// S3 Indicative Pre-Audit — Pillars, Questions, Certifications & Scoring

export interface PillarDefinition {
  key: string;
  title: string;
  subtitle: string;
  questions: string[];
}

export interface CertificationDefinition {
  key: string;
  label: string;
  note: string;
  multipliers: Record<string, number>;
}

export const PILLARS: PillarDefinition[] = [
  {
    key: 'resilience_navigation',
    title: 'Resilience & Navigation',
    subtitle: 'Business continuity, nautical safety, risk anticipation',
    questions: [
      'To what extent are nautical access conditions, manoeuvring and mooring clearly organised, understood and secured for users?',
      'To what extent is the site prepared to maintain essential operations in the event of weather hazards, technical incidents or external disruption?',
      'To what extent are risks related to navigation, infrastructure and traffic flows identified, reviewed and addressed in a structured manner?',
      'To what extent do critical navigation and operational equipment benefit from reliable preventive maintenance?',
      'To what extent does the site anticipate the effects of climate change and extreme events on its operations and access?',
    ],
  },
  {
    key: 'environment_biodiversity',
    title: 'Environment & Biodiversity',
    subtitle: 'Pollution prevention, biodiversity, responsible practices',
    questions: [
      'To what extent does the establishment manage its environmental impacts with clear objectives, responsibilities and monitoring?',
      'To what extent are pollution, discharge and nuisance risks prevented, controlled and addressed promptly?',
      'To what extent does the site actively protect or restore marine and coastal biodiversity within its area of influence?',
      'To what extent are waste, water and consumables managed following a logic of reduction, sorting, recovery and sobriety?',
      'To what extent are teams, clients and partners made aware of responsible practices at sea and ashore?',
    ],
  },
  {
    key: 'customer_experience_hospitality',
    title: 'Customer Experience & Hospitality',
    subtitle: 'Service quality, journey consistency, standing perception',
    questions: [
      'To what extent are reception, orientation and the customer journey fluid, consistent and adapted to the targeted level of standing?',
      'To what extent do teams deliver attentive, responsive and professional service across all touchpoints?',
      'To what extent does the range of services and facilities genuinely meet the expectations of boaters, crews, members and visitors?',
      'To what extent does the establishment offer an experience perceived as qualitative, distinctive and consistent with its positioning?',
      'To what extent is customer satisfaction measured, analysed and translated into visible improvements?',
    ],
  },
  {
    key: 'energy_climate',
    title: 'Energy & Climate',
    subtitle: 'Measurement, efficiency, low-carbon trajectory, adaptation',
    questions: [
      'To what extent are energy consumption and associated emissions measured, tracked and managed?',
      'To what extent are concrete energy efficiency actions already in place across buildings, equipment and operations?',
      'To what extent does the site incorporate renewable energy solutions, electrification or other low-carbon alternatives?',
      'To what extent does the establishment have a credible roadmap to reduce its energy and climate footprint?',
      'To what extent do investment and operational decisions account for heat, flooding, sea level rise or water stress issues?',
    ],
  },
  {
    key: 'security_asset_integrity',
    title: 'Security & Asset Integrity',
    subtitle: 'Safety, asset condition, incident response, cyber-resilience',
    questions: [
      'To what extent is access to the site, sensitive areas and high-value assets controlled in a proportionate and professional manner?',
      'To what extent does the condition of critical infrastructure and equipment limit risks of failure, accident or operational loss?',
      'To what extent are security, safety or degradation incidents subject to an organised, documented and effective response?',
      'To what extent do teams and contractors share a clear culture of safety, instructions and responsibilities?',
      'To what extent are digital systems related to operations, access, payments or client data protected against incidents and unauthorised use?',
    ],
  },
  {
    key: 'service_quality_compliance',
    title: 'Service Quality & Compliance',
    subtitle: 'Procedures, obligations, corrective actions, traceability',
    questions: [
      'To what extent do key operations and services rely on simple, applied and up-to-date procedures?',
      'To what extent are regulatory, contractual and documentary obligations identified, monitored and respected?',
      'To what extent do non-conformities, complaints and operational deviations lead to real corrective actions?',
      'To what extent are subcontractors and service providers selected, managed and evaluated according to consistent quality requirements?',
      'To what extent is the establishment able to demonstrate what it actually does through records, indicators or monitoring evidence?',
    ],
  },
  {
    key: 'innovation_digitalization',
    title: 'Innovation & Digitalization',
    subtitle: 'Digital tools, useful data, experimentation, adoption',
    questions: [
      'To what extent do digital tools genuinely improve operations, customer relations or team coordination?',
      'To what extent is available data used to drive performance, anticipate needs and inform investment decisions?',
      'To what extent does the establishment test new solutions or approaches with a clear method and measurable objectives?',
      'To what extent do digital systems, business tools and information flows work in a coherent and actionable manner?',
      'To what extent are teams trained and engaged to sustainably use the tools and innovations deployed?',
    ],
  },
  {
    key: 'maritime_values_knowledge_transfer',
    title: 'Maritime Values & Knowledge Transfer',
    subtitle: 'Culture, upskilling, transmission, maritime anchoring',
    questions: [
      'To what extent does the establishment transmit a genuine maritime culture founded on safety, respect and good nautical practices?',
      'To what extent do teams benefit from continuous skill development adapted to their missions and the evolution of the site?',
      'To what extent are know-how, key procedures and lessons learned formalised and transmitted between people?',
      'To what extent does the site promote its maritime identity, territory and links with the local nautical community?',
      'To what extent are clients, members, crews or learners guided towards responsible behaviour and a better understanding of the marine environment?',
    ],
  },
];

