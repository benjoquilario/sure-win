import { useEffect, useState } from "react"
import { useAuth } from "@/contexts/auth-context"
import { useLocalSearchParams, useRouter } from "expo-router"
import BadgeCheck from "lucide-react-native/icons/badge-check"
import CircleAlert from "lucide-react-native/icons/circle-alert"
import LoaderCircle from "lucide-react-native/icons/loader-circle"
import { View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

import { cn } from "@/lib/utils"
import { useThemePalette } from "@/hooks/use-theme"
import { Button } from "@/components/ui/button"
import { ContentFrame } from "@/components/ui/content-frame"
import { Text } from "@/components/ui/text"
import { ScrollView } from "@/components/ui/virtualized-scroll-view"

type VerificationState = "loading" | "success" | "error"

export default function VerifyEmailScreen() {
  const router = useRouter()
  const params = useLocalSearchParams<{ userId?: string; secret?: string }>()
  const completeEmailVerification = useAuth(
    (state) => state.completeEmailVerification
  )
  const isAuthenticated = useAuth((state) => state.isAuthenticated)
  const theme = useThemePalette()
  const [state, setState] = useState<VerificationState>("loading")
  const [message, setMessage] = useState(
    "We are confirming your Appwrite email verification now."
  )

  useEffect(() => {
    let cancelled = false

    async function runVerification() {
      const userId = typeof params.userId === "string" ? params.userId : ""
      const secret = typeof params.secret === "string" ? params.secret : ""

      if (!userId || !secret) {
        if (!cancelled) {
          setState("error")
          setMessage(
            "This verification link is missing the required Appwrite parameters."
          )
        }
        return
      }

      try {
        await completeEmailVerification(userId, secret)
        if (!cancelled) {
          setState("success")
          setMessage("Your email has been verified successfully.")
        }
      } catch (error) {
        if (!cancelled) {
          setState("error")
          setMessage(
            error instanceof Error
              ? error.message
              : "Unable to complete email verification."
          )
        }
      }
    }

    void runVerification()

    return () => {
      cancelled = true
    }
  }, [completeEmailVerification, params.secret, params.userId])

  return (
    <SafeAreaView className="flex-1 bg-background">
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, justifyContent: "center" }}
        contentContainerClassName="py-8"
      >
        <ContentFrame width="reading">
          <View className="items-center gap-6">
            <View className="items-center gap-3">
              <View
                className={cn(
                  "h-16 w-16 items-center justify-center rounded-lg",
                  state === "loading" && "bg-primary/10",
                  state === "success" && "bg-success/10",
                  state === "error" && "bg-accent/15"
                )}
              >
                {state === "loading" ? (
                  <LoaderCircle
                    size={28}
                    color={theme.primary}
                    strokeWidth={2.2}
                  />
                ) : state === "success" ? (
                  <BadgeCheck
                    size={28}
                    color={theme.success}
                    strokeWidth={2.2}
                  />
                ) : (
                  <CircleAlert
                    size={28}
                    color={theme.accentText}
                    strokeWidth={2.2}
                  />
                )}
              </View>

              <Text
                role="heading"
                className="text-center text-2xl font-extrabold text-foreground"
              >
                {state === "loading"
                  ? "Verifying email"
                  : state === "success"
                    ? "Email verified"
                    : "Verification failed"}
              </Text>
              <Text className="text-center text-sm leading-6 text-muted-foreground">
                {message}
              </Text>
            </View>

            {state === "success" ? (
              <Button
                size="lg"
                className="w-full"
                onPress={() => router.replace("/(tabs)/profile")}
              >
                <Text>Return to profile</Text>
              </Button>
            ) : null}

            {state === "error" ? (
              <Button
                size="lg"
                variant="outline"
                className="w-full"
                onPress={() =>
                  router.replace(
                    isAuthenticated ? "/(tabs)/profile" : "/(auth)/login"
                  )
                }
              >
                <Text>
                  {isAuthenticated ? "Back to profile" : "Go to login"}
                </Text>
              </Button>
            ) : null}
          </View>
        </ContentFrame>
      </ScrollView>
    </SafeAreaView>
  )
}
