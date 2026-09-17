"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/appwrite/auth";
import {
  StaffPolicyError,
  assertStaffRowRemovable,
  findStaffRow,
  recordStaffActivity,
  setStaffRole,
} from "@/lib/appwrite/staff";
import { getRoleLabel, isCmsRole, toCmsRole } from "@workspace/schema";
import { deleteCmsRow } from "@/lib/appwrite/cms";

// Not declared here: a "use server" module may export only async
// functions, so the empty state a client component renders with lives in
// lib/actions/form-state.ts.
import type { StaffFormState } from "@/lib/actions/form-state";

function toMessage(error: unknown) {
  if (error instanceof StaffPolicyError) {
    return error.message;
  }

  return error instanceof Error
    ? error.message
    : "Something went wrong saving that.";
}

/**
 * Grants, changes, or revokes one person's dashboard access.
 *
 * Every rule lives in `lib/appwrite/staff.ts` and is checked there, on the
 * server, against the signed-in user's own role - not against anything the
 * form sent. The form can only ask.
 */
export async function saveStaffRoleAction(
  _previousState: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const actor = await requirePermission("staff.manage", "/dashboard/user_roles");

  const email = String(formData.get("email") ?? "").trim();
  const roleValue = String(formData.get("role") ?? "");
  const note = String(formData.get("note") ?? "").trim();

  if (!email) {
    return { status: "error", message: "Enter the person's email address." };
  }

  if (!isCmsRole(roleValue)) {
    return { status: "error", message: "Pick a role." };
  }

  try {
    const result = await setStaffRole({
      actor,
      email,
      role: roleValue,
      note,
    });

    revalidatePath("/dashboard/user_roles");
    revalidatePath("/dashboard/staff_activity");

    return {
      status: "success",
      message:
        result.action === "role_revoked"
          ? `${email} no longer has dashboard access.`
          : `${email} is now ${getRoleLabel(result.role)}.`,
    };
  } catch (error) {
    return { status: "error", message: toMessage(error) };
  }
}

/**
 * Deletes a role row outright.
 *
 * Rarely the right move - setting somebody back to Student keeps the history
 * of who had access - so it is offered separately and guarded the same way.
 */
export async function removeStaffRoleAction(
  _previousState: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const actor = await requirePermission("staff.manage", "/dashboard/user_roles");
  const userId = String(formData.get("userId") ?? "").trim();

  if (!userId) {
    return { status: "error", message: "Missing the person to remove." };
  }

  try {
    const member = await findStaffRow(userId);

    if (!member) {
      return { status: "error", message: "That person has no role row." };
    }

    await assertStaffRowRemovable({ actor, member });
    await deleteCmsRow("user_roles", member.rowId);

    await recordStaffActivity({
      actor,
      action: "role_revoked",
      summary: `Removed the role row for ${member.email || member.userId} (was ${getRoleLabel(
        toCmsRole(member.role),
      )})`,
      targetTable: "user_roles",
      targetId: member.userId,
    });

    revalidatePath("/dashboard/user_roles");
    revalidatePath("/dashboard/staff_activity");

    return {
      status: "success",
      message: `${member.email || member.userId} was removed from the team list.`,
    };
  } catch (error) {
    return { status: "error", message: toMessage(error) };
  }
}
