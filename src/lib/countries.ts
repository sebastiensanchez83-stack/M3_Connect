// Canonical country list — the single controlled vocabulary shared by the
// organisation onboarding wizard and the SM26 registration form. Keeping both
// on the same list means a country captured in one place lines up with the
// other, so prefill and the SM26 -> organisation write-back (fill-missing) work
// against matching values instead of divergent free text.
export const COUNTRIES = [
  'Albania', 'Algeria', 'Bahrain', 'Belgium', 'Brazil', 'Canada', 'Chile', 'China',
  'Croatia', 'Cyprus', 'Denmark', 'Egypt', 'Estonia', 'Finland', 'France', 'Germany',
  'Gibraltar', 'Greece', 'Indonesia', 'Ireland', 'Israel', 'Italy', 'Japan', 'Jordan',
  'Kuwait', 'Latvia', 'Lebanon', 'Libya', 'Lithuania', 'Malta', 'Mauritius', 'Mexico',
  'Monaco', 'Montenegro', 'Morocco', 'Netherlands', 'New Zealand', 'Norway', 'Oman',
  'Philippines', 'Poland', 'Portugal', 'Qatar', 'Romania', 'Saudi Arabia', 'Singapore',
  'Slovenia', 'South Africa', 'Spain', 'Sweden', 'Thailand', 'Tunisia', 'Turkey',
  'United Arab Emirates', 'United Kingdom', 'United States', 'Other',
] as const;

export type Country = typeof COUNTRIES[number];
