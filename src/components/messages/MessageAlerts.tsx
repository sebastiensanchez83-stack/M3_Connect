import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { MessageSquare, X } from 'lucide-react';
import { LogoTile } from '@/components/brand/OrgCard';
import { useReducedMotion } from '@/components/motion/useReducedMotion';
import { useAuth } from '@/contexts/AuthContext';
import { refreshInboxCount } from '@/hooks/useInboxCount';
import { supabase } from '@/lib/supabase';
import { displayCase } from '@/lib/displayCase';
import { cn } from '@/lib/utils';
import { fetchPeople } from '@/components/inbox/inboxActions';
import { myOrganizationIds } from '@/components/inbox/inboxCounts';
import {
  getActiveThread, requestOpenThread, useConversationScreenOpen, useLiveChannel, useLiveEvents, useOnLiveAgain,
  type LiveMessageRow, type LiveRequestRow,
} from './messageEvents';
import { loadConversations } from './messagesApi';

/**
 * The small alert in the bottom-left corner of every page (Victor, 10 Oct 2026: "a
 * small alert shows on any page when a message arrives"). Mounted ONCE, in App.tsx,
 * for signed-in verified members.
 *
 *   - A message from another company in one of my conversations, a first message
 *     sent to my company, or my company's message accepted: its sender's photo (or
 *     the company's logo), "Name (Company)", the first 80 characters, and "Reply"
 *     (or "Answer"), which opens it in Messages.
 *   - Never for the conversation open on screen, for my own messages or my
 *     colleagues', nor on the admin pages.
 *   - One alert at a time: what arrives while it shows is grouped into it ("3 new
 *     messages"). It goes away after 10 seconds (not while the pointer or the
 *     keyboard is on it), or with its cross. No sound; no movement when the
 *     system asks for less motion.
 *   - The navbar dot and the dashboard tile are read again at once (refreshInboxCount).
 *
 * Bottom LEFT: the help button and the system's toasts live on the right. On a phone
 * with a conversation open full screen, the alert shows at the top, clear of the
 * composer.
 */

type AlertKind = 'message' | 'request' | 'accepted';

interface AlertItem {
  key: string;
  requestId: string;
  kind: AlertKind;
  name: string;
  company: string;
  text: string;
  avatarUrl: string | null;
  logoUrl: string | null;
  orgType: string | null;
}

const SHOW_MS = 10_000;

function cut(text: string, max = 80): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

function fileText(raw: unknown, t: (k: string, d: string) => string): string {
  const list = Array.isArray(raw) ? raw as { mime?: string }[] : [];
  if (list.length === 0) return '';
  return list.every((a) => typeof a?.mime === 'string' && a.mime.startsWith('image/'))
    ? t('messages.alert.sentPhoto', 'Sent a photo')
    : t('messages.alert.sentFile', 'Sent a file');
}

