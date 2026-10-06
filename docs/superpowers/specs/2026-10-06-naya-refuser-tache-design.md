# Refuser une tâche, expliquer pourquoi, être remplacée — conception

**Date :** 6 octobre 2026

> Demande, dans les mots de l'utilisatrice : « je voudrais pouvoir refuser la tâche et rentrer des informations qui expliquent pourquoi je la refuse, comme ça Naya apprendrait plus de choses sur moi et elle peut remplacer cette tâche par une autre. »
>
> Choix tranché : **remplacer directement** (pas de validation intermédiaire).

## Ce qu'on construit

1. Un bouton **« Refuser »** dans le panneau de la tâche (`TaskWorkspace`) et dans la bulle du planning du tableau de bord ; l'icône existante en vue liste reste.
2. Une fenêtre de refus revue : raisons rapides existantes + champ mis en avant **« Explique à Naya pourquoi »** (facultatif, encouragé).
3. **Apprentissage** : l'explication devient un souvenir de préférence dans la mémoire de Naya (relue par `buildNayaContext`), et le générateur de tâches lit désormais le **texte libre** des refus, plus seulement la raison cochée.
4. **Remplacement direct** : une tâche générée aussitôt prend le créneau, le projet et les dépendances de la tâche refusée. Un échec de génération ne fait jamais échouer le refus.

## Ce qu'on ne construit pas

- Pas de refus d'un événement Google Agenda (ce n'est pas une tâche).
- Pas de refus groupé.
- Pas de validation de la tâche de remplacement avant placement (choix de l'utilisatrice) ; elle peut la refuser à son tour.

## État constaté

| Élément | Emplacement | État |
|---|---|---|
| Fenêtre de refus | `client/src/components/task-feedback-modal.tsx` | Existe : type (supprimer / écarter / reporter), raison (`not_useful`, `wrong_timing`, `already_done`, `not_aligned`, `too_vague`, `wrong_approach`, `other`), texte libre |
| Accès | `todays-tasks.tsx` (icône vue liste) | **Seul** point d'entrée |
| Enregistrement | `DELETE /api/tasks/:id` (avec `reason`) et `POST /api/tasks/:id/feedback` → `task_feedback` | `freeText` stocké |
| Lecture par le générateur | `routes.ts` `generate-daily` → `rejectedTasksContext` (15 derniers `deleted/dismissed/deferred`) | **N'inclut pas `freeText`** |
| Mémoire | `memory_entries` (`fil`, `entryType`, `projectId`, `embedding`, `salience`) ; modèle : `server/services/campaign-reject/rejeter.ts` (fil `cap`, `préférence`, embedding best-effort) | Aucun souvenir pour un refus de tâche |
| Création de dépendances | `server/services/dependances.ts` `ajouterDependance` | Point d'entrée unique (refus auto-référence/inter-comptes/cycle) |
| Re-tassage | `storage.fixOverlappingTasks` | Respecte les précédences |
| Garde de langue / références | `server/services/garde-langue.ts` `imposerLangueDuCompte`, `server/services/references-taches.ts` | Existent |

## Conception

### Serveur — `POST /api/tasks/:id/refuser`

Corps : `{ reason: string, freeText?: string }`. `reason` ∈ raisons existantes (sinon 400).

Service `refuserTache` (dépendances injectées, testable sans base), dans l'ordre :

1. Lire la tâche ; 404 si absente ou d'un autre compte ; 400 si c'est un id fictif.
2. Enregistrer le retour dans `task_feedback` (`feedbackType: "refused"`, `reason`, `freeText`, contexte habituel).
3. Écrire un souvenir (`memory_entries`, `fil: "founder"`, `entryType: "préférence"`, `projectId` de la tâche, `salience: 0.8`, embedding best-effort) — **seulement si `freeText` est non vide**, texte : `A refusé la tâche « <titre> » (<raison lisible>) : <freeText>`. Un échec ici est journalisé, jamais bloquant.
4. Lire les dépendances de la tâche (comme dépendante et comme prérequis) **avant** suppression.
5. Générer une tâche de remplacement (voir plus bas). En cas d'échec : supprimer la tâche refusée, re-tasser, répondre `{ refusee: true, remplacement: null, raison: "generation_failed" }`.
6. Créer le remplacement : même `scheduledDate`, `scheduledTime`, `projectId`, durée générée (bornée 15–240 min, défaut = durée d'origine), `source: "replacement"`.
7. Transférer les dépendances via `ajouterDependance` (remplacement → mêmes prérequis ; mêmes dépendants → remplacement).
8. Supprimer la tâche refusée.
9. `fixOverlappingTasks(userId, max(aujourd'hui, date de la tâche))`.
10. Répondre `{ refusee: true, remplacement: <tâche créée> }`.

### Génération du remplacement

Fonction `genererRemplacement` (`callClaudeWithContext`, modèle rapide, `projectId` de la tâche) : consigne = proposer **une** tâche qui sert le même objectif, en évitant explicitement ce qui a été refusé et pourquoi, en tenant compte des 10 derniers refus de l'utilisateur. Sortie JSON `{ title, description, type, category, estimatedDuration, activationPrompt? }`, validée par une fonction pure (`validerRemplacement`). Puis garde de langue (`imposerLangueDuCompte`) et filet « Task N » (`remplacerReferencesNumerotees` avec liste vide → « la tâche précédente »).

### Le générateur lit le texte libre

`rejectedTasksContext` (generate-daily) et le replanning : chaque ligne inclut `freeText` quand il existe ; `feedbackType` `refused` est compté parmi les signaux négatifs.

### Client

- `TaskWorkspace` : bouton « Refuser » dans l'en-tête (masqué pour un événement d'agenda) → fenêtre de refus.
- Bulle du planning du tableau de bord : bouton « Refuser » (masqué pour un événement d'agenda).
- Fenêtre de refus en mode « refuser » : pas de choix supprimer/écarter/reporter (un refus remplace) ; raisons ; champ « Explique à Naya pourquoi » (placeholder d'exemple) ; bouton « Refuser et remplacer ».
- Succès : toast « Remplacée par « … » » ; échec de génération : toast « Tâche refusée. Naya n'a pas pu proposer de remplacement pour l'instant. » ; invalidation des listes de tâches.
- Toutes les chaînes via `t()` (FR + EN).

## Erreurs

- Le refus réussit dès que l'étape 2 réussit ; mémoire, génération, dépendances et re-tassage sont best-effort et journalisés.
- Pas de suppression de la tâche refusée tant que le remplacement n'est pas créé, sauf si la génération a échoué (alors suppression simple).

## Tests

- Pur : `texteSouvenirRefus`, `validerRemplacement` (champs manquants, durée hors bornes, JSON partiel), contexte de refus incluant `freeText`.
- Service (fakes) : ordre des opérations ; souvenir seulement avec texte ; remplacement au même créneau/projet ; dépendances transférées dans les deux sens ; échec de génération → refus valide sans remplacement ; échec mémoire → non bloquant.
- Route : 404 tâche d'un autre compte, 400 raison invalide, 400 id fictif, réponse avec remplacement.
- Aucun test contre la production.
