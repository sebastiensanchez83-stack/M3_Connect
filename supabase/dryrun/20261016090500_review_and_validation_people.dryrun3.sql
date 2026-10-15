-- DRY RUN 3 of 4 of supabase/migrations/20261016090500_review_and_validation_people.sql
-- (primary_domain, Not accepted, questions, the persona before / after the rights switch, repeated decisions).
-- NOT A MIGRATION. ONE query text, ONE execute_sql call, AFTER
-- 20261016090000_review_and_validation_orgs is applied and BEFORE this one. The migration
-- verbatim (dry run 1 compares the snapshot), then cases as anon / a member / a verified admin, each rolled
-- back (flags are set inside the cases that need them, never left). Ends with RAISE EXCEPTION
-- 'DRYRUN ...'. Expected: "14 PASS, 0 FAIL".

set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- ─── B. The migration, verbatim ─────────────────────────────────────────────────
-- Registration Phase 3 (DB lane), part 2 of 4: M3's decisions on people and claims.
-- Spec: regspec-en.md §4.6 (admin_validate_person, admin_decide_claim), §7, §8.1, §12; Victor's
-- decisions: M3 validates every person and decides every claim (Q3, 11 Oct 2026). Contract §11.
-- NOT APPLIED. Apply after 20261016090000_review_and_validation_orgs (checked below).
-- Down: supabase/migrations/down/20261016090500_review_and_validation_people.down.sql.
-- Dry runs: supabase/dryrun/20261016090500_review_and_validation_people.dryrun.sql, .dryrun2.sql,
-- .dryrun3.sql, .dryrun4.sql.
--
-- New functions only (verified admins; SECURITY DEFINER, search_path ''). Nothing existing
-- changes and nothing runs by itself: the old main site and the redesign with every flag off
-- behave as today. Each decision writes ONE review_log row and queues at most ONE e-mail in
-- notification_outbox (dedupe_key = kind:subject:review_log id; a repeated decision that
-- changes nothing for the person queues none: validate of someone already verified with no
-- company change, the same "not accepted" reason again, the same open question again). The
-- e-mails are sent by the registration-cron drain (EDGE lane), never here.
-- Flags (fixer, 15 Oct 2026):
--  * review_queue OFF (production until go-live): a person decision queues NO e-mail unless
--    the call says notify: true; the result says notify_by_client: true and the page sends
--    the status e-mail itself, as today (send-status-notification / sendNotification). So
--    an approval from the redesign is never silent, and nothing piles up for the drain.
--    review_queue ON: queued for the drain. Questions (ask) and claim decisions are always
--    queued (no other sender exists for them; they come from the v2 queue only).
--  * capabilities_enforced OFF (until the rights switch): the persona still gives rights on
--    the live site, so a decision never moves it on its own. validate with no company step
--    keeps the persona; a company step (create, link, claim) or "participant" sets the
--    display persona, except that nothing but "participant" demotes to individual.
--   admin_validate_person(user_id, decision)  validate | participant | reject | ask
--     (the old Approve / Reject buttons of AdminUsers and AdminUserDetail keep their direct
--     updates while review_queue is off, and open the validation window, i.e. this function,
--     once it is on: contract §11.2; the draft admin_approve_person was dropped, fixer 15 Oct)
--   admin_decide_claim(invitation_id, approve, note)
--   admin_revoke_team_join(member_id, reset_person, note)   Team joins tab ("remove")
--   admin_review_dismiss(kind, id, other_id, note)          FYI seen / keep / not a duplicate

set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $pre$
begin
  if to_regprocedure('public.review_name_key(text,text)') is null
     or to_regprocedure('public.admin_archive_org(uuid,boolean,text)') is null
     or not exists (select 1 from pg_attribute a where a.attrelid = 'public.organizations'::regclass
                     and a.attname = 'duplicate_of' and not a.attisdropped) then
    raise exception 'review_and_validation_people: apply 20261016090000_review_and_validation_orgs first';
  end if;
  if pg_get_constraintdef((select c.oid from pg_constraint c where c.conname = 'notification_outbox_kind_check'
                            and c.conrelid = 'public.notification_outbox'::regclass)) not like '%claim_declined%' then
    raise exception 'review_and_validation_people: notification_outbox does not accept the decision e-mails yet';
  end if;
end
$pre$;

-- The display persona (spec §9): the type of the person's validated company (the one
-- given first, then the one they own, then the first joined), else individual.
create or replace function public.review_display_persona(p_user_id uuid, p_prefer_org uuid default null)
returns text
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce((select o.organization_type
                     from public.organization_members m
                     join public.organizations o on o.id = m.organization_id
                    where m.user_id = p_user_id and o.access_status = 'verified' and o.organization_type is not null
                      and o.archived_at is null and o.duplicate_of is null
                    order by (o.id = p_prefer_org) desc nulls last, (m.role = 'owner') desc, m.joined_at asc nulls last, o.id
                    limit 1), 'individual')
$function$;

