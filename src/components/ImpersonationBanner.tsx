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

  return (
    <div className="sticky top-0 z-[150] bg-amber-500 text-amber-950 shadow-sm">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-2 text-sm">
        <span className="flex min-w-0 items-center gap-2 font-medium">
          <Eye className="h-4 w-4 shrink-0" />
          <span className="truncate">
            Viewing as <strong>{state.target_name}</strong>
            <span className="hidden sm:inline text-amber-900/80"> ({state.target_email})</span>
            <span className="hidden md:inline"> — you are seeing the platform exactly as this participant.</span>
          </span>
        </span>
        <button
          type="button"
          onClick={exit}
          disabled={exiting}
          className="flex shrink-0 items-center gap-1.5 rounded-md bg-amber-950 px-3 py-1.5 text-xs font-semibold text-amber-50 transition-colors hover:bg-amber-900 disabled:opacity-60"
        >
          <LogOut className="h-3.5 w-3.5" />
          {exiting ? 'Exiting…' : 'Exit view'}
        </button>
      </div>
    </div>
  );
}
