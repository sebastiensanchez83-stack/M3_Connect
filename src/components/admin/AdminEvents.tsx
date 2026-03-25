import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  RefreshCw, Plus, Pencil, Trash2, DollarSign, Loader2,
} from 'lucide-react';
import { TIER_LABELS, TIER_COLORS, OrgTier } from '@/types/database';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import type { Event, EventPricingRow } from './types';
import { DEFAULT_PRICING } from './types';

export function AdminEvents() {
  const { t } = useTranslation();
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingEvent, setEditingEvent] = useState<Event | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [formData, setFormData] = useState({ title: '', description: '', date_time: '', location: '', language: 'EN', access_level: 'public', speakers: '', replay_url: '', event_type: 'webinar' });

  // Pricing dialog state
  const [pricingEventId, setPricingEventId] = useState<string | null>(null);
  const [pricingEventTitle, setPricingEventTitle] = useState('');
  const [pricingRows, setPricingRows] = useState<EventPricingRow[]>([]);
  const [pricingLoading, setPricingLoading] = useState(false);
  const [pricingSaving, setPricingSaving] = useState(false);

  useEffect(() => { loadEvents(); }, []);
  const loadEvents = async () => { setLoading(true); const { data } = await supabase.from('events').select('*').order('date_time', { ascending: false }); setEvents(data || []); setLoading(false); };

  const openCreate = () => { setEditingEvent(null); setFormData({ title: '', description: '', date_time: '', location: '', language: 'EN', access_level: 'public', speakers: '', replay_url: '', event_type: 'webinar' }); setIsDialogOpen(true); };
  const openEdit = (event: Event) => { setEditingEvent(event); setFormData({ title: event.title, description: event.description, date_time: event.date_time ? new Date(event.date_time).toISOString().slice(0, 16) : '', location: event.location || '', language: event.language, access_level: event.access_level, speakers: event.speakers ? JSON.stringify(event.speakers) : '', replay_url: event.replay_url || '', event_type: event.event_type || 'webinar' }); setIsDialogOpen(true); };

  const handleSave = async () => {
    let speakers: { name: string; title: string }[] = [];
    try { if (formData.speakers) speakers = JSON.parse(formData.speakers); } catch { toast({ title: 'Invalid speakers JSON', variant: 'destructive' }); return; }
    const payload = { title: formData.title, description: formData.description, date_time: formData.date_time, location: formData.location || null, language: formData.language, access_level: formData.access_level, speakers, replay_url: formData.replay_url || null, event_type: formData.event_type };
    if (editingEvent) { await supabase.from('events').update(payload).eq('id', editingEvent.id); toast({ title: 'Event updated!' }); }
    else { await supabase.from('events').insert(payload); toast({ title: 'Event created!' }); }
    setIsDialogOpen(false); loadEvents();
  };
  const handleDelete = async (id: string) => { if (!confirm('Delete this event?')) return; await supabase.from('events').delete().eq('id', id); toast({ title: 'Deleted' }); loadEvents(); };

  // Pricing management
  const openPricing = async (event: Event) => {
    setPricingEventId(event.id);
    setPricingEventTitle(event.title);
    setPricingLoading(true);
    const { data } = await supabase
      .from('event_pricing')
      .select('id, tier, price_cents, max_included_seats, additional_member_price_cents, discount_pct')
      .eq('event_id', event.id)
      .order('tier');
    if (data && data.length > 0) {
      setPricingRows(data as EventPricingRow[]);
    } else {
      // Pre-fill with defaults
      setPricingRows(DEFAULT_PRICING.map(d => ({ ...d })));
    }
    setPricingLoading(false);
  };

  const updatePricingRow = (index: number, field: keyof EventPricingRow, value: number | null) => {
    setPricingRows(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  const savePricing = async () => {
    if (!pricingEventId) return;
    setPricingSaving(true);
    // Delete existing pricing for this event
    await supabase.from('event_pricing').delete().eq('event_id', pricingEventId);
    // Insert all rows
    const rows = pricingRows.map(r => ({
      event_id: pricingEventId,
      tier: r.tier,
      price_cents: r.price_cents,
      max_included_seats: r.max_included_seats,
      additional_member_price_cents: r.additional_member_price_cents,
      discount_pct: r.discount_pct,
    }));
    const { error } = await supabase.from('event_pricing').insert(rows);
    if (error) {
      toast({ title: 'Failed to save pricing', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Pricing saved successfully' });
      setPricingEventId(null);
    }
    setPricingSaving(false);
  };

  if (loading) return <div className="flex items-center justify-center h-64"><RefreshCw className="h-8 w-8 animate-spin text-gray-400" /></div>;

  return (
    <div>
      <div className="flex justify-between items-center mb-6"><h1 className="text-2xl font-bold">{t('admin.events')} ({events.length})</h1><Button onClick={openCreate}><Plus className="h-4 w-4 mr-2" />Add Event</Button></div>
      <Card><CardContent className="p-0"><div className="overflow-x-auto"><table className="w-full"><thead className="bg-gray-50 border-b"><tr><th className="text-left p-4 font-medium">Title</th><th className="text-left p-4 font-medium">Type</th><th className="text-left p-4 font-medium">Date</th><th className="text-left p-4 font-medium">Location</th><th className="text-left p-4 font-medium">Access</th><th className="text-left p-4 font-medium">Actions</th></tr></thead><tbody>
        {events.map(e => { const evType = e.event_type || 'webinar'; return (<tr key={e.id} className="border-b hover:bg-gray-50"><td className="p-4 font-medium">{e.title}</td><td className="p-4"><Badge variant={evType === 'on_site' ? 'info' : 'secondary'}>{evType === 'on_site' ? 'On-Site' : 'Webinar'}</Badge></td><td className="p-4">{new Date(e.date_time).toLocaleDateString()}</td><td className="p-4">{e.location || 'Online'}</td><td className="p-4"><Badge variant={e.access_level === 'public' ? 'success' : 'info'}>{e.access_level}</Badge></td><td className="p-4"><div className="flex gap-2"><Button size="sm" variant="ghost" onClick={() => openEdit(e)}><Pencil className="h-4 w-4" /></Button><Button size="sm" variant="ghost" onClick={() => openPricing(e)} title="Manage pricing"><DollarSign className="h-4 w-4 text-green-600" /></Button><Button size="sm" variant="ghost" onClick={() => handleDelete(e.id)}><Trash2 className="h-4 w-4 text-red-500" /></Button></div></td></tr>); })}
      </tbody></table></div></CardContent></Card>

      {/* Event Edit Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}><DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>{editingEvent ? 'Edit Event' : 'Add Event'}</DialogTitle><DialogDescription>Manage event details.</DialogDescription></DialogHeader><div className="space-y-4 mt-4">
        <div className="space-y-2"><Label>Title *</Label><Input value={formData.title} onChange={e => setFormData({ ...formData, title: e.target.value })} /></div>
        <div className="space-y-2"><Label>Description *</Label><Textarea value={formData.description} onChange={e => setFormData({ ...formData, description: e.target.value })} rows={3} /></div>
        <div className="grid grid-cols-2 gap-4"><div className="space-y-2"><Label>Date & Time *</Label><Input type="datetime-local" value={formData.date_time} onChange={e => setFormData({ ...formData, date_time: e.target.value })} /></div><div className="space-y-2"><Label>Location</Label><Input value={formData.location} onChange={e => setFormData({ ...formData, location: e.target.value })} placeholder="Monaco Yacht Club" /></div></div>
        <div className="grid grid-cols-3 gap-4"><div className="space-y-2"><Label>Event Type *</Label><Select value={formData.event_type} onValueChange={v => setFormData({ ...formData, event_type: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="webinar">Webinar (Online)</SelectItem><SelectItem value="on_site">On-Site Event</SelectItem></SelectContent></Select></div><div className="space-y-2"><Label>Language</Label><Select value={formData.language} onValueChange={v => setFormData({ ...formData, language: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="EN">English</SelectItem><SelectItem value="FR">Français</SelectItem></SelectContent></Select></div><div className="space-y-2"><Label>Access Level</Label><Select value={formData.access_level} onValueChange={v => setFormData({ ...formData, access_level: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="public">Public</SelectItem><SelectItem value="members">Members</SelectItem><SelectItem value="marina">Marina Only</SelectItem></SelectContent></Select></div></div>
        <div className="space-y-2"><Label>Speakers (JSON)</Label><Textarea value={formData.speakers} onChange={e => setFormData({ ...formData, speakers: e.target.value })} placeholder='[{"name":"John","title":"CEO"}]' rows={2} /></div>
        <div className="space-y-2"><Label>Replay URL</Label><Input value={formData.replay_url} onChange={e => setFormData({ ...formData, replay_url: e.target.value })} /></div>
        <div className="flex justify-end gap-2 pt-4"><Button variant="outline" onClick={() => setIsDialogOpen(false)}>Cancel</Button><Button onClick={handleSave}>{editingEvent ? 'Update' : 'Create'}</Button></div>
      </div></DialogContent></Dialog>

      {/* Event Pricing Dialog */}
      <Dialog open={!!pricingEventId} onOpenChange={() => setPricingEventId(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Event Pricing</DialogTitle>
            <DialogDescription>Configure pricing per tier for: {pricingEventTitle}</DialogDescription>
          </DialogHeader>
          {pricingLoading ? (
            <div className="flex items-center justify-center h-32"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>
          ) : (
            <div className="space-y-4 mt-2">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      <th className="text-left p-3 font-medium">Tier</th>
                      <th className="text-left p-3 font-medium">Price (€)</th>
                      <th className="text-left p-3 font-medium">Included Seats</th>
                      <th className="text-left p-3 font-medium">Extra Seat (€)</th>
                      <th className="text-left p-3 font-medium">Discount %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pricingRows.map((row, i) => (
                      <tr key={row.tier} className="border-b">
                        <td className="p-3">
                          <Badge className={`${TIER_COLORS[row.tier as OrgTier]?.bg || 'bg-gray-100'} ${TIER_COLORS[row.tier as OrgTier]?.text || 'text-gray-800'} border ${TIER_COLORS[row.tier as OrgTier]?.border || 'border-gray-200'}`}>
                            {TIER_LABELS[row.tier as OrgTier] || row.tier}
                          </Badge>
                        </td>
                        <td className="p-3">
                          <Input
                            type="number"
                            min={0}
                            className="w-24 h-8"
                            value={row.price_cents / 100}
                            onChange={(e) => updatePricingRow(i, 'price_cents', Math.round(parseFloat(e.target.value || '0') * 100))}
                          />
                        </td>
                        <td className="p-3">
                          <Input
                            type="number"
                            min={0}
                            className="w-20 h-8"
                            value={row.max_included_seats ?? ''}
                            placeholder="∞"
                            onChange={(e) => updatePricingRow(i, 'max_included_seats', e.target.value ? parseInt(e.target.value) : null)}
                          />
                        </td>
                        <td className="p-3">
                          <Input
                            type="number"
                            min={0}
                            className="w-24 h-8"
                            value={row.additional_member_price_cents / 100}
                            onChange={(e) => updatePricingRow(i, 'additional_member_price_cents', Math.round(parseFloat(e.target.value || '0') * 100))}
                          />
                        </td>
                        <td className="p-3">
                          <Input
                            type="number"
                            min={0}
                            max={100}
                            className="w-20 h-8"
                            value={row.discount_pct}
                            onChange={(e) => updatePricingRow(i, 'discount_pct', parseFloat(e.target.value || '0'))}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-gray-500">
                Prices are in euros. "Included Seats" = how many free registrations a sponsor tier gets. Leave blank for unlimited. "Extra Seat" = price per additional member beyond included seats.
              </p>
              <div className="flex justify-end gap-3 pt-2">
                <Button variant="outline" onClick={() => setPricingEventId(null)}>Cancel</Button>
                <Button onClick={savePricing} disabled={pricingSaving}>
                  {pricingSaving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                  Save Pricing
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
