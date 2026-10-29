import type { ReactNode } from "react"
import BadgeCheck from "lucide-react-native/icons/badge-check"
import Crown from "lucide-react-native/icons/crown"
import LockKeyhole from "lucide-react-native/icons/lock-keyhole"
import { View } from "react-native"

import type { Membership } from "@/lib/member/membership"
import { useThemePalette } from "@/hooks/use-theme"
import { Text } from "@/components/ui/text"

/**
 * The top of the paywall.
 *
 * A flat card on the theme's own surface, not a gradient panel: it follows
 * light and dark mode like every other card, and premium is signalled by gold
 * alone - the crown, the kicker and the status pill. Gold text uses
 * `accent-text`, because the bright logo gold fails contrast as text on a
 * light card (design-system §1).
 */

type PremiumHeroProps = {
  membership: Membership
  /** The locked item that sent the member here, if any. */
  lockedTitle: string
  sourceLabel: string
}

export function PremiumHero({
  membership,
  lockedTitle,
  sourceLabel,
}: PremiumHeroProps) {
  const theme = useThemePalette()

  return (
    <View className="gap-3 rounded-xl border border-border bg-card p-4">
      <View className="flex-row items-center gap-3">
        <View className="h-11 w-11 items-center justify-center rounded-md bg-accent/15">
          <Crown
            size={22}
            color={theme.accentText}
            fill={theme.accent}
            strokeWidth={2}
          />
        </View>

        <View className="min-w-0 flex-1 gap-0.5">
          <Text variant="eyebrow" className="text-accent-text">
            Sure Win Premium
          </Text>
          <Text
            role="heading"
            className="text-lg font-black leading-6 text-card-foreground"
          >
            {membership.isPremium
              ? "You're on Premium"
              : "Unlock the complete reviewer"}
          </Text>
        </View>

        {membership.isPremium ? (
          <View className="flex-row items-center gap-1 rounded-full bg-accent/15 px-2.5 py-1">
            <BadgeCheck size={13} color={theme.accentText} strokeWidth={2.4} />
            <Text className="text-xs font-bold text-accent-text">
              {membership.label}
            </Text>
          </View>
        ) : null}
      </View>

      <Text className="text-sm leading-5 text-muted-foreground">
        {membership.isPremium
          ? "Every premium lesson, exam and question is open to you."
          : "Free accounts get a sample of each paper. Premium opens every question, explanation and lesson."}
      </Text>

      {membership.isPremium ? (
        <HeroNote>
          <Text className="flex-1 text-xs" numberOfLines={1}>
            <Text className="text-xs font-bold text-foreground">
              {membership.planName ?? "Membership"}
            </Text>
            <Text className="text-xs text-muted-foreground">
              {"  ·  "}
              {membership.detail}
            </Text>
          </Text>
        </HeroNote>
      ) : lockedTitle ? (
        <HeroNote>
          <LockKeyhole size={14} color={theme.accentText} strokeWidth={2.4} />
          <Text className="flex-1 text-xs" numberOfLines={1}>
            <Text className="text-xs text-muted-foreground">
              {`Unlocks ${sourceLabel.toLowerCase()}  `}
            </Text>
            <Text className="text-xs font-bold text-foreground">
              {lockedTitle}
            </Text>
          </Text>
        </HeroNote>
      ) : null}
    </View>
  )
}

/** One compact line at the foot of the hero: a soft fill, no border. */
function HeroNote({ children }: { children: ReactNode }) {
  return (
    <View className="flex-row items-center gap-2 rounded-sm bg-muted px-3 py-2">
      {children}
    </View>
  )
}
