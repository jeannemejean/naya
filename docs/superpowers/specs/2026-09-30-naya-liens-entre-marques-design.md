# Les liens entre marques

Date : 2026-09-30
Statut : spec validée, plan à écrire
Sous-projet 1 sur 3 (voir « Découpage » en fin de document)

## Le problème

Jeanne construit plusieurs marques en parallèle, et certaines ont des liens réels entre elles : l'Agence JMD vit de la crédibilité que Jeanne Méjean construit en son nom propre. D'autres n'en ont aucun : Encore Merci n'a rien à voir avec l'agence.

Naya ignore les deux faits. Chaque projet est étanche : elle ne sait pas qu'une campagne pour JMD devrait s'articuler avec ce que Jeanne raconte au même moment, et rien ne l'empêcherait de rapprocher deux marques qui n'ont rien à voir. La conséquence est que la génération de campagnes produit des plans corrects marque par marque, et incohérents à l'échelle de la personne qui les porte.

Cette absence a un coût particulier quand les audiences se recoupent : les mêmes abonnés voient le même angle sortir deux fois la même semaine, sous deux noms.

## Périmètre

Dans le périmètre :

- Un lien **orienté** entre deux projets, déclaré à la main, portant les rôles de chaque côté, la nature du lien et le recoupement d'audiences.
- L'absence de lien traitée comme une **interdiction** de rapprocher deux marques.
- Une étape de proposition avant la génération d'une campagne : articuler avec la marque liée, ou rester indépendante.
- L'injection bornée de la campagne liée dans le prompt de génération, quand l'articulation est choisie.
- Une alerte non bloquante au moment où un contenu est programmé, quand il recoupe l'angle d'un contenu programmé sur une marque liée dont l'audience se recoupe.

Hors périmètre, explicitement :

- Le partage d'ADN de marque, de mémoire ou d'observations de réception entre marques liées. Chaque marque reste étanche sur son identité.
- La génération jumelée : une campagne reste attachée à une seule marque. Il n'existe pas d'objet « campagne de couple ».
- Toute contrainte anti-collision **à la génération** : décision de Jeanne, voir « Décisions ».
- La détection automatique des liens. Naya ne devine jamais que deux marques sont parentes.
- La saisie manuelle de campagnes et de posts → sous-projet 2.
- La curation du contenu généré (rejet, suppression par marque) → sous-projet 3.

## État constaté

Relevé sur le dépôt le 2026-09-30, `main` à `c6c1016`.

| Constat | Valeur |
|---|---|
| Notion de lien entre projets | **inexistante**. `projectRelations` (`shared/schema.ts:1174`) est un helper de jointure Drizzle, pas un concept métier |
| Génération de campagne | trois étapes : `POST /api/campaigns/generate/strategy`, `/content`, `/tasks` (`server/routes.ts:9691`, `:9717`, `:9739`) |
| Contexte déjà transmis à la génération | `objective`, `duration`, `projectId`, `brandDna`, et un texte libre `weekContext` |
| Colonnes de `campaigns` utiles à l'articulation | `name`, `objective`, `coreMessage`, `phases` (jsonb), `contentPlan` (jsonb), `status` |
| Page projet | `client/src/pages/project/ProjectPage.tsx`, composée de panneaux : `ProjectContextEditor`, `MilestoneRoadmap`, `ConversionsPanel`, `RitualList` |
| Programmation d'un contenu | `scheduledFor` sur `content`, écrit par `POST /api/content` et le PATCH (`server/routes.ts:6514`, `:6537`, `:6577`) |
| Modèles disponibles | `CLAUDE_MODELS.fast` (Haiku) et `.smart` (Sonnet) via `server/services/claude.ts:20` |
| Embeddings | `embedText`, `embedTexts`, `toVectorLiteral` (`server/services/memory/embed.ts`), pgvector en base |

## Décisions

Cinq arbitrages rendus le 30 septembre.

