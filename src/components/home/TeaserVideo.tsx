import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Play } from 'lucide-react';
import { TEASER } from '@/lib/siteMedia';
import { cn } from '@/lib/utils';

/**
 * The platform teaser, for visitors who are not signed in.
 *
 * Nothing is downloaded until the visitor asks: the frame shows a still from
 * the film (a local 94 KB JPEG), and the 38 MB video only starts streaming on
 * click — with sound, which browsers allow after a click.
 *
 * Before offering the play button the component asks the storage bucket, with
 * a HEAD request, whether the file is there. Until it is (upload pending, file
 * renamed, bucket emptied) the still stays on its own as an illustration — the
 * page never shows a play button that leads nowhere, and the layout does not
 * jump when the answer comes back.
 */
export function TeaserVideo({ className }: { className?: string }) {
  const { t } = useTranslation();
  const [available, setAvailable] = useState(false);
  const [playing, setPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    let alive = true;
    fetch(TEASER.src, { method: 'HEAD' })
      .then((res) => { if (alive) setAvailable(res.ok); })
      .catch(() => { /* offline or blocked: keep the still */ });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (playing) videoRef.current?.play().catch(() => { /* the controls are there to retry */ });
  }, [playing]);

  return (
    <div
      className={cn(
        'relative aspect-video w-full overflow-hidden rounded-2xl bg-[#0b2653] shadow-2xl ring-1 ring-white/20',
        className,
      )}
    >
      {playing ? (
        <video
          ref={videoRef}
          src={TEASER.src}
          poster={TEASER.poster}
          controls
          playsInline
          preload="auto"
          className="h-full w-full bg-black"
          onError={() => { setPlaying(false); setAvailable(false); }}
        >
          {t('home.teaserUnsupported', 'Your browser cannot play this video.')}
        </video>
      ) : (
        <>
          <img
            src={TEASER.poster}
            alt={t('home.teaserPosterAlt', 'Smart Marina Connect: marinas, operators, suppliers, investors and authorities around one platform')}
            className="h-full w-full object-cover"
            loading="eager"
            decoding="async"
          />
          {available && (
            <button
              type="button"
              onClick={() => setPlaying(true)}
              aria-label={t('home.teaserPlay', { duration: TEASER.duration, defaultValue: 'Play the Smart Marina Connect teaser ({{duration}})' })}
              className="group absolute inset-0 flex items-end justify-start bg-gradient-to-t from-black/45 via-black/0 to-black/0 p-4 text-left focus:outline-none focus-visible:ring-4 focus-visible:ring-secondary sm:p-5"
            >
              <span className="inline-flex items-center gap-3 rounded-full bg-white/95 py-2 pl-2 pr-4 text-sm font-semibold text-primary shadow-lg transition group-hover:bg-white group-hover:shadow-xl">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-secondary text-primary transition-transform group-hover:scale-110">
                  <Play className="ml-0.5 h-4 w-4 fill-current" aria-hidden="true" />
                </span>
                {t('home.teaserWatch', 'Watch the teaser')}
                <span className="font-normal tabular-nums text-gray-500">{TEASER.duration}</span>
              </span>
            </button>
          )}
        </>
      )}
    </div>
  );
}
