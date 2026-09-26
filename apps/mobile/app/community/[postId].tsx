import { memo, useCallback, useMemo, useState } from "react"
import { useAuth } from "@/contexts/auth-context"
import { useCommunity } from "@/contexts/community-context"
import { Image } from "expo-image"
import { useLocalSearchParams, useRouter } from "expo-router"
import Flag from "lucide-react-native/icons/flag"
import Heart from "lucide-react-native/icons/heart"
import MessageSquare from "lucide-react-native/icons/message-square"
import Send from "lucide-react-native/icons/send"
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  TextInput,
  View,
} from "react-native"
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context"

import {
  type CommunityCommentItem,
  type CommunityReplyItem,
} from "@/lib/community"
import { getMemberByline } from "@/lib/member/profile"
import {
  getCommunityCategoryColor,
  withOpacity,
  type ThemePalette,
} from "@/lib/theme"
import { cn } from "@/lib/utils"
import { useCommunityModeration } from "@/hooks/use-community-moderation"
import { useKeyboardInset } from "@/hooks/use-keyboard-inset"
import { useContentPadding } from "@/hooks/use-layout"
import { useReport } from "@/hooks/use-report"
import { useTheme } from "@/hooks/use-theme"
import { Badge } from "@/components/ui/badge"
import { BottomBar } from "@/components/ui/bottom-bar"
import { Card, CardContent } from "@/components/ui/card"
import { ContentFrame } from "@/components/ui/content-frame"
import { EmptyState } from "@/components/ui/empty-state"
import { IconButton } from "@/components/ui/icon-button"
import { Text } from "@/components/ui/text"
import { ScrollView } from "@/components/ui/virtualized-scroll-view"
import { CommunityAvatar } from "@/components/community/avatar"
import {
  PostActionsMenu,
  type PostAction,
} from "@/components/community/post-actions-menu"
import { ReportDialog } from "@/components/report"
import { ScreenHeader } from "@/components/screen-header"

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toAvatarSeed(name: string) {
  return (
    name
      .split(/\s+/)
      .map((p) => p[0])
      .filter(Boolean)
      .join("")
      .toUpperCase()
      .slice(0, 2) || "RV"
  )
}

// ─── Reply Row ────────────────────────────────────────────────────────────────

const ReplyRow = memo(function ReplyRow({
  reply,
  theme,
}: {
  reply: CommunityReplyItem
  theme: ThemePalette
}) {
  return (
    <View className="ml-12 flex-row gap-2.5 py-2">
      <CommunityAvatar
        label={reply.author.avatarSeed}
        sourceUri={reply.author.avatarUrl}
        theme={theme}
        size="sm"
      />
      <View className="flex-1">
        <View className="rounded-md border border-border/70 bg-muted/50 px-3 py-2.5">
          <Text className="text-sm font-bold text-foreground" numberOfLines={1}>
            {reply.author.name}
          </Text>
          <Text className="mt-0.5 text-sm leading-5 text-muted-foreground">
            {reply.content}
          </Text>
        </View>
        <Text className="mt-1 px-3 text-2xs text-muted-foreground">
          {reply.createdAtLabel}
        </Text>
      </View>
    </View>
  )
})

// ─── Comment Row ──────────────────────────────────────────────────────────────

