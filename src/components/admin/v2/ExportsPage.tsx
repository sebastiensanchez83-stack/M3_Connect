import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Building2, CalendarDays, ClipboardList, Download, Info, ListChecks, MessageSquare, Send, ShieldAlert, Truck, Users,
  type LucideIcon,
} from 'lucide-react';
import { AdminPageHeader, AdminSectionLabel } from '@/components/admin/AdminUI';
import { ActionCue } from '@/components/home/dashboard/DashboardKit';

/**
 * Admin > Settings > Exports (admin refonte, wave 2, 21 Oct 2026): ONE place that lists the
 * downloads the admin ALREADY has, what each file holds, and a pill that opens the screen
 * where it is made. Nothing is downloaded from here and no new data leaves the site: every
 * file is still made on its own screen, with that screen's rights and filters (view
 * everywhere, act in one place).
 *
 * Left out on purpose: the SM26 attendee file of the Check-in screen (opening that screen
 * updates the SM26 badges, and the site monitor then reports the archive as changed), and
 * the e-catalogue / media-kit / architecture file bundles (pictures and documents, not lists).
 */

interface ExportItem {
  key: string;
  icon: LucideIcon;
  title: string;
  /** What the file holds, in plain words. */
  inside: string;
  /** How to get it once the screen is open: the button's words. */
  how: string;
  to: string;
  /** Where the pill leads ("Open Companies"). */
  cue: string;
}

function ExportCard({ item }: { item: ExportItem }) {
  const { t } = useTranslation();
  const Icon = item.icon;
  return (
    <li>
      <Link
        to={item.to}
        className="group flex h-full flex-col gap-3 rounded-card border border-rule bg-white p-4 transition-[box-shadow,border-color] duration-200 hover:border-navy/40 hover:shadow-hover focus:outline-none focus-visible:shadow-focus motion-reduce:transition-none sm:p-5"
      >
        <span className="flex items-start gap-4">
          <span aria-hidden="true" className="grid h-11 w-11 shrink-0 place-items-center rounded-[14px] bg-navy text-gold">
            <Icon className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[17px] font-semibold leading-6 text-navy [overflow-wrap:anywhere]">{item.title}</span>
            <span className="mt-1 block text-[14px] leading-5 text-ink [overflow-wrap:anywhere]">
              <span className="font-semibold text-navy">{t('adminExports.inside', 'Inside:')}</span> {item.inside}
            </span>
            <span className="mt-1 block text-[14px] leading-5 text-meta [overflow-wrap:anywhere]">
              <span className="font-semibold text-navy">{t('adminExports.how', 'How:')}</span> {item.how}
            </span>
          </span>
        </span>
        <span className="mt-auto flex pt-1 sm:pl-[60px]">
          <ActionCue size="sm">{item.cue}</ActionCue>
        </span>
      </Link>
    </li>
  );
}

function Group({ title, icon, items }: { title: string; icon: LucideIcon; items: ExportItem[] }) {
  return (
    <section>
      <AdminSectionLabel icon={icon}>{title}</AdminSectionLabel>
      <ul className="grid gap-3 md:grid-cols-2">
        {items.map((i) => <ExportCard key={i.key} item={i} />)}
      </ul>
    </section>
  );
}

