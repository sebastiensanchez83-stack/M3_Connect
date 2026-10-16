/* ─── Data access of the invitation screens ───
 *
 * Tables are read and written directly (RLS: verified admins and moderators).
 * Everything that e-mails someone or touches the guest list goes through the edge
 * function "invitation-campaign", called through ../sendApi.ts (the typed contract),
 * which calls invitation_link_guest / invitation_adopt_request / invitation_mark_sent /
 * invitation_set_answer and guest-list "resend".
 */
import { supabase } from '@/lib/supabase';
import {
  INVITATION_FILES_BUCKET, INVITATION_FONTS, invitationArtwork,
  type InvitationCampaign, type InvitationCampaignInsert, type InvitationCampaignUpdate, type InvitationDuplicate,
  type InvitationGuestStatus, type InvitationRecipient, type InvitationRecipientInsert, type InvitationRecipientUpdate,
} from '../types';
import type { InvitationAssets } from './pdf';

export interface GlEventLite { id: string; slug: string; title: string; capacity: number | null; engine: string | null; settings: Record<string, unknown> | null }
export interface GlGuestLite {
  id: string; event_id: string; source: 'request' | 'invitation' | 'plus_one'; status: InvitationGuestStatus;
  first_name: string; last_name: string; email: string; company: string | null; job_title: string | null; phone: string | null;
  invited_at: string | null; responded_at: string | null; checked_in_at: string | null; created_at: string;
}
export interface EmailLogLite { guest_id: string; kind: string; sent_at: string }

const fail = (error: { message: string } | null) => { if (error) throw new Error(error.message); };

export async function listEvents(): Promise<GlEventLite[]> {
  const { data, error } = await supabase.from('gl_event').select('id, slug, title, capacity, engine, settings').order('created_at');
  fail(error);
  return (data || []) as GlEventLite[];
}

export async function listCampaigns(): Promise<InvitationCampaign[]> {
  const { data, error } = await supabase.from('invitation_campaign').select('*').order('created_at', { ascending: false });
  fail(error);
  return (data || []) as InvitationCampaign[];
}

export async function campaignCounts(): Promise<{ campaign_id: string; status: string; gl_guest_id: string | null }[]> {
  const { data, error } = await supabase.from('invitation_recipient').select('campaign_id, status, gl_guest_id');
  fail(error);
  return (data || []) as { campaign_id: string; status: string; gl_guest_id: string | null }[];
}

export async function getCampaign(id: string): Promise<InvitationCampaign | null> {
  const { data, error } = await supabase.from('invitation_campaign').select('*').eq('id', id).maybeSingle();
  fail(error);
  return data as InvitationCampaign | null;
}

export async function createCampaign(row: InvitationCampaignInsert): Promise<InvitationCampaign> {
  const { data, error } = await supabase.from('invitation_campaign').insert(row).select('*').single();
  fail(error);
  return data as InvitationCampaign;
}

export async function updateCampaign(id: string, patch: InvitationCampaignUpdate): Promise<InvitationCampaign> {
  const { data, error } = await supabase.from('invitation_campaign').update(patch).eq('id', id).select('*').single();
  fail(error);
  return data as InvitationCampaign;
}

export async function deleteCampaign(id: string) {
  const { error } = await supabase.from('invitation_campaign').delete().eq('id', id);
  fail(error);
}

export async function listRecipients(campaignId: string): Promise<InvitationRecipient[]> {
  const { data, error } = await supabase.from('invitation_recipient').select('*').eq('campaign_id', campaignId)
    .order('sort_order', { ascending: true, nullsFirst: false }).order('created_at', { ascending: true });
  fail(error);
  return (data || []) as InvitationRecipient[];
}

