// Les vraies dépendances du module (base, IA, Bright Data, recherche Google).
import { storage } from "../../storage";
import { CLAUDE_MODELS } from "../claude";
import { gardeDepense } from "../routines/garde";
import { SCRAPE_COST_EUR } from "../usage";
import { collecterParLot, instagramDataset } from "../brightdata-enrich";
import { chercher } from "../veille/collecte";
import { genererStructure } from "../ai/structure";
import { soumettreLot, lireLot } from "../ai/lots";
import { stockageProfils as s } from "./stockage";
import { collecterProfil, type DepsCollecte } from "./collecte";
import { lireProfilInstagram } from "./collecte/instagram";
import { lancerAnalyse, finaliserAnalyse, SCHEMA_CLASSEMENT, type DepsAnalyse } from "./analyse";
import { rattacherProjet, SCHEMA_CHOIX, SCHEMA_PROPOSITION, type DepsRattachement } from "./rattachement";
import { trierPourProjet, SCHEMA_TRI, type DepsTri } from "./tri";
import { semaineDe } from "@shared/profils-veille";
import type { DepsTour } from "./planificateur";

export async function estOuvertPour(userId: string): Promise<boolean> {
  if (process.env.PROFILS_VEILLE_POUR_TOUS === "true") return true;
  return (await storage.getUser(userId))?.role === "owner";
}

export const depsCollecte: DepsCollecte = {
  comptesSuivis: s.comptesSuivis, reserverPassage: s.reserverPassage, terminerPassage: s.terminerPassage,
  collecter: async (plateforme, urls) => {
    if (plateforme !== "instagram") return null;
    const ds = instagramDataset();
    return ds ? collecterParLot(ds, urls) : null;
  },
  lireProfil: lireProfilInstagram,
  clesExistantes: s.clesExistantes, enregistrerPosts: s.enregistrerPosts, historiqueCompte: s.historiqueCompte,
  marquerForts: s.marquerForts, majCompte: s.majCompte, depenseDuMois: s.depenseDuMois,
  coutParCompte: SCRAPE_COST_EUR,
};

const SYSTEME_CLASSEMENT =
  "Tu classes des publications de marques sur les réseaux sociaux. Pour chaque post (type de média + légende), donne sa structure et son type d'accroche, " +
  "en choisissant uniquement dans les valeurs proposées. Si rien ne correspond, « autre » avec un libellé court. Ne devine pas au-delà de ce que dit la légende.";

export const depsAnalyse: DepsAnalyse = {
  creerAnalyse: s.creerAnalyse, majAnalyse: s.majAnalyse, depenseDuMois: s.depenseDuMois,
  postsAClasser: s.postsAClasser, enregistrerFormat: s.enregistrerFormat, postsFenetre: s.postsFenetre,
  exemples: s.exemples, tendancesPrecedentes: s.tendancesPrecedentes as any, enregistrerTendances: s.enregistrerTendances,
  classer: async (posts) => {
    const { valeur, coutEur } = await genererStructure({
      schema: SCHEMA_CLASSEMENT, system: SYSTEME_CLASSEMENT, model: CLAUDE_MODELS.fast, maxTokens: 2500,
      taskKind: "classification", etape: "classement des formats",
      prompt: posts.map((p) => `#${p.id} [${p.typeMedia}] ${(p.legende ?? "(sans légende)").replace(/\s+/g, " ").slice(0, 500)}`).join("\n"),
    });
    return { resultats: valeur.posts, coutEur };
  },
  soumettre: (reqs) => soumettreLot(reqs),
  lire: (id) => lireLot(id),
  modeleRaisonnement: CLAUDE_MODELS.smart, modeleRapide: CLAUDE_MODELS.fast,
};

function contexteProjet(nom: string, dna: any, fond: any): string {
  const motivations = Array.isArray(fond?.motivations) ? fond.motivations.map((m: any) => m?.nom).filter(Boolean).join(", ") : "";
  return [
    `Marque : ${dna?.businessName || nom}`,
    dna?.businessType ? `Type de business : ${dna.businessType}` : "",
    dna?.businessDescription ? `Description : ${dna.businessDescription}` : "",
    dna?.primaryAudience ? `Cible : ${dna.primaryAudience}` : "",
    dna?.platformPriority ? `Plateformes : ${dna.platformPriority}` : "",
    fond?.offre?.nom ? `Offre d'entrée : ${fond.offre.nom}` : "",
    motivations ? `Motivations d'achat : ${motivations}` : "",
  ].filter(Boolean).join("\n");
}

