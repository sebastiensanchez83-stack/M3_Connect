import { useId, useRef, useState } from 'react';
import { Check, Copy, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SITE_URL, orgPath } from '@/lib/seoMeta';
import { cn } from '@/lib/utils';
import { BTN_TOUCH } from './EditKit';

/**
 * "Show you are a member": the badge a verified company can put on its own
 * website, linking to its company page here (Victor's "embeddable member
 * badge", approved 7 Oct, kept for before 13 Nov on 19 Oct).
 *
 *  - Two looks, light and dark (public/badges/member-light|dark.png, 448x128
 *    drawn for 224x64, plus .svg copies), shown as a preview on the matching
 *    background.
 *  - The HTML to paste: the image (absolute address on smartmarinaconnect.com,
 *    so it works from any site) in a link to the company page with
 *    rel="noopener" and UTM tags (utm_content = the company's slug, to tell in
 *    Analytics which member's site sent the visit).
 *  - Copy (clipboard, else the text is selected for Ctrl+C) and the image itself.
 *
 * Shown by CompanyPanel only when M3 has verified the company.
 */

type Look = 'light' | 'dark';

const LOOKS: { key: Look; label: string; hint: string }[] = [
  { key: 'light', label: 'Light', hint: 'For a white or light background' },
  { key: 'dark', label: 'Dark', hint: 'For a dark background' },
];

export const MEMBER_BADGE_SIZE = { width: 224, height: 64 } as const;

export function memberBadgeImage(look: Look, absolute = true): string {
  return `${absolute ? SITE_URL : ''}/badges/member-${look}.png`;
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** The company page with the badge's UTM tags. */
export function memberBadgeHref(slug: string): string {
  const q = new URLSearchParams({
    utm_source: 'member-badge',
    utm_medium: 'referral',
    utm_campaign: 'member-badge',
    utm_content: slug,
  });
  return `${SITE_URL}${orgPath(slug)}?${q.toString()}`;
}

export function memberBadgeSnippet(org: { slug: string; name: string }, look: Look): string {
  const { width, height } = MEMBER_BADGE_SIZE;
  return `<a href="${escapeAttr(memberBadgeHref(org.slug))}" target="_blank" rel="noopener" title="${escapeAttr(org.name)} on Smart Marina Connect">`
    + `<img src="${memberBadgeImage(look)}" alt="Member of Smart Marina Connect" width="${width}" height="${height}" style="border:0;"></a>`;
}

export function MemberBadgeCard({ org }: { org: { slug: string; name: string } }) {
  const [look, setLook] = useState<Look>('light');
  const [copied, setCopied] = useState(false);
  const codeRef = useRef<HTMLTextAreaElement>(null);
  const headingId = useId();
  const codeId = useId();
  const snippet = memberBadgeSnippet(org, look);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      // No clipboard (an old browser, a refused permission): select it for Ctrl+C.
      codeRef.current?.focus();
      codeRef.current?.select();
    }
  };

  return (
    <section aria-labelledby={headingId} className="rounded-card border border-rule bg-white px-4 py-4 sm:px-5 sm:py-5">
      <h3 id={headingId} className="text-[16px] font-semibold leading-6 text-navy">Show you are a member</h3>
      <p className="mt-1 max-w-[620px] text-[15px] leading-6 text-ink">
        Add the Smart Marina Connect badge to your website. It links to your company page here, so your visitors can see that M3 has checked your company.
      </p>

      <div role="radiogroup" aria-label="Badge colour" className="mt-4 inline-flex rounded-pill border border-rule bg-page p-1">
        {LOOKS.map((l) => (
          <button
            key={l.key}
            type="button"
            role="radio"
            aria-checked={look === l.key}
            title={l.hint}
            onClick={() => { setLook(l.key); setCopied(false); }}
            className={cn(
              'focus-ring min-h-10 rounded-pill px-4 text-[14px] font-medium transition-colors duration-200',
              look === l.key ? 'bg-navy text-white' : 'text-navy hover:bg-chip',
            )}
          >
            {l.label}
          </button>
        ))}
      </div>

      {/* The preview, on the kind of background it is made for. */}
      <div
        className={cn(
          'mt-4 flex items-center justify-center rounded-field px-4 py-6 ring-1 ring-inset',
          look === 'light' ? 'bg-page ring-rule' : 'bg-navy-deep ring-navy',
        )}
      >
        <img
          src={memberBadgeImage(look, false)}
          alt="Member of Smart Marina Connect"
          width={MEMBER_BADGE_SIZE.width}
          height={MEMBER_BADGE_SIZE.height}
          className="h-auto max-w-full"
        />
      </div>

      <label htmlFor={codeId} className="mt-4 block text-[14px] font-semibold text-navy">HTML to paste on your site</label>
      <textarea
        id={codeId}
        ref={codeRef}
        readOnly
        rows={4}
        value={snippet}
        onFocus={(e) => e.currentTarget.select()}
        className="mt-1.5 w-full resize-none rounded-field border border-rule bg-page px-3 py-2 font-mono text-[12px] leading-5 text-ink focus:outline-none focus-visible:shadow-focus"
      />

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" className={BTN_TOUCH} onClick={copy}>
          {copied ? <Check className="mr-1.5 h-4 w-4" aria-hidden="true" /> : <Copy className="mr-1.5 h-4 w-4" aria-hidden="true" />}
          {copied ? 'Copied' : 'Copy the code'}
        </Button>
        <a
          href={memberBadgeImage(look, false)}
          download={`smart-marina-connect-member-${look}.png`}
          className="focus-ring inline-flex min-h-11 items-center gap-1.5 rounded-field px-1 text-[15px] font-medium text-navy underline decoration-navy/30 underline-offset-4 hover:decoration-gold"
        >
          <Download className="h-4 w-4" aria-hidden="true" />
          Download the image
        </a>
        <span aria-live="polite" className="sr-only">{copied ? 'The code is copied.' : ''}</span>
      </div>
    </section>
  );
}
