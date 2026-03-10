import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import {
  FileText, Send, Loader2, Plus, Trash2, CheckCircle, AlertCircle, Globe, User, Briefcase, MapPin, Calendar,
} from 'lucide-react';

interface Recipient {
  email: string;
  first_name: string;
  last_name: string;
  job_title: string;
}

export function ReferenceRequestForm() {
  const { user, organization } = useAuth();
  const [saving, setSaving] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [submitted, setSubmitted] = useState(false);

  // Client info
  const [clientForm, setClientForm] = useState({
    legal_name: '',
    country: '',
    website: '',
    primary_domain: '',
  });

  // Project info
  const [projectForm, setProjectForm] = useState({
    project_name: '',
    project_location: '',
    project_start_date: '',
    project_end_date: '',
    project_delivery_date: '',
    contract_reference: '',
    solution_product: '',
    scope_description: '',
    results_summary: '',
    key_kpis: '',
  });

  // Recommendation
  const [recommendationStatement, setRecommendationStatement] = useState('');

  // Recipients
  const [recipients, setRecipients] = useState<Recipient[]>([
    { email: '', first_name: '', last_name: '', job_title: '' },
  ]);

  const addRecipient = () => {
    setRecipients([...recipients, { email: '', first_name: '', last_name: '', job_title: '' }]);
  };

  const removeRecipient = (index: number) => {
    if (recipients.length <= 1) return;
    setRecipients(recipients.filter((_, i) => i !== index));
  };

  const updateRecipient = (index: number, field: keyof Recipient, value: string) => {
    setRecipients(recipients.map((r, i) => i === index ? { ...r, [field]: value } : r));
  };

  // Auto-extract domain from website
  const handleWebsiteChange = (website: string) => {
    setClientForm((prev) => {
      const updated = { ...prev, website };
      try {
        const url = new URL(website.startsWith('http') ? website : `https://${website}`);
        updated.primary_domain = url.hostname.replace(/^www\./, '');
      } catch {
        // Invalid URL, don't update domain
      }
      return updated;
    });
  };

  const handleSubmit = async () => {
    if (!organization?.id || !user?.id) return;

    // Validate
    if (!clientForm.legal_name || !clientForm.primary_domain) {
      toast({ title: 'Missing info', description: 'Client name and domain are required.', variant: 'destructive' });
      return;
    }
    if (!projectForm.project_name) {
      toast({ title: 'Missing info', description: 'Project name is required.', variant: 'destructive' });
      return;
    }
    if (!recommendationStatement) {
      toast({ title: 'Missing info', description: 'Recommendation statement is required.', variant: 'destructive' });
      return;
    }
    const validRecipients = recipients.filter((r) => r.email);
    if (validRecipients.length === 0) {
      toast({ title: 'Missing info', description: 'At least one recipient email is required.', variant: 'destructive' });
      return;
    }

    setSaving(true);
    try {
      // Create client organization
      const { data: clientOrg, error: clientErr } = await supabase
        .from('client_organizations')
        .insert({
          legal_name: clientForm.legal_name,
          country: clientForm.country,
          website: clientForm.website,
          primary_domain: clientForm.primary_domain,
          created_by: user.id,
        })
        .select('id')
        .single();

      if (clientErr) throw clientErr;

      // Create reference request via RPC
      const { data: refReq, error: refErr } = await supabase.rpc('create_reference_request', {
        p_partner_org_id: organization.id,
        p_created_by: user.id,
        p_client_legal_name: clientForm.legal_name,
        p_client_country: clientForm.country || null,
        p_client_website: clientForm.website || null,
        p_client_primary_domain: clientForm.primary_domain,
        p_project_name: projectForm.project_name,
        p_project_location: projectForm.project_location || null,
        p_project_start_date: projectForm.project_start_date || null,
        p_project_end_date: projectForm.project_end_date || null,
        p_project_delivery_date: projectForm.project_delivery_date || null,
        p_contract_reference: projectForm.contract_reference || null,
        p_solution_product: projectForm.solution_product || null,
        p_scope_description: projectForm.scope_description || null,
        p_results_summary: projectForm.results_summary || null,
        p_key_kpis: projectForm.key_kpis || null,
        p_recommendation_statement: recommendationStatement,
      });

      if (refErr) throw refErr;

      // Update the reference request with client_organization_id
      await supabase
        .from('reference_requests')
        .update({ client_organization_id: clientOrg.id })
        .eq('id', refReq.id);

      // Send emails via edge function
      const { data: { session } } = await supabase.auth.getSession();
      const emailResponse = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL || 'https://djjbgzasuomhyfvtlidi.supabase.co'}/functions/v1/send-reference-email`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session?.access_token}`,
          },
          body: JSON.stringify({
            reference_request_id: refReq.id,
            recipients: validRecipients,
          }),
        }
      );

      if (!emailResponse.ok) {
        const errData = await emailResponse.json();
        console.warn('Email sending issue:', errData);
      }

      setSubmitted(true);
      toast({ title: 'Reference request created', description: `Reference ID: ${refReq.reference_id}` });
    } catch (err: any) {
      console.error(err);
      toast({
        title: 'Error',
        description: err.message || 'Failed to create reference request',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  if (submitted) {
    return (
      <Card className="border-green-200 bg-green-50">
        <CardContent className="pt-6 text-center">
          <CheckCircle className="h-12 w-12 text-green-600 mx-auto mb-4" />
          <h3 className="text-xl font-bold text-green-900 mb-2">Reference Request Submitted</h3>
          <p className="text-green-700 mb-4">
            Your reference request has been created and confirmation emails are being sent to the recipients.
            You will be notified when they respond.
          </p>
          <Button variant="outline" onClick={() => {
            setSubmitted(false);
            setStep(1);
            setClientForm({ legal_name: '', country: '', website: '', primary_domain: '' });
            setProjectForm({
              project_name: '', project_location: '', project_start_date: '', project_end_date: '',
              project_delivery_date: '', contract_reference: '', solution_product: '', scope_description: '',
              results_summary: '', key_kpis: '',
            });
            setRecommendationStatement('');
            setRecipients([{ email: '', first_name: '', last_name: '', job_title: '' }]);
          }}>
            Submit Another Reference
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card className="border-primary/20">
        <CardContent className="pt-6">
          <div className="flex items-start gap-4">
            <div className="p-3 bg-primary/10 rounded-xl">
              <FileText className="h-8 w-8 text-primary" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-gray-900 mb-1">Client Reference Request</h2>
              <p className="text-gray-600">
                Submit a client reference to strengthen your partner profile. An email will be sent to your client contact
                for independent confirmation.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Progress steps */}
      <div className="flex items-center gap-2 px-2">
        {[1, 2, 3].map((s) => (
          <div key={s} className="flex items-center gap-2 flex-1">
            <button
              onClick={() => setStep(s as 1 | 2 | 3)}
              className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-all ${
                step === s ? 'bg-primary text-white' : step > s ? 'bg-green-500 text-white' : 'bg-gray-200 text-gray-500'
              }`}
            >
              {step > s ? '✓' : s}
            </button>
            <span className={`text-sm ${step === s ? 'font-semibold text-gray-900' : 'text-gray-500'}`}>
              {s === 1 ? 'Client Info' : s === 2 ? 'Project Details' : 'Recipient & Send'}
            </span>
            {s < 3 && <div className="flex-1 h-px bg-gray-200 mx-2" />}
          </div>
        ))}
      </div>

      {/* Step 1: Client Info */}
      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Globe className="h-5 w-5 text-primary" />
              Client Organization
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>Company Name *</Label>
                <Input
                  value={clientForm.legal_name}
                  onChange={(e) => setClientForm({ ...clientForm, legal_name: e.target.value })}
                  placeholder="e.g. Marina Alpha Operations Ltd"
                />
              </div>
              <div>
                <Label>Country</Label>
                <Input
                  value={clientForm.country}
                  onChange={(e) => setClientForm({ ...clientForm, country: e.target.value })}
                  placeholder="e.g. France"
                />
              </div>
              <div>
                <Label>Website</Label>
                <Input
                  value={clientForm.website}
                  onChange={(e) => handleWebsiteChange(e.target.value)}
                  placeholder="e.g. https://marina-alpha.com"
                />
              </div>
              <div>
                <Label>Primary Domain *</Label>
                <Input
                  value={clientForm.primary_domain}
                  onChange={(e) => setClientForm({ ...clientForm, primary_domain: e.target.value })}
                  placeholder="e.g. marina-alpha.com"
                />
                <p className="text-xs text-gray-500 mt-1">
                  The recipient's email must match this domain for verification.
                </p>
              </div>
            </div>
            <div className="flex justify-end">
              <Button onClick={() => setStep(2)} disabled={!clientForm.legal_name || !clientForm.primary_domain}>
                Next: Project Details
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 2: Project Details + Recommendation */}
      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Briefcase className="h-5 w-5 text-primary" />
              Project & Recommendation
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>Project Name *</Label>
                <Input
                  value={projectForm.project_name}
                  onChange={(e) => setProjectForm({ ...projectForm, project_name: e.target.value })}
                  placeholder="e.g. Smart Access Control Implementation"
                />
              </div>
              <div>
                <Label>Location</Label>
                <Input
                  value={projectForm.project_location}
                  onChange={(e) => setProjectForm({ ...projectForm, project_location: e.target.value })}
                  placeholder="e.g. Antibes, France"
                />
              </div>
              <div>
                <Label>Start Date</Label>
                <Input
                  type="date"
                  value={projectForm.project_start_date}
                  onChange={(e) => setProjectForm({ ...projectForm, project_start_date: e.target.value })}
                />
              </div>
              <div>
                <Label>End Date</Label>
                <Input
                  type="date"
                  value={projectForm.project_end_date}
                  onChange={(e) => setProjectForm({ ...projectForm, project_end_date: e.target.value })}
                />
              </div>
              <div>
                <Label>Delivery / Go-Live Date</Label>
                <Input
                  type="date"
                  value={projectForm.project_delivery_date}
                  onChange={(e) => setProjectForm({ ...projectForm, project_delivery_date: e.target.value })}
                />
              </div>
              <div>
                <Label>Contract / PO Reference</Label>
                <Input
                  value={projectForm.contract_reference}
                  onChange={(e) => setProjectForm({ ...projectForm, contract_reference: e.target.value })}
                  placeholder="e.g. PO-ALPHA-2025-1187"
                />
              </div>
            </div>

            <div>
              <Label>Solution / Product</Label>
              <Input
                value={projectForm.solution_product}
                onChange={(e) => setProjectForm({ ...projectForm, solution_product: e.target.value })}
                placeholder="e.g. Smart Access Control + Visitor Management"
              />
            </div>

            <div>
              <Label>Scope Description</Label>
              <textarea
                value={projectForm.scope_description}
                onChange={(e) => setProjectForm({ ...projectForm, scope_description: e.target.value })}
                placeholder="Describe the project scope..."
                className="w-full min-h-[80px] resize-y rounded-lg border border-gray-200 bg-white p-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30"
              />
            </div>

            <div>
              <Label>Results Summary</Label>
              <textarea
                value={projectForm.results_summary}
                onChange={(e) => setProjectForm({ ...projectForm, results_summary: e.target.value })}
                placeholder="Describe the results and value delivered..."
                className="w-full min-h-[80px] resize-y rounded-lg border border-gray-200 bg-white p-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30"
              />
            </div>

            <div>
              <Label>Key KPIs</Label>
              <Input
                value={projectForm.key_kpis}
                onChange={(e) => setProjectForm({ ...projectForm, key_kpis: e.target.value })}
                placeholder="e.g. 99.8% uptime, 35% faster access"
              />
            </div>

            <div className="border-t pt-4">
              <Label className="text-base font-semibold">Recommendation Statement *</Label>
              <p className="text-sm text-gray-500 mb-2">
                Write the recommendation statement that will be presented to your client for confirmation.
              </p>
              <textarea
                value={recommendationStatement}
                onChange={(e) => setRecommendationStatement(e.target.value)}
                placeholder="We confirm that [Partner Name] delivered the above-described project with professionalism, quality and reliability..."
                className="w-full min-h-[100px] resize-y rounded-lg border border-primary/30 bg-green-50 p-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30"
              />
            </div>

            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep(1)}>Back</Button>
              <Button onClick={() => setStep(3)} disabled={!projectForm.project_name || !recommendationStatement}>
                Next: Recipient & Send
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 3: Recipients */}
      {step === 3 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Send className="h-5 w-5 text-primary" />
              Confirmation Recipients
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-amber-800">
                Recipients must have a professional email address matching the client domain (<strong>{clientForm.primary_domain}</strong>).
                Free email providers (Gmail, Outlook, etc.) are not accepted.
              </p>
            </div>

            {recipients.map((recipient, index) => (
              <div key={index} className="border rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold">Recipient {index + 1}</h4>
                  {recipients.length > 1 && (
                    <Button size="sm" variant="ghost" onClick={() => removeRecipient(index)}>
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </Button>
                  )}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Email *</Label>
                    <Input
                      type="email"
                      value={recipient.email}
                      onChange={(e) => updateRecipient(index, 'email', e.target.value)}
                      placeholder={`e.g. contact@${clientForm.primary_domain}`}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Job Title</Label>
                    <Input
                      value={recipient.job_title}
                      onChange={(e) => updateRecipient(index, 'job_title', e.target.value)}
                      placeholder="e.g. COO"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">First Name</Label>
                    <Input
                      value={recipient.first_name}
                      onChange={(e) => updateRecipient(index, 'first_name', e.target.value)}
                      placeholder="e.g. Marie"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Last Name</Label>
                    <Input
                      value={recipient.last_name}
                      onChange={(e) => updateRecipient(index, 'last_name', e.target.value)}
                      placeholder="e.g. Durand"
                    />
                  </div>
                </div>
              </div>
            ))}

            <Button variant="outline" size="sm" onClick={addRecipient}>
              <Plus className="h-4 w-4 mr-1" /> Add Recipient
            </Button>

            <div className="border-t pt-4 flex justify-between">
              <Button variant="outline" onClick={() => setStep(2)}>Back</Button>
              <Button
                onClick={handleSubmit}
                disabled={saving || !recipients.some((r) => r.email)}
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
                Submit Reference Request
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
