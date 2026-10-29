import { memo, useMemo, useState, type ReactNode } from "react"
import BookOpen from "lucide-react-native/icons/book-open"
import Eye from "lucide-react-native/icons/eye"
import ListChecks from "lucide-react-native/icons/list-checks"
import Play from "lucide-react-native/icons/play"
import Target from "lucide-react-native/icons/target"
import Timer from "lucide-react-native/icons/timer"
import { View } from "react-native"

import type { ExamCategory } from "@/lib/content/exam-categories"
import { resolvePaperRules } from "@/lib/content/paper-rules"
import type { QuestionSet } from "@/lib/content/question-sets"
import {
  FEEDBACK_TIMING_LABELS,
  type FeedbackTiming,
  type MemberSettings,
  type QuestionSource,
} from "@/lib/member/settings"
import { useContentPadding } from "@/hooks/use-layout"
import { useThemePalette } from "@/hooks/use-theme"
import { Badge } from "@/components/ui/badge"
import { BottomBar } from "@/components/ui/bottom-bar"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Text } from "@/components/ui/text"
import { ScrollView } from "@/components/ui/virtualized-scroll-view"

import { PaywallNotice } from "./paywall-notice"
import {
  buildLengthOptions,
  describeSession,
  FeedbackTimingPicker,
  QuestionSourcePicker,
  SessionLengthPicker,
  type SessionLengthOption,
} from "./session-setup"

/**
 * Everything between "I picked a paper" and "start".
 *
 * Seeded from the member's stored settings, so the default is always one tap
 * away — the pickers are overrides for this sitting, not a second settings
 * screen. What they choose here is passed to the runner rather than saved,
 * because "I want a short one today" is not a preference change.
 *
 * Owns its scroll view so Start can live in a pinned bar: the primary action
 * of this screen belongs in the thumb zone whatever the scroll position. The
 * parent must not claim the bottom safe-area edge (see `BottomBar`).
 */

export type SessionSetupChoice = {
  questionCount: number
  minutes: number
  feedbackTiming: FeedbackTiming
  questionSource: QuestionSource
}

type SessionSetupPanelProps = {
  category: ExamCategory
  set: QuestionSet | null
  /** Items this viewer can actually open. */
  availableCount: number
  /** Items withheld behind the paywall. */
  hiddenCount: number
  settings: MemberSettings
  sourceAvailability?: Partial<Record<QuestionSource, number>>
  resumeLabel?: string | null
  onStart: (choice: SessionSetupChoice) => void
  onUpgrade: () => void
}

