import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { TIER_LABELS, TIER_COLORS, OrgTier } from '@/types/database';
import {
  Check, X, Minus, Ticket, Users, Wifi, Star, Mail, ArrowRight,
} from 'lucide-react';

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

interface TierFeatures {
  price: string;
  priceNote: string | null;
  connectRequests: string;
  webinarRequests: string;
  teamMembers: number;
  sponsorBadge: boolean;
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
  'main_sponsor',
];

const TIER_CONFIG: Record<OrgTier, TierFeatures> = {
  member: {
    price: '€0',
    priceNote: 'Free forever',
    connectRequests: '5',
    webinarRequests: 'Not included',
    teamMembers: 1,
    sponsorBadge: false,
    ctaLabel: 'Join as Member',
    ctaHref: '/become-partner',
    ctaVariant: 'outline',
    highlighted: false,
  },
  innovation_partner: {
    price: 'Contact us',
    priceNote: 'Annual invoice',
    connectRequests: '20',
    webinarRequests: '5 / year',
    teamMembers: 5,
    sponsorBadge: true,
    ctaLabel: 'Request upgrade',
    ctaHref: '/account?tab=organization',
    ctaVariant: 'default',
    highlighted: false,
  },
  associate_partner: {
    price: 'Contact us',
    priceNote: 'Annual invoice',
    connectRequests: 'Unlimited',
    webinarRequests: 'Unlimited',
    teamMembers: 10,
    sponsorBadge: true,
    ctaLabel: 'Request upgrade',
    ctaHref: '/account?tab=organization',
    ctaVariant: 'default',
    highlighted: true,
  },
  premium_partner: {
    price: 'Contact us',
    priceNote: 'Annual invoice',
    connectRequests: 'Unlimited',
    webinarRequests: 'Unlimited',
    teamMembers: 15,
    sponsorBadge: true,
    ctaLabel: 'Request upgrade',
    ctaHref: '/account?tab=organization',
    ctaVariant: 'default',
    highlighted: false,
  },
  main_sponsor: {
    price: 'Contact us',
    priceNote: 'Annual invoice',
    connectRequests: 'Unlimited',
    webinarRequests: 'Unlimited',
    teamMembers: 25,
    sponsorBadge: true,
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

export function TiersPage() {
  const { organization } = useAuth();
  const currentTier = organization?.tier ?? null;

  return (
    <>
      <Helmet>
        <title>Membership & Sponsorship | M3 Connect</title>
        <meta
          name="description"
          content="Choose the M3 Connect membership tier that fits your organization — from free member access to full main sponsor visibility in the marina industry."
        />
      </Helmet>

      {/* ── Hero ───────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-gradient-to-br from-primary/5 via-white to-teal-50 py-20 px-4">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-primary/10 via-transparent to-transparent pointer-events-none" />
        <div className="container mx-auto max-w-4xl text-center relative">
          <Badge
            variant="outline"
            className="mb-4 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-primary border-primary/30 bg-primary/5"
          >
            <Ticket className="h-3.5 w-3.5 mr-1.5" />
            Membership Plans
          </Badge>
          <h1 className="text-4xl sm:text-5xl font-bold text-gray-900 tracking-tight mb-5">
            Membership &amp; Sponsorship
          </h1>
          <p className="text-lg text-gray-500 max-w-2xl mx-auto leading-relaxed">
            Join the premier B2B network for the marina industry. Start for free and
            upgrade as your visibility needs grow.
          </p>
        </div>
      </section>

      {/* ── Tier Cards ─────────────────────────────────────────────────────── */}
      <section className="py-16 px-4 bg-white">
        <div className="container mx-auto max-w-7xl">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-5 items-stretch">
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
                  } ${isCurrentPlan ? 'ring-2 ring-teal-500' : ''}`}
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
                      <Badge className="px-3 py-0.5 text-xs font-semibold bg-teal-500 text-white shadow-sm">
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
                      <span className="text-3xl font-bold text-gray-900">{config.price}</span>
                    </div>
                    {config.priceNote && (
                      <p className="text-xs text-gray-400">{config.priceNote}</p>
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
                        icon={<Star className="h-4 w-4 text-gray-400" />}
                        label="Sponsor badge"
                        value={config.sponsorBadge}
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
                            ? 'bg-gradient-to-r from-primary to-teal-600 hover:opacity-90 transition-opacity text-white'
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
      <section className="py-16 px-4 bg-gray-50">
        <div className="container mx-auto max-w-6xl">
          <h2 className="text-2xl font-bold text-gray-900 text-center mb-10">
            Full feature comparison
          </h2>

          <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left px-6 py-4 text-gray-500 font-semibold w-48">Feature</th>
                  {TIERS.map((tier) => {
                    const colors = TIER_COLORS[tier];
                    const isCurrentPlan = currentTier === tier;
                    return (
                      <th key={tier} className="px-4 py-4 text-center">
                        <span
                          className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${colors.bg} ${colors.text} border ${colors.border} ${
                            isCurrentPlan ? 'ring-1 ring-teal-400' : ''
                          }`}
                        >
                          {TIER_LABELS[tier]}
                        </span>
                        {isCurrentPlan && (
                          <span className="block text-xs text-teal-500 font-medium mt-1">Your plan</span>
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                <ComparisonRow
                  label="Price"
                  values={TIERS.map((t) => TIER_CONFIG[t].price)}
                  isText
                />
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
                  label="Team members"
                  values={TIERS.map((t) => String(TIER_CONFIG[t].teamMembers))}
                  isText
                />
                <ComparisonRow
                  label="Sponsor badge"
                  values={TIERS.map((t) => TIER_CONFIG[t].sponsorBadge)}
                  isBoolean
                />
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ── Contact CTA ─────────────────────────────────────────────────────── */}
      <section className="py-16 px-4 bg-white">
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
          <Button asChild className="rounded-xl bg-gradient-to-r from-primary to-teal-600 hover:opacity-90 transition-opacity">
            <Link to="/contact">
              Contact us
              <ArrowRight className="h-4 w-4 ml-2" />
            </Link>
          </Button>
        </div>
      </section>
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
