import { memo } from "react"
import Check from "lucide-react-native/icons/check"
import { View } from "react-native"

import {
  describeBillingPeriod,
  getMonthlyEquivalent,
  type SubscriptionPlan,
} from "@/lib/member/plans"
import { cn } from "@/lib/utils"
import { useThemePalette } from "@/hooks/use-theme"
import { Badge } from "@/components/ui/badge"
import { MotionPressable } from "@/components/ui/motion"
import { Text } from "@/components/ui/text"

/**
 * One plan in the premium picker, priced from `subscription_plans`.
 *
 * A radio option rather than a static card: the member picks a plan first and
 * the screen's single checkout button acts on the choice, which is how Play's
 * own sheet is driven (one product id per purchase).
 *
 * The number shown is the stored one, which is the admin's reporting figure and
 * a placeholder. Play's `getFormattedPrice()` is the amount actually charged —
 * localized, and subject to regional pricing — so the caller passes
 * `playPrice` the moment Billing answers and it replaces this outright.
 *
 * A 1px hairline in both states, so selecting a plan never shifts the layout.
 * Selection reads from three things together - the primary edge, the tint and
 * the filled radio - rather than from a heavier border.
 */

export type PlanHighlight = "popular" | "best-value"

type PlanCardProps = {
  plan: SubscriptionPlan
  /** Play's localized price string. Wins over the stored one when present. */
  playPrice?: string | null
  savingPercent?: number | null
  highlight?: PlanHighlight | null
  selected: boolean
  onSelect: (planId: string) => void
}

export const PlanCard = memo(function PlanCard({
  plan,
  playPrice,
  savingPercent,
  highlight,
  selected,
  onSelect,
}: PlanCardProps) {
  const theme = useThemePalette()
  const price = playPrice ?? plan.formattedPrice
  const period = describeBillingPeriod(plan)
  const monthlyEquivalent = getMonthlyEquivalent(plan)

  return (
    <MotionPressable
      role="radio"
      aria-checked={selected}
      accessibilityLabel={[
        plan.name,
        `${price} ${period}`,
        savingPercent ? `save ${savingPercent} percent` : null,
        highlight === "popular" ? "most popular" : null,
        highlight === "best-value" ? "best value" : null,
      ]
        .filter(Boolean)
        .join(", ")}
      onPress={() => onSelect(plan.id)}
      className={cn(
        "rounded-xl border px-4 py-3.5",
        selected ? "border-primary bg-primary/5" : "border-border bg-card"
      )}
    >
      <View className="flex-row items-start gap-3">
        <View
          className={cn(
            "mt-0.5 h-5 w-5 items-center justify-center rounded-full border-2",
            selected
              ? "border-primary bg-primary"
              : "border-muted-foreground/40"
          )}
        >
          {selected ? (
            <Check
              size={12}
              color={theme.primaryForeground}
              strokeWidth={3.2}
            />
          ) : null}
        </View>

        <View className="min-w-0 flex-1 gap-1">
          <View className="flex-row flex-wrap items-center justify-between gap-2">
            <Text variant="subheading" className="text-card-foreground">
              {plan.name}
            </Text>

            {highlight === "popular" ? (
              <Badge tone="primary" size="sm">
                Most popular
              </Badge>
            ) : highlight === "best-value" ? (
              <Badge tone="accent" size="sm">
                Best value
              </Badge>
            ) : null}
          </View>

          <View className="flex-row flex-wrap items-baseline gap-x-1.5">
            <Text className="text-2xl font-extrabold leading-8 text-card-foreground">
              {price}
            </Text>
            <Text variant="caption">{period}</Text>
          </View>

          {monthlyEquivalent || savingPercent ? (
            <View className="flex-row flex-wrap items-center gap-2">
              {monthlyEquivalent ? (
                <Text variant="caption">≈ {monthlyEquivalent} a month</Text>
              ) : null}
              {savingPercent ? (
                <Badge tone="success" size="sm">
                  Save {savingPercent}%
                </Badge>
              ) : null}
            </View>
          ) : null}

          {/* Only the chosen plan spells out its extras, so the picker stays
              scannable as a list of prices. */}
          {selected && (plan.description || plan.features.length > 0) ? (
            <View className="gap-2 pt-2">
              {plan.description ? (
                <Text variant="callout" className="text-muted-foreground">
                  {plan.description}
                </Text>
              ) : null}

              {plan.features.map((feature) => (
                <View key={feature} className="flex-row items-start gap-2">
                  <Check
                    size={14}
                    color={theme.success}
                    strokeWidth={2.6}
                    style={{ marginTop: 3 }}
                  />
                  <Text variant="callout" className="flex-1">
                    {feature}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      </View>
    </MotionPressable>
  )
})