**1. Le lien est orienté, avec des rôles écrits par l'utilisatrice.** Pas de taxonomie de types de liens. Le sens (« qui nourrit qui ») et le recoupement d'audiences sont structurés, parce que ce sont eux qui font agir le code de façon déterministe. Le reste — le rôle de chaque côté, la nature du lien — est du texte libre, dans les mots de Jeanne. C'est l'application directe d'une règle du projet : les critères sont dérivés du contexte de chaque utilisateur, jamais universalisés.

**2. L'absence de lien est une interdiction, pas un silence.** Sans lien déclaré, Naya ne mentionne jamais une marque dans le travail d'une autre et ne s'appuie sur rien de l'autre, même quand le rapprochement lui paraît pertinent. C'est la règle que Jeanne a soulignée deux fois : « parfois les marques n'ont pas de lien les unes avec les autres, ça aussi c'est très important. »

**3. Le lien vit à deux étages.** Un lien **durable** entre marques, déclaré une fois, dont Naya se souvient. Et une décision **ponctuelle** par campagne : celle-ci s'articule avec telle campagne, ou bien elle est délibérément indépendante. Le durable informe, le ponctuel décide. Sans le second étage, une campagne volontairement isolée serait impossible.

**4. Naya propose, Jeanne tranche.** À la génération, Naya signale le lien et l'état des campagnes de la marque liée, puis demande. Elle n'articule pas d'office. Le choix est **persisté** sur la campagne : sans quoi la question reviendrait indéfiniment sur une campagne qu'on a voulue isolée.

**5. L'anti-collision se fait au placement, pas à la génération.** Choix de Jeanne, contre la recommandation initiale. Le contrôle s'exécute quand un contenu reçoit une date, ce qui couvre **aussi les posts écrits à la main** — que la contrainte à la génération n'aurait jamais protégés. Conséquence assumée et à connaître : Naya pourra proposer un angle qui recoupe l'autre marque, et c'est l'alerte au placement qui le rattrapera. Si l'usage montre que c'est agaçant, la contrainte en amont s'ajoute en une ligne de prompt.

## Schéma

```typescript
// Un lien ORIENTÉ entre deux marques : `from` nourrit `to`.
// L'ABSENCE de ligne est une interdiction, pas un vide : sans lien déclaré,
// Naya ne rapproche jamais deux marques, même si le rapprochement lui paraît
// évident. Voir la Décision 2 du spec.
export const projectLinks = pgTable("project_links", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  fromProjectId: integer("from_project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  toProjectId: integer("to_project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  // Les trois champs libres : les mots de l'utilisatrice, jamais une catégorie.
  roleAmont: text("role_amont"),      // ce que fait la marque qui nourrit
  roleAval: text("role_aval"),        // ce que fait la marque nourrie
  nature: text("nature"),             // pourquoi elles sont liées, et les interdits
  // Structuré parce qu'il fait agir le code : il conditionne l'anti-collision.
  audiencesRecoupent: boolean("audiences_recoupent").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => ({
  sensIdx: uniqueIndex("project_link_sens_idx").on(t.userId, t.fromProjectId, t.toProjectId),
  versIdx: index("project_link_vers_idx").on(t.userId, t.toProjectId),
}));

export type ProjectLink = typeof projectLinks.$inferSelect;
```

Deux colonnes ajoutées à `campaigns` :

```typescript
  // L'articulation ponctuelle (Décision 3). Les DEUX colonnes sont nécessaires :
  // sans le booléen, on ne distingue pas « pas encore décidé » de « décidé que non »,
  // et Naya reposerait la question sur une campagne voulue isolée.
  articuleAvecCampaignId: integer("articule_avec_campaign_id")
    .references((): AnyPgColumn => campaigns.id, { onDelete: "set null" }),
  articulationIndependante: boolean("articulation_independante").notNull().default(false),
```

> **Piège vérifié** : `campaigns` se référence elle-même, ce qui oblige Drizzle à une annotation de retour explicite — `(): AnyPgColumn => campaigns.id` — et à l'import de `AnyPgColumn` depuis `drizzle-orm/pg-core`. Sans elle, TypeScript échoue sur une inférence circulaire. Aucune auto-référence n'existe ailleurs dans `shared/schema.ts` : c'est un motif nouveau pour ce dépôt, et le dépôt est à zéro erreur `tsc` — il doit y rester.

