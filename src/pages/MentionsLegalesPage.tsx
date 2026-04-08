import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';

export function MentionsLegalesPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <Helmet>
        <title>Legal Notice — Smart Marina Connect</title>
      </Helmet>

      <div className="container mx-auto px-4 py-12 max-w-4xl">
        <Link to="/" className="inline-flex items-center gap-1 text-primary hover:underline mb-6 text-sm">
          <ChevronLeft className="h-4 w-4" />
          Back to Home
        </Link>

        <h1 className="text-3xl font-bold text-gray-900 mb-2">Legal Notice</h1>
        <p className="text-sm text-gray-500 mb-8">Version of March 6, 2026</p>

        <div className="bg-white rounded-xl shadow-sm border p-6 md:p-10 space-y-8 text-gray-700 leading-relaxed">
          {/* Article 1 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 1 — Website Publisher</h2>
            <div className="bg-gray-50 rounded-lg p-4 text-sm space-y-1">
              <p><strong>Company name:</strong> M3 Monaco SAM</p>
              <p><strong>Legal form:</strong> Société Anonyme Monégasque</p>
              <p><strong>Share capital:</strong> 150 000 EUR</p>
              <p><strong>RCI:</strong> I18S07927</p>
              <p><strong>VAT No.:</strong> FR24000139781</p>
              <p><strong>Registered office:</strong> 3 Boulevard des Moulins, Monte Carlo Palace, Office B21, 98000 Monaco</p>
            </div>
          </section>

          {/* Article 2 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 2 — Publication Director</h2>
            <p>José Marco Casellini, CEO of M3 Monaco SAM.</p>
          </section>

          {/* Article 3 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 3 — Hosting</h2>
            <div className="space-y-3">
              <div className="bg-gray-50 rounded-lg p-4 text-sm">
                <p><strong>Primary host:</strong> Netlify, Inc.</p>
                <p>512 2nd Street, Suite 200, San Francisco, CA 94107, United States</p>
                <p><a href="https://www.netlify.com" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">www.netlify.com</a></p>
              </div>
              <p className="text-sm">Additional services: Supabase (database and authentication), Cloudflare (CDN and security).</p>
            </div>
          </section>

          {/* Article 4 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 4 — Website Access</h2>
            <p>M3 Monaco SAM endeavors to maintain access to the website but cannot guarantee permanent and uninterrupted availability. Access may be temporarily suspended for maintenance, updates, or force majeure reasons.</p>
          </section>

          {/* Article 5 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 5 — Intellectual Property</h2>
            <p>All elements comprising the website (texts, images, logos, videos, software, architecture, databases) are protected by intellectual property laws. Any unauthorized reproduction, representation, modification, or exploitation is strictly prohibited.</p>
          </section>

          {/* Article 6 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 6 — Hyperlinks</h2>
            <p>The Platform may contain links to third-party websites. M3 Monaco SAM disclaims all liability regarding the content of these external websites, over which it exercises no control.</p>
          </section>

          {/* Article 7 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 7 — Personal Data and Cookies</h2>
            <p>Information regarding the processing of personal data is detailed in our <Link to="/privacy" className="text-primary hover:underline">Privacy Policy</Link>.</p>
            <p className="mt-2">The use of cookies and trackers is described in our <Link to="/cookies" className="text-primary hover:underline">Cookie Policy</Link>.</p>
          </section>

          {/* Article 8 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 8 — Applicable Law</h2>
            <p>This legal notice is governed by Monegasque law. In the event of a dispute, the courts of the Principality of Monaco shall have sole jurisdiction.</p>
          </section>

          {/* Contact */}
          <section className="border-t pt-6">
            <p className="text-sm text-gray-500">For any questions, please contact: <a href="mailto:info@m3monaco.com" className="text-primary hover:underline">info@m3monaco.com</a></p>
          </section>
        </div>
      </div>
    </div>
  );
}
