import { parseCsv } from "../../csv";
import type { ReceptionSignal, ReceptionSource, CsvRowError } from "../types";

/**
 * Adaptateur manuel — l'unique adaptateur de ce lot.
 *
 * La réception (saves, shares, ...) n'est récupérable sur AUCUN réseau connecté
 * aujourd'hui (voir types.ts). Le Fil 3 doit donc fonctionner dès aujourd'hui avec de la
 * saisie humaine : un import CSV, poussé par la personne qui possède la donnée. Réutilise
 * `parseCsv` de `server/services/csv.ts` — aucune ré-écriture de parseur ici.
 */

const REQUIRED_COLUMNS = ["content_id", "platform"] as const;

/**
 * Découpe le texte source en lignes PHYSIQUES (celles du fichier tel qu'ouvert dans un
 * éditeur), \r\n et \n compris. On ne délègue pas ce comptage à `parseCsv` : celui-ci
 * élimine silencieusement les lignes vides de son tableau de sortie, ce qui désynchronise
 * tout numéro de ligne calculé depuis l'index de ce tableau dès qu'une ligne vide apparaît
 * au milieu du fichier — un cas fréquent dans un CSV édité à la main.
 */
function splitPhysicalLines(text: string): string[] {
  const lines = text.split(/\r?\n/);
  // Un saut de ligne final produit un dernier élément vide qui ne correspond à aucune ligne
  // réelle du fichier (pas à une ligne vide intentionnelle) : on l'ignore.
  if (lines.length > 0 && lines[lines.length - 1] === "" && /\r?\n$/.test(text)) {
    lines.pop();
  }
  return lines;
}

/** Même définition de « ligne vide » que `parseCsv` : toutes ses cellules sont vides. */
function isBlankCsvLine(line: string): boolean {
  return line.split(",").every((cell) => cell.trim() === "");
}

type FieldResult<T> = { value: T } | { error: string };

/** Entier ≥ 0, ou `null` si la cellule est vide — une cellule vide n'est jamais un zéro. */
function parseNonNegativeIntOrNull(raw: string | undefined, field: string): FieldResult<number | null> {
  const trimmed = (raw ?? "").trim();
  if (trimmed === "") return { value: null };
  const n = Number(trimmed);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    return { error: `${field} invalide : "${raw}" doit être un entier positif ou vide` };
  }
  return { value: n };
}

/** measured_at optionnel, normalisé à minuit UTC ; absent → aujourd'hui à minuit UTC. */
function parseMeasuredAt(raw: string | undefined): FieldResult<Date> {
  const trimmed = (raw ?? "").trim();
  if (trimmed === "") {
    const now = new Date();
    return { value: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) };
  }
  const d = new Date(trimmed);
  if (Number.isNaN(d.getTime())) {
    return { error: `measured_at invalide : "${raw}"` };
  }
  return { value: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())) };
}

/** sentiment_score optionnel, -1..1 ; absent → null (jamais un zéro fabriqué). */
function parseSentiment(raw: string | undefined): FieldResult<number | null> {
  const trimmed = (raw ?? "").trim();
  if (trimmed === "") return { value: null };
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < -1 || n > 1) {
    return { error: `sentiment_score invalide : "${raw}" doit être compris entre -1 et 1` };
  }
  return { value: n };
}

/**
 * Parse un CSV de réception saisi/exporté à la main.
 *
 * - `content_id` et `platform` obligatoires : leur absence rejette tout le fichier.
 * - une ligne malformée ne fait échouer QU'ELLE-MÊME : une erreur portant son numéro de
 *   ligne est reportée, le reste du fichier continue d'être traité.
 * - la numérotation compte l'en-tête comme ligne 1, donc la première ligne de données est 2.
 */
