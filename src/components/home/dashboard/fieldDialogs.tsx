import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Camera, FileText, ImagePlus, Loader2, Trash2, Upload, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { LogoBadge } from '@/components/ui/CoverImage';
import { CATEGORIES } from '@/components/notifications/NotificationPreferencesTab';
import { saveNotificationPrefs, sendPasswordLink } from '@/components/account/profileActions';
import {
  addOrgGalleryImages, deleteOrgDocument, fetchOrgDocuments, orgSectorTable, removeOrgGalleryImage, saveOrgSectors,
  uploadOrgDocument, DOC_ACCEPT, ORG_DOC_MAX_BYTES, type OrgDocument,
} from '@/components/organization/orgActions';
import { toast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase';
import { requireFreshSession } from '@/lib/session';
import { cn } from '@/lib/utils';
import { BTN_TOUCH, EditDialog, errorText } from './EditKit';

/**
 * The small windows behind "Change" (and behind the to-do items): one field
 * or one picture at a time. Each saves through the same functions as the full
 * editors (profileActions, orgActions), says "Saved" (a toast; the row says it
 * too) or what went wrong (in the window), and closes.
 */

const INPUT = 'h-12 text-[16px] md:h-12 md:text-[16px]';

/* ------------------------------------------------------------------ text fields */

export interface FieldSpec {
  key: string;
  label: string;
  initial: string;
  required?: boolean;
  multiline?: boolean;
  placeholder?: string;
  inputMode?: 'text' | 'url' | 'email';
  autoComplete?: string;
  hint?: string;
}

/**
 * One or two text fields (a name, a job title, a description, the country and
 * the city) and Save. `onSave` gets the trimmed values; it throws on failure.
 */
export function FieldsDialog({
  open,
  onOpenChange,
  title,
  description,
  fields,
  onSave,
  savedMessage,
  onSaved,
  onCloseAutoFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  fields: FieldSpec[];
  onSave: (values: Record<string, string>) => Promise<void>;
  savedMessage?: string;
  onSaved?: () => void;
  onCloseAutoFocus?: (e: Event) => void;
}) {
  const { t } = useTranslation();
  const baseId = useId();
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fresh values each time the window opens.
  const initialKey = fields.map((f) => `${f.key}=${f.initial}`).join('|');
  useEffect(() => {
    if (!open) return;
    setValues(Object.fromEntries(fields.map((f) => [f.key, f.initial])));
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialKey]);

  const trimmed = Object.fromEntries(fields.map((f) => [f.key, (values[f.key] ?? '').trim()]));
  const missing = fields.find((f) => f.required && !trimmed[f.key]);
  const unchanged = fields.every((f) => trimmed[f.key] === f.initial.trim());

  const save = async () => {
    if (missing) {
      setError(t('dash.fieldRequired', { label: missing.label, defaultValue: 'Please fill in "{{label}}".' }));
      return;
    }
    if (unchanged) { onOpenChange(false); return; }
    setError(null);
    const uid = await requireFreshSession();
    if (!uid) return;
    setSaving(true);
    try {
      await onSave(trimmed);
      toast({ title: t('dash.savedToast', 'Saved'), description: savedMessage });
      setSaving(false);
      onOpenChange(false);
      onSaved?.();
    } catch (err) {
      setSaving(false);
      setError(t('dash.saveFailed', { reason: errorText(err, ''), defaultValue: 'We could not save this. {{reason}}' }).trim());
    }
  };

  return (
    <EditDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      onSave={save}
      saving={saving}
      error={error}
      onCloseAutoFocus={onCloseAutoFocus}
    >
      {fields.map((f, i) => {
        const id = `${baseId}-${f.key}`;
        return (
          <div key={f.key} className="space-y-2">
            <Label htmlFor={id} className="text-[15px] font-semibold text-navy">
              {f.label}
              {!f.required && <span className="font-normal text-meta"> {t('dash.optional', '(optional)')}</span>}
            </Label>
            {f.multiline ? (
              <Textarea
                id={id}
                autoFocus={i === 0}
                value={values[f.key] ?? ''}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                placeholder={f.placeholder}
                rows={6}
                className="text-[16px] leading-6"
              />
            ) : (
              <Input
                id={id}
                autoFocus={i === 0}
                value={values[f.key] ?? ''}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                placeholder={f.placeholder}
                inputMode={f.inputMode}
                autoComplete={f.autoComplete ?? 'off'}
                className={INPUT}
              />
            )}
            {f.hint && <p className="text-[14px] leading-5 text-meta">{f.hint}</p>}
          </div>
        );
      })}
    </EditDialog>
  );
}

/* ------------------------------------------------------------------ pictures */

export type PictureKind = 'logo' | 'banner' | 'avatar';

/**
 * A picture (the company logo, its cover photo, the member's photo): what is
 * there now, "Choose a picture", a preview of the new one, then Save.
 * `onRemove` adds a "Remove" button when there is one.
 */
export function PictureDialog({
  open,
  onOpenChange,
  kind,
  title,
  description,
  current,
  name,
  accept,
  check,
  onUpload,
  onRemove,
  savedMessage,
  removedMessage,
  onSaved,
  onCloseAutoFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: PictureKind;
  title: string;
  description?: string;
  current: string | null | undefined;
  name: string;
  accept: string;
  /** Why this file cannot be used ('type' or 'size'), or null. */
  check: (file: File) => 'type' | 'size' | null;
  onUpload: (file: File) => Promise<void>;
  onRemove?: () => Promise<void>;
  savedMessage: string;
  removedMessage?: string;
  onSaved?: () => void;
  onCloseAutoFocus?: (e: Event) => void;
}) {
  const { t } = useTranslation();
  const inputId = useId();
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  useEffect(() => {
    if (open) { setFile(null); setError(null); }
  }, [open]);

  const shown = preview ?? current ?? null;
  const pick = (f: File | undefined) => {
    if (!f) return;
    const problem = check(f);
    if (problem === 'type') { setError(t('dash.pictureType', 'This file is not a picture. Please choose a JPG, PNG or WebP image.')); return; }
    if (problem === 'size') { setError(t('dash.pictureSize', 'This picture is too large. The limit is 25 MB.')); return; }
    setError(null);
    setFile(f);
  };

  const run = async (action: () => Promise<void>, message: string) => {
    const uid = await requireFreshSession();
    if (!uid) return;
    setSaving(true);
    setError(null);
    try {
      await action();
      toast({ title: t('dash.savedToast', 'Saved'), description: message });
      setSaving(false);
      onOpenChange(false);
      onSaved?.();
    } catch (err) {
      setSaving(false);
      setError(t('dash.uploadFailed', { reason: errorText(err, ''), defaultValue: 'We could not save this picture. {{reason}}' }).trim());
    }
  };

  const frame = kind === 'banner'
    ? 'aspect-[3/1] w-full rounded-field'
    : kind === 'avatar' ? 'h-32 w-32 rounded-full' : 'h-32 w-32 rounded-field';
  const hint = kind === 'banner'
    ? t('dash.coverHint', 'A wide picture works best (1600 × 400 px). JPG, PNG or WebP, up to 25 MB.')
    : kind === 'avatar'
      ? t('dash.photoHint', 'A square photo of your face works best. JPG, PNG or WebP, up to 25 MB.')
      : t('dash.logoHint', 'A square logo works best. JPG, PNG, WebP or SVG, up to 25 MB.');

  return (
    <EditDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      onSave={() => (file ? run(() => onUpload(file), savedMessage) : onOpenChange(false))}
      saving={saving}
      canSave={!!file}
      error={error}
      wide={kind === 'banner'}
      onCloseAutoFocus={onCloseAutoFocus}
    >
      <div className={cn('flex flex-col items-center gap-4', kind === 'banner' && 'items-stretch')}>
        <div className={cn('relative grid shrink-0 place-items-center overflow-hidden border border-rule bg-chip', frame)}>
          {shown ? (
            <img
              src={shown}
              alt={file ? t('dash.newPicture', 'The new picture') : t('dash.currentPicture', { name, defaultValue: 'Current picture of {{name}}' })}
              className={cn('h-full w-full', kind === 'logo' ? 'bg-white object-contain p-2' : 'object-cover')}
            />
          ) : kind === 'logo' ? (
            <LogoBadge name={name} size="lg" />
          ) : (
            <Camera className="h-9 w-9 text-meta/60" aria-hidden="true" />
          )}
          {file && (
            <span className="absolute left-2 top-2 rounded-pill bg-navy px-2.5 py-0.5 text-[12px] font-semibold text-white">
              {t('dash.newLabel', 'New')}
            </span>
          )}
        </div>
        <div className="flex w-full flex-col items-center gap-2">
          <label
            htmlFor={inputId}
            className="inline-flex h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-pill border-2 border-navy bg-white px-5 text-[16px] font-semibold text-navy transition-colors hover:bg-chip focus-within:shadow-focus sm:w-auto"
          >
            <ImagePlus className="h-5 w-5" aria-hidden="true" />
            {file || current ? t('dash.chooseOther', 'Choose another picture') : t('dash.choosePicture', 'Choose a picture')}
            <input
              id={inputId}
              type="file"
              accept={accept}
              className="sr-only"
              disabled={saving}
              onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }}
            />
          </label>
          <p className="text-center text-[14px] leading-5 text-meta">{hint}</p>
          {file && <p className="text-center text-[14px] leading-5 text-navy">{t('dash.pressSave', 'Press Save to use this picture.')}</p>}
        </div>
        {onRemove && current && !file && (
          <button
            type="button"
            disabled={saving}
            onClick={() => run(onRemove, removedMessage ?? savedMessage)}
            className="inline-flex min-h-11 items-center justify-center gap-1.5 self-center rounded-pill px-4 text-[15px] font-medium text-red-700 transition-colors hover:bg-red-50 focus:outline-none focus-visible:shadow-focus"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            {t('dash.removePicture', 'Remove this picture')}
          </button>
        )}
      </div>
    </EditDialog>
  );
}

