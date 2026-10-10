import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Loader2, LogIn, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { AuthNotice, FieldError } from '@/components/auth/fields';
import { Turnstile, useTurnstile } from '@/components/security/Turnstile';
import {
  questionOptions, questionsFor, registerForEvent, registrationErrorText, sortedTickets,
  type RegFailure, type RegForm, type RegQuestion, type RegStatus, type SourceDetail, type StandardFieldKey,
} from '@/lib/registration';
import { cn } from '@/lib/utils';
import {
  EMPTY_IDENTITY, IdentityBlock, identityErrors, ruleOf,
  type IdentityKey, type IdentityValues,
} from './IdentityBlock';
import { QuestionField, answerError, isAnswered, type AnswerValue } from './QuestionField';
import { TicketCards } from './TicketCards';
import { regLocale } from './RegistrationUI';

/**
 * The registration form of /register/:slug, in three short steps:
 *
 *   1. You — names, e-mail, and the standard fields the event asks for;
 *   2. Your participation — the participation types (when there is more than
 *      one) and that type's own questions (skipped when there is nothing to ask);
 *   3. Confirm — what will be sent, the terms, the image consent when the event
 *      asks it, and the news opt-in, unticked.
 *
 * Signed in, everything the platform already knows is filled in (and the
 * e-mail is the account's). Nothing is lost when going back and forth. On a
 * phone the step's button stays at the bottom of the screen.
 *
 * The answer never says whether the address was already registered: a
 * duplicate is told the same thing (the e-mail it receives differs).
 */

export interface RegistrationDone {
  email: string;
  status?: RegStatus | null;
  /** Registered while the event was full: on the waiting list (as far as the page knows). */
  waitlist: boolean;
}

type Step = 'you' | 'participation' | 'confirm';

const STD_KEYS: StandardFieldKey[] = ['company', 'job_title', 'phone', 'country'];

/** An answer in words, for the summary. */
function answerText(q: RegQuestion, v: AnswerValue | undefined, yes: string, no: string): string {
  if (v === undefined) return '';
  if (typeof v === 'boolean') return v ? yes : no;
  const opts = questionOptions(q);
  const label = (x: string) => opts.find((o) => o.value === x)?.label ?? x;
  if (Array.isArray(v)) return v.map(label).join(', ');
  return q.kind === 'select' ? label(v) : v;
}