-- A registration flag: on only as JSON true (as everywhere else; never a cast).
create or replace function public.review_flag(p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce((select (ps.value -> p_key) = 'true'::jsonb
                     from public.platform_settings ps where ps.key = 'registration_flags'), false)
$function$;

-- An "account under review" e-mail still unsent when M3 decides is never sent afterwards.
create or replace function public.review_skip_under_review_mail(p_user_id uuid)
returns void
language sql
volatile
security definer
set search_path = ''
as $function$
  update public.notification_outbox n
     set sent_at = now(), last_error = 'skipped: M3 decided before it was sent'
   where n.kind = 'account_under_review' and n.user_id = p_user_id and n.sent_at is null
$function$;

create or replace function public.admin_validate_person(p_user_id uuid, p_decision jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_action text;
  v_reason text;
  v_reason_old text;
  v_notify boolean;
  v_client boolean := false;
  v_enforced boolean;
  v_spec jsonb;
  v_mode text;
  v_type text;
  v_as_owner boolean;
  v_org_id uuid;
  v_name text;
  v_website text;
  v_country text;
  v_status text;
  v_first text;
  v_persona_old text;
  v_proven_at timestamptz;
  v_pemail text;
  v_email text;
  v_proven boolean;
  v_ostatus text;
  v_otype text;
  v_oowner uuid;
  v_oname text;
  v_hidden boolean;
  v_role text;
  v_has_owner boolean;
  v_created boolean := false;
  v_verified_org boolean := false;
  v_owner_ignored boolean := false;
  v_type_ignored boolean := false;
  v_domain text;
  v_whost text;
  v_pdomain text;
  v_base text;
  v_slug text;
  v_n integer := 1;
  v_persona text;
  v_display text;
  v_persona_kept boolean := false;
  v_mail_org_id uuid;
  v_mail_org text;
  v_rejected_orgs integer := 0;
  v_unchanged boolean := false;
  v_member_changed boolean := false;
  v_log bigint;
  v_kind text;
  v_outbox bigint;
begin
  if not coalesce(public.is_admin(), false) then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;
  if p_user_id is null or p_decision is null or jsonb_typeof(p_decision) <> 'object' then
    raise exception using errcode = '22023', message = 'bad_input';
  end if;
  v_action := p_decision ->> 'action';
  if v_action is null or v_action not in ('validate', 'participant', 'reject', 'ask') then
    raise exception using errcode = '22023', message = 'bad_action';
  end if;
  v_reason := nullif(left(btrim(coalesce(p_decision ->> 'reason', '')), 2000), '');
  if v_action in ('reject', 'ask') and v_reason is null then
    raise exception using errcode = '22023', message = 'reason_required';
  end if;
  -- notify: false = no e-mail; true = queued; absent = queued when review_queue is on (the
  -- drain's time), else left to the page (notify_by_client); a question is always queued.
  v_notify := case when (p_decision -> 'notify') = 'false'::jsonb then false
                   when (p_decision -> 'notify') = 'true'::jsonb or v_action = 'ask' then true
                   else public.review_flag('review_queue') end;
  v_client := not v_notify and (p_decision -> 'notify') is distinct from 'false'::jsonb;
  v_enforced := public.review_flag('capabilities_enforced');
  v_spec := coalesce(p_decision -> 'org', '{}'::jsonb);
  if jsonb_typeof(v_spec) <> 'object' then
    raise exception using errcode = '22023', message = 'bad_org';
  end if;
  v_mode := coalesce(nullif(v_spec ->> 'mode', ''), 'none');
  if v_mode not in ('none', 'link', 'create') then
    raise exception using errcode = '22023', message = 'bad_org_mode';
  end if;
  if v_mode <> 'none' and v_action <> 'validate' then
    raise exception using errcode = '22023', message = 'org_needs_validate';
  end if;
  v_type := nullif(v_spec ->> 'type', '');
  if v_type is not null and v_type not in ('marina', 'partner', 'media_partner', 'developer', 'investor') then
    raise exception using errcode = '22023', message = 'bad_type';
  end if;
  v_as_owner := coalesce((v_spec -> 'as_owner') = 'true'::jsonb, false);

  select pr.access_status::text, pr.first_name, pr.persona::text, pr.email_proven_at, lower(btrim(pr.email)), pr.rejection_reason
    into v_status, v_first, v_persona_old, v_proven_at, v_pemail, v_reason_old
    from public.profiles pr where pr.user_id = p_user_id
     for update;
  if not found then
    raise exception using errcode = '22023', message = 'person_not_found';
  end if;
  if v_persona_old in ('admin', 'moderator') then
    raise exception using errcode = '22023', message = 'staff_profile';
  end if;
  if v_action = 'ask' and v_status not in ('pending', 'payment_pending', 'rejected') then
    raise exception using errcode = '22023', message = 'not_pending';
  end if;
  select lower(btrim(u.email)) into v_email from auth.users u where u.id = p_user_id;
  -- Proven = stamped AND still the login address (contract §2 "Proven").
  v_proven := v_proven_at is not null and v_email is not null and v_pemail = v_email;

  -- ---- The company (validate only) ----
  if v_mode = 'link' then
    if coalesce(v_spec ->> 'org_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception using errcode = '22023', message = 'org_id_required';
    end if;
    v_org_id := (v_spec ->> 'org_id')::uuid;
    select o.access_status, o.organization_type, o.owner_user_id, o.name, (o.archived_at is not null or o.duplicate_of is not null)
      into v_ostatus, v_otype, v_oowner, v_oname, v_hidden
      from public.organizations o where o.id = v_org_id
       for update;
    if not found then
      raise exception using errcode = '22023', message = 'org_not_found';
    end if;
    if v_hidden then
      raise exception using errcode = '22023', message = 'org_not_listed';
    end if;
    select m.role into v_role from public.organization_members m
     where m.organization_id = v_org_id and m.user_id = p_user_id
     order by (m.role = 'owner') desc limit 1;
    v_has_owner := v_oowner is not null
                   or exists (select 1 from public.organization_members m where m.organization_id = v_org_id and m.role = 'owner');
    if v_ostatus = 'pending' then
      -- Only the person's OWN company (old wizard: they are its owner, or become it here as
      -- a member of an ownerless one) is validated with them, as "Approve" did; never a
      -- company someone else owns. A verified company always has a type (it is then locked).
      if v_role is distinct from 'owner' and not (v_role is not null and v_as_owner and not v_has_owner) then
        raise exception using errcode = '22023', message = 'org_not_verified';
      end if;
      if coalesce(v_type, v_otype) is null then
        raise exception using errcode = '22023', message = 'type_required';
      end if;
      v_verified_org := true;
    elsif v_ostatus <> 'verified' then
      raise exception using errcode = '22023', message = 'org_not_linkable';
    end if;
    if v_role is null then
      v_role := case when v_as_owner and not v_has_owner then 'owner' else 'collaborator' end;
      v_owner_ignored := v_as_owner and v_has_owner;
      insert into public.organization_members (organization_id, user_id, role) values (v_org_id, p_user_id, v_role);
      v_member_changed := true;
    elsif v_role <> 'owner' and v_as_owner then
      if v_has_owner then
        v_owner_ignored := true;
      else
        update public.organization_members m set role = 'owner' where m.organization_id = v_org_id and m.user_id = p_user_id;
        v_role := 'owner';
        v_member_changed := true;
      end if;
    end if;
    if v_role = 'owner' and v_oowner is null then
      update public.organizations o set owner_user_id = p_user_id where o.id = v_org_id;
    end if;
    if v_verified_org then
      update public.organizations o
         set access_status = 'verified', onboarding_status = 'completed', rejection_reason = null,
             organization_type = coalesce(v_type, o.organization_type)
       where o.id = v_org_id;
      perform public.log_org_event(v_org_id, 'organization_verified', jsonb_build_object('by', 'admin_validate_person'));
    elsif v_type is not null and v_type is distinct from v_otype then
      v_type_ignored := true;   -- a verified company's type is locked (change it on the company)
    end if;
    v_mail_org_id := v_org_id;
    v_mail_org := v_oname;
  elsif v_mode = 'create' then
    v_name := nullif(left(btrim(coalesce(v_spec ->> 'name', '')), 200), '');
    if v_name is null then
      raise exception using errcode = '22023', message = 'name_required';
    end if;
    if v_type is null then
      raise exception using errcode = '22023', message = 'type_required';
    end if;
    v_website := nullif(left(btrim(coalesce(v_spec ->> 'website', '')), 300), '');
    v_country := nullif(left(btrim(coalesce(v_spec ->> 'country', '')), 80), '');
    if (v_spec -> 'force_new') is distinct from 'true'::jsonb then
      select o.id into v_org_id from public.organizations o
       where public.normalize_org_name(o.name) = public.normalize_org_name(v_name)
         and o.archived_at is null and o.duplicate_of is null and o.access_status in ('verified', 'pending')
       order by o.created_at limit 1;
      if v_org_id is not null then
        raise exception using errcode = '22023', message = 'org_exists', detail = v_org_id::text;
      end if;
    end if;
    -- primary_domain only from the person's PROVEN, non-public address, and only when the
    -- website (if given) is on that domain.
    v_domain := nullif(split_part(coalesce(v_email, ''), '@', 2), '');
    v_whost := public.review_url_host(v_website);
    if v_proven and v_domain is not null and not public.is_public_email_domain(v_domain)
       and (v_whost is null or public.review_domain_match(v_domain, v_whost))
       and not exists (select 1 from public.organizations o where lower(o.primary_domain) = v_domain) then
      v_pdomain := v_domain;
    end if;
    v_base := coalesce(left(nullif(regexp_replace(regexp_replace(lower(public.immutable_unaccent(v_name)), '[^a-z0-9]+', '-', 'g'),
                                                  '^-+|-+$', '', 'g'), ''), 60), 'company');
    v_slug := v_base;
    while exists (select 1 from public.organizations o where o.slug = v_slug) loop
      v_n := v_n + 1;
      v_slug := v_base || '-' || v_n;
    end loop;
    insert into public.organizations (name, slug, organization_type, website, country, primary_domain,
                                      access_status, onboarding_status, owner_user_id, created_by_user_id)
    values (v_name, v_slug, v_type, v_website, v_country, v_pdomain, 'verified', 'completed', p_user_id, p_user_id)
    returning id into v_org_id;
    insert into public.organization_members (organization_id, user_id, role) values (v_org_id, p_user_id, 'owner');
    perform public.log_org_event(v_org_id, 'organization_created', jsonb_build_object('name', v_name, 'by', 'admin_validate_person'));
    v_created := true;
    v_role := 'owner';
    v_mail_org_id := v_org_id;
    v_mail_org := v_name;
  end if;

  -- ---- The person ----
  if v_action in ('validate', 'participant') then
    v_display := public.review_display_persona(p_user_id, v_org_id);
    v_persona := v_display;
    -- Before the rights switch the persona still gives rights on the live site: a validation
    -- without a company step keeps it (as the old Approve), and only "participant" demotes.
    if not v_enforced and v_action = 'validate' and (v_mode = 'none' or v_display = 'individual') then
      v_persona := v_persona_old;
      v_persona_kept := v_display is distinct from v_persona_old;
    end if;
    if v_mail_org_id is null and v_display <> 'individual' then
      select o.id, o.name into v_mail_org_id, v_mail_org
        from public.organization_members m join public.organizations o on o.id = m.organization_id
       where m.user_id = p_user_id and o.access_status = 'verified' and o.organization_type = v_display
         and o.archived_at is null and o.duplicate_of is null
       order by (m.role = 'owner') desc, m.joined_at asc nulls last, o.id limit 1;
    end if;
    -- Already verified and no company change: nothing to tell the person (no e-mail).
    v_unchanged := v_status = 'verified' and not (v_created or v_verified_org or v_member_changed);
    update public.profiles
       set access_status = 'verified', onboarding_status = 'completed', rejection_reason = null,
           persona = v_persona::public.persona_enum
     where user_id = p_user_id;
    perform public.review_skip_under_review_mail(p_user_id);
  elsif v_action = 'reject' then
    -- Refused again for the same reason (a double click, two admins): no second e-mail.
    v_unchanged := v_status = 'rejected' and v_reason_old is not distinct from v_reason;
    update public.profiles
       set access_status = 'rejected', onboarding_status = 'draft', rejection_reason = v_reason
     where user_id = p_user_id;
    -- As the old "Reject": the person's OWN companies still pending are refused with them.
    update public.organizations o
       set access_status = 'rejected', rejection_reason = v_reason
     where o.access_status = 'pending'
       and exists (select 1 from public.organization_members m
                    where m.organization_id = o.id and m.user_id = p_user_id and m.role = 'owner');
    get diagnostics v_rejected_orgs = row_count;
    perform public.review_skip_under_review_mail(p_user_id);
  else
    -- The same question still waiting to be sent, or asked in the last 10 minutes: not again.
    v_unchanged := exists (select 1 from public.notification_outbox n
                            where n.kind = 'account_info_requested' and n.user_id = p_user_id
                              and n.data ->> 'question' = v_reason
                              and (n.sent_at is null or n.created_at > now() - interval '10 minutes'));
  end if;
  v_client := v_client and not v_unchanged;

  insert into public.review_log (subject_type, subject_id, action, note, details, actor_id)
  values ('person', p_user_id,
          case v_action when 'validate' then 'validated' when 'participant' then 'validated_participant'
                        when 'reject' then 'rejected' else 'info_requested' end,
          v_reason,
          jsonb_strip_nulls(jsonb_build_object('previous_status', v_status, 'org_mode', v_mode, 'organization_id', v_org_id,
            'role', v_role, 'company_created', v_created, 'company_verified', v_verified_org, 'persona', v_persona,
            'persona_before', v_persona_old, 'display_persona', v_display, 'persona_kept', nullif(v_persona_kept, false),
            'primary_domain', v_pdomain, 'owner_ignored', v_owner_ignored, 'type_ignored', v_type_ignored,
            'companies_rejected', nullif(v_rejected_orgs, 0), 'unchanged', v_unchanged, 'notify', v_notify,
            'notify_by_client', v_client)),
          auth.uid())
  returning id into v_log;

  if v_notify and not v_unchanged then
    v_kind := case v_action when 'reject' then 'user_account_rejected' when 'ask' then 'account_info_requested'
                            else 'user_account_approved' end;
    insert into public.notification_outbox (kind, user_id, actor_id, subject_id, dedupe_key, data)
    values (v_kind, p_user_id, auth.uid(), p_user_id, v_kind || ':' || p_user_id || ':' || v_log,
            jsonb_strip_nulls(jsonb_build_object(
              'first_name', nullif(btrim(coalesce(v_first, '')), ''),
              'org_name', v_mail_org,
              'organization_id', v_mail_org_id,
              -- send-status-notification words the approval for a participant on action = 'participant'
              'action', v_action,
              'participant', case when v_action in ('validate', 'participant') then v_display = 'individual' end,
              'company_created', case when v_created then true end,
              'company_verified', case when v_verified_org then true end,
              'reason', case when v_action = 'reject' then v_reason end,
              'question', case when v_action = 'ask' then v_reason end,
              'review_log_id', v_log)))
    on conflict (dedupe_key) do nothing
    returning id into v_outbox;
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'ok', true, 'action', v_action, 'user_id', p_user_id,
    'access_status', case v_action when 'reject' then 'rejected' when 'ask' then v_status else 'verified' end,
    'persona', v_persona, 'persona_before', v_persona_old, 'display_persona', v_display, 'persona_kept', v_persona_kept,
    'organization_id', v_org_id, 'organization_name', coalesce(v_mail_org, v_oname), 'role', v_role,
    'company_created', v_created, 'company_verified', v_verified_org, 'primary_domain', v_pdomain,
    'owner_ignored', v_owner_ignored, 'type_ignored', v_type_ignored, 'companies_rejected', v_rejected_orgs,
    'unchanged', v_unchanged, 'notify_by_client', v_client, 'review_log_id', v_log, 'outbox_id', v_outbox));
end
$function$;

-- A claim (organization_invitations.status 'claim_requested', filed by complete_signup_for).
-- Approve: a verified, listed company with no owner gets the person as owner; the person is
-- verified (Q3). Decline: the request is refused, the person stays as they are.
-- The claimant is the account whose LOGIN address is the claim's, that still PROVES it and
-- already existed when the claim was filed (complete_signup_for files claims for proven
-- addresses only; with Confirm email off, a later account on that address proves nothing).
create or replace function public.admin_decide_claim(p_invitation_id uuid, p_approve boolean, p_note text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_note text := nullif(left(btrim(coalesce(p_note, '')), 2000), '');
  v_org uuid;
  v_email text;
  v_istatus text;
  v_code boolean;
  v_icreated timestamptz;
  v_user uuid;
  v_ucreated timestamptz;
  v_proven boolean;
  v_claimant boolean := false;
  v_first text;
  v_pstatus text;
  v_ppersona text;
  v_display text;
  v_oname text;
  v_ostatus text;
  v_oowner uuid;
  v_hidden boolean;
  v_persona text;
  v_kind text;
  v_log bigint;
  v_outbox bigint;
  v_others integer;
begin
  if not coalesce(public.is_admin(), false) then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;
  if p_invitation_id is null or p_approve is null then
    raise exception using errcode = '22023', message = 'bad_input';
  end if;
  select i.organization_id, lower(btrim(i.email)), i.status, i.code_matched, i.created_at
    into v_org, v_email, v_istatus, v_code, v_icreated
    from public.organization_invitations i where i.id = p_invitation_id
     for update;
  if not found then
    raise exception using errcode = '22023', message = 'claim_not_found';
  end if;
  if v_istatus <> 'claim_requested' then
    raise exception using errcode = '22023', message = 'not_an_open_claim', detail = v_istatus;
  end if;
  -- The account is the one whose LOGIN address is the claim's address (never profiles.email).
  select u.id, u.created_at into v_user, v_ucreated from auth.users u where lower(btrim(u.email)) = v_email order by u.created_at limit 1;
  if v_user is not null then
    select pr.first_name, pr.access_status::text, pr.persona::text,
           (pr.email_proven_at is not null and lower(btrim(pr.email)) = v_email)
      into v_first, v_pstatus, v_ppersona, v_proven
      from public.profiles pr where pr.user_id = v_user
       for update;
    v_claimant := v_pstatus is not null and coalesce(v_proven, false) and coalesce(v_ucreated <= v_icreated, false);
  end if;
  select o.name, o.access_status, o.owner_user_id, (o.archived_at is not null or o.duplicate_of is not null)
    into v_oname, v_ostatus, v_oowner, v_hidden
    from public.organizations o where o.id = v_org
     for update;

  if p_approve then
    if v_user is null or v_pstatus is null then
      raise exception using errcode = '22023', message = 'no_account';
    end if;
    if not coalesce(v_proven, false) then
      raise exception using errcode = '22023', message = 'not_proven';
    end if;
    if v_ucreated > v_icreated then
      raise exception using errcode = '22023', message = 'claimant_changed';
    end if;
    if v_pstatus = 'suspended' then
      raise exception using errcode = '22023', message = 'account_suspended';
    end if;
    if v_hidden then
      raise exception using errcode = '22023', message = 'org_not_listed';
    end if;
    if v_ostatus is distinct from 'verified' then
      raise exception using errcode = '22023', message = 'org_not_verified';
    end if;
    if v_oowner is not null
       or exists (select 1 from public.organization_members m where m.organization_id = v_org and m.role = 'owner') then
      raise exception using errcode = '22023', message = 'org_has_owner';
    end if;
    if exists (select 1 from public.organization_members m where m.organization_id = v_org and m.user_id = v_user) then
      update public.organization_members m set role = 'owner' where m.organization_id = v_org and m.user_id = v_user;
    else
      insert into public.organization_members (organization_id, user_id, role) values (v_org, v_user, 'owner');
    end if;
    update public.organizations o set owner_user_id = v_user where o.id = v_org;
    update public.organization_invitations i set status = 'accepted' where i.id = p_invitation_id;
    if v_ppersona not in ('admin', 'moderator') then
      v_display := public.review_display_persona(v_user, v_org);
      -- Before the rights switch, never a demotion to individual (an untyped company).
      v_persona := case when v_display = 'individual' and not public.review_flag('capabilities_enforced')
                        then v_ppersona else v_display end;
      update public.profiles
         set access_status = 'verified', onboarding_status = 'completed', rejection_reason = null,
             persona = v_persona::public.persona_enum
       where user_id = v_user;
      perform public.review_skip_under_review_mail(v_user);
    end if;
    perform public.log_org_event(v_org, 'ownership_claim_approved', jsonb_build_object('user_id', v_user, 'invitation_id', p_invitation_id));
    v_kind := 'claim_approved';
  else
    update public.organization_invitations i set status = 'rejected' where i.id = p_invitation_id;
    v_kind := 'claim_declined';
  end if;

  select count(*)::integer into v_others from public.organization_invitations i
   where i.organization_id = v_org and i.status = 'claim_requested' and i.id <> p_invitation_id;
  insert into public.review_log (subject_type, subject_id, action, note, details, actor_id)
  values ('claim', p_invitation_id, v_kind, v_note,
          jsonb_strip_nulls(jsonb_build_object('organization_id', v_org, 'user_id', v_user, 'code_matched', v_code,
                                               'claimant', v_claimant, 'persona', v_persona, 'persona_before', v_ppersona,
                                               'other_open_claims', v_others)),
          auth.uid())
  returning id into v_log;
  -- Only the claimant hears of it (never a later account that took over the address).
  if v_claimant then
    insert into public.notification_outbox (kind, user_id, actor_id, subject_id, dedupe_key, data)
    values (v_kind, v_user, auth.uid(), p_invitation_id, v_kind || ':' || p_invitation_id,
            jsonb_strip_nulls(jsonb_build_object('first_name', nullif(btrim(coalesce(v_first, '')), ''),
                                                 'org_name', v_oname, 'organization_id', v_org, 'invitation_id', p_invitation_id)))
    on conflict (dedupe_key) do nothing
    returning id into v_outbox;
  end if;
  return jsonb_strip_nulls(jsonb_build_object('ok', true, 'decision', case when p_approve then 'approved' else 'declined' end,
    'invitation_id', p_invitation_id, 'organization_id', v_org, 'user_id', v_user, 'claimant', v_claimant,
    'persona', v_persona, 'other_open_claims', v_others, 'review_log_id', v_log, 'outbox_id', v_outbox));
end
$function$;

-- Team joins tab: remove someone who joined a company through an invitation or a join
-- request (FYI rows). An owner is never removed here. reset_person: a verified person goes
-- back to M3's review (pending, submitted), when the join was what verified them. A persona
-- that came from that company follows the person's other validated company (or, once the
-- rights switch is on, becomes individual): never a company type with no company behind it,
-- and never a demotion before the switch (same rule as admin_validate_person).
create or replace function public.admin_revoke_team_join(p_member_id uuid, p_reset_person boolean default false,
                                                         p_note text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_org uuid;
  v_user uuid;
  v_role text;
  v_otype text;
  v_persona_old text;
  v_display text;
  v_persona text;
  v_reset integer := 0;
  v_log bigint;
begin
  if not coalesce(public.is_admin(), false) then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;
  select m.organization_id, m.user_id, m.role into v_org, v_user, v_role
    from public.organization_members m where m.id = p_member_id
     for update;
  if not found then
    raise exception using errcode = '22023', message = 'member_not_found';
  end if;
  if v_role = 'owner' then
    raise exception using errcode = '22023', message = 'owner_not_removable';
  end if;
  select o.organization_type into v_otype from public.organizations o where o.id = v_org;
  select pr.persona::text into v_persona_old from public.profiles pr where pr.user_id = v_user for update;
  delete from public.organization_members m where m.id = p_member_id;
  if v_otype is not null and v_persona_old = v_otype then
    v_display := public.review_display_persona(v_user, null);
    if v_display <> v_persona_old and (v_display <> 'individual' or public.review_flag('capabilities_enforced')) then
      update public.profiles pr set persona = v_display::public.persona_enum where pr.user_id = v_user;
      v_persona := v_display;
    end if;
  end if;
  if coalesce(p_reset_person, false) then
    update public.profiles pr set access_status = 'pending', onboarding_status = 'submitted'
     where pr.user_id = v_user and pr.access_status = 'verified' and pr.persona not in ('admin', 'moderator');
    get diagnostics v_reset = row_count;
  end if;
  insert into public.review_log (subject_type, subject_id, action, note, details, actor_id)
  values ('join', p_member_id, 'join_revoked', nullif(left(btrim(coalesce(p_note, '')), 4000), ''),
          jsonb_strip_nulls(jsonb_build_object('organization_id', v_org, 'user_id', v_user, 'person_reset', v_reset > 0,
                                               'persona_before', case when v_persona is not null then v_persona_old end,
                                               'persona', v_persona)), auth.uid())
  returning id into v_log;
  return jsonb_strip_nulls(jsonb_build_object('ok', true, 'organization_id', v_org, 'user_id', v_user, 'person_reset', v_reset > 0,
                                              'persona', coalesce(v_persona, v_persona_old), 'persona_changed', v_persona is not null,
                                              'review_log_id', v_log));
end
$function$;

-- Cards that need no change, only "seen": team_join (FYI; id = organization_members.id),
-- join_request (FYI, the owner decides; id = organization_invitations.id),
-- retro (Q6 list; id = user id: "keep as is"), duplicate_org / duplicate_person ("not a
-- duplicate"; id and other_id = the two companies or the two accounts).
create or replace function public.admin_review_dismiss(p_kind text, p_id uuid, p_other_id uuid default null,
                                                       p_note text default null)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_log bigint;
  v_note text := nullif(left(btrim(coalesce(p_note, '')), 4000), '');
begin
  if not coalesce(public.is_admin(), false) then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;
  if p_id is null then
    raise exception using errcode = '22023', message = 'bad_input';
  end if;
  if p_kind in ('team_join', 'join_request') then
    insert into public.review_log (subject_type, subject_id, action, note, actor_id)
    values ('join', p_id, 'fyi_seen', v_note, auth.uid()) returning id into v_log;
  elsif p_kind = 'retro' then
    insert into public.review_log (subject_type, subject_id, action, note, actor_id)
    values ('person', p_id, 'retro_kept', v_note, auth.uid()) returning id into v_log;
  elsif p_kind in ('duplicate_org', 'duplicate_person') then
    if p_other_id is null or p_other_id = p_id then
      raise exception using errcode = '22023', message = 'other_id_required';
    end if;
    insert into public.review_log (subject_type, subject_id, action, note, details, actor_id)
    values ('merge', least(p_id, p_other_id), 'not_duplicate', v_note,
            jsonb_build_object('other_id', greatest(p_id, p_other_id), 'kind', p_kind), auth.uid())
    returning id into v_log;
  else
    raise exception using errcode = '22023', message = 'bad_kind';
  end if;
  return v_log;
end
$function$;

revoke all on function public.review_flag(text) from public, anon, authenticated, service_role;
revoke all on function public.review_display_persona(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.review_skip_under_review_mail(uuid) from public, anon, authenticated, service_role;
revoke all on function public.admin_validate_person(uuid, jsonb) from public, anon;
grant execute on function public.admin_validate_person(uuid, jsonb) to authenticated;
revoke all on function public.admin_decide_claim(uuid, boolean, text) from public, anon;
grant execute on function public.admin_decide_claim(uuid, boolean, text) to authenticated;
revoke all on function public.admin_revoke_team_join(uuid, boolean, text) from public, anon;
grant execute on function public.admin_revoke_team_join(uuid, boolean, text) to authenticated;
revoke all on function public.admin_review_dismiss(text, uuid, uuid, text) from public, anon;
grant execute on function public.admin_review_dismiss(text, uuid, uuid, text) to authenticated;

comment on function public.admin_validate_person(uuid, jsonb) is 'Phase 3 (spec §4.6): {action: validate|participant|reject|ask, reason, notify (absent: queued when review_queue is on, else notify_by_client; ask always queued), org: {mode: none|link|create, org_id, type, name, website, country, as_owner, force_new}}. Verified admins only. One review_log row, at most one notification_outbox e-mail. See contract §11.2.';
comment on function public.admin_decide_claim(uuid, boolean, text) is 'Phase 3 (Q3): approve or decline a claim_requested row. Approve needs a verified, listed company with no owner and the claimant (the account with that login address, proven, older than the claim): the person becomes its owner and is verified. Verified admins only.';
comment on function public.admin_revoke_team_join(uuid, boolean, text) is 'Phase 3: remove a collaborator who joined through an invitation or a join request (Team joins tab); optionally send a verified person back to review; a persona that came from that company follows their other validated company (individual only once capabilities_enforced is on). Verified admins only.';
comment on function public.admin_review_dismiss(text, uuid, uuid, text) is 'Phase 3: mark a queue card seen without change: team_join or join_request (fyi_seen), retro (retro_kept), duplicate_org / duplicate_person (not_duplicate). Verified admins only.';

-- ─── C. Test helpers (temporary, gone with the rollback) ───────────────────────
-- An account: the auth.users row (handle_new_user makes the profile), then status, persona, proof.
create function pg_temp.dr_user(p_id uuid, p_email text, p_meta jsonb, p_proven boolean, p_status text, p_persona text)
returns void language plpgsql as $f$
begin
  insert into auth.users (id, email, aud, role, raw_user_meta_data, email_confirmed_at, created_at, updated_at)
  values (p_id, p_email, 'authenticated', 'authenticated', p_meta, now(), now(), now());
  update public.profiles
     set email_proven_at = case when p_proven then now() end,
         access_status = p_status::public.access_status_enum,
         persona = p_persona::public.persona_enum,
         onboarding_status = (case when p_status = 'verified' then 'completed' else 'submitted' end)::public.onboarding_status_enum
   where user_id = p_id;
end
$f$;
-- A company (and its owner member when given).
create function pg_temp.dr_org(p_id uuid, p_name text, p_status text, p_type text, p_owner uuid, p_site text)
returns void language plpgsql as $f$
begin
  insert into public.organizations (id, name, slug, access_status, onboarding_status, organization_type, owner_user_id, created_by_user_id, website)
  values (p_id, p_name, 'dryrun-' || p_id, p_status, case when p_status = 'verified' then 'completed' else 'submitted' end,
          p_type, p_owner, p_owner, p_site);
  if p_owner is not null then
    insert into public.organization_members (organization_id, user_id, role) values (p_id, p_owner, 'owner');
  end if;
end
$f$;

-- ─── D. Cases ───────────────────────────────────────────────────────────────────
do $dryrun$
declare
  tests jsonb := '[]'::jsonb;
  t jsonb;
  kv record;
  vars jsonb;
  s0 text;
  v_q text; v_setup text; v_chkq text; v_exp text;
  v_uid uuid; v_dml boolean; v_ret text; v_n bigint;
  v_err text; v_state text; v_chk boolean; v_pass boolean;
  n_pass integer := 0; n_fail integer := 0;
  results text := '';
  r8 text := substr(md5(random()::text), 1, 8);
begin
  vars := jsonb_build_object(
    'admin', gen_random_uuid(), 'owner', gen_random_uuid(), 'p1', gen_random_uuid(), 'p2', gen_random_uuid(),
    'e_admin', 'dryrun-admin-' || r8 || '@example.invalid', 'e_owner', 'dryrun-owner-' || r8 || '@example.invalid',
    'e_p1', 'pat@dryrun-p1-' || r8 || '.example', 'e_p2', 'sam@dryrun-p2-' || r8 || '.example',
    'dom_p1', 'dryrun-p1-' || r8 || '.example', 'site_p1', 'https://www.dryrun-p1-' || r8 || '.example/en',
    'site_p2', 'https://dryrun-p2-' || r8 || '.example', 'site_x', 'https://other-' || r8 || '.example', 'r8', r8,
    'org_v', gen_random_uuid(), 'org_n', gen_random_uuid(), 'org_p', gen_random_uuid(), 'org_q', gen_random_uuid(),
    'name_v', 'Dryrun Zebramarina ' || r8, 'newco', 'Dryrun New Co ' || r8, 'inv', gen_random_uuid(), 'mem', gen_random_uuid());
  -- Every case: an admin, a verified owner of a verified marina, two pending people (p1 proven,
  -- p2 not), a verified company with no owner, p1's own pending company (untyped, old wizard),
  -- a pending company with no owner, and p1's unsent "account under review" e-mail.
  s0 := $s$select pg_temp.dr_user({admin}, {e_admin}, '{}', true, 'verified', 'admin');
select pg_temp.dr_user({owner}, {e_owner}, '{"first_name": "Olive", "last_name": "Owner"}', true, 'verified', 'marina');
select pg_temp.dr_user({p1}, {e_p1}, '{"first_name": "Pat", "last_name": "Dryrun"}', true, 'pending', 'individual');
select pg_temp.dr_user({p2}, {e_p2}, '{"first_name": "Sam", "last_name": "Dryrun"}', false, 'pending', 'individual');
select pg_temp.dr_org({org_v}, {name_v}, 'verified', 'marina', {owner}, null);
select pg_temp.dr_org({org_n}, 'Dryrun Ownerless Yard ' || {r8}, 'verified', 'marina', null, null);
select pg_temp.dr_org({org_p}, 'Dryrun Pat Wizard Co ' || {r8}, 'pending', null, {p1}, null);
select pg_temp.dr_org({org_q}, 'Dryrun Pending Ownerless ' || {r8}, 'pending', 'partner', null, null);
insert into public.notification_outbox (kind, user_id, actor_id, subject_id, dedupe_key, data)
values ('account_under_review', {p1}, {p1}, {p1}, 'account_under_review:' || {p1}, '{}')$s$;
  tests := jsonb_build_array(
    jsonb_build_object('id', 'V07', 'who', 'admin', 'expect', 'ret:none', 'label', 'create for an UNPROVEN address: no primary_domain',
      'q', $q$select coalesce(public.admin_validate_person({p2}, jsonb_build_object('action', 'validate', 'org', jsonb_build_object('mode', 'create', 'type', 'marina', 'name', {newco}, 'website', {site_p2}))) ->> 'primary_domain', 'none')$q$),
    jsonb_build_object('id', 'V08', 'who', 'admin', 'expect', 'ret:none', 'label', 'create with a website on another domain: no primary_domain',
      'q', $q$select coalesce(public.admin_validate_person({p1}, jsonb_build_object('action', 'validate', 'org', jsonb_build_object('mode', 'create', 'type', 'marina', 'name', {newco}, 'website', {site_x}))) ->> 'primary_domain', 'none')$q$),
    jsonb_build_object('id', 'V16', 'who', 'admin', 'expect', 'ret:rejected/1', 'label', 'Not accepted: the person and their own pending company, the reason in the e-mail',
      'q', $q$select (r ->> 'access_status') || '/' || (r ->> 'companies_rejected') from (select public.admin_validate_person({p1}, '{"action": "reject", "reason": "Dry run reason", "notify": true}') as r) x$q$,
      'chk', $c$select (select access_status::text = 'rejected' and rejection_reason = 'Dry run reason' from public.profiles where user_id = {p1})
        and (select access_status = 'rejected' from public.organizations where id = {org_p})
        and (select data ->> 'reason' = 'Dry run reason' from public.notification_outbox where user_id = {p1} and kind = 'user_account_rejected')$c$),
    jsonb_build_object('id', 'V17', 'who', 'admin', 'expect', 'ret:pending', 'label', 'Ask for a detail: still pending, the question e-mailed, logged',
      'q', $q$select public.admin_validate_person({p2}, '{"action": "ask", "reason": "Which company?"}') ->> 'access_status'$q$,
      'chk', $c$select (select access_status::text = 'pending' from public.profiles where user_id = {p2}) and exists (select 1 from public.review_log where subject_id = {p2} and action = 'info_requested')
        and (select data ->> 'question' = 'Which company?' from public.notification_outbox where user_id = {p2} and kind = 'account_info_requested')$c$),
    jsonb_build_object('id', 'V18', 'who', 'admin', 'expect', 'err:not_pending', 'label', 'no question to a verified person',
      'q', $q$select public.admin_validate_person({owner}, '{"action": "ask", "reason": "x"}')::text$q$),
    jsonb_build_object('id', 'V19', 'who', 'admin', 'expect', 'ret:verified', 'label', 'notify false: no e-mail queued',
      'q', $q$select public.admin_validate_person({p2}, '{"action": "validate", "notify": false}') ->> 'access_status'$q$,
      'chk', $c$select not exists (select 1 from public.notification_outbox where user_id = {p2})$c$),
    jsonb_build_object('id', 'V20', 'who', 'admin', 'expect', 'ret:true', 'label', 'validate again with nothing new (notify true): logged, no second e-mail',
      'q', $q$select public.admin_validate_person({owner}, '{"action": "validate", "notify": true}') ->> 'unchanged'$q$,
      'chk', $c$select exists (select 1 from public.review_log where subject_id = {owner} and action = 'validated') and not exists (select 1 from public.notification_outbox where user_id = {owner})$c$),
    jsonb_build_object('id', 'V21', 'who', 'admin', 'expect', 'err:org_needs_validate', 'label', 'a company only with Validate',
      'q', $q$select public.admin_validate_person({p1}, jsonb_build_object('action', 'participant', 'org', jsonb_build_object('mode', 'link', 'org_id', {org_v})))::text$q$),
    jsonb_build_object('id', 'V22', 'who', 'admin', 'expect', 'err:bad_type', 'label', 'company types only',
      'q', $q$select public.admin_validate_person({p1}, '{"action": "validate", "org": {"mode": "create", "name": "x", "type": "admin"}}')::text$q$),
    jsonb_build_object('id', 'V32', 'who', 'admin', 'expect', 'ret:partner/true/true', 'label', 'validate with no company step before the rights switch: a partner persona with no company is KEPT (no demotion); flags off: the page sends the e-mail',
      'setup', $s$update public.profiles set persona = 'partner' where user_id = {p2};
update public.platform_settings set value = value || '{"capabilities_enforced": false, "review_queue": false}'::jsonb where key = 'registration_flags'$s$,
      'q', $q$select (r ->> 'persona') || '/' || (r ->> 'persona_kept') || '/' || (r ->> 'notify_by_client') from (select public.admin_validate_person({p2}, '{"action": "validate", "org": {"mode": "none"}}') as r) x$q$,
      'chk', $c$select (select persona::text = 'partner' and access_status::text = 'verified' from public.profiles where user_id = {p2}) and not exists (select 1 from public.notification_outbox where user_id = {p2})$c$),
    jsonb_build_object('id', 'V33', 'who', 'admin', 'expect', 'ret:individual', 'label', 'once the rights switch is on: no validated company = individual (display persona)',
      'setup', $s$update public.profiles set persona = 'partner' where user_id = {p2};
update public.platform_settings set value = value || '{"capabilities_enforced": true}'::jsonb where key = 'registration_flags'$s$,
      'q', $q$select public.admin_validate_person({p2}, '{"action": "validate", "org": {"mode": "none"}}') ->> 'persona'$q$),
    jsonb_build_object('id', 'V34', 'who', 'admin', 'expect', 'ret:individual/true', 'label', 'retro-review validate of a verified person whose persona differs: persona kept before the switch, no "approved" e-mail',
      'setup', $s$update public.profiles set persona = 'individual' where user_id = {owner};
update public.platform_settings set value = value || '{"capabilities_enforced": false}'::jsonb where key = 'registration_flags'$s$,
      'q', $q$select (r ->> 'persona') || '/' || (r ->> 'unchanged') from (select public.admin_validate_person({owner}, '{"action": "validate", "notify": true}') as r) x$q$,
      'chk', $c$select (select persona::text = 'individual' from public.profiles where user_id = {owner}) and not exists (select 1 from public.notification_outbox where user_id = {owner})$c$),
    jsonb_build_object('id', 'V35', 'who', 'admin', 'expect', 'ret:false/true', 'label', 'Not accepted twice with the same reason (double click): one e-mail',
      'q', $q$select string_agg(public.admin_validate_person({p1}, '{"action": "reject", "reason": "Twice", "notify": true}') ->> 'unchanged', '/') from generate_series(1, 2)$q$,
      'chk', $c$select count(*) = 1 from public.notification_outbox where user_id = {p1} and kind = 'user_account_rejected'$c$),
    jsonb_build_object('id', 'V36', 'who', 'admin', 'expect', 'ret:false/true', 'label', 'the same question twice: one e-mail',
      'q', $q$select string_agg(public.admin_validate_person({p2}, '{"action": "ask", "reason": "Which company?"}') ->> 'unchanged', '/') from generate_series(1, 2)$q$,
      'chk', $c$select count(*) = 1 from public.notification_outbox where user_id = {p2} and kind = 'account_info_requested'$c$)
  );

  -- Runner: setup s0 + setup (postgres), q as the caller (an expected error is caught around q
  -- only, so chk still runs), chk (postgres), all rolled back. {x} = quoted vars.x; <x> = raw.
  for t in select * from jsonb_array_elements(tests) loop
    v_q := t ->> 'q'; v_setup := coalesce(t ->> 'setup', ''); v_chkq := coalesce(t ->> 'chk', ''); v_exp := t ->> 'expect';
    if not coalesce((t ->> 'bare')::boolean, false) then v_setup := s0 || ';' || v_setup; end if;
    for kv in select * from jsonb_each_text(vars) loop
      v_q := replace(v_q, '{' || kv.key || '}', quote_literal(kv.value));
      v_setup := replace(v_setup, '{' || kv.key || '}', quote_literal(kv.value));
      v_chkq := replace(v_chkq, '{' || kv.key || '}', quote_literal(kv.value));
      v_exp := replace(v_exp, '<' || kv.key || '>', kv.value);
    end loop;
    v_dml := lower(left(ltrim(v_q), 6)) in ('insert', 'update', 'delete');
    v_ret := null; v_n := null; v_err := null; v_state := null; v_chk := null;
    begin
      perform set_config('request.jwt.claims', '', true);
      perform set_config('request.jwt.claim.sub', '', true);
      perform set_config('request.jwt.claim.role', '', true);
      if btrim(v_setup, ' ;') <> '' then execute v_setup; end if;
      if t ->> 'who' = 'postgres' then
        null;
      elsif t ->> 'who' like 'jwt:%' then
        perform set_config('request.jwt.claims', jsonb_build_object('sub', vars ->> substr(t ->> 'who', 5), 'role', 'authenticated')::text, true);
      elsif t ->> 'who' = 'anon' then
        perform set_config('request.jwt.claims', '{"role": "anon"}', true);
        set local role anon;
      elsif t ->> 'who' = 'service' then
        perform set_config('request.jwt.claims', '{"role": "service_role"}', true);
        set local role service_role;
      else
        v_uid := (vars ->> (t ->> 'who'))::uuid;
        perform set_config('request.jwt.claims', jsonb_build_object('sub', v_uid, 'role', 'authenticated',
          'email', (select u.email from auth.users u where u.id = v_uid))::text, true);
        set local role authenticated;
      end if;
      begin
        if v_dml then
          execute v_q;
          get diagnostics v_n = row_count;
        else
          execute v_q into v_ret;
        end if;
      exception when others then
        if v_exp like 'err:%' or v_exp = 'rls' then v_err := sqlerrm; v_state := sqlstate; else raise; end if;
      end;
      reset role;
      perform set_config('request.jwt.claims', '', true);
      if v_chkq <> '' then execute v_chkq into v_chk; end if;
      raise exception using errcode = 'DRY01', message = 'case finished';
    exception
      when sqlstate 'DRY01' then null;
      when others then v_err := coalesce(v_err, sqlerrm); v_state := coalesce(v_state, sqlstate);
    end;
    v_pass := coalesce(case
                when v_exp = 'allow' then v_err is null and (not v_dml or v_n > 0)
                when v_exp = 'rls' then v_state = '42501' or (v_err is null and v_dml and v_n = 0)
                when v_exp like 'err:%' then strpos(v_err, substr(v_exp, 5)) > 0
                when v_exp like 'ret:%' then v_err is null and v_ret is not distinct from substr(v_exp, 5)
              end, false)
              and (v_chkq = '' or v_chk is true);
    if v_pass then n_pass := n_pass + 1; else n_fail := n_fail + 1; end if;
    results := results || format(E'\n%s %s %s: %s | expect %s | %s%s',
      case when v_pass then 'PASS' else 'FAIL' end, t ->> 'id', t ->> 'who', t ->> 'label', v_exp,
      left(case when v_err is not null then format('error %s: %s', v_state, v_err)
                when v_dml then v_n || ' row(s) written'
                else 'returned ' || coalesce(v_ret, 'null') end, 300),
      case when v_chkq <> '' then ' | chk ' || coalesce(v_chk::text, 'null') else '' end);
  end loop;

  raise exception 'DRYRUN %', format('%s PASS, %s FAIL (review_and_validation_people dry run 3, run %s)', n_pass, n_fail, now()) || results;
end
$dryrun$;
