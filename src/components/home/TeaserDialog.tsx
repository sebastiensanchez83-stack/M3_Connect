import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Play } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { TEASER } from '@/lib/siteMedia';
import { cn } from '@/lib/utils';
import { TeaserVideo, useTeaserAvailable } from './TeaserVideo';

/**
 * "Watch the teaser" in the hero: a quiet button that opens the platform teaser
 * in a dialog and plays it, on click only. The 38 MB film is never a
 * background video, and nothing of it loads before the click (only a HEAD
 * request checks that the file exists). The button only appears once it does.
 * Closing the dialog (Escape, the close button, a click outside) stops the film
 * and returns focus to the button.
 */
export function TeaserButton({ className }: { className?: string }) {
  const { t } = useTranslation();
  const available = useTeaserAvailable();
  const [open, setOpen] = useState(false);
  if (!available) return null;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className={cn(
            'focus-ring group inline-flex h-12 items-center gap-3 rounded-pill pl-1.5 pr-4 text-[15px] font-semibold text-white transition-colors hover:bg-white/10',
            className,
          )}
        >
          <span className="grid h-9 w-9 place-items-center rounded-full bg-white/15 ring-1 ring-inset ring-white/40 transition-colors group-hover:bg-white group-hover:text-navy">
            <Play className="ml-0.5 h-4 w-4 fill-current" aria-hidden="true" />
          </span>
          {t('home.teaserWatch', 'Watch the teaser')}
          <span className="font-normal tabular text-white/85">{TEASER.duration}</span>
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-5xl gap-0 overflow-hidden border-0 bg-navy-deep p-0 text-white sm:rounded-card [&>button]:right-3 [&>button]:top-3 [&>button]:z-10 [&>button]:grid [&>button]:h-9 [&>button]:w-9 [&>button]:place-items-center [&>button]:rounded-full [&>button]:bg-white [&>button]:text-navy [&>button]:opacity-100">
        <DialogTitle className="sr-only">{t('homePage.hero.teaserTitle', 'Smart Marina Connect teaser')}</DialogTitle>
        {/* Mounted only while open: closing unmounts the player, which stops the film. */}
        {open && <TeaserVideo autoPlay className="rounded-none shadow-none ring-0" />}
      </DialogContent>
    </Dialog>
  );
}
