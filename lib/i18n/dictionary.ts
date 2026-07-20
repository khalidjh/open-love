// UI string dictionary for the Etlaq builder. Flat dot-keyed strings; English is
// the source/fallback. Add keys as surfaces are localized — a missing key renders
// its English value (or the key itself), so partial coverage degrades gracefully.

export type Lang = 'en' | 'ar';

export const LANGS: { code: Lang; label: string; native: string }[] = [
  { code: 'en', label: 'English', native: 'English' },
  { code: 'ar', label: 'Arabic', native: 'العربية' },
];

export const dir = (lang: Lang): 'rtl' | 'ltr' => (lang === 'ar' ? 'rtl' : 'ltr');

type Dict = Record<string, string>;

const en: Dict = {
  // common
  'common.language': 'Language',
  'common.new': 'New app',
  'common.open': 'Open',
  'common.delete': 'Delete',
  'common.cancel': 'Cancel',
  'common.save': 'Save',
  'common.loading': 'Loading…',
  'common.signIn': 'Sign in',
  'common.signOut': 'Sign out',
  'common.getStarted': 'Get started',
  // nav / header
  'nav.dashboard': 'Dashboard',
  'nav.projects': 'Projects',
  'nav.pricing': 'Pricing',
  'nav.docs': 'Docs',
  // marketing home
  'home.hero.title': 'Build web apps by describing them',
  'home.hero.subtitle': 'Describe what you want and Etlaq builds it — a real app with sign-in, data, and files.',
  'home.hero.placeholder': 'Describe the app you want to build…',
  'home.hero.build': 'Build it',
  // dashboard
  'dash.title': 'Your apps',
  'dash.empty': 'No apps yet. Describe one to get started.',
  'dash.newApp': 'New app',
  'dash.openApp': 'Open',
  'dash.deleteApp': 'Delete',
  'dash.deployed': 'Live',
  'dash.draft': 'Draft',
  // generation / builder chrome
  'gen.preview': 'Preview',
  'gen.code': 'Code',
  'gen.chatPlaceholder': 'Describe a change…',
  'gen.building': 'Building your app…',
  'gen.deploy': 'Publish',
  'gen.deploying': 'Publishing…',
};

// Arabic. Keys not yet translated fall back to English.
const ar: Dict = {
  'common.language': 'اللغة',
  'common.new': 'تطبيق جديد',
  'common.open': 'فتح',
  'common.delete': 'حذف',
  'common.cancel': 'إلغاء',
  'common.save': 'حفظ',
  'common.loading': 'جارٍ التحميل…',
  'common.signIn': 'تسجيل الدخول',
  'common.signOut': 'تسجيل الخروج',
  'common.getStarted': 'ابدأ الآن',
  'nav.dashboard': 'لوحة التحكم',
  'nav.projects': 'المشاريع',
  'nav.pricing': 'الأسعار',
  'nav.docs': 'الدليل',
  'home.hero.title': 'ابنِ تطبيقات الويب بوصفها فقط',
  'home.hero.subtitle': 'صِف ما تريد ويبنيه إطلاق — تطبيق حقيقي فيه تسجيل دخول وبيانات وملفات.',
  'home.hero.placeholder': 'صِف التطبيق الذي تريد بناءه…',
  'home.hero.build': 'ابنِه',
  'dash.title': 'تطبيقاتك',
  'dash.empty': 'لا توجد تطبيقات بعد. صِف تطبيقًا لتبدأ.',
  'dash.newApp': 'تطبيق جديد',
  'dash.openApp': 'فتح',
  'dash.deleteApp': 'حذف',
  'dash.deployed': 'منشور',
  'dash.draft': 'مسودة',
  'gen.preview': 'المعاينة',
  'gen.code': 'الكود',
  'gen.chatPlaceholder': 'صِف تعديلًا…',
  'gen.building': 'جارٍ بناء تطبيقك…',
  'gen.deploy': 'نشر',
  'gen.deploying': 'جارٍ النشر…',
};

export const DICT: Record<Lang, Dict> = { en, ar };

export function translate(lang: Lang, key: string): string {
  return DICT[lang]?.[key] ?? DICT.en[key] ?? key;
}
