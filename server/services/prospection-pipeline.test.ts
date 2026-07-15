import { describe, it, expect } from "vitest";
import {
  classifySector,
  searchMethodForSector,
  buildSearchStrategy,
} from "./prospection-strategy";
import {
  classifyProjectType,
  auditSectionsForProjectType,
  stripEmDash,
  sanitizeMessage,
  countSentences,
  validateLinkedInMessage,
  validateEmailMessage,
  enforceLinkedInLimit,
  detectPriority,
} from "./prospection-audit";
import {
  dedupeAgainstExisting,
  prospectionErrorResponse,
} from "./prospection-pipeline";
import {
  ProspectionAccessError,
  LinkedInWeeklyLimitError,
} from "./prospection-access";

const ICP = {
  rationale: "cible acheteurs",
  jobTitles: ["directeur marketing", "responsable communication"],
  seniority: ["senior"],
  sectors: ["mode", "luxe"],
  companySize: "PME",
  geographies: [],
  keywords: ["rebranding", "lancement collection"],
  exclusions: ["agence", "studio"],
  linkedinQueries: ['"directeur marketing" mode'],
  googleQueries: ['site:linkedin.com/in "directeur marketing" mode'],
};

// ─── PHASE 1 : stratégie de recherche adaptive ────────────────────────────────
describe("classifySector / searchMethodForSector", () => {
  it("mode/beauté/luxe → creative_lifestyle → linkedin_people_search", () => {
    expect(classifySector("Mode & Beauté")).toBe("creative_lifestyle");
    expect(classifySector("cosmétique lifestyle")).toBe("creative_lifestyle");
    expect(searchMethodForSector("luxe")).toBe("linkedin_people_search");
  });
  it("vignoble/oenotourisme/agriculture → agriculture_terroir → search_engine", () => {
    expect(classifySector("Vignoble & Oenotourisme")).toBe("agriculture_terroir");
    expect(searchMethodForSector("viticulture")).toBe("search_engine");
  });
  it("secteur inconnu → default → serp_xray", () => {
    expect(classifySector("logiciel B2B")).toBe("default");
    expect(searchMethodForSector("")).toBe("serp_xray");
  });
});

describe("buildSearchStrategy", () => {
  const dna = { offers: "stratégie de marque", businessType: "Agence créative" };

  it("dérive la méthode du secteur + géo France par défaut + signal d'exclusion", () => {
    const s = buildSearchStrategy({ targetSector: "Mode & Beauté" }, dna, ICP);
    expect(s.method).toBe("linkedin_people_search");
    expect(s.icp.geographies).toEqual(["France"]); // défaut quand ICP vide
    expect(s.icp.jobTitles).toEqual(ICP.jobTitles);
    expect(s.exclusionSignal.toLowerCase()).toContain("stratégie de marque");
  });

  it("méthode serp_xray → requêtes = googleQueries", () => {
    const s = buildSearchStrategy({ targetSector: "SaaS" }, dna, ICP);
    expect(s.method).toBe("serp_xray");
    expect(s.queries).toEqual(ICP.googleQueries);
  });

  it("méthode linkedin_people_search → requêtes = linkedinQueries", () => {
    const s = buildSearchStrategy({ targetSector: "beauté" }, dna, ICP);
    expect(s.queries).toEqual(ICP.linkedinQueries);
  });

  it("respecte une géographie déjà fournie par l'ICP", () => {
    const s = buildSearchStrategy({ targetSector: "SaaS" }, dna, { ...ICP, geographies: ["Belgique"] });
    expect(s.icp.geographies).toEqual(["Belgique"]);
  });
});

// ─── PHASE 4 : audit adapté au type de projet (condition 6) ───────────────────
describe("classifyProjectType / auditSectionsForProjectType", () => {
  it("agence créative vs SaaS → jeux de sections DIFFÉRENTS", () => {
    const creative = auditSectionsForProjectType("creative_agency").map(s => s.key);
    const saas = auditSectionsForProjectType("saas").map(s => s.key);
    expect(creative).not.toEqual(saas);
  });
  it("toutes les variantes finissent par la section 'angle' (Angle projet)", () => {
    for (const t of ["creative_agency", "saas", "personal_brand", "default"] as const) {
      const secs = auditSectionsForProjectType(t);
      const last = secs[secs.length - 1];
      expect(last.key).toBe("angle");
      expect(last.label).toMatch(/angle/i);
    }
  });
  it("personal branding → sections centrées personne", () => {
    const keys = auditSectionsForProjectType("personal_brand").map(s => s.key);
    expect(keys).toContain("contextePersonne");
  });
  it("classifyProjectType lit type de projet + businessType", () => {
    expect(classifyProjectType({ type: "Agency" }, { businessType: "agence de communication" })).toBe("creative_agency");
    expect(classifyProjectType({ type: "Business" }, { businessType: "plateforme SaaS logiciel" })).toBe("saas");
    expect(classifyProjectType({ type: "Personal Brand" }, { businessType: "coach" })).toBe("personal_brand");
  });
});

