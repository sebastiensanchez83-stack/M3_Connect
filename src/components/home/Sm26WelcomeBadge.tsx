import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Award } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { sm26Kind, useSm26Participation } from '@/hooks/useSm26Participation';
import { memberHomeHref } from '@/lib/accountNav';

/**
 * A small mark in the "Welcome back" hero for those who took part in the
 * Monaco Smart & Sustainable Marina Rendezvous 2026 (themselves, their team,
 * or their company): Victor, 9 Oct 2026, did not see it anywhere. It leads to
 * My events, where the names are. Nothing for a draft account or anyone who
 * did not take part.
 *
 * It sits LAST in the hero column: it arrives after a few reads, and anywhere
 * higher it would push the search field down while the member reaches for it.
 */
export function Sm26WelcomeBadge() {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const sm26 = useSm26Participation(!!profile && profile.onboarding_status !== 'draft');
  const kind = sm26Kind(sm26);
  if (!kind) return null;
  return (
    <Link
      to={memberHomeHref('registrations')}
      className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-pill bg-white/15 px-4 text-[15px] font-semibold text-white ring-1 ring-inset ring-white/30 transition-colors hover:bg-white/25 focus:outline-none focus-visible:shadow-focus motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-500"
    >
      <Award className="h-4 w-4 shrink-0 text-gold" aria-hidden="true" />
      {kind === 'you'
        ? t('dash.sm26Badge', 'You attended Smart Marina 2026')
        : kind === 'team'
          ? t('dash.sm26BadgeTeam', 'Your team attended Smart Marina 2026')
          : t('dash.sm26BadgeCompany', 'Your company took part in Smart Marina 2026')}
    </Link>
  );
}