export const depsRattachement: DepsRattachement = {
  garde: gardeDepense,
  catalogue: s.catalogueActif as any,
  choisir: async ({ userId, projectId, contexte, catalogue }) => (await genererStructure({
    schema: SCHEMA_CHOIX, model: CLAUDE_MODELS.fast, maxTokens: 400, taskKind: "classification", etape: "rattachement", userId, projectId,
    system: "Tu ranges une marque dans le profil de veille qui lui ressemble le plus (même type de marque, même cible). Si aucun ne lui ressemble vraiment, profilId null. Confiance entre 0 et 1, honnête. Raison en une phrase, en français.",
    prompt: `${contexte}\n\nProfils :\n${catalogue.map((p) => `#${p.id} ${p.nom} — ${p.description}`).join("\n")}`,
  })).valeur,
  enregistrer: s.enregistrerRattachement,
  proposer: async ({ userId, projectId, contexte }) => (await genererStructure({
    schema: SCHEMA_PROPOSITION, model: CLAUDE_MODELS.smart, maxTokens: 800, taskKind: "strategic_reasoning", etape: "proposition de profil", userId, projectId,
    system: "Tu définis un profil de veille : un TYPE de marque (jamais une marque précise), assez large pour regrouper des marques comparables. Nom court en français, description d'une phrase, critères, et jusqu'à 4 requêtes de recherche pour trouver des comptes Instagram de marques de ce type, en France de préférence.",
    prompt: contexte,
  })).valeur,
  chercher: async (userId, requetes) => {
    const liens: string[] = [];
    for (const q of requetes) {
      try { liens.push(...(await chercher(userId, q, { pays: "fr", langue: "fr" })).map((r) => r.link)); } catch (e: any) { console.error("[profils-veille] recherche :", e?.message); }
    }
    return liens;
  },
  creerProposition: s.creerProposition,
};

export const depsTri: DepsTri = {
  estOuvert: estOuvertPour,
  garde: gardeDepense,
  tendancesSemaine: s.tendancesSemaineDuProfil,
  ecartees: s.ecarteesDuProjet,
  projet: async (userId, projectId) => {
    const [pr, dna, fond] = await Promise.all([storage.getProject(projectId, userId), storage.getBrandDnaForProject(userId, projectId), storage.getFondations(userId, projectId)]);
    return { nom: pr?.name ?? "", plateformes: (dna as any)?.platformPriority ?? "", offre: (fond as any)?.offre?.nom ?? "", cible: (dna as any)?.primaryAudience ?? "" };
  },
  choisir: async ({ userId, projectId, projet, tendances }) => (await genererStructure({
    schema: SCHEMA_TRI, model: CLAUDE_MODELS.fast, maxTokens: 900, taskKind: "fast_generation", etape: "tri des tendances", userId, projectId,
    system: "Tu choisis, parmi des formats qui marchent dans un secteur, ceux qui vont à cette marque (au plus 5, zéro si aucun ne lui va), en tenant compte de ses plateformes, son offre et sa cible. Pour chacun, une phrase d'adaptation concrète à cette marque, en français, qui commence par un verbe. N'invente aucun chiffre ni client.",
    prompt: `Marque : ${projet.nom}\nPlateformes : ${projet.plateformes}\nOffre : ${projet.offre}\nCible : ${projet.cible}\n\nFormats :\n${tendances.map((t) => `#${t.id} ${t.plateforme} · ${t.typeMedia} ${t.structure} (×${t.lift.toFixed(1)}) — ${t.commentAdapter}`).join("\n")}`,
  })).valeur,
  enregistrer: s.enregistrerTendancesProjet,
  marquerTri: s.marquerTri,
};

export const depsTour: DepsTour = {
  projetsARattacher: async () => (await s.projetsARattacher(await storage.getActiveUserIds())).map((p) => ({ ...p, contexte: contexteProjet(p.nom, p.dna, p.fond) })),
  rattacher: (p) => rattacherProjet(depsRattachement, { userId: p.userId, projectId: p.projectId, nom: p.nom, contexte: p.contexte, exclus: p.exclus, rattachementId: p.rattachementId }),
  profilsCollectables: s.profilsCollectables,
  collecter: (id, pl, m) => collecterProfil(depsCollecte, id, pl, m),
  lancerAnalyse: (p, semaine, m) => lancerAnalyse(depsAnalyse, p, semaine, m),
  analysesEnAttente: s.analysesEnAttente,
  finaliser: (a) => finaliserAnalyse(depsAnalyse, a),
  rattachementsATrier: () => s.rattachementsATrier(semaineDe(new Date())),
  trier: (r, semaine, m) => trierPourProjet(depsTri, r, semaine, m),
  purger: s.purgerPosts,
};
