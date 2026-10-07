import { forwardRef, type AnchorHTMLAttributes, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * The text link of the refonte: a 1 px rule at 30 % under the label; on hover
 * and keyboard focus a 2 px gold line grows from the left (.4 s) and the small
 * arrow nudges to the right (+80 ms). Defined once in smc-motion.css
 * (.uline, .uline-t, .uline-a): the same classes can be put on any element.
 *
 *   <UnderlineLink to="/events">All events</UnderlineLink>
 *   <UnderlineLink href="https://…" tone="light" external>Official site</UnderlineLink>
 *   <UnderlineLink onClick={open}>Sign up as a marina</UnderlineLink>     (a button)
 *
 * `to`: a page of this site (client-side navigation); `href`: any other link
 * (opens in a new tab with `external`); neither: a <button>.
 * tone 'dark' navy on light, 'light' white on navy and photos, 'footer' white 80 %
 * regular weight, no resting rule (the footer's link columns).
 * `arrow={false}` for no arrow; `plain` keeps only the gold line on
 * hover (footers, menus); `nav` is the header menu's flavour (inherits colour,
 * medium weight, no resting rule).
 */
interface Common {
  tone?: 'dark' | 'light' | 'footer';
  arrow?: boolean;
  plain?: boolean;
  nav?: boolean;
  external?: boolean;
  className?: string;
  children: ReactNode;
}

type AsLink = Common & { to: string; href?: never } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'children' | 'className'>;
type AsAnchor = Common & { href: string; to?: never } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'children' | 'className'>;
type AsButton = Common & { to?: never; href?: never } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'className'>;

export type UnderlineLinkProps = AsLink | AsAnchor | AsButton;

export const UnderlineLink = forwardRef<HTMLElement, UnderlineLinkProps>(function UnderlineLink(props, ref) {
  const { tone = 'dark', arrow = true, plain = false, nav = false, external = false, className, children, ...rest } = props as Common &
    Record<string, unknown>;
  const cls = cn('uline', (tone === 'light' || tone === 'footer') && 'uline--light', tone === 'footer' && 'uline--foot uline--plain', plain && 'uline--plain', nav && 'uline--nav', className);
  const inner = (
    <>
      <span className="uline-t">{children}</span>
      {arrow && !nav && <ArrowRight className="uline-a" strokeWidth={2.25} aria-hidden="true" />}
      {external && <span className="sr-only"> (opens in a new tab)</span>}
    </>
  );
  const { to, href, ...others } = rest as { to?: string; href?: string } & Record<string, unknown>;
  if (typeof to === 'string') {
    return (
      <Link ref={ref as React.Ref<HTMLAnchorElement>} to={to} className={cls} {...(others as object)}>
        {inner}
      </Link>
    );
  }
  if (typeof href === 'string') {
    return (
      <a
        ref={ref as React.Ref<HTMLAnchorElement>}
        href={href}
        className={cls}
        {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : null)}
        {...(others as object)}
      >
        {inner}
      </a>
    );
  }
  return (
    <button ref={ref as React.Ref<HTMLButtonElement>} type="button" className={cls} {...(others as object)}>
      {inner}
    </button>
  );
});
