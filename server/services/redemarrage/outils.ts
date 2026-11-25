// Outils de conversation offerts au modèle PENDANT une séance de redémarrage seulement.
import type { Outil } from "../agent/registre";
import { proposerHorsConversation } from "../agent/propositions";
import { depsSeance, passerProjet, rattacherProposition } from "./seance";
import { SCHEMA_OPERATION } from "./schema-operations";

export const proposerBilanProjet: Outil = {
  nom: "proposer_bilan_projet",
  classe: "a_valider",
  description:
    "Séance de redémarrage : propose en UNE fois tous les changements du projet en cours, tirés de ce que l'utilisatrice a raconté. " +
    "Rien n'est fait avant qu'elle valide (tout ou ligne par ligne).",
  schema: { type: "object", properties: { operations: { type: "array", items: SCHEMA_OPERATION as any } }, required: ["operations"] },
  async executer(ctx, args) {
    const s = await depsSeance.enCours(ctx.userId);
    if (!s || s.projetCourant == null) return { pourModele: { erreur: "aucune_seance" } };
    const r = await proposerHorsConversation(ctx.userId, "appliquer_bilan_projet", { projectId: s.projetCourant, operations: args.operations }, ctx.maintenant, { fuseau: ctx.fuseau });
    if ("erreur" in r) return { pourModele: { erreur: r.erreur } };
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

export const OUTILS_SEANCE: Outil[] = [proposerBilanProjet, passerProjetOutil];
