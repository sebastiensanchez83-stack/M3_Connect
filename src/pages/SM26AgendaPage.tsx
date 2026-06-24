import { Helmet } from 'react-helmet-async';
import { SM26BackLink } from '@/components/sm26/SM26BackLink';
import { SM26Agenda } from '@/components/sm26/SM26Agenda';

// Public single-track agenda. Workshops are the only attendee choice: 1 per day,
// capacity-enforced via an atomic RPC, with a waitlist. The list itself lives in
// the shared <SM26Agenda> component (also used on the event page and /sm26/me).

export function SM26AgendaPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <Helmet><title>Agenda — Smart &amp; Sustainable Marina Rendezvous 2026</title></Helmet>
      <section className="bg-gradient-to-br from-[#0b2653] to-[#143a6b] text-white">
        <div className="container mx-auto px-4 py-12">
          <div className="mb-3"><SM26BackLink light /></div>
          <p className="uppercase tracking-wide text-white/60 text-sm mb-2">SM26 · 20–21 September 2026 · Yacht Club de Monaco</p>
          <h1 className="text-3xl lg:text-4xl font-bold">Programme</h1>
          <p className="text-white/80 mt-2 max-w-2xl">A single-track programme. Choose one workshop per day — seats are limited.</p>
        </div>
      </section>

      <div className="container mx-auto px-4 py-8 max-w-3xl">
        <SM26Agenda />
      </div>
    </div>
  );
}
