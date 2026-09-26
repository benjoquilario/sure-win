import { Link } from "expo-router"
import ArrowLeft from "lucide-react-native/icons/arrow-left"
import { SafeAreaView } from "react-native-safe-area-context"

import { useContentPadding } from "@/hooks/use-layout"
import { useThemePalette } from "@/hooks/use-theme"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Text } from "@/components/ui/text"
import { ScrollView } from "@/components/ui/virtualized-scroll-view"

export default function ModalScreen() {
  const theme = useThemePalette()
  const contentPadding = useContentPadding("reading")

  return (
    <SafeAreaView className="flex-1 bg-background">
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerClassName="gap-3 py-6"
        contentContainerStyle={contentPadding}
      >
        <Text variant="title" className="mb-1 text-2xl">
          Imports Glossary
        </Text>

        <Card>
          <CardContent className="gap-2">
            <Text className="text-sm font-bold">
              import {"{ useState }"} from &apos;react&apos;
            </Text>
            <Text className="text-sm leading-5 text-muted-foreground">
              Stores local state in a functional component.
            </Text>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="gap-2">
            <Text className="text-sm font-bold">
              import {"{ View, Text, Pressable }"} from &apos;react-native&apos;
            </Text>
            <Text className="text-sm leading-5 text-muted-foreground">
              Core building blocks: layout containers, text rendering, and touch
              interactions.
            </Text>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="gap-2">
            <Text className="text-sm font-bold">
              import {"{ Stack, Tabs, Link }"} from &apos;expo-router&apos;
            </Text>
            <Text className="text-sm leading-5 text-muted-foreground">
              Expo Router primitives for file-based navigation and screen
              transitions.
            </Text>
          </CardContent>
        </Card>

        <Link href="/learn" dismissTo asChild>
          <Button size="lg" className="mt-2">
            <ArrowLeft size={16} color={theme.primaryForeground} />
            <Text>Back to Learn tab</Text>
          </Button>
        </Link>
      </ScrollView>
    </SafeAreaView>
  )
}
