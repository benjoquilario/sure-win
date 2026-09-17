/**
 * The shapes `useActionState` hands back, and their initial values.
 *
 * Deliberately **not** a `"use server"` file. Such a file may only export
 * async functions — every other export is compiled into the server-actions
 * manifest, and a plain object there fails the build with:
 *
 *   A "use server" file can only export async functions, found object.
 *
 * A form's empty state is a constant a client component needs at render time,
 * so it cannot live beside the actions that consume it. It lives here instead,
 * and both sides import from one definition rather than keeping two in step.
 *
 * Types alone would have been fine either way — they are erased before any of
 * this matters — but keeping the type next to its constant is what stops the
 * next person from putting the constant back.
 */

import type { MemberSearchResult } from "@/lib/appwrite/membership-grants";

export type StaffFormState = {
  status: "idle" | "success" | "error";
  message: string;
};

export const emptyStaffFormState: StaffFormState = {
  status: "idle",
  message: "",
};

export type MembershipFormState = {
  status: "idle" | "success" | "error";
  message: string;
  results?: MemberSearchResult[];
  /** Kept so the list does not vanish under the person after they act. */
  term?: string;
};

export const emptyMembershipFormState: MembershipFormState = {
  status: "idle",
  message: "",
};
