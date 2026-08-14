import { useRef, useState, type DragEvent } from 'react';
import { FileUp, Loader2, Upload, X, AlertTriangle, Check } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { Pill } from '@/components/sm26/SM26ConsoleUI';
import { SM26_INVITE_CHANNELS as INVITE_CHANNELS, SM26_RSVP_STATES as RSVP_STATES } from './types';

// Load a list of invitations that went out before this module existed — the
// spreadsheet, the mail-merge, the names somebody kept in their own notes.
//
// Nothing is written until the preview has been looked at. The preview is the
// point: an import that silently mangles thirty names is worse than no import.

/**
 * Which character separates the columns. Excel writes semicolons on a French
 * locale and tabs when you paste from a spreadsheet, so guessing is not
 * optional — and guessing once, from the header line, beats treating all three
 * as separators everywhere, which would split "Ministry of Trade; Egypt" in an
 * ordinary comma file.
 */
function sniffDelimiter(str: string): string {
  const firstLine = str.split(/\r?\n/, 1)[0] || '';
  const outside = firstLine.replace(/"[^"]*"/g, '');   // ignore anything quoted
  const counts = [',', ';', '\t'].map(d => [d, outside.split(d).length - 1] as const);
  const best = counts.reduce((a, b) => (b[1] > a[1] ? b : a));
  return best[1] > 0 ? best[0] : ',';
}

/** Same parser the Jotform importer uses — quotes, doubled quotes, CRLF. */
function parseCSV(str: string, delim: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let f = ''; let i = 0; let q = false;
  while (i < str.length) {
    const c = str[i];
    if (q) { if (c === '"') { if (str[i + 1] === '"') { f += '"'; i += 2; continue; } q = false; i++; continue; } f += c; i++; continue; }
    if (c === '"') { q = true; i++; continue; }
    if (c === delim) { row.push(f); f = ''; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; i++; continue; }
    f += c; i++;
  }
  if (f.length || row.length) { row.push(f); rows.push(row); }
  return rows;
}

// Header synonyms, matched loosely so a French or an English spreadsheet both
// land — this is a list somebody typed, not an export from a system.
const FIELDS: { key: keyof Draft; names: string[] }[] = [
  { key: 'name',    names: ['name', 'recipient', 'guest', 'nom', 'invite', 'invité', 'full name', 'nom complet'] },
  { key: 'role',    names: ['title', 'role', 'job title', 'fonction', 'titre', 'poste'] },
  { key: 'org',     names: ['organisation', 'organization', 'company', 'société', 'societe', 'entreprise', 'institution'] },
  { key: 'country', names: ['country', 'pays'] },
  { key: 'email',   names: ['email', 'e-mail', 'mail', 'courriel'] },
  { key: 'phone',   names: ['phone', 'telephone', 'téléphone', 'tel', 'mobile'] },
  { key: 'channel', names: ['channel', 'canal', 'how', 'sent by', 'via'] },
  { key: 'sent',    names: ['sent', 'sent on', 'date', 'envoyé', 'envoye', 'date envoi', 'sent at'] },
  { key: 'reply',   names: ['reply', 'answer', 'rsvp', 'réponse', 'reponse', 'status', 'statut'] },
  { key: 'note',    names: ['note', 'notes', 'comment', 'commentaire', 'remarque'] },
];

interface Draft {
  name: string; role: string; org: string; country: string; email: string;
  phone: string; channel: string; sent: string; reply: string; note: string;
}
/** `skip` is decided when the row is read, not inferred from the warning text. */
interface Row { draft: Draft; problems: string[]; skip: boolean }

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** "email", "mail perso", "by phone" → one of the stored channels. */
function readChannel(raw: string): string {
  const v = norm(raw);
  if (!v) return 'email';
  if (/phone|tel|appel|call/.test(v)) return 'phone';
  if (/person|main propre|hand|face/.test(v)) return 'in_person';
  if (/third|tiers|via|interm/.test(v)) return 'third_party';
  // 'post', not 'platform_letter': a letter this platform never drew, and
  // claiming otherwise would advertise a PDF that does not exist.
  if (/letter|lettre|courrier|post|mail\b/.test(v)) return 'post';
  return 'email';
}

/**
 * "yes", "accepté", "confirmed" → one of the five reply states.
 *
 * Order matters and is the opposite of the obvious one: "no reply" contains
 * "no", so the declined test has to run AFTER the no-reply test or every guest
 * we are still chasing is recorded as having refused.
 */
