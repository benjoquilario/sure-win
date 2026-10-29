import { memo } from "react"
import LogOut from "lucide-react-native/icons/log-out"
import Trash2 from "lucide-react-native/icons/trash-2"

import { Text } from "@/components/ui/text"

import { SettingsLinkRow } from "./settings-rows"
import { SettingsSection } from "./settings-section"

/**
 * Sign out, and the one action that cannot be undone.
 *
 * Last on the screen and tinted by meaning. Deletion opens a dialog that asks
 * the member to type the word: a second tap is not a confirmation, it is a
 * reflex.
 */

type DangerZoneSectionProps = {
  isLoggingOut: boolean
  canDelete: boolean
  onSignOut: () => void
  onDeleteAccount: () => void
}

export const DangerZoneSection = memo(function DangerZoneSection({
  isLoggingOut,
  canDelete,
  onSignOut,
  onDeleteAccount,
}: DangerZoneSectionProps) {
  return (
    <SettingsSection
      id="danger"
      title="Sign out and delete"
      keywords={["logout", "log out", "remove account", "danger"]}
      footer={
        canDelete ? null : (
          <Text variant="caption">
            Account deletion is not available in this build yet.
          </Text>
        )
      }
    >
      <SettingsLinkRow
        icon={LogOut}
        tone="destructive"
        label={isLoggingOut ? "Signing out..." : "Sign out"}
        description="You will need your email and password to sign back in."
        keywords={["log out", "logout"]}
        disabled={isLoggingOut}
        showChevron={false}
        onPress={onSignOut}
      />

      <SettingsLinkRow
        icon={Trash2}
        tone="destructive"
        label="Delete account"
        description="Permanently remove your account, answers and progress."
        keywords={["remove", "erase", "close account"]}
        disabled={!canDelete}
        showChevron={false}
        onPress={onDeleteAccount}
      />
    </SettingsSection>
  )
})
