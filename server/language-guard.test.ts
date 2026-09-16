import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Un seul producteur de consigne de langue : `shared/language.ts`.
 *
 * Pourquoi cette garde existe. La langue de génération était réécrite en dur à dix-sept
 * endroits — dont `server/naya-voice.ts`, injecté dans CHAQUE appel IA, qui portait :
 *
 *     « Ne jamais répondre en anglais, quelle que soit la langue du prompt système ou de
 *       l'instruction. Le français est non-négociable. »
 *
 * Cette phrase ordonnait explicitement au modèle d'ignorer la section « Langue de travail »
 * que `buildNayaContext` construit à partir de la préférence du compte. Un utilisateur en
 * anglais recevait donc du français, systématiquement, et aucune correction locale n'y
 * pouvait rien tant que la voix restait au-dessus.
 *
 * Une consigne dispersée se remet en dur sans que personne ne le remarque. Ce test est là
 * pour que ça se voie tout de suite.
 */

const RACINE = join(import.meta.dirname ?? __dirname, "..");
const DOSSIERS_SCANNES = ["server", "shared", "client/src"];

/** Seul fichier autorisé à formuler une consigne de langue. */
const PRODUCTEUR_AUTORISE = "shared/language.ts";

const INTERDITS: { motif: RegExp; quoi: string }[] = [
  { motif: /RÈGLE\s+LANGUE/i, quoi: "consigne « RÈGLE LANGUE » écrite en dur" },
  { motif: /LANGUAGE\s+RULE/i, quoi: "consigne « LANGUAGE RULE » écrite en dur" },
  { motif: /never\s+(answer\s+)?(in\s+)?english/i, quoi: "interdiction de l'anglais en dur" },
  { motif: /non-?négociable/i, quoi: "langue déclarée « non négociable »" },
  {
    motif: /(génère|génères|generate|réponds|respond|rédige|rédiges|write|draft|traduis|translate)[^.\n]{0,70}\b(en\s+français|en\s+anglais|in\s+french|in\s+english)\b/i,
    quoi: "ordre de générer dans une langue fixe",
  },
];

function fichiersSources(dossier: string): string[] {
  const racine = join(RACINE, dossier);
  const trouves: string[] = [];

  const descendre = (chemin: string) => {
    for (const entree of readdirSync(chemin, { withFileTypes: true })) {
      const complet = join(chemin, entree.name);
      if (entree.isDirectory()) {
        if (entree.name === "node_modules" || entree.name === "dist") continue;
        descendre(complet);
      } else if (/\.(ts|tsx)$/.test(entree.name) && !/\.test\.tsx?$/.test(entree.name)) {
        trouves.push(complet);
      }
    }
  };

  // Un dossier illisible doit faire TOMBER le test. Une garde qui s'endort quand elle ne
  // trouve rien ne garde rien — c'est le défaut corrigé neuf fois sur le lot précédent :
  // l'absence de mesure prise pour une mesure à zéro.
  statSync(racine);
  descendre(racine);
  return trouves;
}

describe("une seule source de vérité pour la langue de génération", () => {
  it("scanne réellement des fichiers", () => {
    // Sans cette vérification, une erreur de chemin rendrait tous les tests suivants verts.
    const total = DOSSIERS_SCANNES.reduce((n, d) => n + fichiersSources(d).length, 0);
    expect(total).toBeGreaterThan(50);
  });

  it("aucune consigne de langue n'est écrite en dur hors de shared/language.ts", () => {
    const infractions: string[] = [];

    for (const dossier of DOSSIERS_SCANNES) {
      for (const fichier of fichiersSources(dossier)) {
        const chemin = relative(RACINE, fichier).split("\\").join("/");
        if (chemin === PRODUCTEUR_AUTORISE) continue;

        const contenu = readFileSync(fichier, "utf8");
        for (const { motif, quoi } of INTERDITS) {
          const trouve = contenu.match(motif);
          if (trouve) infractions.push(`${chemin} — ${quoi} : « ${trouve[0].trim()} »`);
        }
      }
    }

    expect(infractions, `\n${infractions.join("\n")}\n`).toEqual([]);
  });
});
