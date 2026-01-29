import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from '@/hooks/use-toast';

interface SignupFormProps {
  onSuccess?: () => void;
}

const countries = [
  'France', 'Monaco', 'Italy', 'Spain', 'Greece', 'Croatia', 'Portugal',
  'United Kingdom', 'Germany', 'Netherlands', 'Belgium', 'United States',
  'United Arab Emirates', 'Other'
];

export function SignupForm({ onSuccess }: SignupFormProps) {
  const { t } = useTranslation();
  const { signUp } = useAuth();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    confirmPassword: '',
    firstName: '',
    lastName: '',
    jobTitle: '',
    organizationType: '',
    organizationName: '',
    country: '',
    website: '',
    capacity: '',
  });

  const isMarina = formData.organizationType === 'Marina / Port';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (formData.password !== formData.confirmPassword) {
      toast({
        title: t('common.error'),
        description: 'Passwords do not match',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);

    const { error } = await signUp(formData.email, formData.password, {
      first_name: formData.firstName,
      last_name: formData.lastName,
      job_title: formData.jobTitle,
      organization_type: formData.organizationType,
      organization_name: formData.organizationName,
      country: formData.country,
      website: isMarina ? formData.website : null,
      capacity: isMarina ? formData.capacity : null,
    });

    if (error) {
      toast({
        title: t('common.error'),
        description: error.message,
        variant: 'destructive',
      });
    } else {
      toast({
        title: t('auth.signupSuccess'),
      });
      onSuccess?.();
    }

    setLoading(false);
  };

  const updateField = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="firstName">{t('auth.firstName')}</Label>
          <Input
            id="firstName"
            value={formData.firstName}
            onChange={(e) => updateField('firstName', e.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="lastName">{t('auth.lastName')}</Label>
          <Input
            id="lastName"
            value={formData.lastName}
            onChange={(e) => updateField('lastName', e.target.value)}
            required
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="email">{t('auth.email')}</Label>
        <Input
          id="email"
          type="email"
          value={formData.email}
          onChange={(e) => updateField('email', e.target.value)}
          required
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="password">{t('auth.password')}</Label>
          <Input
            id="password"
            type="password"
            value={formData.password}
            onChange={(e) => updateField('password', e.target.value)}
            required
            minLength={6}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirmPassword">{t('auth.confirmPassword')}</Label>
          <Input
            id="confirmPassword"
            type="password"
            value={formData.confirmPassword}
            onChange={(e) => updateField('confirmPassword', e.target.value)}
            required
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="jobTitle">{t('auth.jobTitle')}</Label>
        <Input
          id="jobTitle"
          value={formData.jobTitle}
          onChange={(e) => updateField('jobTitle', e.target.value)}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="organizationType">{t('auth.organizationType')}</Label>
        <Select
          value={formData.organizationType}
          onValueChange={(value) => updateField('organizationType', value)}
          required
        >
          <SelectTrigger>
            <SelectValue placeholder="Select..." />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="Marina / Port">{t('auth.orgTypes.marina')}</SelectItem>
            <SelectItem value="Supplier">{t('auth.orgTypes.supplier')}</SelectItem>
            <SelectItem value="Service Provider">{t('auth.orgTypes.service')}</SelectItem>
            <SelectItem value="Institution">{t('auth.orgTypes.institution')}</SelectItem>
            <SelectItem value="Other">{t('auth.orgTypes.other')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="organizationName">{t('auth.organizationName')}</Label>
        <Input
          id="organizationName"
          value={formData.organizationName}
          onChange={(e) => updateField('organizationName', e.target.value)}
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="country">{t('auth.country')}</Label>
        <Select
          value={formData.country}
          onValueChange={(value) => updateField('country', value)}
          required
        >
          <SelectTrigger>
            <SelectValue placeholder="Select..." />
          </SelectTrigger>
          <SelectContent>
            {countries.map((country) => (
              <SelectItem key={country} value={country}>
                {country}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isMarina && (
        <>
          <div className="space-y-2">
            <Label htmlFor="website">{t('auth.website')}</Label>
            <Input
              id="website"
              type="url"
              value={formData.website}
              onChange={(e) => updateField('website', e.target.value)}
              placeholder="https://..."
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="capacity">{t('auth.capacity')}</Label>
            <Input
              id="capacity"
              value={formData.capacity}
              onChange={(e) => updateField('capacity', e.target.value)}
              placeholder="e.g., 500"
            />
          </div>
        </>
      )}

      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? t('common.loading') : t('auth.signup')}
      </Button>
    </form>
  );
}
