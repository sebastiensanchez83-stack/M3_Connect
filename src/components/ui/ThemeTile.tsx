import type { LucideIcon } from 'lucide-react';
import { CoverImage } from '@/components/ui/CoverImage';
import { cn } from '@/lib/utils';

/**
 * A picture tile that opens a theme (src/lib/themes.ts) — or "All". Used as the
 * way into the resource library and the directory.
 *
 * The label sits on a navy wash rising from the bottom: a white label has to
 * read on a bright photo at ~180 px wide, which a generic black scrim did not
 * manage. The selected tile gets a navy ring (the earlier gold ring was 2:1 on
 * the light page and read as a focus outline).
 *
 * Lay several out in <ThemeTileRow>, which scrolls sideways on phones.
 */
export function ThemeTile({
  label,
  hint,
  count,
  active,
  seed,
  icon,
  image,
  focusY = 0.5,
  onClick,
}: {
  label: string;
  /** Shown as a tooltip: what the theme covers. */
  hint: string;
  count: number;
  active: boolean;
  seed: string;
  icon: LucideIcon;
  image: string | null;
  focusY?: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={hint}
      className={cn(
        'group relative w-44 shrink-0 snap-start overflow-hidden rounded-xl text-left transition lg:w-auto',
        'focus:outline-none focus-visible:ring-[3px] focus-visible:ring-secondary-dark focus-visible:ring-offset-2',
        active ? 'ring-[3px] ring-primary ring-offset-2 ring-offset-gray-50' : 'hover:-translate-y-0.5 hover:shadow-md',
      )}
    >
      <CoverImage
        src={image}
        focusY={focusY}
        alt=""
        seed={seed}
        icon={icon}
        aspect="wide"
        tone="sea"
        imageClassName="group-hover:scale-105"
      >
        <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-[#0b2653]/95 via-[#0b2653]/45 to-[#0b2653]/5" />
        <div className="absolute inset-x-0 bottom-0 p-3 text-white">
          <span className="block text-sm font-semibold leading-tight drop-shadow-sm">{label}</span>
          <span className="mt-0.5 block text-xs tabular-nums text-white/80">{count}</span>
        </div>
      </CoverImage>
    </button>
  );
}

/**
 * Seven tiles on one row from lg up; a sideways scroller below. py-2 keeps the
 * selection ring from being clipped by the scroller; scroll-px-4 keeps the
 * 16 px gutter after a swipe snaps a tile.
 */
export function ThemeTileRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="no-scrollbar -mx-4 flex snap-x scroll-px-4 gap-3 overflow-x-auto px-4 py-2 lg:mx-0 lg:grid lg:grid-cols-7 lg:overflow-visible lg:px-0">
      {children}
    </div>
  );
}
