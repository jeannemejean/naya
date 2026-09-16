# La mémoire de Naya — ce qu'elle a compris ne se perd plus — design

**Date :** 2026-09-16
**Origine :** Jeanne — « il faut absolument un stockage à Naya », après le constat qu'une observation énoncée une seule fois, à l'instant où elle change, est perdue si la notification n'est pas vue.
**Périmètre :** serveur uniquement. Aucun écran, aucun mobile.

## Le problème

Le lot « capter le résultat » a livré un retour immédiat qui ne parle **que quand l'observation change** (arbitrage de Jeanne). Sans mémoire, c'est une machine à oublier : l'observation est dite une fois, au moment précis où elle bascule, et si l'utilisatrice ne voit pas passer la notification — écran verrouillé, téléphone dans une poche — elle est perdue pour de bon. Elle ne sera pas répétée, puisqu'elle n'aura plus « changé ».

## Ce que la vérification a changé à la conception

Interrogation du code et de la **production** avant toute décision — la leçon de l'incident des migrations :

| Constat | Conséquence |
| --- | --- |
| La table `memory_entries` **existe en production**, avec `fil`, `entryType` (dont `observation`), `salience`, `embedding`, `supersededAt` | On ne crée pas de table. On branche. |
| Son commentaire : « bi-temporel : périmé = invalidé, pas supprimé » | La discipline du dépôt y est déjà inscrite. |
| `retrieveMemories` filtre sur `superseded_at IS NULL` | L'invalidation suffit à retirer une observation de l'injection. |
| Le scoring est **additif**, pas multiplicatif — « ne s'effondre pas quand un facteur est proche de 0 » | Une observation sans embedding reste retrouvable par importance et fraîcheur. |
| `embedText` renvoie `null` en cas d'échec, sans lever | On n'écrit jamais rien de perdu à cause d'un appel d'embedding raté. |
| `buildNayaContext` injecte déjà cette mémoire dans **chaque** appel IA | Rien à brancher côté lecture : dès que les observations y sont, Naya s'en sert partout. |
| `buildImmediateInsight` sait faire **deux** observations mais n'en renvoie qu'**une** | Il faut séparer l'observation de sa formulation. |
| `reception/recompute.ts` identifie déjà une mémoire recalculable par **préfixe de contenu**, et la remplace par `replaceMemoryEntry` en transaction | On suit cette convention. **Aucune migration.** |

**La table contenait déjà, en production, une entrée `founder/observation`.** Le fil existe et fonctionne.

## Décisions actées avec Jeanne

1. **La mémoire nourrit Naya elle-même**, elle ne sert pas seulement à relire. Les observations rejoignent ce que `buildNayaContext` injecte dans chaque appel IA.
2. **Plusieurs observations coexistent.** Naya accumule une connaissance de l'utilisatrice, elle ne tient pas une seule pensée courante.
3. **Une observation périmée est invalidée, jamais supprimée.**

## Architecture

### §1 — Séparer l'observation de sa formulation

`buildImmediateInsight` **ne change pas**. Elle continue de rendre une phrase unique pour le retour immédiat ; ce comportement est validé et son test l'est aussi.

À côté, une **nouvelle fonction pure** rend **toutes** les observations que les données permettent, sous forme structurée : la règle qui les produit, leur sujet, et leur formulation. La phrase devient de la présentation ; l'observation devient un fait.

C'est ce qui rend l'accumulation possible. Aujourd'hui la fonction s'arrête à la première observation trouvée — la règle « catégorie » masque la règle « matin / après-midi ». Une mémoire qui accumule doit voir les deux.

### §2 — L'identité d'une observation

Chaque observation porte une identité : **la règle qui l'a produite, plus son sujet**.

- règle « catégorie » + le nom de la catégorie → une identité par catégorie ;
- règle « moment de la journée » → une seule identité, le sujet étant global.

Une nouvelle observation invalide **celle de même identité**, et elle seule. « La catégorie *admin* ne passe pas » et « la catégorie *créatif* ne passe pas » coexistent ; une nouvelle observation sur *admin* ne touche pas *créatif*.

Sans cette identité, seules deux conduites sont possibles, et toutes deux sont mauvaises : tout invalider à chaque écriture, ou ne jamais rien invalider — donc énoncer un jour, avec le même aplomb, quelque chose qui a cessé d'être vrai.

**Révision du 2026-09-16, découverte en écrivant le plan : aucune migration n'est nécessaire.**

Le dépôt a déjà une convention pour identifier une mémoire recalculable — `server/services/reception/recompute.ts` : l'identité est portée par un **préfixe de contenu** en langage naturel, retrouvé par `findActiveMemoryEntry({ userId, fil, entryType, contentPrefix })`, et le remplacement passe par `replaceMemoryEntry(oldEntryId, newEntry)`, qui invalide et réinsère **dans une transaction**. On suit cette convention plutôt que d'ajouter une colonne : un dépôt tenu par une seule personne gagne plus à la cohérence qu'à la pureté.

