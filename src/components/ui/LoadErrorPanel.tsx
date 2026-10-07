import { AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import '@/i18n/refonte-tech';

/**
 * What a list shows when the database could not be read: the directory's error
 * panel (DirectoryPage), shared. A failed read is not "no result": showing
 * "0 events" or "0 resources" told visitors, and Google, that the page is empty.
 * Same markup as the directory's: an alert card, a pictogram, what happened and
 * a button to try again.
 */
export function LoadErrorPanel({
  title,
  body,
  onRetry,
}: {
  /** What could not be loaded, as a sentence ("The events could not be loaded."). */
  title: string;
  /** Defaults to "Check your connection, then try again." */
  body?: string;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div role="alert" className="mx-auto max-w-xl rounded-card border border-rule bg-white px-6 py-12 text-center">
      <span className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-pill bg-chip text-navy">
        <AlertTriangle className="h-6 w-6" aria-hidden="true" />
      </span>
      <p className="text-h3 text-navy">{title}</p>
      <p className="mt-2 text-body text-meta">{body ?? t('loadError.body', 'Check your connection, then try again.')}</p>
      <Button variant="ctaNavy" className="mt-6" onClick={onRetry}>
        {t('loadError.retry', 'Try again')}
      </Button>
    </div>
  );
}
