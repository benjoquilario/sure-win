import { memo } from "react"
import ArrowLeftRight from "lucide-react-native/icons/arrow-left-right"
import ArrowRight from "lucide-react-native/icons/arrow-right"
import BookOpenCheck from "lucide-react-native/icons/book-open-check"
import Bookmark from "lucide-react-native/icons/bookmark"
import CircleHelp from "lucide-react-native/icons/circle-question-mark"
import CircleX from "lucide-react-native/icons/circle-x"
import Clock from "lucide-react-native/icons/clock"
import FastForward from "lucide-react-native/icons/fast-forward"
import Flag from "lucide-react-native/icons/flag"
import Gauge from "lucide-react-native/icons/gauge"
import Hash from "lucide-react-native/icons/hash"
import Hourglass from "lucide-react-native/icons/hourglass"
import Layers from "lucide-react-native/icons/layers"
import Lightbulb from "lucide-react-native/icons/lightbulb"
import ListFilter from "lucide-react-native/icons/list-filter"
import Shuffle from "lucide-react-native/icons/shuffle"
import SkipForward from "lucide-react-native/icons/skip-forward"
import Timer from "lucide-react-native/icons/timer"
import TimerOff from "lucide-react-native/icons/timer-off"
import Zap from "lucide-react-native/icons/zap"

import {
  DIFFICULTY_FILTER_LABELS,
  FEEDBACK_TIMING_LABELS,
  isAutoAdvanceApplicable,
  QUESTION_SOURCE_LABELS,
  TIMER_MODE_LABELS,
  type DifficultyFilter,
  type FeedbackTiming,
  type MemberSettings,
  type QuestionSource,
  type TimerMode,
} from "@/lib/member/settings"

import {
  SettingsOptionRow,
  SettingsStepperRow,
  SettingsSwitchRow,
  type SettingsOption,
} from "./settings-rows"
import { SettingsSection } from "./settings-section"

/**
 * How this member wants to be quizzed.
 *
 * Every value here is a column on `user_settings`, so it follows them to a new
 * phone. The defaults come from the schema, which is why nothing in this file
 * hardcodes one.
 *
 * `feedbackTiming` leads because it decides what kind of session this is, and
 * because a setting below it becomes meaningless under `at_end` - it is
 * disabled rather than hidden, so it is visible *why* it stopped applying.
 */

const FEEDBACK_ICONS: Record<FeedbackTiming, typeof Zap> = {
  instant: Zap,
  on_next: ArrowRight,
  at_end: Flag,
}

const FEEDBACK_OPTIONS: SettingsOption<FeedbackTiming>[] = (
  ["instant", "on_next", "at_end"] as const
).map((value) => ({
  value,
  label: FEEDBACK_TIMING_LABELS[value].title,
  description: FEEDBACK_TIMING_LABELS[value].description,
  icon: FEEDBACK_ICONS[value],
}))

const SOURCE_ICONS: Record<QuestionSource, typeof Zap> = {
  all: Layers,
  unanswered: CircleHelp,
  incorrect: CircleX,
  bookmarked: Bookmark,
}

const SOURCE_OPTIONS: SettingsOption<QuestionSource>[] = (
  ["all", "unanswered", "incorrect", "bookmarked"] as const
).map((value) => ({
  value,
  label: QUESTION_SOURCE_LABELS[value].title,
  description: QUESTION_SOURCE_LABELS[value].description,
  icon: SOURCE_ICONS[value],
}))

const DIFFICULTY_OPTIONS: SettingsOption<DifficultyFilter>[] = (
  ["all", "easy", "medium", "hard"] as const
).map((value) => ({
  value,
  label: value === "all" ? "Any" : DIFFICULTY_FILTER_LABELS[value],
  description:
    value === "all"
      ? "Every item, whatever its difficulty."
      : `Only items marked ${DIFFICULTY_FILTER_LABELS[value].toLowerCase()}.`,
}))

const TIMER_ICONS: Record<TimerMode, typeof Zap> = {
  off: TimerOff,
  per_question: Timer,
  whole_session: Hourglass,
}

const TIMER_DESCRIPTIONS: Record<TimerMode, string> = {
  off: "No clock. A paper's own time limit still applies when it has one.",
  per_question: "A fixed allowance for every item, added up for the sitting.",
  whole_session: "One countdown for the whole sitting.",
}

const TIMER_OPTIONS: SettingsOption<TimerMode>[] = (
  ["off", "per_question", "whole_session"] as const
).map((value) => ({
  value,
  label: TIMER_MODE_LABELS[value],
  description: TIMER_DESCRIPTIONS[value],
  icon: TIMER_ICONS[value],
}))

type StudyPreferencesSectionProps = {
  settings: MemberSettings
  onChange: (patch: Partial<MemberSettings>) => void
}