export const SessionSetupPanel = memo(function SessionSetupPanel({
  category,
  set,
  availableCount,
  hiddenCount,
  settings,
  sourceAvailability,
  resumeLabel,
  onStart,
  onUpgrade,
}: SessionSetupPanelProps) {
  const theme = useThemePalette()
  const readingPadding = useContentPadding("reading")
  const rules = resolvePaperRules(category, set)

  const lengthOptions = useMemo(
    () => buildLengthOptions(availableCount, rules.timeLimitMinutes),
    [availableCount, rules.timeLimitMinutes]
  )

  const [lengthId, setLengthId] = useState(() => lengthOptions[0]?.id ?? "full")
  const [feedbackTiming, setFeedbackTiming] = useState<FeedbackTiming>(
    settings.feedbackTiming
  )
  const [questionSource, setQuestionSource] = useState<QuestionSource>(
    settings.questionSource
  )

  const selectedLength: SessionLengthOption =
    lengthOptions.find((option) => option.id === lengthId) ??
    lengthOptions[lengthOptions.length - 1]

  const questionCount = selectedLength?.questionCount ?? availableCount
  const minutes = selectedLength?.minutes ?? 0
  const isEmpty = availableCount === 0
  const title = set ? set.title : category.title

  return (
    <View className="flex-1">
      <ScrollView
        contentContainerClassName="gap-4"
        contentContainerStyle={{
          ...readingPadding,
          paddingTop: 16,
          paddingBottom: 24,
        }}
        showsVerticalScrollIndicator={false}
      >
        <Card>
          <CardContent className="gap-3">
            <View className="flex-row items-start gap-3">
              <View className="h-11 w-11 items-center justify-center rounded-md bg-primary/10">
                <BookOpen size={20} color={theme.primary} strokeWidth={2.2} />
              </View>

              <View className="min-w-0 flex-1 gap-1">
                <View className="flex-row flex-wrap items-center gap-1.5">
                  <Text variant="heading" className="shrink">
                    {title}
                  </Text>
                  {set?.setCode ? (
                    <Badge tone="primary" size="sm">
                      Set {set.setCode}
                    </Badge>
                  ) : null}
                  {resumeLabel ? (
                    <Badge tone="warning" size="sm">
                      {resumeLabel}
                    </Badge>
                  ) : null}
                </View>

                <Text variant="caption" numberOfLines={2}>
                  {set?.description ||
                    category.description ||
                    "Board exam review."}
                </Text>
              </View>
            </View>

            <View className="flex-row flex-wrap gap-x-4 gap-y-1.5 border-t border-border/60 pt-3">
              <PaperFact icon={<ListChecks size={14} color={theme.primary} />}>
                {availableCount} {availableCount === 1 ? "item" : "items"}
              </PaperFact>
              {rules.timeLimitMinutes ? (
                <PaperFact icon={<Timer size={14} color={theme.primary} />}>
                  {rules.timeLimitMinutes} min limit
                </PaperFact>
              ) : null}
              <PaperFact icon={<Target size={14} color={theme.primary} />}>
                Pass at {rules.passingScore}%
              </PaperFact>
            </View>
          </CardContent>
        </Card>

        {hiddenCount > 0 ? (
          <PaywallNotice
            hiddenCount={hiddenCount}
            contextLabel={title}
            onUpgrade={onUpgrade}
          />
        ) : null}

        {isEmpty ? null : (
          <Card>
            <CardContent className="gap-4">
              <SessionLengthPicker
                options={lengthOptions}
                selectedId={selectedLength?.id ?? lengthId}
                onSelect={(option) => setLengthId(option.id)}
              />

              <View className="h-px bg-border/60" />

              <FeedbackTimingPicker
                value={feedbackTiming}
                onChange={setFeedbackTiming}
              />

              <View className="h-px bg-border/60" />

              <QuestionSourcePicker
                value={questionSource}
                onChange={setQuestionSource}
                availability={sourceAvailability}
              />
            </CardContent>
          </Card>
        )}
      </ScrollView>

      {isEmpty ? null : (
        <BottomBar width="reading" minInset={16} contentClassName="gap-2.5">
          {/* The sitting about to start, in the order the pickers ask. */}
          <View className="flex-row flex-wrap items-center justify-center gap-x-4 gap-y-1">
            <PaperFact
              icon={<ListChecks size={13} color={theme.mutedForeground} />}
            >
              {questionCount} items
            </PaperFact>
            {minutes > 0 ? (
              <PaperFact
                icon={<Timer size={13} color={theme.mutedForeground} />}
              >
                {minutes} min
              </PaperFact>
            ) : null}
            <PaperFact icon={<Eye size={13} color={theme.mutedForeground} />}>
              {FEEDBACK_TIMING_LABELS[feedbackTiming].title}
            </PaperFact>
          </View>

          <Button
            size="xl"
            accessibilityHint={describeSession(
              { feedbackTiming, shuffleQuestions: settings.shuffleQuestions },
              questionCount,
              minutes
            )}
            onPress={() =>
              onStart({
                questionCount,
                minutes,
                feedbackTiming,
                questionSource,
              })
            }
          >
            <Play
              size={16}
              color={theme.primaryForeground}
              fill={theme.primaryForeground}
            />
            <Text>{resumeLabel ? "Continue" : "Start"}</Text>
          </Button>
        </BottomBar>
      )}
    </View>
  )
})

function PaperFact({
  icon,
  children,
}: {
  icon: ReactNode
  children: ReactNode
}) {
  return (
    <View className="flex-row items-center gap-1.5">
      {icon}
      <Text variant="caption" className="font-semibold">
        {children}
      </Text>
    </View>
  )
}
