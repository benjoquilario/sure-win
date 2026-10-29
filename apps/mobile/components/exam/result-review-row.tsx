import { memo } from "react"
import Check from "lucide-react-native/icons/check"
import Lightbulb from "lucide-react-native/icons/lightbulb"
import Minus from "lucide-react-native/icons/minus"
import X from "lucide-react-native/icons/x"
import { View } from "react-native"

import type { PresentedQuestion } from "@/lib/session/question-pool"
import { useThemePalette } from "@/hooks/use-theme"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Text } from "@/components/ui/text"

import { ChoiceList } from "./choice-list"

/**
 * One question as it appears in the post-sitting review.
 *
 * Everything is graded and locked here — including under `at_end`, where this
 * screen is the *only* place the answers are ever shown.
 *
 * The choices already say everything about the outcome: the member's pick is
 * captioned "Your answer · Incorrect" and the right one "Correct answer". So
 * the row adds only what the choices cannot — a status badge to scan the list
 * by, and the explanation — rather than the in-sitting verdict panel, which
 * would repeat the correct answer a second time on every row.
 */

type ResultReviewRowProps = {
  presented: PresentedQuestion
  selectedIndex: number | undefined
  showExplanations: boolean
}

const noop = () => {}

const STATUS = {
  correct: { label: "Correct", tone: "success", Icon: Check },
  incorrect: { label: "Incorrect", tone: "destructive", Icon: X },
  skipped: { label: "Skipped", tone: "muted", Icon: Minus },
} as const

export const ResultReviewRow = memo(function ResultReviewRow({
  presented,
  selectedIndex,
  showExplanations,
}: ResultReviewRowProps) {
  const theme = useThemePalette()
  const { question } = presented
  const status =
    selectedIndex === undefined
      ? STATUS.skipped
      : selectedIndex === question.answerIndex
        ? STATUS.correct
        : STATUS.incorrect
  const statusColor =
    status.tone === "success"
      ? theme.success
      : status.tone === "destructive"
        ? theme.destructive
        : theme.mutedForeground

  return (
    <Card>
      <CardContent className="gap-3.5">
        <View className="flex-row items-center justify-between gap-2">
          <Text variant="eyebrow" className="text-muted-foreground">
            Question {presented.position}
          </Text>

          <Badge tone={status.tone} size="sm">
            <status.Icon size={11} color={statusColor} strokeWidth={3} />
            <Text>{status.label}</Text>
          </Badge>
        </View>

        <Text className="text-base font-semibold leading-6 text-card-foreground">
          {question.prompt}
        </Text>

        <ChoiceList
          presented={presented}
          selectedIndex={selectedIndex}
          isGraded
          disabled
          onSelect={noop}
        />

        {showExplanations && question.explanation ? (
          <View className="gap-1.5 rounded-md bg-muted px-3.5 py-3">
            <View className="flex-row items-center gap-1.5">
              <Lightbulb
                size={13}
                color={theme.mutedForeground}
                strokeWidth={2.4}
              />
              <Text variant="eyebrow" className="text-muted-foreground">
                Why
              </Text>
            </View>
            <Text className="text-sm leading-6 text-foreground">
              {question.explanation}
            </Text>
          </View>
        ) : null}
      </CardContent>
    </Card>
  )
})
