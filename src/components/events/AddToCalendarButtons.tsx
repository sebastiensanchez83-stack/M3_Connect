import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { CalendarPlus, Download } from 'lucide-react';
import {
  cn,
  googleCalendarUrl,
  outlookCalendarUrl,
  downloadICS,
  type CalendarEventInput,
} from '@/lib/utils';

interface AddToCalendarButtonsProps {
  event: CalendarEventInput;
  className?: string;
  /** 'dark' on a navy panel (glass pills, white words); 'light' (default) on white and page backgrounds. */
  tone?: 'light' | 'dark';
}

/**
 * Three small buttons that let a user drop an event into their calendar:
 *  - Google Calendar (pre-filled web event)
 *  - Outlook / Office 365 (pre-filled web event)
 *  - .ics download (works with Apple Calendar and Outlook desktop)
 *
 * Renders nothing if the event has no start date.
 */
export function AddToCalendarButtons({ event, className = '', tone = 'light' }: AddToCalendarButtonsProps) {
  const { t } = useTranslation();
  if (!event.date_time) return null;

  // Pill buttons of the refonte; on navy they turn to glass with white words.
  const pill = cn(
    'justify-center rounded-pill',
    tone === 'dark'
      ? 'border-white/30 bg-white/10 text-white hover:border-white hover:bg-white hover:text-navy'
      : 'border-navy/25 bg-white text-navy hover:border-navy hover:bg-navy hover:text-white',
  );

  return (
    <div className={`grid grid-cols-1 sm:grid-cols-3 gap-2 ${className}`}>
      <Button variant="outline" size="sm" className={pill} asChild>
        <a href={googleCalendarUrl(event)} target="_blank" rel="noopener noreferrer">
          <CalendarPlus className="h-4 w-4 mr-1.5" />
          Google
        </a>
      </Button>
      <Button variant="outline" size="sm" className={pill} asChild>
        <a href={outlookCalendarUrl(event)} target="_blank" rel="noopener noreferrer">
          <CalendarPlus className="h-4 w-4 mr-1.5" />
          Outlook
        </a>
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={pill}
        onClick={() => downloadICS(event)}
      >
        <Download className="h-4 w-4 mr-1.5" />
        {t('eventsShared.addToCalendar.icsFile', '.ics file')}
      </Button>
    </div>
  );
}
