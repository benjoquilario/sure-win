"use client";

import * as React from "react";
import { Check, Minus, ShieldCheck, UserPlus } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { emptyStaffFormState } from "@/lib/actions/form-state";
import { saveStaffRoleAction } from "@/lib/actions/staff";
import {
  canGrantRole,
  canManageStaffMember,
  cmsPermissionCatalog,
  cmsPermissionKeys,
  cmsRoleOrder,
  getRoleDefinition,
  getRoleLabel,
  isStaffRole,
  roleHasPermission,
  type CmsPermission,
  type CmsRole,
} from "@workspace/schema";
import type { StaffMember } from "@/lib/appwrite/staff";

type StaffAccessPanelProps = {
  actorRole: CmsRole;
  canManage: boolean;
  members: StaffMember[];
};

/**
 * Only the jobs get a column.
 *
 * Student and Member are both rank 0 with no permissions at all, so a column
 * for each would be two identical columns of dashes - and would suggest the
 * choice between them means something here. It does not.
 */
const MATRIX_ROLES = cmsRoleOrder.filter((role) => isStaffRole(role));

/** Permissions grouped by the domain they name, in catalog order. */
function groupPermissions() {
  const groups = new Map<string, CmsPermission[]>();

  for (const permission of cmsPermissionKeys) {
    const domain = permission.split(".")[0];
    groups.set(domain, [...(groups.get(domain) ?? []), permission]);
  }

  return [...groups.entries()];
}

