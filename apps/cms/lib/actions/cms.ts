"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ID, MessagePriority } from "node-appwrite";

import {
  requirePermission,
  requireTablePermission,
} from "@/lib/appwrite/auth";
import { appwriteEnv, hasAppwriteServerEnv } from "@/lib/appwrite/env";
import { deleteCmsRow, getCmsRow, saveCmsRow } from "@/lib/appwrite/cms";
import {
  CONTENT_TABLE_IDS,
  getNextContentOrder,
  getTopicSubjectId,
  syncContentCounts,
} from "@/lib/appwrite/content";
import {
  generateExamCategoryCode,
  generateSetCode,
  nextSetCodeForCategory,
  syncCategoryRollups,
} from "@/lib/appwrite/questions";
import {
  generateAccessCode,
  syncMembershipFromSubscriptions,
} from "@/lib/appwrite/subscriptions";
import {
  DEFAULT_ROLE,
  getReviewerTableDefinition,
  isReviewerTableKey,
  normalizeSetCode,
  toCmsRole,
  type CmsFieldDefinition,
  type ReviewerTableKey,
} from "@workspace/schema";
import {
  StaffPolicyError,
  assertRoleChangeAllowed,
  findStaffRow,
  recordStaffActivity,
} from "@/lib/appwrite/staff";
import { getAdminServices } from "@/lib/appwrite/server";

