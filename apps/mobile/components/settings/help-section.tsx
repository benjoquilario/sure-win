import { memo } from "react"
import Compass from "lucide-react-native/icons/compass"
import Info from "lucide-react-native/icons/info"
import RotateCcw from "lucide-react-native/icons/rotate-ccw"
import Stethoscope from "lucide-react-native/icons/stethoscope"

import { SettingsLinkRow } from "./settings-rows"
import { SettingsSection } from "./settings-section"

/**
 * Help, troubleshooting, and the facts support will ask for.
 *
 * The first-run tour lives here afterwards. The slides explain what the app is
 * *for*, which is worth more to somebody three weeks in and unsure what board
 * exam mode does than to somebody skipping past it before signing up.
 *
 * The version row is read-only on purpose: "which version are you on?" is the
 * first question in every support thread, and the answer should be one glance
 * away.
 */

type HelpSectionProps = {
  appVersion: string
  onReplayOnboarding: () => void
  onOpenDiagnostics: () => void
  onRestoreDefaults: () => void
}

export const HelpSection = memo(function HelpSection({
  appVersion,
  onReplayOnboarding,
  onOpenDiagnostics,
  onRestoreDefaults,
}: HelpSectionProps) {
  return (
    <SettingsSection
      id="support"
      title="Help and support"
      description="A refresher, a health check, and a clean slate."
      keywords={["help", "problem", "troubleshoot"]}
    >
      <SettingsLinkRow
        icon={Compass}
        label="How this app works"
        description="The introduction slides from your first launch."
        keywords={["tour", "onboarding", "tutorial", "guide"]}
        onPress={onReplayOnboarding}
      />

      <SettingsLinkRow
        icon={Stethoscope}
        label="Connection diagnostics"
        description="Check the app can reach the question bank and your account."
        keywords={["network", "offline", "error", "not loading"]}
        onPress={onOpenDiagnostics}
      />

      <SettingsLinkRow
        icon={RotateCcw}
        tone="warning"
        label="Restore default study settings"
        description="Feedback, question pool, timer and shuffling go back to how they started. Your progress is kept."
        keywords={["reset", "defaults"]}
        showChevron={false}
        onPress={onRestoreDefaults}
      />

      <SettingsLinkRow
        icon={Info}
        tone="muted"
        label="App version"
        keywords={["about", "build"]}
        value={appVersion}
      />
    </SettingsSection>
  )
})