export const StudyPreferencesSection = memo(function StudyPreferencesSection({
  settings,
  onChange,
}: StudyPreferencesSectionProps) {
  const autoAdvanceApplies = isAutoAdvanceApplicable(settings)
  const isPerQuestion = settings.timerMode === "per_question"

  return (
    <>
      <SettingsSection
        id="feedback"
        title="Answers and feedback"
        description="When you find out whether you were right."
        keywords={["reveal", "rationale", "check"]}
      >
        <SettingsOptionRow
          icon={BookOpenCheck}
          label="Reveal the answer"
          options={FEEDBACK_OPTIONS}
          value={settings.feedbackTiming}
          onChange={(feedbackTiming) => onChange({ feedbackTiming })}
        />

        <SettingsSwitchRow
          icon={Lightbulb}
          tone="accent"
          label="Show explanations"
          description="The rationale under a revealed answer."
          keywords={["rationale"]}
          value={settings.showExplanations}
          onChange={(showExplanations) => onChange({ showExplanations })}
        />

        <SettingsSwitchRow
          icon={FastForward}
          label="Move on automatically"
          description={
            autoAdvanceApplies
              ? "Go to the next item a moment after the answer is revealed."
              : "Not used when answers are revealed at the end."
          }
          keywords={["auto advance"]}
          value={settings.autoAdvance}
          disabled={!autoAdvanceApplies}
          onChange={(autoAdvance) => onChange({ autoAdvance })}
        />

        {settings.autoAdvance && autoAdvanceApplies ? (
          <SettingsStepperRow
            icon={Clock}
            label="Wait before moving on"
            description="Time to read the rationale first."
            value={settings.autoAdvanceSeconds}
            min={1}
            max={30}
            step={1}
            formatValue={(value) => `${value}s`}
            onChange={(autoAdvanceSeconds) => onChange({ autoAdvanceSeconds })}
          />
        ) : null}
      </SettingsSection>

      <SettingsSection
        id="questions"
        title="Question pool"
        description="Which items a new sitting draws from."
        keywords={["questions", "items"]}
      >
        <SettingsOptionRow
          icon={ListFilter}
          label="Source"
          options={SOURCE_OPTIONS}
          value={settings.questionSource}
          onChange={(questionSource) => onChange({ questionSource })}
        />

        <SettingsOptionRow
          icon={Gauge}
          label="Difficulty"
          keywords={["easy", "medium", "hard"]}
          options={DIFFICULTY_OPTIONS}
          value={settings.difficultyFilter}
          onChange={(difficultyFilter) => onChange({ difficultyFilter })}
        />

        <SettingsStepperRow
          icon={Hash}
          label="Questions per sitting"
          description="All means the whole paper."
          keywords={["length", "count"]}
          value={settings.questionsPerSession}
          min={0}
          max={200}
          step={5}
          formatValue={(value) => (value === 0 ? "All" : String(value))}
          onChange={(questionsPerSession) => onChange({ questionsPerSession })}
        />
      </SettingsSection>

      <SettingsSection
        id="sitting"
        title="During a sitting"
        description="Order, skipping and the clock."
        keywords={["exam", "quiz"]}
      >
        <SettingsSwitchRow
          icon={Shuffle}
          label="Shuffle questions"
          description="Change the order they appear in. Item numbers stay the same."
          keywords={["random", "order"]}
          value={settings.shuffleQuestions}
          onChange={(shuffleQuestions) => onChange({ shuffleQuestions })}
        />

        <SettingsSwitchRow
          icon={ArrowLeftRight}
          label="Shuffle choices"
          description="Rearrange the options under each question."
          keywords={["random", "answers"]}
          value={settings.shuffleChoices}
          onChange={(shuffleChoices) => onChange({ shuffleChoices })}
        />

        <SettingsSwitchRow
          icon={SkipForward}
          label="Allow skipping"
          description="Move on without choosing, and come back later."
          keywords={["skip"]}
          value={settings.allowSkip}
          onChange={(allowSkip) => onChange({ allowSkip })}
        />

        <SettingsOptionRow
          icon={Timer}
          label="Timer"
          keywords={["clock", "countdown", "time"]}
          options={TIMER_OPTIONS}
          value={settings.timerMode}
          onChange={(timerMode) => onChange({ timerMode })}
        />

        {settings.timerMode !== "off" ? (
          <SettingsStepperRow
            icon={Clock}
            label={isPerQuestion ? "Time per question" : "Time per sitting"}
            description={
              isPerQuestion
                ? "Seconds allowed for each item."
                : "Minutes for the whole sitting."
            }
            keywords={["time", "duration"]}
            value={
              isPerQuestion
                ? settings.timerSeconds
                : Math.round(settings.timerSeconds / 60)
            }
            min={isPerQuestion ? 5 : 1}
            max={isPerQuestion ? 300 : 600}
            step={5}
            formatValue={(value) => (isPerQuestion ? `${value}s` : `${value}m`)}
            onChange={(value) =>
              onChange({ timerSeconds: isPerQuestion ? value : value * 60 })
            }
          />
        ) : null}
      </SettingsSection>
    </>
  )
})
