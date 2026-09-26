import { useCallback, useEffect, useState, type ComponentProps } from "react"
import * as Haptics from "expo-haptics"
import { Tabs, useRouter } from "expo-router"
import type { LucideIcon } from "lucide-react-native"
import Bell from "lucide-react-native/icons/bell"
import BookOpenText from "lucide-react-native/icons/book-open-text"
import House from "lucide-react-native/icons/house"
import MessagesSquare from "lucide-react-native/icons/messages-square"
import Pencil from "lucide-react-native/icons/pencil"
import Settings from "lucide-react-native/icons/settings"
import User from "lucide-react-native/icons/user"
import { Keyboard, Pressable, ScrollView, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { useAppPreferences } from "@/lib/app-preferences"
import { NAV_RAIL_WIDTH, NAV_SIDEBAR_WIDTH } from "@/lib/layout"
import { withOpacity } from "@/lib/theme"
import { cn } from "@/lib/utils"
import { useSideNavWidth } from "@/hooks/use-layout"
import { useTheme } from "@/hooks/use-theme"
import { BrandLogo } from "@/components/ui/brand-logo"
import { Text } from "@/components/ui/text"

/**
 * ─── App navigation ───────────────────────────────────────────────────────
 *
 * One navigator, three presentations, chosen by window width:
 *
 *   < 1024   docked bottom bar     phones and portrait tablets
 *   ≥ 1024   icon rail on the left landscape tablets, small desktops
 *   ≥ 1280   labelled sidebar      desktop browsers
 *
 * A bottom bar on a 1400px browser puts five targets a hand's width apart
 * along the bottom edge, where no desktop user looks for navigation; a rail on
 * a phone takes a quarter of the screen. So the tab layout moves the bar to
 * the left (`tabBarPosition`) and this component draws whichever form fits.
 *
 * Study is a *verb*, not a destination: it starts a session instead of
 * switching section, so it is a button in every form, never a fifth tab.
 *
 * The old bar floated with a button overhanging its top edge. On Android the
 * overhanging part was drawn but could not be tapped, because touches outside
 * a parent's bounds are not delivered there. Everything now sits inside the
 * bar's own box.
 */

type TabMeta = {
  Icon: LucideIcon
  label: string
  /** Only shown where there is room: the rail and sidebar, not the bottom bar. */
  sideOnly?: boolean
}

/**
 * Keyed by expo-router route name. Updates has no slot in the bottom bar (the
 * Home bell reaches it) but the side navigation has room for it.
 */
const TAB_META: Record<string, TabMeta> = {
  index: { Icon: House, label: "Home" },
  learn: { Icon: BookOpenText, label: "Learn" },
  community: { Icon: MessagesSquare, label: "Forum" },
  news: { Icon: Bell, label: "Updates", sideOnly: true },
  profile: { Icon: User, label: "Profile" },
}

/**
 * The props expo-router hands a custom `tabBar`, inferred from the component
 * that calls it.
 *
 * Not imported from `@react-navigation/bottom-tabs`: expo-router 57 vendors its
 * own copy of that package, so the two `BottomTabBarProps` are structurally
 * incompatible and the assignment fails to typecheck. Inferring from `Tabs`
 * always matches whichever copy the installed router actually uses.
 */
type TabBarRenderer = NonNullable<ComponentProps<typeof Tabs>["tabBar"]>
type TabBarProps = Parameters<TabBarRenderer>[0]

type StudyTabBarProps = TabBarProps & {
  /** Fired by the Study button. */
  onPressStudy: () => void
}

type NavEntry = {
  key: string
  name: string
  meta: TabMeta
  isFocused: boolean
}

/**
 * Android resizes the window for the keyboard, which lifts the bar and parks
 * it on top of the keyboard, covering the field being typed into. iOS draws
 * the keyboard over the bar, so only Android needs the bar out of the way.
 */
function useAndroidKeyboardVisible() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (process.env.EXPO_OS !== "android") {
      return
    }

    const show = Keyboard.addListener("keyboardDidShow", () => setVisible(true))
    const hide = Keyboard.addListener("keyboardDidHide", () =>
      setVisible(false)
    )

    return () => {
      show.remove()
      hide.remove()
    }
  }, [])

  return visible
}

function useNavigationEntries({ state, navigation }: TabBarProps) {
  const hapticsEnabled = useAppPreferences(
    (preferences) => preferences.preferences.hapticsEnabled
  )

  const tapFeedback = useCallback(() => {
    if (hapticsEnabled && process.env.EXPO_OS === "ios") {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    }
  }, [hapticsEnabled])

  const focusedKey = state.routes[state.index]?.key

  const entries: NavEntry[] = state.routes
    .filter((route) => TAB_META[route.name])
    .map((route) => ({
      key: route.key,
      name: route.name,
      meta: TAB_META[route.name],
      isFocused: route.key === focusedKey,
    }))

  const press = useCallback(
    (entry: NavEntry) => {
      tapFeedback()

      const event = navigation.emit({
        type: "tabPress",
        target: entry.key,
        canPreventDefault: true,
      })

      if (!entry.isFocused && !event.defaultPrevented) {
        navigation.navigate(entry.name)
      }
    },
    [navigation, tapFeedback]
  )

  const longPress = useCallback(
    (entry: NavEntry) =>
      navigation.emit({ type: "tabLongPress", target: entry.key }),
    [navigation]
  )

  return { entries, press, longPress, tapFeedback }
}