/** The other campaigns of the same event and their guests (duplicate checks before an import). */
export async function eventRecipients(eventId: string, exceptCampaign: string): Promise<(InvitationRecipient & { campaign_name: string })[]> {
  const { data: camps, error } = await supabase.from('invitation_campaign').select('id, name').eq('gl_event_id', eventId).neq('id', exceptCampaign);
  fail(error);
  const ids = (camps || []).map(c => c.id as string);
  if (!ids.length) return [];
  const names = new Map((camps || []).map(c => [c.id as string, c.name as string]));
  const { data, error: e2 } = await supabase.from('invitation_recipient').select('*').in('campaign_id', ids);
  fail(e2);
  return ((data || []) as InvitationRecipient[]).map(r => ({ ...r, campaign_name: names.get(r.campaign_id) || 'Another campaign' }));
}

export async function eventGuests(eventId: string): Promise<GlGuestLite[]> {
  const { data, error } = await supabase.from('gl_guest')
    .select('id, event_id, source, status, first_name, last_name, email, company, job_title, phone, invited_at, responded_at, checked_in_at, created_at')
    .eq('event_id', eventId);
  fail(error);
  return (data || []) as GlGuestLite[];
}

export async function emailLog(guestIds: string[]): Promise<EmailLogLite[]> {
  if (!guestIds.length) return [];
  const out: EmailLogLite[] = [];
  for (let i = 0; i < guestIds.length; i += 100) {
    const { data, error } = await supabase.from('gl_email_log').select('guest_id, kind, sent_at').in('guest_id', guestIds.slice(i, i + 100));
    fail(error);
    out.push(...((data || []) as EmailLogLite[]));
  }
  return out;
}

export async function insertRecipients(rows: InvitationRecipientInsert[]): Promise<InvitationRecipient[]> {
  if (!rows.length) return [];
  const { data, error } = await supabase.from('invitation_recipient').insert(rows).select('*');
  if (error) throw Object.assign(new Error(error.message), { code: error.code });
  return (data || []) as InvitationRecipient[];
}

export async function updateRecipient(id: string, patch: InvitationRecipientUpdate): Promise<InvitationRecipient> {
  const { data, error } = await supabase.from('invitation_recipient').update(patch).eq('id', id).select('*').single();
  if (error) throw Object.assign(new Error(error.message), { code: error.code });
  return data as InvitationRecipient;
}

export async function updateRecipients(ids: string[], patch: InvitationRecipientUpdate): Promise<InvitationRecipient[]> {
  if (!ids.length) return [];
  const { data, error } = await supabase.from('invitation_recipient').update(patch).in('id', ids).select('*');
  fail(error);
  return (data || []) as InvitationRecipient[];
}

export async function deleteRecipients(ids: string[]) {
  if (!ids.length) return;
  const { error } = await supabase.from('invitation_recipient').delete().in('id', ids);
  fail(error);
}

export async function findDuplicates(campaignId: string): Promise<InvitationDuplicate[]> {
  const { data, error } = await supabase.rpc('invitation_find_duplicates', { p_campaign_id: campaignId });
  fail(error);
  return (data || []) as InvitationDuplicate[];
}

/** "recipientId:guestId" of the guest-list rows this campaign's guests unlinked after a refused send. */
export async function unlinkedRows(campaignId: string): Promise<Set<string>> {
  const { data, error } = await supabase.from('invitation_log').select('recipient_id, payload')
    .eq('campaign_id', campaignId).eq('action', 'guest_unlinked');
  fail(error);
  return new Set((data || []).map(l => `${l.recipient_id}:${(l.payload as { guest_id?: string } | null)?.guest_id}`));
}

export async function logAction(campaignId: string, action: string, payload: Record<string, unknown> = {}, recipientId: string | null = null) {
  // actor_id defaults to the signed-in staff member (the policy requires it). Ids only, no names.
  await supabase.from('invitation_log').insert({ campaign_id: campaignId, recipient_id: recipientId, action, payload });
}

/* ─── Storage: the PDFs the sender attaches ─── */

