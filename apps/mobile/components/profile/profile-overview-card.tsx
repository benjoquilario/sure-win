import { memo, type ReactNode } from "react"
import Award from "lucide-react-native/icons/award"
import BadgeCheck from "lucide-react-native/icons/badge-check"
import Building2 from "lucide-react-native/icons/building-2"
import CalendarClock from "lucide-react-native/icons/calendar-clock"
import Camera from "lucide-react-native/icons/camera"
import ChevronRight from "lucide-react-native/icons/chevron-right"
import Crown from "lucide-react-native/icons/crown"
import IdCard from "lucide-react-native/icons/id-card"
import PenLine from "lucide-react-native/icons/pen-line"
import { Pressable, View } from "react-native"

import type { Membership } from "@/lib/member/membership"
import { cn } from "@/lib/utils"
import { useLayout } from "@/hooks/use-layout"
import { useThemePalette } from "@/hooks/use-theme"
import { Card, CardContent } from "@/components/ui/card"
import { IconButton } from "@/components/ui/icon-button"
import { Text } from "@/components/ui/text"
import { CommunityAvatar } from "@/components/community/avatar"

/**
 * ─── Account overview ─────────────────────────────────────────────────────
 *
 * The top of the profile answers "whose account is this, and what is it
 * entitled to" in one card: photo, name, how they are verified, the facts
 * about them, and their plan.
 *
 * It replaces three blocks the page used to stack below it — a Membership
 * section, a Personal details list and a Shortcuts list — which repeated the
 * same name, email, plan and settings link. The facts are icon chips; the
 * plan is one row that opens Premium; editing is the pencil beside the name
 * or a tap on the photo. A missing school is a tappable prompt rather than a
 * gap, so it gets filled in.
 */

const MEMBER_SINCE_FMT = new Intl.DateTimeFormat("en-PH", {
  month: "short",
  year: "numeric",
})

type ProfileOverviewCardProps = {
  displayName: string
  email: string
  initials: string
  avatarUrl: string | null
  /** Short member type: "Retaker", "Licensed social worker". */
  memberTypeLabel: string | null
  school: string | null
  /** Shown for licensed professionals only. */
  licenseNumber?: string | null
  memberSince: string | null
  isVerified: boolean
  membership: Membership
  onEdit: () => void
  onManagePlan: () => void
}

function formatMemberSince(value: string | null) {
  if (!value) {
    return null
  }

  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : MEMBER_SINCE_FMT.format(date)
}

/** The plan row's heading, in the member's terms rather than a state name. */
function describePlan(membership: Membership) {
  if (membership.isPremium) {
    return membership.planName ?? "Premium"
  }

  if (membership.state === "expired") {
    return "Premium expired"
  }

  if (membership.state === "pending") {
    return "Purchase pending"
  }

  return "Free plan"
}

