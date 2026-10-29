import {
  Children,
  createContext,
  isValidElement,
  memo,
  useContext,
  useEffect,
  useMemo,
  type ReactElement,
  type ReactNode,
} from "react"
import { View } from "react-native"

import { Card } from "@/components/ui/card"
import { Text } from "@/components/ui/text"

/**
 * One group of settings, and the search that runs across all of them.
 *
 * The title sits above the card rather than inside it, the grouped-list
 * layout people already know from their phone's own settings. Rows inside are
 * separated by hairlines, not gaps, so a group reads as one unit.
 *
 * Search needs no index to keep in sync: a section reads `label`,
 * `description`, `keywords` and option labels straight off its child rows and
 * keeps the ones that match. A match on the section's own title keeps the
 * whole section, because "notifications" should show everything under it.
 */

type SearchState = {
  query: string
  /** Each section reports whether anything in it survived the filter. */
  report: (id: string, hasMatches: boolean) => void
}

const SettingsSearchContext = createContext<SearchState>({
  query: "",
  report: () => undefined,
})

export const SettingsSearchProvider = SettingsSearchContext.Provider

function normalize(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim()
}

/** Every word of the query must appear somewhere in the haystack. */
export function matchesQuery(query: string, haystack: readonly unknown[]) {
  const words = normalize(query).split(" ").filter(Boolean)

  if (words.length === 0) {
    return true
  }

  const text = normalize(
    haystack
      .flat()
      .filter((part): part is string => typeof part === "string")
      .join(" ")
  )

  return words.every((word) => text.includes(word))
}

type SearchableProps = {
  label?: string
  description?: string
  keywords?: readonly string[]
  options?: readonly { label: string; description?: string }[]
}

function rowHaystack(props: SearchableProps) {
  return [
    props.label,
    props.description,
    ...(props.keywords ?? []),
    ...(props.options ?? []).flatMap((option) => [
      option.label,
      option.description,
    ]),
  ]
}

type SettingsSectionProps = {
  /** Stable key for search bookkeeping. */
  id: string
  title: string
  description?: string
  /** Section-level words: "alerts" for Reminders, say. */
  keywords?: readonly string[]
  children: ReactNode
  footer?: ReactNode
}

export const SettingsSection = memo(function SettingsSection({
  id,
  title,
  description,
  keywords = [],
  children,
  footer,
}: SettingsSectionProps) {
  const { query, report } = useContext(SettingsSearchContext)

  const rows = useMemo(() => {
    const all = Children.toArray(children).filter(isValidElement)

    if (!query || matchesQuery(query, [title, description, ...keywords])) {
      return all
    }

    return all.filter((child) =>
      matchesQuery(
        query,
        rowHaystack((child as ReactElement<SearchableProps>).props)
      )
    )
  }, [children, description, keywords, query, title])

  const isVisible = rows.length > 0

  useEffect(() => {
    report(id, isVisible)
  }, [id, isVisible, report])

  if (!isVisible) {
    return null
  }

  return (
    <View className="gap-2" role="group" aria-label={title}>
      <View className="gap-0.5 px-1">
        <Text className="text-2xs font-black uppercase tracking-[1.2px] text-muted-foreground">
          {title}
        </Text>
        {description ? <Text variant="caption">{description}</Text> : null}
      </View>

      <Card>
        {rows.map((row, index) => (
          <View
            key={row.key ?? index}
            className={index > 0 ? "border-t border-border/60" : undefined}
          >
            {row}
          </View>
        ))}
      </Card>

      {footer ? <View className="px-1">{footer}</View> : null}
    </View>
  )
})