function readReply(raw: string): string {
  const v = norm(raw);
  if (!v) return 'awaiting';
  // "Still waiting on them" is not the same as "they never answered", so the
  // explicit waiting forms are taken out before anything else.
  if (/awaiting|en attente|^attente|pending|waiting|à relancer|a relancer/.test(v)) return 'awaiting';
  // Any mention of a reply alongside a negation is a non-reply — "pas encore de
  // réponse" and "no answer yet" both live here — as are the words people use
  // when they mean it without saying "reply".
  if (/(répons|repons|reply|answer|retour)/.test(v)
      && /\bno\b|\bnon\b|sans|\bpas\b|aucun|never|jamais|toujours/.test(v)) return 'no_reply';
  if (/no reply|no answer|silence|relanc|unanswered/.test(v)) return 'no_reply';
  // Negations and pending forms next. These are substring tests, and "not
  // coming", "ne viendra pas", "à confirmer" and "not confirmed" all CONTAIN the
  // words the accepted test looks for — so testing accepted first files a
  // refusal as an acceptance and puts somebody on the door list who said no.
  if (/\bnot\b|n[’']t|\bne \w+ pas\b|\bpas\b|\bsans\b|jamais|décliné|decline|refus|cannot|can not|regret|excus|unable|impossible/.test(v)) {
    return /tentat|maybe|probab|unsure|à confirmer|a confirmer|not confirmed|not sure|not yet/.test(v) ? 'tentative' : 'declined';
  }
  if (/tentat|peut-être|peut etre|maybe|probab|unsure|à confirmer|a confirmer|to confirm|provisoire/.test(v)) return 'tentative';
  if (/accept|^yes$|^y$|^oui$|confirm|viendra|coming|attend|présent|present/.test(v)) return 'accepted';
  if (/^no$|^n$|^non$/.test(v)) return 'declined';
  return 'awaiting';
}

/**
 * Accepts 2026-09-03, 03/09/2026 and 3-9-26. Day-first, because this list is
 * European. Returns { iso, ambiguous } — ambiguous when both numbers are 12 or
 * under, so 03/09 could equally be 9 March if the file came from a US export.
 * Guessing silently is how a whole column ends up three months out.
 */
function readDate(raw: string): { iso: string; ambiguous: boolean } {
  const v = raw.trim();
  const none = { iso: '', ambiguous: false };
  if (!v) return none;

  const real = (y: string, m: string, d: string) => {
    const iso = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    // Round-tripping catches 31/02 and 45/13, which Date would otherwise roll
    // forward into a plausible-looking but wrong day.
    const t = new Date(`${iso}T12:00:00Z`);
    return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === iso ? iso : '';
  };

  const iso = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return { iso: real(iso[1], iso[2], iso[3]), ambiguous: false };

  const dmy = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (dmy) {
    const y = dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3];
    const d = Number(dmy[1]);
    const m = Number(dmy[2]);
    // Over 12 in the first slot can only be a day, so the order is settled.
    return { iso: real(y, dmy[2], dmy[1]), ambiguous: d <= 12 && m <= 12 && d !== m };
  }
  return none;
}

