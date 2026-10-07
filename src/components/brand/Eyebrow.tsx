import type { ElementType, ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * The small line above a title, in SMC's harbour-signage voice: a short teal
 * waterline (a two-crest tilde, the same wave as the heroes' edges) and caps in
 * Barlow Semi Condensed. On navy or photos (`tone="onDark"`) the words turn
 * white at 80 % and the wave light teal, so gold stays reserved for actions.
 */
export function WaveMark({ className, tone = 'default' }: { className?: string; tone?: 'default' | 'onDark' }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 8"
      className={cn('h-2 w-4 shrink-0', tone === 'onDark' ? 'text-[#7fc8d4]' : 'text-teal', className)}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    >
      <path d="M1 5.2C3 1.6 5 1.6 6.9 4.2S10.8 6.8 12.8 3.4 15 2.4 15 2.4" />
    </svg>
  );
}

export function Eyebrow({
  children,
  tone = 'default',
  as: Tag = 'p',
  className,
}: {
  children: ReactNode;
  tone?: 'default' | 'onDark';
  as?: ElementType;
  className?: string;
}) {
  return (
    <Tag
      className={cn(
        'flex items-center gap-2 font-signage text-[13px] font-semibold uppercase leading-4 tracking-[0.1em]',
        tone === 'onDark' ? 'text-white/80' : 'text-meta',
        className,
      )}
    >
      <WaveMark tone={tone} />
      {children}
    </Tag>
  );
}
