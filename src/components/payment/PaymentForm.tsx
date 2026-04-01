/**
 * PaymentForm — SogeCommerce / Lyra Embedded Payment Form
 *
 * Uses @lyracom/embedded-form-glue to render a PCI-compliant card iframe.
 * The CDN scripts must be loaded in index.html before this component is used.
 *
 * Props:
 * - amountCents: amount in cents (e.g., 50000 for €500)
 * - paymentType: 'membership' | 'additional_seats' | 'event_participation'
 * - organizationId: optional org ID
 * - referenceId: optional reference (event_registration ID, etc.)
 * - onSuccess: callback when payment completes
 * - onError: callback on failure
 * - metadata: optional extra metadata
 */
import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, CreditCard, CheckCircle, AlertCircle } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';

// Public key for the embedded form — loaded from env or demo default
const LYRA_PUBLIC_KEY = import.meta.env.VITE_LYRA_PUBLIC_KEY || '69876357:testpublickey_DEMOPUBLICKEY95me92597fd28tGD4r5';

interface PaymentFormProps {
  amountCents: number;
  paymentType: 'membership' | 'additional_seats' | 'event_participation';
  organizationId?: string;
  referenceId?: string;
  onSuccess?: (paymentId: string) => void;
  onError?: (error: string) => void;
  metadata?: Record<string, string>;
  label?: string;
  description?: string;
}

type PaymentStatus = 'idle' | 'loading' | 'ready' | 'processing' | 'success' | 'error';

export function PaymentForm({
  amountCents,
  paymentType,
  organizationId,
  referenceId,
  onSuccess,
  onError,
  metadata = {},
  label,
  description,
}: PaymentFormProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [status, setStatus] = useState<PaymentStatus>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const formRef = useRef<HTMLDivElement>(null);
  const formInitialized = useRef(false);

  const initPayment = async () => {
    if (!user) return;
    setStatus('loading');
    setErrorMsg('');

    try {
      // 1. Get form token from our Edge Function
      const { data, error } = await supabase.functions.invoke('create-payment', {
        body: {
          amount_cents: amountCents,
          currency: 'EUR',
          payment_type: paymentType,
          user_id: user.id,
          organization_id: organizationId,
          reference_id: referenceId,
          metadata,
        },
      });

      if (error) throw new Error(error.message || 'Failed to create payment');
      if (!data?.formToken) throw new Error('No form token received');

      setPaymentId(data.paymentId);

      // 2. Initialize the embedded form using KR global (loaded via CDN)
      const KR = (window as unknown as Record<string, unknown>).KR as {
        setFormConfig: (config: Record<string, unknown>) => Promise<unknown>;
        addForm: (selector: string) => Promise<{ KR: unknown }>;
        showForm: (token: string) => Promise<unknown>;
        onSubmit: (cb: (response: Record<string, unknown>) => void) => void;
        onError: (cb: (error: Record<string, unknown>) => void) => void;
      } | undefined;

      if (!KR) {
        throw new Error('Payment form scripts not loaded. Please refresh the page.');
      }

      await KR.setFormConfig({
        'kr-public-key': LYRA_PUBLIC_KEY,
        'kr-language': 'en-US',
      });

      // Mount the form in our div
      if (formRef.current) {
        formRef.current.innerHTML = '';
        const formEl = document.createElement('div');
        formEl.className = 'kr-embedded';
        formEl.setAttribute('kr-form-token', data.formToken);
        formRef.current.appendChild(formEl);
      }

      await KR.addForm('#payment-form-container .kr-embedded');

      // Handle success
      KR.onSubmit((response: Record<string, unknown>) => {
        const clientAnswer = response.clientAnswer as Record<string, unknown> | undefined;
        const orderStatus = clientAnswer?.orderStatus as string;
        if (orderStatus === 'PAID') {
          setStatus('success');
          onSuccess?.(data.paymentId);
        } else {
          setStatus('error');
          setErrorMsg(`Payment not completed (status: ${orderStatus})`);
          onError?.(`Payment status: ${orderStatus}`);
        }
      });

      // Handle errors
      KR.onError((error: Record<string, unknown>) => {
        const detailedMessage = (error.errorMessage as string) || 'Payment error occurred';
        setStatus('error');
        setErrorMsg(detailedMessage);
        onError?.(detailedMessage);
      });

      setStatus('ready');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to initialize payment';
      setStatus('error');
      setErrorMsg(msg);
      onError?.(msg);
    }
  };

  useEffect(() => {
    if (formInitialized.current) return;
    formInitialized.current = true;
    initPayment();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const amountDisplay = `€${(amountCents / 100).toFixed(2)}`;

  if (status === 'success') {
    return (
      <Card className="border-green-200 bg-green-50">
        <CardContent className="p-6 text-center">
          <CheckCircle className="h-12 w-12 text-green-600 mx-auto mb-3" />
          <h3 className="text-lg font-semibold text-green-800 mb-1">
            {t('payment.success', 'Payment Successful')}
          </h3>
          <p className="text-sm text-green-600">
            {t('payment.successDesc', 'Your payment of {{amount}} has been processed.', { amount: amountDisplay })}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CreditCard className="h-5 w-5" />
          {label || t('payment.title', 'Secure Payment')}
        </CardTitle>
        <CardDescription>
          {description || t('payment.description', 'Pay securely via credit card. Amount: {{amount}}', { amount: amountDisplay })}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {status === 'loading' && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-primary mr-3" />
            <span className="text-gray-600">{t('payment.loading', 'Initializing secure payment...')}</span>
          </div>
        )}

        {status === 'error' && (
          <div className="text-center py-6">
            <AlertCircle className="h-10 w-10 text-red-500 mx-auto mb-3" />
            <p className="text-red-600 font-medium mb-2">{t('payment.error', 'Payment Error')}</p>
            <p className="text-sm text-gray-600 mb-4">{errorMsg}</p>
            <Button variant="outline" onClick={() => { formInitialized.current = false; initPayment(); }}>
              {t('payment.retry', 'Try Again')}
            </Button>
          </div>
        )}

        {/* The Lyra embedded form will be injected here */}
        <div
          id="payment-form-container"
          ref={formRef}
          className={status === 'ready' ? '' : 'hidden'}
        />

        {status === 'ready' && (
          <div className="mt-4 flex items-center gap-2 text-xs text-gray-500">
            <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
            </svg>
            {t('payment.secured', 'Secured by SogeCommerce (Société Générale)')}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
