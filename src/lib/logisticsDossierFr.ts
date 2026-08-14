// Le dossier logistique remis au Yacht Club — en français.
//
// The department that runs the room works in French and has no account here, so
// this document is the whole interface. sm_logistics_dossier deliberately
// returns codes and numbers rather than sentences: the wording lives here, in
// one file, next to the language it is written in.
//
// jsPDF's standard helvetica is WinAnsi-encoded, which covers every accented
// character French needs (é è à ç ù û î ô œ « » and the no-break space). Do not
// switch this document to a font that is not embedded without checking that
// first — a missing glyph is silent.

import type { ReportBlock } from './feedbackReportPdf';

// U+00A0. French sets an unbreakable space before : ; ! ? and inside « ». It is
// in WinAnsi, so it survives into the PDF.
const NB = ' ';

export interface DossierPayload {
  decisions: {
    company: string; kind: string; label: string | null;
    width_cm: number | null; height_cm: number | null; depth_cm: number | null;
    weight_kg: number | null; photo: boolean;
  }[];
  technical: { need: string; company: string; detail: string | null }[];
  exhibitors: { company: string; people: number; items: number; brunch: number; notes: string | null }[];
  totals: { exhibitors: number; people: number; power: number; brunch: number; pending: number };
}

const KIND_FR: Record<string, string> = {
  rollup: 'Roll-up ou banderole',
  model: 'Maquette ou prototype',
  screen: 'Écran',
  furniture: 'Mobilier',
  other: 'Autre',
};

const NEED_FR: Record<string, string> = {
  power: 'Prises électriques',
  internet: 'Connexion internet filaire',
  water: 'Arrivée d’eau',
  vehicle: 'Accès véhicule',
};

// French agreement is by the noun, not by a rule that happens to match English.
const plural = (n: number, one: string, many: string) => `${n}${NB}${n > 1 ? many : one}`;

const sizeAndWeight = (d: DossierPayload['decisions'][number]) => {
  const mm = [d.width_cm, d.height_cm, d.depth_cm].filter(v => v != null);
  const parts: string[] = [];
  if (mm.length) parts.push(`${mm.join(' × ')}${NB}cm`);
  if (d.weight_kg != null) parts.push(`${d.weight_kg}${NB}kg`);
  parts.push(d.photo ? 'photo fournie' : 'photo manquante');
  return parts.join(' · ');
};

/** Turns the RPC payload into the blocks the shared PDF builder draws. */
export function dossierBlocks(p: DossierPayload): ReportBlock[] {
  const blocks: ReportBlock[] = [];

  blocks.push({
    kind: 'stats', heading: 'En un coup d’œil',
    items: [
      { label: 'Exposants sur place', value: String(p.totals.exhibitors) },
      { label: 'Personnes sur les stands', value: String(p.totals.people) },
      { label: 'Stands à alimenter', value: String(p.totals.power) },
      { label: 'Couverts au brunch', value: String(p.totals.brunch) },
      { label: 'Éléments à valider', value: String(p.totals.pending) },
    ],
  });

  blocks.push(p.decisions.length ? {
    kind: 'table', heading: 'À valider',
    note: `Éléments de plus de 2${NB}m sur un côté ou de plus de 50${NB}kg. Rien de ce qui suit n’est confirmé à l’exposant tant que le Yacht Club n’a pas répondu.`,
    columns: ['Exposant', 'Élément', 'Dimensions et poids'],
    rows: p.decisions.map(d => [
      d.company,
      (d.label || '').trim() || KIND_FR[d.kind] || 'Élément',
      sizeAndWeight(d),
    ] as [string, string, string]),
  } : {
    kind: 'stats', heading: 'À valider',
    note: 'Aucun élément hors gabarit n’a été déclaré à ce jour.',
    items: [{ label: 'Éléments en attente', value: '0' }],
  });

  // Grouped by need, because the venue orders sockets and runs cables per need
  // and reads one column down to count them.
  if (p.technical.length) {
    const byNeed = new Map<string, DossierPayload['technical']>();
    p.technical.forEach(t => byNeed.set(t.need, [...(byNeed.get(t.need) || []), t]));
    blocks.push({
      kind: 'table', heading: 'À prévoir dans la salle',
      note: 'Une ligne par exposant l’ayant demandé, regroupé par besoin.',
      continued: 'suite',
      columns: ['Besoin', 'Exposant', 'Usage'],
      rows: [...byNeed.entries()].flatMap(([need, list]) =>
        list.map((t, n) => [
          n === 0 ? `${NEED_FR[need] || need} (${list.length})` : '',
          t.company,
          (t.detail || '').trim() || '—',
        ] as [string, string, string])),
    });
  }

  if (p.exhibitors.length) {
    blocks.push({
      kind: 'table', heading: 'Qui vient, et avec quoi',
      columns: ['Exposant', 'Sur le stand', 'Remarques'],
      rows: p.exhibitors.map(e => {
        const stand = [
          plural(e.people, ' personne', ' personnes'),
          plural(e.items, ' élément', ' éléments'),
        ].join(' · ');
        const notes = [
          e.brunch > 0 ? `${plural(e.brunch, ' couvert', ' couverts')} au brunch` : null,
          (e.notes || '').trim() || null,
        ].filter(Boolean).join(' · ');
        return [e.company, stand, notes || '—'] as [string, string, string];
      }),
    });
  }

  blocks.push({
    kind: 'placeholder', heading: 'Réservé au Yacht Club',
    note: 'Numéros de stand, créneaux de livraison et tout ce qui aura été convenu par téléphone.',
    lines: 6,
  });

  return blocks;
}

export const DOSSIER_META = {
  title: 'Smart & Sustainable Marina Rendezvous 2026',
  subtitle: `20–21 septembre 2026 · Yacht Club de Monaco · Dossier logistique`,
  note: 'Renseigné par les exposants eux-mêmes sur la plateforme. Tout élément indiqué comme à valider ne leur est pas encore confirmé.',
};

/** Le nom du fichier tel qu’il arrivera dans la boîte du Yacht Club. */
export const dossierFilename = (on: Date) =>
  `SM26-dossier-logistique-${on.toISOString().slice(0, 10)}.pdf`;
