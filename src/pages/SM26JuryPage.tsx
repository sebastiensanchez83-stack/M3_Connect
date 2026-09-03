import { useState, useEffect, useRef } from 'react';
import { Helmet } from 'react-helmet-async';
import {
  RefreshCw, ArrowLeft, Scale, CheckCircle, Loader2, AlertTriangle, Lock, ChevronRight, ChevronLeft, ExternalLink, Lightbulb, Download, Languages, X, Maximize2,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { requireFreshSession } from '@/lib/session';
import { toast } from '@/hooks/use-toast';
import { SM26AssetGallery } from '@/components/sm26/SM26AssetGallery';
import { SM26MyJurySchedule } from '@/components/sm26/SM26MyJurySchedule';

// Juror scoring (Area 3). Lists the entries M3 assigned to the signed-in juror,
// and scores each on the right versioned scorecard (innovation: stage picks the
// card; architecture: 7 criteria, anonymised). Only confirmed jurors can write
// (RLS); the official Awards Score is computed from these reviews.

interface Entry {
  entry_id: string; competition: string; mandatory: boolean;
  title: string; subtitle: string; stage: string | null; template_key: string;
  review_status: string | null; review_total: number | null; confidence: number | null; coi_flag: boolean | null;
}
// One file a juror can look at without leaving the scorecard. `kind` decides how
// it renders: panels and the notice are PDFs (A2/A3 at 300 dpi), the optional
// animation is video.
interface PreviewItem { path: string; label: string; kind: string }

interface Criterion { id: string; label: string; description: string | null; weight: number; critical: boolean; display_order: number; }
interface Template { id: string; competition: string; key: string; name: string; scale_max: number; criteria: Criterion[]; }
interface Scope { scope: string; innovation_assigned: number; architecture_assigned: number; }
type Family = 'innovation' | 'architecture';
const familyOf = (competition: string): Family =>
  competition.startsWith('architecture') ? 'architecture' : 'innovation';
type Draft = Record<string, { score: number | null; comment: string }>;
interface AllInnovation {
  entry_id: string; company: string | null; website: string | null; stage: string | null;
  categories: string[] | null; fields: Record<string, string>; assigned: boolean; review_status: string | null;
}

const CONFIDENCE = [{ v: 1, label: 'Low' }, { v: 2, label: 'Medium' }, { v: 3, label: 'High' }];

// ── Local draft cache ────────────────────────────────────────────────────────
// A scorecard used to live only in React state, so anything that unmounted the
// page — a session blip redirecting to the home page, a browser discarding the
// tab to save memory, a stray click on "Back to my entries" — took an hour of
// judgement with it. Everything typed is now mirrored to this device as it is
// typed, and removed again the moment the server has it.
//
// Keyed per juror so two people sharing a laptop cannot see each other's work,
// and holds ids and numbers only: never a company name, which would break the
// anonymity architecture judging depends on.
const DRAFT_NS = 'sm26-jury-draft:v1';
const draftKey = (uid: string, entryId: string) => `${DRAFT_NS}:u.${uid}:${entryId}`;
interface CachedDraft { v: 1; scores: Draft; confidence: number | null; coi: boolean; savedAt: number }

const readCached = (uid: string, entryId: string): CachedDraft | null => {
  try {
    const raw = localStorage.getItem(draftKey(uid, entryId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedDraft;
    return parsed && parsed.v === 1 && parsed.scores ? parsed : null;
  } catch { return null; }
};
const writeCached = (uid: string, entryId: string, value: CachedDraft) => {
  // Private mode and a full quota both throw. Losing the mirror is survivable;
  // breaking scoring because of it is not.
  try { localStorage.setItem(draftKey(uid, entryId), JSON.stringify(value)); } catch { /* ignore */ }
};
const clearCached = (uid: string, entryId: string) => {
  try { localStorage.removeItem(draftKey(uid, entryId)); } catch { /* ignore */ }
};

const clockTime = (ms: number) =>
  new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

export function SM26JuryPage({ embedded = false }: { embedded?: boolean } = {}) {
  const { user, loading: authLoading } = useAuth();
  const [eventId, setEventId] = useState<string | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [allInnovations, setAllInnovations] = useState<AllInnovation[]>([]);
  const [browseId, setBrowseId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [selected, setSelected] = useState<Entry | null>(null);
  const [payload, setPayload] = useState<Record<string, unknown> | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [confidence, setConfidence] = useState<number | null>(null);
  const [coi, setCoi] = useState(false);
  const [reviewStatus, setReviewStatus] = useState<string | null>(null);
  const [loadingEntry, setLoadingEntry] = useState(false);
  const [saving, setSaving] = useState(false);
  // A juror can sit on one competition or both. Those who judge both get a
  // switch; everyone else keeps a single plain list with no extra chrome.
  const [scope, setScope] = useState<Scope | null>(null);
  const [comp, setComp] = useState<Family>('innovation');
  // The panel currently open in the lightbox; url is null while it is being signed.
  const [preview, setPreview] = useState<{ items: PreviewItem[]; index: number; url: string | null } | null>(null);

  // Only the first load blanks the page. Supabase re-emits SIGNED_IN with a
  // freshly parsed session every time the tab regains focus, so keying this on
  // the user OBJECT re-ran load() on every return from another window — the
  // scorecard vanished behind a spinner and the juror was thrown back to the top
  // of the page, mid-review. Key on the id, and never blank a card that is open.
  const firstLoadRef = useRef(true);
  // Guards against a slow entry load landing its scores on whichever entry the
  // juror has opened since.
  const reqRef = useRef(0);

  // Has the juror changed anything since this card was hydrated? Drives the save
  // chip, and stops a card that was merely opened for reading from overwriting a
  // good cached draft with the server copy.
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [localAt, setLocalAt] = useState<number | null>(null);
  const [restored, setRestored] = useState(false);
  const [flashId, setFlashId] = useState<string | null>(null);
  const [justSubmitted, setJustSubmitted] = useState<number | null>(null);
  const hydratedRef = useRef(false);
  // Listeners fire outside the render that closed over the state, so they read
  // the latest values from here rather than from a stale closure.
  const latestRef = useRef({ draft: {} as Draft, confidence: null as number | null, coi: false, dirty: false });

  useEffect(() => { if (user) load(); }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Open on the side that actually has something waiting, so a juror who has
  // only been given architecture projects doesn't land on an empty Innovation tab.
  useEffect(() => {
    if (!scope) return;
    if (scope.innovation_assigned === 0 && scope.architecture_assigned > 0) setComp('architecture');
  }, [scope]);

  const load = async () => {
    if (firstLoadRef.current) setLoading(true);
    const { data: ev } = await supabase.from('sm_event').select('id').eq('slug', 'sm26').maybeSingle();
    if (!ev) { setLoading(false); firstLoadRef.current = false; return; }
    const eid = (ev as { id: string }).id;
    setEventId(eid);
    const [{ data: ents }, { data: tpls }, { data: allInn }, { data: sc }] = await Promise.all([
      supabase.rpc('sm_jury_my_entries', { p_event_id: eid }),
      supabase.from('sm_scorecard_template').select('*, criteria:sm_criterion(*)').eq('event_id', eid).eq('is_active', true),
      supabase.rpc('sm_jury_all_innovations', { p_event_id: eid }),
      supabase.rpc('sm_jury_my_scope', { p_event_id: eid }),
    ]);
    setEntries((ents || []) as Entry[]);
    setAllInnovations((allInn || []) as AllInnovation[]);
    setScope(((sc || [])[0] as Scope) || null);
    const t = ((tpls || []) as Template[]).map(x => ({ ...x, criteria: [...x.criteria].sort((a, b) => a.display_order - b.display_order) }));
    setTemplates(t);
    setLoading(false);
    firstLoadRef.current = false;
  };

  // An assignment carries the granular competition (architecture_pro /
  // architecture_student, which the rankings split on) but the architecture
  // scorecard is defined once for the family — so normalise before matching,
  // or every architecture entry shows "No scorecard configured" and can never
  // be submitted. The innovation path is unaffected, and the review row still
  // records the granular competition.
  const templateFor = (e: Entry) => {
    const family = e.competition.startsWith('architecture') ? 'architecture' : e.competition;
    return templates.find(t => t.competition === family && t.key === e.template_key) || null;
  };

  const openEntry = async (e: Entry) => {
    // Two entries opened in quick succession used to race: whichever query
    // answered last wrote its scores into the form, and the next save posted
    // them onto the other company. Only the newest request may touch state.
    const my = ++reqRef.current;
    // Nothing may be mirrored to this device until the server copy has landed,
    // or the empty form below would overwrite a good cached draft.
    hydratedRef.current = false;
    setSelected(e);
    setLoadingEntry(true);
    setPayload(null);
    setDraft({});
    setConfidence(e.confidence ?? null);
    setCoi(!!e.coi_flag);
    setReviewStatus(e.review_status ?? null);
    setDirty(false);
    setRestored(false);
    setSavedAt(null);
    setLocalAt(null);
    setJustSubmitted(null);
    const [{ data: detail }, { data: review }] = await Promise.all([
      supabase.rpc('sm_jury_entry_detail', { p_entry_id: e.entry_id }),
      supabase.from('sm_review').select('*, scores:sm_criterion_score(criterion_id,score,comment)')
        .eq('entry_role_assignment_id', e.entry_id).eq('juror_user_id', user!.id).maybeSingle(),
    ]);
    if (reqRef.current !== my) return;
    setPayload((detail || null) as Record<string, unknown> | null);
    const d: Draft = {};
    const rev = review as { scores?: { criterion_id: string; score: number | null; comment: string | null }[]; confidence?: number; coi_flag?: boolean; status?: string } | null;
    if (rev?.scores) for (const s of rev.scores) d[s.criterion_id] = { score: s.score, comment: s.comment || '' };
    setDraft(d);
    if (rev) { setConfidence(rev.confidence ?? null); setCoi(!!rev.coi_flag); setReviewStatus(rev.status ?? null); }

    // The cache is cleared on every successful server save, so anything still
    // here is by definition work the server never received. Prefer it, and say
    // so rather than restoring it behind the juror's back.
    const cached = readCached(user!.id, e.entry_id);
    if (cached) {
      setDraft(cached.scores);
      setConfidence(cached.confidence);
      setCoi(cached.coi);
      setLocalAt(cached.savedAt);
      setRestored(true);
      setDirty(true);
    }
    hydratedRef.current = true;
    setLoadingEntry(false);
  };

  // Mirror locally 400ms after the last keystroke, and immediately if the tab is
  // being hidden or torn down — the two moments the work was being lost.
  useEffect(() => { latestRef.current = { draft, confidence, coi, dirty }; });

  useEffect(() => {
    if (!selected || !user || !dirty || !hydratedRef.current || reviewStatus === 'locked') return;
    const t = setTimeout(() => {
      writeCached(user.id, selected.entry_id, { v: 1, scores: draft, confidence, coi, savedAt: Date.now() });
      setLocalAt(Date.now());
    }, 400);
    return () => clearTimeout(t);
  }, [draft, confidence, coi, dirty, selected, user, reviewStatus]);

  useEffect(() => {
    if (!selected || !user) return;
    const flush = () => {
      const cur = latestRef.current;
      if (!cur.dirty || !hydratedRef.current || reviewStatus === 'locked') return;
      writeCached(user.id, selected.entry_id, {
        v: 1, scores: cur.draft, confidence: cur.confidence, coi: cur.coi, savedAt: Date.now(),
      });
    };
    const onVisibility = () => { if (document.visibilityState === 'hidden') flush(); };
    document.addEventListener('visibilitychange', onVisibility);
    // pagehide, not beforeunload: beforeunload does not fire when a browser
    // discards a background tab, and registering one disables the back/forward cache.
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', flush);
    };
  }, [selected, user, reviewStatus]);

  const setScore = (cid: string, score: number) => {
    setDirty(true);
    setDraft(prev => ({ ...prev, [cid]: { score: prev[cid]?.score === score ? null : score, comment: prev[cid]?.comment || '' } }));
  };
  const setComment = (cid: string, comment: string) => {
    setDirty(true);
    setDraft(prev => ({ ...prev, [cid]: { score: prev[cid]?.score ?? null, comment } }));
  };

  // Weighted percentage of the WHOLE scorecard. Dividing by only the criteria
  // scored so far made a half-finished draft read 100/100, which is misleading
  // both to the juror and in the saved draft total. A submitted review has every
  // criterion scored, so the official Awards Score is unchanged.
  const computeTotal = (tpl: Template): number | null => {
    const fullWeight = tpl.criteria.reduce((a, c) => a + c.weight, 0);
    let scoredWeight = 0, weighted = 0;
    for (const c of tpl.criteria) {
      const s = draft[c.id]?.score;
      if (s == null) continue;
      weighted += (s / tpl.scale_max) * c.weight;
      scoredWeight += c.weight;
    }
    return scoredWeight > 0 && fullWeight > 0 ? Math.round((weighted / fullWeight) * 1000) / 10 : null;
  };

  // Everything standing between this card and a valid submission, computed the
  // same way for the checklist on screen and for the submit button — so what the
  // juror reads and what the button enforces cannot drift apart. This used to be
  // three sequential red toasts that vanished after five seconds, which is how a
  // juror ends up saving four complete cards as drafts and believing they are done.
  const blockersFor = (tpl: Template | null): { id: string; label: string }[] => {
    if (!tpl) return [];
    const out: { id: string; label: string }[] = [];
    tpl.criteria.forEach((c, i) => {
      if (draft[c.id]?.score == null) out.push({ id: c.id, label: `Score ${i + 1}. ${c.label}` });
    });
    const threshold = 0.4 * tpl.scale_max;
    tpl.criteria.forEach((c, i) => {
      const s = draft[c.id]?.score;
      if (c.critical && s != null && s < threshold && !(draft[c.id]?.comment || '').trim()) {
        out.push({ id: c.id, label: `Justify the low score on ${i + 1}. ${c.label}` });
      }
    });
    if (!confidence) out.push({ id: 'confidence', label: 'Set your confidence' });
    return out;
  };

  const goToBlocker = (id: string) => {
    setFlashId(id);
    window.setTimeout(() => setFlashId(null), 1400);
    document.getElementById(id === 'confidence' ? 'jury-confidence' : `crit-${id}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const saveReview = async (submit: boolean) => {
    if (!selected || !eventId) return;
    const tpl = templateFor(selected);
    if (!tpl) { toast({ title: 'No scorecard found for this entry', variant: 'destructive' }); return; }

    if (submit) {
      // The checklist above the buttons already names every one of these; take
      // the juror to the first rather than describing it in a toast they will
      // have to remember while they scroll.
      const blocking = blockersFor(tpl);
      if (blocking.length) { goToBlocker(blocking[0].id); return; }
    }

    const uid = await requireFreshSession();
    if (!uid) return;

    setSaving(true);
    const total = computeTotal(tpl);
    const allScored = tpl.criteria.every(c => draft[c.id]?.score != null);
    const nextStatus = submit || reviewStatus === 'submitted' ? 'submitted' : 'draft';

    // Clicking an already-selected score clears it. On a review that is already
    // submitted, saving in that state would leave a submitted row with no total
    // in the rankings. Refuse, and say which criterion to put back.
    if (nextStatus === 'submitted' && !allScored) {
      const missing = tpl.criteria.filter(c => draft[c.id]?.score == null).map(c => c.label);
      setSaving(false);
      toast({
        title: 'Your review is submitted — every criterion needs a score',
        description: `Score ${missing.join(', ')} again before saving.`,
        variant: 'destructive',
      });
      return;
    }
    const { data: rv, error: rvErr } = await supabase.from('sm_review').upsert({
      juror_user_id: user!.id,
      entry_role_assignment_id: selected.entry_id,
      event_id: eventId,
      competition: selected.competition,
      template_id: tpl.id,
      confidence,
      coi_flag: coi,
      // A juror who had submitted, reopened the card to fix a comment and pressed
      // "Save draft" used to have their finished review silently demoted back to
      // draft — dropping it out of the submitted count and out of the awards
      // score, while the toast said "Draft saved". A draft save never downgrades
      // a submitted review.
      status: nextStatus,
      // A partial card has no meaningful total: publishing one lets a half-scored
      // draft sit in the rankings looking like a verdict. Only a complete card
      // carries a number.
      total_score: allScored ? total : null,
      // Omitted rather than nulled on a draft save: the upsert only writes the
      // keys present, so an existing submitted_at survives.
      ...(submit ? { submitted_at: new Date().toISOString() } : {}),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'juror_user_id,entry_role_assignment_id' }).select('id').single();

    if (rvErr || !rv) { setSaving(false); toast({ title: 'Could not save', description: rvErr?.message, variant: 'destructive' }); return; }

    const rows = tpl.criteria.map(c => ({
      review_id: (rv as { id: string }).id, criterion_id: c.id,
      score: draft[c.id]?.score ?? null, comment: draft[c.id]?.comment?.trim() || null,
    }));
    const { error: scErr } = await supabase.from('sm_criterion_score').upsert(rows, { onConflict: 'review_id,criterion_id' });
    setSaving(false);
    if (scErr) { toast({ title: 'Scores could not be saved', description: scErr.message, variant: 'destructive' }); return; }

    // The server has it: the local mirror has no further job, and keeping it
    // would let it win over a fresher server copy on the next open.
    clearCached(user!.id, selected.entry_id);
    setDirty(false);
    setRestored(false);
    setLocalAt(null);
    setSavedAt(Date.now());
    setReviewStatus(nextStatus);
    if (submit) setJustSubmitted(total);
    toast({
      title: submit ? 'Review submitted'
        : nextStatus === 'submitted' ? 'Saved — your review stays submitted'
        : 'Draft saved',
    });
    // refresh list state
    setEntries(prev => prev.map(e => e.entry_id === selected.entry_id ? { ...e, review_status: nextStatus, review_total: allScored ? total : null, confidence, coi_flag: coi } : e));
  };

  // Scoring eight A2 panels used to mean eight downloads, then eight windows to
  // find and close, then back here to type a number. Now they open in place and
  // the juror pages through them with ‹ ›; downloading is there for anyone who
  // wants the file at full resolution, but it is no longer the price of looking.
  //
  // An hour of signing, not five minutes: a juror reads a panel, thinks, comes
  // back — a link that dies mid-review reads as the platform breaking.
  const openPreview = async (items: PreviewItem[], index: number) => {
    setPreview({ items, index, url: null });
    const { data } = await supabase.storage.from('event-media').createSignedUrl(items[index].path, 3600);
    if (!data) { setPreview(null); toast({ title: 'Could not open that file', variant: 'destructive' }); return; }
    setPreview(p => (p && p.items[p.index].path === items[index].path ? { ...p, url: data.signedUrl } : p));
  };
  const movePreview = async (delta: number) => {
    if (!preview) return;
    const next = (preview.index + delta + preview.items.length) % preview.items.length;
    await openPreview(preview.items, next);
  };
  const downloadCurrent = async () => {
    if (!preview) return;
    const item = preview.items[preview.index];
    const { data } = await supabase.storage.from('event-media')
      .createSignedUrl(item.path, 300, { download: true });
    if (data) window.open(data.signedUrl, '_blank');
    else toast({ title: 'Could not download that file', variant: 'destructive' });
  };

  // Eight panels is a lot of clicking. Arrows page through them, Escape closes.
  // Skipped while the PDF iframe has focus — the browser's own viewer uses the
  // arrow keys to scroll, and stealing them there would fight the reader.
  useEffect(() => {
    if (!preview) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setPreview(null); return; }
      if (document.activeElement?.tagName === 'IFRAME') return;
      if (e.key === 'ArrowLeft') movePreview(-1);
      if (e.key === 'ArrowRight') movePreview(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview?.index, preview?.items.length]);

  // Never replace an open scorecard with a spinner: a background refresh must
  // not cost the juror their place, their scroll position or their caret.
  if ((authLoading || loading) && !selected) return (
    <div className="flex items-center justify-center h-[60vh]"><RefreshCw className="h-8 w-8 animate-spin text-primary" /></div>
  );

  // ---- Scoring view ----
  if (selected) {
    const tpl = templateFor(selected);
    const total = tpl ? computeTotal(tpl) : null;
    const locked = reviewStatus === 'locked';
    const fields = (payload?.fields || {}) as Record<string, string>;
    const blockers = blockersFor(tpl);
    const mine = entries.filter(x => x.competition.startsWith('architecture') === selected.competition.startsWith('architecture'));
    const position = mine.findIndex(x => x.entry_id === selected.entry_id);
    // One state at a time, and never silent: the old screen said nothing at all
    // between "Draft saved" fading after five seconds and the next save.
    const chip = locked ? { text: 'Locked', cls: 'bg-gray-100 text-gray-500 border-gray-200' }
      : saving ? { text: 'Saving…', cls: 'bg-gray-50 text-gray-500 border-gray-200' }
      : dirty && localAt ? { text: `Kept on this device ${clockTime(localAt)} — not sent to M3 yet`, cls: 'bg-amber-50 text-amber-700 border-amber-200' }
      : dirty ? { text: 'Unsaved changes', cls: 'bg-amber-50 text-amber-700 border-amber-200' }
      : reviewStatus === 'submitted' ? { text: savedAt ? `Submitted ${clockTime(savedAt)}` : 'Submitted', cls: 'bg-green-50 text-green-700 border-green-200' }
      : savedAt ? { text: `Draft saved ${clockTime(savedAt)}`, cls: 'bg-gray-50 text-gray-500 border-gray-200' }
      : reviewStatus === 'draft' ? { text: 'Draft saved', cls: 'bg-gray-50 text-gray-500 border-gray-200' }
      : null;
    return (
      <div className={embedded ? '' : 'min-h-screen bg-gray-50'}>
        {!embedded && <Helmet><title>Score entry — SM26 Jury</title></Helmet>}
        <div className={embedded ? 'space-y-4' : 'container mx-auto px-4 py-6 max-w-3xl space-y-4'}>
          <div className={`sticky ${embedded ? 'top-0' : 'top-16'} z-20 -mx-4 px-4 py-2 bg-gray-50/95 backdrop-blur border-b border-gray-100 flex items-center justify-between gap-2 flex-wrap`}>
            <Button variant="ghost" size="sm" onClick={() => setSelected(null)} className="gap-1.5"><ArrowLeft className="h-4 w-4" /> Back to my entries</Button>
            <div className="flex items-center gap-2">
              {position >= 0 && mine.length > 1 && (
                <span className="text-xs text-gray-500">Entry {position + 1} of {mine.length}</span>
              )}
              {chip && <span className={`text-xs rounded-full border px-2 py-0.5 ${chip.cls}`}>{chip.text}</span>}
            </div>
          </div>

          {restored && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 flex items-start justify-between gap-3 flex-wrap">
              <span>
                We kept what you typed{localAt ? ` at ${clockTime(localAt)}` : ''}. It has not been saved to M3 yet.
              </span>
              <button type="button" className="text-xs underline shrink-0"
                onClick={() => { clearCached(user!.id, selected.entry_id); setRestored(false); openEntry(selected); }}>
                Discard it and reload the saved version
              </button>
            </div>
          )}

          {loadingEntry ? (
            <div className="flex items-center justify-center h-40"><RefreshCw className="h-7 w-7 animate-spin text-gray-400" /></div>
          ) : (
            <>
              {/* Entry content */}
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <CardTitle className="flex items-center gap-2">
                      {selected.title}
                      <Badge variant="outline" className="text-[10px] capitalize">{selected.competition}</Badge>
                      {selected.subtitle && <Badge variant="secondary" className="text-[10px]">{selected.subtitle}</Badge>}
                    </CardTitle>
                    {reviewStatus && <Badge className={`text-[10px] ${reviewStatus === 'submitted' ? 'bg-green-50 text-green-700 border-green-200' : reviewStatus === 'locked' ? 'bg-gray-100 text-gray-500 border-gray-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>{reviewStatus}</Badge>}
                  </div>
                  {payload?.competition === 'innovation' && payload?.website ? (
                    <CardDescription className="flex items-center gap-1">
                      <a href={String(payload.website)} target="_blank" rel="noreferrer" className="text-primary inline-flex items-center gap-1">{String(payload.website)} <ExternalLink className="h-3 w-3" /></a>
                    </CardDescription>
                  ) : payload?.competition === 'architecture' ? (
                    <CardDescription>Anonymised entry — scored on the submitted panels.</CardDescription>
                  ) : null}
                </CardHeader>
                <CardContent className="space-y-3">
                  {Object.entries(fields).map(([k, v]) => (
                    <div key={k}>
                      <div className="text-[11px] uppercase tracking-wide text-gray-400">{k}</div>
                      <div className="text-sm text-gray-800 whitespace-pre-wrap">{v}</div>
                    </div>
                  ))}
                  {Array.isArray(payload?.files) && (payload!.files as unknown[]).length > 0 && (() => {
                    // Label by panel/order — never the filename (it carries the architect's name).
                    const list = payload!.files as { id: string; kind: string; path: string }[];
                    const ps = list.filter(f => f.kind === 'panel');
                    const nt = list.find(f => f.kind === 'notice');
                    const an = list.find(f => f.kind === 'animation');
                    const ordered: (PreviewItem & { id: string })[] = [
                      ...ps.map((f, i) => ({ id: f.id, path: f.path, kind: 'panel', label: `Panel ${i + 1} (A2)` })),
                      ...(nt ? [{ id: nt.id, path: nt.path, kind: 'notice', label: 'Descriptive notice (A3)' }] : []),
                      ...(an ? [{ id: an.id, path: an.path, kind: 'animation', label: '3D animation' }] : []),
                    ];
                    return (
                      <div>
                        <div className="flex items-baseline justify-between gap-2 mb-1.5">
                          <div className="text-[11px] uppercase tracking-wide text-gray-400">Project files</div>
                          <div className="text-[11px] text-gray-400">Opens here — download only if you want to</div>
                        </div>
                        <div className="space-y-1.5">
                          {ordered.map((f, i) => (
                            <button key={f.id} onClick={() => openPreview(ordered, i)}
                              className="flex items-center gap-2 w-full text-left rounded-lg border border-gray-100 hover:border-primary/40 hover:bg-gray-50 px-3 py-2 transition-colors">
                              <Maximize2 className="h-4 w-4 text-primary shrink-0" />
                              <span className="text-sm text-gray-800 truncate">{f.label}</span>
                              <ChevronRight className="h-4 w-4 text-gray-300 ml-auto shrink-0" />
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })()}
                  {/* Imported architecture entries store their boards in
                      project_renders (not sm_architecture_file) — the resolver
                      surfaces them as anonymised previews for scoring. */}
                  <SM26AssetGallery roleAssignmentId={selected.entry_id} title="Project images" emptyText="" />
                  {Array.isArray(payload?.categories) && (payload!.categories as string[]).length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {(payload!.categories as string[]).map(c => <Badge key={c} variant="secondary" className="text-[10px]">{c}</Badge>)}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Scorecard */}
              {!tpl ? (
                <Card><CardContent className="py-8 text-center text-gray-400">No scorecard configured for this entry.</CardContent></Card>
              ) : (
                <Card>
                  <CardHeader>
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <CardTitle className="text-base flex items-center gap-2"><Scale className="h-4 w-4 text-primary" /> {tpl.name}</CardTitle>
                      {(() => {
                        const scored = tpl.criteria.filter(c => draft[c.id]?.score != null).length;
                        return (
                          <div className="text-sm text-right">
                            {total != null
                              ? <span className="font-semibold text-primary">{total.toFixed(1)}/100</span>
                              : <span className="text-gray-400">not scored</span>}
                            {total != null && scored < tpl.criteria.length && (
                              <div className="text-[11px] font-normal text-amber-600">
                                partial — {scored} of {tpl.criteria.length} criteria scored
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                    <CardDescription>Score each criterion 0–{tpl.scale_max}. A comment is required for a low score on a critical criterion.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-5">
                    {tpl.criteria.map((c, i) => {
                      const cur = draft[c.id]?.score ?? null;
                      const lowCritical = c.critical && cur != null && cur < 0.4 * tpl.scale_max;
                      return (
                        <div key={c.id} id={`crit-${c.id}`}
                          className={`space-y-1.5 scroll-mt-28 rounded-lg transition-shadow ${flashId === c.id ? 'ring-2 ring-amber-300 ring-offset-4' : ''}`}>
                          <div className="flex items-center justify-between gap-2">
                            <Label className="flex items-center gap-1.5">
                              {/* Numbered so the checklist above the buttons can name one. */}
                              {i + 1}. {c.label}
                              {c.critical && <span title="Critical criterion" className="text-amber-500"><AlertTriangle className="h-3.5 w-3.5" /></span>}
                            </Label>
                            <span className="text-[11px] text-gray-400">
                              {/* Clicking a chosen score clears it; without this the card
                                  goes quietly back to incomplete. */}
                              {cur == null && <span className="text-amber-600 mr-2">not scored</span>}
                              weight {c.weight}
                            </span>
                          </div>
                          {/* Already fetched and thrown away, while the token scorecard
                              shows it — so two jurors were scoring the same criterion
                              against different information. */}
                          {c.description && <p className="text-xs text-gray-500 -mt-0.5">{c.description}</p>}
                          <div className="flex flex-wrap gap-1">
                            {Array.from({ length: tpl.scale_max + 1 }, (_, i) => i).map(n => (
                              <button
                                key={n} type="button" disabled={locked}
                                onClick={() => setScore(c.id, n)}
                                className={`h-8 w-8 rounded-lg border text-sm font-medium transition-colors ${cur === n ? 'border-primary bg-primary text-white' : 'border-gray-200 text-gray-600 hover:border-primary/40'}`}
                              >{n}</button>
                            ))}
                          </div>
                          <Textarea
                            rows={2} disabled={locked}
                            placeholder={lowCritical ? 'Comment required — justify this low score' : 'Comment (optional)'}
                            className={lowCritical && !(draft[c.id]?.comment || '').trim() ? 'border-amber-400' : ''}
                            value={draft[c.id]?.comment || ''} onChange={e => setComment(c.id, e.target.value)}
                          />
                        </div>
                      );
                    })}

                    <div className="border-t pt-4 space-y-3">
                      <div id="jury-confidence"
                        className={`scroll-mt-28 rounded-lg transition-shadow ${flashId === 'confidence' ? 'ring-2 ring-amber-300 ring-offset-4' : ''}`}>
                        <Label className="mb-1.5 block">Your confidence</Label>
                        {/* Not a toggle: a second click on the level you meant used to
                            clear it, silently re-blocking submit. */}
                        <div className="flex gap-1.5">
                          {CONFIDENCE.map(cf => (
                            <button key={cf.v} type="button" disabled={locked} onClick={() => { setDirty(true); setConfidence(cf.v); }}
                              className={`px-3 h-8 rounded-lg border text-sm transition-colors ${confidence === cf.v ? 'border-primary bg-primary/5 text-primary font-medium' : 'border-gray-200 text-gray-600 hover:border-primary/40'}`}>{cf.label}</button>
                          ))}
                        </div>
                      </div>
                      <div className="flex items-start gap-2">
                        <Checkbox id="coi" checked={coi} disabled={locked} onCheckedChange={v => { setDirty(true); setCoi(v as boolean); }} />
                        <Label htmlFor="coi" className="font-normal text-sm">I have a potential conflict of interest with this entry (M3 will exclude my review from the official score).</Label>
                      </div>
                    </div>

                    {locked ? (
                      <div className="flex items-center gap-2 text-sm text-gray-500"><Lock className="h-4 w-4" /> This review is locked. Contact M3 to reopen it.</div>
                    ) : justSubmitted != null ? (
                      // Submitting used to leave the juror on the card with a toast that
                      // faded, and no way onward but scrolling up and hunting the list.
                      (() => {
                        const next = entries.find(x => x.entry_id !== selected.entry_id && x.review_status !== 'submitted');
                        return (
                          <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 space-y-2">
                            <div className="text-sm font-medium text-green-800 flex items-center gap-1.5">
                              <CheckCircle className="h-4 w-4" /> Review submitted — {justSubmitted?.toFixed(1)}/100
                            </div>
                            <p className="text-xs text-green-700">You can still change it until M3 locks scoring.</p>
                            <div className="flex gap-2 pt-1 flex-wrap">
                              {next
                                ? <Button size="sm" onClick={() => openEntry(next)}>Score the next entry — {next.title}</Button>
                                : <span className="text-sm text-green-800">That is everything assigned to you. Thank you.</span>}
                              <Button size="sm" variant="outline" onClick={() => setSelected(null)}>Back to my entries</Button>
                            </div>
                          </div>
                        );
                      })()
                    ) : (
                      <>
                        {blockers.length > 0 && (
                          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
                            <div className="text-sm font-medium text-amber-800">
                              {blockers.length} thing{blockers.length > 1 ? 's' : ''} still to do before you can submit
                            </div>
                            <ul className="mt-1.5 space-y-1">
                              {blockers.map(b => (
                                <li key={b.id + b.label}>
                                  <button type="button" onClick={() => goToBlocker(b.id)}
                                    className="text-sm text-amber-800 underline underline-offset-2 hover:text-amber-900 text-left">
                                    {b.label}
                                  </button>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        <div className="flex justify-end gap-2">
                          <Button variant="outline" onClick={() => saveReview(false)} disabled={saving}>{saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}{reviewStatus === 'submitted' ? 'Save changes' : 'Save draft'}</Button>
                          <Button onClick={() => saveReview(true)} disabled={saving}>{reviewStatus === 'submitted' ? 'Update my review' : 'Submit review'}</Button>
                        </div>
                      </>
                    )}
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </div>

        {/* Panel viewer. Nothing here identifies the architect: the header shows
            "Panel 3 of 8", never the filename, which carries their name and
            would break the anonymised judging the whole competition rests on. */}
        {preview && (() => {
          const item = preview.items[preview.index];
          const isVideo = item.kind === 'animation';
          return (
            <div className="fixed inset-0 z-50 bg-black/90 flex flex-col" role="dialog" aria-modal="true"
                 aria-label={`${item.label}, ${preview.index + 1} of ${preview.items.length}`}>
              <div className="flex items-center justify-between gap-3 px-4 py-3 text-white shrink-0">
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{item.label}</div>
                  <div className="text-[11px] text-white/50">{preview.index + 1} of {preview.items.length}</div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <Button size="sm" variant="ghost" className="text-white hover:bg-white/10 gap-1.5" onClick={downloadCurrent}>
                    <Download className="h-4 w-4" /> <span className="hidden sm:inline">Download</span>
                  </Button>
                  <Button size="icon" variant="ghost" className="text-white hover:bg-white/10" aria-label="Close" onClick={() => setPreview(null)}>
                    <X className="h-5 w-5" />
                  </Button>
                </div>
              </div>

              <div className="flex-1 min-h-0 flex items-center gap-1 px-1 pb-3">
                {preview.items.length > 1 && (
                  <Button size="icon" variant="ghost" className="text-white hover:bg-white/10 shrink-0" aria-label="Previous" onClick={() => movePreview(-1)}>
                    <ChevronLeft className="h-6 w-6" />
                  </Button>
                )}
                <div className="flex-1 h-full min-w-0 rounded-lg overflow-hidden bg-white/5 flex items-center justify-center">
                  {!preview.url ? (
                    <RefreshCw className="h-7 w-7 animate-spin text-white/40" />
                  ) : isVideo ? (
                    <video src={preview.url} controls className="max-h-full max-w-full" />
                  ) : (
                    // A2 at 300 dpi: the browser's own PDF viewer gives zoom and
                    // page controls for free, which is what reading a panel needs.
                    <iframe src={preview.url} title={item.label} className="w-full h-full border-0 bg-white" />
                  )}
                </div>
                {preview.items.length > 1 && (
                  <Button size="icon" variant="ghost" className="text-white hover:bg-white/10 shrink-0" aria-label="Next" onClick={() => movePreview(1)}>
                    <ChevronRight className="h-6 w-6" />
                  </Button>
                )}
              </div>
            </div>
          );
        })()}
      </div>
    );
  }

  // ---- List view ----
  // Show the switch to anyone M3 put on both competitions, and to anyone who
  // actually holds entries in both (the declared scope and the allocation can
  // disagree while entries are still being handed out).
  const judgesBoth = scope?.scope === 'both'
    || (!!scope && scope.innovation_assigned > 0 && scope.architecture_assigned > 0);
  const visible = judgesBoth ? entries.filter(e => familyOf(e.competition) === comp) : entries;
  const mandatory = visible.filter(e => e.mandatory);
  const optional = visible.filter(e => !e.mandatory);
  // The read-only innovation browse is context for judging innovations, so it
  // stays out of the way while the architecture side is open.
  const showAllInnovations = !judgesBoth || comp === 'innovation';
  const TABS: { key: Family; label: string; n: number }[] = [
    { key: 'innovation', label: 'Innovation', n: entries.filter(e => familyOf(e.competition) === 'innovation').length },
    { key: 'architecture', label: 'Architecture', n: entries.filter(e => familyOf(e.competition) === 'architecture').length },
  ];
  const Row = (e: Entry) => (
    <Card key={e.entry_id} className="border-0 shadow-sm hover:shadow-md transition-all cursor-pointer group" onClick={() => openEntry(e)}>
      <CardContent className="p-4 flex items-center gap-4">
        <div className="h-10 w-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0"><Scale className="h-5 w-5" /></div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-gray-900 truncate group-hover:text-primary">{e.title}</span>
            <Badge variant="outline" className="text-[10px] capitalize">{e.competition}</Badge>
            {e.subtitle && <Badge variant="secondary" className="text-[10px]">{e.subtitle}</Badge>}
          </div>
          <div className="text-xs text-gray-500 mt-0.5">
            {e.review_status === 'submitted'
              ? <span className="text-green-600 inline-flex items-center gap-1"><CheckCircle className="h-3 w-3" /> Submitted · {e.review_total?.toFixed(1)}/100</span>
              : e.review_status === 'draft' ? <span className="text-amber-600">Draft saved</span>
              : <span>Not started</span>}
          </div>
        </div>
        <ChevronRight className="h-5 w-5 text-gray-300 group-hover:text-primary shrink-0" />
      </CardContent>
    </Card>
  );

  return (
    <div className={embedded ? '' : 'min-h-screen bg-gray-50'}>
      {!embedded && <Helmet><title>My jury entries — SM26</title></Helmet>}
      {!embedded && (
        <section className="bg-gradient-to-br from-[#0b2653] to-[#143a6b] text-white">
          <div className="container mx-auto px-4 py-10">
            <p className="uppercase tracking-wide text-white/60 text-sm mb-2">SM26 · Jury</p>
            <h1 className="text-2xl lg:text-3xl font-bold">Entries to evaluate</h1>
            <p className="text-white/80 mt-2">Score each assigned entry on its scorecard. Scoring is in English and completes before the event.</p>
          </div>
        </section>
      )}

      <div className={embedded ? 'space-y-6' : 'container mx-auto px-4 py-8 max-w-2xl space-y-6'}>
        {/* The platform is EN/FR but the scorecards are English-only. The hero
            says so on the standalone page; inside the account tab there is no
            hero, so say it here. */}
        {embedded && (
          <p className="text-xs text-gray-500 flex items-start gap-1.5">
            <Languages className="h-3.5 w-3.5 text-gray-300 shrink-0 mt-px" />
            Jury scoring is in English, and completes before the event.
          </p>
        )}

        {/* When do I judge, whom, and am I confirmed — before the scorecards. */}
        <SM26MyJurySchedule eventId={eventId} />

        {/* Only the jurors who sit on both competitions get a choice; for
            everyone else this would be a switch with one side permanently empty. */}
        {judgesBoth && (
          <div className="flex rounded-lg border border-gray-200 overflow-hidden w-full max-w-sm">
            {TABS.map(t => (
              <button key={t.key} type="button" onClick={() => setComp(t.key)}
                className={`flex-1 px-3 h-9 text-sm font-medium transition-colors ${comp === t.key ? 'bg-primary text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
                {t.label}{t.n > 0 && <span className={comp === t.key ? 'text-white/70' : 'text-gray-400'}> ({t.n})</span>}
              </button>
            ))}
          </div>
        )}

        {visible.length === 0 ? (
          <Card><CardContent className="py-10 text-center text-gray-400">
            {judgesBoth && comp === 'architecture' ? (
              <>No architecture entries have been assigned to you yet — M3 allocates the projects, and they'll appear here to score.</>
            ) : (
              <>Nothing to score yet — Yachting Ventures will invite you to a jury session, and the startups
              you hear will appear here for scoring afterwards.</>
            )}
            {showAllInnovations && allInnovations.length > 0 && <span className="block mt-1">You can already read every innovation below.</span>}
          </CardContent></Card>
        ) : (
          <>
            <div className="space-y-2">
              <h2 className="text-sm font-semibold text-gray-700">Assigned to you ({mandatory.length})</h2>
              {mandatory.map(Row)}
            </div>
            {optional.length > 0 && (
              <div className="space-y-2">
                <h2 className="text-sm font-semibold text-gray-700">Optional (signal only)</h2>
                {optional.map(Row)}
              </div>
            )}
          </>
        )}

        {/* (d) Read-only browse of every innovation — for context/fairness. Scoring stays limited to assigned entries above. */}
        {showAllInnovations && allInnovations.length > 0 && (
          <div className="space-y-2">
            <h2 className="text-sm font-semibold text-gray-700">All innovations · read-only ({allInnovations.length})</h2>
            <p className="text-xs text-gray-500 -mt-1">Open any entry to read it. You can only score the ones assigned to you above.</p>
            {allInnovations.map(a => {
              const open = browseId === a.entry_id;
              const fieldEntries = Object.entries(a.fields || {});
              return (
                <Card key={a.entry_id} className="border-0 shadow-sm">
                  <button onClick={() => setBrowseId(open ? null : a.entry_id)} className="w-full text-left">
                    <CardContent className="p-4 flex items-center gap-3">
                      <div className="h-9 w-9 rounded-lg bg-gray-100 text-gray-400 flex items-center justify-center shrink-0"><Lightbulb className="h-4 w-4" /></div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-gray-900 truncate">{a.company || 'Innovation'}</span>
                          {a.stage && <Badge variant="secondary" className="text-[10px]">{a.stage}</Badge>}
                          {a.assigned && <Badge className="text-[10px] bg-primary/10 text-primary border-primary/20">Assigned to you</Badge>}
                          {a.assigned && a.review_status === 'submitted' && <Badge className="text-[10px] bg-green-50 text-green-700 border-green-200">scored</Badge>}
                        </div>
                      </div>
                      <ChevronRight className={`h-5 w-5 text-gray-300 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
                    </CardContent>
                  </button>
                  {open && (
                    <CardContent className="px-4 pb-4 pt-0 space-y-2">
                      {a.website && <a href={a.website} target="_blank" rel="noreferrer" className="text-primary text-sm inline-flex items-center gap-1">{a.website.replace(/^https?:\/\//, '')} <ExternalLink className="h-3 w-3" /></a>}
                      {fieldEntries.map(([k, v]) => (
                        <div key={k}>
                          <div className="text-[11px] uppercase tracking-wide text-gray-400">{k}</div>
                          <div className="text-sm text-gray-800 whitespace-pre-wrap">{v}</div>
                        </div>
                      ))}
                      {Array.isArray(a.categories) && a.categories.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 pt-1">{a.categories.map(c => <Badge key={c} variant="secondary" className="text-[10px]">{c}</Badge>)}</div>
                      )}
                      {fieldEntries.length === 0 && <p className="text-sm text-gray-400">No written details provided yet.</p>}
                    </CardContent>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
