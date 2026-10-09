import { supabase } from '@/lib/supabase';
import { resizeImage, fileMeta } from '@/lib/image';
import { sendNotification } from '@/lib/notifications';
import type { Organization, OrganizationMember, OrganizationInvitation } from '@/types/database';

/**
 * The organisation's writes, taken out of OrganizationTab (the full editor) so
 * the dashboard's one-field windows do exactly the same thing: same storage
 * paths, same RPCs, same columns, same e-mails. OrganizationTab calls these
 * too; each caller keeps its own messages and local state.
 *
 * Who may do what is the database's call (RLS, update_org_branding /
 * update_org_gallery check membership, guard_org_sensitive_columns): any member
 * edits the company's page; documents, invitations, join requests and removals
 * are the owner's in the interface, as before.
 */

export const ORG_IMAGE_MAX_BYTES = 25 * 1024 * 1024;
export const ORG_DOC_MAX_BYTES = 20 * 1024 * 1024;
export const LOGO_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,image/svg+xml';
export const COVER_ACCEPT = 'image/jpeg,image/png,image/webp';
export const DOC_ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx';

/** Why an image cannot be used ('type': not an image, 'size': over 25 MB), or null. */
export function imageProblem(file: File): 'type' | 'size' | null {
  if (!file.type.startsWith('image/')) return 'type';
  if (file.size > ORG_IMAGE_MAX_BYTES) return 'size';
  return null;
}

/* ------------------------------------------------------------------ branding */

/**
 * Uploads a logo (600 px) or a cover (2000 × 700) to org-logos and stores it
 * with update_org_branding. Returns the public URL and a "1.2 MB · 800×600" line.
 */
export async function uploadOrgBrandImage(orgId: string, kind: 'logo' | 'banner', file: File): Promise<{ url: string; meta: string }> {
  const meta = await fileMeta(file);
  // Shrinks big files; keeps PNG/SVG transparency.
  const blob = kind === 'logo' ? await resizeImage(file, 600, 600) : await resizeImage(file, 2000, 700);
  const ctype = (blob as Blob).type || file.type;
  const ext = ctype === 'image/svg+xml' ? 'svg' : ctype === 'image/png' ? 'png' : 'jpg';
  const fileName = `${orgId}/${kind}-${Date.now()}.${ext}`;
  const { error: upErr } = await supabase.storage.from('org-logos').upload(fileName, blob, { cacheControl: '3600', upsert: true, contentType: ctype });
  if (upErr) throw upErr;
  const { data: urlData } = supabase.storage.from('org-logos').getPublicUrl(fileName);
  const url = urlData.publicUrl;
  const { error: dbErr } = await supabase.rpc('update_org_branding', { p_org_id: orgId, p_field: kind, p_url: url });
  if (dbErr) throw dbErr;
  return { url, meta };
}

/** Removes the logo or the cover (the stored file stays, as before). */
export async function removeOrgBrandImage(orgId: string, kind: 'logo' | 'banner'): Promise<void> {
  const { error } = await supabase.rpc('update_org_branding', { p_org_id: orgId, p_field: kind, p_url: null });
  if (error) throw error;
}

/* ------------------------------------------------------------------ gallery */

export interface GalleryUploadResult {
  /** The whole gallery after the upload (what update_org_gallery stored). */
  next: string[];
  added: number;
  /** Files that were skipped: too large, or the upload failed. Not-images are skipped silently. */
  skipped: { name: string; reason: 'size' | 'upload'; message?: string }[];
}

/** Adds up to 12 pictures (1400 px) to the product images, then stores the list. */
export async function addOrgGalleryImages(orgId: string, current: string[], files: File[]): Promise<GalleryUploadResult> {
  const added: string[] = [];
  const skipped: GalleryUploadResult['skipped'] = [];
  for (const file of files.slice(0, 12)) {
    if (!file.type.startsWith('image/')) continue;
    if (file.size > ORG_IMAGE_MAX_BYTES) { skipped.push({ name: file.name, reason: 'size' }); continue; }
    const blob = await resizeImage(file, 1400, 1400);
    const ctype = (blob as Blob).type || file.type;
    const ext = ctype === 'image/png' ? 'png' : ctype === 'image/webp' ? 'webp' : 'jpg';
    const fileName = `${orgId}/gallery-${Date.now()}-${Math.floor(Math.random() * 100000)}.${ext}`;
    const { error: upErr } = await supabase.storage.from('org-logos').upload(fileName, blob, { cacheControl: '3600', upsert: false, contentType: ctype });
    if (upErr) { skipped.push({ name: file.name, reason: 'upload', message: upErr.message }); continue; }
    added.push(supabase.storage.from('org-logos').getPublicUrl(fileName).data.publicUrl);
  }
  if (added.length === 0) return { next: current, added: 0, skipped };
  const next = [...current, ...added];
  const { error } = await supabase.rpc('update_org_gallery', { p_org_id: orgId, p_urls: next });
  if (error) throw error;
  return { next, added: added.length, skipped };
}

