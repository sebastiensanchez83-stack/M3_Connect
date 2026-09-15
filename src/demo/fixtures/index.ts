// Starting state of the demo database: one fictional marina, confirmed for the
// SM26 Rendezvous, surrounded by a small fictional ecosystem of companies.
// Real-world content is limited to the public programme and the platform's
// reference data (see programme.ts and reference.ts).
import type { Db, Row } from '../store';
import { DEMO_EVENT_ID as EV, DEMO_USER as U, DEMO_ORG as O, DEMO_REGISTRATION_ID as REG, DEMO_ROLE_ID as RA } from '../identity';
import { PROGRAMME } from './programme';
import { SECTORS, TIERS, MARINA_REQUIREMENTS, FEEDBACK_QUESTIONS, FEES, VOTE_CONFIG, sectorId } from './reference';
import { platformRows } from './platform';

// Absolute URL for a file under public/demo-assets (fields rendered directly as <img src>).
export const assetUrl = (p: string) => `${typeof window !== 'undefined' ? window.location.origin : ''}/demo-assets/${p}`;

const T0 = '2026-06-18T08:30:00Z';

export function buildSeed(): Db {
  const profiles: Row[] = [{
    user_id: U.id, persona: 'marina', access_status: 'verified', onboarding_status: 'completed',
    first_name: U.first_name, last_name: U.last_name, email: U.email, job_title: U.job_title,
    avatar_url: assetUrl('avatars/luca-moretti.png'), notification_prefs: {}, rejection_reason: null,
    created_at: '2026-04-16T09:08:44Z', updated_at: T0,
  }];

  const organizations: Row[] = [{
    id: O.id, name: O.name, slug: O.slug, primary_domain: 'marinaportovelaria.com', organization_type: 'marina',
    tier: 'member', max_seats: 5, created_by_user_id: U.id, owner_user_id: U.id,
    logo_url: assetUrl('brand/logo.png'), banner_url: assetUrl('scenes/hero.png'),
    description: 'A Mediterranean marina of 420 berths set beneath the hilltop village of Porto Velaria, with 18 superyacht berths up to 90 m, solar-roofed pontoons, electric boat charging and an ongoing seagrass restoration programme.',
    website: O.website, country: O.country, city: O.city, headquarters_country: O.country,
    access_status: 'verified', onboarding_status: 'completed', rejection_reason: null, audience_description: null,
    social_media_links: 'https://www.linkedin.com/company/marina-porto-velaria', marina_subtype: 'in_operation',
    auto_approve_domain_joins: false, claim_code: null, investment_geographies: null, investment_size_min: null,
    investment_size_max: null, investment_hold_period: null, investment_thesis: null, featured_partner: false,
    gallery: [], is_event_media_partner: false, created_at: '2026-04-16T09:08:44Z', updated_at: T0,
  }];

  const organization_members: Row[] = [
    { id: 'om-demo-owner', organization_id: O.id, user_id: U.id, role: 'owner', joined_at: '2026-04-16T09:08:44Z' },
  ];

  const organization_marina_details: Row[] = [{
    organization_id: O.id, marina_type: 'in_operation', completion_date: '1998-06-01', berths_count: 420,
    superyacht_berths: 18, longest_berth_meters: 90, fresh_water_available: true, mix_range_boats: true,
    mix_range_description: 'From 8 m day boats to 90 m superyachts', certifications: ['Blue Flag', 'ISO 14001'],
    certifications_other: null, has_yacht_club: true, yacht_club_members: 310, has_sailing_school: true,
    has_boat_yard: true, has_restaurants: true, restaurants_count: 6, has_concierge: true,
    marina_description: 'Marina di Porto Velaria sits in a sheltered bay beneath a hilltop village, a short sail from the main Mediterranean cruising grounds.',
    services_description: 'Full-service berthing, 24/7 concierge, fuel dock, boatyard with 150 t travel lift, provisioning and crew services.',
    created_at: '2026-04-16T09:10:00Z', updated_at: T0,
  }];

  const organization_interest_sectors: Row[] = ['electrical-energy-systems', 'environmental-sustainability', 'ict-smart-marina-solutions', 'floating-structures-pontoons']
    .map(slug => ({ organization_id: O.id, sector_id: sectorId(slug), created_at: T0 }));

  const sm_event: Row[] = [{
    id: EV, slug: 'sm26', name: 'Smart & Sustainable Marina Rendezvous 2026', start_date: '2026-09-20', end_date: '2026-09-21',
    venue: 'Yacht Club de Monaco', timezone: 'Europe/Monaco', status: 'draft', legacy_event_id: null,
    // Locks pushed out so the demo stays editable whatever day it is filmed.
    settings: { edition_label: '6th', programme_published: true, edit_locks_at: '2099-12-31', roster_locks_at: '2099-12-31', architecture_closes_at: '2026-08-19' },
    created_at: '2026-01-10T09:00:00Z', updated_at: T0,
  }];

  const sm_registration: Row[] = [{
    id: REG, event_id: EV, user_id: U.id, organization_id: O.id, first_name: U.first_name, last_name: U.last_name,
    email: U.email, phone: '+39 0565 010 420', company_name: O.name, website: O.website, country: O.country,
    job_title: U.job_title, prior_participation: null, objective: 'Present our sustainability programme and meet technology partners for the next phase of our pontoon renewal.',
    how_heard: 'M3 newsletter', image_consent: true, terms_accepted_at: '2026-06-18T08:30:00Z', status: 'confirmed',
    claim_code: null, source: 'self', billing_address: 'Molo Nord 1, 57030 Porto Velaria, Italy', vat_number: 'IT01234567890',
    num_attendees: 3, requested_fields: [], info_request_note: null, attendees_confirmed_at: '2026-09-02T10:12:00Z',
    import_role_suggestions: null, created_at: '2026-06-18T08:30:00Z', updated_at: '2026-09-02T10:12:00Z',
  }];

  // Files live in the event-media bucket, as on the platform; the images ship
  // under public/demo-assets/event-media/<path>.
  const P = (f: string) => `demo/porto-velaria/${f}`;

  const sm_role_assignment: Row[] = [{
    id: RA, registration_id: REG, event_id: EV, organization_id: O.id, role: 'marina', scope: 'organization',
    depth: 'full', source: 'self', status: 'confirmed',
    module_data: {
      logo: P('logo.png'),
      hero_image: P('hero.png'),
      type: 'In operation',
      completion_date: '1998',
      total_berths: '420',
      superyacht_berths: '18',
      longest_berths: '90',
      boat_range: '8 – 90 m',
      fresh_water: 'Yes', yacht_club: 'Yes', sailing_school: 'Yes', boat_yard: 'Yes', restaurants: 'Yes', concierge: 'Yes',
      certification: 'Blue Flag, ISO 14001',
      overview: 'Marina di Porto Velaria sits in a sheltered bay beneath a hilltop village, a short sail from the main Mediterranean cruising grounds. Its 420 berths welcome everything from local day boats to 90 m superyachts, with a quay lined by restaurants and a promenade that stays lively late into the evening.',
      services: '24/7 concierge and berthing assistance, fuel dock, boatyard with a 150 t travel lift, provisioning, crew services, waste and grey-water collection at every berth, and a yacht club with a sailing school.',
      sustainable_diff: 'Solar canopies over three pontoons cover 40% of the marina’s electricity; berths on the outer mole offer shore power and charging for electric boats; and a seagrass restoration programme with the local university has replanted 2 hectares of Posidonia since 2023.',
      hd_images: [P('gallery-aerial.png'), P('gallery-evening.png'), P('gallery-superyacht.png'), P('gallery-sustainability.png')],
      pitch: 'Yes',
      linkedin: 'https://www.linkedin.com/company/marina-porto-velaria',
      instagram: 'https://www.instagram.com/marinaportovelaria',
      facebook: 'https://www.facebook.com/marinaportovelaria',
      contact_photo: P('contact-photo.png'),
    },
    created_at: '2026-06-18T08:30:00Z', updated_at: '2026-09-02T10:12:00Z',
  }];

  const sm_marina_extra: Row[] = [{
    id: 'mx-porto-velaria', role_assignment_id: RA, event_id: EV, organization_id: O.id,
    architectural_quality: 'The marina buildings follow the village’s terraced silhouette: low stone-clad volumes, green roofs and a quay promenade open to the public.',
    biodiversity: 'A 2-hectare Posidonia seagrass meadow has been replanted since 2023 with the local university; mooring buoys in the outer bay use eco-anchors so the meadow can recover.',
    biodiversity_image: P('gallery-sustainability.png'),
    water: 'Grey- and black-water pump-out at every berth, rainwater harvesting for the boatyard and continuous water-quality sensors at the basin entrance.',
    water_image: P('gallery-aerial.png'),
    energy: 'Solar canopies over three pontoons produce 40% of the marina’s electricity; smart pedestals meter shore power per berth and charge electric boats.',
    energy_image: P('gallery-sustainability.png'),
    waste: 'Sorted waste stations on every pontoon, used-oil and battery recovery at the boatyard, and a ban on single-use plastics in quay restaurants.',
    waste_image: null,
    innovation: 'A digital berth-availability map shared with neighbouring marinas cuts cruising around the bay looking for a slot.',
    innovation_image: P('gallery-evening.png'),
    security: 'Access-controlled pontoons, 24/7 harbour office and CCTV coverage of the basin and quay.',
    security_image: P('gallery-superyacht.png'),
    sustainable_diff: 'Energy, water and biodiversity measured and published every season.',
    further_info: 'Visit us on the Marina & Architect Presentations session on 20 September.',
    created_at: '2026-07-01T09:00:00Z', updated_at: '2026-09-01T16:20:00Z',
  }];

  const sm_attendee: Row[] = [
    { id: 'att-luca', registration_id: REG, event_id: EV, first_name: U.first_name, last_name: U.last_name, email: U.email, job_title: U.job_title, user_id: U.id, is_primary: true, attending: true, dietary: null, accessibility: null, created_at: '2026-06-18T08:30:00Z', updated_at: '2026-09-02T10:12:00Z' },
    { id: 'att-giulia', registration_id: REG, event_id: EV, first_name: 'Giulia', last_name: 'Ferraro', email: 'giulia.ferraro@marinaportovelaria.com', job_title: 'Sustainability Manager', user_id: null, is_primary: false, attending: true, dietary: 'Vegetarian', accessibility: null, created_at: '2026-07-02T09:00:00Z', updated_at: '2026-09-02T10:12:00Z' },
    { id: 'att-marco', registration_id: REG, event_id: EV, first_name: 'Marco', last_name: 'Bellini', email: 'marco.bellini@marinaportovelaria.com', job_title: 'Harbour Master', user_id: null, is_primary: false, attending: true, dietary: null, accessibility: null, created_at: '2026-07-02T09:05:00Z', updated_at: '2026-09-02T10:12:00Z' },
  ];

  const sm_payment: Row[] = [{
    id: 'pay-porto-velaria', event_id: EV, registration_id: REG, amount_cents: 165000, currency: 'EUR', status: 'paid',
    invoice_ref: 'SM26-0142', invoiced_at: '2026-06-20T10:00:00Z', paid_at: '2026-07-03T14:22:00Z', note: null,
    created_at: '2026-06-20T10:00:00Z', updated_at: '2026-07-03T14:22:00Z',
  }];

  const sm_invoice: Row[] = [{
    id: 'inv-porto-velaria', event_id: EV, registration_id: REG, file_path: P('invoice-SM26-0142.pdf'),
    label: 'Invoice SM26-0142 — Marina exhibitor + 1 extra attendee', amount_cents: 165000, currency: 'EUR',
    created_by: null, created_at: '2026-06-20T10:00:00Z',
  }];

  const sm_logistics: Row[] = [{
    registration_id: REG, event_id: EV, coming_on_site: true, stand_people: 2, power_needed: true,
    power_details: 'One 55" screen and a laptop', internet_needed: true, water_needed: false, vehicle_access: false,
    vehicle_details: null, setup_preference: 'Close to the terrace if possible', brunch_covers: 3,
    notes: 'We will bring a roll-up banner and brochures.', submitted_at: '2026-09-03T08:40:00Z', updated_at: '2026-09-03T08:40:00Z',
  }];

  const sm_logistics_item: Row[] = [{
    id: 'li-rollup', registration_id: REG, event_id: EV, kind: 'banner', label: 'Roll-up banner', width_cm: 85, height_cm: 200,
    depth_cm: 30, weight_kg: 4, photo_path: null, needs_approval: false, approval_status: 'approved', approval_note: null,
    created_at: '2026-09-03T08:40:00Z',
  }];

  // The designed catalogue page waits for the marina's approval — approving it
  // makes a natural scene to film.
  const sm_ecat_page: Row[] = [{
    id: 'ecat-porto-velaria', event_id: EV, role_assignment_id: RA, registration_id: REG, kind: 'marina', status: 'uploaded',
    designed_file_path: P('ecat-page.png'), published_file_path: null, published_at: null,
    created_at: '2026-09-04T09:00:00Z', updated_at: '2026-09-10T15:30:00Z',
  }];

  const sm_ecat_comment: Row[] = [
    { id: 'ec-1', ecat_page_id: 'ecat-porto-velaria', author_user_id: null, author_role: 'designer', body: 'First layout of your catalogue page is ready.', created_at: '2026-09-05T11:00:00Z', attachment_paths: null },
    { id: 'ec-2', ecat_page_id: 'ecat-porto-velaria', author_user_id: U.id, author_role: 'participant', body: 'Could you use the aerial view higher on the page and add our Blue Flag?', created_at: '2026-09-06T08:15:00Z', attachment_paths: null },
    { id: 'ec-3', ecat_page_id: 'ecat-porto-velaria', author_user_id: null, author_role: 'designer', body: 'Updated version uploaded with both changes.', created_at: '2026-09-10T15:30:00Z', attachment_paths: null },
  ];

  const sm_media_kit: Row[] = [{
    registration_id: REG, event_id: EV,
    caption: 'We are exhibiting at the Smart & Sustainable Marina Rendezvous 2026, 20–21 September at the Yacht Club de Monaco. Come and see how Marina di Porto Velaria combines solar pontoons, electric boat charging and seagrass restoration. #SmartMarina #SustainableMarinas',
    notified_at: '2026-09-11T09:00:00Z', created_by: null, created_at: '2026-09-11T08:30:00Z', updated_at: '2026-09-11T09:00:00Z',
    first_viewed_at: null, first_downloaded_at: null,
  }];

  const sm_media_kit_file: Row[] = [
    ['mk-square', 'social-square.png', 'Instagram post — Meet us at SM26.png'],
    ['mk-story', 'social-story.png', 'Instagram story — Meet us at SM26.png'],
    ['mk-linkedin', 'linkedin-banner.png', 'LinkedIn banner — SM26.png'],
    ['mk-signature', 'email-signature.png', 'Email signature — SM26.png'],
  ].map(([id, file, filename], i) => ({
    id, registration_id: REG, event_id: EV, storage_path: P(`mediakit/${file}`), filename, mime: 'image/png', size_bytes: 480000,
    created_by: null, created_at: `2026-09-11T08:3${i}:00Z`,
  }));

  // People the marina has already met through the networking QR codes (fictional).
  const guest = (id: string, name: string, company: string, email: string) =>
    ({ id, event_id: EV, kind: 'guest', token: `demo${id.replace(/[^a-z0-9]/g, '')}`, name, company, email, user_id: null, registration_id: null, created_at: '2026-09-12T09:00:00Z', revoked_at: null });
  const sm_networking_pass: Row[] = [
    guest('np-berthwise', 'Sofia Lindqvist', 'Berthwise Analytics', 'sofia@berthwise.example'),
    guest('np-voltamar', 'Julien Marchetti', 'Voltamar Charging', 'julien@voltamar.example'),
    guest('np-coralith', 'Amira Haddad', 'Coralith Materials', 'amira@coralith.example'),
  ];
  const sm_connection: Row[] = [
    { id: 'cx-1', event_id: EV, to_registration_id: null, from_user_id: U.id, from_registration_id: REG, from_name: `${U.first_name} ${U.last_name}`, from_email: U.email, from_company: O.name, to_pass_id: 'np-voltamar', from_pass_id: null, note: 'Shore-power pilot for the outer mole — send specs', introduced_at: '2026-09-12T10:05:00Z', created_at: '2026-09-12T10:00:00Z' },
    { id: 'cx-2', event_id: EV, to_registration_id: null, from_user_id: U.id, from_registration_id: REG, from_name: `${U.first_name} ${U.last_name}`, from_email: U.email, from_company: O.name, to_pass_id: 'np-berthwise', from_pass_id: null, note: 'Berth occupancy dashboard demo', introduced_at: null, created_at: '2026-09-12T11:20:00Z' },
    { id: 'cx-3', event_id: EV, to_registration_id: null, from_user_id: U.id, from_registration_id: REG, from_name: `${U.first_name} ${U.last_name}`, from_email: U.email, from_company: O.name, to_pass_id: 'np-coralith', from_pass_id: null, note: null, introduced_at: null, created_at: '2026-09-12T14:45:00Z' },
  ];

  const sm_notification: Row[] = [
    { id: 'n-1', user_id: U.id, type: 'sm26_media_kit_ready', title: 'Your media kit is ready', body: 'Visuals and a caption to announce your participation.', link: '/account?tab=event&sub=mediakit', read_at: null, created_at: '2026-09-11T09:00:00Z' },
    { id: 'n-2', user_id: U.id, type: 'sm26_ecat_uploaded', title: 'Your catalogue page is ready to review', body: 'The designer uploaded an updated version of your page.', link: '/account?tab=event&sub=catalogue', read_at: null, created_at: '2026-09-10T15:30:00Z' },
    { id: 'n-3', user_id: U.id, type: 'sm26_programme', title: 'The programme is published', body: 'Book your workshops — seats are limited.', link: '/sm26/agenda', read_at: '2026-09-09T08:00:00Z', created_at: '2026-09-08T17:00:00Z' },
  ];

  // Day 1 workshop already booked; day 2 is left open to book on camera.
  const sm_workshop_booking: Row[] = [
    { id: 'wb-1', event_id: EV, session_id: 'fb2ef90f-5290-4db7-b605-f84e902189bc', user_id: U.id, day_date: '2026-09-20', status: 'booked', waitlist_pos: null, created_at: '2026-09-09T08:10:00Z' },
  ];

  const sm_session: Row[] = PROGRAMME.map((p, i) => ({
    id: p.id, event_id: EV, title: p.title, description: p.description, type: p.type, starts_at: p.starts_at, ends_at: p.ends_at,
    room: p.room, speakers: p.speakers, capacity: p.capacity, presentation_enabled: p.presentation_enabled, deck_path: null,
    share_with_audience: p.share_with_audience, published: true, display_order: i, qa_enabled: p.qa_enabled,
    created_at: '2026-08-01T09:00:00Z', updated_at: '2026-09-10T09:00:00Z',
  }));

  const eco = platformRows();

  return {
    ...eco,
    profiles: [...profiles, ...eco.profiles],
    organizations: [...organizations, ...eco.organizations],
    organization_members: [...organization_members, ...eco.organization_members],
    organization_interest_sectors: [...organization_interest_sectors, ...eco.organization_interest_sectors],
    organization_service_sectors: eco.organization_service_sectors,
    organization_marina_details, organization_future_plans: [], organization_invitations: [],
    organization_tier_config: TIERS, sectors: SECTORS,
    sm_event, sm_registration, sm_role_assignment, sm_role_requirement: MARINA_REQUIREMENTS, sm_session,
    sm_workshop_booking, sm_feedback_question: FEEDBACK_QUESTIONS, sm_feedback_response: [], sm_fee_config: FEES,
    sm_vote_config: VOTE_CONFIG, sm_marina_extra, sm_attendee, sm_payment, sm_invoice, sm_logistics, sm_logistics_item,
    sm_ecat_page, sm_ecat_comment, sm_media_kit, sm_media_kit_file, sm_networking_pass, sm_connection, sm_notification,
    sm_badge: [], sm_checkin: [], sm_session_question: [], sm_question_vote: [], sm_public_vote: [],
  };
}
