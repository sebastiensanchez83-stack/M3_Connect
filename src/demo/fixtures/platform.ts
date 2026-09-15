// The ecosystem around the demo marina: fictional partner companies, sponsors
// and other marinas for the network, home and partners pages, plus M3's public
// articles and the SM26 event listing. Every company and person here is invented.
import type { Row } from '../store';
import { DEMO_USER as U, DEMO_ORG as O } from '../identity';
import { sectorId } from './reference';

const assetUrl = (p: string) => `${typeof window !== 'undefined' ? window.location.origin : ''}/demo-assets/${p}`;
const kebab = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
const T = '2026-03-01T09:00:00Z';

type Company = {
  name: string; tier: string; featured: boolean; country: string; city: string;
  description: string; sectors: string[]; owner: [string, string, string]; logo?: string;
};

const PARTNERS: Company[] = [
  { name: 'Berthwise Analytics', tier: 'premium_partner', featured: true, country: 'Sweden', city: 'Gothenburg', description: 'Berth occupancy and revenue analytics for marina operators, built on sensor data and booking history.', sectors: ['marina-software-saas', 'ict-smart-marina-solutions'], owner: ['Sofia', 'Lindqvist', 'Chief Executive Officer'] },
  { name: 'Voltamar Charging', tier: 'main_sponsor', featured: true, country: 'France', city: 'Marseille', description: 'Shore-power pedestals and fast charging for electric boats, from single pontoons to whole marinas.', sectors: ['electrical-energy-systems', 'marina-equipment-hardware'], owner: ['Julien', 'Marchetti', 'Head of Marina Partnerships'] },
  { name: 'Coralith Materials', tier: 'innovation_partner', featured: true, country: 'Portugal', city: 'Lisbon', description: 'Low-carbon bio-concrete and recycled composites for breakwaters, pontoons and quay walls.', sectors: ['dredging-civil-engineering', 'environmental-sustainability'], owner: ['Amira', 'Haddad', 'Co-founder'] },
  { name: 'Harbrio Software', tier: 'associate_partner', featured: true, country: 'Netherlands', city: 'Rotterdam', description: 'Marina management software: berthing, billing, access control and customer app in one platform.', sectors: ['marina-software-saas', 'marina-management-operations'], owner: ['Daan', 'Verhoeven', 'Sales Director'] },
  { name: 'Keelgreen Energy', tier: 'premium_partner', featured: true, country: 'Spain', city: 'Valencia', description: 'Solar canopies and battery storage designed for pontoons and marina buildings.', sectors: ['electrical-energy-systems', 'environmental-sustainability'], owner: ['Lucía', 'Navarro', 'Managing Director'] },
  { name: 'Mooragen Systems', tier: 'member', featured: false, country: 'Norway', city: 'Bergen', description: 'Elastic mooring systems that protect seabed habitats and cut maintenance.', sectors: ['mooring-anchoring-systems'], owner: ['Erik', 'Solberg', 'Founder'] },
  { name: 'Tidelume Lighting', tier: 'innovation_partner', featured: false, country: 'Italy', city: 'Genoa', description: 'Dark-sky compliant LED lighting for pontoons and promenades, controlled by occupancy.', sectors: ['marina-equipment-hardware', 'environmental-sustainability'], owner: ['Chiara', 'Rinaldi', 'Product Manager'] },
  { name: 'Portigo Concierge', tier: 'member', featured: false, country: 'Monaco', city: 'Monaco', description: 'Guest and crew concierge services for superyacht marinas: provisioning, transfers, events.', sectors: ['yacht-services-concierge'], owner: ['Nadia', 'Morel', 'Founder'] },
  { name: 'Seaquilt Pontoons', tier: 'associate_partner', featured: true, country: 'Croatia', city: 'Split', description: 'Modular floating pontoons and wave attenuators made from recycled materials.', sectors: ['floating-structures-pontoons'], owner: ['Ivan', 'Kovač', 'Commercial Director'] },
  { name: 'Anchorly Security', tier: 'member', featured: false, country: 'United Kingdom', city: 'Southampton', description: 'Access control, CCTV analytics and incident response for marinas.', sectors: ['safety-security'], owner: ['Oliver', 'Hart', 'Chief Operating Officer'] },
  { name: 'Aquarelle Yacht Services', tier: 'member', featured: false, country: 'Greece', city: 'Athens', description: 'Refit coordination, crew services and technical management for visiting yachts.', sectors: ['yacht-services-concierge', 'naval-architecture'], owner: ['Eleni', 'Papadaki', 'Operations Lead'] },
];

