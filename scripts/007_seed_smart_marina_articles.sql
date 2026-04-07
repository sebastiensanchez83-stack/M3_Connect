-- =============================================================================
-- 007_seed_smart_marina_articles.sql
-- Insert 7 Smart Marina Conference 2025 articles as resources
-- with speakers and sector associations.
--
-- Run in Supabase SQL Editor.
-- =============================================================================

-- ── Helper: collect sector IDs ──
DO $$
DECLARE
  v_sid_sustainability UUID;
  v_sid_infrastructure UUID;
  v_sid_consulting     UUID;
  v_sid_architecture   UUID;
  v_sid_management     UUID;
  v_sid_technology     UUID;
  v_rid UUID;
BEGIN

  -- Fetch sector IDs
  SELECT id INTO v_sid_sustainability FROM sectors WHERE slug = 'sustainability' AND is_active = true LIMIT 1;
  SELECT id INTO v_sid_infrastructure FROM sectors WHERE slug = 'infrastructure' AND is_active = true LIMIT 1;
  SELECT id INTO v_sid_consulting     FROM sectors WHERE slug = 'consulting'     AND is_active = true LIMIT 1;
  SELECT id INTO v_sid_architecture   FROM sectors WHERE slug = 'architecture'   AND is_active = true LIMIT 1;
  SELECT id INTO v_sid_management     FROM sectors WHERE slug = 'management'     AND is_active = true LIMIT 1;
  SELECT id INTO v_sid_technology     FROM sectors WHERE slug = 'technology'     AND is_active = true LIMIT 1;

  -- =========================================================================
  -- ARTICLE 1: Creating Exclusive Coastal Destinations
  -- =========================================================================
  INSERT INTO resources (title, summary, content, type, topic, language, access_level, thumbnail_url, file_url, seo_keywords, published, tags)
  VALUES (
    'Creating Exclusive Coastal Destinations While Preserving Nature',
    'Panel examining how sustainable development, maritime innovation, and architectural identity shape next-generation coastal destinations — balancing luxury with ecological responsibility and cultural preservation.',
    '<div class="intro">
<p>This session examined the intersection of sustainable development, maritime innovation, and architectural identity in shaping next-generation coastal destinations. Panelists addressed the operational, cultural, and environmental frameworks required to create exclusive yet resilient waterfronts that attract global investment while safeguarding local heritage and ecosystems.</p>
</div>
<article>
<section>
<h2>Listening as a Design Strategy</h2>
<p class="speaker-title">Luca Dini, President &amp; CEO, Luca Dini Design &amp; Architecture</p>
<p>Architect Luca Dini opened with a critique of "exported design," emphasizing that authentic coastal architecture must begin with listening rather than imposing aesthetics. Drawing on his ongoing collaboration with the Republic of Albania under its national maritime strategy, Dini detailed a methodology based on:</p>
<ul>
<li><strong>Site-specific cultural integration:</strong> Understanding Albania''s Byzantine, Roman, and Ottoman influences before defining architectural language.</li>
<li><strong>Ecological and spatial restraint:</strong> Rejecting high-density, high-rise development in favor of low-impact coastal interventions.</li>
<li><strong>Community linkage:</strong> Connecting new marinas with mountain villages to spread economic benefit inland and prevent overconcentration on the shoreline.</li>
</ul>
<p>Dini contrasted Albania''s measured approach with overdeveloped models, arguing that coastal luxury must not equate to concrete sprawl. His practice''s role is advisory, establishing design governance frameworks rather than monopolising control.</p>
</section>
<section>
<h2>Regulating for Regeneration</h2>
<p class="speaker-title">Vienna Eleuteri, CEO Advisor, Saudi Red Sea Authority</p>
<p>Vienna Eleuteri presented the Saudi Red Sea Authority''s integrated regulatory model, which governs an extensive coastal development zone encompassing pristine coral ecosystems and heritage communities. She described the Authority''s mission as building an industry from scratch while ensuring that every intervention adheres to a regenerative rather than merely sustainable standard.</p>
<ul>
<li><strong>Regulatory orchestration:</strong> Aligning private development with a national sustainability strategy that mandates biodiversity protection, cultural inclusion, and carbon neutrality.</li>
<li><strong>Contextual governance:</strong> Tailoring zoning and construction standards to the ecological and social profiles of specific coastal regions.</li>
<li><strong>Cultural continuity:</strong> Prioritizing local knowledge systems and traditional crafts as part of destination identity.</li>
</ul>
</section>
<section>
<h2>Smart Sustainability in Practice</h2>
<p class="speaker-title">Yasser Al Jaidah, President &amp; CEO, UDC</p>
<p>Yasser Al Jaidah discussed the Pearl Island and Corinthia Yacht Club projects in Qatar, both developed by United Development Company (UDC). He positioned these as operational models of sustainability within a commercially viable urban-marine framework.</p>
<ul>
<li><strong>ESG leadership:</strong> UDC was the first listed company in Qatar to publish a comprehensive ESG Report.</li>
<li><strong>Smart environmental management:</strong> Deployment of IoT-based sensors across marinas to monitor water quality, biodiversity, and pollution levels.</li>
<li><strong>Circular economy systems:</strong> Recycling wastewater for irrigation, district cooling, and landscape maintenance.</li>
<li><strong>Local innovation ecosystem:</strong> Collaboration with Qatari startups to develop sustainability technologies.</li>
</ul>
</section>
<section>
<h2>Concluding Insights</h2>
<ul>
<li><strong>Context before construction:</strong> Design must emerge from cultural, environmental, and social understanding.</li>
<li><strong>Regulation as enabler:</strong> Governance frameworks should facilitate innovation while safeguarding ecosystems.</li>
<li><strong>Technology as guardian:</strong> Digital monitoring and AI analytics are essential for maintaining live ecological accountability.</li>
<li><strong>Collaboration as foundation:</strong> Partnerships across public, private, and creative sectors ensure enduring value creation.</li>
</ul>
</section>
</article>',
    'article',
    'Sustainability',
    'EN',
    'members',
    NULL,
    NULL,
    'coastal development, sustainable marina, regenerative design, ESG, cultural preservation, waterfront architecture',
    true,
    ARRAY['Smart Marina 2025', 'Conference']
  ) RETURNING id INTO v_rid;

  -- Speakers
  INSERT INTO resource_speakers (resource_id, full_name, job_title, company_name, display_order) VALUES
    (v_rid, 'Neity Maddock', 'Moderator', '', 1),
    (v_rid, 'Vienna Eleuteri', 'CEO Advisor', 'Saudi Red Sea Authority', 2),
    (v_rid, 'Yasser Al Jaidah', 'President & CEO', 'UDC', 3),
    (v_rid, 'Luca Dini', 'President & CEO', 'Luca Dini Design & Architecture', 4);

  -- Sectors
  IF v_sid_sustainability IS NOT NULL THEN INSERT INTO resource_sectors (resource_id, sector_id) VALUES (v_rid, v_sid_sustainability); END IF;
  IF v_sid_infrastructure IS NOT NULL THEN INSERT INTO resource_sectors (resource_id, sector_id) VALUES (v_rid, v_sid_infrastructure); END IF;
  IF v_sid_consulting IS NOT NULL THEN INSERT INTO resource_sectors (resource_id, sector_id) VALUES (v_rid, v_sid_consulting); END IF;
  IF v_sid_architecture IS NOT NULL THEN INSERT INTO resource_sectors (resource_id, sector_id) VALUES (v_rid, v_sid_architecture); END IF;

  RAISE NOTICE 'Article 1 inserted: %', v_rid;

  -- =========================================================================
  -- ARTICLE 2: Financial & Regulatory Frameworks
  -- =========================================================================
  INSERT INTO resources (title, summary, content, type, topic, language, access_level, thumbnail_url, file_url, seo_keywords, published, tags)
  VALUES (
    'Financial & Regulatory Frameworks for Coastal Tourism Destinations',
    'Industry leaders discuss the financial mechanisms, investment models, and regulatory conditions driving global marina development — from Latin America to Asia and the Middle East.',
    '<section class="intro-section">
<h2>Overview</h2>
<p>This session addressed the financial mechanisms, investment models, and regulatory conditions shaping the global marina and coastal infrastructure industry. Participants examined how differing national and regional frameworks impact private capital flow, concession models, and sustainable asset development in the marine economy.</p>
<p>According to OECD figures, the ocean economy has doubled in the past 25 years, reaching USD 2.6 trillion in 2020, with continued growth at 2.8% annually.</p>
</section>
<h2>Panel Members</h2>
<ul>
<li><strong>Gabriela Lobato Marins</strong> — CEO, Marinas do Brasil</li>
<li><strong>Steve English</strong> — CEO, IGY Marinas</li>
<li><strong>Benjamin Wong</strong> — Head of Transport and Logistics, Invest Hong Kong</li>
<li><strong>Derek Van Brussel</strong> — Co-Founder, Baltisse Marinas</li>
</ul>
<h2>Brazil: Building a Regulatory Culture Around Marinas</h2>
<p>Gabriela Lobato Marins outlined the structural and bureaucratic hurdles of developing marinas along Brazil''s 7,000-km coastline. Despite immense potential, regulatory fragmentation across municipal, state, and federal authorities continues to slow progress.</p>
<ul>
<li>Capacity-building with government entities to improve licensing efficiency</li>
<li>Environmental education initiatives to embed sustainability in tourism operations</li>
<li>Private-sector-driven financing, as Brazil currently has no government funding for marina development</li>
</ul>
<h2>Latin American Investment Dynamics</h2>
<p>Derek Van Brussel confirmed the capital appetite for coastal assets in Latin America and identified a new wave of family-office interest in long-duration real-asset investments such as marinas.</p>
<ol>
<li><strong>Shift from greenfield to brownfield investment:</strong> moving from initial construction to redevelopment of aging coastal infrastructure</li>
<li><strong>Integration of real estate and marina assets:</strong> using marina developments as anchors for mixed-use waterfront regeneration</li>
</ol>
<h2>Global Perspective: IGY Marinas</h2>
<p>Steve English of IGY Marinas (24 marinas across 14 countries) provided insight into how financial maturity and regulatory alignment determine the success of long-term marina operations.</p>
<ul>
<li><strong>Investor Education:</strong> Aligning investor expectations with realistic timeframes</li>
<li><strong>Regulatory Harmonization:</strong> Sharing global best practices with local regulators</li>
<li><strong>Stakeholder Mapping:</strong> Engaging municipal and community leaders early</li>
<li><strong>Destination Development:</strong> Marinas embedded in holistic tourism ecosystems</li>
</ul>
<h2>Hong Kong and Asia-Pacific</h2>
<p>Benjamin Wong detailed the region''s renewed focus on marine infrastructure within its broader financial-services diversification strategy, including new tax concessions for family offices and broadened accessibility through public recreation facilities.</p>
<h2>Key Takeaways</h2>
<ol>
<li>Regulatory literacy among investors and local authorities remains uneven</li>
<li>Long-term concession models (50+ years) are indispensable for attracting institutional capital</li>
<li>Integration of marinas with real estate and tourism multiplies economic resilience</li>
<li>Technological and financial innovation are reshaping how capital enters the maritime sector</li>
<li>Gender and leadership diversity enhance transparency and performance</li>
</ol>',
    'article',
    'Management',
    'EN',
    'members',
    NULL,
    NULL,
    'marina investment, regulatory frameworks, concession models, PPP, blue economy finance, institutional capital',
    true,
    ARRAY['Smart Marina 2025', 'Conference']
  ) RETURNING id INTO v_rid;

  INSERT INTO resource_speakers (resource_id, full_name, job_title, company_name, display_order) VALUES
    (v_rid, 'Neity Maddock', 'Moderator', '', 1),
    (v_rid, 'Gabriela Lobato Marins', 'CEO', 'Marinas do Brasil', 2),
    (v_rid, 'Steve English', 'CEO', 'IGY Marinas', 3),
    (v_rid, 'Benjamin Wong', 'Head of Transport and Logistics', 'Invest Hong Kong', 4),
    (v_rid, 'Derek Van Brussel', 'Co-Founder', 'Baltisse Marinas', 5);

  IF v_sid_consulting IS NOT NULL THEN INSERT INTO resource_sectors (resource_id, sector_id) VALUES (v_rid, v_sid_consulting); END IF;
  IF v_sid_management IS NOT NULL THEN INSERT INTO resource_sectors (resource_id, sector_id) VALUES (v_rid, v_sid_management); END IF;
  IF v_sid_infrastructure IS NOT NULL THEN INSERT INTO resource_sectors (resource_id, sector_id) VALUES (v_rid, v_sid_infrastructure); END IF;

  RAISE NOTICE 'Article 2 inserted: %', v_rid;

  -- =========================================================================
  -- ARTICLE 3: Leveraging Data Analytics
  -- =========================================================================
  INSERT INTO resources (title, summary, content, type, topic, language, access_level, thumbnail_url, file_url, seo_keywords, published, tags)
  VALUES (
    'Leveraging Data Analytics for Responsible Marina Operations',
    'How data analytics and AI systems are redefining marina operations — from Monaco''s smart city digital twins to industry-wide data standardization and ethical AI governance.',
    '<section>
<div class="panelists">
<h3>Panelists</h3>
<ul>
<li><strong>Yannick Léo</strong> — Head of Data &amp; AI, Principality of Monaco</li>
<li><strong>Marco Landi</strong> — Maison de l''Intelligence Artificielle</li>
<li><strong>Idan Cohen</strong> — Co-Founder &amp; CEO, Pick a Pier</li>
</ul>
</div>
<p>This session examined how data analytics, AI systems, and digital governance are redefining operational efficiency and sustainability within marinas and coastal cities.</p>
</section>
<section>
<h2>The Smart City Data Ecosystem of Monaco</h2>
<p>Yannick Léo outlined the principality''s structured approach to data governance and AI deployment through the Data &amp; AI Factory, an internal platform serving all government departments.</p>
<ul>
<li><strong>Over 100 AI use cases</strong> under development for Smart City 2030 strategy</li>
<li><strong>Digital twin integration:</strong> a 3D virtual replica combining IoT sensor data, camera feeds, and 5G connectivity</li>
<li><strong>Predictive traffic management:</strong> using AI to forecast congestion based on commuter patterns</li>
<li><strong>Environmental monitoring:</strong> predictive modeling of environmental factors through AI analytics</li>
</ul>
<h3>Three Core Principles</h3>
<ol>
<li><strong>Strategic sensor architecture</strong> — Planning hardware placement for relevant, interoperable data collection</li>
<li><strong>Predictive focus</strong> — Transitioning from reactive to anticipatory governance</li>
<li><strong>Human-centric purpose</strong> — Enhancing quality of life while reducing environmental footprints</li>
</ol>
</section>
<section>
<h2>Protecting Data Sovereignty and Ethical AI</h2>
<p>Marco Landi addressed the ethical and security dimensions of data analytics. He argued that marinas must adopt localized AI models (Small Language Models) instead of depending on cloud-based systems.</p>
<ul>
<li><strong>Data sovereignty:</strong> Marinas should retain control of data on local servers</li>
<li><strong>Frugal AI:</strong> SLMs deliver efficient, domain-specific analytics using fewer resources</li>
<li><strong>Cultural transformation:</strong> True AI adoption demands an internal shift in mindset</li>
</ul>
</section>
<section>
<h2>From Fragmentation to Benchmarking</h2>
<p>Idan Cohen highlighted the systemic data fragmentation limiting AI adoption in marina management. He argued the sector must first establish common standards, build digital infrastructure, and define benchmarking metrics.</p>
</section>
<section>
<h2>Closing Reflections</h2>
<ul>
<li><strong>Marco Landi:</strong> Change management comes before AI implementation</li>
<li><strong>Idan Cohen:</strong> Collaboration is the multiplier</li>
<li><strong>Yannick Léo:</strong> AI adoption is inevitable; hesitation only widens the gap</li>
</ul>
</section>',
    'article',
    'Technology',
    'EN',
    'members',
    NULL,
    NULL,
    'data analytics, AI marina, digital twin, IoT sensors, data sovereignty, smart marina, predictive analytics',
    true,
    ARRAY['Smart Marina 2025', 'Conference']
  ) RETURNING id INTO v_rid;

  INSERT INTO resource_speakers (resource_id, full_name, job_title, company_name, display_order) VALUES
    (v_rid, 'Neity Maddock', 'Moderator', '', 1),
    (v_rid, 'Yannick Léo', 'Head of Data & AI', 'Principality of Monaco', 2),
    (v_rid, 'Marco Landi', 'AI Expert', 'Maison de l''Intelligence Artificielle', 3),
    (v_rid, 'Idan Cohen', 'Co-Founder & CEO', 'Pick a Pier', 4);

  IF v_sid_technology IS NOT NULL THEN INSERT INTO resource_sectors (resource_id, sector_id) VALUES (v_rid, v_sid_technology); END IF;
  IF v_sid_sustainability IS NOT NULL THEN INSERT INTO resource_sectors (resource_id, sector_id) VALUES (v_rid, v_sid_sustainability); END IF;
  IF v_sid_consulting IS NOT NULL THEN INSERT INTO resource_sectors (resource_id, sector_id) VALUES (v_rid, v_sid_consulting); END IF;

  RAISE NOTICE 'Article 3 inserted: %', v_rid;

  -- =========================================================================
  -- ARTICLE 4: Meeting Crew, Guest & Vessel Needs
  -- =========================================================================
  INSERT INTO resources (title, summary, content, type, topic, language, access_level, thumbnail_url, file_url, seo_keywords, published, tags)
  VALUES (
    'Meeting Crew, Guest & Vessel Needs in Modern Marinas',
    'Workshop exploring operational, logistical, and experiential needs of crew, guests, and vessels — from unified booking systems to AI-powered safety monitoring and sustainable vessel infrastructure.',
    '<section class="intro">
<p>This workshop aimed to identify the operational, logistical, and experiential needs of crew, guests, and vessels in marina environments, and to explore how innovation, digital solutions, and service integration can enhance efficiency and satisfaction.</p>
<p><strong>Three core themes:</strong></p>
<ul>
<li>Crew well-being and service support</li>
<li>Guest experience and onshore integration</li>
<li>Vessel logistics, infrastructure, and regulatory challenges</li>
</ul>
</section>
<section>
<h2>1. Current Challenges in Marina–Captain Relations</h2>
<p>Captains emphasized that they are the end customers of marina operations. Despite digitalization efforts, booking and communication remain fragmented:</p>
<ul>
<li><strong>Inefficient reservation systems:</strong> Many marinas still rely on email or phone-based booking</li>
<li><strong>Lack of real-time coordination:</strong> Changes create uncertainty and costly delays</li>
<li><strong>Limited operational transparency:</strong> Few marinas offer clear visibility on berth status or costs</li>
</ul>
</section>
<section>
<h2>2. Technology Solutions: From Booking Platforms to AI Control Systems</h2>
<h3>Integrated Booking Platforms</h3>
<p>A startup showcased an application connecting captains, marinas, and suppliers on a single interface with live berth visualization, instant confirmation, and digital payments.</p>
<h3>AI and Computer Vision</h3>
<p>Companies introduced AI-powered camera systems for berth occupancy detection, vessel identification, traffic flow, and pollution monitoring.</p>
<h3>Smart Infrastructure Sensors</h3>
<p>Radio-frequency sensors can monitor water, electricity, and waste consumption in real time, creating a foundation for smart billing and sustainability tracking.</p>
</section>
<section>
<h2>3. Captains'' Feedback</h2>
<p>Captains responded positively to digital solutions but stressed that simplicity and interoperability are essential. Specific needs included:</p>
<ul>
<li>Unified reservation and payment systems</li>
<li>Transparent cancellation policies</li>
<li>Direct communication channels with marina staff</li>
<li>Data reliability for berth dimensions, depth, and services</li>
</ul>
</section>
<section>
<h2>4. Marina Operators'' Perspectives</h2>
<p>Four critical dimensions identified:</p>
<ol>
<li><strong>Efficiency:</strong> Streamlined communication, automated check-in/out, predictive maintenance</li>
<li><strong>Safety &amp; Security:</strong> Integrated surveillance and environmental control</li>
<li><strong>Sustainability:</strong> Energy-efficient systems, greywater collection, waste monitoring</li>
<li><strong>Comfort &amp; Accessibility:</strong> Simplified provisioning and guest transport</li>
</ol>
</section>
<section>
<h2>5. Vessel Logistics and Infrastructure</h2>
<ul>
<li><strong>Electric and hybrid vessel readiness:</strong> High-capacity shore power and smart charging</li>
<li><strong>Fuel transition:</strong> Sustainable marine fuels including green hydrogen</li>
<li><strong>Waste management:</strong> Efficient greywater and blackwater reception</li>
</ul>
</section>
<section>
<h2>6. Guest Experience Integration</h2>
<p>Modern guests expect concierge-level service including on-demand bookings, personalized recommendations, and seamless handovers between crew, marina, and onshore providers.</p>
</section>
<section>
<h2>7. Key Takeaways</h2>
<ul>
<li><strong>Unification over proliferation:</strong> Interoperable digital standards over competing platforms</li>
<li><strong>Captain-centric design:</strong> Technology must start from real operational needs</li>
<li><strong>Marinas as smart destinations:</strong> Combining digital management, sustainability, and hospitality</li>
<li><strong>Collaborative innovation:</strong> Cooperation among captains, operators, developers, and regulators</li>
</ul>
</section>',
    'article',
    'Management',
    'EN',
    'members',
    NULL,
    NULL,
    'marina operations, crew needs, guest experience, vessel logistics, booking systems, smart marina, captain needs',
    true,
    ARRAY['Smart Marina 2025', 'Workshop']
  ) RETURNING id INTO v_rid;

  INSERT INTO resource_speakers (resource_id, full_name, job_title, company_name, display_order) VALUES
    (v_rid, 'Oscar Siches', 'Workshop Leader', 'Marina Consultant', 1);

  IF v_sid_management IS NOT NULL THEN INSERT INTO resource_sectors (resource_id, sector_id) VALUES (v_rid, v_sid_management); END IF;
  IF v_sid_technology IS NOT NULL THEN INSERT INTO resource_sectors (resource_id, sector_id) VALUES (v_rid, v_sid_technology); END IF;
  IF v_sid_consulting IS NOT NULL THEN INSERT INTO resource_sectors (resource_id, sector_id) VALUES (v_rid, v_sid_consulting); END IF;

  RAISE NOTICE 'Article 4 inserted: %', v_rid;

  -- =========================================================================
  -- ARTICLE 5: When Marina Management Meets Opera
  -- =========================================================================
  INSERT INTO resources (title, summary, content, type, topic, language, access_level, thumbnail_url, file_url, seo_keywords, published, tags)
  VALUES (
    'When Marina Management Meets Opera: Art, Culture & Service Excellence',
    'A creative workshop using opera as metaphor for marina management — exploring community engagement, emotional resonance, cultural sensitivity, and the transformation of marinas into living public spaces.',
    '<div class="intro">
<p>This unique session bridged marina management and artistic interpretation, using opera as a metaphor for the complexity, harmony, and emotional depth required to create vibrant marinas.</p>
<p>Moderator Oscar Siches invited participants to explore how marinas, like operas, are multidimensional productions combining architecture, human behaviour, environment, service design, and cultural meaning.</p>
</div>
<section>
<h2>1. The Opera as a Metaphor for Marina Life</h2>
<p>In opera, the audience focuses on the lead character, but the true experience arises from the entire orchestra, chorus, and stage direction. Likewise, in marinas, visitors see yachts and waterfronts, but rarely perceive the complex interplay of planning, management, and community interaction.</p>
</section>
<section>
<h2>2. Beyond Functionality: Creating Living, Cultural Marinas</h2>
<p>Siches challenged the audience to move beyond the mindset that marinas are just parking lots for boats. Marinas must evolve into cultural and social ecosystems:</p>
<ul>
<li><strong>Community engagement:</strong> Hosting rowing lessons, festivals, educational programs</li>
<li><strong>Local identity:</strong> Designing spaces that reflect regional history and traditions</li>
<li><strong>Social openness:</strong> Transforming marinas from exclusive zones into inclusive, shared public spaces</li>
</ul>
</section>
<section>
<h2>3. The Art of Innovation and the Courage to Change</h2>
<p>Siches urged marina professionals to experiment with new models. Innovation is not limited to technology — it can mean adjusting layouts, improving staff training, or rethinking logistics.</p>
</section>
<section>
<h2>4. The Human Dimension: Service, Emotion, and Micro-Experience</h2>
<ul>
<li><strong>Crew satisfaction drives loyalty:</strong> Captains return because their crews feel welcome</li>
<li><strong>Micro-experiences matter:</strong> Clean restrooms, clear signage, genuine hospitality</li>
<li><strong>Personalisation:</strong> Understanding individual guest expectations creates emotional connection</li>
</ul>
</section>
<section>
<h2>5. Sustainability and the Social Contract</h2>
<p>Participants questioned how multi-million-dollar marina developments can benefit surrounding communities. Siches advocated for measured development with social programs such as sailing schools or vocational training.</p>
</section>
<section>
<h2>6. Cultural Awareness and Local Adaptation</h2>
<p>Drawing from experience in China and the Middle East, Siches stressed that importing Western concepts often leads to misalignment. Developers should adapt to local customs, aesthetics, and community rhythms.</p>
</section>
<section>
<h2>7. Aesthetic and Emotional Sustainability</h2>
<p>A notable example was a marina design in an ultra-modern urban environment with 160 live palm trees across floating pontoons, creating a "floating forest" that transformed concrete into a living environment.</p>
</section>
<section>
<h2>8. Key Takeaways</h2>
<ul>
<li>Marinas are cultural organisms, not mechanical infrastructures</li>
<li>Innovation begins with mindset: small, human-centered ideas yield major improvements</li>
<li>Service and empathy are as vital as engineering</li>
<li>Sustainability includes community: each development must give back</li>
<li>Design with context: culture, history, and environment are the score to which the marina must perform</li>
</ul>
</section>',
    'article',
    'Management',
    'EN',
    'members',
    NULL,
    NULL,
    'marina culture, community engagement, service excellence, hospitality, cultural sensitivity, marina design, human experience',
    true,
    ARRAY['Smart Marina 2025', 'Workshop']
  ) RETURNING id INTO v_rid;

  INSERT INTO resource_speakers (resource_id, full_name, job_title, company_name, display_order) VALUES
    (v_rid, 'Oscar Siches', 'Workshop Moderator', 'Marina Consultant', 1);

  IF v_sid_consulting IS NOT NULL THEN INSERT INTO resource_sectors (resource_id, sector_id) VALUES (v_rid, v_sid_consulting); END IF;
  IF v_sid_management IS NOT NULL THEN INSERT INTO resource_sectors (resource_id, sector_id) VALUES (v_rid, v_sid_management); END IF;

  RAISE NOTICE 'Article 5 inserted: %', v_rid;

  -- =========================================================================
  -- ARTICLE 6: What To Do With Data
  -- =========================================================================
  INSERT INTO resources (title, summary, content, type, topic, language, access_level, thumbnail_url, file_url, seo_keywords, published, tags)
  VALUES (
    'What To Do With Data: Standardization, KPIs & Smart Marina Strategy',
    'Workshop addressing the fundamental challenge of data standardization in the marina industry — building common KPIs, benchmarking frameworks, and practical strategies for digital transformation.',
    '<div class="intro">
<p>This session explored how marinas can collect, interpret, and act upon data to improve operational efficiency, sustainability, and customer experience.</p>
<p>Led by Idan Cohen, the discussion built on prior sessions on smart marina frameworks and AI implementation, aiming to establish a shared understanding of what constitutes meaningful data.</p>
</div>
<section>
<h2>The Foundation: Defining Data and Success</h2>
<p>Cohen opened by noting that AI and digital transformation cannot advance without standardized data. Unlike hospitality or aviation, each marina operates with its own definitions of success, measurement, and terminology.</p>
<p>The absence of a unified data taxonomy prevents benchmarking, investment comparison, and industry-wide improvement.</p>
</section>
<section>
<h2>Measuring Success: From Occupancy to Experience</h2>
<ul>
<li><strong>Operational metrics:</strong> occupancy rates, berth turnover, vessel traffic</li>
<li><strong>Customer experience:</strong> return visits, crew satisfaction, seamless logistics</li>
<li><strong>Sustainability:</strong> waste management, energy consumption, water quality</li>
</ul>
</section>
<section>
<h2>Fragmentation and the Need for Benchmarking</h2>
<p>Marinas, especially in Europe, are often publicly owned and municipally managed, leading to fragmented systems and slow innovation cycles. Cohen argued for a baseline data model enabling cross-operator comparisons.</p>
</section>
<section>
<h2>Data Use Cases: From Sensors to Strategy</h2>
<h3>Environmental Monitoring</h3>
<p>Solar-powered smart surfaces and floating platforms with sensors measuring water quality, energy output, and waste levels.</p>
<h3>Traffic and Safety Analytics</h3>
<p>Computer vision and image analysis to measure vessel movement, berth occupancy, and operational flow.</p>
<h3>Design and Planning Applications</h3>
<p>Data helps simulate vessel traffic, energy demand, and user experience in the design phase.</p>
</section>
<section>
<h2>Sustainability, Value Creation, and Market Reality</h2>
<p>The workshop debated whether sustainability data directly translates to profitability. While sustainability drives long-term value, most marinas still compete on convenience and location. However, sustainability reduces operating costs through efficient energy use, waste control, and digital automation.</p>
</section>
<section>
<h2>Overcoming Resistance and Driving Cultural Change</h2>
<ul>
<li>Demonstrate quick wins: measurable gains from data use</li>
<li>Encourage peer learning across marinas</li>
<li>Develop training programs for data literacy and AI</li>
<li>Shift perception from tech adoption to operational empowerment</li>
</ul>
</section>
<section>
<h2>Key Takeaways</h2>
<ol>
<li><strong>Standardization is the starting point:</strong> Agree on data definitions, KPIs, and formats</li>
<li><strong>Sustainability requires evidence:</strong> Data-backed proof of environmental impact</li>
<li><strong>Cultural evolution precedes digitalization:</strong> Managers must view data as a management tool</li>
<li><strong>Marinas as ecosystems:</strong> Connected, sustainable, human-centered nodes</li>
<li><strong>AI as an enabler:</strong> Turning fragmented information into predictive knowledge</li>
</ol>
</section>',
    'article',
    'Technology',
    'EN',
    'members',
    NULL,
    NULL,
    'data standardization, marina KPIs, benchmarking, smart sensors, digital transformation, sustainability metrics, AI marina',
    true,
    ARRAY['Smart Marina 2025', 'Workshop']
  ) RETURNING id INTO v_rid;

  INSERT INTO resource_speakers (resource_id, full_name, job_title, company_name, display_order) VALUES
    (v_rid, 'Idan Cohen', 'Workshop Leader & CEO', 'Pick a Pier', 1);

  IF v_sid_technology IS NOT NULL THEN INSERT INTO resource_sectors (resource_id, sector_id) VALUES (v_rid, v_sid_technology); END IF;
  IF v_sid_sustainability IS NOT NULL THEN INSERT INTO resource_sectors (resource_id, sector_id) VALUES (v_rid, v_sid_sustainability); END IF;
  IF v_sid_consulting IS NOT NULL THEN INSERT INTO resource_sectors (resource_id, sector_id) VALUES (v_rid, v_sid_consulting); END IF;

  RAISE NOTICE 'Article 6 inserted: %', v_rid;

  -- =========================================================================
  -- ARTICLE 7: Raising Startup Funding in the Blue Economy
  -- =========================================================================
  INSERT INTO resources (title, summary, content, type, topic, language, access_level, thumbnail_url, file_url, seo_keywords, published, tags)
  VALUES (
    'Raising Startup Funding in the Blue Economy',
    'Workshop providing practical guidance on fundraising for marine technology startups — covering venture capital, angel investment, hardware-as-a-service models, and regional investment environments.',
    '<div class="intro">
<p>This workshop provided a practical dialogue between early-stage entrepreneurs and investors, focusing on the realities of fundraising for blue economy and marine technology startups. Participants discussed how to structure investment rounds, what investors look for, and how regional differences influence access to capital.</p>
</div>
<section>
<h2>1. Funding Models for Capital-Intensive Technologies</h2>
<p>Several startup founders presented challenges typical of hardware-based businesses, where upfront installation and long-term payback models make fundraising complex.</p>
<p>One company described smart metering and IoT energy management systems deployed under 15-year service contracts. The difficulty lies in attracting investors who understand hardware-as-a-service or recurring revenue financing.</p>
</section>
<section>
<h2>2. Startup Case Studies: Deep Tech and Water Innovation</h2>
<p>A sustainability-driven water purification system was introduced for marinas and inland waterways, integrating solar-powered floating columns that filter microplastics, heavy metals, and bacteria while collecting environmental data.</p>
</section>
<section>
<h2>3. Investor Response: Risk, Execution, and Trust</h2>
<p>Both investors acknowledged structural challenges and emphasized that execution capability is often the decisive factor. Due diligence extends beyond technical analysis to behavioural evaluation of founders'' resilience and adaptability.</p>
</section>
<section>
<h2>4. Regional Barriers and Structural Limitations</h2>
<ul>
<li><strong>Italy:</strong> Strong industrial capacity but limited early-stage capital and bureaucratic complexity</li>
<li><strong>Estonia:</strong> Exemplary startup jurisdiction with digital transparency and regulatory support</li>
<li><strong>Malta:</strong> International investors remain wary of jurisdictions under enhanced financial scrutiny</li>
</ul>
<p>Access to capital is highly dependent on jurisdictional trust and legal transparency.</p>
</section>
<section>
<h2>5. Strategic Advice: Finding the Right Investor</h2>
<ul>
<li>Bootstrap and seek grants before diluting equity</li>
<li>Secure first clients or pilot projects to demonstrate traction</li>
<li>Focus on relationship-driven fundraising</li>
</ul>
</section>
<section>
<h2>6. Understanding Venture Capital Timelines</h2>
<ul>
<li><strong>Typical VC funds operate on 10-year cycles:</strong> 5 years investing, 5 years exiting</li>
<li><strong>Founders should ask where the fund is in its cycle</strong></li>
<li><strong>VCs prefer scalable markets</strong> (&gt;$1B potential)</li>
</ul>
</section>
<section>
<h2>7. Transparency and Investor Red Flags</h2>
<ul>
<li><strong>Inflated revenue figures:</strong> Confusing grants with actual commercial income</li>
<li><strong>Incomplete cap tables:</strong> Presenting inactive advisors as co-founders</li>
<li><strong>Overconfidence without evidence:</strong> Avoiding hard questions about competition</li>
</ul>
</section>
<section>
<h2>8. Key Takeaways</h2>
<ol>
<li><strong>Understand your model:</strong> Match capital structure to your technology timeline</li>
<li><strong>Trust and transparency:</strong> Honesty and clarity are non-negotiable</li>
<li><strong>Show traction:</strong> Even small pilot projects help demonstrate credibility</li>
<li><strong>Leverage grants and partnerships:</strong> Non-dilutive funding remains critical</li>
<li><strong>Assess investor fit:</strong> Ensure alignment in expectations and timeline</li>
<li><strong>Execution matters most:</strong> Investors fund teams who can deliver</li>
</ol>
</section>',
    'article',
    'Management',
    'EN',
    'members',
    NULL,
    NULL,
    'startup funding, venture capital, angel investment, blue economy, marine technology, fundraising, investor relations',
    true,
    ARRAY['Smart Marina 2025', 'Workshop']
  ) RETURNING id INTO v_rid;

  -- No named speakers for article 7

  IF v_sid_consulting IS NOT NULL THEN INSERT INTO resource_sectors (resource_id, sector_id) VALUES (v_rid, v_sid_consulting); END IF;
  IF v_sid_technology IS NOT NULL THEN INSERT INTO resource_sectors (resource_id, sector_id) VALUES (v_rid, v_sid_technology); END IF;

  RAISE NOTICE 'Article 7 inserted: %', v_rid;

  RAISE NOTICE '✅ All 7 Smart Marina 2025 articles seeded successfully!';
END;
$$;
