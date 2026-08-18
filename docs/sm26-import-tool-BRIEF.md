# Prompt d'implémentation — Outil d'import « drag & drop » des inscriptions Jotform (SM26)

> À coller dans une session Claude Code ouverte sur le repo `M3_Connect`.
> Ce document est **autonome** : il contient tout le contexte et tous les pointeurs (fichier:ligne) nécessaires.
> Ne rien construire en local (Dropbox → EPERM) : commit → push `main` → build Netlify.
> Les edge functions se déploient manuellement (Dashboard Supabase ou `supabase functions deploy`).
>
> **Langue** : ce cahier des charges est en français, mais **tout ce qui est construit sur la plateforme est en anglais** — code, identifiants, commentaires, et **tous les libellés UI visibles** (titres, boutons, colonnes du tableau d'aperçu, toasts, messages d'erreur). Aucune chaîne française dans le produit.

---

## 0. Contexte projet

- **App** : Smart Marina Connect — plateforme B2B des marinas (M3 Monaco). React 18 + TS + Vite, Tailwind + Radix/shadcn, Supabase (Postgres + RLS + Edge Functions Deno), Resend (email), Netlify (SPA).
- **Supabase project id** : `djjbgzasuomhyfvtlidi` — URL `https://djjbgzasuomhyfvtlidi.supabase.co`.
- **Événement pilote** : `sm_event` slug `sm26` (Smart & Sustainable Marina Rendezvous 2026, 20–21 sept, Yacht Club de Monaco).
- **Bucket storage** : `event-media` — **PRIVÉ**, lecture uniquement via **signed URLs**.
- **Client Supabase** : instance unique exportée depuis `@/lib/supabase` (`src/lib/supabase.ts`). Session persistée (PKCE), token attaché automatiquement aux appels de functions.

### Le besoin
Aujourd'hui, pour inscrire les gens qui ont rempli le **formulaire Jotform**, on dépose le **CSV export + les fichiers des inscrits** dans un dossier, et on demande à Claude de « pousser » ça sur la plateforme. C'est manuel à chaque fois.

**But** : un écran admin où l'on **glisse-dépose le CSV + les dossiers `uploads_*` de Jotform**, on voit un **aperçu (preview) de ce qui va se passer**, et on **confirme** pour créer/enrichir les inscriptions — fichiers ré-hébergés au passage.

### Bonne nouvelle : le moteur d'import existe déjà
L'edge function **`sm26-import`** (`supabase/functions/sm26-import/index.ts`, 277 lignes, **déployée**) fait déjà tout le gros œuvre : parsing CSV, dédup, liaison de comptes, codes de revendication, enrichissement « fill-missing ». **Il n'y a AUCUNE UI qui l'appelle** (0 référence dans `src/`). Ce qui manque = **le front (dropzone + preview)** et **le ré-hébergement des fichiers**. Ne PAS réécrire le moteur — le brancher.

---

## 1. Décisions produit (FIGÉES — ne pas ré-arbitrer)

