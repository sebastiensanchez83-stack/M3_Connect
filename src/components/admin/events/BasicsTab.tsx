import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Loader2, Plus, Trash2, Upload, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/lib/supabase';
import { fileMeta, resizeImage } from '@/lib/image';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { COUNTRIES } from '@/lib/countries';
import { Block, ChoiceCards, EDITOR_BTN, Field, INPUT, Note, TEXTAREA } from './editorUi';
import { StaffAlertBlock } from './EmailsTab';
import { TIMEZONE_VALUES, addMinutesToWall, formatInZone, slugify, timezoneLabel, wallToIso, type RegistrationMode } from './eventAdmin';
import { placeLine, type BasicsForm, type EmailsForm, type FormIssue, type Visibility } from './editorModel';
import { SlugAddressPanel } from '../SlugAddressPanel';
import { eventPath } from '@/lib/seoMeta';

interface SectorRow { id: string; label: string }

/**
 * Basics: what the event is and when. The web address follows the title until it is
 * typed by hand or the event is saved; it is fixed once the event is published or
 * someone has registered (their e-mails and door passes carry it).
 */
export function BasicsTab({
  value,
  onChange,
  issues,
  isNew,
  slugLocked,
  slugLockedByRegistrations = false,
  canPublish,
  eventId,
  pageSlug = null,
  savedVisibility,
  kindOpensOldEditor,
  savedTitle,
  onsiteEditor = false,
  staff,
  hiddenTest,
}: {
  value: BasicsForm;
  onChange: (next: BasicsForm) => void;
  issues: FormIssue[];
  isNew: boolean;
  /**
   * On-site event in the on-site editor (onsite_v2 on, a hidden test, or ?editor=new):
   * venue, address, city and country, hidden tests, and the M3 team block here.
   */
  onsiteEditor?: boolean;
  /** On-site editor: the M3 team fields (stored with the e-mails), shown in Basics (spec §8.2). */
  staff?: { value: EmailsForm; onChange: (next: EmailsForm) => void; mode: RegistrationMode };
  /**
   * On-site editor: a hidden test takes registrations from anyone with its link until it
   * closes (contract §9). `closed`: the closing date (form value) is past; `onCloseNow`
   * sets it to now (saved with the next Save).
   */
  hiddenTest?: { closed: boolean; onCloseNow: () => void };
  /** Published once, or someone registered: the web address cannot change any more. */
  slugLocked: boolean;
  /** Locked because people registered (the event is not published). */
  slugLockedByRegistrations?: boolean;
  /** The registration switch of this kind is on, or the event is already published. */
  canPublish: boolean;
  eventId: string | null;
  /** The event page's readable address as loaded (events.slug); null before the migration: the id link. */
  pageSlug?: string | null;
  /** How the event is saved now (null for a new event): the registration link is shown once it works. */
  savedVisibility: Visibility | null;
  /** New event, editor not forced: a type whose switch is off opens the current editor instead. */
  kindOpensOldEditor: { webinar: boolean; onsite: boolean } | null;
  /** The title as saved: when it changes (a save), the event page address is read again. */
  savedTitle?: string;
}) {
  const { t } = useTranslation();
  const v = value;
  const set = <K extends keyof BasicsForm>(k: K, val: BasicsForm[K]) => onChange({ ...v, [k]: val });
  const err = (field: string) => issues.find((i) => i.tab === 'basics' && i.field === field)?.message;
  const webinar = v.kind === 'webinar';

  // Sectors (event_sectors): which members see this event in their suggestions.
  const [sectors, setSectors] = useState<SectorRow[]>([]);
  useEffect(() => {
    let alive = true;
    supabase.from('sectors').select('id, label').eq('is_active', true).order('label')
      .then(({ data }) => { if (alive && data) setSectors(data as SectorRow[]); });
    return () => { alive = false; };
  }, []);

  // A new event's address follows its title until someone types a different one.
  const setTitle = (title: string) => {
    const follows = isNew && !slugLocked && (v.slug === '' || v.slug === slugify(v.title));
    onChange({ ...v, title, slug: follows ? slugify(title) : v.slug });
  };

  const setStart = (start: string) => {
    // A webinar usually lasts an hour: propose the end once the start is set.
    const end = !v.end && start && !v.isFullDay && /T\d{2}:\d{2}$/.test(start) ? addMinutesToWall(start, 60) : v.end;
    onChange({ ...v, start, end });
  };

  // On-site editor: the one-line place (e-mails, cards) follows the venue and the city.
  const setPlace = (k: 'venue' | 'address' | 'city' | 'country', val: string) => {
    const next = { ...v, [k]: val };
    onChange(k === 'venue' || k === 'city' ? { ...next, location: placeLine(next.venue, next.city) } : next);
  };
  const testsAllowed = webinar || onsiteEditor;

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const regLink = v.slug ? `${origin}/register/${v.slug}` : '';
  const startIso = v.start ? wallToIso(v.start, v.timezone) : null;

  const visibilityOptions: { value: Visibility; title: string; body: string; disabled?: boolean }[] = [
    {
      value: 'draft',
      title: t('adminEvents.basics.draft', 'Draft'),
      body: t('adminEvents.basics.draftBody', 'Only M3 sees it. Nobody can register yet.'),
    },
    {
      value: 'published',
      title: t('adminEvents.basics.published', 'Published'),
      body: canPublish
        ? t('adminEvents.basics.publishedBody', 'Listed on the site. People can register.')
        : webinar
          ? t('adminEvents.basics.publishedLater', 'Opens once the new event pages are live.')
          : onsiteEditor
            ? t('adminEvents.basics.publishedLaterOnsiteLive', 'Opens once on-site registration is live on the site. Test it as a hidden event meanwhile.')
            : t('adminEvents.basics.publishedLaterOnsite', 'On-site events can be published from a later update.'),
      disabled: !canPublish && v.visibility !== 'published',
    },
    {
      value: 'hidden',
      title: t('adminEvents.basics.hidden', 'Hidden test'),
      // On-site registrations cannot be decided before the on-site editor: test
      // registrants would wait "under review" with nobody able to answer them.
      body: testsAllowed || savedVisibility === 'hidden'
        ? t('adminEvents.basics.hiddenBody', 'Never listed. Registration works only with the direct link, for tests.')
        : t('adminEvents.basics.hiddenLaterOnsite', 'Tests of on-site registration come with the on-site editor.'),
      disabled: !testsAllowed && savedVisibility !== 'hidden',
    },
  ];

  return (
    <div className="space-y-6">
      <Block
        title={t('adminEvents.basics.whatTitle', 'The event')}
        description={t('adminEvents.basics.whatBody', 'The title and description appear on the event page and in every e-mail.')}
      >
        {isNew && (
          <Field label={t('adminEvents.basics.type', 'Type of event')}>
            <ChoiceCards
              label={t('adminEvents.basics.type', 'Type of event')}
              columns={2}
              value={v.kind}
              onChange={(kind) => set('kind', kind)}
              options={[
                {
                  value: 'webinar',
                  title: t('adminEvents.basics.webinar', 'Webinar'),
                  body: kindOpensOldEditor?.webinar
                    ? t('adminEvents.basics.webinarOld', 'Online. Opens the current webinar editor.')
                    : t('adminEvents.basics.webinarBody', 'Online. People join with a link.'),
                },
                {
                  value: 'onsite',
                  title: t('adminEvents.basics.onsite', 'On-site event'),
                  body: kindOpensOldEditor?.onsite
                    ? t('adminEvents.basics.onsiteOld', 'In a venue. Opens the current on-site editor.')
                    : t('adminEvents.basics.onsiteBody', 'In a venue. M3 checks each registration.'),
                },
              ]}
            />
          </Field>
        )}

        <Field label={t('adminEvents.basics.title', 'Title')} htmlFor="ev-title" error={err('title')}>
          <Input
            id="ev-title"
            value={v.title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={webinar ? t('adminEvents.basics.titlePhWebinar', 'Webinar: data standards for connected marinas') : t('adminEvents.basics.titlePh', 'Event title')}
            className={INPUT}
            maxLength={200}
          />
        </Field>

        <Field
          label={t('adminEvents.basics.slug', 'Web address')}
          htmlFor="ev-slug"
          error={err('slug')}
          hint={slugLockedByRegistrations
            ? t('adminEvents.basics.slugLockedRegs', 'Fixed: people have registered, and their e-mails and door passes use this address.')
            : slugLocked
              ? t('adminEvents.basics.slugLocked', 'Fixed: the event is published and this address may already be shared.')
              : t('adminEvents.basics.slugHint', 'Lower-case letters, numbers and dashes. It cannot change once the event is published or someone has registered.')}
        >
          <div className="flex min-w-0 items-center gap-2">
            <span className="hidden shrink-0 text-[14px] text-meta sm:inline">/register/</span>
            <Input
              id="ev-slug"
              value={v.slug}
              disabled={slugLocked}
              onChange={(e) => set('slug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 60))}
              onBlur={() => set('slug', slugify(v.slug))}
              className={cn(INPUT, 'min-w-0')}
              autoCapitalize="none"
              spellCheck={false}
            />
          </div>
          {!isNew && regLink && (savedVisibility === 'published' || savedVisibility === 'hidden') && (
            <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-1 gap-y-1 text-[13px] text-meta">
              <span className="mr-1 min-w-0 break-all">{regLink}</span>
              <button
                type="button"
                onClick={() => { void navigator.clipboard?.writeText(regLink); toast({ title: t('adminEvents.basics.copied', 'Link copied') }); }}
                className="inline-flex min-h-11 items-center gap-1 rounded-pill px-3 font-semibold text-navy hover:bg-chip focus:outline-none focus-visible:shadow-focus"
              >
                <Copy className="h-3.5 w-3.5" aria-hidden="true" /> {t('adminEvents.basics.copy', 'Copy')}
              </button>
              {eventId && (
                <a
                  href={eventPath({ id: eventId, slug: pageSlug })}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-11 items-center rounded-pill px-3 font-semibold text-navy underline-offset-2 hover:underline focus:outline-none focus-visible:shadow-focus"
                >
                  {t('adminEvents.basics.viewPage', 'Event page')}
                </a>
              )}
            </div>
          )}
          {!isNew && savedVisibility === 'draft' && (
            <p className="mt-2 text-[13px] leading-[18px] text-meta">
              {t('adminEvents.basics.linkLater', 'The registration link appears here once the event is published (or saved as a hidden test).')}
            </p>
          )}
        </Field>

        {/* The event page's own address (events.slug), not the registration's above. Saved on its own. */}
        <Field label={t('adminEvents.basics.pageAddress', 'Event page address')} htmlFor="ev-page-slug">
          <SlugAddressPanel
            table="events"
            recordId={isNew ? null : eventId}
            title={v.title}
            version={`${savedVisibility ?? ''}|${savedTitle ?? ''}`}
            inputId="ev-page-slug"
          />
        </Field>

        <Field label={t('adminEvents.basics.description', 'Description')} htmlFor="ev-desc" optional>
          <Textarea
            id="ev-desc"
            value={v.description}
            onChange={(e) => set('description', e.target.value)}
            rows={6}
            placeholder={t('adminEvents.basics.descriptionPh', 'What will people learn? Who is it for?')}
            className={TEXTAREA}
          />
        </Field>
      </Block>

      <Block
        title={t('adminEvents.basics.whenTitle', 'Date and place')}
        description={t('adminEvents.basics.whenBody', 'Times are read in the time zone you choose. E-mails show them in that zone.')}
      >
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label={t('adminEvents.basics.timezone', 'Time zone')}>
            <Select value={v.timezone} onValueChange={(tz) => set('timezone', tz)}>
              <SelectTrigger className={INPUT} aria-label={t('adminEvents.basics.timezone', 'Time zone')}><SelectValue /></SelectTrigger>
              <SelectContent>
                {(TIMEZONE_VALUES.includes(v.timezone) ? TIMEZONE_VALUES : [v.timezone, ...TIMEZONE_VALUES]).map((z) => (
                  <SelectItem key={z} value={z}>{timezoneLabel(z, t)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {!webinar && (
            <div className="flex items-end">
              <label className="flex items-center gap-3 pb-2 text-[14px] font-semibold text-navy">
                <Switch
                  checked={v.isFullDay}
                  onCheckedChange={(on) => onChange({ ...v, isFullDay: on, start: on ? v.start.slice(0, 10) : v.start, end: on ? '' : v.end })}
                />
                {t('adminEvents.basics.fullDay', 'Full day (no times)')}
              </label>
            </div>
          )}
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label={v.isFullDay ? t('adminEvents.basics.day', 'Day') : t('adminEvents.basics.start', 'Starts')} htmlFor="ev-start" error={err('start')}>
            <Input
              id="ev-start"
              type={v.isFullDay ? 'date' : 'datetime-local'}
              value={v.isFullDay ? v.start.slice(0, 10) : v.start}
              onChange={(e) => setStart(e.target.value)}
              className={INPUT}
            />
          </Field>
          {!v.isFullDay && (
            <Field label={t('adminEvents.basics.end', 'Ends')} htmlFor="ev-end" error={err('end')}>
              <Input id="ev-end" type="datetime-local" value={v.end} onChange={(e) => set('end', e.target.value)} className={INPUT} />
            </Field>
          )}
        </div>
        {startIso && (
          <p className="text-[13px] leading-[18px] text-meta">
            {t('adminEvents.basics.shownAs', 'Shown as:')} <span className="font-semibold text-navy">{formatInZone(startIso, v.timezone, !v.isFullDay)}</span>
          </p>
        )}

        {webinar ? (
          <Field
            label={t('adminEvents.basics.meetingUrl', 'Online link (Zoom, Teams, Meet…)')}
            htmlFor="ev-meeting"
            error={err('meetingUrl')}
            optional
            hint={t('adminEvents.basics.meetingHint', 'Only confirmed registrants get it, in their confirmation and reminder e-mails. It is never shown on the public page. You can add it later.')}
          >
            <Input
              id="ev-meeting"
              type="url"
              inputMode="url"
              value={v.meetingUrl}
              onChange={(e) => set('meetingUrl', e.target.value)}
              placeholder="https://"
              className={INPUT}
              autoCapitalize="none"
              spellCheck={false}
            />
          </Field>
        ) : onsiteEditor ? (
          <>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label={t('adminEvents.basics.venue', 'Venue')} htmlFor="ev-venue" optional>
                <Input
                  id="ev-venue"
                  value={v.venue}
                  onChange={(e) => setPlace('venue', e.target.value)}
                  placeholder={t('adminEvents.basics.venuePh', 'Yacht Club de Monaco')}
                  className={INPUT}
                  maxLength={150}
                  autoComplete="off"
                />
              </Field>
              <Field label={t('adminEvents.basics.city', 'City')} htmlFor="ev-city" optional>
                <Input
                  id="ev-city"
                  value={v.city}
                  onChange={(e) => setPlace('city', e.target.value)}
                  placeholder={t('adminEvents.basics.cityPh', 'Monaco')}
                  className={INPUT}
                  maxLength={80}
                  autoComplete="off"
                />
              </Field>
              <Field label={t('adminEvents.basics.address', 'Street address')} htmlFor="ev-address" optional hint={t('adminEvents.basics.addressHint', 'Shown on the event page with a map link.')}>
                <Input
                  id="ev-address"
                  value={v.address}
                  onChange={(e) => setPlace('address', e.target.value)}
                  placeholder={t('adminEvents.basics.addressPh', 'Quai Louis II')}
                  className={INPUT}
                  maxLength={200}
                  autoComplete="off"
                />
              </Field>
              <Field label={t('adminEvents.basics.country', 'Country')} htmlFor="ev-country" optional>
                <Input
                  id="ev-country"
                  value={v.country}
                  onChange={(e) => setPlace('country', e.target.value)}
                  list="ev-country-list"
                  placeholder={t('adminEvents.basics.countryPh', 'Monaco')}
                  className={INPUT}
                  maxLength={80}
                  autoComplete="off"
                />
                <datalist id="ev-country-list">
                  {COUNTRIES.filter((c) => c !== 'Other').map((c) => <option key={c} value={c} />)}
                </datalist>
              </Field>
            </div>
            {v.location && (
              <p className="text-[13px] leading-[18px] text-meta [overflow-wrap:anywhere]">
                {t('adminEvents.basics.placeShown', 'In the e-mails:')} <span className="font-semibold text-navy">{v.location}</span>
              </p>
            )}
          </>
        ) : (
          <Field label={t('adminEvents.basics.location', 'Venue and city')} htmlFor="ev-location" optional>
            <Input
              id="ev-location"
              value={v.location}
              onChange={(e) => set('location', e.target.value)}
              placeholder={t('adminEvents.basics.locationPh', 'Yacht Club de Monaco, Monaco')}
              className={INPUT}
            />
          </Field>
        )}
      </Block>

      {staff && (
        <StaffAlertBlock
          value={staff.value}
          onChange={staff.onChange}
          issues={issues}
          issueTab="basics"
          mode={staff.mode}
        />
      )}

      <Block
        title={t('adminEvents.basics.visibilityTitle', 'Who can see it')}
        description={t('adminEvents.basics.visibilityBody', 'Keep the event as a draft while you prepare it.')}
      >
        <ChoiceCards
          label={t('adminEvents.basics.visibilityTitle', 'Who can see it')}
          value={v.visibility}
          onChange={(vis) => set('visibility', vis)}
          options={visibilityOptions}
        />
        {hiddenTest && v.visibility === 'hidden' && (
          <Note tone="warning">
            <span className="block">
              {hiddenTest.closed
                ? t('adminEvents.basics.hiddenClosed2', 'The closing date of this test is past (How to register > Registration closes): once saved, nobody can register. Change it there for your next test.')
                : t('adminEvents.basics.hiddenOpen', 'Close it after your test: registrations stay open to anyone with the link, and confirming someone creates a real account.')}
            </span>
            {!hiddenTest.closed && (
              <Button type="button" variant="outline" size="sm" className={cn(EDITOR_BTN, 'mt-3')} onClick={hiddenTest.onCloseNow}>
                {t('adminEvents.basics.closeNow', 'Close registration now')}
              </Button>
            )}
          </Note>
        )}
        {!canPublish && v.visibility !== 'published' && (
          <Note>
            {webinar
              ? t('adminEvents.basics.publishNote', 'Publishing opens once the new event pages are live on the site. Until then, prepare the event as a draft, or test it as a hidden event.')
              : onsiteEditor
                ? t('adminEvents.basics.publishNoteOnsiteLive', 'Publishing opens once on-site registration is live on the site. Until then, prepare the event as a draft, or test it as a hidden event: only a hidden test takes registrations and decisions.')
                : t('adminEvents.basics.publishNoteOnsite', 'On-site events made here can be published from a later update. Until then, prepare the event as a draft, or test it as a hidden event.')}
          </Note>
        )}
      </Block>

      <CoverBlock value={v.imageUrl} onChange={(url) => set('imageUrl', url)} />

      <Block
        title={t('adminEvents.basics.speakersTitle', 'Speakers')}
        description={t('adminEvents.basics.speakersBody', 'Shown on the event page, in this order.')}
      >
        {v.speakers.length === 0 && (
          <p className="text-[14px] text-meta">{t('adminEvents.basics.noSpeakers', 'No speaker yet.')}</p>
        )}
        <ul className="space-y-3">
          {v.speakers.map((sp, i) => (
            <li key={i} className="flex flex-col gap-2 rounded-card border border-rule p-3 sm:flex-row sm:items-start">
              <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2">
                <Input
                  value={sp.name}
                  onChange={(e) => set('speakers', v.speakers.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                  placeholder={t('adminEvents.basics.speakerName', 'Name')}
                  aria-label={t('adminEvents.basics.speakerName', 'Name')}
                  className={INPUT}
                />
                <Input
                  value={sp.title}
                  onChange={(e) => set('speakers', v.speakers.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))}
                  placeholder={t('adminEvents.basics.speakerTitle', 'Job title, company')}
                  aria-label={t('adminEvents.basics.speakerTitle', 'Job title, company')}
                  className={INPUT}
                />
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className={cn(EDITOR_BTN, 'self-end sm:self-auto')}
                onClick={() => set('speakers', v.speakers.filter((_, j) => j !== i))}
              >
                <X className="mr-1 h-4 w-4" aria-hidden="true" /> {t('adminEvents.remove', 'Remove')}
              </Button>
              {err(`speaker${i}`) && <p role="alert" className="text-[13px] text-red-700">{err(`speaker${i}`)}</p>}
            </li>
          ))}
        </ul>
        <Button type="button" variant="outline" size="sm" className={EDITOR_BTN} onClick={() => set('speakers', [...v.speakers, { name: '', title: '' }])}>
          <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" /> {t('adminEvents.basics.addSpeaker', 'Add a speaker')}
        </Button>
      </Block>

      <Block title={t('adminEvents.basics.moreTitle', 'More')}>
        <Field label={t('adminEvents.basics.website', 'Event website')} htmlFor="ev-website" error={err('website')} optional>
          <Input
            id="ev-website"
            type="url"
            inputMode="url"
            value={v.website}
            onChange={(e) => set('website', e.target.value)}
            placeholder="https://"
            className={INPUT}
            autoCapitalize="none"
            spellCheck={false}
          />
        </Field>
        {sectors.length > 0 && (
          <Field
            label={t('adminEvents.basics.sectors', 'Sectors')}
            hint={t('adminEvents.basics.sectorsHint', 'Members interested in these sectors see the event in their suggestions.')}
          >
            <div className="flex flex-wrap gap-2">
              {sectors.map((s) => {
                const on = v.sectorIds.includes(s.id);
                return (
                  <button
                    key={s.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => set('sectorIds', on ? v.sectorIds.filter((x) => x !== s.id) : [...v.sectorIds, s.id].sort())}
                    className={cn(
                      'min-h-11 rounded-pill border px-3.5 py-2.5 text-[13px] font-medium transition-colors focus:outline-none focus-visible:shadow-focus',
                      on ? 'border-navy bg-navy text-white' : 'border-rule bg-white text-navy hover:border-navy/40',
                    )}
                  >
                    {s.label}
                  </button>
                );
              })}
            </div>
          </Field>
        )}
      </Block>
    </div>
  );
}

/**
 * The cover photo, uploaded to the same public bucket as the old editor
 * (resource-images/events/), resized to web size. Saved with the event.
 */
function CoverBlock({ value, onChange }: { value: string; onChange: (url: string) => void }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const upload = async (file: File) => {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      toast({ title: t('adminEvents.cover.badType', 'Use a JPEG, PNG or WebP photo'), variant: 'destructive' });
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      toast({ title: t('adminEvents.cover.tooBig', 'This file is over 25 MB'), variant: 'destructive' });
      return;
    }
    setBusy(true);
    try {
      const meta = await fileMeta(file);
      const blob = await resizeImage(file, 1800, 1200);
      if (blob.size > 5 * 1024 * 1024) throw new Error(t('adminEvents.cover.stillBig', 'Still over 5 MB after resizing. Save it as a JPEG and try again.'));
      const ctype = blob.type || file.type;
      const ext = ctype === 'image/png' ? 'png' : 'jpg';
      const path = `events/event-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error } = await supabase.storage.from('resource-images').upload(path, blob, { cacheControl: '3600', upsert: false, contentType: ctype });
      if (error) throw error;
      onChange(supabase.storage.from('resource-images').getPublicUrl(path).data.publicUrl);
      toast({ title: t('adminEvents.cover.done', 'Photo uploaded'), description: `${meta}. ${t('adminEvents.cover.saveToKeep', 'Save the event to keep it.')}` });
    } catch (e) {
      toast({ title: t('adminEvents.cover.failed', 'Upload failed'), description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
    }
    setBusy(false);
  };

  const dropProps = {
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); setOver(true); },
    onDragLeave: () => setOver(false),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setOver(false);
      const f = e.dataTransfer.files?.[0];
      if (f && !busy) void upload(f);
    },
  };

  return (
    <Block
      title={t('adminEvents.cover.title', 'Cover photo')}
      description={t('adminEvents.cover.body', 'Shown on the event card and at the top of the event page. A landscape photo, at least 1600 px wide.')}
    >
      {value ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <div {...dropProps} className={cn('aspect-video w-full shrink-0 rounded-card border bg-page sm:w-80', over ? 'border-navy ring-2 ring-navy/30' : 'border-rule')}>
            <img src={value} alt="" className="h-full w-full rounded-card object-cover" />
          </div>
          <div className="flex gap-2 sm:flex-col">
            <Button type="button" variant="outline" size="sm" className={EDITOR_BTN} disabled={busy} onClick={() => inputRef.current?.click()}>
              {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : <Upload className="mr-1.5 h-4 w-4" aria-hidden="true" />}
              {t('adminEvents.cover.replace', 'Replace')}
            </Button>
            <Button type="button" variant="outline" size="sm" className={EDITOR_BTN} disabled={busy} onClick={() => onChange('')}>
              <Trash2 className="mr-1.5 h-4 w-4" aria-hidden="true" /> {t('adminEvents.remove', 'Remove')}
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          aria-busy={busy}
          onClick={() => { if (!busy) inputRef.current?.click(); }}
          {...dropProps}
          className={cn(
            'flex w-full items-center gap-3 rounded-card border-2 border-dashed p-5 text-left transition-colors focus:outline-none focus-visible:shadow-focus',
            over ? 'border-navy bg-foam' : 'border-rule hover:border-navy/40 hover:bg-page',
          )}
        >
          {busy ? <Loader2 className="h-5 w-5 animate-spin text-navy" aria-hidden="true" /> : <Upload className="h-5 w-5 text-meta" aria-hidden="true" />}
          <span className="text-[14px] text-meta">
            {busy ? t('adminEvents.cover.uploading', 'Uploading…') : t('adminEvents.cover.drop', 'Drop a photo here, or click to choose one (25 MB at most)')}
          </span>
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void upload(f);
          if (inputRef.current) inputRef.current.value = '';
        }}
      />
    </Block>
  );
}
