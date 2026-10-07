import { useState, type ComponentProps, type FormEvent, type ReactNode } from 'react';
import { CheckCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ContactFailure, Honeypot } from '@/components/contact/ContactParts';
import { currentSource, submitContact, type ContactResult } from '@/lib/contactSubmit';
import { useAuth } from '@/contexts/AuthContext';
import { registerFlowsStrings } from '@/i18n/refonte-flows';
import { cn } from '@/lib/utils';

registerFlowsStrings();

const FIELD = 'h-12 rounded-field border-checkbox bg-white px-4 text-base';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * "Claim this page" / "Is your marina already listed?": a button that opens a
 * small dialog (name, e-mail, role or job title, an optional message) and sends
 * the request to the M3 team through the contact-submit function (subject
 * "general", the page path as source, a message that starts with
 * "Claim request: <organisation> (<slug>)"). "Request sent" is shown only when
 * the function answers { ok: true }; any other answer is said out loud, with the
 * public e-mail address next to it.
 *
 * With `organization` the request is about that page. Without it (the
 * directory's general card) the dialog also asks which marina.
 */
export function ClaimRequestButton({
  organization,
  children,
  variant = 'ctaWhite',
  size,
  className,
}: {
  organization?: { name: string; slug: string };
  children: ReactNode;
  variant?: ComponentProps<typeof Button>['variant'];
  size?: ComponentProps<typeof Button>['size'];
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant={variant} size={size} className={className} onClick={() => setOpen(true)} aria-haspopup="dialog">
        {children}
      </Button>
      {open && <ClaimDialog organization={organization} onClose={() => setOpen(false)} />}
    </>
  );
}

function ClaimDialog({ organization, onClose }: { organization?: { name: string; slug: string }; onClose: () => void }) {
  const { t } = useTranslation();
  const { user, profile } = useAuth();
  const [name, setName] = useState(() => [profile?.first_name, profile?.last_name].filter(Boolean).join(' '));
  const [email, setEmail] = useState(() => user?.email ?? '');
  const [role, setRole] = useState('');
  const [orgName, setOrgName] = useState('');
  const [note, setNote] = useState('');
  const [website, setWebsite] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<Exclude<ContactResult, { ok: true }>['reason'] | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const subjectName = organization?.name ?? orgName.trim();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (sending) return;
    if (!organization && !subjectName) { setError(t('flows.claim.errorOrg')); return; }
    if (!name.trim() || !email.trim() || !role.trim()) { setError(t('flows.claim.errorRequired')); return; }
    if (!EMAIL_PATTERN.test(email.trim())) { setError(t('flows.claim.errorEmail')); return; }
    setError(null);
    setFailure(null);
    setSending(true);
    const label = `Claim request: ${subjectName}${organization ? ` (${organization.slug})` : ''}`;
    const result = await submitContact({
      name,
      email,
      company: subjectName,
      subject: 'general',
      message: [label, `Role: ${role.trim()}`, note.trim()].filter(Boolean).join('\n\n'),
      source: currentSource(),
      website,
    });
    setSending(false);
    if (!result.ok) { setFailure(result.reason); return; }
    setSent(true);
  };

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-[520px]">
        {sent ? (
          <div role="status" className="py-4 text-center">
            <span aria-hidden="true" className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-pill bg-foam text-teal-text">
              <CheckCircle className="h-7 w-7" />
            </span>
            <DialogTitle className="text-xl leading-7 text-navy">{t('flows.claim.successTitle')}</DialogTitle>
            <DialogDescription className="mx-auto mt-3 max-w-sm text-base leading-6 text-ink">
              {t('flows.claim.successBody')}
            </DialogDescription>
            <Button type="button" variant="ctaNavy" className="mt-6" arrow={false} roll={false} onClick={onClose}>
              {t('flows.claim.close')}
            </Button>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="text-xl leading-7 text-navy">
                {organization ? t('flows.claim.titleOrg', { name: organization.name }) : t('flows.claim.titleGeneric')}
              </DialogTitle>
              <DialogDescription className="text-[15px] leading-6 text-ink">{t('flows.claim.intro')}</DialogDescription>
            </DialogHeader>
            <form onSubmit={submit} noValidate className="space-y-4" aria-describedby={error ? 'claim-error' : undefined}>
              {!organization && (
                <div className="space-y-2">
                  <Label htmlFor="claim-org" className="text-sm font-semibold text-navy">{t('flows.claim.orgName')} <span aria-hidden="true" className="text-red-700">*</span></Label>
                  <Input id="claim-org" className={FIELD} maxLength={160} autoComplete="organization" placeholder={t('flows.claim.orgNamePlaceholder')} value={orgName} onChange={(e) => setOrgName(e.target.value)} />
                </div>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="claim-name" className="text-sm font-semibold text-navy">{t('flows.claim.name')} <span aria-hidden="true" className="text-red-700">*</span></Label>
                  <Input id="claim-name" className={FIELD} maxLength={120} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="claim-email" className="text-sm font-semibold text-navy">{t('flows.claim.email')} <span aria-hidden="true" className="text-red-700">*</span></Label>
                  <Input id="claim-email" type="email" className={FIELD} autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="claim-role" className="text-sm font-semibold text-navy">{t('flows.claim.role')} <span aria-hidden="true" className="text-red-700">*</span></Label>
                <Input id="claim-role" className={FIELD} maxLength={120} autoComplete="organization-title" value={role} onChange={(e) => setRole(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="claim-note" className="text-sm font-semibold text-navy">
                  {t('flows.claim.message')} <span className="font-normal text-meta">({t('flows.contact.optional')})</span>
                </Label>
                <Textarea
                  id="claim-note"
                  rows={3}
                  maxLength={2000}
                  placeholder={t('flows.claim.messagePlaceholder')}
                  className="rounded-field border-checkbox bg-white px-4 py-3 text-base"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>

              <Honeypot value={website} onChange={setWebsite} />

              {error && <p id="claim-error" role="alert" className="text-sm font-medium text-red-700">{error}</p>}
              {failure && <ContactFailure reason={failure} />}

              <div className={cn('flex flex-wrap items-center gap-3 pt-1')}>
                <Button type="submit" variant="cta" size="sm" disabled={sending} arrow={!sending} roll={!sending}>
                  {sending ? t('flows.claim.sending') : t('flows.claim.submit')}
                </Button>
                <Button type="button" variant="ghost" onClick={onClose}>
                  {t('flows.claim.cancel')}
                </Button>
              </div>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
