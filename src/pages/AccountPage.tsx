import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/hooks/use-toast';
import { AlertCircle, Calendar, FileText } from 'lucide-react';

const countries = ['France', 'Monaco', 'Italy', 'Spain', 'Greece', 'Croatia', 'Portugal', 'United Kingdom', 'Germany', 'Netherlands', 'Belgium', 'United States', 'United Arab Emirates', 'Other'];

const mockRegistrations = [
  { id: '1', event_title: 'Webinar: Energy Efficiency Solutions', event_date: '2025-02-15T14:00:00Z', status: 'upcoming' },
  { id: '2', event_title: 'Marina Managers Roundtable', event_date: '2025-02-22T10:00:00Z', status: 'upcoming' },
];

const mockProjects = [
  { id: '1', project_type: 'energy', budget_range: '50k_100k', timeline: '12_24_months', status: 'new', created_at: '2025-01-15' },
];

export function AccountPage() {
  const { t, i18n } = useTranslation();
  const { user, profile, updateProfile, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    first_name: '', last_name: '', job_title: '', organization_name: '', country: '', website: '', capacity: '',
  });

  const defaultTab = searchParams.get('tab') || 'profile';

  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/');
    }
    if (profile) {
      setFormData({
        first_name: profile.first_name || '',
        last_name: profile.last_name || '',
        job_title: profile.job_title || '',
        organization_name: profile.organization_name || '',
        country: profile.country || '',
        website: profile.website || '',
        capacity: profile.capacity || '',
      });
    }
  }, [user, profile, authLoading, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await updateProfile(formData);
    if (error) {
      toast({ title: t('common.error'), description: error.message, variant: 'destructive' });
    } else {
      toast({ title: t('account.saveSuccess') });
    }
    setLoading(false);
  };

  const updateField = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const isMarina = profile?.organizat
