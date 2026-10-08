import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Seo } from '@/components/seo/Seo';
import { useSeoTr } from '@/components/seo/useSeoTr';
import { withSiteSuffix } from '@/lib/seoText';
import { ArrowRight, CalendarDays, CalendarRange, UserRound, Vote, MessageSquare, MapPin, LogIn, Loader2, QrCode, type LucideIcon } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { LoginForm } from '@/components/auth/LoginForm';
import { AuthDialog } from '@/components/auth/AuthDialog';
import { CardShell } from '@/components/brand/CardShell';
import { Eyebrow } from '@/components/brand/Eyebrow';
import { UnderlineLink } from '@/components/brand/UnderlineLink';
import { SM26_DATES, SM26_EDITION_OVER } from '@/components/sm26/sm26Edition';
import { cn } from '@/lib/utils';
import { SM26NetworkingPass } from '@/components/sm26/SM26NetworkingPass';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';

// The on-site page behind the QR code printed on every SM26 badge
// (smartmarinaconnect.com/sm26). The address is permanent — the content is not:
// grow this page freely, but never move it or put it behind a login, or every
// printed badge breaks. Public by design; signed-in extras are shown in place.
//
// Since the edition is over (SM26_EDITION_OVER) it reads as a light "thank you /
// archive" page under the site header: the programme, the feedback form while it is
// open, the participant's own record, and the next events. Same links as before.

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
  const cls = 'card-lift group has-ra flex w-full items-center gap-4 rounded-card border border-rule bg-white p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:p-5';
  const inner = (
    <>
      <span aria-hidden="true" className={cn('grid h-11 w-11 shrink-0 place-items-center rounded-field', highlight ? 'bg-navy text-white' : 'bg-chip text-navy')}>
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-card-title text-navy">
          <span className="card-ul">{title}</span>
          <ArrowRight className="card-arrow" strokeWidth={2.25} aria-hidden="true" />
        </span>
        <span className="mt-0.5 block text-sm leading-5 text-meta">{text}</span>
      </span>
    </>
  );
  return to ? <Link to={to} className={cls}>{inner}</Link> : <button type="button" onClick={onClick} className={cls}>{inner}</button>;
}

function SessionLine({ s }: { s: Timed }) {
  return (
    <li className="flex gap-3">
      <span className="w-24 shrink-0 text-sm font-semibold tabular-nums text-navy">{fmtTime(s.start)}–{fmtTime(s.end)}</span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-ink">{s.title}</span>
        {s.room && <span className="block text-[13px] text-meta">{s.room}</span>}
      </span>
    </li>
  );
}

