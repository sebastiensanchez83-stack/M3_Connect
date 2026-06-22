import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

// Consistent "back to the previous page" arrow. Uses real browser history by
// default; pass `to` for a fixed fallback/destination. `light` for dark heroes.
export function SM26BackLink({ to, label = 'Back', light = false }: { to?: string; label?: string; light?: boolean }) {
  const navigate = useNavigate();
  const goBack = () => {
    if (to) { navigate(to); return; }
    if (window.history.length > 1) navigate(-1);
    else navigate('/sm26/me');
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
