import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { BTN, BTN_OUTLINE } from '@/components/member/MemberUI';
import {
  ReferenceBackLink, ReferenceBody, ReferenceCard, ReferenceFacts, ReferencePage, toneForCode,
} from '@/components/references/ReferenceTokenShell';
import { cn } from '@/lib/utils';

// Opened from the e-mail a marina contact receives: declines the recommendation
// request. Unlike the confirmation, this one asks first (a rejection is final).

type State =
  | { kind: 'form' }
  | { kind: 'submitting' }
  | { kind: 'success'; already: boolean; partnerName?: string; projectName?: string }
  | { kind: 'error'; code: string };

const EYEBROW = 'Reference rejection';

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
    <ReferencePage metaTitle="Reference Rejection — Smart Marina Connect">
      {state.kind === 'form' && (
        <ReferenceCard eyebrow={EYEBROW} tone="neutral" title="Reject this reference">
          <ReferenceBody>
            <p>
              You are about to decline the recommendation request. You may optionally provide a reason below.
              This action is final and cannot be undone.
            </p>
          </ReferenceBody>
          <div className="mt-6 space-y-1.5 text-left">
            <Label htmlFor="reject-reason" className="text-[14px] font-medium text-ink">Reason (optional)</Label>
            <Textarea
              id="reject-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. I am not the right person to confirm this, the project details are inaccurate, etc."
              rows={4}
              className="rounded-field"
            />
          </div>
          <div className="mt-5 flex flex-col gap-3 sm:flex-row">
            <Button variant="destructive" className={cn(BTN, 'sm:flex-1')} onClick={submit}>
              Confirm rejection
            </Button>
            <Button asChild variant="outline" className={cn(BTN_OUTLINE, 'sm:flex-1')}>
              <Link to="/">Cancel</Link>
            </Button>
          </div>
        </ReferenceCard>
      )}
      {state.kind === 'submitting' && (
        <div role="status">
          <ReferenceCard eyebrow={EYEBROW} tone="loading" title="Submitting your rejection…">
            <ReferenceBody><p>Please wait a moment.</p></ReferenceBody>
          </ReferenceCard>
        </div>
      )}
      {state.kind === 'success' && (
        <ReferenceCard eyebrow={EYEBROW} tone="neutral" title={state.already ? 'Already rejected' : 'Reference rejected'} focusTitle>
          <ReferenceBody>
            <p>Your rejection has been recorded{state.partnerName || state.projectName ? ':' : '.'}</p>
          </ReferenceBody>
          <ReferenceFacts partnerName={state.partnerName} projectName={state.projectName} />
          <ReferenceBody>
            <p>Thank you for your response. You can safely close this page.</p>
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
      return 'We could not find the reference this link refers to. Please contact the M3 team if you believe this is an error.';
    case 'expired':
      return 'This reference link has expired. Please contact the service provider who requested the reference.';
    case 'already_confirmed':
      return 'This reference has already been confirmed and cannot be rejected.';
    default:
      return 'An unexpected error occurred while processing your rejection. Please try again later or contact the M3 team.';
  }
}
