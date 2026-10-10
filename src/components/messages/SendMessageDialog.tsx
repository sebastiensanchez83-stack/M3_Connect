import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CheckCircle, Lightbulb, Loader2, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { useAuth } from '@/contexts/AuthContext';
import { requireFreshSession } from '@/lib/session';
import { memberHomeHref } from '@/lib/accountNav';
import { mySectorsMissing, sectorsMatch } from '@/lib/sector-matching';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { FIRST_MESSAGE_MAX, sendFirstMessage } from './messagesApi';

/**
 * "Send a message" on a company page (Victor, 9 Oct 2026): a short first message
 * (500 characters at most) to the WHOLE company. Every member of it sees it, and
 * any of them can answer.
 *
 * Before sending, the window says what will happen: when the two companies'
 * activities match (the database's sector rule) they are connected at once and the
 * conversation starts; otherwise the company decides whether to connect. After
 * sending it says what did happen, with the way to the conversation (connected) or
 * to Messages, where it waits in "Sent" (not connected). No e-mail is sent for it:
 * the company sees it in Messages (and in its Friday summary).
 *
 * Few companies have ticked their sectors yet (9 Oct 2026), so most messages wait
 * for an answer. When the sender's own company has none, the "sent" screen says that
 * adding them connects it at once with the companies that match.
 */
export interface SentFirstMessage {
  id: string;
  connected: boolean;
}

