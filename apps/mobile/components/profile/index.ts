// ─── Profile screen, top to bottom ──────────────────────────────────────────
export { ProfileOverviewCard } from "./profile-overview-card"
export { ExamReadinessCard } from "./exam-readiness-card"
export { ProfileStatsGrid } from "./profile-stats-grid"
export { ProfileProgressCard } from "./profile-progress-card"
export {
  AchievementsSection,
  type AchievementCardItem,
} from "./achievements-section"
export { AchievementBadgeCard } from "./achievement-badge-card"
export { ProfileEditDialog } from "./profile-edit-dialog"
export {
  ProfileCompletionCard,
  ProfileVerifyEmailCard,
} from "./profile-status-cards"

// ─── Badge naming, shared with anything that renders an achievement ─────────
export {
  AchievementBadgeIcon,
  getAchievementBadgeMeta,
  type AchievementBadgeMeta,
} from "./profile-achievements"

// ─── Superseded by the sections above ───────────────────────────────────────
// ProfileTopBar and ProfileIdentityCard were replaced by the account overview
// in the 2026-09-26 redesign.
export { ProfileTopBar } from "./profile-top-bar"
export { ProfileIdentityCard } from "./profile-identity-card"
// The tabbed layout is gone: Details, Activity and Performance are now one
// scroll. Kept because these files were never committed, so removing them
// would not be recoverable from git — delete once the new Profile has proven
// itself.
export { ProfileActivityTab } from "./profile-activity-tab"
export { ProfileDetailsTab } from "./profile-details-tab"
export { ProfileHeader } from "./profile-header"
export { ProfilePerformanceTab } from "./profile-performance-tab"
export { ProfileTabs } from "./profile-tabs"
export type { ProfileDetailCard, ProfileRecentActivityItem } from "./types"
