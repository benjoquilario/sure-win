import { memo } from "react"
import { View } from "react-native"

import type { FeedbackTiming } from "@/lib/member/settings"
import type {
  PresentedChoice,
  PresentedQuestion,
} from "@/lib/session/question-pool"

import { ChoiceList } from "./choice-list"
import { ExplanationPanel } from "./explanation-panel"
import { QuestionActions } from "./question-actions"
import { QuestionPrompt } from "./question-prompt"

/**
 * One question, mid-sitting.
 *
 * The whole behaviour of the screen turns on `feedbackTiming` (section 8), and
 * the branch lives here so no caller has to remember it:
 *
 *   instant  graded the moment a choice is tapped
 *   on_next  changeable until they confirm, then graded
 *   at_end   never graded here — the results screen is the only reveal
 */

type ExamQuestionCardProps = {
  presented: PresentedQuestion
  total: number
  selectedIndex: number | undefined
  feedbackTiming: FeedbackTiming
  /** True once this specific question has been revealed. */
  isRevealed: boolean
  showExplanations: boolean
  onSelect: (choice: PresentedChoice) => void
  /**
   * Saving and reporting. Both optional: a review screen renders the same card
   * with nothing to act on, and an absent handler draws no control rather than
   * a dead one.
   */
  isSaved?: boolean
  onToggleSave?: () => void
  onReport?: () => void
}

export const ExamQuestionCard = memo(function ExamQuestionCard({
  presented,
  total,
  selectedIndex,
  feedbackTiming,
  isRevealed,
  showExplanations,
  onSelect,
  isSaved = false,
  onToggleSave,
  onReport,
}: ExamQuestionCardProps) {
  const { question } = presented
  const isGraded = feedbackTiming !== "at_end" && isRevealed
  const isCorrect = selectedIndex === question.answerIndex
  const correctChoice = presented.choices.find(
    (choice) => choice.index === question.answerIndex
  )

  // No card around the question: the choices are the tappable surfaces, and a
  // card holding cards draws two borders around every option. The stem sits on
  // the page, like the paper it stands in for.
  return (
    <View className="gap-5">
      <QuestionPrompt
        question={question}
        position={presented.position}
        total={total}
      />

      <ChoiceList
        presented={presented}
        selectedIndex={selectedIndex}
        isGraded={isGraded}
        onSelect={onSelect}
      />

      {/* Nothing is reserved for the panel before it resolves: its height
            depends on the explanation's length, and a placeholder that jumps
            to a different size is worse than one that appears. */}
      {isGraded ? (
        <ExplanationPanel
          isCorrect={isCorrect}
          correctAnswerLabel={correctChoice?.displayLabel}
          correctAnswerText={correctChoice?.text}
          explanation={question.explanation}
          showExplanation={showExplanations}
        />
      ) : null}

      {onToggleSave && onReport ? (
        <QuestionActions
          isSaved={isSaved}
          onToggleSave={onToggleSave}
          onReport={onReport}
        />
      ) : null}
    </View>
  )
})
