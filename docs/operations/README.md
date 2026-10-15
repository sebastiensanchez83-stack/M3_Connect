# Operations

> **Résumé en français.**
> 1. Trois documents pour faire tourner la plateforme sans mauvaise surprise : sauvegardes, surveillance automatique, jour J du WYS.
> 2. `backups.md` : ce qui est protégé, ce qui ne l'est pas, comment restaurer, l'export mensuel, les décisions à prendre.
> 3. `health-monitor.md` : le contrôle automatique qui n'écrit à M3 que si quelque chose ne va pas, et l'ordre d'installation.
> 4. `wys-dubai-runbook.md` : le déroulé jusqu'au 28 novembre pour l'équipe M3, la porte, le téléphone perdu et le plan B.
> 5. Rien de tout cela n'est installé en production : chaque étape attend ton accord.

| Document | For | What |
|---|---|---|
| [`backups.md`](backups.md) | Victor, Sébastien, technical contact | What is protected today and what is not, recovery procedures (rows, files, migrations, edge functions, whole project), the monthly export, decisions for Victor |
| [`health-monitor.md`](health-monitor.md) | technical contact, Victor | The `ops-health` monitor: what it checks, its e-mail rule and heartbeat, settings, deploy order, which alerts are urgent during WYS |
| [`wys-dubai-runbook.md`](wys-dubai-runbook.md) | the whole M3 team | World Yachting Summit 27 Nov: timeline to 28 Nov, roles and accounts, confirming guests, the door (gala rule, refresh, lost phone), fallback, contacts, do-not-touch list, the 18 Nov rehearsal |

Related: `docs/registration-contract.md` (what the registration code promises),
`docs/rights-switch-runbook.md` (the rights switch at go-live),
`supabase/migrations/README.md` (migration history in git).

Status on 15 Oct 2026: files only. The monitor's migration, dry run and edge function are in
the repository; nothing is applied or deployed. Production writes need Victor's explicit OK.