Garde-fous de schéma :

- une marque ne peut pas être liée à elle-même : `fromProjectId !== toProjectId`, vérifié applicativement avant insertion ;
- les deux projets doivent appartenir à `userId`, vérifié via `storage.getProject(id, userId)` avant insertion — 404 et non 403 si l'un n'appartient pas à l'utilisateur, comme partout ailleurs dans ce dépôt ;
- le sens inverse est un **autre** lien : déclarer `A → B` n'interdit pas `B → A`, et les deux peuvent coexister si la relation est réciproque avec des rôles différents.

## La déclaration des liens

Un panneau `BrandLinksPanel` sur la page projet, à côté des panneaux existants. Il affiche deux listes : les liens **partant** de cette marque et ceux **arrivant** vers elle — un lien se lit dans les deux sens même s'il n'en porte qu'un.

Créer un lien : choisir l'autre marque parmi les projets de l'utilisatrice, dire qui nourrit qui, remplir les trois textes, cocher le recoupement d'audiences. Modifier et supprimer sont possibles ; supprimer un lien ne touche aucune campagne existante.

Endpoints :

- `GET /api/projects/:id/links` → `{ sortants: ProjectLink[], entrants: ProjectLink[] }`
- `POST /api/projects/:id/links` → crée un lien depuis ce projet
- `PATCH /api/project-links/:id` → modifie les champs libres et le recoupement
- `DELETE /api/project-links/:id`

Tous filtrent sur l'utilisateur courant, et une ressource d'autrui est **introuvable**, pas interdite.

## L'usage à la génération

Le flux en trois étapes ne change pas de forme. Il gagne une étape zéro.

**Étape zéro — la proposition.** `GET /api/campaigns/articulation?projectId=N` rend, pour la marque visée : ses liens (sortants et entrants), et pour chaque marque liée, ses campagnes de statut `draft`, `active` ou `running` — les `completed` sont exclues — avec leur `name`, `objective`, `coreMessage` et les angles tirés de `phases`. Si la réponse est vide, l'interface n'affiche rien et la génération suit son cours inchangé.

Si elle n'est pas vide, l'interface annonce le lien et propose : articuler avec une campagne nommée, ou rester indépendante. Le choix s'écrit sur la campagne au moment de sa création (étape 3 du flux existant), dans l'une des deux colonnes ajoutées.

**Ce qui entre dans le prompt quand l'articulation est choisie** — borné, et dans un champ **dédié**, jamais dans `weekContext` :

- le nom, l'objectif, le message central et les angles par phase de la campagne liée ;
- le rôle amont, le rôle aval et la nature du lien ;
- une consigne explicite : construire en écho, pas en répétition, et **ne jamais parler à la place de l'autre marque**.

Ce qui n'entre **pas** : l'ADN de la marque liée, sa mémoire, ses observations de réception. Connaître la relation n'est pas partager la matière.

> `weekContext` décrit la semaine de l'utilisatrice. Y mélanger l'articulation entre marques brouillerait les deux et rendrait le prompt illisible dans six mois. D'où le champ dédié.

## L'alerte au placement

**Déclenchement.** Quand un contenu reçoit une valeur de `scheduledFor` — à la création comme à la modification, qu'il vienne d'une génération ou d'une saisie manuelle — et que sa marque porte un lien dont `audiencesRecoupent` est vrai, on rassemble les contenus programmés sur la ou les marques liées dans une fenêtre de **±7 jours** autour de cette date.

**Le jugement.** Un seul appel `CLAUDE_MODELS.fast`, avec le titre et le corps du contenu qu'on programme et ceux des contenus de la fenêtre, et une seule question : servent-ils le même angle ? Sortie : l'identifiant du contenu qui recoupe et une phrase disant en quoi, ou rien.

**Pourquoi un appel modèle plutôt qu'une comparaison d'embeddings**, alors que `embedText` et pgvector sont disponibles : ce qu'on cherche est une collision d'**angle**, pas une ressemblance de texte. Deux posts peuvent ne partager aucun mot et dire la même chose ; ou partager tout leur vocabulaire et dire l'inverse. Un embedding mesure la première chose. La voie embedding demanderait en plus de stocker des vecteurs par contenu — une colonne ou une table de plus — là où un appel Haiku juge la bonne chose pour un coût négligeable.

