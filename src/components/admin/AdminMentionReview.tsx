import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, ExternalLink, Loader2, RefreshCw, Tags } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LogoBadge } from '@/components/ui/CoverImage';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { htmlToText, mentionContext, suggestMentions, type MentionOrg } from '@/lib/companyMentions';
import { confirmMention, fetchMentionCandidates, fetchSkips, skipSuggestion } from '@/lib/mentionActions';
import type { Resource } from './types';
import { ADMIN_BTN, ADMIN_BTN_PRIMARY, AdminEmpty, AdminLoading, AdminPanel } from './AdminUI';

/**
 * Admin > Resources > "Company tags" (Victor, 20 Oct 2026: "when an article mentions a company
 * that is on the platform, tag it and send readers to its page; see how to make it as practical
 * as possible"). Every published article is scanned at once for the names of verified companies
 * (the same matching as the editor's "Companies mentioned" panel, src/lib/companyMentions.ts), so
 * M3 can tag the whole library in one pass instead of opening each article. Each suggestion shows
 * the words around the name; "Confirm" tags it (resource_organization_mention), "Not this one"
 * turns it down for good (resource_organization_mention_skip). Both are saved at once. New
 * articles show up here too, until each suggestion is answered.
 */

const pairKey = (resourceId: string, orgId: string) => `${resourceId}:${orgId}`;

