# Intégration CRM ⇄ Smart Marina Connect — brief technique pour Codex

> **But** : connecter le CRM (projet Supabase séparé) à la plateforme **Smart Marina Connect**
> (projet Supabase `djjbgzasuomhyfvtlidi`) en **synchronisation bidirectionnelle temps réel**.
> Ce document décrit l'architecture des tables « utilisateurs/contacts/sociétés » de la plateforme,
> les clés de réconciliation, et l'architecture d'intégration recommandée.
>
> Généré le 2026-07-20 par introspection directe de la base. Vérifier avant de coder :
> les schémas évoluent.

---

## 0. Connexion à la plateforme

| | |
|---|---|
| Projet Supabase | `djjbgzasuomhyfvtlidi` |
| REST (PostgREST) | `https://djjbgzasuomhyfvtlidi.supabase.co/rest/v1/` |
| Edge Functions | `https://djjbgzasuomhyfvtlidi.supabase.co/functions/v1/` |
| Auth des emails | Table `auth.users` (l'email **fait foi** ici) ; `public.profiles.email` en est un **miroir** |

**Clés API** : à récupérer dans le dashboard Supabase → *Settings → API*. **Ne jamais mettre la
clé `service_role` côté client.** Le CRM parle à la plateforme uniquement **serveur-à-serveur**
(clé `service_role` ou, mieux, une Edge Function dédiée avec secret HMAC — voir §5).

> ⚠️ **PII.** `profiles`, `sm_registration` et `sm_attendee` contiennent des données personnelles
> (email, téléphone, adresse de facturation, n° TVA). La RLS de `profiles` ne laisse un compte lire
> **que sa propre ligne** ; l'anon key ne voit donc rien d'utile → toute lecture CRM doit passer par
> le `service_role` **côté serveur**. Ne pas ré-ouvrir de surface d'énumération publique.

---

## 1. Les deux notions de « contact »

Point crucial pour la réconciliation : sur la plateforme, **une personne peut exister sans compte**.

1. **`profiles`** — les personnes qui **ont créé un compte** (74 lignes). Clé = `user_id` (= `auth.users.id`).
2. **`sm_registration`** — les **inscrits à l'événement** (55 lignes) ; **beaucoup n'ont pas de compte**
   (import Jotform). C'est souvent la source la plus riche pour un CRM (téléphone, société, TVA, adresse…).
   `user_id` et `organization_id` sont **nullables** — un inscrit peut n'être rattaché ni à un compte ni à une société.

Un même individu peut donc apparaître dans les deux, ou dans une seule. **L'email (en minuscules) est la
clé de rapprochement pivot.**

---

## 2. Schéma des tables (source de vérité pour le mapping)

### 2.1 `profiles` — personnes avec compte
Clé primaire : **`user_id`** (uuid, FK → `auth.users.id`, `ON DELETE CASCADE`).

| Colonne | Type | Null | Notes |
|---|---|---|---|
| `user_id` | uuid | non | PK. = `auth.users.id`. |
| `first_name` | text | oui | |
| `last_name` | text | oui | |
| `email` | text | oui | **Miroir** de `auth.users.email`. Pas d'unique côté profiles. |
| `job_title` | text | oui | |
| `avatar_url` | text | oui | |
| `persona` | enum | non | voir §3. Rôle métier de la personne. |
| `access_status` | enum | non | `pending`/`verified`/`rejected`/`suspended`/`payment_pending`. |
| `onboarding_status` | enum | non | `draft`/`submitted`/`under_review`/`completed`. |
| `rejection_reason` | text | oui | |
| `notification_prefs` | jsonb | non | `{}` par défaut. |
| `created_at` / `updated_at` | timestamptz | non | `now()`. Pour la synchro incrémentale. |

> ⚠️ Pas de colonne `phone` ni `company` ici — pour ça, voir `sm_registration` / `organizations`.

### 2.2 `sm_registration` — inscrits événement (la « mine » CRM)
Clé primaire : **`id`** (uuid).

| Colonne | Type | Null | Notes |
|---|---|---|---|
| `id` | uuid | non | PK. |
| `event_id` | uuid | non | FK → `sm_event.id`. Événement (SM26 = `c43ecba2-02d0-49f3-8e7d-36e44be2b551`). |
| `user_id` | uuid | oui | FK → `auth.users` (`SET NULL`). **NULL si pas de compte.** |
| `organization_id` | uuid | oui | FK → `organizations` (`SET NULL`). |
| `first_name`, `last_name` | text | oui | |
| `email` | text | oui | Texte libre (pas garanti = un compte). |
| `phone` | text | oui | |
| `company_name` | text | oui | Texte libre (peut différer de `organizations.name`). |
| `website` | text | oui | |
| `country` | text | oui | |
| `job_title` | text | oui | |
| `billing_address` | text | oui | |
| `vat_number` | text | oui | |
| `num_attendees` | int | oui | |
| `objective` | text | oui | Objectif de participation. |
| `how_heard` | text | oui | Canal d'acquisition — **utile CRM**. |
| `prior_participation` | jsonb | oui | `{participated, events}`. |
| `image_consent` | bool | non | Consentement image. |
| `terms_accepted_at` | timestamptz | oui | |
| `status` | text | non | `under_review` / `confirmed` / `cancelled` (+ `draft`, `declined`, `waitlist` possibles). |
| `source` | text | non | `self` / `jotform_import` / `event_registration_migration`. |
| `claim_code` | text | oui | Code de réclamation de compte. |
| `requested_fields` | text[] | non | Champs demandés par M3. |
| `info_request_note` | text | oui | |
| `attendees_confirmed_at` | timestamptz | oui | |
| `created_at` / `updated_at` | timestamptz | non | |

### 2.3 `organizations` — sociétés (223 lignes)
Clé primaire : **`id`** (uuid). ⚠️ ~164 sont des marinas **pré-créées jamais réclamées** (aucun membre).

| Colonne | Type | Null | Notes |
|---|---|---|---|
| `id` | uuid | non | PK. |
| `name` | text | non | |
| `slug` | text | non | **UNIQUE**. |
| `primary_domain` | text | oui | **UNIQUE** — excellent clé de rapprochement société. |
| `organization_type` | text | oui | `marina` / `partner` / `investor` / null. |
| `tier` | text | non | `member` (FK → `organization_tier_config`). |
| `country`, `city`, `headquarters_country` | text | oui | |
| `website` | text | oui | |
| `description`, `audience_description` | text | oui | |
| `logo_url`, `banner_url` | text | oui | |
| `social_media_links` | text | oui | |
| `owner_user_id` | uuid | oui | FK → `auth.users`. Propriétaire. |
| `created_by_user_id` | uuid | oui | FK → `auth.users`. |
| `claim_code` | text | oui | **UNIQUE**. |
| `auto_approve_domain_joins` | bool | non | |
| `access_status` | text | non | `pending`/`verified`/`rejected`/`suspended`. |
| `onboarding_status` | text | non | |
| `marina_subtype` | text | oui | |
| `investment_*` | (divers) | oui | Champs investisseur (`geographies` text[], `size_min/max` bigint, `hold_period`, `thesis`). |
| `featured_partner` | bool | non | |
| `gallery` | jsonb | non | `[]`. |
| `created_at` / `updated_at` | timestamptz | non | |

### 2.4 `organization_members` — lien personne ↔ société (67)
| Colonne | Type | Null | Notes |
|---|---|---|---|
| `id` | uuid | non | PK. |
| `organization_id` | uuid | non | FK → `organizations` (`CASCADE`). |
| `user_id` | uuid | non | FK → `profiles.user_id` / `auth.users`. |
| `role` | text | non | `owner` / `collaborator`. |
| `joined_at` | timestamptz | non | |

**UNIQUE `(user_id, organization_id)`** → un ON CONFLICT propre pour les upserts d'appartenance.

### 2.5 `sm_attendee` — accompagnants d'une inscription (44)
| Colonne | Type | Null | Notes |
|---|---|---|---|
| `id` | uuid | non | PK. |
| `registration_id` | uuid | non | FK → `sm_registration` (`CASCADE`). |
| `event_id` | uuid | non | FK → `sm_event`. |
| `first_name`, `last_name`, `email`, `job_title` | text | oui | |
| `user_id` | uuid | oui | Lié au compte si l'email correspond. |
| `is_primary` | bool | non | La personne = contact d'inscription. **UNIQUE partiel** `(registration_id) WHERE is_primary`. |
| `attending` | bool | non | |
| `dietary`, `accessibility` | text | oui | |
| `created_at` / `updated_at` | timestamptz | non | |

**UNIQUE `(registration_id, lower(email))`** (où email non null).

---

## 3. Énumérations (valeurs autorisées)

```
persona_enum            : marina | partner | media_partner | investor | developer | individual | moderator | admin
                          (en base aujourd'hui : marina, partner, investor, individual, admin)
access_status_enum      : pending | verified | rejected | suspended | payment_pending
onboarding_status_enum  : draft | submitted | under_review | completed

sm_registration.status  : draft | under_review | confirmed | cancelled | declined | waitlist   (texte libre, pas enum)
sm_registration.source  : self | jotform_import | event_registration_migration                 (texte libre)
organizations.type      : marina | partner | investor | (null)
organizations.tier      : member (+ innovation_partner/associate_partner/premium_* prévus, FK organization_tier_config)
member role             : owner | collaborator
```

---

## 4. Clés de réconciliation (à câbler dans le CRM)

| Entité CRM | Clé pivot plateforme | Clé secondaire | Contrainte unique existante |
|---|---|---|---|
| **Contact / personne** | `lower(email)` | `user_id` si compte | *aucune sur profiles.email* → dédupliquer côté CRM |
| **Société** | `organizations.primary_domain` | `lower(name)` | `slug` UNIQUE, `primary_domain` UNIQUE |
| **Inscription (lead)** | `sm_registration.id` | `lower(email)` + `event_id` | `(event_id, lower(email))` unique **seulement** pour `source='jotform_import'` |
| **Appartenance** | `(user_id, organization_id)` | — | UNIQUE |

**Recommandation forte** : ne pas rapprocher à la volée par email à chaque sync (fragile, homonymes,
emails partagés type `info@`). Ajouter un **identifiant externe stable** + une **table de correspondance**
(voir §6) pour un mapping 1-à-1 déterministe et éviter les doublons.

---

## 5. Architecture d'intégration : **bidirectionnelle, temps réel**

```
        ┌───────────────────────────┐            ┌───────────────────────────┐
        │  SMART MARINA CONNECT      │            │        VOTRE CRM          │
        │  (djjbgzasuomhyfvtlidi)    │            │   (autre projet Supabase) │
        └───────────────────────────┘            └───────────────────────────┘
   (A) Plateforme → CRM (push)                (B) CRM → Plateforme (push)
   Database Webhook sur INSERT/UPDATE          Webhook CRM  ──HTTPS+HMAC──►  Edge Function
   des tables contacts ──HTTPS+HMAC──►         `crm-inbound` (upsert service_role)
   Edge Function côté CRM (ou endpoint)
```

### (A) Plateforme → CRM (temps réel)
- Utiliser les **Database Webhooks** Supabase (extension `pg_net`) sur `INSERT`/`UPDATE` de
  `profiles`, `sm_registration`, `organizations`, `organization_members`, `sm_attendee`.
- Chaque webhook POST le `record` + `old_record` vers un endpoint du CRM.
- **Signer** le payload (HMAC SHA-256 avec un secret partagé) et le vérifier côté CRM.

### (B) CRM → Plateforme (temps réel)
- Le CRM appelle une **Edge Function dédiée** sur la plateforme, ex. `crm-inbound`, qui fait des
  `upsert` **service_role** (donc bypass RLS de façon contrôlée) plutôt que d'exposer PostgREST +
  service key directement. Avantages : validation, gate HMAC, versionnement, journalisation.
- Ne **jamais** écrire directement dans `auth.users` : passer par `supabase.auth.admin` si un compte
  doit être créé (cf. la fonction existante `sm26-attendee-invite`).

### 🔁 Prévention des boucles (obligatoire en bidirectionnel)
Sans garde, A→B→A→B… boucle à l'infini. Deux options, à combiner :
1. **Marquer l'origine de l'écriture.** Ajouter des colonnes `crm_synced_at` / `last_write_origin`
   (`'platform'|'crm'`). Le webhook (A) **ignore** les lignes dont `last_write_origin='crm'` et dont
   `updated_at ≈ crm_synced_at` ; symétriquement côté CRM.
2. **Idempotence + horodatage.** Chaque upsert porte un `source_updated_at` ; on n'applique que si plus
   récent (last-write-wins) → un écho n'a aucun effet car pas plus récent.

### ⚖️ Conflits (qui fait foi ?)
Décider par champ / par table quelle base est **maître** :
- Suggestion : **plateforme maître** pour l'identité de compte (`profiles`, `auth`), le statut
  d'inscription (`sm_registration.status`) et l'appartenance ; **CRM maître** pour les champs commerciaux
  (étape pipeline, notes, propriétaire commercial, tags). Documenter ce partage — c'est LA décision
  structurante.

---

## 6. DDL recommandé à ajouter sur la plateforme (à valider avec M3)

```sql
-- 1) Table de correspondance déterministe (évite le matching par email à chaque sync)
create table if not exists crm_link (
  id             uuid primary key default gen_random_uuid(),
  entity         text not null check (entity in ('profile','registration','organization','attendee')),
  platform_id    text not null,               -- user_id / sm_registration.id / organizations.id / sm_attendee.id
  crm_id         text not null,               -- identifiant chez vous
  last_origin    text not null default 'platform' check (last_origin in ('platform','crm')),
  synced_at      timestamptz not null default now(),
  unique (entity, platform_id),
  unique (entity, crm_id)
);

-- 2) S'assurer que updated_at bouge à chaque UPDATE (pour la sync incrémentale)
--    Vérifier d'abord si un trigger existe déjà ; sinon :
create or replace function set_updated_at() returns trigger
  language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
-- create trigger ... before update on <table> for each row execute function set_updated_at();
```

> Ces objets ne sont **pas encore créés** — c'est une proposition. Toute migration passe par M3
> (`apply_migration`) et est consignée dans `supabase/migrations/APPLIED_MIGRATIONS.md`.

---

## 7. Squelette Edge Function `crm-inbound` (CRM → plateforme)

```ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { autoRefreshToken: false, persistSession: false } });

Deno.serve(async (req) => {
  // 1) Gate HMAC : vérifier la signature du CRM (header x-crm-signature) avec un secret partagé
  // 2) const { entity, crm_id, data, source_updated_at } = await req.json();
  // 3) upsert idempotent, ex. pour une inscription :
  //    await db.from("sm_registration").upsert({ ...data }, { onConflict: "id" });
  //    puis crm_link (entity, platform_id, crm_id, last_origin='crm', synced_at=now())
  // 4) NE PAS ré-émettre de webbook pour cette ligne (last_origin='crm')
  return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
});
```

Modèle de référence dans le repo : `supabase/functions/sm26-attendee-invite/` (auth service_role,
CORS, gate, `auth.admin.createUser`).

---

## 8. Option MCP (quand est-ce pertinent ?)

Le **MCP** (Model Context Protocol) sert à donner à un **agent IA** (Codex, Claude…) un accès outillé
à un projet Supabase : lire le schéma, exécuter des requêtes, appliquer des migrations. Supabase
publie un serveur MCP officiel.

- ✅ **Idéal pour** : la **phase de réconciliation** (explorer les deux schémas, générer le mapping,
  écrire les migrations), et des **opérations ad hoc / assistées par IA**.
- ❌ **Pas adapté** comme mécanisme de **synchro de production continue** entre deux applications :
  pour ça, ce sont les **Database Webhooks + Edge Functions** (§5) qui sont fiables, idempotents,
  signés et journalisés.

→ **Recommandation** : MCP pour construire/valider l'intégration, **webhooks+edge functions** pour la
faire tourner.

---

## 9. Checklist de mise en œuvre (pour Codex)

- [ ] Récupérer les 2 jeux de clés API (dashboard Supabase des 2 projets), stocker en secrets serveur.
- [ ] **Décider la table de vérité par champ** (§5 « Conflits ») — c'est la première décision.
- [ ] Créer `crm_link` + colonnes de provenance (§6), via migration validée par M3.
- [ ] (A) Configurer les Database Webhooks plateforme → endpoint CRM (INSERT/UPDATE), signés HMAC.
- [ ] (B) Déployer `crm-inbound` (upsert service_role, idempotent, gate HMAC) côté plateforme.
- [ ] Implémenter la **prévention de boucle** (last_origin + source_updated_at) des deux côtés.
- [ ] Backfill initial : rapprocher l'existant (55 inscriptions, 74 profils, 223 sociétés) en peuplant `crm_link`.
- [ ] Tester : création, modification, suppression, écho (doit être un no-op), conflit simultané.
- [ ] Journaliser chaque sync (table `crm_sync_log`) pour l'audit / rejouer les échecs.

---

### Annexe — rappels sécurité récents (à ne pas casser)
- `profiles` : lecture **propre ligne / modérateurs** uniquement (anti-harvest email). Toute lecture CRM = `service_role` serveur.
- Bucket privé `event-media` : signature service-role (ne pas exposer). 
- Ne pas ré-ouvrir de policy `USING (true)` publique sur des tables à PII.
