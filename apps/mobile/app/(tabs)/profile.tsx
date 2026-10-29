import { useCallback, useEffect, useMemo, useState } from "react"
import { useAuth } from "@/contexts/auth-context"
import {
  ProfileProvider,
  useProfileEditState,
} from "@/contexts/profile-context"
import { useQuery } from "@tanstack/react-query"
import * as ImagePicker from "expo-image-picker"
import { useRouter } from "expo-router"
import Settings from "lucide-react-native/icons/settings"
import { Alert, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

import { useAppPreferences } from "@/lib/app-preferences"
import { getAvatarUrl, getInitials } from "@/lib/auth"
import { buildExamCountdown, parseExamDate } from "@/lib/exam-countdown"
import { prepareImageForUpload } from "@/lib/image-upload"
import { listLearningSubjects } from "@/lib/learning-content"
import { getMembership } from "@/lib/member/membership"
import { getMemberTypeDisplay } from "@/lib/member/profile"
import { getStaggerDelay } from "@/lib/motion"
import { getOverallPerformanceStats } from "@/lib/performance-stats"
import { getUserActivityFeed } from "@/lib/progress"
import {
  buildRecentActivityEntries,
  buildStudyProgressSummary,
  buildSubjectProgressItems,
} from "@/lib/study-dashboard"
import { useContentPadding, useGridColumns } from "@/hooks/use-layout"
import { useIsPremium } from "@/hooks/use-membership"
import { useThemePalette } from "@/hooks/use-theme"
import { DatePickerDialog } from "@/components/ui/date-picker-dialog"
import { IconButton } from "@/components/ui/icon-button"
import { FadeInView } from "@/components/ui/motion"
import { ScrollView } from "@/components/ui/virtualized-scroll-view"
import { AppShellHeader } from "@/components/app-shell-header"
import {
  AchievementsSection,
  ExamReadinessCard,
  getAchievementBadgeMeta,
  ProfileEditDialog,
  ProfileOverviewCard,
  ProfileProgressCard,
  ProfileStatsGrid,
  ProfileVerifyEmailCard,
  type AchievementCardItem,
} from "@/components/profile"
import { RecentActivitySection } from "@/components/study/recent-activity"
import {
  SubjectProgressSection,
  type SubjectRailItem,
} from "@/components/study/subject-progress-section"

const SUBJECT_PREVIEW_COUNT = 6
const ACHIEVEMENT_PREVIEW_COUNT = 6
const RECENT_ACTIVITY_COUNT = 4

/**
 * ─── My Profile ───────────────────────────────────────────────────────────
 *
 * Laid out like an account page in a professional tool: who you are and what
 * your plan is first, then where you stand for the exam, then the detail
 * behind it, then the facts you can edit. On a tablet or browser it splits
 * into two columns, account on the left and performance on the right, so the
 * page reads across instead of scrolling a single narrow strip.
 */

/** "Retaker", not "Retaker - has sat the board exam before". */
function toShortMemberType(label: string) {
  return label.split(" - ")[0]?.trim() || label
}

const ACHIEVEMENT_DATE_FMT = new Intl.DateTimeFormat("en-PH", {
  month: "short",
  day: "numeric",
})

function ProfileScreenContent() {
  const router = useRouter()
  const theme = useThemePalette()
  const user = useAuth((state) => state.user)
  const profile = useAuth((state) => state.profile)
  const refreshProfile = useAuth((state) => state.refreshProfile)
  const uploadProfilePhoto = useAuth((state) => state.uploadProfilePhoto)
  const updateProfile = useAuth((state) => state.updateProfile)
  const sendVerificationEmail = useAuth((state) => state.sendVerificationEmail)

  const contentPadding = useContentPadding("wide")
  // Account column and performance column side by side once each keeps
  // 380pt, which is a portrait iPad and up.
  const isTwoColumn = useGridColumns(380, "wide", 2) >= 2

  const examDate = useAppPreferences((state) => state.preferences.examDate)
  const setPreference = useAppPreferences((state) => state.setPreference)
  const [isExamPickerOpen, setIsExamPickerOpen] = useState(false)
  const [isSendingVerification, setIsSendingVerification] = useState(false)
  // Flag *and* date — the cached flag alone keeps a lapsed member premium
  // until a server sweep catches up (section 6).
  const isPremiumUser = useIsPremium()

  const {
    isEditOpen,
    setIsEditOpen,
    openEditDialog: openProfileEditDialog,
    isSubmitting,
    setIsSubmitting,
    isUploadingAvatar,
    setIsUploadingAvatar,
    fullName,
    setFullName,
    memberType,
    setMemberType,
    schoolOrEmployer,
    setSchoolOrEmployer,
    licenseNumber,
    setLicenseNumber,
    avatarUrl,
    setAvatarUrl,
    clearAvatarUrl,
  } = useProfileEditState()

  useEffect(() => {
    if (!profile) void refreshProfile()
  }, [profile, refreshProfile])

  // ─── Identity ───────────────────────────────────────────────────

  const displayName = profile?.fullName ?? user?.name ?? "Reviewer"
  const email = profile?.email ?? user?.email ?? ""
  const emailVerified = user?.emailVerification === true
  const initials = getInitials(displayName)
  const avatarSource = useMemo(
    () => profile?.avatarUrl?.trim() || getAvatarUrl(displayName),
    [displayName, profile?.avatarUrl]
  )

  // Who they said they are, or "Not said" — never a guess, and never a role.
  const roleLabel = getMemberTypeDisplay(profile)
  const shortRoleLabel = profile?.memberType
    ? toShortMemberType(roleLabel)
    : null
  // The paywall answer, date included — never the cached flag on its own.
  const membership = useMemo(() => getMembership(profile), [profile])
  const school = profile?.schoolOrEmployer ?? undefined

  // ─── Data ───────────────────────────────────────────────────────

  const activityQuery = useQuery({
    queryKey: ["profile-activity", user?.$id],
    enabled: Boolean(user?.$id),
    queryFn: () =>
      getUserActivityFeed(
        { userId: user?.$id ?? "" },
        {
          sessionsLimit: 80,
          learningHistoryLimit: 80,
          achievementsLimit: 12,
        }
      ),
    staleTime: 1000 * 20,
  })

  const performanceQuery = useQuery({
    queryKey: ["profile-overall-performance", user?.$id],
    enabled: Boolean(user?.$id),
    queryFn: () => getOverallPerformanceStats(user?.$id ?? ""),
    staleTime: 1000 * 15,
  })

  const subjectsQuery = useQuery({
    queryKey: ["profile-review-subjects", isPremiumUser],
    queryFn: () => listLearningSubjects({ viewerIsPremium: isPremiumUser }),
  })

  // ─── Derived ────────────────────────────────────────────────────

  const activityFeed = activityQuery.data ?? null
  const countdown = useMemo(() => buildExamCountdown(examDate), [examDate])

  const allSubjectItems = useMemo(
    () =>
      buildSubjectProgressItems(subjectsQuery.data ?? [], activityFeed, theme),
    [activityFeed, subjectsQuery.data, theme]
  )

  const subjectItems = useMemo(
    () => allSubjectItems.slice(0, SUBJECT_PREVIEW_COUNT),
    [allSubjectItems]
  )

  const progressSummary = useMemo(
    () => buildStudyProgressSummary(allSubjectItems, activityFeed),
    [activityFeed, allSubjectItems]
  )

  // The sittings the average score is built from, so the readiness verdict
  // can say how much evidence is behind it.
  const completedSittings = useMemo(
    () =>
      (activityFeed?.sessions ?? []).filter(
        (session) => session.status === "completed"
      ).length,
    [activityFeed]
  )

  const achievementItems = useMemo<AchievementCardItem[]>(
    () =>
      (activityFeed?.achievements ?? [])
        .slice(0, ACHIEVEMENT_PREVIEW_COUNT)
        .map((achievement) => {
          const badge = getAchievementBadgeMeta(achievement)

          return {
            id: achievement.id,
            badge,
            title: badge.badgeName,
            caption:
              achievement.description?.trim() ||
              `Earned ${ACHIEVEMENT_DATE_FMT.format(new Date(achievement.earnedAt))}`,
            tone: badge.tone,
          }
        }),
    [activityFeed]
  )

  const recentActivityItems = useMemo(
    () =>
      buildRecentActivityEntries(activityFeed, RECENT_ACTIVITY_COUNT).map(
        (entry) => ({
          id: entry.id,
          Icon: entry.Icon,
          title: entry.title,
          timeLabel: entry.timeLabel,
          scoreLabel: entry.scoreLabel,
          tone: entry.tone,
          onPress: entry.resumeAttemptId
            ? () => router.push("/board-exams")
            : undefined,
        })
      ),
    [activityFeed, router]
  )

  const activityErrorMessage =
    activityQuery.error instanceof Error
      ? activityQuery.error.message
      : activityQuery.error
        ? "Unable to load your recent activity right now."
        : null

  const subjectsErrorMessage =
    subjectsQuery.error instanceof Error
      ? subjectsQuery.error.message
      : subjectsQuery.error
        ? "Unable to load review subjects from Appwrite."
        : null

  // ─── Callbacks ──────────────────────────────────────────────────

  const goToSettings = useCallback(() => router.push("/settings"), [router])
  const goToDashboard = useCallback(() => router.push("/dashboard"), [router])
  const goToLearn = useCallback(() => router.push("/learn"), [router])
  const goToPremium = useCallback(() => router.push("/premium"), [router])
  const goToPractice = useCallback(() => router.push("/mode"), [router])

  const handleConfirmExamDate = useCallback(
    (date: Date) => {
      // 8:00 AM, when Philippine licensure exams start: the same time Home
      // and Settings store, so the three never disagree.
      setPreference(
        "examDate",
        new Date(
          date.getFullYear(),
          date.getMonth(),
          date.getDate(),
          8,
          0,
          0,
          0
        ).toISOString()
      )
      setIsExamPickerOpen(false)
    },
    [setPreference]
  )

  const handleClearExamDate = useCallback(() => {
    setPreference("examDate", null)
    setIsExamPickerOpen(false)
  }, [setPreference])

  const openEditDialog = useCallback(() => {
    openProfileEditDialog({
      fullName: profile?.fullName ?? user?.name ?? "",
      memberType: profile?.memberType ?? null,
      schoolOrEmployer: profile?.schoolOrEmployer ?? "",
      licenseNumber: profile?.licenseNumber ?? "",
      avatarUrl: profile?.avatarUrl ?? "",
    })
  }, [
    openProfileEditDialog,
    profile?.avatarUrl,
    profile?.fullName,
    profile?.licenseNumber,
    profile?.memberType,
    profile?.schoolOrEmployer,
    user?.name,
  ])

  const handlePickProfilePhoto = useCallback(async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!permission.granted) {
      Alert.alert(
        "Permission needed",
        "Allow photo library access to choose a profile picture."
      )
      return
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 1,
      selectionLimit: 1,
    })
    if (result.canceled || result.assets.length === 0) return

    const asset = result.assets[0]

    setIsUploadingAvatar(true)
    try {
      // Avatars are served through a 512x512 preview, so anything larger is
      // upload and storage paid for pixels nobody sees. Picked at quality 1
      // because the single re-encode that matters happens here.
      const prepared = await prepareImageForUpload(asset, {
        maxEdge: 512,
        compress: 0.8,
        baseName: "profile",
      })

      const uploadedAvatarUrl = await uploadProfilePhoto(prepared)
      setAvatarUrl(uploadedAvatarUrl)
      Alert.alert("Photo uploaded", "Your new profile photo is ready to save.")
    } catch (error) {
      Alert.alert(
        "Upload failed",
        error instanceof Error
          ? error.message
          : "Unable to upload your profile photo right now."
      )
    } finally {
      setIsUploadingAvatar(false)
    }
  }, [setAvatarUrl, setIsUploadingAvatar, uploadProfilePhoto])

  const handleSaveProfile = useCallback(async () => {
    setIsSubmitting(true)
    try {
      await updateProfile({
        fullName,
        memberType,
        schoolOrEmployer,
        licenseNumber,
        avatarUrl,
      })
      setIsEditOpen(false)
      Alert.alert("Profile updated", "Your profile details were saved.")
    } catch (error) {
      Alert.alert(
        "Update failed",
        error instanceof Error
          ? error.message
          : "Unable to update your profile right now."
      )
    } finally {
      setIsSubmitting(false)
    }
  }, [
    avatarUrl,
    fullName,
    licenseNumber,
    memberType,
    schoolOrEmployer,
    setIsEditOpen,
    setIsSubmitting,
    updateProfile,
  ])

  const handleSendVerification = useCallback(async () => {
    setIsSendingVerification(true)
    try {
      await sendVerificationEmail()
      Alert.alert(
        "Verification sent",
        "Check your inbox and open the verification link on this device."
      )
    } catch (error) {
      Alert.alert(
        "Unable to send verification",
        error instanceof Error
          ? error.message
          : "Verification email could not be sent."
      )
    } finally {
      setIsSendingVerification(false)
    }
  }, [sendVerificationEmail])

  const handlePressSubject = useCallback(
    (item: SubjectRailItem) => {
      if (item.isLocked) {
        router.push({
          pathname: "/premium",
          params: { source: "subject", title: item.title, categoryId: item.id },
        })
        return
      }

      router.push({
        pathname: "/review/[categoryId]",
        params: { categoryId: item.id },
      })
    },
    [router]
  )

  // ─── Render ─────────────────────────────────────────────────────

  const overview = (
    <ProfileOverviewCard
      displayName={displayName}
      email={email}
      initials={initials}
      avatarUrl={avatarSource}
      memberTypeLabel={shortRoleLabel}
      school={school ?? null}
      licenseNumber={
        profile?.memberType === "professional"
          ? (profile.licenseNumber ?? null)
          : null
      }
      memberSince={profile?.createdAt ?? user?.$createdAt ?? null}
      isVerified={emailVerified}
      membership={membership}
      onEdit={openEditDialog}
      onManagePlan={goToPremium}
    />
  )

  // The Membership card, Personal details list and Shortcuts list that used
  // to follow are gone: the overview now carries the plan row and every fact
  // they listed, editing is its pencil, Settings is the header button, and
  // the dashboard is "View details" on the progress card.

  const readinessBlock = (
    <View className="gap-3">
      <ExamReadinessCard
        isLoading={activityQuery.isLoading}
        averageScore={progressSummary.averageScore}
        sittings={completedSittings}
        countdown={countdown}
        onSetExamDate={() => setIsExamPickerOpen(true)}
        onPractice={goToPractice}
      />
      <ProfileStatsGrid
        isLoading={activityQuery.isLoading || performanceQuery.isLoading}
        questionsAnswered={
          performanceQuery.data?.totalAnswered ??
          progressSummary.questionsSolved
        }
        accuracyPercent={performanceQuery.data?.correctPercent ?? 0}
        dayStreak={progressSummary.dayStreak}
        hoursStudied={progressSummary.hoursStudied}
      />
    </View>
  )

  const progressBlocks = (
    <>
      <FadeInView delay={getStaggerDelay(3)}>
        <ProfileProgressCard
          theme={theme}
          isLoading={activityQuery.isLoading || subjectsQuery.isLoading}
          progressPercent={progressSummary.progressPercent}
          topicsStudied={progressSummary.topicsStudied}
          topicsTotal={progressSummary.topicsTotal}
          onPressViewDetails={goToDashboard}
        />
      </FadeInView>

      <FadeInView delay={getStaggerDelay(4)}>
        <SubjectProgressSection
          theme={theme}
          title="Subjects"
          items={subjectItems}
          isLoading={subjectsQuery.isLoading}
          errorMessage={subjectsErrorMessage}
          onPressItem={handlePressSubject}
          onPressSeeAll={goToLearn}
        />
      </FadeInView>

      <FadeInView delay={getStaggerDelay(5)}>
        <AchievementsSection
          theme={theme}
          items={achievementItems}
          isLoading={activityQuery.isLoading}
          onPressSeeAll={goToDashboard}
        />
      </FadeInView>

      <FadeInView delay={getStaggerDelay(6)}>
        <RecentActivitySection
          theme={theme}
          items={recentActivityItems}
          isLoading={activityQuery.isLoading}
          errorMessage={activityErrorMessage}
          onPressSeeAll={goToDashboard}
        />
      </FadeInView>
    </>
  )

  return (
    <SafeAreaView
      className="flex-1 bg-background"
      edges={["top", "left", "right"]}
    >
      <ScrollView
        contentContainerClassName="gap-4 pt-3"
        contentContainerStyle={{ ...contentPadding, paddingBottom: 32 }}
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
      >
        <AppShellHeader
          compact
          eyebrow="Account"
          title="My Profile"
          trailing={
            <IconButton label="Settings" variant="soft" onPress={goToSettings}>
              <Settings size={20} color={theme.primary} strokeWidth={2.2} />
            </IconButton>
          }
        />

        {!emailVerified ? (
          <ProfileVerifyEmailCard
            theme={theme}
            email={email}
            isSending={isSendingVerification}
            onSendVerification={() => void handleSendVerification()}
          />
        ) : null}

        {isTwoColumn ? (
          <View className="flex-row items-start gap-5">
            <View className="gap-4" style={{ flex: 2 }}>
              <FadeInView delay={getStaggerDelay(0)}>{overview}</FadeInView>
              <FadeInView delay={getStaggerDelay(1)}>
                {readinessBlock}
              </FadeInView>
            </View>

            <View className="gap-4" style={{ flex: 3 }}>
              {progressBlocks}
            </View>
          </View>
        ) : (
          <>
            <FadeInView delay={getStaggerDelay(0)}>{overview}</FadeInView>
            <FadeInView delay={getStaggerDelay(1)}>{readinessBlock}</FadeInView>
            {progressBlocks}
          </>
        )}
      </ScrollView>

      <DatePickerDialog
        open={isExamPickerOpen}
        onOpenChange={setIsExamPickerOpen}
        value={parseExamDate(examDate)}
        title="Your board exam date"
        description="Your profile and Home count down the days to it."
        confirmLabel="Save exam date"
        onConfirm={handleConfirmExamDate}
        onClear={examDate ? handleClearExamDate : undefined}
      />

      <ProfileEditDialog
        open={isEditOpen}
        theme={theme}
        initials={initials}
        avatarPreview={avatarUrl || profile?.avatarUrl || avatarSource}
        fullName={fullName}
        memberType={memberType}
        schoolOrEmployer={schoolOrEmployer}
        licenseNumber={licenseNumber}
        isUploadingAvatar={isUploadingAvatar}
        isSubmitting={isSubmitting}
        onOpenChange={setIsEditOpen}
        onPickPhoto={() => void handlePickProfilePhoto()}
        onClearAvatar={clearAvatarUrl}
        onChangeFullName={setFullName}
        onChangeMemberType={setMemberType}
        onChangeSchoolOrEmployer={setSchoolOrEmployer}
        onChangeLicenseNumber={setLicenseNumber}
        onSave={() => void handleSaveProfile()}
      />
    </SafeAreaView>
  )
}

export default function ProfileScreen() {
  return (
    <ProfileProvider>
      <ProfileScreenContent />
    </ProfileProvider>
  )
}