/* ------------------------------------------------------------------ sectors */

interface SectorRow { id: string; label: string }

/** The company's sectors: what a marina is interested in, what the others provide. Ticks, then Save. */
export function SectorsDialog({
  open,
  onOpenChange,
  orgId,
  orgType,
  onSaved,
  onCloseAutoFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string;
  orgType: string | null | undefined;
  onSaved?: () => void;
  onCloseAutoFocus?: (e: Event) => void;
}) {
  const { t } = useTranslation();
  const [all, setAll] = useState<SectorRow[] | null>(null);
  const [initial, setInitial] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isMarina = orgType === 'marina';

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setAll(null);
    setError(null);
    (async () => {
      const [list, mine] = await Promise.all([
        supabase.from('sectors').select('id, label').eq('is_active', true).order('label'),
        supabase.from(orgSectorTable(orgType)).select('sector_id').eq('organization_id', orgId),
      ]);
      if (!alive) return;
      const ids = ((mine.data ?? []) as { sector_id: string }[]).map((r) => r.sector_id);
      setAll((list.data ?? []) as SectorRow[]);
      setInitial(ids);
      setSelected(ids);
    })().catch(() => { if (alive) { setAll([]); setError(t('dash.loadFailed', 'We could not load this. Please try again.')); } });
    return () => { alive = false; };
  }, [open, orgId, orgType, t]);

  const save = async () => {
    const same = selected.length === initial.length && selected.every((s) => initial.includes(s));
    if (same) { onOpenChange(false); return; }
    const uid = await requireFreshSession();
    if (!uid) return;
    setSaving(true);
    setError(null);
    try {
      await saveOrgSectors(orgId, orgType, selected);
      toast({ title: t('dash.savedToast', 'Saved'), description: t('dash.sectorsSaved', 'Your sectors are up to date.') });
      setSaving(false);
      onOpenChange(false);
      onSaved?.();
    } catch (err) {
      setSaving(false);
      setError(t('dash.saveFailed', { reason: errorText(err, ''), defaultValue: 'We could not save this. {{reason}}' }).trim());
    }
  };

  return (
    <EditDialog
      open={open}
      onOpenChange={onOpenChange}
      title={isMarina ? t('dash.sectorsTitleMarina', 'What are you interested in?') : t('dash.sectorsTitle', 'What does your company do?')}
      description={isMarina
        ? t('dash.sectorsDescMarina', 'Tick the subjects your marina is interested in. We use them to show you the right companies and articles.')
        : t('dash.sectorsDesc', 'Tick the sectors you work in. Marinas use them to find you.')}
      onSave={save}
      saving={saving}
      canSave={!!all}
      error={error}
      wide
      onCloseAutoFocus={onCloseAutoFocus}
    >
      {!all ? (
        <div className="flex items-center justify-center py-10 text-meta" role="status">
          <Loader2 className="mr-2 h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          {t('dash.loading', 'Loading…')}
        </div>
      ) : (
        <fieldset>
          <legend className="sr-only">{t('dash.sectors', 'Sectors')}</legend>
          <p className="mb-2 text-[14px] font-semibold text-navy" aria-live="polite">
            {t('dash.sectorsCount', { count: selected.length, defaultValue_one: '{{count}} ticked', defaultValue_other: '{{count}} ticked' })}
          </p>
          <ul className="max-h-[50vh] space-y-1 overflow-y-auto rounded-field border border-rule p-2">
            {all.map((s) => {
              const id = `sector-${s.id}`;
              const on = selected.includes(s.id);
              return (
                <li key={s.id}>
                  <label htmlFor={id} className={cn('flex min-h-11 cursor-pointer items-center gap-3 rounded-field px-3 py-2 text-[15px] leading-5 text-ink transition-colors hover:bg-page', on && 'bg-foam')}>
                    <Checkbox
                      id={id}
                      checked={on}
                      onCheckedChange={() => setSelected((prev) => (prev.includes(s.id) ? prev.filter((x) => x !== s.id) : [...prev, s.id]))}
                      className="h-5 w-5"
                    />
                    {s.label}
                  </label>
                </li>
              );
            })}
          </ul>
        </fieldset>
      )}
    </EditDialog>
  );
}

