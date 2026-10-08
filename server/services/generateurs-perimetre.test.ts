import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Les prompts des générateurs génériques ne doivent plus pousser vers la prospection
// manuelle ni la création de contenu flottante (décision du 9 octobre 2026) : le contenu
// vient du calendrier éditorial, la prospection du pipeline. Ces ancres en dur produisaient
// « Send the 3 personalized DMs… » et « Draft 3-part carousel… ».
const RACINE = join(import.meta.dirname ?? __dirname, "..", "..");

const ANCRES_INTERDITES: RegExp[] = [
  /DM 5/i,
  /50% direct outreach/i,
  /direct outreach/i,
  /Write 200-word LinkedIn post/i,
  /Prioritize conversion, outreach/i,
  /Inclure des tâches de prospection outreach/i,
  /Inclure des tâches de contact direct/i,
  /"linkedin_message" : si la tâche consiste/i,
];

const FICHIERS = [
  "server/services/openai.ts",
  "server/services/goal-tasks.ts",
  "server/services/milestone-intelligence.ts",
];

describe("prompts des générateurs génériques — hors contenu et prospection", () => {
  it.each(FICHIERS)("%s ne contient plus d'ancre vers la prospection ou le contenu flottant", (fichier) => {
    const contenu = readFileSync(join(RACINE, fichier), "utf8");
    const trouves = ANCRES_INTERDITES.filter((m) => m.test(contenu)).map(String);
    expect(trouves).toEqual([]);
  });

  it.each(FICHIERS)("%s rappelle le périmètre (consignesGenerateur)", (fichier) => {
    expect(readFileSync(join(RACINE, fichier), "utf8")).toMatch(/consignesGenerateur\(/);
  });
});
