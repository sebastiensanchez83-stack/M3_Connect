import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw, Plus, Pencil, Trash2, Loader2, Tag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import {
  AdminEmpty, AdminFilterBar, AdminLoading, AdminPageHeader, AdminStatusPill, AdminTableCard,
  ADMIN_BTN, ADMIN_BTN_DANGER, ADMIN_BTN_PRIMARY,
} from './AdminUI';
import { FIELD, FormField } from './AdminStyleKit';

/**
 * Settings > Sectors (/admin/sectors): the industry sectors people pick when they register.
 * Refonte admin style (Oct 2026): a table on a computer, one card per sector on a phone; every
 * button says what it does; deleting asks first and is refused while the sector is in use.
 * Same reads and writes as before.
 */

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

const SMALL_BTN = 'h-9 px-3 text-[13px]';

export function AdminSectors() {
  const { t } = useTranslation();
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
      toast({ title: 'Type the name of the sector', variant: 'destructive' });
      return;
    }
    if (!slug) {
      toast({ title: 'Type the code of the sector', variant: 'destructive' });
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
      toast({ title: 'Sector saved' });
    } else {
      const { error } = await supabase
        .from('sectors')
        .insert({ label, slug, is_active: form.is_active });
      if (error) {
        toast({
          title: 'Failed to add sector',
          description: error.code === '23505' ? `A sector with the code "${slug}" already exists.` : error.message,
          variant: 'destructive',
        });
        setSaving(false);
        return;
      }
      toast({ title: 'Sector added', description: `"${label}" can now be picked by members.` });
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
    toast({ title: nextActive ? `"${s.label}" is shown again` : `"${s.label}" is hidden` });
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
          ? 'This sector is still used by some companies. Hide it instead.'
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

  const shownSwitch = (s: Sector) => (
    <span className="inline-flex items-center gap-2">
      <Switch
        checked={s.is_active}
        onCheckedChange={(v) => toggleActive(s, v)}
        aria-label={t('adm2.sectors.shownFor', 'Show {{name}} to members', { name: s.label })}
      />
      {s.is_active
        ? <AdminStatusPill tone="success">{t('adm2.sectors.shown', 'Shown')}</AdminStatusPill>
        : <AdminStatusPill>{t('adm2.sectors.hidden', 'Hidden')}</AdminStatusPill>}
    </span>
  );
  const rowButtons = (s: Sector) => (
    <>
      <Button type="button" variant="outline" size="sm" className={`${ADMIN_BTN} ${SMALL_BTN}`} onClick={() => openEdit(s)}>
        <Pencil className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
        {t('adm2.sectors.edit', 'Edit')}
        <span className="sr-only"> {s.label}</span>
      </Button>
      <Button type="button" variant="outline" size="sm" className={`${ADMIN_BTN_DANGER} ${SMALL_BTN}`} onClick={() => openDelete(s)}>
        <Trash2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
        {t('adm2.sectors.delete', 'Delete')}
        <span className="sr-only"> {s.label}</span>
      </Button>
    </>
  );

  return (
    <div>
      <AdminPageHeader
        title={t('adm2.sectors.title', 'Sectors')}
        count={sectors.length}
        description={t('adm2.sectors.desc', 'The industry sectors people pick when they register: what a marina is interested in, what a service provider offers, future plans.')}
        meta={
          <>
            <span>{t('adm2.sectors.activeCount', '{{count}} shown', { count: activeCount })}</span>
            {inactiveCount > 0 && <><span aria-hidden="true">•</span><span>{t('adm2.sectors.inactiveCount', '{{count}} hidden', { count: inactiveCount })}</span></>}
          </>
        }
        actions={
          <>
            <Button variant="outline" size="sm" className={ADMIN_BTN} onClick={loadSectors}>
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
              {t('adm2.sectors.reload', 'Reload the list')}
            </Button>
            <Button variant="secondary" size="sm" className={ADMIN_BTN_PRIMARY} onClick={openCreate}>
              <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
              {t('adm2.sectors.add', 'Add a sector')}
            </Button>
          </>
        }
      />

      <AdminFilterBar search={search} onSearchChange={setSearch} searchPlaceholder={t('adm2.sectors.search', 'Search a sector…')} />

      {loading && sectors.length === 0 ? (
        <AdminLoading />
      ) : filtered.length === 0 ? (
        <div className="rounded-card border border-rule bg-white">
          <AdminEmpty
            icon={Tag}
            title={search ? t('adm2.sectors.noMatch', 'No sector matches this search') : t('adm2.sectors.none', 'No sector yet')}
            body={search ? undefined : t('adm2.sectors.noneBody', 'Press "Add a sector" to create the first one.')}
          />
        </div>
      ) : (
        <>
          {/* Phone and small tablet (below 1024 px, where the table would scroll sideways next to the menu): one card per sector */}
          <ul className="space-y-3 lg:hidden" aria-label={t('adm2.sectors.title', 'Sectors')}>
            {filtered.map(s => (
              <li key={s.id} className="rounded-card border border-rule bg-white p-4">
                <p className="text-[16px] font-semibold leading-6 text-navy [overflow-wrap:anywhere]">{s.label}</p>
                <p className="mt-0.5 text-[13px] leading-5 text-meta">
                  {t('adm2.sectors.code', 'Code')}: <code className="rounded bg-chip px-1.5 py-0.5 text-[12px] text-navy [overflow-wrap:anywhere]">{s.slug}</code>
                </p>
                <div className="mt-3">{shownSwitch(s)}</div>
                <div className="mt-3 flex flex-wrap gap-2 border-t border-rule pt-3">{rowButtons(s)}</div>
              </li>
            ))}
          </ul>

          {/* 1024 px and up: the table */}
          <AdminTableCard className="hidden lg:block" footer={t('adm2.sectors.footer', '{{shown}} of {{total}} sectors shown', { shown: filtered.length, total: sectors.length })}>
            <table className="w-full">
              <thead>
                <tr>
                  <th className="text-left">{t('adm2.sectors.colName', 'Name')}</th>
                  <th className="text-left">{t('adm2.sectors.colCode', 'Code')}</th>
                  <th className="text-left">{t('adm2.sectors.colShown', 'Shown to members')}</th>
                  <th className="text-right"><span className="sr-only">{t('adm2.sectors.colActions', 'Actions')}</span></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(s => (
                  <tr key={s.id}>
                    <td><span className="font-semibold text-navy">{s.label}</span></td>
                    <td><code className="rounded bg-chip px-2 py-0.5 text-[12px] text-navy">{s.slug}</code></td>
                    <td>{shownSwitch(s)}</td>
                    <td className="text-right"><div className="flex items-center justify-end gap-2">{rowButtons(s)}</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </AdminTableCard>
        </>
      )}

      {/* Create / Edit dialog */}
      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-md overflow-y-auto rounded-card p-4 sm:p-6">
          <DialogHeader className="pr-8 text-left">
            <DialogTitle className="text-[19px] leading-7 text-navy">{editing ? t('adm2.sectors.editTitle', 'Edit the sector') : t('adm2.sectors.addTitle', 'Add a sector')}</DialogTitle>
            <DialogDescription className="text-[14px] leading-5 text-meta">
              {editing
                ? t('adm2.sectors.editDesc', 'Rename it, change its code, or hide it from members.')
                : t('adm2.sectors.addDesc', 'A new sector people can pick when they register.')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <FormField label={t('adm2.sectors.nameLabel', 'Name shown to members *')} htmlFor="sector-label">
              <Input
                id="sector-label"
                className={FIELD}
                value={form.label}
                onChange={(e) => handleLabelChange(e.target.value)}
                placeholder="e.g. Marine Robotics & Automation"
              />
            </FormField>
            <FormField
              label={t('adm2.sectors.codeLabel', 'Code *')}
              htmlFor="sector-slug"
              hint={t('adm2.sectors.codeHint', 'Made from the name: small letters and hyphens only. Used inside the platform; rarely changed on an existing sector.')}
            >
              <Input
                id="sector-slug"
                className={`${FIELD} font-mono`}
                value={form.slug}
                onChange={(e) => handleSlugChange(e.target.value)}
                placeholder="made-from-the-name"
              />
            </FormField>
            <label htmlFor="sector-active" className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-rule bg-white p-3">
              <span>
                <span className="block text-[14px] font-semibold leading-5 text-navy">{t('adm2.sectors.activeLabel', 'Shown to members')}</span>
                <span className="mt-0.5 block text-[13px] leading-[18px] text-meta">{t('adm2.sectors.activeHint', 'A hidden sector is not offered in the lists; companies that chose it keep it.')}</span>
              </span>
              <Switch
                id="sector-active"
                checked={form.is_active}
                onCheckedChange={(v) => setForm(f => ({ ...f, is_active: v }))}
              />
            </label>
            <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
              <Button variant="outline" className={ADMIN_BTN} onClick={() => setEditorOpen(false)}>{t('adm2.cancel', 'Cancel')}</Button>
              <Button variant="secondary" className={ADMIN_BTN_PRIMARY} onClick={handleSave} disabled={saving}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                {editing ? t('adm2.sectors.saveEdit', 'Save the sector') : t('adm2.sectors.saveNew', 'Add the sector')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={!!deletingSector} onOpenChange={(o) => !o && setDeletingSector(null)}>
        <DialogContent className="max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-md overflow-y-auto rounded-card p-4 sm:p-6">
          <DialogHeader className="pr-8 text-left">
            <DialogTitle className="text-[19px] leading-7 text-navy [overflow-wrap:anywhere]">{t('adm2.sectors.deleteTitle', 'Delete "{{name}}"?', { name: deletingSector?.label })}</DialogTitle>
            <DialogDescription asChild>
              <div className="text-[14px] leading-5 text-ink">
                {usageCount === null ? (
                  <span className="flex items-center gap-2 text-meta">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> {t('adm2.sectors.checking', 'Checking where it is used…')}
                  </span>
                ) : usageCount > 0 ? (
                  <>
                    This sector is used <strong>{usageCount}</strong> time{usageCount > 1 ? 's' : ''} by companies, future plans or resources,
                    so it <strong>cannot be deleted</strong>. Hide it instead (switch it off): new members no longer see it and the
                    companies that chose it keep it.
                  </>
                ) : (
                  <>This sector is not used anywhere. Deleting it is safe and cannot be undone.</>
                )}
              </div>
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
            <Button variant="outline" className={ADMIN_BTN} onClick={() => setDeletingSector(null)}>{t('adm2.cancel', 'Cancel')}</Button>
            <Button
              variant="outline"
              onClick={confirmDelete}
              disabled={deleting || usageCount === null || usageCount > 0}
              className={ADMIN_BTN_DANGER}
            >
              {deleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />}
              {t('adm2.sectors.deleteBtn', 'Delete this sector')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