/* ------------------------------------------------------------------ photos */

/** The product pictures on the company page: remove one, add some. Each change is saved at once. */
export function GalleryDialog({
  open,
  onOpenChange,
  orgId,
  gallery,
  canEdit,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string;
  gallery: string[];
  canEdit: boolean;
  onChanged: (next: string[]) => void;
}) {
  const { t } = useTranslation();
  const inputId = useId();
  const [busy, setBusy] = useState(false);

  const add = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const uid = await requireFreshSession();
    if (!uid) return;
    setBusy(true);
    try {
      const { next, added, skipped } = await addOrgGalleryImages(orgId, gallery, Array.from(files));
      for (const sk of skipped) {
        toast({
          title: sk.reason === 'size'
            ? t('dash.photoTooLarge', { name: sk.name, defaultValue: '{{name}} is too large (25 MB at most)' })
            : t('dash.photoFailed', { name: sk.name, defaultValue: 'We could not add {{name}}' }),
          description: sk.message,
          variant: 'destructive',
        });
      }
      if (added) {
        onChanged(next);
        toast({ title: t('dash.savedToast', 'Saved'), description: t('dash.photosAdded', { count: added, defaultValue_one: '{{count}} photo added.', defaultValue_other: '{{count}} photos added.' }) });
      }
    } catch (err) {
      toast({ title: t('dash.photoAddFailed', 'We could not add the photos'), description: errorText(err, ''), variant: 'destructive' });
    }
    setBusy(false);
  };

  const remove = async (url: string) => {
    const uid = await requireFreshSession();
    if (!uid) return;
    setBusy(true);
    try {
      onChanged(await removeOrgGalleryImage(orgId, gallery, url));
      toast({ title: t('dash.photoRemoved', 'Photo removed') });
    } catch (err) {
      toast({ title: t('dash.photoRemoveFailed', 'We could not remove the photo'), description: errorText(err, ''), variant: 'destructive' });
    }
    setBusy(false);
  };

  return (
    <EditDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('dash.photosTitle', 'Photos of your company')}
      description={t('dash.photosDesc', 'They show on your company page. Anyone in your team can add or remove them.')}
      wide
    >
      {gallery.length === 0 ? (
        <p className="rounded-field bg-page px-4 py-6 text-center text-[15px] text-meta">{t('dash.noPhotos', 'No photos yet.')}</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-busy={busy}>
          {gallery.map((url, i) => (
            <li key={`${i}:${url}`} className="relative aspect-square overflow-hidden rounded-field border border-rule bg-page">
              <img src={url} alt={t('dash.photoN', { n: i + 1, defaultValue: 'Photo {{n}}' })} className="h-full w-full object-cover" />
              {canEdit && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => remove(url)}
                  aria-label={t('dash.removePhotoN', { n: i + 1, defaultValue: 'Remove photo {{n}}' })}
                  className="absolute right-1.5 top-1.5 grid h-10 w-10 place-items-center rounded-full bg-white/95 text-red-700 ring-1 ring-rule transition-colors hover:bg-red-50 focus:outline-none focus-visible:shadow-focus disabled:opacity-60"
                >
                  <X className="h-5 w-5" aria-hidden="true" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <div className="flex flex-col items-center gap-2">
          <label
            htmlFor={inputId}
            className={cn('inline-flex h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-pill border-2 border-navy bg-white px-5 text-[16px] font-semibold text-navy transition-colors hover:bg-chip focus-within:shadow-focus sm:w-auto', busy && 'pointer-events-none opacity-60')}
          >
            {busy ? <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <ImagePlus className="h-5 w-5" aria-hidden="true" />}
            {busy ? t('dash.working', 'Please wait…') : t('dash.addPhotos', 'Add photos')}
            <input id={inputId} type="file" accept="image/*" multiple className="sr-only" disabled={busy} onChange={(e) => { void add(e.target.files); e.target.value = ''; }} />
          </label>
          <p className="text-center text-[14px] leading-5 text-meta">{t('dash.photosHint', 'You can choose several at once (12 at most). JPG, PNG or WebP, up to 25 MB each.')}</p>
        </div>
      )}
    </EditDialog>
  );
}

/* ------------------------------------------------------------------ documents */

/** The company's documents (members see them; the owner adds and removes). */
export function DocumentsDialog({
  open,
  onOpenChange,
  orgId,
  uid,
  canManage,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string;
  uid: string;
  canManage: boolean;
  onChanged: (count: number) => void;
}) {
  const { t, i18n } = useTranslation();
  const inputId = useId();
  const descId = useId();
  const [docs, setDocs] = useState<OrgDocument[] | null>(null);
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setDocs(null);
    setConfirming(null);
    fetchOrgDocuments(orgId).then((d) => { if (alive) setDocs(d); }, () => { if (alive) setDocs([]); });
    return () => { alive = false; };
  }, [open, orgId]);

  const reload = async () => {
    const d = await fetchOrgDocuments(orgId);
    setDocs(d);
    onChangedRef.current(d.length);
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > ORG_DOC_MAX_BYTES) {
      toast({ title: t('dash.docTooLarge', 'This file is too large'), description: t('dash.docLimit', 'The limit is 20 MB.'), variant: 'destructive' });
      return;
    }
    const fresh = await requireFreshSession();
    if (!fresh) return;
    setBusy(true);
    try {
      await uploadOrgDocument(orgId, uid, file, description);
      setDescription('');
      toast({ title: t('dash.savedToast', 'Saved'), description: t('dash.docAdded', { name: file.name, defaultValue: '{{name}} was added.' }) });
      await reload();
    } catch (err) {
      toast({ title: t('dash.docAddFailed', 'We could not add the document'), description: errorText(err, ''), variant: 'destructive' });
    }
    setBusy(false);
  };

  const remove = async (doc: OrgDocument) => {
    setBusy(true);
    try {
      await deleteOrgDocument(doc.id);
      setConfirming(null);
      toast({ title: t('dash.docRemoved', 'Document removed') });
      await reload();
    } catch (err) {
      toast({ title: t('dash.docRemoveFailed', 'We could not remove the document'), description: errorText(err, ''), variant: 'destructive' });
    }
    setBusy(false);
  };

  const day = (iso: string) => new Date(iso).toLocaleDateString(i18n.language === 'fr' ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

  return (
    <EditDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('dash.docsTitle', 'Your company documents')}
      description={canManage
        ? t('dash.docsDescOwner', 'Brochures, references, certificates: files your team can open. PDF, Word or Excel, up to 20 MB.')
        : t('dash.docsDesc', 'Files your company shared on the platform. Only the company owner can add or remove them.')}
      wide
    >
      {!docs ? (
        <div className="flex items-center justify-center py-8 text-meta" role="status">
          <Loader2 className="mr-2 h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          {t('dash.loading', 'Loading…')}
        </div>
      ) : docs.length === 0 ? (
        <p className="rounded-field bg-page px-4 py-6 text-center text-[15px] text-meta">{t('dash.noDocs', 'No documents yet.')}</p>
      ) : (
        <ul className="divide-y divide-rule rounded-field border border-rule">
          {docs.map((doc) => (
            <li key={doc.id} className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-field bg-chip text-navy">
                  <FileText className="h-5 w-5" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <a href={doc.file_url} target="_blank" rel="noopener noreferrer" className="block truncate text-[15px] font-semibold text-navy underline-offset-2 hover:underline">
                    {doc.file_name}
                    <span className="sr-only"> {t('dash.opensNewTab', '(opens in a new tab)')}</span>
                  </a>
                  <p className="truncate text-[13px] text-meta">
                    {[`${Math.max(1, Math.round(doc.file_size / 1024))} KB`, day(doc.created_at), doc.description].filter(Boolean).join(' · ')}
                  </p>
                </div>
              </div>
              {canManage && (confirming === doc.id ? (
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-[14px] text-navy">{t('dash.removeQ', 'Remove it?')}</span>
                  <button type="button" disabled={busy} onClick={() => remove(doc)} className="min-h-11 rounded-pill bg-red-700 px-4 text-[14px] font-semibold text-white hover:bg-red-800 focus:outline-none focus-visible:shadow-focus disabled:opacity-60">
                    {t('dash.yesRemove', 'Yes, remove')}
                  </button>
                  <button type="button" onClick={() => setConfirming(null)} className="min-h-11 rounded-pill px-3 text-[14px] font-medium text-navy hover:bg-chip focus:outline-none focus-visible:shadow-focus">
                    {t('dash.keep', 'Keep')}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirming(doc.id)}
                  aria-label={t('dash.removeDocNamed', { name: doc.file_name, defaultValue: 'Remove {{name}}' })}
                  className="inline-flex min-h-11 shrink-0 items-center gap-1.5 self-start rounded-pill px-3 text-[14px] font-medium text-red-700 hover:bg-red-50 focus:outline-none focus-visible:shadow-focus sm:self-auto"
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                  {t('dash.remove', 'Remove')}
                </button>
              ))}
            </li>
          ))}
        </ul>
      )}
      {canManage && (
        <div className="space-y-3 rounded-field bg-page p-3">
          <div className="space-y-1.5">
            <Label htmlFor={descId} className="text-[15px] font-semibold text-navy">
              {t('dash.docNote', 'A short note about the next document')} <span className="font-normal text-meta">{t('dash.optional', '(optional)')}</span>
            </Label>
            <Input id={descId} value={description} onChange={(e) => setDescription(e.target.value)} className={INPUT} placeholder={t('dash.docNotePlaceholder', 'e.g. 2026 brochure')} />
          </div>
          <label
            htmlFor={inputId}
            className={cn('inline-flex h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-pill border-2 border-navy bg-white px-5 text-[16px] font-semibold text-navy transition-colors hover:bg-chip focus-within:shadow-focus sm:w-auto', busy && 'pointer-events-none opacity-60')}
          >
            {busy ? <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Upload className="h-5 w-5" aria-hidden="true" />}
            {busy ? t('dash.working', 'Please wait…') : t('dash.addDoc', 'Add a document')}
            <input id={inputId} type="file" accept={DOC_ACCEPT} className="sr-only" disabled={busy} onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
        </div>
      )}
    </EditDialog>
  );
}