**Le piège que cela introduit, et sa parade.** La règle « matin / après-midi » produit **deux formulations** pour un **même** sujet — « le matin se fait, l'après-midi décroche » ou l'inverse. Un préfixe tiré de la phrase ne les rapprocherait pas : basculer de l'une à l'autre créerait un doublon au lieu d'un remplacement, et Naya se souviendrait des deux affirmations contraires.

La parade tient au §1 : le texte **mémorisé** n'a aucune obligation d'être celui de la notification. Chaque sujet reçoit donc un **préfixe stable**, tiré d'une **constante exportée** et non recomposé à la main à chaque appel — « Les tâches « <catégorie> » : … », « Ton rythme dans la journée : … ». Les deux formulations du moment partagent ainsi le même préfixe.

**Limite assumée :** l'identité par préfixe est moins robuste qu'une colonne — une reformulation future qui toucherait le préfixe casserait l'appariement et produirait un doublon au lieu d'une invalidation. D'où l'obligation de la constante, et un test qui vérifie que **toutes** les formulations d'un même sujet la partagent.

### §3 — L'écriture

À chaque réponse, pour chaque observation que les données permettent :

- **identité absente de la mémoire vivante** → on écrit ;
- **identité présente, contenu identique** → on ne fait rien (pas de doublon, pas de réécriture) ;
- **identité présente, contenu différent** → on invalide l'ancienne (`supersededAt`) et on écrit la nouvelle.

L'écriture est **au mieux sur l'embedding** : `embedText` peut rendre `null`, et dans ce cas l'observation est **quand même** écrite. Perdre une observation parce qu'un appel réseau a raté serait exactement le défaut que toute cette feature existe pour corriger. Un embedding absent signifie « non vectorisé », jamais « vecteur nul » — et le scoring additif du module la garde retrouvable.

**Une écriture qui échoue ne doit jamais faire échouer la réponse de l'utilisatrice.** Elle a répondu ; cette réponse est la donnée précieuse. La mémoire est un bénéfice, pas une condition.

### §4 — La salience

`salience` pondère l'importance dans le scoring. Une observation adossée à beaucoup de réponses est plus solide qu'une observation au seuil minimal. La salience se dérive donc du **nombre d'observations qui la fondent**, bornée, avec une constante exportée et documentée comme défaut révisable — jamais un nombre au milieu de la logique.

### §5 — Ce qui n'est pas touché

La récupération, le scoring, `buildNayaContext`, le retour immédiat, et les mémoires issues de captures. Ce lot **ajoute une source** à un système qui fonctionne ; il n'en modifie pas le fonctionnement.

## Ce qu'on ne construit pas

- **Aucun écran.** Jeanne a explicitement choisi « nourrir Naya » plutôt que « un journal à relire ». Le journal viendra dans un lot séparé si elle le veut, et il lira ce que celui-ci écrit.
- **Aucune modification de `buildImmediateInsight`** ni de son test.
- **Aucun nouveau mécanisme de récupération.**
- **Aucune observation sur les durées.** `actualDuration` n'est toujours pas mesurée ; rien ne doit en dépendre.

## Tests

Fonctions pures d'abord, conformément à la discipline du dépôt.

- **L'extraction des observations :** aucune donnée → liste vide ; données suffisantes pour une seule règle → une observation ; données suffisantes pour les deux → **deux** observations, et un test doit tomber si la fonction s'arrête à la première ; une catégorie inconnue n'est jamais citée ; le seuil de `MIN_OBSERVATIONS` est respecté par chaque règle indépendamment.
- **L'identité :** deux catégories différentes produisent deux identités différentes ; la même catégorie produit la même identité d'une exécution à l'autre ; la règle « moment » produit une identité stable.
- **La décision d'écriture :** identité absente → écrire ; identité présente et contenu identique → ne rien faire ; identité présente et contenu différent → invalider puis écrire. Cette décision doit être une **fonction pure**, testée sans base.
- **La robustesse :** un embedding à `null` n'empêche pas l'écriture ; un échec d'écriture n'empêche pas la réponse de l'utilisatrice d'aboutir.

Chaque test doit être **discriminant** : pour chacun, nommer le bug qui le ferait tomber. Sept tests du lot précédent se sont révélés creux — un cas impossible, une graine qui ne déclenchait jamais rien, une vérification voisine de celle annoncée. La règle retenue depuis : ne pas affirmer qu'un test est discriminant, le **prouver par mutation**.

## Critères d'acceptation

- [ ] Une observation énoncée est retrouvable plus tard, même si la notification n'a pas été vue.
- [ ] Deux observations sur des sujets différents coexistent.
- [ ] Une observation sur le même sujet en remplace une seule — la sienne.
- [ ] Une observation périmée n'est plus injectée, et reste consultable en base.
- [ ] Un embedding indisponible n'empêche jamais l'écriture.
- [ ] Un échec d'écriture n'empêche jamais la réponse de l'utilisatrice d'aboutir.
- [ ] `buildImmediateInsight` et son test sont inchangés.
- [ ] **Aucune migration** : la feature s'appuie sur la convention de préfixe déjà en place.
- [ ] Toutes les formulations d'un même sujet partagent le préfixe, tiré d'une constante exportée.
- [ ] `npx tsc --noEmit -p tsconfig.json` silencieux, `npx vitest run` vert sous deux fuseaux éloignés.