export function SM26HubPage() {
  const { user } = useAuth();
  const seoTr = useSeoTr();
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

  // The audience vote needs no account: the tile shows for everyone while staff
  // have a prize open, checked every minute so it appears soon after opening.
  useEffect(() => {
    let alive = true;
    const check = async () => {
      const { data } = await supabase.rpc('sm_public_vote_status');
      const open = (data as { open?: string[] } | null)?.open;
      if (alive && Array.isArray(open)) setVoteOpen(open.length > 0);
    };
    check();
    const t = setInterval(check, 60_000);
    return () => { alive = false; clearInterval(t); };
  }, []);

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
  // The edition is over (SM26_EDITION_OVER): the page reads as its archive even when the
  // programme cannot be read (no sessions, a failed load), not as a page before the event.
  const isOver = phase === 'after' || (SM26_EDITION_OVER && phase === null);
  const current = timed.filter(s => s.start <= now && now < s.end);
  const nextStart = timed.find(s => s.start > now)?.start;
  const next = nextStart ? timed.filter(s => s.start.getTime() === nextStart.getTime()) : [];
  const nextIsOtherDay = !!nextStart && dayOf(nextStart) !== dayOf(now);
  const showFeedback = isOver || (phase === 'during' && !!lastEnd && dayOf(lastEnd) === dayOf(now));

  const needsAccount = (to: string) => (user ? { to } : { onClick: () => setLoginFor(to) });

  return (
    <div className="min-h-screen bg-page">
      {/* PRINTED on every SM26 badge (QR): the words may change, the URL never. Same words as the edge function's share preview. */}
      <Seo title={withSiteSuffix(seoTr('sm26.title'))} description={seoTr('sm26.description')} path="/sm26" />
      <section className="border-b border-rule bg-white">
        <div className="mx-auto max-w-3xl px-4 pb-10 pt-10 sm:px-6 md:pb-12 md:pt-14">
          <Eyebrow>{SM26_DATES} · Yacht Club de Monaco</Eyebrow>
          <h1 className="mt-4 text-h1-sm text-navy [text-wrap:balance] sm:text-h1">Monaco Smart &amp; Sustainable Marina Rendezvous</h1>
          <p className="mt-3 max-w-xl text-body text-meta md:text-body-lg">
            {SM26_EDITION_OVER
              ? `The 2026 edition took place on ${SM26_DATES} at the Yacht Club de Monaco. The programme and your participation stay here.`
              : 'Everything you need during the event, in one place.'}
          </p>
        </div>
      </section>

      <div className="mx-auto max-w-3xl space-y-4 px-4 py-8 sm:px-6 md:py-10">
        {sessions === null ? (
          <CardShell className="flex-row items-center gap-2 p-4 text-sm text-meta" as="div">
            <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> <span role="status">Loading the programme…</span>
          </CardShell>
        ) : phase === 'before' ? (
          <CardShell className="p-5 sm:p-6" as="div">
            <Eyebrow>Coming soon</Eyebrow>
            <p className="mt-3 text-h3 text-navy">The Rendezvous opens on {fmtDay(first.start)}.</p>
            <p className="mt-1 text-sm text-meta">Have a look at the programme and book your workshops below.</p>
          </CardShell>
        ) : phase === 'during' ? (
          <CardShell className="space-y-5 p-5 sm:p-6" as="div">
            {current.length > 0 && (
              <div>
                <p className="mb-2 flex items-center gap-2 text-[13px] font-semibold uppercase tracking-[0.08em] text-teal-text">
                  <span aria-hidden="true" className="h-2 w-2 rounded-full bg-teal motion-safe:animate-pulse" /> Happening now
                </p>
                <ul className="space-y-2">{current.map(s => <SessionLine key={s.id} s={s} />)}</ul>
              </div>
            )}
            {next.length > 0 && (
              <div>
                <p className="mb-2 text-[13px] font-semibold uppercase tracking-[0.08em] text-meta">
                  Next{nextIsOtherDay && nextStart ? ` · ${fmtDay(nextStart)}` : ''}
                </p>
                <ul className="space-y-2">{next.map(s => <SessionLine key={s.id} s={s} />)}</ul>
              </div>
            )}
          </CardShell>
        ) : isOver ? (
          <CardShell className="p-5 sm:p-6" as="div">
            <Eyebrow>Thank you</Eyebrow>
            <p className="mt-3 text-h3 text-navy">Thank you for joining us.</p>
            <p className="mt-1 text-[15px] leading-6 text-meta">We hope to see you at the next Rendezvous.</p>
          </CardShell>
        ) : null}

        <div className="space-y-3">
          {voteOpen && <Tile to="/sm26/vote" icon={Vote} title="Vote" text="Voting is open — choose your favourites" highlight />}
          {showFeedback && <Tile {...needsAccount('/sm26/feedback')} icon={MessageSquare} title="Your feedback" text="Tell us how it went — it shapes the next edition" highlight={isOver} />}
          <Tile to="/sm26/agenda" icon={CalendarDays} title="Programme" text={isOver ? 'The programme and the slides, kept as an archive' : 'The full programme, and the workshops to book'} />
          {!isOver && (
            <Tile onClick={() => setPassOpen(true)} icon={QrCode} title="Meet people"
              text="Your networking QR — or scan someone else's, or an exhibitor's table, to be introduced" />
          )}
          {user
            ? <Tile to="/sm26/me" icon={UserRound} title="My event" text="Your registration, your workshops and your connections" />
            : <Tile onClick={() => setLoginFor('/sm26/me')} icon={LogIn} title="My event" text="Sign in to see your registration, workshops and connections" />}
          {isOver && <Tile to="/events" icon={CalendarRange} title="What's next" text="Upcoming M3 events and webinars" />}
        </div>

        <CardShell className="p-5 sm:p-6" as="div">
          <div className="flex items-start gap-4">
            <span aria-hidden="true" className="grid h-11 w-11 shrink-0 place-items-center rounded-field bg-chip text-navy"><MapPin className="h-5 w-5" /></span>
            <div className="min-w-0">
              <p className="text-card-title text-navy">Yacht Club de Monaco</p>
              <p className="text-sm text-meta">Quai Louis II, 98000 Monaco</p>
              <div className="mt-2"><UnderlineLink href={MAPS_URL} external arrow={false} className="!text-sm">Open in Maps</UnderlineLink></div>
            </div>
          </div>
          <p className="mt-4 border-t border-rule pt-4 text-sm text-meta">
            {isOver
              ? <>A question about the event? <a href="mailto:events@m3monaco.com" className="font-semibold text-navy underline decoration-navy/30 underline-offset-4 hover:decoration-gold">events@m3monaco.com</a></>
              : 'A question on site? Ask the team at the welcome desk.'}
          </p>
        </CardShell>
      </div>

      <Dialog open={passOpen} onOpenChange={open => {
        setPassOpen(open);
        // Drop ?pass=1 so a reload or Back doesn't pop the QR open again.
        if (!open && new URLSearchParams(window.location.search).has('pass')) navigate({ search: '' }, { replace: true });
      }}>
        <DialogContent className="w-[calc(100%-2rem)] max-w-sm rounded-card sm:rounded-card">
          <DialogHeader>
            <DialogTitle className="text-h3 tracking-[-0.01em] text-navy">My networking QR</DialogTitle>
            <DialogDescription className="text-meta">Connect with people you meet — no business cards needed.</DialogDescription>
          </DialogHeader>
          {passOpen && <SM26NetworkingPass />}
        </DialogContent>
      </Dialog>

      <AuthDialog mode="login" open={!!loginFor} onOpenChange={open => { if (!open) setLoginFor(null); }} description="Use the email you registered for the event with.">
        <LoginForm onSuccess={() => { setGoAfterLogin(loginFor); setLoginFor(null); }} />
      </AuthDialog>
    </div>
  );
}