export function MessageAlerts() {
  const { t } = useTranslation();
  const { user, organization } = useAuth();
  const uid = user?.id ?? null;
  const activeOrgId = organization?.id ?? null;
  const location = useLocation();
  const navigate = useNavigate();
  const reduced = useReducedMotion();
  const screenOpen = useConversationScreenOpen();
  const onAdmin = location.pathname.startsWith('/admin');

  useLiveChannel(uid);

  // The live channel came back after a break (Wi-Fi, a laptop asleep): what arrived
  // meanwhile was not seen live; the counts are read again at once.
  useOnLiveAgain(refreshInboxCount);

  // The companies I speak for: what is "mine" and what is "theirs".
  const [orgIds, setOrgIds] = useState<string[]>([]);
  useEffect(() => {
    if (!uid) return;
    let alive = true;
    void myOrganizationIds(uid).then((ids) => {
      if (alive) setOrgIds([...new Set([...ids, ...(activeOrgId ? [activeOrgId] : [])])]);
    }).catch(() => {});
    return () => { alive = false; };
  }, [uid, activeOrgId]);
  const orgsRef = useRef<string[]>([]);
  orgsRef.current = orgIds;

  const [items, setItems] = useState<AlertItem[]>([]);
  const [shown, setShown] = useState(false);
  const done = useRef(new Set<string>());
  const hold = useRef(false);
  const hideTimer = useRef<number | null>(null);
  const countTimer = useRef<number | null>(null);

  const clear = useCallback(() => {
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = null;
    setShown(false);
    setItems([]);
  }, []);

  const armHide = useCallback(() => {
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      // Kept while the pointer or the keyboard is on it, and while the tab is in the
      // background: the member sees it when they come back.
      if (hold.current || document.visibilityState !== 'visible') { armHide(); return; }
      clear();
    }, SHOW_MS);
  }, [clear]);

  useEffect(() => () => {
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    if (countTimer.current) window.clearTimeout(countTimer.current);
  }, []);

  // Never on the admin pages.
  useEffect(() => { if (onAdmin) clear(); }, [onAdmin, clear]);

  const push = useCallback((item: AlertItem) => {
    setItems((prev) => (prev.some((p) => p.key === item.key) ? prev : [...prev, item].slice(-30)));
    armHide();
    // A tick later, so it slides in (a timer, not an animation frame: those wait while the tab is hidden).
    window.setTimeout(() => setShown(true), 30);
  }, [armHide]);

  const countsSoon = () => {
    if (countTimer.current) window.clearTimeout(countTimer.current);
    countTimer.current = window.setTimeout(() => { countTimer.current = null; refreshInboxCount(); }, 500);
  };

  const once = (key: string) => {
    if (done.current.has(key)) return false;
    done.current.add(key);
    return true;
  };

  const describeMessage = async (r: LiveMessageRow): Promise<AlertItem | null> => {
    const [people, conv] = await Promise.all([
      r.author_user_id ? fetchPeople([r.author_user_id]) : Promise.resolve({} as Awaited<ReturnType<typeof fetchPeople>>),
      loadConversations(),
    ]);
    const c = conv.items.find((x) => x.id === r.partner_request_id);
    if (!c) return null;
    // Checked against the conversation itself (my companies may still be loading): only
    // the other company's messages make an alert, never my side's (a colleague's).
    if (r.author_org_id && ((c.myOrgId && r.author_org_id === c.myOrgId) || (c.otherOrg && r.author_org_id !== c.otherOrg.id))) return null;
    const person = r.author_user_id ? people[r.author_user_id] : undefined;
    const company = c.otherOrg ? displayCase(c.otherOrg.name) || c.otherOrg.name : '';
    return {
      key: `m:${r.id}`,
      requestId: r.partner_request_id,
      kind: 'message',
      name: person?.name || (c.lastAuthorName ? displayCase(c.lastAuthorName) : '') || c.otherPersonName || t('messages.aMember', 'A member'),
      company,
      text: cut((r.body || '').trim() || fileText(r.attachments, t)),
      avatarUrl: person?.avatar_url ?? null,
      logoUrl: c.otherOrg?.logo_url ?? null,
      orgType: c.otherOrg?.organization_type ?? null,
    };
  };

  const describeRequest = async (r: LiveRequestRow, kind: AlertKind): Promise<AlertItem> => {
    // A first message: who sent it. My message accepted: the company that accepted.
    const personId = kind === 'accepted' ? null : r.partner_user_id;
    const orgId = kind === 'accepted' ? r.marina_organization_id : r.partner_organization_id;
    const [people, org] = await Promise.all([
      personId ? fetchPeople([personId]) : Promise.resolve({} as Awaited<ReturnType<typeof fetchPeople>>),
      orgId
        ? supabase.from('organizations').select('name, logo_url, organization_type').eq('id', orgId).maybeSingle()
          .then(({ data }) => data as { name: string; logo_url: string | null; organization_type: string | null } | null)
        : Promise.resolve(null),
    ]);
    const person = personId ? people[personId] : undefined;
    const company = org?.name ? displayCase(org.name) || org.name : '';
    return {
      key: `${kind}:${r.id}`,
      requestId: r.id,
      kind,
      name: kind === 'accepted' ? company || t('messages.aCompany', 'A company') : person?.name || company || t('messages.aMember', 'A member'),
      company: kind === 'accepted' ? '' : company,
      text: kind === 'accepted'
        ? t('messages.alert.acceptedText', 'Accepted your message. You can now write to each other.')
        : cut(r.message || ''),
      avatarUrl: person?.avatar_url ?? null,
      logoUrl: org?.logo_url ?? null,
      orgType: org?.organization_type ?? null,
    };
  };

  useLiveEvents((e) => {
    if (!uid) return;
    const mine = new Set(orgsRef.current);
    const quiet = onAdmin;
    if (e.kind === 'message') {
      const r = e.row;
      // Mine, or a colleague's (our company's side): nothing to tell.
      if (r.author_user_id === uid || (r.author_org_id && mine.has(r.author_org_id)) || r.deleted_at) return;
      countsSoon();
      if (quiet || getActiveThread() === r.partner_request_id || !once(`m:${r.id}`)) return;
      void describeMessage(r).then((item) => { if (item) push(item); }).catch(() => {});
      return;
    }
    const r = e.row;
    const toMe = r.marina_organization_id ? mine.has(r.marina_organization_id) : r.marina_user_id === uid;
    const fromMe = r.partner_organization_id ? mine.has(r.partner_organization_id) : r.partner_user_id === uid;
    if (toMe && !fromMe) {
      // A first message to my company (waiting, or connected at once when the sectors
      // match), or a colleague's answer to one (the counts only).
      countsSoon();
      if (e.type !== 'INSERT' || quiet || getActiveThread() === r.id) return;
      if (r.status === 'pending' && once(`request:${r.id}`)) {
        void describeRequest(r, 'request').then(push).catch(() => {});
      } else if (r.status === 'accepted' && once(`message:${r.id}`)) {
        void describeRequest(r, 'message').then(push).catch(() => {});
      }
    } else if (fromMe && !toMe && e.type === 'UPDATE' && r.status === 'accepted') {
      // My company's first message was accepted: the conversation is open. Realtime
      // does not say what changed (the old row is not sent): only an answer of the
      // last minutes, not a later change to a conversation accepted long ago.
      const answered = r.answered_at ? new Date(r.answered_at).getTime() : NaN;
      if (!Number.isFinite(answered) || Math.abs(Date.now() - answered) > 10 * 60_000) return;
      countsSoon();
      if (quiet || !once(`accepted:${r.id}`)) return;
      void describeRequest(r, 'accepted').then(push).catch(() => {});
    }
  });

  if (!uid || onAdmin) return <div role="status" aria-live="polite" className="sr-only" />;

  const latest = items[items.length - 1] ?? null;
  const sameThread = items.length > 0 && items.every((i) => i.requestId === latest?.requestId);
  const onInboxPage = location.pathname === '/inbox';
  const openThread = (id: string) => {
    clear();
    // Messages already on screen opens it in place (a phone's open conversation is
    // swapped for this one); otherwise go to Messages with it.
    if (requestOpenThread(id)) return;
    navigate(onInboxPage ? `/inbox?thread=${id}` : `/?open=inbox&thread=${id}`);
  };
  const openInbox = () => {
    clear();
    navigate(onInboxPage ? '/inbox' : '/?open=inbox');
  };

  let body: ReactNode = null;
  if (latest) {
    const count = items.length;
    const action = sameThread
      ? latest.kind === 'request' ? t('messages.alert.answer', 'Answer') : t('messages.alert.reply', 'Reply')
      : t('messages.alert.open', 'Open messages');
    const title = sameThread
      ? latest.company && latest.kind !== 'accepted' ? `${latest.name} (${latest.company})` : latest.name
      : t('messages.alert.many', { count, defaultValue: '{{count}} new messages' });
    const companies = [...new Set(items.map((i) => (i.kind === 'accepted' ? i.name : i.company || i.name)))];
    const lead = sameThread
      ? count > 1
        ? t('messages.alert.manyHere', { count, defaultValue: '{{count}} new messages' })
        : latest.kind === 'request' ? t('messages.alert.wantsToConnect', 'Would like to connect with your company') : null
      : companies.length > 2
        ? t('messages.alert.fromMany', { a: companies[0], b: companies[1], count: companies.length - 2, defaultValue: 'From {{a}}, {{b}} and {{count}} more' })
        : t('messages.alert.fromTwo', { list: companies.join(t('messages.alert.and', ' and ')), defaultValue: 'From {{list}}' });
    body = (
      <div
        className={cn(
          'pointer-events-auto flex w-full gap-3 rounded-card border border-rule bg-white p-3 pr-2 shadow-drawer sm:w-[380px]',
          !reduced && 'transition-[opacity,transform] duration-300 ease-out-smc',
          shown ? 'translate-y-0 opacity-100' : reduced ? 'opacity-100' : cn('opacity-0', screenOpen ? '-translate-y-2' : 'translate-y-2'),
        )}
        onMouseEnter={() => { hold.current = true; }}
        onMouseLeave={() => { hold.current = false; }}
        onFocus={() => { hold.current = true; }}
        onBlur={() => { hold.current = false; }}
      >
        <span className="shrink-0">
          {sameThread && latest.avatarUrl
            ? <img src={latest.avatarUrl} alt="" className="h-11 w-11 rounded-pill object-cover ring-1 ring-rule" />
            : sameThread && (latest.logoUrl || latest.company || latest.kind === 'accepted')
              ? <LogoTile src={latest.logoUrl} name={latest.kind === 'accepted' ? latest.name : latest.company || latest.name} type={latest.orgType} size={44} />
              : <span aria-hidden="true" className="grid h-11 w-11 place-items-center rounded-pill bg-chip text-navy"><MessageSquare className="h-5 w-5" /></span>}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold leading-5 text-navy [overflow-wrap:anywhere]">{title}</p>
          {lead && <p className="mt-0.5 text-[13px] font-semibold leading-[18px] text-teal-text">{lead}</p>}
          {sameThread && latest.text && <p className="mt-0.5 line-clamp-2 text-[14px] leading-5 text-ink [overflow-wrap:anywhere]">{latest.text}</p>}
          <button
            type="button"
            onClick={() => (sameThread ? openThread(latest.requestId) : openInbox())}
            className="mt-2 inline-flex min-h-11 items-center rounded-pill bg-navy px-4 text-[14px] font-semibold text-white transition-colors hover:bg-navy/90 focus:outline-none focus-visible:shadow-focus"
          >
            {action}
          </button>
        </div>
        <button
          type="button"
          onClick={clear}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-pill text-meta transition-colors hover:bg-chip hover:text-navy focus:outline-none focus-visible:shadow-focus"
          aria-label={t('messages.alert.close', 'Close this alert')}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      data-help-avoid
      className={cn(
        'pointer-events-none fixed inset-x-3 z-[60] flex sm:inset-x-auto sm:left-6',
        // Under the conversation's header (its back arrow and Report stay free), clear of the composer.
        screenOpen ? 'top-[calc(env(safe-area-inset-top,0px)+68px)]' : 'bottom-3 sm:bottom-6',
      )}
    >
      {body}
    </div>
  );
}
