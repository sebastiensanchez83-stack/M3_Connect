import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { EyeOff } from 'lucide-react';
import { TextTiles, type TextTileItem } from '@/components/organization/TextTiles';
import { UnderlineLink } from '@/components/brand/UnderlineLink';
import { externalUrl } from '@/lib/externalUrl';
import { memberHomeHref } from '@/lib/accountNav';
import {
  KIND_LABEL, SECTIONS, fetchShowcase, fetchShowcaseSettings, showcaseLinks,
  type Showcase, type ShowcaseBlock, type ShowcaseSettings,
} from '@/lib/sm26Showcase';

/**
 * The company's Smart Marina 2026 texts on its page (Victor, 20 Oct 2026): the e-catalogue and
 * jury dossier of a startup, or the entry of an architecture practice, as tiles ("Read more"
 * opens the full text, like the marinas' sustainability texts), then its links. What is public
 * is decided by the database (src/lib/sm26Showcase.ts); the company chooses what shows from its
 * dashboard (My company, "Smart Marina 2026 details").
 */

/** Where a company manages what shows: My company on the dashboard, at its row. */
export const SHOWCASE_SETTINGS_HREF = memberHomeHref('company', 'sm26');

/**
 * The public texts of a company (anyone), and for its own members whether they have entries
 * that the page does not show. `loaded` turns true once the reads are over.
 */
export function useSM26Showcase(orgId: string | null, isOwnMember: boolean): {
  loaded: boolean;
  showcase: Showcase | null;
  /** Own members only: the company has SM26 texts that are hidden from this page right now. */
  hiddenForOwner: boolean;
} {
  const [state, setState] = useState<{ key: string; showcase: Showcase | null; settings: ShowcaseSettings | null } | null>(null);
  const key = `${orgId ?? ''}:${isOwnMember}`;
  useEffect(() => {
    if (!orgId) return;
    let alive = true;
    (async () => {
      const [showcase, settings] = await Promise.all([
        fetchShowcase(orgId),
        isOwnMember ? fetchShowcaseSettings(orgId) : Promise.resolve(null),
      ]);
      if (alive) setState({ key, showcase, settings });
    })().catch(() => { if (alive) setState({ key, showcase: null, settings: null }); });
    return () => { alive = false; };
  }, [orgId, isOwnMember, key]);
  const current = state && state.key === key ? state : null;
  const settings = current?.settings ?? null;
  const hiddenForOwner = !!settings && !current?.showcase
    && settings.entries.some((e) => Object.keys(e.sections ?? {}).length > 0);
  return { loaded: !orgId || !!current, showcase: current?.showcase ?? null, hiddenForOwner };
}

/** The tiles of one block, in reading order (links and the architect's field are not tiles). */
function tilesOf(block: ShowcaseBlock): TextTileItem[] {
  return SECTIONS[block.kind]
    .filter((s) => s.key !== 'links' && s.key !== 'domain')
    .map((s) => ({ def: s, text: (block.sections[s.key as Exclude<typeof s.key, 'links'>] ?? '').trim() }))
    .filter((x) => x.text.length > 0)
    .map((x) => ({ key: `${block.kind}-${x.def.key}`, title: x.def.title, text: x.text, icon: x.def.icon }));
}

/** How many tiles a showcase has (the section bar's count). */
export function showcaseCount(showcase: Showcase | null): number {
  if (!showcase) return 0;
  return showcase.blocks.reduce((n, b) => n + tilesOf(b).length, 0);
}

export function SM26ShowcaseBlocks({ showcase, name, canManage }: { showcase: Showcase; name: string; canManage: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-10">
      {showcase.blocks.map((block) => {
        const tiles = tilesOf(block);
        const links = showcaseLinks(block.sections.links);
        const domain = (block.sections.domain ?? '').trim();
        return (
          <div key={block.kind}>
            <p className="-mt-2 mb-6 max-w-prose text-[15px] leading-6 text-meta">
              {block.kind === 'startup'
                ? t('orgProfile.sm26show.sourceStartup', "From {{name}}'s innovation dossier for the Monaco Smart & Sustainable Marina Rendezvous 2026 (e-catalogue and jury).", { name })
                : t('orgProfile.sm26show.sourceArchitect', "From {{name}}'s entry to the architecture competition of the Monaco Smart & Sustainable Marina Rendezvous 2026.", { name })}
            </p>
            {domain && (
              <p className="mb-5 flex flex-wrap items-center gap-2 text-[15px] leading-6 text-ink">
                <span className="text-meta-caps">{t('orgProfile.sm26show.field', 'Field')}</span>
                <span className="inline-flex h-8 items-center rounded-pill bg-chip px-3.5 text-sm font-medium text-navy">{domain}</span>
              </p>
            )}
            {tiles.length > 0 && (
              <TextTiles items={tiles} source={t(`orgProfile.sm26show.kind.${block.kind}`, KIND_LABEL[block.kind])} />
            )}
            {links.length > 0 && (
              <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3">
                <span className="text-meta-caps">{t('orgProfile.sm26show.links', 'Links')}</span>
                {links.map((l) => {
                  const href = externalUrl(l.url);
                  return href ? (
                    <UnderlineLink key={l.key} href={href} external className="!text-[15px]">
                      {l.label}
                    </UnderlineLink>
                  ) : null;
                })}
              </div>
            )}
          </div>
        );
      })}
      {canManage && (
        <p className="text-[14px] leading-5 text-meta">
          {t('orgProfile.sm26show.ownNote', 'Your company chooses what shows here.')}{' '}
          <Link to={SHOWCASE_SETTINGS_HREF} className="font-semibold text-navy underline decoration-navy/30 underline-offset-4 hover:decoration-gold">
            {t('orgProfile.sm26show.manage', 'Choose what shows')}
          </Link>
        </p>
      )}
    </div>
  );
}

/** For the company's own members: their Smart Marina 2026 texts exist but the page hides them. */
export function SM26ShowcaseHiddenNote() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-4 rounded-card border border-dashed border-rule bg-white/70 p-5 sm:flex-row sm:items-center sm:p-6">
      <span aria-hidden="true" className="grid h-11 w-11 shrink-0 place-items-center rounded-pill bg-foam text-teal">
        <EyeOff className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-card-title text-navy">{t('orgProfile.sm26show.hiddenTitle', 'Your Smart Marina 2026 details are not shown here')}</p>
        <p className="mt-1 text-[15px] leading-6 text-meta">
          {t('orgProfile.sm26show.hiddenBody', 'Only your company sees this note. Choose whether visitors see the texts you sent for the e-catalogue and the jury.')}
        </p>
      </div>
      <UnderlineLink to={SHOWCASE_SETTINGS_HREF} className="shrink-0 !text-[15px]">
        {t('orgProfile.sm26show.choose', 'Choose what shows')}
      </UnderlineLink>
    </div>
  );
}
