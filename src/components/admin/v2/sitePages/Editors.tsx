import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { renderToStaticMarkup } from 'react-dom/server';
import type { TFunction } from 'i18next';
import { Check, EyeOff, Plus, Trash2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { RichTextEditor } from '@/components/ui/RichTextEditor';
import { ImageUpload } from '@/components/ui/ImageUpload';
import { AdminLoading, AdminPanel, AdminStatusPill } from '@/components/admin/AdminUI';
import { CardButton } from '@/components/home/dashboard/DashboardKit';
import { LegalBodyOnly } from '@/components/content/LegalLayout';
import { buildHelpSections } from '@/components/help/helpContent';
import { SITE_IMAGES, SM26_MOMENTS } from '@/lib/siteMedia';
import type { SiteContentBody, SiteContentKind } from '@/lib/siteContent/store';
import { safeMediaUrl, type FeaturedEvent, type HelpAddedItem, type HelpCustomBlock, type HomeHeroBlock, type LegalBlock } from '@/lib/siteContent/blocks';
import { cn } from '@/lib/utils';
import { sameBody } from './api';
import { codeText, type SitePageDef, type TextField, type TextSection } from './registry';

/**
 * The editors of Admin > Site pages. Each one reads the block's current value
 * (the change waiting to be published, else the published block, else the
 * code's text) and hands changes to `set`, which keeps only real differences
 * from what is live. Nothing here writes to the database: SitePagesPage publishes.
 */

export interface EditorApi {
  value: (key: string) => SiteContentBody | null;
  isDraft: (key: string) => boolean;
  set: (key: string, kind: SiteContentKind, body: SiteContentBody | null) => void;
}

const FIELD_ID = (key: string) => `site-field-${key.replace(/[^a-zA-Z0-9]/g, '-')}`;
const LINK_BTN = 'inline-flex min-h-9 items-center rounded-pill px-2 font-semibold text-navy underline decoration-gold-text decoration-2 underline-offset-2 hover:bg-chip focus:outline-none focus-visible:shadow-focus';

function StatePill({ draft, changed }: { draft: boolean; changed: boolean }) {
  if (draft) return <AdminStatusPill tone="navy">Not published yet</AdminStatusPill>;
  if (changed) return <AdminStatusPill tone="info">Changed on the site</AdminStatusPill>;
  return null;
}

/* ─── One text of the site ───────────────────────────────────────── */

export function TextFieldRow({ field, api }: { field: TextField; api: EditorApi }) {
  const key = `text:${field.key}`;
  const body = api.value(key);
  const text = typeof body?.text === 'string' ? body.text : field.code;
  const changed = text !== field.code;
  const id = FIELD_ID(field.key);
  const onChange = (v: string) => api.set(key, 'text', v === field.code ? null : { text: v });
  const rows = Math.min(10, Math.max(2, Math.ceil(text.length / 70)));
  return (
    <div className="border-t border-rule py-4 first:border-t-0 first:pt-0 last:pb-0">
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <label htmlFor={id} className="text-[14px] font-semibold leading-5 text-navy">{field.label}</label>
        <StatePill draft={api.isDraft(key)} changed={changed} />
      </div>
      {field.long ? (
        <Textarea id={id} rows={rows} value={text} onChange={(e) => onChange(e.target.value)} className="text-[15px] leading-6" />
      ) : (
        <Input id={id} value={text} onChange={(e) => onChange(e.target.value)} className="text-[15px]" />
      )}
      {field.hint && <p className="mt-1.5 text-[13px] leading-5 text-meta">{field.hint}</p>}
      {!text.trim() && <p className="mt-1.5 text-[13px] leading-5 text-red-700">Empty: the site will show the original text.</p>}
      {changed && (
        <div className="mt-2 rounded-field bg-chip px-3 py-2 text-[13px] leading-5 text-meta">
          <span className="font-semibold text-navy">Original text: </span>
          {field.code}
          <button type="button" onClick={() => onChange(field.code)} className={cn(LINK_BTN, 'ml-1 text-[13px]')}>
            Back to the original text
          </button>
        </div>
      )}
    </div>
  );
}

export function TextSectionsEditor({ sections, api }: { sections: TextSection[]; api: EditorApi }) {
  return (
    <div className="grid gap-5">
      {sections.map((s) => (
        <AdminPanel key={s.title} title={s.title}>
          {s.fields.map((f) => <TextFieldRow key={f.key} field={f} api={api} />)}
        </AdminPanel>
      ))}
    </div>
  );
}

/* ─── Home page: photo or video, featured event ──────────────────── */

export const HERO_KEY = 'home.hero';

const PHOTO_LABELS: Record<string, string> = {
  homeHero: 'The exhibition hall from above (today)',
  eventsHero: 'Full room, speaker at the lectern',
  resourcesHero: 'A panel on stage',
  directoryHero: 'Conversations between stands',
  opportunitiesHero: 'An exhibitor demo on a tablet',
  partnersHero: 'The award trophies',
  joinHero: 'A conversation at a stand',
  aboutHero: 'The community group photo',
  contactHero: 'A round-table workshop',
  dashboardBand: 'Berth sensors on a stand',
};

const PHOTOS: { src: string; focusY: number; label: string }[] = [
  ...Object.entries(SITE_IMAGES)
    .filter(([, img]) => !!img.src)
    .map(([k, img]) => ({ src: img.src as string, focusY: img.focusY, label: PHOTO_LABELS[k] ?? k })),
  ...SM26_MOMENTS.map((m) => ({ src: m.src, focusY: 0.5, label: m.altFallback })),
];

const HERO_DEFAULT: HomeHeroBlock = {
  media: 'photo',
  photo: SITE_IMAGES.homeHero.src ?? undefined,
  focusY: SITE_IMAGES.homeHero.focusY,
  featured: 'all',
};

const FEATURED: { value: FeaturedEvent; label: string; line: string }[] = [
  { value: 'all', label: 'All M3 events in turn (as today)', line: 'World Yachting Summit while it is upcoming, then webinars, then the Rendezvous.' },
  { value: 'wys26', label: 'World Yachting Summit only', line: 'Dubai, 27 November 2026. After that date the card shows all events again.' },
  { value: 'webinars', label: 'Webinars only', line: 'The card links to the webinars on the Events page.' },
  { value: 'rendezvous', label: 'Monaco Rendezvous only', line: 'The card links to the 6th edition.' },
];

function ChoiceCard({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        'group flex w-full items-start gap-3 rounded-field border p-3 text-left transition-colors focus:outline-none focus-visible:shadow-focus',
        selected ? 'border-navy bg-foam ring-1 ring-navy' : 'border-navy/30 bg-white hover:border-navy hover:bg-chip',
      )}
    >
      <span className={cn('mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border-2', selected ? 'border-navy bg-navy text-white' : 'border-navy/50')}>
        {selected && <Check className="h-3 w-3" strokeWidth={3} aria-hidden="true" />}
      </span>
      <span className="min-w-0">{children}</span>
    </button>
  );
}

