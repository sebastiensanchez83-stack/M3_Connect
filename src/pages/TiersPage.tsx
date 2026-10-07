import { Link } from 'react-router-dom';
import { Seo } from '@/components/seo/Seo';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { withSiteSuffix } from '@/lib/seoText';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { TIER_LABELS, TIER_COLORS, OrgTier, PersonaType } from '@/types/database';
import {
  Check, X, Minus, Ticket, Users, Wifi, Star, Mail, ArrowRight,
  FileText, Calendar, Eye, MessageSquare, ClipboardList, Shield,
} from 'lucide-react';

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

interface TierFeatures {
  connectRequests: string;
  webinarRequests: string;
  teamMembers: number;
  sponsorBadge: boolean;
  resourceAccess: string;
  eventAccess: string;
  rfpAccess: boolean;
  consultationAccess: boolean;
  publicProfile: boolean;
  networkDirectory: boolean;
  prioritySupport: boolean;
  /** Key under tiersPage.cta. */
  ctaLabel: 'signUp' | 'contactTeam';
  ctaHref: string;
  ctaVariant: 'default' | 'outline';
  highlighted: boolean;
}

// ──────────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────────

const TIERS: OrgTier[] = [
  'member',
  'innovation_partner',
  'associate_partner',
  'premium_partner',
  'premium_sponsor',
  'main_sponsor',
];

const TIER_CONFIG: Record<OrgTier, TierFeatures> = {
  member: {
    connectRequests: '5',
    webinarRequests: 'Not included',
    teamMembers: 1,
    sponsorBadge: false,
    resourceAccess: 'Public + Members',
    eventAccess: 'Public + Members',
    rfpAccess: true,
    consultationAccess: true,
    publicProfile: true,
    networkDirectory: true,
    prioritySupport: false,
    ctaLabel: 'signUp',
    ctaHref: '/become-partner',
    ctaVariant: 'outline',
    highlighted: false,
  },
  innovation_partner: {
    connectRequests: '20',
    webinarRequests: '5 / year',
    teamMembers: 5,
    sponsorBadge: true,
    resourceAccess: 'All content',
    eventAccess: 'All events',
    rfpAccess: true,
    consultationAccess: true,
    publicProfile: true,
    networkDirectory: true,
    prioritySupport: false,
    ctaLabel: 'contactTeam',
    // Sponsorship is agreed with the M3 team: the contact form, opened on that subject.
    ctaHref: '/contact?subject=partnership',
    ctaVariant: 'default',
    highlighted: false,
  },
  associate_partner: {
    connectRequests: 'Unlimited',
    webinarRequests: 'Unlimited',
    teamMembers: 10,
    sponsorBadge: true,
    resourceAccess: 'All content',
    eventAccess: 'All events + priority',
    rfpAccess: true,
    consultationAccess: true,
    publicProfile: true,
    networkDirectory: true,
    prioritySupport: true,
    ctaLabel: 'contactTeam',
    // Sponsorship is agreed with the M3 team: the contact form, opened on that subject.
    ctaHref: '/contact?subject=partnership',
    ctaVariant: 'default',
    highlighted: true,
  },
  premium_partner: {
    connectRequests: 'Unlimited',
    webinarRequests: 'Unlimited',
    teamMembers: 15,
    sponsorBadge: true,
    resourceAccess: 'All content',
    eventAccess: 'All events + priority',
    rfpAccess: true,
    consultationAccess: true,
    publicProfile: true,
    networkDirectory: true,
    prioritySupport: true,
    ctaLabel: 'contactTeam',
    // Sponsorship is agreed with the M3 team: the contact form, opened on that subject.
    ctaHref: '/contact?subject=partnership',
    ctaVariant: 'default',
    highlighted: false,
  },
  premium_sponsor: {
    connectRequests: 'Unlimited',
    webinarRequests: 'Unlimited',
    teamMembers: 20,
    sponsorBadge: true,
    resourceAccess: 'All content',
    eventAccess: 'All events + VIP',
    rfpAccess: true,
    consultationAccess: true,
    publicProfile: true,
    networkDirectory: true,
    prioritySupport: true,
    ctaLabel: 'contactTeam',
    // Sponsorship is agreed with the M3 team: the contact form, opened on that subject.
    ctaHref: '/contact?subject=partnership',
    ctaVariant: 'default',
    highlighted: false,
  },
  main_sponsor: {
    connectRequests: 'Unlimited',
    webinarRequests: 'Unlimited',
    teamMembers: 25,
    sponsorBadge: true,
    resourceAccess: 'All content',
    eventAccess: 'All events + VIP',
    rfpAccess: true,
    consultationAccess: true,
    publicProfile: true,
    networkDirectory: true,
    prioritySupport: true,
    ctaLabel: 'contactTeam',
    // Sponsorship is agreed with the M3 team: the contact form, opened on that subject.
    ctaHref: '/contact?subject=partnership',
    ctaVariant: 'default',
    highlighted: false,
  },
};


