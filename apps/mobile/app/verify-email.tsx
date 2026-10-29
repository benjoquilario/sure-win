import { useEffect, useState } from "react"
import { useAuth } from "@/contexts/auth-context"
import { useLocalSearchParams, useRouter } from "expo-router"
import BadgeCheck from "lucide-react-native/icons/badge-check"
import CircleAlert from "lucide-react-native/icons/circle-alert"
import Clock3 from "lucide-react-native/icons/clock-3"
import LoaderCircle from "lucide-react-native/icons/loader-circle"
import MailCheck from "lucide-react-native/icons/mail-check"
import { View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

import { cn } from "@/lib/utils"
import { useThemePalette } from "@/hooks/use-theme"
import { BrandLogo } from "@/components/ui/brand-logo"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { ContentFrame } from "@/components/ui/content-frame"
import { FadeInView } from "@/components/ui/motion"
import { Text } from "@/components/ui/text"
import { ScrollView } from "@/components/ui/virtualized-scroll-view"

/**
 * ─── Email verification, the app's side ───────────────────────────────────
 *
 * The verification email now opens the CMS (`/verify-email`), which completes
 * the verification in the browser on any device and then offers to open the
 * app with the result:
 *
 *   reviewer://verify-email?status=verified   done — re-read the account
 *   reviewer://verify-email?status=expired    the link was spent or too old
 *
 * Emails sent before that change still carry `userId` and `secret` for the
 * app to complete itself, so that path stays until those links have expired
 * (seven days).
 *
 * The screen has one job per state and one primary action for it, mirroring
 * the CMS page so the hand-off reads as one flow.
 */

type Phase = "checking" | "verified" | "expired" | "sent" | "error"

type Tone = "primary" | "success" | "warning" | "destructive"

function readParam(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? ""
}

/** Appwrite's "invalid token": the secret was spent or is past seven days. */
function isSpentLinkError(error: unknown) {
  return (error as { code?: number } | null)?.code === 401
}

export default function VerifyEmailScreen() {
  const router = useRouter()
  const theme = useThemePalette()
  const params = useLocalSearchParams<{
    userId?: string
    secret?: string
    status?: string
  }>()
  const completeEmailVerification = useAuth(
    (state) => state.completeEmailVerification
  )
  const reloadUser = useAuth((state) => state.reloadUser)
  const sendVerificationEmail = useAuth((state) => state.sendVerificationEmail)
  const isAuthenticated = useAuth((state) => state.isAuthenticated)
  const email = useAuth((state) => state.user?.email ?? "")

  const userId = readParam(params.userId)
  const secret = readParam(params.secret)
  const status = readParam(params.status)

  const isLegacyLink = Boolean(userId && secret)

  // What the link alone already says, so no effect has to set it: an expired
  // or malformed link is known before anything is fetched.
  const [phase, setPhase] = useState<Phase>(() =>
    isLegacyLink || status === "verified"
      ? "checking"
      : status === "expired"
        ? "expired"
        : "error"
  )
  const [errorMessage, setErrorMessage] = useState<string | null>(() =>
    isLegacyLink || status === "verified" || status === "expired"
      ? null
      : "This link is missing the details needed to verify."
  )
  const [attempt, setAttempt] = useState(0)
  const [isSending, setIsSending] = useState(false)
  // What "Try again" should repeat. A malformed link has nothing to repeat,
  // so it offers no retry at all rather than one that cannot work.
  const [failedStep, setFailedStep] = useState<"verify" | "resend" | null>(null)

  // Old links: the app completes the verification itself. Keyed to the link
  // alone — re-running it when sign-in state changes would spend the token
  // twice and report a success as "expired".
  useEffect(() => {
    if (!userId || !secret) {
      return
    }

    let cancelled = false

    completeEmailVerification(userId, secret)
      .then(() => {
        if (!cancelled) setPhase("verified")
      })
      .catch((error: unknown) => {
        if (cancelled) return
        if (isSpentLinkError(error)) {
          setPhase("expired")
          return
        }
        setErrorMessage(
          error instanceof Error ? error.message : "Verification failed."
        )
        setFailedStep("verify")
        setPhase("error")
      })

    return () => {
      cancelled = true
    }
  }, [attempt, completeEmailVerification, secret, userId])

  // New links: the CMS already did it; the app only catches up. Re-runs once
  // sign-in finishes on a cold start, so the badge on the profile updates.
  useEffect(() => {
    if (isLegacyLink || status !== "verified") {
      return
    }

    let cancelled = false
    const refresh = isAuthenticated ? reloadUser() : Promise.resolve()

    refresh
      .catch(() => {
        // Verified either way; a failed refresh only delays the badge.
      })
      .finally(() => {
        if (!cancelled) setPhase("verified")
      })

    return () => {
      cancelled = true
    }
  }, [attempt, isAuthenticated, isLegacyLink, reloadUser, status])

  async function handleResend() {
    setIsSending(true)

    try {
      await sendVerificationEmail()
      setPhase("sent")
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "We could not send a new link. Try again in a moment."
      )
      setFailedStep("resend")
      setPhase("error")
    } finally {
      setIsSending(false)
    }
  }

  const goHome = () =>
    router.replace(isAuthenticated ? "/(tabs)/profile" : "/(auth)/login")

  const view: {
    tone: Tone
    Icon: typeof BadgeCheck
    title: string
    body: string
    footnote?: string
  } =
    phase === "checking"
      ? {
          tone: "primary",
          Icon: LoaderCircle,
          title: "Checking your link…",
          body: "This only takes a moment.",
        }
      : phase === "verified"
        ? {
            tone: "success",
            Icon: BadgeCheck,
            title: "Email verified",
            body: "Your email address is confirmed. You're all set.",
            footnote: "You can close the browser tab you came from.",
          }
        : phase === "expired"
          ? {
              tone: "warning",
              Icon: Clock3,
              title: "This link has expired",
              body: "Verification links work once and last seven days. Send yourself a new one.",
              footnote: "Requested more than one? Only the newest link works.",
            }
          : phase === "sent"
            ? {
                tone: "primary",
                Icon: MailCheck,
                title: "New link sent",
                body: email
                  ? `We sent a fresh link to ${email}. It can take a minute to arrive.`
                  : "We sent a fresh link. It can take a minute to arrive.",
                footnote: "Not there? Check your spam or promotions folder.",
              }
            : {
                tone: "destructive",
                Icon: CircleAlert,
                title: "We couldn't verify you",
                body:
                  errorMessage ??
                  "Something went wrong. Try again in a moment.",
              }

  const toneColor = {
    primary: theme.primary,
    success: theme.success,
    warning: theme.accentText,
    destructive: theme.destructive,
  }[view.tone]

  return (
    <SafeAreaView className="flex-1 bg-background">
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, justifyContent: "center" }}
        contentContainerClassName="py-8"
      >
        <ContentFrame width="reading" className="gap-6">
          <View className="items-center">
            <BrandLogo size="md" />
          </View>

          <FadeInView key={phase}>
            <Card>
              <CardContent
                className="items-center gap-4 pb-6 pt-7"
                accessibilityLiveRegion="polite"
              >
                <View
                  className={cn(
                    "h-16 w-16 items-center justify-center rounded-full",
                    view.tone === "primary" && "bg-primary/10",
                    view.tone === "success" && "bg-success/15",
                    view.tone === "warning" && "bg-accent/15",
                    view.tone === "destructive" && "bg-destructive/10"
                  )}
                >
                  <view.Icon size={30} color={toneColor} strokeWidth={2.3} />
                </View>

                <View className="items-center gap-1.5">
                  <Text
                    role="heading"
                    className="text-center text-2xl font-extrabold text-card-foreground"
                  >
                    {view.title}
                  </Text>
                  <Text className="text-center text-sm leading-6 text-muted-foreground">
                    {view.body}
                  </Text>
                </View>

                <View className="w-full gap-2.5 pt-1">
                  {phase === "verified" || phase === "sent" ? (
                    <Button size="lg" onPress={goHome}>
                      <Text>
                        {isAuthenticated ? "Back to my profile" : "Sign in"}
                      </Text>
                    </Button>
                  ) : null}

                  {phase === "expired" ? (
                    isAuthenticated ? (
                      <>
                        <Button
                          size="lg"
                          disabled={isSending}
                          onPress={() => void handleResend()}
                        >
                          <Text>
                            {isSending ? "Sending…" : "Send a new link"}
                          </Text>
                        </Button>
                        <Button size="lg" variant="ghost" onPress={goHome}>
                          <Text>Not now</Text>
                        </Button>
                      </>
                    ) : (
                      <Button size="lg" onPress={goHome}>
                        <Text>Sign in to send a new link</Text>
                      </Button>
                    )
                  ) : null}

                  {phase === "error" ? (
                    <>
                      {failedStep ? (
                        <Button
                          size="lg"
                          disabled={isSending}
                          onPress={() => {
                            setErrorMessage(null)

                            if (failedStep === "resend") {
                              void handleResend()
                              return
                            }

                            setPhase("checking")
                            setAttempt((count) => count + 1)
                          }}
                        >
                          <Text>{isSending ? "Sending…" : "Try again"}</Text>
                        </Button>
                      ) : null}
                      <Button size="lg" variant="ghost" onPress={goHome}>
                        <Text>
                          {isAuthenticated
                            ? "Back to my profile"
                            : "Go to sign in"}
                        </Text>
                      </Button>
                    </>
                  ) : null}
                </View>
              </CardContent>

              {view.footnote ? (
                <View className="border-t border-border/60 px-5 py-3.5">
                  <Text variant="caption" className="text-center">
                    {view.footnote}
                  </Text>
                </View>
              ) : null}
            </Card>
          </FadeInView>
        </ContentFrame>
      </ScrollView>
    </SafeAreaView>
  )
}
