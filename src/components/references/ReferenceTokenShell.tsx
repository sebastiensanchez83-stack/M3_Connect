import { useEffect, useRef, type ReactNode } from 'react';
import { Helmet } from 'react-helmet-async';
import { AlertCircle, CheckCircle2, Info, Loader2, type LucideIcon } from 'lucide-react';
import { CardShell } from '@/components/brand/CardShell';
import { Eyebrow } from '@/components/brand/Eyebrow';
import { UnderlineLink } from '@/components/brand/UnderlineLink';
import { cn } from '@/lib/utils';

/**
 * The frame of the two pages a marina contact reaches from an e-mail
 * (/reference/confirm and /reference/reject): one calm centred card on the
 * page background, a clear result, a short note on what a reference is and a
 * way back to the platform. Presentation only; the pages own the logic.
 */

export type ResultTone = 'loading' | 'success' | 'neutral' | 'problem';

const TONE: Record<ResultTone, { icon: LucideIcon; chip: string }> = {
  loading: { icon: Loader2, chip: 'bg-chip text-navy' },
  success: { icon: CheckCircle2, chip: 'bg-emerald-50 text-emerald-700' },
  // A recorded answer, or an answer that was already given: nothing to worry about.
  neutral: { icon: Info, chip: 'bg-chip text-navy' },
  // A link that cannot be used: amber, not red (it is rarely the reader's fault).
  problem: { icon: AlertCircle, chip: 'bg-amber-50 text-amber-700' },
};

/** The error codes that mean "this was already settled" rather than "this failed". */
export function toneForCode(code: string): ResultTone {
  return code === 'already_rejected' || code === 'already_confirmed' ? 'neutral' : 'problem';
}

export function ReferencePage({ metaTitle, children }: { metaTitle: string; children: ReactNode }) {
  return (
    <div className="min-h-[70vh] bg-page px-4 py-12 sm:py-20">
      <Helmet>
        <title>{metaTitle}</title>
        <meta name="robots" content="noindex" />
      </Helmet>
      <div className="mx-auto w-full max-w-lg">
        {children}
        <AboutReferences />
      </div>
    </div>
  );
}

/** The card: eyebrow, round state icon, title, then the content. */
export function ReferenceCard({
  eyebrow,
  tone,
  title,
  focusTitle = false,
  children,
}: {
  eyebrow: string;
  tone: ResultTone;
  title: string;
  /** Move keyboard and screen-reader focus to the title (a result has just appeared). */
  focusTitle?: boolean;
  children?: ReactNode;
}) {
  const { icon: Icon, chip } = TONE[tone];
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (focusTitle) titleRef.current?.focus({ preventScroll: true });
  }, [focusTitle]);
  return (
    <CardShell className="p-7 text-center sm:p-9">
      <div className="flex justify-center"><Eyebrow>{eyebrow}</Eyebrow></div>
      <span className={cn('mx-auto mt-6 grid h-14 w-14 place-items-center rounded-pill', chip)}>
        <Icon className={cn('h-6 w-6', tone === 'loading' && 'animate-spin motion-reduce:animate-none')} aria-hidden="true" />
      </span>
      <h1 ref={titleRef} tabIndex={-1} className="mt-5 text-h2-sm text-navy [overflow-wrap:anywhere] focus:outline-none">{title}</h1>
      {children}
    </CardShell>
  );
}

/** Who and what the answer was about: shown only for the parts the server returned. */
export function ReferenceFacts({ partnerName, projectName }: { partnerName?: string; projectName?: string }) {
  if (!partnerName && !projectName) return null;
  return (
    <dl className="mt-6 divide-y divide-rule rounded-xl border border-rule bg-page text-left">
      {partnerName && (
        <div className="flex flex-col gap-0.5 px-4 py-3 sm:flex-row sm:gap-4">
          <dt className="shrink-0 text-[13px] font-semibold uppercase leading-5 tracking-[0.08em] text-meta sm:w-36">Service provider</dt>
          <dd className="text-[15px] font-medium leading-5 text-navy [overflow-wrap:anywhere]">{partnerName}</dd>
        </div>
      )}
      {projectName && (
        <div className="flex flex-col gap-0.5 px-4 py-3 sm:flex-row sm:gap-4">
          <dt className="shrink-0 text-[13px] font-semibold uppercase leading-5 tracking-[0.08em] text-meta sm:w-36">Project</dt>
          <dd className="text-[15px] font-medium leading-5 text-navy [overflow-wrap:anywhere]">{projectName}</dd>
        </div>
      )}
    </dl>
  );
}

/** The way back, under every state. */
export function ReferenceBackLink({ contact = false }: { contact?: boolean }) {
  return (
    <div className="mt-7 flex flex-wrap items-center justify-center gap-x-6 gap-y-3">
      <UnderlineLink to="/">Back to Smart Marina Connect</UnderlineLink>
      {contact && <UnderlineLink to="/contact" arrow={false}>Contact the M3 team</UnderlineLink>}
    </div>
  );
}

export function ReferenceBody({ children }: { children: ReactNode }) {
  return <div className="mt-3 space-y-3 text-[15px] leading-6 text-meta">{children}</div>;
}

function AboutReferences() {
  return (
    <aside aria-labelledby="about-references" className="mt-6 rounded-card bg-foam p-6 text-left">
      <Eyebrow as="h2"><span id="about-references">What is a reference?</span></Eyebrow>
      <p className="mt-3 text-[15px] leading-6 text-ink">
        A reference is a client recommendation. A service provider on Smart Marina Connect has named a project it delivered for
        your organisation and asked you to confirm it. Once confirmed, the provider's profile shows that your organisation
        recommends its work, with the project name.
      </p>
      <p className="mt-3 text-[15px] leading-6 text-ink">
        Smart Marina Connect is the network where marinas, service providers, investors and media meet, run by M3 Monaco.
      </p>
    </aside>
  );
}
