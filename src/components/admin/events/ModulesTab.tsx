import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Award, BadgeCheck, BookOpen, CalendarDays, Gavel, MessageSquare, QrCode, Users, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AdminStatusPill } from '../AdminUI';
import { Note } from './editorUi';

/**
 * Programme modules (spec §8.2): shown greyed out "After WYS". They come from the SM26
 * modules, un-pinned from sm26 in December (spec §2.4). The door check-in already works
 * for events of the new system (gl_checkin_v2): linked here once the event is saved.
 */
export function ModulesTab({ slug, hasConfirmed }: { slug: string | null; hasConfirmed: boolean }) {
  const { t } = useTranslation();
  const later: { icon: LucideIcon; title: string; body: string }[] = [
    { icon: BadgeCheck, title: t('adminEvents.mod.badges', 'Badges'), body: t('adminEvents.mod.badgesBody', 'Printed name badges with the person\'s QR code.') },
    { icon: CalendarDays, title: t('adminEvents.mod.agenda', 'Agenda'), body: t('adminEvents.mod.agendaBody', 'Sessions, speakers and rooms, on the event page and the app.') },
    { icon: Users, title: t('adminEvents.mod.networking', 'Networking'), body: t('adminEvents.mod.networkingBody', 'Meetings between participants and exhibitor table codes.') },
    { icon: BookOpen, title: t('adminEvents.mod.ecat', 'E-catalogue'), body: t('adminEvents.mod.ecatBody', 'The exhibitors and their products, online.') },
    { icon: Gavel, title: t('adminEvents.mod.jury', 'Jury'), body: t('adminEvents.mod.juryBody', 'Applications reviewed and scored by a jury.') },
    { icon: Award, title: t('adminEvents.mod.awards', 'Awards'), body: t('adminEvents.mod.awardsBody', 'Categories, finalists and the public vote.') },
    { icon: MessageSquare, title: t('adminEvents.mod.feedback', 'Feedback'), body: t('adminEvents.mod.feedbackBody', 'The survey sent to participants after the event.') },
  ];
  return (
    <div className="space-y-5">
      <Note>
        {t('adminEvents.mod.note', 'The programme tools of Smart Marina come to every on-site event after the World Yachting Summit. Until then they stay with Smart Marina 2026.')}
      </Note>

      <section className="rounded-card border border-rule bg-white p-5 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-foam text-navy" aria-hidden="true"><QrCode className="h-5 w-5" /></span>
            <div className="min-w-0">
              <h2 className="text-[17px] font-semibold leading-6 text-navy">{t('adminEvents.mod.door', 'Door check-in')}</h2>
              <p className="mt-1 text-[14px] leading-5 text-meta">
                {t('adminEvents.mod.doorBody', 'Scan the QR code of each confirmed person at the entrance, or find them by name. Works on any phone.')}
              </p>
            </div>
          </div>
          <AdminStatusPill tone="success" className="self-start">{t('adminEvents.mod.available', 'Available now')}</AdminStatusPill>
        </div>
        {slug ? (
          <Link
            to={`/admin/guest-list/${slug}/checkin`}
            className="mt-4 inline-flex min-h-11 items-center rounded-pill border border-navy/25 bg-white px-4 text-[14px] font-semibold text-navy hover:border-navy hover:bg-chip focus:outline-none focus-visible:shadow-focus"
          >
            {t('adminEvents.mod.openDoor', 'Open the door check-in')}
          </Link>
        ) : (
          <p className="mt-3 text-[13px] text-meta">{t('adminEvents.mod.doorSave', 'Available once the event is saved.')}</p>
        )}
        {slug && !hasConfirmed && (
          <p className="mt-2 text-[13px] leading-[18px] text-meta">{t('adminEvents.mod.doorEmpty', 'Nobody is confirmed yet: the page lists people once M3 confirms them.')}</p>
        )}
      </section>

      <ul className="grid gap-3 sm:grid-cols-2">
        {later.map((m) => (
          <li key={m.title} aria-disabled="true" className={cn('flex items-start gap-3 rounded-card border border-dashed border-rule bg-page p-4')}>
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white text-meta" aria-hidden="true"><m.icon className="h-4 w-4" /></span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[15px] font-semibold leading-5 text-meta">{m.title}</p>
                <AdminStatusPill>{t('adminEvents.mod.afterWys', 'After WYS')}</AdminStatusPill>
              </div>
              <p className="mt-1 text-[13px] leading-[18px] text-meta">{m.body}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
