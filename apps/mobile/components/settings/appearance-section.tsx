import { memo } from "react"
import Monitor from "lucide-react-native/icons/monitor-smartphone"
import Moon from "lucide-react-native/icons/moon"
import Sun from "lucide-react-native/icons/sun"
import SunMoon from "lucide-react-native/icons/sun-moon"
import Vibrate from "lucide-react-native/icons/vibrate"

import type { ThemeMode } from "@/lib/app-preferences"
import type { MemberSettings } from "@/lib/member/settings"

import {
  SettingsOptionRow,
  SettingsSwitchRow,
  type SettingsOption,
} from "./settings-rows"
import { SettingsSection } from "./settings-section"

/**
 * Appearance and feel.
 *
 * `theme` lives on `user_settings` so it follows the member to a new device,
 * *and* in the local preference store so the app can paint the right colours on
 * the very first frame, before any network call. The screen writes both; the
 * local one is the render source and the stored one is the source of truth on a
 * fresh install.
 *
 * Text size, language and sound used to be here too. They saved, but nothing
 * in the app read them, so they changed nothing; they come back when they do.
 */

const THEME_OPTIONS: SettingsOption<ThemeMode>[] = [
  {
    value: "system",
    label: "System",
    description: "Follows your device's light or dark setting.",
    icon: Monitor,
  },
  {
    value: "light",
    label: "Light",
    description: "Bright, for daytime study.",
    icon: Sun,
  },
  {
    value: "dark",
    label: "Dark",
    description: "Lower glare, for late-night review.",
    icon: Moon,
  },
]

type AppearanceSectionProps = {
  settings: MemberSettings
  themeMode: ThemeMode
  onChangeSettings: (patch: Partial<MemberSettings>) => void
  onChangeThemeMode: (mode: ThemeMode) => void
}

export const AppearanceSection = memo(function AppearanceSection({
  settings,
  themeMode,
  onChangeSettings,
  onChangeThemeMode,
}: AppearanceSectionProps) {
  return (
    <SettingsSection
      id="appearance"
      title="Appearance"
      description="How the app looks and feels."
      keywords={["display", "look"]}
    >
      <SettingsOptionRow
        icon={SunMoon}
        label="Theme"
        keywords={["dark mode", "light mode", "colour", "color"]}
        options={THEME_OPTIONS}
        value={themeMode}
        onChange={(mode) => {
          onChangeThemeMode(mode)
          onChangeSettings({ theme: mode })
        }}
      />

      <SettingsSwitchRow
        icon={Vibrate}
        label="Haptics"
        description="A tap you can feel when you answer and navigate."
        keywords={["vibration", "vibrate"]}
        value={settings.hapticsEnabled}
        onChange={(hapticsEnabled) => onChangeSettings({ hapticsEnabled })}
      />
    </SettingsSection>
  )
})
