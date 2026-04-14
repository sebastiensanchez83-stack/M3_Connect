import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Save, Loader2, Building2, Globe, MapPin, Users,
  ExternalLink, RefreshCw, Anchor, Copy, CheckCircle, Shield,
  KeyRound, Send,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { TIER_LABELS, TIER_COLORS, OrgTier } from '@/types/database';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { sendNotification } from '@/lib/notifications';

/* ─── Types ─── */

interface OrgDetail {
  id: string;
  name: string;
  slug: string;
  primary_domain: string | null;
  organization_type: string | null;
  tier: string;
  max_seats: number;
  logo_url: string | null;
  website: string | null;
  description: string | null;
  country: string | null;
  city: string | null;
  headquarters_country: string | null;
  access_status: string;
  onboarding_status: string;
  rejection_reason: string | null;
  auto_approve_domain_joins: boolean;
  reference_bypass: boolean;
  claim_code: string | null;
  created_at: string;
  updated_at: string;
  owner_user_id: string | null;
}

interface MemberRow {
  id: string;
  user_id: string;
  role: string;
  joined_at: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  persona: string | null;
  access_status: string | null;
}

interface MarinaDetails {
  marina_type: string | null;
  berths_count: number | null;
  superyacht_berths: number | null;
  longest_berth_meters: number | null;
  marina_description: string | null;
  services_description: string | null;
  has_yacht_club: boolean;
  has_sailing_school: boolean;
  has_boat_yard: boolean;
  has_restaurants: boolean;
  restaurants_count: number | null;
  has_concierge: boolean;
  certifications: string[];
}

const STATUS_OPTIONS = ['verified', 'pending', 'rejected', 'suspended'];
const STATUS_COLORS: Record<string, string> = {
  verified: 'bg-green-50 text-green-700 border-green-200',
  pending: 'bg-amber-50 text-amber-700 border-amber-200',
  rejected: 'bg-red-50 text-red-700 border-red-200',
  suspended: 'bg-gray-100 text-gray-600 border-gray-300',
};

