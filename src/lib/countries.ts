// Canonical country list — the single controlled vocabulary shared by the
// organisation onboarding wizard and the SM26 registration form. Keeping both
// on the same list means a country captured in one place lines up with the
// other, so prefill and the SM26 -> organisation write-back (fill-missing) work
// against matching values instead of divergent free text.
// Territories matter here as much as sovereign states: a marina operator in
// Hong Kong, Gibraltar or the Virgin Islands does not answer "China", "United
// Kingdom" or "United States". Every entry below either appears in live data or
// sits immediately beside one that does, so the dropdown reflects where this
// industry actually works. 'Other' stays last as the escape hatch, but reaching
// for it should be rare — add the country here instead.
export const COUNTRIES = [
  'Albania', 'Algeria', 'Antigua and Barbuda', 'Australia', 'Austria', 'Bahamas', 'Bahrain',
  'Belgium', 'Brazil', 'British Virgin Islands', 'Cameroon', 'Canada', 'Cayman Islands', 'Chile',
  'China', 'Colombia', 'Costa Rica', 'Croatia', 'Cyprus', 'Denmark', 'Dominican Republic',
  'Egypt', 'Estonia', 'Finland', 'France', 'Germany', 'Gibraltar', 'Greece', 'Guernsey',
  'Hong Kong', 'Iceland', 'Indonesia', 'Ireland', 'Isle of Man', 'Israel', 'Italy', 'Japan',
  'Jersey', 'Jordan', 'Kuwait', 'Latvia', 'Lebanon', 'Libya', 'Lithuania', 'Luxembourg',
  'Macau', 'Malta', 'Mauritius', 'Mexico', 'Monaco', 'Montenegro', 'Morocco', 'Netherlands',
  'New Zealand', 'Norway', 'Oman', 'Panama', 'Philippines', 'Poland', 'Portugal', 'Qatar',
  'Romania', 'Saint Lucia', 'Saudi Arabia', 'Seychelles', 'Singapore', 'Sint Maarten',
  'Slovenia', 'South Africa', 'Spain', 'Sweden', 'Switzerland', 'Taiwan', 'Thailand', 'Tunisia',
  'Turkey', 'Turks and Caicos Islands', 'United Arab Emirates', 'United Kingdom',
  'United States', 'US Virgin Islands', 'Other',
] as const;

export type Country = typeof COUNTRIES[number];
