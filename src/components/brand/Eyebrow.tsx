import type { ElementType, ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * The small line above a title: a 6 px dot (teal on light, gold on navy and
 * photos, so gold stays the colour of actions and markers on dark) and the
 * words in capitals, 13 px semibold, tracked at .08 em. White at 75 % on navy.
 *
 * `number` ("01", "02"…) puts a small gold section number before the dot, with
 * a short rule: gold text (#87681b) on light, gold (#d7a647) on navy, tabular
 * figures, hidden from screen readers (it only orders the page visually).
 */
export function SectionNo({
  number,
  tone = 'default',
  className,
}: {
  number: string;
  tone?: 'default' | 'onDark';
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn('inline-flex shrink-0 items-center gap-2 font-semibold tabular-nums', tone === 'onDark' ? 'text-gold' : 'text-gold-text', className)}
    >
      {number}
      <span className="h-px w-4 bg-current opacity-40" />
    </span>
  );
}

export function Eyebrow({
  children,
  tone = 'default',
  as: Tag = 'p',
  className,
  number,
}: {
  children: ReactNode;
  tone?: 'default' | 'onDark';
  as?: ElementType;
  className?: string;
  /** Section number ("01"): shown in gold before the dot. */
  number?: string;
}) {
  const dark = tone === 'onDark';
  return (
    <Tag
      className={cn(
        'flex items-center gap-2 text-[13px] font-semibold uppercase leading-4 tracking-[0.08em]',
        dark ? 'text-white/75' : 'text-meta',
        className,
      )}
    >
      {number && <SectionNo number={number} tone={tone} />}
      <span aria-hidden="true" className={cn('h-1.5 w-1.5 shrink-0 rounded-full', dark ? 'bg-gold' : 'bg-teal')} />
      {children}
    </Tag>
  );
}
