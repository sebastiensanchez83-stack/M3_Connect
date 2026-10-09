import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ShieldCheck, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LogoBadge } from '@/components/ui/CoverImage';
import { RowSkeleton, StatusPill } from '@/components/member/MemberUI';
import { useAuth } from '@/contexts/AuthContext';
import {
  imageProblem, removeOrgBrandImage, saveOrgFields, uploadOrgBrandImage, COVER_ACCEPT, LOGO_ACCEPT,
} from '@/components/organization/orgActions';
import { externalUrl } from '@/lib/externalUrl';
import { lazyWithRetry } from '@/lib/lazyWithRetry';
import { scrollTopUnderBars } from '@/lib/scrollTarget';
import { cn } from '@/lib/utils';
import { BTN_TOUCH, InfoList, InfoRow, NotFilled, useSavedFlash } from './EditKit';
import { DocumentsDialog, FieldsDialog, GalleryDialog, PictureDialog, SectorsDialog } from './fieldDialogs';
import { SwitchCompanyDialog } from './teamDialogs';
import { useCompanyDetails } from './useCompany';

// The full editor (every field, marina facts, capital raise, investment thesis…): only when asked.
const OrganizationWorkspace = lazyWithRetry(() => import('@/components/account/OrganizationWorkspace').then((m) => ({ default: m.OrganizationWorkspace })));

/**
 * My company, as rows: logo, cover photo, name, description, website, country
 * and city, sectors, photos, documents, and whether M3 has checked it. Each
 * "Change" opens a small window with that one thing (OrganizationTab's writes,
 * through orgActions). Anyone in the company may change its page, as in the
 * full editor; documents are the owner's.
 *
 * What the rows do not cover (marina facts, capital raise, investment thesis,
 * audience, headquarters, sponsoring, ownership) stays in the full editor,
 * behind "More settings" at the bottom. The address can point at a row
 * (section=branding: the logo, details: the name, gallery: the photos,
 * documents) or at the full editor (section=more, capital, thesis).
 *
 * No company yet: the full editor's own "create your organisation" form.
 */

type Editing = 'logo' | 'banner' | 'name' | 'description' | 'website' | 'place' | 'sectors' | 'gallery' | 'documents' | 'switch' | null;

const ROW_OF_SECTION: Record<string, string> = {
  branding: 'logo',
  details: 'name',
  gallery: 'gallery',
  documents: 'documents',
};
const EDITOR_SECTIONS = ['more', 'capital', 'thesis'];

