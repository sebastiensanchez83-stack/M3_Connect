import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { MapPin, Radio } from 'lucide-react';
import { ActionCue } from '@/components/home/dashboard/DashboardKit';
import { AdminDetailHeader } from '../../AdminUI';

/**
 * /admin/events/new without a type: "Create an event", the one menu entry, asks which kind.
 * Both open the new event editor (?editor=new), as every "new event" button of the redesign.
 */
export function CreateEventChooser() {
  const { t } = useTranslation();
  const choices = [
    {
      to: '/admin/events/new?type=on_site&editor=new',
      icon: MapPin,
      title: t('adminEventsV2.create.onsite', 'An on-site event'),
      body: t('adminEventsV2.create.onsiteBody', 'A conference, a dinner, a visit: people register or are invited, M3 confirms them, and a QR code opens the door.'),
      cue: t('adminEventsV2.create.onsiteGo', 'Create an on-site event'),
    },
    {
      to: '/admin/events/new?type=webinar&editor=new',
      icon: Radio,
      title: t('adminEventsV2.create.webinar', 'A webinar'),
      body: t('adminEventsV2.create.webinarBody', 'Online: people register, receive the link and the reminders, and the replay afterwards.'),
      cue: t('adminEventsV2.create.webinarGo', 'Create a webinar'),
    },
  ];
  return (
    <div className="mx-auto max-w-3xl">
      <AdminDetailHeader
        back={{ to: '/admin/events', label: t('adminEventsV2.back', 'All events') }}
        title={t('adminEventsV2.create.title', 'Create an event')}
        subtitle={t('adminEventsV2.create.subtitle', 'Which kind of event? It starts as a draft: nobody sees it until it is published.')}
      />
      <ul className="grid gap-4 sm:grid-cols-2">
        {choices.map(c => (
          <li key={c.to}>
            <Link to={c.to} className="group flex h-full flex-col rounded-card border border-rule bg-white p-5 transition-[box-shadow,border-color] hover:border-navy/25 hover:shadow-hover focus:outline-none focus-visible:shadow-focus">
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-foam text-navy" aria-hidden="true"><c.icon className="h-5 w-5" /></span>
              <span className="mt-3 text-[17px] font-semibold leading-6 text-navy">{c.title}</span>
              <span className="mt-1 flex-1 text-[14px] leading-5 text-meta">{c.body}</span>
              <ActionCue className="mt-4 self-start">{c.cue}</ActionCue>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
