import { useMemo, useState } from "react"
import { useAuth } from "@/contexts/auth-context"
import { useQuery } from "@tanstack/react-query"
import { useLocalSearchParams, useRouter } from "expo-router"
import CalendarX from "lucide-react-native/icons/calendar-x"
import Crown from "lucide-react-native/icons/crown"
import GraduationCap from "lucide-react-native/icons/graduation-cap"
import LibraryBig from "lucide-react-native/icons/library-big"
import Lightbulb from "lucide-react-native/icons/lightbulb"
import ListChecks from "lucide-react-native/icons/list-checks"
import ShieldCheck from "lucide-react-native/icons/shield-check"
import Smartphone from "lucide-react-native/icons/smartphone"
import { View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

import { openPlaySubscriptions } from "@/lib/billing/play-billing"
import { getMembership } from "@/lib/member/membership"
import {
  describeBillingPeriod,
  getSavingPercent,
  listSubscriptionPlans,
} from "@/lib/member/plans"
import { getStaggerDelay } from "@/lib/motion"
import { cn } from "@/lib/utils"
import { useContentPadding, useGridColumns } from "@/hooks/use-layout"
import { usePlayCheckout } from "@/hooks/use-play-checkout"
import { useThemePalette } from "@/hooks/use-theme"
import { BottomBar } from "@/components/ui/bottom-bar"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { FadeInView } from "@/components/ui/motion"
import { SectionHeader } from "@/components/ui/section-header"
import { Skeleton } from "@/components/ui/skeleton"
import { Text } from "@/components/ui/text"
import { ScrollView } from "@/components/ui/virtualized-scroll-view"
import { PlanCard, type PlanHighlight } from "@/components/member/plan-card"
import { PremiumHero } from "@/components/member/premium-hero"
import { ScreenHeader } from "@/components/screen-header"

function readFirstParam(value?: string | string[]) {
  if (Array.isArray(value)) {
    return value[0] ?? ""
  }

  return value ?? ""
}

function toSourceLabel(source: string) {
  if (source === "subject") {
    return "Subject"
  }

  if (source === "exam") {
    return "Exam"
  }

  if (source === "topic") {
    return "Topic"
  }

  if (source === "material") {
    return "Learning Material"
  }

  if (source === "quiz-category") {
    return "Quiz Category"
  }

  return "Premium Content"
}

/**
 * What premium unlocks. Every line is something the server actually gates —
 * the question bank and its answer keys through `exam-questions`, lessons
 * through `premium-material-access` — so none of it is a promise the app
 * cannot keep.
 */
const BENEFITS = [
  {
    Icon: ListChecks,
    title: "The full question bank",
    detail: "Every premium question, not just the free samples.",
  },
  {
    Icon: Lightbulb,
    title: "Answers and explanations",
    detail: "See why each answer is right while you review.",
  },
  {
    Icon: GraduationCap,
    title: "Every board exam category",
    detail: "Premium categories and sets, ready to practice.",
  },
  {
    Icon: LibraryBig,
    title: "Premium lessons and topic tracks",
    detail: "The complete learning library, unlocked.",
  },
] as const

const ASSURANCES = [
  { Icon: ShieldCheck, label: "Secure checkout through Google Play." },
  {
    Icon: CalendarX,
    label:
      "Cancel anytime in Google Play. You keep access until the paid period ends.",
  },
  {
    Icon: Smartphone,
    label: "Premium follows your account to every device you sign in on.",
  },
] as const

export default function PremiumSubscriptionScreen() {
  const router = useRouter()
  const profile = useAuth((state) => state.profile)
  const params = useLocalSearchParams<{
    title?: string | string[]
    source?: string | string[]
    categoryId?: string | string[]
    topicId?: string | string[]
  }>()
  const theme = useThemePalette()
  const contentPadding = useContentPadding("reading")
  // Plans compare better side by side once two fit at a readable width.
  const planColumns = useGridColumns(300, "reading", 2)
  // The paywall answer, date included — not the cached flag on its own, or a
  // membership that lapsed an hour ago still opens the content (section 6).
  const membership = useMemo(() => getMembership(profile), [profile])
  const isPremiumUser = membership.isPremium

  /**
   * Real plans, from `subscription_plans`.
   *
   * This screen used to hardcode ₱300 a month and a 20% annual discount, both
   * invented in the client. `subscription_plans` is `app_readonly` — every
   * signed-in member can read it — so the prices come from the CMS, and a
   * change in the dashboard reaches members without an app release.
   */
  const plansQuery = useQuery({
    queryKey: ["subscription-plans"],
    queryFn: listSubscriptionPlans,
    staleTime: 10 * 60 * 1000,
  })

  const plans = useMemo(() => plansQuery.data ?? [], [plansQuery.data])

  // Play's own offers for those plans: the price actually charged, and the
  // token that opens the checkout. A plan Play does not sell gets no offer.
  const checkout = usePlayCheckout(plans)

  const savings = useMemo(
    () =>
      new Map(plans.map((plan) => [plan.id, getSavingPercent(plan, plans)])),
    [plans]
  )

  // The biggest saving earns "Best value"; the CMS's own `isPopular` flag
  // outranks it, so one plan never carries two competing tags.
  const bestValueId = useMemo(() => {
    let bestId: string | null = null
    let bestSaving = 0

    for (const plan of plans) {
      const saving = savings.get(plan.id) ?? 0

      if (saving > bestSaving) {
        bestSaving = saving
        bestId = plan.id
      }
    }

    return bestId
  }, [plans, savings])

  const [chosenPlanId, setChosenPlanId] = useState<string | null>(null)

  // Until the member picks, preselect the plan the screen is recommending.
  const selectedPlan =
    plans.find((plan) => plan.id === chosenPlanId) ??
    plans.find((plan) => plan.isPopular) ??
    plans.find((plan) => plan.id === bestValueId) ??
    plans[0] ??
    null

  const selectedOffer = selectedPlan ? checkout.offerFor(selectedPlan.id) : null
  // Play's localized price once it answers; the CMS figure until then.
  const selectedPrice =
    selectedOffer?.formattedPrice ?? selectedPlan?.formattedPrice ?? ""

  const canCheckout =
    checkout.isSupported &&
    !checkout.isBusy &&
    checkout.status !== "pending" &&
    Boolean(selectedPlan && selectedOffer)

  // The button says what is happening, so a member never taps twice into a
  // checkout that is already open or a purchase that is being confirmed.
  const checkoutLabel = !checkout.isSupported
    ? checkout.unavailableReason === "build"
      ? "Update the app to subscribe"
      : "Available on Android"
    : checkout.status === "connecting"
      ? "Connecting to Google Play…"
      : checkout.status === "purchasing"
        ? "Finish checkout in Google Play"
        : checkout.status === "verifying"
          ? "Activating Premium…"
          : checkout.status === "pending"
            ? "Payment pending"
            : !selectedOffer
              ? "Not available yet"
              : `Subscribe · ${selectedPrice}`

  function highlightFor(
    planId: string,
    isPopular: boolean
  ): PlanHighlight | null {
    if (isPopular) {
      return "popular"
    }

    return planId === bestValueId ? "best-value" : null
  }

  const lockedTitle = readFirstParam(params.title)
  const source = readFirstParam(params.source)
  const sourceLabel = toSourceLabel(source)
  const categoryId = readFirstParam(params.categoryId)
  const topicId = readFirstParam(params.topicId)

  function handleBackToContext() {
    if (topicId) {
      router.push({ pathname: "/learn/topic/[topicId]", params: { topicId } })
      return
    }

    if (categoryId && (source === "exam" || source === "quiz-category")) {
      router.push({ pathname: "/board-exams" })
      return
    }

    if (categoryId) {
      router.push({
        pathname: "/review/[categoryId]",
        params: { categoryId },
      })
      return
    }

    router.back()
  }

  return (
    // The bottom bar paints its own inset, so the screen must not claim it too.
    <SafeAreaView
      edges={["top", "left", "right"]}
      className="flex-1 bg-background"
    >
      <ScreenHeader title="Premium" width="reading" />

      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerClassName="gap-5"
        contentContainerStyle={{
          ...contentPadding,
          paddingTop: 4,
          paddingBottom: 24,
        }}
      >
        <FadeInView>
          <PremiumHero
            membership={membership}
            lockedTitle={lockedTitle}
            sourceLabel={sourceLabel}
          />
        </FadeInView>

        <FadeInView delay={getStaggerDelay(1)}>
          <View className="gap-3">
            <SectionHeader
              eyebrow="What's included"
              title={
                isPremiumUser
                  ? "Your membership includes"
                  : "Everything in Premium"
              }
            />

            <Card>
              <CardContent className="py-1">
                {BENEFITS.map(({ Icon, title, detail }, index) => (
                  <View
                    key={title}
                    className={cn(
                      "flex-row items-center gap-3 py-3",
                      index > 0 && "border-t border-border/60"
                    )}
                  >
                    <View className="h-10 w-10 items-center justify-center rounded-sm bg-primary/10">
                      <Icon size={18} color={theme.primary} strokeWidth={2.2} />
                    </View>

                    <View className="min-w-0 flex-1 gap-0.5">
                      <Text className="text-sm font-bold text-card-foreground">
                        {title}
                      </Text>
                      <Text variant="caption">{detail}</Text>
                    </View>
                  </View>
                ))}
              </CardContent>
            </Card>
          </View>
        </FadeInView>

        {!isPremiumUser ? (
          <FadeInView delay={getStaggerDelay(2)}>
            <View className="gap-3">
              <SectionHeader
                eyebrow="Plans"
                title="Choose your plan"
                subtitle="Google Play confirms the final price and currency at checkout."
              />

              {plansQuery.isLoading ? (
                <View className="gap-3">
                  <Skeleton className="h-28 rounded-xl" />
                  <Skeleton className="h-28 rounded-xl" />
                  <Skeleton className="h-28 rounded-xl" />
                </View>
              ) : plans.length === 0 ? (
                <EmptyState
                  tone={plansQuery.isError ? "destructive" : undefined}
                  title="Plans unavailable"
                  description="We could not load the membership options right now. Please try again shortly."
                  action={
                    plansQuery.isError ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onPress={() => void plansQuery.refetch()}
                      >
                        <Text>Try again</Text>
                      </Button>
                    ) : undefined
                  }
                />
              ) : (
                <View
                  role="radiogroup"
                  aria-label="Membership plans"
                  className={
                    planColumns > 1 ? "flex-row flex-wrap gap-3" : "gap-3"
                  }
                >
                  {plans.map((plan) => (
                    <View
                      key={plan.id}
                      style={
                        planColumns > 1
                          ? { flexBasis: "45%", flexGrow: 1 }
                          : undefined
                      }
                    >
                      <PlanCard
                        plan={plan}
                        playPrice={checkout.offerFor(plan.id)?.formattedPrice}
                        savingPercent={savings.get(plan.id)}
                        highlight={highlightFor(plan.id, plan.isPopular)}
                        selected={plan.id === selectedPlan?.id}
                        onSelect={setChosenPlanId}
                      />
                    </View>
                  ))}
                </View>
              )}
            </View>
          </FadeInView>
        ) : null}

        {!isPremiumUser ? (
          <FadeInView delay={getStaggerDelay(3)}>
            <View className="gap-3 px-1">
              {ASSURANCES.map(({ Icon, label }) => (
                <View key={label} className="flex-row items-start gap-3">
                  <Icon
                    size={16}
                    color={theme.mutedForeground}
                    strokeWidth={2.2}
                    style={{ marginTop: 1 }}
                  />
                  <Text variant="caption" className="flex-1">
                    {label}
                  </Text>
                </View>
              ))}
            </View>
          </FadeInView>
        ) : null}
      </ScrollView>

      <BottomBar width="reading" contentClassName="gap-2">
        {isPremiumUser ? (
          <View className="flex-row gap-3">
            {checkout.isSupported ? (
              <Button
                size="lg"
                variant="outline"
                className="flex-1"
                onPress={() => void openPlaySubscriptions()}
              >
                <Text>Manage in Google Play</Text>
              </Button>
            ) : null}
            <Button size="lg" className="flex-1" onPress={handleBackToContext}>
              <Text>Continue to content</Text>
            </Button>
          </View>
        ) : (
          <>
            {selectedPlan ? (
              <View className="flex-row items-baseline justify-between gap-3">
                <Text variant="callout" className="text-muted-foreground">
                  {selectedPlan.name}
                </Text>
                <Text className="text-sm font-bold text-foreground">
                  {selectedPrice}{" "}
                  <Text variant="caption">
                    {describeBillingPeriod(selectedPlan)}
                  </Text>
                </Text>
              </View>
            ) : null}

            <Button
              size="lg"
              disabled={!canCheckout}
              onPress={() =>
                selectedPlan ? void checkout.purchase(selectedPlan) : undefined
              }
            >
              <Crown
                size={16}
                color={theme.primaryForeground}
                strokeWidth={2.2}
              />
              <Text>{checkoutLabel}</Text>
            </Button>

            <View className="flex-row items-center justify-between gap-3">
              <Text
                variant="caption"
                className={cn(
                  "flex-1",
                  checkout.notice?.tone === "error" && "text-destructive"
                )}
                accessibilityLiveRegion="polite"
              >
                {checkout.notice?.text ??
                  (checkout.isSupported
                    ? "Billed through Google Play. Cancel anytime."
                    : checkout.unavailableReason === "build"
                      ? "This version of the app can't take payments yet. Install the latest version to subscribe."
                      : "Memberships are sold through Google Play on Android.")}
              </Text>

              {checkout.isSupported ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={checkout.isBusy}
                  onPress={() => void checkout.restore()}
                >
                  <Text>Restore purchase</Text>
                </Button>
              ) : null}
            </View>
          </>
        )}
      </BottomBar>
    </SafeAreaView>
  )
}
