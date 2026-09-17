"use client";

import * as React from "react";
import { useActionState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { saveQuestionAction } from "@/lib/actions/questions";
import { toChoiceLabel } from "@workspace/schema";
import {
  emptyQuestionFormState,
  findIssue,
  type QuestionFormState,
} from "@/lib/questions/import-state";
import { MAX_CHOICES } from "@/lib/questions/spreadsheet";
import { cn } from "@/lib/utils";

export type EditorCategoryOption = {
  id: string;
  title: string;
  sets: Array<{ id: string; label: string }>;
};

export type QuestionEditorValues = {
  rowId: string;
  sku: string;
  categoryId: string;
  /** Blank means the question sits directly under the category. */
  setId: string;
  order: number;
  prompt: string;
  questionType: "multiple_choice" | "true_false";
  difficulty: "easy" | "medium" | "hard";
  choices: string[];
  answerIndex: number;
  explanation: string;
  imageUrl: string;
  isFree: boolean;
};

type QuestionEditorProps = {
  categories: EditorCategoryOption[];
  values: QuestionEditorValues;
  /** Drops the card chrome for use inside a dialog. */
  bare?: boolean;
  /**
   * Next free item number per destination, so picking a category fills the
   * number in without a round trip.
   */
  nextItemNumbers?: {
    byCategory: Record<string, number>;
    bySet: Record<string, number>;
  };
};

/** Select cannot hold an empty string, so "no set" needs a sentinel. */
const NO_SET_VALUE = "__no_set__";

const TRUE_FALSE_CHOICES = ["True", "False"];
const DIFFICULTIES = ["easy", "medium", "hard"] as const;

function padChoices(choices: readonly string[]) {
  const filled = choices.filter((choice) => choice.trim().length > 0);
  return filled.length >= 2 ? [...filled] : [...filled, "", ""].slice(0, 4);
}

export function QuestionEditor({
  categories,
  values,
  nextItemNumbers,
  bare = false,
}: QuestionEditorProps) {
  const [state, formAction, pending] = useActionState<
    QuestionFormState,
    FormData
  >(saveQuestionAction, emptyQuestionFormState);

  const [categoryId, setCategoryId] = React.useState(values.categoryId);
  const [setId, setSetId] = React.useState(values.setId);
  const [order, setOrder] = React.useState(values.order);
  const [questionType, setQuestionType] = React.useState(values.questionType);
  const [difficulty, setDifficulty] = React.useState(values.difficulty);
  const [choices, setChoices] = React.useState<string[]>(
    values.questionType === "true_false"
      ? // Keep whatever wording the item already uses - a paper written in
        // Filipino may say Tama/Mali, and editing it should not rewrite that.
        values.choices.length === 2
        ? [...values.choices]
        : TRUE_FALSE_CHOICES
      : padChoices(values.choices),
  );
  const [answerIndex, setAnswerIndex] = React.useState(values.answerIndex);
  const [isFree, setIsFree] = React.useState(values.isFree);
  const [imageUrl, setImageUrl] = React.useState(values.imageUrl);
  const [imageError, setImageError] = React.useState("");
  const [uploading, setUploading] = React.useState(false);

  const isEditing = Boolean(values.rowId);
  const isTrueFalse = questionType === "true_false";
  const category = categories.find((option) => option.id === categoryId);
  const sets = category?.sets ?? [];
  const selectedSet = sets.find((option) => option.id === setId);
  // A set id from another category must not survive a category change.
  const effectiveSetId = selectedSet ? setId : "";
  const destinationLabel = category
    ? selectedSet
      ? `${category.title} - ${selectedSet.label}`
      : category.title
    : "this category";

  /**
   * The next free item number for a destination.
   *
   * Counting is per destination, not per category: Set B starts at 1 again
   * even when the category already holds a hundred questions elsewhere.
   */
  const nextNumberFor = React.useCallback(
    (nextCategoryId: string, nextSetId: string) => {
      if (nextSetId) {
        return nextItemNumbers?.bySet[nextSetId] ?? 1;
      }

      return nextItemNumbers?.byCategory[nextCategoryId] ?? 1;
    },
    [nextItemNumbers],
  );

  // Only when adding. Editing an existing question leaves its number alone -
  // changing it would silently move the item and break a re-uploaded sheet.
  const retargetTo = (nextCategoryId: string, nextSetId: string) => {
    setCategoryId(nextCategoryId);
    setSetId(nextSetId);

    if (!isEditing) {
      setOrder(nextNumberFor(nextCategoryId, nextSetId));
    }
  };

  // A true-false item is exactly True/False: switching type rewrites the
  // choices rather than leaving four boxes the encoder has to clear by hand.
  const handleTypeChange = (nextType: string) => {
    if (nextType === "true_false") {
      setQuestionType("true_false");
      setChoices(TRUE_FALSE_CHOICES);
      setAnswerIndex((current) => (current > 1 ? 0 : current));
      return;
    }

    setQuestionType("multiple_choice");
    setChoices((current) =>
      current.join("") === TRUE_FALSE_CHOICES.join("")
        ? ["", "", "", ""]
        : padChoices(current),
    );
  };

  const updateChoice = (index: number, value: string) => {
    setChoices((current) =>
      current.map((choice, choiceIndex) =>
        choiceIndex === index ? value : choice,
      ),
    );
  };

  const addChoice = () => {
    setChoices((current) =>
      current.length >= MAX_CHOICES ? current : [...current, ""],
    );
  };

  const removeChoice = (index: number) => {
    setChoices((current) => {
      if (current.length <= 2) {
        return current;
      }

      const next = current.filter((_, choiceIndex) => choiceIndex !== index);

      setAnswerIndex((currentAnswer) => {
        if (currentAnswer === index) {
          return 0;
        }

        return currentAnswer > index ? currentAnswer - 1 : currentAnswer;
      });

      return next;
    });
  };

  const uploadImage = async (file: File) => {
    setImageError("");
    setUploading(true);

    try {
      const body = new FormData();
      body.append("file", file);

      const response = await fetch("/api/assets/upload", {
        method: "POST",
        body,
      });
      const payload = (await response.json()) as {
        path?: string;
        url?: string;
        error?: string;
      };

      if (!response.ok) {
        setImageError(payload.error ?? "Upload failed.");
        return;
      }

      // The relative path travels between environments; a full URL would pin
      // the image to whichever host happened to upload it.
      setImageUrl(payload.path ?? payload.url ?? "");
    } catch {
      setImageError("Upload failed. Check your connection and try again.");
    } finally {
      setUploading(false);
    }
  };

  const promptIssue = findIssue(state.errors, "Question");
  const answerIssue = findIssue(state.errors, "Answer");
  const orderIssue = findIssue(state.errors, "No");
  const choiceIssue = state.errors.find((issue) =>
    /^[A-Z]$/.test(issue.column ?? ""),
  );

  return (
    <Card
      className={cn(
        "border-border/80 bg-card/80 shadow-2xl shadow-black/20 backdrop-blur",
        bare &&
          "gap-0 overflow-visible rounded-none bg-transparent py-0 shadow-none ring-0 backdrop-blur-none",
      )}
    >
      {bare ? null : (
        <CardHeader>
          <div className="flex flex-wrap items-center gap-3">
            <Badge className="uppercase tracking-[0.26em] text-[10px]">
              {isEditing ? "Edit question" : "New question"}
            </Badge>
            {values.sku ? (
              <Badge variant="outline" className="font-mono text-[11px]">
                {values.sku}
              </Badge>
            ) : null}
          </div>
          <CardTitle className="mt-3 text-2xl">
            {isEditing ? "Question details" : "Add a question by hand"}
          </CardTitle>
          <CardDescription className="mt-2 text-sm leading-7">
            {isEditing
              ? "The SKU never changes, so answer history follows this item through every edit."
              : "For a handful of items. For a whole batch, use the Import tab. A SKU is assigned automatically when you save."}
          </CardDescription>
        </CardHeader>
      )}

      <CardContent className={cn(bare && "p-0")}>
        <form action={formAction} className="space-y-5">
          <input type="hidden" name="rowId" value={values.rowId} />
          <input type="hidden" name="categoryId" value={categoryId} />
          <input type="hidden" name="setId" value={effectiveSetId} />
          <input type="hidden" name="questionType" value={questionType} />
          <input type="hidden" name="difficulty" value={difficulty} />
          <input type="hidden" name="answerIndex" value={answerIndex} />
          <input type="hidden" name="isFree" value={isFree ? "true" : "false"} />
          <input type="hidden" name="imageUrl" value={imageUrl} />
          {choices.map((choice, index) => (
            <input
              key={`choice-value-${index}`}
              type="hidden"
              name="choice"
              value={choice}
            />
          ))}

          <div className="grid gap-4 lg:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="categoryId">Exam category</Label>
              <Select
                value={categoryId}
                onValueChange={(value) => retargetTo(String(value ?? ""), "")}
              >
                <SelectTrigger id="categoryId">
                  {category ? (
                    category.title
                  ) : (
                    <SelectValue placeholder="Pick a category" />
                  )}
                </SelectTrigger>
                <SelectContent>
                  {categories.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!categories.length ? (
                <p className="text-xs text-destructive">
                  No exam categories yet. Create one first, then come back.
                </p>
              ) : null}
            </div>

            {/* Only shown when the category actually splits into sets. */}
            {sets.length ? (
              <div className="space-y-2">
                <Label htmlFor="setId">Set</Label>
                <Select
                  value={effectiveSetId || NO_SET_VALUE}
                  onValueChange={(value) =>
                    retargetTo(
                      categoryId,
                      value === NO_SET_VALUE ? "" : String(value ?? ""),
                    )
                  }
                >
                  <SelectTrigger id="setId">
                    {selectedSet ? selectedSet.label : "No set"}
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_SET_VALUE}>
                      No set - straight into the category
                    </SelectItem>
                    {sets.map((option) => (
                      <SelectItem key={option.id} value={option.id}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            <div className="space-y-2">
              <Label htmlFor="order">Item number</Label>
              <Input
                id="order"
                name="order"
                type="number"
                min={1}
                max={100000}
                value={order}
                onChange={(event) =>
                  setOrder(Number(event.currentTarget.value) || 1)
                }
                required
              />
              <p className="text-xs text-muted-foreground">
                {isEditing
                  ? "Its position, and what a re-uploaded sheet matches on."
                  : `Filled in for you: ${destinationLabel} continues at ${nextNumberFor(categoryId, effectiveSetId)}. Change it only to slot the question in somewhere specific.`}
              </p>
              {orderIssue ? (
                <p className="text-xs text-destructive">{orderIssue.message}</p>
              ) : null}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="prompt">Question</Label>
            <Textarea
              id="prompt"
              name="prompt"
              defaultValue={values.prompt}
              rows={3}
              required
              placeholder="What the student reads."
            />
            {promptIssue ? (
              <p className="text-xs text-destructive">{promptIssue.message}</p>
            ) : null}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="questionType">Question type</Label>
              <Select
                value={questionType}
                onValueChange={(value) => handleTypeChange(String(value ?? ""))}
              >
                <SelectTrigger id="questionType">
                  {isTrueFalse ? "True or false" : "Multiple choice"}
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="multiple_choice">
                    Multiple choice
                  </SelectItem>
                  <SelectItem value="true_false">True or false</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="difficulty">Difficulty</Label>
              <Select
                value={difficulty}
                onValueChange={(value) =>
                  setDifficulty(
                    (String(value ?? "medium") ||
                      "medium") as QuestionEditorValues["difficulty"],
                  )
                }
              >
                <SelectTrigger id="difficulty">{difficulty}</SelectTrigger>
                <SelectContent>
                  {DIFFICULTIES.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Label>Choices</Label>
              <p className="text-xs text-muted-foreground">
                Select the radio button next to the correct one.
              </p>
            </div>

            <div className="space-y-2">
              {choices.map((choice, index) => (
                <div
                  key={`choice-${index}`}
                  className={cn(
                    "flex items-center gap-3 rounded-2xl border px-3 py-2",
                    answerIndex === index
                      ? "border-primary/60 bg-primary/5"
                      : "border-border/70 bg-muted/20",
                  )}
                >
                  <label className="flex cursor-pointer items-center gap-2">
                    <input
                      type="radio"
                      name="answer-choice"
                      checked={answerIndex === index}
                      onChange={() => setAnswerIndex(index)}
                      className="size-4 accent-primary"
                      aria-label={`Mark choice ${toChoiceLabel(index)} as the answer`}
                    />
                    <span className="w-5 font-mono text-sm text-muted-foreground">
                      {toChoiceLabel(index)}
                    </span>
                  </label>

                  {/* Editable even for true-false: a paper written in Filipino
                      may want Tama/Mali. Only the count is fixed. */}
                  <Input
                    value={choice}
                    onChange={(event) =>
                      updateChoice(index, event.currentTarget.value)
                    }
                    placeholder={`Choice ${toChoiceLabel(index)}`}
                    className="flex-1 border-0 bg-transparent shadow-none focus-visible:ring-0"
                  />

                  {!isTrueFalse && choices.length > 2 ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="rounded-full text-xs"
                      onClick={() => removeChoice(index)}
                    >
                      Remove
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>

            {!isTrueFalse && choices.length < MAX_CHOICES ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="rounded-full"
                onClick={addChoice}
              >
                Add choice {toChoiceLabel(choices.length)}
              </Button>
            ) : null}

            {choiceIssue ? (
              <p className="text-xs text-destructive">{choiceIssue.message}</p>
            ) : null}
            {answerIssue ? (
              <p className="text-xs text-destructive">{answerIssue.message}</p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="explanation">Explanation</Label>
            <Textarea
              id="explanation"
              name="explanation"
              defaultValue={values.explanation}
              rows={3}
              placeholder="Shown after the student answers. Optional."
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="question-image">Image</Label>
              <div className="flex flex-wrap items-center gap-3">
                <input
                  id="question-image"
                  type="file"
                  accept="image/*"
                  disabled={uploading}
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    if (file) {
                      void uploadImage(file);
                    }
                  }}
                  className="w-full cursor-pointer rounded-xl border border-input bg-input/40 px-3 py-2 text-sm file:mr-3 file:rounded-full file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-xs file:font-medium"
                />
              </div>
              <Input
                value={imageUrl}
                onChange={(event) => setImageUrl(event.currentTarget.value)}
                placeholder="Or paste a link"
              />
              {uploading ? (
                <p className="text-xs text-muted-foreground">Uploading...</p>
              ) : null}
              {imageError ? (
                <p className="text-xs text-destructive">{imageError}</p>
              ) : null}
              {imageUrl && !uploading ? (
                <div className="flex items-center gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={imageUrl}
                    alt=""
                    className="h-16 w-16 rounded-xl border border-border/70 object-cover"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="rounded-full text-xs"
                    onClick={() => setImageUrl("")}
                  >
                    Remove image
                  </Button>
                </div>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="isFree">Free sample</Label>
              <div className="flex items-center justify-between rounded-2xl border border-border/70 bg-muted/30 px-4 py-3">
                <div>
                  <p className="text-sm font-medium">
                    Show to students without premium
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Off by default, so a blank column never gives the bank away.
                  </p>
                </div>
                <Switch
                  id="isFree"
                  checked={isFree}
                  onCheckedChange={(checked) => setIsFree(Boolean(checked))}
                />
              </div>
            </div>
          </div>

          {state.message ? (
            <Alert variant="destructive" className="rounded-2xl">
              <AlertTitle>Not saved</AlertTitle>
              <AlertDescription>{state.message}</AlertDescription>
            </Alert>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="submit"
              size="lg"
              className="rounded-full"
              disabled={pending || !categories.length}
            >
              {pending
                ? "Saving..."
                : isEditing
                  ? "Save changes"
                  : "Create question"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
