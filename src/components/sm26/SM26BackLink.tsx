import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

// Robust "back" arrow. Steps back through real in-app history when there is any
// — React Router records our position in the history stack as history.state.idx,
// which is reliable (unlike window.history.length, which also counts entries
// from before the app loaded). On a direct load / no in-app history it falls
// back to a sensible SM26 page instead of dead-ending or jumping somewhere
// unrelated. Pass `to` to force a destination, or `fallback` to change the
// no-history landing page.
export function SM26BackLink({
  to,
  label = 'Back',
  light = false,
  fallback = '/sm26/me',
}: { to?: string; label?: string; light?: boolean; fallback?: string }) {
  const navigate = useNavigate();
  const goBack = () => {
    if (to) { navigate(to); return; }
    const state = window.history.state as { idx?: number } | null;
    const idx = state && typeof state.idx === 'number' ? state.idx : 0;
    if (idx > 0) navigate(-1);
    else navigate(fallback);
  };
  return (
    <button
      onClick={goBack}
      className={`inline-flex items-center gap-1.5 text-sm font-medium transition-colors ${light ? 'text-white/70 hover:text-white' : 'text-gray-500 hover:text-primary'}`}
    >
      <ArrowLeft className="h-4 w-4" /> {label}
    </button>
  );
}
