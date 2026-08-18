# Prompt d'implémentation — Refonte du profil Media (M3 Connect)

> À coller dans une session Claude Code ouverte sur le repo `M3_Connect`.
> Ce document est **autonome** : il contient tout le contexte nécessaire.
> Ne rien construire en local (Dropbox → EPERM) : push GitHub, Netlify build.
> Les edge functions se déploient manuellement (Dashboard Supabase ou `supabase functions deploy`).

---

## 0. Contexte projet

- **App** : Smart Marina Connect — plateforme B2B de l'industrie des marinas (M3 Monaco). React 18 + TS + Vite, Tailwind + Radix/shadcn, Supabase (Postgres + RLS + Edge Functions Deno), Resend pour l'email, Netlify (SPA).
- **Supabase project id** : `djjbgzasuomhyfvtlidi`
- **Événement pilote** : `sm_event` slug `sm26`, id `c43ecba2-02d0-49f3-8e7d-36e44be2b551` (Smart & Sustainable Marina Rendezvous 2026).
- **Toutes les tables ont RLS activé** : toute nouvelle table nécessite ses policies.
- **Bucket storage** : `event-media` (fichiers événement, accès via signed URLs).
- **Personas** : `marina`, `partner`, `media_partner`, `investor`, `individual`, `developer`, `moderator`, `admin`. Un user peut appartenir à plusieurs organisations.

### Le problème à résoudre
Il existe aujourd'hui **deux notions de « media » non reliées** :
1. **Persona plateforme `media_partner`** — identité permanente. Tables : `profiles.persona`, `media_partner_profiles` (user_id, media_name, website, audience_description, logo_url, social_media_links), org de type `media_partner`. **Actuellement 0 user, 0 org, 0 profil.**
2. **Rôle événement SM26 `media`** — accréditation presse. Table `sm_role_assignment.role='media'` sur une `sm_registration`. Collecte déjà `outlet` (obligatoire) + `press_card` (fichier obligatoire) + photo. **1 inscrit actuel** : The Superyacht Group / Martin Redmayne (`martin@thesuperyachtgroup.com`), statut rôle `self_submitted`.

**But de la refonte** : unifier les deux, donner un vrai espace media, et brancher la validation sur la console Yacht Club.

---

## 1. Décisions produit (FIGÉES — ne pas ré-arbitrer)

| Sujet | Décision |
|---|---|
| Entrée media | Via SM (rôle `media`) **ou** directement sur la plateforme |
| Structure du profil | **= organisation** `media_partner` ; les journalistes sont des membres de l'org |
| Validation via SM | **Le Yacht Club valide sur sa console** ; l'admin M3 est en **supervision + veto** |
| Validation directe | Admin M3 |
| Provision | Un media venu par la SM obtient **quand même** un profil plateforme (org media_partner) |
| Tag « media partner » | **Coché par l'admin uniquement** → pose un tag sur l'org → l'org apparaît dans la **page partenaires** |
| Annuaire | Le profil media est **public** (annuaire presse dans `/partners`) |
| Téléchargement d'articles | **PDF généré à la volée** depuis le contenu de l'article + **log** (qui / quoi / quand), visible admin |
| Photos & press releases | **Par événement, 2 modes** : SM (géré par YC) = **lien externe** vers le site du YC ; nos autres événements = **fichiers hébergés** sur la plateforme, avec suivi de téléchargement |
| Accès aux ressources presse | **Tout media** connecté de la plateforme (pas cloisonné par événement) |
| Retombées presse (« coverage ») | **Dès la v1** ; le media déclare ses publications (lien, média, date). Si la retombée est liée à un `sm_event`, **le Yacht Club doit la voir aussi** |
| Socle des futurs événements | **Réutiliser le framework Smart Marina** (`sm_event`) pour tous nos événements → un seul module presse partout |

---

## 2. Modèle de données

### Nouvelles tables

**`organization_media_details`** — l'identité « média » au niveau org (le nom/logo/site vivent déjà sur `organizations`).
- `organization_id uuid PK REFERENCES organizations(id) ON DELETE CASCADE`
- `audience_description text`, `editorial_focus text`, `reach text` (tirage/audience), `press_contact_email text`
- `social_media_links jsonb` (linkedin, instagram, x…)
- `created_at`, `updated_at`
- RLS : lecture publique (annuaire) ; écriture = membres de l'org + admin.
- Note : `media_partner_profiles` (par user) reste la fiche **contact/journaliste** individuelle.

**`organizations.is_event_media_partner boolean DEFAULT false`** *(colonne ajoutée)* — le tag coché par l'admin. La page partenaires l'affiche comme badge « Media Partner ».

