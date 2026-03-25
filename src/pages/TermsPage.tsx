import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';

export function TermsPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <Helmet>
        <title>Terms of Use — M3 Connect</title>
      </Helmet>

      <div className="container mx-auto px-4 py-12 max-w-4xl">
        <Link to="/" className="inline-flex items-center gap-1 text-primary hover:underline mb-6 text-sm">
          <ChevronLeft className="h-4 w-4" />
          Back to Home
        </Link>

        <h1 className="text-3xl font-bold text-gray-900 mb-2">Terms of Use</h1>
        <p className="text-sm text-gray-500 mb-8">Version of March 6, 2026</p>

        <div className="bg-white rounded-xl shadow-sm border p-6 md:p-10 space-y-8 text-gray-700 leading-relaxed">
          {/* Article 1 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 1 — Purpose</h2>
            <p>These terms of use (hereinafter the "Terms") govern access to and use of the M3 Connect platform, accessible at connect.m3monaco.com (hereinafter the "Platform"), published by M3 Monaco SAM.</p>
            <p className="mt-2">The Platform is a B2B ecosystem dedicated to the marina, yacht club, waterfront, leisure port, and sailing school sector. It offers, among other things: a showcase website, member and partner areas, a resource library, webinars and replays, contact forms, payment features, and commercial solicitation tools.</p>
          </section>

          {/* Article 2 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 2 — Publisher Identification</h2>
            <div className="bg-gray-50 rounded-lg p-4 text-sm space-y-1">
              <p><strong>Company name:</strong> M3 Monaco SAM</p>
              <p><strong>Share capital:</strong> 150 000 EUR</p>
              <p><strong>RCI:</strong> I18S07927</p>
              <p><strong>Registered office:</strong> 3 Boulevard des Moulins, Monte Carlo Palace, Office B21, 98000 Monaco</p>
              <p><strong>Publication Director:</strong> José Marco Casellini, CEO</p>
            </div>
          </section>

          {/* Article 3 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 3 — Acceptance of the Terms</h2>
            <p>Access to and use of the Platform implies full and unconditional acceptance of these Terms. Any user acting on behalf of an organization represents that they are duly authorized to bind said organization.</p>
          </section>

          {/* Article 4 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 4 — Platform Access and User Categories</h2>
            <p>Access to certain features of the Platform requires the creation of a user account, subject to manual validation by M3 Monaco SAM.</p>
            <p className="mt-2">The user categories are as follows:</p>
            <ul className="list-disc list-inside mt-2 space-y-1 text-sm">
              <li><strong>Visitor</strong> — free access to public content</li>
              <li><strong>Member</strong> — registered and validated user</li>
              <li><strong>Marina</strong> — marina, port, or yacht club operator</li>
              <li><strong>Partner</strong> — service provider for the sector</li>
              <li><strong>Certified Partner</strong> — partner certified by M3 Monaco</li>
              <li><strong>Media Partner</strong> — specialized media partner</li>
              <li><strong>Administrator</strong> — M3 Monaco staff</li>
              <li><strong>Moderator</strong> — authorized editorial contributor</li>
            </ul>
          </section>

          {/* Article 5 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 5 — User Account</h2>
            <p>Each user undertakes to provide accurate and up-to-date information upon registration. The account is strictly personal, and the user is responsible for maintaining the confidentiality of their login credentials.</p>
          </section>

          {/* Article 6 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 6 — Features and Usage Rules</h2>
            <p>Use of the Platform must be for professional and lawful purposes. The following are strictly prohibited:</p>
            <ul className="list-disc list-inside mt-2 space-y-1 text-sm">
              <li>Scraping, automated copying, or data extraction</li>
              <li>Using bots, robots, or any automated devices</li>
              <li>Distributing viruses, malware, or unauthorized content</li>
              <li>Compromising the security or proper functioning of the Platform</li>
            </ul>
          </section>

          {/* Article 7 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 7 — Content, Publications, and Solicitations for Offers</h2>
            <p>Publications on the Platform are subject to prior approval by M3 Monaco SAM, which holds editorial moderation authority. Content must comply with the professional standards of the sector.</p>
          </section>

          {/* Article 8 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 8 — Matchmaking and Interactions Between Members</h2>
            <p>The Platform facilitates qualified B2B matchmaking between its users. M3 Monaco SAM does not guarantee any commercial outcome and does not charge any automatic commission on transactions concluded between members or partners.</p>
          </section>

          {/* Article 9 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 9 — Intellectual Property</h2>
            <p>All content on the Platform (texts, images, logos, videos, software, databases) is protected by intellectual property law. The user is granted a non-exclusive, non-transferable, and revocable right of use, limited to personal consultation within a professional context.</p>
          </section>

          {/* Article 10 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 10 — Personal Data</h2>
            <p>The processing of personal data is governed by the <Link to="/privacy" className="text-primary hover:underline">Privacy Policy</Link> accessible on the Platform.</p>
          </section>

          {/* Article 11 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 11 — Availability, Maintenance, and Security</h2>
            <p>M3 Monaco SAM endeavors to ensure the availability of the Platform but does not guarantee permanent, continuous, or error-free operation. Maintenance operations may result in temporary interruptions.</p>
          </section>

          {/* Article 12 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 12 — Account Suspension and Deletion</h2>
            <p>M3 Monaco SAM reserves the right to suspend or delete any user account in the event of a breach of these Terms, fraud, a threat to Platform security, or any conduct contrary to professional standards.</p>
          </section>

          {/* Article 13 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 13 — Liability</h2>
            <p>M3 Monaco SAM is subject to a best-efforts obligation. Its liability is limited as follows:</p>
            <ul className="list-disc list-inside mt-2 space-y-1 text-sm">
              <li>For non-paying users: capped at <strong>100 EUR</strong></li>
              <li>For paying users: capped at the total amount actually paid over the <strong>preceding 12 months</strong></li>
            </ul>
            <p className="mt-2">M3 Monaco SAM shall not be held liable for indirect damages, data loss, loss of revenue, or loss of contracts.</p>
          </section>

          {/* Article 14 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 14 — Amendment of the Terms</h2>
            <p>M3 Monaco SAM reserves the right to amend these Terms at any time. Users will be notified of any material changes. Continued use of the Platform following such amendments constitutes acceptance of the updated Terms.</p>
          </section>

          {/* Article 15 */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Article 15 — Applicable Law and Jurisdiction</h2>
            <p>These Terms are governed by Monegasque law. In the event of a dispute, the courts of the Principality of Monaco shall have sole jurisdiction.</p>
          </section>

          {/* Contact */}
          <section className="border-t pt-6">
            <p className="text-sm text-gray-500">For any questions regarding these Terms, please contact: <a href="mailto:info@m3monaco.com" className="text-primary hover:underline">info@m3monaco.com</a></p>
          </section>
        </div>
      </div>
    </div>
  );
}
