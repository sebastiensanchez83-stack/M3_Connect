import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { Anchor, Globe, Users, Link2, Building2, Target, Lightbulb, ArrowRight } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageHero } from '@/components/ui/PageHero';
import { MomentsStrip } from '@/components/ui/MomentsStrip';
import { SITE_IMAGES, PERSONA_IMAGES } from '@/lib/siteMedia';

export function AboutPage() {
  const { t } = useTranslation();

  return (
    <div className="min-h-screen">
      <Helmet>
        <title>About — Smart Marina Connect</title>
        <meta name="description" content="Learn about Smart Marina Connect, the B2B platform connecting marinas, ports and service providers in the yachting industry." />
      </Helmet>
      {/* Hero — the SM26 community under the event's own screen */}
      <PageHero
        image={SITE_IMAGES.aboutHero}
        seed="about-hero"
        containerClassName="max-w-5xl"
        icon={Anchor}
        eyebrow="Monaco Marina Management"
        title={t('about.title', 'About Smart Marina Connect')}
        subtitle={t(
          'about.hero',
          'The B2B platform dedicated to the global marina industry. We connect marinas with qualified partners and media professionals to foster collaboration, knowledge sharing, and business growth across the sector.'
        )}
      />

      {/* Mission Section */}
      <section className="py-16 bg-white">
        <div className="container mx-auto px-4 max-w-5xl">
          <div className="flex items-center gap-3 mb-6">
            <Target className="h-8 w-8 text-primary" />
            <h2 className="text-3xl font-bold text-gray-900">
              {t('about.missionTitle', 'Our Mission')}
            </h2>
          </div>
          <p className="text-lg text-gray-600 leading-relaxed max-w-3xl">
            {t(
              'about.mission',
              'Our mission is to foster collaboration, knowledge sharing, and sustainable growth across the global marina ecosystem by providing a centralized platform for networking and business development.'
            )}
          </p>
          <p className="text-lg text-gray-600 leading-relaxed max-w-3xl mt-4">
            {t(
              'about.missionDetail',
              'We believe the marina industry deserves a dedicated space where professionals can discover new solutions, share expertise, and build meaningful business relationships that drive the entire sector forward.'
            )}
          </p>
        </div>
      </section>

      {/* What We Do Section */}
      <section className="py-16 bg-gray-50">
        <div className="container mx-auto px-4 max-w-5xl">
          <div className="flex items-center gap-3 mb-10">
            <Lightbulb className="h-8 w-8 text-primary" />
            <h2 className="text-3xl font-bold text-gray-900">
              {t('about.whatWeDoTitle', 'What We Do')}
            </h2>
          </div>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            <Card className="border-none shadow-md">
              <CardContent className="pt-6">
                <Globe className="h-10 w-10 text-primary mb-4" />
                <h3 className="text-xl font-semibold mb-2">
                  {t('about.feature1Title', 'Industry Resources')}
                </h3>
                <p className="text-gray-600">
                  {t(
                    'about.feature1Desc',
                    'Curated articles, reports, and guides covering the latest trends, regulations, and best practices in marina management and operations.'
                  )}
                </p>
              </CardContent>
            </Card>

            <Card className="border-none shadow-md">
              <CardContent className="pt-6">
                <Link2 className="h-10 w-10 text-primary mb-4" />
                <h3 className="text-xl font-semibold mb-2">
                  {t('about.feature2Title', 'B2B Matching')}
                </h3>
                <p className="text-gray-600">
                  {t(
                    'about.feature2Desc',
                    'Connect marinas with qualified technology and service partners through our smart matching system. Submit projects, request proposals, and find the right solutions.'
                  )}
                </p>
              </CardContent>
            </Card>

            <Card className="border-none shadow-md">
              <CardContent className="pt-6">
                <Users className="h-10 w-10 text-primary mb-4" />
                <h3 className="text-xl font-semibold mb-2">
                  {t('about.feature3Title', 'Events & Webinars')}
                </h3>
                <p className="text-gray-600">
                  {t(
                    'about.feature3Desc',
                    'Participate in industry events, conferences, and webinars. Network with peers and stay ahead of market developments.'
                  )}
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* Who We Serve Section */}
      <section className="py-16 bg-white">
        <div className="container mx-auto px-4 max-w-5xl">
          <div className="flex items-center gap-3 mb-10">
            <Users className="h-8 w-8 text-primary" />
            <h2 className="text-3xl font-bold text-gray-900">
              {t('about.whoWeServeTitle', 'Who We Serve')}
            </h2>
          </div>
          {/* Photo cards: who the platform is for, shown with the people and work it serves. */}
          <div className="grid gap-8 md:grid-cols-3">
            <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-gray-100">
              <div className="relative aspect-[3/2] bg-primary/5">
                <img src={PERSONA_IMAGES.marinas} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
                <span className="absolute left-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/95 text-primary shadow-sm">
                  <Anchor className="h-5 w-5" aria-hidden="true" />
                </span>
              </div>
              <div className="p-6">
                <h3 className="text-xl font-semibold mb-3">
                  {t('about.audience1Title', 'Marinas')}
                </h3>
                <p className="text-gray-600">
                  {t(
                    'about.audience1Desc',
                    'Marina operators and managers looking for qualified partners, industry knowledge, and proven solutions to improve their operations and services.'
                  )}
                </p>
              </div>
            </div>

            <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-gray-100">
              <div className="relative aspect-[3/2] bg-primary/5">
                <img src={PERSONA_IMAGES.suppliers} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
                <span className="absolute left-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/95 text-primary shadow-sm">
                  <Building2 className="h-5 w-5" aria-hidden="true" />
                </span>
              </div>
              <div className="p-6">
                <h3 className="text-xl font-semibold mb-3">
                  {t('about.audience2Title', 'Partners')}
                </h3>
                <p className="text-gray-600">
                  {t(
                    'about.audience2Desc',
                    'Technology providers, consultants, and service companies serving the marina industry. Gain visibility, connect with marinas, and grow your business.'
                  )}
                </p>
              </div>
            </div>

            <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-gray-100">
              <div className="relative aspect-[3/2] bg-primary/5">
                <img src={PERSONA_IMAGES.media} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
                <span className="absolute left-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/95 text-primary shadow-sm">
                  <Globe className="h-5 w-5" aria-hidden="true" />
                </span>
              </div>
              <div className="p-6">
                <h3 className="text-xl font-semibold mb-3">
                  {t('about.audience3Title', 'Media Professionals')}
                </h3>
                <p className="text-gray-600">
                  {t(
                    'about.audience3Desc',
                    'Journalists, content creators, and industry publications covering the marina and nautical sector. Access press releases, expert insights, and event coverage.'
                  )}
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Company Section */}
      <section className="py-16 bg-gray-50">
        <div className="container mx-auto px-4 max-w-5xl">
          <div className="flex items-center gap-3 mb-6">
            <Building2 className="h-8 w-8 text-primary" />
            <h2 className="text-3xl font-bold text-gray-900">
              {t('about.companyTitle', 'M3 Monaco')}
            </h2>
          </div>
          <p className="text-lg text-gray-600 leading-relaxed max-w-3xl">
            {t(
              'about.companyDesc',
              'Smart Marina Connect is operated by M3 Monaco, based in the Principality of Monaco. With deep expertise in the marina industry, M3 is committed to advancing the sector through professional networking and business development.'
            )}
          </p>
          <p className="text-lg text-gray-600 leading-relaxed max-w-3xl mt-4">
            {t(
              'about.companyDesc2',
              'Our team brings together marina management professionals, technology experts, and industry veterans who understand the unique challenges and opportunities facing the global marina ecosystem.'
            )}
          </p>
        </div>
      </section>

      {/* Relive SM26 — the network in person */}
      <MomentsStrip className="bg-white" />

      {/* CTA Section */}
      <section className="py-16 bg-primary text-white">
        <div className="container mx-auto px-4 max-w-5xl text-center">
          <h2 className="text-3xl font-bold mb-4">
            {t('about.ctaTitle', 'Ready to Join the Marina Community?')}
          </h2>
          <p className="text-lg text-white/90 mb-8 max-w-2xl mx-auto">
            {t(
              'about.ctaDesc',
              'Whether you are a marina operator, technology partner, or media professional, Smart Marina Connect is your gateway to the global marina industry.'
            )}
          </p>
          <div className="flex flex-wrap justify-center gap-4">
            <Button asChild size="lg" variant="secondary">
              <Link to="/signup">
                {t('about.ctaSignup', 'Create an Account')}
                <ArrowRight className="ml-2 h-5 w-5" />
              </Link>
            </Button>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="border-white text-white hover:bg-white/10"
            >
              <Link to="/contact">
                {t('about.ctaContact', 'Contact Us')}
              </Link>
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
