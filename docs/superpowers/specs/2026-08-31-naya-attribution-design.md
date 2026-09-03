# Fil 3 — LOT 3B : l'attribution multi-touch — design

**Date :** 2026-08-31
**Brief source :** `BRIEF-PHASE-3-RECEPTION-ARBITRAGE.md` §4 (LOT 3B)
**Décisions :** `NOTE-DECISION-ATTRIBUTION.md` §0 — le point d'arrêt §4.0 est **levé**
**Migrations :** `MIGRATIONS.md` — état réel des bases et procédure
**Périmètre :** LOT 3B uniquement. **Pas 3C** — son point d'arrêt §5.0 attend toujours une validation.

## Ce qu'on construit

Une conversion est un **signal lent de marque**, pas un applaudissement de post. Elle est créditée à la **fenêtre de contenus qui l'a précédée**, pondérée — jamais au dernier post publié.

Ce lot livre : les deux tables de conversion, la fonction pure qui répartit le crédit, la saisie manuelle d'une conversion, la fenêtre réglable par marque, et le rebouclage vers 3A — le score de réception reçoit enfin son `conversionsInWindow` réel.

## Les trois arbitrages actés — non rediscutés

Repris de `NOTE-DECISION-ATTRIBUTION.md` §0, pour être lisibles ici sans changer de fichier :

1. **Pondération : linéaire uniforme.** Chaque contenu de la fenêtre reçoit `1/n`. À implémenter comme un **défaut provisoire nommé comme tel dans le code**, avec les conditions de bascule du §6 de la note écrites **au même endroit** — pas dans un ticket, pas ailleurs.
2. **Fenêtre réglée par marque dès maintenant.** Défaut 30 j pour les nouveaux projets ; **60 j pour l'Agence JMD**, **14 j pour les marques B2C**. Migration de données ponctuelle, relue avant application, et la valeur **reste éditable depuis les réglages du projet**.
3. **Règle de bord inclusive.** Un contenu publié exactement à `J − attributionWindowDays` **est dans la fenêtre**. Le test l'écrit explicitement, **aux deux bornes**.

Les conditions de bascule vers l'exponentiel, à inscrire dans le code : au moins 20 conversions attribuées sur au moins 2 marques, **et** un écart mesurable entre l'âge médian des contenus des fenêtres qui ont converti et de celles qui n'ont pas converti. Sinon on ne bascule pas, quelle que soit l'intuition.

## État vérifié du code (31 août 2026)

Vérifié par lecture directe sur la branche `reception-fil3`, pas repris d'une description :

| | |
| --- | --- |
| `content_reception` | existe, avec `receivedVsIntentScore`, `confidence`, `rationale`, unique `(content_id, platform, measured_at)` ✓ |
| `projects.attribution_window_days` | existe, `integer` défaut 30, **lue par personne** ✓ |
| `ScoreInput.conversionsInWindow` | déjà typé `number \| null` — 3A passe `null` (non mesuré) ✓ |
| `ingest.ts` | passe `conversionsInWindow: null` avec le commentaire qui l'explique ✓ |
| `storage.upsertContentReception` | renvoie `{ inserted }` via `RETURNING (xmax = 0)` ✓ |
| Tables 3B | **aucune** — `brand_conversions`, `conversion_attributions` absentes ✓ |
| Projets sur dev-local | 6 : Agence JMD (1), Jeanne Mejean (2), Encore Merci (3), Naya (4), Test Jalons (5), Test Cascade (6) — tous à 30 j |

**⚠️ `PATCH /api/projects/:id` a une liste blanche** (`ALLOWED_PROJECT_PATCH_FIELDS`, `server/services/project-fields.ts`). Sans y ajouter `attributionWindowDays`, rendre la fenêtre éditable ne ferait **silencieusement rien**.

**⚠️ Le lot 3A n'est pas dans `main`** (`main` = `754d2d6`, `score.ts` absent). Il vit sur `reception-fil3`. Cette branche part donc de `reception-fil3`, sans quoi 3B n'aurait ni `content_reception` ni score à alimenter.

## Décisions de conception

Le brief donne les règles, pas toutes les valeurs. Ces choix sont isolés pour pouvoir bouger seuls.

### H1 — `conversionsInWindow` est une **somme de crédits**, pas un compte *(hypothèse)*

Le brief ne dit pas ce que ce nombre compte. Deux lectures possibles : le nombre de conversions auxquelles ce contenu a participé, ou la somme des crédits qu'il a reçus.

**Retenu : la somme des `creditWeight`** de toutes les lignes `conversion_attributions` de ce contenu. C'est une valeur fractionnaire — un contenu peut avoir « 0,6 conversion ».

