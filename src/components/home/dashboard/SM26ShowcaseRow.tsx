import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Clock, Eye, EyeOff } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { StatusPill } from '@/components/member/MemberUI';
import { toast } from '@/hooks/use-toast';
import { requireFreshSession } from '@/lib/session';
import { cn } from '@/lib/utils';
import {
  KIND_LABEL, SECTIONS, fetchShowcaseSettings, saveShowcase, sectionFilled, showcaseLinks, shownNow,
  type ShowcaseEntry, type ShowcaseSectionKey, type ShowcaseSettings,
} from '@/lib/sm26Showcase';
import { EditDialog, InfoRow, errorText } from './EditKit';

/**
 * My company > "Smart Marina 2026 details" (Victor, 20 Oct 2026): the company chooses whether
 * its page shows the texts it sent for the Smart Marina 2026 e-catalogue and jury, and hides any
 * block it wants. Only for a company that has such an entry (nothing renders otherwise). The
 * owner and M3 staff change it; the other members see the choice. Saved through
 * org_sm26_showcase_set (src/lib/sm26Showcase.ts). The address /?open=company&section=sm26
 * points here (the "please confirm your choice" e-mail uses it).
 */

/** The blocks of an entry that have something in them, in reading order. */
function filledSections(entry: ShowcaseEntry) {
  return SECTIONS[entry.kind].filter((s) => sectionFilled(entry.sections, s.key));
}

export function SM26ShowcaseRow({
  orgId,
  version,
  autoOpen,
  onChanged,
}: {
  orgId: string;
  /** The dashboard's version: re-read after a change elsewhere. */
  version: string;
  /** The address pointed here (section=sm26): bring the row into view and open its window once. */
  autoOpen?: boolean;
  onChanged?: () => void;
}) {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<ShowcaseSettings | null>(null);
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const autoDone = useRef(false);
  const [highlight, setHighlight] = useState(false);
  const [, setSearchParams] = useSearchParams();

  useEffect(() => {
    let alive = true;
    fetchShowcaseSettings(orgId).then((s) => { if (alive) setSettings(s); }, () => { if (alive) setSettings(null); });
    return () => { alive = false; };
  }, [orgId, version]);

  const entries = (settings?.entries ?? []).filter((e) => filledSections(e).length > 0);
  useEffect(() => {
    if (!autoOpen || autoDone.current || entries.length === 0) return;
    autoDone.current = true;
    // Once only: a reload does not open it again.
    setSearchParams((prev) => {
      if (prev.get('section') !== 'sm26') return prev;
      const next = new URLSearchParams(prev);
      next.delete('section');
      return next;
    }, { replace: true });
    document.getElementById('company-row-sm26')?.scrollIntoView({ block: 'center' });
    setHighlight(true);
    setOpen(true);
  }, [autoOpen, entries.length, setSearchParams]);

  useEffect(() => {
    if (!highlight) return;
    const timer = window.setTimeout(() => setHighlight(false), 2500);
    return () => window.clearTimeout(timer);
  }, [highlight]);

  useEffect(() => {
    if (!saved) return;
    const timer = window.setTimeout(() => setSaved(false), 3000);
    return () => window.clearTimeout(timer);
  }, [saved]);

  if (!settings || entries.length === 0) return null;

  const total = entries.reduce((n, e) => n + filledSections(e).length, 0);
  const visible = entries.reduce((n, e) => n + filledSections(e).filter((s) => !settings.hidden_sections.includes(s.key)).length, 0);
  const shown = shownNow(settings);
  const waiting = settings.opted_in === null && entries.every((e) => e.restricted);

  const value = waiting ? (
    <StatusPill tone="warning" icon={Clock}>{t('dash.sm26show.waiting', 'Not shown: please choose')}</StatusPill>
  ) : shown && visible > 0 ? (
    <span className="inline-flex flex-wrap items-center gap-2">
      <StatusPill tone="success" icon={Eye}>{t('dash.sm26show.shown', 'Shown on your page')}</StatusPill>
      <span className="text-[15px] font-medium text-meta">
        {t('dash.sm26show.count', { visible, total, defaultValue: '{{visible}} of {{total}} blocks' })}
      </span>
    </span>
  ) : (
    <StatusPill tone="neutral" icon={EyeOff}>{t('dash.sm26show.hidden', 'Hidden from your page')}</StatusPill>
  );

  return (
    <>
      <InfoRow
        id="company-row-sm26"
        label={t('dash.sm26show.label', 'Smart Marina 2026 details')}
        value={value}
        hint={!settings.listed
          ? t('dash.sm26show.notListed', 'Visitors see them once M3 has verified your company.')
          : t('dash.sm26show.hint', 'The texts your company sent for the 2026 e-catalogue and jury.')}
        actionLabel={settings.can_edit ? t('dash.sm26show.choose', 'Choose') : t('dash.sm26show.see', 'See')}
        onAction={() => setOpen(true)}
        saved={saved}
        highlight={highlight}
      />
      <ShowcaseDialog
        open={open}
        onOpenChange={setOpen}
        orgId={orgId}
        settings={settings}
        entries={entries}
        onSaved={(next) => { setSettings(next); setSaved(true); onChanged?.(); }}
      />
    </>
  );
}

