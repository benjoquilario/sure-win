import { useCallback, useMemo } from "react"
import { useRouter } from "expo-router"
import { View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

import type { ExamCategory } from "@/lib/content/exam-categories"
import type { QuestionSet } from "@/lib/content/question-sets"
import {
  useAnswerHistory,
  useExamQuestions,
  useResumableSession,
} from "@/hooks/use-exam-content"
import { useContentPadding } from "@/hooks/use-layout"
import { useMemberSettings } from "@/hooks/use-member-settings"
import { Button } from "@/components/ui/button"
import { ContentFrame } from "@/components/ui/content-frame"
import { EmptyState } from "@/components/ui/empty-state"
import { Skeleton } from "@/components/ui/skeleton"
import { Text } from "@/components/ui/text"
import { ScrollView } from "@/components/ui/virtualized-scroll-view"

import { LockedPaper } from "./locked-paper"
import {
  SessionSetupPanel,
  type SessionSetupChoice,
} from "./session-setup-panel"

/**
 * The pre-flight screen for one paper.
 *
 * Shared by both shapes a category can take — a lettered set, or the questions
 * sitting directly under the category — because from the member's side there
 * is no difference between them, and the only thing that changes is which
 * query supplied the items.
 */

type PaperSetupScreenProps = {
  category: ExamCategory
  /** null for questions with no set. */
  set: QuestionSet | null
}

export function PaperSetupScreen({ category, set }: PaperSetupScreenProps) {
  const router = useRouter()
  const { settings, isLoading: isLoadingSettings } = useMemberSettings()
  // A setup form reads best at a measured width; on a tablet the choices
  // would otherwise stretch into rows too long to scan.
  const readingPadding = useContentPadding("reading")

  const questionsQuery = useExamQuestions({
    categoryId: category.id,
    setId: set?.id ?? null,
    isPremiumCategory: category.isPremium,
  })

  const historyQuery = useAnswerHistory({
    categoryId: category.id,
    questionnaireId: set?.id,
  })

  const resumableQuery = useResumableSession({
    categoryId: category.id,
    questionnaireId: set?.id ?? "",
  })

  const resumeLabel = resumableQuery.data
    ? `${resumableQuery.data.answeredCount} answered`
    : null

  const availableCount = questionsQuery.visible.length

  /**
   * How many items each source would actually serve.
   *
   * Shown on the picker so "My mistakes" does not silently fall back to the
   * whole paper when the member has no mistakes yet — which is what the pool
   * builder does, deliberately, rather than presenting an empty run.
   */
  const sourceAvailability = useMemo(() => {
    const answered = historyQuery.data?.answered
    const incorrect = historyQuery.data?.incorrect

    return {
      all: availableCount,
      unanswered: answered
        ? questionsQuery.visible.filter((q) => !answered.has(q.sku)).length
        : undefined,
      incorrect: incorrect
        ? questionsQuery.visible.filter((q) => incorrect.has(q.sku)).length
        : undefined,
    }
  }, [availableCount, historyQuery.data, questionsQuery.visible])

  const handleStart = useCallback(
    (choice: SessionSetupChoice) => {
      router.push({
        pathname: "/quiz",
        params: {
          categoryId: category.id,
          setId: set?.id ?? "",
          questionCount: String(choice.questionCount),
          minutes: String(choice.minutes),
          feedbackTiming: choice.feedbackTiming,
          questionSource: choice.questionSource,
        },
      })
    },
    [category.id, router, set?.id]
  )

  const handleUpgrade = useCallback(() => router.push("/premium"), [router])

  if (questionsQuery.isLoading || isLoadingSettings) {
    return (
      <SafeAreaView
        edges={["left", "right", "bottom"]}
        className="flex-1 bg-background py-4"
      >
        <ContentFrame width="reading" className="gap-3">
          <Skeleton className="h-24 rounded-xl" />
          <Skeleton className="h-40 rounded-xl" />
          <Skeleton className="h-40 rounded-xl" />
        </ContentFrame>
      </SafeAreaView>
    )
  }

  if (questionsQuery.error) {
    return (
      <SafeAreaView
        edges={["left", "right", "bottom"]}
        className="flex-1 bg-background py-4"
      >
        <ContentFrame width="reading">
          <EmptyState
            tone="destructive"
            title="Questions unavailable"
            description={
              questionsQuery.error instanceof Error
                ? questionsQuery.error.message
                : "We could not load this paper. Please try again."
            }
            action={
              <Button
                size="sm"
                variant="outline"
                onPress={() => void questionsQuery.refetch()}
              >
                <Text>Try again</Text>
              </Button>
            }
          />
        </ContentFrame>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView
      edges={["left", "right", "bottom"]}
      className="flex-1 bg-background"
    >
      <ScrollView
        contentContainerStyle={{
          ...readingPadding,
          paddingTop: 16,
          paddingBottom: 40,
        }}
        showsVerticalScrollIndicator={false}
      >
        {availableCount === 0 && questionsQuery.hiddenCount > 0 ? (
          // Paid, with no free sample at all. A hard stop that says so beats
          // a setup screen offering nought items.
          <LockedPaper
            title={set ? set.title : category.title}
            questionCount={questionsQuery.hiddenCount}
            onUpgrade={handleUpgrade}
            onBack={() => router.back()}
          />
        ) : availableCount === 0 ? (
          <EmptyState
            title="Nothing here yet"
            description="This paper has no published questions. Check back soon."
          />
        ) : (
          <View>
            <SessionSetupPanel
              category={category}
              set={set}
              availableCount={availableCount}
              hiddenCount={questionsQuery.hiddenCount}
              settings={settings}
              sourceAvailability={sourceAvailability}
              resumeLabel={resumeLabel}
              onStart={handleStart}
              onUpgrade={handleUpgrade}
            />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}
