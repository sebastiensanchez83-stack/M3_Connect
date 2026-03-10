import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';

export function CookiePolicyPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <Helmet>
        <title>Politique Cookies — M3 Connect</title>
      </Helmet>

      <div className="container mx-auto px-4 py-12 max-w-4xl">
        <Link to="/" className="inline-flex items-center gap-1 text-primary hover:underline mb-6 text-sm">
          <ChevronLeft className="h-4 w-4" />
          Retour à l'accueil
        </Link>

        <h1 className="text-3xl font-bold text-gray-900 mb-2">Politique Cookies</h1>
        <p className="text-sm text-gray-500 mb-8">Version du 6 mars 2026</p>

        <div className="bg-white rounded-xl shadow-sm border p-6 md:p-10 space-y-8 text-gray-700 leading-relaxed">
          {/* Article 1 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 1 — Objet</h2>
            <p>La présente politique cookies décrit les conditions dans lesquelles M3 Connect utilise des cookies et technologies similaires sur le site et la plateforme connect.m3monaco.com.</p>
          </section>

          {/* Article 2 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 2 — Définition</h2>
            <p>Un cookie est un fichier ou identifiant susceptible d'être déposé ou lu sur le terminal de l'utilisateur lors de la consultation du site ou de l'utilisation de la plateforme. Des technologies similaires peuvent également être utilisées, telles que pixels, balises, local storage, SDK, empreintes techniques ou identifiants de session.</p>
          </section>

          {/* Article 3 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 3 — Catégories de traceurs utilisés</h2>
            <p>M3 Connect peut utiliser des traceurs strictement nécessaires au fonctionnement du site et de la plateforme, des traceurs de sécurité, des traceurs de mesure d'audience, des traceurs de préférences, des traceurs liés aux contenus embarqués et webinars, ainsi que des traceurs liés à des opérations de communication ou de remarketing B2B lorsque ces usages sont activés.</p>
            <div className="bg-gray-50 rounded-lg p-4 mt-3">
              <p className="text-sm font-medium text-gray-900 mb-2">Principaux services susceptibles de déposer des traceurs :</p>
              <ul className="list-disc list-inside text-sm space-y-1">
                <li><strong>Netlify</strong> — hébergement et CDN</li>
                <li><strong>Supabase</strong> — base de données et authentification</li>
                <li><strong>Google Analytics</strong> — mesure d'audience</li>
                <li><strong>HubSpot</strong> — CRM et communication B2B</li>
                <li><strong>YouTube</strong> — contenus vidéo embarqués</li>
                <li><strong>Zoom</strong> — webinars et événements en ligne</li>
                <li><strong>Cloudflare</strong> — CDN et sécurité</li>
                <li><strong>Google reCAPTCHA</strong> — protection anti-bots</li>
              </ul>
            </div>
          </section>

          {/* Article 4 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 4 — Finalités des cookies</h2>
            <p>Les traceurs peuvent notamment être utilisés pour :</p>
            <ul className="list-disc list-inside mt-2 space-y-1 text-sm">
              <li>Assurer le maintien de session et l'authentification</li>
              <li>Sécuriser le site</li>
              <li>Distinguer les utilisateurs légitimes des robots ou usages abusifs</li>
              <li>Mémoriser certaines préférences</li>
              <li>Mesurer l'audience</li>
              <li>Analyser les parcours de navigation</li>
              <li>Améliorer les performances techniques</li>
              <li>Intégrer des vidéos ou webinars</li>
              <li>Suivre l'efficacité de campagnes B2B</li>
              <li>Le cas échéant, réaliser des opérations de remarketing</li>
            </ul>
          </section>

          {/* Article 5 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 5 — Consentement</h2>
            <p>Les traceurs strictement nécessaires au fonctionnement ou à la sécurité du site peuvent être déposés sans consentement préalable lorsqu'ils sont réellement indispensables au service demandé.</p>
            <p className="mt-2">Les autres traceurs, notamment de mesure d'audience non exemptée, de remarketing, de contenus tiers embarqués ou de suivi marketing, doivent faire l'objet d'un consentement préalable lorsque la réglementation applicable l'exige.</p>
            <p className="mt-2">M3 Connect met en place un bandeau d'information cookies. Les préférences de l'utilisateur doivent pouvoir être gérées et modifiées à tout moment via un lien permanent de gestion des cookies accessible depuis le site.</p>
          </section>

          {/* Article 6 — Durée de conservation (numbered as 7 in original doc but logically Article 6) */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 6 — Durée de conservation</h2>
            <p>Les cookies et identifiants techniques sont conservés pour des durées proportionnées à leur finalité. Les durées peuvent varier selon le prestataire, le paramétrage du compte ou les choix exprimés par l'utilisateur.</p>
            <p className="mt-2">Sauf obligation différente liée au prestataire concerné, M3 entend limiter les durées techniques aux stricts besoins du service et privilégier des durées courtes pour les traceurs non essentiels.</p>
          </section>

          {/* Article 7 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 7 — Paramétrage du navigateur</h2>
            <p>L'utilisateur peut également configurer son navigateur pour bloquer tout ou partie des cookies. Un tel paramétrage peut toutefois altérer le fonctionnement normal du site ou de certaines fonctionnalités.</p>
          </section>

          {/* Article 8 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 8 — Liens utiles</h2>
            <p>Pour en savoir plus sur la gestion des cookies et données personnelles :</p>
            <ul className="list-disc list-inside mt-2 space-y-1 text-sm">
              <li><Link to="/privacy" className="text-primary hover:underline">Politique de Confidentialité</Link></li>
              <li><Link to="/terms" className="text-primary hover:underline">Conditions Générales d'Utilisation</Link></li>
              <li><Link to="/mentions-legales" className="text-primary hover:underline">Mentions Légales</Link></li>
            </ul>
          </section>

          {/* Contact */}
          <section className="border-t pt-6">
            <p className="text-sm text-gray-500">Pour toute question relative à la présente politique cookies, veuillez contacter : <a href="mailto:info@m3monaco.com" className="text-primary hover:underline">info@m3monaco.com</a></p>
          </section>
        </div>
      </div>
    </div>
  );
}