function ShowcaseDialog({
  open,
  onOpenChange,
  orgId,
  settings,
  entries,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string;
  settings: ShowcaseSettings;
  entries: ShowcaseEntry[];
  onSaved: (next: ShowcaseSettings) => void;
}) {
  const { t } = useTranslation();
  const [master, setMaster] = useState(true);
  const [hidden, setHidden] = useState<ShowcaseSectionKey[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canEdit = settings.can_edit;

  // Each opening starts from what is saved.
  useEffect(() => {
    if (!open) return;
    setMaster(shownNow(settings));
    setHidden(settings.hidden_sections);
    setError(null);
  }, [open, settings]);

  const waiting = settings.opted_in === null && entries.every((e) => e.restricted);
  const reason = entries.find((e) => e.restricted)?.restricted_reason ?? null;

  const save = async () => {
    if (!canEdit) return;
    const uid = await requireFreshSession();
    if (!uid) return;
    setSaving(true);
    setError(null);
    try {
      const next = await saveShowcase(orgId, master, hidden);
      setSaving(false);
      toast({
        title: t('dash.savedToast', 'Saved'),
        description: master
          ? t('dash.sm26show.savedShown', 'Your company page shows the blocks you kept.')
          : t('dash.sm26show.savedHidden', 'Your company page does not show your Smart Marina 2026 details.'),
      });
      onOpenChange(false);
      onSaved(next);
    } catch (err) {
      setSaving(false);
      setError(t('dash.saveFailed', { reason: errorText(err, ''), defaultValue: 'We could not save this. {{reason}}' }).trim());
    }
  };

  const toggle = (key: ShowcaseSectionKey, on: boolean) =>
    setHidden((prev) => (on ? prev.filter((k) => k !== key) : prev.includes(key) ? prev : [...prev, key]));

  return (
    <EditDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('dash.sm26show.title', 'Your Smart Marina 2026 details')}
      description={t('dash.sm26show.desc', 'When your company registered for the Monaco Smart & Sustainable Marina Rendezvous 2026, it sent texts for the e-catalogue and the jury. You choose whether your company page shows them, for everyone to read.')}
      onSave={canEdit ? save : undefined}
      saving={saving}
      error={error}
      wide
    >
      {waiting && (
        <p className="rounded-field border border-amber-200 bg-amber-50 px-3 py-2.5 text-[15px] leading-6 text-amber-900">
          {reason === 'visibility'
            ? t('dash.sm26show.waitingVisibility', 'You asked for limited visibility in 2026, so nothing is shown until you choose.')
            : t('dash.sm26show.waitingConsent', 'We do not have your agreement to show them publicly, so nothing is shown until you choose.')}
        </p>
      )}
      {!canEdit && (
        <p className="rounded-field bg-page px-3 py-2.5 text-[15px] leading-6 text-meta ring-1 ring-inset ring-rule">
          {t('dash.sm26show.ownerOnly', 'Only the company owner or the M3 team can change this.')}
        </p>
      )}

      <div className="flex items-center gap-4 rounded-field border border-rule bg-white px-3 py-3">
        <label htmlFor="sm26show-master" className="min-w-0 flex-1 cursor-pointer">
          <span id="sm26show-master-label" className="block text-[16px] font-semibold leading-6 text-navy">{t('dash.sm26show.master', 'Show them on my company page')}</span>
          <span id="sm26show-master-state" className="mt-0.5 block text-[14px] leading-5 text-meta">
            {master
              ? t('dash.sm26show.masterOn', 'Visitors see the blocks switched on below.')
              : t('dash.sm26show.masterOff', 'Nothing from Smart Marina 2026 shows on your page.')}
          </span>
        </label>
        <Switch
          id="sm26show-master"
          checked={master}
          disabled={!canEdit || saving}
          onCheckedChange={(v) => setMaster(v)}
          aria-labelledby="sm26show-master-label"
          aria-describedby="sm26show-master-state"
          className="data-[state=checked]:bg-navy"
        />
      </div>

      {entries.map((entry) => (
        <fieldset key={entry.kind} disabled={!canEdit || saving || !master} className={cn(!master && 'opacity-60')}>
          <legend className="mb-2 text-meta-caps">{t(`orgProfile.sm26show.kind.${entry.kind}`, KIND_LABEL[entry.kind])}</legend>
          <ul className="divide-y divide-rule rounded-field border border-rule">
            {filledSections(entry).map((s) => {
              const id = `sm26show-${entry.kind}-${s.key}`;
              const on = !hidden.includes(s.key);
              const preview = s.key === 'links'
                ? showcaseLinks(entry.sections.links).map((l) => l.label).join(', ')
                : (entry.sections[s.key as Exclude<ShowcaseSectionKey, 'links'>] ?? '').replace(/\s+/g, ' ').trim();
              return (
                <li key={s.key} className="flex items-center gap-4 px-3 py-3">
                  <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
                    <span className="block text-[15px] font-semibold leading-5 text-navy">{t(`dash.sm26show.section.${s.key}`, s.title)}</span>
                    <span className="mt-0.5 line-clamp-2 block text-[14px] leading-5 text-meta">{preview}</span>
                  </label>
                  <Switch
                    id={id}
                    checked={on}
                    onCheckedChange={(v) => toggle(s.key, v)}
                    aria-label={t('dash.sm26show.sectionToggle', { title: s.title, defaultValue: 'Show "{{title}}"' })}
                    className="data-[state=checked]:bg-navy"
                  />
                </li>
              );
            })}
          </ul>
        </fieldset>
      ))}

      <p className="text-[14px] leading-5 text-meta">
        {t('dash.sm26show.never', 'Never shown: your pitch deck, your funding figures, your team’s details and the jury’s scores. Your pictures are not shown either.')}
      </p>
    </EditDialog>
  );
}
