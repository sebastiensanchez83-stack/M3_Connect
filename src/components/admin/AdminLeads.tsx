import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { RefreshCw, Flame, Thermometer, Snowflake } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/lib/supabase';
import { AdminContextBanner } from './AdminContextBanner';
import type { PartnerLead } from './types';

export function AdminLeads() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const urlStatus = searchParams.get('status') || '';
  const hasUrlFilters = !!urlStatus;
  const [leads, setLeads] = useState<PartnerLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState(urlStatus || 'all');

  useEffect(() => { loadLeads(); }, []);
  const loadLeads = async () => {
    setLoading(true);
    const { data } = await supabase.from('partner_leads').select('*').order('created_at', { ascending: false });
    setLeads(data || []);
    setLoading(false);
  };

  if (loading) return <div className="flex items-center justify-center h-64"><RefreshCw className="h-8 w-8 animate-spin text-gray-400" /></div>;

  const filteredLeads = statusFilter === 'all' ? leads : leads.filter(l => l.status === statusFilter);

  const getIntensity = (l: PartnerLead) => {
    const daysSince = Math.floor((Date.now() - new Date(l.created_at).getTime()) / 86400000);
    if (l.status === 'in_discussion') return { label: 'Hot', icon: Flame, color: 'text-red-600 bg-red-50' };
    if (l.status === 'qualified') return { label: 'Warm', icon: Thermometer, color: 'text-amber-600 bg-amber-50' };
    if (daysSince < 7 && l.status === 'new') return { label: 'Warm', icon: Thermometer, color: 'text-amber-600 bg-amber-50' };
    return { label: 'Cold', icon: Snowflake, color: 'text-blue-400 bg-blue-50' };
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold">{t('admin.partnerLeads')} ({filteredLeads.length})</h1>
      </div>

      {hasUrlFilters && (
        <AdminContextBanner
          label={`Showing ${urlStatus.replace('_', ' ')} leads`}
          count={filteredLeads.length}
          onClear={() => { setSearchParams({}, { replace: true }); setStatusFilter('all'); }}
          color="amber"
        />
      )}

      {/* Pipeline summary strip */}
      <div className="flex items-center gap-2 mb-4">
        {[
          { key: 'all', label: 'All', count: leads.length },
          { key: 'new', label: 'New', count: leads.filter(l => l.status === 'new').length },
          { key: 'qualified', label: 'Qualified', count: leads.filter(l => l.status === 'qualified').length },
          { key: 'in_discussion', label: 'In Discussion', count: leads.filter(l => l.status === 'in_discussion').length },
          { key: 'signed', label: 'Signed', count: leads.filter(l => l.status === 'signed').length },
          { key: 'rejected', label: 'Rejected', count: leads.filter(l => l.status === 'rejected').length },
        ].map(s => (
          <Button key={s.key} variant={statusFilter === s.key ? 'default' : 'outline'} size="sm"
            className="text-xs gap-1.5" onClick={() => setStatusFilter(s.key)}>
            {s.label}
            {s.count > 0 && <span className="bg-white/20 rounded-full px-1.5 text-[10px] font-bold">{s.count}</span>}
          </Button>
        ))}
      </div>

      {/* Lead cards */}
      <div className="space-y-2">
        {filteredLeads.length === 0 ? (
          <Card><CardContent className="py-12 text-center text-gray-400">No leads match this filter</CardContent></Card>
        ) : filteredLeads.map(l => {
          const intensity = getIntensity(l);
          const daysSince = Math.floor((Date.now() - new Date(l.created_at).getTime()) / 86400000);
          return (
            <Card
              key={l.id}
              className="border-0 shadow-sm hover:shadow-md transition-all cursor-pointer group"
              onClick={() => navigate(`/admin/leads/${l.id}`)}
            >
              <CardContent className="p-4">
                <div className="flex items-center gap-4">
                  <div className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 ${intensity.color}`}>
                    <intensity.icon className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-sm font-semibold text-gray-900">{l.company}</span>
                      <Badge variant="outline" className="text-[10px]">{l.actor_type}</Badge>
                      <span className="text-[10px] text-gray-400">{l.country}</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-gray-500">
                      <span>{l.first_name} {l.last_name}</span>
                      <span>{l.email}</span>
                      <span className="text-gray-300">{daysSince}d ago</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <div className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${intensity.color}`}>{intensity.label}</div>
                    <Badge variant={
                      l.status === 'new' ? 'info' :
                      l.status === 'qualified' ? 'warning' :
                      l.status === 'in_discussion' ? 'default' :
                      l.status === 'signed' ? 'success' :
                      'destructive'
                    }>
                      {l.status.replace('_', ' ')}
                    </Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
