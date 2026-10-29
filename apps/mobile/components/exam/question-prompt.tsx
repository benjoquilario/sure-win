import { memo } from "react"
import { Image } from "expo-image"
import Gauge from "lucide-react-native/icons/gauge"
import Gift from "lucide-react-native/icons/gift"
import { View } from "react-native"

import type { ExamQuestion } from "@/lib/content/questions"
import { useThemePalette } from "@/hooks/use-theme"
import { Badge } from "@/components/ui/badge"
import { Text } from "@/components/ui/text"

/**
 * The stem: difficulty, prompt, and the illustration when there is one.
 *
 * "Question 3 of 20" is not repeated here: the top bar carries it, beside the
 * progress it describes, and saying it twice pushes the stem down a line on
 * every question.
 *
 * `imageUrl` has already been resolved to an absolute URL by
 * `lib/content/questions.ts` — a CMS upload stores a path and a pasted link
 * stores a full URL, and an `<Image>` handed the former renders nothing and
 * says nothing about it (gotcha 8).
 */

const DIFFICULTY = {
  easy: { tone: "success", label: "Easy" },
  medium: { tone: "primary", label: "Medium" },
  hard: { tone: "destructive", label: "Hard" },
} as const

type QuestionPromptProps = {
  question: ExamQuestion
  /** Position in this run, 1-based — not the stored `order`. */
  position: number
  total: number
  showDifficulty?: boolean
}

export const QuestionPrompt = memo(function QuestionPrompt({
  question,
  position,
  total,
  showDifficulty = true,
}: QuestionPromptProps) {
  const theme = useThemePalette()
  const difficulty = DIFFICULTY[question.difficulty]
  const hasChips = showDifficulty || question.isFree

  return (
    <View className="gap-3">
      {hasChips ? (
        <View className="flex-row flex-wrap items-center gap-1.5">
          {showDifficulty ? (
            <Badge tone={difficulty.tone} size="sm">
              <Gauge
                size={11}
                strokeWidth={2.6}
                color={
                  difficulty.tone === "success"
                    ? theme.success
                    : difficulty.tone === "destructive"
                      ? theme.destructive
                      : theme.primary
                }
              />
              <Text>{difficulty.label}</Text>
            </Badge>
          ) : null}

          {question.isFree ? (
            <Badge tone="success" size="sm">
              <Gift size={11} strokeWidth={2.6} color={theme.success} />
              <Text>Free sample</Text>
            </Badge>
          ) : null}
        </View>
      ) : null}

      {/* 18px on a 28px line: this is the thing being read under time
          pressure, so it outranks every label around it. */}
      <Text
        role="heading"
        accessibilityLabel={`Question ${position} of ${total}. ${question.prompt}`}
        className="text-lg font-semibold leading-7 text-foreground"
      >
        {question.prompt}
      </Text>

      {question.imageUrl ? (
        <View className="overflow-hidden rounded-md border border-border/70 bg-muted">
          <Image
            source={{ uri: question.imageUrl }}
            style={{ width: "100%", aspectRatio: 16 / 9 }}
            contentFit="contain"
            transition={150}
            accessibilityLabel="Illustration for this question"
          />
        </View>
      ) : null}
    </View>
  )
})
