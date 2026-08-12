import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { supabase } from '@/lib/supabase';
import { CheckCircle2, XCircle, Loader2, CalendarDays, Video } from 'lucide-react';
import { Button } from '@/components/ui/button';

// The startup half of SM26JuryRsvpPage. The token identifies one company on one
// session, so no login is needed — which matters because sm_registration.user_id
// is nullable and an imported startup may have no account at all.
//
// The question is NOT the jurors' question. A juror is asked whether the slot
// suits them and a "no" moves the slot; by the time a startup hears about it the
// panel is being assembled around that hour, so they are asked to acknowledge.
// A decline here is something for Yachting Ventures to pick up by hand, not a
// reason to reschedule — the wording says so, in both directions.

interface Payload {
  ok: boolean; error?: string; status?: string; company?: string; first_name?: string;
  session?: {
    title: string; slot_label: string | null; scheduled_at: string; duration_minutes: number;
    juror_count: number; startup_count: number; zoom_sent: boolean; zoom_join_url: string | null;
  };
  event?: { name: string; venue: string | null; start_date: string | null; end_date: string | null; timezone: string | null; edition_label: string | null };
}

const TZ = 'Europe/Monaco';
const fmtDay = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: TZ });
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ });
function tzLabel(iso: string) {
  const d = new Date(iso);
  const local = new Date(d.toLocaleString('en-US', { timeZone: TZ }));
  const utc = new Date(d.toLocaleString('en-US', { timeZone: 'UTC' }));
  return Math.round((local.getTime() - utc.getTime()) / 3600000) === 2 ? 'CEST' : 'CET';
}

const ERRORS: Record<string, string> = {
  missing_token: 'This link is incomplete. Please use the buttons in the email we sent you.',
  invalid_token: 'This link is no longer valid. It may have been replaced by a newer invitation.',
  cancelled: 'This jury session has been cancelled. Yachting Ventures will be in touch about a new slot.',
};

export function SM26StartupRsvpPage() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const answer = params.get('answer') || '';
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  const send = useCallback(async (ans: string | null) => {
    const { data: res, error } = await supabase.rpc('sm_startup_confirm_by_token', { p_token: token, p_answer: ans });
    if (error) return { ok: false, error: 'server_error' } as Payload;
    return (res || { ok: false, error: 'unknown' }) as Payload;
  }, [token]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!token) { setData({ ok: false, error: 'missing_token' }); setLoading(false); return; }
      const res = await send(answer === 'confirmed' || answer === 'declined' ? answer : null);
      if (!cancelled) { setData(res); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [token, answer, send]);

  const change = async (ans: string) => {
    setSaving(ans);
    const res = await send(ans);
    setSaving(null);
    setData(res);
  };

  const s = data?.session;
  const status = data?.status;

  return (
    <div className="min-h-[70vh] bg-gray-50 flex items-center justify-center px-4 py-12">
      <Helmet><title>Your pitch session — Smart Marina Rendezvous</title></Helmet>
      <div className="bg-white rounded-xl shadow-sm border max-w-lg w-full p-8">
        {loading && (
          <div className="text-center">
            <Loader2 className="h-10 w-10 text-primary animate-spin mx-auto mb-4" />
            <p className="text-sm text-gray-500">One moment…</p>
          </div>
        )}

        {!loading && data && !data.ok && (
          <div className="text-center">
            <XCircle className="h-12 w-12 text-gray-300 mx-auto mb-4" />
            <h1 className="text-xl font-semibold text-gray-900 mb-2">We couldn't record your answer</h1>
            <p className="text-sm text-gray-500">{ERRORS[data.error || ''] || 'Something went wrong. Please reply to the email and we will sort it out.'}</p>
          </div>
        )}

        {!loading && data?.ok && s && (
          <>
            <div className="text-center mb-6">
              {status === 'declined' ? (
                <><XCircle className="h-12 w-12 text-amber-500 mx-auto mb-4" />
                  <h1 className="text-2xl font-bold text-gray-900 mb-2">Thanks for telling us</h1>
                  <p className="text-sm text-gray-500">We've noted that {data.company} won't be pitching in this session. Yachting Ventures will contact you directly.</p></>
              ) : status === 'confirmed' ? (
                <><CheckCircle2 className="h-12 w-12 text-green-600 mx-auto mb-4" />
                  <h1 className="text-2xl font-bold text-gray-900 mb-2">You're confirmed</h1>
                  <p className="text-sm text-gray-500">{s.zoom_sent ? 'Your Zoom link is below and in your calendar.' : 'We will send you the Zoom invitation closer to the date.'}</p></>
              ) : (
                <><CalendarDays className="h-12 w-12 text-primary mx-auto mb-4" />
                  <h1 className="text-2xl font-bold text-gray-900 mb-2">Your pitch session</h1>
                  <p className="text-sm text-gray-500">Please confirm that {data.company} will be there.</p></>
              )}
            </div>

            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-1.5 text-sm">
              <div className="font-semibold text-gray-900">{fmtDay(s.scheduled_at)}</div>
              <div className="text-gray-700">
                {s.slot_label || `${fmtTime(s.scheduled_at)}–${fmtTime(new Date(new Date(s.scheduled_at).getTime() + s.duration_minutes * 60000).toISOString())} ${tzLabel(s.scheduled_at)}`}
                <span className="text-gray-400"> (Monaco time)</span>
              </div>
              <div className="text-gray-600">
                Pitching to {s.juror_count} jury member{s.juror_count === 1 ? '' : 's'}
                {s.startup_count > 1 ? ` · ${s.startup_count} companies in this session` : ''}
              </div>
              {data.event?.name && <div className="text-xs text-gray-400 pt-1">{data.event.name}{data.event.venue ? ` · ${data.event.venue}` : ''}</div>}
            </div>

            {s.zoom_sent && s.zoom_join_url && (
              <a href={s.zoom_join_url} target="_blank" rel="noreferrer"
                className="mt-4 flex items-center justify-center gap-2 rounded-lg bg-primary text-white py-2.5 text-sm font-medium hover:opacity-90">
                <Video className="h-4 w-4" /> Join the Zoom meeting
              </a>
            )}

            <div className="flex gap-2 mt-5">
              <Button variant={status === 'confirmed' ? 'default' : 'outline'} className="flex-1"
                disabled={!!saving} onClick={() => change('confirmed')}>
                {saving === 'confirmed' ? <Loader2 className="h-4 w-4 animate-spin" /> : "We'll be there"}
              </Button>
              <Button variant={status === 'declined' ? 'default' : 'outline'} className="flex-1"
                disabled={!!saving} onClick={() => change('declined')}>
                {saving === 'declined' ? <Loader2 className="h-4 w-4 animate-spin" /> : "We can't make it"}
              </Button>
            </div>
            <p className="text-xs text-gray-400 text-center mt-3">
              You can change your answer here at any time, or see everything in your <Link to="/sm26/me" className="text-primary">event space</Link>.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
