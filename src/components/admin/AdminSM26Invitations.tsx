import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  RefreshCw, ArrowLeft, Mail, Plus, Trash2, Download, Eye, FileText, Image as ImageIcon,
  Upload, RotateCcw, ChevronUp, ChevronDown, ChevronRight, Check, X, Loader2, Search,
  Send, FileUp,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { Pill } from '@/components/sm26/SM26ConsoleUI';
import {
  REGISTERS, LETTER_TYPES, bodyParagraphs, complimentaryCloseFor, letterDateLong, salutationFor,
  subjectFor, signOffFor, addressPlaceholder, salutationWord,
  SENDER_DEFAULT, SIGNATORY_DEFAULT, FOOTER_DEFAULT, BUNDLED_ASSETS,
  type EventFacts, type Lang, type Register, type LetterType,
} from '@/lib/invitationTemplates';
import { downloadInvitationPdf, invitationPdfBlobUrl, toDataUrl, type LetterAssets, type LetterData } from '@/lib/invitationPdf';
import { SM26InvitationGuestPanel } from './SM26InvitationGuestPanel';
import { SM26InvitationImport } from './SM26InvitationImport';
import {
  SM26_INVITE_CHANNELS as INVITE_CHANNELS, SM26_RSVP_STATES as RSVP_STATES,
  type SM26Invitation, type SM26InvitationBoardRow,
} from './types';

// The invitation guest list.
//
// One row = ONE INVITED PERSON, whatever the channel. For an institutional guest
// the platform still draws the letter on the M3 letterhead and stores it, so an
// identical copy can be re-issued months later. For an invitation that went out
// through somebody's own mailbox there is no letter at all — just the fact that
// it went, when, and what came back.
//
// Two independent axes, and keeping them apart is the whole point:
//   status      draft → ready → sent    what WE did
//   rsvp_status awaiting → accepted/…   what THEY answered
//
// An accepted invitation becomes a real participant in one click: registration,
// role, badge, fee waiver and the delegation, so the guest is on the check-in
// list and in the badge print run without anybody retyping them.

// The letter fields are typed loosely in types.ts (it must not import the letter
// template module); here they are narrowed to the template's own unions, which
// is what the editor's selectors need.
type Invitation = Omit<SM26Invitation, 'language' | 'letter_type' | 'register'> & {
  language: Lang; letter_type: LetterType; register: Register;
};
type BoardRow = SM26InvitationBoardRow;

// Images plus the two bits of fixed text that belong to the company, not to a
// given letter: the sender block and the legal footer line.
type Letterhead = {
  banner?: string; footerImage?: string; logo?: string; signature?: string; stamp?: string;
  sender?: string; footer?: string;
};
type AssetSlot = 'banner' | 'footerImage' | 'logo' | 'signature' | 'stamp';
// The pixel widths are the ones needed for a crisp 300 dpi print at the size
// each image is actually drawn. They are spelled out because the bundled M3
// logo was 74px wide for a 20mm slot and printed visibly soft.
const ASSET_SLOTS: { key: AssetSlot; label: string; hint: string; bundled?: boolean }[] = [
  { key: 'banner', label: 'Header strip', hint: 'The full-width banner across the top of the page. Use at least 2480px wide.', bundled: true },
  { key: 'footerImage', label: 'Footer strip', hint: 'Full-width band at the foot of every page — partner logos. Use at least 2480px wide.', bundled: true },
  { key: 'logo', label: 'Sender logo', hint: 'Sits next to the M3 address block. Use at least 240px wide, or it prints blurry.', bundled: true },
  { key: 'signature', label: 'Signature', hint: 'Drawn under the signatory’s name, at the foot of the letter. Kept private — never published on the website.', bundled: true },
  { key: 'stamp', label: 'Company stamp', hint: 'Drawn beside the signature. Kept private — never published on the website.' },
];

const statusMeta = (s: string) =>
  s === 'sent' ? { label: 'Sent', cls: 'bg-green-50 text-green-700 border-green-200' }
  : s === 'ready' ? { label: 'Ready to send', cls: 'bg-blue-50 text-blue-700 border-blue-200' }
  : { label: 'Draft', cls: 'bg-gray-50 text-gray-600 border-gray-200' };

const rsvpMeta = (s: string) => RSVP_STATES.find(r => r.key === s) || RSVP_STATES[0];
const channelLabel = (c: string) => INVITE_CHANNELS.find(x => x.key === c)?.label || c;

/**
 * Does this row carry a letter we can print?
 *
 * Deliberately asked of the CONTENT, not of `channel`. Gating on the channel
 * meant that answering "how it reached them" honestly — the PDF was drawn here
 * but scanned and emailed — hid the letter behind a value only the letter editor
 * could change, and the editor was the thing that had just been hidden.
 */
const hasLetterBody = (r: Invitation) =>
  (r.paragraphs || []).some(p => p.trim()) || !!(r.subject || '').trim();

const sameBody = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

// The list is long enough that "where is the Egyptian ambassador" needs an
// answer that is not scrolling.
type Filter = 'all' | 'to_send' | 'awaiting' | 'accepted' | 'declined' | 'participant';
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'Everyone' },
  { key: 'to_send', label: 'Not sent yet' },
  { key: 'awaiting', label: 'Waiting on a reply' },
  { key: 'accepted', label: 'Accepted' },
  { key: 'declined', label: 'Declined' },
  { key: 'participant', label: 'On the participant list' },
];
const matchesFilter = (r: Invitation, f: Filter) => {
  switch (f) {
    case 'to_send': return r.status !== 'sent';
    case 'awaiting': return r.status === 'sent' && !r.registration_id && ['awaiting', 'tentative', 'no_reply'].includes(r.rsvp_status);
    case 'accepted': return r.rsvp_status === 'accepted';
    case 'declined': return r.rsvp_status === 'declined';
    case 'participant': return !!r.registration_id;
    default: return true;
  }
};

