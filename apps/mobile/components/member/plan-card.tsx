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
import { Card, CardContent } from "@/components/ui/card"
import { Text } from "@/components/ui/text"

/**
 * One plan, priced from `subscription_plans`.
 *
 * The number shown is the stored one, which is the admin's reporting figure and
 * a placeholder. Play's `getFormattedPrice()` is the amount actually charged —
 * localized, and subject to regional pricing — so the caller passes
 * `playPrice` the moment Billing answers and it replaces this outright.
 */

type PlanCardProps = {
  plan: SubscriptionPlan
  /** Play's localized price string. Wins over the stored one when present. */
  playPrice?: string | null
  savingPercent?: number | null
}

export const PlanCard = memo(function PlanCard({
  plan,
  playPrice,
  savingPercent,
}: PlanCardProps) {
  const theme = useThemePalette()
  const monthlyEquivalent = getMonthlyEquivalent(plan)

  return (
    <Card
      className={cn(plan.isPopular && "border-primary bg-primary/5")}
      style={plan.isPopular ? { borderWidth: 1.5 } : undefined}
    >
      <CardContent className="gap-3">
        <View className="flex-row items-start justify-between gap-3">
          <View className="flex-1 gap-1">
            <Text variant="label">{plan.name}</Text>

            <View className="flex-row flex-wrap items-baseline gap-x-1.5">
              <Text className="text-2xl font-extrabold text-card-foreground">
                {playPrice ?? plan.formattedPrice}
              </Text>
              <Text variant="caption">{describeBillingPeriod(plan)}</Text>
            </View>

            {monthlyEquivalent ? (
              <Text variant="caption">
                {monthlyEquivalent} per month, billed{" "}
                {describeBillingPeriod(plan).replace("per ", "")}
              </Text>
            ) : null}
          </View>

          <View className="items-end gap-1.5">
            {plan.isPopular ? (
              <Badge tone="primary" size="sm">
                Popular
              </Badge>
            ) : null}
            {savingPercent ? (
              <Badge tone="success" size="sm">
                Save {savingPercent}%
              </Badge>
            ) : null}
          </View>
        </View>

        {plan.description ? (
          <Text variant="caption">{plan.description}</Text>
        ) : null}

        {plan.features.length > 0 ? (
          <View className="gap-2 pt-0.5">
            {plan.features.map((feature) => (
              <View key={feature} className="flex-row items-start gap-2.5">
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
      </CardContent>
    </Card>
  )
})
