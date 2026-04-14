/**
 * Seed script — Insert Smart Marina 2025 Conference articles as resources.
 *
 * Usage:
 *   npx tsx scripts/seed-resources.ts
 *
 * Requires: VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env
 * (or hardcode them below for one-time use)
 */
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

// ── Supabase client (service role for admin insert) ──
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://djjbgzasuomhyfvtlidi.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!SUPABASE_KEY) {
  console.error('❌ Set SUPABASE_SERVICE_ROLE_KEY env var (service role key from Supabase dashboard)');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── Article definitions ──
interface ArticleDef {
  file: string;
  title: string;
  summary: string;
  topic: string;
  seo_keywords: string;
  speakers: { full_name: string; job_title: string; company_name: string }[];
  /** Sector slugs to match against sectors table */
  sector_slugs: string[];
}

const ARTICLES_DIR = path.resolve(__dirname, '../../Resources/Smart Marina 2026');

const articles: ArticleDef[] = [
  {
    file: 'article-01-creating-exclusive-coastal-destinations.html',
    title: 'Creating Exclusive Coastal Destinations While Preserving Nature',
    summary: 'Panel examining how sustainable development, maritime innovation, and architectural identity shape next-generation coastal destinations — balancing luxury with ecological responsibility and cultural preservation.',
    topic: 'Sustainability',
    seo_keywords: 'coastal development, sustainable marina, regenerative design, ESG, cultural preservation, waterfront architecture',
    speakers: [
      { full_name: 'Neity Maddock', job_title: 'Moderator', company_name: '' },
      { full_name: 'Vienna Eleuteri', job_title: 'CEO Advisor', company_name: 'Saudi Red Sea Authority' },
      { full_name: 'Yasser Al Jaidah', job_title: 'President & CEO', company_name: 'UDC' },
      { full_name: 'Luca Dini', job_title: 'President & CEO', company_name: 'Luca Dini Design & Architecture' },
    ],
    sector_slugs: ['environmental-sustainability', 'marina-design-architecture'],
  },
  {
    file: 'article-02-financial-regulatory-frameworks.html',
    title: 'Financial & Regulatory Frameworks for Coastal Tourism Destinations',
    summary: 'Industry leaders discuss the financial mechanisms, investment models, and regulatory conditions driving global marina development — from Latin America to Asia and the Middle East.',
    topic: 'Management',
    seo_keywords: 'marina investment, regulatory frameworks, concession models, PPP, blue economy finance, institutional capital',
    speakers: [
      { full_name: 'Neity Maddock', job_title: 'Moderator', company_name: '' },
      { full_name: 'Gabriela Lobato Marins', job_title: 'CEO', company_name: 'Marinas do Brasil' },
      { full_name: 'Steve English', job_title: 'CEO', company_name: 'IGY Marinas' },
      { full_name: 'Benjamin Wong', job_title: 'Head of Transport and Logistics', company_name: 'Invest Hong Kong' },
      { full_name: 'Derek Van Brussel', job_title: 'Co-Founder', company_name: 'Baltisse Marinas' },
    ],
    sector_slugs: ['legal-regulatory', 'marina-management-operations'],
  },
  {
    file: 'article-03-leveraging-data-analytics.html',
    title: 'Leveraging Data Analytics for Responsible Marina Operations',
    summary: 'How data analytics and AI systems are redefining marina operations — from Monaco\'s smart city digital twins to industry-wide data standardization and ethical AI governance.',
    topic: 'Technology',
    seo_keywords: 'data analytics, AI marina, digital twin, IoT sensors, data sovereignty, smart marina, predictive analytics',
    speakers: [
      { full_name: 'Neity Maddock', job_title: 'Moderator', company_name: '' },
      { full_name: 'Yannick Léo', job_title: 'Head of Data & AI', company_name: 'Principality of Monaco' },
      { full_name: 'Marco Landi', job_title: 'AI Expert', company_name: 'Maison de l\'Intelligence Artificielle' },
      { full_name: 'Idan Cohen', job_title: 'Co-Founder & CEO', company_name: 'Pick a Pier' },
    ],
    sector_slugs: ['ict-smart-marina-solutions', 'environmental-sustainability', 'marina-software-saas'],
  },
  {
    file: 'article-04-meeting-crew-guest-vessel-needs.html',
    title: 'Meeting Crew, Guest & Vessel Needs in Modern Marinas',
    summary: 'Workshop exploring operational, logistical, and experiential needs of crew, guests, and vessels — from unified booking systems to AI-powered safety monitoring and sustainable vessel infrastructure.',
    topic: 'Management',
    seo_keywords: 'marina operations, crew needs, guest experience, vessel logistics, booking systems, smart marina, captain needs',
    speakers: [
      { full_name: 'Oscar Siches', job_title: 'Workshop Leader', company_name: 'Marina Consultant' },
    ],
    sector_slugs: ['marina-management-operations', 'ict-smart-marina-solutions', 'yacht-services-concierge'],
  },
  {
    file: 'article-05-marina-management-meets-opera.html',
    title: 'When Marina Management Meets Opera: Art, Culture & Service Excellence',
    summary: 'A creative workshop using opera as metaphor for marina management — exploring community engagement, emotional resonance, cultural sensitivity, and the transformation of marinas into living public spaces.',
    topic: 'Management',
    seo_keywords: 'marina culture, community engagement, service excellence, hospitality, cultural sensitivity, marina design, human experience',
    speakers: [
      { full_name: 'Oscar Siches', job_title: 'Workshop Moderator', company_name: 'Marina Consultant' },
    ],
    sector_slugs: ['marina-management-operations', 'yacht-services-concierge'],
  },
  {
    file: 'article-06-what-to-do-with-data.html',
    title: 'What To Do With Data: Standardization, KPIs & Smart Marina Strategy',
    summary: 'Workshop addressing the fundamental challenge of data standardization in the marina industry — building common KPIs, benchmarking frameworks, and practical strategies for digital transformation.',
    topic: 'Technology',
    seo_keywords: 'data standardization, marina KPIs, benchmarking, smart sensors, digital transformation, sustainability metrics, AI marina',
    speakers: [
      { full_name: 'Idan Cohen', job_title: 'Workshop Leader & CEO', company_name: 'Pick a Pier' },
    ],
    sector_slugs: ['ict-smart-marina-solutions', 'environmental-sustainability', 'marina-software-saas'],
  },
  {
    file: 'article-07-raising-startup-funding.html',
    title: 'Raising Startup Funding in the Blue Economy',
    summary: 'Workshop providing practical guidance on fundraising for marine technology startups — covering venture capital, angel investment, hardware-as-a-service models, and regional investment environments.',
    topic: 'Management',
    seo_keywords: 'startup funding, venture capital, angel investment, blue economy, marine technology, fundraising, investor relations',
    speakers: [],
    sector_slugs: ['legal-regulatory', 'ict-smart-marina-solutions'],
  },
];

