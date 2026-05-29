import { Button } from '@/components/ui/button';
import { CalendarPlus, Download } from 'lucide-react';
import {
  googleCalendarUrl,
  outlookCalendarUrl,
  downloadICS,
  type CalendarEventInput,
} from '@/lib/utils';

interface AddToCalendarButtonsProps {
  event: CalendarEventInput;
  className?: string;
}

/**
 * Three small buttons that let a user drop an event into their calendar:
 *  - Google Calendar (pre-filled web event)
 *  - Outlook / Office 365 (pre-filled web event)
 *  - .ics download (works with Apple Calendar and Outlook desktop)
 *
 * Renders nothing if the event has no start date.
 */
export function AddToCalendarButtons({ event, className = '' }: AddToCalendarButtonsProps) {
  if (!event.date_time) return null;

  return (
    <div className={`grid grid-cols-1 sm:grid-cols-3 gap-2 ${className}`}>
      <Button variant="outline" size="sm" className="rounded-xl justify-center" asChild>
        <a href={googleCalendarUrl(event)} target="_blank" rel="noopener noreferrer">
          <CalendarPlus className="h-4 w-4 mr-1.5" />
          Google
        </a>
      </Button>
      <Button variant="outline" size="sm" className="rounded-xl justify-center" asChild>
        <a href={outlookCalendarUrl(event)} target="_blank" rel="noopener noreferrer">
          <CalendarPlus className="h-4 w-4 mr-1.5" />
          Outlook
        </a>
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="rounded-xl justify-center"
        onClick={() => downloadICS(event)}
      >
        <Download className="h-4 w-4 mr-1.5" />
        .ics file
      </Button>
    </div>
  );
}
