import { memo } from "react"
import type { LucideIcon } from "lucide-react-native"
import CircleCheck from "lucide-react-native/icons/circle-check"
import GraduationCap from "lucide-react-native/icons/graduation-cap"
import Lightbulb from "lucide-react-native/icons/lightbulb"
import SlidersHorizontal from "lucide-react-native/icons/sliders-horizontal"
import Target from "lucide-react-native/icons/target"
import { Pressable, View } from "react-native"

import type { MemberSettings } from "@/lib/member/settings"
import {
  findActivePreset,
  getPresetPatch,
  STUDY_PRESETS,
  type StudyPresetId,
} from "@/lib/member/study-presets"
import { cn } from "@/lib/utils"
import { useThemePalette } from "@/hooks/use-theme"
import { Text } from "@/components/ui/text"

import { SettingsIconTile } from "./settings-rows"
import { SettingsSection } from "./settings-section"

const PRESET_ICONS: Record<StudyPresetId, LucideIcon> = {
  exam: GraduationCap,
  practice: Lightbulb,
  mistakes: Target,
}

type PresetRowProps = {
  icon: LucideIcon
  label: string
  description: string
  isActive: boolean
  onPress: () => void
}

const PresetRow = memo(function PresetRow({
  icon,
  label,
  description,
  isActive,
  onPress,
}: PresetRowProps) {
  const theme = useThemePalette()

  return (
    <Pressable
      onPress={onPress}
      role="radio"
      accessibilityState={{ selected: isActive }}
      accessibilityLabel={label}
      accessibilityHint={description}
      className={cn(
        "min-h-16 flex-row items-center gap-3 px-4 py-3 active:bg-muted/50 web:hover:bg-muted/40",
        isActive && "bg-primary/5"
      )}
    >
      <SettingsIconTile icon={icon} tone={isActive ? "primary" : "muted"} />

      <View className="min-w-0 flex-1 gap-0.5">
        <Text
          className={cn(
            "text-sm font-semibold",
            isActive ? "text-primary" : "text-card-foreground"
          )}
        >
          {label}
        </Text>
        <Text variant="caption">{description}</Text>
      </View>

      {/* A filled check for the active mode, an empty ring otherwise, so the
          state reads without relying on the tint. */}
      {isActive ? (
        <CircleCheck size={22} color={theme.primary} strokeWidth={2.4} />
      ) : (
        <View className="h-[22px] w-[22px] rounded-full border-2 border-border" />
      )}
    </Pressable>
  )
})

type StudyModeSectionProps = {
  settings: MemberSettings
  onChange: (patch: Partial<MemberSettings>) => void
}

/**
 * One tap to a whole way of studying.
 *
 * The rows below it are still there for anyone who wants to fine-tune; this
 * is for the member who wants "make it like the real exam" without learning
 * what eight switches do.
 */
export const StudyModeSection = memo(function StudyModeSection({
  settings,
  onChange,
}: StudyModeSectionProps) {
  const theme = useThemePalette()
  const active = findActivePreset(settings)

  return (
    <SettingsSection
      id="study-mode"
      title="Study mode"
      description="Sets feedback, timer, shuffling and question source in one tap."
      keywords={["preset", "mode", "exam", "simulation", "practice", "drill"]}
      footer={
        active ? null : (
          <View className="flex-row items-center gap-1.5">
            <SlidersHorizontal
              size={13}
              color={theme.mutedForeground}
              strokeWidth={2.2}
            />
            <Text variant="caption">
              Custom: your settings below don&apos;t match a mode exactly.
            </Text>
          </View>
        )
      }
    >
      {STUDY_PRESETS.map((preset) => (
        <PresetRow
          key={preset.id}
          icon={PRESET_ICONS[preset.id]}
          label={preset.title}
          description={preset.description}
          isActive={active?.id === preset.id}
          onPress={() => onChange(getPresetPatch(preset, settings))}
        />
      ))}
    </SettingsSection>
  )
})
