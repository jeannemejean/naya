// Propositions à valider de l'agent omniscient (spec §6.3) : pour un gros changement, l'agent
// n'exécute RIEN. Il produit un aperçu (la liste précise des changements, avant → après) et
// l'enregistre comme proposition `en_attente`, valable 1 h. Jeanne clique « Valider » ou
// « Annuler » (« Ajuster » = elle répond dans le fil, le client annule la proposition affichée).
//
// À la validation, dans cet ordre :
//   1. introuvable  — pas de proposition à cet id POUR CETTE utilisatrice ;
//   2. deja_traitee — déjà validée, annulée ou expirée ;
//   3. expiree      — l'heure est passée : `maintenant >= expire_a` (pile 60 min = expirée) ;
//   4. expiree      — l'empreinte n'est plus vraie : un des champs lus à l'aperçu a changé, ou
//                     la ligne a disparu / n'est plus à elle. Rien n'est exécuté ;
//   5. réclamation atomique (`en_attente` → `validee`, conditionnelle en base) : sur deux
//      clics simultanés, un seul exécute ; l'autre reçoit deja_traitee ;
//   6. exécution, élément par élément (réussite partielle possible), résultat enregistré.
import type { Changement, PropositionVue } from "@shared/agent";
import type { Task } from "@shared/schema";
import { storage } from "../../storage";
import { lireMoisMesure } from "../mesure/completer";
import { depot } from "./depot";
import { memeValeur } from "./journal";
import type { ContexteOutil, Outil, ResultatOutil } from "./registre";

export const DUREE_PROPOSITION_MS = 60 * 60 * 1000;

// Ce qu'on a lu à l'aperçu, pour chaque ligne que l'exécution touchera. Relu à la validation,
// toujours borné à l'utilisatrice.
export type Empreinte = { table: string; id: number; champs: Record<string, unknown> }[];

export interface Apercu {
  resume: string;
  changements: Changement[];
  empreinte: Empreinte;
}

export interface BilanExecution {
  reussis: string[];
  echecs: string[];
}

// Un refus d'aperçu : `erreur`, plus d'éventuels détails utiles au modèle (renvoyés tels quels).
export type RefusApercu = { erreur: string } & Record<string, unknown>;

export interface OutilAValider<A> {
  apercu(ctx: ContexteOutil, args: A): Promise<Apercu | RefusApercu>;
  executer(ctx: ContexteOutil, args: A): Promise<BilanExecution>;
}

// Un outil « à valider » tel que le registre le voit : son `executer` côté modèle ne fait que
// l'aperçu et enregistre la proposition ; l'exécution réelle est dans `aValider.executer`.
export type OutilPropose = Outil & { aValider: OutilAValider<any> };

export function outilAValider<A>(def: {
  nom: string;
  description: string;
  schema: Outil["schema"];
} & OutilAValider<A>): OutilPropose {
  const aValider: OutilAValider<A> = { apercu: def.apercu, executer: def.executer };
  return {
    nom: def.nom,
    classe: "a_valider",
    description: def.description,
    schema: def.schema,
    aValider,
    async executer(ctx, args): Promise<ResultatOutil> {
      const a = await aValider.apercu(ctx, args as A);
      if ("erreur" in a) return { pourModele: a };
      const expireA = new Date(ctx.maintenant.getTime() + DUREE_PROPOSITION_MS);
      const p = await depot.ajouterProposition(ctx.userId, def.nom, args, a.changements, a.empreinte, expireA);
      const proposition: PropositionVue = {
        id: p.id, resume: a.resume, changements: a.changements, expireA: expireA.toISOString(),
      };
      return {
        pourModele: {
          a_valider: true,
          propositionId: p.id,
          resume: a.resume,
          changements: a.changements.length,
          consigne: "Rien n'est fait : la proposition attend que l'utilisatrice la valide (1 h au plus).",
        },
        proposition,
      };
    },
  };
}

// ── Lecture fraîche des lignes de l'empreinte ──────────────────────────────────────────
// Chaque lecteur rend la ligne actuelle de l'utilisatrice, ou undefined (disparue / à une autre).

// Les tâches « à faire » d'un jour : non cochées, non archivées, pas des marqueurs de jalon.
export async function tachesNonFaitesDuJour(userId: string, date: string): Promise<Task[]> {
  const taches = await storage.getTasksInRange(userId, date, date);
  return (taches as any[])
    .filter((t) => t.userId === userId && !t.completed && !t.archivedAt && t.type !== "milestone"
      && String(t.scheduledDate ?? "").slice(0, 10) === date && Number.isInteger(t.id) && t.id > 0)
    .sort((a, b) => a.id - b.id);
}

type Lecteur = (userId: string, id: number, champs: Record<string, unknown>) => Promise<Record<string, unknown> | undefined>;

