import { useCallback, useMemo } from "react"
import { FlashList, type ListRenderItemInfo } from "@shopify/flash-list"
import { Stack, useLocalSearchParams, useRouter } from "expo-router"
import { View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

import { getCategoryDestination } from "@/lib/content/exam-categories"
import { DIRECT_SET_ID, type QuestionSet } from "@/lib/content/question-sets"
import { getGridCellStyle } from "@/lib/layout"
import { useExamCategory, useQuestionSets } from "@/hooks/use-exam-content"
import { useContentPadding, useGridColumns } from "@/hooks/use-layout"
import { Button } from "@/components/ui/button"
import { ContentFrame } from "@/components/ui/content-frame"
import { EmptyState } from "@/components/ui/empty-state"
import { Skeleton } from "@/components/ui/skeleton"
import { Text } from "@/components/ui/text"
import { PaperSetupScreen } from "@/components/exam/paper-setup-screen"
import { QuestionSetCard } from "@/components/exam/set-card"

/**
 * A category, routed by its own counts.
 *
 * `setCount > 0` opens the set picker. `setCount === 0` means the questions sit
 * directly under the category, and the member goes straight to the setup —
 * making them tap through an empty picker to get there would be a step that
 * exists only because the data has two shapes.
 */

export default function ExamCategoryScreen() {
  const router = useRouter()
  const params = useLocalSearchParams<{ categoryId?: string }>()
  const categoryId = params.categoryId ?? ""

  const categoryQuery = useExamCategory(categoryId)
  const category = categoryQuery.data ?? null

  const destination = useMemo(
    () => (category ? getCategoryDestination(category) : null),
    [category]
  )

  const setsQuery = useQuestionSets(categoryId, destination?.kind === "sets")
  const columns = useGridColumns(300)
  const contentPadding = useContentPadding()

  /**
   * The sets, plus the category's loose questions when it has both.
   *
   * The model allows a category to hold lettered sets *and* questions directly
   * under it. Once a set was published the picker showed only the sets, and
   * the loose questions became unreachable. They now appear as their own
   * entry, after the sets, under a synthetic id no Appwrite row can have.
   */
  const entries = useMemo<QuestionSet[]>(() => {
    const sets = setsQuery.data ?? []

    if (!category || category.directQuestionCount === 0 || sets.length === 0) {
      return sets
    }

    return [
      ...sets,
      {
        id: DIRECT_SET_ID,
        categoryId: category.id,
        setCode: "•",
        title: "General",
        code: null,
        description: "Questions that are not part of a lettered set",
        order: Number.MAX_SAFE_INTEGER,
        questionCount: category.directQuestionCount,
        isPublished: true,
        passingScore: null,
        timeLimitMinutes: null,
      },
    ]
  }, [category, setsQuery.data])

  const openSet = useCallback(
    (setId: string) => {
      router.push({
        pathname: "/board-exams/[categoryId]/[setId]",
        params: { categoryId, setId },
      })
    },
    [categoryId, router]
  )

  const renderSet = useCallback(
    ({ item, index }: ListRenderItemInfo<QuestionSet>) => (
      <View style={getGridCellStyle(index, columns)}>
        <QuestionSetCard set={item} onPress={() => openSet(item.id)} />
      </View>
    ),
    [columns, openSet]
  )

  const title = category?.title ?? "Board exams"

  if (categoryQuery.isLoading) {
    return (
      <SafeAreaView
        edges={["left", "right", "bottom"]}
        className="flex-1 bg-background py-4"
      >
        <Stack.Screen options={{ title }} />
        <ContentFrame className="gap-3">
          <Skeleton className="h-24 rounded-xl" />
          <Skeleton className="h-24 rounded-xl" />
        </ContentFrame>
      </SafeAreaView>
    )
  }

  if (!category) {
    return (
      <SafeAreaView
        edges={["left", "right", "bottom"]}
        className="flex-1 bg-background py-4"
      >
        <Stack.Screen options={{ title }} />
        <ContentFrame>
          <EmptyState
            tone="destructive"
            title="Category not found"
            description="This category is no longer published."
            action={
              <Button size="sm" variant="outline" onPress={() => router.back()}>
                <Text>Go back</Text>
              </Button>
            }
          />
        </ContentFrame>
      </SafeAreaView>
    )
  }

  if (destination?.kind !== "sets") {
    return <PaperSetupScreen category={category} set={null} />
  }

  return (
    <SafeAreaView
      edges={["left", "right", "bottom"]}
      className="flex-1 bg-background"
    >
      <Stack.Screen options={{ title }} />

      <FlashList
        key={`sets-${columns}`}
        numColumns={columns}
        data={entries}
        keyExtractor={(item) => item.id}
        renderItem={renderSet}
        contentContainerStyle={{ ...contentPadding, paddingVertical: 16 }}
        showsVerticalScrollIndicator={false}
        ItemSeparatorComponent={ListSeparator}
        ListHeaderComponent={
          <View className="gap-1 pb-4">
            <Text variant="label">
              {destination.setCount}{" "}
              {destination.setCount === 1 ? "set" : "sets"}
              {" · "}
              {/* What the member can open. `category.questionCount` also
                  counts draft sets, so it promised items no one can reach. */}
              {setsQuery.data
                ? entries.reduce((sum, entry) => sum + entry.questionCount, 0)
                : category.questionCount}{" "}
              questions
            </Text>
            {category.description ? (
              <Text variant="caption">{category.description}</Text>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          setsQuery.isLoading ? (
            <View className="gap-3">
              <Skeleton className="h-24 rounded-xl" />
              <Skeleton className="h-24 rounded-xl" />
            </View>
          ) : (
            <EmptyState
              title="No sets published yet"
              description="The team is still preparing this category. Check back soon."
            />
          )
        }
      />
    </SafeAreaView>
  )
}

function ListSeparator() {
  return <View className="h-3" />
}