// ── Extract article body from HTML ──
function extractContent(html: string): string {
  // Try <article>...</article> first
  const articleMatch = html.match(/<article[\s>]([\s\S]*?)<\/article>/i);
  if (articleMatch) {
    // Also grab the intro div if it exists before <article>
    const introMatch = html.match(/<div class="intro">([\s\S]*?)<\/div>\s*<article/i);
    const intro = introMatch ? introMatch[1].trim() : '';
    return (intro ? `<div class="intro">${intro}</div>\n` : '') + articleMatch[0];
  }

  // Fall back to <main>...</main>
  const mainMatch = html.match(/<main[\s>]([\s\S]*?)<\/main>/i);
  if (mainMatch) return mainMatch[1].trim();

  // Last resort: grab everything between </header> and <footer>
  const bodyMatch = html.match(/<\/header>([\s\S]*?)<footer/i);
  if (bodyMatch) return bodyMatch[1].trim();

  return '';
}

// ── Main ──
async function main() {
  console.log('🚀 Seeding Smart Marina 2025 Conference articles...\n');

  // 1. Fetch all sectors to build slug→id map
  const { data: sectors, error: secErr } = await supabase
    .from('sectors')
    .select('id, slug')
    .eq('is_active', true);
  if (secErr) { console.error('Failed to fetch sectors:', secErr); return; }
  const sectorMap = new Map((sectors || []).map(s => [s.slug, s.id]));
  console.log(`📂 Loaded ${sectorMap.size} sectors`);

  for (let i = 0; i < articles.length; i++) {
    const art = articles[i];
    const filePath = path.join(ARTICLES_DIR, art.file);

    if (!fs.existsSync(filePath)) {
      console.error(`❌ File not found: ${filePath}`);
      continue;
    }

    const html = fs.readFileSync(filePath, 'utf-8');
    const content = extractContent(html);

    if (!content) {
      console.error(`❌ Could not extract content from: ${art.file}`);
      continue;
    }

    console.log(`\n📝 [${i + 1}/7] ${art.title}`);

    // 2. Insert resource
    const { data: resource, error: resErr } = await supabase
      .from('resources')
      .insert({
        title: art.title,
        summary: art.summary,
        content,
        type: 'article',
        topic: art.topic,
        language: 'EN',
        access_level: 'members',
        thumbnail_url: null,
        file_url: null,
        seo_keywords: art.seo_keywords,
        published: true,
        tags: ['Smart Marina 2025', 'Conference'],
      })
      .select('id')
      .single();

    if (resErr) {
      console.error(`   ❌ Insert failed:`, resErr.message);
      continue;
    }

    const resourceId = resource.id;
    console.log(`   ✅ Resource created: ${resourceId}`);

    // 3. Insert speakers
    if (art.speakers.length > 0) {
      const speakerRows = art.speakers.map((s, idx) => ({
        resource_id: resourceId,
        full_name: s.full_name,
        job_title: s.job_title || null,
        company_name: s.company_name || null,
        display_order: idx + 1,
      }));

      const { error: spkErr } = await supabase
        .from('resource_speakers')
        .insert(speakerRows);
      if (spkErr) {
        console.error(`   ⚠️  Speaker insert failed:`, spkErr.message);
      } else {
        console.log(`   👤 ${speakerRows.length} speaker(s) added`);
      }
    }

    // 4. Associate sectors
    const sectorIds = art.sector_slugs
      .map(slug => sectorMap.get(slug))
      .filter((id): id is string => !!id);

    if (sectorIds.length > 0) {
      const sectorRows = sectorIds.map(sid => ({
        resource_id: resourceId,
        sector_id: sid,
      }));

      const { error: secInsErr } = await supabase
        .from('resource_sectors')
        .insert(sectorRows);
      if (secInsErr) {
        console.error(`   ⚠️  Sector insert failed:`, secInsErr.message);
      } else {
        console.log(`   🏷️  ${sectorIds.length} sector(s) linked`);
      }
    }
  }

  console.log('\n✅ Done! All articles seeded.');
}

main().catch(console.error);
