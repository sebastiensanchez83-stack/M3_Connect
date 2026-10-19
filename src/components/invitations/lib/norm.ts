/* ─── Name keys for the duplicate checks ───
 *
 * The same rules as the database's invitation_norm() and invitation_trim()
 * (supabase/migrations/20261017090000_invitation_campaigns.sql), so a duplicate
 * found here before an import is the one the database finds after it.
 * Pure functions: no browser API, also run by scripts/invitations-check.mjs.
 */

const FROM = 'àáâãäåāăąçćčďđèéêëēėęěìíîïīįıłñńňòóôõöøōőŕřśšşșțťùúûüūůűųýÿźżžðþß';
const TO = 'aaaaaaaaacccddeeeeeeeeiiiiiiilnnnoooooooorrssssttuuuuuuuuyyzzzdts';
const FOLD = new Map<string, string>([...FROM].map((c, i) => [c, TO[i]]));

/** Postgres translate(): mapped characters are replaced, the others kept. */
function fold(s: string): string {
  let out = '';
  for (const ch of s) out += FOLD.get(ch) ?? ch;
  return out;
}

const PERSON_TITLES = /^\s*((h\.?\s*e|h\.?\s*h|s\.?\s*e|dr|mr|mrs|ms|miss|mme|mlle|m|eng|prof|capt|sheikh|sheikha|sir|dame)\.?\s+)+/;

/** invitation_norm(text, person): lower case, accents folded; a person loses leading titles. */
export function normKey(text: string | null | undefined, person = false): string {
  const base = fold((text || '').toLowerCase());
  if (person) return base.replace(PERSON_TITLES, '').replace(/[^a-z0-9]+/g, ' ').trim();
  return base.replace(/[^a-z0-9]+/g, '');
}

/** The name the database keys a guest on: first + last, else the name on the ticket. */
export function personKey(r: { first_name?: string | null; last_name?: string | null; name_on_ticket?: string | null }): string {
  const fl = [r.first_name, r.last_name].map(v => (v || '').trim()).filter(Boolean).join(' ');
  return normKey(fl || r.name_on_ticket || '', true);
}

/** JavaScript trim() as the database's invitation_trim() applies it, plus inner runs of spaces. */
export const clean = (s: string | null | undefined) => (s || '').replace(/\s+/g, ' ').trim();

/** Same check as the database (invitation_recipient.email). */
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const isEmail = (s: string) => EMAIL_RE.test(s);
