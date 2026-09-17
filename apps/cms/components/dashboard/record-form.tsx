"use client";

import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TiptapRichTextField } from "@/components/editor/tiptap-rich-text-field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { saveCmsRecord } from "@/lib/actions/cms";
import { cn } from "@/lib/utils";
import {
  getReviewerTableDefinition,
  type CmsFieldDefinition,
  type ReviewerTableKey,
} from "@workspace/schema";
import type { CmsRelationOptionsMap, CmsRow } from "@/lib/appwrite/cms";

type RecordFormProps = {
  tableKey: ReviewerTableKey;
  row?: CmsRow | null;
  relationOptions?: CmsRelationOptionsMap;
  /**
   * Drops the card chrome so the form can sit inside a dialog, which supplies
   * its own title and border.
   */
  bare?: boolean;
};

const RELATION_NONE_VALUE = "__none__";

function formatDateTimeValue(value: unknown) {
  if (typeof value !== "string" || !value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const pad = (input: number) => String(input).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function stringifyValue(value: unknown) {
  if (Array.isArray(value)) {
    return value.join("\n");
  }

  if (value === null || value === undefined) {
    return "";
  }

  return String(value);
}

function getDateTimeInputValue(
  value: unknown,
  defaultValue: unknown,
  rowExists: boolean,
) {
  const resolvedValue =
    value ?? defaultValue ?? (rowExists ? "" : new Date().toISOString());
  return formatDateTimeValue(resolvedValue);
}

export function RecordForm({
  tableKey,
  row,
  relationOptions,
  bare = false,
}: RecordFormProps) {
  const definition = getReviewerTableDefinition(tableKey);
  const fields = definition.fields as readonly CmsFieldDefinition[];
  const requiredRichTextFields = React.useMemo(
    () =>
      fields.filter(
        (field) => field.kind === "richtext" && field.required,
      ),
    [fields],
  );
  const [richTextErrors, setRichTextErrors] = React.useState<
    Record<string, string>
  >({});
  const [switchValues, setSwitchValues] = React.useState<
    Record<string, boolean>
  >(() =>
    Object.fromEntries(
      fields
        .filter((field) => field.kind === "boolean")
        .map((field) => [
          field.key,
          Boolean(row?.[field.key] ?? field.defaultValue),
        ]),
    ),
  );
  const [selectValues, setSelectValues] = React.useState<
    Record<string, string>
  >(() =>
    Object.fromEntries(
      fields
        .filter((field) => field.kind === "enum")
        .map((field) => [
          field.key,
          stringifyValue(row?.[field.key] ?? field.defaultValue),
        ]),
    ),
  );
  const [relationValues, setRelationValues] = React.useState<
    Record<string, string>
  >(() =>
    Object.fromEntries(
      fields
        .filter(
          (field) =>
            Boolean(relationOptions?.[field.key]) && field.kind !== "enum",
        )
        .map((field) => [
          field.key,
          stringifyValue(row?.[field.key] ?? field.defaultValue),
        ]),
    ),
  );
  const handleSubmit = React.useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      if (!requiredRichTextFields.length) {
        if (Object.keys(richTextErrors).length) {
          setRichTextErrors({});
        }
        return;
      }

      const formData = new FormData(event.currentTarget);
      const nextErrors: Record<string, string> = {};

      for (const field of requiredRichTextFields) {
        const value = String(formData.get(field.key) ?? "").trim();
        if (!value) {
          nextErrors[field.key] = `${field.label} is required.`;
        }
      }

      if (Object.keys(nextErrors).length) {
        event.preventDefault();
        setRichTextErrors(nextErrors);
        return;
      }

      if (Object.keys(richTextErrors).length) {
        setRichTextErrors({});
      }
    },
    [requiredRichTextFields, richTextErrors],
  );

  return (
    <Card
      className={cn(
        "border-border/80 bg-card/80 shadow-2xl shadow-black/20 backdrop-blur",
        // Card draws its outline with `ring-1` and pads with `py-6`, so a
        // dialog that already supplies both would otherwise show a second box
        // inside itself, inset twice.
        bare &&
          "gap-0 overflow-visible rounded-none bg-transparent py-0 shadow-none ring-0 backdrop-blur-none",
      )}
    >
      {bare ? null : (
        <CardHeader>
          <div className="space-y-3">
            <Badge className="w-fit uppercase tracking-[0.26em] text-[10px]">
              {row ? "Edit Record" : "Create Record"}
            </Badge>
            <div>
              <CardTitle className="text-2xl">{definition.name}</CardTitle>
              <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
                {definition.description}
              </p>
            </div>
          </div>
        </CardHeader>
      )}
      <CardContent className={cn(bare && "p-0")}>
        <form action={saveCmsRecord} className="space-y-5" onSubmit={handleSubmit}>
          <input type="hidden" name="tableKey" value={tableKey} />
          <input type="hidden" name="rowId" value={row?.$id ?? ""} />

          <div className="grid gap-4 lg:grid-cols-2">
            {fields.map((field) => {
              const fieldValue = row?.[field.key];
              const isRelationField =
                field.kind !== "enum" &&
                Array.isArray(relationOptions?.[field.key]);
              const relationFieldOptions = isRelationField
                ? (relationOptions?.[field.key] ?? [])
                : [];
              const relationValue = isRelationField
                ? (relationValues[field.key] ??
                  stringifyValue(fieldValue ?? field.defaultValue))
                : "";

              // Find the matching option to display its formatted label
              const matchingOption = relationFieldOptions.find(
                (option) => option.value === relationValue,
              );

              const hasCurrentRelationOption = Boolean(matchingOption);
              const currentDisplayLabel =
                matchingOption?.label ?? "Linked record";
              const richTextError = richTextErrors[field.key];
              const richTextErrorId = richTextError
                ? `${field.key}-error`
                : undefined;

              const resolvedRelationOptions =
                isRelationField && relationValue && !hasCurrentRelationOption
                  ? [
                      {
                        value: relationValue,
                        label: currentDisplayLabel,
                      },
                      ...relationFieldOptions,
                    ]
                  : relationFieldOptions;

              return (
                <div
                  key={field.key}
                  className={cn(
                    "space-y-2 text-sm",
                    field.kind === "text" ||
                      field.kind === "richtext" ||
                      field.kind === "string[]"
                      ? "lg:col-span-2"
                      : "",
                  )}
                >
                  <div className="flex items-center justify-between gap-4">
                    <Label htmlFor={field.key}>{field.label}</Label>
                    {field.required ? (
                      <Badge
                        variant="outline"
                        className="uppercase tracking-[0.18em] text-[10px]"
                      >
                        Required
                      </Badge>
                    ) : null}
                  </div>

                  {field.readOnly ? (
                    <>
                      <input
                        type="hidden"
                        name={field.key}
                        value={stringifyValue(fieldValue ?? field.defaultValue)}
                      />
                      <div className="rounded-2xl border border-border/70 bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
                        {stringifyValue(fieldValue) ||
                          field.placeholder ||
                          stringifyValue(field.defaultValue) ||
                          "Set automatically"}
                      </div>
                    </>
                  ) : field.kind === "richtext" ? (
                    <TiptapRichTextField
                      id={field.key}
                      name={field.key}
                      defaultValue={stringifyValue(fieldValue ?? field.defaultValue)}
                      placeholder={field.placeholder}
                      invalid={Boolean(richTextError)}
                      ariaDescribedBy={richTextErrorId}
                      onValueChange={(value) => {
                        setRichTextErrors((current) => {
                          if (!current[field.key] || !value.trim()) {
                            return current;
                          }

                          const nextErrors = { ...current };
                          delete nextErrors[field.key];
                          return nextErrors;
                        });
                      }}
                    />
                  ) : field.kind === "text" || field.kind === "string[]" ? (
                    <Textarea
                      id={field.key}
                      name={field.key}
                      defaultValue={stringifyValue(fieldValue ?? field.defaultValue)}
                      required={field.required}
                      placeholder={field.placeholder}
                      rows={4}
                    />
                  ) : field.kind === "boolean" ? (
                    <div className="flex items-center justify-between rounded-2xl border border-border/70 bg-muted/30 px-4 py-3">
                      <input
                        type="hidden"
                        name={field.key}
                        value={switchValues[field.key] ? "true" : "false"}
                      />
                      <div className="pr-4">
                        <p className="text-sm font-medium">{field.label}</p>
                        <p className="text-xs text-muted-foreground">
                          {field.description ??
                            `Turn on to enable ${field.label.toLowerCase()}.`}
                        </p>
                      </div>
                      <Switch
                        checked={switchValues[field.key]}
                        onCheckedChange={(checked) =>
                          setSwitchValues((current) => ({
                            ...current,
                            [field.key]: checked,
                          }))
                        }
                      />
                    </div>
                  ) : isRelationField ? (
                    <>
                      <input
                        type="hidden"
                        name={field.key}
                        value={relationValue}
                      />
                      <Select
                        value={
                          field.required
                            ? relationValue
                            : relationValue || RELATION_NONE_VALUE
                        }
                        onValueChange={(value) =>
                          setRelationValues((current) => ({
                            ...current,
                            [field.key]:
                              value === RELATION_NONE_VALUE
                                ? ""
                                : (value ?? ""),
                          }))
                        }
                      >
                        <SelectTrigger id={field.key}>
                          {relationValue ? (
                            resolvedRelationOptions.find(
                              (opt) => opt.value === relationValue,
                            )?.label ||
                            currentDisplayLabel ||
                            field.placeholder ||
                            `Select ${field.label.toLowerCase()}`
                          ) : (
                            <SelectValue
                              placeholder={
                                field.placeholder ??
                                `Select ${field.label.toLowerCase()}`
                              }
                            />
                          )}
                        </SelectTrigger>
                        <SelectContent>
                          {!field.required ? (
                            <SelectItem value={RELATION_NONE_VALUE}>
                              No linked record
                            </SelectItem>
                          ) : null}
                          {resolvedRelationOptions.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </>
                  ) : field.kind === "enum" ? (
                    <>
                      <input
                        type="hidden"
                        name={field.key}
                        value={selectValues[field.key]}
                      />
                      <Select
                        value={selectValues[field.key]}
                        onValueChange={(value) =>
                          setSelectValues((current) => ({
                            ...current,
                            [field.key]: value ?? "",
                          }))
                        }
                      >
                        <SelectTrigger id={field.key}>
                          {selectValues[field.key] ? (
                            (field.optionLabels?.[selectValues[field.key]] ??
                            selectValues[field.key])
                          ) : (
                            <SelectValue
                              placeholder={
                                field.placeholder ??
                                `Select ${field.label.toLowerCase()}`
                              }
                            />
                          )}
                        </SelectTrigger>
                        <SelectContent>
                          {field.options?.map((option) => (
                            <SelectItem key={option} value={option}>
                              {field.optionLabels?.[option] ?? option}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </>
                  ) : (
                    <Input
                      id={field.key}
                      type={
                        field.kind === "integer" || field.kind === "float"
                          ? "number"
                          : field.kind === "datetime"
                            ? "datetime-local"
                            : "text"
                      }
                      name={field.key}
                      defaultValue={
                        field.kind === "datetime"
                          ? getDateTimeInputValue(
                              fieldValue,
                              field.defaultValue,
                              Boolean(row),
                            )
                          : stringifyValue(fieldValue ?? field.defaultValue)
                      }
                      required={field.required}
                      min={field.min}
                      max={field.max}
                      step={field.kind === "float" ? "0.01" : undefined}
                      placeholder={field.placeholder}
                    />
                  )}

                  {richTextError ? (
                    <span
                      id={richTextErrorId}
                      className="block text-xs text-destructive"
                    >
                      {richTextError}
                    </span>
                  ) : null}

                  {/* Booleans already print their description inside the toggle. */}
                  {field.description && field.kind !== "boolean" ? (
                    <span className="block text-xs text-muted-foreground">
                      {field.description}
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" size="lg" className="rounded-full">
              {row ? "Save Changes" : "Create Record"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
