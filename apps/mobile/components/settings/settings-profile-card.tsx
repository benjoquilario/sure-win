import { memo } from "react"
import BadgeCheck from "lucide-react-native/icons/badge-check"
import ChevronRight from "lucide-react-native/icons/chevron-right"
import { Pressable, View } from "react-native"

import type { Membership } from "@/lib/member/membership"
import { useThemePalette } from "@/hooks/use-theme"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { Text } from "@/components/ui/text"
import { CommunityAvatar } from "@/components/community/avatar"

/**
 * Who is signed in, at the top of Settings.
 *
 * It answers the two questions people open Settings with before they have
 * found a row: "am I on the right account?" and "am I a member?". Tapping it
 * goes to the profile, which is where the details it summarises are edited.
 */

type SettingsProfileCardProps = {
  name: string
  email: string
  initials: string
  avatarUrl: string | null
  isEmailVerified: boolean
  membership: Membership
  onPress: () => void
}

export const SettingsProfileCard = memo(function SettingsProfileCard({
  name,
  email,
  initials,
  avatarUrl,
  isEmailVerified,
  membership,
  onPress,
}: SettingsProfileCardProps) {
  const theme = useThemePalette()

  return (
    <Pressable
      onPress={onPress}
      role="button"
      accessibilityLabel={`${name}, ${membership.label} member. Open profile`}
      className="active:opacity-90 web:hover:opacity-95"
    >
      <Card className="flex-row items-center gap-3 p-4">
        <CommunityAvatar
          label={initials}
          theme={theme}
          size="lg"
          sourceUri={avatarUrl}
        />

        <View className="min-w-0 flex-1 gap-1">
          <View className="flex-row items-center gap-1.5">
            <Text
              numberOfLines={1}
              className="shrink text-base font-extrabold text-card-foreground"
            >
              {name}
            </Text>
            {isEmailVerified ? (
              <BadgeCheck
                size={16}
                color={theme.primary}
                strokeWidth={2.4}
                accessibilityLabel="Verified email"
              />
            ) : null}
          </View>

          <Text variant="caption" numberOfLines={1}>
            {email}
          </Text>

          <View className="flex-row">
            <Badge tone={membership.isPremium ? "success" : "muted"} size="sm">
              {membership.label}
            </Badge>
          </View>
        </View>

        <ChevronRight
          size={18}
          color={theme.mutedForeground}
          strokeWidth={2.2}
        />
      </Card>
    </Pressable>
  )
})
