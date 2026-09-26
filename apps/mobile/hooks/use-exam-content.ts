import { useMemo } from "react"
import { useAuth } from "@/contexts/auth-context"
import { useQuery } from "@tanstack/react-query"

import { toContentViewer } from "@/lib/content/access"
import { getExamCategory } from "@/lib/content/exam-categories"
import { getQuestionSet, listQuestionSets } from "@/lib/content/question-sets"
import { loadPaper } from "@/lib/content/questions"
import { listBookmarkedSkus } from "@/lib/member/bookmarks"
import { queryKeys } from "@/lib/query-keys"
import { listAnsweredSkus, listIncorrectSkus } from "@/lib/session/answers"
import { findResumableSession } from "@/lib/session/study-session"

/**
 * Reads for the exam screens, in one place.
 *
 * The paywall is applied here rather than in each screen, so no screen can
 * forget it and no screen can apply it twice.
 */

export function useContentViewer() {
  const profile = useAuth((state) => state.profile)
  return useMemo(() => toContentViewer(profile), [profile])
}

export function useExamCategory(categoryId: string) {
  const viewer = useContentViewer()

  return useQuery({
    queryKey: queryKeys.exam.category(categoryId, viewer.isPremium),
    enabled: Boolean(categoryId),
    queryFn: () => getExamCategory(categoryId, viewer),
  })
}

export function useQuestionSets(categoryId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.exam.sets(categoryId),
    enabled: enabled && Boolean(categoryId),
    queryFn: () => listQuestionSets(categoryId),
  })
}

export function useQuestionSet(setId: string) {
  return useQuery({
    queryKey: queryKeys.exam.set(setId),
    enabled: Boolean(setId),
    queryFn: () => getQuestionSet(setId),
  })
}

/**
 * The items for one paper, already paywalled.
 *
 * `setId` of null means the questions sitting directly under the category —
 * which is the common shape, not the exception.
 *
 * With the exam-questions Function configured, the **server** decides what
 * this member may see and never sends the rest, so the answer keys and
 * explanations of a paper they have not paid for are never on the device.
 * The count of what they are missing comes back as `total`, so the paywall can
 * still say how much is behind it without shipping any of it.
 */
export function useExamQuestions(params: {
  categoryId: string
  setId: string | null
  isPremiumCategory: boolean
  enabled?: boolean
}) {
  const viewer = useContentViewer()
  const freeOnly = params.isPremiumCategory && !viewer.isPremium

  const query = useQuery({
    queryKey: [
      ...queryKeys.exam.questions(params.categoryId, params.setId),
      freeOnly,
    ],
    enabled: (params.enabled ?? true) && Boolean(params.categoryId),
    queryFn: () =>
      loadPaper({
        categoryId: params.categoryId,
        setId: params.setId,
        freeOnly,
      }),
    // A paper does not change mid-sitting; refetching it would rebuild the
    // pool underneath the member.
    staleTime: 10 * 60 * 1000,
  })

  const paywalled = useMemo(() => {
    const paper = query.data

    if (!paper) {
      return { visible: [], hiddenCount: 0, isSample: false }
    }

    // Belt and braces for the direct path: a caller that asked for the whole
    // paper while not entitled still cannot render a paid item.
    const visible = paper.entitled
      ? paper.questions
      : paper.questions.filter((question) => question.isFree)

    return {
      visible,
      // Zero for an entitled member even if the total is higher: the gap is
      // then malformed items the loader withheld, not something to sell.
      hiddenCount: paper.entitled
        ? 0
        : Math.max(paper.total - visible.length, 0),
      isSample: !paper.entitled,
    }
  }, [query.data])

  return { ...query, ...paywalled }
}

/**
 * The unfinished sitting on this exact paper, if there is one.
 *
 * The setup screen reads it so the button can say "Continue" rather than
 * "Start" — the session layer would resume it either way, and a button that
 * says one thing and does another is worse than no badge at all.
 */
export function useResumableSession(params: {
  categoryId: string
  questionnaireId: string
  enabled?: boolean
}) {
  const userId = useAuth((state) => state.user?.$id) ?? ""

  return useQuery({
    queryKey: [
      "session",
      "resumable",
      userId,
      params.categoryId,
      params.questionnaireId,
    ],
    enabled: (params.enabled ?? true) && Boolean(userId && params.categoryId),
    queryFn: () =>
      findResumableSession({
        userId,
        categoryId: params.categoryId,
        questionnaireId: params.questionnaireId,
      }),
    staleTime: 15 * 1000,
  })
}

/** SKUs this member has already answered, and the ones they got wrong. */
export function useAnswerHistory(params: {
  categoryId: string
  questionnaireId?: string
  enabled?: boolean
}) {
  const userId = useAuth((state) => state.user?.$id) ?? ""

  return useQuery({
    queryKey: queryKeys.member.answerStats(
      userId,
      `${params.categoryId}:${params.questionnaireId ?? ""}`
    ),
    enabled: (params.enabled ?? true) && Boolean(userId && params.categoryId),
    queryFn: async () => {
      // All three sources `questionSource` can ask for, fetched together.
      // `bookmarked` was the odd one out until v3 added the table — the option
      // shipped, nothing stored a bookmark, and choosing it silently returned
      // the whole paper.
      const [answered, incorrect, bookmarked] = await Promise.all([
        listAnsweredSkus({
          userId,
          categoryId: params.categoryId,
          questionnaireId: params.questionnaireId,
        }),
        listIncorrectSkus({
          userId,
          categoryId: params.categoryId,
          questionnaireId: params.questionnaireId,
        }),
        listBookmarkedSkus({ userId, categoryId: params.categoryId }),
      ])

      return { answered, incorrect, bookmarked }
    },
  })
}
