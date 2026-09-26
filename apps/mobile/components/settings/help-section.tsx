import { memo } from "react"
import ChevronRight from "lucide-react-native/icons/chevron-right"
import Compass from "lucide-react-native/icons/compass"
import { Pressable, View } from "react-native"

import { useThemePalette } from "@/hooks/use-theme"
import { Text } from "@/components/ui/text"

import { SettingsSection } from "./settings-section"

/**
 * Where the first-run tour goes to live afterwards.
 *
 * Onboarding used to be genuinely once-only: it ran before the first sign-in,
 * set a flag, and became unreachable for the life of the install. That is the
 * wrong shape for it — the slides explain what the app is *for*, which is worth
 * more to somebody three weeks in and unsure what "board exam mode" does than
 * to somebody who has not signed up yet and is skipping to get past it.
 *
 * So it stays out of the way and stays reachable.
 */

type HelpSectionProps = {
  onReplayOnboarding: () => void
}

export const HelpSection = memo(function HelpSection({
  onReplayOnboarding,
}: HelpSectionProps) {
  const theme = useThemePalette()

  return (
    <SettingsSection
      title="Help"
      description="A refresher on what this app does, whenever you want it."
    >
      <Pressable
        onPress={onReplayOnboarding}
        accessibilityRole="button"
        accessibilityLabel="How this app works"
        accessibilityHint="Replays the introduction slides"
        className="-mx-2 min-h-14 flex-row items-center gap-3 rounded-md px-2 py-2 active:bg-muted/60 web:hover:bg-muted/60"
      >
        <View className="h-9 w-9 items-center justify-center rounded-full bg-primary/10">
          <Compass size={16} color={theme.primary} strokeWidth={2.2} />
        </View>

        <View className="flex-1 gap-0.5">
          <Text variant="callout" className="font-semibold">
            How this app works
          </Text>
          <Text variant="caption">
            The three slides from your first launch.
          </Text>
        </View>

        <ChevronRight
          size={18}
          color={theme.mutedForeground}
          strokeWidth={2.2}
        />
      </Pressable>
    </SettingsSection>
  )
})