const SPONSORS: Company[] = [
  { name: 'Riviera Blue Fund', tier: 'main_sponsor', featured: true, country: 'Monaco', city: 'Monaco', description: 'Investment fund dedicated to sustainable waterfront infrastructure.', sectors: ['environmental-sustainability'], owner: ['Philippe', 'Castellane', 'Partner'], logo: 'sponsors/riviera-blue-fund.png' },
  { name: 'Velamar Insurance', tier: 'premium_partner', featured: false, country: 'Italy', city: 'Milan', description: 'Marine and marina operator insurance, from liability to climate risk.', sectors: ['insurance-risk-management'], owner: ['Francesca', 'Galli', 'Head of Marine'], logo: 'sponsors/velamar-insurance.png' },
];

const OTHER_MARINAS: Company[] = [
  { name: 'Bluecrest Marinas Group', tier: 'member', featured: false, country: 'Greece', city: 'Lavrio', description: 'A group of four marinas across the Aegean with 1,600 berths.', sectors: ['marina-management-operations'], owner: ['Nikos', 'Andreou', 'Group Technical Director'], logo: 'companies/bluecrest-marinas-group.png' },
];

export function platformRows() {
  const organizations: Row[] = [];
  const profiles: Row[] = [];
  const organization_members: Row[] = [];
  const organization_service_sectors: Row[] = [];
  const organization_interest_sectors: Row[] = [];
  let avatar = 1;

  const add = (c: Company, type: 'partner' | 'marina') => {
    const slug = kebab(c.name);
    const id = `org-${slug}`;
    const userId = `usr-${slug}`;
    organizations.push({
      id, name: c.name, slug, primary_domain: null, organization_type: type, tier: c.tier, max_seats: 5,
      created_by_user_id: userId, owner_user_id: userId, logo_url: assetUrl(c.logo || `companies/${slug}.png`),
      banner_url: null, description: c.description, website: null, country: c.country, city: c.city, headquarters_country: c.country,
      access_status: 'verified', onboarding_status: 'completed', rejection_reason: null, audience_description: null,
      social_media_links: null, marina_subtype: type === 'marina' ? 'in_operation' : null, auto_approve_domain_joins: false,
      claim_code: null, investment_geographies: null, investment_size_min: null, investment_size_max: null,
      investment_hold_period: null, investment_thesis: null, featured_partner: c.featured, gallery: [],
      is_event_media_partner: false, created_at: T, updated_at: T,
    });
    profiles.push({
      user_id: userId, persona: type, access_status: 'verified', onboarding_status: 'completed',
      first_name: c.owner[0], last_name: c.owner[1], email: `${c.owner[0].toLowerCase()}@${slug}.example`,
      job_title: c.owner[2], avatar_url: assetUrl(`avatars/avatar-${String(avatar++).padStart(2, '0')}.png`),
      notification_prefs: {}, rejection_reason: null, created_at: T, updated_at: T,
    });
    organization_members.push({ id: `om-${slug}`, organization_id: id, user_id: userId, role: 'owner', joined_at: T });
    for (const s of c.sectors) {
      (type === 'partner' ? organization_service_sectors : organization_interest_sectors)
        .push({ organization_id: id, sector_id: sectorId(s), created_at: T });
    }
  };

  PARTNERS.forEach(c => add(c, 'partner'));
  SPONSORS.forEach(c => add(c, 'partner'));
  OTHER_MARINAS.forEach(c => add(c, 'marina'));

  const org = (name: string) => `org-${kebab(name)}`;
  const usr = (name: string) => `usr-${kebab(name)}`;

  // Inbound B2B requests to the demo marina: two waiting, one already accepted.
  const partner_requests: Row[] = [
    { id: 'pr-voltamar', partner_user_id: usr('Voltamar Charging'), marina_user_id: U.id, partner_organization_id: org('Voltamar Charging'), marina_organization_id: O.id, sector_id: sectorId('electrical-energy-systems'), message: 'Following our chat about the outer mole: we would love to propose a shore-power pilot for your superyacht berths ahead of next season.', status: 'pending', created_at: '2026-09-12T10:30:00Z', updated_at: '2026-09-12T10:30:00Z' },
    { id: 'pr-seaquilt', partner_user_id: usr('Seaquilt Pontoons'), marina_user_id: U.id, partner_organization_id: org('Seaquilt Pontoons'), marina_organization_id: O.id, sector_id: sectorId('floating-structures-pontoons'), message: 'We saw your pontoon renewal plans — our recycled-material pontoons could fit phase two. Happy to share references from Adriatic marinas.', status: 'pending', created_at: '2026-09-10T08:10:00Z', updated_at: '2026-09-10T08:10:00Z' },
    { id: 'pr-berthwise', partner_user_id: usr('Berthwise Analytics'), marina_user_id: U.id, partner_organization_id: org('Berthwise Analytics'), marina_organization_id: O.id, sector_id: sectorId('marina-software-saas'), message: 'Introduction for an occupancy analytics demo.', status: 'accepted', created_at: '2026-08-28T14:00:00Z', updated_at: '2026-08-29T09:00:00Z' },
  ];

  const profile_views: Row[] = Array.from({ length: 38 }, (_, i) => ({
    id: `pv-${i}`, viewed_user_id: U.id, viewer_user_id: null,
    viewed_at: new Date(Date.UTC(2026, 7, 15 + (i % 30), 9 + (i % 8))).toISOString(),
  }));

  const rfps: Row[] = [
    { id: 'rfp-bluecrest-lighting', marina_user_id: usr('Bluecrest Marinas Group'), organization_id: org('Bluecrest Marinas Group'), title: 'Pontoon lighting renewal across four marinas', scope: 'Supply and install dark-sky compliant LED lighting on 3.2 km of pontoons, with occupancy-based control and a five-year maintenance plan.', sector_id: sectorId('marina-equipment-hardware'), deadline_date: '2026-11-15', attachments_path: null, is_open: true, status: 'approved', rejection_reason: null, admin_notes: null, created_at: '2026-08-20T09:00:00Z', updated_at: '2026-08-22T09:00:00Z' },
  ];

  const consultations: Row[] = [
    { id: 'cons-bluecrest-esg', marina_user_id: usr('Bluecrest Marinas Group'), organization_id: org('Bluecrest Marinas Group'), title: 'ESG reporting framework for a multi-marina group', description: 'Looking for advice on a common set of environmental KPIs and how to report them to lenders.', sector_id: sectorId('environmental-sustainability'), is_open: true, status: 'approved', rejection_reason: null, admin_notes: null, created_at: '2026-09-01T09:00:00Z', updated_at: '2026-09-02T09:00:00Z' },
  ];

  // M3's public articles, as listed on /resources.
  const art = (id: string, title: string, summary: string, topic: string, tags: string[], thumb: string, created_at: string) => ({
    id, title, summary, content: `<p>${summary}</p>`, type: 'article', topic, language: 'EN', access_level: 'public',
    thumbnail_url: assetUrl(thumb), file_url: null, published: true, created_at, updated_at: created_at, published_at: created_at,
    published_by: null, tags, seo_keywords: null,
  });
  const resources: Row[] = [
    art('652fc78f-be3b-4631-8ad2-e09237167459', 'Leveraging Data Analytics for Responsible Marina Operations', 'How data analytics and AI systems are redefining marina operations — from digital twins to industry-wide data standardization.', 'Technology', ['Smart Marina 2025', 'Conference'], 'scenes/aerial.png', '2026-05-20T09:00:00Z'),
    art('93f75e35-ef4a-4cf5-8391-e316821de9c1', 'Financial & Regulatory Frameworks for Coastal Tourism Destinations', 'Industry leaders discuss the financial mechanisms, investment models, and regulatory conditions driving global marina development.', 'Management', ['Smart Marina 2025', 'Conference'], 'scenes/evening.png', '2026-05-18T09:00:00Z'),
    art('6a35b4f1-a141-42e2-b459-39810dedc4e5', 'Raising Startup Funding in the Blue Economy', 'Workshop providing practical guidance on fundraising for marine technology startups — covering venture capital and investment models.', 'Management', ['Smart Marina 2025', 'Conference'], 'scenes/sustainability.png', '2026-05-15T09:00:00Z'),
    art('0490b614-42c8-42eb-b1dc-8c4894adfc67', 'What To Do With Data: Standardization, KPIs & Smart Marina Strategy', 'Workshop addressing the challenge of data standardization in the marina industry — building common KPIs and benchmarking frameworks.', 'Technology', ['Smart Marina 2025', 'Conference'], 'scenes/hero.png', '2026-05-12T09:00:00Z'),
    art('06f21927-99b0-4551-8cf7-29b7d7323fcb', 'When Marina Management Meets Opera: Art, Culture & Service Excellence', 'A creative workshop using opera as metaphor for marina management — exploring community engagement and service excellence.', 'Management', ['Smart Marina 2025', 'Conference'], 'scenes/superyacht.png', '2026-05-10T09:00:00Z'),
  ];

  const events: Row[] = [
    { id: 'f55f7b2f-96ac-4c5e-b620-358624e52240', title: 'Monaco Smart & Sustainable Marina — 6th Edition', description: 'The Monaco Smart & Sustainable Marina is the leading international conference dedicated to the future of marinas, ports, and the yachting industry. Organised by Monaco Marina Management (M3), the 6th edition brings together marina operators, innovators, architects and investors at the Yacht Club de Monaco.', date_time: '2026-09-20T07:00:00Z', end_date_time: '2026-09-21T16:00:00Z', location: 'Yacht Club de Monaco', language: 'EN', access_level: 'public', speakers: [], replay_url: null, created_at: '2026-01-10T09:00:00Z', pdf_url: null, fees: null, max_attendance: null, location_details: {}, event_type: 'on_site', event_website_url: null, event_partners: [], brochure_url: null, invitation_only: false, is_full_day: true, published: true, meeting_url: null },
    { id: 'evt-webinar-shore-power', title: 'Webinar — Shore Power at Scale: Lessons from Mediterranean Marinas', description: 'Operators who electrified their outer moles share costs, grid constraints and what they would do differently.', date_time: '2026-10-14T14:00:00Z', end_date_time: '2026-10-14T15:00:00Z', location: 'Online', language: 'EN', access_level: 'members', speakers: [], replay_url: null, created_at: '2026-09-01T09:00:00Z', pdf_url: null, fees: null, max_attendance: null, location_details: {}, event_type: 'webinar', event_website_url: null, event_partners: [], brochure_url: null, invitation_only: false, is_full_day: false, published: true, meeting_url: null },
  ];

  // Sector tags drive "Recommended for you" on the home page and dashboard.
  const resource_sectors: Row[] = [
    ['652fc78f-be3b-4631-8ad2-e09237167459', 'ict-smart-marina-solutions'],
    ['0490b614-42c8-42eb-b1dc-8c4894adfc67', 'ict-smart-marina-solutions'],
    ['93f75e35-ef4a-4cf5-8391-e316821de9c1', 'environmental-sustainability'],
    ['6a35b4f1-a141-42e2-b459-39810dedc4e5', 'electrical-energy-systems'],
  ].map(([resource_id, slug]) => ({ resource_id, sector_id: sectorId(slug) }));

  const event_sectors: Row[] = [
    ['f55f7b2f-96ac-4c5e-b620-358624e52240', 'environmental-sustainability'],
    ['f55f7b2f-96ac-4c5e-b620-358624e52240', 'ict-smart-marina-solutions'],
    ['evt-webinar-shore-power', 'electrical-energy-systems'],
  ].map(([event_id, slug]) => ({ event_id, sector_id: sectorId(slug) }));

  events.push({ id: 'evt-webinar-data-kpis', title: 'Webinar — Common KPIs for Smart Marinas', description: 'How a shared set of operational and environmental indicators lets marinas benchmark themselves and report to lenders.', date_time: '2026-06-10T14:00:00Z', end_date_time: '2026-06-10T15:00:00Z', location: 'Online', language: 'EN', access_level: 'public', speakers: [], replay_url: null, created_at: '2026-05-01T09:00:00Z', pdf_url: null, fees: null, max_attendance: null, location_details: {}, event_type: 'webinar', event_website_url: null, event_partners: [], brochure_url: null, invitation_only: false, is_full_day: false, published: true, meeting_url: null });

  const event_registrations: Row[] = [
    { id: 'er-sm26', event_id: 'f55f7b2f-96ac-4c5e-b620-358624e52240', user_id: U.id, organization_id: O.id, registration_type: 'exhibitor', payment_status: 'paid', amount_due: 1650, invoice_reference: 'SM26-0142', registered_by: U.id, amount_due_cents: 165000, guest_email: null, guest_first_name: null, guest_last_name: null, guest_company: null, reminder_sent_at: null, created_at: '2026-06-18T08:30:00Z' },
  ];

  return {
    organizations, profiles, organization_members, organization_service_sectors, organization_interest_sectors,
    partner_requests, profile_views, rfps, consultations, marina_projects: [] as Row[], resources, events, event_registrations,
    resource_sectors, event_sectors,
  };
}
