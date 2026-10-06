import { describe, it, expect } from "vitest";
import {
  DEFAULT_LANGUAGE,
  ecritDansUneAutreLangue,
  normalizeLanguage,
  resolveLanguage,
  languageDirective,
} from "./language";

describe("normalizeLanguage", () => {
  it("accepte les deux langues supportées", () => {
    expect(normalizeLanguage("fr")).toBe("fr");
    expect(normalizeLanguage("en")).toBe("en");
  });

  it("rejette tout le reste", () => {
    expect(normalizeLanguage("de")).toBeNull();
    expect(normalizeLanguage("")).toBeNull();
    expect(normalizeLanguage(null)).toBeNull();
    expect(normalizeLanguage(undefined)).toBeNull();
    expect(normalizeLanguage(42)).toBeNull();
    expect(normalizeLanguage("FR")).toBeNull(); // pas de tolérance à la casse : la base écrit en minuscules
  });
});

describe("resolveLanguage", () => {
  it("le compte l'emporte sur le cache local", () => {
    expect(resolveLanguage({ account: "en", cached: "fr" })).toBe("en");
    expect(resolveLanguage({ account: "fr", cached: "en" })).toBe("fr");
  });

  it("retombe sur le cache quand le compte est absent", () => {
    expect(resolveLanguage({ cached: "en" })).toBe("en");
    expect(resolveLanguage({ account: null, cached: "en" })).toBe("en");
  });

  it("retombe sur le français quand rien n'est exploitable", () => {
    expect(resolveLanguage({})).toBe("fr");
    expect(resolveLanguage({ account: null, cached: null })).toBe("fr");
    expect(resolveLanguage({ account: "de", cached: "es" })).toBe("fr");
  });

  it("ignore une valeur de compte invalide et utilise le cache", () => {
    expect(resolveLanguage({ account: "de", cached: "en" })).toBe("en");
  });

  it("le défaut est le français", () => {
    expect(DEFAULT_LANGUAGE).toBe("fr");
  });
});

describe("languageDirective", () => {
  it("demande l'anglais, et ne mentionne jamais le français comme langue de sortie", () => {
    // LE bug. `naya-voice.ts` portait « Ne jamais répondre en anglais, quelle que soit la
    // langue du prompt système », ce qui ordonnait au modèle d'ignorer la préférence de
    // l'utilisateur. Un compte en anglais recevait du français, toujours.
    const d = languageDirective("en");

    expect(d).toMatch(/English/i);
    expect(d).not.toMatch(/\bFrench\b/i);
    expect(d).not.toMatch(/\bfrançais\b/i);
  });

  it("demande le français, et ne mentionne jamais l'anglais comme langue de sortie", () => {
    const d = languageDirective("fr");

    expect(d).toMatch(/français/i);
    expect(d).not.toMatch(/\banglais\b/i);
    expect(d).not.toMatch(/\bEnglish\b/i);
  });

  it("produit deux directives réellement différentes", () => {
    // Bug visé : une directive constante qui ignorerait son paramètre.
    expect(languageDirective("fr")).not.toBe(languageDirective("en"));
  });

  it("couvre les titres de tâches, qui sont le cas rapporté", () => {
    for (const lang of ["fr", "en"] as const) {
      expect(languageDirective(lang)).toMatch(/task titles|titres de tâches/i);
    }
  });

  it("n'est jamais vide", () => {
    for (const lang of ["fr", "en"] as const) {
      expect(languageDirective(lang).trim().length).toBeGreaterThan(20);
    }
  });
});


describe("ecritDansUneAutreLangue — garde de sortie (6 octobre 2026)", () => {
  // Les titres exacts reçus par un compte en français.
  it("repère les tâches anglaises reçues par un compte français", () => {
    expect(ecritDansUneAutreLangue("Send the 3 personalized DMs (based on outreach template) + document responses", "fr")).toBe(true);
    expect(ecritDansUneAutreLangue("Set a 5-minute daily ritual: respond to comments and share one Stories moment from your week", "fr")).toBe(true);
  });

  it("laisse passer le français, y compris avec des anglicismes", () => {
    expect(ecritDansUneAutreLangue("Photographier 3 détails de ton environnement créatif + annoter chacun avec une observation", "fr")).toBe(false);
    expect(ecritDansUneAutreLangue("Rédiger le carrousel LinkedIn sur ton offre", "fr")).toBe(false);
    expect(ecritDansUneAutreLangue("Envoyer les DMs d'outreach préparés", "fr")).toBe(false);
  });

  it("ne déclenche rien sur un nom propre ou un titre court", () => {
    expect(ecritDansUneAutreLangue("Ostéopathes Mr Darcy", "fr")).toBe(false);
    expect(ecritDansUneAutreLangue("", "fr")).toBe(false);
    expect(ecritDansUneAutreLangue("LinkedIn", "fr")).toBe(false);
  });

  it("marche dans l'autre sens pour un compte anglais", () => {
    expect(ecritDansUneAutreLangue("Envoyer les 3 messages à tes prospects de la semaine", "en")).toBe(true);
    expect(ecritDansUneAutreLangue("Send the 3 messages to your prospects", "en")).toBe(false);
  });
});
