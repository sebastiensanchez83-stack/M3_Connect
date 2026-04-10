import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { supabase } from '@/lib/supabase';
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

type State =
  | { kind: 'form' }
  | { kind: 'submitting' }
  | { kind: 'success'; already: boolean; partnerName?: string; projectName?: string }
  | { kind: 'error'; code: string };

export function ReferenceRejectPage() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const ref = params.get('ref') || '';
  const [reason, setReason] = useState('');
  const [state, setState] = useState<State>(token && ref ? { kind: 'form' } : { kind: 'error', code: 'missing_params' });

  async function submit() {
    setState({ kind: 'submitting' });
    const { data, error } = await supabase.rpc('reject_reference_by_token', {
      p_reference_id: ref,
      p_token: token,
      p_reason: reason.trim() || null,
    });
    if (error) {
      setState({ kind: 'error', code: 'server_error' });
      return;
    }
    const payload = data as { ok: boolean; already?: boolean; error?: string; partner_name?: string; project_name?: string };
    if (payload?.ok) {
      setState({ kind: 'success', already: !!payload.already, partnerName: payload.partner_name, projectName: payload.project_name });
    } else {
      setState({ kind: 'error', code: payload?.error || 'unknown' });
    }
  }

  return (
    <div className="min-h-[70vh] bg-gray-50 flex items-center justify-center px-4 py-12">
      <Helmet>
        <title>Reference Rejection — Smart Marina Connect</title>
      </Helmet>
      <div className="bg-white rounded-xl shadow-sm border max-w-lg w-full p-8">
        {state.kind === 'form' && (
          <>
            <h1 className="text-xl font-semibold text-gray-900 mb-3 text-center">Reject this reference</h1>
            <p className="text-sm text-gray-600 mb-6 text-center">
              You are about to decline the recommendation request. You may optionally provide a reason below.
              This action is final and cannot be undone.
            </p>
            <label className="block text-sm font-medium text-gray-700 mb-1">Reason (optional)</label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. I am not the right person to confirm this, the project details are inaccurate, etc."
              rows={4}
              className="mb-4"
            />
            <div className="flex gap-3">
              <Button variant="destructive" className="flex-1" onClick={submit}>
                Confirm rejection
              </Button>
              <Link to="/" className="flex-1">
                <Button variant="outline" className="w-full">Cancel</Button>
              </Link>
            </div>
          </>
        )}
        {state.kind === 'submitting' && (
          <div className="text-center">
            <Loader2 className="h-10 w-10 text-primary animate-spin mx-auto mb-4" />
            <p className="text-sm text-gray-500">Submitting your rejection…</p>
          </div>
        )}
        {state.kind === 'success' && (
          <div className="text-center">
            <CheckCircle2 className="h-12 w-12 text-gray-600 mx-auto mb-4" />
            <h1 className="text-2xl font-bold text-gray-900 mb-3">
              {state.already ? 'Already rejected' : 'Reference rejected'}
            </h1>
            <p className="text-gray-600">
              Your rejection has been recorded
              {state.partnerName ? <> for <strong>{state.partnerName}</strong></> : null}
              {state.projectName ? <> regarding the project <strong>{state.projectName}</strong></> : null}.
            </p>
            <p className="text-sm text-gray-500 mt-4">
              Thank you for your response. You can safely close this page.
            </p>
            <Link to="/" className="inline-block mt-6 text-primary hover:underline text-sm">
              Back to Smart Marina Connect
            </Link>
          </div>
        )}
        {state.kind === 'error' && (
          <div className="text-center">
            <XCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
            <h1 className="text-xl font-semibold text-gray-900 mb-3">{errorTitle(state.code)}</h1>
            <p className="text-sm text-gray-600">{errorMessage(state.code)}</p>
            <Link to="/" className="inline-block mt-6 text-primary hover:underline text-sm">
              Back to Smart Marina Connect
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

function errorTitle(code: string): string {
  switch (code) {
    case 'missing_params': return 'Invalid link';
    case 'invalid_token': return 'Invalid or expired link';
    case 'reference_not_found': return 'Reference not found';
    case 'expired': return 'Link expired';
    case 'already_confirmed': return 'Already confirmed';
    default: return 'Something went wrong';
  }
}

function errorMessage(code: string): string {
  switch (code) {
    case 'missing_params':
      return 'This rejection link is missing required parameters. Please use the link from the email you received.';
    case 'invalid_token':
      return 'The token in this link is invalid. It may have been tampered with. Please use the original link from your email.';
    case 'reference_not_found':
      return 'We could not find the reference this link refers to. Please contact support if you believe this is an error.';
    case 'expired':
      return 'This reference link has expired. Please contact the partner who requested the reference.';
    case 'already_confirmed':
      return 'This reference has already been confirmed and cannot be rejected.';
    default:
      return 'An unexpected error occurred while processing your rejection. Please try again later or contact support.';
  }
}
