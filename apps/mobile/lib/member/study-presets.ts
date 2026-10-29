import type { MemberSettings } from "./settings"

/**
 * ─── Study modes ──────────────────────────────────────────────────────────
 *
 * Eight separate switches decide how a sitting behaves, and most members want
 * one of three combinations. A preset sets all of them in one tap; changing any
 * single switch afterwards turns the mode into "Custom", which is shown rather
 * than hidden so nobody wonders why the exam simulation is revealing answers.
 *
 * Only settings that shape a sitting are touched. Theme, reminders and the
 * question pool size stay the member's own.
 */

export type StudyPresetId = "exam" | "practice" | "mistakes"

type PresetSettings = Pick<
  MemberSettings,
  | "feedbackTiming"
  | "showExplanations"
  | "autoAdvance"
  | "questionSource"
  | "shuffleQuestions"
  | "shuffleChoices"
  | "allowSkip"
  | "timerMode"
>

export type StudyPreset = {
  id: StudyPresetId
  title: string
  description: string
  settings: PresetSettings
}

export const STUDY_PRESETS: readonly StudyPreset[] = [
  {
    id: "exam",
    title: "Board exam simulation",
    description:
      "Timed, shuffled, answers revealed only when you submit. The closest thing to exam day.",
    settings: {
      feedbackTiming: "at_end",
      // Shown on the results screen, which is the only place anything is
      // revealed under `at_end`.
      showExplanations: true,
      autoAdvance: false,
      questionSource: "all",
      shuffleQuestions: true,
      shuffleChoices: true,
      // The real exam lets you leave an item and come back to it.
      allowSkip: true,
      timerMode: "whole_session",
    },
  },
  {
    id: "practice",
    title: "Guided practice",
    description:
      "Untimed, with the answer and rationale after every item. For learning a topic.",
    settings: {
      feedbackTiming: "instant",
      showExplanations: true,
      autoAdvance: false,
      questionSource: "all",
      shuffleQuestions: false,
      shuffleChoices: false,
      allowSkip: true,
      timerMode: "off",
    },
  },
  {
    id: "mistakes",
    title: "Mistake drill",
    description:
      "Only the items you got wrong before, with explanations. The drill that moves scores.",
    settings: {
      feedbackTiming: "instant",
      showExplanations: true,
      autoAdvance: false,
      questionSource: "incorrect",
      shuffleQuestions: true,
      shuffleChoices: true,
      allowSkip: false,
      timerMode: "off",
    },
  },
]

/** The preset these settings match exactly, or null for "Custom". */
export function findActivePreset(settings: MemberSettings): StudyPreset | null {
  return (
    STUDY_PRESETS.find((preset) =>
      (Object.keys(preset.settings) as (keyof PresetSettings)[]).every(
        (key) => settings[key] === preset.settings[key]
      )
    ) ?? null
  )
}

/**
 * Applying the exam preset turns the timer on. A member who has never set a
 * duration would get the schema default, so give them a sensible one: the
 * paper's own limit still wins whenever the setup screen passes minutes.
 */
export function getPresetPatch(
  preset: StudyPreset,
  settings: MemberSettings
): Partial<MemberSettings> {
  if (
    preset.settings.timerMode === "whole_session" &&
    settings.timerMode !== "whole_session"
  ) {
    return { ...preset.settings, timerSeconds: 60 * 60 }
  }

  return preset.settings
}
