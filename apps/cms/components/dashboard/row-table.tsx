import type { ReactNode } from "react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { deleteCmsRecord } from "@/lib/actions/cms";
import { deleteQuestionAction } from "@/lib/actions/questions";
import {
  getReviewerTableDefinition,
  type ReviewerTableKey,
} from "@workspace/schema";
import type { CmsRelationOptionsMap, CmsRow } from "@/lib/appwrite/cms";

type RowTableProps = {
  tableKey: ReviewerTableKey;
  /**
   * Split, because they are two different permissions and two different
   * tables: student data can be deleted but never edited, the audit log
   * neither, and an encoder may edit a question they may not delete.
   */
  canEdit?: boolean;
  canDelete?: boolean;
  rows: CmsRow[];
  relationOptions?: CmsRelationOptionsMap;
  emptyMessage?: string;
  caption?: string;
};

/**
 * Columns worth seeing, for tables where the first four schema fields are
 * plumbing. A question row starts with three IDs; what an editor scans for is
 * the item number and the wording.
 */
const visibleFieldOverrides: Partial<Record<ReviewerTableKey, string[]>> = {
  questions: ["order", "prompt", "questionType", "difficulty", "sku"],
  questionnaires: ["title", "mode", "setCode", "questionCount", "isPublished"],
  subjects: ["name", "topicCount", "materialCount", "order", "isPublished"],
  topics: ["title", "subjectId", "materialCount", "order", "isPublished"],
  learning_materials: ["title", "type", "topicId", "order", "isPublished"],
  exam_categories: [
    "title",
    "mode",
    "setCount",
    "questionCount",
    "isPublished",
  ],
};

const MAX_TEXT_PREVIEW = 120;
const MAX_ARRAY_PREVIEW = 3;

function formatValue(value: unknown): ReactNode {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span className="text-muted-foreground">-</span>;
    }

    const preview = value
      .slice(0, MAX_ARRAY_PREVIEW)
      .map((item) => String(item));

    return (
      <div className="flex max-w-xs flex-wrap gap-1.5">
        {preview.map((item, index) => (
          <Badge
            key={`${item}-${index}`}
            variant="outline"
            className="rounded-full px-2 text-[11px]"
          >
            {item}
          </Badge>
        ))}
        {value.length > preview.length ? (
          <Badge variant="outline" className="rounded-full px-2 text-[11px]">
            +{value.length - preview.length}
          </Badge>
        ) : null}
      </div>
    );
  }

  if (typeof value === "boolean") {
    return (
      <Badge
        variant={value ? "secondary" : "outline"}
        className="rounded-full px-2 text-[11px]"
      >
        {value ? "Yes" : "No"}
      </Badge>
    );
  }

  if (value === null || value === undefined || value === "") {
    return <span className="text-muted-foreground">-</span>;
  }

  const text = String(value);
  const preview =
    text.length > MAX_TEXT_PREVIEW
      ? `${text.slice(0, MAX_TEXT_PREVIEW)}...`
      : text;

  return (
    <span className="block max-w-xs wrap-break-word leading-6" title={text}>
      {preview}
    </span>
  );
}

function resolveRelationValue(
  fieldKey: string,
  value: unknown,
  relationOptions?: CmsRelationOptionsMap,
) {
  const options = relationOptions?.[fieldKey];

  if (!options?.length) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => {
      const normalizedItem = String(item ?? "").trim();
      const match = options.find((option) => option.value === normalizedItem);
      return match?.label ?? item;
    });
  }

  const normalizedValue = String(value ?? "").trim();

  if (!normalizedValue) {
    return value;
  }

  const match = options.find((option) => option.value === normalizedValue);
  return match?.label ?? value;
}

export function RowTable({
  tableKey,
  canEdit = true,
  canDelete = true,
  rows,
  relationOptions,
  emptyMessage,
  caption,
}: RowTableProps) {
  const definition = getReviewerTableDefinition(tableKey);
  const overrideKeys = visibleFieldOverrides[tableKey];
  const visibleFields = overrideKeys
    ? overrideKeys
        .map((key) => definition.fields.find((field) => field.key === key))
        .filter((field): field is (typeof definition.fields)[number] =>
          Boolean(field),
        )
    : tableKey === "learning_materials"
      ? (() => {
          const orderField = definition.fields.find(
            (field) => field.key === "order",
          );
          const baseFields = definition.fields.filter(
            (field) => field.key !== "order",
          );

          return orderField
            ? [...baseFields.slice(0, 3), orderField]
            : definition.fields.slice(0, 4);
        })()
      : definition.fields.slice(0, 4);
  const deleteAction =
    tableKey === "questions" ? deleteQuestionAction : deleteCmsRecord;

  return (
    <Card className="overflow-hidden border-border/80 bg-card/80 backdrop-blur">
      <CardHeader className="border-b border-border/70">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.26em] text-primary">
            Records
          </p>
          <CardTitle className="mt-1 text-lg">
            {rows.length} loaded rows
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <div className="px-6 py-10 text-sm text-muted-foreground">
            {emptyMessage ??
              "No rows found yet. Create the first record to start filling this table."}
          </div>
        ) : (
          <Table className="table-fixed">
            <TableCaption className="px-6 pb-4 text-left">
              {caption ?? `Showing ${rows.length} rows from ${definition.name}.`}
            </TableCaption>
            <TableHeader className="bg-muted/40">
              <TableRow>
                {visibleFields.map((field) => (
                  <TableHead
                    key={field.key}
                    className="px-6 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground"
                  >
                    {field.label}
                  </TableHead>
                ))}
                <TableHead className="w-55 px-6 text-right text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Actions
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.$id} className="align-top even:bg-muted/20">
                  {visibleFields.map((field) => (
                    <TableCell
                      key={field.key}
                      className="max-w-xs px-6 py-4 text-sm whitespace-normal text-foreground/90"
                    >
                      {formatValue(
                        resolveRelationValue(
                          field.key,
                          row[field.key],
                          relationOptions,
                        ),
                      )}
                    </TableCell>
                  ))}
                  <TableCell className="px-6 py-4">
                    <div className="flex flex-wrap justify-end gap-2">
                      {canEdit ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="rounded-full uppercase tracking-[0.18em]"
                          nativeButton={false}
                          render={
                            <Link href={`/dashboard/${tableKey}/${row.$id}`} />
                          }
                        >
                          Edit
                        </Button>
                      ) : null}
                      {canDelete ? (
                        <form action={deleteAction}>
                          <input
                            type="hidden"
                            name="tableKey"
                            value={tableKey}
                          />
                          <input type="hidden" name="rowId" value={row.$id} />
                          <Button
                            type="submit"
                            variant="destructive"
                            size="sm"
                            className="rounded-full uppercase tracking-[0.18em]"
                          >
                            Delete
                          </Button>
                        </form>
                      ) : null}
                      {!canEdit && !canDelete ? (
                        <span className="text-xs text-muted-foreground">
                          View only
                        </span>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
