import { useState, useEffect } from 'react';
import { Loader2, UserPlus, Building2, Link2, Ban, Search, Mail, ShieldCheck } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';

// Platform-identity provisioning for an SM26 registration: persona + company
// org + verified account + welcome email, applied by sm26-provision. Suggested
// values are derived from the event roles; the admin adjusts before sending
// (juries and multi-role people are exactly why this is a human decision).

export interface ProvisionRoleRow { role: string; module_data?: Record<string, unknown> | null }
export interface ProvisionReg {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  company_name: string | null;
  user_id: string | null;
  organization_id: string | null;
  roles: ProvisionRoleRow[];
}

export const PROVISION_PERSONAS: { value: string; label: string }[] = [
  { value: 'partner', label: 'Partner (solution provider / architect / startup)' },
  { value: 'marina', label: 'Marina' },
  { value: 'media_partner', label: 'Media' },
  { value: 'investor', label: 'Investor' },
  { value: 'individual', label: 'Individual (no company)' },
];

// Suggested platform identity from the event roles. Priority: the org-bearing
// business roles win; jury alone falls back to their declared domain.
export function suggestProvision(reg: ProvisionReg): { persona: string; orgMode: 'create' | 'link' | 'none'; orgName: string } {
  const roles = new Set(reg.roles.map(r => r.role));
  let persona = 'individual';
  if (roles.has('startup') || roles.has('sponsor') || roles.has('architect_pro') || roles.has('architect_student')) persona = 'partner';
  else if (roles.has('marina')) persona = 'marina';
  else if (roles.has('media')) persona = 'media_partner';
  else if (roles.has('investor')) persona = 'investor';
  else if (roles.has('jury')) {
    const jury = reg.roles.find(r => r.role === 'jury');
    const domain = String((jury?.module_data as Record<string, unknown> | null)?.domain || '');
    if (/invest/i.test(domain)) persona = 'investor';
    else if (/marina|port/i.test(domain)) persona = 'marina';
    else if (/architect|solution|provider|partner|consult/i.test(domain)) persona = 'partner';
  }
  const orgable = persona !== 'individual';
  const orgMode: 'create' | 'link' | 'none' =
    reg.organization_id ? 'none' : (orgable && (reg.company_name || '').trim() ? 'create' : 'none');
  return { persona, orgMode, orgName: (reg.company_name || '').trim() };
}

// Run the provisioning call (shared by the dialog and the backfill panel).
export async function runProvision(body: {
  registration_id: string; persona: string;
  org: 'create' | 'link' | 'none'; org_name?: string; org_id?: string; send_email: boolean;
}): Promise<{ ok: boolean; error?: string; emailed?: boolean }> {
  let res = await supabase.functions.invoke('sm26-provision', { body });
  if (res.error && (res.error as { name?: string }).name === 'FunctionsFetchError') {
    await new Promise(r => setTimeout(r, 900));
    res = await supabase.functions.invoke('sm26-provision', { body });
  }
  if (res.error) {
    let msg = res.error.message || 'Please try again.';
    try { const b = await (res.error as { context?: Response }).context?.json(); if (b?.error) msg = b.error; } catch { /* keep */ }
    return { ok: false, error: msg };
  }
  const d = res.data as { ok?: boolean; error?: string; emailed?: boolean } | null;
  return d?.ok ? { ok: true, emailed: d.emailed } : { ok: false, error: d?.error || 'Unexpected response' };
}

interface OrgHit { id: string; name: string; organization_type: string | null; tier: string }
export interface OrgNameMatch { exact: OrgHit | null; similar: OrgHit[] }

const normaliseOrgName = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

// Single primitive for "does an organization with this name already exist?".
// Several admin screens hand-rolled this with divergent ilike patterns, none of
// which escaped the LIKE wildcards — a company called "100% Marine" or "A_B"
// silently matched the wrong rows. It also separates an exact (normalised) name
// match from mere look-alikes, which is what provisioning needs in order to stop
// creating a second organization beside one that already exists (typically a
// pre-created marina still waiting for its claim code).
export async function findOrgByName(name: string): Promise<OrgNameMatch> {
  const wanted = normaliseOrgName(name);
  if (wanted.length < 2) return { exact: null, similar: [] };
  const escaped = wanted.replace(/[\\%_]/g, c => `\\${c}`);
  const { data } = await supabase.from('organizations')
    .select('id, name, organization_type, tier')
    .ilike('name', `%${escaped}%`)
    .order('name').limit(8);
  const hits = (data || []) as OrgHit[];
  const exact = hits.find(h => normaliseOrgName(h.name) === wanted) || null;
  return { exact, similar: hits.filter(h => h.id !== exact?.id) };
}

