import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft, Save, Trash2, Loader2, Calendar, MapPin, Globe, Users,
  DollarSign, Eye, Radio, Film, Plus, X,
} from 'lucide-react';
import { TIER_LABELS, TIER_COLORS, OrgTier } from '@/types/database';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import type { Event, EventPricingRow } from './types';
import { DEFAULT_PRICING } from './types';

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
    title: '', description: '', date_time: '', location: '', language: 'EN',
    access_level: 'public', event_type: 'webinar', replay_url: '',
  });
  const [speakers, setSpeakers] = useState<{ name: string; title: string }[]>([]);

  // Pricing
  const [pricingRows, setPricingRows] = useState<EventPricingRow[]>([]);
  const [pricingLoading, setPricingLoading] = useState(false);

  // Registrations
  const [registrations, setRegistrations] = useState<RegistrationRow[]>([]);
  const [regsLoading, setRegsLoading] = useState(false);

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
    const evt = data as Event;
    setEvent(evt);
    setForm({
      title: evt.title, description: evt.description,
      date_time: evt.date_time ? new Date(evt.date_time).toISOString().slice(0, 16) : '',
      location: evt.location || '', language: evt.language, access_level: evt.access_level,
      event_type: evt.event_type || 'webinar', replay_url: evt.replay_url || '',
    });
    setSpeakers(evt.speakers || []);
    setLoading(false);

    // Load pricing and registrations in parallel
    loadPricing(eventId);
    loadRegistrations(eventId);
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
      // Enrich with user names
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

  const handleSave = async () => {
    if (!form.title || !form.date_time) {
      toast({ title: 'Title and date are required', variant: 'destructive' });
      return;
    }
    setSaving(true);
    const payload = {
      title: form.title, description: form.description, date_time: form.date_time,
      location: form.location || null, language: form.language, access_level: form.access_level,
      speakers, replay_url: form.replay_url || null, event_type: form.event_type,
    };

    if (isNew) {
      const { data, error } = await supabase.from('events').insert(payload).select().single();
      if (error) { toast({ title: 'Failed to create event', variant: 'destructive' }); setSaving(false); return; }
      toast({ title: 'Event created!' });
      // Save pricing
      await savePricingForEvent(data.id);
      navigate(`/admin/events/${data.id}`, { replace: true });
    } else if (event) {
      const { error } = await supabase.from('events').update(payload).eq('id', event.id);
      if (error) { toast({ title: 'Failed to update', variant: 'destructive' }); setSaving(false); return; }
      await savePricingForEvent(event.id);
      toast({ title: 'Event saved!' });
      loadEvent(event.id);
    }
    setSaving(false);
  };

  const savePricingForEvent = async (eventId: string) => {
    await supabase.from('event_pricing').delete().eq('event_id', eventId);
    const rows = pricingRows.map(r => ({
      event_id: eventId, tier: r.tier, price_cents: r.price_cents,
      max_included_seats: r.max_included_seats,
      additional_member_price_cents: r.additional_member_price_cents,
      discount_pct: r.discount_pct,
    }));
    await supabase.from('event_pricing').insert(rows);
  };

  const handleDelete = async () => {
    if (!event || !confirm('Delete this event permanently?')) return;
    await supabase.from('events').delete().eq('id', event.id);
    toast({ title: 'Event deleted' });
    navigate('/admin/events');
  };

  const updatePricingRow = (index: number, field: keyof EventPricingRow, value: number | null) => {
    setPricingRows(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  const addSpeaker = () => setSpeakers([...speakers, { name: '', title: '' }]);
  const removeSpeaker = (i: number) => setSpeakers(speakers.filter((_, idx) => idx !== i));
  const updateSpeaker = (i: number, field: 'name' | 'title', value: string) => {
    setSpeakers(prev => { const n = [...prev]; n[i] = { ...n[i], [field]: value }; return n; });
  };

  const approveRegistration = async (regId: string) => {
    const amount = prompt('Enter amount due in euros (0 for free):');
    if (amount === null) return;
    const cents = Math.round(parseFloat(amount) * 100);
    await supabase.from('event_registrations').update({
      payment_status: cents > 0 ? 'pending_payment' : 'paid',
      amount_due_cents: cents,
    }).eq('id', regId);
    toast({ title: cents > 0 ? 'Approved — payment pending' : 'Approved — free entry' });
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
              <Badge variant={form.event_type === 'on_site' ? 'info' : 'secondary'}>
                {form.event_type === 'on_site' ? 'On-Site' : 'Webinar'}
              </Badge>
              {isPast && <Badge variant="outline" className="text-gray-500">Past Event</Badge>}
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

      {/* Event Details */}
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
            <Label>Description *</Label>
            <Textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={4} placeholder="Describe the event..." />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5"><Calendar className="h-3.5 w-3.5 text-gray-400" /> Date & Time *</Label>
              <Input type="datetime-local" value={form.date_time} onChange={e => setForm({ ...form, date_time: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5 text-gray-400" /> Location</Label>
              <Input value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} placeholder="Monaco Yacht Club" />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5"><Radio className="h-3.5 w-3.5 text-gray-400" /> Event Type *</Label>
              <Select value={form.event_type} onValueChange={v => setForm({ ...form, event_type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="webinar">Webinar (Online)</SelectItem>
                  <SelectItem value="on_site">On-Site Event</SelectItem>
                </SelectContent>
              </Select>
            </div>
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
          <div className="space-y-2">
            <Label className="flex items-center gap-1.5"><Film className="h-3.5 w-3.5 text-gray-400" /> Replay URL</Label>
            <Input value={form.replay_url} onChange={e => setForm({ ...form, replay_url: e.target.value })} placeholder="https://..." />
          </div>
        </CardContent>
      </Card>

      {/* Speakers */}
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

      {/* Pricing */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-bold text-gray-700 flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-emerald-500" /> Tier Pricing
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
                        <Label className="text-[10px] text-gray-500">Price (\u20AC)</Label>
                        <Input type="number" min={0} className="h-8" value={row.price_cents / 100}
                          onChange={e => updatePricingRow(i, 'price_cents', Math.round(parseFloat(e.target.value || '0') * 100))} />
                      </div>
                      <div>
                        <Label className="text-[10px] text-gray-500">Included Seats</Label>
                        <Input type="number" min={0} className="h-8" value={row.max_included_seats ?? ''} placeholder="\u221E"
                          onChange={e => updatePricingRow(i, 'max_included_seats', e.target.value ? parseInt(e.target.value) : null)} />
                      </div>
                      <div>
                        <Label className="text-[10px] text-gray-500">Extra Seat (\u20AC)</Label>
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
                "Included Seats" = free registrations per tier. "Extra Seat" = price for additional members beyond included. Leave blank for unlimited.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Registrations */}
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
                        <span className="text-xs font-medium text-gray-600">\u20AC{(reg.amount_due_cents / 100).toFixed(0)}</span>
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
