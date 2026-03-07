import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, CheckCircle, Lock } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { Sector } from '@/types/database';
import { toast } from '@/hooks/use-toast';

export function WebinarRequestPage() {
  const { user, profile, isVerified, organization, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [selectedSectors, setSelectedSectors] = useState<string[]>([]);

  const [form, setForm] = useState({
    title: '',
    description: '',
    preferred_language: 'EN',
    preferred_timeframe: '',
  });

  useEffect(() => {
    if (authLoading) return;
    if (!user) { navigate('/'); return; }
    if (isVerified && organization?.access_status === 'verified') {
      supabase.from('sectors').select('*').eq('is_active', true).order('label')
        .then(({ data }) => { if (data) setSectors(data as Sector[]); });
    }
  }, [user, isVerified, organization, authLoading, navigate]);

  const toggleSector = (id: string) => {
    setSelectedSectors((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (!form.title.trim() || !form.description.trim()) {
      toast({ title: 'Required fields', description: 'Title and description are mandatory.', variant: 'destructive' });
      return;
    }

    setLoading(true);
    try {
      const { data: request, error } = await supabase
        .from('webinar_requests')
        .insert({
          user_id: user.id,
          organization_id: organization?.id || null,
          title: form.title.trim(),
          description: form.description.trim(),
          preferred_language: form.preferred_language,
          preferred_timeframe: form.preferred_timeframe.trim() || null,
          status: 'submitted',
        })
        .select('id')
        .single();

      if (error) throw error;

      if (selectedSectors.length > 0 && request) {
        await supabase.from('webinar_request_sectors').insert(
          selectedSectors.map((sector_id) => ({ request_id: request.id, sector_id }))
        );
      }

      toast({
        title: 'Webinar request submitted!',
        description: 'Our team will review your proposal and get back to you.',
      });
      navigate('/account?tab=webinars');
    } catch (err: unknown) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'An error occurred.',
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

  // Not logged in, not verified, or org not verified
  if (!user || !isVerified || organization?.access_status !== 'verified') {
    return (
      <div className="container mx-auto px-4 py-16 max-w-lg text-center">
        <Lock className="h-12 w-12 mx-auto text-gray-300 mb-4" />
        <h1 className="text-2xl font-bold text-gray-800 mb-2">Members Only</h1>
        <p className="text-gray-500 mb-6">
          {!user
            ? 'Please log in to propose a webinar topic.'
            : 'Your account must be verified to submit a webinar request.'}
        </p>
        {!user && (
          <Button onClick={() => navigate('/')}>Go to Homepage</Button>
        )}
        {user && !isVerified && (
          <Button onClick={() => navigate('/account')}>View Account Status</Button>
        )}
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-2xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-primary mb-2">Propose a Webinar</h1>
        <p className="text-gray-600">
          Suggest a topic or expert you'd like to see featured in an M3 Connect webinar.
          Our team will review your proposal and notify you.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Webinar Details</CardTitle>
            <CardDescription>Tell us what you'd like to explore</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <Label>Topic / Title *</Label>
              <Input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                required
                placeholder="e.g. Sustainable shore power solutions for marinas"
              />
            </div>

            <div className="space-y-2">
              <Label>Description *</Label>
              <Textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                required
                rows={5}
                placeholder="Describe the topic, why it matters to the marina industry, any specific questions you'd like answered, or experts you'd like to hear from..."
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Preferred Language</Label>
                <Select
                  value={form.preferred_language}
                  onValueChange={(v) => setForm({ ...form, preferred_language: v })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="EN">English</SelectItem>
                    <SelectItem value="FR">Français</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Preferred Timeframe</Label>
                <Input
                  value={form.preferred_timeframe}
                  onChange={(e) => setForm({ ...form, preferred_timeframe: e.target.value })}
                  placeholder="e.g. Q3 2026, Autumn 2026"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Related Sectors</CardTitle>
            <CardDescription>Select the sectors most relevant to this webinar topic</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-2 max-h-60 overflow-y-auto border rounded-lg p-3">
              {sectors.map((s) => (
                <div key={s.id} className="flex items-center space-x-2">
                  <Checkbox
                    id={`ws-${s.id}`}
                    checked={selectedSectors.includes(s.id)}
                    onCheckedChange={() => toggleSector(s.id)}
                  />
                  <Label htmlFor={`ws-${s.id}`} className="text-sm cursor-pointer font-normal">
                    {s.label}
                  </Label>
                </div>
              ))}
            </div>
            {sectors.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-4">Loading sectors...</p>
            )}
          </CardContent>
        </Card>

        <Button type="submit" className="w-full" size="lg" disabled={loading}>
          {loading
            ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Submitting...</>
            : <><CheckCircle className="h-4 w-4 mr-2" />Submit Webinar Request</>
          }
        </Button>
      </form>
    </div>
  );
}
