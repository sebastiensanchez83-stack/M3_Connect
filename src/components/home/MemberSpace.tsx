import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { LucideIcon } from 'lucide-react';
import {
  AlertCircle, ArrowRight, BookOpen, Building2, CalendarDays, Clock, Eye, Inbox, LayoutDashboard, Link2, Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CoverImage, LogoBadge } from '@/components/ui/CoverImage';
import { BathyPattern } from '@/components/motion/BathyPattern';
import { Reveal, RevealGroup } from '@/components/motion/Reveal';
import { accountHref } from '@/lib/accountNav';
import { boardMonth } from '@/lib/boardDate';

/**
 * The signed-in member's own band on the home page (moved here unchanged in
 * behaviour, restyled on the refonte tokens): the door to /dashboard with the
 * member's counters, then three feeds — my registrations, resources picked for
 * my sectors, events in my sectors. The homepage is where a returning member
 * lands after clicking the logo, and it must not be a dead end.
 */
export interface PersonalResource {
  id: string;
  title: string;
  summary: string | null;
  type: string;
  access_level: string;
  thumbnail_url: string | null;
}

export interface PersonalEvent {
  id: string;
  title: string;
  date_time: string;
  access_level: string;
}

export function MemberSpace({
  profileIncomplete, completeProfileHref, orgName, orgLogo, personalStats, accountLoaded, feedLoaded,
  myRegistrations, personalResources, personalEvents, lang,
}: {
  profileIncomplete: boolean;
  /** Where the amber banner leads: the sign-up form for a draft, the organization tab otherwise. */
  completeProfileHref: string;
  orgName: string | null;
  orgLogo: string | null;
  personalStats: { profileViews: number; connectionRequests: number; pendingItems: number } | null;
  /** Registrations and counters (need only the account). */
  accountLoaded: boolean;
  /** The sector feed (needs the profile; also true once auth settled without one). */
  feedLoaded: boolean;
  myRegistrations: { event_id: string; title: string; date_time: string }[];
  personalResources: PersonalResource[];
  personalEvents: PersonalEvent[];
  lang: string;
}) {
  const { t } = useTranslation();
  const shortcuts: { to: string; icon: LucideIcon; label: string }[] = [
    { to: accountHref('inbox'), icon: Inbox, label: t('accountNav.inbox', 'Inbox') },
    { to: accountHref('registrations'), icon: CalendarDays, label: t('accountNav.registrations', 'My events') },
    { to: accountHref('organization'), icon: Building2, label: t('accountNav.organization', 'Organisation & team') },
  ];
  const statTiles: { key: string; to: string; icon: LucideIcon; value: number | undefined; label: string }[] = [
    { key: 'views', to: accountHref('profile'), icon: Eye, value: personalStats?.profileViews, label: t('homeSections.personalStats.profileViews', 'Profile views') },
    { key: 'connections', to: accountHref('inbox'), icon: Link2, value: personalStats?.connectionRequests, label: t('homeSections.personalStats.connections', 'Connections') },
    { key: 'pending', to: accountHref('inbox'), icon: Inbox, value: personalStats?.pendingItems, label: t('homeSections.personalStats.pending', 'Pending requests') },
  ];

  return (
    <section aria-labelledby="home-member-heading" className="bg-page pb-16 md:pb-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <h2 id="home-member-heading" className="sr-only">{t('homeSections.memberEyebrow', 'Your space')}</h2>

        {/* Complete Profile Notification */}
        {profileIncomplete && (
          <div className="mb-6 flex flex-col gap-3 rounded-card bg-amber-50 p-4 text-amber-900 ring-1 ring-amber-200 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-start gap-3 text-sm font-medium">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" aria-hidden="true" />
              {t('home.completeOrgBanner', 'Complete your organisation profile to unlock all platform features.')}
            </p>
            <Button size="sm" variant="outline" className="min-h-10 shrink-0 border-amber-300 bg-white text-amber-900 hover:bg-amber-100" asChild>
              <Link to={completeProfileHref}>{t('homeSections.completeProfileCta', 'Complete my profile')}</Link>
            </Button>
          </div>
        )}

        {/* The door to the dashboard: the obvious next step for a member on / */}
        <Reveal className="relative isolate overflow-hidden rounded-card bg-navy text-white">
          <BathyPattern seed={3} className="absolute inset-0 -z-10" />
          <div className="relative grid gap-6 p-5 sm:p-6 lg:grid-cols-[1.2fr_1fr] lg:items-center lg:p-8">
            <div>
              <div className="flex items-center gap-3">
                {orgName ? (
                  <LogoBadge src={orgLogo} name={orgName} size="md" className="ring-2 ring-white/80" />
                ) : (
                  <span className="flex h-12 w-12 items-center justify-center rounded-field bg-white/15">
                    <LayoutDashboard className="h-6 w-6" aria-hidden="true" />
                  </span>
                )}
                <div className="min-w-0">
                  <p className="text-meta-caps !text-white/75">{t('homeSections.memberEyebrow', 'Your space')}</p>
                  {orgName && <p className="truncate text-sm text-white/90">{orgName}</p>}
                </div>
              </div>
              <h3 className="mt-4 text-h3 text-white">{t('homeSections.dashboardTitle', 'Your dashboard')}</h3>
              <p className="mt-1 max-w-xl text-sm text-white/85">
                {t('homeSections.dashboardBody', 'Requests to answer, your next events and open opportunities — all in one place.')}
              </p>
              <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
                <Button asChild variant="cta">
                  <Link to="/dashboard">
                    {t('homeSections.dashboardCta', 'Open my dashboard')}
                  </Link>
                </Button>
                <nav aria-label={t('homeSections.shortcuts', 'Shortcuts')} className="flex flex-wrap gap-2">
                  {shortcuts.map((s) => (
                    <Link
                      key={s.to}
                      to={s.to}
                      className="focus-ring inline-flex min-h-10 items-center gap-1.5 rounded-pill bg-white/10 px-3.5 text-sm font-medium text-white transition hover:bg-white/20"
                    >
                      <s.icon className="h-4 w-4" aria-hidden="true" />
                      {s.label}
                    </Link>
                  ))}
                </nav>
              </div>
            </div>

            <ul className="grid grid-cols-3 gap-2 sm:gap-3">
              {statTiles.map((tile) => (
                <li key={tile.key}>
                  <Link
                    to={tile.to}
                    className="focus-ring group flex h-full flex-col items-center justify-center rounded-field bg-white/10 px-2 py-4 text-center transition hover:bg-white/20"
                  >
                    <tile.icon className="h-5 w-5 text-[#9fd6df] transition-transform group-hover:scale-110" aria-hidden="true" />
                    {!accountLoaded && tile.value === undefined ? (
                      <span className="mt-2 block h-7 w-10 animate-pulse rounded bg-white/20" aria-hidden="true" />
                    ) : (
                      <span className="mt-2 font-signage text-[26px] font-semibold leading-none tabular sm:text-[30px]">{tile.value ?? 0}</span>
                    )}
                    <span className="mt-1 text-xs leading-tight text-white/85 sm:text-sm">{tile.label}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </Reveal>

        {/* Personalized Feed */}
        <RevealGroup className="mt-6 grid gap-5 md:grid-cols-3">
          <FeedCard
            icon={CalendarDays}
            title={t('homeSections.myRegistrations', 'My registrations')}
            link={{ to: accountHref('registrations'), label: t('homeSections.viewAllRegistrations', 'All my events') }}
          >
            {!accountLoaded ? <FeedSkeleton /> : myRegistrations.length === 0 ? (
              <FeedEmpty>{t('homeSections.noRegistrations', 'No event registrations yet.')}</FeedEmpty>
            ) : (
              <ul className="divide-y divide-rule">
                {myRegistrations.map((r) => (
                  <li key={r.event_id}>
                    <FeedEventRow to={`/events/${r.event_id}`} title={r.title} dateTime={r.date_time} lang={lang} />
                  </li>
                ))}
              </ul>
            )}
          </FeedCard>

          <FeedCard
            icon={Sparkles}
            title={t('homeSections.forYou', 'Picked for you')}
            link={{ to: '/resources', label: t('homeSections.resourcesLink', 'Browse the library') }}
          >
            {!feedLoaded ? <FeedSkeleton /> : personalResources.length === 0 ? (
              <FeedEmpty>{t('homeSections.noPersonalResources', 'Add your sectors to your organisation profile to get recommendations.')}</FeedEmpty>
            ) : (
              <ul className="divide-y divide-rule">
                {personalResources.slice(0, 4).map((r) => (
                  <li key={r.id}>
                    <Link to={`/resources/${r.id}`} className="focus-ring group flex items-center gap-3 rounded-field px-2 py-2.5 hover:bg-page">
                      <CoverImage
                        src={r.thumbnail_url}
                        alt=""
                        seed={r.id}
                        icon={BookOpen}
                        aspect="square"
                        className="w-12 shrink-0 rounded-field"
                      />
                      <span className="min-w-0">
                        <span className="block text-xs text-meta">{t(`resources.types.${r.type}`, r.type)}</span>
                        <span className="block truncate text-sm font-medium text-ink group-hover:text-navy">{r.title}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </FeedCard>

          <FeedCard
            icon={Clock}
            title={t('homeSections.eventsForYou', 'Events in your sectors')}
            link={{ to: '/events', label: t('homeSections.eventsLink', 'All events') }}
          >
            {!feedLoaded ? <FeedSkeleton /> : personalEvents.length === 0 ? (
              <FeedEmpty>{t('homeSections.noPersonalEvents', 'No upcoming events in your sectors.')}</FeedEmpty>
            ) : (
              <ul className="divide-y divide-rule">
                {personalEvents.map((e) => (
                  <li key={e.id}>
                    <FeedEventRow to={`/events/${e.id}`} title={e.title} dateTime={e.date_time} lang={lang} />
                  </li>
                ))}
              </ul>
            )}
          </FeedCard>
        </RevealGroup>
      </div>
    </section>
  );
}

function FeedCard({
  icon: Icon, title, link, children,
}: {
  icon: LucideIcon;
  title: string;
  link: { to: string; label: string };
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col overflow-hidden rounded-card border border-rule bg-white">
      <header className="flex items-center gap-2 border-b border-rule px-5 py-3.5">
        <Icon className="h-4 w-4 text-teal" aria-hidden="true" />
        <h3 className="text-sm font-semibold text-navy">{title}</h3>
      </header>
      <div className="flex-1 px-3 py-2">{children}</div>
      <footer className="border-t border-rule px-5 py-1.5">
        <Link
          to={link.to}
          className="focus-ring group inline-flex min-h-10 items-center gap-1 rounded-field text-sm font-medium text-navy underline-offset-4 hover:underline"
        >
          {link.label}
          <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-[3px]" aria-hidden="true" />
        </Link>
      </footer>
    </section>
  );
}

function FeedEventRow({ to, title, dateTime, lang }: { to: string; title: string; dateTime: string; lang: string }) {
  const d = new Date(dateTime);
  return (
    <Link to={to} className="focus-ring group flex items-center gap-3 rounded-field px-2 py-2.5 hover:bg-page">
      <span className="flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-field bg-chip text-center">
        <span className="text-sm font-semibold leading-none text-navy tabular">{d.getDate()}</span>
        {/* The board's own month abbreviations ("SEP"), as everywhere else on the home page. */}
        <span className="mt-0.5 font-signage text-[11px] font-semibold uppercase leading-none tracking-[0.06em] text-meta">{boardMonth(d.getMonth(), lang)}</span>
      </span>
      <span className="min-w-0 truncate text-sm font-medium text-ink group-hover:text-navy">{title}</span>
    </Link>
  );
}

function FeedEmpty({ children }: { children: React.ReactNode }) {
  return <p className="px-2 py-6 text-center text-sm text-meta">{children}</p>;
}

function FeedSkeleton() {
  return (
    <div className="space-y-1 py-1" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-3 px-2 py-2.5">
          <div className="h-11 w-11 animate-pulse rounded-field bg-chip" />
          <div className="h-3 flex-1 animate-pulse rounded bg-chip" />
        </div>
      ))}
    </div>
  );
}