export function AdminOrganizationDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [org, setOrg] = useState<OrgDetail | null>(null);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [marina, setMarina] = useState<MarinaDetails | null>(null);
  const [codeCopied, setCodeCopied] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [sendingInvite, setSendingInvite] = useState(false);

  // Editable fields
  const [status, setStatus] = useState('');
  const [tier, setTier] = useState('');
  const [maxSeats, setMaxSeats] = useState(5);
  const [rejectionReason, setRejectionReason] = useState('');
  const [claimCode, setClaimCode] = useState('');

  useEffect(() => { if (id) loadOrg(); }, [id]);

  const loadOrg = async () => {
    setLoading(true);
    const [{ data: orgData }, { data: memberData }, { data: marinaData }] = await Promise.all([
      supabase.from('organizations').select('*').eq('id', id!).single(),
      supabase.from('organization_members').select('id, user_id, role, joined_at').eq('organization_id', id!),
      supabase.from('organization_marina_details').select('*').eq('organization_id', id!).maybeSingle(),
    ]);

    if (!orgData) { setLoading(false); return; }

    // Fetch member profiles
    const userIds = (memberData || []).map((m: { user_id: string }) => m.user_id);
    const { data: profiles } = userIds.length > 0
      ? await supabase.from('profiles').select('user_id, first_name, last_name, email, persona, access_status').in('user_id', userIds)
      : { data: [] };
    const profileMap = new Map((profiles || []).map((p: any) => [p.user_id, p]));

    const enrichedMembers: MemberRow[] = (memberData || []).map((m: any) => {
      const p = profileMap.get(m.user_id) as any;
      return {
        ...m,
        first_name: p?.first_name || null,
        last_name: p?.last_name || null,
        email: p?.email || null,
        persona: p?.persona || null,
        access_status: p?.access_status || null,
      };
    });

    setOrg(orgData as OrgDetail);
    setMembers(enrichedMembers);
    setMarina(marinaData as MarinaDetails | null);
    setStatus(orgData.access_status);
    setTier(orgData.tier);
    setMaxSeats(orgData.max_seats);
    setRejectionReason(orgData.rejection_reason || '');
    setClaimCode(orgData.claim_code || '');
    setLoading(false);
  };

  const handleSave = async () => {
    if (!org) return;
    setSaving(true);
    const updates: Record<string, unknown> = {
      access_status: status,
      tier,
      max_seats: maxSeats,
      rejection_reason: status === 'rejected' ? rejectionReason : null,
      claim_code: claimCode.trim() || null,
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase.from('organizations').update(updates).eq('id', org.id);
    if (error) {
      toast({ title: 'Error saving', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Organization updated' });
      await loadOrg();
    }
    setSaving(false);
  };

  const copyCode = () => {
    if (!claimCode) return;
    navigator.clipboard.writeText(claimCode);
    setCodeCopied(true);
    setTimeout(() => setCodeCopied(false), 2000);
  };

  const handleSendConnectLink = async () => {
    if (!inviteEmail.trim() || !claimCode.trim() || !org) return;
    setSendingInvite(true);
    try {
      await sendNotification({
        type: 'org_claim_code',
        email: inviteEmail.trim(),
        data: {
          org_name: org.name,
          claim_code: claimCode,
        },
      });
      toast({ title: 'Connect link sent', description: `Email sent to ${inviteEmail.trim()} with claim code ${claimCode}.` });
      setInviteEmail('');
    } catch {
      toast({ title: 'Failed to send', description: 'Please try again.', variant: 'destructive' });
    }
    setSendingInvite(false);
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <RefreshCw className="h-8 w-8 animate-spin text-gray-400" />
    </div>
  );

  if (!org) return (
    <div className="text-center py-12 text-gray-500">
      <p>Organization not found.</p>
      <Button variant="ghost" onClick={() => navigate('/admin/organizations')} className="mt-4">
        <ArrowLeft className="h-4 w-4 mr-2" /> Back to Organizations
      </Button>
    </div>
  );

  const tierColors = TIER_COLORS[org.tier as OrgTier];
  const statusColor = STATUS_COLORS[org.access_status] || STATUS_COLORS.pending;

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate('/admin/organizations')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex items-center gap-3 flex-1">
          <div className="h-12 w-12 rounded-xl shrink-0 overflow-hidden bg-gray-100 flex items-center justify-center">
            {org.logo_url ? (
              <img src={org.logo_url} alt={org.name} className="h-full w-full object-cover" />
            ) : (
              <Building2 className="h-6 w-6 text-gray-400" />
            )}
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">{org.name}</h1>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              <Badge className={`${statusColor} border text-[10px]`}>{org.access_status}</Badge>
              {org.organization_type && <Badge variant="outline" className="text-[10px]">{org.organization_type}</Badge>}
              <Badge className={`${tierColors?.bg || 'bg-gray-50'} ${tierColors?.text || 'text-gray-700'} border ${tierColors?.border || 'border-gray-200'} text-[10px]`}>
                {TIER_LABELS[org.tier as OrgTier] || org.tier}
              </Badge>
            </div>
          </div>
        </div>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
          Save Changes
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left column: Details */}
        <div className="space-y-6">
          {/* Basic Info */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Building2 className="h-4 w-4" /> Organization Info
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs text-gray-500">Slug</Label>
                  <p className="text-sm font-mono">{org.slug}</p>
                </div>
                <div>
                  <Label className="text-xs text-gray-500">Domain</Label>
                  <p className="text-sm">{org.primary_domain || '—'}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs text-gray-500">Country</Label>
                  <p className="text-sm flex items-center gap-1"><MapPin className="h-3 w-3" />{org.country || '—'}</p>
                </div>
                <div>
                  <Label className="text-xs text-gray-500">City</Label>
                  <p className="text-sm">{org.city || '—'}</p>
                </div>
              </div>
              {org.website && (
                <div>
                  <Label className="text-xs text-gray-500">Website</Label>
                  <a href={org.website} target="_blank" rel="noopener noreferrer" className="text-sm text-primary flex items-center gap-1 hover:underline">
                    <Globe className="h-3 w-3" /> {org.website}
                  </a>
                </div>
              )}
              {org.description && (
                <div>
                  <Label className="text-xs text-gray-500">Description</Label>
                  <p className="text-sm text-gray-600 whitespace-pre-wrap">{org.description}</p>
                </div>
              )}
              <div className="text-xs text-gray-400 pt-1">
                Created {new Date(org.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                {' • '}Updated {new Date(org.updated_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
              </div>
            </CardContent>
          </Card>

          {/* Claim Code & Send Connect Link */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <KeyRound className="h-4 w-4" /> Claim Code
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <div className="flex items-center gap-2">
                  <Input
                    value={claimCode}
                    onChange={(e) => setClaimCode(e.target.value.toUpperCase())}
                    placeholder="e.g. ACI-SPLIT"
                    className="max-w-[200px] uppercase tracking-wider font-mono text-sm"
                  />
                  {claimCode && (
                    <Button variant="ghost" size="sm" onClick={copyCode}>
                      {codeCopied ? <CheckCircle className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                    </Button>
                  )}
                </div>
                <p className="text-xs text-gray-400 mt-2">Users enter this code during onboarding to join this organization.</p>
              </div>

              {claimCode && (
                <>
                  <Separator />
                  <div>
                    <Label className="text-xs font-medium text-gray-600 mb-1.5 block">Send Connect Link</Label>
                    <div className="flex items-center gap-2">
                      <Input
                        type="email"
                        value={inviteEmail}
                        onChange={(e) => setInviteEmail(e.target.value)}
                        placeholder="manager@marina.com"
                        className="text-sm"
                      />
                      <Button
                        size="sm"
                        onClick={handleSendConnectLink}
                        disabled={sendingInvite || !inviteEmail.trim()}
                      >
                        {sendingInvite ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4 mr-1" />}
                        {sendingInvite ? '' : 'Send'}
                      </Button>
                    </div>
                    <p className="text-xs text-gray-400 mt-1.5">Sends an email with the claim code and signup instructions.</p>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Marina Details */}
          {marina && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Anchor className="h-4 w-4" /> Marina Details
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <Label className="text-xs text-gray-500">Type</Label>
                    <p className="text-sm">{marina.marina_type || '—'}</p>
                  </div>
                  <div>
                    <Label className="text-xs text-gray-500">Berths</Label>
                    <p className="text-sm font-semibold">{marina.berths_count ?? '—'}</p>
                  </div>
                  <div>
                    <Label className="text-xs text-gray-500">Superyacht Berths</Label>
                    <p className="text-sm">{marina.superyacht_berths ?? '—'}</p>
                  </div>
                </div>
                {marina.longest_berth_meters && (
                  <div>
                    <Label className="text-xs text-gray-500">Longest Berth</Label>
                    <p className="text-sm">{marina.longest_berth_meters}m</p>
                  </div>
                )}
                <div className="flex flex-wrap gap-2 pt-1">
                  {marina.has_yacht_club && <Badge variant="outline" className="text-[10px]">Yacht Club</Badge>}
                  {marina.has_sailing_school && <Badge variant="outline" className="text-[10px]">Sailing School</Badge>}
                  {marina.has_boat_yard && <Badge variant="outline" className="text-[10px]">Boat Yard</Badge>}
                  {marina.has_restaurants && <Badge variant="outline" className="text-[10px]">Restaurants ({marina.restaurants_count || '?'})</Badge>}
                  {marina.has_concierge && <Badge variant="outline" className="text-[10px]">Concierge</Badge>}
                </div>
                {marina.certifications && marina.certifications.length > 0 && (
                  <div>
                    <Label className="text-xs text-gray-500">Certifications</Label>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {marina.certifications.map(c => <Badge key={c} variant="secondary" className="text-[10px]">{c}</Badge>)}
                    </div>
                  </div>
                )}
                {marina.marina_description && (
                  <div>
                    <Label className="text-xs text-gray-500">Marina Description</Label>
                    <p className="text-sm text-gray-600 whitespace-pre-wrap">{marina.marina_description}</p>
                  </div>
                )}
                {marina.services_description && (
                  <div>
                    <Label className="text-xs text-gray-500">Services</Label>
                    <p className="text-sm text-gray-600 whitespace-pre-wrap">{marina.services_description}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right column: Admin controls + Members */}
        <div className="space-y-6">
          {/* Admin Controls */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Shield className="h-4 w-4" /> Admin Controls
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label className="text-xs">Access Status</Label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map(s => <SelectItem key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {status === 'rejected' && (
                <div>
                  <Label className="text-xs">Rejection Reason</Label>
                  <Textarea value={rejectionReason} onChange={e => setRejectionReason(e.target.value)} rows={2} />
                </div>
              )}
              <div>
                <Label className="text-xs">Tier</Label>
                <Select value={tier} onValueChange={setTier}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="member">Member</SelectItem>
                    <SelectItem value="innovation_partner">Innovation Partner</SelectItem>
                    <SelectItem value="associate_partner">Associate Partner</SelectItem>
                    <SelectItem value="premium_partner">Partner</SelectItem>
                    <SelectItem value="premium_sponsor">Premium Sponsor</SelectItem>
                    <SelectItem value="main_sponsor">Main Sponsor</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Max Seats</Label>
                <Input type="number" value={maxSeats} onChange={e => setMaxSeats(parseInt(e.target.value) || 1)} min={1} className="h-9 w-24" />
              </div>
              <Separator />
              <div className="text-xs text-gray-400 space-y-1">
                <p>Auto-approve domain joins: <span className="font-medium text-gray-600">{org.auto_approve_domain_joins ? 'Yes' : 'No'}</span></p>
                <p>Reference bypass: <span className="font-medium text-gray-600">{org.reference_bypass ? 'Yes' : 'No'}</span></p>
              </div>
            </CardContent>
          </Card>

          {/* Members */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Users className="h-4 w-4" /> Members ({members.length}/{maxSeats})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {members.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-4">No members yet</p>
              ) : (
                <div className="space-y-2">
                  {members.map(m => (
                    <div key={m.id}
                      className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 cursor-pointer transition-colors"
                      onClick={() => navigate(`/admin/users/${m.user_id}`)}
                    >
                      <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary">
                        {(m.first_name?.[0] || '?').toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">
                          {[m.first_name, m.last_name].filter(Boolean).join(' ') || 'Unknown'}
                        </p>
                        <p className="text-xs text-gray-400 truncate">{m.email}</p>
                      </div>
                      <Badge variant="outline" className="text-[10px] shrink-0">{m.role}</Badge>
                      {m.access_status && (
                        <span className={`inline-block h-2 w-2 rounded-full shrink-0 ${
                          m.access_status === 'verified' ? 'bg-green-500' :
                          m.access_status === 'pending' ? 'bg-yellow-500' :
                          m.access_status === 'rejected' ? 'bg-red-500' : 'bg-gray-400'
                        }`} title={m.access_status} />
                      )}
                    </div>
                  ))}
                </div>
              )}
              <Separator className="my-3" />
              <Button variant="outline" size="sm" className="w-full text-xs"
                onClick={() => navigate(`/admin/users?org=${org.id}`)}>
                <ExternalLink className="h-3 w-3 mr-1" /> View all users from this org
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
