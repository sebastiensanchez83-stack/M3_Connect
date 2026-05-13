import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { LoadingSkeleton } from '@/components/LoadingSkeleton';
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
  const { user } = useAuth();
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
    return <LoadingSkeleton variant="inline" />;
  }

  if (entries.length === 0) {
    return (
      <Card>
        <CardContent className="pt-12 pb-12 text-center">
          <Star className="h-10 w-10 text-gray-300 mx-auto mb-3" />
          <h3 className="font-medium text-gray-800 mb-1">Your shortlist is empty</h3>
          <p className="text-sm text-gray-500 max-w-md mx-auto mb-5">
            Star any organization on the platform to save it here with private notes. Useful for tracking vendors you might want to work with on a future project.
          </p>
          <Button asChild variant="outline">
            <Link to="/partners">Browse partners</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Shortlist</h2>
          <p className="text-sm text-gray-500">{entries.length} {entries.length === 1 ? 'organization' : 'organizations'} saved with private notes.</p>
        </div>
      </div>

      <div className="space-y-3">
        {entries.map((entry) => {
          const org = entry.organization;
          const location = [org.city, org.country || org.headquarters_country].filter(Boolean).join(', ');
          const isEditing = editingId === entry.id;
          const isSaving = savingId === entry.id;
          return (
            <Card key={entry.id}>
              <CardContent className="p-5">
                <div className="flex gap-4">
                  {/* Logo */}
                  <Link to={`/organizations/${org.slug}`} className="shrink-0">
                    {org.logo_url ? (
                      <img src={org.logo_url} alt={org.name} className="w-14 h-14 rounded-lg object-cover border" />
                    ) : (
                      <div className="w-14 h-14 rounded-lg bg-primary/10 flex items-center justify-center">
                        <Building2 className="h-6 w-6 text-primary" />
                      </div>
                    )}
                  </Link>

                  {/* Org info + note */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="min-w-0">
                        <Link to={`/organizations/${org.slug}`} className="font-semibold text-gray-900 hover:text-primary transition-colors">
                          {org.name}
                        </Link>
                        <div className="flex items-center gap-2 mt-1 flex-wrap text-xs text-gray-500">
                          {org.organization_type && (
                            <Badge variant="outline" className="text-[10px] capitalize">
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
                          <Button size="sm" variant="ghost" onClick={() => handleEdit(entry)} title="Edit note">
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleRemove(entry.id, org.name)}
                          title="Remove from shortlist"
                          className="text-red-500 hover:text-red-600 hover:bg-red-50"
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
                          className="w-full text-sm rounded-lg border border-gray-200 bg-white p-2.5 focus:outline-none focus:ring-1 focus:ring-primary/30 resize-y"
                          autoFocus
                        />
                        <div className="flex gap-2 justify-end">
                          <Button size="sm" variant="ghost" onClick={handleCancel} disabled={isSaving}>
                            <X className="h-3.5 w-3.5 mr-1" /> Cancel
                          </Button>
                          <Button size="sm" onClick={() => handleSave(entry.id)} disabled={isSaving}>
                            <Save className="h-3.5 w-3.5 mr-1" />
                            {isSaving ? 'Saving…' : 'Save note'}
                          </Button>
                        </div>
                      </div>
                    ) : entry.note ? (
                      <p
                        onClick={() => handleEdit(entry)}
                        className="mt-3 text-sm text-gray-700 bg-amber-50 border border-amber-100 rounded-lg p-3 cursor-text hover:bg-amber-100/60 transition-colors whitespace-pre-wrap"
                      >
                        {entry.note}
                      </p>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleEdit(entry)}
                        className="mt-3 text-xs text-gray-400 hover:text-primary inline-flex items-center gap-1"
                      >
                        <Pencil className="h-3 w-3" /> Add a private note
                      </button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <p className="text-xs text-gray-400 text-center pt-2">
        Notes are private and only visible to you. The organization itself can't see they're on your shortlist.
      </p>
    </div>
  );
}
