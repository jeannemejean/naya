# Migrations — état réel et procédure

> Vérifié le 30 août 2026 contre le dépôt et contre `drizzle-orm@0.39.1` installé.
> À lire **avant** de toucher au schéma d'une base déployée. Ce fichier existe parce que
> l'écart entre la discipline annoncée et le dépôt réel est un accident de production
> qui attend de se produire.

---

## 1. L'état réel

- ~~`package.json` n'expose que `db:push`. **Il n'existe aucun script `db:migrate`.**~~ → **corrigé** (§4) : `db:migrate` existe, et `db:push` s'appelle désormais `db:push:dev`.
- Aucun appel au migrator Drizzle nulle part : ni `server/index.ts`, ni `server/db.ts`, ni `scripts/`. **C'est volontaire, ne pas « corriger » — cf. §4.**
- Les migrations `0000` → `0006` existent dans `migrations/` et sont listées dans `meta/_journal.json`.
- **Aucune base déployée n'a de table de suivi.** `drizzle.__drizzle_migrations` n'existe pas : dev-local et la production ont été construites à coups de `db:push`, jamais par `migrate`.

Autrement dit : les migrations sont **générées** mais rien dans le dépôt ne sait les **appliquer**.

## 2. Ce qui se passerait si on lançait `migrate` aujourd'hui

Le migrator de `drizzle-orm@0.39.1` (`node_modules/drizzle-orm/pg-core/dialect.js`) :

1. crée `drizzle.__drizzle_migrations` (`id`, `hash`, `created_at bigint`) si absente ;
2. lit **la dernière ligne** par `created_at desc` ;
3. applique **toute entrée du journal dont le `when` est strictement supérieur** à ce `created_at`.

Les `hash` ne servent pas à décider quoi appliquer, seulement à tracer.

Table absente ⇒ aucune ligne ⇒ il repart de `0000_baseline_existing_schema`, qui contient **47 `CREATE TABLE` sans un seul `IF NOT EXISTS`**. Il plante sur la première (`relation "access_code_redemptions" already exists`) et rien n'est appliqué.

**Le vrai risque n'est pas ce plantage — c'est le réflexe d'après :** « migrate ne marche pas, je fais `db:push` ». `db:push` compare le schéma à la base et génère seul les `DROP` et `ALTER`. C'est là que des données meurent, et c'est aujourd'hui le seul script de migration que le dépôt propose.

## 3. La procédure — baseliner avant tout

Une seule ligne à insérer par base, avec le `created_at` de la dernière migration **déjà présente** dans cette base. Le migrator repartira juste après.

```sql
CREATE SCHEMA IF NOT EXISTS drizzle;
CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
  id         SERIAL PRIMARY KEY,
  hash       text NOT NULL,
  created_at bigint
);
```

### Production — baseline jusqu'à `0005` inclus

La prod contient déjà tout le DDL de `0000` → `0005` (appliqué à la main ou par `db:push`). Elle n'a **pas** `0006` (réception / Fil 3).

```sql
INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES
('f34f03c6d76424fb28745a14e51c9d4745d68970db2dd946f5ad956f5dfd4175', 1782641715036), -- 0000_baseline_existing_schema
('ea03560cc0150389755f08e314946ce011b6e4b4881a657c70554fdb5c3f8a42', 1782642976516), -- 0001_add_ai_invocations
('4324e28b08183aca08a003043f1f5dc56d28790f640c514c027b0961ae7bd898', 1782654314622), -- 0002_add_memory_entries
('ef23b4db06151f1c2ba4ef9363aafba17e422d9cd1e5225f4da30af63bf98b35', 1782660000000), -- 0003_add_perf_indexes
('33a7a3acadea73002ebe2ba61250518059ee02241e383e7b3c99134ba2e52e63', 1784537635779), -- 0004_familiar_triton
('9d0ab35fd8587a472b2de988bbcfec1b10dac5c32cb23cf291f9c825777eb3b0', 1788123194293); -- 0005_baseline_ddl_applique_a_la_main
```

Après ça, `migrate` n'appliquera que `0006` — c'est le comportement voulu.

### Dev-local — même chose, plus la ligne `0006` si elle y a déjà été appliquée à la main

```sql
INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES
('4496e241a8cb60140aeb2979366cef44572c08362d37309315a51a611dc1d912', 1788123233460); -- 0006_tranquil_sally_floyd
```

### Vérifier avant de lancer quoi que ce soit

```sql
SELECT id, left(hash, 12) AS hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at;
```

La dernière ligne doit correspondre à la dernière migration réellement présente dans cette base. Si tu n'en es pas certaine, **ne lance pas `migrate`** : compare d'abord les tables.

### Régénérer ces valeurs si le journal change

```bash
node -e "
const fs=require('fs'),c=require('crypto');
const j=JSON.parse(fs.readFileSync('migrations/meta/_journal.json'));
for(const e of j.entries){
  const q=fs.readFileSync('migrations/'+e.tag+'.sql').toString();
  console.log(e.tag, c.createHash('sha256').update(q).digest('hex'), e.when);
}"
```

## 4. À faire dans le dépôt

- [x] Ajouter `"db:migrate": "drizzle-kit migrate"` à `package.json`.
- [x] Renommer `db:push` en `db:push:dev`. Le nom actuel invitait à l'utiliser partout ; c'est le seul geste qui peut détruire des données. Les invocations `npm run db:push` du `README.md`, de `BRIEF-PHASE-1-MODEL-PROVIDER.md` et de `META_COMPLIANCE.md` ont été corrigées au passage. **Non touchés volontairement** : `.local/tasks/` et `docs/superpowers/{specs,plans}/` — ce sont des archives de lots livrés, elles décrivent ce qui était vrai à l'époque et les réécrire falsifierait le journal.
- [x] **Ne pas migrer au démarrage du serveur.** Vérifié : aucun appel au migrator dans `server/`. Une migration qui échoue au boot met Railway en boucle de redémarrage via le healthcheck `/api/health`. La migration est une étape manuelle, avant le déploiement, avec la sortie sous les yeux. **Cette case reste cochée en permanence : elle décrit une règle, pas une tâche faite une fois.**
- [ ] Sauvegarde Neon (branche ou point de restauration) avant chaque `migrate` sur la prod. *(Habitude opérationnelle — ne se coche jamais définitivement.)*

> ⚠️ **`db:migrate` existe désormais, mais la baseline du §3 n'est toujours pas posée.** Le lancer aujourd'hui sur dev-local ou sur la prod rejouerait `0000` et planterait sur la première table existante. Poser d'abord la table de suivi et ses lignes, comme décrit au §3.

## 5. Le cas `0005`

`0005_baseline_ddl_applique_a_la_main.sql` porte l'avertissement « ne doit jamais être rejoué sur dev-local ni sur la production ». Une fois la baseline du §3 posée, cette règle **s'applique toute seule** : le migrator démarre après `0005`, personne n'a besoin de se souvenir du commentaire.

Sur une base **neuve**, en revanche, la table de suivi est absente et `0000` → `0006` s'appliquent dans l'ordre — ce qui est correct, et c'est pour ça que `0005` doit rester dans le journal.
