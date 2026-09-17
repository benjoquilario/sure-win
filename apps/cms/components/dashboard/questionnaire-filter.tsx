"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const ALL_CATEGORIES_VALUE = "__all_categories__";
const ALL_SETS_VALUE = "__all_sets__";
const NO_SET_VALUE = "__no_set__";

export type FilterOption = {
  value: string;
  label: string;
  hint?: string;
};

type QuestionnaireFilterProps = {
  categories: FilterOption[];
  /** Sets inside the chosen category. Empty for categories that have none. */
  sets: FilterOption[];
  selectedCategoryId: string;
  /** A set id, or "none" for questions sitting directly under the category. */
  selectedSetId: string;
  selectedCategoryLabel: string;
  uploadHref?: string;
};

/**
 * Category first, set only if there is one.
 *
 * The set dropdown is hidden entirely for a category without sets, so the
 * common case never shows a control with one meaningless option in it.
 */
export function QuestionnaireFilter({
  categories,
  sets,
  selectedCategoryId,
  selectedSetId,
  selectedCategoryLabel,
  uploadHref,
}: QuestionnaireFilterProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const pushParams = (params: URLSearchParams) => {
    const queryString = params.toString();

    startTransition(() => {
      router.push(queryString ? `${pathname}?${queryString}` : pathname);
    });
  };

  const handleCategoryChange = (nextValue: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    const resolved = nextValue ?? ALL_CATEGORIES_VALUE;

    params.delete("setId");

    if (resolved === ALL_CATEGORIES_VALUE) {
      params.delete("categoryId");
    } else {
      params.set("categoryId", resolved);
    }

    pushParams(params);
  };

  const handleSetChange = (nextValue: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    const resolved = nextValue ?? ALL_SETS_VALUE;

    if (resolved === ALL_SETS_VALUE) {
      params.delete("setId");
    } else {
      params.set("setId", resolved === NO_SET_VALUE ? "none" : resolved);
    }

    pushParams(params);
  };

  const selectedSetLabel =
    selectedSetId === "none"
      ? "No set"
      : (sets.find((set) => set.value === selectedSetId)?.label ?? "");

  return (
    <Card className="border-border/80 bg-card/80">
      <CardHeader>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <Badge className="uppercase tracking-[0.24em] text-[10px]">
              Question filter
            </Badge>
            <CardTitle className="mt-2 text-xl">
              Browse by exam category
            </CardTitle>
            <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
              Questions belong to a category. Pick one to see its items in
              order, including any that sit inside its sets.
            </p>
          </div>

          <div className="grid w-full max-w-2xl gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="question-category-filter">Exam category</Label>
              <Select
                value={selectedCategoryId || ALL_CATEGORIES_VALUE}
                onValueChange={handleCategoryChange}
              >
                <SelectTrigger id="question-category-filter">
                  <SelectValue placeholder="All categories" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_CATEGORIES_VALUE}>
                    All categories
                  </SelectItem>
                  {categories.map((category) => (
                    <SelectItem key={category.value} value={category.value}>
                      {category.label}
                      {category.hint ? ` (${category.hint})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {sets.length ? (
              <div className="space-y-2">
                <Label htmlFor="question-set-filter">Set</Label>
                <Select
                  value={
                    selectedSetId === "none"
                      ? NO_SET_VALUE
                      : selectedSetId || ALL_SETS_VALUE
                  }
                  onValueChange={handleSetChange}
                >
                  <SelectTrigger id="question-set-filter">
                    <SelectValue placeholder="Everything in the category" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_SETS_VALUE}>
                      Everything in the category
                    </SelectItem>
                    <SelectItem value={NO_SET_VALUE}>
                      Only questions with no set
                    </SelectItem>
                    {sets.map((set) => (
                      <SelectItem key={set.value} value={set.value}>
                        {set.label}
                        {set.hint ? ` - ${set.hint}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-0">
        <p className="text-sm text-muted-foreground">
          {isPending
            ? "Updating..."
            : selectedCategoryId
              ? `Showing ${selectedCategoryLabel}${selectedSetLabel ? ` - ${selectedSetLabel}` : ""}.`
              : "Showing the most recent questions across every category."}
        </p>

        {uploadHref ? (
          <Button
            variant="outline"
            size="sm"
            className="rounded-full"
            nativeButton={false}
            render={<a href={uploadHref} />}
          >
            Upload questions here
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
