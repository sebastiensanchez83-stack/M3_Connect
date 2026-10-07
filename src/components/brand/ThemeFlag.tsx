import type { ThemeKey } from '@/lib/themes';
import { cn } from '@/lib/utils';

/**
 * A small signal flag per theme, in the SMC palette: the marine mark that sits
 * in theme chips and logbook rows instead of a generic UI icon. Not real
 * International Code of Signals flags (their meanings would mislead), only
 * their grammar: two colours, halves, crosses, borders. Decorative; the theme's
 * name is always written next to it.
 */
const NAVY = 'rgb(11 38 83)';
const GOLD = 'rgb(215 166 71)';
const TEAL = 'rgb(31 122 140)';
const WHITE = '#ffffff';

function Pattern({ theme }: { theme: ThemeKey }) {
  switch (theme) {
    case 'infrastructure':
      // Vertical halves.
      return (
        <>
          <rect width="9" height="12" fill={NAVY} />
          <rect x="9" width="9" height="12" fill={WHITE} />
        </>
      );
    case 'design':
      // Diagonal halves.
      return (
        <>
          <rect width="18" height="12" fill={GOLD} />
          <path d="M0 12 18 0V12Z" fill={NAVY} />
        </>
      );
    case 'digital':
      // A square in the middle.
      return (
        <>
          <rect width="18" height="12" fill={TEAL} />
          <rect x="6" y="3" width="6" height="6" fill={WHITE} />
        </>
      );
    case 'energy':
      // Horizontal halves.
      return (
        <>
          <rect width="18" height="6" fill={GOLD} />
          <rect y="6" width="18" height="6" fill={NAVY} />
        </>
      );
    case 'operations':
      // A cross.
      return (
        <>
          <rect width="18" height="12" fill={NAVY} />
          <path d="M7.5 0h3v12h-3zM0 4.5h18v3H0z" fill={WHITE} />
        </>
      );
    case 'business':
    default:
      // A border.
      return (
        <>
          <rect width="18" height="12" fill={TEAL} />
          <rect x="3" y="3" width="12" height="6" fill={WHITE} />
        </>
      );
  }
}

export function ThemeFlag({ theme, className }: { theme: ThemeKey; className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 18 12" className={cn('h-3 w-[18px] shrink-0 rounded-[1px] ring-1 ring-navy/25', className)}>
      <Pattern theme={theme} />
    </svg>
  );
}
