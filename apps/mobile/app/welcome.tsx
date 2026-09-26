import { useCallback, useState } from "react"
import { useAuth } from "@/contexts/auth-context"
import { useRouter } from "expo-router"
import { Alert, Pressable, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

import type { MemberType } from "@workspace/schema"

import { useContentPadding, useLayout } from "@/hooks/use-layout"
import { Button } from "@/components/ui/button"
import { FormField, Input } from "@/components/ui/input"
import { Text } from "@/components/ui/text"
import { ScrollView } from "@/components/ui/virtualized-scroll-view"
import { MemberTypePicker } from "@/components/member/member-type-picker"

/**
 * ─── Tell us about you ────────────────────────────────────────────────────
 *
 * Asked once, right after sign-up, and **skippable** — blank is a normal
 * answer and every screen in the app works without it (section 14).
 *
 * It is worth asking because the audience is not only undergraduates:
 * graduates sitting the board, retakers, licensed social workers doing CPD,
 * instructors and review centres all subscribe, and a retaker does not need
 * the tour a first-timer needs.
 *
 * It grants nothing. A licensed social worker with no subscription sees the
 * same paywall as anybody else.
 */
export default function WelcomeScreen() {
  const router = useRouter()
  const profile = useAuth((state) => state.profile)
  const user = useAuth((state) => state.user)
  const updateProfile = useAuth((state) => state.updateProfile)

  const [memberType, setMemberType] = useState<MemberType | null>(
    profile?.memberType ?? null
  )
  const [schoolOrEmployer, setSchoolOrEmployer] = useState(
    profile?.schoolOrEmployer ?? ""
  )
  const [isSaving, setIsSaving] = useState(false)
  const { isSmallPhone } = useLayout()
  const { paddingHorizontal } = useContentPadding("reading")

  const goToApp = useCallback(() => router.replace("/(tabs)"), [router])

  const handleSave = useCallback(async () => {
    setIsSaving(true)

    try {
      await updateProfile({
        fullName: profile?.fullName ?? user?.name ?? "Reviewer",
        memberType,
        schoolOrEmployer,
      })

      goToApp()
    } catch (error) {
      // Never a dead end: this whole screen is optional, so a failure here
      // must not trap somebody outside the app they just signed up for.
      Alert.alert(
        "We could not save that",
        error instanceof Error
          ? error.message
          : "You can add these details later from your profile.",
        [{ text: "Continue", onPress: goToApp }]
      )
    } finally {
      setIsSaving(false)
    }
  }, [
    goToApp,
    memberType,
    profile?.fullName,
    schoolOrEmployer,
    updateProfile,
    user?.name,
  ])

  return (
    <SafeAreaView className="flex-1 bg-background">
      <ScrollView
        contentContainerClassName="gap-6 pb-8 pt-6"
        // flexGrow, not flex: the spacer below pushes the actions down on a
        // tall screen, but a short one (or an open keyboard) must still scroll.
        contentContainerStyle={{
          flexGrow: 1,
          paddingHorizontal: Math.max(paddingHorizontal, isSmallPhone ? 0 : 24),
        }}
        automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        showsVerticalScrollIndicator={false}
      >
        <View className="gap-2">
          <Text variant="eyebrow">One quick question</Text>
          <Text
            role="heading"
            className={
              isSmallPhone
                ? "text-2xl font-extrabold text-foreground"
                : "text-3xl font-extrabold text-foreground"
            }
          >
            Where are you in your journey?
          </Text>
          <Text variant="callout" className="text-muted-foreground">
            It shapes the tips and announcements you get. You can change it any
            time, and skipping is completely fine.
          </Text>
        </View>

        <MemberTypePicker
          value={memberType}
          onChange={setMemberType}
          label="I am a…"
          helper="Optional."
        />

        <FormField
          label="School or employer"
          hint="Your BSSW school, review centre, or agency."
        >
          <Input
            value={schoolOrEmployer}
            onChangeText={setSchoolOrEmployer}
            placeholder="Optional"
            autoCapitalize="words"
          />
        </FormField>

        <View className="flex-1" />

        <View className="gap-3">
          <Button
            size="xl"
            disabled={isSaving}
            onPress={() => void handleSave()}
          >
            <Text>{isSaving ? "Saving…" : "Continue"}</Text>
          </Button>

          <Pressable
            role="button"
            onPress={goToApp}
            hitSlop={8}
            className="min-h-11 items-center justify-center self-center px-3 web:hover:opacity-80"
          >
            <Text className="text-sm font-bold text-muted-foreground">
              Skip for now
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}
