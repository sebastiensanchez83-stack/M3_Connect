import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { CalendarDays, UserRound, Vote, MessageSquare, MapPin, ChevronRight, LogIn, Loader2, QrCode, type LucideIcon } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { LoginForm } from '@/components/auth/LoginForm';
import { SM26NetworkingPass } from '@/components/sm26/SM26NetworkingPass';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';

// The on-site page behind the QR code printed on every SM26 badge
// (smartmarinaconnect.com/sm26). The address is permanent — the content is not:
// grow this page freely, but never move it or put it behind a login, or every
// printed badge breaks. Public by design; signed-in extras are shown in place.

const TZ = 'Europe/Monaco';
const MAPS_URL = 'https://www.google.com/maps/search/?api=1&query=Yacht+Club+de+Monaco';

interface Session { id: string; title: string; type: string; starts_at: string | null; ends_at: string | null; room: string | null }
interface Timed extends Session { start: Date; end: Date }

const fmtTime = (d: Date) => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
const fmtDay = (d: Date) => d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ });
const dayOf = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: TZ }); // YYYY-MM-DD, Monaco time

function Tile({ icon: Icon, title, text, to, onClick, highlight = false }: {
  icon: LucideIcon; title: string; text: string; to?: string; onClick?: () => void; highlight?: boolean;
}) {
  const cls = 'flex items-center gap-4 w-full text-left bg-white rounded-2xl border border-gray-200 p-4 hover:border-primary/40 hover:shadow-sm transition';
  const inner = (
    <>
      <span className={`h-11 w-11 rounded-xl flex items-center justify-center shrink-0 ${highlight ? 'bg-primary text-white' : 'bg-primary/10 text-primary'}`}>
        <Icon className="h-5 w-5" />
      </span>
      <span className="flex-1 min-w-0">
        <span className="block font-semibold text-gray-900">{title}</span>
        <span className="block text-sm text-gray-500">{text}</span>
      </span>
      <ChevronRight className="h-5 w-5 text-gray-300 shrink-0" />
    </>
  );
  return to ? <Link to={to} className={cls}>{inner}</Link> : <button type="button" onClick={onClick} className={cls}>{inner}</button>;
}

function SessionLine({ s }: { s: Timed }) {
  return (
    <li className="flex gap-3">
      <span className="text-sm font-semibold text-gray-900 w-24 shrink-0">{fmtTime(s.start)}–{fmtTime(s.end)}</span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-gray-900">{s.title}</span>
        {s.room && <span className="block text-xs text-gray-500">{s.room}</span>}
      </span>
    </li>
  );
}

