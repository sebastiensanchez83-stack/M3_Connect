import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';

export function MentionsLegalesPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <Helmet>
        <title>Mentions Légales — M3 Connect</title>
      </Helmet>

      <div className="container mx-auto px-4 py-12 max-w-4xl">
        <Link to="/" className="inline-flex items-center gap-1 text-primary hover:underline mb-6 text-sm">
          <ChevronLeft className="h-4 w-4" />
          Retour à l'accueil
        </Link>

        <h1 className="text-3xl font-bold text-gray-900 mb-2">Mentions Légales</h1>
        <p className="text-sm text-gray-500 mb-8">Version du 6 mars 2026</p>

        <div className="bg-white rounded-xl shadow-sm border p-6 md:p-10 space-y-8 text-gray-700 leading-relaxed">
          {/* Article 1 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 1 — Éditeur du site</h2>
            <div className="bg-gray-50 rounded-lg p-4 text-sm space-y-1">
              <p><strong>Raison sociale :</strong> M3 Monaco SAM</p>
              <p><strong>Forme juridique :</strong> Société Anonyme Monégasque</p>
              <p><strong>Capital social :</strong> 150 000 EUR</p>
              <p><strong>RCI :</strong> I18S07927</p>
              <p><strong>N° TVA :</strong> FR24000139781</p>
              <p><strong>Siège social :</strong> 3 Boulevard des Moulins, Monte Carlo Palace, Office B21, 98000 Monaco</p>
            </div>
          </section>

          {/* Article 2 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 2 — Directeur de la publication</h2>
            <p>José Marco Casellini, CEO de M3 Monaco SAM.</p>
          </section>

          {/* Article 3 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 3 — Hébergement</h2>
            <div className="space-y-3">
              <div className="bg-gray-50 rounded-lg p-4 text-sm">
                <p><strong>Hébergeur principal :</strong> Netlify, Inc.</p>
                <p>512 2nd Street, Suite 200, San Francisco, CA 94107, États-Unis</p>
                <p><a href="https://www.netlify.com" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">www.netlify.com</a></p>
              </div>
              <p className="text-sm">Services additionnels : Supabase (base de données et authentification), Cloudflare (CDN et sécurité).</p>
            </div>
          </section>

          {/* Article 4 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 4 — Accès au site</h2>
            <p>M3 Monaco SAM s'efforce de maintenir l'accès au site mais ne saurait garantir une disponibilité permanente et ininterrompue. L'accès peut être temporairement suspendu pour des raisons de maintenance, de mise à jour ou de force majeure.</p>
          </section>

          {/* Article 5 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 5 — Propriété intellectuelle</h2>
            <p>L'ensemble des éléments composant le site (textes, images, logos, vidéos, logiciels, architecture, bases de données) est protégé par les lois relatives à la propriété intellectuelle. Toute reproduction, représentation, modification ou exploitation non autorisée est strictement interdite.</p>
          </section>

          {/* Article 6 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 6 — Liens hypertextes</h2>
            <p>La Plateforme peut contenir des liens vers des sites tiers. M3 Monaco SAM décline toute responsabilité quant au contenu de ces sites externes, sur lesquels elle n'exerce aucun contrôle.</p>
          </section>

          {/* Article 7 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 7 — Données personnelles et cookies</h2>
            <p>Les informations relatives au traitement des données personnelles sont détaillées dans notre <Link to="/privacy" className="text-primary hover:underline">Politique de Confidentialité</Link>.</p>
            <p className="mt-2">L'utilisation des cookies et traceurs est décrite dans notre <Link to="/cookies" className="text-primary hover:underline">Politique Cookies</Link>.</p>
          </section>

          {/* Article 8 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 8 — Droit applicable</h2>
            <p>Les présentes mentions légales sont régies par le droit monégasque. En cas de litige, les tribunaux de la Principauté de Monaco seront seuls compétents.</p>
          </section>

          {/* Contact */}
          <section className="border-t pt-6">
            <p className="text-sm text-gray-500">Pour toute question, veuillez contacter : <a href="mailto:info@m3monaco.com" className="text-primary hover:underline">info@m3monaco.com</a></p>
          </section>
        </div>
      </div>
    </div>
  );
}
