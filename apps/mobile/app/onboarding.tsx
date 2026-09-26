import { useRef, useState } from "react"
import { useLocalSearchParams, useRouter } from "expo-router"
import type { LucideIcon } from "lucide-react-native"
import BookOpenText from "lucide-react-native/icons/book-open-text"
import ListChecks from "lucide-react-native/icons/list-checks"
import TrendingUp from "lucide-react-native/icons/trending-up"
import {
  FlatList,
  Pressable,
  useWindowDimensions,
  View,
  type ViewToken,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

import { useAppPreferences } from "@/lib/app-preferences"
import { cn } from "@/lib/utils"
import { useLayout } from "@/hooks/use-layout"
import { useTheme } from "@/hooks/use-theme"
import { Badge } from "@/components/ui/badge"
import { BrandLogo } from "@/components/ui/brand-logo"
import { Button } from "@/components/ui/button"
import { ContentFrame } from "@/components/ui/content-frame"
import { Text } from "@/components/ui/text"

/** Illustration and copy stay a centred column on a tablet or desktop. */
const SLIDE_MAX_WIDTH = 480

type OnboardingSlide = {
  key: string
  icon: LucideIcon
  badge: string
  title: string
  description: string
}

const SLIDES: OnboardingSlide[] = [
  {
    key: "learn",
    icon: BookOpenText,
    badge: "Curated reviewers",
    title: "Study smarter, not longer",
    description:
      "Bite-sized lessons and curated reviewers built for the Social Work Licensure Exam, organized by topic so nothing falls through the cracks.",
  },
  {
    key: "drill",
    icon: ListChecks,
    badge: "Board-exam drills",
    title: "Drill like it's exam day",
    description:
      "Timed board-exam sets and practice quizzes with detailed explanations for every answer — so every mistake becomes a lesson.",
  },
  {
    key: "progress",
    icon: TrendingUp,
    badge: "Progress & community",
    title: "See your progress climb",
    description:
      "Track your scores, keep your study streak alive, and learn together with a community preparing for the same exam.",
  },
]

export default function OnboardingScreen() {
  const router = useRouter()
  /**
   * Replayed from Settings rather than shown before the first sign-in.
   *
   * The slides are the same; what changes is where the exits go. A first run
   * ends by handing somebody to register or login, because that is the next
   * thing they need. A replay ends by putting them back where they were — a
   * member three weeks in who taps "How this app works" and lands on a login
   * screen has been thrown out of their own app.
   */
  const { replay } = useLocalSearchParams<{ replay?: string }>()
  const isReplay = replay === "1"
  const { theme } = useTheme()
  const setPreference = useAppPreferences((state) => state.setPreference)
  const { width } = useWindowDimensions()
  const { height, gutter, isSmallPhone } = useLayout()
  const isShort = height < 600
  const listRef = useRef<FlatList<OnboardingSlide>>(null)
  const [index, setIndex] = useState(0)

  const isLastSlide = index === SLIDES.length - 1

  function finish(target: "/(auth)/register" | "/(auth)/login") {
    if (isReplay) {
      router.back()
      return
    }

    setPreference("hasCompletedOnboarding", true)
    router.replace(target)
  }

  function handleNext() {
    if (isLastSlide) {
      finish("/(auth)/register")
      return
    }
    listRef.current?.scrollToIndex({ index: index + 1, animated: true })
  }

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      const first = viewableItems[0]
      if (first?.index != null) {
        setIndex(first.index)
      }
    }
  ).current

  return (
    <SafeAreaView className="flex-1 bg-background">
      {/* Skip */}
      <ContentFrame width="reading">
        <View className="flex-row items-center justify-between pt-2">
          <View className="flex-row items-center gap-2">
            <BrandLogo size="sm" />
            <BrandLogo size="sm" variant="wordmark" />
          </View>
          <Pressable
            role="button"
            onPress={() => finish("/(auth)/login")}
            hitSlop={12}
            className="-mr-3 min-h-11 justify-center px-3 web:hover:opacity-80"
          >
            <Text className="text-sm font-bold text-muted-foreground">
              {isReplay ? "Done" : "Skip"}
            </Text>
          </Pressable>
        </View>
      </ContentFrame>

      {/* Slides - each page is the full window width so paging stays exact;
          only the column inside it is capped. */}
      <FlatList
        ref={listRef}
        data={SLIDES}
        keyExtractor={(item) => item.key}
        horizontal
        pagingEnabled
        bounces={false}
        showsHorizontalScrollIndicator={false}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={{ itemVisiblePercentThreshold: 60 }}
        getItemLayout={(_, itemIndex) => ({
          length: width,
          offset: width * itemIndex,
          index: itemIndex,
        })}
        renderItem={({ item }) => {
          const Icon = item.icon
          return (
            <View
              style={{ width, paddingHorizontal: gutter }}
              className="items-center justify-center"
            >
              <View
                className={cn(
                  "w-full items-center",
                  isShort ? "gap-5" : "gap-8"
                )}
                style={{ maxWidth: SLIDE_MAX_WIDTH }}
              >
                {/* A landscape phone has no height to spare for the art. */}
                <View
                  className={cn(
                    "items-center justify-center rounded-3xl bg-secondary",
                    isShort ? "h-24 w-24" : "h-40 w-40"
                  )}
                >
                  <View
                    className={cn(
                      "items-center justify-center rounded-2xl bg-primary",
                      isShort ? "h-14 w-14" : "h-24 w-24"
                    )}
                  >
                    <Icon
                      size={isShort ? 28 : 44}
                      color={theme.primaryForeground}
                      strokeWidth={2.25}
                    />
                  </View>
                </View>
                <View className="items-center gap-3">
                  <Badge tone="primary" className="self-center">
                    {item.badge}
                  </Badge>
                  <Text
                    role="heading"
                    className={cn(
                      "text-center font-extrabold text-foreground",
                      isSmallPhone || isShort ? "text-2xl" : "text-3xl"
                    )}
                  >
                    {item.title}
                  </Text>
                  <Text className="text-center text-sm leading-6 text-muted-foreground">
                    {item.description}
                  </Text>
                </View>
              </View>
            </View>
          )
        }}
      />

      {/* Controls */}
      <ContentFrame width="reading">
        <View className={cn("pb-6", isShort ? "gap-3" : "gap-5")}>
          <View className="flex-row items-center justify-center gap-2">
            {SLIDES.map((slide, dotIndex) => (
              <View
                key={slide.key}
                className={cn(
                  "h-2 rounded-full",
                  dotIndex === index ? "w-6 bg-primary" : "w-2 bg-border"
                )}
              />
            ))}
          </View>
          <Button size="lg" onPress={handleNext}>
            <Text>
              {isLastSlide ? (isReplay ? "Done" : "Get Started") : "Continue"}
            </Text>
          </Button>
          {isReplay ? null : (
            <Pressable
              role="button"
              onPress={() => finish("/(auth)/login")}
              className="min-h-11 items-center justify-center web:hover:opacity-80"
              hitSlop={8}
            >
              <Text className="text-sm text-muted-foreground">
                Already have an account?{" "}
                <Text className="text-sm font-bold text-primary">Sign in</Text>
              </Text>
            </Pressable>
          )}
        </View>
      </ContentFrame>
    </SafeAreaView>
  )
}
