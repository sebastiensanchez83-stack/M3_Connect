import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { LucideIcon } from 'lucide-react';
import {
  Anchor, ArrowRight, Building2, Camera, Globe, KeyRound, Loader2, Newspaper, Pencil, Save, ShieldCheck,
  TrendingUp, Upload, UserCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LogoBadge } from '@/components/ui/CoverImage';
import { BTN, BTN_OUTLINE, MemberPanel } from '@/components/member/MemberUI';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/hooks/use-toast';
import { requireFreshSession } from '@/lib/session';
import { externalUrl } from '@/lib/externalUrl';
import { memberHomeHref } from '@/lib/accountNav';
import { cn } from '@/lib/utils';
import { Field } from './accountUi';
import { avatarProblem, saveProfileFields, sendPasswordLink as emailPasswordLink, uploadAvatar as storeAvatar } from './profileActions';
import { formatDay, humanize, uiLocale } from './format';

/**
 * The member's own profile: photo, name, job title, account details, the
 * organisation they act for, and the password. Moved from the old
 * /account?tab=profile, reads and writes unchanged. (The "preview my profile"
 * dialog went with the public personal page: there is none any more.)
 */
const PERSONA_META: Record<string, { key: string; fallback: string; icon: LucideIcon }> = {
  marina: { key: 'accountArea.persona.marina', fallback: 'Marina / Port', icon: Anchor },
  developer: { key: 'accountArea.persona.developer', fallback: 'Marina developer', icon: Anchor },
  partner: { key: 'accountArea.persona.partner', fallback: 'Service provider', icon: Building2 },
  media_partner: { key: 'accountArea.persona.media_partner', fallback: 'Media', icon: Newspaper },
  investor: { key: 'accountArea.persona.investor', fallback: 'Investor', icon: TrendingUp },
  individual: { key: 'accountArea.persona.individual', fallback: 'Individual', icon: UserCircle },
  moderator: { key: 'accountArea.persona.moderator', fallback: 'Moderator', icon: ShieldCheck },
  admin: { key: 'accountArea.persona.admin', fallback: 'Administrator', icon: ShieldCheck },
};

const ACCESS_LABEL: Record<string, { key: string; fallback: string }> = {
  verified: { key: 'accountArea.access.verified', fallback: 'Verified' },
  pending: { key: 'accountArea.access.pending', fallback: 'Pending' },
  rejected: { key: 'accountArea.access.rejected', fallback: 'Rejected' },
  suspended: { key: 'accountArea.access.suspended', fallback: 'Suspended' },
};

