import { useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

// A hub section that folds. The event hub grew long enough that finding the one
// thing you came for meant scrolling past everything already dealt with, so a
// section that needs nothing from you starts closed and says so on its header.
// The whole header is the toggle — a chevron alone is too small a target on a
// phone, which is where most of this gets read.

interface Props {
  title: ReactNode;
  /** Shown on the right of the header, visible whether open or closed. */
  meta?: ReactNode;
  /** Shown under the title while open. */
  description?: ReactNode;
  /** Open on first render. Pass false for anything already complete. */
  defaultOpen?: boolean;
  /**
   * For sections whose content already draws its own Card. Renders just the
   * header bar, so folding never puts a card inside a card.
   */
  bare?: boolean;
  children: ReactNode;
}

export function SM26Foldable({ title, meta, description, defaultOpen = true, bare = false, children }: Props) {
  const [open, setOpen] = useState(defaultOpen);

  if (bare) {
    return (
      <div className="space-y-2">
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          className="w-full text-left flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3 hover:border-primary/40 transition-colors group"
        >
          <span className="font-semibold text-gray-900 flex items-center gap-2 flex-wrap group-hover:text-primary transition-colors">
            {title}
          </span>
          <span className="flex items-center gap-2 shrink-0">
            {meta}
            <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
          </span>
        </button>
        {open && children}
      </div>
    );
  }

  return (
    <Card>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="w-full text-left px-6 pt-5 pb-4 flex items-start justify-between gap-3 group"
      >
        <div className="min-w-0">
          <div className="font-semibold text-gray-900 flex items-center gap-2 flex-wrap group-hover:text-primary transition-colors">
            {title}
          </div>
          {open && description && <div className="text-sm text-gray-500 mt-1">{description}</div>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {meta}
          <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
        </div>
      </button>
      {open && <CardContent className="pt-0 space-y-4">{children}</CardContent>}
    </Card>
  );
}
