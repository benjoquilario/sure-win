import { memo, useState } from "react"
import { Image } from "expo-image"
import MoreHorizontal from "lucide-react-native/icons/ellipsis"
import Heart from "lucide-react-native/icons/heart"
import MessageSquare from "lucide-react-native/icons/message-square"
import { Pressable, View } from "react-native"

import { type CommunityPostItem } from "@/lib/community"
import { getCommunityCategoryColor, THEME, withOpacity } from "@/lib/theme"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { Text } from "@/components/ui/text"
import { CommunityAvatar } from "@/components/community/avatar"

type ThemePalette = (typeof THEME)["light"] | (typeof THEME)["dark"]

const ACTION_CLASS =
  "min-h-11 flex-1 flex-row items-center justify-center gap-2 rounded-md active:bg-muted/60 web:hover:bg-muted/60"

type CommunityThreadCardProps = {
  post: CommunityPostItem
  liking: boolean
  onLike: (post: CommunityPostItem) => void
  onOpen: (postId: string) => void
  /** Opens the actions sheet — report, block, or delete when it is theirs. */
  onOpenActions: (post: CommunityPostItem) => void
  theme: ThemePalette
}

export const CommunityThreadCard = memo(function CommunityThreadCard({
  post,
  liking,
  onLike,
  onOpen,
  onOpenActions,
  theme,
}: CommunityThreadCardProps) {
  const [imageFailed, setImageFailed] = useState(false)
  const hasPhoto = Boolean(post.photoUrl) && !imageFailed
  const categoryColor = getCommunityCategoryColor(theme, post.category)

  return (
    <Card>
      {/* Author header */}
      <Pressable
        // No label: the thread's own text is what a screen reader should read.
        accessibilityRole="button"
        accessibilityHint="Opens the thread"
        className="gap-3 px-4 pt-3.5"
        onPress={() => onOpen(post.id)}
      >
        <View className="flex-row items-center gap-2.5">
          <CommunityAvatar
            label={post.author.avatarSeed}
            sourceUri={post.author.avatarUrl}
            theme={theme}
            size="lg"
          />
          <View className="min-w-0 flex-1">
            <View className="flex-row items-center gap-2">
              <Text
                className="shrink text-sm font-bold text-card-foreground"
                numberOfLines={1}
              >
                {post.author.name}
              </Text>
              <View
                className="shrink-0 rounded-full px-2 py-0.5"
                style={{ backgroundColor: withOpacity(categoryColor, 0.12) }}
              >
                <Text
                  className="text-2xs font-bold uppercase tracking-[1px]"
                  style={{ color: categoryColor }}
                >
                  {post.category}
                </Text>
              </View>
            </View>
            <View className="flex-row items-center gap-1.5">
              <Text
                className="shrink text-xs text-muted-foreground"
                numberOfLines={1}
              >
                {post.author.subtitle}
              </Text>
              <View className="h-0.5 w-0.5 rounded-full bg-muted-foreground/50" />
              <Text className="shrink-0 text-xs text-muted-foreground">
                {post.createdAtLabel}
              </Text>
            </View>
          </View>
        </View>

        {/* Subject tag */}
        {post.subjectName ? (
          <Badge size="sm" className="max-w-full">
            <Text numberOfLines={1}>{post.subjectName}</Text>
          </Badge>
        ) : null}

        {/* Post content */}
        <View className="gap-1.5">
          <Text className="text-base font-bold text-card-foreground">
            {post.title}
          </Text>
          <Text
            className="text-sm leading-5 text-muted-foreground"
            numberOfLines={hasPhoto ? 3 : 5}
          >
            {post.content}
          </Text>
        </View>
      </Pressable>

      {/* Photo */}
      {hasPhoto ? (
        <Pressable
          accessibilityRole="imagebutton"
          accessibilityLabel="Open thread image"
          className="mt-3"
          onPress={() => onOpen(post.id)}
        >
          <Image
            source={{ uri: post.photoUrl as string }}
            style={{
              width: "100%",
              aspectRatio: 1.5,
              backgroundColor: withOpacity(theme.muted, 0.6),
              borderTopWidth: 1,
              borderBottomWidth: 1,
              borderColor: theme.border,
            }}
            contentFit="cover"
            transition={120}
            onError={() => setImageFailed(true)}
          />
        </Pressable>
      ) : null}

      {/* Engagement stats */}
      <View className="flex-row items-center justify-between gap-3 px-4 py-2.5">
        <View className="flex-row items-center gap-1.5">
          <View
            className="h-5 w-5 items-center justify-center rounded-full"
            style={{ backgroundColor: withOpacity(theme.primary, 0.15) }}
          >
            <Heart size={10} color={theme.primary} />
          </View>
          <Text className="text-xs text-muted-foreground">
            {post.likesCount}
          </Text>
        </View>
        <Text
          className="shrink text-xs text-muted-foreground"
          numberOfLines={1}
        >
          {post.commentsCount} comments · {post.repliesCount} replies
        </Text>
      </View>

      {/* Action buttons row */}
      <View className="flex-row gap-1 border-t border-border px-2 py-1">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={post.isLiked ? "Unlike" : "Like"}
          accessibilityState={{ selected: post.isLiked, disabled: liking }}
          className={cn(ACTION_CLASS, liking && "opacity-50")}
          onPress={() => onLike(post)}
          disabled={liking}
        >
          <Heart
            size={18}
            color={post.isLiked ? theme.primary : theme.mutedForeground}
            fill={post.isLiked ? theme.primary : "transparent"}
          />
          <Text
            className={cn(
              "text-xs font-semibold",
              post.isLiked ? "text-primary" : "text-muted-foreground"
            )}
          >
            Like
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Comment"
          className={ACTION_CLASS}
          onPress={() => onOpen(post.id)}
        >
          <MessageSquare size={18} color={theme.mutedForeground} />
          <Text className="text-xs font-semibold text-muted-foreground">
            Comment
          </Text>
        </Pressable>
        <Pressable
          className={ACTION_CLASS}
          onPress={() => onOpenActions(post)}
          accessibilityRole="button"
          accessibilityLabel="More actions for this post"
        >
          <MoreHorizontal size={18} color={theme.mutedForeground} />
          <Text className="text-xs font-semibold text-muted-foreground">
            More
          </Text>
        </Pressable>
      </View>
    </Card>
  )
})
