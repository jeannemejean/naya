/**
 * Bibliothèque de preuves : règles pures. Une preuve est une réalisation réelle de
 * l'utilisatrice (client ou type de client, ce qui a été fait, le résultat, un lien).
 *
 * Pourquoi : sans matière concrète, et avec l'interdiction (juste) d'inventer une ressource,
 * Naya comblait le vide par du lyrisme. Seules les preuves VALIDÉES par l'utilisatrice sont
 * utilisées, et `citable=false` interdit d'écrire le nom du client.
 */
import type { ProjectProof, InsertProjectProof } from "@shared/schema";
import { normaliserTexte } from "../sequence-distinct";

export const STATUTS_PREUVE = ["proposed", "validated", "archived"] as const;
export const SOURCES_PREUVE = ["manual", "site", "post", "document"] as const;

/** Texte de la preuve tel qu'on le donne au rédacteur. */
export function texteDePreuve(p: ProjectProof): string {
  const qui = p.citable
    ? `Client : ${p.clientLabel} (peut être nommé)`
    : `Client : ne pas nommer ce client ; parle d'un type de client (« ${typeClient(p)} »)`;
  return [
    qui,
    `Ce qui a été fait : ${p.whatWasDone}`,
    p.result ? `Résultat : ${p.result}` : "",
    p.url ? `Lien utilisable tel quel : ${p.url}` : "Aucun lien : n'en propose pas.",
  ].filter(Boolean).join("\n");
}

/** Type de client à utiliser quand le nom est confidentiel : un tag, sinon une formule neutre. */
function typeClient(p: ProjectProof): string {
  const tag = (p.tags || []).find((t) => t && t.trim());
  return tag ? `une marque du secteur ${tag.trim()}` : "une marque comparable";
}

export function liensDePreuve(p: ProjectProof | null | undefined): string[] {
  return p?.url ? [p.url] : [];
}

const cle = (x: { clientLabel?: string | null; whatWasDone?: string | null }) =>
  `${normaliserTexte(x.clientLabel || "")}|${normaliserTexte(x.whatWasDone || "")}`;

export function dedoublonnerPropositions<T extends { clientLabel?: string | null; whatWasDone?: string | null }>(
  existantes: Array<{ clientLabel: string; whatWasDone: string }>, nouvelles: T[],
): T[] {
  const vues = new Set(existantes.map(cle));
  const out: T[] = [];
  for (const n of nouvelles) {
    const k = cle(n);
    if (!n.clientLabel?.trim() || !n.whatWasDone?.trim() || vues.has(k)) continue;
    vues.add(k);
    out.push(n);
  }
  return out;
}

type ChampsPreuve = Pick<InsertProjectProof, "clientLabel" | "citable" | "whatWasDone" | "result" | "url" | "tags" | "status" | "mediaId">;
export type ResultatValidation = { ok: true; valeur: Partial<ChampsPreuve> } | { ok: false; erreur: string };

const texte = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : undefined);

/** Valide et nettoie le corps d'une requête (création, ou mise à jour si `partiel`). */
export function validerPreuve(body: any, opts: { partiel?: boolean } = {}): ResultatValidation {
  const v: Partial<ChampsPreuve> = {};
  const b = body ?? {};
  if ("clientLabel" in b || !opts.partiel) {
    const t = texte(b.clientLabel, 160);
    if (!t) return { ok: false, erreur: "client_requis" };
    v.clientLabel = t;
  }
  if ("whatWasDone" in b || !opts.partiel) {
    const t = texte(b.whatWasDone, 600);
    if (!t) return { ok: false, erreur: "realisation_requise" };
    v.whatWasDone = t;
  }
  if ("result" in b) v.result = texte(b.result, 400) || null;
  if ("citable" in b) v.citable = b.citable === true;
  if ("url" in b) {
    const u = texte(b.url, 500);
    if (u && !/^https?:\/\/[^\s]+$/i.test(u)) return { ok: false, erreur: "url_invalide" };
    v.url = u || null;
  }
  if ("tags" in b) v.tags = Array.isArray(b.tags) ? b.tags.filter((t: unknown) => typeof t === "string" && t.trim()).map((t: string) => t.trim().slice(0, 60)).slice(0, 12) : [];
  if ("status" in b) {
    if (!STATUTS_PREUVE.includes(b.status)) return { ok: false, erreur: "statut_invalide" };
    v.status = b.status;
  }
  if ("mediaId" in b) v.mediaId = Number.isInteger(b.mediaId) ? b.mediaId : null;
  return { ok: true, valeur: v };
}

export interface PropositionPreuve {
  clientLabel: string; whatWasDone: string; result: string | null; tags: string[]; citable: false;
}

/** Réponse de l'IA d'extraction → propositions. Jamais citables d'office : c'est à l'utilisatrice de le dire. */
export function parsePropositions(raw: string): PropositionPreuve[] {
  let obj: any;
  try { obj = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || raw); } catch { return []; }
  const arr: any[] = Array.isArray(obj?.preuves) ? obj.preuves : [];
  return arr
    .map((x) => ({
      clientLabel: texte(x?.clientLabel, 160) || "",
      whatWasDone: texte(x?.whatWasDone, 600) || "",
      result: texte(x?.result, 400) || null,
      tags: Array.isArray(x?.tags) ? x.tags.filter((t: unknown) => typeof t === "string").slice(0, 12) : [],
      citable: false as const,
    }))
    .filter((x) => x.clientLabel && x.whatWasDone)
    .slice(0, 20);
}