export function AdminMentionReview({ resources }: { resources: Resource[] }) {
  const [candidates, setCandidates] = useState<MentionOrg[] | null>(null);
  // Answered pairs (confirmed or turned down): never shown here.
  const [answered, setAnswered] = useState<Set<string> | null>(null);
  const [confirmedCount, setConfirmedCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let alive = true;
    setError(null);
    (async () => {
      try {
        const [orgs, mentions, skips] = await Promise.all([
          fetchMentionCandidates(),
          supabase.from('resource_organization_mention').select('resource_id, organization_id').limit(5000)
            .then(({ data, error: e }) => { if (e) throw e; return (data ?? []) as { resource_id: string; organization_id: string }[]; }),
          fetchSkips(null),
        ]);
        if (!alive) return;
        setCandidates(orgs);
        setConfirmedCount(mentions.length);
        setAnswered(new Set([...mentions, ...skips].map((m) => pairKey(m.resource_id, m.organization_id))));
      } catch {
        if (!alive) return;
        setCandidates([]);
        setAnswered(new Set());
        setError('The company tags could not be loaded. Is the database change 20261020141000_resource_organization_mention installed?');
      }
    })();
    return () => { alive = false; };
  }, [reload]);

  // The readable text of each published article, once per list of resources.
  const texts = useMemo(
    () => resources
      .filter((r) => r.published)
      .map((r) => ({ r, text: [r.title, r.summary, htmlToText(r.content)].filter(Boolean).join(' \n ') })),
    [resources],
  );

  const groups = useMemo(() => {
    if (!candidates || !answered) return [];
    return texts
      .map(({ r, text }) => ({
        r,
        items: suggestMentions(text, candidates)
          .filter((s) => !answered.has(pairKey(r.id, s.org.id)))
          .map((s) => ({ ...s, context: mentionContext(text, s.org.name) })),
      }))
      .filter((g) => g.items.length > 0);
  }, [texts, candidates, answered]);

  const total = groups.reduce((n, g) => n + g.items.length, 0);

  const markAnswered = (resourceId: string, orgId: string) =>
    setAnswered((prev) => new Set(prev ?? []).add(pairKey(resourceId, orgId)));

  const confirm = async (r: Resource, org: MentionOrg): Promise<boolean> => {
    setBusy(pairKey(r.id, org.id));
    try {
      await confirmMention(r.id, org.id);
    } catch (e) {
      setBusy(null);
      toast({ title: 'Could not tag this company', description: (e as Error).message, variant: 'destructive' });
      return false;
    }
    setBusy(null);
    markAnswered(r.id, org.id);
    setConfirmedCount((n) => n + 1);
    return true;
  };

  const turnDown = async (r: Resource, org: MentionOrg) => {
    setBusy(pairKey(r.id, org.id));
    try {
      await skipSuggestion(r.id, org.id);
    } catch (e) {
      setBusy(null);
      toast({ title: 'Could not save "Not this one"', description: (e as Error).message, variant: 'destructive' });
      return;
    }
    setBusy(null);
    markAnswered(r.id, org.id);
  };

  const confirmAll = async (r: Resource, orgs: MentionOrg[]) => {
    for (const org of orgs) {
      // One at a time, in the order shown; stop at the first failure.
      if (!(await confirm(r, org))) return;
    }
  };

  if (!candidates || !answered) return <AdminLoading label="Scanning the articles…" />;

  return (
    <div className="space-y-4">
      <AdminPanel
        icon={Tags}
        title="Company tags to review"
        description={error ?? `${total} suggestion${total === 1 ? '' : 's'} in ${groups.length} article${groups.length === 1 ? '' : 's'} · ${confirmedCount} tag${confirmedCount === 1 ? '' : 's'} confirmed so far`}
        actions={(
          <Button variant="outline" size="sm" className={ADMIN_BTN} onClick={() => setReload((n) => n + 1)} aria-label="Scan again">
            <RefreshCw className="mr-1.5 h-4 w-4" /> Scan again
          </Button>
        )}
      >
        <p className="text-[14px] leading-6 text-ink">
          Every published article, checked against the names of the verified companies. <strong>Confirm</strong> tags the company:
          the first time its name appears in the article it links to the company page, the company is listed under the article,
          and the article shows under &ldquo;In the news&rdquo; on the company page. <strong>Not this one</strong> hides the
          suggestion for good (a common word, another company with the same name). Both are saved at once.
        </p>
      </AdminPanel>

      {!error && groups.length === 0 && (
        <AdminEmpty icon={Tags} title="Nothing to review" body="Every company name found in the published articles has been answered." />
      )}

      {groups.map(({ r, items }) => (
        <AdminPanel
          key={r.id}
          as="article"
          padded={false}
          title={(
            <Link to={`/admin/resources/${r.id}`} className="rounded-sm text-navy hover:underline focus:outline-none focus-visible:shadow-focus">
              {r.title}
            </Link>
          )}
          actions={(
            <>
              <a
                href={`/resources/${r.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[13px] font-semibold text-navy underline decoration-navy/30 underline-offset-4 hover:decoration-gold"
              >
                Article <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
              {items.length > 1 && (
                <Button size="sm" className={ADMIN_BTN_PRIMARY} disabled={!!busy} onClick={() => confirmAll(r, items.map((i) => i.org))}>
                  <Check className="mr-1.5 h-4 w-4" /> Confirm all {items.length}
                </Button>
              )}
            </>
          )}
        >
          <ul className="divide-y divide-rule">
            {items.map(({ org, count, context }) => {
              const key = pairKey(r.id, org.id);
              return (
                <li key={key} className="flex flex-wrap items-start gap-3 px-5 py-3.5">
                  <LogoBadge src={org.logo_url} name={org.name} size="sm" />
                  <div className="min-w-0 flex-1 basis-56">
                    <p className="text-[15px] font-semibold leading-5 text-navy [overflow-wrap:anywhere]">
                      {org.name}
                      <span className="ml-2 text-[13px] font-normal text-meta">{count} time{count > 1 ? 's' : ''}</span>
                    </p>
                    {context && (
                      <p className="mt-1 text-[13px] leading-5 text-meta [overflow-wrap:anywhere]">
                        {context.before}
                        <mark className="rounded-sm bg-gold/30 px-0.5 font-semibold text-navy">{context.match}</mark>
                        {context.after}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button size="sm" className={ADMIN_BTN_PRIMARY} onClick={() => confirm(r, org)} disabled={!!busy}>
                      {busy === key ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Check className="mr-1.5 h-4 w-4" />} Confirm
                    </Button>
                    <Button variant="outline" size="sm" className={ADMIN_BTN} onClick={() => turnDown(r, org)} disabled={!!busy}>
                      Not this one
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </AdminPanel>
      ))}
    </div>
  );
}
