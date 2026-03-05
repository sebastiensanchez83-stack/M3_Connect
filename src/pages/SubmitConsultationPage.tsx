import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, CheckCircle } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { Sector } from '@/types/database';
import { toast } from '@/hooks/use-toast';

export function SubmitConsultationPage() {
  const { user, profile, isVerified, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [sectors, setSectors] = useState<Sector[]>([]);

  const [form, setForm] = useState({
    title: '',
    description: '',
    sector_id: '',
  });

  useEffect(() => {
    if (authLoading) return;
    if (!user) { navigate('/'); return; }
    if (profile?.persona === 'marina' && isVerified) {
      supabase.from('sectors').select('*').eq('is_active', true).order('label')
        .then(({ data }) => { if (data) setSectors(data as Sector[]); });
    }
  }, [user, profile, isVerified, authLoading, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (!form.title.trim() || !form.description.trim()) {
      toast({ title: 'Required fields', description: 'Title and description are mandatory.', variant: 'destructive' });
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase
        .from('consultations')
        .insert({
          marina_user_id: user.id,
          title: form.title.trim(),
          description: form.description.trim(),
          sector_id: form.sector_id || null,
          is_open: true,
        });

      if (error) throw error;

      toast({
        title: 'Consultation request submitted!',
        description: 'Your question is now visible to relevant partners who can offer their expertise.',
      });
      navigate('/account?tab=consultations');
    } catch (err: unknown) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'An error occurred while submitting your consultation.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  if (authLoading) {
    return (
      <div className="container mx-auto py-16 text-center">
        <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
      </div>
    );
  }

  // Access guard: only verified marina users
  if (!user || profile?.persona !== 'marina' || !isVerified) {
    return (
      <div className="container mx-auto px-4 py-16 max-w-lg text-center">
        <h1 className="text-2xl font-bold text-gray-800 mb-2">Marina Members Only</h1>
        <p className="text-gray-500 mb-6">
          {!user
            ? 'Please log in to request a consultation.'
            : profile?.persona !== 'marina'
              ? 'Only marina accounts can request consultations.'
              : 'Your account must be verified before you can request a consultation.'}
        </p>
        {!user && (
          <Button onClick={() => navigate('/')}>Go to Homepage</Button>
        )}
        {user && !isVerified && (
          <Button onClick={() => navigate('/account')}>View Account Status</Button>
        )}
        {user && isVerified && profile?.persona !== 'marina' && (
          <Button onClick={() => navigate('/account')}>Back to Account</Button>
        )}
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-2xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-primary mb-2">Request a Consultation</h1>
        <p className="text-gray-600">
          Post a question or topic you need expert guidance on. Industry partners
          with relevant expertise will be able to offer their insights and assistance.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Consultation Details</CardTitle>
            <CardDescription>Describe what you need help with</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <Label>Title *</Label>
              <Input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                required
                placeholder="e.g. Best practices for superyacht berth management"
              />
            </div>

            <div className="space-y-2">
              <Label>Description *</Label>
              <Textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                required
                rows={6}
                placeholder="Describe your question or topic in detail: what challenge are you facing, what context is important, what kind of expertise or advice are you looking for..."
              />
            </div>

            <div className="space-y-2">
              <Label>Sector</Label>
              <Select
                value={form.sector_id}
                onValueChange={(v) => setForm({ ...form, sector_id: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a sector" />
                </SelectTrigger>
                <SelectContent>
                  {sectors.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Button type="submit" className="w-full" size="lg" disabled={loading}>
          {loading
            ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Submitting...</>
            : <><CheckCircle className="h-4 w-4 mr-2" />Submit Consultation Request</>
          }
        </Button>
      </form>
    </div>
  );
}
