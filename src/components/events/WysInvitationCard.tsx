import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowRight, CalendarDays, Mail, MapPin } from 'lucide-react';
import { CoverImage } from '@/components/ui/CoverImage';
import { cn } from '@/lib/utils';

/**
 * The World Yachting Summit 2026 (Dubai, 27 November 2026, by invitation).
 *
 * It runs on the guest-list module (gl_*), not in the events table, so the
 * events page and the home page never list it on their own: without this card
 * they said "no upcoming event announced" right under a hero that names it.
 * Shown until the summit is over, and never next to an events row that
 * already carries it (an admin may add one later).
 *
 * /wys26 is printed and e-mailed: the card links to it, it never changes it.
 */
export const WYS26_PATH = '/wys26';
/** End of the summit day in Dubai (UTC+4): the card disappears after that. */
const WYS26_ENDS_AT = Date.parse('2026-11-28T00:00:00+04:00');

/** Whether the card should still show at `now` (ms). */
export function wys26Upcoming(now: number): boolean {
  return now < WYS26_ENDS_AT;
}

/** An events row that is the summit itself: the card then steps aside so it is not listed twice. */
export function isWys26Event(title: string | null | undefined): boolean {
  return !!title && /world yachting summit/i.test(title);
}

export function WysInvitationCard({ className, headingLevel = 'h3' }: { className?: string; headingLevel?: 'h2' | 'h3' }) {
  const { t } = useTranslation();
  const Heading = headingLevel;
  return (
    <article className={cn('group relative overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-gray-100 transition-shadow duration-300 hover:shadow-lg', className)}>
      <div className="grid sm:grid-cols-5">
        <CoverImage
          src={null}
          alt=""
          seed="wys26-dubai"
          icon={Mail}
          aspect="fill"
          tone="sea"
          className="h-28 sm:col-span-2 sm:h-auto sm:min-h-[12rem]"
        >
          <span className="absolute left-4 top-4 inline-flex items-center gap-1 rounded-full bg-secondary px-3 py-1 text-xs font-bold uppercase tracking-wide text-primary">
            <Mail className="h-3 w-3" aria-hidden="true" />
            {t('eventsPage.wys.badge', 'By invitation')}
          </span>
        </CoverImage>
        <div className="flex flex-col p-6 sm:col-span-3 lg:p-8">
          <Heading className="text-lg font-bold leading-tight text-gray-900 transition-colors group-hover:text-primary lg:text-xl">
            <Link
              to={WYS26_PATH}
              className='after:absolute after:inset-0 after:z-0 after:rounded-2xl after:content-[""] focus:outline-none focus-visible:after:ring-2 focus-visible:after:ring-primary focus-visible:after:ring-offset-2'
            >
              {t('eventsPage.wys.title', 'World Yachting Summit')}
            </Link>
          </Heading>
          <ul className="mt-3 space-y-1.5 text-sm text-gray-700">
            <li className="flex items-start gap-2">
              <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              <span>{t('eventsPage.wys.date', '27 November 2026')}</span>
            </li>
            <li className="flex items-start gap-2">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              <span>{t('eventsPage.wys.place', 'Dubai')}</span>
            </li>
          </ul>
          <p className="mt-3 text-sm leading-relaxed text-gray-600">
            {t('eventsPage.wys.body', 'A conference and a gala dinner organised by M3 Monaco, by invitation only.')}
          </p>
          <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-primary">
            {t('eventsPage.wys.cta', 'Request an invitation')}
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
          </span>
        </div>
      </div>
    </article>
  );
}
