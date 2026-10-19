import { useTranslation } from 'react-i18next';
import { QrCode } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatInZone, type RegistrationMode } from './eventAdmin';
import type { IntroTemplate } from './editorModel';

/**
 * What a registrant receives, drawn in the look of the SMC e-mail layout v1 (navy band,
 * gold rule, white card, gold button). The wording mirrors the templates of the
 * `registration` and `registration-cron` functions; the staff member's own paragraph sits
 * right under the greeting. Approximate on purpose: the real e-mail adds the person's
 * details, their links and the QR code image. "Send a test to me" shows the real thing.
 */

export interface PreviewEvent {
  title: string;
  startIso: string | null;
  timezone: string;
  isFullDay: boolean;
  location: string;
  mode: RegistrationMode;
  practicalInfo: string;
  /** A participation type to show in the confirmation (the first one), if any. */
  ticketLabel: string | null;
}

const EM = { navy: '#0b2653', gold: '#d7a647', teal: '#1f7a8c', ink: '#1f2937', muted: '#5b6475', line: '#e3e7ee', page: '#eef2f8', soft: '#f6f7f9' };

interface Shape {
  subject: string;
  title: string;
  paragraphs: string[];
  rows?: [string, string][];
  qr?: boolean;
  note?: { label: string; text: string };
  after?: string[];
  cta: string;
}

/** The English text of each template (e-mails are English only), for an event. */
export function previewShape(template: IntroTemplate, ev: PreviewEvent): Shape {
  const title = ev.title.trim() || 'Your event';
  const when = ev.startIso ? formatInZone(ev.startIso, ev.timezone, !ev.isFullDay) : 'Date to be announced';
  const rows: [string, string][] = [['When', when]];
  if (ev.location.trim()) rows.push(['Where', ev.location.trim()]);
  const info = ev.practicalInfo.trim();
  const infoNote = info ? { label: 'Practical information', text: info } : undefined;
  switch (template) {
    case 'reg_received':
      return ev.mode === 'invitation'
        ? {
          subject: `Your request: ${title}`,
          title: 'Request received',
          paragraphs: [`Thank you for asking to attend ${title}. Attendance is by invitation.`, 'M3 reviews every registration. You will hear from us within 2 working days.', 'You can view or change your answers at any time from your registration page.'],
          cta: 'View my registration',
        }
        : {
          subject: `Registration received: ${title}`,
          title: 'Registration received',
          paragraphs: [`Thank you for registering for ${title}.`, 'M3 reviews every registration. You will hear from us within 2 working days.', 'You can view or change your answers at any time from your registration page.'],
          cta: 'View my registration',
        };
    case 'reg_confirmed':
      return {
        subject: `Your place is confirmed: ${title}`,
        title: 'Your place is confirmed',
        paragraphs: [`M3 has confirmed your place at ${title}.`],
        rows: ev.ticketLabel ? [...rows, ['Participation', ev.ticketLabel]] : rows,
        qr: true,
        note: infoNote,
        cta: 'View my registration',
      };
    case 'reg_waitlisted':
      return {
        subject: `You're on the waiting list: ${title}`,
        title: "You're on the waiting list",
        paragraphs: [`${title} is full at the moment, so you are on the waiting list.`, 'If a place opens up, we will e-mail you straight away. You do not need to do anything until then.'],
        cta: 'View my registration',
      };
    case 'reg_info_requested':
      return {
        subject: `We need a detail: ${title}`,
        title: 'We need a little more information',
        paragraphs: [`Thank you for registering for ${title}. Before M3 can confirm your place, we need a little more information.`],
        note: { label: 'Our question', text: 'The question you type when you press "Ask for more information".' },
        after: ['Please answer from your registration page. It only takes a minute.'],
        cta: 'Answer now',
      };
    case 'reg_not_accepted':
      return {
        subject: `About your registration: ${title}`,
        title: 'About your registration',
        paragraphs: [`Thank you for your interest in ${title}. Unfortunately we are not able to confirm your place for this event.`, 'We hope to welcome you at a future event.'],
        cta: 'See upcoming events',
      };
    case 'reg_invitation':
      return {
        subject: `You're invited: ${title}`,
        title: "You're invited",
        paragraphs: [`M3 would be delighted to welcome you at ${title}.`],
        rows,
        after: ['Please let us know whether you can come: it takes one click.'],
        cta: 'Reply to the invitation',
      };
    case 'reg_reminder':
    default:
      return {
        subject: `Coming up: ${title}`,
        title: 'Coming up soon',
        paragraphs: [`This is a reminder of ${title}.`],
        rows,
        qr: true,
        note: infoNote,
        cta: 'View my registration',
      };
  }
}

