import { supabase } from '@/lib/supabase';

// Human labels for the transactional-email kinds logged in sm_email_log.
export const SM26_EMAIL_KIND_LABEL: Record<string, string> = {
  registration_received: 'Registration received',
  info_requested: 'Info requested',
  attendees_requested: 'Attendee confirmation',
  confirmed: 'Confirmed',
  declined: 'Declined',
  paid: 'Payment received',
  payment_reminder: 'Payment reminder',
  invoice_available: 'Invoice available',
  ecat_review: 'E-catalogue ready to review',
  ecat_review_reminder: 'E-catalogue approval reminder',
  ecat_published: 'E-catalogue published',
  media_kit_ready: 'Media kit ready',
};

export interface LastEmail { kind: string; sent_at: string }

const fmt = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

// "Last emailed: E-catalogue approval reminder · 20 Jul 2026"
export function lastEmailText(e: LastEmail | null | undefined): string | null {
  if (!e) return null;
  return `Last emailed: ${SM26_EMAIL_KIND_LABEL[e.kind] || e.kind} · ${fmt(e.sent_at)}`;
}

// Latest email per registration for a set of registration ids (staff/YCM-gated via RLS).
export async function fetchLastEmails(registrationIds: string[]): Promise<Record<string, LastEmail>> {
  const ids = [...new Set(registrationIds)].filter(Boolean);
  if (!ids.length) return {};
  const { data } = await supabase
    .from('sm_email_log')
    .select('registration_id, kind, sent_at')
    .in('registration_id', ids)
    .order('sent_at', { ascending: false });
  const map: Record<string, LastEmail> = {};
  for (const r of (data || []) as { registration_id: string; kind: string; sent_at: string }[]) {
    if (!map[r.registration_id]) map[r.registration_id] = { kind: r.kind, sent_at: r.sent_at };
  }
  return map;
}
