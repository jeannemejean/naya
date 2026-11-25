// La consigne ajoutée au chat pendant une séance de redémarrage : le bilan du SEUL projet courant
// et la façon de mener l'échange. Rien d'un autre projet n'y figure.
import type { SeanceRedemarrage } from "@shared/schema";
import type { BilanSilencieux } from "./bilan";

const dateFr = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long" });

export function consigneSeance(s: SeanceRedemarrage): string {
  const bilan = s.bilan as BilanSilencieux;
  const projets = (s.projets ?? []) as Array<{ projectId: number }>;
  const p = bilan.projets.find((x) => x.projectId === s.projetCourant);
  if (!p) return "";
  const rang = projets.findIndex((x) => x.projectId === p.projectId) + 1;
  const etat = projets.find((x) => x.projectId === p.projectId) as { recit?: boolean; propositionId?: number; aRefaire?: boolean; echecs?: string[] } | undefined;
  const recit = !!etat?.recit;
  const lignes = [
    `## Séance de redémarrage en cours : projet ${rang} sur ${projets.length}, « ${p.nom} » (projectId ${p.projectId})`,
    `L'utilisatrice revient après une absence (depuis le ${dateFr(bilan.depuis)}). Vous faites le point ensemble, projet par projet, pour que Naya reflète où elle en est vraiment.`,
    "",
    "Ce que Naya sait déjà de ce projet (ne le demande JAMAIS) :",
    `- Statut : ${p.statut}. Note actuelle : ${p.noteActuelle ? `« ${p.noteActuelle} »` : "aucune"}.`,
    `- Dernière tâche faite : ${p.derniereTacheFaite ? dateFr(p.derniereTacheFaite) : "aucune connue"}.`,
    `- Posts prévus sur la période : ${p.postsPrevus}, publiés : ${p.postsPublies}.`,
    p.tachesEnRetard.length
      ? `- Tâches en retard (id : titre, date) :\n${p.tachesEnRetard.map((t) => `  - ${t.id} : ${t.titre} (${t.date})`).join("\n")}`
      : "- Aucune tâche en retard.",
    p.creneaux.length ? `- Créneaux réguliers : ${p.creneaux.map((c) => `${c.id} « ${c.titre} » (${c.rythme})`).join(" ; ")}.` : "- Aucun créneau régulier.",
    p.envoisEnCours.length ? `- Envois en attente : ${p.envoisEnCours.map((e) => `${e.marque} (${e.objet})`).join(" ; ")}.` : "",
    "",
    rang > 1 ? "Le projet précédent est réglé : rien de ce qui a été dit pour lui (tâches, envois, créneaux) ne s'applique à ce projet-ci." : "",
    recit ? "" : "Elle n'a pas encore parlé de ce projet : commence par l'étape 1, ne propose rien avant sa réponse.",
    etat?.propositionId != null ? `La proposition n° ${etat.propositionId} attend sa validation (carte en tête du chat) : n'en refais pas une, sauf si elle demande à changer quelque chose.` : "",
    etat?.echecs?.length
      ? `Elle a validé ta proposition, mais AUCUN changement n'a pu s'appliquer :\n${etat.echecs.map((e) => `  - ${e}`).join("\n")}\nDis-le-lui simplement, puis refais une proposition corrigée (ou passer_projet si elle préfère).`
      : etat?.aRefaire ? "Sa proposition précédente a expiré ou a été annulée : elle est à refaire à partir de ce qu'elle a déjà dit (demande-lui seulement ce qui a changé)." : "",
    "",
    "Comment mener ce projet :",
    "1. Si ce n'est pas déjà fait dans la conversation, résume en 2 ou 3 lignes ce que tu sais, puis demande où elle en est vraiment. Une seule question ouverte.",
    "2. Au plus 2 questions de relance, et seulement si un trou important reste. C'est rapide : pas d'interrogatoire.",
    "3. Repère le travail qu'elle fait hors de Naya (avec d'autres outils, de façon répétée) : propose un créneau régulier pour lui faire de la place (creer_creneau, avec intervalWeeks si c'est toutes les deux semaines, par exemple).",
    "4. Si elle a présenté un projet à une marque, note l'envoi (creer_envoi) avec une date de relance (par défaut 7 jours après l'envoi).",
    "5. Appelle alors proposer_bilan_projet avec TOUS les changements de ce projet : tâches faites (cocher_tache) ou abandonnées (archiver_tache), note réécrite à partir de son récit (note_projet), statut si elle le dit, créneaux, envois, prochaines étapes (creer_tache). Elle validera tout ou ligne par ligne.",
    "6. Si elle veut passer ce projet sans rien changer, appelle passer_projet.",
    "N'invente rien : ce qu'elle n'a pas dit ne devient pas un changement.",
  ];
  return lignes.filter((l) => l !== "").join("\n");
}

/** Consigne du dernier message, quand la séance vient de se terminer. */
const LIMITES_EN_CLAIR: Record<string, string> = {
  metricool_absent: "Metricool n'est pas connecté : les posts programmés là-bas ne sont pas comptés (Réglages > Metricool).",
  metricool_refuse: "Metricool refuse l'accès (jeton ou offre sans API) : à reconnecter dans Réglages.",
  metricool_indisponible: "Metricool n'a pas répondu comme prévu : ses posts ne sont pas comptés cette fois.",
  portee_manquante: "Les chiffres Instagram ne sont pas disponibles : reconnecte Instagram dans Réglages pour autoriser les statistiques.",
  instagram_expire: "La connexion Instagram a expiré : reconnecte Instagram dans Réglages.",
  instagram_erreur: "Instagram n'a pas répondu : ses posts ne sont pas comptés cette fois.",
  instagram_partiel: "Il y a eu plus de posts Instagram que Naya n'en lit d'un coup : les chiffres Instagram sont des minimums.",
  linkedin_profil_non_lisible: "LinkedIn ne permet pas de lire ce que tu publies depuis ton profil : seuls les posts passés par Naya ou Metricool sont comptés.",
  evaluation_indisponible: "L'évaluation des réseaux n'a pas pu être faite.",
};

export function consigneFinSeance(s: SeanceRedemarrage): string {
  const limites = (((s.evaluation as any)?.limites ?? []) as string[]).map((c) => LIMITES_EN_CLAIR[c]).filter(Boolean);
  return [
    "## Séance de redémarrage terminée",
    "Écris le récap, court et concret :",
    "1. L'évaluation des réseaux ci-dessous : publié ou non par rapport à ce qui était prévu, puis les chiffres disponibles. Ne jamais inventer un chiffre absent ; dis clairement ce qui manque et pourquoi (codes dans « limites »).",
    "2. Ce que tu as compris de sa façon de travailler (le travail fait hors de Naya, les créneaux ajoutés, les envois suivis).",
    "3. Une phrase sur la semaine qui vient.",
    limites.length ? `Ce qui manque, à dire tel quel (une phrase chacun) :\n${limites.map((l) => `- ${l}`).join("\n")}` : "",
    `Évaluation des réseaux (JSON) : ${JSON.stringify(s.evaluation ?? null)}`,
  ].filter(Boolean).join("\n");
}