export function SM26InvitationImport({ eventId, existingEmails, existingNames, onImported, onClose }: {
  eventId: string;
  existingEmails: Set<string>;
  existingNames: Set<string>;
  onImported: () => void | Promise<void>;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [fileName, setFileName] = useState('');
  const [unmapped, setUnmapped] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const read = async (file: File) => {
    // Excel prefixes a UTF-8 BOM. Left in place it becomes part of the first
    // header cell, so "Name" stops matching and the file reads as headerless.
    // file.text() always decodes as UTF-8. Excel on a French Windows saves CSV
    // as windows-1252 by default, and every accent then comes back as U+FFFD —
    // which silently breaks the accented headers (Société, Réponse, Téléphone)
    // as well as the names. A replacement character is proof of the wrong
    // codec, so decode again with the one it almost certainly is.
    const buf = await file.arrayBuffer();
    let text = new TextDecoder('utf-8').decode(buf);
    if (text.includes('�')) {
      try { text = new TextDecoder('windows-1252').decode(buf); } catch { /* keep the utf-8 read */ }
    }
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const grid = parseCSV(text, sniffDelimiter(text)).filter(r => r.some(c => c.trim()));
    if (grid.length < 2) {
      toast({ title: 'Nothing to import', description: 'The file needs a header row and at least one guest.', variant: 'destructive' });
      return;
    }
    const header = grid[0].map(norm);
    const idx: Partial<Record<keyof Draft, number>> = {};
    header.forEach((h, i) => {
      const f = FIELDS.find(f => f.names.includes(h));
      if (f && idx[f.key] === undefined) idx[f.key] = i;
    });
    setUnmapped(header.filter((h, i) => h && !Object.values(idx).includes(i)));

    if (idx.name === undefined) {
      toast({
        title: 'No name column',
        description: `Add a column called Name (or Nom). Found: ${header.filter(Boolean).join(', ')}`,
        variant: 'destructive',
      });
      return;
    }

    const at = (r: string[], k: keyof Draft) => (idx[k] === undefined ? '' : (r[idx[k] as number] || '').trim());
    const seen = new Set<string>();
    const out: Row[] = grid.slice(1).map(r => {
      const rawSent = at(r, 'sent');
      const date = readDate(rawSent);
      const draft: Draft = {
        name: at(r, 'name'), role: at(r, 'role'), org: at(r, 'org'), country: at(r, 'country'),
        email: at(r, 'email').toLowerCase(), phone: at(r, 'phone'),
        channel: readChannel(at(r, 'channel')), sent: date.iso,
        reply: readReply(at(r, 'reply')), note: at(r, 'note'),
      };
      const problems: string[] = [];
      let skip = false;
      if (!draft.name) { problems.push('no name — skipped'); skip = true; }
      if (draft.email && !draft.email.includes('@')) {
        problems.push('that is not an email address — skipped'); skip = true;
      }
      const key = draft.email || norm(draft.name);
      if (key && seen.has(key)) { problems.push('appears twice in this file — skipped'); skip = true; }
      if (key) seen.add(key);
      if (draft.email && existingEmails.has(draft.email)) {
        problems.push('already invited — skipped'); skip = true;
      } else if (!draft.email && existingNames.has(norm(draft.name))) {
        problems.push('same name already invited — skipped'); skip = true;
      }
      if (rawSent && !draft.sent) problems.push(`could not read the date “${rawSent}” — imported as not sent`);
      if (date.ambiguous) {
        problems.push(`“${rawSent}” read as ${draft.sent} — day first. Check it if this file came from the US.`);
      }
      return { draft, problems, skip };
    });
    setRows(out);
    setFileName(file.name);
  };

  const keep = (rows || []).filter(r => !r.skip);

  const doImport = async () => {
    if (!keep.length) return;
    setBusy(true);
    try {
    // Whoever runs the import is the staff member behind these rows. Without it
    // the console prints "not sent" beside an invitation whose status is sent.
    //
    // getUser() can REJECT rather than return an error: it takes a Navigator
    // LockManager lock, and a LockAcquireTimeoutError is not an AuthError, so
    // auth-js never converts it. This project already carries a workaround for a
    // Web Locks deadlock (see CLAUDE.md), so an unguarded await here is how the
    // Import button ends up spinning for ever with no message.
    const { data: u } = await supabase.auth.getUser();
    const me = u?.user?.id || null;
    const payload = keep.map(({ draft }) => ({
      event_id: eventId,
      created_by: me,
      sent_by: draft.sent ? me : null,
      letter_type: 'general',
      register: 'standard',
      language: 'fr',
      recipient_name: draft.name,
      recipient_role: draft.role || null,
      recipient_org: draft.org || null,
      country: draft.country || null,
      recipient_email: draft.email || null,
      recipient_phone: draft.phone || null,
      channel: draft.channel,
      // No letter was drawn here, so the row carries no body — only the fact
      // that something went out, when, and what came back.
      subject: '',
      salutation: '',
      status: draft.sent ? 'sent' : 'draft',
      sent_at: draft.sent ? new Date(`${draft.sent}T12:00:00Z`).toISOString() : null,
      letter_date: draft.sent || new Date().toISOString().slice(0, 10),
      rsvp_status: draft.reply,
      rsvp_at: draft.reply !== 'awaiting' ? new Date().toISOString() : null,
      rsvp_by: draft.reply !== 'awaiting' ? me : null,
      rsvp_note: draft.note || null,
      notes: 'Imported from a list kept outside the platform',
    }));
    const { error } = await supabase.from('sm_invitation').insert(payload);
    if (error) { toast({ title: 'Import failed', description: error.message, variant: 'destructive' }); return; }
    toast({ title: `${payload.length} invitation${payload.length > 1 ? 's' : ''} imported` });
    setRows(null); setFileName('');
    await onImported();
    onClose();
    } catch (e) {
      toast({ title: 'Import failed', description: String((e as Error).message || e), variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault(); setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) read(f);
  };

  return (
    <Card className="border-0 shadow-sm ring-1 ring-primary/20">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-semibold text-gray-800 flex items-center gap-1.5">
            <FileUp className="h-4 w-4 text-primary" /> Import a list of invitations already sent
          </div>
          <Button size="sm" variant="ghost" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>

        {!rows ? (
          <>
            <div
              onDragOver={e => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              onClick={() => fileRef.current?.click()}
              className={`rounded-lg border-2 border-dashed p-6 text-center cursor-pointer transition-colors ${
                dragging ? 'border-primary bg-primary/5' : 'border-gray-200 hover:border-primary/40'}`}>
              <Upload className="h-6 w-6 mx-auto text-gray-400 mb-2" />
              <div className="text-sm text-gray-600">Drop a CSV here, or click to choose one</div>
              <div className="text-[11px] text-gray-400 mt-1">
                Comma, semicolon or tab separated. Nothing is saved until you have seen the preview.
              </div>
            </div>
            <input ref={fileRef} type="file" accept=".csv,.tsv,.txt,text/csv" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; e.currentTarget.value = ''; if (f) read(f); }} />
            <p className="text-[11px] text-gray-500">
              Columns it looks for — only <b>Name</b> is required, the rest fill in what they can:
              Name · Title · Organisation · Country · Email · Phone · Channel · Sent on · Reply · Note.
              French headers work too (Nom, Fonction, Société, Pays, Courriel, Canal, Date envoi, Réponse).
            </p>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 flex-wrap text-xs">
              <span className="text-gray-500">{fileName}</span>
              <Pill label={`${keep.length} to import`} cls="bg-green-50 text-green-700 border-green-200" />
              {rows.length - keep.length > 0 &&
                <Pill label={`${rows.length - keep.length} skipped`} cls="bg-amber-50 text-amber-700 border-amber-200" />}
              {unmapped.length > 0 &&
                <span className="text-gray-400">ignored columns: {unmapped.join(', ')}</span>}
            </div>

            <div className="max-h-80 overflow-auto rounded-lg border border-gray-100">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-gray-50">
                  <tr className="text-left text-[10px] uppercase tracking-wide text-gray-400">
                    <th className="px-2 py-1.5">Guest</th><th className="px-2 py-1.5">Organisation</th>
                    <th className="px-2 py-1.5">Email</th><th className="px-2 py-1.5">Channel</th>
                    <th className="px-2 py-1.5">Sent</th><th className="px-2 py-1.5">Reply</th>
                    <th className="px-2 py-1.5" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className={`border-t border-gray-50 ${r.skip ? 'opacity-45' : ''}`}>
                      <td className="px-2 py-1.5">
                        <div className="font-medium">{r.draft.name || '—'}</div>
                        {r.draft.role && <div className="text-gray-400">{r.draft.role}</div>}
                      </td>
                      <td className="px-2 py-1.5 text-gray-500">{r.draft.org || '—'}</td>
                      <td className="px-2 py-1.5 text-gray-500">{r.draft.email || <span className="text-gray-300">none</span>}</td>
                      <td className="px-2 py-1.5 text-gray-500">
                        {INVITE_CHANNELS.find(c => c.key === r.draft.channel)?.label}
                      </td>
                      <td className="px-2 py-1.5 text-gray-500">{r.draft.sent || <span className="text-gray-300">not sent</span>}</td>
                      <td className="px-2 py-1.5">
                        {(() => { const m = RSVP_STATES.find(s => s.key === r.draft.reply); return m ? <Pill label={m.label} cls={m.cls} /> : null; })()}
                      </td>
                      <td className="px-2 py-1.5">
                        {r.problems.map((p, j) => (
                          <div key={j} className="flex items-center gap-1 text-amber-700">
                            <AlertTriangle className="h-3 w-3 shrink-0" /> {p}
                          </div>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center gap-2">
              <Button size="sm" className="gap-1.5" disabled={busy || !keep.length} onClick={doImport}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Import {keep.length} invitation{keep.length > 1 ? 's' : ''}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { setRows(null); setFileName(''); }}>Choose another file</Button>
              <span className="text-[11px] text-gray-400">
                They land as invitations to follow — you record each reply afterwards, as usual.
              </span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
