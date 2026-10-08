import { useState } from 'react';
import { Eye, LogOut } from 'lucide-react';
import { getImpersonation, stopImpersonation } from '@/lib/impersonation';

// Full-width warning bar shown whenever an admin is viewing the platform as another
// user (see src/lib/impersonation.ts). Reads the localStorage flag synchronously so
// it is correct on first paint after the impersonation reload; renders nothing
// otherwise. Deliberately independent of AuthContext (never touch that provider).

export function ImpersonationBanner() {
  const [state] = useState(getImpersonation);
  const [exiting, setExiting] = useState(false);
  if (!state) return null;

  const exit = async () => {
    setExiting(true);
    try {
      await stopImpersonation();
    } catch {
      setExiting(false);
    }
  };

  // Stays amber on purpose (it must never be mistaken for the normal site): a
  // solid amber-400 band with navy text (8.9:1, the e-mail at 75 %: 5.2:1), the
  // kit's 7xl column and type, and a navy pill to leave.
  return (
    <div className="sticky top-0 z-[150] border-b border-navy/15 bg-amber-400 text-navy">
      <div className="mx-auto flex min-h-12 max-w-7xl items-center justify-between gap-3 px-4 py-1.5 text-[14px] leading-5 sm:px-6">
        <span className="flex min-w-0 items-center gap-2.5 font-medium">
          <span aria-hidden="true" className="grid h-7 w-7 shrink-0 place-items-center rounded-pill bg-navy/10">
            <Eye className="h-4 w-4" />
          </span>
          <span className="truncate">
            Viewing as <strong className="font-semibold">{state.target_name}</strong>
            <span className="hidden text-navy/75 sm:inline"> ({state.target_email})</span>
            <span className="hidden md:inline"> — you are seeing the platform exactly as this participant.</span>
          </span>
        </span>
        <button
          type="button"
          onClick={exit}
          disabled={exiting}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-pill bg-navy px-4 text-[13px] font-semibold text-white transition-colors hover:bg-navy-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy focus-visible:ring-offset-2 focus-visible:ring-offset-amber-400 disabled:opacity-60"
        >
          <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
          {exiting ? 'Exiting…' : 'Exit view'}
        </button>
      </div>
    </div>
  );
}
