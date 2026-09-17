"use client";

import * as React from "react";
import { FileSpreadsheet, PencilLine, Plus } from "lucide-react";

import {
  QuestionEditor,
  type EditorCategoryOption,
  type QuestionEditorValues,
} from "@/components/dashboard/question-editor";
import {
  QuestionImportCard,
  type ImportCategoryOption,
} from "@/components/dashboard/question-import-card";
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
import {
  Tabs,
  TabsContent,
  TabsIndicator,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";

type QuestionDialogProps = {
  /** Categories with their sets, for both the editor and the importer. */
  categories: ImportCategoryOption[];
  editorCategories: EditorCategoryOption[];
  values: QuestionEditorValues;
  nextItemNumbers?: {
    byCategory: Record<string, number>;
    bySet: Record<string, number>;
  };
  initialCategoryId?: string;
  initialSetId?: string;
  label?: string;
};

/**
 * Adding questions, one way or the other, from a single button.
 *
 * The two routes in - typing one out and uploading a hundred - are the same
 * job at different scales, so they belong behind one control rather than in
 * two places someone has to know to look. Typing one is the tab that opens,
 * because it is the one people reach for without being told.
 */
export function QuestionDialog({
  categories,
  editorCategories,
  values,
  nextItemNumbers,
  initialCategoryId,
  initialSetId,
  label = "Add questions",
}: QuestionDialogProps) {
  const [open, setOpen] = React.useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button className="rounded-full" />}>
        <Plus data-icon="inline-start" />
        {label}
      </DialogTrigger>

      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>Add questions</DialogTitle>
          <DialogDescription>
            Type one out, or upload a filled-in Excel or CSV sheet. Item numbers
            and SKUs are assigned either way.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="manual" className="min-h-0 flex-1 gap-0">
          <div className="shrink-0 border-b border-border/70 px-6 pb-4 pt-4">
            <TabsList>
              <TabsIndicator />
              <TabsTrigger value="manual">
                <PencilLine className="size-4" />
                One at a time
              </TabsTrigger>
              <TabsTrigger value="import">
                <FileSpreadsheet className="size-4" />
                Excel or CSV
              </TabsTrigger>
            </TabsList>
          </div>

          <DialogBody>
            <TabsContent value="manual">
              <QuestionEditor
                bare
                categories={editorCategories}
                values={values}
                nextItemNumbers={nextItemNumbers}
              />
            </TabsContent>

            <TabsContent value="import">
              <QuestionImportCard
                bare
                categories={categories}
                initialCategoryId={initialCategoryId}
                initialSetId={initialSetId}
              />
            </TabsContent>
          </DialogBody>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
