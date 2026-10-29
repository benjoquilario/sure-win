import { memo, useCallback, type ReactNode } from "react"
import type { LucideIcon } from "lucide-react-native"
import ChevronRight from "lucide-react-native/icons/chevron-right"
import Minus from "lucide-react-native/icons/minus"
import Plus from "lucide-react-native/icons/plus"
import { Pressable, View } from "react-native"

import { getToneColor, type Tone } from "@/lib/tone"
import { cn } from "@/lib/utils"
import { useThemePalette } from "@/hooks/use-theme"
import { IconButton } from "@/components/ui/icon-button"
import { Switch } from "@/components/ui/switch"
import { Text } from "@/components/ui/text"

/**
 * The row shapes every settings screen is built from.
 *
 * Four of them: a switch, a choice between named options, a number, and a
 * link. Every row leads with an icon tile, so a long screen can be scanned by
 * shape before it is read, and every row carries a one-line description,
 * because "Shuffle choices" is a guess and "Rearrange the options under each
 * question" is a decision.
 *
 * `label`, `description` and `keywords` also feed settings search: the section
 * reads them off its children to decide what to show (see settings-section).
 */

/** Props every row shares. Search reads these, so keep them on the element. */
export type SettingsRowBaseProps = {
  icon: LucideIcon
  /** Tints the icon tile. Primary unless the row means something. */
  tone?: Tone
  label: string
  description?: string
  /** Extra words search should match: "dark mode" for Theme, say. */
  keywords?: readonly string[]
  disabled?: boolean
}

const TILE_CLASS: Record<Tone, string> = {
  default: "bg-muted",
  primary: "bg-primary/10",
  success: "bg-success/10",
  warning: "bg-warning/15",
  accent: "bg-accent/15",
  destructive: "bg-destructive/10",
  muted: "bg-muted",
}

export const SettingsIconTile = memo(function SettingsIconTile({
  icon: Icon,
  tone = "primary",
}: {
  icon: LucideIcon
  tone?: Tone
}) {
  const theme = useThemePalette()

  return (
    <View
      className={cn(
        "h-9 w-9 shrink-0 items-center justify-center rounded-sm",
        TILE_CLASS[tone]
      )}
    >
      <Icon size={18} color={getToneColor(theme, tone)} strokeWidth={2.2} />
    </View>
  )
})

/** Icon, then label over description. The left half of every row. */
function RowText({
  label,
  description,
  trailing,
  tone,
}: {
  label: string
  description?: string
  trailing?: ReactNode
  tone?: Tone
}) {
  return (
    <View className="min-w-0 flex-1 gap-0.5">
      <View className="flex-row items-center gap-2">
        <Text
          className={cn(
            "shrink text-sm font-semibold",
            // Only a destructive row colours its label; everywhere else the
            // tint stays on the icon, where it signals without shouting.
            tone === "destructive" ? "text-destructive" : "text-card-foreground"
          )}
          numberOfLines={2}
        >
          {label}
        </Text>
        {trailing}
      </View>
      {description ? <Text variant="caption">{description}</Text> : null}
    </View>
  )
}

// ─── Switch ─────────────────────────────────────────────────────────────────

type SwitchRowProps = SettingsRowBaseProps & {
  value: boolean
  onChange: (value: boolean) => void
}

export const SettingsSwitchRow = memo(function SettingsSwitchRow({
  icon,
  tone,
  label,
  description,
  value,
  disabled = false,
  onChange,
}: SwitchRowProps) {
  const toggle = useCallback(() => onChange(!value), [onChange, value])

  return (
    // The whole row toggles, not only the 48pt switch: it is the bigger
    // target, and it is what every platform's own settings app does.
    <Pressable
      onPress={toggle}
      disabled={disabled}
      role="switch"
      accessibilityState={{ checked: value, disabled }}
      accessibilityLabel={label}
      accessibilityHint={description}
      className={cn(
        "min-h-14 flex-row items-center gap-3 px-4 py-3 active:bg-muted/50 web:hover:bg-muted/40",
        disabled && "opacity-50"
      )}
    >
      <SettingsIconTile icon={icon} tone={tone} />
      <RowText label={label} description={description} />
      <Switch
        checked={value}
        onCheckedChange={onChange}
        disabled={disabled}
        // The row already announces itself as the switch.
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
      />
    </Pressable>
  )
})

// ─── Choice ─────────────────────────────────────────────────────────────────

export type SettingsOption<T extends string> = {
  value: T
  label: string
  description?: string
  icon?: LucideIcon
}

type OptionRowProps<T extends string> = SettingsRowBaseProps & {
  options: readonly SettingsOption<T>[]
  value: T
  onChange: (value: T) => void
}

/**
 * A closed choice, rendered as chips.
 *
 * Chips rather than a dropdown because every one of these has two to four
 * options and the whole set fits on screen: a picker would hide the answer
 * behind a tap for no benefit. The description under the label always names
 * what the *selected* option does, so the effect of a tap is read, not guessed.
 */
