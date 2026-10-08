import { useTranslation } from 'react-i18next';
import { TextTiles, type TextTileItem } from '@/components/organization/TextTiles';

// Oct 2026 refonte: nine long texts one after another made Ayla's page about
// 37,000 px tall. They are now tiles (TextTiles: icon, title, three lines, "Read
// more" opens the full text with its evidence photo on top). The data is read by
// useSM26MarinaTexts() (./useSM26MarinaTexts.ts) so the page knows whether the
// section exists: it gets a numbered heading and a pill in the section bar only then.

/** The line that says where the texts come from, then the tiles. Draws nothing without texts. */
export function SM26MarinaSustainability({ items }: { items: TextTileItem[] }) {
  const { t } = useTranslation();
  if (items.length === 0) return null;
  return (
    <div>
      <p className="-mt-2 mb-6 max-w-prose text-[15px] leading-6 text-meta">
        {t('orgProfile.sm26.source', "From this marina's submission to the Monaco Smart & Sustainable Marina Rendezvous 2026.")}
      </p>
      <TextTiles items={items} source={t('orgProfile.sm26.eyebrow', 'Smart Marina 2026 submission')} />
    </div>
  );
}
