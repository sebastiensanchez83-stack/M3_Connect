import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import {
  Organization, OrganizationMember, OrganizationInvitation,
} from '@/types/database';
import {
  Building2, Users, Mail, Crown, UserPlus, Loader2, ExternalLink,
  Trash2, LogOut, ArrowRightLeft, Globe, MapPin, Shield,
} from 'lucide-react';

export function OrganizationTab() {
  const { t } = useTranslation();
  const { user, profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [org, setOrg] = useState<Organization | null>(null);
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [invitations, setInvitations] = useState<OrganizationInvitation[]>([]);
  const [isOwner, setIsOwner] = useState(false);

  // Create org form
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState({
    name: '', domain: '', website: '', description: '', country: '', city: '',
  });

  // Edit org
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editForm, setEditForm] = useState({
    name: '', website: '', description: '', country: '', city: '',
  });

  // Invite dialog
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [inviteForm, setInviteForm] = useState({ email: '', firstName: '', lastName: '' });

  // Transfer dialog
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferTarget, setTransferTarget] = useState<OrganizationMember | null>(null);
  const [transferring, setTransferring] = useState(false);

  const fetchOrg = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      // Get user's org membership
      const { data: membership } = await supabase
        .from('organization_members')
        .select('organization_id, role')
        .eq('user_id', user.id)
        .maybeSingle();

      if (!membership) {
        setOrg(null);
        setLoading(false);
        return;
      }

      // Fetch org
      const { data: orgData } = await supabase
        .from('organizations')
        .select('*')
        .eq('id', membership.organization_id)
        .single();

      if (orgData) {
        setOrg(orgData as Organization);
        setIsOwner(membership.role === 'owner');
        setEditForm({
          name: orgData.name || '',
          website: orgData.website || '',
          description: orgData.description || '',
          country: orgData.country || '',
          city: orgData.city || '',
        });
      }

      // Fetch members with profile info
      const { data: membersData } = await supabase
        .from('organization_members')
        .select('id, organization_id, user_id, role, joined_at, profiles(first_name, last_name, email, persona)')
        .eq('organization_id', membership.organization_id)
        .order('joined_at', { ascending: true });

      if (membersData) setMembers(membersData as unknown as OrganizationMember[]);

      // Fetch pending invitations (owner only)
      if (membership.role === 'owner') {
        const { data: invData } = await supabase
          .from('organization_invitations')
          .select('*')
          .eq('organization_id', membership.organization_id)
          .eq('status', 'pending')
          .order('created_at', { ascending: false });

        if (invData) setInvitations(invData as OrganizationInvitation[]);
      }
    } catch (err) {
      console.error('Error fetching org:', err);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => { fetchOrg(); }, [fetchOrg]);

  // Pre-fill create form from profile/metadata
  useEffect(() => {
    if (!user || !profile) return;
    const email = user.email || '';
    const domain = email.includes('@') ? email.split('@')[1]?.toLowerCase() : '';
    const companyName = user.user_metadata?.company_name || '';
    const companyWebsite = user.user_metadata?.company_website || '';

    const PUBLIC_DOMAINS = [
      'gmail.com','yahoo.com','yahoo.fr','hotmail.com','hotmail.fr',
      'outlook.com','outlook.fr','live.com','live.fr',
      'aol.com','icloud.com','me.com','mac.com',
      'mail.com','protonmail.com','proton.me','gmx.com','gmx.fr',
      'wanadoo.fr','orange.fr','free.fr','sfr.fr','laposte.net',
      'msn.com','ymail.com','fastmail.com','zoho.com',
    ];

    setCreateForm((prev) => ({
      ...prev,
      name: companyName || prev.name,
      domain: (!PUBLIC_DOMAINS.includes(domain) ? domain : '') || prev.domain,
      website: companyWebsite || prev.website,
    }));
  }, [user, profile]);

  const handleCreate = async () => {
    if (!createForm.name.trim()) return;
    setCreating(true);
    try {
      const { data, error } = await supabase.rpc('create_organization', {
        p_name: createForm.name.trim(),
        p_organization_type: profile?.persona || null,
        p_primary_domain: createForm.domain.trim() || null,
        p_website: createForm.website.trim() || null,
        p_description: createForm.description.trim() || null,
        p_country: createForm.country.trim() || null,
        p_city: createForm.city.trim() || null,
      });

      if (error) throw error;
      toast({ title: t('org.created'), description: t('org.createdDesc') });
      setShowCreateForm(false);
      fetchOrg();
    } catch (err: any) {
      toast({ title: t('common.error'), description: err.message, variant: 'destructive' });
    }
    setCreating(false);
  };

  const handleSaveEdit = async () => {
    if (!org) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from('organizations')
        .update({
          name: editForm.name.trim(),
          website: editForm.website.trim() || null,
          description: editForm.description.trim() || null,
          country: editForm.country.trim() || null,
          city: editForm.city.trim() || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', org.id);

      if (error) throw error;
      toast({ title: t('org.saved') });
      setEditing(false);
      fetchOrg();
    } catch (err: any) {
      toast({ title: t('common.error'), description: err.message, variant: 'destructive' });
    }
    setSaving(false);
  };

  const handleInvite = async () => {
    if (!org || !inviteForm.email.trim()) return;
    // Domain check
    const inviteDomain = inviteForm.email.split('@')[1]?.toLowerCase();
    if (org.primary_domain && inviteDomain !== org.primary_domain) {
      toast({ title: t('common.error'), description: t('org.inviteDomainMismatch'), variant: 'destructive' });
      return;
    }
    setInviting(true);
    try {
      const { error } = await supabase
        .from('organization_invitations')
        .insert({
          organization_id: org.id,
          email: inviteForm.email.trim().toLowerCase(),
          normalized_domain: inviteDomain || null,
          invited_by_user_id: user!.id,
          first_name: inviteForm.firstName.trim() || null,
          last_name: inviteForm.lastName.trim() || null,
        });

      if (error) throw error;
      toast({ title: t('org.inviteSent'), description: t('org.inviteSentDesc', { email: inviteForm.email }) });
      setInviteOpen(false);
      setInviteForm({ email: '', firstName: '', lastName: '' });
      fetchOrg();
    } catch (err: any) {
      toast({ title: t('common.error'), description: err.message, variant: 'destructive' });
    }
    setInviting(false);
  };

  const handleCancelInvitation = async (invId: string) => {
    try {
      const { error } = await supabase
        .from('organization_invitations')
        .update({ status: 'cancelled' })
        .eq('id', invId);
      if (error) throw error;
      toast({ title: t('org.invitationCancelled') });
      fetchOrg();
    } catch (err: any) {
      toast({ title: t('common.error'), description: err.message, variant: 'destructive' });
    }
  };

  const handleRemoveMember = async (member: OrganizationMember) => {
    if (!org) return;
    const name = member.profiles ? `${member.profiles.first_name || ''} ${member.profiles.last_name || ''}`.trim() : 'this member';
    if (!window.confirm(t('org.removeMemberConfirm', { name }))) return;
    try {
      const { error } = await supabase
        .from('organization_members')
        .delete()
        .eq('id', member.id);
      if (error) throw error;
      toast({ title: t('org.memberRemoved') });
      fetchOrg();
    } catch (err: any) {
      toast({ title: t('common.error'), description: err.message, variant: 'destructive' });
    }
  };

  const handleLeaveOrg = async () => {
    if (!org || !user) return;
    if (!window.confirm(t('org.leaveConfirm'))) return;
    try {
      const { error } = await supabase
        .from('organization_members')
        .delete()
        .eq('organization_id', org.id)
        .eq('user_id', user.id);
      if (error) throw error;
      toast({ title: t('org.leftOrg') });
      setOrg(null);
      setMembers([]);
      setInvitations([]);
    } catch (err: any) {
      toast({ title: t('common.error'), description: err.message, variant: 'destructive' });
    }
  };

  const handleTransfer = async () => {
    if (!org || !transferTarget) return;
    setTransferring(true);
    try {
      const { error } = await supabase.rpc('transfer_org_ownership', {
        p_org_id: org.id,
        p_new_owner_user_id: transferTarget.user_id,
      });
      if (error) throw error;
      toast({ title: t('org.transferSuccess') });
      setTransferOpen(false);
      setTransferTarget(null);
      fetchOrg();
    } catch (err: any) {
      toast({ title: t('common.error'), description: err.message, variant: 'destructive' });
    }
    setTransferring(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary/40" />
      </div>
    );
  }

  // ── NO ORG: Show create form ──
  if (!org) {
    return (
      <div className="space-y-6">
        <Card>
          <CardContent className="pt-6 text-center">
            <Building2 className="h-12 w-12 mx-auto text-gray-300 mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">{t('org.noOrg')}</h3>
            <p className="text-gray-500 text-sm mb-6">{t('org.createOrgDesc')}</p>
            <Button onClick={() => setShowCreateForm(true)}>
              <Building2 className="h-4 w-4 mr-2" />
              {t('org.createOrg')}
            </Button>
          </CardContent>
        </Card>

        {showCreateForm && (
          <Card>
            <CardHeader>
              <CardTitle>{t('org.createOrg')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>{t('org.orgName')} *</Label>
                <Input
                  value={createForm.name}
                  onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                  placeholder={t('org.orgNamePlaceholder')}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>{t('org.domain')}</Label>
                <Input
                  value={createForm.domain}
                  onChange={(e) => setCreateForm({ ...createForm, domain: e.target.value })}
                  placeholder={t('org.domainPlaceholder')}
                />
                <p className="text-xs text-gray-500">{t('org.domainHelp')}</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>{t('org.website')}</Label>
                  <Input
                    value={createForm.website}
                    onChange={(e) => setCreateForm({ ...createForm, website: e.target.value })}
                    placeholder={t('org.websitePlaceholder')}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t('org.country')}</Label>
                  <Input
                    value={createForm.country}
                    onChange={(e) => setCreateForm({ ...createForm, country: e.target.value })}
                    placeholder={t('org.countryPlaceholder')}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>{t('org.city')}</Label>
                <Input
                  value={createForm.city}
                  onChange={(e) => setCreateForm({ ...createForm, city: e.target.value })}
                  placeholder={t('org.cityPlaceholder')}
                />
              </div>
              <div className="space-y-2">
                <Label>{t('org.description')}</Label>
                <textarea
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[80px]"
                  value={createForm.description}
                  onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
                  placeholder={t('org.descriptionPlaceholder')}
                />
              </div>
              <div className="flex gap-3 justify-end">
                <Button variant="outline" onClick={() => setShowCreateForm(false)}>{t('common.cancel')}</Button>
                <Button onClick={handleCreate} disabled={creating || !createForm.name.trim()}>
                  {creating && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                  {creating ? t('org.creating') : t('org.createOrg')}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  // ── HAS ORG: Show org details ──
  const canInvite = isOwner && org.tier !== 'member' && members.length < org.max_seats;

  return (
    <div className="space-y-6">
      {/* Organization Info Card */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between">
          <div className="flex items-center gap-3">
            {org.logo_url ? (
              <img src={org.logo_url} alt={org.name} className="w-12 h-12 rounded-lg object-cover" />
            ) : (
              <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center">
                <Building2 className="h-6 w-6 text-primary" />
              </div>
            )}
            <div>
              <CardTitle className="text-xl">{org.name}</CardTitle>
              <div className="flex items-center gap-2 mt-1">
                <Badge variant="outline">{t(`org.${isOwner ? 'owner' : 'collaborator'}`)}</Badge>
                <Badge variant="secondary">{org.tier.charAt(0).toUpperCase() + org.tier.slice(1)}</Badge>
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link to={`/organizations/${org.slug}`}>
                <ExternalLink className="h-4 w-4 mr-1" />
                {t('org.viewPublicPage')}
              </Link>
            </Button>
            {isOwner && (
              <Button variant="outline" size="sm" onClick={() => setEditing(!editing)}>
                {t('org.editOrg')}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Org details */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            {org.primary_domain && (
              <div className="flex items-center gap-2 text-gray-600">
                <Mail className="h-4 w-4 text-primary" />
                <span>{org.primary_domain}</span>
              </div>
            )}
            {org.website && (
              <div className="flex items-center gap-2 text-gray-600">
                <Globe className="h-4 w-4 text-primary" />
                <a href={org.website} target="_blank" rel="noopener noreferrer" className="hover:underline truncate">
                  {org.website.replace(/^https?:\/\//, '')}
                </a>
              </div>
            )}
            {(org.city || org.country) && (
              <div className="flex items-center gap-2 text-gray-600">
                <MapPin className="h-4 w-4 text-primary" />
                <span>{[org.city, org.country].filter(Boolean).join(', ')}</span>
              </div>
            )}
            <div className="flex items-center gap-2 text-gray-600">
              <Users className="h-4 w-4 text-primary" />
              <span>{t('org.seatUsage', { used: members.length, max: org.max_seats })}</span>
            </div>
          </div>

          {org.description && (
            <p className="text-gray-600 text-sm">{org.description}</p>
          )}

          {/* Seat usage bar */}
          <div className="w-full bg-gray-100 rounded-full h-2">
            <div
              className="bg-primary rounded-full h-2 transition-all"
              style={{ width: `${Math.min(100, (members.length / org.max_seats) * 100)}%` }}
            />
          </div>

          {/* Edit form */}
          {editing && isOwner && (
            <div className="border-t pt-4 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>{t('org.orgName')}</Label>
                  <Input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>{t('org.website')}</Label>
                  <Input value={editForm.website} onChange={(e) => setEditForm({ ...editForm, website: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>{t('org.country')}</Label>
                  <Input value={editForm.country} onChange={(e) => setEditForm({ ...editForm, country: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>{t('org.city')}</Label>
                  <Input value={editForm.city} onChange={(e) => setEditForm({ ...editForm, city: e.target.value })} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>{t('org.description')}</Label>
                <textarea
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[80px]"
                  value={editForm.description}
                  onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                />
              </div>
              <div className="flex gap-3 justify-end">
                <Button variant="outline" onClick={() => setEditing(false)}>{t('common.cancel')}</Button>
                <Button onClick={handleSaveEdit} disabled={saving}>
                  {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                  {t('org.saveChanges')}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Members */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            {t('org.members')} ({members.length})
          </CardTitle>
          {canInvite && (
            <Button size="sm" onClick={() => setInviteOpen(true)}>
              <UserPlus className="h-4 w-4 mr-1" />
              {t('org.inviteMember')}
            </Button>
          )}
        </CardHeader>
        <CardContent>
          <div className="divide-y">
            {members.map((member) => {
              const p = member.profiles;
              const name = p ? `${p.first_name || ''} ${p.last_name || ''}`.trim() : 'Unknown';
              return (
                <div key={member.id} className="flex items-center justify-between py-3">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm">
                      {name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <div className="font-medium text-gray-900 flex items-center gap-2">
                        {name}
                        {member.role === 'owner' && (
                          <Crown className="h-4 w-4 text-amber-500" />
                        )}
                      </div>
                      <div className="text-xs text-gray-500">{p?.email}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">
                      {t(`org.${member.role}`)}
                    </Badge>
                    {isOwner && member.user_id !== user!.id && (
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => { setTransferTarget(member); setTransferOpen(true); }}
                          title={t('org.transferOwnership')}
                        >
                          <ArrowRightLeft className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs text-red-600 hover:text-red-700"
                          onClick={() => handleRemoveMember(member)}
                          title={t('org.removeMember')}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    )}
                    {!isOwner && member.user_id === user!.id && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs text-red-600 hover:text-red-700"
                        onClick={handleLeaveOrg}
                      >
                        <LogOut className="h-3 w-3 mr-1" />
                        {t('org.leaveOrg')}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Pending Invitations (owner only) */}
      {isOwner && invitations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5 text-primary" />
              {t('org.pendingInvitations')} ({invitations.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="divide-y">
              {invitations.map((inv) => (
                <div key={inv.id} className="flex items-center justify-between py-3">
                  <div>
                    <div className="font-medium text-gray-900">
                      {[inv.first_name, inv.last_name].filter(Boolean).join(' ') || inv.email}
                    </div>
                    <div className="text-xs text-gray-500">{inv.email}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-400">
                      {new Date(inv.expires_at).toLocaleDateString()}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs text-red-600"
                      onClick={() => handleCancelInvitation(inv.id)}
                    >
                      {t('org.cancelInvitation')}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Invite Dialog */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('org.inviteMember')}</DialogTitle>
            <DialogDescription>
              {org.primary_domain
                ? t('org.domainHelp')
                : t('org.inviteMember')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t('org.inviteEmail')} *</Label>
              <Input
                type="email"
                value={inviteForm.email}
                onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })}
                placeholder={t('org.inviteEmailPlaceholder')}
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>{t('org.inviteFirstName')}</Label>
                <Input
                  value={inviteForm.firstName}
                  onChange={(e) => setInviteForm({ ...inviteForm, firstName: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>{t('org.inviteLastName')}</Label>
                <Input
                  value={inviteForm.lastName}
                  onChange={(e) => setInviteForm({ ...inviteForm, lastName: e.target.value })}
                />
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setInviteOpen(false)}>{t('common.cancel')}</Button>
              <Button onClick={handleInvite} disabled={inviting || !inviteForm.email.trim()}>
                {inviting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                {inviting ? t('org.inviteSending') : t('org.inviteSend')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Transfer Ownership Dialog */}
      <Dialog open={transferOpen} onOpenChange={setTransferOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('org.transferOwnership')}</DialogTitle>
            <DialogDescription>
              {transferTarget && t('org.transferConfirm', {
                name: transferTarget.profiles
                  ? `${transferTarget.profiles.first_name || ''} ${transferTarget.profiles.last_name || ''}`.trim()
                  : 'this member',
              })}
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => setTransferOpen(false)}>{t('common.cancel')}</Button>
            <Button variant="destructive" onClick={handleTransfer} disabled={transferring}>
              {transferring && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {t('org.transferOwnership')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