Raison : le §5.3 du brief interdit explicitement « ce post a converti X ». Un compte entier dirait exactement cela. La somme des crédits dit « ce post a participé à hauteur de 0,6 » — c'est la seule formulation compatible avec le principe multi-touch, et c'est ce que le schéma stocke déjà.

### H2 — La somme vaut **exactement** 1 par construction *(hypothèse)*

`1/3 + 1/3 + 1/3` ne fait pas `1` en virgule flottante. Le brief exige pourtant « la somme des poids d'une conversion vaut exactement 1 », testé.

**Retenu : les `n−1` premiers contenus reçoivent `1/n`, le dernier reçoit `1 − somme des précédents`.** Le résidu d'arrondi est absorbé par un seul contenu, la somme est exacte par construction, et l'écart au `1/n` théorique est de l'ordre de 10⁻¹⁶ — invisible. Le test assert l'égalité stricte à 1 **et** que chaque poids reste à moins de 10⁻⁹ de `1/n`.

### H3 — Appartenance à la fenêtre *(hypothèse sur les bornes non nommées)*

Un contenu est dans la fenêtre d'une conversion si : il appartient à la **même marque**, il est **publié** (`publishedAt` non nul), et `publishedAt ∈ [convertedAt − windowDays, convertedAt]`.

