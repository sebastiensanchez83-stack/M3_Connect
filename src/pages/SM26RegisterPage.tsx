import { useState, useEffect, type ElementType, type FormEvent } from 'react';
import { Helmet } from 'react-helmet-async';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import {
  CheckCircle, Loader2, Eye, Ship, Lightbulb, Compass, GraduationCap,
  Newspaper, Scale, TrendingUp, Building2, Mic, Star,
} from 'lucide-react';
import { StartupFields, EMPTY_STARTUP, type StartupData } from '@/components/sm26/StartupFields';
import { ArchitectureFields, EMPTY_ARCHITECTURE, type ArchitectureData } from '@/components/sm26/ArchitectureFields';
import { MarinaFields, EMPTY_MARINA, type MarinaData } from '@/components/sm26/MarinaFields';
import { LightRoleFields, type LightData } from '@/components/sm26/LightRoleFields';
import { SM26BackLink } from '@/components/sm26/SM26BackLink';

// SM26 public intake — guest-first registration.
// The registrant picks ONE way to participate; M3 can add further roles
// afterwards (e.g. a sponsor who also speaks) from the admin panel.

interface RoleDef {
  key: string;
  label: string;
  scope: 'user' | 'org';
  desc: string;
  feeKey?: string;
  freeNote?: string;
}

const ROLES: RoleDef[] = [
  { key: 'visitor', label: 'Visitor / Attendee', scope: 'user', desc: 'Attend the conference, talks and exhibition.', feeKey: 'visitor' },
  { key: 'marina', label: 'Marina / Exhibitor', scope: 'org', desc: 'Exhibit your marina with an e-catalogue page and a stand.', feeKey: 'marina' },
  { key: 'startup', label: 'Startup / Scaleup', scope: 'org', desc: 'Enter the Innovation Awards.', feeKey: 'innovation' },
  { key: 'architect_pro', label: 'Architecture — Professional', scope: 'user', desc: 'Enter the Architecture competition.', freeNote: 'Free entry · optional onsite €600' },
  { key: 'architect_student', label: 'Architecture — Student', scope: 'user', desc: 'Enter the Architecture competition (students, teams up to 5).', freeNote: 'Free entry · optional onsite €120' },
  { key: 'media', label: 'Media', scope: 'user', desc: 'Request press accreditation.', freeNote: 'By accreditation' },
  { key: 'jury', label: 'Jury', scope: 'user', desc: 'Evaluate competition entries.', freeNote: 'By validation' },
  { key: 'investor', label: 'Investor', scope: 'user', desc: 'Access the innovation portfolio and deal-flow.', freeNote: 'By validation' },
  { key: 'sponsor', label: 'Sponsor / Partner', scope: 'org', desc: 'Partner the event.', freeNote: 'By agreement' },
  { key: 'speaker', label: 'Speaker', scope: 'user', desc: 'Speak at the conference.', freeNote: 'By invitation' },
  { key: 'vip', label: 'Official / VIP', scope: 'user', desc: 'Invited institutional guest.', freeNote: 'Complimentary' },
];

const ROLE_ICON: Record<string, ElementType> = {
  visitor: Eye, marina: Ship, startup: Lightbulb, architect_pro: Compass, architect_student: GraduationCap,
  media: Newspaper, jury: Scale, investor: TrendingUp, sponsor: Building2, speaker: Mic, vip: Star,
};

