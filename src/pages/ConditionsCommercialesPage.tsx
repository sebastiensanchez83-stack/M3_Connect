import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';

export function ConditionsCommercialesPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <Helmet>
        <title>Commercial Terms — Smart Marina Connect</title>
      </Helmet>

      <div className="container mx-auto px-4 py-12 max-w-4xl">
        <Link to="/" className="inline-flex items-center gap-1 text-primary hover:underline mb-6 text-sm">
          <ChevronLeft className="h-4 w-4" />
          Back to Home
        </Link>

        <h1 className="text-3xl font-bold text-gray-900 mb-2">Commercial Terms for Paid Offers and Partners</h1>
        <p className="text-sm text-gray-500 mb-8">Version of March 6, 2026</p>

        <div className="bg-white rounded-xl shadow-sm border p-6 md:p-10 space-y-8 text-gray-700 leading-relaxed">
          {/* Article 1 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 1 — Purpose and Scope</h2>
            <p>These commercial terms apply to paid offers, subscriptions, visibility campaigns, premium access, sponsorships, placements, partner spaces, and more generally to any Smart Marina Connect commercial offer subscribed to by a client, partner, or paying member.</p>
            <p className="mt-2">They supplement the <Link to="/terms" className="text-primary hover:underline">Terms of Use</Link> and, in the event of a conflict, shall prevail with respect to all matters concerning financial conditions, subscription terms, renewal, suspension, and termination of paid offers.</p>
          </section>

          {/* Article 2 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 2 — Nature of Offers</h2>
            <p>Smart Marina Connect may market, among other things, memberships, premium access, partner or certified partner profiles, media partner spaces, visibility campaigns, editorial placements, sponsorships, access to specific content or workshops, attendance or exhibition packages, and any other professional offer defined by M3.</p>
            <p className="mt-2">The exact content of each offer, its scope, duration, price, access level, specific terms, and any limitations are defined in the applicable commercial proposal, purchase order, insertion order, or pricing page.</p>
          </section>

          {/* Article 3 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 3 — Subscription and Contract Formation</h2>
            <p>Subscription to a paid offer takes effect on the date of signature of the applicable commercial document, online acceptance, or actual payment when the platform allows digital subscription.</p>
            <p className="mt-2">M3 reserves the right to refuse a subscription for legitimate reasons, including compliance risk, reputational harm, sector inconsistency, conflict of interest, inaccurate information, prior non-payment, or use incompatible with the positioning of Smart Marina Connect.</p>
          </section>

          {/* Article 4 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 4 — Pricing and Payment Terms</h2>
            <p>Unless otherwise stated, prices are expressed in euros, exclusive of taxes, and payable in advance.</p>
            <p className="mt-2">Payment may be made by bank transfer, credit card, or any other method offered by M3 or its banking or payment service provider.</p>
            <p className="mt-2">Any late payment entitles M3, without prejudice to its other rights, to suspend access to the relevant offer, freeze the associated account, suspend any ongoing publication or visibility, and demand immediate payment of all amounts due.</p>
          </section>

          {/* Article 5 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 5 — Duration and Renewal</h2>
            <p>Unless otherwise specified in the applicable commercial document, subscriptions and memberships are entered into for an initial period of twelve months and are tacitly renewed for successive twelve-month periods.</p>
            <p className="mt-2">The party that does not wish to renew must provide written notice at least thirty calendar days before the end of the current period.</p>
            <p className="mt-2">One-time offers, campaigns, sponsorships, insertion orders, and time-limited operations terminate at the end date specified in the applicable commercial document, without automatic renewal unless otherwise stipulated.</p>
          </section>

          {/* Article 6 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 6 — No Professional Right of Withdrawal</h2>
            <p>As Smart Marina Connect offers are intended for professionals, no right of withdrawal applies unless an overriding mandatory provision expressly provides otherwise.</p>
          </section>

          {/* Article 7 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 7 — Early Termination</h2>
            <p>In the event of a material breach by either party of its essential obligations, not remedied within fifteen days of written notice, the other party may terminate the relevant offer as of right, without prejudice to any damages to which it may be entitled.</p>
            <p className="mt-2">In the event of non-payment, serious harm to M3's image, misuse of the platform, unlawful content, or repeated violation of the Terms of Use, M3 may immediately suspend performance and then terminate the access or offer concerned if the situation is not rectified.</p>
          </section>

          {/* Article 8 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 8 — Refund</h2>
            <p>Unless otherwise provided in a specific commercial document or in the event of proven fault by M3 rendering the service entirely unusable on a lasting basis, amounts paid shall remain acquired and shall not be subject to a pro rata refund.</p>
            <p className="mt-2">Where an offer is terminated solely at M3's initiative for internal convenience before its term, without fault on the part of the client, M3 may offer, at its discretion, a deferral, a credit note, or a partial refund calculated in good faith.</p>
          </section>

          {/* Article 9 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 9 — Visibility, Sponsorship, and Placements</h2>
            <p>Visibility spaces, sponsorships, partner placements, featured content, or publications of a commercial nature are distributed according to the formats, positions, periods, quotas, editorial approvals, and quality standards defined by M3.</p>
            <p className="mt-2">M3 retains editorial oversight over any creative, resource, visual, text, press release, banner, publication, or sponsored content intended to appear on Smart Marina Connect.</p>
            <p className="mt-2">M3 may reject or remove any commercial content that does not comply with applicable laws, its editorial line, its image, or the targeted sector.</p>
          </section>

          {/* Article 10 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 10 — No Guarantee of Commercial Results</h2>
            <p>Unless otherwise expressly agreed in writing, M3 does not guarantee any volume of leads, number of meetings, number of views, number of introductions, contract value, commercial conversion, or media coverage.</p>
            <p className="mt-2">The value of an Smart Marina Connect offer may result from a combination of visibility, positioning, access to the ecosystem, content, editorial presence, and matchmaking opportunities, without any guarantee of quantified results.</p>
          </section>

          {/* Article 11 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 11 — No Automatic Commission on Deals</h2>
            <p>Unless otherwise expressly agreed, M3 does not charge any automatic commission on contracts or deals concluded between members, partners, or third parties following a relationship initiated on the platform.</p>
          </section>

          {/* Article 12 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 12 — Premium Access and License Usage</h2>
            <p>Premium access, memberships, and rights attached to an offer are strictly limited to the agreed scope. Unless otherwise specified, a named access may not be shared among multiple persons.</p>
            <p className="mt-2">Access rights associated with a company may, where the offer provides for it, be distributed among a legal representative and authorized affiliated employees, subject to the number of seats included and the applicable administration rules.</p>
          </section>

          {/* Article 13 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 13 — Revision of Offers and Pricing</h2>
            <p>M3 may modify its offers and pricing for future periods. Any price change applicable to a renewal shall be communicated to the client within a reasonable time before the relevant expiration date.</p>
          </section>

          {/* Article 14 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 14 — Liability</h2>
            <p>M3's liability under a paid offer is strictly limited to the amount (exclusive of taxes) actually received by M3 for said offer during the twelve months preceding the event giving rise to liability, except in cases of gross negligence or willful misconduct and subject to applicable mandatory provisions.</p>
            <p className="mt-2">Under no circumstances shall M3 be held liable for indirect damages, loss of business, loss of margin, loss of opportunity, loss of reputation, loss of data, or loss of commercial opportunities.</p>
          </section>

          {/* Article 15 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 15 — Applicable Law and Jurisdiction</h2>
            <p>These commercial terms are governed by Monegasque law. Any dispute arising hereunder shall, subject to applicable mandatory rules, fall under the exclusive jurisdiction of the courts of the Principality of Monaco.</p>
          </section>

          {/* Contact */}
          <section className="border-t pt-6">
            <p className="text-sm text-gray-500">For any questions regarding these commercial terms, please contact: <a href="mailto:contact@smartmarinaconnect.com" className="text-primary hover:underline">contact@smartmarinaconnect.com</a></p>
          </section>
        </div>
      </div>
    </div>
  );
}
