import { memo } from "react"
import Crown from "lucide-react-native/icons/crown"
import KeyRound from "lucide-react-native/icons/key-round"
import Mail from "lucide-react-native/icons/mail"
import MailWarning from "lucide-react-native/icons/mail-warning"
import UserRound from "lucide-react-native/icons/user-round"

import type { Membership } from "@/lib/member/membership"
import { Badge } from "@/components/ui/badge"

import { SettingsLinkRow } from "./settings-rows"
import { SettingsSection } from "./settings-section"

/**
 * Membership, profile, sign-in details.
 *
 * "Verify your email" appears only while the address is unverified. A
 * permanently visible button for something already done is noise, and worse,
 * it makes a member wonder whether it *did* work.
 */

type AccountSectionProps = {
  email: string
  isEmailVerified: boolean
  membership: Membership
  onOpenMembership: () => void
  onOpenProfile: () => void
  onChangeEmail: () => void
  onChangePassword: () => void
  onSendVerification: () => void
}

export const AccountSection = memo(function AccountSection({
  email,
  isEmailVerified,
  membership,
  onOpenMembership,
  onOpenProfile,
  onChangeEmail,
  onChangePassword,
  onSendVerification,
}: AccountSectionProps) {
  return (
    <SettingsSection
      id="account"
      title="Account"
      description="Your membership and how you sign in."
      keywords={["login", "sign in", "security"]}
    >
      <SettingsLinkRow
        icon={Crown}
        tone="accent"
        label="Membership"
        description={membership.detail}
        keywords={["premium", "subscription", "plan", "billing", "upgrade"]}
        badge={
          <Badge tone={membership.isPremium ? "success" : "muted"} size="sm">
            {membership.label}
          </Badge>
        }
        onPress={onOpenMembership}
      />

      <SettingsLinkRow
        icon={UserRound}
        label="Profile"
        description="Name, photo, school and licence details."
        keywords={["name", "photo", "avatar", "school", "license"]}
        onPress={onOpenProfile}
      />

      <SettingsLinkRow
        icon={Mail}
        label="Email address"
        description={email || "Not set"}
        keywords={["change email"]}
        onPress={onChangeEmail}
      />

      {!isEmailVerified ? (
        <SettingsLinkRow
          icon={MailWarning}
          tone="warning"
          label="Verify your email"
          description="Send the link again. You need a verified address to recover your account."
          keywords={["verification", "confirm"]}
          badge={
            <Badge tone="warning" size="sm">
              Action needed
            </Badge>
          }
          onPress={onSendVerification}
        />
      ) : null}

      <SettingsLinkRow
        icon={KeyRound}
        label="Password"
        description="Change the password you sign in with."
        keywords={["change password", "security"]}
        onPress={onChangePassword}
      />
    </SettingsSection>
  )
})
