import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';

export function PrivacyPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <Helmet>
        <title>Privacy Policy — Smart Marina Connect</title>
      </Helmet>

      <div className="container mx-auto px-4 py-12 max-w-4xl">
        <Link to="/" className="inline-flex items-center gap-1 text-primary hover:underline mb-6 text-sm">
          <ChevronLeft className="h-4 w-4" />
          Back to Home
        </Link>

        <h1 className="text-3xl font-bold text-gray-900 mb-2">Privacy Policy</h1>
        <p className="text-sm text-gray-500 mb-8">Version of March 6, 2026</p>

        <div className="bg-white rounded-xl shadow-sm border p-6 md:p-10 space-y-8 text-gray-700 leading-relaxed">
          {/* Article 1 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 1 — Data Controller</h2>
            <p>This privacy policy describes how M3 Monaco SAM processes personal data in connection with the operation of the Smart Marina Connect website and platform.</p>
            <div className="bg-gray-50 rounded-lg p-4 mt-3 text-sm space-y-1">
              <p><strong>Data Controller:</strong> M3 Monaco SAM, Société Anonyme Monégasque with a share capital of 150 000 EUR</p>
              <p><strong>RCI:</strong> I18S07927</p>
              <p><strong>Registered office:</strong> 3 Boulevard des Moulins, Monte Carlo Palace, 2nd floor - Office B21, 98000 Monaco</p>
              <p><strong>General contact:</strong> <a href="mailto:info@m3monaco.com" className="text-primary hover:underline">info@m3monaco.com</a></p>
              <p><strong>Data protection officer:</strong> Victor Meyer, reachable at <a href="mailto:info@m3monaco.com" className="text-primary hover:underline">info@m3monaco.com</a></p>
            </div>
            <p className="mt-3 text-sm">As of the date of this document, M3 has not appointed a Data Protection Officer or a representative within the European Union.</p>
          </section>

          {/* Article 2 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 2 — Applicable Legal Framework</h2>
            <p>M3 intends to process personal data in compliance with Monegasque data protection law, as well as the provisions of the European Union General Data Protection Regulation, hereinafter "GDPR", where applicable.</p>
            <p className="mt-2">Where processing involves individuals located in the European Union, international transfers, or service providers located outside Monaco, M3 implements or requires appropriate contractual, technical, and organizational safeguards in accordance with applicable rules.</p>
          </section>

          {/* Article 3 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 3 — Data Subjects</h2>
            <p>This policy applies to, among others, website visitors, account holders, legal representatives of companies, affiliated employees, professional contacts, participants in webinars or workshops, prospects, partners, partner applicants, advertisers, sponsors, and more generally any natural person whose data is processed through Smart Marina Connect.</p>
          </section>

          {/* Article 4 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 4 — Categories of Data Collected</h2>
            <p>M3 may collect and process the following categories of data:</p>
            <ul className="list-disc list-inside mt-2 space-y-1 text-sm">
              <li>Last name, first name, professional email address, professional phone number</li>
              <li>Job title, company or organization, country</li>
              <li>Photograph, logo, and professional biography</li>
              <li>Account-related data, login history, security logs</li>
              <li>Browsing data, contact forms, matchmaking requests</li>
              <li>Participation in webinars or workshops</li>
              <li>Billing data, communication preferences</li>
              <li>Documents submitted or uploaded</li>
              <li>Internal assessment or qualification notes related to account or request management</li>
            </ul>
            <p className="mt-3">M3 does not request sensitive data as defined by applicable regulations and does not intend to process such data in the normal course of the platform's operations.</p>
            <p className="mt-2">As of the date of this document, M3 does not perform automated scoring or automated profiling that produces legal or significant effects on data subjects.</p>
          </section>

          {/* Article 5 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 5 — Purposes of Processing</h2>
            <p>Personal data is processed for the following purposes:</p>
            <ul className="list-disc list-inside mt-2 space-y-1 text-sm">
              <li>Account creation and management, authentication, access and rights management</li>
              <li>Smart Marina Connect community engagement</li>
              <li>Sending newsletters, invitations to webinars or events</li>
              <li>Content and replay management</li>
              <li>Processing contact forms and matchmaking requests</li>
              <li>Qualification of members and partners, support</li>
              <li>System security, usage statistics, production of anonymized or aggregated benchmarks</li>
              <li>Billing, contract management, regulatory compliance, and defense of M3's rights</li>
            </ul>
            <p className="mt-3">Where relevant, certain processing operations may also enable the organization of publications, commercial solicitations, visibility campaigns, sponsored operations, or partner placements within a professional B2B context.</p>
          </section>

          {/* Article 6 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 6 — Legal Bases</h2>
            <p>Depending on the circumstances, processing is based on:</p>
            <ul className="list-disc list-inside mt-2 space-y-1 text-sm">
              <li>Performance of the Terms of Use or a contract / pre-contractual measures</li>
              <li>M3's legitimate interest in operating the platform and developing its business</li>
              <li>Compliance with legal or regulatory obligations</li>
              <li>Consent of the data subject (in particular for certain trackers, communications, or targeted transmissions)</li>
            </ul>
            <p className="mt-3">When M3 transmits data to a third-party partner as part of a user request, such transmission is, in principle, subject to the prior authorization of the individual or organization concerned, unless otherwise required by law or contract.</p>
          </section>

          {/* Article 7 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 7 — Data Recipients</h2>
            <p>On a need-to-know basis, data may be shared with authorized internal M3 teams, technical service providers, advisors, contractual partners involved in the delivery of a service or feature, as well as competent authorities where required by law.</p>
            <div className="bg-gray-50 rounded-lg p-4 mt-3">
              <p className="text-sm font-medium text-gray-900 mb-2">Key service providers and tools:</p>
              <ul className="list-disc list-inside text-sm space-y-1">
                <li><strong>Netlify</strong> — hosting</li>
                <li><strong>Supabase</strong> — database and authentication</li>
                <li><strong>Resend</strong> — transactional emails</li>
                <li><strong>HubSpot</strong> — CRM and newsletters</li>
                <li><strong>Google Analytics</strong> — audience measurement</li>
                <li><strong>Zoom</strong> — webinars</li>
                <li><strong>YouTube</strong> — replays and embedded video content</li>
                <li><strong>Cloudflare</strong> — network layer and security</li>
                <li><strong>Google reCAPTCHA</strong> — anti-bot protection</li>
              </ul>
            </div>
            <p className="mt-3 text-sm">Data is not freely shared with all members or partners of the network. Exchanges between users and data transmissions related to requests remain governed by the platform's functional settings.</p>
          </section>

          {/* Article 8 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 8 — International Transfers</h2>
            <p>Given the service providers used, certain data may be hosted, stored, accessed, or processed outside Monaco and, depending on the contractual configurations of the services, outside the European Economic Area.</p>
            <p className="mt-2">Where such transfers occur, M3 intends to rely on appropriate legal mechanisms, including standard contractual clauses, contractual commitments of service providers, relevant technical and organizational security measures, and, where available, any applicable adequacy decision.</p>
          </section>

          {/* Article 9 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 9 — Retention Periods</h2>
            <p>Unless a specific legal or contractual retention period applies, M3 applies the following retention periods:</p>
            <ul className="list-disc list-inside mt-2 space-y-1 text-sm">
              <li><strong>Account data:</strong> duration of account activation plus 3 years after the last significant activity</li>
              <li><strong>Prospect / form data:</strong> 3 years from the last meaningful contact</li>
              <li><strong>Matchmaking requests, projects:</strong> processing duration plus 5 years (evidence and follow-up)</li>
              <li><strong>Newsletter data:</strong> until unsubscription or 3 years of inactivity</li>
              <li><strong>Security logs:</strong> 12 months, unless a longer period is required for security reasons</li>
              <li><strong>Billing data:</strong> legally applicable duration</li>
              <li><strong>Uploaded documents:</strong> duration of the account or engagement, then contractual or evidentiary retention</li>
            </ul>
            <p className="mt-3 text-sm">Upon expiration of the applicable retention periods, data is deleted, anonymized, or securely archived as appropriate.</p>
          </section>

          {/* Article 10 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 10 — Data Subject Rights</h2>
            <p>Under the conditions set forth by applicable legislation, any data subject has the right to information, access, rectification, erasure, restriction, objection, and, where applicable, data portability and withdrawal of consent.</p>
            <p className="mt-2">These rights may be exercised by writing to <a href="mailto:info@m3monaco.com" className="text-primary hover:underline">info@m3monaco.com</a>, to the attention of Victor Meyer. M3 may request any information reasonably necessary to verify the identity of the requester and to securely process the request.</p>
            <p className="mt-2">If the data subject believes, after contacting M3, that their rights have not been respected, they may lodge a complaint with the Data Protection Authority of the Principality of Monaco or, where the GDPR applies, the competent supervisory authority.</p>
          </section>

          {/* Article 11 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 11 — Cookies and Similar Technologies</h2>
            <p>The use of cookies and other trackers by Smart Marina Connect is described in the <Link to="/cookies" className="text-primary hover:underline">Cookie Policy</Link>. Where trackers require prior consent, such consent must be obtainable and revocable at any time through the dedicated management interface.</p>
          </section>

          {/* Article 12 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 12 — Security</h2>
            <p>M3 implements reasonable technical and organizational measures to protect data against destruction, loss, alteration, unauthorized disclosure, unlawful access, or any other form of unauthorized processing.</p>
            <p className="mt-2">These measures may include, among others, access control, logging, secure access management, use of anti-bot tools, service provider reviews, backups, access restrictions, and incident management.</p>
          </section>

          {/* Article 13 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 13 — Data of Minors</h2>
            <p>Smart Marina Connect is a platform intended for professional use. It is not designed to be used by minors in the normal course of its services.</p>
          </section>

          {/* Article 14 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 14 — Policy Amendments</h2>
            <p>M3 may update this privacy policy at any time to reflect changes to the platform, its operating model, its service providers, or the applicable legal framework. The enforceable version is the one published on the platform at the time of consultation.</p>
          </section>

          {/* Contact */}
          <section className="border-t pt-6">
            <p className="text-sm text-gray-500">For any questions regarding this privacy policy, please contact: <a href="mailto:info@m3monaco.com" className="text-primary hover:underline">info@m3monaco.com</a></p>
          </section>
        </div>
      </div>
    </div>
  );
}
