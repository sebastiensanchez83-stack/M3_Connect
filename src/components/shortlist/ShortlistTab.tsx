import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { CardShell } from '@/components/brand/CardShell';
import { BTN, MemberEmpty, MemberPanel, RowSkeleton } from '@/components/member/MemberUI';
import { cn } from '@/lib/utils';
import {
  Star, MapPin, ExternalLink, Pencil, Save, X, Trash2, Building2, Globe,
} from 'lucide-react';
import { SponsorBadge } from '@/components/ui/SponsorBadge';
import type { OrgTier } from '@/types/database';

interface ShortlistEntry {
  id: string;
  note: string | null;
  created_at: string;
  organization: {
    id: string;
    name: string;
    slug: string;
    logo_url: string | null;
    organization_type: string | null;
    country: string | null;
    city: string | null;
    headquarters_country: string | null;
    website: string | null;
    tier: string;
    description: string | null;
  };
}

export function ShortlistTab() {
  const { user, profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState<ShortlistEntry[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftNote, setDraftNote] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('org_bookmarks')
      .select(`
        id,
        note,
        created_at,
        organization:organizations (
          id, name, slug, logo_url, organization_type,
          country, city, headquarters_country, website, tier, description
        )
      `)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) {
      toast({ title: 'Could not load shortlist', description: error.message, variant: 'destructive' });
    } else if (data) {
      // Filter out any bookmarks whose org was deleted (cascade should prevent this, but guard anyway)
      setEntries((data as unknown as ShortlistEntry[]).filter((e) => e.organization));
    }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  const handleEdit = (entry: ShortlistEntry) => {
    setEditingId(entry.id);
    setDraftNote(entry.note ?? '');
  };

  const handleCancel = () => {
    setEditingId(null);
    setDraftNote('');
  };

  const handleSave = async (id: string) => {
    setSavingId(id);
    const { error } = await supabase
      .from('org_bookmarks')
      .update({ note: draftNote.trim() || null, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) {
      toast({ title: 'Could not save note', description: error.message, variant: 'destructive' });
    } else {
      setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, note: draftNote.trim() || null } : e)));
      setEditingId(null);
      setDraftNote('');
      toast({ title: 'Note saved' });
    }
    setSavingId(null);
  };

  const handleRemove = async (id: string, orgName: string) => {
    if (!confirm(`Remove ${orgName} from your shortlist?`)) return;
    const { error } = await supabase.from('org_bookmarks').delete().eq('id', id);
    if (error) {
      toast({ title: 'Could not remove', description: error.message, variant: 'destructive' });
    } else {
      setEntries((prev) => prev.filter((e) => e.id !== id));
      toast({ title: 'Removed from shortlist' });
    }
  };

  if (loading) {
    return <MemberPanel><RowSkeleton rows={2} /></MemberPanel>;
  }

  if (entries.length === 0) {
    const isInvestor = profile?.persona === 'investor';
    return (
      <CardShell>
        <MemberEmpty
          icon={Star}
          title="Your shortlist is empty"
          body={isInvestor
            ? 'Pin any organization to save it here with private notes. Useful for tracking deal-flow targets and capital-seekers worth a second look.'
            : 'Star any organization on the platform to save it here with private notes. Useful for tracking service providers you might want to work with on a future project.'}
          action={(
            <Button asChild variant="ctaNavy" size="sm">
              <Link to={isInvestor ? '/investments' : '/directory?type=partner'}>
                {isInvestor ? 'Browse deal flow' : 'Browse service providers'}
              </Link>
            </Button>
          )}
        />
      </CardShell>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-[15px] leading-6 text-meta">{entries.length} {entries.length === 1 ? 'organization' : 'organizations'} saved with private notes.</p>

      <div className="space-y-3">
        {entries.map((entry) => {
          const org = entry.organization;
          const location = [org.city, org.country || org.headquarters_country].filter(Boolean).join(', ');
          const isEditing = editingId === entry.id;
          const isSaving = savingId === entry.id;
          return (
            <CardShell key={entry.id} className="p-4 sm:p-5">
              <div>
                <div className="flex gap-4">
                  {/* Logo */}
                  <Link to={`/organizations/${org.slug}`} className="shrink-0">
                    {org.logo_url ? (
                      <img src={org.logo_url} alt={org.name} className="h-14 w-14 rounded-xl border border-rule bg-white object-contain p-1" />
                    ) : (
                      <div className="grid h-14 w-14 place-items-center rounded-xl bg-chip">
                        <Building2 className="h-6 w-6 text-navy" />
                      </div>
                    )}
                  </Link>

                  {/* Org info + note */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="min-w-0">
                        <Link to={`/organizations/${org.slug}`} className="group text-[16px] font-semibold text-navy"><span className="card-ul">
                          {org.name}
                        </span></Link>
                        <div className="flex items-center gap-2 mt-1 flex-wrap text-xs text-meta">
                          {org.organization_type && (
                            <Badge variant="outline" className="border-rule bg-chip text-[12px] font-medium capitalize text-navy">
                              {org.organization_type.replace('_', ' ')}
                            </Badge>
                          )}
                          <SponsorBadge tier={org.tier as OrgTier} size="sm" />
                          {location && (
                            <span className="inline-flex items-center gap-1">
                              <MapPin className="h-3 w-3" />
                              {location}
                            </span>
                          )}
                          {org.website && (
                            <a
                              href={org.website}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="inline-flex items-center gap-1 hover:text-primary"
                            >
                              <Globe className="h-3 w-3" />
                              Website
                              <ExternalLink className="h-2.5 w-2.5" />
                            </a>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {!isEditing && (
                          <Button size="sm" variant="ghost" className="h-10 w-10 rounded-pill p-0 text-navy hover:bg-chip" onClick={() => handleEdit(entry)} title="Edit note" aria-label="Edit note">
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleRemove(entry.id, org.name)}
                          title="Remove from shortlist"
                          aria-label="Remove from shortlist"
                          className="h-10 w-10 rounded-pill p-0 text-red-600 hover:bg-red-50 hover:text-red-700"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>

                    {/* Note display / edit */}
                    {isEditing ? (
                      <div className="mt-3 space-y-2">
                        <textarea
                          value={draftNote}
                          onChange={(e) => setDraftNote(e.target.value)}
                          rows={3}
                          placeholder="Private note (e.g. met at Cannes, recommended by ACI, shortlisted for Q3 dredging project)…"
                          className="w-full resize-y rounded-xl border border-rule bg-white p-3 text-[14px] focus:outline-none focus:ring-2 focus:ring-primary/30"
                          autoFocus
                        />
                        <div className="flex gap-2 justify-end">
                          <Button size="sm" variant="ghost" className={cn(BTN, 'text-navy hover:bg-chip')} onClick={handleCancel} disabled={isSaving}>
                            <X className="h-3.5 w-3.5 mr-1" /> Cancel
                          </Button>
                          <Button size="sm" className={BTN} onClick={() => handleSave(entry.id)} disabled={isSaving}>
                            <Save className="h-3.5 w-3.5 mr-1" />
                            {isSaving ? 'Saving…' : 'Save note'}
                          </Button>
                        </div>
                      </div>
                    ) : entry.note ? (
                      <p
                        onClick={() => handleEdit(entry)}
                        className="mt-3 cursor-text whitespace-pre-wrap rounded-xl border border-teal/20 bg-foam p-3 text-[14px] leading-5 text-ink transition-colors hover:border-teal/40"
                      >
                        {entry.note}
                      </p>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleEdit(entry)}
                        className="mt-3 inline-flex min-h-10 items-center gap-1.5 text-[13px] font-medium text-meta hover:text-navy"
                      >
                        <Pencil className="h-3 w-3" /> Add a private note
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </CardShell>
          );
        })}
      </div>

      <p className="pt-2 text-center text-[13px] leading-5 text-meta">
        Notes are private and only visible to you. The organization itself can't see they're on your shortlist.
      </p>
    </div>
  );
}
