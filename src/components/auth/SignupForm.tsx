import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase';
import { PersonaType } from '@/types/database';
import { Checkbox } from '@/components/ui/checkbox';
import { Anchor, Building2, Newspaper, Loader2, ChevronLeft, Eye, EyeOff, Info } from 'lucide-react';

interface SignupFormProps {
  onSuccess?: () => void;
  defaultPersona?: PersonaType;
}

export function SignupForm({ onSuccess, defaultPersona }: SignupFormProps) {
  const { t } = useTranslation();
  const { signUp } = useAuth();
  const [step, setStep] = useState<1 | 2>(defaultPersona ? 2 : 1);
  const [loading, setLoading] = useState(false);
  const [selectedPersona, setSelectedPersona] = useState<PersonaType | ''>(defaultPersona || '');
  const [formData, setFormData] = useState({ firstName: '', lastName: '', email: '', jobTitle: '', companyName: '', companyWebsite: '', password: '', confirmPassword: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [detectedOrg, setDetectedOrg] = useState<{ id: string; name: string } | null>(null);
  const [errors, setErrors] = useState<{ passwordMismatch?: boolean; termsRequired?: boolean; passwordWeak?: boolean }>({});
  const [incomingClaimCode, setIncomingClaimCode] = useState<string | null>(null);

  const validatePasswordStrength = (pwd: string) => {
    return pwd.length >= 8 && /[A-Z]/.test(pwd) && /[^A-Za-z0-9]/.test(pwd);
  };

  // Domain detection: check if an organization exists for this email domain
  // (Public/personal email domains are now allowed — no blacklist)
  const checkDomain = useCallback(async (email: string) => {
    if (!email.includes('@')) { setDetectedOrg(null); return; }
    const domain = email.split('@')[1]?.toLowerCase();
    if (!domain) { setDetectedOrg(null); return; }

    // Check if organization already exists for this domain
    try {
      const { data } = await supabase
        .from('organizations')
        .select('id, name')
        .eq('primary_domain', domain)
        .maybeSingle();
      setDetectedOrg(data || null);
    } catch {
      setDetectedOrg(null);
    }
  }, []);

  // Debounced email domain check
  useEffect(() => {
    const timer = setTimeout(() => {
      if (formData.email) checkDomain(formData.email);
    }, 500);
    return () => clearTimeout(timer);
  }, [formData.email, checkDomain]);

  // Pre-fill email and claim code from URL params (from "Send Connect Link" email)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const emailParam = params.get('email');
    const codeParam = params.get('code');
    if (emailParam) {
      setFormData(prev => ({ ...prev, email: emailParam }));
      // Marina persona is most common for claim codes; auto-advance to step 2
      if (codeParam && !defaultPersona) {
        setSelectedPersona('marina');
        setStep(2);
      }
    }
    if (codeParam) {
      // Persist code so OnboardingPage can pre-fill it after email confirmation
      try { sessionStorage.setItem('pending_claim_code', codeParam); } catch { /* ignore */ }
      setIncomingClaimCode(codeParam);
    } else {
      // Check sessionStorage in case user refreshed
      try {
        const stored = sessionStorage.getItem('pending_claim_code');
        if (stored) setIncomingClaimCode(stored);
      } catch { /* ignore */ }
    }
  }, [defaultPersona]);

  const personas = [
    { value: 'marina' as PersonaType, icon: <Anchor className="h-6 w-6" />, title: t('auth.personaMarina'), desc: t('auth.personaMarinaDesc') },
    { value: 'partner' as PersonaType, icon: <Building2 className="h-6 w-6" />, title: t('auth.personaPartner'), desc: t('auth.personaPartnerDesc') },
    { value: 'media_partner' as PersonaType, icon: <Newspaper className="h-6 w-6" />, title: t('auth.personaMedia'), desc: t('auth.personaMediaDesc') },
  ];

  const handlePersonaSelect = (persona: PersonaType) => {
    setSelectedPersona(persona);
    setStep(2);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPersona) return;
    if (!acceptTerms) {
      setErrors(prev => ({ ...prev, termsRequired: true }));
      toast({ title: t('auth.error'), description: t('auth.acceptTermsRequired', 'Please accept the Terms and Conditions'), variant: 'destructive' });
      return;
    }
    if (formData.password !== formData.confirmPassword) {
      setErrors(prev => ({ ...prev, passwordMismatch: true }));
      toast({ title: t('auth.error'), description: t('auth.passwordMismatch'), variant: 'destructive' });
      return;
    }
    if (!validatePasswordStrength(formData.password)) {
      setErrors(prev => ({ ...prev, passwordWeak: true }));
      toast({ title: t('auth.error'), description: 'Password must be at least 8 characters with one uppercase letter and one symbol.', variant: 'destructive' });
      return;
    }
    setLoading(true);
    // Validate company website URL format if provided
    if (formData.companyWebsite.trim()) {
      try {
        const url = formData.companyWebsite.trim().startsWith('http') ? formData.companyWebsite.trim() : `https://${formData.companyWebsite.trim()}`;
        new URL(url);
      } catch {
        toast({ title: t('auth.error'), description: t('auth.invalidWebsite'), variant: 'destructive' });
        setLoading(false);
        return;
      }
    }
    // If the user arrived via a valid claim-code link, bypass email confirmation
    // (they already proved email ownership by clicking the invitation link).
    let pendingClaimCode: string | null = null;
    try { pendingClaimCode = sessionStorage.getItem('pending_claim_code'); } catch { /* ignore */ }

    if (pendingClaimCode) {
      try {
        const { data: claimResult, error: claimError } = await supabase.functions.invoke('claim-code-signup', {
          body: {
            email: formData.email,
            password: formData.password,
            first_name: formData.firstName.trim(),
            last_name: formData.lastName.trim(),
            persona: selectedPersona,
            claim_code: pendingClaimCode,
          },
        });

        if (claimError || !claimResult?.success) {
          // If claim-code signup fails, fall back to normal signup below
          // (this covers the case of a typo'd code, already-used email, etc.)
          const errMsg = claimResult?.error || claimError?.message || 'Claim code signup failed';
          // Only fall through to normal signup if it was an invalid code;
          // existing-email errors should be surfaced to the user directly.
          if (errMsg.toLowerCase().includes('already exists')) {
            setLoading(false);
            toast({ title: t('auth.error'), description: errMsg, variant: 'destructive' });
            return;
          }
          // fall through to normal signup
        } else {
          // Success \u2014 sign the user in immediately (skips email confirmation)
          const { error: signInError } = await supabase.auth.signInWithPassword({
            email: formData.email,
            password: formData.password,
          });
          setLoading(false);
          if (signInError) {
            toast({ title: t('auth.error'), description: signInError.message, variant: 'destructive' });
            return;
          }
          toast({ title: t('auth.signupSuccess'), description: 'Account created! Completing setup...' });
          // sessionStorage claim code will be read by OnboardingPage and auto-claim
          onSuccess?.();
          return;
        }
      } catch (err) {
        // fall through to normal signup on unexpected error
        console.error('Claim-code signup error:', err);
      }
    }

    // Normal signup path (requires email confirmation)
    const { error } = await signUp(formData.email, formData.password, selectedPersona, formData.firstName.trim(), formData.lastName.trim(), formData.companyName.trim(), formData.companyWebsite.trim(), detectedOrg?.id, formData.jobTitle.trim());
    setLoading(false);
    if (error) {
      toast({ title: t('auth.error'), description: error.message, variant: 'destructive' });
    } else {
      toast({ title: t('auth.signupSuccess'), description: t('auth.signupSuccessDesc') });
      onSuccess?.();
    }
  };

  if (step === 1) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-gray-600">{t('auth.selectPersona')}</p>
        <div className="space-y-3">
          {personas.map((p) => (
            <button key={p.value} type="button" onClick={() => handlePersonaSelect(p.value)}
              className="w-full flex items-center gap-4 p-4 rounded-lg border-2 border-gray-200 hover:border-primary hover:bg-primary/5 transition-all text-left group">
              <div className="text-primary shrink-0">{p.icon}</div>
              <div>
                <div className="font-semibold text-gray-900 group-hover:text-primary">{p.title}</div>
                <div className="text-sm text-gray-500">{p.desc}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  const selected = personas.find((p) => p.value === selectedPersona);

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <button type="button" onClick={() => setStep(1)} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
        <ChevronLeft className="h-4 w-4" /> {t('auth.back')}
      </button>
      {incomingClaimCode && (
        <div className="flex items-start gap-3 p-3 rounded-lg bg-green-50 border border-green-200">
          <Info className="h-5 w-5 text-green-600 shrink-0 mt-0.5" />
          <div className="text-sm">
            <div className="font-medium text-green-900">You've been invited to join an organization</div>
            <div className="text-xs text-green-700 mt-0.5">Code <span className="font-mono font-semibold">{incomingClaimCode}</span> will be applied automatically. No email confirmation needed.</div>
          </div>
        </div>
      )}
      {selected && (
        <div className="flex items-center gap-3 p-3 rounded-lg bg-primary/5 border border-primary/20">
          <div className="text-primary">{selected.icon}</div>
          <div><div className="font-medium text-primary">{selected.title}</div><div className="text-xs text-gray-500">{selected.desc}</div></div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="firstName">{t('auth.firstName')} *</Label>
          <Input id="firstName" value={formData.firstName} onChange={(e) => setFormData({ ...formData, firstName: e.target.value })} required placeholder={t('auth.firstNamePlaceholder')} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="lastName">{t('auth.lastName')} *</Label>
          <Input id="lastName" value={formData.lastName} onChange={(e) => setFormData({ ...formData, lastName: e.target.value })} required placeholder={t('auth.lastNamePlaceholder')} />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="jobTitle">{t('auth.jobTitle', 'Job Title / Position')}</Label>
        <Input id="jobTitle" value={formData.jobTitle} onChange={(e) => setFormData({ ...formData, jobTitle: e.target.value })} placeholder={t('auth.jobTitlePlaceholder', 'e.g. Marina Director, Sales Manager...')} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="email">{t('auth.emailPro')} *</Label>
        <Input id="email" type="email" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} required placeholder={t('auth.emailPlaceholder')} />
      </div>
      {/* Domain detection banner - organization found */}
      {detectedOrg && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-50 border border-blue-200 text-sm">
          <Info className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />
          <span className="text-blue-800">
            {t('auth.orgDetected', { orgName: detectedOrg.name })}
            {' — '}
            {t('auth.orgDetectedJoin', 'Your registration will be sent to the organization owner for approval.')}
          </span>
        </div>
      )}
      <div className="space-y-2">
        <Label htmlFor="companyName">{t('auth.companyName')} *</Label>
        <Input id="companyName" value={formData.companyName} onChange={(e) => setFormData({ ...formData, companyName: e.target.value })} required placeholder={t('auth.companyNamePlaceholder')} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="companyWebsite">{t('auth.companyWebsite')}</Label>
        <Input id="companyWebsite" type="url" value={formData.companyWebsite} onChange={(e) => setFormData({ ...formData, companyWebsite: e.target.value })} placeholder={t('auth.companyWebsitePlaceholder')} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">{t('auth.password')} *</Label>
        <div className="relative">
          <Input
            id="password"
            type={showPassword ? 'text' : 'password'}
            value={formData.password}
            onChange={(e) => {
              const pwd = e.target.value;
              setFormData({ ...formData, password: pwd });
              if (pwd.length > 0) {
                setErrors(prev => ({ ...prev, passwordWeak: !validatePasswordStrength(pwd) }));
              } else {
                setErrors(prev => ({ ...prev, passwordWeak: false }));
              }
            }}
            required
            minLength={8}
            placeholder={t('auth.passwordPlaceholder')}
            className="pr-10"
            aria-invalid={errors.passwordWeak || undefined}
          />
          <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors" tabIndex={-1}>
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        {errors.passwordWeak ? (
          <p className="text-sm text-red-600 mt-1">Password must be at least 8 characters and include one uppercase letter and one symbol.</p>
        ) : (
          <p className="text-xs text-gray-400">Min. 8 characters, 1 uppercase letter, 1 symbol</p>
        )}
      </div>
      <div className="space-y-2">
        <Label htmlFor="confirmPassword">{t('auth.confirmPassword')} *</Label>
        <div className="relative">
          <Input id="confirmPassword" type={showConfirmPassword ? 'text' : 'password'} value={formData.confirmPassword} onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })} required className="pr-10"
            onBlur={() => {
              if (formData.confirmPassword && formData.password !== formData.confirmPassword) {
                setErrors(prev => ({ ...prev, passwordMismatch: true }));
              } else {
                setErrors(prev => ({ ...prev, passwordMismatch: false }));
              }
            }}
          />
          <button type="button" onClick={() => setShowConfirmPassword(!showConfirmPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors" tabIndex={-1}>
            {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        {errors.passwordMismatch && (
          <p className="text-sm text-red-600 mt-1">{t('auth.passwordMismatch', 'Passwords do not match')}</p>
        )}
      </div>
      <div className="flex items-start gap-2.5">
        <Checkbox
          id="acceptTerms"
          checked={acceptTerms}
          onCheckedChange={(checked) => { setAcceptTerms(checked === true); setErrors(prev => ({ ...prev, termsRequired: false })); }}
          className="mt-0.5"
        />
        <label htmlFor="acceptTerms" className="text-sm text-gray-600 leading-snug cursor-pointer">
          {t('auth.acceptTerms', 'I accept the')}{' '}
          <a href="/terms" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline font-medium">
            {t('auth.termsAndConditions', 'Terms and Conditions')}
          </a>{' '}
          {t('auth.andThe', 'and the')}{' '}
          <a href="/privacy" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline font-medium">
            {t('auth.privacyPolicy', 'Privacy Policy')}
          </a>
        </label>
      </div>
      {errors.termsRequired && !acceptTerms && (
        <p className="text-sm text-red-600 mt-1 ml-7">{t('auth.acceptTermsRequired', 'Please accept the Terms and Conditions to continue')}</p>
      )}
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
        {loading ? t('auth.creating') : t('auth.createAccount')}
      </Button>
    </form>
  );
}
