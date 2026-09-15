// Reference data copied from the live platform: industry sectors, tier
// configuration, the SM26 marina requirement checklist, feedback questions and
// fee grid. None of it is personal data.
import { DEMO_EVENT_ID as EV } from '../identity';

export const SECTORS = [
  ['fc40c1b2-71ce-4b28-af3b-5070d2884345', 'dredging-civil-engineering', 'Dredging & Civil Engineering'],
  ['ae348dfc-5f12-4935-a043-2cc8a56c4cac', 'electrical-energy-systems', 'Electrical & Energy Systems'],
  ['d3b0ee3d-0114-44a4-8cdf-de5e9c3c123a', 'environmental-sustainability', 'Environmental & Sustainability'],
  ['d141576d-938f-4368-9427-18e0a4752177', 'floating-structures-pontoons', 'Floating Structures & Pontoons'],
  ['45d8641b-b27d-40a3-9637-77df44bb5fa0', 'ict-smart-marina-solutions', 'ICT & Smart Marina Solutions'],
  ['ae875edb-1ddc-4ef4-a50c-fa364068e42e', 'insurance-risk-management', 'Insurance & Risk Management'],
  ['150d57b5-ac2b-4605-b86e-b6f7778d211c', 'legal-regulatory', 'Legal & Regulatory'],
  ['910e6642-1799-4e87-8e99-7238cbd47108', 'marina-design-architecture', 'Marina Design & Architecture'],
  ['a89d330f-4475-4d56-b8a2-163fbc217ced', 'marina-equipment-hardware', 'Marina Equipment & Hardware'],
  ['6d5a2397-c45c-4e85-8437-6314f5822d27', 'marina-management-operations', 'Marina Management & Operations'],
  ['1e9681a7-c64d-4236-8588-c0e27e41da48', 'marina-software-saas', 'Marina Software & SaaS'],
  ['dd9a5095-4f17-429a-9696-7434be800967', 'marketing-communication', 'Marketing & Communication'],
  ['1712edeb-0c32-4eea-af6d-82c57859ec2d', 'mooring-anchoring-systems', 'Mooring & Anchoring Systems'],
  ['d2e61497-4150-460f-83f9-064bb73a6729', 'naval-architecture', 'Naval Architecture'],
  ['578fc93a-f586-4c1a-849a-f7ff87bc08cb', 'safety-security', 'Safety & Security'],
  ['098ccd90-a1e6-4f12-9cb3-9d8b8c7da21a', 'waste-management-water-treatment', 'Waste Management & Water Treatment'],
  ['49420624-a286-4353-8a4b-086de8d391e1', 'yacht-services-concierge', 'Yacht Services & Concierge'],
].map(([id, slug, label]) => ({ id, slug, label, is_active: true, created_at: '2026-01-10T09:00:00Z', updated_at: '2026-01-10T09:00:00Z' }));

export const sectorId = (slug: string) => SECTORS.find(s => s.slug === slug)!.id;

export const TIERS = [
  { tier: 'member', max_seats: 1, can_invite: true, label: 'Member' },
  { tier: 'innovation_partner', max_seats: 5, can_invite: true, label: 'Innovation Partner' },
  { tier: 'associate_partner', max_seats: 10, can_invite: true, label: 'Associate Partner' },
  { tier: 'premium_partner', max_seats: 15, can_invite: true, label: 'Premium Partner' },
  { tier: 'main_sponsor', max_seats: 25, can_invite: true, label: 'Main Sponsor' },
];

const req = (id: string, field_key: string, label: string, display_order: number, required = false, is_asset = false) =>
  ({ id, event_id: EV, role: 'marina', field_key, label, required, is_asset, autofill_source: null, display_order });

export const MARINA_REQUIREMENTS = [
  req('07b547bd-9a8a-4277-b2c9-667ab6ed90b5', 'logo', 'Marina logo', 1, true, true),
  req('c7f14ca2-ff88-43f8-8894-866b00bba0a2', 'hero_image', 'Hero image for the e-catalogue', 2, true, true),
  req('8245ce8b-eed8-45a4-bdb1-e1c55a084b5c', 'type', 'Marina type (in operation / in project)', 3),
  req('52977135-048a-417a-9a5b-606fa5422461', 'completion_date', 'In operation since / completion date', 4),
  req('725e3451-3b98-4ff9-a382-7145fe557791', 'total_berths', 'Total berths', 5),
  req('b3de615e-bda4-4695-a8ef-643e27216c74', 'superyacht_berths', 'Superyacht berths', 6),
  req('a994b605-e9d2-47f2-83a6-563bb5e82bd2', 'longest_berths', 'Longest berth (m)', 7),
  req('a4b56b3a-14ec-4ea2-97de-f1ea6b590d86', 'boat_range', 'Size range of boats (m)', 8),
  req('315426a9-fee3-4ca2-871f-c8e4b5f132a6', 'fresh_water', 'Fresh water (Yes/No)', 9),
  req('8de54432-5f97-4815-a33e-da73c97fb0b3', 'yacht_club', 'Yacht club (Yes/No)', 10),
  req('7d621cfc-4fae-4ea2-95c7-95fa46ac7883', 'sailing_school', 'Sailing school / watersports (Yes/No)', 11),
  req('ccf7deb2-b563-4eb6-902a-51ca6bdef900', 'boat_yard', 'Boat yard (Yes/No)', 12),
  req('4703ad7c-ba94-4d6e-99dd-1e77b44730d7', 'restaurants', 'Restaurants (Yes/No)', 13),
  req('0d6073ab-b195-4637-a171-d89a214521d5', 'concierge', 'Concierge services (Yes/No)', 14),
  req('bca665ff-3031-4259-b456-b1220958b680', 'certification', 'Certifications', 15),
  req('7ffcedff-6b47-4f52-a99a-3c823a9ce92b', 'overview', 'Overview of the marina', 16),
  req('9a4978fa-35d3-4a02-b862-0dbf05d003a8', 'services', 'Description of services', 17),
  req('05289955-b088-4aa3-a4c1-0ffba9060aba', 'sustainable_diff', 'Sustainable differentiation & smart solutions', 18),
  req('8b622749-bad5-4664-9502-e4b089ceabda', 'hd_images', 'Marina photos — add as many as you like', 19, false, true),
  req('60989396-4090-4841-8090-32f430f2f2c6', 'pitch', 'Pitching at the event (Yes/No)', 20),
  req('88ed816c-b882-4de6-9f0d-636082247c2d', 'pitch_deck', 'Pitch presentation / video', 21, false, true),
  req('d6227150-bbbe-458b-9a59-b721c72d7a2d', 'linkedin', 'LinkedIn', 22),
  req('c4d627fc-a9cf-447d-9152-3f1c7d9ac1f5', 'instagram', 'Instagram', 23),
  req('69b2fead-aeec-4eed-857e-361a21db1a72', 'facebook', 'Facebook', 24),
  req('ce4e84b7-4677-4431-bc11-51591925abb0', 'twitter', 'X / Twitter', 25),
  req('498d6b7e-06f8-4b61-8a89-7aa8c45ac2ae', 'contact_photo', 'Contact photo (internal — not on the catalogue page)', 26, false, true),
];

