/**
 * Display normalisation for names typed in capitals ("ARENES PARTNERS", "AQABA").
 *
 * Only a value written ENTIRELY in upper case is changed, and only when it holds a
 * word of four letters or more: "IGY Marinas", "Port de Nice" and short acronyms
 * ("MDL", "M3", "YCM") are shown exactly as stored. The stored value never changes;
 * this is for display only.
 *
 *   displayCase('ARENES PARTNERS')     → 'Arenes Partners'
 *   displayCase('AQABA')               → 'Aqaba'
 *   displayCase('PORT DE SAINT-TROPEZ') → 'Port de Saint-Tropez'
 *   displayCase("MARINA D'ARENZANO SPA") → "Marina d'Arenzano SpA"
 *   displayCase('IGY Marinas')          → 'IGY Marinas' (mixed case: untouched)
 */

/** Small words kept in lower case inside a name (never as its first word). */
const SMALL_WORDS = new Set([
  'a', 'al', 'and', 'at', 'au', 'aux', 'by', 'da', 'das', 'de', 'del', 'della', 'der', 'des', 'di', 'do', 'dos',
  'du', 'e', 'el', 'en', 'et', 'for', 'in', 'la', 'le', 'les', 'of', 'on', 'sur', 'the', 'to', 'und', 'van', 'von', 'y',
]);

/** Company forms written their own way ("GMBH" → "GmbH"); the others listed stay in capitals. */
const FIXED_WORDS: Record<string, string> = {
  gmbh: 'GmbH', spa: 'SpA', srl: 'Srl', ltd: 'Ltd', inc: 'Inc', llc: 'LLC', plc: 'PLC', sa: 'SA', sas: 'SAS',
  sarl: 'SARL', sl: 'SL', slu: 'SLU', bv: 'BV', nv: 'NV', ag: 'AG', ab: 'AB', as: 'AS', oy: 'Oy', co: 'Co',
  uae: 'UAE', usa: 'USA', uk: 'UK', us: 'US', fze: 'FZE', fzco: 'FZCO', fzc: 'FZC', dmcc: 'DMCC',
};

function hasLetters(s: string): boolean {
  return /\p{L}/u.test(s);
}

/** True when every letter of the value is upper case (and there is at least one). */
export function isAllCaps(value: string): boolean {
  return hasLetters(value) && value === value.toUpperCase() && value !== value.toLowerCase();
}

/** "SAINT-TROPEZ" → "Saint-Tropez", "D'ARENZANO" → "D'Arenzano": a capital after each - or '. */
function capitalizeWord(word: string): string {
  return word
    .toLowerCase()
    .replace(/(^|[-'’/(.])(\p{L})/gu, (_m, sep: string, ch: string) => `${sep}${ch.toUpperCase()}`);
}

/**
 * The value as a reader should see it: title case when it was typed all in capitals,
 * unchanged otherwise. Null, undefined and blank values come back as ''.
 */
export function displayCase(value: string | null | undefined): string {
  const s = (value ?? '').trim();
  if (!s || !isAllCaps(s)) return s;
  // A short acronym on its own ("MDL", "YCM", "M3 SA") is a name, not shouting.
  const longest = Math.max(0, ...s.split(/[^\p{L}]+/u).map((w) => w.length));
  if (longest < 4) return s;

  return s
    .split(/(\s+)/)
    .map((token, i) => {
      if (/^\s+$/.test(token) || !hasLetters(token)) return token;
      const bare = token.toLowerCase().replace(/[^\p{L}]/gu, '');
      if (FIXED_WORDS[bare] && bare.length === token.replace(/[^\p{L}]/gu, '').length) {
        return token.replace(/\p{L}+/u, FIXED_WORDS[bare]);
      }
      // Elided articles: "D'ARENZANO" inside a name reads "d'Arenzano".
      const word = capitalizeWord(token);
      if (i > 0 && SMALL_WORDS.has(bare)) return token.toLowerCase();
      if (i > 0 && /^[DL]['’]\p{L}/u.test(word)) return word.charAt(0).toLowerCase() + word.slice(1);
      return word;
    })
    .join('');
}
