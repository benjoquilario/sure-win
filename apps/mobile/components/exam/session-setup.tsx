import { memo, useCallback, type ReactNode } from "react"
import ArrowRight from "lucide-react-native/icons/arrow-right"
import CircleHelp from "lucide-react-native/icons/circle-question-mark"
import CircleX from "lucide-react-native/icons/circle-x"
import ClipboardList from "lucide-react-native/icons/clipboard-list"
import Clock from "lucide-react-native/icons/clock"
import Eye from "lucide-react-native/icons/eye"
import Flag from "lucide-react-native/icons/flag"
import Hourglass from "lucide-react-native/icons/hourglass"
import Layers from "lucide-react-native/icons/layers"
import ListFilter from "lucide-react-native/icons/list-filter"
import Target from "lucide-react-native/icons/target"
import Zap from "lucide-react-native/icons/zap"
import { View } from "react-native"

import {
  FEEDBACK_TIMING_LABELS,
  QUESTION_SOURCE_LABELS,
  type FeedbackTiming,
  type MemberSettings,
  type QuestionSource,
} from "@/lib/member/settings"
import { cn } from "@/lib/utils"
import { useThemePalette } from "@/hooks/use-theme"
import { MotionPressable } from "@/components/ui/motion"
import { Text } from "@/components/ui/text"

/**
 * The pre-flight choices: how long, when to reveal, which items.
 *
 * Seeded from the member's saved `user_settings` so the common case is one
 * tap — the choices here are per-sitting overrides, not a second copy of the
 * preferences screen.
 *
 * Laid out as tiles rather than full-width rows so all three fit above the
 * fold: a 2×2 grid for length, three-across for the other two, with the
 * selected option's description spelled out once beneath its group instead
 * of under every option. The icons are the ones the study-preferences screen
 * uses for the same settings, so the two screens read as one system.
 */

type IconComponent = typeof Zap

export type SessionLengthOption = {
  id: string
  label: string
  description: string
  questionCount: number
  minutes: number
}

/**
 * Presets, capped to what the paper actually holds.
 *
 * Offering "120 items" over an 80-item set is how a run silently becomes
 * shorter than it claims, so anything that does not fit is dropped rather than
 * quietly truncated.
 */
export function buildLengthOptions(
  availableCount: number,
  /** The paper's own time limit from the CMS, when it has one. */
  paperMinutes?: number | null
): SessionLengthOption[] {
  const presets: SessionLengthOption[] = [
    {
      id: "quick",
      label: "Quick drill",
      description: "20 items · 10 min",
      questionCount: 20,
      minutes: 10,
    },
    {
      id: "practice",
      label: "Practice",
      description: "50 items · 30 min",
      questionCount: 50,
      minutes: 30,
    },
    {
      id: "extended",
      label: "Extended",
      description: "80 items · 45 min",
      questionCount: 80,
      minutes: 45,
    },
  ]

  const fitting = presets.filter(
    (preset) => preset.questionCount <= availableCount
  )

  // The real sitting's time limit when the CMS gives one; otherwise about
  // 36 seconds an item, floored so a short paper still gets a usable timer.
  const fullMinutes =
    paperMinutes && paperMinutes > 0
      ? paperMinutes
      : Math.max(Math.round(availableCount * 0.6), 5)

  return [
    ...fitting,
    {
      id: "full",
      label: "Whole paper",
      description: `${availableCount} items · ${fullMinutes} min`,
      questionCount: availableCount,
      minutes: fullMinutes,
    },
  ]
}

const LENGTH_ICONS: Record<string, IconComponent> = {
  quick: Zap,
  practice: Target,
  extended: Hourglass,
  full: ClipboardList,
}

const FEEDBACK_ICONS: Record<FeedbackTiming, IconComponent> = {
  instant: Zap,
  on_next: ArrowRight,
  at_end: Flag,
}

const SOURCE_ICONS: Record<QuestionSource, IconComponent> = {
  all: Layers,
  unanswered: CircleHelp,
  incorrect: CircleX,
  bookmarked: Layers,
}

