import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock, Loader2, Mail, Plus, Save, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { readSlaDays } from '../AdminReviewQueue';
import { ADMIN_BTN, ADMIN_BTN_PRIMARY, AdminPanel } from '../AdminUI';
import { readSetting, saveSetting } from './settingsStore';

/**
 * The review settings of spec §8.4 (platform_settings):
 *  - review_sla_text (a JSON string): the delay M3 promises, shown to people waiting and
 *    used by the review list to mark items late (it reads "N working days");
 *  - review_digest_recipients (a JSON array of e-mails, staff-only): who gets the 08:00
 *    summary of the review list (registration-cron, while "Review list v2" is on).
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function ReviewSettingsPanel() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [sla, setSla] = useState('');
  const [slaSaved, setSlaSaved] = useState('');
  const [slaAt, setSlaAt] = useState<string | null>(null);
  const [recipients, setRecipients] = useState<string[]>([]);
  const [recipientsSaved, setRecipientsSaved] = useState<string[]>([]);
  const [recAt, setRecAt] = useState<string | null>(null);
  const [newEmail, setNewEmail] = useState('');
  const [savingSla, setSavingSla] = useState(false);
  const [savingRec, setSavingRec] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [s, r] = await Promise.all([readSetting<unknown>('review_sla_text'), readSetting<unknown>('review_digest_recipients')]);
    if (s.failed || r.failed) { setState('error'); return; }
    const text = typeof s.value === 'string' ? s.value : '';
    setSla(text);
    setSlaSaved(text);
    setSlaAt(s.updatedAt);
    const list = Array.isArray(r.value) ? (r.value as unknown[]).filter((x): x is string => typeof x === 'string') : [];
    setRecipients(list);
    setRecipientsSaved(list);
    setRecAt(r.updatedAt);
    setState('ready');
  }, []);

  useEffect(() => { void load(); }, [load]);

  const conflict = () => {
    toast({
      title: t('adminSettings.conflictTitle', 'Changed by someone else'),
      description: t('adminSettings.conflictSetting', 'Someone changed this setting since you opened the page. The page now shows the current value: check it, then try again.'),
      variant: 'destructive',
    });
    void load();
  };

  const saveSla = async () => {
    const text = sla.trim();
    if (!text) return;
    setSavingSla(true);
    const res = await saveSetting('review_sla_text', text, slaAt, user?.id);
    setSavingSla(false);
    if (!res.ok) {
      if (res.reason === 'conflict') conflict();
      else toast({ title: t('adminSettings.saveFailedTitle', 'Not saved'), description: res.message, variant: 'destructive' });
      return;
    }
    setSla(text);
    setSlaSaved(text);
    setSlaAt(res.updatedAt);
    toast({ title: t('adminSettings.sla.saved', 'Promised delay saved') });
  };

  const addEmail = (e: FormEvent) => {
    e.preventDefault();
    const email = newEmail.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) { setEmailError(t('adminSettings.digest.invalid', 'This is not an e-mail address.')); return; }
    if (recipients.includes(email)) { setEmailError(t('adminSettings.digest.duplicate', 'This address is already in the list.')); return; }
    setRecipients(list => [...list, email]);
    setNewEmail('');
    setEmailError(null);
  };

  const saveRecipients = async () => {
    setSavingRec(true);
    const res = await saveSetting('review_digest_recipients', recipients, recAt, user?.id);
    setSavingRec(false);
    if (!res.ok) {
      if (res.reason === 'conflict') conflict();
      else toast({ title: t('adminSettings.saveFailedTitle', 'Not saved'), description: res.message, variant: 'destructive' });
      return;
    }
    setRecipientsSaved(recipients);
    setRecAt(res.updatedAt);
    toast({ title: t('adminSettings.digest.saved', 'Recipients saved') });
  };

  const days = readSlaDays(sla);
  const understood = /(\d+)\s*working\s*days?/i.test(sla);
  const recDirty = recipients.join('\n') !== recipientsSaved.join('\n');

  return (
    <AdminPanel
      icon={Clock}
      title={t('adminSettings.review.title', 'Review list')}
      description={t('adminSettings.review.description', 'The delay M3 promises to people waiting, and who gets the daily summary of what waits.')}
    >
      {state === 'loading' && (
        <p className="flex items-center gap-2 py-4 text-[14px] text-meta" role="status">
          <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />{t('adminUi.loading', 'Loading…')}
        </p>
      )}
      {state === 'error' && (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-[14px] text-red-900">
          {t('adminSettings.review.loadFailed', 'These settings could not be read. Reload the page. Nothing was changed.')}
        </p>
      )}
      {state === 'ready' && (
        <div className="grid gap-8 lg:grid-cols-2">
          <section>
            <h3 className="text-[15px] font-semibold text-navy">{t('adminSettings.sla.title', 'Promised delay')}</h3>
            <p className="mt-1 text-[14px] leading-5 text-meta">
              {t('adminSettings.sla.help', 'Shown to people waiting ("M3 reviews every account {{text}}") and used by the review list to mark items late.', { text: slaSaved || '…' })}
            </p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <Input
                value={sla}
                onChange={e => setSla(e.target.value)}
                maxLength={80}
                aria-label={t('adminSettings.sla.title', 'Promised delay')}
                className="h-11"
              />
              <Button size="sm" className={cn(ADMIN_BTN_PRIMARY, 'h-11 shrink-0')} onClick={() => saveSla()} disabled={savingSla || !sla.trim() || sla.trim() === slaSaved}>
                {savingSla ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Save className="mr-1.5 h-4 w-4" aria-hidden="true" />}
                {t('adminSettings.save', 'Save')}
              </Button>
            </div>
            <p className={cn('mt-2 text-[13px] leading-5', understood ? 'text-meta' : 'text-amber-800')}>
              {understood
                ? t('adminSettings.sla.understood', { count: days, defaultValue_one: 'The review list marks an item late after {{count}} working day.', defaultValue_other: 'The review list marks an item late after {{count}} working days.' })
                : t('adminSettings.sla.notUnderstood', 'The review list understands "within N working days" only; with this text it marks items late after 2 working days.')}
            </p>
          </section>

          <section>
            <h3 className="text-[15px] font-semibold text-navy">{t('adminSettings.digest.title', 'Daily summary e-mail')}</h3>
            <p className="mt-1 text-[14px] leading-5 text-meta">
              {t('adminSettings.digest.help', 'Every day at 08:00 (Monaco time), while "Review list v2" is on: how many items wait in each topic, and the oldest one. Only M3 staff can see this list.')}
            </p>
            {recipients.length === 0 ? (
              <p className="mt-3 text-[14px] text-amber-800">{t('adminSettings.digest.none', 'Nobody gets the summary.')}</p>
            ) : (
              <ul className="mt-3 flex flex-wrap gap-2">
                {recipients.map(r => (
                  <li key={r} className="inline-flex max-w-full items-center gap-1 rounded-pill border border-rule bg-white py-1 pl-3 pr-1 text-[14px] text-navy">
                    <Mail className="h-3.5 w-3.5 shrink-0 text-meta" aria-hidden="true" />
                    <span className="min-w-0 [overflow-wrap:anywhere]">{r}</span>
                    <button
                      type="button"
                      onClick={() => setRecipients(list => list.filter(x => x !== r))}
                      aria-label={t('adminSettings.digest.remove', 'Remove {{email}}', { email: r })}
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-meta hover:bg-chip hover:text-navy focus:outline-none focus-visible:shadow-focus"
                    >
                      <X className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <form onSubmit={addEmail} className="mt-3 flex flex-col gap-2 sm:flex-row" noValidate>
              <Input
                type="email"
                inputMode="email"
                autoComplete="email"
                value={newEmail}
                onChange={e => { setNewEmail(e.target.value); setEmailError(null); }}
                placeholder={t('adminSettings.digest.placeholder', 'name@m3monaco.com')}
                aria-label={t('adminSettings.digest.add', 'Add an address')}
                aria-invalid={!!emailError}
                className="h-11"
              />
              <Button type="submit" variant="outline" size="sm" className={cn(ADMIN_BTN, 'h-11 shrink-0')} disabled={!newEmail.trim()}>
                <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />{t('adminSettings.digest.addButton', 'Add')}
              </Button>
            </form>
            {emailError && <p role="alert" className="mt-1.5 text-[13px] text-red-800">{emailError}</p>}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button size="sm" className={cn(ADMIN_BTN_PRIMARY, 'h-11')} onClick={() => saveRecipients()} disabled={savingRec || !recDirty}>
                {savingRec ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Save className="mr-1.5 h-4 w-4" aria-hidden="true" />}
                {t('adminSettings.digest.save', 'Save the recipients')}
              </Button>
              {recDirty && <span className="text-[13px] text-amber-800">{t('adminSettings.unsaved', 'Not saved yet')}</span>}
            </div>
          </section>
        </div>
      )}
    </AdminPanel>
  );
}
