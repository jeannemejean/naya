# SPEC D'ARCHITECTURE — Le moteur de triangulation (Naya Context Engine)

> Document d'architecture. Couvre les Phases 2 et 3. À lire avant d'écrire le moindre code de mémoire ou de réception.
> Il décrit le **quoi** et le **pourquoi** (le modèle de données et les principes). Les briefs d'exécution par phase en découleront.

---

## 0. Le principe central (à ne jamais perdre de vue)

Le cœur de Naya n'est pas l'ADN de marque. C'est le **croisement permanent de trois fils**, arbitrés à chaque décision :

| Fil | Ce qu'il lit | Cadence | Tables actuelles |
|-----|--------------|---------|------------------|
| **1 — Le cap** | ADN de marque : positionnement, voix, intention. **Par projet** (~10 marques/utilisateur). | Lente (mois) | `brand_dna` |
| **2 — Le fondateur** | Personnalité, habitudes, façon de parler à Naya, **temps et énergie**, retards/avances. | Moyenne (semaines) | `userOperatingProfiles`, `behavioral_signals`, `userPreferences` (energy) |
| **3 — La cible** | Réception réelle de l'audience, + benchmark concurrent, + teinte macro. | Rapide (jours) | `targetPersonas` + données sociales (nouveau) |

> **L'invention n'est aucun fil pris seul** (chacun = du contexte copiable). **L'invention est l'arbitrage entre les trois.** Tout ce document existe pour rendre cet arbitrage possible et juste.

---

## 1. Conséquence n°1 — Trois mémoires, trois cadences (Phase 2)

L'erreur à éviter : une seule table `business_memory` plate, lue par « les 5 dernières ». Les fils n'évoluent pas au même rythme ; les mélanger détruit le signal.

### 1.1 Découpage du stockage

- **Mémoire ADN (lente).** Versionnée. Chaque révision est datée et conservée (on veut l'historique d'évolution de la marque). Faible volume, forte valeur.
- **Mémoire fondateur (moyenne).** Profil opérationnel mis à jour ~hebdomadairement par agrégation des signaux (`behavioral_signals`, complétions/reports de tâches, énergie). Inclut explicitement le **rythme** : sur quels types de projets l'utilisateur est en retard / en avance.
- **Mémoire réception (rapide).** Flux quotidien de signaux de réception par post et par marque (voir §2). Fort volume, péremption rapide pour les signaux bruts, agrégats conservés.

### 1.2 Récupération sémantique (pgvector)

