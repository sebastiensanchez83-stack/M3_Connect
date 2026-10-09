import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LucideIcon } from 'lucide-react';
import { ArrowRight, Check, CheckCircle2 } from 'lucide-react';
import { Eyebrow } from '@/components/brand/Eyebrow';
import { HelpTip } from '@/components/help/HelpTip';
import { RowSkeleton, ROW_FOCUS } from '@/components/member/MemberUI';
import { useAuth } from '@/contexts/AuthContext';
import { avatarProblem, saveProfileFields, uploadAvatar } from '@/components/account/profileActions';
import {
  imageProblem, saveOrgFields, uploadOrgBrandImage, COVER_ACCEPT, LOGO_ACCEPT,
} from '@/components/organization/orgActions';
import { cn } from '@/lib/utils';
import { FieldsDialog, PictureDialog, SectorsDialog } from './fieldDialogs';
import { ConnectionsDialog, JoinRequestsDialog } from './teamDialogs';

/**
 * "To do" (Victor, 9 Oct 2026: "when you click a to-do it should open exactly
 * what you have to do"): each item opens a small window with only that, the
 * logo upload, the job title, the requests with Accept / Decline. Once it is
 * done the item ticks itself off (a check that pops, or simply appears under
 * reduced motion) and leaves the list.
 *
 * The items are derived by the dashboard, as before (answers someone waits
 * for first, then what the company owner can complete, then the member's own
 * profile); this only shows them and their windows.
 */

export type TodoAction = 'connections' | 'join' | 'logo' | 'banner' | 'description' | 'sectors' | 'photo' | 'job';

export interface TodoItem {
  key: TodoAction;
  title: string;
  hint: string;
  icon: LucideIcon;
  /** Someone waits for an answer. */
  urgent: boolean;
}

type Phase = 'ticking' | 'leaving';

