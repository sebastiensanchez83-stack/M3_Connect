// RPC and edge-function behaviour for the demo. Each handler mirrors the live
// function it stands in for (same arguments, same return shape, same error
// wording where the UI shows it), reading and writing the demo database.
import { onRpc, onFunction } from './registry';
import { table, persist, uuid, nowIso, Row } from './store';
import { DEMO_EVENT_ID as EV, DEMO_USER as U } from './identity';
import { PROGRAMME } from './fixtures/programme';

// PostgREST reports a raised exception as HTTP 400 with the message in `message`.
export const rpcError = (message: string, code = 'P0001') =>
  new Response(JSON.stringify({ code, message, details: null, hint: null }), {
    status: 400, headers: { 'content-type': 'application/json' },
  });

const one = <T extends Row>(rows: T[], pred: (r: T) => boolean) => rows.find(pred) ?? null;

// ─── account / platform ─────────────────────────────────────────────
onRpc('is_media_user', () => false);
onRpc('sm_autoclaim_by_email', () => 0);
onRpc('is_org_member', ({ p_org_id }) =>
  table('organization_members').some(m => m.organization_id === p_org_id && m.user_id === U.id));
onRpc('get_public_profile', ({ target_user_id }) =>
  table('profiles').filter(p => p.user_id === target_user_id).map(p => ({
    user_id: p.user_id, first_name: p.first_name, last_name: p.last_name, avatar_url: p.avatar_url,
    persona: p.persona, job_title: p.job_title, access_status: p.access_status,
  })));

// ─── programme and workshops ────────────────────────────────────────
const others = (sessionId: string) => PROGRAMME.find(p => p.id === sessionId)?.booked_others ?? 0;
const bookings = () => table('sm_workshop_booking');
const bookedCount = (sessionId: string) =>
  others(sessionId) + bookings().filter(b => b.session_id === sessionId && b.status === 'booked').length;
const session = (id: string) => one(table('sm_session'), s => s.id === id);
const dayOf = (iso: string) => iso.slice(0, 10);

onRpc('sm_agenda', ({ p_event_id }) =>
  table('sm_session')
    .filter(s => s.event_id === (p_event_id || EV) && s.published)
    .sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at)) || a.display_order - b.display_order)
    .map(s => ({
      id: s.id, title: s.title, description: s.description, type: s.type, starts_at: s.starts_at, ends_at: s.ends_at,
      room: s.room, speakers: s.speakers, capacity: s.capacity, presentation_enabled: s.presentation_enabled,
      deck_path: s.deck_path, share_with_audience: s.share_with_audience, qa_enabled: s.qa_enabled,
      booked_count: bookedCount(s.id),
      my_status: one(bookings(), b => b.session_id === s.id && b.user_id === U.id)?.status ?? null,
    })));

onRpc('sm_book_workshop', ({ p_session_id }) => {
  const s = session(p_session_id);
  if (!s) return rpcError('session not found');
  if (s.type !== 'workshop') return rpcError('not a workshop');
  const day = dayOf(s.starts_at);
  const existing = one(bookings(), b => b.user_id === U.id && b.event_id === s.event_id && b.day_date === day);
  if (existing) {
    if (existing.session_id === p_session_id) return 'already_booked';
    return rpcError('You already have a workshop booked that day');
  }
  const full = s.capacity != null && bookedCount(s.id) >= s.capacity;
  const waitlist_pos = full
    ? bookings().filter(b => b.session_id === s.id && b.status === 'waitlisted').length + 1
    : null;
  bookings().push({ id: uuid(), event_id: s.event_id, session_id: s.id, user_id: U.id, day_date: day, status: full ? 'waitlisted' : 'booked', waitlist_pos, created_at: nowIso() });
  persist();
  return full ? 'waitlisted' : 'booked';
});

onRpc('sm_switch_workshop', ({ p_session_id }) => {
  const s = session(p_session_id);
  if (!s) return rpcError('session not found');
  if (s.type !== 'workshop') return rpcError('not a workshop');
  const day = dayOf(s.starts_at);
  const from = one(bookings(), b => b.user_id === U.id && b.event_id === s.event_id && b.day_date === day);
  if (!from) return rpcError('NO_BOOKING: nothing booked that day');
  if (from.session_id === p_session_id) return 'already_booked';
  if (s.capacity != null && bookedCount(s.id) >= s.capacity) {
    return rpcError(`FULL: ${s.title} is full, so you have been left in ${session(from.session_id)?.title}.`);
  }
  bookings().splice(bookings().indexOf(from), 1);
  bookings().push({ id: uuid(), event_id: s.event_id, session_id: s.id, user_id: U.id, day_date: day, status: 'booked', waitlist_pos: null, created_at: nowIso() });
  persist();
  return 'booked';
});

