import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
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
  pricePartner: string;
  priceMarina: string;
  priceNote: string | null;
  renewalPrice: string | null;
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
  ctaLabel: string;
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
    pricePartner: '€500',
    priceMarina: '€0',
    priceNote: null,
    renewalPrice: null,
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
    ctaLabel: 'Join as Member',
    ctaHref: '/become-partner',
    ctaVariant: 'outline',
    highlighted: false,
  },
  innovation_partner: {
    pricePartner: '€3,000',
    priceMarina: '€3,000',
    priceNote: 'Annual invoice',
    renewalPrice: '€2,500',
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
    ctaLabel: 'Request upgrade',
    ctaHref: '/account?tab=organization',
    ctaVariant: 'default',
    highlighted: false,
  },
  associate_partner: {
    pricePartner: '€15,000',
    priceMarina: '€15,000',
    priceNote: 'Annual invoice',
    renewalPrice: '€10,000',
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
    ctaLabel: 'Request upgrade',
    ctaHref: '/account?tab=organization',
    ctaVariant: 'default',
    highlighted: true,
  },
  premium_partner: {
    pricePartner: '€40,000',
    priceMarina: '€40,000',
    priceNote: 'Annual invoice',
    renewalPrice: '€35,000',
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
    ctaLabel: 'Request upgrade',
    ctaHref: '/account?tab=organization',
    ctaVariant: 'default',
    highlighted: false,
  },
  premium_sponsor: {
    pricePartner: '€100,000',
    priceMarina: '€100,000',
    priceNote: 'Annual invoice',
    renewalPrice: '€90,000',
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
    ctaLabel: 'Request upgrade',
    ctaHref: '/account?tab=organization',
    ctaVariant: 'default',
    highlighted: false,
  },
  main_sponsor: {
    pricePartner: '€150,000',
    priceMarina: '€150,000',
    priceNote: 'Annual invoice',
    renewalPrice: '€150,000',
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
    ctaLabel: 'Request upgrade',
    ctaHref: '/account?tab=organization',
    ctaVariant: 'default',
    highlighted: false,
  },
};

// ──────────────────────────────────────────────────────────────────────────────
// Sub-components
// ──────────────────────────────────────────────────────────────────────────────

function FeatureValue({ value, isBoolean }: { value: string | boolean; isBoolean?: boolean }) {
  if (isBoolean) {
    return typeof value === 'boolean' && value
      ? <Check className="h-5 w-5 text-emerald-500 mx-auto" />
      : <X className="h-5 w-5 text-gray-300 mx-auto" />;
  }

  if (typeof value === 'string') {
    if (value === 'Unlimited') {
      return (
        <span className="flex items-center justify-center gap-1 text-sm font-semibold text-emerald-600">
          <Minus className="h-3 w-3" />
          <span>Unlimited</span>
        </span>
      );
    }
    if (value === 'Not included') {
      return <X className="h-5 w-5 text-gray-300 mx-auto" />;
    }
    return <span className="text-sm font-medium text-gray-700">{value}</span>;
  }

  return null;
}

// ──────────────────────────────────────────────────────────────────────────────
// Main Page Component
// ──────────────────────────────────────────────────────────────────────────────

