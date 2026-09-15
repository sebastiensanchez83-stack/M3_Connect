// The published SM26 programme, as shown publicly on /sm26/agenda (snapshot of
// 15 Sep 2026). Workshop fill levels are kept close to reality so the booking
// flow on camera shows a mix of open, nearly full and waitlisted sessions.
export type DemoSession = {
  id: string; title: string; description: string | null; type: string;
  starts_at: string; ends_at: string; room: string; speakers: string | null;
  capacity: number | null; qa_enabled: boolean; presentation_enabled: boolean;
  share_with_audience: boolean; booked_others: number; published: boolean;
};

const s = (
  id: string, title: string, description: string | null, type: string, starts_at: string, ends_at: string,
  room: string, capacity: number | null = null, booked_others = 0,
): DemoSession => ({
  id, title, description, type, starts_at, ends_at, room, speakers: null, capacity,
  qa_enabled: false, presentation_enabled: false, share_with_audience: false, booked_others, published: true,
});

export const PROGRAMME: DemoSession[] = [
  s('22458182-b8d6-4270-81a0-6e71cf6d9cfe', 'Exhibition Set-up [Only for exhibitors]', 'This is the time for all exhibitors to come and setup their allocated spaces with their marketing materials', 'ceremony', '2026-09-20T06:00:00Z', '2026-09-20T09:30:00Z', 'Ballroom - 2nd floor'),
  s('57766ed2-9fe0-4807-89cb-88d3112a1473', 'Official Opening', null, 'ceremony', '2026-09-20T12:00:00Z', '2026-09-20T12:15:00Z', 'Ballroom - 2nd floor'),
  s('fcd41f28-fbc6-4d11-8ad5-89645d2ce161', 'Speed networking', 'Structured one-on-one introductions to meet each other before the event begins.', 'talk', '2026-09-20T12:15:00Z', '2026-09-20T13:15:00Z', 'Ballroom - 2nd floor'),
  s('7930dc87-76b8-4ac3-afc8-c3c0737f1d2b', 'Workshop 1 - Cybersecurity', 'Cybersecurity and the Connected Marina\nThe attack surface no one wants to talk about. Ransomware, OT exploits and what operators are actually doing about it.', 'workshop', '2026-09-20T13:15:00Z', '2026-09-20T14:15:00Z', 'Ballroom Alcove - 2nd floor', 10, 7),
  s('a49a37b8-7ed8-46a9-8b80-ddae11a75fdd', 'Workshop 2 - New materials', 'The New Construction Materials Reshaping Marinas\nBio-concrete, recycled composites, upcycled sediment: the materials that will build the next generation of pontoons, breakwaters and berths.', 'workshop', '2026-09-20T13:15:00Z', '2026-09-20T14:15:00Z', 'Ballroom Alcove - 2nd floor', 10, 10),
  s('fb2ef90f-5290-4db7-b605-f84e902189bc', 'Workshop 3 - Decarbonisation', 'After the Refit: The Existing Fleet and the Decarbonisation Curve\nRefit economics, retrofittability and owner appetite. The decarbonisation story marinas actually live with', 'workshop', '2026-09-20T13:15:00Z', '2026-09-20T14:15:00Z', 'Ballroom Alcove - 2nd floor', 10, 5),
  s('02ede341-5c46-4d81-9e75-f06dc08efc9e', 'Marina & Architect Presentations', 'Marinas present their destinations, followed by architects presenting their entries to the annual Smart & Sustainable Marina architecture competition.', 'pitch', '2026-09-20T14:15:00Z', '2026-09-20T15:00:00Z', 'Ballroom - 2nd floor'),
  s('f6487e56-aa46-40ca-9b91-8dcf0d87afad', 'Cocktail & networking', null, 'meal', '2026-09-20T15:00:00Z', '2026-09-20T20:00:00Z', 'Ballroom & Terrace - 2nd floor'),
  s('223bc786-9728-4e2a-a3ce-8aab5b3e64dc', 'Breakfast & Networking', null, 'meal', '2026-09-21T07:00:00Z', '2026-09-21T07:30:00Z', 'Conference room - Ground floor'),
  s('7c78bf07-b5af-443c-bcad-0ecc1617fd63', 'Opening keynote', null, 'pitch', '2026-09-21T07:30:00Z', '2026-09-21T07:40:00Z', 'Conference room - Ground floor'),
  s('f8c3772f-8ddb-4732-a300-43fe253c7c7a', 'The Bio-Positive Marina: Where Biodiversity Meets the Balance Sheet', 'Marinas that host thriving marine life command premium berths, unlock ESG-linked finance and turn a compliance cost into a revenue driver.', 'panel', '2026-09-21T07:40:00Z', '2026-09-21T08:25:00Z', 'Conference room - Ground floor'),
  s('550c78c1-0552-492a-9cba-e1a8bf847f7e', 'Innovation Top 5 · Live Pitching', 'Five jury-picked startups and scaleups pitch live to the audience', 'pitch', '2026-09-21T08:25:00Z', '2026-09-21T08:40:00Z', 'Conference room - Ground floor'),
  s('3f94cdbb-ebb8-418e-992b-ae5671e949e5', 'Coffee Break', null, 'meal', '2026-09-21T08:40:00Z', '2026-09-21T08:55:00Z', 'Conference room - Ground floor'),
  s('18c1abc3-f0a1-4dc5-98bc-2b754813705f', 'The Trillion-Euro Asset Class: A New Era of Marina Investment', "The world's marinas sit on roughly a trillion euros of waterfront real estate, regulated concessions and recurring revenue, and the investment community is only just starting to take notice.", 'panel', '2026-09-21T09:00:00Z', '2026-09-21T09:45:00Z', 'Conference room - Ground floor'),
  s('241d5c0d-09d7-445c-85b3-ba57c6161e69', 'Beyond Sustainable: The Architects, Engineers and Innovators Redrawing the Marina', 'The marinas being designed today have to be regenerative, climate-adaptive, energy-positive and beautiful at the same time.', 'panel', '2026-09-21T09:45:00Z', '2026-09-21T10:30:00Z', 'Conference room - Ground floor'),
  s('d1d0a33f-cd27-4c22-8855-204a381892f1', 'Innovation Top 5 · Live Pitching', 'Five jury-picked startups and scaleups pitch live to the audience', 'pitch', '2026-09-21T10:30:00Z', '2026-09-21T10:45:00Z', 'Conference room - Ground floor'),
  s('1a874518-4e81-44ad-9aaa-c24af74588f4', 'Lunch & Networking', null, 'meal', '2026-09-21T10:45:00Z', '2026-09-21T12:30:00Z', 'Ballroom & Terrace - 2nd floor'),
  s('970393e5-206b-4245-993d-6c906bd8bc38', 'Workshop 6 - Marina projects', "From site selection to ribbon-cutting, the operators, architects and financiers behind today's headline marina projects on what actually gets a development delivered.", 'workshop', '2026-09-21T12:30:00Z', '2026-09-21T13:30:00Z', 'Ballroom Alcove - 2nd floor', 10, 9),
  s('95f2888b-72af-4eb2-890f-afe2a449cfc0', 'Workshop 4 - AI & The waterfront', 'Yards on the building/refit floor, Marinas at the front desk, Captains on the bridge. Three jobs, one technology. What actually works.', 'workshop', '2026-09-21T12:30:00Z', '2026-09-21T13:30:00Z', 'Ballroom Alcove - 2nd floor', 10, 6),
  s('d950d926-1e60-419e-a13d-ea0b59bfdf79', 'Workshop 5 - The modern berth', 'How modern berthing infrastructure is being reinvented for electric yachts, connected services and higher demand.', 'workshop', '2026-09-21T12:30:00Z', '2026-09-21T13:30:00Z', 'Ballroom Alcove - 2nd floor', 10, 8),
  s('9c11fa74-8fa8-468b-9a0a-b8e07c1695ac', 'Marina project presentation', null, 'pitch', '2026-09-21T13:30:00Z', '2026-09-21T13:40:00Z', 'Ballroom - 2nd floor'),
  s('917ebf36-9697-49e3-8144-55be7065cb39', 'Award ceremony & closing remarks', null, 'ceremony', '2026-09-21T13:40:00Z', '2026-09-21T14:30:00Z', 'Ballroom - 2nd floor'),
  s('dce9b867-3c96-494f-9bc7-6f0cd9a1ff04', 'Cocktail & networking', null, 'ceremony', '2026-09-21T14:30:00Z', '2026-09-21T16:30:00Z', 'Ballroom & Terrace - 2nd floor'),
];
