/**
 * Arabic message catalogue -- the TEMPLATE.
 *
 * Every new string is written here first. `en.ts` is typed against this
 * object, so TypeScript reports English as the language with missing
 * translations, never the other way round. That is the Arabic-first posture
 * enforced by the compiler rather than by discipline.
 */
export const ar = {
  appTitle: "ومضة",

  captureHint: "ما الذي يدور في بالك؟",
  captureVoice: "سجّل صوتيًا",
  captureText: "اكتب",
  captureSave: "احفظ",
  captureSaving: "جارٍ الحفظ…",
  captureRecording: "جارٍ التسجيل…",
  captureStop: "أوقف التسجيل",
  captureUnsupported: "التسجيل الصوتي غير مدعوم في هذا المتصفح.",

  // The idle capture screen: a heading, a decorative (non-interactive) mark,
  // and two cards that choose HOW to capture. Picking "نص" swaps this screen
  // for the textarea; picking "صوت" starts recording directly.
  captureIdleTitle: "التقاط سريع",
  captureIdleSubtitle: "التقط أفكارك بوضوح وهدوء.",
  captureCardVoiceLabel: "صوت",
  captureCardVoiceHint: "سجّل ملاحظة",
  captureCardTextLabel: "نص",
  captureCardTextHint: "اكتب أفكارك",

  notesTitle: "ملاحظاتي",
  notesEmpty: "لا توجد ملاحظات بعد. ابدأ بفكرة واحدة.",
  // On a note that is durable on this device but has not reached the server
  // yet. Deliberately calm: being offline is not the user's mistake, and the
  // note is not at risk.
  notesPendingSync: "محفوظة على جهازك",
  notesVoiceNote: "ملاحظة صوتية",
  // Shown when the server did not answer. States the situation and what the
  // user is looking at instead -- it is not a warning, because nothing is
  // wrong and nothing needs doing.
  notesOffline: "تعذّر الوصول للخادم — هذه ملاحظاتك المحفوظة على جهازك.",

  // The suggestion the user just answered, shown IN PLACE of the two links so
  // the click has a visible result -- the screen where trust in the AI is
  // earned or lost, and where the owner reported "ماحصل أي شي" (SB-033).
  notesActionAccepted: "تمّت",
  notesActionDismissed: "تم التجاهل",
  notesActionUndo: "تراجع",

  // The category filter bar above the notes list.
  filterLabel: "تصفية حسب النوع",
  filterAll: "الكل",
  notesFilterEmpty: "لا ملاحظات في هذا التصنيف.",

  // Tasks -- a filter over notes whose AI category is "task", grouped by when
  // they are due. Not a container: a task IS a note, it does not move into one.
  tasksTitle: "المهام",
  tasksEmpty: "لا مهام الآن. ما تكتبه وتصنّفه المعالجة كمهمة يظهر هنا.",
  tasksToday: "اليوم",
  tasksThisWeek: "هذا الأسبوع",
  tasksLater: "لاحقًا",
  tasksDone: "منجزة",
  // Shown on a task with no resolved due date, so "لاحقًا" is not misread as a
  // date the app invented.
  tasksNoDate: "بلا موعد",

  // The single-note detail view: the exact text captured, opened from a note
  // or a task row. This is what keeps a task a VIEW over its note (SB-037).
  detailTitle: "الملاحظة",
  detailRawLabel: "النص كما كُتب",
  detailClose: "إغلاق",
  detailLoadFailed: "تعذّر فتح الملاحظة.",

  searchTitle: "البحث",
  searchHint: "ابحث في ملاحظاتك",
  searchNoResults: "لا توجد نتائج",

  digestTitle: "مراجعة الأسبوع",
  digestEmpty: "ستظهر مراجعتك الأسبوعية هنا يوم السبت.",

  settingsLanguage: "اللغة",
  offline: "أنت غير متصل — تُحفظ ملاحظاتك على جهازك.",

  // The shared wait state. The design export writes "جاري"; the spelling here
  // is "جارٍ", matching every other progress string in this catalogue.
  loading: "جارٍ تجهيز البيانات…",

  authTitle: "تسجيل الدخول",
  authEmailLabel: "البريد الإلكتروني",
  authSendCode: "أرسل رمز الدخول",
  authSending: "جارٍ الإرسال…",
  authCodeLabel: "رمز التحقق",
  authCodeSent: "أرسلنا رمزًا مكوّنًا من ستة أرقام إلى بريدك.",
  authVerify: "تأكيد",
  authVerifying: "جارٍ التحقق…",
  authResend: "إعادة الإرسال",
  authChangeEmail: "تغيير البريد",
  authSignOut: "تسجيل الخروج",
  // Labels the avatar button. The avatar carries no text of its own, so
  // without this a screen reader announces an unnamed button.
  accountMenu: "الحساب",
  authRequired: "سجّل الدخول لعرض ملاحظاتك المحفوظة.",
  // The promise that makes gating the other tabs acceptable: capture is never
  // blocked, and nothing the user wrote while signed out is lost.
  authCaptureAnyway:
    "يمكنك متابعة تدوين الملاحظات الآن — ستُزامَن تلقائيًا بعد تسجيل الدخول.",

  errorEmailRequired: "أدخل بريدًا إلكترونيًا صحيحًا.",
  errorInvalidCode: "الرمز غير صحيح أو منتهي الصلاحية.",
  // The local write failing is the only capture failure worth alarming about:
  // it is the one case where the thought is not stored anywhere.
  errorCaptureFailed: "تعذّر حفظ الملاحظة على جهازك. حاول مرة أخرى.",
  // Diagnostic, not polished copy -- the raw sync error message follows this
  // prefix directly (see Capture.tsx). The note itself is safe and will keep
  // retrying; this exists so a failure mode can be reported instead of
  // silently retrying forever with nothing on screen to describe it (SB-012).
  captureSyncErrorPrefix: "لم تُرفع الملاحظة الصوتية بعد:",

  categoryTask: "مهمة",
  categoryEvent: "موعد",
  categoryIdea: "فكرة",
  categoryLearning: "معلومة",
  categoryReference: "مرجع",
  categoryPersonal: "شخصي",
  categoryOther: "أخرى",

  priorityUrgent: "عاجل",
  priorityHigh: "مهم",
  priorityNormal: "عادي",
  // Reworded from "لاحقًا" to "منخفض": "لاحقًا" now names the Tasks screen's
  // later-due group (tasksLater), and a scheduling word read badly as a
  // priority label anyway. This is a priority level, so name it as one.
  priorityLow: "منخفض",

  actionCreateTask: "أضفها كمهمة",
  actionCreateEvent: "أضفها للتقويم",
  actionArchive: "أرشفة",
  actionReviewLater: "راجعها لاحقًا",
  actionDismiss: "تجاهل",

  statusProcessing: "جارٍ التحليل…",
  // A note that reached the server but whose AI pass failed. Honest, not
  // alarming, and true for a voice note too: the note itself is safe, only the
  // analysis did not complete.
  statusFailed: "تعذّر تحليل هذه الملاحظة — ملاحظتك محفوظة",
  statusNeedsReview: "التسجيل غير واضح — راجع النص",

  errorGeneric: "حدث خطأ. حاول مرة أخرى.",
  errorUnauthenticated: "انتهت الجلسة. سجّل الدخول مرة أخرى.",
  errorTranscriptionFailed: "تعذّر تحويل الصوت إلى نص.",
  errorEnrichmentRefused: "تعذّر تحليل هذه الملاحظة.",
} as const;