function OptionChip<T extends string>({
  option,
  isSelected,
  disabled,
  onPress,
}: {
  option: SettingsOption<T>
  isSelected: boolean
  disabled: boolean
  onPress: (value: T) => void
}) {
  const theme = useThemePalette()
  const handlePress = useCallback(
    () => onPress(option.value),
    [onPress, option.value]
  )
  const Icon = option.icon

  return (
    <Pressable
      onPress={handlePress}
      disabled={disabled}
      role="radio"
      accessibilityState={{ selected: isSelected, disabled }}
      accessibilityLabel={option.label}
      accessibilityHint={option.description}
      // min-w lets a four-option row wrap on a 320pt phone instead of
      // squeezing every label onto two lines.
      className={cn(
        "min-h-11 min-w-24 flex-1 flex-row items-center justify-center gap-1.5 rounded-sm border px-3 py-2 active:opacity-90",
        isSelected
          ? "border-primary bg-primary/10"
          : "border-border bg-background web:hover:bg-muted/60"
      )}
    >
      {Icon ? (
        <Icon
          size={15}
          color={isSelected ? theme.primary : theme.mutedForeground}
          strokeWidth={2.3}
        />
      ) : null}
      <Text
        numberOfLines={1}
        className={cn(
          "shrink text-xs font-bold",
          isSelected ? "text-primary" : "text-muted-foreground"
        )}
      >
        {option.label}
      </Text>
    </Pressable>
  )
}

export const SettingsOptionRow = memo(function SettingsOptionRow<
  T extends string,
>({
  icon,
  tone,
  label,
  description,
  options,
  value,
  disabled = false,
  onChange,
}: OptionRowProps<T>) {
  const selected = options.find((option) => option.value === value)

  return (
    <View className={cn("gap-3 px-4 py-3", disabled && "opacity-50")}>
      <View className="flex-row items-center gap-3">
        <SettingsIconTile icon={icon} tone={tone} />
        <RowText
          label={label}
          description={selected?.description ?? description}
        />
      </View>

      <View className="flex-row flex-wrap gap-2" role="radiogroup">
        {options.map((option) => (
          <OptionChip
            key={option.value}
            option={option}
            isSelected={option.value === value}
            disabled={disabled}
            onPress={onChange}
          />
        ))}
      </View>
    </View>
  )
}) as <T extends string>(props: OptionRowProps<T>) => React.ReactElement

// ─── Number ─────────────────────────────────────────────────────────────────

type StepperRowProps = SettingsRowBaseProps & {
  value: number
  min: number
  max: number
  step?: number
  /** Rendered instead of the raw number: "All" for 0, say. */
  formatValue?: (value: number) => string
  onChange: (value: number) => void
}

/**
 * A number, changed by tapping rather than typing.
 *
 * These are set once and rarely revisited, and every one has a small sensible
 * range: a keyboard for "20" is more friction than it is worth, and a slider
 * cannot land on an exact value.
 */
export const SettingsStepperRow = memo(function SettingsStepperRow({
  icon,
  tone,
  label,
  description,
  value,
  min,
  max,
  step = 5,
  disabled = false,
  formatValue,
  onChange,
}: StepperRowProps) {
  const theme = useThemePalette()

  const decrement = useCallback(
    () => onChange(Math.max(value - step, min)),
    [min, onChange, step, value]
  )
  const increment = useCallback(
    () => onChange(Math.min(value + step, max)),
    [max, onChange, step, value]
  )

  return (
    <View
      className={cn(
        "min-h-14 flex-row flex-wrap items-center gap-3 px-4 py-3",
        disabled && "opacity-50"
      )}
    >
      <SettingsIconTile icon={icon} tone={tone} />
      <RowText label={label} description={description} />

      <View
        className="flex-row items-center rounded-md border border-border bg-background"
        accessibilityLabel={`${label}: ${formatValue ? formatValue(value) : value}`}
      >
        <IconButton
          label={`Decrease ${label}`}
          size="sm"
          disabled={disabled || value <= min}
          onPress={decrement}
        >
          <Minus size={16} color={theme.foreground} strokeWidth={2.4} />
        </IconButton>

        <Text className="min-w-12 text-center text-sm font-extrabold text-card-foreground">
          {formatValue ? formatValue(value) : value}
        </Text>

        <IconButton
          label={`Increase ${label}`}
          size="sm"
          disabled={disabled || value >= max}
          onPress={increment}
        >
          <Plus size={16} color={theme.foreground} strokeWidth={2.4} />
        </IconButton>
      </View>
    </View>
  )
})

// ─── Link ───────────────────────────────────────────────────────────────────

type LinkRowProps = SettingsRowBaseProps & {
  /** Current value, shown before the chevron: "Nov 20", "Premium". */
  value?: string
  /** A badge beside the label, for state that needs attention. */
  badge?: ReactNode
  /** Hide the chevron for a row that acts in place rather than navigating. */
  showChevron?: boolean
  onPress?: () => void
}

/**
 * Opens something: a screen, a dialog, a picker. Without `onPress` it is a
 * read-only fact, such as the app version.
 */
export const SettingsLinkRow = memo(function SettingsLinkRow({
  icon,
  tone,
  label,
  description,
  value,
  badge,
  disabled = false,
  showChevron = true,
  onPress,
}: LinkRowProps) {
  const theme = useThemePalette()

  const content = (
    <>
      <SettingsIconTile icon={icon} tone={tone} />
      <RowText
        label={label}
        description={description}
        trailing={badge}
        tone={tone}
      />
      {value ? (
        <Text
          numberOfLines={1}
          className="max-w-[40%] text-right text-sm font-medium text-muted-foreground"
        >
          {value}
        </Text>
      ) : null}
      {onPress && showChevron ? (
        <ChevronRight
          size={18}
          color={theme.mutedForeground}
          strokeWidth={2.2}
        />
      ) : null}
    </>
  )

  if (!onPress) {
    return (
      <View className="min-h-14 flex-row items-center gap-3 px-4 py-3">
        {content}
      </View>
    )
  }

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      role="button"
      accessibilityLabel={value ? `${label}, ${value}` : label}
      accessibilityHint={description}
      className={cn(
        "min-h-14 flex-row items-center gap-3 px-4 py-3 active:bg-muted/50 web:hover:bg-muted/40",
        disabled && "opacity-50"
      )}
    >
      {content}
    </Pressable>
  )
})
