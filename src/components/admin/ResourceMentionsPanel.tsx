import { useEffect, useMemo, useState } from 'react';
import { Building2, Check, ExternalLink, Loader2, Plus, Search, X } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { LogoBadge } from '@/components/ui/CoverImage';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import {
  countMentions, foldName, htmlToText, isMatchableName, mentionHref, suggestMentions, type MentionOrg,
} from '@/lib/companyMentions';

/**
 * "Companies mentioned" in the article editor (Victor, 20 Oct 2026). The panel reads the title,
 * the summary and the text as they are being typed, and proposes the verified companies whose
 * name appears in them (whole words, any case; see src/lib/companyMentions.ts for the rules).
 * One click confirms a company; any other one can be added by searching. Confirmed mentions are
 * saved at once in resource_organization_mention (M3 staff only, by the database), separately
 * from "Save Changes": the article's HTML is never modified. Readers then see the first
 * occurrence of each name linked to the company page, and a "Companies in this article" row;
 * the company page lists the article under "In the news" (public, published articles only).
 */

interface Confirmed extends MentionOrg {
  listed: boolean;
}

type OrgRow = MentionOrg & { access_status?: string | null; archived_at?: string | null; duplicate_of?: string | null };

export function ResourceMentionsPanel({
  resourceId,
  title,
  summary,
  content,
}: {
  /** Null while the article has never been saved: suggestions only. */
  resourceId: string | null;
  title: string;
  summary: string;
  content: string;
}) {
  const [candidates, setCandidates] = useState<MentionOrg[] | null>(null);
  const [confirmed, setConfirmed] = useState<Confirmed[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [text, setText] = useState('');
  // The article's own text only: where the first occurrence becomes a link (not the title or summary).
  const [bodyText, setBodyText] = useState('');

  // The verified companies, once (names, for the scan and the search).
  useEffect(() => {
    let alive = true;
    supabase
      .from('organizations')
      .select('id, name, slug, logo_url, organization_type')
      .eq('access_status', 'verified')
      .is('archived_at', null)
      .is('duplicate_of', null)
      .order('name')
      .limit(2000)
      .then(({ data, error }) => {
        if (!alive) return;
        if (error) { setCandidates([]); setLoadError('The companies could not be loaded. Reload the page to tag companies.'); return; }
        setCandidates(((data ?? []) as MentionOrg[]).filter((o) => o.slug));
      });
    return () => { alive = false; };
  }, []);

  // What is already confirmed for this article.
  useEffect(() => {
    if (!resourceId) { setConfirmed([]); return; }
    let alive = true;
    supabase
      .from('resource_organization_mention')
      .select('organization_id, organizations(id, name, slug, logo_url, organization_type, access_status, archived_at, duplicate_of)')
      .eq('resource_id', resourceId)
      .then(({ data, error }) => {
        if (!alive) return;
        if (error) { setLoadError('The mentions could not be loaded (is the database change installed?).'); return; }
        setConfirmed(
          ((data ?? []) as unknown as { organizations: OrgRow | OrgRow[] | null }[])
            .map((r) => (Array.isArray(r.organizations) ? r.organizations[0] : r.organizations))
            .filter((o): o is OrgRow => !!o)
            .map((o) => ({
              id: o.id, name: o.name, slug: o.slug, logo_url: o.logo_url, organization_type: o.organization_type,
              listed: o.access_status === 'verified' && !o.archived_at && !o.duplicate_of,
            }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        );
      });
    return () => { alive = false; };
  }, [resourceId]);

  // The text to scan, a moment after the typing stops.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const body = htmlToText(content);
      setBodyText(body);
      setText([title, summary, body].filter(Boolean).join(' \n '));
    }, 400);
    return () => window.clearTimeout(timer);
  }, [title, summary, content]);

  const confirmedIds = useMemo(() => new Set(confirmed.map((c) => c.id)), [confirmed]);
  const suggestions = useMemo(
    () => (candidates ? suggestMentions(text, candidates).filter((s) => !confirmedIds.has(s.org.id) && !dismissed.includes(s.org.id)) : []),
    [candidates, text, confirmedIds, dismissed],
  );
  const results = useMemo(() => {
    const q = foldName(query);
    if (!candidates || q.length < 2) return [];
    return candidates.filter((o) => !confirmedIds.has(o.id) && foldName(o.name).includes(q)).slice(0, 8);
  }, [candidates, query, confirmedIds]);

  const add = async (org: MentionOrg) => {
    if (!resourceId) return;
    setBusy(org.id);
    const { error } = await supabase.from('resource_organization_mention').insert({ resource_id: resourceId, organization_id: org.id });
    setBusy(null);
    if (error && error.code !== '23505') {
      toast({ title: 'Could not tag this company', description: error.message, variant: 'destructive' });
      return;
    }
    setConfirmed((prev) => (prev.some((c) => c.id === org.id) ? prev : [...prev, { ...org, listed: true }].sort((a, b) => a.name.localeCompare(b.name))));
    setQuery('');
  };

  const addAll = async () => {
    for (const s of suggestions) {
      // One at a time, in the order shown.
      await add(s.org);
    }
  };

  const remove = async (org: Confirmed) => {
    if (!resourceId) return;
    setBusy(org.id);
    const { error } = await supabase.from('resource_organization_mention').delete().eq('resource_id', resourceId).eq('organization_id', org.id);
    setBusy(null);
    if (error) {
      toast({ title: 'Could not remove this company', description: error.message, variant: 'destructive' });
      return;
    }
    setConfirmed((prev) => prev.filter((c) => c.id !== org.id));
  };

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-sm font-bold text-gray-700 flex items-center gap-2">
            <Building2 className="h-4 w-4 text-blue-500" /> Companies mentioned ({confirmed.length})
          </CardTitle>
          {suggestions.length > 1 && resourceId && (
            <Button variant="outline" size="sm" onClick={addAll} disabled={!!busy} className="gap-1.5">
              <Check className="h-3.5 w-3.5" /> Confirm all {suggestions.length}
            </Button>
          )}
        </div>
        <p className="text-xs text-gray-500">
          The first time each confirmed company appears in the text, readers can click it to open its page, and the companies are listed under the article.
          Saved at once (no need to press Save Changes); the article text itself is not changed.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        {loadError && <p className="text-sm text-red-600">{loadError}</p>}
        {!resourceId && (
          <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Create the resource first, then confirm the companies it mentions.
          </p>
        )}

        {/* Confirmed */}
        {confirmed.length > 0 && (
          <ul className="space-y-2">
            {confirmed.map((c) => {
              const n = countMentions(bodyText, c.name);
              const elsewhere = n === 0 && countMentions(text, c.name) > 0;
              return (
                <li key={c.id} className="flex flex-wrap items-center gap-3 rounded-lg border bg-white p-2.5">
                  <LogoBadge src={c.logo_url} name={c.name} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-gray-800">{c.name}</p>
                    <p className="text-xs text-gray-500">
                      {!c.listed
                        ? 'Not shown to readers: this company is not verified, or it is archived or merged.'
                        : n > 0
                          ? `In the text ${n} time${n > 1 ? 's' : ''}: the first one links to its page (never inside a heading or an existing link)`
                          : elsewhere
                            ? 'In the title or summary only: listed under the article'
                            : isMatchableName(c.name)
                              ? 'Not found in the text: listed under the article only'
                              : 'Name too short or too common to link in the text: listed under the article only'}
                    </p>
                  </div>
                  <a href={mentionHref(c.slug)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-blue-600 underline">
                    Page <ExternalLink className="h-3 w-3" />
                  </a>
                  <Button variant="ghost" size="sm" onClick={() => remove(c)} disabled={busy === c.id} className="gap-1 text-red-600">
                    {busy === c.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />} Remove
                  </Button>
                </li>
              );
            })}
          </ul>
        )}

        {/* Suggestions from the text */}
        <div className="space-y-2">
          <p className="text-sm font-medium text-gray-600">Found in the text</p>
          {candidates === null ? (
            <p className="flex items-center gap-2 text-sm text-gray-400"><Loader2 className="h-4 w-4 animate-spin" /> Loading the companies…</p>
          ) : suggestions.length === 0 ? (
            <p className="text-sm italic text-gray-400">No other verified company name found in the title, summary or text.</p>
          ) : (
            <ul className="space-y-2">
              {suggestions.map(({ org, count }) => (
                <li key={org.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed bg-gray-50 p-2.5">
                  <LogoBadge src={org.logo_url} name={org.name} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-gray-800">{org.name}</p>
                    <p className="text-xs text-gray-500">{count} time{count > 1 ? 's' : ''} in the text</p>
                  </div>
                  <Badge variant="outline" className="text-xs">Suggested</Badge>
                  <Button size="sm" onClick={() => add(org)} disabled={!resourceId || busy === org.id} className="gap-1">
                    {busy === org.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Confirm
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setDismissed((d) => [...d, org.id])} className="text-gray-500">
                    Not this one
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Add one by name */}
        <div className="space-y-2">
          <p className="text-sm font-medium text-gray-600">Add another company</p>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search a verified company by name…"
              className="pl-9"
              disabled={!resourceId}
              aria-label="Search a verified company by name"
            />
          </div>
          {results.length > 0 && (
            <ul className="max-h-64 overflow-y-auto rounded border bg-white shadow-sm">
              {results.map((o) => (
                <li key={o.id}>
                  <button
                    type="button"
                    onClick={() => add(o)}
                    disabled={busy === o.id}
                    className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-gray-100"
                  >
                    <LogoBadge src={o.logo_url} name={o.name} size="sm" />
                    <span className="flex-1 font-medium">{o.name}</span>
                    <Plus className="h-4 w-4 text-gray-400" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {query.trim().length >= 2 && results.length === 0 && candidates && (
            <p className="text-xs text-gray-400">No verified company with that name (or it is already tagged).</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