onRpc('sm_cancel_workshop', ({ p_session_id }) => {
  const b = one(bookings(), x => x.session_id === p_session_id && x.user_id === U.id);
  if (!b) return 'not_booked';
  bookings().splice(bookings().indexOf(b), 1);
  persist();
  return 'cancelled';
});

// ─── networking ─────────────────────────────────────────────────────
onRpc('sm_my_networking_pass', () => {
  const passes = table('sm_networking_pass');
  let pass = one(passes, p => p.event_id === EV && p.kind === 'member' && p.user_id === U.id);
  const reg = one(table('sm_registration'), r => r.user_id === U.id && r.event_id === EV);
  if (!pass) {
    pass = {
      id: uuid(), event_id: EV, kind: 'member', token: uuid().replace(/-/g, ''), user_id: U.id,
      registration_id: reg?.id ?? null, name: `${U.first_name} ${U.last_name}`, company: reg?.company_name ?? null,
      email: U.email, created_at: nowIso(), revoked_at: null,
    };
    passes.push(pass);
    persist();
  }
  return { ok: true, token: pass.token, name: pass.name, company: pass.company };
});

onRpc('sm_my_connections', ({ p_event_id }) => {
  const passes = table('sm_networking_pass');
  const regs = table('sm_registration');
  const myPass = one(passes, p => p.kind === 'member' && p.user_id === U.id);
  return table('sm_connection')
    .filter(c => c.event_id === (p_event_id || EV) && (c.from_user_id === U.id || (myPass && c.from_pass_id === myPass.id)))
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .map(c => {
      const r = c.to_registration_id ? one(regs, x => x.id === c.to_registration_id) : null;
      const tp = c.to_pass_id ? one(passes, x => x.id === c.to_pass_id) : null;
      const sr = tp && tp.kind === 'stand' && tp.registration_id ? one(regs, x => x.id === tp.registration_id) : null;
      const personName = r ? `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim() : '';
      return {
        to_company: r?.company_name || sr?.company_name || tp?.company || personName || tp?.name || 'Participant',
        to_name: tp?.kind === 'stand' ? null : (tp?.name || personName || null),
        note: c.note, introduced: !!c.introduced_at, created_at: c.created_at,
      };
    });
});

// ─── participant assets (edge function sm26-assets) ─────────────────
// Same normalisation as the live resolver: module_data keys that look like files
// (string path, http URL, JSON-array string or array), labelled and "signed".
const IMG_EXT = /\.(png|jpe?g|gif|webp|svg|avif)(\?|$)/i;
const FILE_KEY = /(_url$|logo|image|photo|deck|slides|brochure|attachment|proof|document|pitch|banner|render|hero|press|panel|media|gallery)/i;
const NON_ASSET_KEY = /(portfolio_link|website|social|link$|_at$|_by$|consent)/i;
export const signedUrl = (bucket: string, path: string) =>
  /^https?:\/\//.test(path) ? path : `${window.location.origin}/__demo/storage/v1/object/public/${bucket}/${path}`;
const toList = (raw: unknown): string[] => {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw.filter((x): x is string => typeof x === 'string' && !!x.trim());
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (!s) return [];
    if (s.startsWith('[')) { try { const a = JSON.parse(s); return Array.isArray(a) ? a.filter((x: unknown): x is string => typeof x === 'string') : []; } catch { /* plain */ } }
    return [s];
  }
  return [];
};
const LABELS: Record<string, string> = { logo: 'Logo', photo: 'Photo', deck: 'Pitch deck', product: 'Product image', render: 'Project image', panel: 'Competition panel', hero: 'Hero image', banner: 'Banner', slides: 'Slides', proof: 'Proof of enrolment', pitch: 'Pitch media', press: 'Press card', other: 'File' };

onFunction('sm26-assets', ({ registration_id, role_assignment_id }) => {
  let regId = registration_id;
  if (!regId && role_assignment_id) regId = one(table('sm_role_assignment'), r => r.id === role_assignment_id)?.registration_id;
  const roles = table('sm_role_assignment').filter(r => r.registration_id === regId && r.status !== 'declined' && (!role_assignment_id || r.id === role_assignment_id));
  const raw: { role: string; ra: string; kind: string; path: string }[] = [];
  for (const r of roles) {
    for (const [k, v] of Object.entries(r.module_data || {})) {
      if (k.startsWith('_') || NON_ASSET_KEY.test(k) || !FILE_KEY.test(k)) continue;
      const kind = /logo/i.test(k) ? 'logo' : /photo/i.test(k) ? 'photo' : /deck|pitch/i.test(k) ? 'deck' : /product/i.test(k) ? 'product'
        : /render|panel/i.test(k) ? 'render' : /hero/i.test(k) ? 'hero' : /banner/i.test(k) ? 'banner' : /slides/i.test(k) ? 'slides' : /press/i.test(k) ? 'press' : 'other';
      // The live resolver drops anything Storage cannot sign, so a plain answer
      // such as pitch: 'Yes' never shows up as a document. Same rule here.
      for (const p of toList(v)) if (/^https?:\/\//.test(p) || p.includes('/')) raw.push({ role: r.role, ra: r.id, kind, path: p });
    }
  }
  const counts: Record<string, number> = {};
  raw.forEach(x => { counts[`${x.ra}|${x.kind}`] = (counts[`${x.ra}|${x.kind}`] || 0) + 1; });
  const idx: Record<string, number> = {};
  const assets = raw.map(x => {
    const g = `${x.ra}|${x.kind}`;
    const i = idx[g] = (idx[g] ?? -1) + 1;
    return {
      role: x.role, role_assignment_id: x.ra, kind: x.kind,
      label: counts[g] > 1 ? `${LABELS[x.kind] || 'File'} ${i + 1}` : (LABELS[x.kind] || 'File'),
      url: signedUrl('event-media', x.path), is_image: IMG_EXT.test(x.path), filename: decodeURIComponent(x.path.split('/').pop() || 'file'),
    };
  });
  return { assets, audience: 'owner' };
});

// ─── media kit (edge function sm26-media-kit) ───────────────────────
onFunction('sm26-media-kit', ({ action = 'get', registration_id }) => {
  const kit = one(table('sm_media_kit'), k => k.registration_id === registration_id);
  if (action === 'downloaded') {
    if (kit && !kit.first_downloaded_at) { kit.first_downloaded_at = nowIso(); persist(); }
    return { ok: true };
  }
  if (action !== 'get') return { ok: true };
  const files = table('sm_media_kit_file')
    .filter(f => f.registration_id === registration_id)
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
    .map(f => ({ id: f.id, filename: f.filename || f.storage_path.split('/').pop(), url: signedUrl('event-media', f.storage_path), is_image: (f.mime || '').startsWith('image/') || IMG_EXT.test(f.filename || ''), mime: f.mime || null }));
  if (kit && files.length && !kit.first_viewed_at) { kit.first_viewed_at = nowIso(); persist(); }
  return { caption: kit?.caption || '', notified_at: kit?.notified_at || null, first_viewed_at: kit?.first_viewed_at || null, first_downloaded_at: kit?.first_downloaded_at || null, files, can_edit: false };
});

// ─── e-catalogue review (approve / request changes) ─────────────────
onRpc('sm_ecat_respond', ({ p_page_id, p_action, p_comment, p_attachments }) => {
  const page = one(table('sm_ecat_page'), p => p.id === p_page_id);
  if (!page) return rpcError('not authorized');
  if (page.status !== 'uploaded') return rpcError('no page awaiting your review');
  if (p_action === 'approve') {
    page.status = 'approved';
    page.updated_at = nowIso();
  } else if (p_action === 'request_changes') {
    const hasNote = typeof p_comment === 'string' && p_comment.trim().length > 0;
    const hasFiles = Array.isArray(p_attachments) && p_attachments.length > 0;
    if (!hasNote && !hasFiles) return rpcError('Please describe the changes you would like');
    page.status = 'changes_requested';
    page.updated_at = nowIso();
    table('sm_ecat_comment').push({
      id: uuid(), ecat_page_id: p_page_id, author_user_id: U.id, author_role: 'participant',
      body: (p_comment || '').trim(), attachment_paths: hasFiles ? p_attachments : null, created_at: nowIso(),
    });
  } else {
    return rpcError('invalid action');
  }
  persist();
  return null;
});

onRpc('sm_ecat_apply_to_profile', ({ p_page_id, p_path, p_field_key }) => {
  if (!p_path || !p_field_key) return rpcError('missing arguments');
  const page = one(table('sm_ecat_page'), p => p.id === p_page_id);
  const ra = page ? one(table('sm_role_assignment'), r => r.id === page.role_assignment_id) : null;
  if (!ra) return rpcError('page not found');
  const md = { ...(ra.module_data || {}) };
  if (['product_images', 'project_renders', 'renders', 'panels', 'slides'].includes(p_field_key)) {
    md[p_field_key] = [...(Array.isArray(md[p_field_key]) ? md[p_field_key] : []), p_path];
  } else {
    md[p_field_key] = [p_path];
    const alias = p_field_key.endsWith('_url') ? p_field_key.slice(0, -4) : `${p_field_key}_url`;
    delete md[alias];
  }
  ra.module_data = md;
  persist();
  return null;
});

// ─── anything that would send an email ──────────────────────────────
// Answered as sent, so the interface behaves as on the platform, but the demo
// has no mail provider and nothing leaves the browser.
for (const name of ['send-notification', 'notify-admins', 'sm26-email', 'sm26-connection', 'send-status-notification']) {
  onFunction(name, () => ({ ok: true, sent: true }));
}
onFunction('sm26-attendee-invite', () => ({ ok: true, created_account: false, emailed: true }));

// ─── scanning a networking code (sm_connect_scan) ───────────────────
// Signed-in path of the live function: resolve the code (badge connect_token or
// networking pass), refuse self-scans, then record or refresh the connection.
onRpc('sm_connect_scan', ({ p_token, p_note }) => {
  if (!p_token) return { ok: false, error: 'unknown_code' };
  const passes = table('sm_networking_pass');
  const regs = table('sm_registration');
  const badge = one(table('sm_badge'), b => b.connect_token === p_token);
  const pass = badge ? null : one(passes, p => p.token === p_token && !p.revoked_at);
  if (!badge && !pass) return { ok: false, error: 'unknown_code' };
  const toReg = badge ? one(regs, r => r.id === badge.registration_id) : null;
  const standReg = pass && pass.kind === 'stand' ? one(regs, r => r.id === pass.registration_id) : null;
  const personName = (r: Row | null) => r ? `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim() || null : null;
  let to_company: string; let to_name: string | null;
  if (pass && pass.kind !== 'stand') {
    to_company = pass.company?.trim() || pass.name?.trim() || 'this participant';
    to_name = pass.name?.trim() || null;
  } else {
    const r = toReg || standReg;
    to_company = r?.company_name?.trim() || personName(r) || (pass?.company?.trim()) || (pass ? 'this exhibitor' : 'this participant');
    to_name = pass ? null : personName(r);
  }
  const myReg = one(regs, r => r.user_id === U.id && r.status !== 'declined' && r.status !== 'cancelled');
  const targetReg = toReg || standReg;
  if ((myReg && targetReg && myReg.id === targetReg.id) || pass?.user_id === U.id) {
    return { ok: false, error: 'self', to_company };
  }
  const note = typeof p_note === 'string' && p_note.trim() ? p_note.trim().slice(0, 1000) : null;
  const conns = table('sm_connection');
  const existing = one(conns, c => c.from_user_id === U.id && (toReg ? c.to_registration_id === toReg.id : (!c.to_registration_id && c.to_pass_id === pass?.id)));
  if (existing) {
    existing.note = note ?? existing.note;
    existing.created_at = nowIso();
  } else {
    conns.push({
      id: uuid(), event_id: badge?.event_id ?? pass?.event_id ?? EV, to_registration_id: toReg?.id ?? null, to_pass_id: pass?.id ?? null,
      from_user_id: U.id, from_registration_id: myReg?.id ?? null, from_pass_id: null, from_name: null, from_email: null,
      from_company: null, note, introduced_at: null, created_at: nowIso(),
    });
  }
  persist();
  return { ok: true, to_company, to_name };
});

onRpc('sm_networking_pass_create', ({ p_name, p_company, p_email }) => {
  const name = (p_name || '').trim();
  const email = (p_email || '').trim().toLowerCase();
  if (!name || name.length > 120) return { ok: false, error: 'bad_name' };
  if (!/^[^\s@"<>]+@[^\s@"<>]+\.[^\s@"<>]+$/.test(email)) return { ok: false, error: 'bad_email' };
  const token = uuid().replace(/-/g, '');
  table('sm_networking_pass').push({ id: uuid(), event_id: EV, kind: 'guest', token, name, company: (p_company || '').trim() || null, email, user_id: null, registration_id: null, created_at: nowIso(), revoked_at: null });
  persist();
  return { ok: true, token };
});

// ─── attendees, module rows, registration ───────────────────────────
onRpc('sm_confirm_attendees', ({ p_registration_id, p_confirmed = true }) => {
  const reg = one(table('sm_registration'), r => r.id === p_registration_id);
  if (!reg) return rpcError('Not authorized');
  const ts = p_confirmed ? nowIso() : null;
  reg.attendees_confirmed_at = ts;
  reg.updated_at = nowIso();
  persist();
  return ts;
});

onRpc('sm_org_member_candidates', ({ p_registration_id }) => {
  const reg = one(table('sm_registration'), r => r.id === p_registration_id);
  if (!reg?.organization_id) return [];
  const attendees = table('sm_attendee').filter(a => a.registration_id === p_registration_id);
  return table('organization_members')
    .filter(m => m.organization_id === reg.organization_id)
    .map(m => one(table('profiles'), p => p.user_id === m.user_id))
    .filter((p): p is Row => !!p && !attendees.some(a => a.user_id === p.user_id || (a.email && p.email && a.email.trim().toLowerCase() === p.email.trim().toLowerCase())))
    .map(p => ({ user_id: p.user_id, first_name: p.first_name, last_name: p.last_name, email: p.email, job_title: p.job_title }));
});

onRpc('sm_ensure_module_row', ({ p_role_assignment_id }) => {
  const ra = one(table('sm_role_assignment'), r => r.id === p_role_assignment_id);
  if (!ra) return rpcError('role assignment not found');
  if (ra.role === 'marina') {
    if (!one(table('sm_marina_extra'), m => m.role_assignment_id === ra.id)) {
      table('sm_marina_extra').push({ id: uuid(), role_assignment_id: ra.id, event_id: ra.event_id, organization_id: ra.organization_id, created_at: nowIso(), updated_at: nowIso() });
      persist();
    }
    return 'sm_marina_extra';
  }
  return 'none';
});

// A confirmed, paid registration cannot be restarted on the platform either.
onRpc('sm_restart_registration', () => ({ deleted: false, reason: 'settled' }));
onRpc('sm_set_onsite_attendance', () => rpcError('Not a jury role'));
onRpc('sm_company_has_registration', ({ p_company }) =>
  table('sm_registration').some(r => (r.company_name || '').trim().toLowerCase() === String(p_company || '').trim().toLowerCase()));

// ─── session Q&A ────────────────────────────────────────────────────
onRpc('sm_session_questions', ({ p_session_id }) => {
  const votes = table('sm_question_vote');
  return table('sm_session_question')
    .filter(q => q.session_id === p_session_id && !q.hidden)
    .map(q => {
      const mine = votes.filter(v => v.question_id === q.id);
      return {
        id: q.id, author_name: q.author_name, text: q.text, answered: q.answered, hidden: q.hidden, created_at: q.created_at,
        upvotes: (q.seed_upvotes || 0) + mine.length, mine_voted: mine.some(v => v.user_id === U.id), is_mine: q.user_id === U.id,
      };
    })
    .sort((a, b) => b.upvotes - a.upvotes || String(a.created_at).localeCompare(String(b.created_at)));
});

onRpc('sm_ask_question', ({ p_session_id, p_text }) => {
  const text = String(p_text || '').trim();
  if (!text) return rpcError('Question is empty');
  const s = session(p_session_id);
  if (!s) return rpcError('Session not found');
  if (!s.qa_enabled || !s.published) return rpcError('Q&A is not open for this session');
  const id = uuid();
  table('sm_session_question').push({ id, session_id: s.id, event_id: s.event_id, user_id: U.id, author_name: `${U.first_name} ${U.last_name}`, text: text.slice(0, 500), answered: false, hidden: false, created_at: nowIso() });
  persist();
  return id;
});

onRpc('sm_toggle_question_vote', ({ p_question_id }) => {
  const votes = table('sm_question_vote');
  const mine = one(votes, v => v.question_id === p_question_id && v.user_id === U.id);
  if (mine) { votes.splice(votes.indexOf(mine), 1); persist(); return false; }
  votes.push({ id: uuid(), question_id: p_question_id, user_id: U.id, created_at: nowIso() });
  persist();
  return true;
});

onRpc('sm_moderate_question', () => rpcError('Not authorized'));

// ─── public vote and awards ─────────────────────────────────────────
onRpc('sm_vote_ballot', ({ p_event_id, p_competition }) => {
  const cfg = one(table('sm_vote_config'), c => c.event_id === p_event_id && c.competition === p_competition);
  const mine = one(table('sm_public_vote'), v => v.voter_user_id === U.id && v.competition === p_competition);
  return { open: !!cfg?.is_open, eligible: false, my_vote: mine?.entry_role_assignment_id ?? null, entries: [] };
});
onRpc('sm_cast_vote', () => rpcError('You must be checked in to vote'));
onRpc('sm_award_results', () => []);

// ─── organisation profile ───────────────────────────────────────────
const myOrg = (orgId: string) =>
  table('organization_members').some(m => m.organization_id === orgId && m.user_id === U.id)
    ? one(table('organizations'), o => o.id === orgId) : null;

onRpc('update_org_branding', ({ p_org_id, p_field, p_url }) => {
  const org = myOrg(p_org_id);
  if (!org) return rpcError('Not authorized');
  if (p_field === 'logo') org.logo_url = p_url;
  else if (p_field === 'banner') org.banner_url = p_url;
  else return rpcError(`Invalid field: ${p_field}`);
  org.updated_at = nowIso();
  persist();
  return null;
});

onRpc('update_org_gallery', ({ p_org_id, p_urls }) => {
  const org = myOrg(p_org_id);
  if (!org) return rpcError('Not authorized');
  if (!Array.isArray(p_urls)) return rpcError('gallery must be an array');
  org.gallery = p_urls;
  org.updated_at = nowIso();
  persist();
  return null;
});

onRpc('get_public_profiles', ({ target_user_ids }) =>
  table('profiles')
    .filter(p => (target_user_ids || []).includes(p.user_id) && p.access_status === 'verified')
    .map(p => ({ user_id: p.user_id, first_name: p.first_name, last_name: p.last_name, avatar_url: p.avatar_url, persona: p.persona, job_title: p.job_title })));

onRpc('approve_join_request', ({ p_invitation_id }) => {
  const inv = one(table('organization_invitations'), i => i.id === p_invitation_id);
  if (!inv) return rpcError('Invitation not found');
  inv.status = 'accepted';
  inv.updated_at = nowIso();
  persist();
  return null;
});
onRpc('reject_join_request', ({ p_invitation_id }) => {
  const inv = one(table('organization_invitations'), i => i.id === p_invitation_id);
  if (!inv) return rpcError('Invitation not found');
  inv.status = 'rejected';
  inv.updated_at = nowIso();
  persist();
  return null;
});
onRpc('create_organization', () => rpcError('You already manage an organization'));

// Banner counters: nothing to count in a demo.
onRpc('increment_banner_impressions', () => null);
onRpc('increment_banner_clicks', () => null);

// ─── public marina profile ──────────────────────────────────────────
onRpc('sm_org_marina_submission', ({ p_org_id }) => {
  const reg = one(table('sm_registration'), r => r.organization_id === p_org_id && r.status === 'confirmed');
  if (!reg) return null;
  const ra = one(table('sm_role_assignment'), x => x.registration_id === reg.id && x.role === 'marina' && x.status !== 'declined');
  const m = ra ? one(table('sm_marina_extra'), x => x.role_assignment_id === ra.id) : null;
  if (!m) return null;
  const keys = ['architectural_quality', 'biodiversity', 'water', 'energy', 'waste', 'innovation', 'security', 'sustainable_diff', 'further_info',
    'biodiversity_image', 'water_image', 'energy_image', 'waste_image', 'innovation_image', 'security_image'];
  return Object.fromEntries(keys.map(k => [k, m[k] ?? null]));
});
