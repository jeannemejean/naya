# RÉVISION — Lot 3C : l'arbitre en deux temps

> **Remplace le §5 de `BRIEF-PHASE-3-RECEPTION-ARBITRAGE.md`.** Le point d'arrêt §5.0 du brief initial est annulé : il n'y a pas de politique de pondération à concevoir dans le premier lot.
> Motif : à la fin du lot 3B, le Fil 3 a un pipeline et **zéro mesure** — aucune réception saisie, aucune conversion déclarée. Écrire une politique d'arbitrage dans cet état, c'est figer un jeu d'hypothèses au moment précis où rien ne permet de les tester. C'est le raisonnement retenu pour l'attribution (`NOTE-DECISION-ATTRIBUTION.md` §6), appliqué ici.

---

## 5.0 Dette à solder AVANT d'ouvrir 3C-1

Deux contrôles, tirés de ce que le lot 3B a révélé. Sans eux, 3C reproduira les mêmes incidents.

### a) Une CI qui bloque — **fait**

Pendant 3B, la version naïve du calcul d'attribution — le bug que le lot entier existe pour empêcher — s'est retrouvée dans l'arbre de travail après la mort d'un agent, et n'a été rattrapée que parce qu'un humain a lu le diff. Relire n'est pas un contrôle.

`.github/workflows/ci.yml` est en place : typecheck, tests, et une garde structurelle qui vérifie qu'aucun fichier hors liste ne touche `creditWeight`. La liste actuelle — `attribute.ts` (seul producteur), `storage.ts` (écrit et relit), `ingest.ts` (commentaire), `shared/schema.ts` (colonne) — a été établie en lisant chaque occurrence. **Tout ajout à cette liste est une décision consciente, pas un contournement d'échec CI.**

### b) « Non mesuré » ≠ « mesuré à zéro », en type et non en consigne

La distinction a dû être rattrapée quatre fois en deux lots : score 3A, parseur CSV, frontière HTTP, couture 3A↔3B. Chaque fois, quelqu'un écrit `|| 0` ou `coalesce(…, 0)` parce que c'est plus court que de porter un `null` jusqu'au bout. Consigner la règle en mémoire est le contrôle le plus faible qui existe : la mémoire est un conseil, un type est une contrainte. Il y aura une cinquième occurrence en 3C si rien ne change.

Deux niveaux, dans cet ordre :

1. **Immédiat — une règle de lint.** Interdire `|| 0` et `?? 0` sur les champs de mesure (`saves`, `shares`, `comments`, `reach`, `sentimentScore`, le crédit d'attribution) et `coalesce(…, 0)` sur ces colonnes en SQL. Une règle `no-restricted-syntax` suffit ; le message d'erreur cite la règle du Fil 3.
2. **Ensuite — un type qui ne se coerce pas.** Un `Measured<T> = { value: T } | { unmeasured: true }` (ou un type nominal équivalent) sur les entrées de `score.ts` et sur la couture 3A↔3B, de sorte qu'un `0` fabriqué **ne compile pas**.

---

## 5.1 LOT 3C-1 — L'arbitre observateur

**Constructible maintenant. Il détecte et journalise les conflits entre fils. Il ne tranche pas, et il ne change rien à ce que Naya produit.**

### Architecture

```
server/services/arbitration/
├── conflict.ts        ← détection de conflit — PUR, testé sans base ni modèle
├── observer.ts        ← rassemble les slivers, appelle conflict.ts, journalise
└── arbitration.test.ts
```

Plus la table `arbitration_log` de `SCHEMA-TRIANGULATION.md` §D.2, avec deux nuances pour cette étape :

- `dominantFil` reste **NULL** — aucune décision n'est prise ;
- `rationale` décrit **le conflit observé**, jamais une résolution.

### Les types de conflit — liste fermée

`conflict.ts` ne détecte que ces quatre cas. **Aucune invention de nouveau type sans validation.**

| Type | Ce qu'il signale |
|---|---|
| `cap_vs_reception` | Le positionnement pousse un registre que la réception mesurée contredit — mesurée **contre son intention**, jamais en valeur brute. |
| `cap_vs_founder` | La marque demande une cadence ou un registre que les préférences, le rythme ou l'énergie du fondateur contredisent. |
| `founder_vs_reception` | Ce qui est bien reçu exige un mode de travail que le fondateur évite systématiquement. |
| `donnee_absente` | Un fil nécessaire à la décision n'a aucune entrée exploitable. **C'est un conflit de première classe, pas un cas d'erreur** — et ce sera le plus fréquent au début. Il se journalise, il ne se filtre pas. |

### Exécution

- L'observateur tourne sur le chemin de **génération de contenu** uniquement, en best-effort, **après** la génération.
- **Contrainte dure : la sortie produite doit être identique, observateur activé ou non.** C'est un test de non-régression, pas une intention.
- Une route de lecture `GET /api/arbitration/log` (filtrable par marque et par type) pour que le journal soit lisible sans requête SQL. Pas d'écran dédié à ce stade.

### Critères d'acceptation 3C-1

- [ ] `npm run build`, `npm run check` et `npx vitest run` verts ; la CI passe et bloque en cas d'échec.
- [ ] `conflict.ts` est pur et testé sans base ni appel modèle, sur les quatre types.
- [ ] `grep` : **aucun poids, aucune priorité entre fils nulle part** dans le code. Si un nombre pondère un fil, le lot est hors périmètre.
- [ ] Test de non-régression : la génération de contenu rend exactement la même sortie, observateur activé ou non.
- [ ] `donnee_absente` est journalisé, avec le nom du fil manquant.
- [ ] Un échec d'écriture du journal ne casse aucune génération.
- [ ] `dominantFil` est NULL sur toutes les lignes produites par ce lot.

---

## 5.2 LOT 3C-2 — La politique

**Porte d'entrée : au moins 30 conflits réels journalisés, sur au moins 2 marques.** Pas d'estimation, pas d'exception — la requête de comptage est la condition d'ouverture du lot.

Quand la porte s'ouvre, la note de décision se rédige **à partir du journal**, pas de trois exemples inventés :

1. lire les 30 conflits, les regrouper par type et par marque ;
2. pour chacun, écrire ce que la politique *devrait* trancher et pourquoi — c'est là que l'expertise de Jeanne vaut plus que n'importe quel modèle ;
3. en déduire la table de politique (contexte de décision × poids par fil × règle de départage) ;
4. **valider**, puis coder `policy.ts`.

Alors seulement : l'arbitre tranche, `dominantFil` et `rationale` se remplissent, `confidence` devient significatif, et le verdict est injecté dans le contexte avant la génération.

**Règle absolue, inchangée : aucun poids, aucune priorité entre fils ne vit ailleurs que dans `policy.ts`.** Un « privilégie la réception » écrit dans un prompt est une régression, pas un raccourci.

---

## 5.3 Ce que ce découpage achète

L'arbitre initial aurait répondu « je manque de donnée de réception » à presque chaque appel, et sa politique aurait été calibrée sur des cas imaginés. En observant d'abord, on obtient la matière première de la décision — des conflits qui se sont réellement produits, sur de vraies marques — avant d'écrire la règle qui les tranche.

Et la fréquence du type `donnee_absente` dans le journal dira, chiffres à l'appui, quand le Fil 3 est assez nourri pour qu'un arbitre serve à quelque chose. C'est une réponse mesurée à une question qui, sinon, se règle à l'intuition.