export function ExportsPage() {
  const { t } = useTranslation();

  const members: ExportItem[] = [
    {
      key: 'companies', icon: Building2,
      title: t('adminExports.companies.title', 'Companies and individuals'),
      inside: t('adminExports.companies.inside', 'One line per company or individual: name, company or individual, type, status, sponsor plan, country, city, number of people, the person in charge and their e-mail, date added, and the link to its admin page.'),
      how: t('adminExports.companies.how', 'Filter the list if you want only part of it, then press "Download the list (CSV)" at the top.'),
      to: '/admin/companies', cue: t('adminExports.companies.cue', 'Open Companies'),
    },
    {
      key: 'accounts', icon: Users,
      title: t('adminExports.accounts.title', 'Accounts (people)'),
      inside: t('adminExports.accounts.inside', 'One line per account: name, e-mail, company, account type, status, sign-up step and the date the account was created.'),
      how: t('adminExports.accounts.how', 'Filter the list if you want only part of it, then press the Export button at the top.'),
      to: '/admin/users', cue: t('adminExports.accounts.cue', 'Open Accounts'),
    },
  ];

  const events: ExportItem[] = [
    {
      key: 'registrations', icon: CalendarDays,
      title: t('adminExports.registrations.title', 'Registrations to an event'),
      inside: t('adminExports.registrations.inside', 'One line per person registered: name, e-mail, company, job title, phone, country, status, date, attended or not, has an account, agreed to receive news by e-mail, where they came from, and their answers to the event\'s questions. On-site events add the participation type, payment and account set-up.'),
      how: t('adminExports.registrations.how', 'Open the event, go to its Registrations tab, then press "Export (CSV)".'),
      to: '/admin/events', cue: t('adminExports.registrations.cue', 'Open the events'),
    },
    {
      key: 'wys', icon: ClipboardList,
      title: t('adminExports.wys.title', 'WYS 2026 guest list'),
      inside: t('adminExports.wys.inside', 'One line per guest: status, how they came, name, e-mail, phone, company, job title, country, conference, gala, whose plus-one they are, checked in, and what they wrote when asking to come.'),
      how: t('adminExports.wys.how', 'Press "Export CSV" at the top of the guest list.'),
      to: '/admin/guest-list/wys26', cue: t('adminExports.wys.cue', 'Open the WYS guest list'),
    },
    {
      key: 'invitations', icon: Send,
      title: t('adminExports.invitations.title', 'Invitation campaigns: who said yes'),
      inside: t('adminExports.invitations.inside', 'One line per confirmed guest of a campaign: title, first name, surname, name on the ticket, job title, organisation, country, e-mail, phone, date of the answer, checked in.'),
      how: t('adminExports.invitations.how', 'Open the campaign, go to its Tracking tab, then press "Confirmed, CSV" or "Confirmed, Excel".'),
      to: '/admin/invitations', cue: t('adminExports.invitations.cue', 'Open the invitation campaigns'),
    },
  ];

  const sm26: ExportItem[] = [
    {
      key: 'sm26-logistics', icon: Truck,
      title: t('adminExports.sm26Logistics.title', 'SM26 logistics'),
      inside: t('adminExports.sm26Logistics.inside', 'One line per company at the Rendezvous: contact, e-mail, country, roles, coming on site, number of people, power, vehicle, brunch covers, items, items waiting for a decision, notes.'),
      how: t('adminExports.sm26Logistics.how', 'Press "CSV" at the top of the Logistics screen.'),
      to: '/admin/sm26/logistics', cue: t('adminExports.sm26Logistics.cue', 'Open SM26 Logistics'),
    },
    {
      key: 'sm26-feedback', icon: MessageSquare,
      title: t('adminExports.sm26Feedback.title', 'SM26 feedback'),
      inside: t('adminExports.sm26Feedback.inside', 'Two files. "Coming back": who wants to come next year, with company, e-mail, country, roles, paid, attended. "Collaborations": who declared a collaboration, what they wrote and whether it may be quoted.'),
      how: t('adminExports.sm26Feedback.how', 'Press "CSV" next to "Coming back" or "Collaborations declared".'),
      to: '/admin/sm26/feedback', cue: t('adminExports.sm26Feedback.cue', 'Open SM26 Feedback'),
    },
    {
      key: 'sm26-workshops', icon: ListChecks,
      title: t('adminExports.sm26Workshops.title', 'SM26 workshop lists'),
      inside: t('adminExports.sm26Workshops.inside', 'One line per booking: workshop, date, time, booked or waiting list, name, company, e-mail, roles, when they booked.'),
      how: t('adminExports.sm26Workshops.how', 'Press "Workshop lists (CSV)" on the Programme screen.'),
      to: '/admin/sm26/agenda', cue: t('adminExports.sm26Workshops.cue', 'Open SM26 Programme'),
    },
  ];

  return (
    <div>
      <AdminPageHeader
        title={t('adminExports.title', 'Exports')}
        description={t('adminExports.desc', 'Every list you can download from the admin, in one place. Each card says what the file holds; press it to open the screen where the file is made. Nothing is downloaded from this page.')}
      />

      <p className="mb-6 flex items-start gap-2.5 rounded-card border border-amber-200 bg-amber-50 px-4 py-3 text-[15px] leading-6 text-amber-900">
        <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        <span className="min-w-0">
          {t('adminExports.privacy', 'These files hold personal data (names, e-mails, phone numbers). Keep them on M3 computers, do not forward them outside M3, and delete them once you are done.')}
        </span>
      </p>

      <div className="space-y-8">
        <Group title={t('adminExports.group.members', 'Members')} icon={Users} items={members} />
        <Group title={t('adminExports.group.events', 'Events')} icon={CalendarDays} items={events} />
        <Group title={t('adminExports.group.sm26', 'SM26 archive')} icon={Download} items={sm26} />

        <section>
          <AdminSectionLabel icon={Info}>{t('adminExports.group.notHere', 'Not on this list')}</AdminSectionLabel>
          <ul className="space-y-3 rounded-card border border-rule bg-white p-4 text-[14px] leading-5 text-ink sm:p-5">
            <li>
              <span className="font-semibold text-navy">{t('adminExports.news.title', 'Newsletter subscribers.')}</span>{' '}
              {t('adminExports.news.body', 'There is no download in the admin: the list is kept in Mailchimp, export it from there. A person\'s consent shows on their page, and event registration files say who agreed to receive news by e-mail.')}
            </li>
            <li>
              <span className="font-semibold text-navy">{t('adminExports.badges.title', 'SM26 attendees for badge printing.')}</span>{' '}
              {t('adminExports.badges.body', 'Made on the SM26 Check-in screen. It is not linked here on purpose: opening that screen updates the SM26 badges.')}
            </li>
          </ul>
        </section>
      </div>
    </div>
  );
}

export default ExportsPage;