/* ------------------------------------------------------------------ e-mails */

/** The kinds of e-mail, in plain words (the full list with examples is NotificationPreferencesTab). */
const EMAIL_KIND_LABEL: Record<string, { label: string; hint: string }> = {
  b2b: { label: 'Connection requests', hint: 'When a member wants to connect with you, and their answers.' },
  submissions: { label: 'Your requests and proposals', hint: 'When the M3 team approves or answers what you published.' },
  recommendations: { label: 'References', hint: 'When a marina confirms or declines a reference you asked for.' },
  events: { label: 'Events', hint: 'Your registrations and reminders before a webinar.' },
  payments: { label: 'Payments and invoices', hint: 'Invoices and payment confirmations.' },
  team: { label: 'Your team', hint: 'Invitations and people asking to join your company.' },
  account: { label: 'Your account', hint: 'When your account is approved. Best kept on.' },
  marketing: { label: 'News from M3', hint: 'Welcome e-mails about the platform.' },
};

/** Which e-mails the member gets: one switch per kind, then Save. A missing key reads as "on". */
export function EmailPrefsDialog({
  open,
  onOpenChange,
  uid,
  prefs,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  uid: string;
  prefs: Record<string, unknown> | null | undefined;
  onSaved?: () => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stored = useMemo(() => {
    const out: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(prefs ?? {})) if (typeof v === 'boolean') out[k] = v;
    return out;
  }, [prefs]);
  useEffect(() => {
    if (open) { setDraft(stored); setError(null); }
  }, [open, stored]);

  const on = (key: string) => draft[key] !== false;

  const save = async () => {
    const changed = CATEGORIES.some((c) => (stored[c.key] !== false) !== on(c.key));
    if (!changed) { onOpenChange(false); return; }
    const fresh = await requireFreshSession();
    if (!fresh) return;
    setSaving(true);
    setError(null);
    try {
      // The same map the full preferences screen writes: what is stored, plus
      // each switch that was flipped (as if each had been toggled there).
      const next = { ...(prefs ?? {}) } as Record<string, boolean>;
      for (const c of CATEGORIES) if ((stored[c.key] !== false) !== on(c.key)) next[c.key] = on(c.key);
      await saveNotificationPrefs(uid, next);
      toast({ title: t('dash.savedToast', 'Saved'), description: t('dash.emailsSaved', 'Your e-mail choices are saved.') });
      setSaving(false);
      onOpenChange(false);
      onSaved?.();
    } catch (err) {
      setSaving(false);
      setError(t('dash.saveFailed', { reason: errorText(err, ''), defaultValue: 'We could not save this. {{reason}}' }).trim());
    }
  };

  return (
    <EditDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('dash.emailsTitle', 'Which e-mails do you want?')}
      description={t('dash.emailsDesc', 'Turn off what you do not need. You can change this at any time.')}
      onSave={save}
      saving={saving}
      error={error}
      wide
    >
      <ul className="divide-y divide-rule rounded-field border border-rule">
        {CATEGORIES.map((c) => {
          const copy = EMAIL_KIND_LABEL[c.key] ?? { label: c.title, hint: c.description };
          const id = `email-kind-${c.key}`;
          return (
            <li key={c.key} className="flex items-center gap-4 px-3 py-3">
              <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
                <span className="block text-[15px] font-semibold leading-5 text-navy">{t(`dash.emails.${c.key}`, copy.label)}</span>
                <span className="mt-0.5 block text-[14px] leading-5 text-meta">{t(`dash.emails.${c.key}Hint`, copy.hint)}</span>
              </label>
              <Switch
                id={id}
                checked={on(c.key)}
                onCheckedChange={(v) => setDraft((d) => ({ ...d, [c.key]: v }))}
                className="data-[state=checked]:bg-navy"
              />
            </li>
          );
        })}
      </ul>
    </EditDialog>
  );
}