export const CERTIFICATIONS: CertificationDefinition[] = [
  {
    key: 'ports_propres',
    label: 'Ports Propres',
    note: 'Port environmental management and pollution prevention.',
    multipliers: { environment_biodiversity: 1.10, service_quality_compliance: 1.03 },
  },
  {
    key: 'ports_propres_biodiversity',
    label: 'Ports Propres Actifs en Biodiversité',
    note: 'Biodiversity extension of the Ports Propres framework.',
    multipliers: { environment_biodiversity: 1.12, service_quality_compliance: 1.02, maritime_values_knowledge_transfer: 1.02 },
  },
  {
    key: 'blue_flag',
    label: 'Blue Flag / Pavillon Bleu',
    note: 'Environment, information, services, safety and accessibility.',
    multipliers: { resilience_navigation: 1.03, environment_biodiversity: 1.08, customer_experience_hospitality: 1.02, energy_climate: 1.02, security_asset_integrity: 1.03, service_quality_compliance: 1.04, maritime_values_knowledge_transfer: 1.02 },
  },
  {
    key: 'gold_anchor',
    label: 'Gold Anchor',
    note: 'Customer experience, service quality, standards and infrastructure.',
    multipliers: { resilience_navigation: 1.02, environment_biodiversity: 1.02, customer_experience_hospitality: 1.10, security_asset_integrity: 1.05, service_quality_compliance: 1.05 },
  },
  {
    key: 'iso_14001',
    label: 'ISO 14001',
    note: 'Environmental management system.',
    multipliers: { environment_biodiversity: 1.08, energy_climate: 1.02, service_quality_compliance: 1.03 },
  },
  {
    key: 'iso_50001',
    label: 'ISO 50001',
    note: 'Energy management system.',
    multipliers: { energy_climate: 1.10, service_quality_compliance: 1.02 },
  },
  {
    key: 'iso_45001',
    label: 'ISO 45001',
    note: 'Occupational health and safety.',
    multipliers: { resilience_navigation: 1.02, security_asset_integrity: 1.08, service_quality_compliance: 1.04 },
  },
  {
    key: 'iso_9001',
    label: 'ISO 9001',
    note: 'Quality management system.',
    multipliers: { customer_experience_hospitality: 1.03, service_quality_compliance: 1.08, innovation_digitalization: 1.02 },
  },
  {
    key: 'isps',
    label: 'ISPS / Port security equivalent',
    note: 'Facility security and access control.',
    multipliers: { resilience_navigation: 1.05, security_asset_integrity: 1.10, service_quality_compliance: 1.03 },
  },
  {
    key: 'other',
    label: 'Other certification',
    note: 'Reserved for future customisation.',
    multipliers: {},
  },
];

export const SCORE_LABELS: Record<number, string> = {
  0: 'Non-existent',
  1: 'Fragmented',
  2: 'Informal',
  3: 'Credible base',
  4: 'Controlled',
  5: 'Exemplary',
};

export type IndicativeLevel = 'non_eligible' | 'horizon' | 'regatta' | 'flagship' | 'sovereign';

export const LEVEL_CONFIG: Record<IndicativeLevel, { label: string; color: string; bgClass: string; textClass: string; borderClass: string }> = {
  non_eligible: { label: 'Non Eligible', color: '#e58e8e', bgClass: 'bg-red-50', textClass: 'text-red-700', borderClass: 'border-red-200' },
  horizon:      { label: 'Horizon',      color: '#e0c17f', bgClass: 'bg-amber-50', textClass: 'text-amber-700', borderClass: 'border-amber-200' },
  regatta:      { label: 'Regatta',      color: '#7fc9c6', bgClass: 'bg-teal-50', textClass: 'text-teal-700', borderClass: 'border-teal-200' },
  flagship:     { label: 'Flagship',     color: '#d7b56d', bgClass: 'bg-yellow-50', textClass: 'text-yellow-700', borderClass: 'border-yellow-200' },
  sovereign:    { label: 'Sovereign',    color: '#9fd4a3', bgClass: 'bg-green-50', textClass: 'text-green-700', borderClass: 'border-green-200' },
};