// ─── PHASE 4 : validation des messages (conditions 4 et 5) ────────────────────
describe("messages — tirets longs et longueur", () => {
  it("stripEmDash retire le tiret long", () => {
    expect(stripEmDash("bonjour — ça va")).not.toContain("—");
  });

  it("Condition 4 — message LinkedIn ≤ 200 caractères, pas de tiret long", () => {
    const good = "Bonjour Marie, j'ai remarqué votre travail sur la nouvelle collection. Qu'est-ce qui a inspiré ce virage ? Curieuse d'en savoir plus. Jeanne";
    const v = validateLinkedInMessage(good);
    expect(v.ok).toBe(true);
    expect(v.length).toBeLessThanOrEqual(200);
    expect(v.hasEmDash).toBe(false);
  });

  it("Condition 4 — message LinkedIn trop long OU avec tiret long → invalide", () => {
    expect(validateLinkedInMessage("x".repeat(201)).ok).toBe(false);
    expect(validateLinkedInMessage("court — avec tiret").ok).toBe(false);
  });

  it("enforceLinkedInLimit ramène sous 200 sans tiret long", () => {
    const long = "Bonjour, " + "un texte assez long ".repeat(20) + "— et un tiret.";
    const out = enforceLinkedInLimit(long);
    expect(out.length).toBeLessThanOrEqual(200);
    expect(out).not.toContain("—");
  });

  it("countSentences compte les phrases", () => {
    expect(countSentences("Une phrase. Deux phrases ! Trois ?")).toBe(3);
  });

  it("Condition 5 — email valide = 5 à 8 phrases, pas de tiret long", () => {
    const email = "Bonjour Marc. J'ai vu que votre domaine ouvre à l'oenotourisme. Beaucoup de visiteurs cherchent l'expérience avant de réserver. Votre site ne montre pas encore ces coulisses. On aide les domaines à raconter ça simplement. Est-ce un sujet pour vous cette saison ? Jeanne Méjean.";
    const v = validateEmailMessage(email);
    expect(v.sentences).toBeGreaterThanOrEqual(5);
    expect(v.sentences).toBeLessThanOrEqual(8);
    expect(v.ok).toBe(true);
  });

  it("Condition 5 — email de 3 phrases → invalide", () => {
    expect(validateEmailMessage("Une. Deux. Trois.").ok).toBe(false);
  });
});

// ─── PHASE 3 : détection du signal d'achat → priority ─────────────────────────
describe("detectPriority", () => {
  it("signal d'achat présent dans les données → hot", () => {
    expect(detectPriority("ils préparent un rebranding en 2026", "rebranding, levée de fonds")).toBe("hot");
  });
  it("aucun signal → warm", () => {
    expect(detectPriority("profil classique sans signal", "rebranding, levée de fonds")).toBe("warm");
  });
  it("sans liste de signaux → warm", () => {
    expect(detectPriority("texte", "")).toBe("warm");
  });
});

// ─── PHASE 2 : déduplication (condition 7) ────────────────────────────────────
describe("dedupeAgainstExisting", () => {
  const existing = [
    { linkedinUrl: "https://linkedin.com/in/marie-dupont", email: null },
    { linkedinUrl: null, email: "jean@exemple.fr" },
  ];
  it("Condition 7 — prospect déjà présent (même URL) → exclu", () => {
    const found = [
      { name: "Marie", linkedinUrl: "https://linkedin.com/in/marie-dupont?trk=x" },
      { name: "Nouveau", linkedinUrl: "https://linkedin.com/in/nouveau" },
    ];
    const { fresh, skipped } = dedupeAgainstExisting(found, existing);
    expect(fresh.map(f => f.name)).toEqual(["Nouveau"]);
    expect(skipped).toBe(1);
  });
  it("dédup aussi par email et à l'intérieur du lot", () => {
    const found = [
      { name: "Jean", email: "JEAN@exemple.fr" },
      { name: "Dup", linkedinUrl: "https://linkedin.com/in/z" },
      { name: "Dup2", linkedinUrl: "https://linkedin.com/in/z" },
    ];
    const { fresh } = dedupeAgainstExisting(found, existing);
    expect(fresh.map(f => f.name)).toEqual(["Dup"]);
  });
});

// ─── Mapping d'erreur → HTTP 403 (conditions 1 et 2) ──────────────────────────
describe("prospectionErrorResponse", () => {
  it("Condition 1 — ProspectionAccessError → 403 + message plan", () => {
    const r = prospectionErrorResponse(new ProspectionAccessError());
    expect(r?.status).toBe(403);
    expect(r?.body.message).toMatch(/Enrichissement/i);
    expect(r?.body.code).toBe("prospection_enrichment_required");
  });
  it("Condition 2 — LinkedInWeeklyLimitError → 403 + message LinkedIn", () => {
    const r = prospectionErrorResponse(new LinkedInWeeklyLimitError("Limite LinkedIn atteinte cette semaine (30/30) — recommence lundi."));
    expect(r?.status).toBe(403);
    expect(r?.body.message).toMatch(/Limite LinkedIn/i);
    expect(r?.body.code).toBe("linkedin_weekly_limit_reached");
  });
  it("erreur générique → null (le routeur renverra 500)", () => {
    expect(prospectionErrorResponse(new Error("boom"))).toBeNull();
  });
});