export function StudyTabBar(props: StudyTabBarProps) {
  const sideNavWidth = useSideNavWidth()
  const keyboardVisible = useAndroidKeyboardVisible()

  if (sideNavWidth >= NAV_SIDEBAR_WIDTH) {
    return <SideNavigation {...props} variant="sidebar" />
  }

  if (sideNavWidth >= NAV_RAIL_WIDTH) {
    return <SideNavigation {...props} variant="rail" />
  }

  if (keyboardVisible) {
    return null
  }

  return <BottomNavigation {...props} />
}

// ─── Bottom bar ─────────────────────────────────────────────────────────────

function BottomNavigation(props: StudyTabBarProps) {
  const { theme, isDark } = useTheme()
  const insets = useSafeAreaInsets()
  const { entries, press, longPress, tapFeedback } = useNavigationEntries(props)
  const { onPressStudy } = props

  const bottomEntries = entries.filter((entry) => !entry.meta.sideOnly)
  const splitAt = Math.ceil(bottomEntries.length / 2)
  const indicator = withOpacity(theme.primary, isDark ? 0.2 : 0.12)

  const renderTab = (entry: NavEntry) => {
    const { Icon, label } = entry.meta
    const color = entry.isFocused ? theme.primary : theme.mutedForeground

    return (
      <Pressable
        key={entry.key}
        role="tab"
        accessibilityState={{ selected: entry.isFocused }}
        accessibilityLabel={label}
        onPress={() => press(entry)}
        onLongPress={() => longPress(entry)}
        className="flex-1 items-center justify-center gap-1 active:opacity-70"
      >
        {/* The pill behind the icon carries the selected state, so it is
            never signalled by colour alone. */}
        <View
          className="h-8 w-14 items-center justify-center rounded-full"
          style={{
            backgroundColor: entry.isFocused ? indicator : "transparent",
          }}
        >
          <Icon
            size={22}
            color={color}
            strokeWidth={entry.isFocused ? 2.5 : 2}
          />
        </View>
        <Text
          numberOfLines={1}
          maxFontSizeMultiplier={1.3}
          className={cn(
            "text-2xs",
            entry.isFocused ? "font-bold" : "font-medium"
          )}
          style={{ color }}
        >
          {label}
        </Text>
      </Pressable>
    )
  }

  return (
    <View
      role="tablist"
      className="border-t border-border/70 bg-card"
      style={{
        // The system gesture bar or button bar sits under this padding. A
        // floor keeps the labels off the screen edge on devices with none.
        paddingBottom: Math.max(insets.bottom, 6),
        paddingLeft: insets.left,
        paddingRight: insets.right,
      }}
    >
      {/* Capped so a portrait tablet does not spread five targets across
          800pt; the bar itself still paints edge to edge. */}
      <View className="h-16 w-full max-w-[640px] flex-row items-stretch self-center">
        {bottomEntries.slice(0, splitAt).map(renderTab)}

        <View className="flex-1 items-center justify-center gap-1">
          <Pressable
            role="button"
            accessibilityLabel="Start studying"
            accessibilityHint="Choose a quiz or board exam to start"
            onPress={() => {
              tapFeedback()
              onPressStudy()
            }}
            className="h-10 w-14 items-center justify-center rounded-2xl bg-primary active:opacity-85"
            style={{
              shadowColor: theme.primary,
              shadowOpacity: isDark ? 0.5 : 0.35,
              shadowRadius: 10,
              shadowOffset: { width: 0, height: 4 },
              elevation: 6,
            }}
          >
            <Pencil
              size={20}
              color={theme.primaryForeground}
              strokeWidth={2.5}
            />
          </Pressable>
          <Text
            numberOfLines={1}
            maxFontSizeMultiplier={1.3}
            className="text-2xs font-bold text-primary"
          >
            Study
          </Text>
        </View>

        {bottomEntries.slice(splitAt).map(renderTab)}
      </View>
    </View>
  )
}

// ─── Rail and sidebar ───────────────────────────────────────────────────────

