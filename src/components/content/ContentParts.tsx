import { useEffect, useRef, type ReactNode } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Eyebrow } from '@/components/brand/Eyebrow';
import { LineReveal } from '@/components/motion/LineReveal';
import { Reveal } from '@/components/motion/Reveal';
import { useParallax } from '@/components/motion/useParallax';

/**
 * Small pieces shared by the content and static pages (library, About, Contact,
 * Join, 404), so each page keeps the home page's rhythm: a dot eyebrow with a
 * gold section number, an H2 whose lines rise out of their mask, one intro line.
 */

/**
 * The heading of a section: eyebrow (with its number), an H2 (26/32 on phones,
 * 40/48 from md) and an optional intro. `title` is plain text: LineReveal splits
 * it into words.
 */
export function SectionHead({
  id,
  number,
  eyebrow,
  title,
  intro,
  tone = 'light',
  className,
}: {
  id: string;
  number?: string;
  eyebrow?: string;
  title: string;
  intro?: string;
  tone?: 'light' | 'dark';
  className?: string;
}) {
  const dark = tone === 'dark';
  return (
    <div className={cn('max-w-3xl', className)}>
      {eyebrow && (
        <Reveal>
          <Eyebrow number={number} tone={dark ? 'onDark' : 'default'}>
            {eyebrow}
          </Eyebrow>
        </Reveal>
      )}
      <LineReveal
        as="h2"
        id={id}
        className={cn(
          eyebrow && 'mt-4',
          'text-balance text-[26px] font-semibold leading-8 tracking-[-0.02em] md:text-[40px] md:leading-[48px]',
          dark ? 'text-white' : 'text-navy',
        )}
      >
        {title}
      </LineReveal>
      {intro && (
        <Reveal as="p" delay={120} className={cn('mt-3 max-w-2xl text-body md:text-body-lg', dark ? 'text-white/80' : 'text-ink')}>
          {intro}
        </Reveal>
      )}
    </div>
  );
}

/** A list of what a profile can do: a teal tick on foam, then the sentence. */
export function CheckList({ items, className }: { items: ReactNode[]; className?: string }) {
  return (
    <ul className={cn('grid gap-3', className)}>
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-3 text-body text-ink">
          <span aria-hidden="true" className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-pill bg-foam text-teal-text">
            <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
          </span>
          <span className="min-w-0">{item}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * A photo in a rounded frame (16 px) whose picture drifts a little as the page
 * scrolls (24 px at most, never under reduced motion). `aspect` is a Tailwind
 * aspect class.
 */
export function PhotoFrame({
  src,
  focusY = 0.5,
  aspect = 'aspect-[4/3]',
  className,
  children,
}: {
  src: string | null;
  focusY?: number;
  aspect?: string;
  className?: string;
  children?: ReactNode;
}) {
  const pxRef = useRef<HTMLDivElement>(null);
  useParallax(pxRef, { max: 24 });
  return (
    <div className={cn('relative isolate overflow-hidden rounded-card bg-navy', aspect, className)}>
      <div aria-hidden="true" className="absolute inset-0 -z-20 bg-[linear-gradient(135deg,#081d40,#1f7a8c)]" />
      <div ref={pxRef} aria-hidden="true" className="absolute inset-x-0 -bottom-6 -top-6 -z-10">
        {src && (
          <img
            src={src}
            alt=""
            loading="lazy"
            decoding="async"
            className="h-full w-full max-w-none object-cover"
            style={{ objectPosition: `50% ${Math.round(focusY * 100)}%` }}
          />
        )}
      </div>
      {children}
    </div>
  );
}

/**
 * Scrolls to the element a URL hash names (/join#media) once the page
 * has mounted: React Router does not do it, and the target is rendered after the
 * route changes. The root's scroll-padding (index.css) keeps it clear of the header.
 */
export function useScrollToHash(hash: string, reduced: boolean) {
  useEffect(() => {
    const id = decodeURIComponent(hash.replace(/^#/, ''));
    if (!id) return;
    const frame = requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
    });
    return () => cancelAnimationFrame(frame);
  }, [hash, reduced]);
}
