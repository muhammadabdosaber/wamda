import type { Messages, PluralKey } from "./ar";

/**
 * English catalogue, phase 2.
 *
 * Typed as `Messages` (derived from the Arabic template), so adding a string
 * to `ar.ts` and forgetting it here is a compile error rather than a missing
 * key discovered in production.
 */
export const en: Messages = {
  appTitle: "Second Brain",

  captureHint: "What's on your mind?",
  captureVoice: "Record",
  captureText: "Write",
  captureSave: "Save",
  captureSaving: "Saving…",
  captureRecording: "Recording…",
  captureStop: "Stop recording",
  captureUnsupported: "Voice recording isn't supported in this browser.",

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

  tasksTitle: "Tasks",
  tasksEmpty: "No tasks right now. Anything the AI files as a task shows up here.",
  tasksToday: "Today",
  tasksThisWeek: "This week",
  tasksLater: "Later",
  tasksDone: "Done",
  tasksNoDate: "No date",

  detailTitle: "Note",
  detailRawLabel: "As you wrote it",
  detailClose: "Close",
  detailLoadFailed: "Couldn't open the note.",

  searchTitle: "Search",
  searchHint: "Search your notes",
  searchNoResults: "No results",

  digestTitle: "Weekly review",
  digestEmpty: "Your weekly review will appear here on Saturday.",

  settingsLanguage: "Language",
  offline: "You're offline — notes are saved on your device.",

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
  authRequired: "Sign in to see your saved notes.",
  authCaptureAnyway:
    "You can keep capturing notes now — they'll sync once you sign in.",

  errorEmailRequired: "Enter a valid email address.",
  errorInvalidCode: "That code is wrong or has expired.",
  errorCaptureFailed: "Couldn't save this note on your device. Try again.",

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
};