/**
 * Plural forms, kept separate from the flat strings above because they need
 * one entry per CLDR plural category.
 *
 * Arabic has six (`zero one two few many other`) against English's two. A
 * hand-rolled `n === 1 ? a : b` produces grammatically wrong Arabic for 2, and
 * for 3-10 -- which covers most counts a user will actually see. `Intl.PluralRules`
 * picks the right branch; see `i18n/index.ts`.
 */
export const arPlurals = {
  pendingSync: {
    zero: "",
    one: "ملاحظة واحدة بانتظار المزامنة",
    two: "ملاحظتان بانتظار المزامنة",
    few: "{n} ملاحظات بانتظار المزامنة",
    many: "{n} ملاحظة بانتظار المزامنة",
    other: "{n} ملاحظة بانتظار المزامنة",
  },
  // The open-task count beside each group heading. All six categories, because
  // "مهمتان" (2) and "مهام" (3-10) are different words from "مهمة" (11+) and no
  // singular/plural pair can express them -- the whole reason this table exists.
  taskCount: {
    zero: "لا مهام",
    one: "مهمة واحدة",
    two: "مهمتان",
    few: "{n} مهام",
    many: "{n} مهمة",
    other: "{n} مهمة",
  },
} as const;

/**
 * Keys come from the Arabic template; VALUES are widened to `string`.
 *
 * Without the mapped type, `as const` above would make each value a literal
 * type and `Messages` would require English to equal the Arabic text —
 * every entry in `en.ts` a type error. The goal is to constrain the SET OF
 * KEYS, not the content.
 */
export type Messages = { readonly [K in keyof typeof ar]: string };
export type PluralKey = keyof typeof arPlurals;