**`media_download_log`** — traçabilité.
- `id uuid PK`, `user_id uuid`, `organization_id uuid null`, `event_id uuid null` (→ `sm_event`)
- `resource_type text CHECK in ('article','press_release','photo_link')`
- `resource_id uuid null`, `resource_ref text null` (url ou storage_path), `label text`
- `created_at timestamptz default now()`
- RLS : INSERT via service role (edge function) ; SELECT = admin ; + YC pour les lignes dont `event_id` est un `sm_event` qu'il gère.

**`event_press_resource`** — ressources presse par événement, **gère les 2 modes**.
- `id uuid PK`, `event_id uuid REFERENCES sm_event(id)`
- `kind text CHECK in ('photos','press_release')`
- `mode text CHECK in ('link','hosted')`
- `url text null` (mode link) — `storage_path text null`, `filename text null`, `mime text null`, `size_bytes bigint null` (mode hosted)
- `title text`, `embargo_at timestamptz null` (diffusable à partir de…)
- `created_by uuid`, `created_at timestamptz default now()`
- RLS : SELECT = tout media connecté (persona `media_partner` OU membre d'une org media_partner) ; INSERT/UPDATE = admin, **et YC pour ses `sm_event`** (via RPC SECURITY DEFINER).

**`media_coverage`** — retombées presse.
- `id uuid PK`, `organization_id uuid`, `user_id uuid`, `event_id uuid null` (→ `sm_event`)
- `url text`, `outlet text`, `published_at date`, `title text`, `note text null`
- `created_at timestamptz default now()`
- RLS : le media insère/édite les siennes ; SELECT = auteur + admin + **YC quand `event_id` est un `sm_event` qu'il gère**.

### Réutilisation de l'existant (patterns à copier, NE PAS réinventer)
- **Fichiers hébergés + suivi** : `sm_media_kit` / `sm_media_kit_file` ont déjà `first_viewed_at` / `first_downloaded_at` → même patron pour le mode `hosted` et le log.
- **Store de fichiers org** : `organization_documents` (id, organization_id, uploaded_by, file_name, file_url, file_size, description).
- **Statuts de rôle** : `self_submitted → needs_info → info_provided → confirmed → declined`.

---

## 3. Provision & personas

- **Étendre `supabase/functions/sm26-provision/index.ts`** : quand la persona provisionnée est `media_partner`, après création/liaison de l'org, **remplir `organization_media_details`** à partir de l'inscription :
  - `audience_description`/`editorial_focus` ← champs `module_data` du rôle media si présents
  - `social_media_links` ← `module_data.social_links` (déjà structuré : linkedin, instagram)
  - `press_contact_email` ← email de l'inscription
  - `media_partner_profiles` (contact) ← nom, photo, outlet
- Le mapping rôle `media` → persona `media_partner` **existe déjà** dans `src/components/admin/SM26ProvisionDialog.tsx` (`suggestProvision`, ligne ~44). Ne pas le casser.
- **Le tag `is_event_media_partner` reste une action admin manuelle** (case à cocher), séparée de la provision.

---

## 4. Validation via la console Yacht Club

- **Qui est le YC** : lignes `sm_event_partner` avec `kind='yacht_club'` (2 comptes). Leur console = `src/pages/SM26PartnerPage.tsx`.
- **Aujourd'hui** : seul l'admin peut changer `sm_role_assignment.status` (`setRoleStatus`, `src/components/admin/AdminSM26Detail.tsx` ~ligne 490). Le YC ne peut PAS.
- **À faire** :
  1. RPC `SECURITY DEFINER` `sm_partner_set_media_status(p_role_assignment_id, p_status)` qui autorise un `sm_event_partner kind='yacht_club'` du bon `event_id` à passer un rôle **`media`** à `confirmed` / `declined` / `needs_info`. (Ne l'autoriser que pour le rôle media.)
  2. Dans `SM26PartnerPage.tsx`, un bloc **« Demandes presse »** listant les rôles `media` en `self_submitted` / `needs_info`, avec boutons Confirmer / Refuser / Demander infos.
  3. Deux champs par événement dans cette console : **lien photos** et **lien press releases** (écrit dans `event_press_resource` en `mode='link'`).
  4. L'admin garde la **supervision + veto** : la validation YC est visible dans `AdminSM26Detail`, et l'admin peut annuler (repasser `declined`/`needs_info`).
- Email : réutiliser `supabase/functions/sm26-email/index.ts` (ajouter des `kind` : `media_accredited`, `media_declined`, `press_material_available`).

---

## 5. Écrans

### Compte media (dans `/account`, réutiliser le patron d'onglets `?tab=`)
- **Profil média** : édition `organization_media_details` + logo/nom (org) + fiche contact.
- **Onglet Articles** : liste des `resources` (type `article`) → bouton « Télécharger le PDF » → **PDF généré** du `content` → écrit une ligne `media_download_log`.
- **Salle de presse** : par événement, affiche photos + press releases. Mode `link` → boutons vers l'URL ; mode `hosted` → fichiers via signed URL (log au téléchargement). Respecter `embargo_at`.
- **Mes retombées** : formulaire d'ajout `media_coverage` + liste.

### Admin
- Case **tag « Media partner »** sur la fiche org (`is_event_media_partner`).
- Supervision/veto des validations media (dans `AdminSM26Detail`).
- **Dashboard téléchargements** : lecture `media_download_log` (qui/quoi/quand, filtres par media/article/événement, « top articles »).
- Gestion des ressources presse **hébergées** (nos événements sans YC) : upload dans `event_press_resource` mode `hosted`.
- **Rapport de couverture** par événement (agrège `media_coverage`).

### Console YC (`SM26PartnerPage.tsx`)
- Bloc « Demandes presse » (cf. §4).
- Champs lien photos + lien press releases.
- Vue des retombées SM (`media_coverage` où `event_id` = son `sm_event`).

### Public
- `src/pages/PartnersPage.tsx` : faire apparaître les orgs `media_partner` (annuaire presse) + badge « Media Partner » si `is_event_media_partner`.

---

## 6. Edge functions

- **`sm26-provision`** (modifier) : remplir `organization_media_details` (cf. §3).
- **Génération PDF d'article** : au choix client-side (jsPDF/react-pdf) ou une petite edge function. Le log de téléchargement doit être écrit **côté serveur** (service role) pour être fiable → une function `media-article-pdf` (ou endpoint) qui rend le PDF ET insère `media_download_log` est le plus propre.
- **`sm26-email`** (modifier) : ajouter les `kind` presse.
- **Téléchargement de fichiers hébergés** : passer par une function qui délivre une signed URL **et** logue (comme le patron media kit).

---

## 7. Contrôle d'accès (RLS) — résumé

- `organization_media_details` : SELECT public ; write = membres org + admin.
- `event_press_resource` : SELECT = tout media connecté ; write = admin + YC (RPC) pour ses sm_event.
- `media_download_log` : INSERT = service role ; SELECT = admin (+ YC pour ses sm_event).
- `media_coverage` : write = auteur ; SELECT = auteur + admin + YC (pour ses sm_event).
- RPC `sm_partner_set_media_status` : réservé aux `sm_event_partner kind='yacht_club'`, rôle `media` uniquement.

---

## 8. Découpage — COMMENCER PAR LA PHASE 1

1. **Phase 1 — Profil & validation** : `organization_media_details`, tag `is_event_media_partner`, provision étendue, RPC + bloc « Demandes presse » YC, supervision admin, annuaire public. *→ Livrer et valider avant la suite.*
2. **Phase 2 — Articles** : PDF généré + `media_download_log` + dashboard admin.
3. **Phase 3 — Salle de presse & retombées** : `event_press_resource` (link/hosted), `media_coverage` (avec visibilité YC), rapport de couverture.

---

## 9. Critères d'acceptation (Phase 1)

- [ ] Un media inscrit via SM peut être **validé par le YC depuis sa console** ; le statut passe `confirmed` et un profil org `media_partner` existe.
- [ ] L'admin voit la validation et peut la **révoquer** (veto).
- [ ] La provision d'un media remplit `organization_media_details` (plus de fiche vide).
- [ ] L'admin peut **cocher le tag** ; l'org apparaît dans `/partners` avec le badge.
- [ ] Le profil media est **visible dans l'annuaire public**.
- [ ] Cas de test : **The Superyacht Group** (`martin@thesuperyachtgroup.com`), rôle media `self_submitted` → validé par YC → compte + profil OK.

---

## 10. Rappels techniques
- Ne PAS build en local. Commit → push `main` → Netlify build. Edge functions : déploiement manuel.
- Toute nouvelle table : migration SQL versionnée dans `supabase/migrations/` + policies RLS.
- Réutiliser les composants shadcn existants et les patrons SM26 (upload = `SM26AssetUpload`, signed URLs via `event-media`).
- Ne pas régresser le flux `pw_pending` / `AuthRedirector` / `/welcome` (comptes provisionnés).
