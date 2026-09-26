import { Stack, useLocalSearchParams, useRouter } from "expo-router"
import { SafeAreaView } from "react-native-safe-area-context"

import { DIRECT_SET_ID } from "@/lib/content/question-sets"
import { useExamCategory, useQuestionSet } from "@/hooks/use-exam-content"
import { Button } from "@/components/ui/button"
import { ContentFrame } from "@/components/ui/content-frame"
import { EmptyState } from "@/components/ui/empty-state"
import { Skeleton } from "@/components/ui/skeleton"
import { Text } from "@/components/ui/text"
import { PaperSetupScreen } from "@/components/exam/paper-setup-screen"

/**
 * One lettered set, ready to start.
 *
 * The setup itself is `PaperSetupScreen`, shared with the no-set shape — this
 * route only resolves which category and set the member picked.
 */
export default function QuestionSetScreen() {
  const router = useRouter()
  const params = useLocalSearchParams<{
    categoryId?: string
    setId?: string
  }>()

  const categoryId = params.categoryId ?? ""
  // "General" on the set picker: the questions directly under a category that
  // also has sets. It is the no-set paper, reached through the picker.
  const isDirect = params.setId === DIRECT_SET_ID
  const setId = isDirect ? "" : (params.setId ?? "")

  const categoryQuery = useExamCategory(categoryId)
  const setQuery = useQuestionSet(setId)

  const category = categoryQuery.data ?? null
  const set = setQuery.data ?? null
  const isLoading = categoryQuery.isLoading || (!isDirect && setQuery.isLoading)

  if (isLoading) {
    return (
      <SafeAreaView
        edges={["left", "right", "bottom"]}
        className="flex-1 bg-background py-4"
      >
        <Stack.Screen options={{ title: "Loading" }} />
        <ContentFrame width="reading" className="gap-3">
          <Skeleton className="h-24 rounded-xl" />
          <Skeleton className="h-40 rounded-xl" />
        </ContentFrame>
      </SafeAreaView>
    )
  }

  if (isDirect && category) {
    return (
      <>
        <Stack.Screen options={{ title: `${category.title} · General` }} />
        <PaperSetupScreen category={category} set={null} />
      </>
    )
  }

  // A set whose `categoryId` does not match the route is a stale deep link —
  // opening it would show one category's title above another's questions.
  if (!category || !set || set.categoryId !== category.id) {
    return (
      <SafeAreaView
        edges={["left", "right", "bottom"]}
        className="flex-1 bg-background py-4"
      >
        <Stack.Screen options={{ title: "Not found" }} />
        <ContentFrame width="reading">
          <EmptyState
            tone="destructive"
            title="Set not found"
            description="This set is no longer published, or it belongs to another category."
            action={
              <Button
                size="sm"
                variant="outline"
                onPress={() => router.replace("/board-exams")}
              >
                <Text>Browse categories</Text>
              </Button>
            }
          />
        </ContentFrame>
      </SafeAreaView>
    )
  }

  return (
    <>
      <Stack.Screen options={{ title: set.title }} />
      <PaperSetupScreen category={category} set={set} />
    </>
  )
}
