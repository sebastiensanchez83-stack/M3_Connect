import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';

export function CookiePolicyPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <Helmet>
        <title>Cookie Policy — Smart Marina Connect</title>
      </Helmet>

      <div className="container mx-auto px-4 py-12 max-w-4xl">
        <Link to="/" className="inline-flex items-center gap-1 text-primary hover:underline mb-6 text-sm">
          <ChevronLeft className="h-4 w-4" />
          Back to Home
        </Link>

        <h1 className="text-3xl font-bold text-gray-900 mb-2">Cookie Policy</h1>
        <p className="text-sm text-gray-500 mb-8">Version of March 6, 2026</p>

        <div className="bg-white rounded-xl shadow-sm border p-6 md:p-10 space-y-8 text-gray-700 leading-relaxed">
          {/* Article 1 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 1 — Purpose</h2>
            <p>This cookie policy describes the conditions under which Smart Marina Connect uses cookies and similar technologies on the website and platform at smartmarinaconnect.com.</p>
          </section>

          {/* Article 2 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 2 — Definition</h2>
            <p>A cookie is a file or identifier that may be placed or read on the user's device when browsing the website or using the platform. Similar technologies may also be used, such as pixels, beacons, local storage, SDKs, technical fingerprints, or session identifiers.</p>
          </section>

          {/* Article 3 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 3 — Categories of Trackers Used</h2>
            <p>Smart Marina Connect may use trackers strictly necessary for the operation of the website and platform, security trackers, audience measurement trackers, preference trackers, trackers related to embedded content and webinars, as well as trackers related to B2B communication or remarketing operations when such uses are activated.</p>
            <div className="bg-gray-50 rounded-lg p-4 mt-3">
              <p className="text-sm font-medium text-gray-900 mb-2">Key services that may place trackers:</p>
              <ul className="list-disc list-inside text-sm space-y-1">
                <li><strong>Netlify</strong> — hosting and CDN</li>
                <li><strong>Supabase</strong> — database and authentication</li>
                <li><strong>Google Analytics</strong> — audience measurement</li>
                <li><strong>HubSpot</strong> — CRM and B2B communication</li>
                <li><strong>YouTube</strong> — embedded video content</li>
                <li><strong>Zoom</strong> — webinars and online events</li>
                <li><strong>Cloudflare</strong> — CDN and security</li>
                <li><strong>Google reCAPTCHA</strong> — anti-bot protection</li>
              </ul>
            </div>
          </section>

          {/* Article 4 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 4 — Purposes of Cookies</h2>
            <p>Trackers may be used, among other things, to:</p>
            <ul className="list-disc list-inside mt-2 space-y-1 text-sm">
              <li>Maintain sessions and authentication</li>
              <li>Secure the website</li>
              <li>Distinguish legitimate users from bots or abusive usage</li>
              <li>Remember certain preferences</li>
              <li>Measure audience</li>
              <li>Analyze browsing patterns</li>
              <li>Improve technical performance</li>
              <li>Embed videos or webinars</li>
              <li>Track the effectiveness of B2B campaigns</li>
              <li>Where applicable, carry out remarketing operations</li>
            </ul>
          </section>

          {/* Article 5 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 5 — Consent</h2>
            <p>Trackers strictly necessary for the operation or security of the website may be placed without prior consent when they are genuinely essential to the requested service.</p>
            <p className="mt-2">Other trackers, in particular non-exempt audience measurement trackers, remarketing trackers, embedded third-party content trackers, or marketing tracking trackers, require prior consent where applicable regulations so require.</p>
            <p className="mt-2">Smart Marina Connect implements a cookie information banner. User preferences must be manageable and modifiable at any time via a permanent cookie management link accessible from the website.</p>
          </section>

          {/* Article 6 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 6 — Retention Period</h2>
            <p>Cookies and technical identifiers are retained for periods proportionate to their purpose. Retention periods may vary depending on the service provider, account settings, or choices expressed by the user.</p>
            <p className="mt-2">Unless a different obligation applies due to the relevant service provider, M3 intends to limit technical retention periods to the strict needs of the service and to favor short retention periods for non-essential trackers.</p>
          </section>

          {/* Article 7 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 7 — Browser Settings</h2>
            <p>The user may also configure their browser to block all or some cookies. Such settings may, however, affect the normal operation of the website or certain features.</p>
          </section>

          {/* Article 8 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 8 — Useful Links</h2>
            <p>To learn more about the management of cookies and personal data:</p>
            <ul className="list-disc list-inside mt-2 space-y-1 text-sm">
              <li><Link to="/privacy" className="text-primary hover:underline">Privacy Policy</Link></li>
              <li><Link to="/terms" className="text-primary hover:underline">Terms of Use</Link></li>
              <li><Link to="/mentions-legales" className="text-primary hover:underline">Legal Notice</Link></li>
            </ul>
          </section>

          {/* Contact */}
          <section className="border-t pt-6">
            <p className="text-sm text-gray-500">For any questions regarding this cookie policy, please contact: <a href="mailto:contact@smartmarinaconnect.com" className="text-primary hover:underline">contact@smartmarinaconnect.com</a></p>
          </section>
        </div>
      </div>
    </div>
  );
}