// ──────────────────────────────────────────────────────────────────────────────
// Labels
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Membership is free: the paid levels are event sponsorship packages, agreed
 * with the M3 team, that also raise the platform quotas. The copy says so —
 * no "plan", "upgrade" or "pricing".
 */
const VALUE_KEYS: Record<string, { key: string; fallback: string }> = {
  'Not included': { key: 'tiersPage.values.notIncluded', fallback: 'Not included' },
  Unlimited: { key: 'tiersPage.values.unlimited', fallback: 'Unlimited' },
  '5 / year': { key: 'tiersPage.values.fivePerYear', fallback: '5 per year' },
  'Public + Members': { key: 'tiersPage.values.publicMembers', fallback: 'Public and members-only' },
  'All content': { key: 'tiersPage.values.allContent', fallback: 'All content' },
  'All events': { key: 'tiersPage.values.allEvents', fallback: 'All events' },
  'All events + priority': { key: 'tiersPage.values.allEventsPriority', fallback: 'All events, priority access' },
  'All events + VIP': { key: 'tiersPage.values.allEventsVip', fallback: 'All events, VIP access' },
};

function valueLabel(t: TFunction, value: string): string {
  const entry = VALUE_KEYS[value];
  return entry ? t(entry.key, entry.fallback) : value;
}

// ──────────────────────────────────────────────────────────────────────────────
// Sub-components
// ──────────────────────────────────────────────────────────────────────────────

function FeatureValue({ value, isBoolean }: { value: string | boolean; isBoolean?: boolean }) {
  const { t } = useTranslation();
  if (isBoolean) {
    return typeof value === 'boolean' && value
      ? <Check className="h-5 w-5 text-emerald-500 mx-auto" aria-label={t('tiersPage.included', 'Included')} />
      : <X className="h-5 w-5 text-gray-300 mx-auto" aria-label={t('tiersPage.notIncluded', 'Not included')} />;
  }

  if (typeof value === 'string') {
    if (value === 'Unlimited') {
      return (
        <span className="flex items-center justify-center gap-1 text-sm font-semibold text-emerald-600">
          <Minus className="h-3 w-3" />
          <span>{valueLabel(t, value)}</span>
        </span>
      );
    }
    if (value === 'Not included') {
      return <X className="h-5 w-5 text-gray-300 mx-auto" aria-label={t('tiersPage.notIncluded', 'Not included')} />;
    }
    return <span className="text-sm font-medium text-gray-700">{valueLabel(t, value)}</span>;
  }

  return null;
}

// ──────────────────────────────────────────────────────────────────────────────
// Main Page Component
// ──────────────────────────────────────────────────────────────────────────────