- Activer l'extension `pgvector` (gratuite) sur PostgreSQL.
- Colonne `embedding vector(N)` sur les entrées de mémoire (N selon le modèle d'embedding choisi via `NayaModelProvider.embed()` — Phase 1).
- `buildNayaContext()` ne récite plus des champs : pour la décision en cours, il **récupère par fil** les entrées les plus pertinentes = score sémantique × fraîcheur (pondérée par la cadence du fil) × saillance.
- Règle de cadence dans le scoring : un signal de réception de 3 jours est « frais » ; un point d'ADN de 3 mois l'est aussi. La demi-vie de fraîcheur est propre à chaque fil.

### 1.3 Pipeline d'extraction

- Chaque capture, conversation Companion et signal passe par une étape d'extraction (Haiku, via le routeur Phase 1, `TaskKind = "extraction"`).
- Sortie : entrées de mémoire **typées et routées vers le bon fil** (fait ADN / préférence opératoire / signal de réception).
- Best-effort, jamais bloquant.

---

## 2. Conséquence n°2 — La boucle de réception (Phase 3)

C'est le Fil 3, et c'est l'actif le plus précieux. Trois couches, à construire dans cet ordre.

### 2.1 Définition de « bien reçu » — NON négociable

On ne mesure **pas les likes** (vanité). On mesure trois profondeurs de résonance :

| Signal | Profondeur | Vitesse | Attribuable à |
|--------|-----------|---------|---------------|
| **Saves** | « assez utile pour le garder » (intention moyenne) | Rapide | Un post précis |
| **Sentiment** | accueil émotionnel (commentaires, DMs) | Rapide | Un post précis |
| **Conversion** | passage à l'acte | **Lente, décalée, diffuse** | **La marque, pas un post** |

### 2.2 Le modèle d'attribution — PRINCIPE CENTRAL

> La conversion est un **signal lent de marque**, pas un signal rapide de post. Elle résulte souvent du **cumul** de plusieurs contenus.

Règles d'architecture :

- **Fenêtre d'attribution** (paramétrable, ex. 7–30 jours) : une conversion est rattachée à la *fenêtre* de contenus qui l'a précédée, pas au dernier post.
- Modèle d'attribution **multi-touch** (répartir le crédit sur les contenus de la fenêtre), pas last-touch.
- Stocker séparément : signaux rapides (par post) et signaux lents (par marque, agrégés sur fenêtre).
- **Interdiction explicite** : ne jamais écrire « ce post a converti X » à partir d'un last-touch naïf. Ce serait apprendre faux. À documenter en commentaire dans le code de la boucle.

### 2.3 Mesurer la réception CONTRE l'intention (croisement Fil 1 × Fil 3)

- Chaque contenu porte une **intention** héritée du Fil 1 (awareness / consideration / conversion).
- « Bien reçu » se juge contre cette intention : saves élevés sur un post d'awareness = succès ; mêmes saves sur un post de conversion sans conversion = échec.
- C'est l'opération de triangulation rendue concrète. Le schéma doit lier `content.intent` (Fil 1) aux signaux de réception (Fil 3).

### 2.4 Les trois couches du Fil 3

- **3a — Réception propre (le roc, à faire en premier).** Ingestion via les **API sociales en lecture** (accès disponible) : saves, sentiment (commentaires/DMs), conversion. 100 % donnée propriétaire.
- **3b — Benchmark concurrent (puissant mais fragile).** Métriques **normalisées** (taux d'engagement, pas valeurs brutes). Identification d'un set de concurrents proches par marque. **Cadrage produit obligatoire : apprentissage (« angle qui résonne dans ton marché »), jamais scoreboard.** La voix Naya ne doit jamais produire de comparaison démoralisante.
- **3c — Teinte macro (faible, en dernier).** Tendances/contexte via `serp.ts`, `article-analysis.ts`, `sentiment-analysis.ts`. Ancrée sur signaux concrets, jamais sur du raisonnement géopolitique générique.

---

## 3. Conséquence n°3 — Le moteur d'arbitrage (le vrai cœur, Phase 3)

C'est l'invention. Un composant dédié, pas un gros prompt.

### 3.1 Rôle

À chaque recommandation/décision, l'arbitre :
1. récupère les slivers pertinents de chaque fil (via la mémoire §1) ;
2. détecte les **conflits** (le cap dit X, l'habitude dit Y, la réception dit Z) ;
3. applique une **politique de pondération** et tranche ;
4. produit une décision **traçable** (quel fil a primé et pourquoi).

### 3.2 Exigences

- La politique de pondération est **centralisée et explicite** (pas dispersée dans des prompts). On doit pouvoir la lire, la tester, la faire évoluer.
- Chaque arbitrage est **journalisé** (entrée → fils consultés → décision → fil dominant). C'est à la fois la traçabilité produit ET le corpus d'entraînement de la Phase 5.
- L'arbitre doit pouvoir dire « je manque de donnée de réception sur cette marque » plutôt que d'inventer — l'incertitude est un état légitime.

---

## 4. Impacts sur le schéma (à concevoir, ne pas coder en aveugle)

À élaborer avec soin (ce sont ces choix qui décident du moat) :

- Découplage `business_memory` → trois portées de mémoire (fil + cadence + embedding).
- `content.intent` relié au Fil 1.
- Nouvelles tables : signaux de réception par post (rapides) ; agrégats de conversion par marque sur fenêtre (lents) ; ensembles de concurrents par marque ; journal d'arbitrage.
- Versionnage de l'ADN et du profil fondateur.

---

## 5. Garde-fous transversaux

- **Best-effort partout.** Ni l'extraction, ni l'ingestion sociale, ni la journalisation ne doivent bloquer un appel IA.
- **Coût maîtrisé.** Extraction et embeddings sur Haiku/modèle dédié via le routeur Phase 1.
- **RGPD / éthique.** La donnée de réception et le benchmark concurrent manipulent des données d'audience : prévoir consentement, rétention, et anonymisation des agrégats concurrents.
- **La voix Naya prime.** Surtout sur 3b : aucune sortie ne doit transformer Naya en machine à culpabiliser. C'est une exigence produit, pas cosmétique.

---

## 6. Definition of Done (architecture)

Le NCE cesse d'être un empileur de contexte. Il devient un moteur qui (a) maintient trois mémoires à trois cadences, (b) mesure la réception réelle contre l'intention avec un modèle d'attribution correct, et (c) arbitre les trois fils de façon centralisée, traçable et journalisée. C'est ce triptyque — pas l'ADN seul — qui constitue la propriété intellectuelle de Naya.

> ⚠️ Avant de coder : le modèle d'attribution (§2.2) et la politique d'arbitrage (§3.1) sont les deux décisions qui font ou défont le moat. Ne les laisse pas un agent les improviser. Fais-les valider avant implémentation.