export function TodoList({
  items,
  loading,
  onChanged,
  onInboxChanged,
  compact = false,
}: {
  items: TodoItem[];
  /** In a narrow column (next to my next event): no "Do it now" words on large screens, the arrow only. */
  compact?: boolean;
  loading: boolean;
  /** Something was saved: the dashboard reads its summaries again. */
  onChanged: () => void;
  /** Requests were answered: the inbox count is asked again. */
  onInboxChanged: () => void;
}) {
  const { t } = useTranslation();
  const { user, profile, organization, refreshProfile } = useAuth();
  const [open, setOpen] = useState<TodoAction | null>(null);
  // Items ticked off: shown with their check for a moment, then gone.
  const [phase, setPhase] = useState<Partial<Record<TodoAction, Phase>>>({});
  const [snapshots, setSnapshots] = useState<Partial<Record<TodoAction, { item: TodoItem; index: number }>>>({});
  const [gone, setGone] = useState<Set<TodoAction>>(new Set());
  const [announce, setAnnounce] = useState('');
  const allAnswered = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach((id) => window.clearTimeout(id)), []);

  // An item that left the derived list may come back later for a new reason (a new request): it shows again.
  const derivedKeys = items.map((i) => i.key).join('|');
  useEffect(() => {
    setGone((prev) => {
      const next = new Set([...prev].filter((k) => items.some((i) => i.key === k)));
      return next.size === prev.size ? prev : next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [derivedKeys]);

  const tick = (key: TodoAction) => {
    const index = items.findIndex((i) => i.key === key);
    const item = items[index];
    if (!item) return;
    setSnapshots((s) => ({ ...s, [key]: { item, index } }));
    setPhase((p) => ({ ...p, [key]: 'ticking' }));
    setAnnounce(t('dash.todoDone', { task: item.title, defaultValue: 'Done: {{task}}' }));
    timers.current.push(window.setTimeout(() => setPhase((p) => ({ ...p, [key]: 'leaving' })), 1300));
    timers.current.push(window.setTimeout(() => {
      // The focus was on this item: keep it in the list's heading.
      const row = document.getElementById(`todo-${key}`);
      if (row && row.contains(document.activeElement)) headingRef.current?.focus({ preventScroll: true });
      setGone((g) => new Set(g).add(key));
      setPhase((p) => { const n = { ...p }; delete n[key]; return n; });
      setSnapshots((s) => { const n = { ...s }; delete n[key]; return n; });
    }, 1700));
  };

  const saved = (key: TodoAction) => () => {
    tick(key);
    void refreshProfile();
    onChanged();
  };

  // What shows: the derived items not gone, plus those ticking that the data no longer lists.
  const shown: TodoItem[] = items.filter((i) => !gone.has(i.key));
  for (const [key, snap] of Object.entries(snapshots) as [TodoAction, { item: TodoItem; index: number }][]) {
    if (!shown.some((i) => i.key === key)) shown.splice(Math.min(snap.index, shown.length), 0, snap.item);
  }

  const orgName = organization?.name ?? '';
  return (
    <section aria-labelledby="todo-title" className="card-shell relative flex h-full flex-col overflow-hidden rounded-card border border-rule bg-white text-ink">
      <header className="flex items-center justify-between gap-4 border-b border-rule px-5 py-4">
        <Eyebrow as="h3" className="min-w-0">
          <span id="todo-title" ref={headingRef} tabIndex={-1} className="focus:outline-none">{t('dash.todoTitle', 'To do')}</span>
        </Eyebrow>
        <HelpTip title={t('help.tips.todoTitle', 'What is in To do?')} more="account-dashboard" className="text-meta">
          {t('help.tips.todoWaits', 'First the messages and requests waiting for your answer, then what is missing on your company page and your profile. Press a line to deal with it.')}
        </HelpTip>
      </header>
      <p className="sr-only" role="status" aria-live="polite">{announce}</p>

      {loading ? (
        <RowSkeleton rows={2} />
      ) : shown.length === 0 && profile?.onboarding_status !== 'draft' ? (
        <div className="flex items-center gap-3 px-5 py-6 text-[16px] leading-6 text-meta">
          <CheckCircle2 className="h-6 w-6 shrink-0 text-teal" aria-hidden="true" />
          {t('dash.todoEmpty', 'Nothing to do right now. Well done!')}
        </div>
      ) : (
        <ul className="divide-y divide-rule">
          {shown.map((item) => {
            const p = phase[item.key];
            const Icon = item.icon;
            return (
              <li
                key={item.key}
                id={`todo-${item.key}`}
                className={cn('transition-opacity duration-300 motion-reduce:transition-none', p === 'leaving' && 'opacity-0')}
              >
                <button
                  type="button"
                  onClick={() => { if (!p) { allAnswered.current = false; setOpen(item.key); } }}
                  aria-disabled={!!p}
                  className={cn('group flex min-h-[72px] w-full items-center gap-4 px-5 py-3.5 text-left transition-colors hover:bg-page', ROW_FOCUS)}
                >
                  <span
                    className={cn(
                      'grid h-11 w-11 shrink-0 place-items-center rounded-full transition-colors duration-300',
                      p ? 'bg-teal text-white' : item.urgent ? 'bg-gold/25 text-navy' : 'bg-chip text-navy',
                    )}
                  >
                    {p ? (
                      <Check className="h-6 w-6 motion-safe:animate-in motion-safe:zoom-in-50 motion-safe:fade-in-0 motion-safe:duration-300" strokeWidth={3} aria-hidden="true" />
                    ) : (
                      <Icon className="h-5 w-5" aria-hidden="true" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={cn('block text-[16px] font-semibold leading-6 text-navy [overflow-wrap:anywhere]', p && 'text-meta line-through decoration-teal decoration-2')}>
                      <span className={p ? undefined : 'card-ul'}>{item.title}</span>
                    </span>
                    <span className="mt-0.5 block text-[14px] leading-5 text-meta">
                      {p ? t('dash.todoTicked', 'Done, thank you!') : item.hint}
                    </span>
                  </span>
                  {/* Phones: always a sign that the row opens something. The display
                      utilities sit on a wrapper: .card-arrow sets its own display and
                      comes later in the cascade, so it would beat them on the icon. */}
                  {!p && (
                    <span aria-hidden="true" className="flex shrink-0 sm:hidden">
                      <ArrowRight className="card-arrow !ml-0" strokeWidth={2.25} />
                    </span>
                  )}
                  {!p && compact && (
                    <span aria-hidden="true" className="hidden shrink-0 lg:flex">
                      <ArrowRight className="card-arrow !ml-0" strokeWidth={2.25} />
                    </span>
                  )}
                  {!p && (
                    <span className={cn('hidden shrink-0 items-center gap-1 text-[15px] font-semibold text-navy sm:inline-flex', compact && 'lg:hidden')}>
                      {t('dash.doItNow', 'Do it now')}
                      <ArrowRight className="card-arrow !ml-0" strokeWidth={2.25} aria-hidden="true" />
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {/* The small windows, one per kind of item. */}
      {user && profile && (
        <>
          <ConnectionsDialog
            open={open === 'connections'}
            onOpenChange={(o) => {
              if (o) return;
              setOpen(null);
              onInboxChanged();
              if (allAnswered.current) tick('connections');
            }}
            onAnswered={(remaining) => { allAnswered.current = remaining === 0; }}
          />
          <PictureDialog
            open={open === 'photo'}
            onOpenChange={(o) => { if (!o) setOpen(null); }}
            kind="avatar"
            title={t('dash.photoTitle', 'Add your photo')}
            description={t('dash.photoDesc', 'People you meet on the platform see it next to your name.')}
            current={profile.avatar_url}
            name={`${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim()}
            accept="image/*"
            check={avatarProblem}
            onUpload={async (file) => { await uploadAvatar(user.id, file); }}
            savedMessage={t('dash.photoSaved', 'Your photo is updated.')}
            onSaved={saved('photo')}
          />
          <FieldsDialog
            open={open === 'job'}
            onOpenChange={(o) => { if (!o) setOpen(null); }}
            title={t('dash.jobTitleAdd', 'Add your job title')}
            description={t('dash.jobTitleDesc', 'For example "Harbour master" or "Sales director". It shows next to your name.')}
            fields={[{ key: 'v', label: t('dash.jobTitle', 'Job title'), initial: profile.job_title ?? '', required: true, autoComplete: 'organization-title' }]}
            onSave={(v) => saveProfileFields(user.id, { job_title: v.v || null })}
            onSaved={saved('job')}
          />
          {organization && (
            <>
              <JoinRequestsDialog
                open={open === 'join'}
                onOpenChange={(o) => {
                  if (o) return;
                  setOpen(null);
                  onInboxChanged();
                  onChanged();
                  if (allAnswered.current) tick('join');
                }}
                org={organization}
                onAnswered={(remaining) => { allAnswered.current = remaining === 0; }}
              />
              <PictureDialog
                open={open === 'logo'}
                onOpenChange={(o) => { if (!o) setOpen(null); }}
                kind="logo"
                title={t('dash.logoTitle', 'Add your company logo')}
                description={t('dash.logoDesc', 'It shows on your company page, in the directory and next to your requests.')}
                current={null}
                name={orgName}
                accept={LOGO_ACCEPT}
                check={imageProblem}
                onUpload={async (file) => { await uploadOrgBrandImage(organization.id, 'logo', file); }}
                savedMessage={t('dash.logoSaved', 'Your logo is updated.')}
                onSaved={saved('logo')}
              />
              <PictureDialog
                open={open === 'banner'}
                onOpenChange={(o) => { if (!o) setOpen(null); }}
                kind="banner"
                title={t('dash.coverTitle', 'Add a cover photo')}
                description={t('dash.coverDesc', 'The wide picture at the top of your company page.')}
                current={null}
                name={orgName}
                accept={COVER_ACCEPT}
                check={imageProblem}
                onUpload={async (file) => { await uploadOrgBrandImage(organization.id, 'banner', file); }}
                savedMessage={t('dash.coverSaved', 'Your cover photo is updated.')}
                onSaved={saved('banner')}
              />
              <FieldsDialog
                open={open === 'description'}
                onOpenChange={(o) => { if (!o) setOpen(null); }}
                title={t('dash.descriptionTitle', 'Add a description')}
                description={t('dash.descriptionDesc', 'A few sentences about what your company does. It is the first thing people read on your page.')}
                fields={[{ key: 'v', label: t('dash.description', 'Description'), initial: '', multiline: true, required: true }]}
                onSave={(v) => saveOrgFields(organization.id, { description: v.v || null })}
                onSaved={saved('description')}
              />
              <SectorsDialog
                open={open === 'sectors'}
                onOpenChange={(o) => { if (!o) setOpen(null); }}
                orgId={organization.id}
                orgType={organization.organization_type}
                onSaved={saved('sectors')}
              />
            </>
          )}
        </>
      )}
    </section>
  );
}