/** Takes one picture out of the product images; returns the new list. */
export async function removeOrgGalleryImage(orgId: string, current: string[], url: string): Promise<string[]> {
  const next = current.filter((u) => u !== url);
  const { error } = await supabase.rpc('update_org_gallery', { p_org_id: orgId, p_urls: next });
  if (error) throw error;
  return next;
}

/* ------------------------------------------------------------------ details */

/** The columns of the company page a member edits one by one. */
export type OrgEditableField = 'name' | 'website' | 'description' | 'country' | 'city' | 'headquarters_country' | 'audience_description';

/**
 * Saves some of the company's own columns (and updated_at), as the full
 * editor's "Save changes" does for all of them. The caller trims; an empty
 * optional value is stored as null (the name is never empty).
 */
export async function saveOrgFields(orgId: string, fields: Partial<Record<OrgEditableField, string | null>>): Promise<void> {
  const { error } = await supabase
    .from('organizations')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', orgId);
  if (error) throw error;
}

/** Which sectors describe a company: what a marina is interested in, what the others provide (the full editor's rule). */
export function orgSectorTable(orgType: string | null | undefined): 'organization_interest_sectors' | 'organization_service_sectors' {
  return orgType === 'marina' ? 'organization_interest_sectors' : 'organization_service_sectors';
}

/** Replaces the company's sectors: delete, then insert the new list (as the full editor does). */
export async function saveOrgSectors(orgId: string, orgType: string | null | undefined, sectorIds: string[]): Promise<void> {
  const table = orgSectorTable(orgType);
  const del = await supabase.from(table).delete().eq('organization_id', orgId);
  if (del.error) throw del.error;
  if (sectorIds.length > 0) {
    const ins = await supabase.from(table).insert(sectorIds.map((s) => ({ organization_id: orgId, sector_id: s })));
    if (ins.error) throw ins.error;
  }
}

/* ------------------------------------------------------------------ documents */

export interface OrgDocument {
  id: string;
  organization_id: string;
  uploaded_by: string;
  file_name: string;
  file_url: string;
  file_size: number;
  description: string | null;
  created_at: string;
}

export async function fetchOrgDocuments(orgId: string): Promise<OrgDocument[]> {
  const { data } = await supabase
    .from('organization_documents')
    .select('*')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false });
  return (data ?? []) as OrgDocument[];
}

/**
 * Uploads a document to the private org-documents bucket (a one-year signed
 * link is stored) and lists it. The caller checks the size (20 MB) and the
 * session first.
 */