| Sujet | Décision |
|---|---|
| Emplacement | Nouvel écran admin **`/admin/sm26/import`** (staff/admin only) |
| Flux | **Preview d'abord, puis confirmation** (jamais d'écriture DB sans que Victor ait vu l'aperçu) |
| Moteur | **Réutiliser `sm26-import` tel quel** ; seule modif autorisée = ajout d'un mode **`dry_run`** (voir §4) |
| Ré-hébergement des fichiers | **Côté navigateur** (le browser a les fichiers ; évite la limite de taille du body d'une edge function). Upload direct vers `event-media`, puis on passe au moteur un CSV dont les URLs Jotform ont été remplacées |
| Périmètre fichiers | Ré-héberger : **(a)** les colonnes déjà ingérées par `sm26-import`, **(b)** les 6 images marina jury, **(c)** la carte de presse du rôle `media`, **(d)** l'entrée concours **architecte** complète (DÉCIDÉ : inclus, §6). Liste exacte §5.2 + extensions moteur §5.4 |
| Fichier non retrouvé | **Dégradation propre** : si un fichier référencé par une URL n'est pas dans les dossiers déposés, **laisser l'URL Jotform d'origine** et le signaler dans l'aperçu (« non ré-hébergé »). Ne jamais bloquer l'import pour ça |
| Idempotence | Ré-importer le même CSV ne doit pas dupliquer : c'est déjà garanti par le moteur (dédup + enrichissement + index uniques). L'UI doit juste rendre ça lisible |

---

## 2. Architecture cible (vue d'ensemble)

```
[Écran admin /admin/sm26/import]
  1. L'utilisateur dépose :  le CSV Jotform  +  les dossiers uploads_<submissionId>/
  2. (LOCAL, navigateur) parse le CSV, associe chaque URL Jotform -> fichier local
  3. APERÇU :
       a. appel sm26-import { csv, dry_run:true }  -> compteurs officiels (new/enriched/…)
       b. résumé local des fichiers : N associés, M non retrouvés
       -> tableau d'aperçu affiché à l'écran
  4. L'utilisateur clique CONFIRMER :
       a. upload de chaque fichier associé vers event-media  -> chemin storage
       b. remplace dans le TEXTE BRUT du CSV chaque URL Jotform par son chemin storage
       c. appel sm26-import { csv: <réécrit>, dry_run:false }  -> écrit en base
  5. Affiche le résultat (imported/enriched/linked, codes de revendication, suggestions de rôle, erreurs)
```

Points clés :
- **Le moteur ne voit qu'un petit CSV texte** (~12 Ko). Les gros fichiers (images HD marina, PDF, vidéos) transitent **navigateur → Storage** directement, jamais par la function.
- Le **remplacement des URLs se fait sur le texte brut** du CSV (remplacement de chaîne global `ancienneURL → cheminStorage`). Comme une URL Jotform ne contient ni guillemet ni virgule non encodée, la sous-chaîne dans le texte brut == la valeur parsée → remplacement fiable, **sans re-sérialiser le CSV** (donc zéro risque de casser le quoting). Les cellules multi-fichiers (séparateur `\n`) restent correctes : `url1\nurl2` devient `chemin1\nchemin2`, et le moteur re-splitte déjà sur `\r?\n|;|,`.

---

## 3. Écran & branchement UI

### 3.1 Route — dans `src/pages/AdminPage.tsx` (⚠ PAS `App.tsx`)
Tout `/admin/*` est monté une seule fois dans `App.tsx:140` puis routé **à l'intérieur de `AdminPage.tsx`**. Donc :

1. Ajouter le lazy import près des autres `AdminSM26*` (`AdminPage.tsx` ~l.57-68), même forme exacte que `AdminPage.tsx:63` :
   ```tsx
   const AdminSM26Import = lazyWithRetry(() => import('@/components/admin/AdminSM26Import').then(m => ({ default: m.AdminSM26Import })));
   ```
   (`lazyWithRetry` est déjà importé à `AdminPage.tsx:8`.)

2. Ajouter la route **AVANT** la route catch-all `/sm26/:id` (`AdminPage.tsx:146`), au milieu des routes `/sm26/xxx` nommées (l.134-145), sinon `import` sera pris pour un id d'inscription :
   ```tsx
   <Route path="/sm26/import" element={<AdminOnlyGuard><AdminSM26Import /></AdminOnlyGuard>} />
   ```
   `AdminOnlyGuard` est défini dans le même fichier (`AdminPage.tsx:71-84`) et gate sur `isAdmin` (les modérateurs sont renvoyés). Pas d'import à ajouter.

3. **Ne PAS toucher `App.tsx`.**

### 3.2 Entrée sidebar — `src/components/admin/AdminSidebar.tsx`
Ajouter un item au tableau `sm26Children` (l.33-45), même format ; icône déjà importée (ex. `Upload`/`FileUp` à ajouter au bloc lucide l.4-9, ou `Plus` déjà présent) :
```tsx
{ to: '/admin/sm26/import', label: 'Import', icon: <Upload className="h-4 w-4" /> },
```
Le `to` est le chemin **absolu** `/admin/sm26/import`. Pas besoin de `exact` (route feuille). Le rendu et l'état actif sont automatiques (`sm26Children.map`, l.146-150). Le groupe Smart 26 ne s'affiche déjà que pour `isAdmin` (l.128) — cohérent avec le guard.

### 3.3 Composant — `src/components/admin/AdminSM26Import.tsx` (nouveau)
**Export nommé** `export function AdminSM26Import() { … }` (le lazy loader attend un export nommé, pas default). Conventions à copier depuis `AdminSM26.tsx` :
- `import { supabase } from '@/lib/supabase'` ; `import { toast } from '@/hooks/use-toast'`.
- UI shadcn : `Button`, `Card`/`CardContent`, `Input`, `Badge`, `Checkbox` depuis `@/components/ui/*`.
- Toast succès : `toast({ title: '…', description: … })` ; erreur : `toast({ title: '…', description: msg, variant: 'destructive' })`.
- Pas de garde de rôle côté composant : l'accès est déjà assuré par `AdminOnlyGuard` + RLS.
- Layout racine : `<div className="space-y-4">` + `<h1 className="text-2xl font-bold …">` avec une icône lucide, comme `AdminSM26.tsx:389-393`.
- Spinner de chargement : early-return avec `<RefreshCw className="h-8 w-8 animate-spin …" />` (cf. `AdminSM26.tsx:382-386`).

### 3.4 Dropzone dossiers — net-new (⚠ point technique)
Le hook réutilisable `src/hooks/useFileDrop.ts` ne lit que `e.dataTransfer.files` (plat) — **insuffisant pour un dossier**. Il faut récupérer l'**arborescence** pour connaître le `uploads_<submissionId>/` de chaque fichier :
- **Recommandé** : un `<input type="file" webkitdirectory multiple>` → chaque `File` porte `file.webkitRelativePath` = `…/uploads_<sub>/<filename>`. (Aucun usage de `webkitdirectory` n'existe encore dans le repo — c'est nouveau.)
- **En plus / alternative** : drop via `DataTransferItem.webkitGetAsEntry()` puis récursion des `FileSystemDirectoryEntry` pour reconstruire les chemins relatifs.
- Prévoir aussi un simple `<input type="file" accept=".csv">` pour le CSV (ou l'accepter dans le même dépôt et le distinguer par extension).
- S'inspirer du style « zone pointillée + surbrillance `isDragging` » de `SM26Invoices.tsx:209` et du multi-fichiers de `SM26AssetUpload.tsx`.

### 3.5 Tableau d'aperçu (preview) attendu
Afficher, avant confirmation :
- Compteurs du moteur (dry_run) : **total**, **deduped**, **imported (dont linked)**, **enriched**, **skipped**.
- **Codes de revendication** qui seront générés (email → code) et **suggestions de rôle** (email → rôles suggérés) — voir §4.
- **Fichiers** : nb associés / nb non retrouvés (avec la liste des non-retrouvés).
- **Erreurs** éventuelles remontées par le dry_run.
Bouton **Confirmer l'import** (désactivé tant que le CSV n'est pas chargé), avec `window.confirm(...)` de sécurité comme ailleurs dans l'admin.

---

## 4. Contrat de l'edge function `sm26-import`

**Appel (Pattern A du repo — le token session est attaché automatiquement) :**
```ts
const { data, error } = await supabase.functions.invoke('sm26-import', { body: { csv, dry_run } });
if (error) {
  let msg = error.message;
  try { const b = await (error as { context?: Response }).context?.json(); if (b?.error) msg = b.error; } catch {}
  // afficher msg (ex. "Staff only")
}
```
Copier le pattern **`invokeWithRetry`** de `AdminSM26Health.tsx:32-41` (retry unique sur `FunctionsFetchError` cold-start uniquement) — l'import est une action one-shot critique.

**Auth** : la function lit le header `Authorization` (401 si absent), reconstruit un client user, appelle la RPC **`sm_is_staff`** → **403 "Staff only"** si faux. `invoke` fournit le bon token pour un admin connecté. CORS autorise déjà `smartmarinaconnect.com`, `m3connect.netlify.app`, `localhost:5173/3000`.

**Réponse (HTTP 200) — forme exacte à typer côté UI :**
```ts
type ImportResult = {
  total: number;            // lignes de données exploitables
  deduped: number;          // après dédup (1 par société, dernière soumission)
  imported: number;         // nouvelles inscriptions créées
  enriched: number;         // inscriptions LIVE existantes enrichies (pas de doublon)
  skipped: number;          // collisions d'index unique (23505) ignorées
  linked: number;           // parmi imported : rattachées à un compte existant (par email)
  codes: { email: string; code: string }[];              // codes SM26-XXXXXX pour les sans-compte
  role_suggestions: { email: string; has_roles: string[]; suggested: string[] }[];
  errors: { email: string; error: string }[];            // échecs par ligne (l'appel reste 200)
};
```
Erreurs possibles : 405 (non-POST), 401 (no token), 403 (Staff only), 400 (`Invalid JSON` / `Missing csv` / `Event not found`).

### Modif à apporter : mode `dry_run` (pour la preview)
Ajouter un flag `dry_run` qui calcule les **mêmes compteurs sans écrire**. Points d'insertion (7 sites d'écriture ; garder tous les `result.*++` et `result.*.push` HORS du garde pour que les compteurs restent justes) :
1. `body` (l.148) : `let body: { csv?: string; dry_run?: boolean };` puis `const dryRun = body.dry_run === true;`.
2. Garder d'un `if (!dryRun)` les 3 `update` du chemin enrich (l.201, 217, 229).
3. Chemin create : les `insert` renvoient des `id` réutilisés → en dry_run, court-circuiter avec un id factice (`"00000000-0000-0000-0000-000000000000"`) au lieu d'insérer (l.241-247 registration, l.260-262 role_assignment).
4. `upsertTypedProfile` (l.124-132) : passer `dryRun` en paramètre et garder ses 2 écritures (insert l.128, update l.131). Appels à mettre à jour (l.219, 265).
5. Laisser tels quels les **reads** `sm_user_id_by_email` (l.238) et `genCode` (pur) pour que `linked`/`codes` restent calculés.

