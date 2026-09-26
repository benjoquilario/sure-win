import { memo, useCallback, useState } from "react"
import { useAuth } from "@/contexts/auth-context"
import { useQuery } from "@tanstack/react-query"
import { useRouter } from "expo-router"
import { View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

import { getStaggerDelay } from "@/lib/motion"
import {
  getDashboardInsights,
  getDashboardReportMetrics,
  getOverallPerformanceStats,
  getQuestionsAnsweredTimeline,
  type TimelineWindow,
} from "@/lib/performance-stats"
import { useContentPadding, useGridColumns } from "@/hooks/use-layout"
import { useTheme } from "@/hooks/use-theme"
import { EmptyState } from "@/components/ui/empty-state"
import { FadeInView } from "@/components/ui/motion"
import { Skeleton } from "@/components/ui/skeleton"
import { ScrollView } from "@/components/ui/virtualized-scroll-view"
import { ActivityMetricsSection } from "@/components/dashboard/activity-metrics"
import { OverallPerformanceSection } from "@/components/dashboard/overall-performance"
import { ProgressInsightsSection } from "@/components/dashboard/progress-insights"
import { ScreenHeader } from "@/components/screen-header"

/** Narrowest a dashboard column may get before the sections stack. */
const SECTION_MIN_WIDTH = 340

const DashboardUnauthenticatedState = memo(
  function DashboardUnauthenticatedState() {
    return (
      <FadeInView delay={getStaggerDelay(0)}>
        <EmptyState
          title="Sign in to view performance"
          description="Your quiz performance and progress data appear after login."
        />
      </FadeInView>
    )
  }
)

const DashboardLoadingState = memo(function DashboardLoadingState({
  isTwoUp,
}: {
  isTwoUp: boolean
}) {
  return (
    <View className="gap-3">
      <Skeleton className="h-56 rounded-xl" />
      <View className="flex-row gap-3">
        <Skeleton className="h-24 flex-1 rounded-xl" />
        <Skeleton className="h-24 flex-1 rounded-xl" />
      </View>
      <View className={isTwoUp ? "flex-row gap-3" : "gap-3"}>
        <Skeleton
          className={isTwoUp ? "h-64 flex-1 rounded-xl" : "h-64 rounded-xl"}
        />
        {isTwoUp ? <Skeleton className="h-64 flex-1 rounded-xl" /> : null}
      </View>
    </View>
  )
})

export default function DashboardScreen() {
  const router = useRouter()
  const user = useAuth((state) => state.user)
  const { theme } = useTheme()
  const contentPadding = useContentPadding("standard")
  // Performance and insights sit side by side once both columns stay readable.
  const isTwoUp = useGridColumns(SECTION_MIN_WIDTH, "standard", 2) > 1

  const [window, setWindow] = useState<TimelineWindow>("week")
  const [offset, setOffset] = useState(0)
  const [selectedBarIndex, setSelectedBarIndex] = useState<number | null>(null)

  const handleWindowChange = useCallback((w: TimelineWindow) => {
    setWindow(w)
    setOffset(0)
    setSelectedBarIndex(null)
  }, [])

  const handlePrev = useCallback(() => {
    setOffset((prev) => prev - 1)
    setSelectedBarIndex(null)
  }, [])

  const handleNext = useCallback(() => {
    setOffset((prev) => Math.min(prev + 1, 0))
    setSelectedBarIndex(null)
  }, [])

  const handleToday = useCallback(() => {
    setOffset(0)
    setSelectedBarIndex(null)
  }, [])

  // Queries
  const timelineQuery = useQuery({
    queryKey: ["dashboard-timeline", user?.$id, window, offset],
    enabled: Boolean(user?.$id),
    queryFn: () =>
      getQuestionsAnsweredTimeline(user?.$id ?? "", window, offset),
    staleTime: 1000 * 15,
  })

  const performanceQuery = useQuery({
    queryKey: ["dashboard-overall-performance", user?.$id],
    enabled: Boolean(user?.$id),
    queryFn: () => getOverallPerformanceStats(user?.$id ?? ""),
    staleTime: 1000 * 15,
  })

  const reportMetricsQuery = useQuery({
    queryKey: ["dashboard-report-metrics", user?.$id],
    enabled: Boolean(user?.$id),
    queryFn: () => getDashboardReportMetrics(user?.$id ?? ""),
    staleTime: 1000 * 15,
  })

  const insightsQuery = useQuery({
    queryKey: ["dashboard-insights", user?.$id],
    enabled: Boolean(user?.$id),
    queryFn: () => getDashboardInsights(user?.$id ?? ""),
    staleTime: 1000 * 15,
  })

  const timeline = timelineQuery.data ?? null
  const performanceStats = performanceQuery.data ?? null
  const reportMetrics = reportMetricsQuery.data ?? null
  const insights = insightsQuery.data ?? null

  const isLoadingContent =
    timelineQuery.isLoading ||
    performanceQuery.isLoading ||
    reportMetricsQuery.isLoading ||
    insightsQuery.isLoading

  const sectionStyle = isTwoUp ? { flex: 1 } : undefined

  return (
    <SafeAreaView className="flex-1 bg-background">
      <ScreenHeader
        title="Performance Dashboard"
        width="standard"
        onBack={() => {
          if (router.canGoBack()) {
            router.back()
            return
          }
          router.replace("/(tabs)")
        }}
      />

      <ScrollView
        contentContainerClassName="gap-6"
        contentContainerStyle={{
          ...contentPadding,
          paddingTop: 4,
          paddingBottom: 40,
        }}
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
      >
        {!user ? (
          <DashboardUnauthenticatedState />
        ) : isLoadingContent ? (
          <DashboardLoadingState isTwoUp={isTwoUp} />
        ) : (
          <>
            <FadeInView delay={getStaggerDelay(0)}>
              <ActivityMetricsSection
                timeline={timeline}
                reportMetrics={reportMetrics}
                isLoading={timelineQuery.isLoading}
                window={window}
                onWindowChange={handleWindowChange}
                selectedBarIndex={selectedBarIndex}
                onSelectBar={setSelectedBarIndex}
                onPrev={handlePrev}
                onNext={handleNext}
                onToday={handleToday}
                theme={theme}
                isWide={isTwoUp}
              />
            </FadeInView>

            <View className={isTwoUp ? "flex-row items-start gap-5" : "gap-6"}>
              <FadeInView delay={getStaggerDelay(1)} style={sectionStyle}>
                {performanceQuery.isLoading ? (
                  <View className="gap-3">
                    <Skeleton className="h-40 rounded-xl" />
                    <Skeleton className="h-32 rounded-xl" />
                  </View>
                ) : performanceStats ? (
                  <OverallPerformanceSection
                    stats={performanceStats}
                    theme={theme}
                  />
                ) : null}
              </FadeInView>

              <FadeInView delay={getStaggerDelay(2)} style={sectionStyle}>
                {insightsQuery.isLoading ? (
                  <View className="gap-3">
                    <Skeleton className="h-32 rounded-xl" />
                    <Skeleton className="h-40 rounded-xl" />
                  </View>
                ) : insights ? (
                  <ProgressInsightsSection insights={insights} theme={theme} />
                ) : null}
              </FadeInView>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}
