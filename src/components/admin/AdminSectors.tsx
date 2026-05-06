import { useState, useEffect } from 'react';
import { RefreshCw, Plus, Search, Edit2, Trash2, Loader2, Tag } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';

interface Sector {
  id: string;
  slug: string;
  label: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/** Slugify: "Marina Software & SaaS" → "marina-software-saas" */
function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export function AdminSectors() {
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Sector | null>(null);
  const [form, setForm] = useState({ label: '', slug: '', is_active: true });
  const [autoSlug, setAutoSlug] = useState(true);
  const [saving, setSaving] = useState(false);

  const [deletingSector, setDeletingSector] = useState<Sector | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [usageCount, setUsageCount] = useState<number | null>(null);

  const loadSectors = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('sectors')
      .select('*')
      .order('label', { ascending: true });
    if (error) {
      toast({ title: 'Failed to load sectors', description: error.message, variant: 'destructive' });
    } else {
      setSectors((data || []) as Sector[]);
    }
    setLoading(false);
  };

  useEffect(() => { loadSectors(); }, []);

  const openCreate = () => {
    setEditing(null);
    setForm({ label: '', slug: '', is_active: true });
    setAutoSlug(true);
    setEditorOpen(true);
  };

  const openEdit = (s: Sector) => {
    setEditing(s);
    setForm({ label: s.label, slug: s.slug, is_active: s.is_active });
    setAutoSlug(false);
    setEditorOpen(true);
  };

  const handleLabelChange = (label: string) => {
    setForm(f => ({
      ...f,
      label,
      slug: autoSlug ? slugify(label) : f.slug,
    }));
  };

  const handleSlugChange = (slug: string) => {
    setForm(f => ({ ...f, slug: slugify(slug) }));
    setAutoSlug(false);
  };

  const handleSave = async () => {
    const label = form.label.trim();
    const slug = (form.slug || slugify(form.label)).trim();
    if (!label) {
      toast({ title: 'Label required', variant: 'destructive' });
      return;
    }
    if (!slug) {
      toast({ title: 'Slug required', variant: 'destructive' });
      return;
    }
    setSaving(true);
    if (editing) {
      const { error } = await supabase
        .from('sectors')
        .update({ label, slug, is_active: form.is_active, updated_at: new Date().toISOString() })
        .eq('id', editing.id);
      if (error) {
        toast({ title: 'Failed to save', description: error.message, variant: 'destructive' });
        setSaving(false);
        return;
      }
      toast({ title: 'Sector updated' });
    } else {
      const { error } = await supabase
        .from('sectors')
        .insert({ label, slug, is_active: form.is_active });
      if (error) {
        toast({
          title: 'Failed to add sector',
          description: error.code === '23505' ? `A sector with slug "${slug}" already exists.` : error.message,
          variant: 'destructive',
        });
        setSaving(false);
        return;
      }
      toast({ title: 'Sector added', description: `"${label}" is now available for users to choose.` });
    }
    setSaving(false);
    setEditorOpen(false);
    loadSectors();
  };

  const toggleActive = async (s: Sector, nextActive: boolean) => {
    const { error } = await supabase
      .from('sectors')
      .update({ is_active: nextActive, updated_at: new Date().toISOString() })
      .eq('id', s.id);
    if (error) {
      toast({ title: 'Failed to update', description: error.message, variant: 'destructive' });
      return;
    }
    setSectors(prev => prev.map(x => x.id === s.id ? { ...x, is_active: nextActive } : x));
    toast({ title: nextActive ? `"${s.label}" activated` : `"${s.label}" deactivated` });
  };

  const openDelete = async (s: Sector) => {
    setDeletingSector(s);
    setUsageCount(null);
    // Count usage across all sector mapping tables
    const [a, b, c, d] = await Promise.all([
      supabase.from('organization_interest_sectors').select('sector_id', { count: 'exact', head: true }).eq('sector_id', s.id),
      supabase.from('organization_service_sectors').select('sector_id', { count: 'exact', head: true }).eq('sector_id', s.id),
      supabase.from('organization_future_plans').select('sector_id', { count: 'exact', head: true }).eq('sector_id', s.id),
      supabase.from('resource_sectors').select('sector_id', { count: 'exact', head: true }).eq('sector_id', s.id),
    ]);
    const total = (a.count || 0) + (b.count || 0) + (c.count || 0) + (d.count || 0);
    setUsageCount(total);
  };

  const confirmDelete = async () => {
    if (!deletingSector) return;
    setDeleting(true);
    const { error } = await supabase.from('sectors').delete().eq('id', deletingSector.id);
    if (error) {
      toast({
        title: 'Cannot delete sector',
        description: error.message.includes('violates foreign key')
          ? 'This sector is still used by some organizations. Deactivate it instead.'
          : error.message,
        variant: 'destructive',
      });
    } else {
      toast({ title: 'Sector deleted' });
      setSectors(prev => prev.filter(x => x.id !== deletingSector.id));
    }
    setDeleting(false);
    setDeletingSector(null);
  };

