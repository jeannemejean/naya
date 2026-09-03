# Migrations — état réel et procédure

> **Corrigé le 1er septembre 2026 après interrogation directe de la base de production.**
> La première version de ce fichier affirmait que la production n'avait pas de table de suivi Drizzle.
> **C'était faux** : elle en a une, avec les migrations `0000` → `0003` enregistrées. L'affirmation
> venait du dépôt (aucun runner) et du rapport de session, jamais d'une requête sur la base.
> Ce qui suit décrit l'état constaté, pas l'état supposé.

---

## 1. L'état réel de la production (constaté)

- `drizzle.__drizzle_migrations` **existe** et contenait quatre lignes : `0000`, `0001`, `0002`, `0003`
  — hash conformes à ceux des fichiers du dépôt. Une migration a donc bien tourné, à une époque.
- **`0004` et `0005` n'étaient pas enregistrés**, alors que **tous leurs objets existent en prod** :
  `lead_step_messages`, `recurring_rituals`, `daily_rhythm_feedback`, `outreach_step_sends`, et les
  colonnes `campaign_sequence_steps.intention` / `.condition`, `leads.linkedin_connected_at`,
  `prospection_campaigns.message_instructions`, `tasks.ritual_id`, `user_preferences.buffer_min` /
  `.buffer_adjusted_at` / `.message_instructions`. Appliqués à la main ou par `db:push`, sans trace.
- **`0006` (lot 3A) et `0007` (lot 3B) ne sont pas appliqués** : ni `content_reception`, ni
  `competitors`, ni `competitor_reception`, ni `content.intent`, ni
  `projects.attribution_window_days`, ni `brand_conversions`, ni `conversion_attributions`.
- Côté dépôt, inchangé : aucun runner de migration. `package.json` n'a longtemps eu que `db:push`,
  et rien n'appelle le migrator au démarrage.

### Le danger qui existait vraiment

Avec la table arrêtée à `0003`, un `drizzle-kit migrate` aurait appliqué `0004`, **puis `0005`** — le
fichier qui porte l'avertissement « ne doit jamais être rejoué en production ». Ses objets existant
déjà, il aurait échoué en cours de route, après avoir possiblement validé `0004`. État à moitié
migré, et le réflexe suivant est `db:push`, qui génère seul des `DROP` et des `ALTER`. C'est là que
des données meurent.

## 2. La baseline — **faite le 1er septembre 2026**

Deux lignes ont été insérées dans `drizzle.__drizzle_migrations`, dans une transaction, après
vérification que chaque objet correspondant existait bien en base :

| tag | created_at |
|---|---|
| `0004_familiar_triton` | 1784537635779 |
| `0005_baseline_ddl_applique_a_la_main` | 1788123194293 |

La table compte désormais six lignes, `0000` → `0005`. **`drizzle-kit migrate` sur la production
appliquera donc `0006` puis `0007`** — c'est le comportement voulu.

### La branche dev-local, baselinée aussi

`dev-local` (`ep-jolly-sky-…`) n'avait **aucune** table de suivi alors que tous les objets jusqu'à
`0007` y étaient — même piège, un cran plus bas. Les sept lignes `0000` → `0007` y ont été insérées
après vérification que `content_reception`, `competitors`, `brand_conversions` et
`conversion_attributions` existent bien.

> Honnêteté de méthode : ces lignes ont été insérées **avant** de vérifier `0007`, et la
> vérification n'est venue qu'après. Elle est passée, mais l'ordre était mauvais — exactement
> l'erreur décrite au §7. Vérifier d'abord, écrire ensuite.

Pour annuler cette baseline si besoin : `DELETE FROM drizzle.__drizzle_migrations WHERE created_at IN (1784537635779, 1788123194293);`

## 3. Production — migrée le 1er septembre 2026

> Les deux endpoints Neon, vérifiés : `.env.prod.bak` → `ep-damp-water-anuyb0k6` = branche
> **production** ; `.env` → `ep-jolly-sky-an1x7ddn` = branche **dev-local**. Deux bases distinctes.

- [x] Point de restauration Neon : branche `avant-0006-0007`, créée depuis `production`, vérifiée
      conforme avant migration (54 tables, 3 utilisateurs, 4 projets, 58 tâches, suivi à `0005`).
- [x] `0006` et `0007` appliqués via le migrator `drizzle-orm` avec l'URL de production passée
      explicitement — pas par `drizzle-kit`, pour écarter tout risque que le `.env` local
      (dev-local) soit ramassé à la place.
