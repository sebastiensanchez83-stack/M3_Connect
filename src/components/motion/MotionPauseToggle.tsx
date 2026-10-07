import { Pause, Play } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { useMotion } from './MotionProvider';

/**
 * The visible pause control for continuous motion (WCAG 2.2.2). One switch for
 * the whole site: pausing here also stops the waves in the footer, the marquee,
 * the departure board… Hidden when the visitor's system already asks for
 * reduced motion, since nothing loops then.
 *
 * It says what it will do ("Pause the animations" / "Play the animations") and
 * swaps its icon. It carries no aria-pressed: with a name that changes, that
 * would be read as "Play the animations, toggle button, pressed". The local
 * carousels (pontoon tag, departures board) follow the same pattern.
 *
 * The heroes show it WITH its words (`withLabel`), so the site-wide control
 * never looks like a carousel's own icon-only pause button.
 */
export function MotionPauseToggle({
  className,
  tone = 'dark',
  withLabel = false,
}: {
  className?: string;
  /** 'dark' = on navy or a photo (white icon); 'light' = on a light background. */
  tone?: 'dark' | 'light';
  /** Show the words next to the icon; icon only otherwise. */
  withLabel?: boolean;
}) {
  const { t } = useTranslation();
  const { reduced, paused, togglePaused } = useMotion();
  if (reduced) return null;
  const label = paused
    ? t('brand.motion.play', 'Play the animations')
    : t('brand.motion.pause', 'Pause the animations');
  const Icon = paused ? Play : Pause;
  return (
    <button
      type="button"
      onClick={togglePaused}
      aria-label={withLabel ? undefined : label}
      title={withLabel ? undefined : label}
      className={cn(
        'focus-ring inline-flex shrink-0 items-center gap-2 rounded-full text-sm font-medium transition-colors',
        // 44 px touch targets on phones.
        withLabel ? 'h-11 px-3.5 md:h-9 md:px-3' : 'h-11 w-11 justify-center md:h-10 md:w-10',
        tone === 'dark'
          ? 'bg-white/10 text-white ring-1 ring-inset ring-white/30 hover:bg-white/20'
          : 'bg-chip text-navy ring-1 ring-inset ring-rule hover:bg-white',
        className,
      )}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      {withLabel && <span>{label}</span>}
    </button>
  );
}
