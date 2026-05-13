import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft, Save, Trash2, Loader2, Calendar, MapPin, Globe, Users,
  DollarSign, Eye, Radio, Film, Plus, X, Upload, FileText, Lock,
  Tag, Package, Sun,
} from 'lucide-react';
import { TIER_LABELS, TIER_COLORS, OrgTier, Sector } from '@/types/database';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import type { Event, EventPricingRow } from './types';
import { DEFAULT_PRICING } from './types';

// Convert a DB timestamp (UTC ISO string) to a local "YYYY-MM-DDTHH:mm" string
// suitable for <input type="datetime-local"> (which expects local wall-clock time).
function toLocalDatetimeInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

interface RegistrationRow {
  id: string;
  user_id: string;
  registration_type: string;
  payment_status: string;
  amount_due_cents: number | null;
  registered_at: string;
  profile_name: string;
  profile_email: string;
  org_name: string | null;
}

interface PackageRow {
  id?: string;
  name: string;
  description: string;
  price_cents: number;
  max_seats: number | null;
  display_order: number;
}

export function AdminEventDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const isNew = id === 'new';

  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [event, setEvent] = useState<Event | null>(null);

  // Form
  const [form, setForm] = useState({
    title: '', description: '', date_time: '', end_date_time: '', location: '',
    language: 'EN', access_level: 'public', event_type: 'webinar', replay_url: '', meeting_url: '',
    invitation_only: false, is_full_day: false, published: true,
  });
  const [speakers, setSpeakers] = useState<{ name: string; title: string }[]>([]);

  // Sectors
  const [allSectors, setAllSectors] = useState<Sector[]>([]);
  const [selectedSectorIds, setSelectedSectorIds] = useState<string[]>([]);

  // Packages (for on-site events)
  const [packages, setPackages] = useState<PackageRow[]>([]);

  // Pricing (legacy tier-based — kept for backward compat)
  const [pricingRows, setPricingRows] = useState<EventPricingRow[]>([]);
  const [pricingLoading, setPricingLoading] = useState(false);

  // PDF upload
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [uploadingPdf, setUploadingPdf] = useState(false);

  // Registrations
  const [registrations, setRegistrations] = useState<RegistrationRow[]>([]);
  const [regsLoading, setRegsLoading] = useState(false);

  const isOnSite = form.event_type === 'on_site';
  const isWebinar = form.event_type === 'webinar';

  // Load sectors once
  useEffect(() => {
    supabase.from('sectors').select('*').eq('is_active', true).order('label')
      .then(({ data }) => { if (data) setAllSectors(data as Sector[]); });
  }, []);

  useEffect(() => {
    if (!isNew && id) loadEvent(id);
  }, [id]);

  const loadEvent = async (eventId: string) => {
    setLoading(true);
    const { data, error } = await supabase.from('events').select('*').eq('id', eventId).single();
    if (error || !data) {
      toast({ title: 'Event not found', variant: 'destructive' });
      navigate('/admin/events');
      return;
    }
    const evt = data as any;
    setEvent(evt as Event);
    setForm({
      title: evt.title, description: evt.description || '',
      // datetime-local inputs expect LOCAL wall-clock time, not UTC. Using .toISOString()
      // (which returns UTC) caused the admin to see a UTC value, then re-save it as local,
      // shifting every event by the browser's TZ offset (+2h in CEST). Convert to local here.
      date_time: evt.date_time ? toLocalDatetimeInput(evt.date_time) : '',
      end_date_time: evt.end_date_time ? toLocalDatetimeInput(evt.end_date_time) : '',
      location: evt.location || '', language: evt.language || 'EN',
      access_level: evt.access_level || 'public',
      event_type: evt.event_type || 'webinar', replay_url: evt.replay_url || '',
      meeting_url: evt.meeting_url || '',
      invitation_only: evt.invitation_only || false,
      is_full_day: evt.is_full_day || false,
      published: evt.published !== false,
    });
    setSpeakers(evt.speakers || []);
    setPdfUrl(evt.pdf_url || null);
    setLoading(false);

    // Load related data in parallel
    loadPricing(eventId);
    loadRegistrations(eventId);
    loadEventSectors(eventId);
    loadPackages(eventId);
  };

  const loadEventSectors = async (eventId: string) => {
    const { data } = await supabase.from('event_sectors').select('sector_id').eq('event_id', eventId);
    setSelectedSectorIds((data || []).map((r: any) => r.sector_id));
  };

  const loadPackages = async (eventId: string) => {
    const { data } = await supabase
      .from('event_packages')
      .select('id, name, description, price_cents, max_seats, display_order')
      .eq('event_id', eventId)
      .order('display_order');
    setPackages((data || []) as PackageRow[]);
  };

  const loadPricing = async (eventId: string) => {
    setPricingLoading(true);
    const { data } = await supabase
      .from('event_pricing')
      .select('id, tier, price_cents, max_included_seats, additional_member_price_cents, discount_pct')
      .eq('event_id', eventId).order('tier');
    setPricingRows(data && data.length > 0 ? data as EventPricingRow[] : DEFAULT_PRICING.map(d => ({ ...d })));
    setPricingLoading(false);
  };

  const loadRegistrations = async (eventId: string) => {
    setRegsLoading(true);
    const { data } = await supabase
      .from('event_registrations')
      .select('id, user_id, registration_type, payment_status, amount_due_cents, registered_at')
      .eq('event_id', eventId)
      .order('registered_at', { ascending: false });

    if (data && data.length > 0) {
      const userIds = [...new Set(data.map((r: any) => r.user_id))];
      const { data: profiles } = await supabase
        .from('profiles').select('user_id, first_name, last_name, email')
        .in('user_id', userIds);
      const { data: members } = await supabase
        .from('organization_members').select('user_id, organization_id, organizations(name)')
        .in('user_id', userIds);

      const profileMap = new Map((profiles || []).map((p: any) => [p.user_id, p]));
      const orgMap = new Map((members || []).map((m: any) => [m.user_id, (m.organizations as any)?.name || null]));

      setRegistrations(data.map((r: any) => {
        const p = profileMap.get(r.user_id) as any;
        return {
          ...r,
          profile_name: p ? `${p.first_name || ''} ${p.last_name || ''}`.trim() || p.email : r.user_id,
          profile_email: p?.email || '',
          org_name: orgMap.get(r.user_id) || null,
        };
      }));
    } else {
      setRegistrations([]);
    }
    setRegsLoading(false);
  };

  /* ─── Save ─── */
  const handleSave = async () => {
    if (!form.title) {
      toast({ title: 'Title is required', variant: 'destructive' });
      return;
    }
    setSaving(true);
    const payload: Record<string, unknown> = {
      title: form.title, description: form.description,
      // form.date_time is a local wall-clock string from a datetime-local input.
      // Convert it to a real ISO (UTC) timestamp before sending to Postgres so the
      // "timestamptz" column stores the intended local instant, not a UTC string mis-interpreted.
      date_time: form.date_time ? new Date(form.date_time).toISOString() : null,
      end_date_time: form.end_date_time ? new Date(form.end_date_time).toISOString() : null,
      location: isOnSite ? (form.location || null) : null,
      language: form.language, access_level: form.access_level,
      speakers, replay_url: isWebinar ? (form.replay_url || null) : null,
      meeting_url: isWebinar ? (form.meeting_url || null) : null,
      event_type: form.event_type,
      invitation_only: form.invitation_only,
      is_full_day: form.is_full_day,
      published: form.published,
      pdf_url: pdfUrl,
    };

    let eventId: string;

    if (isNew) {
      const { data, error } = await supabase.from('events').insert(payload).select('id').single();
      if (error) { toast({ title: 'Failed to create event', description: error.message, variant: 'destructive' }); setSaving(false); return; }
      eventId = data.id;
      toast({ title: 'Event created!' });
    } else if (event) {
      eventId = event.id;
      const { error } = await supabase.from('events').update(payload).eq('id', event.id);
      if (error) { toast({ title: 'Failed to update', description: error.message, variant: 'destructive' }); setSaving(false); return; }
    } else {
      setSaving(false); return;
    }

    // Save related data in parallel
    await Promise.all([
      savePricingForEvent(eventId),
      saveSectorsForEvent(eventId),
      savePackagesForEvent(eventId),
    ]);

    if (isNew) {
      navigate(`/admin/events/${eventId}`, { replace: true });
    } else {
      toast({ title: 'Event saved!' });
      loadEvent(eventId);
    }
    setSaving(false);
  };

  const savePricingForEvent = async (eventId: string) => {
    await supabase.from('event_pricing').delete().eq('event_id', eventId);
    if (isOnSite && pricingRows.length > 0) {
      const rows = pricingRows.map(r => ({
        event_id: eventId, tier: r.tier, price_cents: r.price_cents,
        max_included_seats: r.max_included_seats,
        additional_member_price_cents: r.additional_member_price_cents,
        discount_pct: r.discount_pct,
      }));
      await supabase.from('event_pricing').insert(rows);
    }
  };

  const saveSectorsForEvent = async (eventId: string) => {
    await supabase.from('event_sectors').delete().eq('event_id', eventId);
    if (selectedSectorIds.length > 0) {
      await supabase.from('event_sectors').insert(
        selectedSectorIds.map(sid => ({ event_id: eventId, sector_id: sid }))
      );
    }
  };

  const savePackagesForEvent = async (eventId: string) => {
    await supabase.from('event_packages').delete().eq('event_id', eventId);
    if (packages.length > 0) {
      await supabase.from('event_packages').insert(
        packages.map((p, i) => ({
          event_id: eventId, name: p.name, description: p.description || null,
          price_cents: p.price_cents, max_seats: p.max_seats, display_order: i,
        }))
      );
    }
  };

  const handleDelete = async () => {
    if (!event || !confirm('Delete this event permanently?')) return;
    await supabase.from('events').delete().eq('id', event.id);
    toast({ title: 'Event deleted' });
    navigate('/admin/events');
  };

  /* ─── PDF Upload ─── */
  const handlePdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type !== 'application/pdf') { toast({ title: 'Only PDF files allowed', variant: 'destructive' }); return; }
    if (file.size > 10 * 1024 * 1024) { toast({ title: 'File too large (max 10MB)', variant: 'destructive' }); return; }

    setUploadingPdf(true);
    const fileName = `event-pdfs/${Date.now()}-${file.name}`;
    const { error } = await supabase.storage.from('public-assets').upload(fileName, file);
    if (error) {
      toast({ title: 'Upload failed', description: error.message, variant: 'destructive' });
      setUploadingPdf(false);
      return;
    }
    const { data: urlData } = supabase.storage.from('public-assets').getPublicUrl(fileName);
    setPdfUrl(urlData.publicUrl);
    toast({ title: 'PDF uploaded!' });
    setUploadingPdf(false);
  };

  /* ─── Helpers ─── */
  const updatePricingRow = (index: number, field: keyof EventPricingRow, value: number | null) => {
    setPricingRows(prev => { const u = [...prev]; u[index] = { ...u[index], [field]: value }; return u; });
  };

  const addSpeaker = () => setSpeakers([...speakers, { name: '', title: '' }]);
  const removeSpeaker = (i: number) => setSpeakers(speakers.filter((_, idx) => idx !== i));
  const updateSpeaker = (i: number, field: 'name' | 'title', value: string) => {
    setSpeakers(prev => { const n = [...prev]; n[i] = { ...n[i], [field]: value }; return n; });
  };

  const addPackage = () => setPackages([...packages, { name: '', description: '', price_cents: 0, max_seats: null, display_order: packages.length }]);
  const removePackage = (i: number) => setPackages(packages.filter((_, idx) => idx !== i));
  const updatePackage = (i: number, field: keyof PackageRow, value: any) => {
    setPackages(prev => { const n = [...prev]; n[i] = { ...n[i], [field]: value }; return n; });
  };

  const toggleSector = (sectorId: string) => {
    setSelectedSectorIds(prev =>
      prev.includes(sectorId) ? prev.filter(id => id !== sectorId) : [...prev, sectorId]
    );
  };

  const approveRegistration = async (regId: string) => {
    const amount = prompt('Enter amount due in euros (0 for free):');
    if (amount === null) return;
    const cents = Math.round(parseFloat(amount) * 100);
    await supabase.from('event_registrations').update({
      payment_status: cents > 0 ? 'pending_payment' : 'paid',
      amount_due_cents: cents,
    }).eq('id', regId);
    toast({ title: cents > 0 ? 'Approved \u2014 payment pending' : 'Approved \u2014 free entry' });
    if (event) loadRegistrations(event.id);
  };

  const rejectRegistration = async (regId: string) => {
    if (!confirm('Reject this registration?')) return;
    await supabase.from('event_registrations').update({ payment_status: 'rejected' }).eq('id', regId);
    toast({ title: 'Registration rejected' });
    if (event) loadRegistrations(event.id);
  };

  const paymentBadge = (status: string) => {
    const map: Record<string, { variant: any; label: string }> = {
      pending_approval: { variant: 'warning', label: 'Pending Approval' },
      pending_payment: { variant: 'info', label: 'Payment Due' },
      paid: { variant: 'success', label: 'Paid' },
      free: { variant: 'success', label: 'Free' },
      rejected: { variant: 'destructive', label: 'Rejected' },
    };
    const m = map[status] || { variant: 'outline', label: status };
    return <Badge variant={m.variant}>{m.label}</Badge>;
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );

  const isPast = form.date_time && new Date(form.date_time) < new Date();

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate('/admin/events')} className="gap-1.5">
            <ArrowLeft className="h-4 w-4" /> Events
          </Button>
          <Separator orientation="vertical" className="h-6" />
          <h1 className="text-xl font-bold text-gray-900">{isNew ? 'Create Event' : form.title || 'Edit Event'}</h1>
          {!isNew && event && (
            <>
              <Badge variant={isOnSite ? 'info' : 'secondary'}>
                {isOnSite ? 'On-Site' : 'Webinar'}
              </Badge>
              {isPast && <Badge variant="outline" className="text-gray-500">Past Event</Badge>}
              {!form.published && <Badge variant="warning">Draft</Badge>}
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!isNew && (
            <Button variant="outline" size="sm" onClick={handleDelete} className="text-red-600 hover:bg-red-50 gap-1.5">
              <Trash2 className="h-4 w-4" /> Delete
            </Button>
          )}
          <Button onClick={handleSave} disabled={saving} className="gap-1.5">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {isNew ? 'Create Event' : 'Save Changes'}
          </Button>
        </div>
      </div>

      {/* ── EVENT TYPE SELECTOR (top of form) ── */}
      <Card className="border-0 shadow-sm">
        <CardContent className="p-4">
          <div className="flex items-center gap-6">
            <Label className="text-sm font-bold text-gray-700">Event Type</Label>
            <div className="flex gap-2">
              {[
                { value: 'on_site', label: 'On-Site Event', icon: <MapPin className="h-4 w-4" /> },
                { value: 'webinar', label: 'Webinar (Online)', icon: <Radio className="h-4 w-4" /> },
              ].map(opt => (
                <button key={opt.value} type="button"
                  onClick={() => setForm({ ...form, event_type: opt.value })}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border-2 text-sm font-medium transition-all ${
                    form.event_type === opt.value
                      ? 'border-primary bg-primary/5 text-primary'
                      : 'border-gray-200 text-gray-500 hover:border-gray-300'
                  }`}>
                  {opt.icon} {opt.label}
                </button>
              ))}
            </div>
            <div className="ml-auto flex items-center gap-3">
              <div className="flex items-center gap-2">
                <Switch checked={form.published} onCheckedChange={v => setForm({ ...form, published: v })} />
                <Label className="text-xs text-gray-500">Published</Label>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── EVENT DETAILS ── */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-bold text-gray-700 flex items-center gap-2">
            <Calendar className="h-4 w-4 text-pink-500" /> Event Details
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Title *</Label>
            <Input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Event title" />
          </div>
          <div className="space-y-2">
            <Label>Description</Label>
            <Textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={4} placeholder="Describe the event..." />
          </div>

          {/* Date & Time */}
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <Label className="flex items-center gap-1.5"><Calendar className="h-3.5 w-3.5 text-gray-400" /> Date & Time</Label>
              <div className="flex items-center gap-2 ml-auto">
                <Switch checked={form.is_full_day} onCheckedChange={v => setForm({ ...form, is_full_day: v })} />
                <span className="text-xs text-gray-500 flex items-center gap-1"><Sun className="h-3 w-3" /> Full day</span>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label className="text-xs text-gray-400">Start {form.is_full_day ? 'date' : 'date & time'}</Label>
                <Input
                  type={form.is_full_day ? 'date' : 'datetime-local'}
                  value={form.is_full_day && form.date_time ? form.date_time.slice(0, 10) : form.date_time}
                  onChange={e => setForm({ ...form, date_time: e.target.value })}
                />
              </div>
              {!form.is_full_day && (
                <div className="space-y-1">
                  <Label className="text-xs text-gray-400">End date & time</Label>
                  <Input type="datetime-local" value={form.end_date_time}
                    onChange={e => setForm({ ...form, end_date_time: e.target.value })} />
                </div>
              )}
            </div>
          </div>

          {/* Location (on-site only) */}
          {isOnSite && (
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5 text-gray-400" /> Location</Label>
              <Input value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} placeholder="Monaco Yacht Club" />
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5"><Globe className="h-3.5 w-3.5 text-gray-400" /> Language</Label>
              <Select value={form.language} onValueChange={v => setForm({ ...form, language: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="EN">English</SelectItem>
                  <SelectItem value="FR">Fran\u00e7ais</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5"><Eye className="h-3.5 w-3.5 text-gray-400" /> Access Level</Label>
              <Select value={form.access_level} onValueChange={v => setForm({ ...form, access_level: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="public">Public</SelectItem>
                  <SelectItem value="members">Members</SelectItem>
                  <SelectItem value="marina">Marina Only</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Webinar URLs (webinar only) */}
          {isWebinar && (
            <>
              <div className="space-y-2">
                <Label className="flex items-center gap-1.5"><Radio className="h-3.5 w-3.5 text-violet-500" /> Live Meeting URL</Label>
                <Input
                  value={form.meeting_url}
                  onChange={e => setForm({ ...form, meeting_url: e.target.value })}
                  placeholder="https://zoom.us/j/… or Google Meet / Teams link"
                />
                <p className="text-xs text-gray-400">Shown to registered attendees so they can join the live session.</p>
              </div>
              <div className="space-y-2">
                <Label className="flex items-center gap-1.5"><Film className="h-3.5 w-3.5 text-gray-400" /> Replay URL</Label>
                <Input value={form.replay_url} onChange={e => setForm({ ...form, replay_url: e.target.value })} placeholder="https://..." />
                <p className="text-xs text-gray-400">Recording link, posted after the event.</p>
              </div>
            </>
          )}

          {/* Invitation Only (applies to both on-site events and webinars) */}
          <div className="flex items-center gap-3 p-3 rounded-xl bg-gray-50 border border-gray-200">
            <Lock className="h-4 w-4 text-gray-500" />
            <div className="flex-1">
              <div className="text-sm font-medium text-gray-700">Invitation Only</div>
              <div className="text-xs text-gray-400">
                {isOnSite
                  ? 'Users must request an invitation which you approve manually'
                  : 'Restricts the webinar to invited users only — disables public guest signup'}
              </div>
            </div>
            <Switch checked={form.invitation_only} onCheckedChange={v => setForm({ ...form, invitation_only: v })} />
          </div>
        </CardContent>
      </Card>

      {/* ── SECTORS ── */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-bold text-gray-700 flex items-center gap-2">
            <Tag className="h-4 w-4 text-teal-500" /> Sectors ({selectedSectorIds.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-gray-400 mb-3">Select sectors to show this event to relevant users in their recommendations.</p>
          <div className="flex flex-wrap gap-2">
            {allSectors.map(s => {
              const selected = selectedSectorIds.includes(s.id);
              return (
                <button key={s.id} type="button" onClick={() => toggleSector(s.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                    selected
                      ? 'bg-teal-50 border-teal-300 text-teal-700'
                      : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'
                  }`}>
                  {s.label}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* ── PDF UPLOAD (on-site only) ── */}
      {isOnSite && (
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-bold text-gray-700 flex items-center gap-2">
              <FileText className="h-4 w-4 text-orange-500" /> Event Presentation (PDF)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {pdfUrl ? (
              <div className="flex items-center gap-3 bg-orange-50 rounded-xl p-3 border border-orange-200">
                <FileText className="h-5 w-5 text-orange-600 shrink-0" />
                <a href={pdfUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-orange-700 hover:underline truncate flex-1">
                  {pdfUrl.split('/').pop()}
                </a>
                <Button variant="ghost" size="sm" onClick={() => setPdfUrl(null)} className="text-red-400 hover:text-red-600 h-7 px-2">
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <label className="flex items-center gap-3 p-4 border-2 border-dashed border-gray-200 rounded-xl cursor-pointer hover:border-primary/40 hover:bg-primary/5 transition-all">
                {uploadingPdf ? <Loader2 className="h-5 w-5 animate-spin text-primary" /> : <Upload className="h-5 w-5 text-gray-400" />}
                <span className="text-sm text-gray-500">{uploadingPdf ? 'Uploading...' : 'Click to upload PDF presentation (max 10MB)'}</span>
                <input type="file" accept=".pdf" className="hidden" onChange={handlePdfUpload} disabled={uploadingPdf} />
              </label>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── SPEAKERS ── */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-bold text-gray-700 flex items-center gap-2">
              <Users className="h-4 w-4 text-blue-500" /> Speakers ({speakers.length})
            </CardTitle>
            <Button variant="outline" size="sm" onClick={addSpeaker} className="gap-1.5">
              <Plus className="h-3.5 w-3.5" /> Add Speaker
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {speakers.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">No speakers added yet</p>
          ) : (
            <div className="space-y-3">
              {speakers.map((sp, i) => (
                <div key={i} className="flex items-center gap-3 bg-gray-50 rounded-xl p-3">
                  <div className="h-9 w-9 rounded-xl bg-blue-100 flex items-center justify-center text-xs font-bold text-blue-700 shrink-0">
                    {(sp.name?.[0] || '?').toUpperCase()}
                  </div>
                  <div className="flex-1 grid grid-cols-2 gap-3">
                    <Input value={sp.name} onChange={e => updateSpeaker(i, 'name', e.target.value)} placeholder="Speaker name" className="h-8" />
                    <Input value={sp.title} onChange={e => updateSpeaker(i, 'title', e.target.value)} placeholder="Job title / Company" className="h-8" />
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => removeSpeaker(i)} className="h-8 w-8 p-0 text-red-400 hover:text-red-600">
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── EVENT PACKAGES (on-site events) ── */}
      {isOnSite && (
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-bold text-gray-700 flex items-center gap-2">
                <Package className="h-4 w-4 text-purple-500" /> Event Packages ({packages.length})
              </CardTitle>
              <Button variant="outline" size="sm" onClick={addPackage} className="gap-1.5">
                <Plus className="h-3.5 w-3.5" /> Add Package
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-gray-400 mb-3">Define packages that users can select when registering. These are shown on the event page.</p>
            {packages.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-4">No packages defined \u2014 users will register without a package selection</p>
            ) : (
              <div className="space-y-3">
                {packages.map((pkg, i) => (
                  <div key={i} className="bg-gray-50 rounded-xl p-4 border border-gray-200 space-y-3">
                    <div className="flex items-center gap-3">
                      <div className="flex-1 grid grid-cols-3 gap-3">
                        <div className="col-span-2 space-y-1">
                          <Label className="text-[10px] text-gray-500">Package Name *</Label>
                          <Input value={pkg.name} onChange={e => updatePackage(i, 'name', e.target.value)}
                            placeholder="e.g. Visitor, Exhibitor, VIP..." className="h-8" />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[10px] text-gray-500">Price (€)</Label>
                          <Input type="number" min={0} className="h-8" value={pkg.price_cents / 100}
                            onChange={e => updatePackage(i, 'price_cents', Math.round(parseFloat(e.target.value || '0') * 100))} />
                        </div>
                      </div>
                      <Button variant="ghost" size="sm" onClick={() => removePackage(i)} className="h-8 w-8 p-0 text-red-400 hover:text-red-600 shrink-0">
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <div className="col-span-2 space-y-1">
                        <Label className="text-[10px] text-gray-500">Description</Label>
                        <Input value={pkg.description} onChange={e => updatePackage(i, 'description', e.target.value)}
                          placeholder="What's included in this package..." className="h-8" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px] text-gray-500">Max Seats</Label>
                        <Input type="number" min={0} className="h-8" value={pkg.max_seats ?? ''} placeholder="\u221E"
                          onChange={e => updatePackage(i, 'max_seats', e.target.value ? parseInt(e.target.value) : null)} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── TIER PRICING (on-site events) ── */}
      {isOnSite && (
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-bold text-gray-700 flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-emerald-500" /> Sponsorship Tier Pricing
            </CardTitle>
          </CardHeader>
          <CardContent>
            {pricingLoading ? (
              <div className="flex items-center justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>
            ) : (
              <div className="space-y-3">
                {pricingRows.map((row, i) => {
                  const colors = TIER_COLORS[row.tier as OrgTier];
                  return (
                    <div key={row.tier} className="flex items-center gap-4 bg-gray-50 rounded-xl p-3">
                      <Badge className={`${colors?.bg || 'bg-gray-100'} ${colors?.text || 'text-gray-800'} border ${colors?.border || 'border-gray-200'} min-w-[120px] justify-center`}>
                        {TIER_LABELS[row.tier as OrgTier] || row.tier}
                      </Badge>
                      <div className="flex-1 grid grid-cols-4 gap-3">
                        <div>
                          <Label className="text-[10px] text-gray-500">Price (€)</Label>
                          <Input type="number" min={0} className="h-8" value={row.price_cents / 100}
                            onChange={e => updatePricingRow(i, 'price_cents', Math.round(parseFloat(e.target.value || '0') * 100))} />
                        </div>
                        <div>
                          <Label className="text-[10px] text-gray-500">Included Seats</Label>
                          <Input type="number" min={0} className="h-8" value={row.max_included_seats ?? ''} placeholder="\u221E"
                            onChange={e => updatePricingRow(i, 'max_included_seats', e.target.value ? parseInt(e.target.value) : null)} />
                        </div>
                        <div>
                          <Label className="text-[10px] text-gray-500">Extra Seat (€)</Label>
                          <Input type="number" min={0} className="h-8" value={row.additional_member_price_cents / 100}
                            onChange={e => updatePricingRow(i, 'additional_member_price_cents', Math.round(parseFloat(e.target.value || '0') * 100))} />
                        </div>
                        <div>
                          <Label className="text-[10px] text-gray-500">Discount %</Label>
                          <Input type="number" min={0} max={100} className="h-8" value={row.discount_pct}
                            onChange={e => updatePricingRow(i, 'discount_pct', parseFloat(e.target.value || '0'))} />
                        </div>
                      </div>
                    </div>
                  );
                })}
                <p className="text-xs text-gray-500 mt-2">
                  Sponsor tier pricing for included seats and additional members. Leave "Included Seats" blank for unlimited.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── REGISTRATIONS ── */}
      {!isNew && (
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-bold text-gray-700 flex items-center gap-2">
              <Users className="h-4 w-4 text-violet-500" /> Registrations ({registrations.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {regsLoading ? (
              <div className="flex items-center justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>
            ) : registrations.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-4">No registrations yet</p>
            ) : (
              <div className="space-y-2">
                {registrations.map((reg) => (
                  <div key={reg.id} className="flex items-center justify-between bg-gray-50 rounded-xl p-3">
                    <div className="flex items-center gap-3">
                      <div className="h-9 w-9 rounded-xl bg-violet-100 flex items-center justify-center text-xs font-bold text-violet-700">
                        {(reg.profile_name?.[0] || '?').toUpperCase()}
                      </div>
                      <div>
                        <div className="text-sm font-medium text-gray-900">{reg.profile_name}</div>
                        <div className="text-[11px] text-gray-400">
                          {reg.profile_email}
                          {reg.org_name && <span> \u2022 {reg.org_name}</span>}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge variant="outline" className="text-xs">{reg.registration_type || 'standard'}</Badge>
                      {paymentBadge(reg.payment_status)}
                      {reg.amount_due_cents && reg.amount_due_cents > 0 && (
                        <span className="text-xs font-medium text-gray-600">€{(reg.amount_due_cents / 100).toFixed(0)}</span>
                      )}
                      {reg.payment_status === 'pending_approval' && (
                        <div className="flex gap-1">
                          <Button size="sm" variant="outline" className="h-7 text-xs text-green-600 hover:bg-green-50" onClick={() => approveRegistration(reg.id)}>
                            Approve
                          </Button>
                          <Button size="sm" variant="outline" className="h-7 text-xs text-red-600 hover:bg-red-50" onClick={() => rejectRegistration(reg.id)}>
                            Reject
                          </Button>
                        </div>
                      )}
                      <span className="text-[10px] text-gray-400">
                        {new Date(reg.registered_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
