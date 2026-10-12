/**
 * Brief stratégique par prospect : rédigé UNE fois après l'enrichissement, il pilote toute
 * la séquence.
 *  - déclencheur : le fait réel et daté qui justifie d'écrire maintenant ;
 *  - preuve : au plus une preuve validée de la bibliothèque du projet ;
 *  - raison : pourquoi lui, pourquoi maintenant, pourquoi nous ;
 *  - proposition : ce qu'on apporte (une preuve, une idée, un échange) ;
 *  - angles : un angle par touche, décidé à l'avance (la variété est prévue, pas corrigée).
 *
 * Sans déclencheur réel, AUCUN message n'est rédigé : le prospect est « à compléter ».
 * Une note de l'utilisatrice sur le prospect (« vu au salon X ») sert alors de déclencheur.
 *
 * Les fonctions parse/lire/éditer sont PURES et testées ; genererBrief orchestre les appels.
 */
import { callClaudeWithContext, CLAUDE_MODELS } from "../claude";
import { serpSearch, serpConfigured } from "../serp";
import { logProspectionUsage } from "../prospection-access";
import { normaliserTexte } from "../sequence-distinct";
import { texteDePreuve } from "./preuves";
import type { ProjectProof } from "@shared/schema";

export interface Declencheur { fait: string; source: string; url?: string; date?: string }
export type TypeProposition = "preuve" | "idee" | "echange";

export interface BriefProspect {
  declencheur: Declencheur | null;
  preuveId: number | null;
  raison: string;
  proposition: { type: TypeProposition; contenu: string };
  angles: string[];
  langue: string;
  registre: "vous" | "tu";
  genereLe: string;
  edite: boolean;
}

const txt = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

function lireDeclencheur(d: any): Declencheur | null {
  const fait = txt(d?.fait, 400);
  if (!fait) return null;
  const out: Declencheur = { fait, source: txt(d?.source, 60) || "inconnue" };
  const url = txt(d?.url, 500);
  if (/^https?:\/\//i.test(url)) out.url = url;
  const date = txt(d?.date, 30);
  if (date) out.date = date;
  return out;
}

function lireAngles(a: unknown, nbTouches: number, repli: string): string[] {
  const vus = new Set<string>();
  const out: string[] = [];
  for (const x of Array.isArray(a) ? a : []) {
    const t = txt(x, 200);
    const k = normaliserTexte(t);
    if (!t || vus.has(k)) continue;
    vus.add(k);
    out.push(t);
    if (out.length >= Math.max(1, nbTouches)) break;
  }
  if (out.length === 0 && repli) out.push(repli);
  return out;
}

/** PURE : réponse de l'IA → brief, borné et vérifié (preuve uniquement parmi `preuvesValides`). */
export function parseBrief(raw: string, preuvesValides: number[], nbTouches: number): BriefProspect {
  let o: any = {};
  try { o = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || raw); } catch { o = {}; }
  const declencheur = lireDeclencheur(o?.declencheur);
  const preuveId = Number.isInteger(o?.preuveId) && preuvesValides.includes(o.preuveId) ? o.preuveId : null;
  const type: TypeProposition = ["preuve", "idee", "echange"].includes(o?.proposition?.type) ? o.proposition.type : "echange";
  return {
    declencheur,
    preuveId,
    raison: txt(o?.raison, 400),
    proposition: { type: type === "preuve" && preuveId == null ? "idee" : type, contenu: txt(o?.proposition?.contenu, 400) },
    angles: lireAngles(o?.angles, nbTouches, declencheur?.fait ?? ""),
    langue: txt(o?.langue, 10) || "fr",
    registre: o?.registre === "tu" ? "tu" : "vous",
    genereLe: new Date().toISOString(),
    edite: false,
  };
}

/** PURE : brief stocké (jsonb ou chaîne) → brief, ou null. */
export function lireBrief(v: unknown): BriefProspect | null {
  let o: any = v;
  if (typeof v === "string") { try { o = JSON.parse(v); } catch { return null; } }
  if (!o || typeof o !== "object" || Array.isArray(o)) return null;
  if (!("angles" in o) && !("declencheur" in o)) return null;
  return {
    declencheur: lireDeclencheur(o.declencheur),
    preuveId: Number.isInteger(o.preuveId) ? o.preuveId : null,
    raison: txt(o.raison, 400),
    proposition: { type: ["preuve", "idee", "echange"].includes(o?.proposition?.type) ? o.proposition.type : "echange", contenu: txt(o?.proposition?.contenu, 400) },
    angles: lireAngles(o.angles, 12, ""),
    langue: txt(o.langue, 10) || "fr",
    registre: o.registre === "tu" ? "tu" : "vous",
    genereLe: txt(o.genereLe, 40),
    edite: o.edite === true,
  };
}

export function briefActionnable(b: BriefProspect | null | undefined): b is BriefProspect {
  return !!b?.declencheur?.fait;
}

export function angleDeTouche(b: BriefProspect, index: number): string {
  if (b.angles.length === 0) return b.declencheur?.fait ?? "";
  return b.angles[Math.min(Math.max(0, index), b.angles.length - 1)];
}

export type EditionBrief = Partial<Pick<BriefProspect, "raison" | "angles" | "preuveId" | "registre">> & {
  declencheur?: { fait: string; source?: string; url?: string; date?: string } | null;
  proposition?: { type?: string; contenu?: string };
};

