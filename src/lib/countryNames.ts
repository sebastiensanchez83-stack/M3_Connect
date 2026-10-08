import { countryKey, countryParts } from '@/lib/networkStats';

/**
 * Display names for the free-text country field of organizations.
 *
 * The database holds whatever members typed ("UK", "United Kingdom", "Italia",
 * "FRANCE", "tunisie"). networkStats.countryKey() folds those to one key per
 * country; this module turns a key back into a name a visitor can read, in the
 * page's language when the browser knows the country ("Croatia" → "Croatie"),
 * else in the best spelling found in the data.
 *
 * Nothing is hard-coded per country: the English names of every ISO region the
 * browser knows (Intl.DisplayNames) are folded with the same countryKey(), so a
 * key that matches one gets its ISO code, and through it a localized name.
 */

let englishToCode: Map<string, string> | null = null;

function codeIndex(): Map<string, string> {
  if (englishToCode) return englishToCode;
  englishToCode = new Map();
  try {
    const names = new Intl.DisplayNames(['en'], { type: 'region' });
    const A = 65;
    for (let i = 0; i < 26; i++) {
      for (let j = 0; j < 26; j++) {
        const code = String.fromCharCode(A + i, A + j);
        let name: string | undefined;
        try {
          name = names.of(code);
        } catch {
          name = undefined;
        }
        if (!name || name === code) continue;
        const key = countryKey(name);
        // Keep the first code for a name (real countries come before the odd aliases).
        if (!englishToCode.has(key)) englishToCode.set(key, code);
      }
    }
  } catch {
    /* No Intl.DisplayNames: the data's own spelling is used. */
  }
  return englishToCode;
}

const localNames = new Map<string, Intl.DisplayNames | null>();

function displayNamesFor(lang: string): Intl.DisplayNames | null {
  if (!localNames.has(lang)) {
    try {
      localNames.set(lang, new Intl.DisplayNames([lang], { type: 'region' }));
    } catch {
      localNames.set(lang, null);
    }
  }
  return localNames.get(lang) ?? null;
}

/** "united kingdom" → "united-kingdom": the form used in the URL (?country=). */
export function countrySlug(key: string): string {
  return key
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** "FRANCE", "tunisie" → "France", "Tunisie"; mixed-case spellings are kept. */
function tidy(spelling: string): string {
  const s = spelling.trim();
  if (s !== s.toUpperCase() && s !== s.toLowerCase()) return s;
  return s
    .toLowerCase()
    .replace(/(^|[\s(-])(\p{L})/gu, (_m, sep: string, ch: string) => `${sep}${ch.toUpperCase()}`)
    .replace(/\b(And|Of|The|De|Du|Des|La|Le)\b/g, (w, _x, offset: number) => (offset === 0 ? w : w.toLowerCase()));
}

/**
 * The best spelling of a country among the ones found in the data: prefer a
 * spelling that is the key itself (not an alias such as "UK" or "Suomi"), then
 * the most frequent one.
 */
export function bestSpelling(key: string, spellings: Map<string, number>): string {
  let best = '';
  let bestScore = -1;
  for (const [spelling, count] of spellings) {
    const folded = spelling
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .replace(/\./g, '')
      .trim()
      .replace(/^the\s+/, '');
    const direct = folded === key ? 1000 : 0;
    const score = direct + count;
    if (score > bestScore) {
      best = spelling;
      bestScore = score;
    }
  }
  return tidy(best || key);
}

/** A country's name in `lang` when the browser knows it, else `fallback`. */
export function localizedCountryName(key: string, fallback: string, lang: string): string {
  const code = codeIndex().get(key);
  if (!code) return fallback;
  const name = displayNamesFor(lang)?.of(code);
  return name && name !== code ? name : fallback;
}

/**
 * A country field as an English reader should see it: "Suomi" → "Finland",
 * "Italia" → "Italy", "UK" → "United Kingdom", "FRANCE" → "France",
 * "Spain/France" → "Spain, France". Native and French spellings fold through
 * networkStats' COUNTRY_ALIASES, then the browser's English name of the ISO
 * region; a spelling it does not recognise is shown tidied (capitals fixed),
 * never dropped. The interface is English only, hence no `lang` parameter.
 */
export function englishCountryName(raw: string | null | undefined): string {
  const s = (raw ?? '').trim();
  if (!s) return '';
  const parts = countryParts(s);
  if (parts.length === 0) return tidy(s);
  const names = parts.map((part) => localizedCountryName(countryKey(part), tidy(part), 'en'));
  return [...new Set(names)].join(', ');
}