**L'alerte ne bloque jamais.** Elle nomme le contenu qui recoupe, sa marque et sa date, et le placement se fait quand même. Elle ne s'affiche **que** s'il y a recouvrement : pas de message « aucun conflit détecté », qui serait du bruit. Best-effort de bout en bout : un appel modèle en échec ne fait pas échouer la programmation, il la laisse passer en silence et journalise.

## Critères d'acceptation

- [ ] `npm run build` vert, `npx tsc --noEmit` à **zéro** erreur, et les 1444 tests existants inchangés.
- [ ] Migration générée, relue à la main, appliquée sur dev. Jamais de `db:push`.
- [ ] Un lien ne peut pas relier une marque à elle-même.
- [ ] Un lien vers un projet qui n'appartient pas à l'utilisateur rend **404**, et la réponse est indiscernable de celle d'un projet inexistant.
- [ ] Les liens sont visibles, modifiables et supprimables depuis la page projet, dans les deux sens.
- [ ] Sans lien déclaré, la génération d'une campagne est **strictement identique** à ce qu'elle est aujourd'hui : aucune étape zéro, aucun champ ajouté au prompt.
- [ ] Avec un lien, l'articulation est **proposée** et jamais imposée ; le choix est persisté et la question ne revient pas sur une campagne marquée indépendante.
- [ ] L'ADN, la mémoire et les observations de la marque liée n'entrent **jamais** dans le prompt — vérifiable par un test sur le contenu du prompt assemblé.
- [ ] L'articulation passe par un champ dédié, et `weekContext` n'est pas modifié.
- [ ] L'alerte de collision ne se déclenche que si un lien existe **et** que `audiencesRecoupent` est vrai.
- [ ] L'alerte ne bloque jamais la programmation, et un appel modèle en échec la laisse passer.
- [ ] Aucun message n'est affiché quand il n'y a pas de collision.
- [ ] Aucun compteur, aucune relance, aucune formulation de reproche dans les textes ajoutés.

## Risques et inconnues

**La qualité du jugement de collision.** Aucun test automatique ne peut dire si « même angle » est correctement apprécié. Il faut une période d'usage réel avant de figer le prompt, et un seuil de tolérance : une alerte qui se déclenche à tort est plus coûteuse qu'une collision manquée, parce qu'elle apprend à ignorer les alertes.

**La conséquence de la Décision 5.** Naya générera parfois un angle qui recoupe l'autre marque. À mesurer à l'usage : si la friction est réelle, la contrainte à la génération s'ajoute en une ligne de prompt, sans rien changer d'autre.

**Le volume de contenus dans la fenêtre.** Avec beaucoup de contenus programmés sur une marque liée, le prompt de jugement grossit. À borner — un plafond de contenus comparés, et un journal de ce qui a été écarté.

## Découpage

Trois sous-projets, dont celui-ci est le premier :

1. **Les liens entre marques** (ce document) — le socle : Naya apprend quelles marques sont liées, comment, et s'en sert.
2. **La saisie manuelle par marque** — un endroit pour écrire ses propres posts et campagnes, et pour coller un grand texte décrivant tout un calendrier de contenu, que Naya ingère et comprend.
3. **La curation du généré** — rejeter une campagne produite, supprimer pour une marque en particulier, compléter ce qui existe.

L'ordre est celui-là parce que les liens changent le *sens* des deux autres : un post écrit à la main pour JMD peut devoir s'articuler avec Jeanne, et rejeter une campagne pour une marque a des conséquences sur la marque liée. Chaque sous-projet a son propre cycle spec → plan → implémentation.

## Migration

Procédure de `MIGRATIONS.md` : `drizzle-kit generate`, relecture du SQL à la main, `migrate` sur dev. Jamais de `db:push`. L'application en production est une étape manuelle et décidée, avec une sauvegarde Neon avant.