export function SendMessageDialog({
  open,
  onOpenChange,
  org,
  onSent,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The company written to (and its type), and the person the message is filed under (its owner, or a member). */
  org: { id: string; name: string; contactUserId: string; type?: string | null };
  onSent: (sent: SentFirstMessage) => void;
}) {
  const { t } = useTranslation();
  const { user, organization } = useAuth();
  const uid = user?.id ?? null;
  const myOrgId = organization?.id ?? null;
  const myOrgType = organization?.organization_type ?? null;
  const fieldId = useId();
  const hintId = useId();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  // Set before any await: a double click must not send the message twice.
  const sendingRef = useRef(false);
  const [match, setMatch] = useState<boolean | null>(null);
  // My company has ticked no sectors on its side (the sector rule could never match).
  const [noSectors, setNoSectors] = useState(false);
  const [done, setDone] = useState<SentFirstMessage | null>(null);
  const [problem, setProblem] = useState<{ message: string; already: boolean } | null>(null);

  // Fresh each time the window opens: the match, the answer of the last send.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setDone(null);
    setProblem(null);
    setMatch(null);
    setNoSectors(false);
    sectorsMatch(myOrgId, org.id).then((m) => { if (alive) setMatch(m); }, () => {});
    mySectorsMissing(myOrgId, myOrgType, org.type).then((m) => { if (alive) setNoSectors(m); }, () => {});
    return () => { alive = false; };
  }, [open, myOrgId, myOrgType, org.id, org.type]);

  const left = FIRST_MESSAGE_MAX - text.length;
  const ready = text.trim().length > 0 && left >= 0;

  const send = async () => {
    if (!uid || !ready || sendingRef.current) return;
    sendingRef.current = true;
    try {
      const fresh = await requireFreshSession();
      if (!fresh) return;
      setSending(true);
      setProblem(null);
      const result = await sendFirstMessage({ uid, myOrgId, targetOrgId: org.id, targetUserId: org.contactUserId, message: text });
      if (result.ok) {
        setDone({ id: result.id, connected: result.connected });
        setText('');
        onSent({ id: result.id, connected: result.connected });
        return;
      }
      if (result.reason === 'error') {
        toast({ title: t('messages.sendFailed', 'Not sent'), description: result.message, variant: 'destructive' });
      } else {
        setProblem({ message: result.message, already: result.reason === 'already' });
      }
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  // Connected: straight into the conversation. Not connected: Messages, where the
  // message waits under "Sent" (it is not a conversation yet).
  const threadHref = done?.connected ? `/?open=inbox&thread=${done.id}` : '/?open=inbox';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg rounded-card">
        {done ? (
          <div className="py-2 text-center" role="status">
            <span className="mx-auto grid h-14 w-14 place-items-center rounded-pill bg-foam text-teal">
              <CheckCircle className="h-6 w-6" aria-hidden="true" />
            </span>
            <DialogHeader className="mt-4 space-y-2 text-center sm:text-center">
              <DialogTitle className="text-[20px] leading-7 text-navy">
                {done.connected
                  ? t('messages.first.connectedTitle', "You're connected: start the conversation")
                  : t('messages.first.sentTitle', 'Message sent')}
              </DialogTitle>
              <DialogDescription className="text-[15px] leading-6 text-ink">
                {done.connected
                  ? t('messages.first.connectedBody', 'Your activities match, so you and {{name}} are connected straight away. Everyone in both teams can read and reply.', { name: org.name })
                  : t('messages.first.sentBody', '{{name}} will decide whether to connect. You will see their answer in Messages.', { name: org.name })}
              </DialogDescription>
            </DialogHeader>
            {!done.connected && noSectors && (
              <p className="mt-5 flex items-start gap-2.5 rounded-field bg-page px-3.5 py-3 text-left text-[14px] leading-5 text-ink">
                <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-meta" aria-hidden="true" />
                <span>
                  {myOrgType === 'marina'
                    ? t('messages.first.tipInterests', 'Tip: tick the sectors your company is interested in. Companies whose activities match are then connected with you straight away.')
                    : t('messages.first.tipServices', 'Tip: tick the sectors your company works in. Companies interested in them are then connected with you straight away.')}
                  {' '}
                  <Link to={memberHomeHref('company')} onClick={() => onOpenChange(false)} className="font-semibold text-navy underline decoration-navy/30 underline-offset-[3px] hover:decoration-gold">
                    {t('messages.first.tipLink', 'Add them now')}
                  </Link>
                </span>
              </p>
            )}
            <div className="mt-6 flex flex-col-reverse justify-center gap-3 sm:flex-row">
              <Button variant="ctaOutline" size="sm" arrow={false} className="min-h-11" onClick={() => onOpenChange(false)}>
                {t('common.close', 'Close')}
              </Button>
              <Button asChild variant="cta" size="sm" className="min-h-11">
                <Link to={threadHref} onClick={() => onOpenChange(false)}>
                  {done.connected ? t('messages.first.openConversation', 'Open the conversation') : t('messages.first.openMessages', 'Go to my messages')}
                </Link>
              </Button>
            </div>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="text-navy">{t('messages.first.title', 'Send a message to {{name}}', { name: org.name })}</DialogTitle>
              <DialogDescription className="text-[15px] leading-6">
                {t('messages.first.intro', 'A short first message to introduce yourself. Everyone in the {{name}} team can read it; any of them can answer.', { name: org.name })}
              </DialogDescription>
            </DialogHeader>

            {/* What will happen: connected at once, or the company decides. */}
            {match !== null && (
              <p className={cn('flex items-start gap-2.5 rounded-field px-3.5 py-3 text-[14px] leading-5', match ? 'bg-foam text-teal-text' : 'bg-page text-ink')}>
                {match
                  ? <CheckCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  : <Users className="mt-0.5 h-4 w-4 shrink-0 text-meta" aria-hidden="true" />}
                <span>
                  {match
                    ? t('messages.first.matchHint', 'Your activities match: you will be connected straight away and can talk at once.')
                    : t('messages.first.decideHintMessages', '{{name}} will decide whether to connect. If they accept, you can talk in Messages, and M3 introduces you by e-mail.', { name: org.name })}
                </span>
              </p>
            )}

            <div className="space-y-2">
              <label htmlFor={fieldId} className="text-[15px] font-semibold text-navy">
                {t('messages.first.label', 'Your message')}
              </label>
              <textarea
                id={fieldId}
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={5}
                maxLength={FIRST_MESSAGE_MAX}
                aria-describedby={hintId}
                placeholder={t('messages.first.placeholder', 'Hello, I am … from … We would like to talk about …')}
                className="block w-full resize-y rounded-field border border-rule bg-white px-3.5 py-3 text-[16px] leading-6 text-ink placeholder:text-meta focus:outline-none focus-visible:shadow-focus"
              />
              <p id={hintId} className={cn('text-right text-[13px] tabular-nums', left < 0 ? 'text-red-700' : 'text-meta')}>
                {t('messages.first.left', { count: Math.max(left, 0), defaultValue_one: '{{count}} character left', defaultValue_other: '{{count}} characters left' })}
              </p>
            </div>

            {problem && (
              <p role="alert" className="rounded-field border border-amber-200 bg-amber-50 px-3.5 py-3 text-[14px] leading-5 text-amber-950">
                {problem.message}
                {problem.already && (
                  <>
                    {' '}
                    <Link to="/?open=inbox" onClick={() => onOpenChange(false)} className="font-semibold underline underline-offset-2">
                      {t('messages.first.openMessages', 'Go to my messages')}
                    </Link>
                  </>
                )}
              </p>
            )}

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-end">
              <Button variant="ctaOutline" size="sm" arrow={false} className="min-h-11" onClick={() => onOpenChange(false)}>
                {t('common.cancel', 'Cancel')}
              </Button>
              <Button variant="cta" size="sm" roll={!sending} arrow={!sending} className="min-h-11" onClick={send} disabled={!ready || sending}>
                {sending && <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
                {t('messages.first.send', 'Send the message')}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
