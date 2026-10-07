import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Seo } from '@/components/seo/Seo';
import { Anchor, Globe, Users, Link2, Building2, Target, Lightbulb, ArrowRight } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageHero } from '@/components/ui/PageHero';
import { MomentsStrip } from '@/components/ui/MomentsStrip';
import { SITE_IMAGES, PERSONA_IMAGES } from '@/lib/siteMedia';
import { withSiteSuffix } from '@/lib/seoText';

export function AboutPage() {
  const { t } = useTranslation();
  const seoTitle = withSiteSuffix(t('seo.about.title', 'About Smart Marina Connect, by M3 Monaco'));
  const seoDescription = t('seo.about.description', 'Smart Marina Connect is the marina industry network run by M3 Monaco, organiser of industry events in Monaco, Dubai and online.');

  return (
    <div className="min-h-screen">
      <Seo title={seoTitle} description={seoDescription} path="/about" />
      {/* Hero — the SM26 community under the event's own screen */}
      <PageHero
        image={SITE_IMAGES.aboutHero}
        seed="about-hero"
        containerClassName="max-w-5xl"
        icon={Anchor}
        eyebrow={t('about.eyebrow', 'By M3 Monaco')}
        title={t('about.title', 'About Smart Marina Connect')}
        subtitle={t(
          'about.hero',
          'The network of marinas and the companies that serve them. Smart Marina Connect is run by M3 Monaco, organiser of industry events in Monaco, Dubai and online.'
        )}
      />

      {/* Mission Section */}
      <section className="py-16 bg-white">
        <div className="container mx-auto px-4 max-w-5xl">
          <div className="flex items-center gap-3 mb-6">
            <Target className="h-8 w-8 text-primary" />
            <h2 className="text-3xl font-bold text-gray-900">
              {t('about.missionTitle', 'Our mission')}
            </h2>
          </div>
          <p className="text-lg text-gray-600 leading-relaxed max-w-3xl">
            {t(
              'about.mission',
              'Help marinas find the right service providers, and help those providers understand what marinas need.'
            )}
          </p>
          <p className="text-lg text-gray-600 leading-relaxed max-w-3xl mt-4">
            {t(
              'about.missionDetail',
              "Marinas publish their needs, service providers answer them, and both meet at M3's events in Monaco, Dubai and online. The M3 team checks every member, so you know who you are talking to."
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
              {t('about.whatWeDoTitle', 'What we do')}
            </h2>
          </div>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            <Card className="border-none shadow-md">
              <CardContent className="pt-6">
                <Globe className="h-10 w-10 text-primary mb-4" />
                <h3 className="text-xl font-semibold mb-2">
                  {t('about.feature1Title', 'Resources')}
                </h3>
                <p className="text-gray-600">
                  {t(
                    'about.feature1Desc',
                    'Articles on marina infrastructure, design, digital, energy, operations and business, sorted by theme.'
                  )}
                </p>
              </CardContent>
            </Card>

            <Card className="border-none shadow-md">
              <CardContent className="pt-6">
                <Link2 className="h-10 w-10 text-primary mb-4" />
                <h3 className="text-xl font-semibold mb-2">
                  {t('about.feature2Title', 'Introductions')}
                </h3>
                <p className="text-gray-600">
                  {t(
                    'about.feature2Desc',
                    'Marinas publish tenders, projects and expert questions. Service providers answer them and request introductions.'
                  )}
                </p>
              </CardContent>
            </Card>

            <Card className="border-none shadow-md">
              <CardContent className="pt-6">
                <Users className="h-10 w-10 text-primary mb-4" />
                <h3 className="text-xl font-semibold mb-2">
                  {t('about.feature3Title', 'Events & webinars')}
                </h3>
                <p className="text-gray-600">
                  {t(
                    'about.feature3Desc',
                    'The Monaco Smart & Sustainable Marina Rendezvous, the World Yachting Summit in Dubai and webinars online.'
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
              {t('about.whoWeServeTitle', 'Who it is for')}
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
                    'Marina operators and managers looking for service providers, industry knowledge and proven solutions.'
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
                  {t('about.audience2Title', 'Service providers')}
                </h3>
                <p className="text-gray-600">
                  {t(
                    'about.audience2Desc',
                    'Technology providers, consultants and service companies working for marinas: a company page in the directory, the needs marinas publish, and introductions.'
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
                  {t('about.audience3Title', 'Media')}
                </h3>
                <p className="text-gray-600">
                  {t(
                    'about.audience3Desc',
                    'Journalists and publications covering marinas and the nautical sector: press accreditation for our events, news and replays.'
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
              'Smart Marina Connect is run by M3 Monaco, based in the Principality of Monaco. M3 organises the Monaco Smart & Sustainable Marina Rendezvous, the World Yachting Summit in Dubai and webinars for the marina industry.'
            )}
          </p>
          <p className="text-lg text-gray-600 leading-relaxed max-w-3xl mt-4">
            {t(
              'about.companyDesc2',
              "The team brings together marina management professionals and event organisers who know the sector's challenges first-hand."
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
            {t('about.ctaTitle', 'Join the marina network')}
          </h2>
          <p className="text-lg text-white/90 mb-8 max-w-2xl mx-auto">
            {t(
              'about.ctaDesc',
              'Marina, service provider, investor, developer or media: sign up and the M3 team checks your company. A question first? Write to us.'
            )}
          </p>
          <div className="flex flex-wrap justify-center gap-4">
            <Button asChild size="lg" variant="secondary">
              <Link to="/become-partner">
                {t('about.ctaSignup', 'Sign up')}
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
                {t('about.ctaContact', 'Contact us')}
              </Link>
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
