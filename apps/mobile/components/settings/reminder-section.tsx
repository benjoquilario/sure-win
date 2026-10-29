import { memo } from "react"
import AlarmClock from "lucide-react-native/icons/alarm-clock"
import BellRing from "lucide-react-native/icons/bell-ring"
import CalendarDays from "lucide-react-native/icons/calendar-days"

import type { MemberSettings } from "@/lib/member/settings"
import { Text } from "@/components/ui/text"

import {
  SettingsLinkRow,
  SettingsStepperRow,
  SettingsSwitchRow,
} from "./settings-rows"
import { SettingsSection } from "./settings-section"

/**
 * The exam date and the daily nudge towards it.
 *
 * The exam date is a device preference (it drives the Home countdown); it used
 * to be settable only from that card, which is not where anyone looks for it
 * once the card has scrolled out of mind.
 *
 * `reminderTime` is stored as `"19:00"` **text** with a `timezone` beside it,
 * because it is a wall-clock time rather than an instant: 7pm should still be
 * 7pm when the member travels. The local notification is scheduled from those
 * two; nothing is converted to UTC.
 */

type ReminderSectionProps = {
  settings: MemberSettings
  /** Short countdown for the value slot, "128 days left"; null when unset. */
  examDateValue: string | null
  /** The full schedule line, "Nov 20, 2026 · 8:00 AM". */
  examDateDetail: string | null
  onPressExamDate: () => void
  onChange: (patch: Partial<MemberSettings>) => void
}

function parseHour(reminderTime: string) {
  const [hour] = reminderTime.split(":")
  const parsed = Number(hour)

  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 0), 23) : 19
}

function formatHour(hour: number) {
  const suffix = hour < 12 ? "am" : "pm"
  const display = hour % 12 === 0 ? 12 : hour % 12

  return `${display}${suffix}`
}

export const ReminderSection = memo(function ReminderSection({
  settings,
  examDateValue,
  examDateDetail,
  onPressExamDate,
  onChange,
}: ReminderSectionProps) {
  const hour = parseHour(settings.reminderTime)

  return (
    <SettingsSection
      id="exam-day"
      title="Exam day and reminders"
      description="Your target date, and a daily nudge towards it."
      keywords={["notification", "alert", "countdown", "schedule"]}
      footer={
        settings.reminderEnabled ? (
          <Text variant="caption">
            Reminders use your local time ({settings.timezone}).
          </Text>
        ) : null
      }
    >
      <SettingsLinkRow
        icon={CalendarDays}
        tone="accent"
        label="Board exam date"
        description={examDateDetail ?? "Set it and Home counts down the days."}
        keywords={["licensure", "countdown", "date"]}
        value={examDateValue ?? "Not set"}
        onPress={onPressExamDate}
      />

      <SettingsSwitchRow
        icon={BellRing}
        label="Daily study reminder"
        description="One notification a day if you have not studied yet."
        keywords={["notification", "push"]}
        value={settings.reminderEnabled}
        onChange={(reminderEnabled) => onChange({ reminderEnabled })}
      />

      {settings.reminderEnabled ? (
        <SettingsStepperRow
          icon={AlarmClock}
          label="Remind me at"
          description="Pick the hour you usually study."
          keywords={["time"]}
          value={hour}
          min={5}
          max={23}
          step={1}
          formatValue={formatHour}
          onChange={(nextHour) =>
            onChange({
              reminderTime: `${String(nextHour).padStart(2, "0")}:00`,
            })
          }
        />
      ) : null}
    </SettingsSection>
  )
})
