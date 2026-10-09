import { Suspense, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Award, ChevronDown, Users } from 'lucide-react';
import { RowSkeleton } from '@/components/member/MemberUI';
import { RENDEZVOUS_2026_PATH } from '@/components/brand/m3Events';
import { lazyWithRetry } from '@/lib/lazyWithRetry';
import { cn } from '@/lib/utils';
import type { Sm26Participation } from '@/hooks/useSm26Participation';

const MyEvents = lazyWithRetry(() => import('@/components/account/MyEvents').then((m) => ({ default: m.MyEvents })));

/** "Alice Martin, Bob Smith and 4 others" (or fewer names when there are few). */
export function teamSummary(names: string[], t: TFunction): string {
  if (names.length === 0) return '';
  if (names.length === 1) return names[0];
  if (names.length === 2) return String(t('dash.twoNames', { a: names[0], b: names[1], defaultValue: '{{a}} and {{b}}' }));
  if (names.length === 3) return String(t('dash.threeNames', { a: names[0], b: names[1], c: names[2], defaultValue: '{{a}}, {{b}} and {{c}}' }));
  return String(t('dash.namesAndOthers', { a: names[0], b: names[1], count: names.length - 2, defaultValue_one: '{{a}}, {{b}} and {{count}} other', defaultValue_other: '{{a}}, {{b}} and {{count}} others' }));
}

/**
 * Smart Marina 2026, read-only: "You attended…" and "Your team took part:
 * Alice Martin, Bob Smith and 4 others", with every name a click away. No
 * action: the event is over (src/lib/sm26Participation.ts says who counts).
 */
export function Sm26Block({ sm26 }: { sm26: Sm26Participation }) {
  const { t } = useTranslation();
  const [all, setAll] = useState(false);
  const listId = useId();
  const names = sm26.team.people.map((p) => p.name);
  if (!sm26.attended && names.length === 0) return null;
  return (
    <section aria-labelledby={`${listId}-title`} className="rounded-card border border-teal/25 bg-foam p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-field bg-white text-teal-text">
          <Award className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1 text-[16px] leading-6 text-navy">
          <h4 id={`${listId}-title`} className="font-semibold">
            {sm26.attended
              ? t('dash.sm26You', 'You attended the Monaco Smart & Sustainable Marina Rendezvous 2026')
              : t('dash.sm26TeamTitle', 'Your company took part in the Monaco Smart & Sustainable Marina Rendezvous 2026')}
          </h4>
          {names.length > 0 && (
            <p className="mt-1 flex items-start gap-2">
              <Users className="mt-1 h-4 w-4 shrink-0 text-teal-text" aria-hidden="true" />
              <span>
                {t('dash.sm26Team', { names: teamSummary(names, t), defaultValue: 'Your team took part: {{names}}.' })}
              </span>
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
            {names.length > 3 && (
              <button
                type="button"
                aria-expanded={all}
                aria-controls={listId}
                onClick={() => setAll((v) => !v)}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-pill text-[15px] font-semibold text-navy underline decoration-navy/30 underline-offset-4 hover:decoration-gold focus:outline-none focus-visible:shadow-focus"
              >
                {all ? t('dash.hideNames', 'Hide the names') : t('dash.seeAllNames', { count: names.length, defaultValue: 'See all {{count}} names' })}
                <ChevronDown className={cn('h-4 w-4 transition-transform motion-reduce:transition-none', all && 'rotate-180')} aria-hidden="true" />
              </button>
            )}
            <Link
              to={RENDEZVOUS_2026_PATH}
              className="inline-flex min-h-11 items-center text-[15px] font-semibold text-navy underline decoration-navy/30 underline-offset-4 hover:decoration-gold focus:outline-none focus-visible:shadow-focus"
            >
              {t('dash.sm26Page', 'See the event page')}
            </Link>
          </div>
          {names.length > 3 && (
            <ul id={listId} className={cn('mt-2 gap-x-6 gap-y-1 sm:grid-cols-2', all ? 'grid' : 'hidden')}>
              {names.map((n, i) => (
                <li key={`${i}:${n}`} className="text-[15px] leading-6 text-ink">{n}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

/** My events: Smart Marina 2026 first when it applies, then every registration (MyEvents, unchanged). */
export function EventsPanel({ sm26 }: { sm26: Sm26Participation | null }) {
  return (
    <div className="space-y-4">
      {sm26 && <Sm26Block sm26={sm26} />}
      <Suspense fallback={<div className="rounded-card border border-rule bg-white"><RowSkeleton rows={2} /></div>}>
        <MyEvents />
      </Suspense>
    </div>
  );
}