const CommentRow = memo(function CommentRow({
  comment,
  onSubmitReply,
  disabled,
  theme,
}: {
  comment: CommunityCommentItem
  onSubmitReply: (commentId: string, content: string) => void
  disabled: boolean
  theme: ThemePalette
}) {
  const [replyDraft, setReplyDraft] = useState("")
  const [isReplying, setIsReplying] = useState(false)

  const toggleReplying = useCallback(() => {
    setIsReplying((current) => !current)
  }, [])

  const submitReply = useCallback(() => {
    const trimmed = replyDraft.trim()
    if (!trimmed) return
    onSubmitReply(comment.id, trimmed)
    setReplyDraft("")
    setIsReplying(false)
  }, [comment.id, onSubmitReply, replyDraft])

  return (
    <View>
      <View className="flex-row gap-2.5 py-2">
        <CommunityAvatar
          label={comment.author.avatarSeed}
          sourceUri={comment.author.avatarUrl}
          theme={theme}
          size="md"
        />
        <View className="flex-1">
          <View className="rounded-md border border-border/70 bg-muted/50 px-3.5 py-3">
            <Text
              className="text-sm font-bold text-foreground"
              numberOfLines={1}
            >
              {comment.author.name}
            </Text>
            <Text className="mt-0.5 text-sm leading-5 text-foreground">
              {comment.content}
            </Text>
          </View>
          <View className="flex-row items-center gap-3 px-3">
            <Text className="text-2xs text-muted-foreground">
              {comment.createdAtLabel}
            </Text>
            <Pressable
              role="button"
              accessibilityLabel={`Reply to ${comment.author.name}`}
              accessibilityState={{ expanded: isReplying }}
              onPress={toggleReplying}
              disabled={disabled}
              hitSlop={6}
              className="min-h-8 justify-center px-1 web:hover:opacity-80"
            >
              <Text className="text-xs font-bold text-primary">Reply</Text>
            </Pressable>
          </View>
        </View>
      </View>

      {comment.replies.map((reply) => (
        <ReplyRow key={reply.id} reply={reply} theme={theme} />
      ))}

      {isReplying ? (
        <View className="ml-12 flex-row items-center gap-2 py-2">
          <TextInput
            value={replyDraft}
            onChangeText={setReplyDraft}
            placeholder="Write a reply..."
            placeholderTextColor={theme.mutedForeground}
            className="flex-1 rounded-full bg-muted/60 px-4 py-2.5 text-sm text-foreground"
            style={{ color: theme.foreground }}
            selectionColor={theme.primary}
            returnKeyType="send"
            onSubmitEditing={submitReply}
          />
          <IconButton
            label="Send reply"
            variant="default"
            size="sm"
            onPress={submitReply}
            disabled={disabled || !replyDraft.trim()}
            className={cn("rounded-full", !replyDraft.trim() && "opacity-40")}
          >
            <Send size={16} color={theme.primaryForeground} />
          </IconButton>
        </View>
      ) : null}
    </View>
  )
})

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function CommunityDiscussionScreen() {
  const insets = useSafeAreaInsets()
  const keyboardInset = useKeyboardInset()
  const { theme } = useTheme()
  const contentPadding = useContentPadding("reading")
  const user = useAuth((s) => s.user)
  const profile = useAuth((s) => s.profile)

  const { postId } = useLocalSearchParams<{ postId: string }>()

  const feed = useCommunity((s) => s.feed)
  const isCreatingComment = useCommunity((s) => s.isCreatingComment)
  const isCreatingReply = useCommunity((s) => s.isCreatingReply)
  const togglingLikePostId = useCommunity((s) => s.togglingLikePostId)
  const toggleLike = useCommunity((s) => s.toggleLike)
  const submitReplyAction = useCommunity((s) => s.submitReply)

  const post = useMemo(
    () => feed?.posts.find((p) => p.id === postId) ?? null,
    [feed?.posts, postId]
  )

  const [commentText, setCommentText] = useState("")
  const router = useRouter()

  /** The one thing the app may do with `flagged_content`: write to it. */
  const report = useReport()

  // The same three actions the feed offers, so the two screens do not disagree
  // about what a member may do with a post.
  const [isActionsOpen, setIsActionsOpen] = useState(false)
  const moderation = useCommunityModeration({
    onChanged: () => {
      // The post is gone from the feed now, so there is nothing left to show.
      router.back()
    },
  })

  const handleAction = useCallback(
    (action: PostAction) => {
      setIsActionsOpen(false)

      if (!post) {
        return
      }

      if (action === "report") {
        report.open({ contentType: "post", contentId: postId })
        return
      }

      if (action === "block") {
        moderation.confirmBlock({
          userId: post.userId,
          name: post.author.name,
        })
        return
      }

      moderation.confirmDelete({ table: "posts", rowId: postId })
    },
    [moderation, post, postId, report]
  )

  const currentAvatarSeed = useMemo(
    () => toAvatarSeed(profile?.fullName ?? user?.name ?? "RV"),
    [profile?.fullName, user?.name]
  )
  const currentAvatarUrl = profile?.avatarUrl?.trim() || null

  const currentAuthor = useCallback(() => {
    if (!user) return null
    const name = profile?.fullName ?? user.name ?? "Reviewer"
    return {
      id: user.$id,
      name,
      subtitle: getMemberByline(profile, user.email ?? "Community member"),
      avatarSeed: toAvatarSeed(name),
      avatarUrl: profile?.avatarUrl?.trim() || null,
    }
  }, [profile, user])

  const handleSubmitComment = useCallback(async () => {
    if (!user?.$id || !post || !commentText.trim()) return
    const author = currentAuthor()
    if (!author) return

    // Use store mutation
    const store = useCommunity.getState()
    store.setActivePostId(post.id)
    store.setCommentDraft(commentText.trim())
    await store.submitComment(user.$id, author)
    setCommentText("")
  }, [commentText, currentAuthor, post, user?.$id])

  const handleSubmitReply = useCallback(
    (commentId: string, content: string) => {
      if (!user?.$id) return
      const author = currentAuthor()
      if (!author) return
      void submitReplyAction(user.$id, commentId, content, author)
    },
    [currentAuthor, submitReplyAction, user?.$id]
  )

  const handleToggleLike = useCallback(() => {
    if (!user?.$id || !post) return
    void toggleLike(user.$id, post)
  }, [post, toggleLike, user?.$id])

  const categoryColor = getCommunityCategoryColor(theme, post?.category ?? "")

  if (!post) {
    return (
      <SafeAreaView className="flex-1 bg-background">
        <ScreenHeader title="Discussion" width="reading" />
        <ContentFrame width="reading" className="flex-1 justify-center">
          <EmptyState
            title="Discussion unavailable"
            description="This discussion is no longer available."
          />
        </ContentFrame>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView className="flex-1 bg-background">
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Math.max(insets.top, 12)}
      >
        {/* Header */}
        <View className="border-b border-border/50">
          <ScreenHeader title={`${post.author.name}'s Post`} width="reading" />
        </View>

        <ScrollView
          automaticallyAdjustKeyboardInsets
          contentContainerClassName="gap-2"
          contentContainerStyle={{
            ...contentPadding,
            paddingTop: 16,
            paddingBottom: Math.max(insets.bottom, 20) + 80,
          }}
          contentInsetAdjustmentBehavior="automatic"
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
        >
          {/* Post content */}
          <Card>
            <CardContent size="compact" className="gap-3">
              {/* Author row */}
              <View className="flex-row items-center gap-3">
                <CommunityAvatar
                  label={post.author.avatarSeed}
                  sourceUri={post.author.avatarUrl}
                  theme={theme}
                  size="lg"
                />
                <View className="flex-1">
                  <Text
                    className="text-sm font-bold text-foreground"
                    numberOfLines={1}
                  >
                    {post.author.name}
                  </Text>
                  <View className="flex-row flex-wrap items-center gap-x-1.5 gap-y-1">
                    <Text className="text-xs text-muted-foreground">
                      {post.createdAtLabel}
                    </Text>
                    <View className="h-1 w-1 rounded-full bg-muted-foreground/40" />
                    <View
                      className="rounded-full px-2 py-0.5"
                      style={{
                        backgroundColor: withOpacity(categoryColor, 0.12),
                      }}
                    >
                      <Text
                        className="text-2xs font-bold uppercase tracking-[1px]"
                        style={{ color: categoryColor }}
                      >
                        {post.category}
                      </Text>
                    </View>
                  </View>
                </View>
              </View>

              {/* Subject tag */}
              {post.subjectName ? (
                <Badge tone="primary">{post.subjectName}</Badge>
              ) : null}

              {/* Title & content */}
              <Text
                role="heading"
                className="text-lg font-extrabold text-foreground"
              >
                {post.title}
              </Text>
              <Text className="text-sm leading-6 text-foreground/80">
                {post.content}
              </Text>

              {/* Photo */}
              {post.photoUrl ? (
                <View className="overflow-hidden rounded-md border border-border/70">
                  <Image
                    source={{ uri: post.photoUrl }}
                    style={{
                      width: "100%",
                      aspectRatio: 1.5,
                      backgroundColor: withOpacity(theme.muted, 0.6),
                    }}
                    contentFit="cover"
                    transition={120}
                  />
                </View>
              ) : null}

              {/* Engagement stats */}
              <View className="flex-row flex-wrap items-center justify-between gap-2 border-y border-border/70 py-2.5">
                <View className="flex-row items-center gap-1.5">
                  <View className="h-5 w-5 items-center justify-center rounded-full bg-primary/15">
                    <Heart size={10} color={theme.primary} />
                  </View>
                  <Text className="text-xs text-muted-foreground">
                    {post.likesCount}
                  </Text>
                </View>
                <Text className="text-xs text-muted-foreground">
                  {post.commentsCount} comments · {post.repliesCount} replies
                </Text>
              </View>

              {/* Action buttons */}
              <View className="flex-row pb-1">
                <Pressable
                  role="button"
                  accessibilityState={{ selected: post.isLiked }}
                  className="min-h-11 flex-1 flex-row items-center justify-center gap-2 rounded-sm active:bg-muted/60 web:hover:bg-muted/60"
                  onPress={handleToggleLike}
                  disabled={togglingLikePostId === post.id}
                >
                  <Heart
                    size={18}
                    color={post.isLiked ? theme.primary : theme.mutedForeground}
                    fill={post.isLiked ? theme.primary : "transparent"}
                  />
                  <Text
                    className={cn(
                      "text-sm font-semibold",
                      post.isLiked ? "text-primary" : "text-muted-foreground"
                    )}
                  >
                    Like
                  </Text>
                </Pressable>
                <Pressable className="min-h-11 flex-1 flex-row items-center justify-center gap-2 rounded-sm">
                  <MessageSquare size={18} color={theme.mutedForeground} />
                  <Text className="text-sm font-semibold text-muted-foreground">
                    Comment
                  </Text>
                </Pressable>
                <Pressable
                  className="min-h-11 flex-1 flex-row items-center justify-center gap-2 rounded-sm active:bg-muted/60 web:hover:bg-muted/60"
                  onPress={() => setIsActionsOpen(true)}
                  accessibilityRole="button"
                  accessibilityLabel="More actions for this post"
                >
                  <Flag size={18} color={theme.mutedForeground} />
                  <Text className="text-sm font-semibold text-muted-foreground">
                    Report
                  </Text>
                </Pressable>
              </View>
            </CardContent>
          </Card>

          {/* Comments section */}
          <View>
            {post.comments.length === 0 ? (
              <EmptyState
                className="mt-2"
                icon={<MessageSquare size={22} color={theme.mutedForeground} />}
                title="No comments yet"
                description="Be the first to comment."
              />
            ) : (
              post.comments.map((comment: CommunityCommentItem) => (
                <CommentRow
                  key={comment.id}
                  comment={comment}
                  onSubmitReply={handleSubmitReply}
                  disabled={isCreatingReply}
                  theme={theme}
                />
              ))
            )}
          </View>
        </ScrollView>

        {/* Bottom comment input */}
        <BottomBar
          minInset={10}
          bordered={false}
          className="border-t border-border/40 bg-card px-0 pt-2.5"
          style={{ marginBottom: keyboardInset }}
        >
          <ContentFrame width="reading" className="flex-row items-center gap-2">
            <CommunityAvatar
              label={currentAvatarSeed}
              sourceUri={currentAvatarUrl}
              theme={theme}
              size="sm"
            />
            <TextInput
              value={commentText}
              onChangeText={setCommentText}
              placeholder="Write a comment..."
              placeholderTextColor={theme.mutedForeground}
              accessibilityLabel="Write a comment"
              className="min-h-11 flex-1 rounded-full border border-border bg-muted/50 px-4 py-2.5 text-sm text-foreground"
              style={{ color: theme.foreground }}
              selectionColor={theme.primary}
              returnKeyType="send"
              onSubmitEditing={() => void handleSubmitComment()}
            />
            <IconButton
              label="Send comment"
              variant="default"
              onPress={() => void handleSubmitComment()}
              disabled={isCreatingComment || !commentText.trim()}
              className={cn(
                "rounded-full",
                !commentText.trim() && "opacity-40"
              )}
            >
              <Send size={16} color={theme.primaryForeground} />
            </IconButton>
          </ContentFrame>
        </BottomBar>
      </KeyboardAvoidingView>

      <PostActionsMenu
        open={isActionsOpen}
        onOpenChange={setIsActionsOpen}
        isOwn={moderation.isOwn(post?.userId ?? "")}
        authorName={post?.author.name ?? "This member"}
        onSelect={handleAction}
      />

      <ReportDialog
        open={report.isOpen}
        contentType={report.contentType}
        onOpenChange={(open) => {
          if (!open) {
            report.close()
          }
        }}
        onSubmit={report.submit}
      />
    </SafeAreaView>
  )
}
