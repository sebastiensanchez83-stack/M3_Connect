import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LifeBuoy } from 'lucide-react';
import { CardShell } from '@/components/brand/CardShell';
import { CardLink } from '@/components/home/dashboard/DashboardKit';
import { ROW_FOCUS } from '@/components/member/MemberUI';
import { cn } from '@/lib/utils';
import { buildHelpSections, helpHref, PERSONA_SECTION, type HelpItem, type HelpSection } from './helpContent';

/**
 * "Need help?" at the end of the member's home dashboard (Victor, 10 Oct
 * 2026: the help centre must be more visible). Three questions people of the
 * reader's profile ask most, each opening its answer on /help, then "Open the
 * help centre" and "Write to the team". The same card grammar as the
 * dashboard's other cards ("Coming up", "Opportunities").
 */

/** The profile keys of the help centre, plus the fallback for a profile it has no section for. */
export type HelpProfile = 'marina' | 'service-provider' | 'investor' | 'developer' | 'media' | 'no-company' | 'member';

/**
 * The reader's profile, as the help centre names it: no company yet, else the
 * person's profile (persona), else their company's type (the same reading as
 * the "Your profile" mark of /help, with the company's type as a fallback).
 */
export function helpProfileOf(hasOrganization: boolean, persona?: string | null, orgType?: string | null): HelpProfile {
  if (!hasOrganization) return 'no-company';
  const key = PERSONA_SECTION[persona ?? ''] ?? PERSONA_SECTION[orgType ?? ''];
  return (key as HelpProfile | undefined) ?? 'member';
}

/** Three useful questions per profile (ids of helpContent.ts). */
export const PROFILE_QUESTIONS: Record<HelpProfile, string[]> = {
  marina: ['marina-publish', 'publishing-answers', 'company-invite'],
  'service-provider': ['provider-answer', 'provider-references', 'provider-visibility'],
  investor: ['investor-deal-flow', 'investor-thesis', 'messages-who'],
  developer: ['publishing-kinds', 'publishing-project', 'developer-or-marina'],
  media: ['media-press-room', 'media-accreditation', 'events-propose'],
  'no-company': ['no-company-add', 'no-company-can', 'verification-time'],
  member: ['account-dashboard', 'messages-who', 'company-edit'],
};

export function NeedHelpCard({ hasOrganization, persona, orgType }: { hasOrganization: boolean; persona?: string | null; orgType?: string | null }) {
  const { t } = useTranslation();
  const sections = useMemo(() => buildHelpSections(t), [t]);
  const profile = helpProfileOf(hasOrganization, persona, orgType);
  const questions = useMemo(() => {
    const byId = new Map<string, { item: HelpItem; section: HelpSection }>();
    sections.forEach((section) => section.items.forEach((item) => byId.set(item.id, { item, section })));
    return PROFILE_QUESTIONS[profile].map((id) => byId.get(id)).filter((x): x is { item: HelpItem; section: HelpSection } => !!x);
  }, [sections, profile]);

  return (
    <CardShell as="article" className="p-5 lg:grid lg:grid-cols-12 lg:gap-8">
      <div className="lg:col-span-4">
        <div className="flex items-start gap-4">
          <span aria-hidden="true" className="grid h-12 w-12 shrink-0 place-items-center rounded-field bg-foam text-teal-text">
            <LifeBuoy className="h-6 w-6" />
          </span>
          <div className="min-w-0">
            <h4 className="text-card-title text-navy">{t('dash.help.title', 'Need help?')}</h4>
            <p className="mt-1 text-[15px] leading-[22px] text-meta">
              {t('dash.help.body', 'Short answers in plain words, and a person at M3 if you are still stuck.')}
            </p>
          </div>
        </div>
        <div className="mt-3 hidden flex-col items-start gap-1 lg:flex">
          <CardLink to="/help">{t('dash.help.open', 'Open the help centre')}</CardLink>
          <CardLink to="/contact">{t('dash.help.write', 'Write to the team')}</CardLink>
        </div>
      </div>

      <div className="mt-4 lg:col-span-8 lg:mt-0">
        <p className="text-meta-caps">{t('dash.help.asked', 'Often asked')}</p>
        <ul className="mt-2 divide-y divide-rule border-y border-rule">
          {questions.map(({ item, section }) => {
            const Icon = section.icon;
            return (
              <li key={item.id}>
                <Link
                  to={helpHref(item.id)}
                  className={cn('group -mx-2 flex min-h-[52px] items-center gap-3 rounded-field px-2 py-2.5 text-left transition-colors hover:bg-page', ROW_FOCUS)}
                >
                  <span aria-hidden="true" className="grid h-8 w-8 shrink-0 place-items-center rounded-field bg-chip text-navy">
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1 text-[15px] font-semibold leading-5 text-navy [overflow-wrap:anywhere]">
                    <span className="card-ul">{item.q}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
        <div className="mt-3 flex flex-wrap items-center gap-x-6 lg:hidden">
          <CardLink to="/help">{t('dash.help.open', 'Open the help centre')}</CardLink>
          <CardLink to="/contact">{t('dash.help.write', 'Write to the team')}</CardLink>
        </div>
      </div>
    </CardShell>
  );
}
