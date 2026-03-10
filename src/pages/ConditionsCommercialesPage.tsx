import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';

export function ConditionsCommercialesPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <Helmet>
        <title>Conditions Commerciales — M3 Connect</title>
      </Helmet>

      <div className="container mx-auto px-4 py-12 max-w-4xl">
        <Link to="/" className="inline-flex items-center gap-1 text-primary hover:underline mb-6 text-sm">
          <ChevronLeft className="h-4 w-4" />
          Retour à l'accueil
        </Link>

        <h1 className="text-3xl font-bold text-gray-900 mb-2">Conditions Commerciales des Offres Payantes et Partenaires</h1>
        <p className="text-sm text-gray-500 mb-8">Version du 6 mars 2026</p>

        <div className="bg-white rounded-xl shadow-sm border p-6 md:p-10 space-y-8 text-gray-700 leading-relaxed">
          {/* Article 1 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 1 — Objet et champ d'application</h2>
            <p>Les présentes conditions commerciales s'appliquent aux offres payantes, abonnements, campagnes de visibilité, accès premium, sponsorings, insertions, espaces partenaires et plus généralement à toute offre commerciale M3 Connect souscrite par un client, un partenaire ou un membre payant.</p>
            <p className="mt-2">Elles complètent les <Link to="/terms" className="text-primary hover:underline">CGU</Link> et, en cas de contradiction, prévalent pour tout ce qui concerne les conditions financières, les modalités d'abonnement, de renouvellement, de suspension et de résiliation des offres payantes.</p>
          </section>

          {/* Article 2 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 2 — Nature des offres</h2>
            <p>M3 Connect peut commercialiser notamment des memberships, accès premium, profils partner ou certified partner, espaces media partner, campagnes de visibilité, insertions éditoriales, sponsorings, accès à certains contenus ou workshops, packages de présence ou d'exposition et toute autre formule professionnelle définie par M3.</p>
            <p className="mt-2">Le contenu exact de chaque offre, son périmètre, sa durée, son prix, son niveau d'accès, ses conditions particulières et ses éventuelles limitations sont définis dans la proposition commerciale, le bon de commande, l'ordre d'insertion ou la page tarifaire applicable.</p>
          </section>

          {/* Article 3 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 3 — Souscription et formation du contrat</h2>
            <p>La souscription d'une offre payante intervient à la date de signature du document commercial applicable, d'acceptation en ligne, ou de paiement effectif lorsque la plateforme permet une souscription numérique.</p>
            <p className="mt-2">M3 se réserve le droit de refuser une souscription pour motif légitime, notamment en cas de risque de conformité, d'atteinte à la réputation, d'incohérence sectorielle, de conflit d'intérêts, d'informations inexactes, de non-paiement antérieur ou d'usage incompatible avec le positionnement de M3 Connect.</p>
          </section>

          {/* Article 4 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 4 — Prix et modalités de paiement</h2>
            <p>Sauf mention contraire, les prix sont exprimés en euros, hors taxes, et payables d'avance.</p>
            <p className="mt-2">Le règlement peut intervenir par virement, carte bancaire ou tout autre moyen proposé par M3 ou son prestataire bancaire ou de paiement.</p>
            <p className="mt-2">Tout retard de paiement autorise M3, sans préjudice de ses autres droits, à suspendre l'accès à l'offre concernée, à geler le compte associé, à suspendre toute publication ou visibilité en cours et à exiger le paiement immédiat de toute somme due.</p>
          </section>

          {/* Article 5 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 5 — Durée et renouvellement</h2>
            <p>Sauf mention particulière dans le document commercial applicable, les abonnements et memberships sont conclus pour une durée initiale de douze mois et se renouvellent tacitement par périodes successives de douze mois.</p>
            <p className="mt-2">La partie qui ne souhaite pas le renouvellement doit notifier sa décision par écrit au moins trente jours calendaires avant l'échéance de la période en cours.</p>
            <p className="mt-2">Les offres ponctuelles, campagnes, sponsorings, ordres d'insertion et opérations limitées dans le temps prennent fin au terme prévu dans le document commercial applicable, sans reconduction automatique sauf stipulation contraire.</p>
          </section>

          {/* Article 6 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 6 — Absence de droit de rétractation professionnel</h2>
            <p>Les offres M3 Connect étant destinées à des professionnels, aucun droit de rétractation n'est ouvert sauf disposition impérative contraire expressément applicable.</p>
          </section>

          {/* Article 7 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 7 — Résiliation anticipée</h2>
            <p>En cas de manquement grave par l'une des parties à ses obligations essentielles, non réparé dans un délai de quinze jours à compter d'une mise en demeure écrite, l'autre partie pourra résilier l'offre concernée de plein droit, sans préjudice de tous dommages et intérêts auxquels elle pourrait prétendre.</p>
            <p className="mt-2">En cas de non-paiement, d'atteinte grave à l'image de M3, d'usage abusif de la plateforme, de contenu illicite ou de violation répétée des CGU, M3 pourra suspendre immédiatement l'exécution puis résilier l'accès ou l'offre concernée si la situation n'est pas régularisée.</p>
          </section>

          {/* Article 8 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 8 — Remboursement</h2>
            <p>Sauf disposition contraire figurant dans un document commercial spécifique ou faute avérée de M3 rendant le service totalement inutilisable de manière durable, les sommes versées demeurent acquises et ne font pas l'objet d'un remboursement prorata temporis.</p>
            <p className="mt-2">Lorsqu'une offre est interrompue du fait exclusif de M3 pour convenance interne avant son terme sans faute du client, M3 pourra proposer au choix un report, un avoir ou un remboursement partiel calculé de bonne foi.</p>
          </section>

          {/* Article 9 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 9 — Visibilité, sponsoring et insertions</h2>
            <p>Les espaces de visibilité, sponsorings, insertions partenaires, mises en avant ou publications à vocation commerciale sont diffusés selon les formats, emplacements, périodes, quotas, validations éditoriales et standards de qualité définis par M3.</p>
            <p className="mt-2">M3 conserve un droit de regard éditorial sur toute création, ressource, visuel, texte, communiqué, bannière, publication ou contenu sponsorisé destiné à apparaître sur M3 Connect.</p>
            <p className="mt-2">M3 peut refuser ou retirer tout contenu commercial non conforme aux lois applicables, à sa ligne éditoriale, à son image ou au secteur ciblé.</p>
          </section>

          {/* Article 10 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 10 — Absence de garantie de résultat commercial</h2>
            <p>Sauf engagement écrit contraire, M3 ne garantit ni volume de leads, ni nombre de rendez-vous, ni nombre de vues, ni nombre d'introductions, ni montant de contrats, ni conversion commerciale, ni retombées médias.</p>
            <p className="mt-2">La valeur d'une offre M3 Connect peut résulter d'une combinaison de visibilité, de positionnement, d'accès à l'écosystème, de contenus, de présence éditoriale et d'opportunités de mise en relation, sans garantie de résultat quantifié.</p>
          </section>

          {/* Article 11 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 11 — Pas de commission automatique sur les deals</h2>
            <p>Sauf accord séparé exprès, M3 ne perçoit pas de commission automatique sur les contrats ou deals conclus entre membres, partenaires ou tiers à l'issue d'une relation initiée sur la plateforme.</p>
          </section>

          {/* Article 12 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 12 — Accès premium et usage des licences</h2>
            <p>Les accès premium, memberships et droits attachés à une offre sont strictement limités au périmètre convenu. Sauf stipulation spécifique, un accès nominatif ne peut être partagé entre plusieurs personnes.</p>
            <p className="mt-2">Les droits d'accès associés à une entreprise peuvent, lorsque l'offre le prévoit, être répartis entre un représentant légal et des collaborateurs affiliés autorisés, sous réserve du nombre de sièges inclus et des règles d'administration applicables.</p>
          </section>

          {/* Article 13 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 13 — Révision des offres et des prix</h2>
            <p>M3 peut faire évoluer ses offres et ses prix pour les périodes futures. Toute évolution de prix applicable à un renouvellement devra être portée à la connaissance du client dans un délai raisonnable avant l'échéance concernée.</p>
          </section>

          {/* Article 14 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 14 — Responsabilité</h2>
            <p>La responsabilité de M3 au titre d'une offre payante est strictement limitée au montant hors taxes effectivement encaissé par M3 au titre de ladite offre au cours des douze mois précédant le fait générateur, sauf faute lourde ou dolosive et sous réserve des dispositions impératives applicables.</p>
            <p className="mt-2">En aucun cas M3 ne pourra être tenue responsable des dommages indirects, pertes d'exploitation, pertes de marge, pertes de chance, pertes d'image, pertes de données ou pertes d'opportunités commerciales.</p>
          </section>

          {/* Article 15 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 15 — Droit applicable et juridiction</h2>
            <p>Les présentes conditions commerciales sont régies par le droit monégasque. Tout litige y afférent relève, sous réserve des règles impératives applicables, de la compétence exclusive des juridictions de la Principauté de Monaco.</p>
          </section>

          {/* Contact */}
          <section className="border-t pt-6">
            <p className="text-sm text-gray-500">Pour toute question relative aux présentes conditions commerciales, veuillez contacter : <a href="mailto:info@m3monaco.com" className="text-primary hover:underline">info@m3monaco.com</a></p>
          </section>
        </div>
      </div>
    </div>
  );
}