export function CompanyPanel({
  initialSection,
  version,
  onChanged,
}: {
  initialSection: string | null;
  /** The dashboard's version: a change saved elsewhere (a to-do window) reads the rows again. */
  version: number;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const { user, organization, orgRole, organizations, refreshProfile } = useAuth();
  const [, setSearchParams] = useSearchParams();
  const orgId = organization?.id ?? null;
  const orgType = organization?.organization_type ?? null;
  const [reloadKey, setReloadKey] = useState(0);
  const { data, loading, patch } = useCompanyDetails(orgId, orgType, `${reloadKey}:${version}`);
  const [editing, setEditing] = useState<Editing>(null);
  const [saved, flash] = useSavedFlash();
  const [moreOpen, setMoreOpen] = useState(() => !!initialSection && EDITOR_SECTIONS.includes(initialSection));
  // A change made here while the full editor is open re-opens the editor on the new values.
  const [editorKey, setEditorKey] = useState(0);
  const [highlight, setHighlight] = useState<string | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const galleryTouched = useRef(false);

  // An address that points at a row (only the one the panel opened with): bring
  // it into view, tint it, focus its button, then drop it from the address so a
  // reload does not do it again.
  const [pointed] = useState(() => (initialSection ? ROW_OF_SECTION[initialSection] ?? null : null));
  const pointedDone = useRef(false);
  const hasData = !!data;
  useEffect(() => {
    if (!pointed || pointedDone.current || !hasData) return;
    const timer = window.setTimeout(() => {
      pointedDone.current = true;
      setSearchParams((prev) => {
        if (prev.get('section') === null || EDITOR_SECTIONS.includes(prev.get('section') ?? '')) return prev;
        const p = new URLSearchParams(prev);
        p.delete('section');
        return p;
      }, { replace: true });
      const row = document.getElementById(`company-row-${pointed}`);
      if (!row) return;
      window.scrollTo({ top: scrollTopUnderBars(row, 0, 24) });
      row.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
      setHighlight(pointed);
      window.setTimeout(() => setHighlight(null), 2500);
    }, 700);
    return () => window.clearTimeout(timer);
  }, [pointed, hasData, setSearchParams]);

  if (!user) return null;

  // No company yet: the full editor's own explanation and "create your organisation" form.
  if (!organization || !orgId) {
    return (
      <Suspense fallback={<div className="rounded-card border border-rule bg-white"><RowSkeleton rows={3} /></div>}>
        <OrganizationWorkspace />
      </Suspense>
    );
  }

  const isOwner = orgRole === 'owner';
  // Any member edits the company's page (the full editor's canEditOrg): the database checks membership.
  const canEdit = !!orgRole;
  const org = data?.org ?? organization;
  const gallery = Array.isArray(org.gallery) ? org.gallery : [];

  const changed = (key: string) => () => {
    flash(key);
    setReloadKey((k) => k + 1);
    setEditorKey((k) => k + 1);
    void refreshProfile();
    onChanged();
  };
  const close = (open: boolean) => { if (!open) setEditing(null); };
  const change = t('dash.change', 'Change');
  const onlyOwner = t('dash.onlyOwner', 'Only the company owner or an admin can change this.');

  const toggleMore = () => {
    const next = !moreOpen;
    setMoreOpen(next);
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev);
      if (next) p.set('section', 'more'); else p.delete('section');
      return p;
    }, { replace: true });
    if (next) {
      window.setTimeout(() => {
        if (editorRef.current) window.scrollTo({ top: scrollTopUnderBars(editorRef.current, 0, 16), behavior: 'smooth' });
      }, 150);
    } else {
      // The full editor may have changed things: read them again.
      setReloadKey((k) => k + 1);
      onChanged();
    }
  };

  const action = (key: Exclude<Editing, null>, label = change) => (canEdit ? { actionLabel: label, onAction: () => setEditing(key) } : {});
  const place = [org.city, org.country].filter(Boolean).join(', ');
  // What the full editor adds to the rows, for this kind of company.
  const moreHint = orgType === 'marina'
    ? t('dash.moreHintMarina', 'Your marina facts (berths, services, plans), raising money for a project, and the full company form.')
    : orgType === 'developer'
      ? t('dash.moreHintDeveloper', 'Raising money for a project, and the full company form.')
      : orgType === 'investor'
        ? t('dash.moreHintInvestor', 'What you invest in, and the full company form.')
        : orgType === 'media_partner'
          ? t('dash.moreHintMedia', 'Your audience, and the full company form.')
          : orgType === 'partner'
            ? t('dash.moreHintPartner', 'Your head office, raising money, sponsoring an event, and the full company form.')
            : t('dash.moreHintOther', 'The full company form.');
  const verified = org.access_status === 'verified';

  return (
    <div className="space-y-4">
      {/* Who the dashboard acts for, when there is a choice. */}
      {organizations.length > 1 && (
        <div className="flex flex-col gap-3 rounded-card border border-rule bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <p className="text-[15px] leading-6 text-ink">
            {t('dash.actingFor', { org: org.name, defaultValue: 'You act for {{org}}.' })}{' '}
            <span className="text-meta">{t('dash.severalCompanies', { count: organizations.length, defaultValue: 'You belong to {{count}} companies.' })}</span>
          </p>
          <Button type="button" variant="outline" className={BTN_TOUCH} onClick={() => setEditing('switch')}>
            {t('dash.switchCompany', 'Switch company')}
          </Button>
        </div>
      )}

      {!canEdit && (
        <p className="rounded-card bg-white px-4 py-3 text-[15px] leading-6 text-meta ring-1 ring-inset ring-rule">{onlyOwner}</p>
      )}

      {loading && !data ? (
        <div className="rounded-card border border-rule bg-white"><RowSkeleton rows={5} /></div>
      ) : (
        <InfoList label={t('dash.tiles.company', 'My company')}>
          <InfoRow
            id="company-row-logo"
            label={t('dash.logo', 'Logo')}
            value={org.logo_url ? <LogoBadge src={org.logo_url} name={org.name} size="lg" /> : <NotFilled />}
            {...action('logo', org.logo_url ? change : t('dash.addLogo', 'Add logo'))}
            saved={saved === 'logo'}
            highlight={highlight === 'logo'}
          />
          <InfoRow
            id="company-row-banner"
            label={t('dash.cover', 'Cover photo')}
            value={org.banner_url
              ? <img src={org.banner_url} alt={t('dash.coverOf', { org: org.name, defaultValue: 'Cover photo of {{org}}' })} className="aspect-[3/1] w-full max-w-[18rem] rounded-field object-cover ring-1 ring-rule" />
              : <NotFilled />}
            {...action('banner', org.banner_url ? change : t('dash.addCover', 'Add cover photo'))}
            saved={saved === 'banner'}
          />
          <InfoRow
            id="company-row-name"
            label={t('dash.companyName', 'Name')}
            value={org.name || <NotFilled />}
            {...action('name')}
            saved={saved === 'name'}
            highlight={highlight === 'name'}
          />
          <InfoRow
            id="company-row-description"
            label={t('dash.description', 'Description')}
            value={org.description
              ? <span className="line-clamp-4 whitespace-pre-line font-normal text-ink">{org.description}</span>
              : <NotFilled />}
            {...action('description', org.description ? change : t('dash.addDescription', 'Add description'))}
            saved={saved === 'description'}
          />
          <InfoRow
            id="company-row-website"
            label={t('dash.website', 'Website')}
            value={org.website
              ? <a href={externalUrl(org.website) ?? undefined} target="_blank" rel="noopener noreferrer" className="break-all underline decoration-navy/30 underline-offset-4 hover:decoration-gold">{org.website.replace(/^https?:\/\//, '')}<span className="sr-only"> {t('dash.opensNewTab', '(opens in a new tab)')}</span></a>
              : <NotFilled />}
            {...action('website')}
            saved={saved === 'website'}
          />
          <InfoRow
            id="company-row-place"
            label={t('dash.placeRow', 'City, country')}
            value={place || <NotFilled />}
            {...action('place')}
            saved={saved === 'place'}
          />
          <InfoRow
            id="company-row-sectors"
            label={orgType === 'marina' ? t('dash.interests', 'What you are interested in') : t('dash.sectorsRow', 'What you do')}
            value={data && data.sectors.length > 0 ? (
              <span className="flex flex-wrap gap-1.5">
                {data.sectors.slice(0, 6).map((s) => (
                  <span key={s} className="rounded-pill bg-chip px-2.5 py-0.5 text-[13px] font-medium text-navy">{s}</span>
                ))}
                {data.sectors.length > 6 && (
                  <span className="px-1 text-[13px] font-medium text-meta">{t('dash.andMore', { count: data.sectors.length - 6, defaultValue: 'and {{count}} more' })}</span>
                )}
              </span>
            ) : <NotFilled />}
            {...action('sectors')}
            saved={saved === 'sectors'}
          />
          <InfoRow
            id="company-row-gallery"
            label={t('dash.photos', 'Photos')}
            value={gallery.length > 0 ? (
              <span className="flex items-center gap-2">
                {gallery.slice(0, 3).map((url, i) => (
                  <img key={`${i}:${url}`} src={url} alt="" className="h-12 w-12 rounded-field object-cover ring-1 ring-rule" />
                ))}
                <span className="text-[15px] font-medium text-meta">
                  {t('dash.photosCount', { count: gallery.length, defaultValue_one: '{{count}} photo', defaultValue_other: '{{count}} photos' })}
                </span>
              </span>
            ) : <NotFilled>{t('dash.noPhotosYet', 'No photos yet')}</NotFilled>}
            actionLabel={canEdit ? t('dash.managePhotos', 'Manage photos') : t('dash.seePhotos', 'See photos')}
            onAction={() => setEditing('gallery')}
            saved={saved === 'gallery'}
            highlight={highlight === 'gallery'}
          />
          <InfoRow
            id="company-row-documents"
            label={t('dash.documents', 'Documents')}
            value={(data?.documents ?? 0) > 0
              ? t('dash.docsCount', { count: data?.documents ?? 0, defaultValue_one: '{{count}} document', defaultValue_other: '{{count}} documents' })
              : <NotFilled>{t('dash.noDocsYet', 'No documents yet')}</NotFilled>}
            hint={isOwner ? undefined : t('dash.docsOwnerOnly', 'Only the company owner can add or remove documents.')}
            actionLabel={isOwner ? t('dash.manageDocs', 'Manage documents') : t('dash.seeDocs', 'See documents')}
            onAction={() => setEditing('documents')}
            highlight={highlight === 'documents'}
          />
          <InfoRow
            label={t('dash.checkedByM3', 'Checked by M3')}
            value={verified
              ? <StatusPill tone="success" icon={ShieldCheck}>{t('dash.companyVerified', 'Yes, your company is verified')}</StatusPill>
              : <StatusPill tone="warning" icon={Clock}>{t('dash.companyPending', 'Not yet: the M3 team is checking it')}</StatusPill>}
          />
        </InfoList>
      )}

      {/* Everything else, in the full editor. */}
      <div className="rounded-card border border-dashed border-rule bg-white/60 px-4 py-3 sm:px-5">
        <button
          type="button"
          onClick={toggleMore}
          aria-expanded={moreOpen}
          aria-controls="company-more-settings"
          className="flex min-h-11 w-full items-center justify-between gap-3 rounded-field text-left focus:outline-none focus-visible:shadow-focus"
        >
          <span>
            <span className="block text-[16px] font-semibold text-navy">{moreOpen ? t('dash.hideMore', 'Hide more settings') : t('dash.moreSettings', 'More settings')}</span>
            <span className="block text-[14px] leading-5 text-meta">{moreHint}</span>
          </span>
          <ChevronDown className={cn('h-5 w-5 shrink-0 text-meta transition-transform motion-reduce:transition-none', moreOpen && 'rotate-180')} aria-hidden="true" />
        </button>
      </div>
      <div id="company-more-settings" ref={editorRef}>
        {moreOpen && (
          <Suspense fallback={<div className="rounded-card border border-rule bg-white"><RowSkeleton rows={3} /></div>}>
            <p className="mb-3 text-[14px] leading-5 text-meta">
              {t('dash.moreSettingsSave', 'Press Save in this form before you use a "Change" button above, or what you typed here is lost.')}
            </p>
            <OrganizationWorkspace
              key={editorKey}
              syncAddress={false}
              onSaved={() => { setReloadKey((k) => k + 1); onChanged(); }}
            />
          </Suspense>
        )}
      </div>

      {/* The small windows. */}
      <PictureDialog
        open={editing === 'logo'}
        onOpenChange={close}
        kind="logo"
        title={org.logo_url ? t('dash.logoTitleChange', 'Change your company logo') : t('dash.logoTitle', 'Add your company logo')}
        description={t('dash.logoDesc', 'It shows on your company page, in the directory and next to your requests.')}
        current={org.logo_url}
        name={org.name}
        accept={LOGO_ACCEPT}
        check={imageProblem}
        onUpload={async (file) => { const { url } = await uploadOrgBrandImage(orgId, 'logo', file); patch({ logo_url: url }); }}
        onRemove={async () => { await removeOrgBrandImage(orgId, 'logo'); patch({ logo_url: null }); }}
        savedMessage={t('dash.logoSaved', 'Your logo is updated.')}
        removedMessage={t('dash.logoRemoved', 'The logo is removed.')}
        onSaved={changed('logo')}
      />
      <PictureDialog
        open={editing === 'banner'}
        onOpenChange={close}
        kind="banner"
        title={org.banner_url ? t('dash.coverTitleChange', 'Change your cover photo') : t('dash.coverTitle', 'Add a cover photo')}
        description={t('dash.coverDesc', 'The wide picture at the top of your company page.')}
        current={org.banner_url}
        name={org.name}
        accept={COVER_ACCEPT}
        check={imageProblem}
        onUpload={async (file) => { const { url } = await uploadOrgBrandImage(orgId, 'banner', file); patch({ banner_url: url }); }}
        onRemove={async () => { await removeOrgBrandImage(orgId, 'banner'); patch({ banner_url: null }); }}
        savedMessage={t('dash.coverSaved', 'Your cover photo is updated.')}
        removedMessage={t('dash.coverRemoved', 'The cover photo is removed.')}
        onSaved={changed('banner')}
      />
      <FieldsDialog
        open={editing === 'name'}
        onOpenChange={close}
        title={t('dash.nameTitle', 'Change the company name')}
        fields={[{ key: 'v', label: t('dash.companyName', 'Name'), initial: org.name ?? '', required: true, autoComplete: 'organization' }]}
        onSave={async (v) => { await saveOrgFields(orgId, { name: v.v }); patch({ name: v.v }); }}
        onSaved={changed('name')}
      />
      <FieldsDialog
        open={editing === 'description'}
        onOpenChange={close}
        title={org.description ? t('dash.descriptionTitleChange', 'Change the description') : t('dash.descriptionTitle', 'Add a description')}
        description={t('dash.descriptionDesc', 'A few sentences about what your company does. It is the first thing people read on your page.')}
        fields={[{ key: 'v', label: t('dash.description', 'Description'), initial: org.description ?? '', multiline: true }]}
        onSave={async (v) => { await saveOrgFields(orgId, { description: v.v || null }); patch({ description: v.v || null }); }}
        onSaved={changed('description')}
      />
      <FieldsDialog
        open={editing === 'website'}
        onOpenChange={close}
        title={t('dash.websiteTitle', 'Change the website')}
        fields={[{ key: 'v', label: t('dash.website', 'Website'), initial: org.website ?? '', inputMode: 'url', placeholder: 'www.example.com', autoComplete: 'url' }]}
        onSave={async (v) => { await saveOrgFields(orgId, { website: v.v || null }); patch({ website: v.v || null }); }}
        onSaved={changed('website')}
      />
      <FieldsDialog
        open={editing === 'place'}
        onOpenChange={close}
        title={t('dash.placeTitle', 'Where is your company?')}
        fields={[
          { key: 'country', label: t('dash.country', 'Country'), initial: org.country ?? '', autoComplete: 'country-name' },
          { key: 'city', label: t('dash.city', 'City'), initial: org.city ?? '', autoComplete: 'address-level2' },
        ]}
        onSave={async (v) => {
          await saveOrgFields(orgId, { country: v.country || null, city: v.city || null });
          patch({ country: v.country || null, city: v.city || null });
        }}
        onSaved={changed('place')}
      />
      <SectorsDialog open={editing === 'sectors'} onOpenChange={close} orgId={orgId} orgType={orgType} onSaved={changed('sectors')} />
      <GalleryDialog
        open={editing === 'gallery'}
        onOpenChange={(o) => {
          if (o) return;
          setEditing(null);
          if (galleryTouched.current) { galleryTouched.current = false; changed('gallery')(); }
        }}
        orgId={orgId}
        gallery={gallery}
        canEdit={canEdit}
        onChanged={(next) => { galleryTouched.current = true; patch({ gallery: next }); }}
      />
      <DocumentsDialog
        open={editing === 'documents'}
        onOpenChange={(o) => { if (!o) { setEditing(null); setReloadKey((k) => k + 1); onChanged(); } }}
        orgId={orgId}
        uid={user.id}
        canManage={isOwner}
        onChanged={() => undefined}
      />
      <SwitchCompanyDialog open={editing === 'switch'} onOpenChange={close} />
    </div>
  );
}
