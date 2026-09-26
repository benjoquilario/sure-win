import { memo } from "react"
import { View } from "react-native"

import { useLayout } from "@/hooks/use-layout"
import { Text } from "@/components/ui/text"

type HomeGreetingProps = {
  firstName: string
  /** "Good morning" / "Good afternoon" / "Good evening". */
  salutation: string
}

/**
 * The screen's opening block: a personal greeting, then the promise.
 *
 * The headline carries the only two-tone text on Home — the second clause sits
 * in `primary` so the eye lands on "Starts Here." first. Everything else on
 * this screen earns attention through size and surface, not colour, which is
 * what keeps that one accent meaningful.
 */
export const HomeGreeting = memo(function HomeGreeting({
  firstName,
  salutation,
}: HomeGreetingProps) {
  // One step down the ramp on a 320pt phone, where 3xl sets the promise over
  // four lines and pushes the countdown below the fold.
  const { isSmallPhone } = useLayout()
  const headlineClass = isSmallPhone
    ? "text-2xl font-extrabold"
    : "text-3xl font-extrabold leading-10"

  return (
    <View className="gap-1">
      <Text variant="callout" className="text-muted-foreground">
        {salutation}, {firstName}! 👋
      </Text>

      {/* One Text, not two stacked lines: this way the clause wraps naturally
          on narrow screens instead of breaking at a hard-coded point. */}
      <Text
        role="heading"
        aria-level="1"
        className={`${headlineClass} text-foreground`}
      >
        Your Board Exam Success{" "}
        <Text className={`${headlineClass} text-primary`}>Starts Here.</Text>
      </Text>

      <Text variant="callout" className="mt-1 text-muted-foreground">
        Study smart. Practice more. Pass the board exam.
      </Text>
    </View>
  )
})