export function EmailPreview({ template, event, intro, className }: { template: IntroTemplate; event: PreviewEvent; intro: string; className?: string }) {
  const { t } = useTranslation();
  const s = previewShape(template, event);
  const p = (text: string, key: string | number) => (
    <p key={key} style={{ margin: '0 0 14px', fontSize: 15, lineHeight: '23px', color: EM.ink }} className="[overflow-wrap:anywhere]">{text}</p>
  );
  return (
    <figure className={cn('min-w-0', className)} aria-label={t('adminEvents.mail.previewLabel', 'Preview of the e-mail')}>
      <figcaption className="mb-2 min-w-0 rounded-field border border-rule bg-white px-3 py-2 text-[13px] leading-[18px]">
        <span className="text-meta">{t('adminEvents.mail.subject', 'Subject:')} </span>
        <span className="font-semibold text-navy [overflow-wrap:anywhere]">{s.subject}</span>
      </figcaption>
      <div style={{ background: EM.page, fontFamily: 'Arial, Helvetica, sans-serif' }} className="rounded-card p-3 sm:p-4">
        <div style={{ background: EM.navy, borderBottom: `4px solid ${EM.gold}` }} className="rounded-t-[10px] px-5 py-4">
          <span style={{ color: '#fff', fontWeight: 700, fontSize: 15 }}>Smart Marina Connect</span>
          <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12 }} className="ml-2">by M3 Monaco</span>
        </div>
        <div style={{ background: '#fff' }} className="rounded-b-[10px] px-5 py-5">
          <p style={{ margin: '0 0 6px', color: EM.teal, fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }} className="[overflow-wrap:anywhere]">
            {event.title.trim() || 'Your event'}
          </p>
          <p style={{ margin: '0 0 14px', color: EM.navy, fontSize: 21, lineHeight: '27px', fontWeight: 700 }}>{s.title}</p>
          {p('Hello Alex,', 'hello')}
          {intro.trim() && (
            <div className="relative -mx-2 mb-3.5 rounded-[6px] border border-dashed border-gold/70 bg-gold/10 px-2 pt-2">
              <span className="absolute -top-2.5 right-2 rounded-pill bg-gold px-2 text-[10px] font-semibold uppercase tracking-wide text-navy">
                {t('adminEvents.mail.yourText', 'Your text')}
              </span>
              {intro.trim().split(/\n{2,}/).map((para, i) => (
                <p key={i} style={{ margin: '0 0 10px', fontSize: 15, lineHeight: '23px', color: EM.ink }} className="whitespace-pre-line [overflow-wrap:anywhere]">{para}</p>
              ))}
            </div>
          )}
          {s.paragraphs.map((x, i) => p(x, i))}
          {s.rows && (
            <table style={{ width: '100%', borderCollapse: 'collapse', margin: '0 0 16px', fontSize: 14 }}>
              <tbody>
                {s.rows.map(([k, val]) => (
                  <tr key={k} style={{ borderTop: `1px solid ${EM.line}` }}>
                    <td style={{ padding: '8px 10px 8px 0', color: EM.muted, width: 100, verticalAlign: 'top' }}>{k}</td>
                    <td style={{ padding: '8px 0', color: EM.ink, fontWeight: 600 }} className="[overflow-wrap:anywhere]">{val}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {s.qr && (
            <div style={{ background: EM.soft, borderRadius: 12, padding: '16px 12px', margin: '0 0 16px', textAlign: 'center' }}>
              <QrCode className="mx-auto h-16 w-16 text-navy/70" aria-hidden="true" />
              <p style={{ margin: '8px 0 0', fontSize: 12, lineHeight: '17px', color: EM.muted }}>
                Show this QR code at the entrance. It is personal to you.
              </p>
            </div>
          )}
          {s.note && (
            <div style={{ borderLeft: `3px solid ${EM.gold}`, background: EM.soft, padding: '10px 12px', margin: '0 0 16px', borderRadius: 4 }}>
              <p style={{ margin: '0 0 4px', fontSize: 12, fontWeight: 700, color: EM.navy }}>{s.note.label}</p>
              <p style={{ margin: 0, fontSize: 14, lineHeight: '21px', color: EM.ink }} className="whitespace-pre-line [overflow-wrap:anywhere]">{s.note.text}</p>
            </div>
          )}
          {(s.after || []).map((x, i) => p(x, `a${i}`))}
          <span style={{ display: 'inline-block', background: EM.gold, color: EM.navy, fontWeight: 700, fontSize: 14, borderRadius: 999, padding: '10px 18px' }}>
            {s.cta}
          </span>
        </div>
      </div>
    </figure>
  );
}
