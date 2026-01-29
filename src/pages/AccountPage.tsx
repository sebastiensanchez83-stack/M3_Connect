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
import { AlertCircle, Calendar, FileText, RefreshCw } from 'lucide-react';

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
  const { user, profile, updateProfile, loading: authLoading, profileLoading, refreshProfile } = useAuth();
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
  }, [user, authLoading, navigate]);

  useEffect(() => {
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
  }, [profile]);

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

  const handleRefreshProfile = async () => {
    await refreshProfile();
    toast({ title: 'Profile refreshed' });
  };

  const updateField = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const isMarina = profile?.organization_type === 'Marina / Port';

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'new': return <Badge variant="warning">New</Badge>;
      case 'in_progress': return <Badge variant="info">In Progress</Badge>;
      case 'completed': return <Badge variant="success">Completed</Badge>;
      case 'upcoming': return <Badge variant="info">Upcoming</Badge>;
      case 'past': return <Badge variant="secondary">Past</Badge>;
      default: return <Badge>{status}</Badge>;
    }
  };

  if (authLoading || profileLoading) {
    return (
      <div className="container mx-auto px-4 py-8 text-center">
        <div className="flex items-center justify-center gap-2">
          <RefreshCw className="h-5 w-5 animate-spin" />
          <span>{t('common.loading')}</span>
        </div>
      </div>
    );
  }

  if (!user) return null;

  if (!profile) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 text-center">
          <AlertCircle className="h-8 w-8 text-yellow-600 mx-auto mb-4" />
          <h2 className="text-lg font-semibold text-yellow-800 mb-2">Profile not found</h2>
          <p className="text-yellow-700 mb-4">Your profile is being set up. Please try refreshing.</p>
          <Button onClick={handleRefreshProfile} variant="outline">
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh Profile
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      <h1 className="text-3xl font-bold text-primary mb-8">{t('account.title')}</h1>

      {profile?.role === 'marina_pending' && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6 flex items-center gap-3">
          <AlertCircle className="h-5 w-5 text-yellow-600" />
          <p className="text-yellow-800">{t('account.pendingVerification')}</p>
        </div>
      )}

      <Tabs defaultValue={defaultTab}>
        <TabsList className="mb-6">
          <TabsTrigger value="profile">{t('account.profile')}</TabsTrigger>
          <TabsTrigger value="registrations">{t('account.registrations')}</TabsTrigger>
          {isMarina && <TabsTrigger value="projects">{t('account.projects')}</TabsTrigger>}
        </TabsList>

        <TabsContent value="profile">
          <Card>
            <CardHeader>
              <CardTitle>{t('account.profile')}</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>{t('auth.firstName')}</Label>
                    <Input value={formData.first_name} onChange={e => updateField('first_name', e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>{t('auth.lastName')}</Label>
                    <Input value={formData.last_name} onChange={e => updateField('last_name', e.target.value)} />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>{t('auth.email')}</Label>
                  <Input value={profile?.email || ''} disabled className="bg-gray-50" />
                </div>
                <div className="space-y-2">
                  <Label>{t('auth.jobTitle')}</Label>
                  <Input value={formData.job_title} onChange={e => updateField('job_title', e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>{t('auth.organizationType')}</Label>
                  <Input value={profile?.organization_type || ''} disabled className="bg-gray-50" />
                </div>
                <div className="space-y-2">
                  <Label>{t('auth.organizationName')}</Label>
                  <Input value={formData.organization_name} onChange={e => updateField('organization_name', e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>{t('auth.country')}</Label>
                  <Select value={formData.country} onValueChange={v => updateField('country', v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {countries.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                {isMarina && (
                  <>
                    <div className="space-y-2">
                      <Label>{t('auth.website')}</Label>
                      <Input value={formData.website} onChange={e => updateField('website', e.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <Label>{t('auth.capacity')}</Label>
                      <Input value={formData.capacity} onChange={e => updateField('capacity', e.target.value)} />
                    </div>
                  </>
                )}
                <Button type="submit" disabled={loading}>
                  {loading ? t('common.loading') : t('account.save')}
                </Button>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="registrations">
          <Card>
            <CardHeader>
              <CardTitle>{t('account.registrations')}</CardTitle>
            </CardHeader>
            <CardContent>
              {mockRegistrations.length === 0 ? (
                <p className="text-gray-500 text-center py-8">{t('account.noRegistrations')}</p>
              ) : (
                <div className="space-y-4">
                  {mockRegistrations.map(reg => (
                    <div key={reg.id} className="flex items-center justify-between p-4 border rounded-lg">
                      <div className="flex items-center gap-4">
                        <Calendar className="h-5 w-5 text-gray-400" />
                        <div>
                          <div className="font-medium">{reg.event_title}</div>
                          <div className="text-sm text-gray-500">
                            {new Date(reg.event_date).toLocaleDateString(i18n.language === 'fr' ? 'fr-FR' : 'en-US', {
                              year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'
                            })}
                          </div>
                        </div>
                      </div>
                      {getStatusBadge(reg.status)}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {isMarina && (
          <TabsContent value="projects">
            <Card>
              <CardHeader>
                <CardTitle>{t('account.projects')}</CardTitle>
              </CardHeader>
              <CardContent>
                {mockProjects.length === 0 ? (
                  <p className="text-gray-500 text-center py-8">{t('account.noProjects')}</p>
                ) : (
                  <div className="space-y-4">
                    {mockProjects.map(project => (
                      <div key={project.id} className="flex items-center justify-between p-4 border rounded-lg">
                        <div className="flex items-center gap-4">
                          <FileText className="h-5 w-5 text-gray-400" />
                          <div>
                            <div className="font-medium">{t(`submitProject.projectTypes.${project.project_type}`)}</div>
                            <div className="text-sm text-gray-500">
                              {t(`submitProject.budgets.${project.budget_range}`)} • {t(`submitProject.timelines.${project.timeline}`)}
                            </div>
                          </div>
                        </div>
                        {getStatusBadge(project.status)}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
