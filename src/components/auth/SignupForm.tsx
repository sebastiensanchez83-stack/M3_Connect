import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/hooks/use-toast';
import { PersonaType } from '@/types/database';
import { Anchor, Building2, Newspaper, Loader2, ChevronLeft, Eye, EyeOff } from 'lucide-react';

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
  const [formData, setFormData] = useState({ firstName: '', lastName: '', email: '', companyName: '', companyWebsite: '', password: '', confirmPassword: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

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
    if (formData.password !== formData.confirmPassword) {
      toast({ title: t('auth.error'), description: t('auth.passwordMismatch'), variant: 'destructive' });
      return;
    }
    if (formData.password.length < 8) {
      toast({ title: t('auth.error'), description: t('auth.passwordTooShort'), variant: 'destructive' });
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
    const { error } = await signUp(formData.email, formData.password, selectedPersona, formData.firstName.trim(), formData.lastName.trim(), formData.companyName.trim(), formData.companyWebsite.trim());
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
        <Label htmlFor="email">{t('auth.emailPro')} *</Label>
        <Input id="email" type="email" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} required placeholder={t('auth.emailPlaceholder')} />
      </div>
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
          <Input id="password" type={showPassword ? 'text' : 'password'} value={formData.password} onChange={(e) => setFormData({ ...formData, password: e.target.value })} required minLength={8} placeholder={t('auth.passwordPlaceholder')} className="pr-10" />
          <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors" tabIndex={-1}>
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="confirmPassword">{t('auth.confirmPassword')} *</Label>
        <div className="relative">
          <Input id="confirmPassword" type={showConfirmPassword ? 'text' : 'password'} value={formData.confirmPassword} onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })} required className="pr-10" />
          <button type="button" onClick={() => setShowConfirmPassword(!showConfirmPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors" tabIndex={-1}>
            {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
        {loading ? t('auth.creating') : t('auth.createAccount')}
      </Button>
    </form>
  );
}