export const pdfPath = (campaignId: string, recipientId: string, kind: 'ticket' | 'letter') => `${campaignId}/${recipientId}/${kind}.pdf`;

export async function uploadPdf(campaignId: string, recipientId: string, kind: 'ticket' | 'letter', bytes: Uint8Array) {
  const path = pdfPath(campaignId, recipientId, kind);
  const { error } = await supabase.storage.from(INVITATION_FILES_BUCKET)
    .upload(path, new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' }), { upsert: true, contentType: 'application/pdf', cacheControl: '0' });
  fail(error);
  return path;
}

/* ─── Artwork, fonts and the signature (cached for the session) ─── */

const cache = new Map<string, Promise<ArrayBuffer | null>>();
function fetchBytes(url: string): Promise<ArrayBuffer | null> {
  if (!cache.has(url)) {
    cache.set(url, fetch(url).then(r => (r.ok ? r.arrayBuffer() : null)).catch(() => null));
  }
  return cache.get(url)!;
}

let signatureP: Promise<ArrayBuffer | null> | null = null;
/** The SM26 letterhead signature (sm_event "sm26" settings.letterhead.signature, private event-media). */
export function signatureBytes(): Promise<ArrayBuffer | null> {
  if (!signatureP) {
    signatureP = (async () => {
      const { data: ev } = await supabase.from('sm_event').select('settings').eq('slug', 'sm26').maybeSingle();
      const path = ((ev?.settings as { letterhead?: { signature?: string } } | null)?.letterhead?.signature) || '';
      if (!path) return null;
      const { data } = await supabase.storage.from('event-media').createSignedUrl(path, 600);
      if (!data?.signedUrl) return null;
      const r = await fetch(data.signedUrl);
      return r.ok ? r.arrayBuffer() : null;
    })().catch(() => null);
    // A failure is retried on the next call (for example after the session refreshed).
    signatureP.then(b => { if (!b) signatureP = null; });
  }
  return signatureP;
}

export async function loadAssets(c: Pick<InvitationCampaign, 'settings'>): Promise<InvitationAssets> {
  const folder = (c.settings?.assets || 'wys26').replace(/[^a-z0-9_-]/gi, '');
  const art = invitationArtwork(folder);
  const drawn = c.settings?.ticket_artwork === 'drawn';
  const need = async (url: string) => {
    const b = await fetchBytes(url);
    if (!b) throw new Error(`Could not load ${url}`);
    return b;
  };
  const [light, regular, medium, semibold, pagellaRegular, pagellaItalic] = await Promise.all([
    need(INVITATION_FONTS.montserratLight), need(INVITATION_FONTS.montserratRegular), need(INVITATION_FONTS.montserratMedium),
    need(INVITATION_FONTS.montserratSemiBold), need(INVITATION_FONTS.pagellaRegular), need(INVITATION_FONTS.pagellaItalic),
  ]);
  const opt = (url: string) => fetchBytes(url);
  const [white, navy, banner, m3Navy, m3White, wysNavy, wysWhite, omniNavy, omniWhite, signature] = await Promise.all([
    drawn ? null : opt(art.templates.ticketWhite), drawn ? null : opt(art.templates.ticketNavy), opt(art.logos.letterBanner),
    drawn ? opt(art.logos.m3Navy) : null, drawn ? opt(art.logos.m3White) : null,
    drawn ? opt(art.logos.wysNavy) : null, drawn ? opt(art.logos.wysWhite) : null,
    drawn ? opt(art.logos.omniNavy) : null, drawn ? opt(art.logos.omniWhite) : null,
    c.settings?.signature === 'none' ? null : signatureBytes(),
  ]);
  return {
    fonts: { light, regular, medium, semibold, pagellaRegular, pagellaItalic },
    templates: { white, navy },
    logos: { banner, m3Navy, m3White, wysNavy, wysWhite, omniNavy, omniWhite },
    signature,
  };
}
