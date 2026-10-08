// Consignes partagées par les générateurs GÉNÉRIQUES de tâches (journée, semaine, mois,
// objectif, jalon). PURE.
//
// Deux raisons d'exister (9 octobre 2026) :
//  1. Périmètre : le contenu vient du calendrier éditorial, la prospection du pipeline de
//     prospection. Les générateurs génériques n'en produisent plus — voir aussi le filtre
//     déterministe `filtre-taches-generees.ts`, qui le garantit après coup.
//  2. Langue : les exemples de titres étaient en anglais dans les prompts et le modèle rapide
//     les imitait. Les exemples suivent désormais la langue du compte.
//
// La consigne de langue elle-même reste produite par `languageDirective()` (shared/language.ts),
// seul endroit autorisé à la formuler (server/language-guard.test.ts).

import { languageDirective, type Language } from "@shared/language";

/** Ce que les générateurs génériques ne doivent pas produire, et pourquoi. */
export function consignePerimetre(langue: Language): string {
  if (langue === "en") {
    return `## Scope of these tasks
Content and prospecting are NOT your job here — they are planned elsewhere:
- Content work (posts, carousels, reels, scripts, newsletters, visuals) comes ONLY from the content calendar, which creates its own production tasks for each post.
- Prospecting (identifying prospects, DMs, outreach messages, connection requests, follow-ups) comes ONLY from the automated prospecting pipeline.
So never create a content-creation or prospecting task. Focus on strategy, offer, product, planning, client delivery, operations and admin.`;
  }
  return `## Périmètre de ces tâches
Le contenu et la prospection ne sont PAS ton rôle ici — ils sont planifiés ailleurs :
- Le travail de contenu (posts, carrousels, reels, scripts, newsletters, visuels) vient UNIQUEMENT du calendrier éditorial, qui crée lui-même les tâches de production de chaque post.
- La prospection (identifier des prospects, DM, messages d'approche, demandes de connexion, relances) vient UNIQUEMENT du pipeline de prospection automatisé.
Ne crée donc jamais de tâche de création de contenu ni de prospection. Concentre-toi sur la stratégie, l'offre, le produit, la planification, la livraison client, l'opérationnel et l'administratif.`;
}

/** Exemples de titres (mauvais / bons) dans la langue du compte, hors contenu et prospection. */
export function exemplesTitres(langue: Language): string {
  if (langue === "en") {
    return `❌ "Prepare a strategy document"
❌ "Review your week"
❌ "Work on your offer"

✅ "Rewrite the 3 promises of [offer] around [audience pain point] — one sentence each, in [brand voice] tone."
✅ "List the 5 objections heard on the last discovery calls and draft one answer for each in the [offer] FAQ."
✅ "Set the price and scope of the [offer] pilot: deliverables, duration, what is NOT included."`;
  }
  return `❌ "Préparer un document de stratégie"
❌ "Faire le point sur ta semaine"
❌ "Travailler ton offre"

✅ "Réécrire les 3 promesses de [offre] autour de [douleur de l'audience] — une phrase chacune, dans le ton [voix de marque]."
✅ "Lister les 5 objections entendues lors des derniers appels découverte et rédiger une réponse pour chacune dans la FAQ de [offre]."
✅ "Fixer le prix et le périmètre du pilote de [offre] : livrables, durée, ce qui n'est PAS inclus."`;
}

/** Bloc à placer en fin de prompt : périmètre + consigne de langue du compte. */
export function consignesGenerateur(langue: Language): string {
  return `${consignePerimetre(langue)}\n\n${languageDirective(langue)}`;
}