const fq = (key: string, label: string, kind: string, display_order: number, section: string, required = false, help: string | null = null, options: any = null) =>
  ({ id: `fq-${key}`, event_id: EV, key, label, kind, required, display_order, section, help, options, created_at: '2026-08-01T09:00:00Z' });

export const FEEDBACK_QUESTIONS = [
  fq('overall', 'Out of 5, how would you rate the Rendezvous?', 'rating', 10, 'Overall', true),
  fq('org_comms', 'Communication before the event', 'rating', 20, 'Organisation'),
  fq('org_prep', 'Organisation before the event', 'rating', 21, 'Organisation'),
  fq('org_assist', 'Assistance received before and during the event', 'rating', 22, 'Organisation'),
  fq('org_catering', 'Coffee breaks, lunch and cocktail dinner', 'rating', 23, 'Organisation'),
  fq('org_programme', 'Quality of the programme', 'rating', 24, 'Organisation'),
  fq('org_fee', 'Value for the access fee', 'rating', 25, 'Organisation'),
  fq('org_comment', 'Anything else about the organisation?', 'text', 26, 'Organisation'),
  fq('objectives', 'What was your objective in taking part?', 'multiselect', 30, 'Your participation', false, 'Choose as many as apply.', { choices: ['Promoting my product or service', 'Keeping up with marina industry trends', 'Acting for a greener industry', 'Visibility for my company', 'Discovering a potential market', 'Networking', 'Meeting innovative companies'] }),
  fq('participation', 'How did the event deliver on each of these?', 'matrix', 31, 'Your participation', false, null, { rows: ['Visibility on site', 'Visibility online', 'Quality of the innovations presented', 'Opportunity to meet the right people', 'Quality of the networking'], scale: ['Poor', 'Fair', 'Average', 'Good', 'Excellent'] }),
  fq('found_solutions', 'Did you find any innovation you plan to use?', 'text', 32, 'Your participation', false, 'A product, a service, a supplier — anything you left intending to follow up on.'),
  fq('collaborations', 'Any collaboration you are considering thanks to this event?', 'text', 33, 'Your participation', false, 'Name the companies if you can. We follow these up a few months later to measure what the Rendezvous actually generated.'),
  fq('sessions', 'Remarks on the sessions you attended', 'per_session', 40, 'Programme', false, 'Leave blank for anything you did not attend.'),
  fq('workshops', 'Feedback on the round-table workshops', 'text', 41, 'Programme'),
  fq('actions_now', 'What should the industry do without delay to move towards sustainable marinas?', 'text', 50, 'Looking ahead'),
  fq('your_involvement', 'How could you or your company get more involved?', 'text', 51, 'Looking ahead'),
  fq('m3_help', 'How could M3 accelerate or help that transition?', 'text', 52, 'Looking ahead'),
  fq('improve', 'What should M3 improve for the next edition?', 'text', 53, 'Looking ahead'),
  fq('return_next', 'Would you like to take part again?', 'yesno', 54, 'Looking ahead', true),
  fq('consent', 'May we mention your name and company in our promotional material?', 'yesno', 60, 'Permission', true, 'Yes lets us cite your participation publicly. No keeps your answers for our own improvement only — either way, everything you wrote above is read.'),
];

export const FEES = [
  ['visitor', 'Visitor ticket', 48000],
  ['marina', 'Marina exhibitor', 144000],
  ['innovation', 'Innovation entry', 72000],
  ['extra_attendee', 'Extra exhibitor attendee', 21000],
  ['architecture_onsite_pro', 'Architecture onsite (Professional)', 60000],
  ['architecture_onsite_student', 'Architecture onsite (Student)', 12000],
].map(([fee_key, label, amount_cents]) => ({ id: `fee-${fee_key}`, event_id: EV, fee_key, label, amount_cents, currency: 'EUR', created_at: '2026-06-01T09:00:00Z', updated_at: '2026-06-01T09:00:00Z' }));

export const VOTE_CONFIG = ['innovation', 'architecture_pro', 'architecture_student'].map(competition => ({ event_id: EV, competition, is_open: false }));