export const ProfileOverviewCard = memo(function ProfileOverviewCard({
  displayName,
  email,
  initials,
  avatarUrl,
  memberTypeLabel,
  school,
  licenseNumber,
  memberSince,
  isVerified,
  membership,
  onEdit,
  onManagePlan,
}: ProfileOverviewCardProps) {
  const theme = useThemePalette()
  const { isSmallPhone } = useLayout()
  const since = formatMemberSince(memberSince)

  return (
    <Card>
      <CardContent className="gap-4">
        <View className="flex-row items-start gap-3.5">
          {/* The photo edits too: it is the thing people tap to change it. */}
          <Pressable
            onPress={onEdit}
            role="button"
            accessibilityLabel="Change profile photo"
            className="active:opacity-80"
          >
            <CommunityAvatar
              label={initials}
              theme={theme}
              size={isSmallPhone ? "lg" : "xl"}
              sourceUri={avatarUrl}
              className="rounded-full"
            />
            <View
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              className="absolute -bottom-0.5 -right-0.5 h-6 w-6 items-center justify-center rounded-full border-2 border-card bg-primary"
            >
              <Camera
                size={11}
                color={theme.primaryForeground}
                strokeWidth={2.6}
              />
            </View>
          </Pressable>

          <View className="min-w-0 flex-1 gap-0.5">
            <View className="flex-row items-center gap-1.5">
              <Text
                numberOfLines={1}
                className="shrink text-lg font-extrabold leading-6 text-card-foreground"
              >
                {displayName}
              </Text>
              {isVerified ? (
                <BadgeCheck
                  size={17}
                  color={theme.primary}
                  strokeWidth={2.4}
                  accessibilityLabel="Verified email"
                />
              ) : null}
            </View>

            <Text variant="caption" numberOfLines={1}>
              {email}
            </Text>

            <View className="flex-row flex-wrap gap-1.5 pt-2">
              {memberTypeLabel ? (
                <MetaChip icon={<IdCard size={12} color={theme.primary} />}>
                  {memberTypeLabel}
                </MetaChip>
              ) : null}

              <MetaChip
                icon={
                  <Building2
                    size={12}
                    color={school ? theme.primary : theme.mutedForeground}
                  />
                }
                isPrompt={!school}
                onPress={school ? undefined : onEdit}
              >
                {school ?? "Add school"}
              </MetaChip>

              {licenseNumber ? (
                <MetaChip icon={<Award size={12} color={theme.primary} />}>
                  PRC {licenseNumber}
                </MetaChip>
              ) : null}

              {since ? (
                <MetaChip
                  icon={
                    <CalendarClock size={12} color={theme.mutedForeground} />
                  }
                >
                  Since {since}
                </MetaChip>
              ) : null}
            </View>
          </View>

          <IconButton
            label="Edit profile"
            variant="soft"
            size="sm"
            onPress={onEdit}
          >
            <PenLine size={16} color={theme.primary} strokeWidth={2.3} />
          </IconButton>
        </View>

        {/* The plan, in one row: what you have, when it renews, and the way
            to change it. Gold only when premium, so a free account does not
            look like it is on a paid tier. */}
        <Pressable
          onPress={onManagePlan}
          role="button"
          accessibilityLabel={`${describePlan(membership)}. ${membership.detail} ${membership.isPremium ? "Manage" : "Upgrade"}`}
          className={cn(
            "flex-row items-center gap-3 rounded-md px-3 py-2.5 active:opacity-80",
            membership.isPremium ? "bg-accent/10" : "bg-muted"
          )}
        >
          <View
            className={cn(
              "h-9 w-9 items-center justify-center rounded-sm",
              membership.isPremium ? "bg-accent/20" : "bg-card"
            )}
          >
            <Crown
              size={17}
              color={
                membership.isPremium ? theme.accentText : theme.mutedForeground
              }
              fill={membership.isPremium ? theme.accent : "transparent"}
              strokeWidth={2.2}
            />
          </View>

          <View className="min-w-0 flex-1 gap-0.5">
            <Text className="text-sm font-bold text-card-foreground">
              {describePlan(membership)}
            </Text>
            <Text variant="caption" numberOfLines={1}>
              {membership.detail}
            </Text>
          </View>

          <View className="flex-row items-center gap-0.5">
            <Text className="text-xs font-bold text-primary">
              {membership.isPremium ? "Manage" : "Upgrade"}
            </Text>
            <ChevronRight size={14} color={theme.primary} strokeWidth={2.6} />
          </View>
        </Pressable>
      </CardContent>
    </Card>
  )
})

/** One fact about the member, as a small pill. A prompt is tappable. */
function MetaChip({
  icon,
  children,
  isPrompt = false,
  onPress,
}: {
  icon: ReactNode
  children: ReactNode
  isPrompt?: boolean
  onPress?: () => void
}) {
  const content = (
    <>
      {icon}
      <Text
        numberOfLines={1}
        className={cn(
          "shrink text-xs font-semibold",
          isPrompt ? "text-muted-foreground" : "text-foreground"
        )}
      >
        {children}
      </Text>
    </>
  )

  const className = cn(
    "max-w-full flex-row items-center gap-1 rounded-full px-2.5 py-1",
    isPrompt ? "border border-dashed border-border" : "bg-muted"
  )

  return onPress ? (
    <Pressable
      onPress={onPress}
      role="button"
      className={cn(className, "active:opacity-80")}
    >
      {content}
    </Pressable>
  ) : (
    <View className={className}>{content}</View>
  )
}
