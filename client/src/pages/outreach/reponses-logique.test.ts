import { describe, it, expect } from "vitest";
import fr from "@/locales/fr";
import en from "@/locales/en";
import {
  cleErreurEnvoi, cleErreurPasUneReponse, typeBulle, ordonnerFil, dateRelative, dateHeure,
  couleurCampagne, PALETTE_CAMPAGNES, campagneDepuisRecherche, urlReponses, filtrerParCampagne,
  campagnesDeListe, compterATraiterParCampagne, fusionnerCampagnes,
} from "./reponses-logique";

const lire = (o: any, cle: string) => cle.split(".").reduce((x, k) => x?.[k], o);

describe("raison -> message", () => {
  const raisons = ["envoi_coupe", "compte_restreint", "compte_deconnecte", "compte_absent", "envoi_en_cours", "deja_envoye", "texte_vide", "texte_trop_long", "introuvable", "echec"];
  it("chaque raison a un message en français et en anglais", () => {
    for (const r of raisons) {
      const cle = cleErreurEnvoi(r);
      expect(typeof lire(fr, cle)).toBe("string");
      expect(typeof lire(en, cle)).toBe("string");
    }
  });
  it("raison inconnue : message générique", () => {
    expect(cleErreurEnvoi("zzz")).toBe("outreach.reponses.erreurs.echec");
    expect(cleErreurEnvoi(undefined)).toBe("outreach.reponses.erreurs.echec");
  });
  it("pas une réponse", () => {
    expect(cleErreurPasUneReponse("deja_repondu")).toContain("dejaRepondu");
    expect(cleErreurPasUneReponse(undefined)).toContain("echec");
    for (const c of [cleErreurPasUneReponse("deja_repondu"), cleErreurPasUneReponse(null), "outreach.reponses.pasUneReponse.autreEnAttente"]) {
      expect(typeof lire(fr as any, c)).toBe("string");
      expect(typeof lire(en as any, c)).toBe("string");
    }
  });
});

describe("fil", () => {
  it("types de bulle", () => {
    expect(typeBulle({ sens: "entrant", nature: "reponse" })).toBe("entrant");
    expect(typeBulle({ sens: "sortant", nature: "nous" })).toBe("sortant");
    expect(typeBulle({ sens: "sortant", nature: "en_attente" })).toBe("en_attente");
    expect(typeBulle({ sens: "entrant", nature: "absence" })).toBe("discret");
    expect(typeBulle({ sens: "entrant", nature: "accuse" })).toBe("discret");
  });
  it("ordre chronologique stable, entrée intacte", () => {
    const m = [{ id: "b", sentAt: "2026-11-02T10:00:00Z" }, { id: "a", sentAt: "2026-11-01T10:00:00Z" }, { id: "c", sentAt: "2026-11-02T10:00:00Z" }];
    expect(ordonnerFil(m).map((x) => x.id)).toEqual(["a", "b", "c"]);
    expect(m[0].id).toBe("b");
  });
  it("date relative", () => {
    const now = new Date("2026-11-02T12:00:00Z");
    expect(dateRelative("2026-11-02T09:00:00Z", now, "fr")).toMatch(/3\s*h/);
    expect(dateRelative("2026-11-02T11:59:40Z", now, "fr")).toBe("à l'instant");
    expect(dateRelative("2026-11-02T11:59:40Z", now, "en")).toBe("just now");
    expect(dateRelative(null, now, "fr")).toBe("");
  });
});

describe("campagnes dans la boîte", () => {
  const liste = [
    { id: 1, statut: "a_traiter", campaignId: 7, campaignName: "Test" },
    { id: 2, statut: "a_traiter", campaignId: 3, campaignName: "Archi Lyon" },
    { id: 3, statut: "traitee", campaignId: 7, campaignName: "Test" },
    { id: 4, statut: "a_traiter", campaignId: 7, campaignName: "Test" },
    { id: 5, statut: "a_traiter", campaignId: null, campaignName: null },
    { id: 6, statut: "a_traiter" }, // serveur plus ancien : pas de champ campagne
  ];

  it("couleur stable par id, prise dans la palette, sans text-white", () => {
    expect(couleurCampagne(7)).toBe(couleurCampagne(7));
    expect(PALETTE_CAMPAGNES).toContain(couleurCampagne(7));
    expect(couleurCampagne(1)).not.toBe(couleurCampagne(2));
    expect(couleurCampagne(null)).toBe(PALETTE_CAMPAGNES[3]);
    expect(PALETTE_CAMPAGNES).toContain(couleurCampagne(-4));
    for (const c of PALETTE_CAMPAGNES) expect(c).not.toMatch(/text-white/);
  });

  it("filtre campagne", () => {
    expect(filtrerParCampagne(liste, null)).toHaveLength(6);
    expect(filtrerParCampagne(liste, 7).map((c) => c.id)).toEqual([1, 3, 4]);
    expect(filtrerParCampagne(liste, 99)).toEqual([]);
  });

  it("campagnes présentes, triées, sans doublon", () => {
    expect(campagnesDeListe(liste)).toEqual([{ id: 3, name: "Archi Lyon" }, { id: 7, name: "Test" }]);
  });

  it("filtre : campagnes connues + campagnes archivées encore présentes dans la liste", () => {
    expect(fusionnerCampagnes([{ id: 7, name: "Test à jour" }], campagnesDeListe(liste)))
      .toEqual([{ id: 3, name: "Archi Lyon" }, { id: 7, name: "Test à jour" }]);
    expect(fusionnerCampagnes([], [{ id: 9, name: "Archivée" }])).toEqual([{ id: 9, name: "Archivée" }]);
  });

  it("compte à traiter par campagne (traitées et hors campagne ignorées)", () => {
    const m = compterATraiterParCampagne(liste);
    expect(m.get(7)).toBe(2);
    expect(m.get(3)).toBe(1);
    expect(m.size).toBe(2);
  });

  it("URL : filtre campagne lu et gardé avec la conversation", () => {
    expect(campagneDepuisRecherche("onglet=reponses&campagne=12")).toBe(12);
    expect(campagneDepuisRecherche("?onglet=reponses&campagne=abc")).toBeNull();
    expect(campagneDepuisRecherche("onglet=reponses")).toBeNull();
    expect(urlReponses()).toBe("/outreach?onglet=reponses");
    expect(urlReponses({ campagne: 12, conversation: 4 })).toBe("/outreach?onglet=reponses&campagne=12&conversation=4");
    expect(urlReponses({ campagne: null, conversation: 4 })).toBe("/outreach?onglet=reponses&conversation=4");
  });

  it("date et heure absolues", () => {
    // Midi UTC : le même jour dans tout fuseau habité ; comparé à Intl pour ne dépendre ni de l'ICU ni du fuseau.
    const d = "2026-11-05T12:00:00Z";
    const attendu = new Date(d).toLocaleString("fr", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    expect(dateHeure(d, "fr")).toBe(attendu);
    expect(dateHeure(d, "fr")).toContain(String(new Date(d).getDate()));
    expect(dateHeure("pas une date", "fr")).toBe("");
    expect(dateHeure(null, "fr")).toBe("");
  });

  it("libellés campagne en français et en anglais", () => {
    for (const k of ["filtreCampagne", "toutesCampagnes", "videCampagne", "voirComplet", "masquerCitation", "aTraiterCampagne_one", "aTraiterCampagne_other", "aucuneATraiterCampagne"]) {
      expect(typeof lire(fr, `outreach.reponses.${k}`)).toBe("string");
      expect(typeof lire(en, `outreach.reponses.${k}`)).toBe("string");
    }
  });
});
