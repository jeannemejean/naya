// Outils de conversation offerts au modèle PENDANT une séance de redémarrage seulement.
import type { Outil } from "../agent/registre";
import { annulerProposition, proposerHorsConversation } from "../agent/propositions";
import { basculerProjet, depsSeance, passerProjet, rattacherProposition } from "./seance";
import { SCHEMA_OPERATION } from "./schema-operations";

export const proposerBilanProjet: Outil = {
  nom: "proposer_bilan_projet",
  classe: "a_valider",
  description:
    "Séance de redémarrage : propose en UNE fois tous les changements du projet en cours, tirés de ce que l'utilisatrice a raconté. " +
    "Rien n'est fait avant qu'elle valide (tout ou ligne par ligne). " +
    "projectId : le projet dont elle vient de parler (celui de la consigne, sauf si la conversation a pris un autre projet de la séance).",
  schema: {
    type: "object",
    properties: { projectId: { type: "integer" }, operations: { type: "array", items: SCHEMA_OPERATION as any } },
    required: ["projectId", "operations"],
  },
  async executer(ctx, args) {
    let s = await depsSeance.enCours(ctx.userId);
    if (!s || s.projetCourant == null) return { pourModele: { erreur: "aucune_seance" } };
    // 27 nov. : changements de « Personal branding » rangés dans « Encore Merci » parce que la
    // conversation avait pris un autre ordre que la séance. Le projet nommé fait foi.
    const vise = Number(args.projectId);
    if (Number.isInteger(vise) && vise !== s.projetCourant) {
      const b = await basculerProjet(s, vise);
      if (!b) return { pourModele: { erreur: "projet_hors_seance", consigne: `Le projet ${vise} n'est pas à traiter dans cette séance (déjà fait ou inconnu). Le projet en cours est ${s.projetCourant}.` } };
      s = b;
    }
    // Jamais de proposition avant qu'elle ait parlé de CE projet (25 nov. : sur le projet 2, le
    // modèle avait reproposé les changements du projet 1 sans rien demander).
    const courant = ((s.projets ?? []) as Array<{ projectId: number; recit?: boolean; propositionId?: number }>).find((p) => p.projectId === s.projetCourant);
    if (!courant?.recit) {
      return { pourModele: { erreur: "attends_son_recit", consigne: "Elle n'a pas encore parlé de ce projet : résume ce que tu sais en 2 ou 3 lignes et demande-lui où elle en est. Rien du projet précédent ne s'applique ici." } };
    }
    const r = await proposerHorsConversation(ctx.userId, "appliquer_bilan_projet", { projectId: s.projetCourant, operations: args.operations }, ctx.maintenant, { fuseau: ctx.fuseau });
    if ("erreur" in r) return { pourModele: { erreur: r.erreur } };
    // Une seule proposition vivante par projet : la précédente, si elle attend encore, est annulée.
    if (courant.propositionId != null && courant.propositionId !== r.id) {
      try { await annulerProposition(ctx.userId, courant.propositionId); } catch { /* déjà traitée : rien à faire */ }
    }
    await rattacherProposition(s, r.id);
    return {
      pourModele: { a_valider: true, propositionId: r.id, resume: r.resume, changements: r.changements.length,
        consigne: "Rien n'est fait : elle valide la carte (tout ou ligne par ligne), ou répond « oui »." },
      proposition: r,
    };
  },
};

export const passerProjetOutil: Outil = {
  nom: "passer_projet",
  classe: "direct",
  description: "Séance de redémarrage : passe le projet en cours sans rien changer (à sa demande).",
  schema: { type: "object", properties: {} },
  async executer(ctx) {
    const r = await passerProjet(ctx.userId, ctx.maintenant);
    // Dernier projet passé : la séance est finie, le récap se fait tout de suite.
    if (r.termineeMaintenant && r.seance) {
      const { consigneFinSeance } = await import("./consigne");
      return { pourModele: { ok: true, termineeMaintenant: true, projetSuivant: null, consigne: consigneFinSeance(r.seance) } };
    }
    return { pourModele: { ok: true, termineeMaintenant: r.termineeMaintenant, projetSuivant: r.seance?.projetCourant ?? null } };
  },
};

export const consulterEvaluationReseaux = {
  nom: "consulter_evaluation_reseaux",
  classe: "lecture" as const,
  description: "Séance de redémarrage : ce qui était prévu et ce qui est sorti sur les réseaux depuis son absence, et les chiffres disponibles (null = indisponible, voir « limites »).",
  schema: { type: "object" as const, properties: {} },
  async executer(ctx: any, _args: any, deps: { evaluer?: (u: string, d: Date, m: Date) => Promise<unknown> } = {}) {
    const s = await depsSeance.enCours(ctx.userId);
    const depuis = new Date((s?.bilan as any)?.depuis ?? ctx.maintenant.getTime() - 30 * 86_400_000);
    const evaluer = deps.evaluer ?? (async (u: string, d: Date, m: Date) => {
      const { evaluationReseaux, depsEvaluation } = await import("./reseaux");
      return evaluationReseaux(depsEvaluation, u, d, m);
    });
    return { pourModele: await evaluer(ctx.userId, depuis, ctx.maintenant) };
  },
} satisfies Outil & { executer: (...a: any[]) => any };

export const OUTILS_SEANCE: Outil[] = [proposerBilanProjet, passerProjetOutil, consulterEvaluationReseaux];