  const filtered = sectors.filter(s => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return s.label.toLowerCase().includes(q) || s.slug.toLowerCase().includes(q);
  });

  const activeCount = sectors.filter(s => s.is_active).length;
  const inactiveCount = sectors.length - activeCount;

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Tag className="h-6 w-6 text-primary" /> Sectors
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Industry sectors users can pick during onboarding (marina interests, partner services, future plans).
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={loadSectors}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </Button>
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4 mr-2" /> Add Sector
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            placeholder="Search by name or slug..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
        <div className="text-xs text-gray-500 flex items-center gap-3">
          <span><strong className="text-gray-900">{sectors.length}</strong> total</span>
          <span className="text-green-700"><strong>{activeCount}</strong> active</span>
          {inactiveCount > 0 && <span className="text-gray-500"><strong>{inactiveCount}</strong> inactive</span>}
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b text-left text-sm">
                <tr>
                  <th className="p-4 font-medium">Label</th>
                  <th className="p-4 font-medium">Slug</th>
                  <th className="p-4 font-medium">Active</th>
                  <th className="p-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={4} className="p-8 text-center text-gray-400">
                    <RefreshCw className="h-5 w-5 animate-spin inline mr-2" /> Loading sectors...
                  </td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={4} className="p-8 text-center text-gray-400">
                    {search ? 'No sectors match your search.' : 'No sectors yet — add your first one.'}
                  </td></tr>
                ) : filtered.map(s => (
                  <tr key={s.id} className="border-b hover:bg-gray-50/50 transition-colors">
                    <td className="p-4">
                      <div className="font-medium text-gray-900">{s.label}</div>
                    </td>
                    <td className="p-4">
                      <code className="text-xs bg-gray-100 text-gray-700 px-2 py-0.5 rounded">{s.slug}</code>
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={s.is_active}
                          onCheckedChange={(v) => toggleActive(s, v)}
                        />
                        {s.is_active
                          ? <Badge variant="success" className="text-[10px]">Active</Badge>
                          : <Badge variant="secondary" className="text-[10px]">Inactive</Badge>}
                      </div>
                    </td>
                    <td className="p-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => openEdit(s)}>
                          <Edit2 className="h-4 w-4" />
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => openDelete(s)} className="text-red-600 hover:text-red-700 hover:bg-red-50">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Create / Edit dialog */}
      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Sector' : 'Add Sector'}</DialogTitle>
            <DialogDescription>
              {editing
                ? 'Rename, reslug, or toggle this sector.'
                : 'Add a new sector users can pick during onboarding.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Display name *</Label>
              <Input
                value={form.label}
                onChange={(e) => handleLabelChange(e.target.value)}
                placeholder="e.g. Marine Robotics & Automation"
              />
            </div>
            <div className="space-y-2">
              <Label>Slug *</Label>
              <Input
                value={form.slug}
                onChange={(e) => handleSlugChange(e.target.value)}
                placeholder="auto-generated from name"
              />
              <p className="text-[11px] text-gray-400">
                URL-safe identifier — lowercase, hyphens only. Used internally; changing it on existing sectors is rare.
              </p>
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <Label className="text-sm">Active</Label>
                <p className="text-xs text-gray-500">Inactive sectors don't appear in user dropdowns.</p>
              </div>
              <Switch
                checked={form.is_active}
                onCheckedChange={(v) => setForm(f => ({ ...f, is_active: v }))}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setEditorOpen(false)}>Cancel</Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                {editing ? 'Save Changes' : 'Add Sector'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={!!deletingSector} onOpenChange={(o) => !o && setDeletingSector(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete "{deletingSector?.label}"?</DialogTitle>
            <DialogDescription asChild>
              <div className="text-sm text-gray-600">
                {usageCount === null ? (
                  <span className="flex items-center gap-2 text-gray-500">
                    <Loader2 className="h-4 w-4 animate-spin" /> Checking usage...
                  </span>
                ) : usageCount > 0 ? (
                  <>
                    This sector is currently used <strong>{usageCount}</strong> time{usageCount > 1 ? 's' : ''} across organizations,
                    future plans, or resources. <strong>Deleting it will fail.</strong> Toggle it off (Inactive) instead — this hides it
                    from new users while preserving existing assignments.
                  </>
                ) : (
                  <>This sector isn't currently used anywhere. Deleting it is safe and permanent.</>
                )}
              </div>
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setDeletingSector(null)}>Cancel</Button>
            <Button
              onClick={confirmDelete}
              disabled={deleting || usageCount === null || usageCount > 0}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {deleting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Delete sector
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