export function TiersPage({ embedded }: { embedded?: boolean } = {}) {
  const { organization, profile } = useAuth();
  const currentTier = organization?.tier ?? null;
  const persona = profile?.persona as PersonaType | undefined;
  const isMarina = persona === 'marina';
  const isMedia = persona === 'media_partner';
  const getPrice = (config: TierFeatures) => (isMarina || isMedia) ? config.priceMarina : config.pricePartner;

  return (
    <>
      {!embedded && (
        <Helmet>
          <title>Membership & Sponsorship | M3 Connect</title>
          <meta
            name="description"
            content="Choose the M3 Connect membership tier that fits your organization — from free member access to full main sponsor visibility in the marina industry."
          />
        </Helmet>
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
              Membership Plans
            </Badge>
          )}
          <h1 className={`font-bold text-gray-900 tracking-tight mb-3 ${embedded ? 'text-2xl' : 'text-4xl sm:text-5xl mb-5'}`}>
            Membership &amp; Sponsorship
          </h1>
          <p className={`text-gray-500 max-w-2xl mx-auto leading-relaxed ${embedded ? 'text-sm' : 'text-lg'}`}>
            Join the premier B2B network for the marina industry. Start for free and
            upgrade as your visibility needs grow.
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
              const label = TIER_LABELS[tier];
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
                  {/* Popular badge */}
                  {isHighlighted && !isCurrentPlan && (
                    <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
                      <Badge className="px-3 py-0.5 text-xs font-semibold bg-primary text-white shadow-sm">
                        Most popular
                      </Badge>
                    </div>
                  )}

                  {/* Current plan badge */}
                  {isCurrentPlan && (
                    <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
                      <Badge className="px-3 py-0.5 text-xs font-semibold bg-secondary text-secondary-foreground shadow-sm">
                        Your current plan
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

                    {/* Price */}
                    <div className="mb-1">
                      <span className="text-3xl font-bold text-gray-900">{getPrice(config)}</span>
                    </div>
                    <p className="text-xs text-gray-400">
                      {tier === 'member'
                        ? (isMarina || isMedia ? 'Free forever' : 'Annual membership fee')
                        : (config.priceNote || '')}
                    </p>
                    {config.renewalPrice && (
                      <p className="text-xs text-gray-400 mt-1">
                        Renewal: {config.renewalPrice}/year
                      </p>
                    )}
                  </CardHeader>

                  <CardContent className="flex flex-col flex-1 gap-5 px-5 pb-6">
                    {/* Features list */}
                    <ul className="space-y-3 flex-1">
                      <FeatureRow
                        icon={<Wifi className="h-4 w-4 text-gray-400" />}
                        label="Connect requests"
                        value={config.connectRequests}
                      />
                      <FeatureRow
                        icon={<Ticket className="h-4 w-4 text-gray-400" />}
                        label="Webinar requests"
                        value={config.webinarRequests}
                      />
                      <FeatureRow
                        icon={<Users className="h-4 w-4 text-gray-400" />}
                        label="Team members"
                        value={String(config.teamMembers)}
                      />
                      <FeatureRow
                        icon={<FileText className="h-4 w-4 text-gray-400" />}
                        label="Resources"
                        value={config.resourceAccess}
                      />
                      <FeatureRow
                        icon={<Calendar className="h-4 w-4 text-gray-400" />}
                        label="Events"
                        value={config.eventAccess}
                      />
                      <FeatureRow
                        icon={<Star className="h-4 w-4 text-gray-400" />}
                        label="Sponsor badge"
                        value={config.sponsorBadge}
                        isBoolean
                      />
                      <FeatureRow
                        icon={<Shield className="h-4 w-4 text-gray-400" />}
                        label="Priority support"
                        value={config.prioritySupport}
                        isBoolean
                      />
                    </ul>

                    {/* CTA */}
                    {isCurrentPlan ? (
                      <Button disabled className="w-full rounded-xl" variant="outline">
                        Current plan
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
                          {config.ctaLabel}
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
            Full feature comparison
          </h2>

          {isMarina && (
            <p className="text-center text-sm text-gray-500 mb-6">
              Marina profiles benefit from free membership. Upgrade to a sponsor package for enhanced visibility.
            </p>
          )}

          <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm">
            <table className="w-full text-sm" style={{ minWidth: '700px' }}>
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left px-5 py-4 text-gray-500 font-semibold" style={{ width: '180px', minWidth: '180px' }}>Feature</th>
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
                          {TIER_LABELS[tier]}
                        </span>
                        {isCurrentPlan && (
                          <span className="block text-xs text-secondary font-medium mt-1">Your plan</span>
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {/* Pricing */}
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  <td colSpan={7} className="px-5 py-2 text-xs font-bold text-gray-400 uppercase tracking-wider">Pricing</td>
                </tr>
                <ComparisonRow
                  label="Price"
                  values={TIERS.map((t) => getPrice(TIER_CONFIG[t]))}
                  isText
                />
                <ComparisonRow
                  label="Renewal"
                  values={TIERS.map((t) => TIER_CONFIG[t].renewalPrice || '—')}
                  isText
                />
                <ComparisonRow
                  label="Team members"
                  values={TIERS.map((t) => String(TIER_CONFIG[t].teamMembers))}
                  isText
                />

                {/* Platform Access */}
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  <td colSpan={7} className="px-5 py-2 text-xs font-bold text-gray-400 uppercase tracking-wider">Platform Access</td>
                </tr>
                <ComparisonRow
                  label="Resource library"
                  values={TIERS.map((t) => TIER_CONFIG[t].resourceAccess)}
                  isText
                />
                <ComparisonRow
                  label="Events access"
                  values={TIERS.map((t) => TIER_CONFIG[t].eventAccess)}
                  isText
                />
                <ComparisonRow
                  label="Public profile page"
                  values={TIERS.map((t) => TIER_CONFIG[t].publicProfile)}
                  isBoolean
                />
                <ComparisonRow
                  label="Network directory"
                  values={TIERS.map((t) => TIER_CONFIG[t].networkDirectory)}
                  isBoolean
                />

                {/* B2B Features */}
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  <td colSpan={7} className="px-5 py-2 text-xs font-bold text-gray-400 uppercase tracking-wider">B2B Features</td>
                </tr>
                <ComparisonRow
                  label="Connect requests / month"
                  values={TIERS.map((t) => TIER_CONFIG[t].connectRequests)}
                  isText
                />
                <ComparisonRow
                  label="Webinar requests"
                  values={TIERS.map((t) => TIER_CONFIG[t].webinarRequests)}
                  isText
                />
                <ComparisonRow
                  label="RFP submissions"
                  values={TIERS.map((t) => TIER_CONFIG[t].rfpAccess)}
                  isBoolean
                />
                <ComparisonRow
                  label="Consultation access"
                  values={TIERS.map((t) => TIER_CONFIG[t].consultationAccess)}
                  isBoolean
                />

                {/* Visibility & Support */}
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  <td colSpan={7} className="px-5 py-2 text-xs font-bold text-gray-400 uppercase tracking-wider">Visibility &amp; Support</td>
                </tr>
                <ComparisonRow
                  label="Sponsor badge"
                  values={TIERS.map((t) => TIER_CONFIG[t].sponsorBadge)}
                  isBoolean
                />
                <ComparisonRow
                  label="Priority support"
                  values={TIERS.map((t) => TIER_CONFIG[t].prioritySupport)}
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
            Not sure which plan fits?
          </h2>
          <p className="text-gray-500 mb-7">
            Sponsorship packages are tailored to your visibility goals and budget. Reach
            out to the M3 Connect team and we will find the right fit together.
          </p>
          <Button asChild className="rounded-xl bg-primary hover:bg-primary/90">
            <Link to="/contact">
              Contact us
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
  return (
    <li className="flex items-start gap-2.5">
      <span className="mt-0.5 flex-shrink-0">{icon}</span>
      <div className="flex-1 min-w-0">
        <span className="text-xs text-gray-500 block">{label}</span>
        {isBoolean ? (
          <span className="flex items-center gap-1 mt-0.5">
            {typeof value === 'boolean' && value ? (
              <><Check className="h-4 w-4 text-emerald-500" /><span className="text-xs font-medium text-emerald-600">Included</span></>
            ) : (
              <><X className="h-4 w-4 text-gray-300" /><span className="text-xs text-gray-400">Not included</span></>
            )}
          </span>
        ) : (
          <span className="text-sm font-semibold text-gray-800">
            {String(value)}
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
  return (
    <tr className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50 transition-colors">
      <td className="px-6 py-4 text-gray-600 font-medium">{label}</td>
      {values.map((v, idx) => (
        <td key={idx} className="px-4 py-4 text-center">
          {isBoolean ? (
            <FeatureValue value={v} isBoolean />
          ) : isText ? (
            <span className={`text-sm font-medium ${v === 'Unlimited' ? 'text-emerald-600' : v === 'Not included' ? 'text-gray-300' : 'text-gray-700'}`}>
              {String(v)}
            </span>
          ) : null}
        </td>
      ))}
    </tr>
  );
}
