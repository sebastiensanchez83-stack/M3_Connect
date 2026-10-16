import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Loader2, Save, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/hooks/use-toast';
import type { InvitationCampaign, InvitationCampaignSettings, InvitationCampaignTexts } from './types';
import { deleteCampaign, signatureBytes, updateCampaign, type GlEventLite } from './lib/api';
import { JOIN_PLATFORM_DEFAULT, VARIABLES, dashProblems, unknownVariables } from './lib/render';
import { isEmail } from './lib/norm';
import { WYS_EVENT, WYS_TICKET_TEXTS } from './lib/presets';
import { Segmented, SectionTitle } from './ui';

interface Form {
  name: string; gl_event_id: string; ticket_style: 'white' | 'navy'; rsvp_deadline: string; letter_date: string;
  conference: boolean; gala: boolean; sender_name: string; sender_email: string; reply_to: string; archived: boolean;
  settings: InvitationCampaignSettings; texts: InvitationCampaignTexts;
}

const toForm = (c: InvitationCampaign): Form => ({
  name: c.name, gl_event_id: c.gl_event_id, ticket_style: c.ticket_style, rsvp_deadline: c.rsvp_deadline || '', letter_date: c.letter_date || '',
  conference: c.conference, gala: c.gala, sender_name: c.sender_name || '', sender_email: c.sender_email || '', reply_to: c.reply_to || '',
  archived: !!c.archived_at, settings: { ...(c.settings || {}) },
  texts: { ticket: { ...(c.texts?.ticket || {}) }, letter: { ...(c.texts?.letter || {}) }, email: { ...(c.texts?.email || {}) } },
});
const paras = (list: string[] | undefined) => (list || []).join('\n\n');
const toParas = (t: string) => t.split(/\n\s*\n/).map(s => s.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean);
const lines = (list: string[] | undefined) => (list || []).join('\n');
const toLines = (t: string) => t.split('\n').map(s => s.trim()).filter(Boolean);

