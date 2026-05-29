import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(date: string, locale: string = 'en'): string {
  return new Date(date).toLocaleDateString(locale === 'fr' ? 'fr-FR' : 'en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

export function formatDateTime(date: string, locale: string = 'en'): string {
  return new Date(date).toLocaleDateString(locale === 'fr' ? 'fr-FR' : 'en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function isUpcoming(date: string): boolean {
  return new Date(date) > new Date()
}

/**
 * Shared shape for anything that needs to be added to a calendar.
 * Only `title` and `date_time` (ISO string) are required; everything else
 * is optional. `url` is the meeting / join link for webinars.
 */
export interface CalendarEventInput {
  title: string
  description?: string | null
  date_time: string
  end_date_time?: string | null
  location?: string | null
  url?: string | null
}

// Resolve start/end. When no end is provided we default to a 1-hour slot.
function resolveCalendarTimes(event: CalendarEventInput): { start: Date; end: Date } {
  const start = new Date(event.date_time)
  const end = event.end_date_time
    ? new Date(event.end_date_time)
    : new Date(start.getTime() + 60 * 60 * 1000)
  return { start, end }
}

// UTC compact form expected by .ics and Google Calendar: YYYYMMDDTHHMMSSZ
function toCalendarDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

// Compose a human-readable description that also surfaces the join link.
function buildCalendarDescription(event: CalendarEventInput): string {
  const parts: string[] = []
  if (event.description) parts.push(event.description)
  if (event.url) parts.push(`Join: ${event.url}`)
  return parts.join('\n\n')
}

export function generateICS(event: CalendarEventInput): string {
  const { start, end } = resolveCalendarTimes(event)
  // RFC 5545 text escaping: backslash, semicolon, comma, newline.
  const esc = (s: string) =>
    s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Smart Marina Connect//Events//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${Date.now()}@smartmarinaconnect.com`,
    `DTSTAMP:${toCalendarDate(new Date())}`,
    `DTSTART:${toCalendarDate(start)}`,
    `DTEND:${toCalendarDate(end)}`,
    `SUMMARY:${esc(event.title)}`,
    `DESCRIPTION:${esc(buildCalendarDescription(event))}`,
    `LOCATION:${esc(event.location || event.url || 'Online')}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n')
}

export function downloadICS(event: CalendarEventInput) {
  const ics = generateICS(event)
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' })
  const url = window.URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${event.title.replace(/[^a-zA-Z0-9]/g, '_')}.ics`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  window.URL.revokeObjectURL(url)
}

/** "Add to Google Calendar" pre-filled event URL. */
export function googleCalendarUrl(event: CalendarEventInput): string {
  const { start, end } = resolveCalendarTimes(event)
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title,
    dates: `${toCalendarDate(start)}/${toCalendarDate(end)}`,
    details: buildCalendarDescription(event),
    location: event.location || event.url || 'Online',
  })
  return `https://calendar.google.com/calendar/render?${params.toString()}`
}

/** "Add to Outlook / Office 365 Calendar" pre-filled event URL. */
export function outlookCalendarUrl(event: CalendarEventInput): string {
  const { start, end } = resolveCalendarTimes(event)
  const params = new URLSearchParams({
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: event.title,
    startdt: start.toISOString(),
    enddt: end.toISOString(),
    body: buildCalendarDescription(event),
    location: event.location || event.url || 'Online',
  })
  return `https://outlook.office.com/calendar/0/deeplink/compose?${params.toString()}`
}

export function exportToCSV(data: Record<string, unknown>[], filename: string) {
  if (data.length === 0) return

  const headers = Object.keys(data[0])
  const csvContent = [
    headers.join(','),
    ...data.map(row =>
      headers.map(header => {
        const value = row[header]
        if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
          return `"${value.replace(/"/g, '""')}"`
        }
        return value
      }).join(',')
    )
  ].join('\n')

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  const url = window.URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${filename}.csv`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  window.URL.revokeObjectURL(url)
}
