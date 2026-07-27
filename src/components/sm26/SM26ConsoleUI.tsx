import { useState, type ComponentType, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

// Shared console furniture for the SM26 partner-facing consoles (Yacht Club and
// Yachting Ventures). Extracted from SM26PartnerPage so both read the same:
// a dashboard of clickable "to do" tiles, progress funnels, collapsible panels
// and a right-hand slide-in drawer for row detail.

/** Small status pill. */
export const Pill = ({ label, cls }: { label: string; cls: string }) => (
  <span className={`text-[10px] px-1.5 py-0.5 rounded-full border whitespace-nowrap ${cls}`}>{label}</span>
);

/** Segmented progress funnel. */
export function Funnel({ title, segments }: { title: string; segments: { label: string; value: number; bar: string; dot: string }[] }) {
  const total = segments.reduce((a, s) => a + s.value, 0) || 1;
  return (
    <div>
      <div className="text-xs font-semibold text-gray-600 mb-1.5">{title}</div>
      <div className="flex h-2.5 rounded-full overflow-hidden bg-gray-100">
        {segments.map((s, i) => s.value > 0 && <div key={i} className={s.bar} style={{ width: `${(s.value / total) * 100}%` }} title={`${s.label}: ${s.value}`} />)}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5">
        {segments.map((s, i) => (
          <span key={i} className="text-[11px] text-gray-500 inline-flex items-center gap-1">
            <span className={`inline-block h-2 w-2 rounded-full ${s.dot}`} /> {s.label} {s.value}
          </span>
        ))}
      </div>
    </div>
  );
}

/** One dashboard tile: a count that also filters the list below when clicked. */
export function ConsoleTile({ label, icon: Icon, cls, num, value, active, onClick }: {
  label: string; icon: ComponentType<{ className?: string }>; cls: string; num: string;
  value: number; active: boolean; onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick}
      className={`text-left rounded-lg border p-2.5 transition-all hover:shadow-sm ${cls} ${active ? 'ring-2 ring-primary/50' : ''} ${value === 0 && !active ? 'opacity-55' : ''}`}>
      <Icon className={`h-4 w-4 mb-1 ${num}`} />
      <div className={`text-xl font-bold leading-none ${num}`}>{value}</div>
      <div className="text-[11px] text-gray-600 mt-1 leading-tight">{label}</div>
    </button>
  );
}

/** Collapsible section for read-only / specialised blocks. */
export function CollapsiblePanel({ title, icon: Icon, count, description, defaultOpen = false, children }: {
  title: string; icon: ComponentType<{ className?: string }>; count?: number; description?: string; defaultOpen?: boolean; children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card>
      <button type="button" onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between gap-2 px-4 py-3.5 text-left">
        <span className="flex items-center gap-2 min-w-0">
          <Icon className="h-5 w-5 text-primary shrink-0" />
          <span className="font-semibold text-gray-900 truncate">{title}</span>
          {typeof count === 'number' && <span className="text-xs text-gray-400 shrink-0">({count})</span>}
        </span>
        <ChevronDown className={`h-5 w-5 text-gray-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <CardContent className="pt-0">
          {description && <p className="text-sm text-gray-500 mb-3">{description}</p>}
          {children}
        </CardContent>
      )}
    </Card>
  );
}

/** Right-hand slide-in drawer (full width on mobile). */
export function ConsoleDrawer({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-40" onClick={onClose} />
      <div className="fixed inset-y-0 right-0 w-full max-w-xl bg-gray-50 z-50 shadow-2xl overflow-y-auto">{children}</div>
    </>
  );
}
