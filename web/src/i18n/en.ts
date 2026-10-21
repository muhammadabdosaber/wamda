import type { Messages, PluralKey } from "./ar";

/**
 * English catalogue, phase 2.
 *
 * Typed as `Messages` (derived from the Arabic template), so adding a string
 * to `ar.ts` and forgetting it here is a compile error rather than a missing
 * key discovered in production.
 */
export const en: Messages = {
  appTitle: "Wamda",

  captureHint: "What's on your mind?",
  captureVoice: "Record",
  captureText: "Write",
  captureSave: "Save",
  captureSaving: "Saving…",
  captureRecording: "Recording…",
  captureStop: "Stop recording",
  captureUnsupported: "Voice recording isn't supported in this browser.",
  captureNoSignal: "We can't hear anything — check your microphone",
  captureSilentSaved:
    "Note saved, but no sound was picked up — check your microphone settings.",

  captureIdleTitle: "Quick capture",
  captureIdleSubtitle: "Capture your thoughts, clearly and calmly.",
  captureCardVoiceLabel: "Voice",
  captureCardVoiceHint: "Record a note",
  captureCardTextLabel: "Text",
  captureCardTextHint: "Write your thoughts",

  notesTitle: "My notes",
  notesEmpty: "No notes yet. Start with one thought.",
  notesPendingSync: "Saved on your device",
  notesVoiceNote: "Voice note",
  notesOffline: "Couldn't reach the server — these are the notes saved on your device.",

  notesActionAccepted: "Done",
  notesActionDismissed: "Dismissed",
  notesActionUndo: "Undo",

  filterLabel: "Filter by type",
  filterAll: "All",
  notesFilterEmpty: "No notes in this category.",

  tasksTitle: "Tasks",
  tasksEmpty: "No tasks right now. Anything the AI files as a task shows up here.",
  tasksToday: "Today",
  tasksThisWeek: "This week",
  tasksLater: "Later",
  tasksDone: "Done",
  tasksNoDate: "No date",
  tasksOverdue: "Overdue",

  // SB-051.
  pushDueTitle: "Tasks due",
  pushTaskDueTitle: "Task due now",
  pushEnable: "Remind me when the app is closed",
  pushDisable: "Turn reminders off",
  pushEnabled: "Reminders on — one notification in the morning when something is due.",
  pushBlocked: "Notifications are blocked in your browser settings. Allow them there first.",
  pushUnsupported: "To get notifications on iPhone, add this app to your Home Screen first.",
  pushFailed: "Couldn't turn notifications on.",

  detailTitle: "Note",
  detailRawLabel: "As you wrote it",
  detailClose: "Close",
  detailLoadFailed: "Couldn't open the note.",

  searchTitle: "Search",
  searchHint: "Search your notes",
  searchNoResults: "No results",

  digestTitle: "Weekly review",
  digestEmpty: "Your weekly review will appear here on Saturday.",
  digestThisWeek: "This week",
  digestHistoryLabel: "Browse past weekly reviews",

  settingsLanguage: "Language",
  offline: "You're offline — notes are saved on your device.",

  loading: "Getting your space ready…",

  authTitle: "Sign in",
  authEmailLabel: "Email",
  authSendCode: "Send sign-in code",
  authSending: "Sending…",
  authCodeLabel: "Verification code",
  authCodeSent: "We sent a six-digit code to your email.",
  authVerify: "Verify",
  authVerifying: "Verifying…",
  authResend: "Resend",
  authChangeEmail: "Change email",
  authSignOut: "Sign out",
  accountMenu: "Account",
  authRequired: "Sign in to see your saved notes.",
  authCaptureAnyway:
    "You can keep capturing notes now — they'll sync once you sign in.",

  errorEmailRequired: "Enter a valid email address.",
  errorInvalidCode: "That code is wrong or has expired.",
  errorCaptureFailed: "Couldn't save this note on your device. Try again.",
  captureSyncErrorPrefix: "This voice note hasn't uploaded yet:",

  categoryTask: "Task",
  categoryEvent: "Event",
  categoryIdea: "Idea",
  categoryLearning: "Learning",
  categoryReference: "Reference",
  categoryPersonal: "Personal",
  categoryOther: "Other",

  priorityUrgent: "Urgent",
  priorityHigh: "High",
  priorityNormal: "Normal",
  priorityLow: "Low",

  actionCreateTask: "Add as task",
  actionCreateEvent: "Add to calendar",
  actionArchive: "Archive",
  actionReviewLater: "Review later",
  actionDismiss: "Dismiss",

  statusProcessing: "Analysing…",
  statusFailed: "Couldn't analyse this note — it's still saved",
  statusNeedsReview: "Audio was unclear — check the transcript",

  errorGeneric: "Something went wrong. Try again.",
  errorUnauthenticated: "Session expired. Sign in again.",
  errorTranscriptionFailed: "Could not transcribe the audio.",
  errorEnrichmentRefused: "Could not analyse this note.",
};

/**
 * English uses only `one` and `other`. The remaining categories are still
 * present because the lookup is category-keyed -- `Intl.PluralRules('en')`
 * will simply never select them.
 */
export const enPlurals: Record<PluralKey, Record<Intl.LDMLPluralRule, string>> = {
  pendingSync: {
    zero: "",
    one: "1 note waiting to sync",
    two: "{n} notes waiting to sync",
    few: "{n} notes waiting to sync",
    many: "{n} notes waiting to sync",
    other: "{n} notes waiting to sync",
  },
  taskCount: {
    zero: "No tasks",
    one: "1 task",
    two: "{n} tasks",
    few: "{n} tasks",
    many: "{n} tasks",
    other: "{n} tasks",
  },
  pushMoreTasks: {
    zero: "",
    one: "and 1 more",
    two: "and {n} more",
    few: "and {n} more",
    many: "and {n} more",
    other: "and {n} more",
  },
  tasksDueSoonCount: {
    zero: "No tasks due",
    one: "1 task overdue or due today",
    two: "{n} tasks overdue or due today",
    few: "{n} tasks overdue or due today",
    many: "{n} tasks overdue or due today",
    other: "{n} tasks overdue or due today",
  },
  searchResultCount: {
    zero: "No results",
    one: "1 result",
    two: "{n} results",
    few: "{n} results",
    many: "{n} results",
    other: "{n} results",
  },
};
