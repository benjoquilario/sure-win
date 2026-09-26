import { useState } from "react"
import { useAuth } from "@/contexts/auth-context"
import { useRouter } from "expo-router"
import Eye from "lucide-react-native/icons/eye"
import EyeOff from "lucide-react-native/icons/eye-off"
import Lock from "lucide-react-native/icons/lock"
import Mail from "lucide-react-native/icons/mail"
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  View,
} from "react-native"
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context"

import { cn } from "@/lib/utils"
import { useContentPadding, useLayout } from "@/hooks/use-layout"
import { useTheme } from "@/hooks/use-theme"
import { BrandLogo } from "@/components/ui/brand-logo"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { IconButton } from "@/components/ui/icon-button"
import { FormField, Input } from "@/components/ui/input"
import { Text } from "@/components/ui/text"
import { ScrollView } from "@/components/ui/virtualized-scroll-view"

export default function LoginScreen() {
  const router = useRouter()
  const login = useAuth((state) => state.login)
  const insets = useSafeAreaInsets()
  const { theme } = useTheme()
  const { isCompact, isSmallPhone } = useLayout()
  const { paddingHorizontal } = useContentPadding("reading")
  // Past phone width the form becomes a raised panel in a centred column,
  // rather than fields stretched across a tablet or a browser window.
  const Panel = isCompact ? View : Card

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleLogin() {
    if (!email.trim() || !password.trim()) {
      setError("Please enter your email and password.")
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      await login(email.trim(), password)
      router.replace("/(tabs)")
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Login failed. Please try again."
      setError(message)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-background">
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Math.max(insets.top, 12)}
        className="flex-1"
      >
        <ScrollView
          automaticallyAdjustKeyboardInsets
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={{
            // Auth keeps its roomier 24pt phone margin (12pt under 360pt).
            paddingHorizontal: Math.max(
              paddingHorizontal,
              isSmallPhone ? 0 : 24
            ),
            flexGrow: 1,
            justifyContent: "center",
            paddingTop: 24,
            paddingBottom: Math.max(insets.bottom, 24) + 24,
          }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
        >
          <Panel className={cn("gap-6", !isCompact && "px-8 py-10")}>
            {/* Brand + heading */}
            <View className="gap-5">
              {/* The full signature: this is the one screen where the brand is
                the point, so it gets the mark and the wordmark together. */}
              <BrandLogo size="lg" variant="lockup" className="self-start" />
              <View className="gap-1.5">
                <Text
                  role="heading"
                  className={cn(
                    "font-extrabold text-foreground",
                    isSmallPhone ? "text-2xl" : "text-3xl"
                  )}
                >
                  Welcome back
                </Text>
                <Text className="text-sm leading-6 text-muted-foreground">
                  Sign in to continue your drills and keep your study streak
                  moving.
                </Text>
              </View>
            </View>

            {/* Form */}
            <View className="gap-3">
              {error ? (
                <View
                  role="alert"
                  className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3"
                >
                  <Text className="text-sm text-destructive">{error}</Text>
                </View>
              ) : null}

              {/* Email field */}
              <FormField label="Email">
                <Input
                  leading={<Mail size={16} color={theme.mutedForeground} />}
                  placeholder="your@email.com"
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  returnKeyType="next"
                />
              </FormField>

              {/* Password field */}
              <FormField label="Password">
                <Input
                  leading={<Lock size={16} color={theme.mutedForeground} />}
                  trailing={
                    <IconButton
                      label={showPassword ? "Hide password" : "Show password"}
                      size="sm"
                      className="-mr-2 h-9 w-9"
                      onPress={() => setShowPassword((prev) => !prev)}
                    >
                      {showPassword ? (
                        <EyeOff size={16} color={theme.mutedForeground} />
                      ) : (
                        <Eye size={16} color={theme.mutedForeground} />
                      )}
                    </IconButton>
                  }
                  placeholder="Enter your password"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  returnKeyType="done"
                  onSubmitEditing={handleLogin}
                />
              </FormField>

              {/* Sign in button */}
              <Button
                size="lg"
                className="mt-1"
                onPress={handleLogin}
                disabled={isLoading}
              >
                {isLoading ? (
                  <ActivityIndicator color={theme.primaryForeground} />
                ) : (
                  <Text>Sign In</Text>
                )}
              </Button>
            </View>

            {/* Register link */}
            <View className="flex-row flex-wrap items-center justify-center gap-x-1">
              <Text className="text-sm text-muted-foreground">
                Don&apos;t have an account?
              </Text>
              <Pressable
                role="link"
                hitSlop={8}
                className="min-h-11 justify-center web:hover:opacity-80"
                onPress={() => router.push("/(auth)/register")}
              >
                <Text className="text-sm font-bold text-primary">
                  Create one
                </Text>
              </Pressable>
            </View>

            <Pressable
              role="link"
              hitSlop={8}
              onPress={() => router.push("/diagnostics")}
              className="min-h-11 items-center justify-center self-center px-2 web:hover:opacity-80"
            >
              <Text className="text-sm font-bold text-primary">
                Open diagnostics
              </Text>
            </Pressable>
          </Panel>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}
