# Conception — Le suivi d'objectif → résultat (la variable de sortie)

> Le seul point urgent et non-discutable : capter le **résultat** des objectifs, pas seulement l'état des tâches. C'est la variable de sortie du flywheel, et le seul moat *candidat* de Naya (voir `STRATEGIE-DONNEES-ET-POSITIONNEMENT.md`).
> Cette note pose le problème et la décision AVANT le schéma. Elle n'est pas un brief d'exécution — il y a un choix produit à trancher (Jeanne) avant de coder.

---

## 1. Ce qu'on veut, et pourquoi

Pour chaque objectif déclaré (« signer 3 clients en 6 mois », « 5000 abonnés en 1 an »), on veut la **trajectoire du résultat dans le temps** : baseline → jalons datés → atteint/raté à l'échéance.

À terme, chaque objectif clôturé devient un **exemple labellisé** :
`(contexte : ce fondateur + cette marque + ces tâches faites + cette réception) → (résultat : trajectoire, atteint/raté, en combien de temps)`.

C'est la donnée causale que personne ne peut acheter dehors. Sans elle, le compteur de l'IA prédictive ne démarre jamais. C'est pour ça que ça doit exister **avant le premier utilisateur externe**.

---

## 2. LE VRAI PROBLÈME : capter le résultat SANS friction

Le piège évident : faire demander à Naya « alors, tu as signé ? » tous les trois jours. Résultat garanti : bruité, oublié, agaçant, l'utilisateur décroche — et la donnée est fausse (auto-report rétrospectif flatteur). **L'auto-report naggy est la pire des solutions.**

### Principe de conception : inférer d'abord, confirmer léger, demander en dernier

Hiérarchie des sources, de la moins friction à la plus :

| Priorité | Source | Exemple d'objectif | Friction |
|----------|--------|--------------------|----------|
| 1 (idéal) | **Connecté / inféré automatiquement** | « 5000 abonnés » → compteur d'abonnés via l'API sociale (infra Phase 3, déjà prévue). « CA / paiements » → Stripe. | Zéro |
| 2 | **Adossé aux jalons existants** | « Signer 3 clients » → l'utilisateur marque un jalon « client signé » (Naya a déjà le système de jalons conditionnels). | Très faible |
| 3 | **Confirmation légère, bien timée** | Naya demande UNIQUEMENT quand un signal pertinent apparaît (ex. un jalon proche, une échéance) — pas sur un calendrier fixe. | Faible, ponctuelle |
| 4 (dernier recours) | **Auto-report libre** | L'utilisateur note un résultat quand il le veut. | Variable |

> La règle : **on ne demande que ce qu'on ne peut pas observer.** Un objectif d'audience se mesure tout seul (API). Un objectif de signature s'adosse à un jalon que l'utilisateur pose déjà dans son flux. La question directe est l'exception, pas la norme.

---

## 3. Décision à prendre (Jeanne) — AVANT le schéma

C'est ici que ton expertise vaut plus que n'importe quel modèle. Trois choses à trancher :

1. **Quels types d'objectifs on supporte en premier ?** (Audience/abonnés — le plus facile car auto-mesurable ? Signature/CA — le plus proche de ta valeur mais dépend d'un jalon ou d'un connecteur ?)
2. **Le mécanisme de capture par type** : quels objectifs peuvent être inférés (API/Stripe/jalons) vs lesquels exigeront une confirmation, et à quel moment Naya a le droit de demander sans être pénible ?
3. **La granularité de la trajectoire** : on capte chaque incrément (0→1→2→3, daté) ou seulement baseline + résultat final ? (L'incrément est plus riche pour l'entraînement, mais plus coûteux à capter.)

Une fois ces trois points tranchés, j'écris le brief d'exécution pour Claude Code.

---

## 4. Esquisse de schéma (indicative, à figer après la décision §3)

```
projectGoals (existant) — à étendre :
  targetMetric      : text     -- "clients_signés" | "abonnés" | "ca_eur" | ...
  targetValue       : numeric  -- 3 | 5000 | ...
  baselineValue     : numeric  -- point de départ, daté à la création
  deadline          : date     -- l'horizon
  outcomeSource     : text     -- "social_api" | "stripe" | "milestone" | "self_report"

goalProgressSnapshots (nouveau) :
  goalId            : fk
  value             : numeric  -- mesure à l'instant t
  capturedAt        : timestamp
  source            : text     -- d'où vient la mesure (traçabilité = honnêteté de la donnée)

-- L'exemple labellisé se forme à l'échéance :
--   contexte (au fil de l'objectif) → trajectoire (snapshots) → atteint/raté + temps réel.
```

## 5. Ce qui est volontairement laissé ouvert

- La capture sans friction n'est pas « résolue » — elle est **conçue** (inférer d'abord). Le réglage fin (quand Naya a le droit de demander) se fera sur usage réel.
- On ne prétend PAS que ça crée un moat aujourd'hui. Ça crée la **matière première** du seul moat candidat. Nuance importante, à ne pas re-glisser sous le tapis.

> Boussole : chaque objectif que Naya laisse se clôturer sans capter son résultat est un exemple d'entraînement perdu pour toujours. C'est ça, l'urgence — pas le schéma, la **capture**.
