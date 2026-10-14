# L'atelier de contenu — plan d'implémentation

> Exécution : inline (superpowers:executing-plans), TDD à chaque tâche, relecture indépendante à la fin. Jeanne a demandé d'aller au bout sans validation intermédiaire.

**Spec :** `docs/superpowers/specs/2026-10-14-atelier-contenu-design.md`

## Contraintes globales

- Aucun texte en dur dans le JSX (cliquet `jsx-guard`) ; clés FR et EN ensemble.
- `npx tsc --noEmit` à zéro erreur ; suite complète verte ; build OK.
- Migration générée, relue, appliquée sur dev seulement ; additive.
- Garde de dépense sur tout appel IA ; jamais deux rédactions automatiques d'un même post.
- Rien ne se publie sans validation (`auto_post` ne passe à true que par la validation).
- Aucune tâche supprimée : les anciennes étapes sont archivées.

## Review Focus

1. Un post ne peut pas être programmé avec un format qui ne serait pas celui prévu (vidéo sans vidéo, image sans visuel, carrousel < 2).
2. Le placement est idempotent : relancé N fois (resume, redeploy, refus, migration), il ne crée qu'un atelier par semaine (+ rattrapage seulement si l'atelier est fait).
3. L'échéance de l'atelier tient au re-tassage : jamais après la veille travaillée du premier post.
4. La bascule ne touche jamais un post dont une étape est faite, ni un post publié/programmé, ni le passé.
5. Post d'un autre compte → 404 sur toutes les routes de l'atelier.

## Tâches

1. **Règles pures** `shared/atelier.ts` : `lundiDe`, `libelleSemaine`, `DUREE_ATELIER`, `decouperAtelier`, `planAtelier`, `etatPost`, `manquesPourValider`, `estEtapeEcran`, `ETAPES_HORS_ATELIER`. Tests.
2. **Migration** `content.consigne`.
3. **Placement** : `placerTachesProductionPosts` crée Tourner/Monter (vidéo) + `assurerAteliers` par semaine ; échéance des tâches d'atelier dans `retasserJours` ; `ordonnerEtapesPosts` place Tourner après l'atelier. Tests.
4. **Rédaction** : `redigerPost` (verrou `consigne`, IA avec contexte, garde), `refairePost` (consigne courte). Tests.
5. **Validation** : `validerPost` / `devaliderPost` (programmation, Publier de secours, archivage des étapes d'écran, coche des tâches d'atelier quand tout est validé). Routes `/api/atelier/*`. Tests.
6. **Filets** : rappel de la veille + bascule dans le passage quotidien ; script `scripts/basculer-ateliers.ts` (`--dry-run`). Tests.
7. **Client** : page `/atelier`, panneau de tâche d'atelier, bouton « Valider et programmer » sur Monter, lien depuis le calendrier ; locales.
8. **Vérification, relecture, fusion.**
