import { useState } from 'react';
import { Seo } from '@/components/seo/Seo';
import { plainPageMeta } from '@/lib/seoMeta';
import { SM26BackLink } from '@/components/sm26/SM26BackLink';
import { SM26Agenda } from '@/components/sm26/SM26Agenda';

// Public single-track agenda. Workshops are the only attendee choice: 1 per day,
// capacity-enforced via an atomic RPC, with a waitlist. The list itself lives in
// the shared <SM26Agenda> component (also used on the event page and /sm26/me).
//
// Once the edition is over the agenda is an archive: the component hides booking,
// the waitlist and "Add to calendar" and keeps the programme and the slides, and
// the sentence under the title stops inviting people to choose a workshop.
// Head: title and description from the shared table (src/lib/seoMeta.ts); the
// canonical URL is the 6th edition's event page, whose programme this is.

export function SM26AgendaPage() {
  // null until the programme has loaded, so the sentence never flips from one wording to the other.
  const [ended, setEnded] = useState<boolean | null>(null);
  const meta = plainPageMeta('/sm26/agenda');
  return (
    <div className="min-h-screen bg-gray-50">
      {meta && <Seo {...meta} />}
      <section className="bg-gradient-to-br from-[#0b2653] to-[#143a6b] text-white">
        <div className="container mx-auto px-4 py-12">
          <div className="mb-3"><SM26BackLink light fallback="/sm26" /></div>
          <p className="uppercase tracking-wide text-white/60 text-sm mb-2">SM26 · 20–21 September 2026 · Yacht Club de Monaco</p>
          <h1 className="text-3xl lg:text-4xl font-bold">Programme</h1>
          <p className="text-white/80 mt-2 max-w-2xl min-h-[1.5rem]">
            {ended === null
              ? null
              : ended
                ? 'The single-track programme of the 6th edition, with one workshop per day.'
                : 'A single-track programme. Choose one workshop per day — seats are limited.'}
          </p>
        </div>
      </section>

      <div className="container mx-auto px-4 py-8 max-w-3xl">
        <SM26Agenda onEndedChange={setEnded} />
      </div>
    </div>
  );
}
