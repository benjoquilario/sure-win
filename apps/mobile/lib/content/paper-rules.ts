/**
 * ─── The rules of one paper ───────────────────────────────────────────────
 *
 * Pass mark and time limit are set per category in the CMS, and a set can
 * override either one. A blank at both levels falls back to the app's
 * defaults: 75% to pass, and a timer sized from the item count.
 *
 * Resolved in one place so the setup screen, the timer and the results screen
 * can never disagree about which number applies.
 */

export const DEFAULT_PASSING_SCORE = 75

type RuleSource = {
  passingScore: number | null
  timeLimitMinutes: number | null
}

export type PaperRules = {
  passingScore: number
  /** null when neither level sets one. */
  timeLimitMinutes: number | null
}

export function resolvePaperRules(
  category: RuleSource,
  set: RuleSource | null
): PaperRules {
  return {
    passingScore:
      set?.passingScore ?? category.passingScore ?? DEFAULT_PASSING_SCORE,
    timeLimitMinutes: set?.timeLimitMinutes ?? category.timeLimitMinutes,
  }
}
