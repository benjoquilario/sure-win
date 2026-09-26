import { useEffect, useMemo, useState } from "react"
import RefreshCcw from "lucide-react-native/icons/refresh-ccw"
import { ActivityIndicator, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

import {
  runAppwriteDiagnostics,
  type AppwriteDiagnosticResult,
} from "@/lib/appwrite-diagnostics"
import { type Tone } from "@/lib/tone"
import { useContentPadding, useGridColumns } from "@/hooks/use-layout"
import { useThemePalette } from "@/hooks/use-theme"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { IconButton } from "@/components/ui/icon-button"
import { SectionHeader } from "@/components/ui/section-header"
import { StatTile } from "@/components/ui/stat-tile"
import { Text } from "@/components/ui/text"
import { ScrollView } from "@/components/ui/virtualized-scroll-view"
import { ScreenHeader } from "@/components/screen-header"

const STATUS_STYLES: Record<
  AppwriteDiagnosticResult["status"],
  { label: string; tone: Tone }
> = {
  success: { label: "OK", tone: "success" },
  warning: { label: "WARN", tone: "warning" },
  error: { label: "FAIL", tone: "destructive" },
}

export default function DiagnosticsScreen() {
  const theme = useThemePalette()
  const contentPadding = useContentPadding("standard")
  const columns = useGridColumns(320, "standard", 2)
  const [results, setResults] = useState<AppwriteDiagnosticResult[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    void loadDiagnostics()
  }, [])

  async function loadDiagnostics() {
    setIsLoading(true)
    try {
      const nextResults = await runAppwriteDiagnostics()
      setResults(nextResults)
    } finally {
      setIsLoading(false)
    }
  }

  const summary = useMemo(() => {
    const errors = results.filter((result) => result.status === "error").length
    const warnings = results.filter(
      (result) => result.status === "warning"
    ).length

    return { errors, warnings, total: results.length }
  }, [results])

  return (
    <SafeAreaView className="flex-1 bg-background">
      <ScreenHeader
        title="Diagnostics"
        width="standard"
        trailing={
          <IconButton
            label="Rerun diagnostics"
            size="sm"
            variant="ghost"
            className="-mr-2.5"
            onPress={() => void loadDiagnostics()}
          >
            <RefreshCcw size={20} color={theme.primary} strokeWidth={2.2} />
          </IconButton>
        }
      />

      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerClassName="gap-5"
        contentContainerStyle={{
          ...contentPadding,
          paddingTop: 4,
          paddingBottom: 32,
        }}
      >
        <SectionHeader
          eyebrow="Appwrite Diagnostics"
          title="Access Checks"
          subtitle="Verify authentication, profile access, and collection permissions from the mobile app session."
        />

        {isLoading ? (
          <Card>
            <CardContent size="compact" className="flex-row items-center gap-3">
              <ActivityIndicator color={theme.primary} />
              <Text variant="callout" className="text-muted-foreground">
                Running diagnostics...
              </Text>
            </CardContent>
          </Card>
        ) : (
          <View className="flex-row gap-3">
            <StatTile
              className="flex-1"
              label="Checks"
              value={String(summary.total)}
            />
            <StatTile
              className="flex-1"
              label="Errors"
              value={String(summary.errors)}
              tone={summary.errors > 0 ? "destructive" : "default"}
            />
            <StatTile
              className="flex-1"
              label="Warnings"
              value={String(summary.warnings)}
              tone={summary.warnings > 0 ? "warning" : "default"}
            />
          </View>
        )}

        <View className={columns > 1 ? "flex-row flex-wrap gap-3" : "gap-3"}>
          {results.map((result) => {
            const statusStyle = STATUS_STYLES[result.status]

            return (
              <Card
                key={result.key}
                style={
                  columns > 1 ? { flexBasis: "45%", flexGrow: 1 } : undefined
                }
              >
                <CardContent size="compact" className="gap-2">
                  <View className="flex-row items-start justify-between gap-3">
                    <Text variant="subheading" className="flex-1 text-sm">
                      {result.label}
                    </Text>
                    <Badge tone={statusStyle.tone} size="sm">
                      {statusStyle.label}
                    </Badge>
                  </View>
                  <Text variant="caption">{result.message}</Text>
                  {result.detail ? (
                    <Text className="text-2xs text-muted-foreground">
                      {result.detail}
                    </Text>
                  ) : null}
                </CardContent>
              </Card>
            )
          })}
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}
