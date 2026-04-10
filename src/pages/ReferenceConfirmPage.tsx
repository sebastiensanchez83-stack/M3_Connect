import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { supabase } from '@/lib/supabase';
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react';

type State =
  | { kind: 'loading' }
  | { kind: 'success'; already: boolean; partnerName?: string; projectName?: string }
  | { kind: 'error'; code: string };

export function ReferenceConfirmPage() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const ref = params.get('ref') || '';
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!token || !ref) {
        setState({ kind: 'error', code: 'missing_params' });
        return;
      }
      const { data, error } = await supabase.rpc('confirm_reference_by_token', {
        p_reference_id: ref,
        p_token: token,
      });
      if (cancelled) return;
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
    })();
    return () => { cancelled = true; };
  }, [token, ref]);

  return (
    <div className="min-h-[70vh] bg-gray-50 flex items-center justify-center px-4 py-12">
      <Helmet>
        <title>Reference Confirmation — Smart Marina Connect</title>
      </Helmet>
      <div className="bg-white rounded-xl shadow-sm border max-w-lg w-full p-8 text-center">
        {state.kind === 'loading' && (
          <>
            <Loader2 className="h-10 w-10 text-primary animate-spin mx-auto mb-4" />
            <h1 className="text-xl font-semibold text-gray-900 mb-2">Confirming your recommendation…</h1>
            <p className="text-sm text-gray-500">Please wait a moment.</p>
          </>
        )}
        {state.kind === 'success' && (
          <>
            <CheckCircle2 className="h-12 w-12 text-green-600 mx-auto mb-4" />
            <h1 className="text-2xl font-bold text-gray-900 mb-3">
              {state.already ? 'Already confirmed' : 'Thank you — reference confirmed'}
            </h1>
            <p className="text-gray-600 mb-2">
              You have confirmed the client recommendation
              {state.partnerName ? <> for <strong>{state.partnerName}</strong></> : null}
              {state.projectName ? <> regarding the project <strong>{state.projectName}</strong></> : null}.
            </p>
            <p className="text-sm text-gray-500 mt-4">
              No further action is required. You can safely close this page.
            </p>
            <Link to="/" className="inline-block mt-6 text-primary hover:underline text-sm">
              Back to Smart Marina Connect
            </Link>
          </>
        )}
        {state.kind === 'error' && (
          <>
            <XCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
            <h1 className="text-xl font-semibold text-gray-900 mb-3">
              {errorTitle(state.code)}
            </h1>
            <p className="text-sm text-gray-600">{errorMessage(state.code)}</p>
            <Link to="/" className="inline-block mt-6 text-primary hover:underline text-sm">
              Back to Smart Marina Connect
            </Link>
          </>
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
    case 'already_rejected': return 'Already rejected';
    default: return 'Something went wrong';
  }
}

function errorMessage(code: string): string {
  switch (code) {
    case 'missing_params':
      return 'This confirmation link is missing required parameters. Please use the link from the email you received.';
    case 'invalid_token':
      return 'The token in this link is invalid. It may have been tampered with or already superseded. Please use the original link from your email.';
    case 'reference_not_found':
      return 'We could not find the reference this link refers to. Please contact support if you believe this is an error.';
    case 'expired':
      return 'This reference confirmation link has expired. Please contact the partner who requested the reference.';
    case 'already_rejected':
      return 'This reference has already been rejected and cannot be confirmed.';
    default:
      return 'An unexpected error occurred while processing your confirmation. Please try again later or contact support.';
  }
}
