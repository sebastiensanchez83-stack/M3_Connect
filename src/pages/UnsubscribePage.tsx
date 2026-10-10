import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertCircle, CheckCircle2, Info, Loader2, MailX, type LucideIcon } from 'lucide-react';
import { Seo } from '@/components/seo/Seo';
import { Button } from '@/components/ui/button';
import { CardShell } from '@/components/brand/CardShell';
import { Eyebrow } from '@/components/brand/Eyebrow';
import { UnderlineLink } from '@/components/brand/UnderlineLink';
import i18n from '@/i18n';
import { cn } from '@/lib/utils';
import { CTA_WRAP } from '@/components/auth/fields';

/**
 * /unsubscribe: where the "Unsubscribe" link of every notification e-mail lands
 * (send-notification, ?t=<signed token>). No sign-in: the token says which account
 * and which kind of e-mail; the "unsubscribe" edge function checks it and changes
 * profiles.notification_prefs, the same switches as the account's Notifications tab.
 *
 * Opening the page changes nothing (mail filters open links before people do): it
 * reads the state with a GET, and only a button press sends the POST.
 *
 * Without a token, or with the old /unsubscribe?email=… links (no proof of who is
 * asking, so they can change nothing), it explains and offers the preferences page
 * after signing in. The Mailchimp newsletter has its own unsubscribe link.
 */

const FN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/unsubscribe`;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const PREFERENCES_PATH = '/account?tab=notifications';

interface OptionalCategory {
  key: string;
  label: string;
  subscribed: boolean;
}

interface LinkState {
  email: string;
  category: string;
  category_label: string;
  category_optional: boolean;
  subscribed: boolean;
  optional: OptionalCategory[];
}

type Scope = 'category' | 'all';

type View =
  | { kind: 'loading' }
  | { kind: 'noToken'; legacy: boolean }
  | { kind: 'invalid' }
  | { kind: 'notFound' }
  | { kind: 'error' }
  | { kind: 'ready'; link: LinkState }
  | { kind: 'done'; link: LinkState; scope: Scope; resubscribed: boolean };

async function callFunction(method: 'GET' | 'POST', token: string, body?: Record<string, unknown>): Promise<{ status: number; data: Record<string, unknown> | null }> {
  const res = await fetch(method === 'GET' ? `${FN_URL}?t=${encodeURIComponent(token)}` : FN_URL, {
    method,
    headers: {
      Accept: 'application/json',
      apikey: ANON_KEY,
      Authorization: `Bearer ${ANON_KEY}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  return { status: res.status, data };
}

/**
 * The b2b e-mails are now the Friday summary of messages from companies (and the
 * e-mail when a company accepts yours): called by the name the account's
 * preferences give them, whatever the unsubscribe function still calls them.
 */
const b2bLabel = () => i18n.t('unsubscribe.label.b2b', 'Messages from companies');

function asLinkState(data: Record<string, unknown> | null): LinkState | null {
  if (!data || data.ok !== true || typeof data.category !== 'string') return null;
  return {
    email: typeof data.email === 'string' ? data.email : '',
    category: data.category,
    category_label: data.category === 'b2b' ? b2bLabel() : typeof data.category_label === 'string' ? data.category_label : '',
    category_optional: data.category_optional === true,
    subscribed: data.subscribed === true,
    optional: Array.isArray(data.optional)
      ? (data.optional as OptionalCategory[]).map((o) => (o && o.key === 'b2b' ? { ...o, label: b2bLabel() } : o))
      : [],
  };
}

