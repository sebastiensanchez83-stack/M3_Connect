import { Link } from 'react-router-dom';
import { Trophy } from 'lucide-react';
import { cn } from '@/lib/utils';
import { awardWinText, type AwardWin } from '@/lib/awardWins';

/**
 * "Smart Marina 2026 winner, Innovation Jury Award" (src/lib/awardWins.ts).
 *
 *  - `WinnerBadge`: the gold badge of the company page header, next to
 *    "Verified member". For an SM26 award it opens the public results
 *    (/sm26/vote), where the winners are listed.
 *  - `WinnerLine`: the one-line version for a directory card (no link: the
 *    whole card already links to the company page).
 *
 * The accent text #1b6ea8 on the accent tint keeps 5:1 (sky blue since 21 Oct 2026, gold before).
 */

const RESULTS_PATH: Record<string, string> = { sm26: '/sm26/vote' };

export function WinnerBadge({ win, className }: { win: AwardWin; className?: string }) {
  const text = awardWinText(win);
  const look = cn(
    'inline-flex max-w-full items-center gap-1 rounded-badge bg-gold/15 px-1.5 py-0.5 text-[12px] font-semibold leading-4 text-gold-text ring-1 ring-inset ring-gold/40',
    className,
  );
  const body = (
    <>
      <Trophy className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="min-w-0">{text}</span>
    </>
  );
  const to = RESULTS_PATH[win.event_slug];
  if (!to) return <span className={look}>{body}</span>;
  return (
    <Link
      to={to}
      title={`See the Smart Marina ${win.edition_year} winners`}
      className={cn(look, 'focus-ring transition-colors duration-300 hover:bg-gold/25')}
    >
      {body}
    </Link>
  );
}

export function WinnerLine({ wins, className }: { wins: AwardWin[]; className?: string }) {
  if (wins.length === 0) return null;
  return (
    <ul className={cn('space-y-1', className)}>
      {wins.map((w) => (
        <li key={`${w.event_slug}:${w.award_key}`} className="flex items-start gap-1.5 text-[13px] font-semibold leading-[18px] text-gold-text">
          <Trophy className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="line-clamp-2">{awardWinText(w)}</span>
        </li>
      ))}
    </ul>
  );
}