function formatDate(value: string) {
  if (!value) {
    return "";
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? ""
    : parsed.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
}

function RoleBadge({ role }: { role: CmsRole }) {
  return (
    <Badge
      variant={isStaffRole(role) ? "secondary" : "outline"}
      className="whitespace-nowrap"
    >
      {getRoleLabel(role)}
    </Badge>
  );
}

/**
 * The form for putting somebody on the team.
 *
 * It asks for an email rather than an Appwrite user ID, because an email is
 * what the person adding a colleague actually has. The server looks the
 * account up and refuses if there isn't one - which is also the honest answer
 * to "why can't I add them yet": they have not signed in.
 */
function GrantAccessDialog({ actorRole }: { actorRole: CmsRole }) {
  const [state, formAction, pending] = React.useActionState(
    saveStaffRoleAction,
    emptyStaffFormState,
  );
  const [open, setOpen] = React.useState(false);
  const [role, setRole] = React.useState<CmsRole>("encoder");

  const grantable = cmsRoleOrder.filter((option) =>
    canGrantRole(actorRole, option),
  );

  React.useEffect(() => {
    if (state.status === "success") {
      setOpen(false);
    }
  }, [state.status]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button className="rounded-full" />}>
        <UserPlus data-icon="inline-start" />
        Give someone access
      </DialogTrigger>

      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Give someone access</DialogTitle>
          <DialogDescription>
            They have to have signed in to the app at least once, so there is an
            account to attach the role to.
          </DialogDescription>
        </DialogHeader>

        <DialogBody>
          <form action={formAction} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="staff-email">Email address</Label>
              <Input
                id="staff-email"
                name="email"
                type="email"
                required
                autoComplete="off"
                placeholder="colleague@example.com"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="staff-role">Role</Label>
              <input type="hidden" name="role" value={role} />
              <Select
                value={role}
                onValueChange={(value) => setRole(value as CmsRole)}
              >
                <SelectTrigger id="staff-role">
                  {getRoleLabel(role)}
                </SelectTrigger>
                <SelectContent>
                  {grantable.map((option) => (
                    <SelectItem key={option} value={option}>
                      {getRoleLabel(option)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-sm leading-6 text-muted-foreground">
                {getRoleDefinition(role).summary}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="staff-note">Note (optional)</Label>
              <Textarea
                id="staff-note"
                name="note"
                rows={2}
                placeholder="Why this person has access. Worth reading a year from now."
              />
            </div>

            {state.status === "error" ? (
              <Alert variant="destructive">
                <AlertDescription>{state.message}</AlertDescription>
              </Alert>
            ) : null}

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                className="rounded-full"
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" className="rounded-full" disabled={pending}>
                {pending ? "Saving..." : "Grant access"}
              </Button>
            </div>
          </form>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Changing or revoking one person's role, from their row.
 *
 * Revoking sets them back to Member rather than deleting the row, so the
 * record of who had access - and who took it away - survives the revocation.
 */
function ChangeRoleForm({
  actorRole,
  member,
}: {
  actorRole: CmsRole;
  member: StaffMember;
}) {
  const [state, formAction, pending] = React.useActionState(
    saveStaffRoleAction,
    emptyStaffFormState,
  );
  const [role, setRole] = React.useState<CmsRole>(member.role);

  const grantable = cmsRoleOrder.filter((option) =>
    canGrantRole(actorRole, option),
  );

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="email" value={member.email} />
      <input type="hidden" name="note" value={member.note} />
      <input type="hidden" name="role" value={role} />
      <Select
        value={role}
        onValueChange={(value) => setRole(value as CmsRole)}
      >
        <SelectTrigger className="h-9 w-[190px]">
          {getRoleLabel(role)}
        </SelectTrigger>
        <SelectContent>
          {grantable.map((option) => (
            <SelectItem key={option} value={option}>
              {getRoleLabel(option)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        type="submit"
        size="sm"
        variant="outline"
        className="rounded-full"
        disabled={pending || role === member.role}
      >
        {pending ? "Saving..." : "Apply"}
      </Button>
      {state.status === "error" ? (
        <p className="w-full text-xs text-destructive">{state.message}</p>
      ) : null}
    </form>
  );
}

/**
 * Who has access, what each role can do, and the form for changing both.
 *
 * The matrix is not decoration. Someone handing out a role is making a
 * security decision, and the honest way to help them make it is to show what
 * they are handing over - next to the picker, not in a wiki page nobody opens.
 */
export function StaffAccessPanel({
  actorRole,
  canManage,
  members,
}: StaffAccessPanelProps) {
  const groups = groupPermissions();
  const withAccess = members.filter((member) => isStaffRole(member.role));
  const revoked = members.filter((member) => !isStaffRole(member.role));

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1.5">
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="size-5 text-muted-foreground" />
              The team
            </CardTitle>
            <CardDescription>
              {withAccess.length}{" "}
              {withAccess.length === 1 ? "person has" : "people have"} dashboard
              access. Everyone else who uses the app is a member - a student, a
              graduate sitting the board, a practising social worker - and
              nothing here changes what they see in it.
            </CardDescription>
          </div>

          {canManage ? <GrantAccessDialog actorRole={actorRole} /> : null}
        </CardHeader>

        <CardContent className="px-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="px-6">Person</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Granted by</TableHead>
                  <TableHead>When</TableHead>
                  <TableHead className="px-6 text-right">Change</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {withAccess.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="px-6 py-8 text-center text-sm text-muted-foreground"
                    >
                      Nobody has been given access from here yet. Anyone signing
                      in right now is doing it through an email list in the
                      environment.
                    </TableCell>
                  </TableRow>
                ) : null}

                {withAccess.map((member) => {
                  const editable =
                    canManage && canManageStaffMember(actorRole, member.role);

                  return (
                    <TableRow key={member.rowId}>
                      <TableCell className="px-6 py-4">
                        <p className="font-medium">
                          {member.name || member.email || member.userId}
                        </p>
                        {member.name && member.email ? (
                          <p className="text-xs text-muted-foreground">
                            {member.email}
                          </p>
                        ) : null}
                        {member.note ? (
                          <p className="mt-1 max-w-md text-xs leading-5 text-muted-foreground">
                            {member.note}
                          </p>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <RoleBadge role={member.role} />
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {member.grantedBy || "-"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDate(member.grantedAt) || "-"}
                      </TableCell>
                      <TableCell className="px-6 py-4 text-right">
                        {editable ? (
                          <div className="flex justify-end">
                            <ChangeRoleForm
                              actorRole={actorRole}
                              member={member}
                            />
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            {member.role === actorRole
                              ? "Same rank as you"
                              : "Above your rank"}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {revoked.length ? (
            <p className="px-6 pt-4 text-sm text-muted-foreground">
              {revoked.length} former{" "}
              {revoked.length === 1 ? "colleague" : "colleagues"} kept in the
              table with an audience role, so the history of who once had
              access survives.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What each role can do</CardTitle>
          <CardDescription>
            Handing out a role is a security decision, so this is what you are
            handing over. A Super Admin outranks an Admin: only they can appoint
            another Admin or erase collected student records.
          </CardDescription>
        </CardHeader>

        <CardContent className="px-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="px-6">Can</TableHead>
                  {MATRIX_ROLES.map((role) => (
                    <TableHead key={role} className="text-center">
                      {getRoleLabel(role)}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {groups.map(([domain, permissions]) => (
                  <React.Fragment key={domain}>
                    <TableRow className="bg-muted/40">
                      <TableCell
                        colSpan={MATRIX_ROLES.length + 1}
                        className="px-6 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground"
                      >
                        {domain}
                      </TableCell>
                    </TableRow>

                    {permissions.map((permission) => (
                      <TableRow key={permission}>
                        <TableCell className="px-6 py-3 text-sm">
                          {cmsPermissionCatalog[permission]}
                        </TableCell>
                        {MATRIX_ROLES.map((role) => (
                          <TableCell key={role} className="text-center">
                            {roleHasPermission(role, permission) ? (
                              <Check
                                className="mx-auto size-4 text-foreground"
                                aria-label="Yes"
                              />
                            ) : (
                              <Minus
                                className="mx-auto size-4 text-muted-foreground/50"
                                aria-label="No"
                              />
                            )}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </React.Fragment>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