/* ------------------------------------------------------------------ password */

/** "Change password": we e-mail a link to choose a new one. */
export function PasswordDialog({
  open,
  onOpenChange,
  email,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  email: string | null | undefined;
}) {
  const { t } = useTranslation();
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) setError(null); }, [open]);

  const send = async () => {
    if (!email) return;
    setSending(true);
    setError(null);
    try {
      await sendPasswordLink(email);
      toast({ title: t('dash.passwordSent', 'E-mail sent'), description: t('dash.passwordSentDesc', { email, defaultValue: 'Open the e-mail we sent to {{email}} and follow the link to choose a new password.' }) });
      setSending(false);
      onOpenChange(false);
    } catch (err) {
      setSending(false);
      setError(t('dash.passwordFailed', { reason: errorText(err, ''), defaultValue: 'We could not send the e-mail. {{reason}}' }).trim());
    }
  };

  return (
    <EditDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('dash.passwordTitle', 'Change your password')}
      description={t('dash.passwordDesc', { email: email ?? '', defaultValue: 'We will e-mail a link to {{email}}. Open it and choose your new password.' })}
      onSave={send}
      saveLabel={t('dash.passwordSend', 'Send me the link')}
      saving={sending}
      error={error}
    />
  );
}

/** Re-exported for the panels: the touch-size outline button class. */
export { BTN_TOUCH };