export function SM26HubPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [eventId, setEventId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [voteOpen, setVoteOpen] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [loginFor, setLoginFor] = useState<string | null>(null);
  const [goAfterLogin, setGoAfterLogin] = useState<string | null>(null);
  // ?pass=1 opens the networking QR straight away (linked from the connect page).
  const [passOpen, setPassOpen] = useState(() => {
    try { return new URLSearchParams(window.location.search).get('pass') === '1'; } catch { return false; }
  });

  // Programme: on load, then quietly every 5 minutes so a time or room change
  // on the day reaches phones that keep the page open. Never back to a spinner,
  // and a failed refresh (venue Wi-Fi) keeps what is already on screen.
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const { data: ev } = await supabase.from('sm_event').select('id').eq('slug', 'sm26').maybeSingle();
      const eid = (ev as { id: string } | null)?.id ?? null;
      if (!alive) return;
      if (!eid) { setSessions(prev => prev ?? []); return; }
      setEventId(eid);
      const { data } = await supabase.rpc('sm_agenda', { p_event_id: eid });
      if (!alive) return;
      if (data) setSessions(data as Session[]);
      else setSessions(prev => prev ?? []);
    };
    load();
    const t = setInterval(load, 5 * 60_000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  // Voting needs an account (sm_vote_config is readable by signed-in users only),
  // so the tile appears for them, and only while a competition is open.
  // Keyed on the id so returning to the tab doesn't refetch.
  useEffect(() => {
    if (!user?.id || !eventId) { setVoteOpen(false); return; }
    let alive = true;
    const check = async () => {
      const { data } = await supabase.from('sm_vote_config').select('competition').eq('event_id', eventId).eq('is_open', true).limit(1);
      if (alive) setVoteOpen(!!data && data.length > 0);
    };
    check();
    const t = setInterval(check, 2 * 60_000);
    return () => { alive = false; clearInterval(t); };
  }, [user?.id, eventId]);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  // After signing in from a tile, continue to where they were going — but only
  // once the session is in context, or the protected page would bounce them.
  useEffect(() => {
    if (user?.id && goAfterLogin) { const to = goAfterLogin; setGoAfterLogin(null); navigate(to); }
  }, [user?.id, goAfterLogin, navigate]);

  const timed: Timed[] = (sessions ?? [])
    .filter(s => s.starts_at)
    .map(s => {
      const start = new Date(s.starts_at as string);
      return { ...s, start, end: s.ends_at ? new Date(s.ends_at) : new Date(start.getTime() + 3600_000) };
    })
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  const first = timed[0];
  const lastEnd = timed.reduce<Date | null>((m, s) => (!m || s.end > m ? s.end : m), null);
  const phase = !first || !lastEnd ? null : now < first.start ? 'before' : now > lastEnd ? 'after' : 'during';
  const current = timed.filter(s => s.start <= now && now < s.end);
  const nextStart = timed.find(s => s.start > now)?.start;
  const next = nextStart ? timed.filter(s => s.start.getTime() === nextStart.getTime()) : [];
  const nextIsOtherDay = !!nextStart && dayOf(nextStart) !== dayOf(now);
  const showFeedback = phase === 'after' || (phase === 'during' && !!lastEnd && dayOf(lastEnd) === dayOf(now));

  const needsAccount = (to: string) => (user ? { to } : { onClick: () => setLoginFor(to) });

  return (
    <div className="min-h-screen bg-gray-50">
      <Helmet><title>Event info — Smart &amp; Sustainable Marina Rendezvous 2026</title></Helmet>
      <section className="bg-gradient-to-br from-[#0b2653] to-[#143a6b] text-white">
        <div className="container mx-auto px-4 py-10 max-w-3xl">
          <p className="uppercase tracking-wide text-white/60 text-sm mb-2">SM26 · 20–21 September 2026 · Yacht Club de Monaco</p>
          <h1 className="text-3xl lg:text-4xl font-bold">Smart &amp; Sustainable Marina Rendezvous</h1>
          <p className="text-white/80 mt-2">Everything you need during the event, in one place.</p>
        </div>
      </section>

      <div className="container mx-auto px-4 py-6 max-w-3xl space-y-4">
        {sessions === null ? (
          <div className="bg-white rounded-2xl border border-gray-200 p-4 flex items-center gap-2 text-sm text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading the programme…
          </div>
        ) : phase === 'before' ? (
          <div className="bg-white rounded-2xl border border-gray-200 p-5">
            <p className="text-xs uppercase tracking-wide text-gray-500 mb-1">Coming soon</p>
            <p className="text-lg font-semibold text-gray-900">The Rendezvous opens on {fmtDay(first.start)}.</p>
            <p className="text-sm text-gray-500 mt-1">Have a look at the programme and book your workshops below.</p>
          </div>
        ) : phase === 'during' ? (
          <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-4">
            {current.length > 0 && (
              <div>
                <p className="flex items-center gap-2 text-xs uppercase tracking-wide text-emerald-700 font-semibold mb-2">
                  <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" /> Happening now
                </p>
                <ul className="space-y-2">{current.map(s => <SessionLine key={s.id} s={s} />)}</ul>
              </div>
            )}
            {next.length > 0 && (
              <div>
                <p className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-2">
                  Next{nextIsOtherDay && nextStart ? ` · ${fmtDay(nextStart)}` : ''}
                </p>
                <ul className="space-y-2">{next.map(s => <SessionLine key={s.id} s={s} />)}</ul>
              </div>
            )}
          </div>
        ) : phase === 'after' ? (
          <div className="bg-white rounded-2xl border border-gray-200 p-5">
            <p className="text-lg font-semibold text-gray-900">Thank you for joining us.</p>
            <p className="text-sm text-gray-500 mt-1">We hope to see you at the next Rendezvous.</p>
          </div>
        ) : null}

        <div className="space-y-3">
          {voteOpen && <Tile to="/sm26/vote" icon={Vote} title="Vote" text="Voting is open — choose your favourites" highlight />}
          {showFeedback && <Tile {...needsAccount('/sm26/feedback')} icon={MessageSquare} title="Your feedback" text="Tell us how it went — it shapes the next edition" highlight={phase === 'after'} />}
          <Tile to="/sm26/agenda" icon={CalendarDays} title="Programme" text="The full programme, and the workshops to book" />
          {phase !== 'after' && (
            <Tile onClick={() => setPassOpen(true)} icon={QrCode} title="Meet people"
              text="Your networking QR — or scan someone else's, or an exhibitor's table, to be introduced" />
          )}
          {user
            ? <Tile to="/sm26/me" icon={UserRound} title="My event" text="Your registration, your workshops and your connections" />
            : <Tile onClick={() => setLoginFor('/sm26/me')} icon={LogIn} title="My event" text="Sign in to see your registration, workshops and connections" />}
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 p-5">
          <div className="flex items-start gap-4">
            <span className="h-11 w-11 rounded-xl flex items-center justify-center shrink-0 bg-primary/10 text-primary"><MapPin className="h-5 w-5" /></span>
            <div className="min-w-0">
              <p className="font-semibold text-gray-900">Yacht Club de Monaco</p>
              <p className="text-sm text-gray-500">Quai Louis II, 98000 Monaco</p>
              <a href={MAPS_URL} target="_blank" rel="noopener noreferrer" className="inline-block mt-2 text-sm font-medium text-primary hover:underline">Open in Maps</a>
            </div>
          </div>
          <p className="text-sm text-gray-500 mt-4 pt-4 border-t border-gray-100">A question on site? Ask the team at the welcome desk.</p>
        </div>
      </div>

      <Dialog open={passOpen} onOpenChange={open => {
        setPassOpen(open);
        // Drop ?pass=1 so a reload or Back doesn't pop the QR open again.
        if (!open && new URLSearchParams(window.location.search).has('pass')) navigate({ search: '' }, { replace: true });
      }}>
        <DialogContent className="rounded-2xl max-w-sm">
          <DialogHeader>
            <DialogTitle>My networking QR</DialogTitle>
            <DialogDescription>Connect with people you meet — no business cards needed.</DialogDescription>
          </DialogHeader>
          {passOpen && <SM26NetworkingPass />}
        </DialogContent>
      </Dialog>

      <Dialog open={!!loginFor} onOpenChange={open => { if (!open) setLoginFor(null); }}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle>Sign in</DialogTitle>
            <DialogDescription>Use the email you registered for the event with.</DialogDescription>
          </DialogHeader>
          <LoginForm onSuccess={() => { setGoAfterLogin(loginFor); setLoginFor(null); }} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