const LECTEURS: Record<string, Lecteur> = {
  async tasks(userId, id) {
    const t = await storage.getTask(id);
    return t && (t as any).userId === userId ? (t as any) : undefined;
  },
  async projects(userId, id) {
    return (await storage.getProject(id, userId)) as any;
  },
  async project_milestones(userId, id) {
    const j = await storage.getMilestone(id);
    return j && j.userId === userId ? (j as any) : undefined;
  },
  // id = projet ; champs.mois = le mois. L'id de la ligne (null si le mois n'existait pas) fait
  // partie des champs : un mois saisi entre-temps rend la proposition périmée.
  async mesures_mensuelles(userId, id, champs) {
    const projet = await storage.getProject(id, userId);
    if (!projet || typeof champs.mois !== "string") return undefined;
    const ligne = await lireMoisMesure(userId, id, champs.mois);
    return { ...(ligne ?? {}), id: ligne?.id ?? null, mois: champs.mois };
  },
  // id = projet ; champs = { nombre } : le nombre de jalons du projet. Un jalon créé depuis
  // l'aperçu (creer_jalons ne s'applique qu'à un projet sans jalon) rend la proposition périmée.
  async jalons_du_projet(userId, id) {
    const projet = await storage.getProject(id, userId);
    if (!projet) return undefined;
    return { nombre: (await storage.getMilestones(id, userId)).length };
  },
  // id = 0 (pas une ligne) ; champs = { date, ids } : la liste des tâches à faire du jour.
  // Une tâche ajoutée, cochée ou partie depuis l'aperçu la change.
  async taches_du_jour(userId, _id, champs) {
    if (typeof champs.date !== "string") return undefined;
    const ids = (await tachesNonFaitesDuJour(userId, champs.date)).map((t) => t.id);
    return { date: champs.date, ids };
  },
};

async function empreinteIntacte(userId: string, empreinte: unknown): Promise<boolean> {
  if (!Array.isArray(empreinte)) return false;
  for (const e of empreinte as Empreinte) {
    const lire = LECTEURS[e?.table];
    if (!lire) return false; // table inconnue : prudence, on ne valide pas
    const actuelle = await lire(userId, Number(e.id), e.champs ?? {});
    if (!actuelle) return false;
    for (const [champ, valeur] of Object.entries(e.champs ?? {})) {
      if (!memeValeur(actuelle[champ], valeur)) return false;
    }
  }
  return true;
}

// ── Valider / annuler ──────────────────────────────────────────────────────────────────

export type ResultatValidation =
  | { ok: true; reussis: string[]; echecs: string[] }
  | { ok: false; raison: "introuvable" | "deja_traitee" | "expiree" };

export async function validerProposition(
  userId: string,
  id: number,
  maintenant: Date,
  options: { fuseau?: string; outils?: Outil[] } = {},
): Promise<ResultatValidation> {
  // Le dépôt filtre sur userId : la proposition d'une autre est « introuvable ».
  const p = await depot.getProposition(id, userId);
  if (!p) return { ok: false, raison: "introuvable" };
  if (p.statut !== "en_attente") return { ok: false, raison: "deja_traitee" };

  // Import différé : le registre importe les outils, qui importent ce module.
  const outils = options.outils ?? (await import("./registre")).REGISTRE;
  const o = outils.find((x) => x.nom === p.outil) as OutilPropose | undefined;
  if (!o?.aValider) return { ok: false, raison: "introuvable" };

  // Expirée (pile 60 min comprise), ou ce qui était vrai à l'aperçu ne l'est plus : on la
  // marque expirée, sans rien exécuter.
  const perimee = maintenant.getTime() >= new Date(p.expireA).getTime()
    || !(await empreinteIntacte(userId, p.empreinte));
  if (perimee) {
    const marquee = await depot.reclamerProposition(id, userId, "expiree");
    return { ok: false, raison: marquee ? "expiree" : "deja_traitee" };
  }

  // Un seul clic gagne : la réclamation est conditionnelle en base.
  if (!(await depot.reclamerProposition(id, userId, "validee"))) return { ok: false, raison: "deja_traitee" };

  const ctx: ContexteOutil = { userId, maintenant, fuseau: options.fuseau ?? "Europe/Paris" };
  let bilan: BilanExecution;
  try {
    bilan = await o.aValider.executer(ctx, p.arguments as any);
  } catch (e: any) {
    // Les outils traitent chaque élément à part ; une erreur ici a tout interrompu.
    console.error(`[agent] exécution de la proposition ${id} (${p.outil}) :`, e?.message ?? e);
    bilan = { reussis: [], echecs: ["L'exécution s'est interrompue sur une erreur imprévue."] };
  }
  await depot.majProposition(id, userId, { resultat: bilan });
  return { ok: true, reussis: bilan.reussis, echecs: bilan.echecs };
}

export async function annulerProposition(
  userId: string,
  id: number,
): Promise<{ ok: true } | { ok: false; raison: "introuvable" | "deja_traitee" }> {
  const p = await depot.getProposition(id, userId);
  if (!p) return { ok: false, raison: "introuvable" };
  if (!(await depot.reclamerProposition(id, userId, "annulee"))) return { ok: false, raison: "deja_traitee" };
  return { ok: true };
}
