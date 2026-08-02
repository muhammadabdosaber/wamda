/**
 * Arabic message catalogue -- the TEMPLATE.
 *
 * Every new string is written here first. `en.ts` is typed against this
 * object, so TypeScript reports English as the language with missing
 * translations, never the other way round. That is the Arabic-first posture
 * enforced by the compiler rather than by discipline.
 */
export const ar = {
  appTitle: "الدماغ الثاني",

  captureHint: "ما الذي يدور في بالك؟",
  captureVoice: "سجّل صوتيًا",
  captureText: "اكتب",
  captureSave: "احفظ",
  captureRecording: "جارٍ التسجيل…",
  captureStop: "أوقف التسجيل",
  captureUnsupported: "التسجيل الصوتي غير مدعوم في هذا المتصفح.",

  notesTitle: "ملاحظاتي",
  notesEmpty: "لا توجد ملاحظات بعد. ابدأ بفكرة واحدة.",

  searchTitle: "البحث",
  searchHint: "ابحث في ملاحظاتك",
  searchNoResults: "لا توجد نتائج",

  digestTitle: "مراجعة الأسبوع",
  digestEmpty: "ستظهر مراجعتك الأسبوعية هنا يوم السبت.",

  settingsLanguage: "اللغة",
  offline: "أنت غير متصل — تُحفظ ملاحظاتك على جهازك.",

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
  authRequired: "سجّل الدخول لعرض ملاحظاتك المحفوظة.",
  // The promise that makes gating the other tabs acceptable: capture is never
  // blocked, and nothing the user wrote while signed out is lost.
  authCaptureAnyway:
    "يمكنك متابعة تدوين الملاحظات الآن — ستُزامَن تلقائيًا بعد تسجيل الدخول.",

  errorEmailRequired: "أدخل بريدًا إلكترونيًا صحيحًا.",
  errorInvalidCode: "الرمز غير صحيح أو منتهي الصلاحية.",

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
  priorityLow: "لاحقًا",

  actionCreateTask: "أضفها كمهمة",
  actionCreateEvent: "أضفها للتقويم",
  actionArchive: "أرشفة",
  actionReviewLater: "راجعها لاحقًا",
  actionDismiss: "تجاهل",

  statusProcessing: "جارٍ التحليل…",
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
