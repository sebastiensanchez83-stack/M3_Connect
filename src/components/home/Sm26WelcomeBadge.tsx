import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Award } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useSm26Participation } from '@/hooks/useSm26Participation';
import { memberHomeHref } from '@/lib/accountNav';

/**
 * A small mark under "Welcome back" for those who took part in the Monaco
 * Smart & Sustainable Marina Rendezvous 2026 (themselves, or their team):
 * Victor, 9 Oct 2026, did not see it anywhere. It leads to My events, where
 * the names are. Nothing for a draft account or anyone who did not take part.
 */
export function Sm26WelcomeBadge() {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const sm26 = useSm26Participation(!!profile && profile.onboarding_status !== 'draft');
  if (!sm26 || (!sm26.attended && sm26.team.people.length === 0)) return null;
  return (
    <Link
      to={memberHomeHref('registrations')}
      className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-pill bg-white/15 px-4 text-[15px] font-semibold text-white ring-1 ring-inset ring-white/30 transition-colors hover:bg-white/25 focus:outline-none focus-visible:shadow-focus"
    >
      <Award className="h-4 w-4 shrink-0 text-gold" aria-hidden="true" />
      {sm26.attended
        ? t('dash.sm26Badge', 'You attended Smart Marina 2026')
        : t('dash.sm26BadgeTeam', 'Your team attended Smart Marina 2026')}
    </Link>
  );
}