export async function uploadOrgDocument(orgId: string, uid: string, file: File, description: string): Promise<void> {
  const storagePath = `${orgId}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  const { error: upErr } = await supabase.storage.from('org-documents').upload(storagePath, file, { cacheControl: '3600' });
  if (upErr) throw upErr;
  // For private bucket, we build a signed URL or use the path for later download
  const { data: signedData } = await supabase.storage.from('org-documents').createSignedUrl(storagePath, 60 * 60 * 24 * 365);
  const fileUrl = signedData?.signedUrl || storagePath;
  const { error: dbErr } = await supabase.from('organization_documents').insert({
    organization_id: orgId,
    uploaded_by: uid,
    file_name: file.name,
    file_url: fileUrl,
    file_size: file.size,
    description: description.trim() || null,
  });
  if (dbErr) throw dbErr;
}

export async function deleteOrgDocument(docId: string): Promise<void> {
  const { error } = await supabase.from('organization_documents').delete().eq('id', docId);
  if (error) throw error;
}

/* ------------------------------------------------------------------ team */

export type TeamMember = OrganizationMember & {
  profiles?: { first_name: string | null; last_name: string | null; email: string | null; persona?: string | null; avatar_url?: string | null; job_title?: string | null } | null;
};

/** The company's members with their name, e-mail, photo and job title (co-members may read each other's profile). */
export async function fetchOrgMembers(orgId: string): Promise<TeamMember[]> {
  const { data } = await supabase
    .from('organization_members')
    .select('id, organization_id, user_id, role, joined_at, profiles(first_name, last_name, email, persona, avatar_url, job_title)')
    .eq('organization_id', orgId)
    .order('joined_at', { ascending: true });
  return (data ?? []) as unknown as TeamMember[];
}

/** Invitations still open, join requests and accepted invitations (visible to every member; actions are the owner's). */
export async function fetchOrgInvitations(orgId: string): Promise<OrganizationInvitation[]> {
  const { data } = await supabase
    .from('organization_invitations')
    .select('*')
    .eq('organization_id', orgId)
    .in('status', ['pending', 'join_requested', 'accepted'])
    .order('created_at', { ascending: false });
  return (data ?? []) as OrganizationInvitation[];
}

/**
 * Why this invitation cannot be sent, or null:
 *  - 'capacity': a company other than a marina / developer has used its seats
 *    (members and open invitations count);
 *  - 'domain': the company has a primary domain (not a marina) and the address is elsewhere.
 */
export function invitationProblem(org: Pick<Organization, 'organization_type' | 'max_seats' | 'primary_domain'>, occupiedSeats: number, email: string): 'capacity' | 'domain' | null {
  const isMarinaOrg = org.organization_type === 'marina' || org.organization_type === 'developer';
  if (!isMarinaOrg && org.max_seats && occupiedSeats >= org.max_seats) return 'capacity';
  // Domain check — skip for marina orgs (marinas use personal emails, invite-only)
  const inviteDomain = email.split('@')[1]?.toLowerCase();
  if (org.primary_domain && org.organization_type !== 'marina' && inviteDomain !== org.primary_domain) return 'domain';
  return null;
}

/** "Alex Morel", else the e-mail's name, else "A team member": how invitations are signed. */
export function inviterName(profile: { first_name?: string | null; last_name?: string | null } | null | undefined, email: string | null | undefined): string {
  return profile?.first_name
    ? `${profile.first_name}${profile.last_name ? ' ' + profile.last_name : ''}`
    : email?.split('@')[0] || 'A team member';
}

/**
 * Invites a colleague: the invitation row, then the e-mail with its /join/<id>
 * link (team_invitation). The caller checks invitationProblem() and the session first.
 */
export async function sendTeamInvitation(
  org: Pick<Organization, 'id' | 'name'>,
  invitedBy: string,
  signedBy: string,
  person: { email: string; firstName?: string; lastName?: string },
): Promise<void> {
  const email = person.email.trim().toLowerCase();
  const inviteDomain = person.email.split('@')[1]?.toLowerCase();
  const { error } = await supabase
    .from('organization_invitations')
    .insert({
      organization_id: org.id,
      email,
      normalized_domain: inviteDomain || null,
      invited_by_user_id: invitedBy,
      first_name: person.firstName?.trim() || null,
      last_name: person.lastName?.trim() || null,
    });
  if (error) throw error;

  // Fetch the newly created invitation ID so we can include it in the email link
  const { data: newInvite } = await supabase
    .from('organization_invitations')
    .select('id')
    .eq('organization_id', org.id)
    .eq('email', email)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const inviteUrl = newInvite?.id
    ? `${window.location.origin}/join/${newInvite.id}`
    : window.location.origin;

  // Send invitation email via edge function
  sendNotification({
    type: 'team_invitation',
    email,
    data: {
      org_name: org.name || 'An organization',
      inviter_name: signedBy,
      signup_url: inviteUrl,
      first_name: person.firstName?.trim() || '',
    },
  });
}

/** Sends the invitation e-mail again (team_invitation_reminder), with the same /join/<id> link. */
export function resendTeamInvitation(org: Pick<Organization, 'name'>, inv: Pick<OrganizationInvitation, 'id' | 'email' | 'first_name'>, signedBy: string): void {
  const reminderUrl = `${window.location.origin}/join/${inv.id}`;
  sendNotification({
    type: 'team_invitation_reminder',
    email: inv.email,
    data: {
      org_name: org.name || 'An organization',
      inviter_name: signedBy,
      signup_url: reminderUrl,
      first_name: inv.first_name || '',
    },
  });
}

export async function cancelTeamInvitation(invId: string): Promise<void> {
  const { error } = await supabase
    .from('organization_invitations')
    .update({ status: 'cancelled' })
    .eq('id', invId);
  if (error) throw error;
}

/** Accepts or declines someone who asked to join, then tells them by e-mail. */
export async function answerJoinRequest(invId: string, invEmail: string, orgName: string | null | undefined, approve: boolean): Promise<void> {
  const { error } = await supabase.rpc(approve ? 'approve_join_request' : 'reject_join_request', { p_invitation_id: invId });
  if (error) throw error;
  // Notify the requester by email
  sendNotification({
    type: approve ? 'join_request_approved' : 'join_request_rejected',
    email: invEmail,
    data: {
      org_name: orgName || 'Your organization',
      first_name: '',
    },
  });
}

/** Takes a member off the company (the owner's action). */
export async function removeOrgMember(memberId: string): Promise<void> {
  const { error } = await supabase
    .from('organization_members')
    .delete()
    .eq('id', memberId);
  if (error) throw error;
}

/** Leaves the company (a member who is not its owner). */
export async function leaveOrg(orgId: string, uid: string): Promise<void> {
  const { error } = await supabase
    .from('organization_members')
    .delete()
    .eq('organization_id', orgId)
    .eq('user_id', uid);
  if (error) throw error;
}
