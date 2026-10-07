import { cn } from '@/lib/utils';
import { Eyebrow } from '@/components/brand/Eyebrow';
import { UnderlineLink } from '@/components/brand/UnderlineLink';
import { LineReveal } from '@/components/motion/LineReveal';
import { Reveal } from '@/components/motion/Reveal';

/**
 * The heading of a home page section: dot eyebrow, an H2 whose lines rise out
 * of their mask (26/32 on phones, 40/48 from md; 22/28 for a side column), an
 * optional intro, and an optional "see all" underline link on the right (under
 * the title on phones).
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
  /** 'section' = H2 26/32 → 40/48; 'column' = H3 22/28, for a side column. */
  size?: 'section' | 'column';
  className?: string;
}) {
  const dark = tone === 'dark';
  return (
    <div className={cn('flex flex-wrap items-end justify-between gap-x-8 gap-y-4', className)}>
      <div className="max-w-3xl">
        {eyebrow && (
          <Reveal>
            <Eyebrow tone={dark ? 'onDark' : 'default'}>{eyebrow}</Eyebrow>
          </Reveal>
        )}
        <LineReveal
          as="h2"
          id={id}
          className={cn(
            eyebrow && (size === 'section' ? 'mt-4' : 'mt-2'),
            size === 'section'
              ? 'text-balance text-[26px] font-semibold leading-8 tracking-[-0.02em] md:text-[40px] md:leading-[48px]'
              : 'text-[22px] font-semibold leading-7 tracking-[-0.01em]',
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
      {link && (
        <Reveal delay={160}>
          <TextLink to={link.to} tone={dark ? 'dark' : 'light'}>
            {link.label}
          </TextLink>
        </Reveal>
      )}
    </div>
  );
}

/** The refonte's text link (gold line growing from the left, arrow). `tone="dark"` = on navy. */
export function TextLink({
  to,
  children,
  tone = 'light',
  className,
}: {
  to: string;
  children: React.ReactNode;
  /** 'light' = a light page (navy link); 'dark' = a navy panel or photo (white link). */
  tone?: 'light' | 'dark';
  className?: string;
}) {
  return (
    <UnderlineLink to={to} tone={tone === 'dark' ? 'light' : 'dark'} className={className}>
      {children}
    </UnderlineLink>
  );
}
