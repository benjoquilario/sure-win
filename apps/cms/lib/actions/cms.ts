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
  countQuestionsInCategory,
  countQuestionsInSet,
  countSetsInCategory,
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
  getPublishPermission,
  normalizeSetCode,
  roleHasPermission,
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

function buildRecordPayload(
  tableKey: ReviewerTableKey,
  formData: FormData,
  rowId: string | null,
) {
  const definition = getReviewerTableDefinition(tableKey);
  const payload: Record<string, unknown> = {};

  for (const field of definition.fields as readonly CmsFieldDefinition[]) {
    // A read-only field is the system's to write - a counter, a set letter, a
    // derived subject - so whatever the form sent back for it is ignored. The
    // form used to echo these in hidden inputs, which meant saving a category
    // wrote back whatever its question count was when the page was opened,
    // quietly undoing any recount that ran in between.
    if (field.readOnly) {
      // The one thing a read-only field ever needs from a save: a required
      // timestamp is stamped on create, and left alone afterwards.
      if (!rowId && field.required && field.kind === "datetime") {
        payload[field.key] = new Date().toISOString();
      }

      continue;
    }

    // An optional number with no default - a time limit, a passing score -
    // uses blank to mean "the app's default". Parsing would turn blank into 0,
    // which is out of range for a passing score; skipping it would make a
    // value set earlier impossible to clear. Null does both jobs.
    const isClearableNumber =
      (field.kind === "integer" || field.kind === "float") &&
      !field.required &&
      field.defaultValue === undefined;

    if (
      isClearableNumber &&
      formData.has(field.key) &&
      !String(formData.get(field.key) ?? "").trim()
    ) {
      payload[field.key] = null;
      continue;
    }

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
  existing: Record<string, unknown> | null,
) {
  // The set letter belongs to the server: the form never sends one (it is
  // read-only), so a set keeps the letter it has for as long as it stays in
  // its category, and gets the next free letter of wherever it lands - a new
  // set, or an empty one moved to another category.
  if (tableKey === "questionnaires") {
    const categoryId = String(payload.categoryId ?? "").trim();
    const previousCategoryId = String(existing?.categoryId ?? "").trim();
    const staysPut = Boolean(existing) && categoryId === previousCategoryId;
    const currentLetter = staysPut
      ? normalizeSetCode(String(existing?.setCode ?? ""))
      : "";

    payload.setCode =
      currentLetter ||
      (categoryId ? await nextSetCodeForCategory(categoryId, rowId ?? "") : "A");

    // A moved set's short code still starts with its old category's code.
    // Regenerate it - unless the editor typed a new one in the same save.
    if (
      existing &&
      !staysPut &&
      String(payload.code ?? "").trim() === String(existing.code ?? "").trim()
    ) {
      delete payload.code;
    }
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

function pluralize(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function describeSet(row: Record<string, unknown> | null) {
  const title = String(row?.title ?? "").trim();
  const setCode = String(row?.setCode ?? "").trim();

  return title || (setCode ? `Set ${setCode}` : "This set");
}

function describeCategory(row: Record<string, unknown> | null) {
  const title = String(row?.title ?? "").trim();

  return title ? `"${title}"` : "This category";
}

/**
 * Why a category or set cannot be deleted yet, or null when it can.
 *
 * Refused rather than cascaded: one click on a set should not take a hundred
 * encoded questions and their SKUs with it. Appwrite has no foreign keys, so
 * the alternative - deleting just the parent - leaves questions pointing at a
 * category or set that no longer exists, where nobody can find them.
 */
async function explainBlockedDelete(
  tableKey: ReviewerTableKey,
  rowId: string,
  row: Record<string, unknown> | null,
): Promise<string | null> {
  try {
    if (tableKey === "questionnaires") {
      const questions = await countQuestionsInSet(rowId);

      return questions
        ? `${describeSet(row)} still has ${pluralize(questions, "question")}. Move or delete them first.`
        : null;
    }

    if (tableKey === "exam_categories") {
      const [sets, questions] = await Promise.all([
        countSetsInCategory(rowId),
        countQuestionsInCategory(rowId),
      ]);

      if (!sets && !questions) {
        return null;
      }

      const contents = [
        sets ? pluralize(sets, "set") : "",
        questions ? pluralize(questions, "question") : "",
      ]
        .filter(Boolean)
        .join(" and ");

      return `${describeCategory(row)} still has ${contents}. Move or delete them first.`;
    }

    return null;
  } catch {
    // Fail closed: not knowing whether it is empty is not the same as empty.
    return "Could not check whether it is empty, so nothing was deleted. Try again.";
  }
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
  // `create`/`edit` let an encoder write the row; making it live for students
  // is a separate call, which is the point of having someone check the work.
  const publishPermission = getPublishPermission(tableKey);

  // The stored row, for the checks that depend on what is changing rather than
  // on what was sent: publishing, and moving a set between categories.
  const existing =
    resolvedRowId && publishPermission
      ? await getCmsRow(tableKey, resolvedRowId)
      : null;

  const formPayload = buildRecordPayload(tableKey, formData, resolvedRowId);

  // Only a change of visibility needs the publish permission, so an encoder can
  // still fix a typo in a live category without being bounced. A new row
  // counts as a change when it is created already visible. An unreadable
  // stored row counts as unpublished, which errs towards asking.
  if (publishPermission && typeof formPayload.isPublished === "boolean") {
    const wasPublished = existing?.isPublished === true;
    const changesVisibility = resolvedRowId
      ? formPayload.isPublished !== wasPublished
      : formPayload.isPublished;

    if (
      changesVisibility &&
      !roleHasPermission(cmsUser.role, publishPermission)
    ) {
      const verb = formPayload.isPublished ? "publish" : "unpublish";

      redirect(
        `/dashboard/${tableKey}?error=${encodeURIComponent(
          `Your role cannot ${verb} this. Save it with "Visible in the app" left as it was, and ask a moderator to ${verb} it.`,
        )}`,
      );
    }
  }

  // A set with questions stays in its category. Moving it would leave every
  // question's categoryId pointing at the old one - counted there, listed
  // there, served under the wrong subject - while the set itself shows up
  // somewhere else. An empty set has nothing to strand, so it may move.
  const previousCategoryId =
    tableKey === "questionnaires"
      ? String(existing?.categoryId ?? "").trim()
      : "";
  const movedFromCategoryId =
    previousCategoryId &&
    previousCategoryId !== String(formPayload.categoryId ?? "").trim()
      ? previousCategoryId
      : "";

  if (resolvedRowId && movedFromCategoryId) {
    let questionsInSet: number | null;

    try {
      questionsInSet = await countQuestionsInSet(resolvedRowId);
    } catch {
      questionsInSet = null;
    }

    if (questionsInSet !== 0) {
      redirect(
        `/dashboard/questionnaires?error=${encodeURIComponent(
          questionsInSet === null
            ? "Could not check whether this set is empty, so it was not moved. Try again."
            : `${describeSet(existing)} still has ${pluralize(
                questionsInSet,
                "question",
              )}, so it cannot move to another category. Move or delete them first, or add a new set in the other category.`,
        )}`,
      );
    }
  }

  const payload = await applyContentDefaults(
    tableKey,
    await applyGeneratedCodes(tableKey, formPayload, resolvedRowId, existing),
    resolvedRowId,
  );
  const createdRow = await saveCmsRow(tableKey, resolvedRowId, payload);

  // Adding a set, or publishing one, changes the category's setCount - which is
  // what tells the mobile app whether to open a set picker at all. A set that
  // moved changes two categories' counts.
  if (tableKey === "questionnaires") {
    const categoryId = String(payload.categoryId ?? "").trim();

    if (categoryId) {
      await syncCategoryRollups(categoryId);
    }

    if (movedFromCategoryId) {
      await syncCategoryRollups(movedFromCategoryId);
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
    tableKey === "exam_categories" ||
    tableKey === "learning_materials" ||
    tableKey === "topics"
      ? await getCmsRow(tableKey, rowId)
      : null;

  const blocked = await explainBlockedDelete(tableKey, rowId, doomed);

  if (blocked) {
    redirect(`/dashboard/${tableKey}?error=${encodeURIComponent(blocked)}`);
  }

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