export function SM26RegisterPage() {
  const { user, profile, organization } = useAuth();
  const [eventId, setEventId] = useState<string | null>(null);
  const [fees, setFees] = useState<Record<string, number>>({});
  const [form, setForm] = useState({
    first_name: '', last_name: '', email: '', phone: '', company_name: '', website: '', country: '', job_title: '',
  });
  const [role, setRole] = useState<string>('');
  const [startup, setStartup] = useState<StartupData>(EMPTY_STARTUP);
  const [arch, setArch] = useState<ArchitectureData>(EMPTY_ARCHITECTURE);
  const [marina, setMarina] = useState<MarinaData>(EMPTY_MARINA);
  const [light, setLight] = useState<LightData>({});
  const [imageConsent, setImageConsent] = useState(false);
  const [terms, setTerms] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [honeypot, setHoneypot] = useState(''); // bot trap — must stay empty
  const wasGuest = !user; // captured for the success screen wording

  // Load the event id + fee config
  useEffect(() => {
    supabase.from('sm_event').select('id').eq('slug', 'sm26').maybeSingle()
      .then(({ data }) => { if (data) setEventId(data.id); });
    supabase.from('sm_fee_config').select('fee_key, amount_cents')
      .then(({ data }) => {
        if (!data) return;
        const m: Record<string, number> = {};
        for (const f of data as { fee_key: string; amount_cents: number }[]) m[f.fee_key] = f.amount_cents;
        setFees(m);
      });
  }, []);

  // Pre-fill known fields for logged-in members
  useEffect(() => {
    if (!user) return;
    setForm(prev => ({
      ...prev,
      first_name: prev.first_name || profile?.first_name || '',
      last_name: prev.last_name || profile?.last_name || '',
      email: prev.email || user.email || '',
      job_title: prev.job_title || profile?.job_title || '',
      company_name: prev.company_name || organization?.name || '',
      website: prev.website || organization?.website || '',
      country: prev.country || organization?.country || '',
    }));
  }, [user, profile, organization]);

  const setField = (k: string, v: string) => setForm(prev => ({ ...prev, [k]: v }));
  const selectRole = (k: string) => {
    setRole(prev => (prev === k ? '' : k));
    // changing role clears any details entered for the previous one
    setStartup(EMPTY_STARTUP);
    setArch(EMPTY_ARCHITECTURE);
    setMarina(EMPTY_MARINA);
    setLight({});
  };

  const fmtFee = (cents?: number) =>
    cents == null ? null : (cents === 0 ? 'Free' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(cents / 100));

  const roleFeeLabel = (r: RoleDef) =>
    r.feeKey ? (fmtFee(fees[r.feeKey]) ?? r.freeNote ?? null) : (r.freeNote ?? null);

  // Guest (no account): a public edge function provisions an account + writes
  // the registration server-side, then emails a magic-link to access it.
  const submitGuest = async () => {
    const def = ROLES.find(r => r.key === role)!;
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke('sm26-register', {
        body: {
          honeypot,
          origin: window.location.origin,
          registration: {
            first_name: form.first_name.trim(),
            last_name: form.last_name.trim(),
            email: form.email.trim(),
            phone: form.phone.trim(),
            company_name: form.company_name.trim(),
            website: form.website.trim(),
            country: form.country.trim(),
            job_title: form.job_title.trim(),
            image_consent: imageConsent,
            terms_accepted: terms,
          },
          role,
          scope: def.scope,
          light,
          startup: role === 'startup' ? startup : undefined,
          arch: role === 'architect_pro' || role === 'architect_student' ? arch : undefined,
          marina: role === 'marina' ? marina : undefined,
        },
      });

      if (error) {
        let msg = 'Please try again in a moment.';
        try {
          const body = await (error as { context?: Response }).context?.json();
          if (body?.error) msg = body.error;
        } catch { /* keep generic message */ }
        toast({ title: 'Registration failed', description: msg, variant: 'destructive' });
        return;
      }

      const status = (data as { status?: string })?.status;
      // The endpoint returns an identical 'ok' whether the account was created or
      // already existed (anti-enumeration); either way we email an access link.
      if (status === 'ok' || status === 'created') {
        setDone(true);
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
      toast({ title: 'Registration failed', description: 'Unexpected response. Please try again.', variant: 'destructive' });
    } catch {
      toast({ title: 'Registration failed', description: 'An unexpected error occurred.', variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.first_name.trim() || !form.last_name.trim() || !form.email.trim()) {
      toast({ title: 'Please fill in your name and email', variant: 'destructive' }); return;
    }
    if (!role) { toast({ title: 'Select how you want to participate', variant: 'destructive' }); return; }
    if (!terms) { toast({ title: 'Please accept the terms & conditions', variant: 'destructive' }); return; }
    if (!user) { await submitGuest(); return; }
    if (!eventId) { toast({ title: 'Event not available yet', variant: 'destructive' }); return; }

    setSubmitting(true);
    try {
      const { data: reg, error: regErr } = await supabase.from('sm_registration').insert({
        event_id: eventId,
        user_id: user.id,
        organization_id: organization?.id ?? null,
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim() || null,
        company_name: form.company_name.trim() || null,
        website: form.website.trim() || null,
        country: form.country.trim() || null,
        job_title: form.job_title.trim() || null,
        image_consent: imageConsent,
        terms_accepted_at: new Date().toISOString(),
        status: 'submitted',
      }).select('id').single();

      if (regErr || !reg) {
        toast({ title: 'Registration failed', description: regErr?.message, variant: 'destructive' });
        setSubmitting(false); return;
      }

      const def = ROLES.find(r => r.key === role)!;
      const { data: ra, error: raErr } = await supabase.from('sm_role_assignment').insert({
        registration_id: reg.id,
        event_id: eventId,
        organization_id: def.scope === 'org' ? (organization?.id ?? null) : null,
        role,
        scope: def.scope,
        depth: 'full',
        source: 'self',
        status: 'self_submitted',
        module_data: light,
      }).select('id').single();
      if (raErr || !ra) {
        toast({ title: 'Could not save your selected role', description: raErr?.message, variant: 'destructive' });
        setSubmitting(false); return;
      }

      // Role-specific module details (more roles to follow).
      if (role === 'startup') {
        const { error: spErr } = await supabase.from('sm_startup_profile').insert({
          role_assignment_id: ra.id,
          event_id: eventId,
          startup_or_scaleup: startup.startup_or_scaleup || null,
          stage: startup.stage || null,
          categories: startup.categories,
          organization_activity: startup.organization_activity || null,
          problem: startup.problem || null,
          solution: startup.solution || null,
          differentiation: startup.differentiation || null,
          usp: startup.usp || null,
          target_markets: startup.target_markets || null,
          business_model: startup.business_model || null,
          competitive_positioning: startup.competitive_positioning || null,
          collaboration_expected: startup.collaboration_expected || null,
          investment_seeking: startup.investment_seeking,
          investment_stage: startup.investment_stage || null,
          investment_type: startup.investment_type || null,
          funds_needed: startup.funds_needed || null,
          references_text: startup.references_text || null,
        });
        if (spErr) {
          toast({ title: 'Registration saved — but the innovation details could not be saved', description: `${spErr.message}. You can add them later.`, variant: 'destructive' });
        }
      }

      if (role === 'architect_pro' || role === 'architect_student') {
        const teamMembers = arch.team_members.split('\n').map(s => s.trim()).filter(Boolean);
        const { error: arErr } = await supabase.from('sm_architecture_entry').insert({
          role_assignment_id: ra.id,
          event_id: eventId,
          category: role === 'architect_pro' ? 'professional' : 'student',
          company_description: arch.company_description || null,
          sustainability_statement: arch.sustainability_statement || null,
          domain: arch.domain || null,
          references_text: arch.references_text || null,
          proof_of_enrolment_url: arch.proof_of_enrolment_url || null,
          is_team: arch.is_team,
          team_size: arch.team_size ? parseInt(arch.team_size, 10) : null,
          team_members: teamMembers,
          portfolio_link: arch.portfolio_link || null,
          onsite_attendance: arch.onsite_attendance,
        });
        if (arErr) {
          toast({ title: 'Registration saved — but the architecture details could not be saved', description: `${arErr.message}. You can add them later.`, variant: 'destructive' });
        }
      }

      if (role === 'marina') {
        const { error: meErr } = await supabase.from('sm_marina_extra').insert({
          role_assignment_id: ra.id,
          event_id: eventId,
          organization_id: organization?.id ?? null,
          architectural_quality: marina.architectural_quality || null,
          biodiversity: marina.biodiversity || null,
          water: marina.water || null,
          energy: marina.energy || null,
          waste: marina.waste || null,
          innovation: marina.innovation || null,
          security: marina.security || null,
          further_info: marina.further_info || null,
        });
        if (meErr) {
          toast({ title: 'Registration saved — but the marina details could not be saved', description: `${meErr.message}. You can add them later.`, variant: 'destructive' });
        }
      }

      setDone(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch {
      toast({ title: 'Registration failed', description: 'An unexpected error occurred.', variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <div className="container mx-auto px-4 py-16 max-w-xl text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-green-100">
          <CheckCircle className="h-8 w-8 text-green-600" />
        </div>
        <h1 className="text-2xl font-bold mb-2">Registration received</h1>
        <p className="text-gray-600">
          Thanks, {form.first_name}. Your registration for the Smart &amp; Sustainable Marina Rendezvous 2026
          is in. M3 will review it — you'll get full access (and any invoice) once it's confirmed.
        </p>
        {wasGuest && (
          <p className="text-gray-600 mt-3">
            We've emailed <strong>{form.email}</strong> a link to access your workspace and complete your registration.
            Please check your inbox (and spam folder).
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Helmet><title>Register — Smart &amp; Sustainable Marina Rendezvous 2026</title></Helmet>

      <section className="bg-gradient-to-br from-[#0b2653] to-[#143a6b] text-white">
        <div className="container mx-auto px-4 py-12">
          <div className="mb-4"><SM26BackLink to="/events" label="Back to events" light /></div>
          <p className="uppercase tracking-wide text-white/60 text-sm mb-2">SM26 · 20–21 September 2026 · Yacht Club de Monaco</p>
          <h1 className="text-3xl lg:text-4xl font-bold">Register for the Rendezvous</h1>
          <p className="text-white/80 mt-2 max-w-2xl">Tell us who you are and how you'd like to take part.</p>
        </div>
      </section>

      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <form onSubmit={handleSubmit} className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Your details</CardTitle>
              <CardDescription>{user ? 'Pre-filled from your account — edit if anything has changed.' : 'Fill in your contact details.'}</CardDescription>
            </CardHeader>
            <CardContent className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-1"><Label>First name *</Label><Input value={form.first_name} onChange={e => setField('first_name', e.target.value)} required /></div>
              <div className="space-y-1"><Label>Last name *</Label><Input value={form.last_name} onChange={e => setField('last_name', e.target.value)} required /></div>
              <div className="space-y-1"><Label>Email *</Label><Input type="email" value={form.email} onChange={e => setField('email', e.target.value)} required /></div>
              <div className="space-y-1"><Label>Phone</Label><Input value={form.phone} onChange={e => setField('phone', e.target.value)} /></div>
              <div className="space-y-1"><Label>Company / University</Label><Input value={form.company_name} onChange={e => setField('company_name', e.target.value)} /></div>
              <div className="space-y-1"><Label>Website</Label><Input value={form.website} onChange={e => setField('website', e.target.value)} placeholder="https://" /></div>
              <div className="space-y-1"><Label>Country</Label><Input value={form.country} onChange={e => setField('country', e.target.value)} /></div>
              <div className="space-y-1"><Label>Job title</Label><Input value={form.job_title} onChange={e => setField('job_title', e.target.value)} /></div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>How do you want to participate? *</CardTitle>
              <CardDescription>Choose one. If you take part in several ways, M3 can add the other roles after you register. Some roles are confirmed by M3.</CardDescription>
            </CardHeader>
            <CardContent className="grid sm:grid-cols-2 gap-3">
              {ROLES.map(r => {
                const Icon = ROLE_ICON[r.key] ?? Eye;
                const selected = role === r.key;
                const fee = roleFeeLabel(r);
                return (
                  <button
                    type="button"
                    key={r.key}
                    onClick={() => selectRole(r.key)}
                    aria-pressed={selected}
                    className={`text-left rounded-xl border p-4 transition-all ${selected ? 'border-primary ring-2 ring-primary/30 bg-primary/5' : 'border-gray-200 hover:border-primary/40'}`}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`rounded-lg p-2 shrink-0 ${selected ? 'bg-primary/10 text-primary' : 'bg-gray-100 text-gray-500'}`}>
                        <Icon className="h-5 w-5" />
                      </div>
                      <div className="min-w-0">
                        <div className="font-semibold flex items-center gap-1.5">
                          {r.label}{selected && <CheckCircle className="h-4 w-4 text-primary shrink-0" />}
                        </div>
                        <div className="text-sm text-gray-500">{r.desc}</div>
                        {fee && <div className="text-xs font-medium text-gray-700 mt-1">{fee}</div>}
                      </div>
                    </div>
                  </button>
                );
              })}
            </CardContent>
          </Card>

          {role === 'startup' && <StartupFields value={startup} onChange={setStartup} />}
          {(role === 'architect_pro' || role === 'architect_student') && (
            <ArchitectureFields variant={role === 'architect_pro' ? 'professional' : 'student'} value={arch} onChange={setArch} />
          )}
          {role === 'marina' && <MarinaFields value={marina} onChange={setMarina} />}
          <LightRoleFields role={role} value={light} onChange={setLight} />

          {/* Honeypot — hidden from real users; bots that fill it are silently dropped */}
          <input
            type="text"
            name="company_url"
            tabIndex={-1}
            autoComplete="off"
            aria-hidden="true"
            value={honeypot}
            onChange={e => setHoneypot(e.target.value)}
            style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, opacity: 0 }}
          />

          <Card>
            <CardContent className="pt-6 space-y-3">
              <div className="flex items-start gap-2">
                <Checkbox id="img-consent" checked={imageConsent} onCheckedChange={c => setImageConsent(c as boolean)} />
                <Label htmlFor="img-consent" className="font-normal text-sm">I agree that photos/videos taken at the event may be used for communication purposes.</Label>
              </div>
              <div className="flex items-start gap-2">
                <Checkbox id="terms" checked={terms} onCheckedChange={c => setTerms(c as boolean)} />
                <Label htmlFor="terms" className="font-normal text-sm">I accept the terms &amp; conditions and the privacy policy. *</Label>
              </div>

              {!user && (
                <p className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                  No account needed — we'll create your workspace and email you a link to access and complete your registration.
                  Already have a Smart Marina Connect account? Use <strong>Log in</strong> (top-right) first, so this registration links to your account.
                </p>
              )}

              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Submit registration
              </Button>
            </CardContent>
          </Card>
        </form>
      </div>
    </div>
  );
}
