import { canonicalizeUrl, hashUrl, normalizeTitle } from "./url";
import { callClaude, CLAUDE_MODELS } from "../claude";

// ── Constantes de politique. Aucune n'est un réglage utilisateur. ──────────────
export const FRAICHEUR_JOURS = 7;
export const SEUIL_RETENTION = 0.7;
export const MAX_FICHES = 3;
export const MAX_PAR_PROJET = 2;

// Agrégateurs et fermes de contenu : ils republient sans rien ajouter, et leurs URLs
// ne mènent pas à la source. Liste volontairement courte — à étendre sur constat, pas
// par précaution.
export const DOMAINES_EXCLUS = [
  "news.google.com",
  "msn.com",
  "flipboard.com",
  "medium.com",
  "pinterest.com",
  "quora.com",
];

export interface CandidatBrut {
  url: string;
  title: string;
  source?: string | null;
  publishedAt: Date | null;
  projectId: number;
}

export interface Candidat {
  url: string;          // URL canonique
  urlHash: string;
  title: string;
  source: string | null;
  publishedAt: Date;
  projectId: number;
}

/**
 * Étage 1 du tri : déterministe, pur, sans modèle. Il élimine ce qu'aucun jugement
 * ne rattraperait — le vieux, le déjà-vu, l'agrégateur, le doublon — AVANT de payer
 * le moindre appel. Un candidat sans date est écarté : une date inconnue n'est pas
 * une date fraîche, et une fiche sur un article de 2019 détruit la confiance.
 */
export function etage1(bruts: CandidatBrut[], opts: { today: Date; urlHashDejaVus: Set<string> }): Candidat[] {
  const limite = opts.today.getTime() - FRAICHEUR_JOURS * 24 * 3600 * 1000;
  const hashDuLot = new Set<string>();
  const titresDuLot = new Set<string>();
  const out: Candidat[] = [];

  for (const b of bruts) {
    // Une Invalid Date est un objet TRUTHY dont getTime() vaut NaN : ni `!b.publishedAt`
    // ni `NaN < limite` ne l'écartent seuls, donc sans le garde explicite `!Number.isFinite`,
    // une date invalide se comporterait comme une date fraîche — l'inverse de la règle.
    // Point de passage obligé : il doit tenir seul même si l'amont change un jour.
    if (!b.publishedAt || !Number.isFinite(b.publishedAt.getTime()) || b.publishedAt.getTime() < limite) continue;

    const canonique = canonicalizeUrl(b.url);
    if (!canonique) continue;

    const hote = new URL(canonique).hostname;
    if (DOMAINES_EXCLUS.some((d) => hote === d || hote.endsWith(`.${d}`))) continue;

    const h = hashUrl(canonique);
    if (opts.urlHashDejaVus.has(h) || hashDuLot.has(h)) continue;

    const titre = normalizeTitle(b.title);
    // Un titre qui se normalise en chaîne vide est indiscernable d'un doublon,
    // mais c'est un candidat invalide : reading_cards.title est NOT NULL.
    if (!titre) continue;
    // Un titre déjà vu dans ce lot est un doublon : on garde le premier arrivé.
    if (titresDuLot.has(titre)) continue;

    hashDuLot.add(h);
    titresDuLot.add(titre);
    out.push({
      url: canonique,
      urlHash: h,
      title: b.title,
      source: b.source ?? null,
      publishedAt: b.publishedAt,
      projectId: b.projectId,
    });
  }

  return out;
}

// ── Étage 2 : le jugement comparatif du modèle, et le seuil hors de sa portée. ─────

export interface Note { url: string; score: number; rationale: string }

export const PROMPT_TRI = `Tu tries une veille pour UNE marque précise.

On te donne le contexte de la marque, puis une liste d'articles d'actualité récents
(titre, source, date, URL). Tu réponds à UNE SEULE question, pour chacun :

  « Cette personne, avec CETTE marque, a-t-elle quelque chose de NON ÉVIDENT à en dire ? »

Tu ne juges pas si l'article est bon, intéressant en soi, ou bien écrit. Tu juges s'il
appelle un point de vue que seule cette personne peut donner. Un article que n'importe
qui commenterait pareil ne vaut rien ici.

Tu notes les articles LES UNS PAR RAPPORT AUX AUTRES : le meilleur du lot n'est pas
forcément bon. Si aucun ne mérite mieux que 0.5, note-les tous en dessous de 0.5.
Ne cherche pas à en faire ressortir un.

Réponds UNIQUEMENT par un tableau JSON, sans texte autour :
[{"url": "...", "score": 0.0 à 1.0, "rationale": "une phrase, en français"}]`;