- [x] Vérifié après coup : `content_reception`, `competitors`, `competitor_reception`,
      `brand_conversions`, `conversion_attributions`, `content.intent`,
      `projects.attribution_window_days` (défaut 30) — tous présents. 59 tables, données
      inchangées (3 utilisateurs, 4 projets, 58 tâches).
- [x] Table de suivi : 8 lignes, `0000` → `0007`.

### Ce qui reste

- [ ] Pousser `main` une fois les merges faits — Railway déploie sur push, et le code de 3A/3B lit
      désormais des objets qui existent.
- [ ] Régler `projects.attribution_window_days` par marque en production (arbitrage n°2 de
      `NOTE-DECISION-ATTRIBUTION.md` §0 : 60 j pour l'Agence JMD, 14 j pour les marques B2C). Les
      quatre projets sont au défaut de 30 j. Non urgent : la fenêtre ne compte qu'à partir de la
      première conversion déclarée.
- [ ] Supprimer la branche `avant-0006-0007` quand le déploiement est stable depuis quelques jours.

## 4. Comment le migrator décide (drizzle-orm 0.39.1, vérifié dans `node_modules`)

1. crée `drizzle.__drizzle_migrations` (`id`, `hash`, `created_at bigint`) si absente ;
2. lit **la dernière ligne** par `created_at desc` ;
3. applique **toute entrée du journal dont le `when` est strictement supérieur** à ce `created_at`.

Les `hash` ne servent qu'à tracer, jamais à décider quoi appliquer.

### Régénérer les valeurs si le journal change

```bash
node -e "
const fs=require('fs'),c=require('crypto');
const j=JSON.parse(fs.readFileSync('migrations/meta/_journal.json'));
for(const e of j.entries){
  const q=fs.readFileSync('migrations/'+e.tag+'.sql').toString();
  console.log(e.tag, c.createHash('sha256').update(q).digest('hex'), e.when);
}"
```

## 5. Le dépôt — état des règles

- [x] `"db:migrate": "drizzle-kit migrate"` ajouté à `package.json` (commit `d48aadb`).
- [x] `db:push` renommé `db:push:dev`. Le nom nu invitait à l'employer partout ; c'est le seul geste
      du dépôt capable de détruire des données. Les invocations de `README.md`,
      `BRIEF-PHASE-1-MODEL-PROVIDER.md` et `META_COMPLIANCE.md` ont été corrigées ; les archives de
      `.local/tasks/` et `docs/superpowers/` ont été laissées telles quelles, volontairement — elles
      décrivent ce qui était vrai à leur date.
- [x] `.github/workflows/ci.yml` : typecheck, tests, et la garde « un seul producteur de poids
      d'attribution ». ⚠️ Cette garde ne fonctionne qu'en **bash** — sous `zsh`, `--include=*.ts`
      est avalé, la liste ressort vide et la garde passe pour la mauvaise raison. Le runner GitHub
      est en bash ; en local, la lancer avec `bash -c`.

Deux règles permanentes, qui ne se cochent jamais :

- **Aucun migrator au démarrage du serveur.** Il n'y en a pas dans `server/`, et c'est volontaire —
  ne pas « corriger » cette absence. Une migration qui échoue au boot met Railway en boucle de
  redémarrage via le healthcheck `/api/health`. La migration est une étape manuelle, avant le
  déploiement, avec la sortie sous les yeux.
- **Une sauvegarde Neon avant chaque `migrate` sur la production**, et une vérification des objets
  après.

## 6. Le cas `0005`

`0005_baseline_ddl_applique_a_la_main.sql` porte l'avertissement « ne doit jamais être rejoué ». Avec
la baseline du §2, cette règle **s'applique toute seule** : le migrator démarre après `0005`.

Sur une base **neuve**, la table de suivi est absente et `0000` → `0006` s'appliquent dans l'ordre —
ce qui est correct, et c'est pour ça que `0005` doit rester dans le journal.

## 7. La leçon

Ce fichier a affirmé pendant deux jours un état de la production que personne n'avait vérifié. Le
dépôt disait « pas de runner », le rapport d'agent disait « pas de table de suivi », et les deux
ensemble ont produit une conclusion fausse sur un système que ni l'un ni l'autre n'avait interrogé.
**Avant d'écrire une procédure sur une base, interroger la base.**
