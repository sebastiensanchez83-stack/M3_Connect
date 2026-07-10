import { Check } from 'lucide-react';
import { REG_STATUS_META, REG_STAGES, regStatusBadgeClass, prettyStatus } from '@/components/admin/AdminSM26';

// Happy-path status timeline (Submitted → Under review → Confirmed → Paid).
// Off-path statuses (waitlist / declined / cancelled) show a clear notice
// instead, because they aren't a step on the line. Shared between the admin
// registration detail and the participant event hub.
export function SM26StatusTimeline({ status, paid, waived = false }: { status: string; paid: boolean; waived?: boolean }) {
  const meta = REG_STATUS_META[status] || { label: prettyStatus(status), desc: '', stage: null };
  if (meta.stage === null) {
    return (
      <div className="mt-3">
        <div className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${regStatusBadgeClass(status)}`}>
          <span className="font-semibold">{meta.label}</span>
        </div>
        {meta.desc && <p className="text-xs text-gray-500 mt-1.5">{meta.desc}</p>}
      </div>
    );
  }
  const current = paid ? 3 : meta.stage;
  return (
    <div className="mt-3">
      <div className="flex items-start overflow-x-auto">
        {REG_STAGES.map((label, i) => {
          const done = i < current;
          const isCurrent = i === current;
          return (
            <div key={label} className="flex items-start flex-1 last:flex-none min-w-0">
              <div className="flex flex-col items-center gap-1 w-14 shrink-0">
                <div className={`h-7 w-7 rounded-full flex items-center justify-center border-2 transition-colors
                  ${done ? 'bg-primary border-primary text-white'
                    : isCurrent ? 'bg-primary border-primary text-white ring-4 ring-primary/15'
                    : 'bg-white border-gray-200'}`}>
                  {done ? <Check className="h-3.5 w-3.5" /> : isCurrent ? <span className="h-2 w-2 rounded-full bg-white" /> : null}
                </div>
                <span className={`text-[10px] text-center leading-tight ${isCurrent ? 'font-semibold text-gray-800' : done ? 'text-gray-600' : 'text-gray-300'}`}>{label}</span>
              </div>
              {i < REG_STAGES.length - 1 && (
                <div className={`h-0.5 flex-1 mt-3.5 mx-0.5 rounded ${i < current ? 'bg-primary' : 'bg-gray-200'}`} />
              )}
            </div>
          );
        })}
      </div>
      <p className="text-xs text-gray-500 mt-2">
        <span className="font-medium text-gray-700">{meta.label}</span> — {meta.desc}
        {paid && <span className="text-emerald-600">{waived ? ' · No payment due.' : ' · Payment received.'}</span>}
      </p>
    </div>
  );
}