export function HomeHeroEditor({ api }: { api: EditorApi }) {
  const stored = (api.value(HERO_KEY) as HomeHeroBlock | null) ?? {};
  const cur: HomeHeroBlock = { ...HERO_DEFAULT, ...stored };
  const update = (patch: Partial<HomeHeroBlock>) => {
    const next = { ...cur, ...patch };
    api.set(HERO_KEY, 'json', sameBody(next as SiteContentBody, HERO_DEFAULT as SiteContentBody) ? null : (next as SiteContentBody));
  };
  const builtIn = PHOTOS.some((p) => p.src === cur.photo);
  const videoOk = !!safeMediaUrl(cur.video);

  return (
    <div className="grid gap-5">
      <AdminPanel
        title="Photo or video"
        description="The rounded frame on the right of the top of the home page."
        actions={<StatePill draft={api.isDraft(HERO_KEY)} changed={!!stored && Object.keys(stored).length > 0 && !sameBody(cur as SiteContentBody, HERO_DEFAULT as SiteContentBody)} />}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <ChoiceCard selected={cur.media !== 'video'} onClick={() => update({ media: 'photo' })}>
            <span className="block text-[15px] font-semibold text-navy">A photo</span>
            <span className="block text-[13px] leading-5 text-meta">Shown to everyone.</span>
          </ChoiceCard>
          <ChoiceCard selected={cur.media === 'video'} onClick={() => update({ media: 'video' })}>
            <span className="block text-[15px] font-semibold text-navy">A short video, with the photo as cover</span>
            <span className="block text-[13px] leading-5 text-meta">Plays on computers and tablets. Phones show the photo.</span>
          </ChoiceCard>
        </div>

        <p className="mt-6 text-[14px] font-semibold text-navy">Choose the photo</p>
        <ul className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
          {PHOTOS.map((p) => {
            const selected = cur.photo === p.src;
            return (
              <li key={p.src}>
                <button
                  type="button"
                  aria-pressed={selected}
                  onClick={() => update({ photo: p.src, focusY: p.focusY })}
                  className={cn(
                    'group block w-full overflow-hidden rounded-field border bg-white text-left transition-colors focus:outline-none focus-visible:shadow-focus',
                    selected ? 'border-navy ring-2 ring-navy' : 'border-navy/30 hover:border-navy',
                  )}
                >
                  <img src={p.src} alt="" loading="lazy" className="aspect-[3/2] w-full object-cover" />
                  <span className="flex items-start gap-1.5 px-2.5 py-2 text-[13px] leading-[18px] text-navy">
                    {selected && <Check className="mt-px h-4 w-4 shrink-0" strokeWidth={2.5} aria-hidden="true" />}
                    <span>{selected ? 'Chosen' : p.label}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        <div className="mt-5">
          <ImageUpload
            label="Or upload your own photo (landscape, at least 1600 px wide)"
            value={builtIn ? '' : cur.photo ?? ''}
            onChange={(url) => update({ photo: url || HERO_DEFAULT.photo, focusY: url ? 0.5 : HERO_DEFAULT.focusY })}
            maxWidth={2000}
            maxHeight={1400}
          />
          {!builtIn && cur.photo && (
            <div className="mt-3">
              <p className="text-[14px] font-semibold text-navy">Where is the subject of your photo?</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {([['Top', 0.2], ['Middle', 0.5], ['Bottom', 0.8]] as const).map(([label, y]) => (
                  <ChoiceCard key={label} selected={Math.abs((cur.focusY ?? 0.5) - y) < 0.05} onClick={() => update({ focusY: y })}>
                    <span className="text-[14px] font-semibold text-navy">{label}</span>
                  </ChoiceCard>
                ))}
              </div>
            </div>
          )}
        </div>

        {cur.media === 'video' && (
          <div className="mt-6">
            <label htmlFor="site-hero-video" className="text-[14px] font-semibold text-navy">Address of the video</label>
            <Input
              id="site-hero-video"
              className="mt-1.5"
              placeholder="https://… .mp4"
              value={cur.video ?? ''}
              onChange={(e) => update({ video: e.target.value.trim() || undefined })}
            />
            <p className="mt-1.5 text-[13px] leading-5 text-meta">
              An MP4 of a few seconds, without sound, under 10 MB, at an https address. Not the 40 MB teaser: it is too heavy for the top of the page.
            </p>
            {cur.video && !videoOk && <p className="mt-1.5 text-[13px] leading-5 text-red-700">This address is not an https address: the site will show the photo.</p>}
            {videoOk && (
              <video src={cur.video} muted loop autoPlay playsInline className="mt-3 aspect-video w-full max-w-md rounded-field bg-navy object-cover" />
            )}
          </div>
        )}
      </AdminPanel>

      <AdminPanel title="Event in the card" description="The card that floats over the corner of the photo.">
        <div className="grid gap-3">
          {FEATURED.map((f) => (
            <ChoiceCard key={f.value} selected={(cur.featured ?? 'all') === f.value} onClick={() => update({ featured: f.value })}>
              <span className="block text-[15px] font-semibold text-navy">{f.label}</span>
              <span className="block text-[13px] leading-5 text-meta">{f.line}</span>
            </ChoiceCard>
          ))}
        </div>
      </AdminPanel>
    </div>
  );
}

/* ─── Legal pages ────────────────────────────────────────────────── */

/** The document's own body and version line, read from its page component. */
function useLegalCode(page: SitePageDef): { html: string; version: string } | null {
  const [code, setCode] = useState<{ html: string; version: string } | null>(null);
  useEffect(() => {
    let alive = true;
    page.legal?.load().then((Page) => {
      if (!alive) return;
      const markup = renderToStaticMarkup(
        <LegalBodyOnly.Provider value>
          <MemoryRouter><Page /></MemoryRouter>
        </LegalBodyOnly.Provider>,
      );
      const doc = new DOMParser().parseFromString(markup, 'text/html');
      setCode({
        html: doc.querySelector('[data-legal-body]')?.innerHTML ?? '',
        version: doc.querySelector('[data-legal-version]')?.textContent?.trim() ?? '',
      });
    }).catch(() => { if (alive) setCode({ html: '', version: '' }); });
    return () => { alive = false; };
  }, [page]);
  return code;
}

export function LegalEditor({ page, api }: { page: SitePageDef; api: EditorApi }) {
  const key = page.legal?.key ?? '';
  const code = useLegalCode(page);
  if (!code) return <AdminLoading label="Reading the page…" />;

  const body = api.value(key) as LegalBlock | null;
  const html = typeof body?.html === 'string' ? body.html : code.html;
  const version = typeof body?.version === 'string' ? body.version : code.version;
  const changed = !!body;
  const write = (next: { html: string; version: string }) => api.set(key, 'rich', next as unknown as SiteContentBody);

  return (
    <div className="grid gap-5">
      <AdminPanel
        title="Version line"
        description="Shown under the title. Change the date when the text changes."
        actions={<StatePill draft={api.isDraft(key)} changed={changed} />}
      >
        <label htmlFor="site-legal-version" className="sr-only">Version line</label>
        <Input id="site-legal-version" value={version} onChange={(e) => write({ html, version: e.target.value })} />
      </AdminPanel>
      <AdminPanel
        title="Text of the page"
        description="Each article starts with a heading (H2 button): the site lists them in “On this page”."
      >
        <div className="overflow-hidden rounded-field border border-rule">
          <RichTextEditor content={html} onChange={(next) => write({ html: next, version })} allowImages={false} />
        </div>
        {changed ? (
          <p className="mt-3 text-[13px] leading-5 text-meta">
            This page shows your text.
            <button type="button" onClick={() => api.set(key, 'rich', null)} className={cn(LINK_BTN, 'ml-1 text-[13px]')}>
              Back to the original text
            </button>
          </p>
        ) : (
          <p className="mt-3 text-[13px] leading-5 text-meta">
            This is the text written in the code. Once you publish a change, the page uses the editor’s simpler layout (the grey boxes become plain paragraphs).
          </p>
        )}
      </AdminPanel>
    </div>
  );
}

/* ─── Help centre ────────────────────────────────────────────────── */

export const HELP_KEY = 'help.custom';

interface HelpItemDef { id: string; q: TextField; fields: TextField[] }
interface HelpSectionDef { id: string; title: TextField; intro: TextField; items: HelpItemDef[] }

/** The help centre's questions as the code writes them, with the key of every string. */
export function buildHelpDefs(): HelpSectionDef[] {
  const rec = new Map<string, string>();
  const tRec = ((key: string, def?: unknown) => {
    const d = typeof def === 'string' ? def : '';
    rec.set(key, d);
    return d;
  }) as unknown as TFunction;
  const today = buildHelpSections(tRec, { codeOnly: true });
  buildHelpSections(tRec, { codeOnly: true, rightsEnforced: true });
  const f = (key: string, label: string): TextField => {
    const code = codeText(key, rec.get(key) ?? '');
    return { key, label, code, long: code.length > 70 };
  };
  return today.map((s) => ({
    id: s.id,
    title: f(`help.s.${s.id}.title`, 'Section title'),
    intro: f(`help.s.${s.id}.intro`, 'Line under the section title'),
    items: s.items.map((it) => {
      const fields: TextField[] = [];
      it.a.forEach((_, i) => {
        const base = `help.q.${it.id}.a${i + 1}`;
        if (rec.has(`${base}r`)) {
          fields.push(f(base, `Paragraph ${i + 1}, until the rights switch`));
          fields.push(f(`${base}r`, `Paragraph ${i + 1}, from the rights switch (go-live)`));
        } else {
          fields.push(f(base, `Paragraph ${i + 1}`));
        }
      });
      it.steps?.forEach((_, i) => fields.push(f(`help.q.${it.id}.s${i + 1}`, `Step ${i + 1}`)));
      it.links?.forEach((l, i) => fields.push(f(`help.q.${it.id}.l${i + 1}`, `Link ${i + 1} (opens ${l.to})`)));
      return { id: it.id, q: f(`help.q.${it.id}.q`, 'Question'), fields };
    }),
  }));
}

export function helpTextKeys(defs: HelpSectionDef[]): string[] {
  return defs.flatMap((s) => [s.title.key, s.intro.key, ...s.items.flatMap((i) => [i.q.key, ...i.fields.map((x) => x.key)])]).map((k) => `text:${k}`);
}

function textOf(api: EditorApi, f: TextField): string {
  const b = api.value(`text:${f.key}`);
  return typeof b?.text === 'string' ? b.text : f.code;
}

export function HelpEditor({ api }: { api: EditorApi }) {
  const defs = useMemo(buildHelpDefs, []);
  const [open, setOpen] = useState<string | null>(null);
  const custom = (api.value(HELP_KEY) as HelpCustomBlock | null) ?? {};
  const hidden = new Set(custom.hidden ?? []);
  const added = custom.added ?? [];
  const saveCustom = (next: HelpCustomBlock) => {
    const clean: HelpCustomBlock = { hidden: next.hidden ?? [], added: next.added ?? [] };
    api.set(HELP_KEY, 'json', clean.hidden!.length || clean.added!.length ? (clean as unknown as SiteContentBody) : null);
  };
  const toggleHidden = (id: string) => {
    const h = new Set(hidden);
    if (h.has(id)) h.delete(id); else h.add(id);
    saveCustom({ ...custom, hidden: [...h] });
  };
  const updateAdded = (id: string, patch: Partial<HelpAddedItem>) =>
    saveCustom({ ...custom, added: added.map((a) => (a.id === id ? { ...a, ...patch } : a)) });
  const addQuestion = (section: string) => {
    const id = `m3-${Date.now().toString(36)}`;
    saveCustom({ ...custom, added: [...added, { id, section, q: '', a: [''] }] });
    setOpen(id);
  };

  return (
    <div className="grid gap-5">
      <AdminPanel padded>
        <p className="text-[14px] leading-6 text-ink">
          Change a question or its answer, hide a question, or add your own at the end of a section.
          The Help button on the site and the help tips use the same questions.
        </p>
        {api.isDraft(HELP_KEY) && <p className="mt-2"><AdminStatusPill tone="navy">Hidden or added questions not published yet</AdminStatusPill></p>}
      </AdminPanel>

      {defs.map((s) => {
        const mine = added.filter((a) => a.section === s.id);
        return (
          <AdminPanel key={s.id} title={textOf(api, s.title)} description={`${s.items.length + mine.length} questions`}>
            <TextFieldRow field={s.title} api={api} />
            <TextFieldRow field={s.intro} api={api} />
            <ul className="mt-4 grid gap-2">
              {s.items.map((it) => {
                const isOpen = open === it.id;
                const isHidden = hidden.has(it.id);
                const changed = [it.q, ...it.fields].some((f) => textOf(api, f) !== f.code);
                const draft = [it.q, ...it.fields].some((f) => api.isDraft(`text:${f.key}`));
                return (
                  <li key={it.id} className={cn('rounded-field border border-rule', isHidden && 'bg-chip/60')}>
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      onClick={() => setOpen(isOpen ? null : it.id)}
                      className="group flex w-full flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 text-left focus:outline-none focus-visible:shadow-focus"
                    >
                      <span className={cn('min-w-0 flex-1 text-[15px] font-semibold leading-5 text-navy', isHidden && 'text-meta line-through')}>
                        {textOf(api, it.q)}
                      </span>
                      {isHidden && <AdminStatusPill tone="neutral" icon={EyeOff}>Hidden</AdminStatusPill>}
                      <StatePill draft={draft} changed={changed} />
                      <span className="inline-flex min-h-9 items-center rounded-pill border border-navy/55 px-3 text-[14px] font-semibold text-navy group-hover:border-navy group-hover:bg-chip">
                        {isOpen ? 'Close' : 'Edit'}
                      </span>
                    </button>
                    {isOpen && (
                      <div className="border-t border-rule px-4 py-4">
                        <TextFieldRow field={it.q} api={api} />
                        {it.fields.map((f) => <TextFieldRow key={f.key} field={f} api={api} />)}
                        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-rule pt-4">
                          <CardButton onClick={() => toggleHidden(it.id)}>
                            {isHidden ? 'Show this question again' : 'Hide this question on the site'}
                          </CardButton>
                          <span className="text-[13px] text-meta">Address of this answer: /help#{it.id}</span>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
              {mine.map((a) => {
                const isOpen = open === a.id;
                return (
                  <li key={a.id} className="rounded-field border border-navy/40 bg-foam/40">
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      onClick={() => setOpen(isOpen ? null : a.id)}
                      className="group flex w-full flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 text-left focus:outline-none focus-visible:shadow-focus"
                    >
                      <span className="min-w-0 flex-1 text-[15px] font-semibold leading-5 text-navy">{a.q || 'New question'}</span>
                      <AdminStatusPill tone="info">Added by M3</AdminStatusPill>
                      <span className="inline-flex min-h-9 items-center rounded-pill border border-navy/55 px-3 text-[14px] font-semibold text-navy group-hover:border-navy group-hover:bg-chip">
                        {isOpen ? 'Close' : 'Edit'}
                      </span>
                    </button>
                    {isOpen && (
                      <div className="grid gap-3 border-t border-rule px-4 py-4">
                        <div>
                          <label htmlFor={`${a.id}-q`} className="text-[14px] font-semibold text-navy">Question</label>
                          <Input id={`${a.id}-q`} className="mt-1.5" value={a.q} onChange={(e) => updateAdded(a.id, { q: e.target.value })} />
                        </div>
                        <div>
                          <label htmlFor={`${a.id}-a`} className="text-[14px] font-semibold text-navy">Answer</label>
                          <Textarea id={`${a.id}-a`} rows={5} className="mt-1.5" value={(a.a ?? []).join('\n\n')} onChange={(e) => updateAdded(a.id, { a: [e.target.value] })} />
                          <p className="mt-1 text-[13px] text-meta">Leave an empty line to start a new paragraph.</p>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div>
                            <label htmlFor={`${a.id}-ll`} className="text-[14px] font-semibold text-navy">Link text (optional)</label>
                            <Input id={`${a.id}-ll`} className="mt-1.5" placeholder="Open the directory" value={a.linkLabel ?? ''} onChange={(e) => updateAdded(a.id, { linkLabel: e.target.value })} />
                          </div>
                          <div>
                            <label htmlFor={`${a.id}-lt`} className="text-[14px] font-semibold text-navy">Link address (optional)</label>
                            <Input id={`${a.id}-lt`} className="mt-1.5" placeholder="/directory" value={a.linkTo ?? ''} onChange={(e) => updateAdded(a.id, { linkTo: e.target.value })} />
                          </div>
                        </div>
                        {!a.q.trim() && <p className="text-[13px] text-red-700">Write the question: a question without words is not shown.</p>}
                        <div className="flex flex-wrap items-center gap-3 border-t border-rule pt-3">
                          <button
                            type="button"
                            onClick={() => saveCustom({ ...custom, added: added.filter((x) => x.id !== a.id) })}
                            className="inline-flex min-h-11 items-center gap-1.5 rounded-pill border border-red-200 bg-white px-4 text-[15px] font-semibold text-red-700 hover:border-red-300 hover:bg-red-50 focus:outline-none focus-visible:shadow-focus"
                          >
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                            Remove this question
                          </button>
                          <span className="text-[13px] text-meta">Address of this answer: /help#{a.id}</span>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            <div className="mt-4">
              <CardButton onClick={() => addQuestion(s.id)} icon="expand">
                <Plus className="mr-0.5 inline h-4 w-4" aria-hidden="true" />
                Add a question to this section
              </CardButton>
            </div>
          </AdminPanel>
        );
      })}
    </div>
  );
}
