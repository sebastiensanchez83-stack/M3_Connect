import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Clock, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { accountHref } from '@/lib/accountNav';
import type { OrgViewer } from '@/lib/orgVisibility';
import { cn } from '@/lib/utils';

/**
 * What a visitor sees in place of a members-only block (Victor, 21 Oct 2026, "design for
 * non-tech users"): the same card everywhere, readable at rest, with no hover needed:
 *   - a lock and the block's title;
 *   - ONE line naming what is inside with its counts ("Facilities, 2 descriptions and 3 purchase
 *     projects"), never the values themselves;
 *   - two obvious buttons, "Sign in" and "Sign up for free"; for an account M3 has not validated
 *     yet, "Your account is being reviewed" and the way to its status instead.
 * Nothing locked is ever in the page, blurred or not: the page never loads it for this reader
 * (src/lib/orgVisibility.ts).
 */
export function LockedBlock({
  title, line, viewer, onSignIn, onSignUp, className, headingLevel = 3,
}: {
  title: string;
  line: ReactNode;
  /** 'pending' shows the review status instead of the two buttons. */
  viewer: OrgViewer;
  onSignIn: () => void;
  onSignUp: () => void;
  className?: string;
  headingLevel?: 2 | 3;
}) {
  const { t } = useTranslation();
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  const pending = viewer === 'pending';
  return (
    <div
      data-locked-block=""
      className={cn('rounded-card border border-rule bg-white p-5 md:p-6', className)}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-5">
        <span aria-hidden="true" className="grid h-12 w-12 shrink-0 place-items-center rounded-pill bg-foam text-teal">
          <Lock className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <Heading className="text-card-title text-navy">{title}</Heading>
          <p className="mt-1 text-[15px] leading-6 text-ink">{line}</p>
          {pending && (
            <p className="mt-2 inline-flex items-center gap-1.5 text-[14px] font-semibold leading-5 text-navy">
              <Clock className="h-4 w-4 shrink-0 text-teal" aria-hidden="true" />
              {t('orgProfile.locked.pending', 'Your account is being reviewed')}
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-3">
          {pending ? (
            <Button asChild variant="ctaOutline" size="sm">
              <Link to={accountHref('dashboard')}>{t('orgProfile.locked.checkStatus', 'Check my account status')}</Link>
            </Button>
          ) : (
            <>
              <Button variant="ctaNavy" size="sm" onClick={onSignIn}>{t('orgProfile.locked.signIn', 'Sign in')}</Button>
              <Button variant="cta" size="sm" onClick={onSignUp}>{t('orgProfile.locked.signUp', 'Sign up for free')}</Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** "a, b and c" (English UI). */
export function joinList(items: string[]): string {
  const list = items.filter(Boolean);
  if (list.length <= 1) return list[0] ?? '';
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}
