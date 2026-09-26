import { type ReactNode } from "react"
import { View } from "react-native"

import { Text } from "@/components/ui/text"

type AppShellHeaderProps = {
  eyebrow?: ReactNode
  title: ReactNode
  subtitle?: ReactNode
  /** Optional trailing element (avatar, action button, …) */
  trailing?: ReactNode
  compact?: boolean
}

/**
 * Top-of-screen header used by tab screens: eyebrow · title · subtitle.
 *
 * No horizontal padding of its own. Screens place it in a `ContentFrame` or
 * inside a padded list, and an extra inset here would knock the title a few
 * points off the edge of the cards below it.
 */
export function AppShellHeader({
  eyebrow,
  title,
  subtitle,
  trailing,
  compact = false,
}: AppShellHeaderProps) {
  return (
    <View className="flex-row items-start justify-between gap-4">
      <View
        className={compact ? "min-w-0 flex-1 gap-1" : "min-w-0 flex-1 gap-1.5"}
      >
        {eyebrow ? <Text variant="eyebrow">{eyebrow}</Text> : null}

        <Text
          variant="title"
          className={compact ? undefined : "text-2xl leading-8"}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text variant="callout" className="text-muted-foreground">
            {subtitle}
          </Text>
        ) : null}
      </View>

      {trailing ?? null}
    </View>
  )
}
