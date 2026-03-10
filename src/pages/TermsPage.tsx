import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';

export function TermsPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <Helmet>
        <title>Conditions Générales d'Utilisation — M3 Connect</title>
      </Helmet>

      <div className="container mx-auto px-4 py-12 max-w-4xl">
        <Link to="/" className="inline-flex items-center gap-1 text-primary hover:underline mb-6 text-sm">
          <ChevronLeft className="h-4 w-4" />
          Retour à l'accueil
        </Link>

        <h1 className="text-3xl font-bold text-gray-900 mb-2">Conditions Générales d'Utilisation</h1>
        <p className="text-sm text-gray-500 mb-8">Version du 6 mars 2026</p>

        <div className="bg-white rounded-xl shadow-sm border p-6 md:p-10 space-y-8 text-gray-700 leading-relaxed">
          {/* Article 1 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 1 — Objet</h2>
            <p>Les présentes conditions générales d'utilisation (ci-après « CGU ») régissent l'accès et l'utilisation de la plateforme M3 Connect, accessible à l'adresse connect.m3monaco.com (ci-après la « Plateforme »), éditée par M3 Monaco SAM.</p>
            <p className="mt-2">La Plateforme est un écosystème B2B dédié au secteur des marinas, yacht clubs, waterfronts, ports de plaisance et écoles de voile. Elle propose notamment : un site vitrine, des espaces membres et partenaires, une bibliothèque de ressources, des webinaires et replays, des formulaires de contact, des fonctionnalités de paiement et de sollicitations commerciales.</p>
          </section>

          {/* Article 2 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 2 — Identification de l'éditeur</h2>
            <div className="bg-gray-50 rounded-lg p-4 text-sm space-y-1">
              <p><strong>Raison sociale :</strong> M3 Monaco SAM</p>
              <p><strong>Capital social :</strong> 150 000 EUR</p>
              <p><strong>RCI :</strong> I18S07927</p>
              <p><strong>Siège social :</strong> 3 Boulevard des Moulins, Monte Carlo Palace, Office B21, 98000 Monaco</p>
              <p><strong>Directeur de la publication :</strong> José Marco Casellini, CEO</p>
            </div>
          </section>

          {/* Article 3 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 3 — Acceptation des CGU</h2>
            <p>L'accès et l'utilisation de la Plateforme impliquent l'acceptation pleine et entière des présentes CGU. Tout utilisateur agissant pour le compte d'une organisation déclare être dûment habilité à engager ladite organisation.</p>
          </section>

          {/* Article 4 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 4 — Accès à la Plateforme et catégories d'utilisateurs</h2>
            <p>L'accès à certaines fonctionnalités de la Plateforme nécessite la création d'un compte utilisateur, soumise à une validation manuelle par M3 Monaco SAM.</p>
            <p className="mt-2">Les catégories d'utilisateurs sont les suivantes :</p>
            <ul className="list-disc list-inside mt-2 space-y-1 text-sm">
              <li><strong>Visiteur</strong> — accès libre au contenu public</li>
              <li><strong>Membre</strong> — utilisateur inscrit et validé</li>
              <li><strong>Marina</strong> — opérateur de marina, port ou yacht club</li>
              <li><strong>Partner</strong> — prestataire de services pour le secteur</li>
              <li><strong>Certified Partner</strong> — partenaire certifié par M3 Monaco</li>
              <li><strong>Media Partner</strong> — partenaire média spécialisé</li>
              <li><strong>Administrateur</strong> — personnel M3 Monaco</li>
              <li><strong>Modérateur</strong> — contributeur éditorial habilité</li>
            </ul>
          </section>

          {/* Article 5 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 5 — Compte utilisateur</h2>
            <p>Chaque utilisateur s'engage à fournir des informations exactes et à jour lors de l'inscription. Le compte est strictement personnel et l'utilisateur est responsable de la confidentialité de ses identifiants de connexion.</p>
          </section>

          {/* Article 6 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 6 — Fonctionnalités et règles d'usage</h2>
            <p>L'utilisation de la Plateforme doit se faire à des fins professionnelles et licites. Il est strictement interdit de :</p>
            <ul className="list-disc list-inside mt-2 space-y-1 text-sm">
              <li>Effectuer du scraping, de la copie automatisée ou de l'extraction de données</li>
              <li>Utiliser des bots, robots ou tout dispositif automatisé</li>
              <li>Diffuser des virus, logiciels malveillants ou contenus non autorisés</li>
              <li>Porter atteinte à la sécurité ou au bon fonctionnement de la Plateforme</li>
            </ul>
          </section>

          {/* Article 7 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 7 — Contenus, publications et sollicitations d'offres</h2>
            <p>Les publications sur la Plateforme sont soumises à l'approbation préalable de M3 Monaco SAM, qui dispose d'un pouvoir de modération éditoriale. Les contenus doivent être conformes aux standards professionnels du secteur.</p>
          </section>

          {/* Article 8 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 8 — Mise en relation et interactions entre membres</h2>
            <p>La Plateforme facilite la mise en relation B2B qualifiée entre ses utilisateurs. M3 Monaco SAM ne garantit aucun résultat commercial et ne prélève aucune commission automatique sur les transactions conclues entre membres ou partenaires.</p>
          </section>

          {/* Article 9 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 9 — Propriété intellectuelle</h2>
            <p>L'ensemble des contenus présents sur la Plateforme (textes, images, logos, vidéos, logiciels, bases de données) sont protégés par le droit de la propriété intellectuelle. L'utilisateur bénéficie d'un droit d'usage non exclusif, non transférable et révocable, limité à la consultation personnelle dans le cadre professionnel.</p>
          </section>

          {/* Article 10 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 10 — Données personnelles</h2>
            <p>Le traitement des données personnelles est régi par la <Link to="/privacy" className="text-primary hover:underline">Politique de Confidentialité</Link> accessible sur la Plateforme.</p>
          </section>

          {/* Article 11 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 11 — Disponibilité, maintenance et sécurité</h2>
            <p>M3 Monaco SAM s'efforce d'assurer la disponibilité de la Plateforme mais ne garantit pas un fonctionnement permanent, continu ou exempt d'erreurs. Des opérations de maintenance peuvent entraîner des interruptions temporaires.</p>
          </section>

          {/* Article 12 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 12 — Suspension et suppression de compte</h2>
            <p>M3 Monaco SAM se réserve le droit de suspendre ou supprimer tout compte utilisateur en cas de violation des présentes CGU, de fraude, d'atteinte à la sécurité de la Plateforme ou de tout comportement contraire aux usages professionnels.</p>
          </section>

          {/* Article 13 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 13 — Responsabilité</h2>
            <p>M3 Monaco SAM est soumise à une obligation de moyens. Sa responsabilité est limitée :</p>
            <ul className="list-disc list-inside mt-2 space-y-1 text-sm">
              <li>Pour les utilisateurs non payants : plafonnée à <strong>100 EUR</strong></li>
              <li>Pour les utilisateurs payants : plafonnée au montant des sommes effectivement versées au cours des <strong>12 derniers mois</strong></li>
            </ul>
            <p className="mt-2">M3 Monaco SAM ne saurait être tenue responsable des dommages indirects, pertes de données, de chiffre d'affaires ou de contrats.</p>
          </section>

          {/* Article 14 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 14 — Modification des CGU</h2>
            <p>M3 Monaco SAM se réserve le droit de modifier les présentes CGU à tout moment. Les utilisateurs seront informés de toute modification substantielle. L'utilisation continue de la Plateforme après modification vaut acceptation des nouvelles CGU.</p>
          </section>

          {/* Article 15 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 15 — Droit applicable et juridiction compétente</h2>
            <p>Les présentes CGU sont régies par le droit monégasque. En cas de litige, les tribunaux de la Principauté de Monaco seront seuls compétents.</p>
          </section>

          {/* Contact */}
          <section className="border-t pt-6">
            <p className="text-sm text-gray-500">Pour toute question relative aux présentes CGU, veuillez contacter : <a href="mailto:info@m3monaco.com" className="text-primary hover:underline">info@m3monaco.com</a></p>
          </section>
        </div>
      </div>
    </div>
  );
}
