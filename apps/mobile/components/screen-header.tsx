import { type ReactNode } from "react"
import { useRouter } from "expo-router"
import ArrowLeft from "lucide-react-native/icons/arrow-left"
import { ScrollView, View } from "react-native"

import type { ContentWidth } from "@/lib/layout"
import { cn } from "@/lib/utils"
import { useThemePalette } from "@/hooks/use-theme"
import { ContentFrame } from "@/components/ui/content-frame"
import { IconButton } from "@/components/ui/icon-button"
import { Text } from "@/components/ui/text"

type ScreenHeaderProps = {
  /** The screen title displayed next to the back arrow */
  title: string
  /** Optional trailing element (search icon, etc.) */
  trailing?: ReactNode
  /** Override the default router.back() behavior */
  onBack?: () => void
  /**
   * Frame the header at a content width so it lines up with the list or
   * scroll view beneath it. Omit it when the caller already pads the header.
   */
  width?: ContentWidth
}

/**
 * Consistent screen header: ← Title [trailing]
 * Used across all detail screens for a uniform navigation pattern.
 */
export function ScreenHeader({
  title,
  trailing,
  onBack,
  width,
}: ScreenHeaderProps) {
  const router = useRouter()
  const theme = useThemePalette()

  const row = (
    <View
      className={cn(
        "flex-row items-center justify-between gap-2 py-3",
        !width && "px-1.5"
      )}
    >
      <View className="flex-1 flex-row items-center gap-1.5">
        {/* Framed, the button pulls left so the arrow glyph - not the
            button's padding - sits on the content edge. */}
        <IconButton
          label="Go back"
          size="sm"
          className={width ? "-ml-2.5" : undefined}
          onPress={onBack ?? (() => router.back())}
        >
          <ArrowLeft size={20} color={theme.foreground} strokeWidth={2.4} />
        </IconButton>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          className="flex-1"
          contentContainerStyle={{ paddingRight: 16 }}
        >
          <Text variant="title" numberOfLines={1}>
            {title}
          </Text>
        </ScrollView>
      </View>
      {trailing ?? null}
    </View>
  )

  return width ? <ContentFrame width={width}>{row}</ContentFrame> : row
}