export function RegistrationForm({
  form,
  signedIn,
  onSignIn,
  source,
  onDone,
}: {
  form: RegForm;
  signedIn: boolean;
  onSignIn: () => void;
  source: SourceDetail;
  onDone: (done: RegistrationDone) => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = regLocale(i18n.language);
  const ev = form.event;
  const std = form.standard_fields;
  const tickets = useMemo(() => sortedTickets(form.tickets), [form.tickets]);
  const prefill = form.prefill ?? null;

  const [values, setValues] = useState<IdentityValues>(EMPTY_IDENTITY);
  const [ticketKey, setTicketKey] = useState<string | null>(() => {
    const open = tickets.filter((tk) => !tk.invite_only && !tk.full);
    return tickets.length === 1 && open.length === 1 ? open[0].key : null;
  });
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({});
  const [terms, setTerms] = useState(false);
  const [imageOk, setImageOk] = useState(false);
  const [news, setNews] = useState(false);
  const [honeypot, setHoneypot] = useState('');
  const [step, setStep] = useState<Step>('you');
  const [idErrors, setIdErrors] = useState<Partial<Record<IdentityKey, string>>>({});
  const [qErrors, setQErrors] = useState<Record<string, string>>({});
  const [ticketError, setTicketError] = useState<string | null>(null);
  const [termsError, setTermsError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const captcha = useTurnstile();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);

  // What the platform knows, into the EMPTY fields only (nothing typed is ever overwritten).
  // Signed in, the e-mail is always the account's.
  useEffect(() => {
    if (!prefill) return;
    setValues((cur) => {
      const next = { ...cur };
      for (const key of Object.keys(EMPTY_IDENTITY) as IdentityKey[]) {
        const known = (prefill as Record<string, string | null | undefined>)[key];
        if (known && (!next[key] || (key === 'email' && signedIn))) next[key] = known;
      }
      return next;
    });
  }, [prefill, signedIn]);

  const asked = questionsFor(form.questions, tickets.length > 0 ? ticketKey : null);
  const anyQuestions = tickets.length > 0
    ? tickets.some((tk) => questionsFor(form.questions, tk.key).length > 0)
    : asked.length > 0;
  const needParticipation = tickets.length > 1 || anyQuestions;
  const steps: Step[] = needParticipation ? ['you', 'participation', 'confirm'] : ['you', 'confirm'];
  const stepNo = steps.indexOf(step) + 1;

  // A new step: back to its top, the heading read out.
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    const el = headingRef.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY - 120;
    if (window.scrollY > top) window.scrollTo({ top, behavior: 'smooth' });
    el.focus({ preventScroll: true });
  }, [step]);

  const setValue = (key: IdentityKey, v: string) => {
    setValues((cur) => ({ ...cur, [key]: v }));
    if (idErrors[key]) setIdErrors((e) => ({ ...e, [key]: undefined }));
  };
  const setAnswer = (key: string, v: AnswerValue) => {
    setAnswers((cur) => ({ ...cur, [key]: v }));
    if (qErrors[key]) setQErrors((e) => { const n = { ...e }; delete n[key]; return n; });
  };

  const checkYou = (): boolean => {
    const errs = identityErrors(values, std, t);
    setIdErrors(errs);
    return Object.keys(errs).length === 0;
  };
  const checkParticipation = (): boolean => {
    let ok = true;
    if (tickets.length > 0 && !ticketKey) {
      setTicketError(t('reg.error.ticketRequired', 'Please choose how you will take part.'));
      ok = false;
    } else {
      setTicketError(null);
    }
    const errs: Record<string, string> = {};
    for (const q of asked) {
      const e = answerError(q, answers[q.key], t);
      if (e) errs[q.key] = e;
    }
    setQErrors(errs);
    return ok && Object.keys(errs).length === 0;
  };

  const next = () => {
    setFailure(null);
    if (step === 'you') {
      if (!checkYou()) return;
      setStep(steps[1]);
    } else if (step === 'participation') {
      if (!checkParticipation()) return;
      setStep('confirm');
    }
  };
  const back = () => {
    setFailure(null);
    const i = steps.indexOf(step);
    if (i > 0) setStep(steps[i - 1]);
  };

  /** Bring the person back to where the server found something to fix. */
  const handleFailure = (f: RegFailure) => {
    if (f.error === 'missing_fields' || f.error === 'invalid_email') {
      const errs: Partial<Record<IdentityKey, string>> = {};
      const need = t('reg.field.required', 'Please fill this in.');
      for (const k of f.fields ?? []) if (k in EMPTY_IDENTITY) errs[k as IdentityKey] = need;
      if (f.error === 'invalid_email') errs.email = t('reg.field.emailInvalid', 'Please enter a valid e-mail address, like name@company.com.');
      setIdErrors(errs);
      setStep('you');
    } else if (f.error === 'invalid_answers') {
      const errs: Record<string, string> = {};
      for (const k of f.keys ?? []) errs[k] = t('reg.q.check', 'Please check this answer.');
      setQErrors(errs);
      if (needParticipation) setStep('participation');
    } else if (f.error && f.error.startsWith('ticket') || f.error === 'unknown_ticket') {
      setTicketError(registrationErrorText(t, f));
      if (needParticipation) setStep('participation');
    }
    setFailure(registrationErrorText(t, f));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (step !== 'confirm') { next(); return; }
    setFailure(null);
    if (!terms) {
      setTermsError(t('reg.confirm.termsNeeded', 'Please accept the terms to send your registration.'));
      return;
    }
    if (!checkYou()) { setStep('you'); return; }
    if (needParticipation && !checkParticipation()) { setStep('participation'); return; }

    const now = new Date().toISOString();
    const fields: Partial<Record<StandardFieldKey, string>> = {};
    for (const k of STD_KEYS) if (ruleOf(std, k) !== 'hidden' && values[k].trim()) fields[k] = values[k].trim();
    const sentAnswers: Record<string, AnswerValue> = {};
    for (const q of asked) if (isAnswered(answers[q.key])) sentAnswers[q.key] = answers[q.key];

    setSending(true);
    const res = await registerForEvent({
      slug: ev.slug,
      first_name: values.first_name.trim(),
      last_name: values.last_name.trim(),
      email: values.email.trim().toLowerCase(),
      ...fields,
      ticket_key: tickets.length > 0 ? ticketKey : null,
      answers: sentAnswers,
      consents: {
        terms_at: now,
        ...(form.ask_image_consent ? { image: imageOk } : {}),
        ...(news ? { marketing_at: now } : {}),
      },
      source_detail: source,
      organization_id: prefill?.organization_id ?? null,
      website: honeypot,
      captcha: signedIn ? null : captcha.token,
    });
    setSending(false);
    if (!signedIn) captcha.reset(); // a token works once, whatever the answer
    if (res.ok) {
      onDone({ email: values.email.trim().toLowerCase(), status: res.status ?? null, waitlist: form.state === 'waitlist' });
      return;
    }
    handleFailure(res);
  };

  const mode = ev.mode;
  const submitLabel = form.state === 'waitlist'
    ? t('reg.submit.waitlist', 'Join the waiting list')
    : mode === 'invitation'
      ? t('reg.submit.request', 'Send my request')
      : mode === 'review'
        ? t('reg.submit.review', 'Send my registration')
        : t('reg.submit.instant', 'Register');

  const stepTitle = step === 'you'
    ? t('reg.step.you', 'You')
    : step === 'participation'
      ? t('reg.step.participation', 'Your participation')
      : t('reg.step.confirm', 'Check and send');

  const ticket = tickets.find((tk) => tk.key === ticketKey) ?? null;
  const yes = t('reg.summary.yes', 'Yes');
  const no = t('reg.summary.no', 'No');

  const summaryRows: { label: string; value: string; step: Step }[] = [
    { label: t('reg.field.name', 'Name'), value: `${values.first_name.trim()} ${values.last_name.trim()}`.trim(), step: 'you' },
    { label: t('reg.field.email', 'E-mail'), value: values.email.trim(), step: 'you' },
    ...STD_KEYS.filter((k) => ruleOf(std, k) !== 'hidden' && values[k].trim()).map((k) => ({
      label: k === 'company' ? t('reg.field.company', 'Company')
        : k === 'job_title' ? t('reg.field.jobTitle', 'Job title')
          : k === 'phone' ? t('reg.field.phone', 'Phone') : t('reg.field.country', 'Country'),
      value: values[k].trim(),
      step: 'you' as Step,
    })),
    ...(ticket && tickets.length > 1 ? [{ label: t('reg.summary.participation', 'Participation'), value: ticket.label, step: 'participation' as Step }] : []),
    ...asked.filter((q) => isAnswered(answers[q.key])).map((q) => ({
      label: q.label, value: answerText(q, answers[q.key], yes, no), step: 'participation' as Step,
    })),
  ];

  const primary = step === 'confirm' ? submitLabel : t('reg.next', 'Continue');

  return (
    <form onSubmit={submit} noValidate className="space-y-6">
      {/* Signed out: one line to sign in and skip the typing. */}
      {!signedIn && step === 'you' && (
        <div className="flex flex-col gap-3 rounded-field border border-rule bg-page p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm leading-5 text-ink">
            {t('reg.signInHint', 'Already have an account? Sign in and we fill this in for you.')}
          </p>
          <Button type="button" variant="outline" className="h-10 shrink-0 rounded-pill border-navy/25 px-4 text-navy" onClick={onSignIn}>
            <LogIn className="mr-2 h-4 w-4" aria-hidden="true" />
            {t('reg.signIn', 'Sign in')}
          </Button>
        </div>
      )}

      <div>
        <p className="text-meta-caps">
          {t('reg.stepOf', { n: stepNo, total: steps.length, defaultValue: 'Step {{n}} of {{total}}' })}
        </p>
        <h2 ref={headingRef} tabIndex={-1} className="mt-1.5 text-h3 text-navy focus:outline-none">{stepTitle}</h2>
        {/* The progress, as three short bars. */}
        <div aria-hidden="true" className="mt-3 flex gap-1.5">
          {steps.map((s, i) => (
            <span key={s} className={cn('h-1.5 flex-1 rounded-pill', i < stepNo ? 'bg-navy' : 'bg-rule')} />
          ))}
        </div>
      </div>

      {step === 'you' && (
        <IdentityBlock
          values={values}
          onChange={setValue}
          errors={idErrors}
          standardFields={std}
          emailLocked={signedIn && !!prefill?.email}
        />
      )}

      {step === 'participation' && (
        <div className="space-y-6">
          {tickets.length > 1 && (
            <TicketCards
              tickets={tickets}
              value={ticketKey}
              onChange={(k) => { setTicketKey(k); setTicketError(null); }}
              error={ticketError}
              locale={locale}
            />
          )}
          {asked.map((q) => (
            <QuestionField key={q.key} question={q} value={answers[q.key]} onChange={(v) => setAnswer(q.key, v)} error={qErrors[q.key]} />
          ))}
          {tickets.length > 1 && !ticketKey && asked.length === 0 && (
            <p className="text-sm text-meta">{t('reg.ticket.thenQuestions', 'Choose how you will take part: the questions for it appear here.')}</p>
          )}
        </div>
      )}

      {step === 'confirm' && (
        <div className="space-y-5">
          <dl className="divide-y divide-rule rounded-field ring-1 ring-inset ring-rule">
            {summaryRows.map((row, i) => (
              <div key={`${row.label}-${i}`} className="flex items-start gap-4 px-4 py-3">
                <div className="min-w-0 flex-1 sm:flex sm:gap-6">
                  <dt className="text-meta-caps sm:w-36 sm:shrink-0 sm:pt-0.5">{row.label}</dt>
                  <dd className="mt-0.5 text-[15px] leading-6 text-navy [overflow-wrap:anywhere] sm:mt-0">{row.value}</dd>
                </div>
                {!(row.step === 'you' && i === 1 && signedIn) && (
                  <button
                    type="button"
                    onClick={() => setStep(row.step)}
                    className="inline-flex min-h-10 shrink-0 items-center rounded-pill px-2 text-sm font-semibold text-navy underline decoration-navy/30 underline-offset-4 hover:decoration-gold focus:outline-none focus-visible:shadow-focus"
                  >
                    {t('reg.change', 'Change')}
                    <span className="sr-only">: {row.label}</span>
                  </button>
                )}
              </div>
            ))}
          </dl>

          <div className="space-y-3">
            <label className={cn(
              'flex cursor-pointer items-start gap-3 rounded-field border px-4 py-3 text-[15px] leading-6 text-ink',
              terms ? 'border-navy bg-foam' : termsError ? 'border-red-700' : 'border-checkbox',
            )}
            >
              <Checkbox
                checked={terms}
                onCheckedChange={(c) => { setTerms(c === true); setTermsError(null); }}
                aria-invalid={!!termsError}
                aria-describedby={termsError ? 'reg-terms-err' : undefined}
                className="mt-0.5 h-5 w-5 border-checkbox"
              />
              <span>
                {t('reg.confirm.termsBefore', 'I accept the')}{' '}
                <Link to="/terms" target="_blank" className="font-semibold text-navy underline underline-offset-4">{t('reg.confirm.terms', 'terms of use')}</Link>{' '}
                {t('reg.confirm.and', 'and the')}{' '}
                <Link to="/privacy" target="_blank" className="font-semibold text-navy underline underline-offset-4">{t('reg.confirm.privacy', 'privacy policy')}</Link>.
                <span aria-hidden="true" className="text-red-700"> *</span>
              </span>
            </label>
            {termsError && <FieldError id="reg-terms-err">{termsError}</FieldError>}

            {form.ask_image_consent && (
              <label className={cn('flex cursor-pointer items-start gap-3 rounded-field border px-4 py-3 text-[15px] leading-6 text-ink', imageOk ? 'border-navy bg-foam' : 'border-checkbox')}>
                <Checkbox checked={imageOk} onCheckedChange={(c) => setImageOk(c === true)} className="mt-0.5 h-5 w-5 border-checkbox" />
                <span>{t('reg.confirm.image', 'I agree that photos and videos taken at the event, where I may appear, can be used by M3 to tell about it.')}</span>
              </label>
            )}

            <label className={cn('flex cursor-pointer items-start gap-3 rounded-field border px-4 py-3 text-[15px] leading-6 text-ink', news ? 'border-navy bg-foam' : 'border-checkbox')}>
              <Checkbox checked={news} onCheckedChange={(c) => setNews(c === true)} className="mt-0.5 h-5 w-5 border-checkbox" />
              <span>{t('reg.confirm.news', 'Send me news about Smart Marina Connect events (you can stop at any time).')}</span>
            </label>
          </div>

          {mode !== 'instant' && (
            <AuthNotice tone="info" icon={<ShieldCheck className="h-4 w-4" />}>
              <p>{mode === 'invitation'
                ? t('reg.rule.invitation', 'Places are by invitation: the M3 team reviews every request and replies by e-mail.')
                : t('reg.rule.review', 'The M3 team reviews every registration and replies by e-mail.')}</p>
            </AuthNotice>
          )}

          {!signedIn && <Turnstile captcha={captcha} action="registration" />}
        </div>
      )}

      {/* Honeypot: invisible to people, filled by bots. */}
      <input
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        value={honeypot}
        onChange={(e) => setHoneypot(e.target.value)}
        className="absolute -left-[9999px] h-0 w-0 opacity-0"
        aria-hidden="true"
      />

      {failure && (
        <AuthNotice tone="error" role="alert">
          <p>{failure}</p>
        </AuthNotice>
      )}

      {/* The step's buttons: pinned to the bottom of the screen on phones. */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-rule bg-white/95 px-4 py-3 shadow-[0_-4px_16px_rgba(11,38,83,0.08)] backdrop-blur sm:static sm:z-auto sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none sm:backdrop-blur-none"
        style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
      >
        <div className="mx-auto flex max-w-xl items-center gap-3 sm:max-w-none">
          {stepNo > 1 && (
            <Button type="button" variant="ghost" className="h-12 shrink-0 rounded-pill px-4 text-navy hover:bg-chip" onClick={back} disabled={sending}>
              <ArrowLeft className="mr-1.5 h-4 w-4" aria-hidden="true" />
              {t('reg.back', 'Back')}
            </Button>
          )}
          <Button
            type="submit"
            variant="cta"
            className="flex-1 justify-between sm:flex-none sm:min-w-[240px]"
            disabled={sending || (step === 'confirm' && !signedIn && captcha.waiting)}
            arrow={!sending}
            roll={!sending}
          >
            {sending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />{t('reg.sending', 'Sending…')}</> : primary}
          </Button>
        </div>
      </div>
      {/* Room for the pinned buttons, so the last field is never hidden under them. */}
      <div aria-hidden="true" className="h-16 sm:hidden" />
    </form>
  );
}