**Caveat à afficher** : en dry_run, **`skipped` n'est pas exact** (il n'est incrémenté que sur une vraie erreur `23505` d'insert que le lookup LIVE ne voit pas — ex. ré-import d'un `declined`/`cancelled`). En preview, ces lignes seront comptées comme `imported`. Le mentionner dans l'UI (« estimation »), ou l'accepter tel quel. Ne pas complexifier le moteur pour ça en v1.

**Après modif, redéployer `sm26-import` manuellement** (Dashboard ou `supabase functions deploy sm26-import`).

---

## 5. Ré-hébergement des fichiers (le cœur du nouveau travail)

### 5.1 Mapping URL Jotform → fichier local (vérifié sur 4 exports, 180 URLs, 100 % résolues)
Structure d'URL constante :
```
https://eu.jotform.com/uploads/<user>/<formId>/<submissionId>/<filename>
                                 AUDREY_Luciani 252933238145357  ^^^^^^^^^^^^  encodé %20/%26/%C3%A9…
```
- `<submissionId>` == nom du dossier `uploads_<submissionId>` sur disque.
- `<filename>` doit être **`decodeURIComponent`** avant recherche disque (le dossier contient la forme décodée : `CAL-Logo-2021 B&W.jpg`, `007…ENAÍPERU-©-HG.ESCH.jpg`). Jotform remplace `/` par `_` dans les noms stockés.
- **Cellules multi-fichiers** : séparateur = **saut de ligne nu `\n`** (pas `\r\n`, pas `;`, pas `,`), à l'intérieur d'une cellule quotée. Splitter sur `\n` **puis** décoder ; ne jamais splitter sur `,`.
- **Layout des exports variable** : parfois `uploads_<sub>` est à la racine de l'export, parfois **imbriqué** sous un dossier `Registration_form_-_SM_2026_…/`. → localiser `uploads_<sub>` par le `webkitRelativePath` (chercher le segment `uploads_<sub>/`), pas par une profondeur fixe.

