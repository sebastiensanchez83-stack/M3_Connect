import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * The round arrow of a card. At rest a white (or glass) disc with a navy (or
 * white) arrow; when its card is hovered or holds focus, a gold disc grows from
 * the centre while the arrow leaves to the right and a copy
 * enters from the left (.525 s, cubic-bezier(.625,.05,0,1)). The card
 * itself lifts 4 px and its picture scales to 1.05 (CardShell interactive).
 *
 * The trigger is the card: put `has-ra` (or `group`) on it; CardShell with
 * `interactive` does. Decorative (aria-hidden): the card's link carries the
 * words. Place it in a corner of the card (the notch card, resource and
 * article cards) or at the end of a row.
 *
 *   <CardShell interactive> … <ArrowDisc tone="light" className="absolute right-3 top-3" /> </CardShell>
 *
 * Tones: 'light' white disc on light cards, 'photo' frosted glass over a
 * photograph, 'navy' navy disc on light cards. Sizes: 'md' 46 px, 'sm' 36 px.
 */
export function ArrowDisc({
  tone = 'light',
  size = 'md',
  className,
}: {
  tone?: 'light' | 'photo' | 'navy';
  size?: 'sm' | 'md';
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'arrow-disc',
        size === 'sm' && 'arrow-disc--sm',
        tone === 'photo' && 'arrow-disc--photo',
        tone === 'navy' && 'arrow-disc--navy',
        className,
      )}
    >
      <ArrowRight className="ad-a1" strokeWidth={2.25} />
      <ArrowRight className="ad-a2" strokeWidth={2.25} />
    </span>
  );
}