export function UnsubscribePage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const token = params.get('t') || '';
  const legacy = !token && params.has('email');
  const [view, setView] = useState<View>(token ? { kind: 'loading' } : { kind: 'noToken', legacy });
  const [busy, setBusy] = useState<null | Scope>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // The old links carried the address itself: take it out of the address bar and history.
  useEffect(() => {
    if (!params.has('email')) return;
    const next = new URLSearchParams(params);
    next.delete('email');
    setParams(next, { replace: true });
  }, [params, setParams]);

  // What one kind of e-mail is called in a sentence ("Unsubscribe from <x> e-mails").
  const noun = (key: string, fallback: string): string => {
    switch (key) {
      case 'b2b': return t('unsubscribe.noun.companyMessages', 'company message');
      case 'submissions': return t('unsubscribe.noun.submissions', 'submission update');
      case 'recommendations': return t('unsubscribe.noun.recommendations', 'recommendation');
      case 'events': return t('unsubscribe.noun.events', 'event');
      case 'team': return t('unsubscribe.noun.team', 'team and invitation');
      case 'marketing': return t('unsubscribe.noun.marketing', 'welcome and onboarding');
      default: return fallback;
    }
  };

  // The sentence for an e-mail that is always sent (its kind cannot be switched off from a link).
  const serviceNote = (key: string): string => {
    if (key === 'account') return t('unsubscribe.service.account', 'This link came with an e-mail about your account (approval, organisation codes). Those messages are always sent.');
    if (key === 'payments') return t('unsubscribe.service.payments', 'This link came with an e-mail about a payment or an invoice. Those messages are always sent.');
    return t('unsubscribe.service.other', 'This link came with a service message. Those are always sent.');
  };

  const load = useCallback(async () => {
    if (!token) return;
    setView({ kind: 'loading' });
    try {
      const { status, data } = await callFunction('GET', token);
      const link = asLinkState(data);
      if (status === 200 && link) setView({ kind: 'ready', link });
      else if (status === 400) setView({ kind: 'invalid' });
      else if (status === 404) setView({ kind: 'notFound' });
      else setView({ kind: 'error' });
    } catch {
      setView({ kind: 'error' });
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const change = async (scope: Scope, resubscribe: boolean) => {
    if (busy) return;
    setBusy(scope);
    setActionError(null);
    try {
      const { status, data } = await callFunction('POST', token, { t: token, scope, resubscribe });
      const link = asLinkState(data);
      if (status === 200 && link) {
        setView({ kind: 'done', link, scope, resubscribed: resubscribe });
      } else if (status === 429) {
        setActionError(t('unsubscribe.error.rateLimited', 'Too many changes in a short time. Please try again in an hour, or manage your preferences after signing in.'));
      } else if (status === 400 && data?.error === 'invalid_token') {
        setView({ kind: 'invalid' });
      } else {
        setActionError(t('unsubscribe.error.save', "We couldn't save this change. Please try again in a moment."));
      }
    } catch {
      setActionError(t('unsubscribe.error.save', "We couldn't save this change. Please try again in a moment."));
    }
    setBusy(null);
  };

  const eyebrow = t('unsubscribe.eyebrow', 'E-mail preferences');

  return (
    <div className="min-h-[70vh] bg-page px-4 py-12 sm:py-20">
      <Seo title={`${t('unsubscribe.metaTitle', 'Unsubscribe')} | Smart Marina Connect`} noindex />
      <div className="mx-auto w-full max-w-lg">
        {view.kind === 'loading' && (
          <div role="status">
            <StateCard eyebrow={eyebrow} icon={Loader2} spin title={t('unsubscribe.loading', 'Checking your link…')} />
          </div>
        )}

        {view.kind === 'noToken' && (
          <StateCard eyebrow={eyebrow} icon={Info} title={t('unsubscribe.noToken.title', 'Manage your e-mail preferences')}>
            <Body>
              <p>
                {view.legacy
                  ? t('unsubscribe.noToken.legacy', 'This link comes from an older e-mail and cannot change your preferences on its own.')
                  : t('unsubscribe.noToken.plain', 'This link does not say which e-mails to stop.')}{' '}
                {t('unsubscribe.noToken.signIn', 'Sign in to choose the notifications you receive: every kind of e-mail has its own switch.')}
              </p>
            </Body>
            <SignInButton />
          </StateCard>
        )}

        {view.kind === 'invalid' && (
          <StateCard eyebrow={eyebrow} icon={AlertCircle} tone="problem" title={t('unsubscribe.invalid.title', 'This link no longer works')}>
            <Body>
              <p>{t('unsubscribe.invalid.body', 'It may come from an older e-mail, or it was not copied in full. Sign in to choose the notifications you receive.')}</p>
            </Body>
            <SignInButton />
          </StateCard>
        )}

        {view.kind === 'notFound' && (
          <StateCard eyebrow={eyebrow} icon={Info} title={t('unsubscribe.notFound.title', 'This account no longer exists')}>
            <Body>
              <p>{t('unsubscribe.notFound.body', 'There is no account left for this link, so no more notifications will be sent to it. If you still receive e-mails from us, contact the M3 team.')}</p>
            </Body>
            <div className="mt-7 flex justify-center">
              <UnderlineLink to="/contact">{t('unsubscribe.contact', 'Contact the M3 team')}</UnderlineLink>
            </div>
          </StateCard>
        )}

        {view.kind === 'error' && (
          <StateCard eyebrow={eyebrow} icon={AlertCircle} tone="problem" title={t('unsubscribe.error.title', 'Something went wrong')}>
            <Body>
              <p>{t('unsubscribe.error.body', "We couldn't read this link just now. Please try again in a moment, or sign in to manage your preferences.")}</p>
            </Body>
            <div className="mt-7 flex flex-wrap items-center justify-center gap-x-6 gap-y-3">
              <Button type="button" variant="cta" onClick={() => void load()}>
                {t('unsubscribe.retry', 'Try again')}
              </Button>
              <UnderlineLink to={PREFERENCES_PATH} arrow={false}>
                {t('unsubscribe.signIn', 'Sign in to manage your e-mail preferences')}
              </UnderlineLink>
            </div>
          </StateCard>
        )}

        {view.kind === 'ready' && (
          <StateCard eyebrow={eyebrow} icon={MailX} title={t('unsubscribe.ready.title', 'Unsubscribe from e-mails')}>
            <Body>
              {view.link.email && (
                <p>
                  {t('unsubscribe.ready.address', 'Notifications sent to')}{' '}
                  <span className="font-semibold text-navy [overflow-wrap:anywhere]">{view.link.email}</span>
                </p>
              )}
              <p>
                {view.link.category_optional
                  ? t('unsubscribe.ready.covers', 'This link came with one of your “{{label}}” e-mails.', { label: view.link.category_label })
                  : view.link.category === 'all'
                    ? t('unsubscribe.ready.coversAll', 'This link covers every optional e-mail from Smart Marina Connect.')
                    : serviceNote(view.link.category)}
              </p>
            </Body>

            {view.link.category_optional && !view.link.subscribed && (
              <p className="mt-5 rounded-field bg-chip px-4 py-3 text-[14px] leading-6 text-ink">
                {t('unsubscribe.ready.alreadyOff', 'You are already unsubscribed from {{noun}} e-mails.', { noun: noun(view.link.category, view.link.category_label) })}{' '}
                <UnderlineLink arrow={false} disabled={!!busy} onClick={() => void change('category', true)}>
                  {t('unsubscribe.ready.subscribeAgain', 'Subscribe again')}
                </UnderlineLink>
              </p>
            )}

            <div className="mt-7 flex flex-col items-stretch gap-3">
              {view.link.category_optional && view.link.subscribed && (
                <Button type="button" variant="cta" roll={false} className={cn(CTA_WRAP, 'justify-between')} disabled={!!busy} onClick={() => void change('category', false)}>
                  {busy === 'category' ? t('unsubscribe.saving', 'Saving…') : t('unsubscribe.ready.category', 'Unsubscribe from {{noun}} e-mails', { noun: noun(view.link.category, view.link.category_label) })}
                </Button>
              )}
              <Button
                type="button"
                variant={view.link.category_optional && view.link.subscribed ? 'ctaOutline' : 'cta'}
                roll={false}
                className={cn(CTA_WRAP, 'justify-between')}
                disabled={!!busy}
                onClick={() => void change('all', false)}
              >
                {busy === 'all' ? t('unsubscribe.saving', 'Saving…') : t('unsubscribe.ready.all', 'Unsubscribe from all optional e-mails')}
              </Button>
            </div>
            {actionError && (
              <p role="alert" className="mt-4 text-sm leading-5 text-red-700">{actionError}</p>
            )}

            <OptionalList link={view.link} />
          </StateCard>
        )}

        {view.kind === 'done' && (
          <StateCard
            eyebrow={eyebrow}
            icon={CheckCircle2}
            tone="success"
            focusTitle
            title={view.resubscribed
              ? t('unsubscribe.done.resubscribedTitle', 'You are subscribed again')
              : t('unsubscribe.done.title', 'You are unsubscribed')}
          >
            <Body>
              <p>
                {view.resubscribed
                  ? view.scope === 'category'
                    ? t('unsubscribe.done.resubscribedCategory', 'You will receive {{noun}} e-mails again.', { noun: noun(view.link.category, view.link.category_label) })
                    : t('unsubscribe.done.resubscribedAll', 'You will receive the optional e-mails again.')
                  : view.scope === 'category'
                    ? t('unsubscribe.done.category', 'You will no longer receive {{noun}} e-mails.', { noun: noun(view.link.category, view.link.category_label) })
                    : t('unsubscribe.done.all', 'You will no longer receive optional e-mails from Smart Marina Connect.')}
                {view.link.email && (
                  <>
                    {' '}
                    {t('unsubscribe.done.address', 'Address:')}{' '}
                    <span className="font-semibold text-navy [overflow-wrap:anywhere]">{view.link.email}</span>
                  </>
                )}
              </p>
              {!view.resubscribed && (
                <p>{t('unsubscribe.done.essential', 'Essential messages about your account and your payments are still sent.')}</p>
              )}
            </Body>
            {actionError && (
              <p role="alert" className="mt-4 text-sm leading-5 text-red-700">{actionError}</p>
            )}
            <div className="mt-7 flex flex-wrap items-center justify-center gap-x-6 gap-y-3">
              {!view.resubscribed && (
                <p className="text-[15px] leading-6 text-meta">
                  {t('unsubscribe.done.changedMind', 'Changed your mind?')}{' '}
                  <UnderlineLink arrow={false} disabled={!!busy} onClick={() => void change(view.scope, true)}>
                    {busy ? t('unsubscribe.saving', 'Saving…') : t('unsubscribe.done.resubscribe', 'Re-subscribe')}
                  </UnderlineLink>
                </p>
              )}
              <UnderlineLink to={PREFERENCES_PATH}>{t('unsubscribe.done.manage', 'Manage all your e-mail preferences')}</UnderlineLink>
            </div>
          </StateCard>
        )}

        <aside aria-labelledby="unsubscribe-newsletter" className="mt-6 rounded-card bg-foam p-6 text-left">
          <Eyebrow as="h2"><span id="unsubscribe-newsletter">{t('unsubscribe.newsletter.title', 'The newsletter')}</span></Eyebrow>
          <p className="mt-3 text-[15px] leading-6 text-ink">
            {t('unsubscribe.newsletter.body', 'The Smart Marina Connect newsletter is sent separately, through Mailchimp. To stop it, use the unsubscribe link at the bottom of any newsletter.')}
          </p>
          <p className="mt-3 text-[15px] leading-6 text-ink">
            {t('unsubscribe.newsletter.account', 'These settings only cover the notification e-mails of your account. You can change them one by one at any time')}{' '}
            <Link to={PREFERENCES_PATH} className="font-semibold text-navy underline decoration-navy/30 underline-offset-4 hover:decoration-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {t('unsubscribe.newsletter.accountLink', 'in your account')}
            </Link>
            .
          </p>
        </aside>
      </div>
    </div>
  );
}

/** What "all optional e-mails" covers, with the ones already off. */
function OptionalList({ link }: { link: LinkState }) {
  const { t } = useTranslation();
  if (!link.optional.length) return null;
  return (
    <div className="mt-7 border-t border-rule pt-5 text-left">
      <p className="text-[13px] font-semibold uppercase leading-4 tracking-[0.08em] text-meta">
        {t('unsubscribe.list.title', 'Optional e-mails')}
      </p>
      <ul className="mt-3 space-y-1.5 text-[14px] leading-5 text-ink">
        {link.optional.map((o) => (
          <li key={o.key} className="flex items-center justify-between gap-3">
            <span>{o.label}</span>
            <span className={cn('shrink-0 text-[13px] font-medium', o.subscribed ? 'text-teal-text' : 'text-meta')}>
              {o.subscribed ? t('unsubscribe.list.on', 'On') : t('unsubscribe.list.off', 'Off')}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[13px] leading-5 text-meta">
        {t('unsubscribe.list.essential', 'Messages about your account and your payments are always sent.')}
      </p>
    </div>
  );
}

function SignInButton() {
  const { t } = useTranslation();
  return (
    <div className="mt-7 flex justify-center">
      <Button asChild variant="cta" roll={false} className={CTA_WRAP}>
        <Link to={PREFERENCES_PATH}>{t('unsubscribe.signIn', 'Sign in to manage your e-mail preferences')}</Link>
      </Button>
    </div>
  );
}

function Body({ children }: { children: ReactNode }) {
  return <div className="mt-3 space-y-3 text-[15px] leading-6 text-meta">{children}</div>;
}

const TONE = {
  neutral: 'bg-chip text-navy',
  success: 'bg-foam text-teal-text',
  // A link that cannot be used: amber, not red (it is rarely the reader's fault).
  problem: 'bg-amber-50 text-amber-700',
} as const;

/** One calm centred card: eyebrow, round state icon, title, then the content. */
function StateCard({
  eyebrow,
  icon: Icon,
  tone = 'neutral',
  spin = false,
  title,
  focusTitle = false,
  children,
}: {
  eyebrow: string;
  icon: LucideIcon;
  tone?: keyof typeof TONE;
  spin?: boolean;
  title: string;
  /** Move focus to the title (a result has just appeared). */
  focusTitle?: boolean;
  children?: ReactNode;
}) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (focusTitle) titleRef.current?.focus({ preventScroll: true });
  }, [focusTitle, title]);
  return (
    <CardShell className="p-7 text-center sm:p-9">
      <div className="flex justify-center"><Eyebrow>{eyebrow}</Eyebrow></div>
      <span className={cn('mx-auto mt-6 grid h-14 w-14 place-items-center rounded-full', TONE[tone])}>
        <Icon className={cn('h-6 w-6', spin && 'animate-spin motion-reduce:animate-none')} aria-hidden="true" />
      </span>
      <h1 ref={titleRef} tabIndex={-1} className="mt-5 text-h2-sm text-navy [overflow-wrap:anywhere] focus:outline-none">{title}</h1>
      {children}
    </CardShell>
  );
}
