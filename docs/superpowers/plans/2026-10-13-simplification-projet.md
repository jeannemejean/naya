# Simplifier Naya (tout dans le projet) — plan d'implémentation

> Exécution : inline (superpowers:executing-plans), TDD à chaque tâche, relecture indépendante à la fin. Jeanne a demandé d'aller au bout sans validation intermédiaire.

**Spec :** `docs/superpowers/specs/2026-10-13-simplification-projet-design.md`

## Contraintes globales

- Aucun texte en dur dans le JSX (cliquet `jsx-guard`) ; clés FR et EN ensemble.
- `npx tsc --noEmit` à zéro erreur ; suite complète verte avant fusion ; build OK.
- Migration générée, relue, appliquée sur dev seulement ; additive.
- Garde de dépense sur tout appel IA ; aucun appel quand il n'y a rien à faire.

## Review Focus

1. La proposition automatique des Fondations ne peut jamais être payée deux fois pour un projet (ouvertures répétées, onglets multiples, échec de l'IA).
2. La complétion d'un mois n'efface jamais un champ non dit.
3. La phrase de Mesure n'invente aucun chiffre (absent → absent).
4. L'onglet et le projet viennent de l'URL ; un onglet inconnu ou « client » sur un projet perso ne casse rien.
5. Projet d'une autre → 404 sur toutes les nouvelles routes.

## Tâches

1. **Liens des notifications** : colonne `lien` (migration), `ResultatPassage.lien`, `notifierRoutine(userId, message, lien)`, routines Mesure/Rapports/Veille ; compagnon : bouton « Ouvrir ».
2. **Mesure — complétion et phrase** : `completerMois` (pur, fusion par champ présent), route `/completer`, `lirePhrase` (pur : lecture de la sortie IA, validations), route `/phrase` (garde, IA rapide), rappel reformulé, action compagnon `saisir_mesure` (serveur : prompt ; client : exécuteur).
3. **Fondations — proposition automatique** : `aRemplir` au GET, `{ auto: true }` au POST (ligne posée d'abord, rien si elle existe).
4. **Page projet à onglets** : `ongletDe(query, projet)` (pur), en-tête avec sélecteur, onglets Vue d'ensemble / Fondations / Veille / Mesure / Client ; pages Fondations, Veille, Mesure extraites en composants par projet ; redirections des anciennes adresses ; barre latérale allégée.
5. **Fondations — édition au clic** : SectionCarte cliquable, zone vide « Écrire moi-même », Échap ; remplissage automatique à l'ouverture.
6. **Mesure — onglet** : champ « Dis-moi tes chiffres », aperçu, saisie détaillée repliée.
7. **Vérification, relecture, fusion.**