export const LEVEL_INTERPRETATION: Record<IndicativeLevel, string> = {
  non_eligible: 'The current profile suggests that several fundamental building blocks still need to be stabilised before positioning towards a certification pathway.',
  horizon: 'The marina presents a credible base with clear potential, but several pillars still require more structure and consistency.',
  regatta: 'The marina shows a serious and progressive maturity level, with a realistic trajectory towards a more advanced S3 positioning.',
  flagship: 'The marina already presents a solid maturity profile; the challenge now becomes consolidation, evidence and differentiation.',
  sovereign: 'The marina displays an advanced maturity profile, consistent with a premium positioning and an ambition of international reference.',
};

export const PILLAR_RECOMMENDATIONS: Record<string, string> = {
  resilience_navigation: 'Strengthen operational continuity, critical asset reliability and anticipation of navigation-related risks.',
  environment_biodiversity: 'Prioritise environmental monitoring, pollution prevention discipline and visible biodiversity actions with clear ownership.',
  customer_experience_hospitality: 'Improve customer journey consistency, service standards and translation of feedback into visible improvements.',
  energy_climate: 'Structure a clear energy baseline, a credible climate roadmap and a short list of concrete efficiency and adaptation actions.',
  security_asset_integrity: 'Strengthen access control, asset condition monitoring, incident response and operational system protection.',
  service_quality_compliance: 'Tighten procedures, compliance monitoring, corrective discipline and operational traceability.',
  innovation_digitalization: 'Focus on useful tool adoption, data exploitation and better coherence between systems and teams.',
  maritime_values_knowledge_transfer: 'Formalise training, knowledge transfer and the site\'s contribution to responsible maritime culture.',
};

// Scoring logic
export function getRawScoreForPillar(
  answers: Record<string, number | undefined>,
  pillarKey: string
): number | null {
  const scores: number[] = [];
  for (let i = 0; i < 5; i++) {
    const val = answers[`${pillarKey}_${i}`];
    if (typeof val === 'number') scores.push(val);
  }
  if (scores.length === 0) return null;
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}

export function getCertificationFactorForPillar(
  selectedCerts: Record<string, boolean>,
  pillarKey: string
): number {
  let factor = 1;
  CERTIFICATIONS.forEach((cert) => {
    if (selectedCerts[cert.key] && cert.multipliers[pillarKey]) {
      factor += cert.multipliers[pillarKey] - 1;
    }
  });
  return Math.min(1.2, factor);
}

export interface PillarResult {
  key: string;
  title: string;
  rawScore: number | null;
  factor: number;
  adjustedScore: number | null;
  adjustedPct: number | null;
}

export interface AuditResult {
  complete: boolean;
  pillarResults: PillarResult[];
  globalAdjusted?: number;
  globalPct?: number;
  minPillarPct?: number;
  level?: IndicativeLevel;
  priorities?: (PillarResult & { recommendation: string })[];
}

export function calculateAuditResult(
  answers: Record<string, number | undefined>,
  selectedCerts: Record<string, boolean>
): AuditResult {
  const pillarResults: PillarResult[] = PILLARS.map((p) => {
    const raw = getRawScoreForPillar(answers, p.key);
    const factor = getCertificationFactorForPillar(selectedCerts, p.key);
    const adjusted = raw === null ? null : Math.min(5, raw * factor);
    const pct = adjusted === null ? null : (adjusted / 5) * 100;
    return { key: p.key, title: p.title, rawScore: raw, factor, adjustedScore: adjusted, adjustedPct: pct };
  });

  const answeredCount = Object.values(answers).filter((v) => typeof v === 'number').length;
  const allComplete = answeredCount === 40 && pillarResults.every((p) => p.rawScore !== null);

  if (!allComplete) return { complete: false, pillarResults };

  const globalAdjusted = pillarResults.reduce((sum, p) => sum + (p.adjustedScore ?? 0), 0) / pillarResults.length;
  const globalPct = (globalAdjusted / 5) * 100;
  const minPillarPct = Math.min(...pillarResults.map((p) => p.adjustedPct ?? 0));

  let level: IndicativeLevel;
  if (globalPct >= 85 && minPillarPct >= 85) level = 'sovereign';
  else if (globalPct >= 75 && minPillarPct >= 75) level = 'flagship';
  else if (globalPct >= 60 && minPillarPct >= 60) level = 'regatta';
  else if (globalPct >= 50 && minPillarPct >= 50) level = 'horizon';
  else level = 'non_eligible';

  const priorities = [...pillarResults]
    .sort((a, b) => (a.adjustedScore ?? 0) - (b.adjustedScore ?? 0))
    .slice(0, 3)
    .map((p) => ({ ...p, recommendation: PILLAR_RECOMMENDATIONS[p.key] ?? '' }));

  return { complete: true, pillarResults, globalAdjusted, globalPct, minPillarPct, level, priorities };
}