export function TiersPage({ embedded }: { embedded?: boolean } = {}) {
  const { t } = useTranslation();
  const { organization, profile } = useAuth();
  const currentTier = organization?.tier ?? null;
  const persona = profile?.persona as PersonaType | undefined;
  const isMarina = persona === 'marina';
  // No prices: membership is free and sponsorship packages are agreed with the M3 team.

  const seoTitle = withSiteSuffix(t('seo.tiers.title', 'Free membership and event sponsorship'));
  const seoDescription = t('seo.tiers.description', 'Membership of Smart Marina Connect is free. Companies that sponsor M3 Monaco’s events get more team seats, more introductions and a sponsor badge.');

  return (
    <>
      {!embedded && (
        <Seo title={seoTitle} description={seoDescription} path="/tiers" />
      )}

      {/* ── Hero ───────────────────────────────────────────────────────────── */}
      <section className={`relative overflow-hidden bg-white px-4 ${embedded ? 'py-6' : 'py-20'}`}>
        <div className="container mx-auto max-w-4xl text-center relative">
          {!embedded && (
            <Badge
              variant="outline"
              className="mb-4 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-primary border-primary/30 bg-primary/5"
            >
              <Ticket className="h-3.5 w-3.5 mr-1.5" />
              {t('tiersPage.eyebrow', 'Membership & sponsorship')}
            </Badge>
          )}
          <h1 className={`font-bold text-gray-900 tracking-tight mb-3 ${embedded ? 'text-2xl' : 'text-4xl sm:text-5xl mb-5'}`}>
            {t('tiersPage.title', 'Free membership, event sponsorship')}
          </h1>
          <p className={`text-gray-500 max-w-2xl mx-auto leading-relaxed ${embedded ? 'text-sm' : 'text-lg'}`}>
            {t('tiersPage.subtitle', "Membership is free for every member. Companies that sponsor M3's events get more team seats, more introductions and a sponsor badge on the platform.")}
          </p>
        </div>
      </section>

      {/* ── Tier Cards ─────────────────────────────────────────────────────── */}
      <section className={`${embedded ? 'py-8' : 'py-16'} px-4 bg-white`}>
        <div className={`mx-auto ${embedded ? 'max-w-full' : 'container max-w-7xl'}`}>
          <div className={embedded
            ? 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 items-stretch'
            : 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 items-stretch'
          }>
            {TIERS.map((tier) => {
              const config = TIER_CONFIG[tier];
              const colors = TIER_COLORS[tier];
              const label = tier === 'member' ? t('tiersPage.memberLabel', 'Member') : TIER_LABELS[tier];
              const isCurrentPlan = currentTier === tier;
              const isHighlighted = config.highlighted;

              return (
                <Card
                  key={tier}
                  className={`relative flex flex-col transition-all duration-200 ${
                    isHighlighted
                      ? 'ring-2 ring-primary shadow-xl scale-[1.02]'
                      : 'border border-gray-200 hover:shadow-md'
                  } ${isCurrentPlan ? 'ring-2 ring-secondary' : ''}`}
                >
                  {/* Current level badge */}
                  {isCurrentPlan && (
                    <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
                      <Badge className="px-3 py-0.5 text-xs font-semibold bg-secondary text-secondary-foreground shadow-sm">
                        {t('tiersPage.yourCurrentLevel', 'Your current level')}
                      </Badge>
                    </div>
                  )}

                  <CardHeader className="pb-4 pt-6 px-5">
                    {/* Tier color pill */}
                    <span
                      className={`inline-block w-fit px-2.5 py-0.5 rounded-full text-xs font-semibold mb-3 ${colors.bg} ${colors.text} border ${colors.border}`}
                    >
                      {label}
                    </span>

                    {/* What it is: free membership, or an event sponsorship package */}
                    <div className="mb-1">
                      <span className="text-3xl font-bold text-gray-900">
                        {tier === 'member' ? t('tiersPage.free', 'Free') : t('tiersPage.sponsor', 'Event sponsor')}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400">
                      {tier === 'member'
                        ? t('tiersPage.freeNote', 'For every member')
                        : t('tiersPage.sponsorNote', 'Package agreed with the M3 team')}
                    </p>
                  </CardHeader>

                  <CardContent className="flex flex-col flex-1 gap-5 px-5 pb-6">
                    {/* Features list */}
                    <ul className="space-y-3 flex-1">
                      <FeatureRow
                        icon={<Wifi className="h-4 w-4 text-gray-400" />}
                        label={t('tiersPage.features.connectRequests', 'Introduction requests per month')}
                        value={config.connectRequests}
                      />
                      <FeatureRow
                        icon={<Ticket className="h-4 w-4 text-gray-400" />}
                        label={t('tiersPage.features.webinarRequests', 'Webinar proposals')}
                        value={config.webinarRequests}
                      />
                      <FeatureRow
                        icon={<Users className="h-4 w-4 text-gray-400" />}
                        label={t('tiersPage.features.teamMembers', 'Team seats')}
                        value={String(config.teamMembers)}
                      />
                      <FeatureRow
                        icon={<FileText className="h-4 w-4 text-gray-400" />}
                        label={t('tiersPage.features.resources', 'Resources')}
                        value={config.resourceAccess}
                      />
                      <FeatureRow
                        icon={<Calendar className="h-4 w-4 text-gray-400" />}
                        label={t('tiersPage.features.events', 'Events')}
                        value={config.eventAccess}
                      />
                      <FeatureRow
                        icon={<Star className="h-4 w-4 text-gray-400" />}
                        label={t('tiersPage.features.sponsorBadge', 'Sponsor badge')}
                        value={config.sponsorBadge}
                        isBoolean
                      />
                      <FeatureRow
                        icon={<Shield className="h-4 w-4 text-gray-400" />}
                        label={t('tiersPage.features.prioritySupport', 'Priority support')}
                        value={config.prioritySupport}
                        isBoolean
                      />
                    </ul>

                    {/* CTA */}
                    {isCurrentPlan ? (
                      <Button disabled className="w-full rounded-xl" variant="outline">
                        {t('tiersPage.yourLevel', 'Your level')}
                      </Button>
                    ) : (
                      <Button
                        asChild
                        variant={config.ctaVariant}
                        className={`w-full rounded-xl group ${
                          isHighlighted
                            ? 'bg-primary hover:bg-primary/90 text-white'
                            : ''
                        }`}
                      >
                        <Link to={config.ctaHref}>
                          {config.ctaLabel === 'signUp'
                            ? t('tiersPage.cta.signUp', 'Sign up')
                            : t('tiersPage.cta.contactTeam', 'Contact the M3 team')}
                          <ArrowRight className="h-4 w-4 ml-1.5 group-hover:translate-x-0.5 transition-transform" />
                        </Link>
                      </Button>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── Feature Comparison Table ────────────────────────────────────────── */}
      <section className={`${embedded ? 'py-8' : 'py-16'} px-4 bg-gray-50`}>
        <div className="container mx-auto max-w-7xl">
          <h2 className="text-2xl font-bold text-gray-900 text-center mb-10">
            {t('tiersPage.compareTitle', 'Compare the levels')}
          </h2>

          {isMarina && (
            <p className="text-center text-sm text-gray-500 mb-6">
              {t('tiersPage.marinaNote', 'Membership is free for marinas, as for every member, and a marina can invite its whole team. Sponsoring an event adds visibility.')}
            </p>
          )}

          <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm">
            <table className="w-full text-sm" style={{ minWidth: '700px' }}>
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left px-5 py-4 text-gray-500 font-semibold" style={{ width: '180px', minWidth: '180px' }}>{t('tiersPage.feature', 'Feature')}</th>
                  {TIERS.map((tier) => {
                    const colors = TIER_COLORS[tier];
                    const isCurrentPlan = currentTier === tier;
                    return (
                      <th key={tier} className="px-3 py-4 text-center" style={{ minWidth: '100px' }}>
                        <span
                          className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${colors.bg} ${colors.text} border ${colors.border} ${
                            isCurrentPlan ? 'ring-1 ring-secondary/70' : ''
                          }`}
                        >
                          {tier === 'member' ? t('tiersPage.memberLabel', 'Member') : TIER_LABELS[tier]}
                        </span>
                        {isCurrentPlan && (
                          <span className="block text-xs text-secondary font-medium mt-1">{t('tiersPage.yourLevel', 'Your level')}</span>
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {/* Team */}
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  <td colSpan={7} className="px-5 py-2 text-xs font-bold text-gray-400 uppercase tracking-wider">{t('tiersPage.sections.team', 'Team')}</td>
                </tr>
                <ComparisonRow
                  label={t('tiersPage.features.teamMembers', 'Team seats')}
                  values={TIERS.map((tier) => String(TIER_CONFIG[tier].teamMembers))}
                  isText
                />

                {/* Platform Access */}
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  <td colSpan={7} className="px-5 py-2 text-xs font-bold text-gray-400 uppercase tracking-wider">{t('tiersPage.sections.platform', 'Platform access')}</td>
                </tr>
                <ComparisonRow
                  label={t('tiersPage.features.resourceLibrary', 'Resource library')}
                  values={TIERS.map((tier) => TIER_CONFIG[tier].resourceAccess)}
                  isText
                />
                <ComparisonRow
                  label={t('tiersPage.features.eventsAccess', 'Events')}
                  values={TIERS.map((tier) => TIER_CONFIG[tier].eventAccess)}
                  isText
                />
                <ComparisonRow
                  label={t('tiersPage.features.publicProfile', 'Company page')}
                  values={TIERS.map((tier) => TIER_CONFIG[tier].publicProfile)}
                  isBoolean
                />
                <ComparisonRow
                  label={t('tiersPage.features.directory', 'Directory')}
                  values={TIERS.map((tier) => TIER_CONFIG[tier].networkDirectory)}
                  isBoolean
                />

                {/* Introductions and needs */}
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  <td colSpan={7} className="px-5 py-2 text-xs font-bold text-gray-400 uppercase tracking-wider">{t('tiersPage.sections.business', 'Introductions and needs')}</td>
                </tr>
                <ComparisonRow
                  label={t('tiersPage.features.connectRequests', 'Introduction requests per month')}
                  values={TIERS.map((tier) => TIER_CONFIG[tier].connectRequests)}
                  isText
                />
                <ComparisonRow
                  label={t('tiersPage.features.webinarRequests', 'Webinar proposals')}
                  values={TIERS.map((tier) => TIER_CONFIG[tier].webinarRequests)}
                  isText
                />
                <ComparisonRow
                  label={t('tiersPage.features.rfps', 'Publish tenders')}
                  values={TIERS.map((tier) => TIER_CONFIG[tier].rfpAccess)}
                  isBoolean
                />
                <ComparisonRow
                  label={t('tiersPage.features.consultations', 'Expert questions')}
                  values={TIERS.map((tier) => TIER_CONFIG[tier].consultationAccess)}
                  isBoolean
                />

                {/* Visibility & Support */}
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  <td colSpan={7} className="px-5 py-2 text-xs font-bold text-gray-400 uppercase tracking-wider">{t('tiersPage.sections.visibility', 'Visibility and support')}</td>
                </tr>
                <ComparisonRow
                  label={t('tiersPage.features.sponsorBadge', 'Sponsor badge')}
                  values={TIERS.map((tier) => TIER_CONFIG[tier].sponsorBadge)}
                  isBoolean
                />
                <ComparisonRow
                  label={t('tiersPage.features.prioritySupport', 'Priority support')}
                  values={TIERS.map((tier) => TIER_CONFIG[tier].prioritySupport)}
                  isBoolean
                />
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ── Contact CTA ─────────────────────────────────────────────────────── */}
      {!embedded && <section className="py-16 px-4 bg-white">
        <div className="container mx-auto max-w-2xl text-center">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/10 mb-5">
            <Mail className="h-7 w-7 text-primary" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-3">
            {t('tiersPage.contactTitle', 'Want to sponsor an event?')}
          </h2>
          <p className="text-gray-500 mb-7">
            {t('tiersPage.contactBody', 'Sponsorship packages are built around each event and your goals. Write to the M3 team and we will put together the right package with you.')}
          </p>
          <Button asChild className="rounded-xl bg-primary hover:bg-primary/90">
            <Link to="/contact?subject=partnership">
              {t('tiersPage.cta.contactTeam', 'Contact the M3 team')}
              <ArrowRight className="h-4 w-4 ml-2" />
            </Link>
          </Button>
        </div>
      </section>}
    </>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function FeatureRow({
  icon,
  label,
  value,
  isBoolean,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | boolean;
  isBoolean?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <li className="flex items-start gap-2.5">
      <span className="mt-0.5 flex-shrink-0">{icon}</span>
      <div className="flex-1 min-w-0">
        <span className="text-xs text-gray-500 block">{label}</span>
        {isBoolean ? (
          <span className="flex items-center gap-1 mt-0.5">
            {typeof value === 'boolean' && value ? (
              <><Check className="h-4 w-4 text-emerald-500" /><span className="text-xs font-medium text-emerald-600">{t('tiersPage.included', 'Included')}</span></>
            ) : (
              <><X className="h-4 w-4 text-gray-300" /><span className="text-xs text-gray-400">{t('tiersPage.notIncluded', 'Not included')}</span></>
            )}
          </span>
        ) : (
          <span className="text-sm font-semibold text-gray-800">
            {valueLabel(t, String(value))}
          </span>
        )}
      </div>
    </li>
  );
}

function ComparisonRow({
  label,
  values,
  isText,
  isBoolean,
}: {
  label: string;
  values: (string | boolean)[];
  isText?: boolean;
  isBoolean?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <tr className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50 transition-colors">
      <td className="px-6 py-4 text-gray-600 font-medium">{label}</td>
      {values.map((v, idx) => (
        <td key={idx} className="px-4 py-4 text-center">
          {isBoolean ? (
            <FeatureValue value={v} isBoolean />
          ) : isText ? (
            <span className={`text-sm font-medium ${v === 'Unlimited' ? 'text-emerald-600' : v === 'Not included' ? 'text-gray-300' : 'text-gray-700'}`}>
              {valueLabel(t, String(v))}
            </span>
          ) : null}
        </td>
      ))}
    </tr>
  );
}
