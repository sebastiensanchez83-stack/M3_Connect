import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Eyebrow } from '@/components/brand/Eyebrow';
import { LineReveal } from '@/components/motion/LineReveal';
import { Reveal } from '@/components/motion/Reveal';

/**
 * The heading of a home page section: teal-dot eyebrow, an H2 whose lines rise
 * out of their mask, an optional intro, and an optional "see all" link on the
 * right (under the title on phones).
 */
export function HomeHeading({
  id,
  eyebrow,
  title,
  intro,
  link,
  tone = 'light',
  size = 'section',
  className,
}: {
  id: string;
  eyebrow?: string;
  title: string;
  intro?: string;
  link?: { to: string; label: string };
  tone?: 'light' | 'dark';
  /** 'section' = H2 32/40 (24/30 on phones); 'column' = H3 size, for a side column. */
  size?: 'section' | 'column';
  className?: string;
}) {
  const dark = tone === 'dark';
  return (
    <div className={cn('flex flex-wrap items-end justify-between gap-x-8 gap-y-4', className)}>
      <div className="max-w-3xl">
        {eyebrow && <Eyebrow tone={dark ? 'onDark' : 'default'}>{eyebrow}</Eyebrow>}
        <LineReveal
          as="h2"
          id={id}
          className={cn(
            eyebrow && 'mt-3',
            size === 'section' ? 'text-h2-sm md:text-h2' : 'text-h3',
            dark ? 'text-white' : 'text-navy',
          )}
        >
          {title}
        </LineReveal>
        {intro && (
          <Reveal as="p" delay={120} className={cn('mt-3 max-w-2xl text-body md:text-body-lg', dark ? 'text-white/80' : 'text-meta')}>
            {intro}
          </Reveal>
        )}
      </div>
      {link && <TextLink to={link.to} tone={tone}>{link.label}</TextLink>}
    </div>
  );
}

/** A quiet text link with an arrow that nudges on hover and keyboard focus. */
export function TextLink({
  to,
  children,
  tone = 'light',
  className,
}: {
  to: string;
  children: React.ReactNode;
  tone?: 'light' | 'dark';
  className?: string;
}) {
  return (
    <Link
      to={to}
      className={cn(
        'focus-ring group inline-flex min-h-10 items-center gap-1.5 rounded-field text-sm font-semibold underline-offset-4 hover:underline',
        tone === 'dark' ? 'text-white' : 'text-navy',
        className,
      )}
    >
      {children}
      <ArrowRight
        className="h-4 w-4 shrink-0 transition-transform duration-300 ease-out-smc group-hover:translate-x-[3px] group-focus-visible:translate-x-[3px]"
        aria-hidden="true"
      />
    </Link>
  );
}
