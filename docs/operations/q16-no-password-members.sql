-- Q16 (go-live runbook §1 "Auth sign-in methods", D5 row 4): the members who have signed in
-- but never with a password (e-mail code or link only, or no stored session left). Once
-- password_only_login is on they must click "Forgot password" once; the short notice
-- (preview: "Refonte - aperçus des e-mails/q16-password-notice.html") goes to this list,
-- with Victor's OK on the text and the list.
--
-- READ-ONLY. Run it in the SQL editor or with execute_sql; it writes nothing.
-- Staff (persona admin) are left out: they all sign in with a password (door phones).
-- auth.mfa_amr_claims keeps the sign-in method of every live session.

with pw as (
  select distinct s.user_id
    from auth.sessions s
    join auth.mfa_amr_claims c on c.session_id = s.id
   where c.authentication_method = 'password'
)
select p.first_name, p.last_name, u.email, u.last_sign_in_at::date as last_sign_in
  from auth.users u
  join public.profiles p on p.user_id = u.id
 where u.last_sign_in_at is not null
   and u.deleted_at is null
   and (u.banned_until is null or u.banned_until < now())
   and u.id not in (select user_id from pw)
   and p.persona::text <> 'admin'
 order by u.last_sign_in_at desc;

-- Count only. 21 Oct 2026: 45 (individual 21, partner 18, investor 3, marina 3; admin 0).
-- select count(*) from ( <the query above> ) q;
