import { describe, it, expect } from "vitest";
import { pickAllowedProjectFields, validateProjectPatchFields, ALLOWED_PROJECT_PATCH_FIELDS } from "./project-fields";

describe("pickAllowedProjectFields — whitelist PATCH /api/projects/:id", () => {
  it("ne garde QUE les champs whitelistés", () => {
    const out = pickAllowedProjectFields({
      name: "Nouveau nom",
      priorityLevel: "primary",
      projectStatus: "active",
      description: "desc",
      // champs hors-liste / malveillants :
      userId: "evil-user",
      id: 999,
      isPrimary: true,
      slug: "hack",
      createdAt: "2020-01-01",
      foo: "bar",
    });
    expect(out).toEqual({
      name: "Nouveau nom",
      priorityLevel: "primary",
      projectStatus: "active",
      description: "desc",
    });
  });

  it("rejette (ignore) un champ hors-liste — userId/isPrimary/id ne passent jamais", () => {
    const out = pickAllowedProjectFields({ userId: "x", isPrimary: true, id: 1, hacked: true });
    expect(out).toEqual({});
    expect("userId" in out).toBe(false);
    expect("isPrimary" in out).toBe(false);
    expect("id" in out).toBe(false);
  });

  it("gère body vide / null sans planter", () => {
    expect(pickAllowedProjectFields(null)).toEqual({});
    expect(pickAllowedProjectFields(undefined)).toEqual({});
    expect(pickAllowedProjectFields({})).toEqual({});
  });

  it("garde les nouveaux champs éditables (category, dailyTimeBudgetHours, statusNote)", () => {
    const out = pickAllowedProjectFields({
      category: "revenue",
      dailyTimeBudgetHours: 4,
      statusNote: "J'ai signé un nouveau client hors Naya",
      userId: "evil",
    });
    expect(out).toEqual({
      category: "revenue",
      dailyTimeBudgetHours: 4,
      statusNote: "J'ai signé un nouveau client hors Naya",
    });
  });

  it("garde les champs projet client (projectKind + métadonnées client)", () => {
    const out = pickAllowedProjectFields({
      projectKind: "client",
      clientName: "Acme SARL",
      clientContact: "jean@acme.fr",
      clientBrief: "Refonte site + campagne Q1",
      userId: "evil",
      id: 42,
    });
    expect(out).toEqual({
      projectKind: "client",
      clientName: "Acme SARL",
      clientContact: "jean@acme.fr",
      clientBrief: "Refonte site + campagne Q1",
    });
  });

  it("liste des champs autorisés (référence)", () => {
    expect([...ALLOWED_PROJECT_PATCH_FIELDS]).toEqual([
      "name", "icon", "color", "type", "description", "monetizationIntent", "priorityLevel", "projectStatus",
      "category", "dailyTimeBudgetHours", "statusNote",
      "projectKind", "clientName", "clientContact", "clientBrief",
      "attributionWindowDays",
    ]);
  });

  it("garde attributionWindowDays (fenêtre d'attribution éditable par projet) — sans cet ajout, l'édition depuis les réglages ne fait silencieusement rien", () => {
    const out = pickAllowedProjectFields({
      attributionWindowDays: 60,
      userId: "evil",
    });
    expect(out).toEqual({ attributionWindowDays: 60 });
  });
});

/**
 * I2 (revue finale) — `attributionWindowDays` est le SEUL champ whitelisté dont une
 * mauvaise valeur est ensuite recopiée TELLE QUELLE, et pour toujours, dans un historique
 * append-only que le lot promet de ne jamais réécrire (la fenêtre est figée sur chaque
 * ligne `brand_conversions` à la déclaration). Le seul garde-fou existant était un clamp
 * CÔTÉ CLIENT : un `PATCH /api/projects/:id` direct posait `0` (fenêtre de largeur nulle,
 * qui ne crédite personne), `-5` (début > fin, même effet), ou une valeur non numérique
 * qui faisait 500 la requête ENTIÈRE — perdant silencieusement les autres champs du même
 * enregistrement. D'où cette validation serveur : entier, 1–365, refus en 400 NOMMANT le
 * champ.
 */
describe("validateProjectPatchFields — garde serveur sur attributionWindowDays", () => {
  const erreur = (fields: Record<string, any>) => {
    const r = validateProjectPatchFields(fields);
    return r.ok ? null : r;
  };

  it("laisse passer un patch qui ne touche pas à la fenêtre", () => {
    const r = validateProjectPatchFields({ statusNote: "coucou", category: "revenue" });
    expect(r).toEqual({ ok: true, fields: { statusNote: "coucou", category: "revenue" } });
  });

  it("accepte les bornes 1 et 365", () => {
    expect(validateProjectPatchFields({ attributionWindowDays: 1 })).toEqual({ ok: true, fields: { attributionWindowDays: 1 } });
    expect(validateProjectPatchFields({ attributionWindowDays: 365 })).toEqual({ ok: true, fields: { attributionWindowDays: 365 } });
  });

  it("accepte une valeur courante au milieu de la plage", () => {
    expect(validateProjectPatchFields({ attributionWindowDays: 60 })).toEqual({ ok: true, fields: { attributionWindowDays: 60 } });
  });

  it("refuse 0 — une fenêtre de largeur nulle ne crédite personne, et c'est figé pour toujours", () => {
    expect(erreur({ attributionWindowDays: 0 })?.field).toBe("attributionWindowDays");
  });

  it("refuse une valeur négative — début > fin, la fenêtre est vide", () => {
    expect(erreur({ attributionWindowDays: -5 })?.field).toBe("attributionWindowDays");
  });

  it("refuse au-delà de 365", () => {
    expect(erreur({ attributionWindowDays: 366 })?.field).toBe("attributionWindowDays");
  });

  it("refuse un non-entier plutôt que de tronquer en silence", () => {
    expect(erreur({ attributionWindowDays: 30.5 })?.field).toBe("attributionWindowDays");
  });

  it("refuse une valeur non numérique SANS faire perdre les autres champs (400, pas 500)", () => {
    const r = validateProjectPatchFields({ attributionWindowDays: "soixante", statusNote: "à ne pas perdre" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.field).toBe("attributionWindowDays");
      // Le message NOMME le champ : l'écran peut dire quoi corriger au lieu d'un échec opaque.
      expect(r.message).toContain("attributionWindowDays");
    }
  });

  it("refuse les types qui coerceraient silencieusement (booléen, tableau, objet, null)", () => {
    for (const mauvais of [true, false, [30], {}, null, NaN, Infinity]) {
      expect(erreur({ attributionWindowDays: mauvais })?.field).toBe("attributionWindowDays");
    }
  });

  it("normalise une chaîne numérique entière en nombre — jamais une chaîne dans une colonne integer", () => {
    expect(validateProjectPatchFields({ attributionWindowDays: "60" })).toEqual({ ok: true, fields: { attributionWindowDays: 60 } });
  });

  it("ne modifie jamais les autres champs whitelistés au passage", () => {
    const r = validateProjectPatchFields({ attributionWindowDays: "14", statusNote: "note", dailyTimeBudgetHours: 4 });
    expect(r).toEqual({ ok: true, fields: { attributionWindowDays: 14, statusNote: "note", dailyTimeBudgetHours: 4 } });
  });
});
