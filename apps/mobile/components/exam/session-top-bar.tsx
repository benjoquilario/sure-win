import { memo } from "react"
import LayoutGrid from "lucide-react-native/icons/layout-grid"
import X from "lucide-react-native/icons/x"
import { View } from "react-native"

import { useThemePalette } from "@/hooks/use-theme"
import { ContentFrame } from "@/components/ui/content-frame"
import { IconButton } from "@/components/ui/icon-button"
import { Text } from "@/components/ui/text"

import { SessionProgress } from "./session-progress"
import { SessionTimer } from "./session-timer"

/**
 * The persistent bar above a sitting.
 *
 * Everything a member glances up for and nothing else: where they are, how
 * long is left, a way to jump, and a way out. The exit is a plain X rather than
 * a back arrow because leaving mid-paper is a decision, not navigation.
 */

type SessionTopBarProps = {
  position: number
  total: number
  answeredCount: number
  endsAtMs: number | null
  onExpire: () => void
  onOpenMap: () => void
  onExit: () => void
}

export const SessionTopBar = memo(function SessionTopBar({
  position,
  total,
  answeredCount,
  endsAtMs,
  onExpire,
  onOpenMap,
  onExit,
}: SessionTopBarProps) {
  const theme = useThemePalette()

  return (
    <View className="border-b border-border/70 bg-background pb-2.5 pt-1.5">
      {/* Same measure as the question below, so the progress bar and the
          prompt share a left edge on a tablet. */}
      <ContentFrame width="reading" className="gap-2">
        <View className="flex-row items-center gap-2">
          <IconButton label="Leave this sitting" size="sm" onPress={onExit}>
            <X size={19} color={theme.foreground} strokeWidth={2.4} />
          </IconButton>

          {/* Hidden from the screen reader: the progress bar below announces
              the same thing as one sentence. */}
          <View
            className="min-w-0 flex-1"
            importantForAccessibility="no-hide-descendants"
            accessibilityElementsHidden
          >
            <Text className="text-sm font-extrabold text-foreground">
              Question {position}
              <Text className="text-sm font-semibold text-muted-foreground">
                {` of ${total}`}
              </Text>
            </Text>
            <Text variant="caption" numberOfLines={1}>
              {answeredCount} answered
            </Text>
          </View>

          {endsAtMs ? (
            <SessionTimer endsAtMs={endsAtMs} onExpire={onExpire} />
          ) : null}

          <IconButton label="Jump to a question" size="sm" onPress={onOpenMap}>
            <LayoutGrid size={18} color={theme.foreground} strokeWidth={2.2} />
          </IconButton>
        </View>

        <SessionProgress
          position={position}
          total={total}
          answeredCount={answeredCount}
        />
      </ContentFrame>
    </View>
  )
})