function SideNavigation({
  variant,
  ...props
}: StudyTabBarProps & { variant: "rail" | "sidebar" }) {
  const router = useRouter()
  const { theme, isDark } = useTheme()
  const insets = useSafeAreaInsets()
  const { entries, press, longPress, tapFeedback } = useNavigationEntries(props)
  const { onPressStudy } = props

  const isSidebar = variant === "sidebar"
  const indicator = withOpacity(theme.primary, isDark ? 0.2 : 0.12)

  const startStudy = () => {
    tapFeedback()
    onPressStudy()
  }

  return (
    <View
      role="tablist"
      className="border-r border-border/70 bg-card"
      style={{
        width: (isSidebar ? NAV_SIDEBAR_WIDTH : NAV_RAIL_WIDTH) + insets.left,
        paddingLeft: insets.left,
        paddingTop: insets.top + 16,
        paddingBottom: Math.max(insets.bottom, 16),
      }}
    >
      <ScrollView
        contentContainerClassName={cn(
          "flex-grow gap-6",
          isSidebar ? "px-4" : "items-center px-2"
        )}
        showsVerticalScrollIndicator={false}
      >
        <View className={cn(isSidebar ? "px-2" : "items-center")}>
          <BrandLogo
            variant={isSidebar ? "wordmark" : "mark"}
            size={isSidebar ? "md" : "sm"}
            accessibilityLabel="Social Work Sure Win"
          />
        </View>

        {isSidebar ? (
          <Pressable
            role="button"
            accessibilityLabel="Start studying"
            onPress={startStudy}
            className="h-12 flex-row items-center justify-center gap-2 rounded-2xl bg-primary active:opacity-85 web:hover:opacity-90"
          >
            <Pencil
              size={18}
              color={theme.primaryForeground}
              strokeWidth={2.5}
            />
            <Text className="font-bold text-primary-foreground">
              Start studying
            </Text>
          </Pressable>
        ) : (
          <View className="items-center gap-1">
            <Pressable
              role="button"
              accessibilityLabel="Start studying"
              onPress={startStudy}
              className="h-14 w-14 items-center justify-center rounded-2xl bg-primary active:opacity-85 web:hover:opacity-90"
            >
              <Pencil
                size={22}
                color={theme.primaryForeground}
                strokeWidth={2.5}
              />
            </Pressable>
            <Text className="text-2xs font-bold text-primary">Study</Text>
          </View>
        )}

        <View className={cn("gap-1", !isSidebar && "items-center gap-3")}>
          {entries.map((entry) => {
            const { Icon, label } = entry.meta
            const color = entry.isFocused
              ? theme.primary
              : theme.mutedForeground

            if (isSidebar) {
              return (
                <Pressable
                  key={entry.key}
                  role="tab"
                  accessibilityState={{ selected: entry.isFocused }}
                  accessibilityLabel={label}
                  onPress={() => press(entry)}
                  onLongPress={() => longPress(entry)}
                  className={cn(
                    "h-11 flex-row items-center gap-3 rounded-xl px-3",
                    !entry.isFocused && "web:hover:bg-muted"
                  )}
                  style={{
                    backgroundColor: entry.isFocused ? indicator : undefined,
                  }}
                >
                  <Icon
                    size={20}
                    color={color}
                    strokeWidth={entry.isFocused ? 2.5 : 2}
                  />
                  <Text
                    className={cn(
                      "text-sm",
                      entry.isFocused ? "font-bold" : "font-medium"
                    )}
                    style={{
                      color: entry.isFocused ? theme.primary : theme.foreground,
                    }}
                  >
                    {label}
                  </Text>
                </Pressable>
              )
            }

            return (
              <Pressable
                key={entry.key}
                role="tab"
                accessibilityState={{ selected: entry.isFocused }}
                accessibilityLabel={label}
                onPress={() => press(entry)}
                onLongPress={() => longPress(entry)}
                className="w-full items-center gap-1 py-1"
              >
                <View
                  className={cn(
                    "h-8 w-14 items-center justify-center rounded-full",
                    !entry.isFocused && "web:hover:bg-muted"
                  )}
                  style={{
                    backgroundColor: entry.isFocused ? indicator : undefined,
                  }}
                >
                  <Icon
                    size={22}
                    color={color}
                    strokeWidth={entry.isFocused ? 2.5 : 2}
                  />
                </View>
                <Text
                  numberOfLines={1}
                  className={cn(
                    "text-2xs",
                    entry.isFocused ? "font-bold" : "font-medium"
                  )}
                  style={{ color }}
                >
                  {label}
                </Text>
              </Pressable>
            )
          })}
        </View>

        {/* Pushes Settings to the foot of the column. */}
        <View className="flex-1" />

        <Pressable
          role="button"
          accessibilityLabel="Settings"
          onPress={() => router.push("/settings")}
          className={cn(
            "rounded-xl web:hover:bg-muted",
            isSidebar
              ? "h-11 flex-row items-center gap-3 px-3"
              : "w-full items-center gap-1 py-2"
          )}
        >
          <Settings size={isSidebar ? 20 : 22} color={theme.mutedForeground} />
          <Text
            className={cn(
              "font-medium",
              isSidebar ? "text-sm text-foreground" : "text-2xs"
            )}
            style={isSidebar ? undefined : { color: theme.mutedForeground }}
          >
            Settings
          </Text>
        </Pressable>
      </ScrollView>
    </View>
  )
}