export function AdminSM26Invitations() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [event, setEvent] = useState<EventFacts & { id: string } | null>(null);
  const [letterhead, setLetterhead] = useState<Letterhead>({});
  const [assets, setAssets] = useState<LetterAssets>({});
  const [rows, setRows] = useState<Invitation[]>([]);
  const [board, setBoard] = useState<Record<string, BoardRow>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Invitation | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showAssets, setShowAssets] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [quick, setQuick] = useState<{ name: string; role: string; org: string; country: string; email: string; phone: string; channel: string; sent: string; note: string } | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [staff, setStaff] = useState<Record<string, string>>({});
  const [me, setMe] = useState<string | null>(null);
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const staffName = useCallback((id: string | null) => (id ? staff[id] || 'Staff' : null), [staff]);

  // ---- load ---------------------------------------------------------------
  /**
   * `quiet` skips the full-page spinner.
   *
   * The loading guard replaces the whole page with a spinner, so every child
   * unmounts — including the expanded guest panel. Refreshing after an action
   * there therefore threw away a half-filled "turn them into a participant"
   * form: the name split, the roles, the fee waiver, all of it, with no warning.
   * Actions inside the panel reload quietly; only the first load and the
   * Refresh button take the spinner.
   */
  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    const { data: ev } = await supabase.from('sm_event')
      .select('id, name, venue, start_date, end_date, settings').eq('slug', 'sm26').maybeSingle();
    if (!ev) { setLoading(false); return; }
    const e = ev as { id: string; name: string; venue: string | null; start_date: string | null; end_date: string | null; settings: Record<string, unknown> | null };
    const settings = (e.settings || {}) as Record<string, unknown>;
    setEvent({
      id: e.id, name: e.name, venue: e.venue,
      startDate: e.start_date, endDate: e.end_date,
      editionLabel: typeof settings.edition_label === 'string' ? settings.edition_label : null,
    });
    const lh = (settings.letterhead || {}) as Letterhead;
    setLetterhead(lh);
    const { data: list } = await supabase.from('sm_invitation')
      .select('*').eq('event_id', e.id).order('updated_at', { ascending: false });
    setRows((list || []) as Invitation[]);
    // Guests, badges, the door verdict — one call rather than a query per row.
    const { data: bd } = await supabase.rpc('sm_invitation_board', { p_event_id: e.id });
    setBoard(Object.fromEntries(((bd || []) as BoardRow[]).map(b => [b.invitation_id, b])));
    const { data: st } = await supabase.rpc('sm_invitation_staff', { p_event_id: e.id });
    setStaff(Object.fromEntries(((st || []) as { user_id: string; name: string }[]).map(s => [s.user_id, s.name])));
    const { data: u } = await supabase.auth.getUser();
    setMe(u?.user?.id || null);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  // Resolve the letterhead images to data URLs for jsPDF. The banner and the
  // logo ship with the app, so a letter is correct out of the box; an upload
  // simply overrides them.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const out: LetterAssets = {};
      out.banner = await toDataUrl(BUNDLED_ASSETS.banner);
      out.footerImage = await toDataUrl(BUNDLED_ASSETS.footer);
      out.logo = await toDataUrl(BUNDLED_ASSETS.logo);
      out.signature = await toDataUrl(BUNDLED_ASSETS.signature);
      // Only the four image slots are storage paths; sender/footer are text.
      const paths = ASSET_SLOTS.map(s => [s.key, letterhead[s.key]] as const).filter(([, v]) => !!v) as [AssetSlot, string][];
      for (const [k, p] of paths) {
        const { data } = await supabase.storage.from('event-media').createSignedUrl(p, 600);
        if (data?.signedUrl) {
          const url = await toDataUrl(data.signedUrl);
          if (url) out[k] = url;
        }
      }
      if (!cancelled) setAssets(out);
    })();
    return () => { cancelled = true; };
  }, [letterhead]);

  const facts: EventFacts = event || { name: '', venue: null, startDate: null, endDate: null, editionLabel: null };

  // ---- create / edit ------------------------------------------------------
  const blank = (type: LetterType): Invitation => {
    const lang: Lang = 'fr';
    // A ministry is addressed as an Excellency; a company is not.
    const register: Register = type === 'authorities' ? 'excellency' : 'standard';
    return {
      id: '', event_id: event?.id || '', language: lang, letter_type: type, register,
      country: '', sign_off: signOffFor(lang, type), created_by: me, sent_by: null,
      recipient_name: '', recipient_role: '', recipient_org: '',
      address_block: '', salutation: salutationFor(lang, register),
      letter_place: 'Monaco', letter_date: new Date().toISOString().slice(0, 10),
      subject: subjectFor(lang, type, facts),
      paragraphs: bodyParagraphs(lang, type, register, facts, { rsvpEmail: 'info@m3monaco.com' }),
      complimentary_close: complimentaryCloseFor(lang, type, register),
      signatory_name: SIGNATORY_DEFAULT.name, signatory_title: SIGNATORY_DEFAULT.title, signatory_org: SIGNATORY_DEFAULT.org,
      status: 'draft', sent_at: null, notes: '', updated_at: '',
      channel: 'platform_letter', recipient_email: '', recipient_phone: '',
      rsvp_status: 'awaiting', rsvp_at: null, rsvp_by: null, rsvp_note: '',
      discreet: true, registration_id: null, converted_at: null,
    };
  };

  // The editor renders above the list, so on any list longer than a screen it
  // opens out of sight and the only feedback is a faint tint on the row.
  const editorRef = useRef<HTMLDivElement | null>(null);
  const revealEditor = () =>
    requestAnimationFrame(() => editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));

  const openNew = (type: LetterType) => { setDraft(blank(type)); setOpenId('new'); setQuick(null); revealEditor(); };
  const openRow = (r: Invitation) => { setDraft({ ...r }); setOpenId(r.id); revealEditor(); };
  const close = () => { setDraft(null); setOpenId(null); };

  const set = <K extends keyof Invitation>(k: K, v: Invitation[K]) =>
    setDraft(d => (d ? { ...d, [k]: v } : d));

  /** Standard body for the draft's current type + language + register. */
  const templateBody = (d: Invitation) =>
    bodyParagraphs(d.language, d.letter_type, d.register, facts, { country: d.country || '' });

  /**
   * Re-derive the standard wording after a language / type / register change —
   * but only while the body is still untouched, so a letter someone has
   * personalised is never destroyed by flipping a selector.
   */
  const reshape = (patch: Partial<Invitation>) => {
    setDraft(d => {
      if (!d) return d;
      const wasTemplate = sameBody(d.paragraphs, templateBody(d));
      const n: Invitation = { ...d, ...patch };
      n.salutation = salutationFor(n.language, n.register);
      n.complimentary_close = complimentaryCloseFor(n.language, n.letter_type, n.register, salutationWord(n.language, n.salutation));
      n.sign_off = signOffFor(n.language, n.letter_type);
      n.subject = subjectFor(n.language, n.letter_type, facts);
      if (wasTemplate) n.paragraphs = bodyParagraphs(n.language, n.letter_type, n.register, facts, { country: n.country || '' });
      return n;
    });
  };
  /**
   * The country names itself inside one body paragraph, so typing it has to
   * refresh that paragraph. reshape() cannot do this job: by the time it ran,
   * the draft already carried the new country, so its "is the body still the
   * standard wording?" test compared the paragraphs against a template built
   * with that same new country — never a match, so the letter was treated as
   * personalised and kept "« le pays »". Here the comparison happens against
   * the draft as it stands, which still holds the previous country.
   */
  const setCountry = (country: string) => {
    setDraft(d => {
      if (!d) return d;
      const wasTemplate = sameBody(d.paragraphs, templateBody(d));
      const n: Invitation = { ...d, country };
      if (wasTemplate) n.paragraphs = bodyParagraphs(n.language, n.letter_type, n.register, facts, { country });
      return n;
    });
  };

  const switchLanguage = (language: Lang) => reshape({ language });
  const switchRegister = (register: Register) => reshape({ register });
  const switchType = (letter_type: LetterType) =>
    reshape({ letter_type, register: letter_type === 'authorities' ? 'excellency' : 'standard' });

  const reloadTemplate = () => {
    if (!draft) return;
    if (!confirm('Replace the body with the standard wording? Anything you typed in the paragraphs is lost.')) return;
    setDraft(d => (d ? {
      ...d,
      subject: subjectFor(d.language, d.letter_type, facts),
      salutation: salutationFor(d.language, d.register),
      sign_off: signOffFor(d.language, d.letter_type),
      paragraphs: bodyParagraphs(d.language, d.letter_type, d.register, facts, { country: d.country || '' }),
      complimentary_close: complimentaryCloseFor(d.language, d.letter_type, d.register),
    } : d));
  };

  /**
   * The salutation and the complimentary close name the same person, so editing
   * one has to carry into the other — a letter that opens "Monsieur le
   * Ministre," cannot close on "Excellence". The close only follows while it
   * still reads as the generated one; once it has been rewritten by hand, it is
   * left alone.
   */
  const setSalutation = (v: string) => {
    setDraft(d => {
      if (!d) return d;
      const generated = complimentaryCloseFor(d.language, d.letter_type, d.register, salutationWord(d.language, d.salutation));
      const next = { ...d, salutation: v };
      if (d.complimentary_close.trim() === generated.trim()) {
        next.complimentary_close = complimentaryCloseFor(d.language, d.letter_type, d.register, salutationWord(d.language, v));
      }
      return next;
    });
  };

  const setPara = (i: number, v: string) =>
    setDraft(d => (d ? { ...d, paragraphs: d.paragraphs.map((p, j) => (j === i ? v : p)) } : d));
  const addPara = (at: number) =>
    setDraft(d => (d ? { ...d, paragraphs: [...d.paragraphs.slice(0, at), '', ...d.paragraphs.slice(at)] } : d));
  const removePara = (i: number) =>
    setDraft(d => (d ? { ...d, paragraphs: d.paragraphs.filter((_, j) => j !== i) } : d));
  const movePara = (i: number, dir: -1 | 1) =>
    setDraft(d => {
      if (!d) return d;
      const j = i + dir;
      if (j < 0 || j >= d.paragraphs.length) return d;
      const p = [...d.paragraphs];
      [p[i], p[j]] = [p[j], p[i]];
      return { ...d, paragraphs: p };
    });

  // ---- persist ------------------------------------------------------------
  const save = async (): Promise<string | null> => {
    if (!draft || !event) return null;
    // Deliberately not in the payload: rsvp_*, discreet, registration_id and
    // converted_at. They belong to the guest panel and to the conversion RPC,
    // and an UPDATE that listed them would let a letter edit quietly undo an
    // answer somebody recorded an hour earlier.
    const payload = {
      event_id: event.id,
      language: draft.language, letter_type: draft.letter_type, register: draft.register,
      country: draft.country || null,
      sign_off: draft.sign_off,
      created_by: draft.created_by || me,
      // Whoever flips it to "sent" owns that, and it sticks.
      sent_by: draft.status === 'sent' ? (draft.sent_by || me) : null,
      recipient_name: draft.recipient_name || null,
      recipient_role: draft.recipient_role || null,
      recipient_org: draft.recipient_org || null,
      recipient_email: draft.recipient_email || null,
      recipient_phone: draft.recipient_phone || null,
      channel: draft.channel,
      address_block: draft.address_block,
      salutation: draft.salutation,
      letter_place: draft.letter_place,
      letter_date: draft.letter_date,
      subject: draft.subject,
      paragraphs: draft.paragraphs,
      complimentary_close: draft.complimentary_close,
      signatory_name: draft.signatory_name,
      signatory_title: draft.signatory_title,
      signatory_org: draft.signatory_org,
      status: draft.status,
      sent_at: draft.status === 'sent' ? (draft.sent_at || new Date().toISOString()) : null,
      notes: draft.notes || null,
    };
    setBusy('save');
    const q = draft.id
      ? supabase.from('sm_invitation').update(payload).eq('id', draft.id).select('id').single()
      : supabase.from('sm_invitation').insert(payload).select('id').single();
    const { data, error } = await q;
    setBusy(null);
    if (error) { toast({ title: 'Could not save', description: error.message, variant: 'destructive' }); return null; }
    const id = (data as { id: string }).id;
    toast({ title: draft.id ? 'Invitation saved' : 'Invitation created' });
    await load();
    setDraft(d => (d ? { ...d, id } : d));
    setOpenId(id);
    return id;
  };

  /**
   * Record an invitation that went out without this module — a personal email, a
   * phone call, a letter carried by somebody else. No letter is drawn: what is
   * being captured is that it went, when, and to whom.
   */
  const saveQuick = async () => {
    if (!quick || !event || !quick.name.trim()) return;
    setBusy('quick');
    try {
      // A date input can be cleared, and `new Date('T12:00:00Z')` throws — which
      // used to abort the whole function before the insert, leaving no row, no
      // error and the page-wide busy lock stuck on. An invitation with no date
      // is simply one we have not dated.
      // Shape alone is not enough: 2026-13-45 matches the pattern and then
      // throws, and 2026-02-30 silently rolls over to 2 March. Round-tripping
      // through Date is what separates a date from a string that looks like one.
      const looksRight = /^\d{4}-\d{2}-\d{2}$/.test(quick.sent);
      const parsed = looksRight ? new Date(`${quick.sent}T12:00:00Z`) : null;
      const dated = !!parsed && !Number.isNaN(parsed.getTime())
        && parsed.toISOString().slice(0, 10) === quick.sent;
      const today = new Date().toISOString().slice(0, 10);
      const { error } = await supabase.from('sm_invitation').insert({
        event_id: event.id,
        letter_type: 'general', register: 'standard', language: 'fr',
        recipient_name: quick.name.trim(),
        recipient_role: quick.role.trim() || null,
        recipient_org: quick.org.trim() || null,
        country: quick.country.trim() || null,
        recipient_email: quick.email.trim().toLowerCase() || null,
        recipient_phone: quick.phone.trim() || null,
        channel: quick.channel,
        subject: '', salutation: '',
        created_by: me, sent_by: me,
        status: 'sent',
        letter_date: dated ? quick.sent : today,
        sent_at: new Date(`${dated ? quick.sent : today}T12:00:00Z`).toISOString(),
        notes: quick.note.trim() || null,
      });
      if (error) { toast({ title: 'Could not save', description: error.message, variant: 'destructive' }); return; }
      toast({
        title: `${quick.name.trim()} added to the guest list`,
        description: dated ? '' : 'No send date was given, so today was recorded — correct it if it went out earlier.',
      });
      setQuick(null);
      await load();
    } catch (e) {
      toast({ title: 'Could not save', description: String((e as Error).message || e), variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  const remove = async (r: Invitation) => {
    // Be exact about what goes. sm_invitation_guest cascades on the invitation,
    // so the delegation DOES die with it — including names captured but not yet
    // turned into badges, which exist nowhere else.
    const b = board[r.id];
    const lines: string[] = [];
    if (b && b.guest_count > 0) {
      lines.push(`The ${b.guest_count} name${b.guest_count > 1 ? 's' : ''} recorded under "who comes with them" go with it.`);
      if (b.guests_pending > 0) {
        lines.push(`${b.guests_pending} of them have no badge yet and are recorded nowhere else — they will be lost.`);
      }
    }
    if (r.registration_id) {
      lines.push('Their participant record and badges stay — only this invitation and its guest names are removed. Cancel the registration itself if they are no longer coming.');
      if (r.discreet) {
        // Both discretion enforcers look for a surviving sm_invitation row, so
        // deleting the invitation quietly ends the "access badge only" promise:
        // the badges stay NULL today, but the next time anything re-mints one it
        // will carry a scannable token.
        lines.push('"Access badge only" stops being enforced: their badges keep no connect code today, but a re-issued one would become scannable again.');
      }
    }
    const extra = lines.length ? `\n\n${lines.join('\n')}` : '';
    if (!confirm(`Delete the invitation for ${r.recipient_name || 'this recipient'}? This cannot be undone.${extra}`)) return;
    setBusy(`del:${r.id}`);
    const { error } = await supabase.from('sm_invitation').delete().eq('id', r.id);
    setBusy(null);
    if (error) { toast({ title: 'Could not delete', description: error.message, variant: 'destructive' }); return; }
    if (openId === r.id) close();
    if (expanded === r.id) setExpanded(null);
    load();
  };

  // ---- letterhead assets --------------------------------------------------
  /** Persist the whole letterhead object (images + sender + footer). */
  const saveLetterhead = async (next: Letterhead, note?: string) => {
    if (!event) return false;
    const { error } = await supabase.rpc('sm_set_letterhead', { p_event_id: event.id, p_letterhead: next });
    if (error) { toast({ title: 'Could not save the letterhead', description: error.message, variant: 'destructive' }); return false; }
    setLetterhead(next);
    if (note) toast({ title: note });
    return true;
  };

  const uploadAsset = async (slot: AssetSlot, file: File) => {
    if (!event) return;
    setBusy(`asset:${slot}`);
    const ext = (file.name.split('.').pop() || 'png').toLowerCase();
    const path = `letterhead/sm26/${slot}-${Date.now()}.${ext}`;
    const up = await supabase.storage.from('event-media').upload(path, file, { upsert: true, contentType: file.type || undefined });
    if (up.error) { setBusy(null); toast({ title: 'Upload failed', description: up.error.message, variant: 'destructive' }); return; }
    await saveLetterhead({ ...letterhead, [slot]: path }, 'Letterhead updated');
    setBusy(null);
  };
  const clearAsset = async (slot: AssetSlot) => {
    const next = { ...letterhead };
    delete next[slot];
    setBusy(`asset:${slot}`);
    await saveLetterhead(next);
    setBusy(null);
  };

  // ---- render the PDF -----------------------------------------------------
  const letterData = (d: Invitation): LetterData => ({
    senderLines: (letterhead.sender || SENDER_DEFAULT.join('\n')).split(/\r?\n/),
    // The addressee column is assembled from the structured fields, not just the
    // free-text box: who / their title / their organisation were captured on the
    // form but never reached the letter, and the country was only feeding the
    // body paragraph.
    //
    // Institution first, then the post, then the person. These letters are
    // addressed to an office rather than to an individual — the ambassador of
    // the day changes, the embassy does not — and it reads down to the specific
    // in the same order as the envelope.
    addressBlock: [
      d.recipient_org,
      d.recipient_role,
      d.recipient_name,
      ...(d.address_block || '').split(/\r?\n/),
      d.country,
    ].map(s => (s || '').trim()).filter(Boolean).join('\n'),
    place: d.letter_place,
    dateLine: letterDateLong(d.language, d.letter_date),
    // The authorities letter heads its subject with no "Subject:" label.
    subjectLabel: d.letter_type === 'authorities' ? '' : (d.language === 'fr' ? 'Objet' : 'Subject'),
    subject: d.subject,
    salutation: d.salutation,
    paragraphs: d.paragraphs,
    complimentaryClose: d.complimentary_close,
    signOff: d.sign_off,
    signatoryName: d.signatory_name,
    signatoryTitle: d.signatory_title,
    signatoryOrg: d.signatory_org,
    footer: letterhead.footer ?? FOOTER_DEFAULT,
  });

  const preview = async (d: Invitation) => {
    setBusy('preview');
    try {
      const url = await invitationPdfBlobUrl(letterData(d), assets);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      toast({ title: 'Could not build the preview', description: String((e as Error).message || e), variant: 'destructive' });
    } finally { setBusy(null); }
  };
  const download = async (d: Invitation) => {
    setBusy('pdf');
    try {
      const who = d.recipient_name || d.recipient_org || 'invitation';
      await downloadInvitationPdf(letterData(d), assets, `invitation-sm26-${who}`);
    } catch (e) {
      toast({ title: 'Could not build the PDF', description: String((e as Error).message || e), variant: 'destructive' });
    } finally { setBusy(null); }
  };

  // Only the two private slots can actually be missing; the rest ship with the app.
  const missingAssets = useMemo(
    () => ASSET_SLOTS.filter(s => !s.bundled && !letterhead[s.key]).map(s => s.label.toLowerCase()),
    [letterhead]);

  const counts = useMemo(() => Object.fromEntries(
    FILTERS.map(f => [f.key, rows.filter(r => matchesFilter(r, f.key)).length])
  ) as Record<Filter, number>, [rows]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(r => matchesFilter(r, filter)).filter(r => !q || [
      r.recipient_name, r.recipient_role, r.recipient_org, r.recipient_email, r.country,
    ].some(v => (v || '').toLowerCase().includes(q)));
  }, [rows, filter, query]);

  // Used by the importer to flag a name it has seen before rather than creating
  // a second invitation for the same person.
  const existingEmails = useMemo(
    () => new Set(rows.map(r => (r.recipient_email || '').toLowerCase()).filter(Boolean)), [rows]);
  const existingNames = useMemo(
    () => new Set(rows.map(r => (r.recipient_name || '').trim().toLowerCase()).filter(Boolean)), [rows]);

  if (loading) return <div className="flex items-center justify-center h-64"><RefreshCw className="h-8 w-8 animate-spin text-gray-400" /></div>;

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={() => navigate('/admin/sm26')} className="gap-1.5"><ArrowLeft className="h-4 w-4" /> Back to registrations</Button>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Mail className="h-6 w-6 text-primary" /> Invitations &amp; guest list ({rows.length})
        </h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => load()} title="Refresh"><RefreshCw className="h-4 w-4" /></Button>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => { setShowImport(o => !o); setQuick(null); }}>
            <FileUp className="h-4 w-4" /> Import a list
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setShowAssets(o => !o)}><ImageIcon className="h-4 w-4" /> Letterhead</Button>
        </div>
      </div>

      <p className="text-sm text-gray-500 -mt-1 max-w-3xl">
        Every person we invited, however the invitation reached them. Draw the letter here and the platform
        prints it on the M3 letterhead; or simply record one that went out from your own mailbox. Record the
        reply as it comes in, and turn an acceptance into a participant — badge, check-in and print run
        included — in one click.
      </p>

      {/* Starting a new invitation: two letters, or none at all. */}
      <div className="grid sm:grid-cols-3 gap-3">
        {LETTER_TYPES.map(t => (
          <button key={t.key} type="button" onClick={() => openNew(t.key)}
            className="text-left rounded-lg border border-gray-200 bg-white p-4 hover:border-primary/50 hover:shadow-sm transition-all">
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
              <Plus className="h-4 w-4 text-primary" /> {t.en}
            </div>
            <p className="text-xs text-gray-500 mt-1">{t.hint_en}</p>
          </button>
        ))}
        <button type="button"
          onClick={() => {
            close(); setShowImport(false);
            setQuick(q => q ? null : {
              name: '', role: '', org: '', country: '', email: '', phone: '',
              channel: 'email', sent: new Date().toISOString().slice(0, 10), note: '',
            });
          }}
          className="text-left rounded-lg border border-gray-200 bg-white p-4 hover:border-primary/50 hover:shadow-sm transition-all">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
            <Send className="h-4 w-4 text-primary" /> Already invited, outside the platform
          </div>
          <p className="text-xs text-gray-500 mt-1">
            An email you sent yourself, a phone call, a letter carried by somebody else. No letter is drawn —
            it joins the list so the reply can be followed.
          </p>
        </button>
      </div>

      {/* ---- record an off-platform invitation ---- */}
      {quick && (
        <Card className="border-0 shadow-sm ring-1 ring-primary/20">
          <CardContent className="p-4 space-y-3">
            <div className="text-sm font-semibold text-gray-800">Record an invitation already sent</div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <Input placeholder="Who you invited *" value={quick.name} onChange={e => setQuick({ ...quick, name: e.target.value })} />
              <Input placeholder="Title / role" value={quick.role} onChange={e => setQuick({ ...quick, role: e.target.value })} />
              <Input placeholder="Organisation" value={quick.org} onChange={e => setQuick({ ...quick, org: e.target.value })} />
              <Input placeholder="Email (leave empty if there is none)" value={quick.email} onChange={e => setQuick({ ...quick, email: e.target.value })} />
              <Input placeholder="Phone" value={quick.phone} onChange={e => setQuick({ ...quick, phone: e.target.value })} />
              <Input placeholder="Country" value={quick.country} onChange={e => setQuick({ ...quick, country: e.target.value })} />
              <Select value={quick.channel} onValueChange={v => setQuick({ ...quick, channel: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {INVITE_CHANNELS.filter(c => c.key !== 'platform_letter').map(c =>
                    <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <div>
                <Label className="text-[11px] text-gray-500">Sent on</Label>
                <Input type="date" className="mt-0.5" value={quick.sent} onChange={e => setQuick({ ...quick, sent: e.target.value })} />
              </div>
              <Input placeholder="Internal note" value={quick.note} onChange={e => setQuick({ ...quick, note: e.target.value })} />
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" className="gap-1.5" disabled={busy === 'quick' || !quick.name.trim()} onClick={saveQuick}>
                {busy === 'quick' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Add to the guest list
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setQuick(null)}>Cancel</Button>
              <span className="text-xs text-gray-400">No email is sent. This only records what already happened.</span>
            </div>
          </CardContent>
        </Card>
      )}

      {showImport && event && (
        <SM26InvitationImport
          eventId={event.id}
          existingEmails={existingEmails}
          existingNames={existingNames}
          onImported={load}
          onClose={() => setShowImport(false)}
        />
      )}

      {missingAssets.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          The header strip and the M3 logo ship with the platform, so letters already look right.
          Upload the {missingAssets.join(' and ')} once under <b>Letterhead</b> and every future letter carries {missingAssets.length > 1 ? 'them' : 'it'} — you never do this again.
        </div>
      )}

      {/* ---- letterhead assets ---- */}
      {showAssets && (
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2"><ImageIcon className="h-4 w-4 text-primary" /> Letterhead</CardTitle>
            <p className="text-xs text-gray-500">Uploaded once and reused by every letter. Swap an image here and all future letters follow — no code change.</p>
          </CardHeader>
          <CardContent className="grid sm:grid-cols-2 gap-3">
            {ASSET_SLOTS.map(s => (
              <div key={s.key} className="rounded-lg border border-gray-200 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{s.label}</div>
                    <div className="text-[11px] text-gray-400">{s.hint}</div>
                  </div>
                  {letterhead[s.key]
                    ? <Pill label="uploaded" cls="bg-green-50 text-green-700 border-green-200" />
                    : s.bundled
                      ? <Pill label="ships with the app" cls="bg-blue-50 text-blue-700 border-blue-200" />
                      : <Pill label="not set" cls="bg-amber-50 text-amber-700 border-amber-200" />}
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <input ref={el => { fileRefs.current[s.key] = el; }} type="file" accept="image/*" className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; e.currentTarget.value = ''; if (f) uploadAsset(s.key, f); }} />
                  <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" disabled={busy === `asset:${s.key}`}
                    onClick={() => fileRefs.current[s.key]?.click()}>
                    {busy === `asset:${s.key}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                    {letterhead[s.key] ? 'Replace' : 'Upload'}
                  </Button>
                  {letterhead[s.key] && (
                    <Button size="sm" variant="ghost" className="h-8 text-xs text-gray-400 hover:text-red-600" onClick={() => clearAsset(s.key)}>Remove</Button>
                  )}
                  {assets[s.key] && <img src={assets[s.key] as string} alt="" className="h-8 ml-auto object-contain rounded border border-gray-100" />}
                </div>
              </div>
            ))}

            <div className="sm:col-span-2 grid sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-gray-500">Sender block — one line per line</Label>
                <Textarea rows={4} className="mt-1 text-xs font-mono"
                  value={letterhead.sender ?? SENDER_DEFAULT.join('\n')}
                  onChange={e => setLetterhead(l => ({ ...l, sender: e.target.value }))} />
              </div>
              <div>
                <Label className="text-xs text-gray-500">Legal footer — printed small at the bottom of every page</Label>
                <Textarea rows={4} className="mt-1 text-xs"
                  value={letterhead.footer ?? FOOTER_DEFAULT}
                  onChange={e => setLetterhead(l => ({ ...l, footer: e.target.value }))}
                  placeholder="M3 S.A.M. — Monte Carlo Palace, 3/7 Boulevard des Moulins — 98 000 Monaco — R.C.I. … — N.I.S. …" />
                <p className="text-[11px] text-gray-400 mt-1">
                  Copy the exact line from your existing letterhead, including the R.C.I. and N.I.S. numbers.
                </p>
              </div>
              <div className="sm:col-span-2 flex justify-end">
                <Button size="sm" className="gap-1.5" disabled={busy === 'lh'}
                  onClick={async () => { setBusy('lh'); await saveLetterhead(letterhead, 'Letterhead saved'); setBusy(null); }}>
                  {busy === 'lh' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save sender &amp; footer
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ---- editor ---- */}
      {draft && (
        <Card className="border-0 shadow-sm scroll-mt-4" ref={editorRef}>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <CardTitle className="text-base flex items-center gap-2">
                <FileText className="h-4 w-4 text-primary" />
                {draft.id ? 'Edit the letter' : 'New letter'}
              </CardTitle>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="ghost" onClick={close}>Close</Button>
                <Button size="sm" variant="outline" className="gap-1.5" disabled={!!busy} onClick={() => preview(draft)}><Eye className="h-4 w-4" /> Preview</Button>
                <Button size="sm" variant="outline" className="gap-1.5" disabled={!!busy} onClick={() => download(draft)}><Download className="h-4 w-4" /> PDF</Button>
                <Button size="sm" className="gap-1.5" disabled={busy === 'save'} onClick={save}>
                  {busy === 'save' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* type + language + register + status */}
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-gray-500">Kind of letter</Label>
                <Select value={draft.letter_type} onValueChange={v => switchType(v as LetterType)}>
                  <SelectTrigger className="h-9 mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {LETTER_TYPES.map(t => <SelectItem key={t.key} value={t.key}>{t.en}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {/* Shown for both kinds: the authorities letter names the country in
                  its delegation paragraph, and every letter needs it on the last
                  line of the address. */}
              <div>
                <Label className="text-xs text-gray-500">
                  {draft.letter_type === 'authorities' ? 'Country / territory (named in the letter)' : 'Country'}
                </Label>
                <Input className="h-9 mt-1" value={draft.country || ''}
                  onChange={e => setCountry(e.target.value)}
                  placeholder={draft.language === 'fr' ? "l'Égypte" : 'Egypt'} />
                {draft.language === 'fr' && draft.letter_type === 'authorities' && (
                  <p className="text-[11px] text-gray-400 mt-1">
                    Include the article: <i>l’Égypte</i>, <i>le Maroc</i>, <i>les Émirats arabes unis</i>.
                  </p>
                )}
              </div>
            </div>

            <div className="grid sm:grid-cols-3 gap-3">
              <div>
                <Label className="text-xs text-gray-500">Language</Label>
                <div className="flex rounded-lg border border-gray-200 overflow-hidden mt-1 w-fit">
                  {(['fr', 'en'] as Lang[]).map(l => (
                    <button key={l} type="button" onClick={() => switchLanguage(l)}
                      className={`px-4 h-9 text-sm ${draft.language === l ? 'bg-primary text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
                      {l === 'fr' ? 'Français' : 'English'}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <Label className="text-xs text-gray-500">Form of address</Label>
                <Select value={draft.register} onValueChange={v => switchRegister(v as Register)}>
                  <SelectTrigger className="h-9 mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {REGISTERS.map(r => <SelectItem key={r.key} value={r.key}>{draft.language === 'fr' ? r.fr : r.en}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs text-gray-500">Has it gone out?</Label>
                <Select value={draft.status} onValueChange={v => set('status', v)}>
                  <SelectTrigger className="h-9 mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="ready">Ready to send</SelectItem>
                    <SelectItem value="sent">Sent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* recipient */}
            <div className="grid sm:grid-cols-3 gap-3">
              <div><Label className="text-xs text-gray-500">Recipient name</Label>
                <Input className="h-9 mt-1" value={draft.recipient_name || ''} onChange={e => set('recipient_name', e.target.value)} placeholder="Dr. Tarek Dahroug" /></div>
              <div><Label className="text-xs text-gray-500">Title / role</Label>
                <Input className="h-9 mt-1" value={draft.recipient_role || ''} onChange={e => set('recipient_role', e.target.value)} placeholder="Ambassador" /></div>
              <div><Label className="text-xs text-gray-500">Organisation</Label>
                <Input className="h-9 mt-1" value={draft.recipient_org || ''} onChange={e => set('recipient_org', e.target.value)} placeholder="Embassy of Egypt in France" /></div>
            </div>

            {/* How to reach them. Never printed on the letter — this is how the
                platform emails them a badge later, and how the list is chased. */}
            <div className="grid sm:grid-cols-3 gap-3">
              <div><Label className="text-xs text-gray-500">Email — not printed, used to send their badge</Label>
                <Input className="h-9 mt-1" value={draft.recipient_email || ''} onChange={e => set('recipient_email', e.target.value)} placeholder="Leave empty if there is none" /></div>
              <div><Label className="text-xs text-gray-500">Phone — not printed</Label>
                <Input className="h-9 mt-1" value={draft.recipient_phone || ''} onChange={e => set('recipient_phone', e.target.value)} /></div>
              <div><Label className="text-xs text-gray-500">How it reached them</Label>
                <Select value={draft.channel} onValueChange={v => set('channel', v)}>
                  <SelectTrigger className="h-9 mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {INVITE_CHANNELS.map(c => <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label className="text-xs text-gray-500">Address block — printed as typed, one line per line</Label>
              <Textarea rows={5} className="mt-1 font-mono text-xs" value={draft.address_block} onChange={e => set('address_block', e.target.value)}
                placeholder={addressPlaceholder(draft.language, draft.letter_type)} />
            </div>

            <div className="grid sm:grid-cols-3 gap-3">
              <div><Label className="text-xs text-gray-500">Place</Label>
                <Input className="h-9 mt-1" value={draft.letter_place} onChange={e => set('letter_place', e.target.value)} /></div>
              <div><Label className="text-xs text-gray-500">Date</Label>
                <Input type="date" className="h-9 mt-1" value={draft.letter_date} onChange={e => set('letter_date', e.target.value)} /></div>
              <div><Label className="text-xs text-gray-500">Salutation</Label>
                <Input className="h-9 mt-1" value={draft.salutation} onChange={e => setSalutation(e.target.value)} /></div>
            </div>

            <div>
              <Label className="text-xs text-gray-500">Subject</Label>
              <Input className="h-9 mt-1" value={draft.subject} onChange={e => set('subject', e.target.value)} />
            </div>

            {/* body */}
            <div>
              <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
                <Label className="text-xs text-gray-500">
                  Body — wrap text in **double asterisks** to print it in bold
                </Label>
                <Button size="sm" variant="ghost" className="h-7 text-xs gap-1.5 text-gray-500" onClick={reloadTemplate}>
                  <RotateCcw className="h-3.5 w-3.5" /> Reload the {draft.language === 'fr' ? 'French' : 'English'} template
                </Button>
              </div>
              <div className="space-y-2">
                {draft.paragraphs.map((p, i) => (
                  <div key={i} className="flex gap-2">
                    <Textarea rows={3} className="text-sm" value={p} onChange={e => setPara(i, e.target.value)}
                      placeholder="Write a paragraph specific to this guest…" />
                    <div className="flex flex-col gap-1 shrink-0">
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-gray-300 hover:text-gray-700" title="Move up" onClick={() => movePara(i, -1)}><ChevronUp className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-gray-300 hover:text-gray-700" title="Move down" onClick={() => movePara(i, 1)}><ChevronDown className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-gray-300 hover:text-red-600" title="Remove" onClick={() => removePara(i)}><Trash2 className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-gray-300 hover:text-primary" title="Add a paragraph below" onClick={() => addPara(i + 1)}><Plus className="h-4 w-4" /></Button>
                    </div>
                  </div>
                ))}
                {draft.paragraphs.length === 0 && (
                  <Button size="sm" variant="outline" className="gap-1.5" onClick={() => addPara(0)}><Plus className="h-4 w-4" /> Add a paragraph</Button>
                )}
              </div>
            </div>

            <div className="grid sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <Label className="text-xs text-gray-500">Complimentary close</Label>
                <Textarea rows={2} className="mt-1 text-sm" value={draft.complimentary_close} onChange={e => set('complimentary_close', e.target.value)} />
              </div>
              <div>
                <Label className="text-xs text-gray-500">Sign-off above the signature</Label>
                <Input className="h-9 mt-1" value={draft.sign_off} onChange={e => set('sign_off', e.target.value)} placeholder="Yours sincerely," />
              </div>
            </div>

            <div className="grid sm:grid-cols-3 gap-3">
              <div><Label className="text-xs text-gray-500">Signatory</Label>
                <Input className="h-9 mt-1" value={draft.signatory_name} onChange={e => set('signatory_name', e.target.value)} /></div>
              <div><Label className="text-xs text-gray-500">Title</Label>
                <Input className="h-9 mt-1" value={draft.signatory_title} onChange={e => set('signatory_title', e.target.value)} /></div>
              <div><Label className="text-xs text-gray-500">Company</Label>
                <Input className="h-9 mt-1" value={draft.signatory_org} onChange={e => set('signatory_org', e.target.value)} /></div>
            </div>

            <div>
              <Label className="text-xs text-gray-500">Internal note — never printed</Label>
              <Input className="h-9 mt-1" value={draft.notes || ''} onChange={e => set('notes', e.target.value)} placeholder="Hand-delivered by the Embassy, follow up on 5 Sep…" />
            </div>
          </CardContent>
        </Card>
      )}

      {/* ---- filters ---- */}
      {rows.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          {FILTERS.map(f => (
            <button key={f.key} type="button" onClick={() => setFilter(f.key)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                filter === f.key ? 'bg-primary text-white border-primary' : 'border-gray-200 text-gray-600 hover:border-primary/40'}`}>
              {f.label} <span className={filter === f.key ? 'opacity-80' : 'text-gray-400'}>{counts[f.key]}</span>
            </button>
          ))}
          <div className="relative ml-auto">
            <Search className="h-4 w-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <Input className="h-9 pl-8 w-56" placeholder="Search a guest…" value={query} onChange={e => setQuery(e.target.value)} />
          </div>
        </div>
      )}

      {/* ---- list ---- */}
      <Card className="border-0 shadow-sm">
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <div className="py-12 text-center text-gray-400 text-sm">
              Nobody on the list yet. Draw a letter above, record one you already sent, or import a list.
            </div>
          ) : visible.length === 0 ? (
            <div className="py-12 text-center text-gray-400 text-sm">
              Nobody matches that. Clear the search, or pick another filter.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-[11px] uppercase tracking-wide text-gray-400 border-b border-gray-100">
                  <th className="px-4 py-2">Guest</th><th className="px-4 py-2">Invited</th>
                  <th className="px-4 py-2">Reply</th><th className="px-4 py-2">Participant</th>
                  <th className="px-4 py-2">Staff</th><th className="px-4 py-2" />
                </tr></thead>
                <tbody>
                  {visible.map(r => {
                    const m = statusMeta(r.status);
                    const rm = rsvpMeta(r.rsvp_status);
                    const b = board[r.id];
                    const isOpen = expanded === r.id;
                    const hasLetter = hasLetterBody(r);
                    return [
                      <tr key={r.id} className={`border-b border-gray-50 hover:bg-gray-50 ${openId === r.id || isOpen ? 'bg-primary/5' : ''}`}>
                        <td className="px-4 py-2.5 cursor-pointer" onClick={() => setExpanded(isOpen ? null : r.id)}>
                          <div className="flex items-center gap-1.5">
                            <ChevronRight className={`h-4 w-4 text-gray-300 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                            <div>
                              <div className="font-medium">{r.recipient_name || '—'}</div>
                              <div className="text-xs text-gray-400">
                                {[r.recipient_role, r.recipient_org].filter(Boolean).join(' · ') || r.subject || '—'}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-1 flex-wrap">
                            <Pill label={m.label} cls={m.cls} />
                            {hasLetter && <Pill label={r.letter_type === 'authorities' ? 'Authorities' : 'General'} cls="bg-blue-50 text-blue-700 border-blue-200" />}
                            {r.channel !== 'platform_letter' && <Pill label={channelLabel(r.channel)} cls="bg-gray-50 text-gray-600 border-gray-200" />}
                          </div>
                          <div className="text-[11px] text-gray-400 mt-0.5">{(r.sent_at || '').slice(0, 10) || r.letter_date}</div>
                        </td>
                        <td className="px-4 py-2.5">
                          <Pill label={rm.label} cls={rm.cls} />
                          {b && b.guest_count > 0 && (
                            <div className="text-[11px] text-gray-400 mt-0.5">+{b.guest_count} with them</div>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          {!r.registration_id ? (
                            <span className="text-xs text-gray-300">not yet</span>
                          ) : (
                            <div className="flex flex-col gap-0.5">
                              <div className="flex items-center gap-1 flex-wrap">
                                {b?.door_ok
                                  ? <Pill label="door OK" cls="bg-green-50 text-green-700 border-green-200" />
                                  : <Pill label="door refuses" cls="bg-red-50 text-red-700 border-red-200" />}
                                <span className="text-[11px] text-gray-400">{b?.badge_count ?? 0} badge{(b?.badge_count ?? 0) > 1 ? 's' : ''}</span>
                              </div>
                              <span className="text-[11px] text-gray-400">
                                {(b?.exported_count ?? 0) >= (b?.badge_count ?? 0)
                                  ? 'labels printed'
                                  : `${(b?.badge_count ?? 0) - (b?.exported_count ?? 0)} not printed yet`}
                              </span>
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-xs text-gray-500 whitespace-nowrap">
                          {staffName(r.created_by) && <div>Prepared by {staffName(r.created_by)}</div>}
                          {r.sent_by
                            ? <div className="text-green-700">Sent by {staffName(r.sent_by)}{r.sent_at ? ` · ${r.sent_at.slice(0, 10)}` : ''}</div>
                            : <div className="text-gray-300">not sent</div>}
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center justify-end gap-1">
                            {/* Always reachable: this is the only editor for the
                                recipient, the email and the channel, whether or
                                not a letter was ever drawn. */}
                            <Button size="icon" variant="ghost" className="h-7 w-7 text-gray-400 hover:text-primary"
                              title={hasLetter ? 'Open the letter' : 'Edit this record, or write a letter for it'}
                              onClick={() => openRow(r)}><FileText className="h-4 w-4" /></Button>
                            {hasLetter && (
                              <Button size="icon" variant="ghost" className="h-7 w-7 text-gray-400 hover:text-primary" title="Download the PDF"
                                disabled={!!busy} onClick={() => download(r)}><Download className="h-4 w-4" /></Button>
                            )}
                            <Button size="icon" variant="ghost" className="h-7 w-7 text-gray-400 hover:text-red-600" title="Delete"
                              disabled={busy === `del:${r.id}`} onClick={() => remove(r)}><X className="h-4 w-4" /></Button>
                          </div>
                        </td>
                      </tr>,
                      isOpen ? (
                        <tr key={`${r.id}-panel`} className="bg-gray-50/60">
                          <td colSpan={6} className="px-4 py-4">
                            <SM26InvitationGuestPanel
                              invitation={r}
                              board={b}
                              staffName={staffName}
                              onChanged={() => load(true)}
                            />
                          </td>
                        </tr>
                      ) : null,
                    ];
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
