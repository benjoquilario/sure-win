"use client";

import * as React from "react";
import { Plus } from "lucide-react";

import { RecordForm } from "@/components/dashboard/record-form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { CmsRelationOptionsMap } from "@/lib/appwrite/cms";
import {
  getReviewerTableDefinition,
  type ReviewerTableKey,
} from "@workspace/schema";

/**
 * "Exam Categories" -> "Exam Category", for a button that adds exactly one.
 *
 * Table names are plural because they name a list; a button names the thing it
 * creates. The parenthetical on "Sets (optional)" is a note to the reader, not
 * part of the name.
 */
function toSingularLabel(name: string) {
  const base = name.replace(/\s*\(.*\)\s*$/, "").trim();

  if (/ies$/i.test(base)) {
    return `${base.slice(0, -3)}y`;
  }

  if (/(ss|us|is)$/i.test(base)) {
    return base;
  }

  return /s$/i.test(base) ? base.slice(0, -1) : base;
}

type RecordDialogProps = {
  tableKey: ReviewerTableKey;
  relationOptions?: CmsRelationOptionsMap;
  label?: string;
};

/**
 * The create form, behind a button.
 *
 * It used to sit open on the page above the table, which put a twelve-field
 * form between someone and the rows they came to look at. The table is the
 * page; adding is an action you take from it.
 */
export function RecordDialog({
  tableKey,
  relationOptions,
  label,
}: RecordDialogProps) {
  const definition = getReviewerTableDefinition(tableKey);
  const singular = toSingularLabel(definition.name);
  const [open, setOpen] = React.useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button className="rounded-full" />}>
        <Plus data-icon="inline-start" />
        {label ?? `Add ${singular.toLowerCase()}`}
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>New {singular.toLowerCase()}</DialogTitle>
          <DialogDescription>{definition.description}</DialogDescription>
        </DialogHeader>

        <DialogBody>
          <RecordForm
            bare
            tableKey={tableKey}
            relationOptions={relationOptions}
          />
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
