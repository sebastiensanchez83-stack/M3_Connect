import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

/**
 * A key figure, shown at its final value. Only real, live figures go through
 * it (networkStats), or a confirmed one ("250" participants).
 *
 * It used to count up from 0 when it scrolled into view; the design audit of
 * 8 Oct 2026 caught it mid-count ("more than 0", "127", "206 participants")
 * and asked for the final value straight away. The name and the props stay, so
 * the pages that use it did not change; `duration` is ignored.
 *
 * `value` may arrive late (null while loading): the placeholder shows until
 * then. Tabular figures, so neighbouring figures line up.
 */
export function Counter({
  value,
  format,
  suffix = '',
  placeholder = '—',
  className,
}: {
  value: number | null | undefined;
  /** @deprecated The figure no longer counts up; ignored. */
  duration?: number;
  /** Defaults to the locale's grouping (1,234 / 1 234). */
  format?: (n: number) => string;
  /** Appended after the number, e.g. "+" for an admin-typed figure. */
  suffix?: string;
  /** Shown while value is null. */
  placeholder?: string;
  className?: string;
}) {
  const { i18n } = useTranslation();
  const fmt = format ?? ((n: number) => n.toLocaleString(i18n.language === 'fr' ? 'fr-FR' : 'en-GB'));
  const text = value == null ? placeholder : `${fmt(value)}${suffix}`;
  return <span className={cn('tabular', className)}>{text}</span>;
}
