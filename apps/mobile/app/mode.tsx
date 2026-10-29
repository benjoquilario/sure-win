import { useCallback } from "react"
import { useRouter } from "expo-router"
import type { LucideIcon } from "lucide-react-native"
import ChevronRight from "lucide-react-native/icons/chevron-right"
import ClipboardCheck from "lucide-react-native/icons/clipboard-check"
import Flag from "lucide-react-native/icons/flag"
import GraduationCap from "lucide-react-native/icons/graduation-cap"
import Layers from "lucide-react-native/icons/layers"
import Lightbulb from "lucide-react-native/icons/lightbulb"
import Timer from "lucide-react-native/icons/timer"
import TimerOff from "lucide-react-native/icons/timer-off"
import Zap from "lucide-react-native/icons/zap"
import { View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

import type { QuestionnaireMode } from "@workspace/schema"

import { getStaggerDelay } from "@/lib/motion"
import { withOpacity, type ThemePalette } from "@/lib/theme"
import { cn } from "@/lib/utils"
import { useContentPadding, useLayout } from "@/hooks/use-layout"
import { useThemePalette } from "@/hooks/use-theme"
import { FadeInView, MotionPressable } from "@/components/ui/motion"
import { Text } from "@/components/ui/text"
import { ScrollView } from "@/components/ui/virtualized-scroll-view"

/**
 * ─── Pick a mode ──────────────────────────────────────────────────────────
 *
 * `exam_categories.mode` is `quiz` or `board_exam`, and it is the CMS's own
 * statement about where a category belongs. This screen is that column, made
 * tappable — it does not invent a third category of its own.
 *
 * The native Stack header already titles it "Question Mode", so there is no
 * second heading in the content. Each mode is one compact card: what it is in
 * a line, and the three facts that separate it from the other as chips.
 */

type ModeFeature = { Icon: LucideIcon; label: string }

type ModeOption = {
  mode: QuestionnaireMode
  Icon: LucideIcon
  title: string
  description: string
  /** Category hue from the palette, so the two modes are told apart at a glance. */
  accent: (theme: ThemePalette) => string
  features: ModeFeature[]
}

const MODES: ModeOption[] = [
  {
    mode: "quiz",
    Icon: ClipboardCheck,
    title: "Quick quiz",
    description: "Short, untimed, feedback as you go.",
    accent: (theme) => theme.chart2,
    features: [
      { Icon: TimerOff, label: "Untimed" },
      { Icon: Zap, label: "Instant feedback" },
      { Icon: Lightbulb, label: "Best for drilling" },
    ],
  },
  {
    mode: "board_exam",
    Icon: GraduationCap,
    title: "Board exam",
    description: "Full lettered sets, timed, answers at the end.",
    accent: (theme) => theme.chart1,
    features: [
      { Icon: Timer, label: "Timed" },
      { Icon: Layers, label: "Lettered sets" },
      { Icon: Flag, label: "Answers at the end" },
    ],
  },
]

const FILL = { flex: 1 } as const

export default function ModeScreen() {
  const router = useRouter()
  const contentPadding = useContentPadding("reading")
  // Two choices side by side once each can keep a comfortable card width;
  // stacked, they push the second one below the fold on a landscape tablet.
  const { frameWidth } = useLayout()
  const sideBySide = frameWidth >= 600

  const openMode = useCallback(
    (mode: QuestionnaireMode) => {
      router.push({ pathname: "/board-exams", params: { mode } })
    },
    [router]
  )

  return (
    // Under the native Stack header, which owns the top edge.
    <SafeAreaView
      edges={["left", "right", "bottom"]}
      className="flex-1 bg-background"
    >
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerClassName="gap-3 pb-8 pt-3"
        contentContainerStyle={contentPadding}
      >
        <Text variant="caption" className="px-1">
          Both use the same question bank. They differ in how you are asked and
          when you see the answers.
        </Text>

        <View className={sideBySide ? "flex-row gap-3" : "gap-3"}>
          {MODES.map((option, index) => (
            <FadeInView
              key={option.mode}
              delay={getStaggerDelay(index)}
              style={sideBySide ? { flex: 1 } : undefined}
            >
              <ModeCard option={option} fill={sideBySide} onPress={openMode} />
            </FadeInView>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

function ModeCard({
  option,
  fill = false,
  onPress,
}: {
  option: ModeOption
  /** Side by side: stretch so both cards share the taller one's height. */
  fill?: boolean
  onPress: (mode: QuestionnaireMode) => void
}) {
  const theme = useThemePalette()
  const accent = option.accent(theme)

  return (
    <MotionPressable
      onPress={() => onPress(option.mode)}
      accessibilityRole="button"
      accessibilityLabel={`${option.title}. ${option.description}`}
      accessibilityHint={option.features.map((item) => item.label).join(", ")}
      containerStyle={fill ? FILL : undefined}
      className={cn(
        "gap-3 rounded-xl border border-border bg-card p-4",
        fill && "flex-1"
      )}
    >
      <View className="flex-row items-center gap-3">
        <View
          className="h-12 w-12 items-center justify-center rounded-md"
          style={{ backgroundColor: withOpacity(accent, 0.12) }}
        >
          <option.Icon size={22} color={accent} strokeWidth={2.2} />
        </View>

        <View className="min-w-0 flex-1 gap-0.5">
          <Text className="text-base font-extrabold text-card-foreground">
            {option.title}
          </Text>
          <Text variant="caption" numberOfLines={2}>
            {option.description}
          </Text>
        </View>

        <View className="h-8 w-8 items-center justify-center rounded-full bg-muted">
          <ChevronRight
            size={16}
            color={theme.mutedForeground}
            strokeWidth={2.4}
          />
        </View>
      </View>

      <View className="flex-row flex-wrap gap-1.5">
        {option.features.map(({ Icon, label }) => (
          <View
            key={label}
            className="flex-row items-center gap-1 rounded-full bg-muted px-2.5 py-1"
          >
            <Icon size={12} color={accent} strokeWidth={2.4} />
            <Text className="text-xs font-semibold text-muted-foreground">
              {label}
            </Text>
          </View>
        ))}
      </View>
    </MotionPressable>
  )
}
