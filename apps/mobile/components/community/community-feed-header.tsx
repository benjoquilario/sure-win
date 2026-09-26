import Plus from "lucide-react-native/icons/plus"
import { Pressable, View } from "react-native"

import { THEME } from "@/lib/theme"
import { cn } from "@/lib/utils"
import { useLayout } from "@/hooks/use-layout"
import { IconButton } from "@/components/ui/icon-button"
import { StatTile } from "@/components/ui/stat-tile"
import { Text } from "@/components/ui/text"
import { ScrollView } from "@/components/ui/virtualized-scroll-view"
import { AppShellHeader } from "@/components/app-shell-header"
import { CommunityAvatar } from "@/components/community/avatar"

type ThemePalette = (typeof THEME)["light"] | (typeof THEME)["dark"]

type CommunityFeedHeaderProps = {
  activeFeedFilter: string
  featuredSubjects: { id: string; name: string }[]
  filters: readonly string[]
  onChangeFeedFilter: (filter: string) => void
  onOpenComposer: () => void
  onRefresh: () => void
  totalPosts: number
  stats?: {
    activeLearners: number
    openTopics: number
    answeredToday: number
  }
  theme: ThemePalette
  currentUserAvatarLabel?: string
  currentUserAvatarUrl?: string | null
}

/**
 * Everything above the first thread: title, composer prompt, the three
 * community numbers and the category filter.
 *
 * Rendered as the feed's list header, so it inherits the list's reading-width
 * padding and lines up with the cards below it.
 */
export function CommunityFeedHeader({
  activeFeedFilter,
  filters,
  onChangeFeedFilter,
  onOpenComposer,
  totalPosts,
  stats,
  theme,
  currentUserAvatarLabel,
  currentUserAvatarUrl,
}: CommunityFeedHeaderProps) {
  const { isSmallPhone, paddingFor } = useLayout()
  // The list's own padding, so the filter row can scroll edge to edge while
  // its first pill starts on the content edge.
  const bleed = paddingFor("reading")
  // Three tiles share 296pt on a 320pt phone; the default inset leaves
  // "Answered" no room.
  const tileClass = cn("min-w-0 flex-1", isSmallPhone && "px-2.5")

  return (
    <View className="gap-4 pb-3">
      <AppShellHeader compact eyebrow="Forum" title="Community" />

      {/* Composer prompt */}
      <View className="flex-row items-center gap-3 rounded-xl border border-border/80 bg-card px-3.5 py-3">
        <CommunityAvatar
          label={currentUserAvatarLabel ?? "RV"}
          sourceUri={currentUserAvatarUrl}
          theme={theme}
          size="md"
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Start a thread"
          className="min-h-11 min-w-0 flex-1 justify-center rounded-md px-1 web:hover:bg-muted/60"
          onPress={onOpenComposer}
        >
          <Text className="text-sm text-muted-foreground" numberOfLines={1}>
            What&apos;s on your mind?
          </Text>
        </Pressable>
        <IconButton
          label="Create a post"
          variant="default"
          className="rounded-full"
          onPress={onOpenComposer}
        >
          <Plus size={18} color={theme.primaryForeground} />
        </IconButton>
      </View>

      {/* Community numbers */}
      <View className="flex-row gap-2">
        <StatTile
          className={tileClass}
          label="Threads"
          value={String(totalPosts)}
          tone="primary"
        />
        <StatTile
          className={tileClass}
          label="Active"
          value={String(stats?.activeLearners ?? 0)}
          tone="primary"
        />
        <StatTile
          className={tileClass}
          label="Answered"
          value={String(stats?.answeredToday ?? 0)}
          tone="primary"
        />
      </View>

      {/* Filter pills */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ marginHorizontal: -bleed }}
        contentContainerClassName="gap-2"
        contentContainerStyle={{ paddingHorizontal: bleed }}
      >
        {filters.map((filter) => {
          const isActive = activeFeedFilter === filter
          return (
            <Pressable
              key={filter}
              accessibilityRole="button"
              accessibilityState={{ selected: isActive }}
              hitSlop={6}
              onPress={() => onChangeFeedFilter(filter)}
              className={cn(
                "rounded-full px-4 py-2",
                isActive
                  ? "bg-primary"
                  : "bg-muted/80 active:bg-muted web:hover:bg-muted"
              )}
            >
              <Text
                className={cn(
                  "text-xs font-bold capitalize",
                  isActive ? "text-primary-foreground" : "text-muted-foreground"
                )}
              >
                {filter}
              </Text>
            </Pressable>
          )
        })}
      </ScrollView>
    </View>
  )
}
