import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import {
  ReferenceBackLink, ReferenceBody, ReferenceCard, ReferenceFacts, ReferencePage, toneForCode,
} from '@/components/references/ReferenceTokenShell';

// Opened from the e-mail a marina contact receives: confirms the recommendation
// on arrival (the link IS the confirmation) and says what happened.

type State =
  | { kind: 'loading' }
  | { kind: 'success'; already: boolean; partnerName?: string; projectName?: string }
  | { kind: 'error'; code: string };

const EYEBROW = 'Reference confirmation';

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
    <ReferencePage metaTitle="Reference Confirmation — Smart Marina Connect">
      {state.kind === 'loading' && (
        <div role="status">
          <ReferenceCard eyebrow={EYEBROW} tone="loading" title="Confirming your recommendation…">
            <ReferenceBody><p>Please wait a moment.</p></ReferenceBody>
          </ReferenceCard>
        </div>
      )}
      {state.kind === 'success' && (
        <ReferenceCard
          eyebrow={EYEBROW}
          tone="success"
          title={state.already ? 'Already confirmed' : 'Thank you — reference confirmed'}
          focusTitle
        >
          <ReferenceBody>
            <p>You have confirmed the client recommendation{state.partnerName || state.projectName ? ':' : '.'}</p>
          </ReferenceBody>
          <ReferenceFacts partnerName={state.partnerName} projectName={state.projectName} />
          <ReferenceBody>
            <p>No further action is required. You can safely close this page.</p>
          </ReferenceBody>
          <ReferenceBackLink />
        </ReferenceCard>
      )}
      {state.kind === 'error' && (
        <ReferenceCard eyebrow={EYEBROW} tone={toneForCode(state.code)} title={errorTitle(state.code)} focusTitle>
          <ReferenceBody><p>{errorMessage(state.code)}</p></ReferenceBody>
          <ReferenceBackLink contact />
        </ReferenceCard>
      )}
    </ReferencePage>
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
      return 'We could not find the reference this link refers to. Please contact the M3 team if you believe this is an error.';
    case 'expired':
      return 'This reference confirmation link has expired. Please contact the service provider who requested the reference.';
    case 'already_rejected':
      return 'This reference has already been rejected and cannot be confirmed.';
    default:
      return 'An unexpected error occurred while processing your confirmation. Please try again later or contact the M3 team.';
  }
}
