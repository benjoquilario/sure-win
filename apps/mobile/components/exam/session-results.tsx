import { memo, useMemo, useState } from "react"
import { FlashList, type ListRenderItemInfo } from "@shopify/flash-list"
import Check from "lucide-react-native/icons/check"
import CircleX from "lucide-react-native/icons/circle-x"
import ListChecks from "lucide-react-native/icons/list-checks"
import PartyPopper from "lucide-react-native/icons/party-popper"
import RotateCcw from "lucide-react-native/icons/rotate-ccw"
import { View } from "react-native"

import type { PresentedQuestion } from "@/lib/session/question-pool"
import { useLayout } from "@/hooks/use-layout"
import { useThemePalette } from "@/hooks/use-theme"
import { BottomBar } from "@/components/ui/bottom-bar"
import { Button } from "@/components/ui/button"
import { SectionHeader } from "@/components/ui/section-header"
import { Text } from "@/components/ui/text"

import { SampleFinishedUpsell } from "./locked-paper"
import { ResultReviewRow } from "./result-review-row"
import { ResultSummary } from "./result-summary"
import { ChoiceTile } from "./session-setup"

/**
 * What a member sees after submitting.
 *
 * Under `feedbackTiming: "at_end"` this is the **only** place any answer is
 * ever revealed, so the review list is not an optional extra — it is the whole
 * feedback loop for a mock exam.
 *
 * The list defaults to mistakes. Somebody who scored 84% wants the sixteen they
 * missed, not to scroll a hundred rows to find them.
 *
 * Done and Try again sit in a pinned bar rather than above the list, so the
 * score card leads straight into the review and leaving never needs a scroll
 * back to the top. The parent claims only the top and side safe-area edges;
 * the bar paints the bottom one.
 */

type SessionResultsProps = {
  label: string
  pool: PresentedQuestion[]
  answers: ReadonlyMap<number, number>
  correctCount: number
  answeredCount: number
  durationSeconds: number
  showExplanations: boolean
  /** Items this member could not open. Drives the upsell below the score. */
  hiddenCount?: number
  /** This paper's pass mark. */
  passingScore?: number
  onDone: () => void
  onRetry?: () => void
  onUpgrade?: () => void
}

type ReviewFilter = "mistakes" | "all"

const LIST_BOTTOM_GAP = 24

export const SessionResults = memo(function SessionResults({
  label,
  pool,
  answers,
  correctCount,
  answeredCount,
  durationSeconds,
  showExplanations,
  hiddenCount = 0,
  passingScore,
  onDone,
  onRetry,
  onUpgrade,
}: SessionResultsProps) {
  const theme = useThemePalette()

  // Skipped items count as mistakes here: they are just as much "the ones to
  // look at again".
  const mistakes = useMemo(
    () =>
      pool.filter(
        (presented, index) =>
          answers.get(index) !== presented.question.answerIndex
      ),
    [answers, pool]
  )

  // Position in the run, looked up once rather than `indexOf` per row.
  const indexOf = useMemo(
    () => new Map(pool.map((presented, index) => [presented, index])),
    [pool]
  )

  // Reading width: the review rows carry full question text and explanations.
  const paddingHorizontal = useLayout().paddingFor("reading")
  const listContentStyle = useMemo(
    () => ({ paddingHorizontal, paddingBottom: LIST_BOTTOM_GAP }),
    [paddingHorizontal]
  )

  const [filter, setFilter] = useState<ReviewFilter>(
    mistakes.length > 0 ? "mistakes" : "all"
  )

  const visible = filter === "mistakes" ? mistakes : pool

  const renderRow = ({ item }: ListRenderItemInfo<PresentedQuestion>) => (
    <ResultReviewRow
      presented={item}
      selectedIndex={answers.get(indexOf.get(item) ?? -1)}
      showExplanations={showExplanations}
    />
  )

  return (
    <View className="flex-1">
      <FlashList
        data={visible}
        keyExtractor={(item) => item.question.id}
        renderItem={renderRow}
        contentContainerStyle={listContentStyle}
        showsVerticalScrollIndicator={false}
        ItemSeparatorComponent={Separator}
        ListHeaderComponent={
          <View className="gap-5 pb-4 pt-4">
            <ResultSummary
              label={label}
              correctCount={correctCount}
              questionCount={pool.length}
              answeredCount={answeredCount}
              durationSeconds={durationSeconds}
              passingScore={passingScore}
            />

            {onUpgrade ? (
              <SampleFinishedUpsell
                hiddenCount={hiddenCount}
                onUpgrade={onUpgrade}
              />
            ) : null}

            <View className="gap-3">
              <SectionHeader
                title="Review answers"
                subtitle={
                  filter === "mistakes"
                    ? "Wrong and skipped items, with the right answer marked."
                    : "Every item in this run, in the order you answered."
                }
              />

              {/* Full tiles rather than a slim pill: this switch decides what
                  the whole rest of the screen shows, so it gets a real target
                  and says how many items each side holds. */}
              <View
                role="radiogroup"
                aria-label="Which answers to review"
                className="flex-row gap-2"
              >
                <View className="flex-1">
                  <ChoiceTile
                    icon={CircleX}
                    title="Mistakes"
                    meta={
                      mistakes.length === 0
                        ? "None to review"
                        : `${mistakes.length} to review`
                    }
                    isSelected={filter === "mistakes"}
                    layout="row"
                    onPress={() => setFilter("mistakes")}
                  />
                </View>
                <View className="flex-1">
                  <ChoiceTile
                    icon={ListChecks}
                    title="All"
                    meta={`${pool.length} ${pool.length === 1 ? "item" : "items"}`}
                    isSelected={filter === "all"}
                    layout="row"
                    onPress={() => setFilter("all")}
                  />
                </View>
              </View>
            </View>
          </View>
        }
        ListEmptyComponent={
          <View className="items-center gap-2 rounded-xl border border-border bg-card px-6 py-8">
            <View className="h-12 w-12 items-center justify-center rounded-full bg-success/15">
              <PartyPopper size={22} color={theme.success} strokeWidth={2.2} />
            </View>
            <Text className="text-base font-extrabold text-card-foreground">
              A perfect run
            </Text>
            <Text variant="caption" className="text-center">
              Nothing to review — every item was answered correctly.
            </Text>
          </View>
        }
      />

      <BottomBar width="reading" contentClassName="flex-row gap-3">
        {onRetry ? (
          <Button
            size="lg"
            variant="outline"
            className="flex-1"
            onPress={onRetry}
          >
            <RotateCcw size={16} color={theme.foreground} strokeWidth={2.4} />
            <Text>Try again</Text>
          </Button>
        ) : null}
        <Button size="lg" className="flex-1" onPress={onDone}>
          <Check size={17} color={theme.primaryForeground} strokeWidth={2.6} />
          <Text>Done</Text>
        </Button>
      </BottomBar>
    </View>
  )
})

function Separator() {
  return <View className="h-3" />
}
