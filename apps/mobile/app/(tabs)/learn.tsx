import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from "react"
import { useAuth } from "@/contexts/auth-context"
import { FlashList, type ListRenderItemInfo } from "@shopify/flash-list"
import { useQuery } from "@tanstack/react-query"
import { useRouter } from "expo-router"
import Search from "lucide-react-native/icons/search"
import { View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

import {
  listLearningSubjects,
  type LearningSubject,
} from "@/lib/learning-content"
import { useGridColumns, useLayout } from "@/hooks/use-layout"
import { useIsPremium } from "@/hooks/use-membership"
import { useThemePalette } from "@/hooks/use-theme"
import { Card, CardContent } from "@/components/ui/card"
import { ContentFrame } from "@/components/ui/content-frame"
import { EmptyState } from "@/components/ui/empty-state"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Text } from "@/components/ui/text"
import { AppShellHeader } from "@/components/app-shell-header"
import { SubjectCard } from "@/components/learn"

/**
 * Half the gap between grid cells. Each cell pads itself by this much on every
 * side and the list pulls its padding in by the same amount, so the cards line
 * up with the pinned header while sitting a full `gap-3` apart from each other.
 */
const CELL_INSET = 6

const SubjectSkeleton = () => (
  <Card>
    <CardContent className="gap-3">
      <View className="flex-row items-start gap-3">
        <Skeleton className="h-11 w-11 rounded-lg" />
        <View className="flex-1 gap-1.5">
          <Skeleton className="h-4 w-44 rounded-xs" />
          <Skeleton className="h-3 w-28 rounded-xs" />
        </View>
      </View>
      <Skeleton className="h-4 w-full rounded-xs" />
      <Skeleton className="h-4 w-2/3 rounded-xs" />
    </CardContent>
  </Card>
)

export default function LearningLibraryScreen() {
  const router = useRouter()
  const theme = useThemePalette()
  const isAuthenticated = useAuth((state) => state.isAuthenticated)
  const profile = useAuth((state) => state.profile)
  const refreshProfile = useAuth((state) => state.refreshProfile)
  // Flag *and* date — the cached flag alone keeps a lapsed member premium
  // until a server sweep catches up (section 6).
  const isPremiumUser = useIsPremium()

  const [query, setQuery] = useState("")
  const deferredQuery = useDeferredValue(query)

  const { paddingFor } = useLayout()
  // Two columns once each card keeps 320pt, three on a wide desktop window.
  const columns = useGridColumns(320)

  useEffect(() => {
    if (isAuthenticated && !profile) {
      void refreshProfile()
    }
  }, [isAuthenticated, profile, refreshProfile])

  const subjectsQuery = useQuery({
    queryKey: ["learning-subjects", isPremiumUser],
    queryFn: () => listLearningSubjects({ viewerIsPremium: isPremiumUser }),
  })

  const subjects = useMemo(() => subjectsQuery.data ?? [], [subjectsQuery.data])

  const visibleSubjects = useMemo(() => {
    const normalized = deferredQuery.trim().toLowerCase()

    if (!normalized) {
      return subjects
    }

    return subjects.filter(
      (subject) =>
        subject.name.toLowerCase().includes(normalized) ||
        subject.description.toLowerCase().includes(normalized)
    )
  }, [deferredQuery, subjects])

  const handleSubjectPress = useCallback(
    (subject: LearningSubject) => {
      if (subject.isLocked) {
        router.push({
          pathname: "/premium",
          params: {
            source: "subject",
            title: subject.name,
            categoryId: subject.id,
          },
        })
        return
      }

      router.push({
        pathname: "/review/[categoryId]",
        params: { categoryId: subject.id },
      })
    },
    [router]
  )

  const renderSubject = useCallback(
    ({ item }: ListRenderItemInfo<LearningSubject>) => (
      <View style={{ padding: CELL_INSET }}>
        <SubjectCard
          subject={item}
          theme={theme}
          showPremiumMix={!isPremiumUser && item.hasPremiumContent}
          onPress={handleSubjectPress}
        />
      </View>
    ),
    [handleSubjectPress, isPremiumUser, theme]
  )

  const errorMessage =
    subjectsQuery.error instanceof Error
      ? subjectsQuery.error.message
      : subjectsQuery.error
        ? "Unable to load learning subjects from Appwrite."
        : null

  return (
    <SafeAreaView
      className="flex-1 bg-background"
      edges={["top", "left", "right"]}
    >
      {/* Search stays pinned rather than scrolling away inside the list
          header — in a library, the filter is the primary control. Its
          bottom padding is short because the first row's cell inset
          supplies the rest of the gap. */}
      <ContentFrame className="gap-3 pb-1.5 pt-3">
        <AppShellHeader
          compact
          eyebrow="Learn"
          title="Material library"
          subtitle="Pick a subject, open a topic, work through its materials."
        />
        <Input
          value={query}
          onChangeText={setQuery}
          placeholder="Search subjects"
          accessibilityLabel="Search subjects"
          returnKeyType="search"
          leading={<Search size={16} color={theme.mutedForeground} />}
        />
      </ContentFrame>

      <FlashList
        // FlashList cannot change `numColumns` on a mounted list; keying on
        // the count remounts it when a rotation or window resize crosses a
        // breakpoint.
        key={`subjects-${columns}`}
        numColumns={columns}
        data={subjectsQuery.isLoading || errorMessage ? [] : visibleSubjects}
        extraData={theme}
        keyExtractor={(item) => item.id}
        renderItem={renderSubject}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          subjectsQuery.isLoading ? (
            <View className="gap-3" style={{ padding: CELL_INSET }}>
              <SubjectSkeleton />
              <SubjectSkeleton />
              <SubjectSkeleton />
            </View>
          ) : errorMessage ? (
            <EmptyState
              tone="destructive"
              title="Library unavailable"
              description={errorMessage}
              style={{ margin: CELL_INSET }}
            />
          ) : query.trim() ? (
            <EmptyState
              title="No matching subjects"
              description={`Nothing in the library matches "${query.trim()}".`}
              style={{ margin: CELL_INSET }}
            />
          ) : (
            <EmptyState
              title="No subjects yet"
              description="Add subject records in Appwrite to populate the library."
              style={{ margin: CELL_INSET }}
            />
          )
        }
        ListFooterComponent={
          visibleSubjects.length > 0 ? (
            <Text variant="label" className="pt-3 text-center">
              {visibleSubjects.length} of {subjects.length} subjects
            </Text>
          ) : null
        }
        contentContainerStyle={{
          paddingHorizontal: paddingFor("standard") - CELL_INSET,
          paddingBottom: 32,
        }}
        showsVerticalScrollIndicator={false}
      />
    </SafeAreaView>
  )
}