/** PURE : modification par l'utilisatrice (route PATCH /api/leads/:id/brief). */
export function appliquerEditionBrief(
  actuel: BriefProspect | null, e: EditionBrief, preuvesValides: number[],
): { ok: true; brief: BriefProspect } | { ok: false; erreur: string } {
  const base: BriefProspect = actuel ?? {
    declencheur: null, preuveId: null, raison: "", proposition: { type: "echange", contenu: "" },
    angles: [], langue: "fr", registre: "vous", genereLe: new Date().toISOString(), edite: false,
  };
  const b: BriefProspect = { ...base, edite: true };
  if (e.declencheur !== undefined) b.declencheur = e.declencheur ? lireDeclencheur({ source: "note", ...e.declencheur }) : null;
  if (e.raison !== undefined) b.raison = txt(e.raison, 400);
  if (e.angles !== undefined) b.angles = lireAngles(e.angles, 12, "");
  if (e.registre !== undefined) b.registre = e.registre === "tu" ? "tu" : "vous";
  if (e.preuveId !== undefined) {
    if (e.preuveId !== null && !preuvesValides.includes(e.preuveId)) return { ok: false, erreur: "preuve_inconnue" };
    b.preuveId = e.preuveId;
  }
  if (e.proposition !== undefined) {
    const type = ["preuve", "idee", "echange"].includes(e.proposition.type as string) ? (e.proposition.type as TypeProposition) : b.proposition.type;
    b.proposition = { type, contenu: e.proposition.contenu !== undefined ? txt(e.proposition.contenu, 400) : b.proposition.contenu };
  }
  if (b.angles.length === 0 && b.declencheur) b.angles = [b.declencheur.fait];
  return { ok: true, brief: b };
}

/** Une recherche d'actualité sur l'entreprise du prospect (au plus un appel, jamais bloquant). */
async function actualiteEntreprise(userId: string, company: string, campaignId: number, leadId: number): Promise<string> {
  if (!company || !serpConfigured()) return "";
  try {
    const res = await serpSearch(`"${company}"`, userId, { vertical: "news", langue: "fr" });
    await logProspectionUsage(userId, "bright_data_search", { prospectId: leadId, campaignId }).catch(() => {});
    return res.slice(0, 5).map((r) => `- ${r.title}${r.publishedAtRaw ? ` (${r.publishedAtRaw})` : ""} ${r.link}${r.description ? `\n  ${r.description}` : ""}`).join("\n");
  } catch {
    return "";
  }
}

export async function genererBrief(userId: string, args: {
  lead: any; campaign: any; projectId: number | null; enrichText: string; audit: Record<string, string>;
  preuves: ProjectProof[]; nbTouches: number;
}): Promise<BriefProspect> {
  const { lead, campaign } = args;
  const actu = await actualiteEntreprise(userId, lead?.company || "", campaign?.id, lead?.id);
  const preuves = args.preuves.filter((p) => p.status === "validated");
  const note = typeof lead?.notes === "string" ? lead.notes.trim() : "";

  const prompt = `Tu prépares le BRIEF d'une prise de contact, pas le message. Tu décides : pourquoi écrire à cette personne MAINTENANT, avec quoi, et sous quels angles successifs.

PROSPECT : ${lead?.name || ""}, ${lead?.role || ""} chez ${lead?.company || "?"}
CAMPAGNE : ${campaign?.name || ""}
Objectif : ${campaign?.campaignBrief || "non précisé"}
Offre mise en avant : ${campaign?.offer || "non précisée"}

CE QU'ON SAIT DU PROSPECT
${args.enrichText || "(peu de données)"}

AUDIT
${Object.entries(args.audit || {}).map(([k, v]) => `${k} : ${v}`).join("\n") || "(aucun)"}

ACTUALITÉ RÉCENTE DE L'ENTREPRISE
${actu || "(rien trouvé)"}
${note ? `\nNOTE DE L'UTILISATRICE SUR CE PROSPECT (fait vérifié, utilisable comme déclencheur) : ${note}\n` : ""}
PREUVES DISPONIBLES (réalisations réelles de l'utilisatrice ; choisis-en au plus une, la plus proche de ce prospect, ou aucune)
${preuves.length ? preuves.map((p) => `[id ${p.id}]\n${texteDePreuve(p)}`).join("\n\n") : "(aucune preuve validée)"}

RÈGLES
- Le déclencheur est un fait RÉEL, précis et nommé, présent ci-dessus (une publication, un lancement, une nomination, une actualité, ou la note de l'utilisatrice). Si rien de tel n'existe, mets "declencheur": null. N'invente jamais.
- La raison tient en une phrase : pourquoi lui, pourquoi maintenant, pourquoi nous.
- La proposition est concrète : "preuve" (si une preuve est choisie), "idee" (une idée précise pour SA marque), ou "echange".
- Prévois ${args.nbTouches} angles DIFFÉRENTS, un par touche, dans l'ordre (le premier exploite le déclencheur).
- Langue : celle du prospect. Registre : "vous" sauf indice clair de tutoiement.

Réponds UNIQUEMENT avec ce JSON :
{"declencheur":{"fait":"...","source":"post|site|actualite|note|profil","url":"...","date":"..."},"preuveId":null,"raison":"...","proposition":{"type":"preuve|idee|echange","contenu":"..."},"angles":["..."],"langue":"fr","registre":"vous"}`;

  const raw = await callClaudeWithContext({
    userId, projectId: args.projectId, userMessage: prompt,
    model: CLAUDE_MODELS.smart, max_tokens: 1200, temperature: 0.3, destinataire: "tiers",
  });
  const brief = parseBrief(raw, preuves.map((p) => p.id), args.nbTouches);
  // Filet : une note de l'utilisatrice est un déclencheur réel, même si le modèle l'a ignorée.
  if (!brief.declencheur && note) {
    brief.declencheur = { fait: note.slice(0, 400), source: "note" };
    if (brief.angles.length === 0) brief.angles = [brief.declencheur.fait];
  }
  return brief;
}