/** Lit la sortie du modèle. Tolérante au bavardage et aux balises markdown. Pure. */
export function parseNotes(raw: string): Note[] {
  if (!raw || !raw.trim()) return [];
  const debut = raw.indexOf("[");
  const fin = raw.lastIndexOf("]");
  if (debut === -1 || fin <= debut) return [];
  let brut: any;
  try { brut = JSON.parse(raw.slice(debut, fin + 1)); } catch { return []; }
  if (!Array.isArray(brut)) return [];
  return brut
    .filter((n) => n && typeof n.url === "string" && typeof n.score === "number" && n.score >= 0 && n.score <= 1)
    .map((n) => ({ url: n.url, score: n.score, rationale: typeof n.rationale === "string" ? n.rationale : "" }));
}

/**
 * Applique le seuil et les plafonds. Volontairement HORS du modèle : le nombre de fiches
 * est ce qui reste après le seuil, jamais un quota à remplir. Aucun chemin de ce code
 * ne peut abaisser SEUIL_RETENTION pour produire une fiche de plus.
 */
export function selectionFinale(
  candidats: Candidat[],
  notes: Note[],
): Array<Candidat & { score: number; rationale: string }> {
  const parUrl = new Map(candidats.map((c) => [c.url, c]));

  // Le modèle peut noter deux fois la même URL — sa sortie n'est jamais garantie unique.
  // Sans cette étape, un même article pourrait occuper deux des trois places du plafond ;
  // l'index unique en base n'est qu'un filet de sécurité, pas la règle. On garde la
  // meilleure note pour chaque URL avant d'appliquer le seuil.
  const meilleureNoteParUrl = new Map<string, Note>();
  for (const n of notes) {
    const existante = meilleureNoteParUrl.get(n.url);
    if (!existante || n.score > existante.score) meilleureNoteParUrl.set(n.url, n);
  }

  const retenus = Array.from(meilleureNoteParUrl.values())
    .filter((n) => n.score >= SEUIL_RETENTION && parUrl.has(n.url))
    .sort((a, b) => b.score - a.score)
    .map((n) => ({ ...(parUrl.get(n.url) as Candidat), score: n.score, rationale: n.rationale }));

  const out: Array<Candidat & { score: number; rationale: string }> = [];
  const parProjet = new Map<number, number>();
  for (const r of retenus) {
    if (out.length >= MAX_FICHES) break;
    const n = parProjet.get(r.projectId) ?? 0;
    if (n >= MAX_PAR_PROJET) continue;
    parProjet.set(r.projectId, n + 1);
    out.push(r);
  }
  return out;
}

/**
 * Étage 2 : UN SEUL appel par marque, avec toute la liste. Le modèle voit le champ
 * entier, donc il distingue « le meilleur d'aujourd'hui » de « bon dans l'absolu » —
 * ce qu'un jugement article par article ne sait pas faire.
 */
export async function noterCandidats(input: {
  userId: string;
  projectId: number;
  contexteMarque: string;
  candidats: Candidat[];
}): Promise<Note[]> {
  if (input.candidats.length === 0) return [];
  const liste = input.candidats
    .map((c, i) => `${i + 1}. ${c.title}\n   source: ${c.source ?? "inconnue"} — ${c.publishedAt.toISOString().slice(0, 10)}\n   url: ${c.url}`)
    .join("\n");
  try {
    const raw = await callClaude({
      model: CLAUDE_MODELS.smart,
      taskKind: "strategic_reasoning",
      system: PROMPT_TRI,
      max_tokens: 2048,
      userId: input.userId,
      projectId: input.projectId,
      messages: [{ role: "user", content: `CONTEXTE DE LA MARQUE\n${input.contexteMarque}\n\nARTICLES DU JOUR\n${liste}` }],
    });
    return parseNotes(raw);
  } catch (err: any) {
    console.error(`[Lecture] notation projet ${input.projectId} échouée:`, err?.message);
    return []; // best-effort : pas de note → pas de fiche, jamais d'erreur visible
  }
}