export function SM26ProvisionDialog({ reg, open, onOpenChange, onDone }: {
  reg: ProvisionReg;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDone: () => void;
}) {
  const [persona, setPersona] = useState('individual');
  const [orgMode, setOrgMode] = useState<'create' | 'link' | 'none'>('none');
  const [orgName, setOrgName] = useState('');
  const [orgQuery, setOrgQuery] = useState('');
  const [orgHits, setOrgHits] = useState<OrgHit[]>([]);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [sendEmail, setSendEmail] = useState(true);
  const [busy, setBusy] = useState(false);
  // Whether this email already has a platform account (and if it's active).
  const [acctStatus, setAcctStatus] = useState<'none' | 'pending' | 'active' | null>(null);

  // Re-derive suggestions each time the dialog opens for a registration.
  useEffect(() => {
    if (!open) return;
    const s = suggestProvision(reg);
    setPersona(s.persona);
    setOrgMode(s.orgMode);
    setOrgName(s.orgName);
    setOrgQuery(s.orgName);
    setOrgId(null);
    setSendEmail(!reg.user_id); // already-claimed accounts usually don't need the invite email
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, reg.id]);

  // Look up whether this email already has an account. A person can't get a
  // duplicate account (Supabase enforces unique emails — provisioning links the
  // existing one), and we must never send a "set your password" email to someone
  // who already has an active account. So detect it up front and, when active,
  // force the email off.
  useEffect(() => {
    if (!open) { setAcctStatus(null); return; }
    const email = (reg.email || '').trim();
    if (!email) { setAcctStatus('none'); return; }
    let active = true;
    setAcctStatus(null);
    supabase.rpc('sm_account_status_for_email', { p_email: email }).then(({ data }) => {
      if (!active) return;
      const s = ((data as string) || 'none') as 'none' | 'pending' | 'active';
      setAcctStatus(s);
      if (s === 'active') setSendEmail(false);
    });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, reg.id]);

  // Live org search for the link mode.
  useEffect(() => {
    if (!open || orgMode !== 'link' || orgQuery.trim().length < 2) { setOrgHits([]); return; }
    let active = true;
    const t = setTimeout(async () => {
      const { exact, similar } = await findOrgByName(orgQuery);
      // Exact name match first — it is almost always the one to link.
      if (active) setOrgHits(exact ? [exact, ...similar] : similar);
    }, 250);
    return () => { active = false; clearTimeout(t); };
  }, [open, orgMode, orgQuery]);

  const name = `${reg.first_name || ''} ${reg.last_name || ''}`.trim() || reg.email || 'this registrant';

  const submit = async () => {
    if (orgMode === 'create' && !orgName.trim()) { toast({ title: 'Enter the organization name', variant: 'destructive' }); return; }
    if (orgMode === 'link' && !orgId) { toast({ title: 'Pick the organization to link', variant: 'destructive' }); return; }
    setBusy(true);
    const r = await runProvision({
      registration_id: reg.id, persona, org: orgMode,
      org_name: orgMode === 'create' ? orgName.trim() : undefined,
      org_id: orgMode === 'link' ? orgId! : undefined,
      send_email: sendEmail,
    });
    setBusy(false);
    if (!r.ok) { toast({ title: 'Provisioning failed', description: r.error, variant: 'destructive' }); return; }
    toast({ title: 'Platform account ready', description: sendEmail ? (r.emailed ? `Welcome email sent to ${reg.email}` : 'Account set up — the email could not be sent, retry from the sheet') : 'Account set up (no email sent)' });
    onOpenChange(false);
    onDone();
  };

  const ModeBtn = ({ mode, icon, label }: { mode: 'create' | 'link' | 'none'; icon: React.ReactNode; label: string }) => (
    <button type="button" onClick={() => setOrgMode(mode)}
      className={`flex-1 min-w-[110px] rounded-lg border px-3 py-2 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors ${orgMode === mode ? 'border-primary bg-primary/5 text-primary' : 'border-gray-200 text-gray-600 hover:border-primary/40'}`}>
      {icon}{label}
    </button>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><UserPlus className="h-5 w-5 text-primary" /> Platform account</DialogTitle>
          <DialogDescription>
            Set up {name}'s Smart Marina Connect identity — persona, company and verified access. Suggested from their event roles; adjust before applying.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label>Persona</Label>
            <Select value={persona} onValueChange={v => { setPersona(v); if (v === 'individual') setOrgMode('none'); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{PROVISION_PERSONAS.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Company on the platform</Label>
            {reg.organization_id && <p className="text-[11px] text-gray-500">Already linked to an organization — “No change” keeps it.</p>}
            <div className="flex gap-1.5 flex-wrap">
              <ModeBtn mode="create" icon={<Building2 className="h-3.5 w-3.5" />} label="Create org" />
              <ModeBtn mode="link" icon={<Link2 className="h-3.5 w-3.5" />} label="Link existing" />
              <ModeBtn mode="none" icon={<Ban className="h-3.5 w-3.5" />} label={reg.organization_id ? 'No change' : 'No company'} />
            </div>
            {orgMode === 'create' && (
              <div className="space-y-1 pt-1">
                <Input value={orgName} onChange={e => setOrgName(e.target.value)} placeholder="Organization name" />
                <p className="text-[11px] text-gray-500">Created as a verified <strong>{persona === 'individual' ? 'partner' : persona.replace('_', ' ')}</strong> organization · member tier · {name} becomes owner.</p>
              </div>
            )}
            {orgMode === 'link' && (
              <div className="space-y-1.5 pt-1">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                  <Input className="pl-8" value={orgQuery} onChange={e => { setOrgQuery(e.target.value); setOrgId(null); }} placeholder="Search organizations…" />
                </div>
                {orgHits.length > 0 && (
                  <div className="rounded-lg border border-gray-200 divide-y max-h-40 overflow-auto">
                    {orgHits.map(o => (
                      <button key={o.id} type="button" onClick={() => { setOrgId(o.id); setOrgQuery(o.name); setOrgHits([]); }}
                        className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50">
                        {o.name} <span className="text-[10px] text-gray-400">{o.organization_type || ''} · {o.tier}</span>
                      </button>
                    ))}
                  </div>
                )}
                {orgId && <p className="text-[11px] text-green-600">Will join “{orgQuery}”.</p>}
              </div>
            )}
          </div>

          {/* Account existence — created vs linked, and email safety. */}
          {acctStatus && (
            <div className={`text-xs rounded-lg border px-3 py-2 flex items-start gap-2 ${
              acctStatus === 'active' ? 'border-green-200 bg-green-50 text-green-700'
                : acctStatus === 'pending' ? 'border-amber-200 bg-amber-50 text-amber-700'
                  : 'border-gray-200 bg-gray-50 text-gray-600'}`}>
              {acctStatus === 'active' ? <ShieldCheck className="h-3.5 w-3.5 mt-0.5 shrink-0" /> : <Mail className="h-3.5 w-3.5 mt-0.5 shrink-0" />}
              <span>
                {acctStatus === 'active'
                  ? <>This email <strong>already has an active account</strong> — it will just be linked (no new account is created), and no email is sent.</>
                  : acctStatus === 'pending'
                    ? <>This email has an account that hasn't set a password yet — you can re-send the set-up link below.</>
                    : <>No account exists for this email yet — a new one will be created.</>}
              </span>
            </div>
          )}

          <label className={`flex items-start gap-2 ${acctStatus === 'active' ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}>
            <Checkbox checked={sendEmail} disabled={acctStatus === 'active'} onCheckedChange={c => setSendEmail(c as boolean)} className="mt-0.5" />
            <span className="text-sm text-gray-700 flex items-center gap-1.5"><Mail className="h-3.5 w-3.5 text-gray-400" /> Send the welcome email now (set password → event hub)</span>
          </label>

          <Button className="w-full gap-1.5" onClick={submit} disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} {reg.user_id ? 'Apply platform identity' : acctStatus === 'active' ? 'Link account & apply' : 'Create account & apply'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