function parseArray(value: FormDataEntryValue | null) {
  return String(value ?? "")
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseFieldValue(
  field: CmsFieldDefinition,
  rawValue: FormDataEntryValue | null,
  formData: FormData,
) {
  switch (field.kind) {
    case "integer": {
      const fallback =
        typeof field.defaultValue === "number" ? field.defaultValue : 0;
      const value = Number(rawValue ?? fallback);
      return Number.isFinite(value) ? Math.trunc(value) : fallback;
    }
    case "float": {
      const fallback =
        typeof field.defaultValue === "number" ? field.defaultValue : 0;
      const value = Number(rawValue ?? fallback);
      return Number.isFinite(value) ? value : fallback;
    }
    case "boolean": {
      return formData.get(field.key) === "on" || rawValue === "true";
    }
    case "datetime": {
      if (!rawValue) {
        return field.required ? new Date().toISOString() : null;
      }

      const value = new Date(String(rawValue));
      return Number.isNaN(value.getTime())
        ? new Date().toISOString()
        : value.toISOString();
    }
    case "string[]": {
      return parseArray(rawValue);
    }
    default: {
      const value = String(rawValue ?? "").trim();
      if (!value && field.required) {
        return field.defaultValue ?? "";
      }
      return value || null;
    }
  }
}

function buildRecordPayload(tableKey: ReviewerTableKey, formData: FormData) {
  const definition = getReviewerTableDefinition(tableKey);
  const payload: Record<string, unknown> = {};

  for (const field of definition.fields) {
    const parsedValue = parseFieldValue(
      field,
      formData.get(field.key),
      formData,
    );

    if (parsedValue !== null && parsedValue !== "") {
      payload[field.key] = parsedValue;
    }
  }

  return payload;
}

/** Which list a row's position is counted within, per table. */
const ORDER_SCOPES: Partial<
  Record<ReviewerTableKey, { tableId: string; parentField: string | null }>
> = {
  subjects: { tableId: CONTENT_TABLE_IDS.subjects, parentField: null },
  topics: { tableId: CONTENT_TABLE_IDS.topics, parentField: "subjectId" },
  learning_materials: {
    tableId: CONTENT_TABLE_IDS.materials,
    parentField: "topicId",
  },
};

/**
 * Fills in the parts of a content row the system can work out for itself.
 *
 * A material's subject comes from its topic - asking for both invites them to
 * disagree - and a blank position means "put it at the end", which is what
 * someone adding a topic almost always wants.
 */
async function applyContentDefaults(
  tableKey: ReviewerTableKey,
  payload: Record<string, unknown>,
  rowId: string | null,
) {
  if (tableKey === "learning_materials") {
    const topicId = String(payload.topicId ?? "").trim();

    if (topicId) {
      payload.subjectId = await getTopicSubjectId(topicId);
    }
  }

  const scope = ORDER_SCOPES[tableKey];
  const hasOrder = String(payload.order ?? "").trim() !== "";

  // Only on create: re-saving an existing row must not move it.
  if (scope && !hasOrder && !rowId) {
    payload.order = await getNextContentOrder(
      scope.tableId,
      scope.parentField,
      scope.parentField ? String(payload[scope.parentField] ?? "").trim() : "",
    );
  }

  return payload;
}

/**
 * Fills in the identifiers nobody should have to invent.
 *
 * Same principle as question SKUs: a code is only there to be unique and
 * short, so the system picks one when the field is left blank rather than
 * making an editor guess whether "HSCI-A" is already taken.
 */
async function applyGeneratedCodes(
  tableKey: ReviewerTableKey,
  payload: Record<string, unknown>,
  rowId: string | null,
) {
  // The set letter is free text so it can go past Z, which means it also has to
  // be tidied: "set f" and " f " are both F. Blank means "give me the next one".
  if (tableKey === "questionnaires") {
    const categoryId = String(payload.categoryId ?? "").trim();
    const typed = normalizeSetCode(String(payload.setCode ?? ""));

    payload.setCode =
      typed ||
      (categoryId ? await nextSetCodeForCategory(categoryId, rowId ?? "") : "A");
  }

  const code = String(payload.code ?? "").trim();

  if (code) {
    return payload;
  }

  if (tableKey === "exam_categories") {
    const title = String(payload.title ?? "").trim();

    if (title) {
      payload.code = await generateExamCategoryCode(title);
    }

    return payload;
  }

  // A plan code is a stable handle for receipts, not something to invent.
  if (tableKey === "subscription_plans") {
    const name = String(payload.name ?? "").trim();

    if (name) {
      payload.code =
        name
          .toUpperCase()
          .replace(/[^A-Z0-9]+/g, "")
          .slice(0, 24) || `PLAN${Date.now().toString(36).toUpperCase()}`;
    }

    return payload;
  }

  if (tableKey === "access_codes") {
    payload.code = generateAccessCode();
    return payload;
  }

  if (tableKey === "questionnaires") {
    const categoryId = String(payload.categoryId ?? "").trim();
    const title = String(payload.title ?? "").trim();

    if (categoryId || title) {
      payload.code = await generateSetCode(
        categoryId,
        String(payload.setCode ?? "").trim(),
        title,
      );
    }
  }

  return payload;
}

export async function saveCmsRecord(formData: FormData) {
  if (!hasAppwriteServerEnv()) {
    redirect("/dashboard?error=Appwrite server credentials are not configured");
  }

  const tableKey = String(formData.get("tableKey") ?? "");
  const rowIdValue = String(formData.get("rowId") ?? "").trim();

  if (!isReviewerTableKey(tableKey)) {
    redirect("/dashboard?error=Invalid table requested");
  }

  const resolvedRowId = rowIdValue || null;

  // The UI hides forms somebody cannot use; this is the check that makes that
  // cosmetic. It covers both halves at once - whether the table is authored
  // here at all, and whether this person is the one who authors it.
  const cmsUser = await requireTablePermission(
    tableKey,
    resolvedRowId ? "edit" : "create",
    `/dashboard/${tableKey}`,
  );

  // Handing out a role is not an ordinary edit, so the ordinary form does not
  // get to do it unchecked: rank, self-edits, and the last-owner rule all
  // apply however the change arrives.
  if (tableKey === "user_roles") {
    try {
      const targetUserId = String(formData.get("userId") ?? "").trim();
      const existing = targetUserId ? await findStaffRow(targetUserId) : null;

      await assertRoleChangeAllowed({
        actor: cmsUser,
        targetUserId,
        nextRole: toCmsRole(formData.get("role")),
        currentRole: existing?.role ?? DEFAULT_ROLE,
      });
    } catch (error) {
      redirect(
        `/dashboard/user_roles?error=${encodeURIComponent(
          error instanceof StaffPolicyError
            ? error.message
            : "That role change was refused.",
        )}`,
      );
    }
  }
  const payload = await applyContentDefaults(
    tableKey,
    await applyGeneratedCodes(
      tableKey,
      buildRecordPayload(tableKey, formData),
      resolvedRowId,
    ),
    resolvedRowId,
  );
  const createdRow = await saveCmsRow(tableKey, resolvedRowId, payload);

  // Adding a set, or publishing one, changes the category's setCount - which is
  // what tells the mobile app whether to open a set picker at all.
  if (tableKey === "questionnaires") {
    const categoryId = String(payload.categoryId ?? "").trim();

    if (categoryId) {
      await syncCategoryRollups(categoryId);
    }
  }

  // Membership is derived, so any change to a subscription refreshes the
  // cached flags on the student's profile rather than trusting a form.
  if (tableKey === "subscriptions") {
    const subscriberId = String(payload.userId ?? "").trim();

    if (subscriberId) {
      await syncMembershipFromSubscriptions(subscriberId);
    }
  }

  // A material changes its topic's count and its subject's; a topic changes
  // only its subject's.
  if (tableKey === "learning_materials") {
    await syncContentCounts(
      String(payload.topicId ?? "").trim(),
      String(payload.subjectId ?? "").trim(),
    );
  } else if (tableKey === "topics") {
    await syncContentCounts("", String(payload.subjectId ?? "").trim());
  }

  await recordStaffActivity({
    actor: cmsUser,
    action: resolvedRowId ? "record_updated" : "record_created",
    summary: `${resolvedRowId ? "Updated" : "Created"} a ${getReviewerTableDefinition(
      tableKey,
    ).name} record`,
    targetTable: tableKey,
    targetId: createdRow.$id,
  });

  revalidatePath("/dashboard");
  revalidatePath(`/dashboard/${tableKey}`);
  revalidatePath("/dashboard/subjects");
  revalidatePath("/dashboard/topics");

  redirect(`/dashboard/${tableKey}/${createdRow.$id}?success=saved`);
}

export async function deleteCmsRecord(formData: FormData) {
  const tableKey = String(formData.get("tableKey") ?? "");
  const rowId = String(formData.get("rowId") ?? "").trim();

  if (!isReviewerTableKey(tableKey) || !rowId) {
    redirect("/dashboard?error=Missing record target");
  }

  const cmsUser = await requireTablePermission(
    tableKey,
    "delete",
    `/dashboard/${tableKey}`,
  );

  // Deleting a role row is a revocation. Same rules as granting one.
  if (tableKey === "user_roles") {
    try {
      const row = await getCmsRow("user_roles", rowId);

      await assertRoleChangeAllowed({
        actor: cmsUser,
        targetUserId: String(row?.userId ?? ""),
        nextRole: DEFAULT_ROLE,
        currentRole: toCmsRole(row?.role),
      });
    } catch (error) {
      redirect(
        `/dashboard/user_roles?error=${encodeURIComponent(
          error instanceof StaffPolicyError
            ? error.message
            : "That role change was refused.",
        )}`,
      );
    }
  }

  // Read the parents before the row is gone, so they can be recounted after.
  const doomed =
    tableKey === "questionnaires" ||
    tableKey === "learning_materials" ||
    tableKey === "topics"
      ? await getCmsRow(tableKey, rowId)
      : null;

  await deleteCmsRow(tableKey, rowId);

  if (tableKey === "questionnaires") {
    const categoryId = String(doomed?.categoryId ?? "").trim();

    if (categoryId) {
      await syncCategoryRollups(categoryId);
    }
  } else if (tableKey === "learning_materials") {
    await syncContentCounts(
      String(doomed?.topicId ?? "").trim(),
      String(doomed?.subjectId ?? "").trim(),
    );
  } else if (tableKey === "topics") {
    await syncContentCounts("", String(doomed?.subjectId ?? "").trim());
  }

  await recordStaffActivity({
    actor: cmsUser,
    action: "record_deleted",
    summary: `Deleted a ${getReviewerTableDefinition(tableKey).name} record`,
    targetTable: tableKey,
    targetId: rowId,
  });

  revalidatePath("/dashboard");
  revalidatePath(`/dashboard/${tableKey}`);
  revalidatePath("/dashboard/subjects");
  revalidatePath("/dashboard/topics");
  redirect(`/dashboard/${tableKey}?success=deleted`);
}

export async function sendNotificationMessage(formData: FormData) {
  const cmsUser = await requirePermission("announcements.send");

  if (!hasAppwriteServerEnv()) {
    redirect("/dashboard?error=Appwrite server credentials are not configured");
  }

  const channel = String(formData.get("channel") ?? "email");
  const topicList = parseArray(formData.get("topics"));
  const userList = parseArray(formData.get("users"));
  const targetList = parseArray(formData.get("targets"));
  const scheduledAtValue = String(formData.get("scheduledAt") ?? "").trim();
  const scheduledAt = scheduledAtValue
    ? new Date(scheduledAtValue).toISOString()
    : undefined;
  const { messaging } = getAdminServices();
  const messageId = ID.unique();

  if (channel === "email") {
    await messaging.createEmail({
      messageId,
      subject: String(formData.get("subject") ?? "CMS Notification"),
      content: String(formData.get("content") ?? ""),
      topics: topicList,
      users: userList,
      targets: targetList,
      html: true,
      scheduledAt,
    });
  } else if (channel === "sms") {
    await messaging.createSms({
      messageId,
      content: String(formData.get("content") ?? ""),
      topics: topicList,
      users: userList,
      targets: targetList,
      scheduledAt,
    });
  } else {
    await messaging.createPush({
      messageId,
      title: String(formData.get("subject") ?? "Social Work Reviewer"),
      body: String(formData.get("content") ?? ""),
      topics: topicList,
      users: userList,
      targets: targetList,
      scheduledAt,
      priority: MessagePriority.High,
      data: {
        source: "cms-dashboard",
        projectName: appwriteEnv.projectName,
      },
    });
  }

  await recordStaffActivity({
    actor: cmsUser,
    action: "announcement_sent",
    summary: `Sent a ${channel} announcement: ${String(
      formData.get("subject") ?? "",
    ).slice(0, 120)}`,
  });

  redirect("/dashboard?success=notification_queued");
}
