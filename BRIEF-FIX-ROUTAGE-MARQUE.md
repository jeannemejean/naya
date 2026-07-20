# BRIEF — Fix : routage de marque à l'extraction (silencieux + conservateur)

> À exécuter par Claude Code dans NayaVision-29, **avant la Phase 3**.
> Petit correctif ciblé, pas une phase. Il corrige un misfile constaté en prod et pose une règle de routage de marque pour la mémoire.

---

## 0. Le problème constaté (prod)

Les faits `cap` extraits d'une conversation sur **Encore Merci** (projet 3) ont été tagués `project_id = 1` (Agence JMD), parce que l'extraction hérite du **projet actif** du Companion, pas de la marque dont parle réellement le contenu. Avec ~10 marques, ce misfile silencieux se reproduira en permanence et polluera la triangulation (le fil `cap` doit être attaché à la bonne marque).

## 1. Décision (actée avec Jeanne)

Routage **silencieux quand c'est certain, sinon Naya DEMANDE.** Trois cas, uniquement pour les faits spécifiques à une marque (`cap` / `reception`) :

1. **Une marque clairement nommée** dans la conversation → on route silencieusement vers elle.
2. **Aucune marque nommée, mais contenu spécifique à une marque** → **Naya pose la question** dans la conversation (« tu parles de quelle marque ? »), puis utilise la réponse. **Pas de fallback silencieux sur le projet actif** — c'est lui qui créait le misfile.
3. **Contenu non spécifique à une marque** (`founder`, transverse) → **on ne demande RIEN**, `projectId = null`.

**Jamais de devinette. Jamais un fait d'ADN classé sous une marque non confirmée.** Chaque résolution de marque est journalisée (auditable pour la revue du samedi).

### Deux conditions non négociables (sinon la règle se retourne contre l'utilisateur)

- **Ne demander QUE pour `cap`/`reception`.** Un fait `founder` (« préfère bosser l'après-midi ») ne déclenche jamais de question — il est transverse. Interroger l'utilisateur sur ses propres habitudes serait absurde.
- **Demander une fois par sujet, pas par message.** Une fois la marque établie dans la conversation, la garder pour tout le fil. Si l'utilisateur parle d'Encore Merci sur cinq échanges, ne pas redemander au sixième.

### Conséquence d'architecture

La question se pose **dans le Companion, en direct** — PAS dans l'extraction (qui tourne en tâche de fond *après* la réponse de Naya : trop tard pour demander). Le Companion établit la **marque-sujet** de la conversation (nom donné ou question posée) ; l'extraction se contente de **consommer** cette marque résolue pour taguer les faits `cap`/`reception`.

## 2. Comportement cible

### A. Côté Companion (live) — établir la marque-sujet

Le Companion maintient une **marque-sujet** pour la conversation en cours :
1. Charger les projets de l'utilisateur : `storage.getProjects(userId)` → `[{ id, name }]`.
2. À partir du message + de l'historique de la conversation, détecter si une **marque connue est nommée** (comparaison normalisée — voir Garde-fous). Si oui → c'est la marque-sujet, persistée pour le fil.
3. Si l'utilisateur aborde un sujet **spécifique à une marque** (ADN / audience / contenu d'une marque) **sans** qu'aucune marque-sujet ne soit établie → le Companion **pose la question** dans sa réponse (« Tu parles de quelle marque ? »), avec le projet actif en suggestion. La réponse fixe la marque-sujet.
4. La réponse du Companion expose la marque-sujet résolue (ex. champ `subjectProjectId`) pour que l'extraction la consomme.

> Une marque-sujet, c'est l'identité de la marque dont parle la conversation — **distincte** du « projet actif » (la sélection d'UI, faillible). Le projet actif n'est qu'une suggestion par défaut, jamais une vérité.

### B. Côté extraction (`extract.ts`) — consommer la marque résolue

À l'insertion :
- entrées **`cap`** / **`reception`** → `projectId = subjectProjectId` (la marque-sujet établie par le Companion) ;
- si une entrée `cap`/`reception` arrive **sans** marque-sujet résolue → **ne pas l'insérer sous une marque devinée ni sous le projet actif** ; la mettre en attente / la sauter (best-effort) — le Companion aura posé la question, la résolution viendra ;
- entrées **`founder`** → `projectId = null` (transverses, inchangé, jamais de question).

### C. Journalisation (auditable)

Tracer chaque résolution (best-effort) : `sourceType`, marque(s) détectée(s), `subjectProjectId`, projet actif, et si une question a été posée. Réutilisable à la revue du samedi.

## 3. Garde-fous

- **En cas d'ambiguïté (0 ou >1 marque nommée) sur du contenu `cap`/`reception`, on DEMANDE — on ne devine pas, et on ne retombe pas en silence sur le projet actif.** C'est la règle centrale.
- **Ne pas toucher au prompt d'extraction figé** (`DECISIONS-MEMOIRE-IA.md` §7). La détection de marque-sujet et la question vivent dans le Companion ; l'extraction ne fait que consommer la marque résolue.
- **Best-effort.** Si la résolution échoue côté extraction, ne PAS insérer un `cap`/`reception` sous une marque devinée — mettre en attente / sauter, jamais de crash.
- **Normalisation robuste** : gérer accents (« Encore Merci » vs « encore merci »), casse, espaces. Éviter les faux positifs sur des noms très courts/génériques (ex. un projet nommé « Test » ne doit pas matcher le mot « test » dans une phrase — exiger un match sur le nom complet, idéalement en limite de mots).

## 4. Correction de la donnée existante (one-shot)

Les trois faits `cap` déjà en prod sont mal attribués. Requête de correction ponctuelle :

```sql
UPDATE memory_entries SET project_id = 3 WHERE id IN (2,3,4); -- Encore Merci
```

Vérifier ensuite : `SELECT id, fil, project_id, left(content,50) FROM memory_entries ORDER BY id DESC;` — les `cap` doivent être sur 3, les `founder` sur `null`.

## 5. Tests

- [ ] Marque nommée → les `cap`/`reception` partent sur ce projet, même si le projet actif est différent.
- [ ] Contenu spécifique à une marque, **aucune marque nommée**, aucune marque-sujet établie → le Companion **pose la question** (et n'insère pas le fait `cap`/`reception` sous le projet actif).
- [ ] Marque-sujet **déjà établie** plus tôt dans la conversation → pas de nouvelle question, réutilisation de la marque-sujet.
- [ ] Contenu `founder` sans marque → **aucune question**, `projectId = null`.
- [ ] Normalisation : « encore merci » (sans majuscules/accents) matche le projet « Encore Merci ».
- [ ] Pas de faux positif sur un nom de projet court/générique (match en limite de mots).
- [ ] Build + tests existants verts ; aucun site d'appel cassé.

## 6. Definition of Done

Un fait d'ADN se range sous la marque qu'il décrit dès qu'elle est nommée ; si elle ne l'est pas, Naya **demande** plutôt que de deviner ou de retomber sur le projet actif. Les faits `founder` restent transverses, sans question. La décision est tracée pour ta revue. Le moat (le bon fait sur la bonne marque) est protégé avant que la Phase 3 (réception par marque) ne s'y appuie.

> ⚠️ La règle d'or : aucun fait d'ADN sous une marque non confirmée. En cas de doute, Naya demande — jamais elle ne suppose. Un misfile silencieux coûte plus cher qu'une question de plus.