export function SettingsTab({ campaign, events, hasGuests, invitedAny, onSaved, listPath = '/admin/invitations', onDeleted }: {
  campaign: InvitationCampaign; events: GlEventLite[]; hasGuests: boolean; invitedAny: boolean; onSaved: (c: InvitationCampaign) => void;
  /** Where to go once the campaign is deleted. */
  listPath?: string;
  /** Called once the campaign is deleted (listPath may be the page already open, which then reloads its list). */
  onDeleted?: () => void;
}) {
  const navigate = useNavigate();
  const [f, setF] = useState<Form>(() => toForm(campaign));
  const [saving, setSaving] = useState(false);
  const [sig, setSig] = useState<'loading' | 'ok' | 'missing'>('loading');
  // Paragraph fields are edited as free text and split on save, so typing a blank line works.
  const [bodyText, setBodyText] = useState({ paragraphs: paras(campaign.texts?.letter?.paragraphs), bullets: lines(campaign.texts?.letter?.bullets), closing: paras(campaign.texts?.letter?.closing_paragraphs) });
  useEffect(() => {
    setF(toForm(campaign));
    setBodyText({ paragraphs: paras(campaign.texts?.letter?.paragraphs), bullets: lines(campaign.texts?.letter?.bullets), closing: paras(campaign.texts?.letter?.closing_paragraphs) });
  }, [campaign]);
  useEffect(() => { signatureBytes().then(b => setSig(b ? 'ok' : 'missing')); }, []);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF(x => ({ ...x, [k]: v }));
  const setS = (k: keyof InvitationCampaignSettings, v: unknown) => setF(x => ({ ...x, settings: { ...x.settings, [k]: v } }));
  const setT = <B extends 'ticket' | 'letter' | 'email'>(b: B, k: string, v: unknown) =>
    setF(x => ({ ...x, texts: { ...x.texts, [b]: { ...(x.texts[b] || {}), [k]: v } } }));

  const build = (): Form => ({
    ...f,
    texts: { ...f.texts, letter: { ...f.texts.letter, paragraphs: toParas(bodyText.paragraphs), bullets: toLines(bodyText.bullets), closing_paragraphs: toParas(bodyText.closing) } },
  });
  const dirty = useMemo(() => JSON.stringify(build()) !== JSON.stringify(toForm(campaign)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [f, bodyText, campaign]);

  const allTexts = useMemo(() => {
    const b = build();
    return [...Object.values(b.texts.ticket || {}), ...Object.values(b.texts.letter || {}).flat(), b.texts.email?.subject, b.texts.email?.body, b.texts.email?.join_platform_line]
      .filter((x): x is string => typeof x === 'string');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f, bodyText]);
  const unknown = [...new Set(allTexts.flatMap(unknownVariables))];
  const dashes = allTexts.some(dashProblems);
  const template = (f.settings.ticket_artwork || 'template') === 'template';
  const artworkDiffers = template && f.settings.assets === 'wys26' && (!(f.conference && f.gala) ||
    JSON.stringify(f.texts.ticket || {}) !== JSON.stringify(WYS_TICKET_TEXTS)
    || (['date_label', 'venue', 'access', 'contact_email_ticket', 'website'] as const).some(k => (f.settings[k] || '') !== WYS_EVENT[k]));

  const problems: string[] = [];
  if (!f.name.trim()) problems.push('The campaign needs a name.');
  if (!f.conference && !f.gala) problems.push('Choose the conference, the gala dinner or both.');
  if (unknown.length) problems.push(`Unknown variable${unknown.length > 1 ? 's' : ''}: ${unknown.map(u => `{{${u}}}`).join(', ')}. Use one of the list below.`);
  for (const [k, label] of [['sender_email', 'Sender e-mail'], ['reply_to', 'Reply-to']] as const) if (f[k].trim() && !isEmail(f[k].trim())) problems.push(`${label} is not a valid address.`);

  const save = async () => {
    if (problems.length) { toast({ title: problems[0], variant: 'destructive' }); return; }
    const b = build();
    setSaving(true);
    try {
      const saved = await updateCampaign(campaign.id, {
        name: b.name.trim(), gl_event_id: b.gl_event_id, ticket_style: b.ticket_style, rsvp_deadline: b.rsvp_deadline || null, letter_date: b.letter_date || null,
        conference: b.conference, gala: b.gala, sender_name: b.sender_name.trim() || null, sender_email: b.sender_email.trim() || null,
        reply_to: b.reply_to.trim() || null, archived_at: b.archived ? (campaign.archived_at || new Date().toISOString()) : null,
        settings: b.settings, texts: b.texts,
      });
      toast({ title: 'Settings saved' });
      onSaved(saved);
    } catch (e) {
      toast({ title: 'Not saved', description: (e as Error).message, variant: 'destructive' });
    } finally { setSaving(false); }
  };

  const remove = async () => {
    if (!confirm(`Delete the campaign "${campaign.name}" and its guests? This cannot be undone.`)) return;
    try { await deleteCampaign(campaign.id); toast({ title: 'Campaign deleted' }); navigate(listPath); onDeleted?.(); }
    catch (e) { toast({ title: 'Not deleted', description: (e as Error).message, variant: 'destructive' }); }
  };

  const text = (label: string, value: string | undefined, on: (v: string) => void, hint?: ReactNode, type = 'text') => (
    <Labeled label={label} hint={hint}><Input type={type} value={value || ''} onChange={e => on(e.target.value)} /></Labeled>
  );
  const join = f.texts.email?.join_platform_line;

  return (
    <div className="space-y-6 max-w-5xl pb-20">
      <Card title="Campaign">
        <div className="grid sm:grid-cols-2 gap-4">
          {text('Name', f.name, v => set('name', v))}
          <Labeled label="Event (guest list)" hint={hasGuests ? 'Fixed once the campaign has guests.' : 'Invited guests join this guest list, with its QR and door.'}>
            <select className="border rounded-md h-10 px-2 bg-white w-full text-sm" value={f.gl_event_id} disabled={hasGuests} onChange={e => set('gl_event_id', e.target.value)}>
              {events.map(e => <option key={e.id} value={e.id} disabled={e.engine !== 'guest_list_v1'}>{e.title}{e.engine !== 'guest_list_v1' ? ' (not supported)' : ''}</option>)}
            </select>
          </Labeled>
          <Labeled group label="Ticket style"><Segmented label="Ticket style" value={f.ticket_style} onChange={v => set('ticket_style', v)} options={[{ value: 'white', label: 'White' }, { value: 'navy', label: 'Navy' }]} /></Labeled>
          <Labeled group label="Ticket artwork" hint={template ? 'The validated WYS 2026 artwork; only the name is added (identical to the kit samples).' : 'Every text below is drawn from these settings (for the next events).'}>
            <Segmented label="Ticket artwork" value={(f.settings.ticket_artwork || 'template') as 'template' | 'drawn'} onChange={v => setS('ticket_artwork', v)}
              options={[{ value: 'template', label: 'Validated artwork' }, { value: 'drawn', label: 'Drawn from settings' }]} />
          </Labeled>
          {text('RSVP deadline', f.rsvp_deadline, v => set('rsvp_deadline', v), 'Counts down on the Tracking tab.', 'date')}
          {text('Date printed on the letter', f.letter_date, v => set('letter_date', v), 'Empty: the day the PDF is made.', 'date')}
          <Labeled group label="Access written on the guest list">
            <div className="flex gap-4 h-10 items-center text-sm">
              <label className="flex items-center gap-2"><Checkbox checked={f.conference} onCheckedChange={v => set('conference', v === true)} /> Conference</label>
              <label className="flex items-center gap-2"><Checkbox checked={f.gala} onCheckedChange={v => set('gala', v === true)} /> Gala dinner</label>
            </div>
          </Labeled>
          <Labeled group label="Archived" hint="An archived campaign sends nothing.">
            <div className="h-10 flex items-center"><Switch aria-label="Archived" checked={f.archived} onCheckedChange={v => set('archived', v)} /></div>
          </Labeled>
        </div>
      </Card>

      <Card title="Sender">
        <div className="grid sm:grid-cols-3 gap-4">
          {text('Sender name', f.sender_name, v => set('sender_name', v))}
          {text('Sender e-mail', f.sender_email, v => set('sender_email', v), 'events@m3monaco.com only once the m3monaco.com domain is verified on the platform\'s Resend account.', 'email')}
          {text('Replies go to', f.reply_to, v => set('reply_to', v), undefined, 'email')}
        </div>
      </Card>

      <Card title="Event facts">
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {text('Event name', f.settings.name, v => setS('name', v))}
          {text('Edition', f.settings.edition, v => setS('edition', v))}
          {text('Date (as printed)', f.settings.date_label, v => setS('date_label', v))}
          {text('City', f.settings.city, v => setS('city', v))}
          {text('Venue', f.settings.venue, v => setS('venue', v))}
          {text('Access (as printed)', f.settings.access, v => setS('access', v))}
          {text('RSVP deadline (as printed)', f.settings.rsvp_deadline_label, v => setS('rsvp_deadline_label', v))}
          {text('RSVP e-mail', f.settings.rsvp_email, v => setS('rsvp_email', v))}
          {text('Hosts', f.settings.hosts, v => setS('hosts', v))}
          {text('Website', f.settings.website, v => setS('website', v))}
          {text('Contact e-mail on the ticket', f.settings.contact_email_ticket, v => setS('contact_email_ticket', v))}
          {text('Phone', f.settings.phone, v => setS('phone', v))}
          {text('Artwork folder', f.settings.assets, v => setS('assets', v), 'Under public/invitations/: wys26 holds the WYS 2026 tickets, logos and letter banner.')}
          {text('File name prefix', f.settings.file_prefix, v => setS('file_prefix', v), 'WYS gives WYS_Ticket_First_Last.pdf.')}
          <Labeled group label="Letter signature" hint={sig === 'loading' ? 'Checking the SM26 letterhead signature...' : sig === 'ok' ? <span className="text-green-700 inline-flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5" />SM26 letterhead signature found</span> : <span className="text-red-700">The SM26 letterhead signature could not be loaded.</span>}>
            <Segmented label="Letter signature" value={(f.settings.signature || 'sm26') as 'sm26' | 'none'} onChange={v => setS('signature', v)}
              options={[{ value: 'sm26', label: 'SM26 letterhead signature' }, { value: 'none', label: 'None' }]} />
          </Labeled>
        </div>
      </Card>

      <Card title="Ticket texts">
        {template && <p className="text-sm text-gray-600 mb-3">With the validated artwork, the ticket prints the kit's texts; these are used when the ticket is drawn from settings.</p>}
        {artworkDiffers && <Warn>These texts or event facts differ from what the WYS 2026 artwork prints. Switch the ticket artwork to "Drawn from settings" to print them.</Warn>}
        <div className="grid sm:grid-cols-2 gap-4">
          {text('Heading above the name', f.texts.ticket?.eyebrow, v => setT('ticket', 'eyebrow', v))}
          {text('Line under the name', f.texts.ticket?.line_under_name, v => setT('ticket', 'line_under_name', v))}
          {text('Fine print', f.texts.ticket?.fine_print, v => setT('ticket', 'fine_print', v))}
          {text('Stub heading', f.texts.ticket?.stub_top, v => setT('ticket', 'stub_top', v))}
          {text('Stub day', f.texts.ticket?.stub_day, v => setT('ticket', 'stub_day', v))}
          {text('Stub month and year', f.texts.ticket?.stub_month_year, v => setT('ticket', 'stub_month_year', v))}
          {text('Stub city', f.texts.ticket?.stub_city, v => setT('ticket', 'stub_city', v))}
          {text('Stub edition', f.texts.ticket?.stub_edition, v => setT('ticket', 'stub_edition', v))}
        </div>
      </Card>

      <Card title="Letter">
        <p className="text-sm text-gray-600 mb-3">**double stars** print in bold, *single stars* in Pagella italics (conference titles). The guest's name, job title, organisation and "Dear ..." line are added above the text.</p>
        <div className="grid gap-4">
          {text('Place before the date', f.texts.letter?.place, v => setT('letter', 'place', v), 'Monaco gives "Monaco, 9 October 2026".')}
          <Labeled label="Paragraphs (a blank line between paragraphs)"><Textarea rows={8} value={bodyText.paragraphs} onChange={e => setBodyText(b => ({ ...b, paragraphs: e.target.value }))} /></Labeled>
          <Labeled label="Bullet points (one per line)"><Textarea rows={5} value={bodyText.bullets} onChange={e => setBodyText(b => ({ ...b, bullets: e.target.value }))} /></Labeled>
          <Labeled label="Closing paragraphs (a blank line between paragraphs)"><Textarea rows={6} value={bodyText.closing} onChange={e => setBodyText(b => ({ ...b, closing: e.target.value }))} /></Labeled>
          <div className="grid sm:grid-cols-2 gap-4">
            {text('Signatory', f.texts.letter?.signatory_name, v => setT('letter', 'signatory_name', v))}
            {text('Signatory title', f.texts.letter?.signatory_title, v => setT('letter', 'signatory_title', v))}
          </div>
          {text('Footer', f.texts.letter?.footer, v => setT('letter', 'footer', v))}
        </div>
      </Card>

      <Card title="E-mail">
        <div className="grid gap-4">
          {text('Subject', f.texts.email?.subject, v => setT('email', 'subject', v))}
          <Labeled label="Body" hint='"Dear {{greeting}}," becomes "Your Excellency," for an Excellency. The ticket and the letter are attached.'>
            <Textarea rows={14} value={f.texts.email?.body || ''} onChange={e => setT('email', 'body', e.target.value)} />
          </Labeled>
          <div className="rounded-md border p-3 space-y-2">
            <label className="flex items-center gap-3 text-sm">
              <Switch checked={!!join} onCheckedChange={v => setT('email', 'join_platform_line', v ? JOIN_PLATFORM_DEFAULT : null)} />
              <span>Invite the guest to join Smart Marina Connect (a last line of the e-mail; no account is created)</span>
            </label>
            {!!join && <Textarea rows={2} value={join} onChange={e => setT('email', 'join_platform_line', e.target.value)} aria-label="Line inviting the guest to join Smart Marina Connect" />}
          </div>
        </div>
      </Card>

      <Card title="Variables">
        <ul className="grid sm:grid-cols-2 gap-x-6 gap-y-1 text-sm">
          {VARIABLES.map(v => <li key={v.key}><code className="text-[#0A2E5C]">{`{{${v.key}}}`}</code> <span className="text-gray-600">{v.label}</span></li>)}
        </ul>
      </Card>

      {!invitedAny && (
        <Card title="Delete">
          <p className="text-sm text-gray-600 mb-3">Possible while nobody of this campaign has been invited. Afterwards, archive it instead.</p>
          <Button variant="outline" className="text-red-700" onClick={remove}><Trash2 className="h-4 w-4 mr-1" /> Delete this campaign</Button>
        </Card>
      )}

      <div className="fixed bottom-0 left-0 right-0 md:left-56 z-30 border-t bg-white/95 backdrop-blur px-4 py-3 flex flex-wrap items-center gap-3">
        <Button disabled={saving || !dirty} onClick={save}>{saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}Save settings</Button>
        {dirty ? <span className="text-sm text-amber-700">Unsaved changes</span> : <span className="text-sm text-gray-500">All saved</span>}
        {dashes && <span className="text-sm text-amber-700">A text uses a dash as punctuation.</span>}
        {problems.length > 0 && <span className="text-sm text-red-700">{problems[0]}</span>}
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return <section className="rounded-lg border bg-white p-4"><SectionTitle>{title}</SectionTitle>{children}</section>;
}
/** A field with its label; group: for buttons and checkboxes, which a <label> must not wrap. */
function Labeled({ label, hint, children, group = false }: { label: string; hint?: ReactNode; children: ReactNode; group?: boolean }) {
  const inner = <>
    <span className="block text-xs font-medium text-gray-600 mb-1">{label}</span>
    {children}
    {hint && <span className="block text-xs text-gray-500 mt-1">{hint}</span>}
  </>;
  return group ? <div role="group" aria-label={label} className="block min-w-0">{inner}</div> : <label className="block min-w-0">{inner}</label>;
}
function Warn({ children }: { children: ReactNode }) {
  return <p className="mb-3 flex gap-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-sm text-amber-900"><AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />{children}</p>;
}