// ─── Building blocks ────────────────────────────────────────────────────────

/** One group's heading: a small icon, the question it answers, a hint. */
export function SetupGroup({
  icon: Icon,
  title,
  hint,
  children,
}: {
  icon: IconComponent
  title: string
  /** One line under the options — the selected option, spelled out. */
  hint?: string
  children: ReactNode
}) {
  const theme = useThemePalette()

  return (
    <View className="gap-2.5">
      <View className="flex-row items-center gap-1.5">
        <Icon size={14} color={theme.mutedForeground} strokeWidth={2.4} />
        <Text variant="label" className="text-muted-foreground">
          {title}
        </Text>
      </View>

      {children}

      {hint ? (
        <Text variant="caption" className="px-0.5">
          {hint}
        </Text>
      ) : null}
    </View>
  )
}

/** Lets a tile fill its stretched wrapper, so a row shares one height. */
const FILL = { flex: 1 } as const

type ChoiceTileProps = {
  icon: IconComponent
  title: string
  meta?: string
  isSelected: boolean
  /** Spoken after the title; the visible tile is too small to carry it. */
  accessibilityHint?: string
  /** `row` puts the icon beside the text (wide tiles), `stack` above it. */
  layout: "row" | "stack"
  onPress: () => void
}

/**
 * A selectable tile. 1px border in both states so nothing shifts on tap; the
 * selection reads from the filled icon, the primary edge and the tint
 * together, which keeps it legible without relying on color alone.
 *
 * Exported for the results screen's Mistakes / All switch, so every
 * "pick one of these" control in a sitting looks the same.
 */
export const ChoiceTile = memo(function ChoiceTile({
  icon: Icon,
  title,
  meta,
  isSelected,
  accessibilityHint,
  layout,
  onPress,
}: ChoiceTileProps) {
  const theme = useThemePalette()
  const isStack = layout === "stack"

  return (
    <MotionPressable
      onPress={onPress}
      role="radio"
      aria-checked={isSelected}
      accessibilityLabel={[title, meta].filter(Boolean).join(", ")}
      accessibilityHint={accessibilityHint}
      containerStyle={FILL}
      className={cn(
        "flex-1 rounded-md border px-3 py-3",
        isStack ? "items-center gap-2" : "flex-row items-center gap-2.5",
        isSelected ? "border-primary bg-primary/5" : "border-border bg-card"
      )}
    >
      <View
        className={cn(
          "h-8 w-8 items-center justify-center rounded-sm",
          isSelected ? "bg-primary" : "bg-muted"
        )}
      >
        <Icon
          size={16}
          color={isSelected ? theme.primaryForeground : theme.mutedForeground}
          strokeWidth={2.4}
        />
      </View>

      <View
        className={cn("min-w-0 gap-0.5", isStack ? "items-center" : "flex-1")}
      >
        <Text
          className={cn(
            "text-sm font-bold leading-5",
            isStack && "text-center",
            isSelected ? "text-primary" : "text-card-foreground"
          )}
          numberOfLines={2}
        >
          {title}
        </Text>
        {meta ? (
          <Text
            variant="caption"
            className={isStack ? "text-center" : undefined}
            numberOfLines={1}
          >
            {meta}
          </Text>
        ) : null}
      </View>
    </MotionPressable>
  )
})

// ─── The three pickers ──────────────────────────────────────────────────────

type SessionLengthPickerProps = {
  options: SessionLengthOption[]
  selectedId: string
  onSelect: (option: SessionLengthOption) => void
}

