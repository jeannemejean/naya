# Décisions d'architecture mémoire — fondées sur l'état de l'art

> Décisions d'expert prises pour la mémoire de Naya, adossées à la recherche en mémoire d'agents LLM (2023-2026).
> Elles sont **figées** : le brief Phase 2 les applique, sans porte de validation. Ce document explique le *pourquoi* (et sert aussi au récit d'innovation du dossier).

---

## Ce que dit l'état de l'art (sources en bas)

- **Generative Agents (Stanford, Park et al. 2023)** — devenu le standard du scoring de récupération mémoire : un souvenir est rappelé selon **recency + importance + relevance**, chacun normalisé [0,1], combinés en **somme pondérée** (pas un produit). Recency = décroissance exponentielle ; importance = note 0-10 donnée par un LLM ; relevance = similarité cosinus.
- **Mem0 (2025, production)** — pipeline en deux temps : **extraction** de faits atomiques depuis la dernière interaction, puis **moteur de mise à jour** qui décide ADD / UPDATE / DELETE / NOOP pour garder la mémoire cohérente (déduplique, met à jour le périmé). Résultats : +26 % vs la mémoire d'OpenAI, −90 % de tokens. C'est l'argument décisif pour ne PAS se contenter d'un « extract → insert » naïf.
- **Zep / Graphiti (2025)** — modèle **bi-temporel** : un fait périmé est *invalidé, pas supprimé* (on garde l'historique). Valide notre champ `supersededAt`.
- **MemoryBank / SAGE** — courbe d'oubli d'Ebbinghaus : la décroissance doit suivre la volatilité de l'information. C'est exactement notre idée de **demi-vies par fil**.
- **RAG 2025-2026** — récupérer **5 à 10 entrées** est l'optimum ; au-delà d'un « context cliff » (~2500 tokens) la qualité chute. Garder la mémoire injectée courte.
- **Embeddings 2026** — `text-embedding-3-small` reste le défaut « ça marche » mais surtout pour l'anglais ; `text-embedding-3-large` est meilleur, même fournisseur ; les leaders multilingues (Voyage, Gemini, Cohere) sont une voie d'amélioration future.

---

## Les décisions (figées)

### Décision 1 — Formule de scoring : somme pondérée normalisée (PAS un produit)

> **Correction de mon design précédent.** J'avais proposé `score = sim × fraîcheur × salience` (produit). La recherche impose la forme additive normalisée des Generative Agents — plus robuste (un produit s'effondre dès qu'un facteur est proche de 0) et c'est le standard validé.

Pour chaque fil, sur l'ensemble des candidats récupérés :

```
score = w_rel · relevance + w_imp · importance + w_rec · recency
```

- `relevance` = similarité cosinus(focus, entrée), normalisée [0,1] (min-max sur les candidats).
- `importance` = salience de l'entrée (0-1), déjà bornée.
- `recency` = fraîcheur (voir Décision 2), déjà bornée [0,1].
- **Poids de départ : w_rel = 1.0, w_imp = 1.0, w_rec = 1.0** (défaut Stanford). La cadence est portée par la demi-vie du fil, pas par les poids — on garde donc les poids égaux et simples.

### Décision 2 — Recency : décroissance exponentielle, demi-vie PAR FIL

```
recency = 0.5 ^ (age_jours / demi_vie(fil))
```

| Fil | Demi-vie | Justification |
|-----|----------|---------------|
| `cap` (ADN) | **180 j** | Le positionnement d'une marque bouge en mois. |
| `founder` | **45 j** | Les habitudes/contraintes du fondateur évoluent en semaines. |
| `reception` | **10 j** | Les signaux d'audience sont volatils (aligné sur la demi-vie ~6 j des systèmes type Generative Agents pour la donnée volatile). |

> Valeurs de départ raisonnées. Elles seront affinées sur données réelles — mais ce sont des défauts défendables, pas des devinettes.

### Décision 3 — Importance : notée 0-10 par le LLM à l'extraction (puis /10)

Fini le `salience = 0.5` fixe. L'extracteur **note chaque souvenir de 0 à 10** (sa « poignancy »), stocké en `salience` (0-1). C'est la méthode Generative Agents.

### Décision 4 — Extraction en deux temps (Mem0), bi-temporelle

1. **Extraction** : à partir de la dernière interaction (message utilisateur + réponse Naya, ou une capture), produire des **faits atomiques** typés et routés par fil, avec leur importance.
2. **Moteur de mise à jour** (anti-bloat — c'est lui qui fait la différence) : pour chaque fait extrait, chercher l'entrée existante la plus proche dans le même `(user, project, fil)` :
   - similarité ≥ 0.92 et même sens → **NOOP** (on rafraîchit éventuellement la date/salience de l'existante) ;
   - similarité élevée mais **valeur changée/contredite** → **UPDATE** : `supersededAt = now()` sur l'ancienne, insertion de la nouvelle (bi-temporel, on garde l'historique) ;
   - sinon → **ADD**.
   - En zone ambiguë (~0.85-0.92), un appel `fast` (Haiku) tranche ADD/UPDATE/NOOP.

> Sans cette étape, `memory_entries` se remplit de quasi-doublons et la récupération se dégrade. C'est l'enseignement n°1 de Mem0.

### Décision 5 — Embeddings : `text-embedding-3-large` réduit à **1536 dim**

- Meilleur que `3-small` (surtout utile pour le **français** de Naya), **même fournisseur déjà intégré**, coût négligeable à ton échelle, **aucune nouvelle dépendance**. Rien n'est encore embeddé → changer maintenant est gratuit.
- **Réduit à 1536 dim** (les modèles `text-embedding-3` supportent la réduction de dimension « matryoshka » avec une perte minime). **Raison technique impérative :** l'index pgvector **HNSW/IVFFlat est plafonné à 2000 dimensions** — les 3072 dim natives de `3-large` ne seraient pas indexables. 1536 reste sous le plafond et conserve l'essentiel de la qualité.
- Voie d'amélioration future (derrière l'abstraction `embed()`) : Voyage-3-large ou Gemini Embedding si la qualité de récupération devient un jour un goulot. Changement = ré-embedder, donc à faire seulement si justifié.

### Décision 6 — Top-K : `cap` 3 · `founder` 4 · `reception` 5 (~12 faits atomiques)

Sous le « context cliff » (~2500 tokens), faits courts. Adaptatif plus tard si besoin.

### Décision 7 — Le prompt d'extraction (figé, en français)

```
SYSTÈME — Extracteur de mémoire Naya

Tu es l'extracteur de mémoire de Naya. À partir d'une interaction (message de
l'utilisateur + réponse de Naya, ou une capture), tu extrais UNIQUEMENT les
informations durables qui méritent d'être mémorisées sur le business de
l'utilisateur. Tu ne réponds pas à l'utilisateur ; tu produis seulement du JSON.

Règles :
1. Extrais des FAITS ATOMIQUES — une seule information par entrée, autoportante,
   compréhensible hors contexte.
2. N'invente RIEN. Si l'interaction ne contient aucune information durable
   (bavardage, demande ponctuelle sans enseignement), renvoie [].
3. Ignore l'éphémère ("ok merci", "fais ça maintenant"). Ne garde que ce qui
   sera encore vrai dans une semaine.
4. Range chaque fait dans le bon FIL :
   - "cap"       : identité / positionnement / offre / voix / stratégie d'une
                   MARQUE. Ex : "La marque vise le haut de gamme", "Offre à 2000€",
                   "Ton : direct, jamais corporate".
   - "founder"   : façon de travailler de L'UTILISATEUR — préférences, habitudes,
                   rythme, énergie, contraintes de temps, manière de décider.
                   Ex : "Préfère traiter l'outbound l'après-midi", "Se décourage
                   quand trop de tâches le même jour", "Décide vite".
   - "reception" : observations sur l'AUDIENCE / le marché / la réception.
                   Ex : "L'audience réagit mieux aux carrousels qu'aux reels".
5. Type chaque entrée : "fait" | "décision" | "préférence" | "observation".
6. Note l'IMPORTANCE de 0 à 10 : 0 = trivial, 10 = structurant pour le business.
   Décision stratégique ou contrainte forte = 8-10 ; préférence mineure = 3-5.

Sortie : un tableau JSON, et RIEN d'autre.
[{ "fil": "cap|founder|reception", "entryType": "...", "content": "...", "importance": 0-10 }]
```

---

## Sources

- [Generative Agents: Interactive Simulacra of Human Behavior (Park et al., Stanford)](https://ar5iv.labs.arxiv.org/html/2304.03442)
- [Generative Agents Memory — architecture (scoring recency×importance×relevance)](https://www.subodhjena.com/blog/generative-agents-memory-stanford)
- [Mem0: Building Production-Ready AI Agents with Scalable Long-Term Memory (arXiv 2504.19413)](https://arxiv.org/html/2504.19413v1)
- [Zep: A Temporal Knowledge Graph Architecture for Agent Memory (arXiv 2501.13956)](https://arxiv.org/abs/2501.13956)
- [Graphiti — knowledge graph memory (Neo4j)](https://neo4j.com/blog/developer/graphiti-knowledge-graph-memory/)
- [Best Embedding Model for RAG 2026 (Milvus)](https://milvus.io/blog/choose-embedding-model-rag-2026.md)
- [RAG 2025 year-end review (RAGFlow) — top-k et context cliff](https://ragflow.io/blog/rag-review-2025-from-rag-to-context)
- [Designing Memory Systems for LLM Agents (Demir)](https://medium.com/@candemir13/designing-memory-systems-for-llm-agents-from-short-term-context-to-long-term-knowledge-b27a1d4d5516)
