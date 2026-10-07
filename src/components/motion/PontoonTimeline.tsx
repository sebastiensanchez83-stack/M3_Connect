import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { RevealGroup } from './Reveal';

/**
 * "Ponton": a programme as a pontoon. A vertical walkway (navy, with planks)
 * runs down the page; each session hangs off it on a short catway, with the
 * time on the left. Used for event programmes; items reveal one after another.
 *
 *   <PontoonTimeline items={[{ time: '09:30', title: 'Opening', meta: 'Main hall' }, …]} />
 */
export interface PontoonItem {
  time: string;
  title: string;
  meta?: string;
  href?: string;
}

export function PontoonTimeline({ items, className }: { items: PontoonItem[]; className?: string }) {
  return (
    <div className={cn('relative', className)}>
      {/* The walkway: a navy band with plank joints every 10 px. */}
      <span
        aria-hidden="true"
        className="absolute bottom-2 left-[76px] top-2 w-1.5 rounded-full sm:left-[92px]"
        style={{ background: 'repeating-linear-gradient(180deg, rgb(11 38 83) 0 8px, rgb(11 38 83 / .55) 8px 10px)' }}
      />
      <RevealGroup as="ol" className="relative space-y-4">
        {items.map((item) => {
          const body = (
            <>
              <p className="text-card-title text-navy">{item.title}</p>
              {item.meta && <p className="mt-0.5 text-meta-caps">{item.meta}</p>}
            </>
          );
          return (
            <li key={`${item.time}-${item.title}`} className="relative flex items-start">
              <span className="w-[64px] shrink-0 pt-3 text-right text-sm font-semibold text-navy tabular sm:w-[80px]">{item.time}</span>
              {/* Catway: from the walkway to the card, with a cleat where it meets the walkway. */}
              <span aria-hidden="true" className="relative mt-[22px] ml-[12px] h-[3px] w-7 shrink-0 bg-navy/70 sm:w-9">
                <span className="absolute -left-[3px] -top-[3px] h-[9px] w-[9px] rounded-full border-2 border-navy bg-white" />
              </span>
              <div
                className={cn(
                  'relative min-w-0 flex-1 rounded-card border border-rule bg-white px-4 py-3',
                  item.href && 'card-lift',
                )}
              >
                {item.href ? (
                  <Link to={item.href} className="stretched-link focus-ring block rounded-card">
                    {body}
                  </Link>
                ) : (
                  body
                )}
              </div>
            </li>
          );
        })}
      </RevealGroup>
    </div>
  );
}
