// Premier jet : les vraies dépendances (base, sources officielles, IA, jalons).
import { CLAUDE_MODELS } from "../claude";
import { genererStructure } from "../ai/structure";
import { isAiBlocked } from "../usage";
import { appelsOffresStore, enregistrerPremierJet } from "../appels-offres-store";
import { storage } from "../../storage";
import { extraitContexte } from "./qualification";
import { relireAvis } from "./sources";
import { MAX_TOKENS_PREMIER_JET, SCHEMA_PREMIER_JET, SYSTEME_PREMIER_JET, type DepsPremierJet } from "./premier-jet";

export const depsPremierJet: DepsPremierJet = {
  lire: (id, userId) => appelsOffresStore.lireAppelOffres(id, userId),
  lister: (userId) => appelsOffresStore.listerAppelsOffres(userId),
  relireAvis: (source, sourceId) => relireAvis((u, i) => fetch(u, i) as any, source, sourceId),
  contexte: async (userId) => extraitContexte((await storage.getBrandDna(userId)) as any),
  estBloquee: (userId) => isAiBlocked(userId),
  generer: (userId, prompt) => genererStructure({
    schema: SCHEMA_PREMIER_JET,
    system: SYSTEME_PREMIER_JET,
    prompt,
    model: CLAUDE_MODELS.smart,
    maxTokens: MAX_TOKENS_PREMIER_JET,
    taskKind: "strategic_reasoning",
    etape: "premier jet d'appel d'offres",
    userId,
  }),
  enregistrer: (id, userId, texte) => enregistrerPremierJet(id, userId, texte),
  // Mêmes jalons qu'après un changement de statut (premier_jet_pret ouvre « Décider »).
  apres: async (userId) => {
    const [{ synchroniserJalonsAO }, { depsJalonsAO }, { parisTodayString }, { filActifPour }] = await Promise.all([
      import("../orchestre/jalons-ao"), import("../orchestre/jalons-ao-deps"),
      import("../../utils/timezone"), import("../fil/interrupteur"),
    ]);
    if (!filActifPour(userId)) return;
    const r = await synchroniserJalonsAO(userId, new Date(), depsJalonsAO);
    if (Object.values(r).some((n) => n > 0)) await storage.fixOverlappingTasks(userId, parisTodayString(new Date()));
  },
};