export function ProfileEditor({ onOpenOrganization }: { onOpenOrganization?: () => void }) {
  const { t, i18n } = useTranslation();
  const { user, profile, organization: org, orgRole, refreshProfile } = useAuth();
  const locale = uiLocale(i18n.language);

  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [editingProfile, setEditingProfile] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileForm, setProfileForm] = useState({ firstName: '', lastName: '', jobTitle: '' });

  // Initialise the form when the profile loads or its values change — keyed on
  // the values, so a refocus can't wipe what is being typed.
  const hasProfile = !!profile;
  const pFirst = profile?.first_name || '';
  const pLast = profile?.last_name || '';
  const pJob = profile?.job_title || '';
  useEffect(() => {
    if (!hasProfile) return;
    setProfileForm({ firstName: pFirst, lastName: pLast, jobTitle: pJob });
  }, [hasProfile, pFirst, pLast, pJob]);

  if (!user || !profile) return null;

  const handleSaveProfile = async () => {
    const freshUid = await requireFreshSession();
    if (!freshUid) return;
    setSavingProfile(true);
    try {
      await saveProfileFields(user.id, {
        first_name: profileForm.firstName.trim(),
        last_name: profileForm.lastName.trim(),
        job_title: profileForm.jobTitle.trim() || null,
      });
      toast({ title: t('accountArea.toast.profileUpdated', 'Profile updated'), description: t('accountArea.toast.profileUpdatedDesc', 'Your personal information has been saved.') });
      setEditingProfile(false);
      await refreshProfile();
    } catch (err: unknown) {
      toast({ title: t('accountArea.toast.error', 'Error'), description: err instanceof Error ? err.message : t('accountArea.toast.profileUpdateFailed', 'Failed to update profile.'), variant: 'destructive' });
    } finally {
      setSavingProfile(false);
    }
  };

  const uploadAvatar = async (file: File) => {
    const problem = avatarProblem(file);
    if (problem === 'type') {
      toast({ title: t('accountArea.toast.invalidFile', 'Invalid file type'), description: t('accountArea.toast.invalidFileDesc', 'Please upload an image (JPEG, PNG, WebP)'), variant: 'destructive' });
      return;
    }
    if (problem === 'size') {
      toast({ title: t('accountArea.toast.fileTooLarge', 'File too large'), description: t('accountArea.toast.fileTooLargeDesc', 'Maximum 25 MB'), variant: 'destructive' });
      return;
    }
    const freshUid = await requireFreshSession();
    if (!freshUid) return;
    setUploadingAvatar(true);
    try {
      const { meta } = await storeAvatar(user.id, file);
      toast({ title: t('accountArea.toast.avatarUpdated', 'Profile image updated'), description: meta });
      await refreshProfile();
    } catch (err: unknown) {
      toast({ title: t('accountArea.toast.uploadFailed', 'Upload failed'), description: err instanceof Error ? err.message : t('accountArea.toast.unexpected', 'An unexpected error occurred.'), variant: 'destructive' });
    }
    setUploadingAvatar(false);
  };

  const sendPasswordLink = async () => {
    if (!user.email) return;
    try {
      await emailPasswordLink(user.email);
    } catch (error: unknown) {
      toast({ title: t('accountArea.toast.error', 'Error'), description: error instanceof Error ? error.message : String(error), variant: 'destructive' });
      return;
    }
    toast({ title: t('memberHome.profile.passwordSent', 'Password reset email sent'), description: t('memberHome.profile.passwordSentDesc', 'Check your inbox for a link to reset your password.') });
  };

  const personaMeta = PERSONA_META[profile.persona as string];
  const personaLabel = personaMeta ? t(personaMeta.key, personaMeta.fallback) : '';
  const PersonaIcon = personaMeta?.icon ?? null;
  const access = ACCESS_LABEL[profile.access_status];
  const displayName = `${profile.first_name || ''} ${profile.last_name || ''}`.trim();
  const emailLabel = t('memberHome.profile.email', 'Email');

  return (
    <div className="space-y-6">
      {/* Photo + identity */}
      <MemberPanel>
        <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:p-6">
          <div className="group relative w-fit shrink-0">
            {profile.avatar_url ? (
              <img src={profile.avatar_url} alt={t('accountArea.profile.avatarAlt', 'Your profile photo')} className="h-20 w-20 rounded-full border-2 border-rule object-cover" />
            ) : (
              <div className="flex h-20 w-20 items-center justify-center rounded-full border-2 border-rule bg-chip text-xl font-bold text-navy">
                {(profile.first_name?.[0] || '').toUpperCase()}{(profile.last_name?.[0] || '').toUpperCase()}
              </div>
            )}
            <label className="absolute inset-0 flex cursor-pointer items-center justify-center rounded-full bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
              {uploadingAvatar ? <Loader2 className="h-5 w-5 animate-spin text-white" aria-hidden="true" /> : <Camera className="h-5 w-5 text-white" aria-hidden="true" />}
              <span className="sr-only">{t('accountArea.profile.changePhoto', 'Change photo')}</span>
              <input type="file" accept="image/*" className="hidden" onChange={(e) => { if (e.target.files?.[0]) uploadAvatar(e.target.files[0]); }} disabled={uploadingAvatar} />
            </label>
          </div>
          <div className="min-w-0">
            <p className="text-lg font-semibold text-navy">
              {displayName || user.email?.split('@')[0] || t('memberHome.sections.profile', 'My profile')}
            </p>
            <p className="break-all text-sm text-meta">{user.email}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              {profile.job_title && <span className="text-sm text-meta">{profile.job_title}</span>}
              {personaLabel && (
                <span className="inline-flex items-center gap-1 rounded-pill bg-chip px-2.5 py-0.5 text-xs font-medium text-navy">
                  {PersonaIcon && <PersonaIcon className="h-3.5 w-3.5" aria-hidden="true" />}
                  {personaLabel}
                </span>
              )}
            </div>
            <label className="mt-3 inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-pill border border-navy/25 bg-white px-4 text-sm font-medium text-navy hover:border-navy hover:bg-chip focus-within:shadow-focus">
              {uploadingAvatar ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Upload className="h-4 w-4" aria-hidden="true" />}
              {profile.avatar_url ? t('accountArea.profile.changePhoto', 'Change photo') : t('accountArea.profile.uploadPhoto', 'Upload photo')}
              <input type="file" accept="image/*" className="sr-only" onChange={(e) => { if (e.target.files?.[0]) uploadAvatar(e.target.files[0]); }} disabled={uploadingAvatar} />
            </label>
            <p className="mt-1.5 text-xs text-meta">{t('accountArea.profile.photoHelp', 'Square JPG, PNG or WebP · up to 25 MB. Large photos are optimised automatically.')}</p>
          </div>
        </div>
      </MemberPanel>

      {/* Personal information */}
      <MemberPanel
        title={t('accountArea.profile.personalInfo', 'Personal information')}
        actions={!editingProfile ? (
          <Button variant="outline" size="sm" onClick={() => setEditingProfile(true)} className={cn(BTN_OUTLINE, 'gap-2')}>
            <Pencil className="h-4 w-4" aria-hidden="true" />
            {t('accountArea.profile.edit', 'Edit profile')}
          </Button>
        ) : (
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className={BTN_OUTLINE}
              onClick={() => {
                setEditingProfile(false);
                setProfileForm({ firstName: pFirst, lastName: pLast, jobTitle: pJob });
              }}
            >
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button size="sm" onClick={handleSaveProfile} disabled={savingProfile} className={cn(BTN, 'gap-2')}>
              {savingProfile ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
              {t('common.save', 'Save')}
            </Button>
          </div>
        )}
      >
        <div className="p-5">
          {editingProfile ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="edit-firstName">{t('accountArea.profile.firstName', 'First name')}</Label>
                <Input id="edit-firstName" value={profileForm.firstName} onChange={(e) => setProfileForm((prev) => ({ ...prev, firstName: e.target.value }))} placeholder={t('accountArea.profile.firstName', 'First name')} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-lastName">{t('accountArea.profile.lastName', 'Last name')}</Label>
                <Input id="edit-lastName" value={profileForm.lastName} onChange={(e) => setProfileForm((prev) => ({ ...prev, lastName: e.target.value }))} placeholder={t('accountArea.profile.lastName', 'Last name')} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-email">{emailLabel}</Label>
                <Input id="edit-email" value={user.email || ''} disabled className="bg-page" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-jobTitle">{t('accountArea.profile.jobTitle', 'Job title')}</Label>
                <Input id="edit-jobTitle" value={profileForm.jobTitle} onChange={(e) => setProfileForm((prev) => ({ ...prev, jobTitle: e.target.value }))} placeholder={t('accountArea.profile.jobTitle', 'Job title')} />
              </div>
            </div>
          ) : (
            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label={t('accountArea.profile.firstName', 'First name')}>{profile.first_name || '—'}</Field>
              <Field label={t('accountArea.profile.lastName', 'Last name')}>{profile.last_name || '—'}</Field>
              <Field label={emailLabel}>{user.email}</Field>
              {profile.job_title && <Field label={t('accountArea.profile.jobTitle', 'Job title')}>{profile.job_title}</Field>}
            </dl>
          )}
        </div>
      </MemberPanel>

      {/* Account details */}
      <MemberPanel title={t('accountArea.profile.accountDetails', 'Account details')}>
        <dl className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
          <Field label={t('accountArea.profile.persona', 'Profile type')}>{personaLabel || '—'}</Field>
          <Field label={t('accountArea.profile.status', 'Status')}>
            {access ? t(access.key, access.fallback) : humanize(profile.access_status)}
          </Field>
          {orgRole && <Field label={t('accountArea.profile.orgRole', 'Organisation role')}>{t(`org.${orgRole}`, humanize(orgRole))}</Field>}
          <Field label={t('accountArea.profile.registered', 'Member since')}>
            {formatDay(profile.created_at, locale, { year: 'numeric', month: 'long', day: 'numeric' })}
          </Field>
        </dl>
      </MemberPanel>

      {/* The organisation they act for (edited in its own block) */}
      {org && (
        <MemberPanel
          title={t('accountArea.profile.organization', 'Organisation')}
          actions={onOpenOrganization ? (
            <Button variant="outline" size="sm" className={cn(BTN_OUTLINE, 'gap-1.5')} onClick={onOpenOrganization}>
              {t('accountArea.profile.manageOrg', 'Manage organisation')}
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          ) : (
            <Link to={memberHomeHref('company')} className="inline-flex min-h-10 items-center gap-1 text-sm font-medium text-navy underline-offset-2 hover:underline">
              {t('accountArea.profile.manageOrg', 'Manage organisation')}
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          )}
        >
          <div className="space-y-4 p-5">
            <div className="flex items-center gap-3">
              <LogoBadge src={org.logo_url} name={org.name || '—'} size="lg" />
              <p className="font-semibold text-navy">{org.name || '—'}</p>
            </div>
            {(org.country || org.city || org.headquarters_country) && (
              <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                {org.country && <Field label={t('accountArea.profile.country', 'Country')}>{org.country}</Field>}
                {org.city && <Field label={t('accountArea.profile.city', 'City')}>{org.city}</Field>}
                {org.headquarters_country && <Field label={t('accountArea.profile.hqCountry', 'Headquarters country')}>{org.headquarters_country}</Field>}
              </dl>
            )}
            {org.description && (
              <div className="text-sm">
                <p className="mb-1 text-xs font-medium text-meta">{t('accountArea.profile.description', 'Description')}</p>
                <p className="text-ink">{org.description}</p>
              </div>
            )}
            {org.website && (
              <a href={externalUrl(org.website) ?? undefined} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 items-center gap-1.5 break-all text-sm text-navy hover:underline">
                <Globe className="h-4 w-4 shrink-0" aria-hidden="true" />
                {org.website}
              </a>
            )}
          </div>
        </MemberPanel>
      )}

      {/* Security */}
      <MemberPanel title={t('accountArea.profile.security', 'Security')}>
        <div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-start gap-2 text-sm text-meta">
            <KeyRound className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {t('memberHome.profile.securityHelp', "We'll email you a link to choose a new password.")}
          </p>
          <Button variant="outline" className={cn(BTN_OUTLINE, 'shrink-0 gap-2')} onClick={sendPasswordLink}>
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            {t('accountArea.profile.changePassword', 'Change password')}
          </Button>
        </div>
      </MemberPanel>
    </div>
  );
}