**Algorithme de matching** : pour chaque URL d'une colonne fichier → extraire `submissionId` + `filename` décodé → trouver le `File` déposé dont `webkitRelativePath` contient `uploads_<submissionId>/` et dont le basename == `filename`. Fallback : match par basename seul si unique. (Aucune collision de nom entre submissions n'a été trouvée sur les 4 exports, mais le scope par `submissionId` reste plus sûr.)

### 5.2 Colonnes fichiers à ré-héberger
Indices `r[N]` (0-based, mêmes indices que dans `sm26-import`).

**(A) Déjà ingérées par le moteur** (le front doit juste ré-héberger + réécrire l'URL) :

| `r[N]` | Champ stocké | Rôle / table | Cardinalité |
|---|---|---|---|
| `r[41]` | `logo_url` | jury `module_data` | 1 |
| `r[42]` | `photo_url` | jury `module_data` | 1 |
| `r[20]` \|\| `r[32]` | `photo_url` | speaker `module_data` | 1 (1er non vide) |
| `r[33]` | `portfolio` | speaker `module_data` | 1 |
| `r[47]` | `logo_url` | marina `module_data` | 1 |
| `r[63]` | `hd_images` | marina `module_data` | **multi** (`\n`) |
| `r[64]` | `building_images` | marina `module_data` | **multi** (`\n`) |
| `r[65]` | `pitch` | marina `module_data` | 1 (média) |
| `r[103]` | `logo_url` | startup → `sm_startup_profile` | 1 |
| `r[104]` | `deck_url` | startup → `sm_startup_profile` | 1 |
| `r[95]` | `product_images` | startup → `sm_startup_profile` | **array** |
| `r[110]` | `pitch_media_url` | startup → `sm_startup_profile` | 1 |

**(B) NOUVELLES en scope** (nécessitent AUSSI une extension moteur — §5.4) :

| `r[N]` | Champ stocké | Cible | Cardinalité |
|---|---|---|---|
| `r[73]` | `biodiversity_image` (sustainability) | `sm_marina_extra` (colonne existante) | 1 |
| `r[75]` | `water_image` | `sm_marina_extra` | 1 |
| `r[77]` | `energy_image` | `sm_marina_extra` | 1 |
| `r[79]` | `waste_image` | `sm_marina_extra` | 1 |
| `r[81]` | `innovation_image` | `sm_marina_extra` | 1 |
| `r[83]` | `security_image` | `sm_marina_extra` | 1 |
| `r[85]` | `press_card` | rôle `media` `module_data` | array (cf. self-reg) |
| `r[20]`/`r[32]` | `photo_url` | architecte `module_data` | array (§6.1) |
| `r[21]` | `logo_url` | architecte `sm_architecture_entry` | scalar (1er) |
| `r[22]` | `company_image_url` | architecte `sm_architecture_entry` | scalar (1er) |
| `r[23]` | `project_renders` | architecte `sm_architecture_entry` | **array** (multi) |
| `r[31]` | `proof_of_enrolment` | architecte student `module_data` | array (§6.1) |

**NE PAS** ré-héberger (URLs de profil, pas des assets) : `r[6]` website, `r[24]`-`r[27]` réseaux (→ `module_data.social_links`), `r[33]` portfolio link, `r[106]-r[109]` réseaux startup.

### 5.3 Convention de chemin Storage — ⚠ à CALER sur `sm26-register`
Le moteur stocke la chaîne telle quelle dans les champs URL de `module_data` / profils typés. Pour que les inscriptions importées soient **indiscernables des auto-inscriptions**, les fichiers ré-hébergés doivent être stockés **exactement dans la même forme** que ce que `sm26-register` écrit.
- **AVANT de coder** : lire `supabase/functions/sm26-register/index.ts` (~l.122, `admin.storage.from('event-media').upload(path, bytes, …)`) et repérer **(a)** le gabarit de `path` utilisé et **(b)** ce qui est stocké dans `module_data`/profils : **chemin storage relatif** (probable) ou URL signée. **Répliquer à l'identique.**
- Upload navigateur (pattern repo) : sanitize `const safe = file.name.replace(/[^a-zA-Z0-9._-]/g,'_')`, `upload(path, file, { upsert:false, contentType: file.type||'application/octet-stream' })`. Si un insert échoue plus loin, supprimer l'objet (`remove([path])`) comme `SM26Invoices.tsx:108`.
- Défaut proposé **si** `sm26-register` ne dicte pas déjà un gabarit réutilisable : `sm26/imports/<submissionId>/<Date.now()>-<safe>`. (Le bucket n'a **aucune** limite MIME/taille définie dans le repo — voir §8. Caps client-side conseillés, cf. `SM26RegUpload.tsx` : 12 Mo/fichier, downscale 1600px.)
- Lecture ultérieure : signed URL (`createSignedUrl(path, 300)`), comme partout ailleurs.

### 5.4 Extensions du moteur `sm26-import` (pour les fichiers du groupe (B))
Ces fichiers nécessitent, EN PLUS du ré-hébergement front, des modifs dans `supabase/functions/sm26-import/index.ts` (puis **redéploiement manuel**) :

**Images marina jury (`r[73/75/77/79/81/83]`) — simple, cibles déjà en base.**
Les 6 colonnes existent **déjà** sur `sm_marina_extra` (`biodiversity_image, water_image, energy_image, waste_image, innovation_image, security_image` — toutes `text`, nullable ; non définies dans le repo = drift Dashboard ; vides et non écrites aujourd'hui). Étendre la branche marina de `typedProfile()` (`index.ts:109-116`) :
```ts
biodiversity_image: S(r[73]), water_image: S(r[75]), energy_image: S(r[77]),
waste_image: S(r[79]), innovation_image: S(r[81]), security_image: S(r[83]),
```
⚠ Le mapping n'est pas 1:1 avec le libellé : l'image « sustainability » va dans `biodiversity_image` (mapping ci-dessus figé). `AdminSM26Detail.tsx` les affiche déjà en vignettes via son rendu générique (clé `*_image`) dès qu'elles contiennent un chemin/URL. NB : `AdminSM26EcatDossier` ne les vignette pas encore (hors scope importeur).

**Carte de presse / rôle `media` (`r[85]`) — nouveau chemin de rôle.**
Le moteur n'a **aucun** rôle `media` (map `PARTICIPATE` l.46 : Jury/Marina/Speaker/Startup/Visitor). Le rôle plateforme `media` existe pourtant (scope `user`, pas de table typée, tout en `module_data`). Self-reg stocke : `press_card` = **array de chemins storage** (`${userId}/sm26/press_card/…`), `outlet` = string, `photo_url` = array. Pour couvrir l'import :
1. Ajouter `PARTICIPATE["<libellé media exact>"] = ["media"]` (⚠ libellé à confirmer sur le formulaire Jotform live — §7).
2. Ajouter une branche `media` à `roleModuleData()` (~l.92) : `press_card ← r[85]` (ré-hébergé, **en array** pour matcher self-reg), `photo_url ← r[42]`, `outlet ← company_name` (r[5], faute de colonne outlet dédiée dans Jotform).
3. Ajouter `r[85]` à la table de ré-hébergement front (§5.2 B).

---

## 6. Cas ARCHITECTE — EN SCOPE (Phase 4) ⚠ corrige une perte de données EN COURS

**Décidé : inclus.** Aujourd'hui `r[15]` = **"Architecture contest"** n'est **pas** mappé dans `PARTICIPATE` → **12 soumissions architectes réelles** (présentes dans les exports) sont importées comme simples **`visitor`**, et **toute l'entrée concours (dont `r[21]` logo / `r[22]` image / `r[23]` renders) est perdue**. La Phase 4 corrige ça.

Self-reg gère l'architecte via 2 rôles (`architect_pro` / `architect_student`, split sur `r[16]`) écrivant dans la table typée **`sm_architecture_entry`**. **L'import doit reproduire EXACTEMENT ce mapping self-reg** (source de vérité).

Travail Phase 4 : (a) mapper `"Architecture contest"` avec conditionnel pro/étudiant sur `r[16]` (un `PARTICIPATE` statique ne suffit pas → petite logique) ; (b) nouvelle branche `sm_architecture_entry` dans `typedProfile()` ; (c) ré-héberger `r[21]/r[22]/r[23]` (+ `r[31]` proof of enrolment étudiant).

> En attendant que la Phase 4 soit livrée, l'aperçu (Phase 1) doit signaler « N inscrits 'Architecture contest' importés comme visitor ».

### 6.1 Mapping exact `r[N]` → `sm_architecture_entry` (VÉRIFIÉ sur les exports)

Rôle : `r[16]`="Professional" → `architect_pro` (`category='professional'`) ; "Student" → `architect_student` (`category='student'`). **Reproduire EXACTEMENT le mapping self-reg** (`sm26-register/index.ts:351-359` + `mapArch:66-84` ; membre `SM26RegisterPage.tsx:527-544`). Scope du rôle : caler sur la def self-reg (`SM26RegisterPage.tsx:41-42`) — a priori `user` (l'architecte n'est pas dans le set `ORG` du moteur), à confirmer.

`sm_architecture_entry` n'est **pas** dans le repo (drift). Colonnes reconstruites depuis l'usage. Mapping :

| `r[N]` | Jotform | → colonne `sm_architecture_entry` | Forme stockée | Fichier ? |
|---|---|---|---|---|
| `r[12]` (+`r[13]` si "Other") | domaine | `domain` | text | non |
| `r[17]` | company description | `company_description` | text | non |
| `r[18]` | sustainability/innovation | `sustainability_statement` | text | non |
| `r[19]` | references | `references_text` | text | non |
| `r[21]` | company logo | `logo_url` | **1er chemin storage (scalar)** | **FILE (multi→1er)** |
| `r[22]` | image of company | `company_image_url` | **1er chemin storage (scalar)** | **FILE (multi→1er)** |
| `r[23]` | project renders | `project_renders` | **text[] chemins storage** | **FILE (multi, jusqu'à 13 ; peut être un PDF)** |
| `r[28]` | team? | `is_team` | boolean | non |
| `r[29]` | number of members | `team_size` | integer (`parseInt`) | non |
| `r[30]` | additional members | `team_members` | text[] (split `\n`) | non |
| `r[33]` | portfolio link | `portfolio_link` | text (URL) | non |
| `r[37]` | onsite 20-21 sept | `onsite_attendance` | boolean (+ `module_data.onsite_attendance`='yes'/'no') | non |

**Hors colonne typée — dans `sm_role_assignment.module_data`** (mirror self-reg) :
- Photo : `r[20]` (Professional) **ou** `r[32]` (Student) → `module_data.photo_url` (array de chemins). **FILE.**
- Preuve d'inscription (Student) : `r[31]` fichier uploadé → `module_data.proof_of_enrolment` (array). **FILE.** ⚠ La colonne `proof_of_enrolment_url` est réservée à une **URL saisie** (self-reg) — n'y mets **pas** le fichier ; range le chemin ré-hébergé dans `module_data.proof_of_enrolment`.
- Réseaux : `r[24]` linkedin, `r[25]` instagram, `r[26]` facebook, `r[27]` twitter → `module_data.social_links`.

**Fichiers architecte à ré-héberger (front §5.2)** : `r[20], r[21], r[22], r[23], r[31], r[32]` — tous potentiellement multi (séparateur `\n`). Preuve d'indices : ligne réelle **Cowan Architects** (export 20.07) — r[15]="Architecture contest", r[16]="Professional", r[21]=logo (×2), r[22]=image société, r[23]=PDF portfolio.
(NB self-reg recopie aussi tous ces assets en bloc dans `module_data` via `{...ap}` ; les colonnes typées ne gardent que le 1er chemin pour logo/hero. Reproduire ce doublon si l'on veut être strictement identique ; sinon la colonne typée suffit pour l'affichage `AdminSM26Detail`.)

---

## 7. À vérifier / confirmer AVANT de coder
1. **Format d'asset (confirmé, à répliquer)** : self-reg (`sm26-register`) stocke les assets comme **chemins storage relatifs** du bucket privé `event-media` (gabarit `${userId}/sm26/${key}/${ts}-${i}.${ext}`), rangés dans `module_data` / colonnes typées — **jamais** des URLs. L'import doit stocker la **même forme** (chemin relatif). ⚠ **Préfixe** : le gabarit self-reg commence par l'`uid` ; or un inscrit importé **sans compte** n'a pas d'uid à l'import. Choisir un préfixe stable (ex. `sm26/imports/<submissionId>/…`) et **vérifier la policy Storage RLS de `event-media`** pour que l'upload admin + la lecture signed-URL marchent sous ce préfixe. **Bloquant.**
2. **Libellé media Jotform (`r[15]`)** : la valeur exacte de l'option « media/press » n'apparaît dans **aucun** export (0 inscrit media à ce jour). La clé `PARTICIPATE` doit matcher ce libellé **au caractère près** → le lire sur le formulaire Jotform live. **Bloquant pour la carte de presse.**
3. **Architecte (§6)** : TRANCHÉ — inclus (Phase 4). Mapping exact à confirmer §6.1.
4. **Bucket `event-media`** : `file_size_limit` / `allowed_mime_types` absents du repo (drift). Les lire sur le projet live si on veut les respecter ; sinon caps client-side (12 Mo/fichier, downscale 1600px comme `SM26RegUpload.tsx`).
5. **Volume** : un dossier `uploads_<sub>` marina peut peser lourd (images HD). Upload navigateur à **concurrence limitée** + barre de progression.

---

## 8. Découpage — COMMENCER PAR LA PHASE 1

1. **Phase 1 — Preview only (aucune écriture)** : écran `/admin/sm26/import` + sidebar, dépôt CSV + dossiers, matching local des fichiers, ajout `dry_run` à `sm26-import` (+ redéploiement), tableau d'aperçu (compteurs + codes + suggestions + fichiers associés/non-retrouvés + **alerte « N architectes importés comme visitor »**). *→ Livrer et valider avec Victor avant toute écriture en base.*
2. **Phase 2 — Confirmation & ré-hébergement (fichiers groupe (A))** : upload vers `event-media` (préfixe §7 pt.1), réécriture du CSV (remplacement de chaînes), appel `dry_run:false`, affichage du résultat, gestion des non-retrouvés (URL Jotform conservée). Couvre les fichiers **déjà ingérés** (§5.2 A).
3. **Phase 3 — Extensions moteur (fichiers groupe (B))** : étendre `sm26-import` (§5.4) pour **(a)** les 6 images marina → colonnes `sm_marina_extra.*_image`, **(b)** le rôle `media` + carte de presse `r[85]` (une fois le libellé confirmé §7 pt.2) ; redéployer. Ajouter r[73…83] + r[85] au ré-hébergement front.
4. **Phase 4 — Architecte** (en scope) : mapping `"Architecture contest"` + split pro/étudiant (r[16]), branche `sm_architecture_entry` dans `typedProfile()` (mapping §6.1), ré-hébergement r[21]/r[22]/r[23]/r[31] ; redéployer.
5. **Finitions** : barre de progression upload, nettoyage des objets orphelins si annulation après upload, export/copie du récap (codes à envoyer), support multi-exports.

---

## 9. Critères d'acceptation

**Phase 1**
- [ ] `/admin/sm26/import` accessible aux admins seulement, visible dans la sidebar Smart 26.
- [ ] Déposer un CSV Jotform + ses dossiers `uploads_*` affiche un **aperçu** : compteurs (total/deduped/new/enriched/skipped), codes à générer, suggestions de rôle, et **N fichiers associés / M non retrouvés**.
- [ ] **Aucune écriture en base** en phase preview (vérifiable : relancer un `dry_run` ne change aucun compteur réel).
- [ ] Le caveat `skipped` (estimation) est affiché.

- [ ] L'aperçu signale le nombre d'inscrits `"Architecture contest"` importés comme `visitor` (données concours non reprises).

**Phase 2**
- [ ] Confirmer : les fichiers associés (groupe A) sont uploadés dans `event-media` **au même format que `sm26-register`** (chemin storage relatif), et les inscriptions créées/enrichies pointent vers les **chemins storage** (pas les URLs Jotform).
- [ ] Une inscription importée s'affiche correctement dans les surfaces existantes (e-catalogue, détail inscription) avec ses visuels via signed URL — **au même titre qu'une auto-inscription**.
- [ ] Un fichier non retrouvé n'empêche pas l'import : l'URL Jotform d'origine est conservée et le cas est listé.
- [ ] Ré-importer le **même** CSV n'ajoute aucun doublon (enrich, pas create) et n'écrase aucune valeur déjà remplie.
- [ ] Cas de test réels : dossiers `Dev plateform/JotForm 20.07.2026` (2 soumissions) et `jotform17072026` (3), noms de fichiers avec espaces/`&`/`'`/accents/`©` — tous ré-hébergés.

**Phase 3 (extensions moteur)**
- [ ] Une marina importée avec images jury remplit les colonnes `sm_marina_extra.biodiversity_image/water_image/energy_image/waste_image/innovation_image/security_image` et ces images apparaissent en vignettes dans `AdminSM26Detail`.
- [ ] Un inscrit media est créé avec le rôle `media` (pas `visitor`), sa carte de presse (`press_card`) ré-hébergée en chemin storage `event-media`, `outlet` renseigné.

**Phase 4 (architecte)**
- [ ] Un inscrit `"Architecture contest"` est créé avec le rôle `architect_pro`/`architect_student` (selon r[16]) et une ligne `sm_architecture_entry` complète (logo/image/renders ré-hébergés) — plus aucun architecte en `visitor`.
- [ ] Cas de test réel : **Cowan Architects** (export 20.07) importé en architecte avec logo + image société + renders projets ré-hébergés.

---

## 10. Rappels techniques
- Ne PAS build en local (Dropbox EPERM). Commit → push `main` → Netlify. Edge functions : déploiement manuel.
- Réutiliser l'existant, ne pas réinventer : hook `useFileDrop` (drop simple), `SM26AssetUpload.tsx` / `SM26Invoices.tsx` (upload `event-media` + signed URL + rollback), `invokeWithRetry` (`AdminSM26Health.tsx:32`), coercions/indices de `sm26-import`.
- Le moteur `sm26-import` reste la **source de vérité** de la logique métier (dédup, enrichissement, rôles, codes). Le front ne fait que : matcher les fichiers, uploader, réécrire les URLs, appeler la function, afficher le résultat.
- Pointeurs clés : `supabase/functions/sm26-import/index.ts` (moteur), `src/pages/AdminPage.tsx` (routes admin), `src/components/admin/AdminSidebar.tsx` (sidebar), `src/components/admin/AdminSM26.tsx` (conventions de page), `src/lib/supabase.ts` (client), `supabase/functions/sm26-register/index.ts` (référence upload/format).
