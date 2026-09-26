import { memo } from "react"
import { Pressable, View } from "react-native"

import type { QuestionsAnsweredTimeline } from "@/lib/performance-stats"
import { withOpacity, type ThemePalette } from "@/lib/theme"
import { useLayout } from "@/hooks/use-layout"
import { Text } from "@/components/ui/text"

const BAR_MAX_HEIGHT = 110
/** Room on the right for the y-axis labels. */
const Y_AXIS_WIDTH = 36

const BarChartGridlines = memo(function BarChartGridlines({
  theme,
}: {
  theme: ThemePalette
}) {
  return (
    <>
      {[0, 0.5, 1].map((ratio) => (
        <View
          key={`grid-${ratio}`}
          style={{
            position: "absolute",
            left: 0,
            right: Y_AXIS_WIDTH - 6,
            top: (1 - ratio) * BAR_MAX_HEIGHT,
            height: 1,
            backgroundColor: withOpacity(theme.border, 0.5),
          }}
        />
      ))}
    </>
  )
})

const BarChartYAxis = memo(function BarChartYAxis({
  maxValue,
}: {
  maxValue: number
}) {
  return (
    <View
      className="absolute right-0 top-0 items-end justify-between"
      style={{ height: BAR_MAX_HEIGHT }}
    >
      {[maxValue, Math.round(maxValue / 2), 0].map((value, index) => (
        <Text
          key={`y-${index}`}
          className="text-2xs font-semibold text-muted-foreground"
        >
          {value}
        </Text>
      ))}
    </View>
  )
})

const BarChartBars = memo(function BarChartBars({
  points,
  theme,
  maxValue,
  selectedBarIndex,
  onSelectBar,
  gap,
}: {
  points: QuestionsAnsweredTimeline["points"]
  theme: ThemePalette
  maxValue: number
  selectedBarIndex: number | null
  onSelectBar: (index: number) => void
  gap: number
}) {
  return (
    <View
      style={{
        flex: 1,
        flexDirection: "row",
        alignItems: "flex-end",
        gap,
        paddingRight: Y_AXIS_WIDTH,
        height: BAR_MAX_HEIGHT,
      }}
    >
      {points.map((point, index) => {
        const height =
          point.value === 0
            ? 4
            : Math.max((point.value / maxValue) * BAR_MAX_HEIGHT, 8)
        const isSelected = selectedBarIndex === index

        return (
          <Pressable
            key={point.key}
            role="button"
            accessibilityLabel={`${point.label}: ${point.value} answered`}
            accessibilityState={{ selected: isSelected }}
            onPress={() => onSelectBar(index)}
            className="flex-1 items-center"
          >
            {isSelected && point.value > 0 ? (
              <View className="mb-1.5 items-center rounded-xs bg-primary px-2 py-1">
                <Text
                  className="text-2xs font-extrabold text-primary-foreground"
                  numberOfLines={1}
                >
                  {point.value}
                </Text>
                <View
                  style={{
                    position: "absolute",
                    bottom: -4,
                    width: 0,
                    height: 0,
                    borderLeftWidth: 5,
                    borderRightWidth: 5,
                    borderTopWidth: 5,
                    borderLeftColor: "transparent",
                    borderRightColor: "transparent",
                    borderTopColor: theme.primary,
                  }}
                />
              </View>
            ) : null}

            <View
              className="rounded-xs"
              style={{
                width: "85%",
                height,
                backgroundColor:
                  point.value === 0
                    ? withOpacity(theme.primary, 0.06)
                    : isSelected
                      ? theme.primary
                      : withOpacity(theme.primary, 0.3),
              }}
            />
          </Pressable>
        )
      })}
    </View>
  )
})

const BarChartLabels = memo(function BarChartLabels({
  points,
  gap,
}: {
  points: QuestionsAnsweredTimeline["points"]
  gap: number
}) {
  return (
    <View className="mt-2 flex-row" style={{ paddingRight: Y_AXIS_WIDTH, gap }}>
      {points.map((point) => (
        <View key={`label-${point.key}`} className="flex-1">
          <Text
            className="text-center text-2xs font-semibold text-muted-foreground"
            numberOfLines={1}
            // Twelve month labels share ~230pt on a 320pt phone.
            adjustsFontSizeToFit
            minimumFontScale={0.8}
          >
            {point.label}
          </Text>
        </View>
      ))}
    </View>
  )
})

export const BarChart = memo(function BarChart({
  timeline,
  theme,
  selectedBarIndex,
  onSelectBar,
}: {
  timeline: QuestionsAnsweredTimeline
  theme: ThemePalette
  selectedBarIndex: number | null
  onSelectBar: (index: number) => void
}) {
  const { isSmallPhone } = useLayout()
  const maxValue = Math.max(1, ...timeline.points.map((p) => p.value))
  // A dense year view needs the space more than the bars need the gap.
  const gap = isSmallPhone || timeline.points.length > 8 ? 4 : 8

  return (
    <View style={{ height: BAR_MAX_HEIGHT + 28, position: "relative" }}>
      <BarChartGridlines theme={theme} />
      <BarChartYAxis maxValue={maxValue} />
      <BarChartBars
        points={timeline.points}
        theme={theme}
        maxValue={maxValue}
        selectedBarIndex={selectedBarIndex}
        onSelectBar={onSelectBar}
        gap={gap}
      />
      <BarChartLabels points={timeline.points} gap={gap} />
    </View>
  )
})
