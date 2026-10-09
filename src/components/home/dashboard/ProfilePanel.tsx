import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import { avatarProblem, saveProfileFields, uploadAvatar } from '@/components/account/profileActions';
import { InfoList, InfoRow, NotFilled, useSavedFlash } from './EditKit';
import { EmailPrefsDialog, FieldsDialog, PasswordDialog, PictureDialog } from './fieldDialogs';

/**
 * My profile, as rows: photo, first name, last name, job title, e-mail
 * (read-only), password, e-mails received, and the account's state. Each
 * "Change" opens a small window with that one thing (ProfileEditor's writes,
 * through profileActions). `section=notifications` in the address (the old
 * /account?tab=notifications of every e-mail footer) opens the e-mails window.
 */

type Editing = 'photo' | 'first' | 'last' | 'job' | 'password' | 'emails' | null;

const PERSONA_LABEL: Record<string, string> = {
  marina: 'Marina or port',
  developer: 'Marina developer',
  partner: 'Service provider',
  media_partner: 'Media',
  investor: 'Investor',
  individual: 'Individual',
  moderator: 'Moderator',
  admin: 'Administrator',
};

export function ProfilePanel({ initialSection, onChanged }: { initialSection: string | null; onChanged: () => void }) {
  const { t, i18n } = useTranslation();
  const { user, profile, refreshProfile } = useAuth();
  const [editing, setEditing] = useState<Editing>(null);
  const [saved, flash] = useSavedFlash();
  const opened = useRef(false);

  // The old "Email notifications" address lands on its window, once.
  useEffect(() => {
    if (opened.current || initialSection !== 'notifications') return;
    opened.current = true;
    const id = window.setTimeout(() => setEditing('emails'), 400);
    return () => window.clearTimeout(id);
  }, [initialSection]);

  if (!user || !profile) return null;
  const uid = user.id;

  const after = (key: string) => async () => {
    flash(key);
    await refreshProfile();
    onChanged();
  };
  const close = (open: boolean) => { if (!open) setEditing(null); };

  const prefs = (profile.notification_prefs ?? {}) as Record<string, unknown>;
  const off = Object.values(prefs).filter((v) => v === false).length;
  const persona = PERSONA_LABEL[profile.persona as string];
  const status = profile.access_status === 'verified'
    ? t('dash.accountVerified', 'Approved by M3')
    : profile.access_status === 'pending'
      ? t('dash.accountPending', 'Waiting for M3 to approve it')
      : profile.access_status === 'rejected'
        ? t('dash.accountRejected', 'Not approved')
        : profile.access_status;
  const since = profile.created_at
    ? new Date(profile.created_at).toLocaleDateString(i18n.language === 'fr' ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
    : '';
  const initials = `${(profile.first_name?.[0] || '').toUpperCase()}${(profile.last_name?.[0] || '').toUpperCase()}` || (user.email?.[0] || '?').toUpperCase();

  return (
    <div className="space-y-4">
      <InfoList label={t('dash.tiles.profile', 'My profile')}>
        <InfoRow
          label={t('dash.photo', 'Photo')}
          value={profile.avatar_url ? (
            <img src={profile.avatar_url} alt={t('dash.yourPhoto', 'Your photo')} className="h-16 w-16 rounded-full object-cover ring-1 ring-rule" />
          ) : (
            <span className="flex items-center gap-3">
              <span aria-hidden="true" className="grid h-16 w-16 place-items-center rounded-full bg-chip text-[18px] font-semibold text-navy">{initials}</span>
              <NotFilled />
            </span>
          )}
          actionLabel={profile.avatar_url ? t('dash.change', 'Change') : t('dash.addPhoto', 'Add photo')}
          onAction={() => setEditing('photo')}
          saved={saved === 'photo'}
        />
        <InfoRow
          label={t('dash.firstName', 'First name')}
          value={profile.first_name || <NotFilled />}
          actionLabel={t('dash.change', 'Change')}
          onAction={() => setEditing('first')}
          saved={saved === 'first'}
        />
        <InfoRow
          label={t('dash.lastName', 'Last name')}
          value={profile.last_name || <NotFilled />}
          actionLabel={t('dash.change', 'Change')}
          onAction={() => setEditing('last')}
          saved={saved === 'last'}
        />
        <InfoRow
          label={t('dash.jobTitle', 'Job title')}
          value={profile.job_title || <NotFilled />}
          actionLabel={profile.job_title ? t('dash.change', 'Change') : t('dash.addJobTitle', 'Add job title')}
          onAction={() => setEditing('job')}
          saved={saved === 'job'}
        />
        <InfoRow
          label={t('dash.email', 'E-mail address')}
          value={<span className="break-all">{user.email}</span>}
          hint={t('dash.emailHint', 'You sign in with it. To change it, write to the M3 team.')}
        />
        <InfoRow
          label={t('dash.password', 'Password')}
          value={<span aria-label={t('dash.passwordSet', 'Set')}>••••••••</span>}
          actionLabel={t('dash.changePassword', 'Change password')}
          onAction={() => setEditing('password')}
        />
        <InfoRow
          label={t('dash.emailsRow', 'E-mails you receive')}
          value={off === 0
            ? t('dash.emailsAll', 'All of them')
            : t('dash.emailsOff', { count: off, defaultValue_one: 'All but {{count}} kind', defaultValue_other: 'All but {{count}} kinds' })}
          actionLabel={t('dash.change', 'Change')}
          onAction={() => setEditing('emails')}
          saved={saved === 'emails'}
        />
        <InfoRow
          label={t('dash.yourAccount', 'Your account')}
          value={[persona ? t(`dash.persona.${profile.persona}`, persona) : null, status].filter(Boolean).join(' · ')}
          hint={since ? t('dash.memberSince', { date: since, defaultValue: 'Member since {{date}}' }) : undefined}
        />
      </InfoList>

      <PictureDialog
        open={editing === 'photo'}
        onOpenChange={close}
        kind="avatar"
        title={profile.avatar_url ? t('dash.photoTitleChange', 'Change your photo') : t('dash.photoTitle', 'Add your photo')}
        description={t('dash.photoDesc', 'People you meet on the platform see it next to your name.')}
        current={profile.avatar_url}
        name={`${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim() || (user.email ?? '')}
        accept="image/*"
        check={avatarProblem}
        onUpload={async (file) => { await uploadAvatar(uid, file); }}
        savedMessage={t('dash.photoSaved', 'Your photo is updated.')}
        onSaved={after('photo')}
      />
      <FieldsDialog
        open={editing === 'first'}
        onOpenChange={close}
        title={t('dash.firstNameTitle', 'Change your first name')}
        fields={[{ key: 'v', label: t('dash.firstName', 'First name'), initial: profile.first_name ?? '', required: true, autoComplete: 'given-name' }]}
        onSave={(v) => saveProfileFields(uid, { first_name: v.v })}
        onSaved={after('first')}
      />
      <FieldsDialog
        open={editing === 'last'}
        onOpenChange={close}
        title={t('dash.lastNameTitle', 'Change your last name')}
        fields={[{ key: 'v', label: t('dash.lastName', 'Last name'), initial: profile.last_name ?? '', required: true, autoComplete: 'family-name' }]}
        onSave={(v) => saveProfileFields(uid, { last_name: v.v })}
        onSaved={after('last')}
      />
      <FieldsDialog
        open={editing === 'job'}
        onOpenChange={close}
        title={profile.job_title ? t('dash.jobTitleChange', 'Change your job title') : t('dash.jobTitleAdd', 'Add your job title')}
        description={t('dash.jobTitleDesc', 'For example "Harbour master" or "Sales director". It shows next to your name.')}
        fields={[{ key: 'v', label: t('dash.jobTitle', 'Job title'), initial: profile.job_title ?? '', autoComplete: 'organization-title' }]}
        onSave={(v) => saveProfileFields(uid, { job_title: v.v || null })}
        onSaved={after('job')}
      />
      <PasswordDialog open={editing === 'password'} onOpenChange={close} email={user.email} />
      <EmailPrefsDialog
        open={editing === 'emails'}
        onOpenChange={close}
        uid={uid}
        prefs={prefs}
        onSaved={after('emails')}
      />
    </div>
  );
}