export function parseReceptionCsv(text: string): {
  rows: Omit<ReceptionSignal, "source">[];
  errors: CsvRowError[];
} {
  const physicalLines = splitPhysicalLines(text);
  const headerLine = physicalLines[0] ?? "";
  const headers = headerLine.split(",").map((h) => h.trim().toLowerCase());
  const missing = REQUIRED_COLUMNS.filter((c) => !headers.includes(c));
  if (missing.length > 0) {
    return {
      rows: [],
      errors: [{ line: 1, message: `colonne(s) obligatoire(s) manquante(s) : ${missing.join(", ")}` }],
    };
  }

  // On retire nous-mêmes les lignes vides AVANT `parseCsv`, en gardant trace du numéro de
  // ligne d'origine de chacune des lignes conservées (l'en-tête compte comme ligne 1, donc
  // la première ligne de données du fichier est la ligne 2). `parseCsv` ne verra alors plus
  // aucune ligne vide à sauter en interne : l'ordre de son tableau de sortie correspond
  // exactement, position par position, à `keptLines`.
  const dataLines = physicalLines.slice(1);
  const keptLines: { text: string; line: number }[] = [];
  dataLines.forEach((lineText, i) => {
    if (!isBlankCsvLine(lineText)) keptLines.push({ text: lineText, line: i + 2 });
  });

  const reconstructed = [headerLine, ...keptLines.map((k) => k.text)].join("\n");
  const rawRows = parseCsv(reconstructed);
  const rows: Omit<ReceptionSignal, "source">[] = [];
  const errors: CsvRowError[] = [];

  rawRows.forEach((row, index) => {
    const line = keptLines[index]?.line ?? index + 2;

    const contentIdRaw = (row["content_id"] ?? "").trim();
    const contentId = Number(contentIdRaw);
    if (contentIdRaw === "" || !Number.isInteger(contentId)) {
      errors.push({ line, message: `content_id invalide : "${row["content_id"] ?? ""}" doit être un entier` });
      return;
    }

    const platform = (row["platform"] ?? "").trim();
    if (platform === "") {
      errors.push({ line, message: "platform manquant" });
      return;
    }

    const saves = parseNonNegativeIntOrNull(row["saves"], "saves");
    if ("error" in saves) { errors.push({ line, message: saves.error }); return; }

    const shares = parseNonNegativeIntOrNull(row["shares"], "shares");
    if ("error" in shares) { errors.push({ line, message: shares.error }); return; }

    const comments = parseNonNegativeIntOrNull(row["comments"], "comments");
    if ("error" in comments) { errors.push({ line, message: comments.error }); return; }

    const reach = parseNonNegativeIntOrNull(row["reach"], "reach");
    if ("error" in reach) { errors.push({ line, message: reach.error }); return; }

    const measuredAt = parseMeasuredAt(row["measured_at"]);
    if ("error" in measuredAt) { errors.push({ line, message: measuredAt.error }); return; }

    const sentimentScore = parseSentiment(row["sentiment_score"]);
    if ("error" in sentimentScore) { errors.push({ line, message: sentimentScore.error }); return; }

    rows.push({
      contentId,
      platform,
      saves: saves.value,
      shares: shares.value,
      comments: comments.value,
      reach: reach.value,
      sentimentScore: sentimentScore.value,
      measuredAt: measuredAt.value,
    });
  });

  return { rows, errors };
}

/**
 * L'adaptateur manuel n'expose pas de lecture : la saisie manuelle est POUSSÉE dans le
 * système (formulaire ou import CSV via `parseReceptionCsv`), jamais TIRÉE depuis une
 * source externe. `fetchSignals` n'a donc rien à interroger.
 */
export const manualSource: ReceptionSource = {
  name: "manual",
  async fetchSignals() {
    throw new Error(
      "L'adaptateur manuel ne peut pas être « tiré » : la réception saisie à la main est " +
        "poussée dans le système via `parseReceptionCsv` (import CSV) ou un formulaire, jamais " +
        "récupérée par un appel sortant. Utilise l'import CSV pour ingérer ces données.",
    );
  },
};
