"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const ALL_SUBJECTS_VALUE = "__all_subjects__";
const ALL_TOPICS_VALUE = "__all_topics__";

type SubjectOption = {
  value: string;
  label: string;
  topicCount: number;
  materialCount: number;
};

type TopicOption = {
  value: string;
  label: string;
};

type LearningMaterialsSubjectFilterProps = {
  subjects?: SubjectOption[];
  topics?: TopicOption[];
  selectedSubjectId?: string;
  selectedTopicId?: string;
  selectedSubjectLabel?: string;
  selectedTopicLabel?: string;
  selectedTopicCount?: number;
};

export function LearningMaterialsSubjectFilter({
  subjects = [],
  topics = [],
  selectedSubjectId = "",
  selectedTopicId = "",
  selectedSubjectLabel = "",
  selectedTopicLabel = "",
  selectedTopicCount = 0,
}: LearningMaterialsSubjectFilterProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const selectedSubjectValue = selectedSubjectId || ALL_SUBJECTS_VALUE;
  const selectedTopicValue = selectedTopicId || ALL_TOPICS_VALUE;
  const isTopicSelectDisabled = !selectedSubjectId || topics.length === 0;

  const handleSubjectChange = (nextValue: string | null) => {
    const resolvedValue = nextValue ?? ALL_SUBJECTS_VALUE;
    const params = new URLSearchParams(searchParams.toString());

    if (resolvedValue === ALL_SUBJECTS_VALUE) {
      params.delete("subjectId");
      params.delete("topicId");
    } else {
      params.set("subjectId", resolvedValue);
      params.delete("topicId");
    }

    const queryString = params.toString();

    startTransition(() => {
      router.push(queryString ? `${pathname}?${queryString}` : pathname);
    });
  };

  const handleTopicChange = (nextValue: string | null) => {
    if (!selectedSubjectId) {
      return;
    }

    const resolvedValue = nextValue ?? ALL_TOPICS_VALUE;
    const params = new URLSearchParams(searchParams.toString());

    params.set("subjectId", selectedSubjectId);

    if (resolvedValue === ALL_TOPICS_VALUE) {
      params.delete("topicId");
    } else {
      params.set("topicId", resolvedValue);
    }

    const queryString = params.toString();

    startTransition(() => {
      router.push(queryString ? `${pathname}?${queryString}` : pathname);
    });
  };

  return (
    <Card className="border-border/80 bg-card/80">
      <CardHeader>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <Badge className="uppercase tracking-[0.24em] text-[10px]">
              Learning Materials Filter
            </Badge>
            <CardTitle className="mt-2 text-xl">
              Browse by subject and topic
            </CardTitle>
            <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
              Pick a subject to see everything in it. Narrow to one topic only
              when you need to.
            </p>
          </div>

          <div className="grid w-full max-w-2xl gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="learning-material-subject-filter">Subject</Label>
              <Select
                value={selectedSubjectValue}
                onValueChange={handleSubjectChange}
              >
                <SelectTrigger id="learning-material-subject-filter">
                  <SelectValue placeholder="Select subject" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_SUBJECTS_VALUE}>
                    All subjects
                  </SelectItem>
                  {subjects.map((subject) => (
                    <SelectItem key={subject.value} value={subject.value}>
                      {subject.label} - {subject.topicCount}{" "}
                      {subject.topicCount === 1 ? "topic" : "topics"},{" "}
                      {subject.materialCount}{" "}
                      {subject.materialCount === 1 ? "material" : "materials"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="learning-material-topic-filter">Topic</Label>
              <Select
                value={selectedTopicValue}
                onValueChange={handleTopicChange}
              >
                <SelectTrigger
                  id="learning-material-topic-filter"
                  disabled={isTopicSelectDisabled}
                >
                  <SelectValue
                    placeholder={
                      selectedSubjectId
                        ? "Select topic"
                        : "Select subject first"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_TOPICS_VALUE}>All topics</SelectItem>
                  {topics.map((topic) => (
                    <SelectItem key={topic.value} value={topic.value}>
                      {topic.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-0">
        <p className="text-sm text-muted-foreground">
          {isPending
            ? "Updating learning material filters..."
            : selectedSubjectId && selectedTopicId
              ? `Showing materials for ${selectedSubjectLabel} > ${selectedTopicLabel}.`
              : selectedSubjectId
                ? `Showing materials for ${selectedSubjectLabel} across ${selectedTopicCount} topics.`
                : "Showing materials from all subjects."}
        </p>
      </CardContent>
    </Card>
  );
}