export const SessionLengthPicker = memo(function SessionLengthPicker({
  options,
  selectedId,
  onSelect,
}: SessionLengthPickerProps) {
  return (
    <SetupGroup icon={Clock} title="How long">
      <View
        role="radiogroup"
        aria-label="How long"
        className="flex-row flex-wrap gap-2"
      >
        {options.map((option) => (
          // Two across. `flexBasis` slightly under half so the gap fits; an
          // odd option out (a short paper offers fewer presets) grows to fill.
          <View key={option.id} style={{ flexBasis: "46%", flexGrow: 1 }}>
            <ChoiceTile
              icon={LENGTH_ICONS[option.id] ?? ClipboardList}
              title={option.label}
              meta={option.description}
              isSelected={option.id === selectedId}
              layout="row"
              onPress={() => onSelect(option)}
            />
          </View>
        ))}
      </View>
    </SetupGroup>
  )
})

type FeedbackTimingPickerProps = {
  value: FeedbackTiming
  onChange: (value: FeedbackTiming) => void
}

const FEEDBACK_ORDER: FeedbackTiming[] = ["instant", "on_next", "at_end"]

export const FeedbackTimingPicker = memo(function FeedbackTimingPicker({
  value,
  onChange,
}: FeedbackTimingPickerProps) {
  const handleChange = useCallback(
    (next: FeedbackTiming) => () => onChange(next),
    [onChange]
  )

  return (
    <SetupGroup
      icon={Eye}
      title="When to reveal the answer"
      hint={FEEDBACK_TIMING_LABELS[value].description}
    >
      <View
        role="radiogroup"
        aria-label="When to reveal the answer"
        className="flex-row gap-2"
      >
        {FEEDBACK_ORDER.map((timing) => (
          <View key={timing} className="flex-1">
            <ChoiceTile
              icon={FEEDBACK_ICONS[timing]}
              title={FEEDBACK_TIMING_LABELS[timing].title}
              accessibilityHint={FEEDBACK_TIMING_LABELS[timing].description}
              isSelected={timing === value}
              layout="stack"
              onPress={handleChange(timing)}
            />
          </View>
        ))}
      </View>
    </SetupGroup>
  )
})

type QuestionSourcePickerProps = {
  value: QuestionSource
  onChange: (value: QuestionSource) => void
  /** How many items each source would actually serve. */
  availability?: Partial<Record<QuestionSource, number>>
}

const SOURCE_ORDER: QuestionSource[] = ["all", "unanswered", "incorrect"]

export const QuestionSourcePicker = memo(function QuestionSourcePicker({
  value,
  onChange,
  availability,
}: QuestionSourcePickerProps) {
  const handleChange = useCallback(
    (next: QuestionSource) => () => onChange(next),
    [onChange]
  )

  return (
    <SetupGroup
      icon={ListFilter}
      title="Which questions"
      hint={QUESTION_SOURCE_LABELS[value].description}
    >
      <View
        role="radiogroup"
        aria-label="Which questions"
        className="flex-row gap-2"
      >
        {SOURCE_ORDER.map((source) => {
          const count = availability?.[source]

          return (
            <View key={source} className="flex-1">
              <ChoiceTile
                icon={SOURCE_ICONS[source]}
                title={QUESTION_SOURCE_LABELS[source].title}
                // The count, not the description: it is what tells a member
                // that "My mistakes" would fall back to the whole paper today.
                meta={
                  typeof count === "number"
                    ? `${count} ${count === 1 ? "item" : "items"}`
                    : undefined
                }
                accessibilityHint={QUESTION_SOURCE_LABELS[source].description}
                isSelected={source === value}
                layout="stack"
                onPress={handleChange(source)}
              />
            </View>
          )
        })}
      </View>
    </SetupGroup>
  )
})

/** The one-line summary of a sitting, e.g. for the start button's hint. */
export function describeSession(
  settings: Pick<MemberSettings, "feedbackTiming" | "shuffleQuestions">,
  questionCount: number,
  minutes: number
) {
  const parts = [
    `${questionCount} items`,
    minutes > 0 ? `${minutes} minutes` : null,
    FEEDBACK_TIMING_LABELS[settings.feedbackTiming].title.toLowerCase() +
      " feedback",
    settings.shuffleQuestions ? "shuffled" : null,
  ]

  return parts.filter(Boolean).join(" · ")
}