Les **deux bornes sont inclusives** — la borne basse par décision actée n°3, la borne haute par symétrie (un contenu publié à l'instant exact de la conversion en fait partie). Le test écrit les deux.

L'intention du contenu n'entre pas en compte : tout contenu publié de la marque compte, quelle que soit son intention. C'est ce qui permet ensuite de mesurer *quelle intention* a porté la conversion.

### H4 — La migration de données ne touche que les marques **nommées** *(hypothèse)*

La décision nomme explicitement l'Agence JMD (60 j) et « Encore Merci et assimilées » (14 j). Elle ne nomme ni Jeanne Mejean, ni Naya, ni les projets de test.

**Retenu : la migration ne fixe que les deux marques nommées** — Agence JMD → 60, Encore Merci → 14. Toutes les autres gardent 30 j.

Raison : « et assimilées » invite à deviner le cycle commercial d'une marque, ce qui est précisément le genre de supposition silencieuse que ce projet refuse. Comme la fenêtre devient éditable dans les réglages du projet dans ce même lot, corriger Jeanne Mejean ou Naya est affaire de deux clics — et c'est un jugement métier, pas un défaut technique.

### H5 — Pas de port pour les conversions *(hypothèse)*

Le §4.2 tient en une phrase : « Une conversion se déclare à la main […] Pas de connecteur Stripe dans ce lot — le port existe, l'adaptateur viendra. »

**Retenu : une route de déclaration et un écran, sans abstraction de port.** Le port de 3A (`ReceptionSource`) existe parce que l'ingestion réseau était structurellement bloquée et qu'il fallait prouver que le blocage n'empêchait rien. Rien de tel ici : la saisie manuelle est le mode nominal, et une conversion Stripe future arrivera par un webhook, pas par un `fetch` que quelqu'un déclenche. Fabriquer une interface à une seule implémentation serait de l'abstraction prématurée.

### H6 — Le recalcul périme aussi les souvenirs devenus faux *(ajout au §4.3, à confirmer)*

Le §4.3 demande de recalculer les scores existants une fois. **Il ne parle pas des entrées mémoire.**

Or 3A n'écrit une entrée `memory_entries` qu'à l'**insertion** d'une mesure (la garde qui a tué la duplication). Un recalcul, qui fait des `UPDATE`, n'en écrira donc aucune — et les entrées déjà présentes continueront d'affirmer les scores d'avant 3B, avec la salience la plus haute du fil `reception`, indéfiniment.

**Retenu : quand un score change matériellement (écart > 0,05), le script périme l'entrée mémoire correspondante (`superseded_at`) et en écrit une nouvelle avec la phrase corrigée.** C'est le mécanisme déjà utilisé par `memory/extract.ts`, pas une invention.

C'est un ajout au périmètre littéral du §4.3. S'il n'est pas voulu, le retirer ne casse rien d'autre — mais la mémoire mentira.

## Architecture

### Le schéma

Conforme à `SCHEMA-TRIANGULATION.md` §C.3 :

```
brand_conversions        id, project_id→projects, converted_at, conversion_type,
                         value, attribution_window_days (FIGÉ), created_at
conversion_attributions  id, conversion_id→brand_conversions, content_id→content,
                         credit_weight
```

`attribution_window_days` est **figé sur la ligne de conversion** au moment du calcul. Modifier `projects.attribution_window_days` plus tard ne doit **rien** changer aux attributions passées : c'est un test.

`conversion_attributions` porte un **UNIQUE (`conversion_id`, `content_id`)** — un contenu ne peut pas être crédité deux fois pour la même conversion, quelle que soit la manipulation.

### La fonction pure

`server/services/attribution/attribute.ts` :

```typescript
attribute(conversion, contentsInWindow, policy) → { contentId, creditWeight }[]
```

Aucune base, aucune horloge, aucun appel modèle. **En tête du fichier, en commentaire** : l'interdit de last-touch et sa raison, comme l'exige le §4.1.

La sélection des contenus de la fenêtre est elle aussi pure et testée séparément (`contentsInWindow`), pour que la règle de bord inclusive soit vérifiable sans base.

Une fenêtre vide renvoie `[]`. La conversion existe, elle n'est créditée à personne. **Aucun rattachement forcé.**

### Le recalcul idempotent

`attributeConversion(conversionId)` : dans une transaction, supprime les lignes existantes de cette conversion, recalcule, réinsère. Rejouer remplace, n'ajoute jamais.

### La saisie

`POST /api/conversions` — `{ projectId, convertedAt, conversionType, value? }`. Au moment de l'écriture, la fenêtre de la marque est **lue et figée** sur la ligne, puis l'attribution est calculée. `GET /api/conversions?projectId=` liste avec leurs crédits.

Écran : une déclaration de conversion depuis la page projet, et la restitution de ce qu'elle a crédité — **en fractions de fenêtre**, jamais « ce post a converti X ».

### La fenêtre éditable

Champ dans les réglages du projet, **et `attributionWindowDays` ajouté à `ALLOWED_PROJECT_PATCH_FIELDS`** — sans quoi l'édition ne fait rien.

### Le rebouclage vers 3A

- `ingest.ts` passe désormais le `conversionsInWindow` réel (H1) au lieu de `null`.
- Un script idempotent recalcule une fois les `content_reception` existantes, et périme les souvenirs devenus faux (H6).

## Migrations

Suit `MIGRATIONS.md` :

- **Dev-local uniquement.** La production n'a **toujours pas** de table de suivi Drizzle : tant que la baseline du §3 n'est pas posée, **aucune migration ne part en prod**, et `db:push` sur la prod reste interdit.
- Migration de schéma générée par `drizzle-kit generate`, **SQL relu** avant application.
- Migration de **données** (les deux fenêtres nommées) écrite à la main, relue, appliquée séparément — elle touche des lignes existantes, elle mérite d'être lisible seule.
- Pas de migration au démarrage du serveur.

## Tests

Fonctions pures d'abord, conformément à la discipline du dépôt :

- `attribute` — somme **exactement** égale à 1 sur 1, 2, 3, 5 et 7 contenus ; fenêtre vide → `[]` ; poids uniformes à 10⁻⁹ près ; aucun contenu ne reçoit 100 % quand il y en a plusieurs (**anti-last-touch, testé comme tel**).
- `contentsInWindow` — bornes **inclusives des deux côtés** ; un contenu publié la veille de la borne basse est **exclu** ; un contenu non publié est exclu ; un contenu d'une autre marque est exclu.
- Gel de la fenêtre — modifier `projects.attribution_window_days` après coup ne change aucune attribution passée.
- Idempotence — rejouer l'attribution d'une conversion laisse le même nombre de lignes.
- Le recalcul des scores 3A — idempotent, et un contenu d'intention `conversion` voit bien son score bouger quand des conversions lui sont créditées.

## Critères d'acceptation (§4.4 du brief)

- [ ] Note de décision produite et validée avant tout code — **faite** (`NOTE-DECISION-ATTRIBUTION.md` §0).
- [ ] `attribute()` pure et testée ; somme des poids = 1 sur tous les cas ; fenêtre vide gérée.
- [ ] Fenêtre figée sur la conversion : modifier `projects.attribution_window_days` ne change aucune attribution passée.
- [ ] Recalcul idempotent vérifié par test.
- [ ] Aucun chemin de code ne peut produire une attribution last-touch — et le commentaire l'explique.
- [ ] Les scores 3A intègrent les conversions et ont été recalculés une fois.

## Hors périmètre

Pas de 3C : ni `arbitration_log`, ni politique de pondération entre fils, ni arbitre — le point d'arrêt §5.0 tient. Pas de connecteur Stripe. Pas d'ingestion concurrent. Pas de refonte de la page Analytics. Aucune migration en production.
