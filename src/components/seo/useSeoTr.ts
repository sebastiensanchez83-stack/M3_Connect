import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { SeoTr } from '@/lib/seoMeta';

/** The `seo.*` strings (src/i18n/seo.ts) in the reader's language, as the builders of src/lib/seoMeta.ts expect them. */
export function useSeoTr(): SeoTr {
  const { t } = useTranslation();
  return useCallback<SeoTr>((key, vars) => t(`seo.${key}`, { ...(vars ?? {}) }), [t]);
}
