// Veille AO : ce qui est déjà en base, y compris importé de Notion, ne repasse pas par l'IA.
import { describe, it, expect } from "vitest";
import { classer, cleObjet, numerosBoamp, numerosTed, type Existant } from "./dedupe";
import type { AvisCollecte } from "./mapping";

const avis = (over: Partial<AvisCollecte>): AvisCollecte => ({
  source: "boamp", sourceId: "26-1", objet: "Prestations de communication globale pour la ville", acheteur: null,
  reference: "BOAMP 26-1", procedure: null, dateLimite: null, departement: null, montantEstimeHt: null,
  lienAvis: null, lienDce: null, cpv: [], texte: "", ...over,
});
const MAINTENANT = new Date("2026-11-10T08:00:00Z");
const existant = (over: Partial<Existant>): Existant => ({
  id: 1, source: "notion_import", sourceId: "abc", reference: null, lienAvis: null, objet: "Autre chose sans rapport ici", ...over,
});

describe("numéros cités", () => {
  it("BOAMP : référence Notion (avec rectificatif) et lien France Marchés", () => {
    expect(numerosBoamp("BOAMP 26-91021, rectificatif 26-101261 du 20/10/2026 / 26FS-GIP-2184-C")).toEqual(["26-91021", "26-101261"]);
    expect(numerosBoamp("BOAMP 26-95224 / TED 684030-2026")).toEqual(["26-95224"]);
    expect(numerosBoamp(null, "https://www.francemarches.com/appel-offre/3boamp2696260-2026-prestatio")).toEqual(["26-96260"]);
    expect(numerosBoamp("2026-086", "Procédure 688ff9ce-3294")).toEqual([]);
  });

  it("TED / JOUE", () => {
    expect(numerosTed("BOAMP 26-95992 / JOUE 690005-2026 / 2026A0513")).toEqual(["690005-2026"]);
    expect(numerosTed(null, "https://www.francemarches.com/appel-offre/13joue006635422026-2026-appe")).toEqual(["663542-2026"]);
  });

  it("objet normalisé ; trop court, pas de clé", () => {
    expect(cleObjet("Prestations de COMMUNICATION — Ville d'Évry")).toBe("prestations de communication ville d evry");
    expect(cleObjet("Conception création")).toBeNull();
  });
});

describe("classer", () => {
  it("même source et même id : rafraîchi, pas requalifié", () => {
    const r = classer([avis({ sourceId: "26-5" })], [existant({ id: 9, source: "boamp", sourceId: "26-5" })]);
    expect(r.aRafraichir).toEqual([{ id: 9, source: "boamp", avis: expect.objectContaining({ sourceId: "26-5" }) }]);
    expect(r.nouveaux).toHaveLength(0);
  });

  it("ligne Notion dont la référence porte le numéro BOAMP : c'est elle qui est rafraîchie", () => {
    const notion = existant({ id: 3, reference: "BOAMP 26-96260 / A2026-035" });
    const r = classer([avis({ sourceId: "26-96260", objet: "Un objet formulé autrement par le BOAMP" })], [notion]);
    expect(r.aRafraichir).toEqual([{ id: 3, source: "notion_import", avis: expect.objectContaining({ sourceId: "26-96260" }) }]);
    expect(r.nouveaux).toHaveLength(0);
  });

  it("ligne Notion reconnue par son lien France Marchés, et par son numéro TED", () => {
    const r = classer(
      [avis({ sourceId: "26-97469" }), avis({ source: "ted", sourceId: "663542-2026", objet: "Encore un autre objet assez long" })],
      [existant({ id: 4, lienAvis: "https://www.francemarches.com/appel-offre/3boamp2697469-2026-2626-mise" }),
        existant({ id: 5, reference: "JOUE 663542-2026" })],
    );
    expect(r.aRafraichir.map((x) => x.id)).toEqual([4, 5]);
  });

  it("une ligne Notion ne capte pas un numéro BOAMP d'une autre source", () => {
    const r = classer([avis({ source: "ted", sourceId: "26-96260", objet: "Objet totalement distinct de tout le reste" })],
      [existant({ reference: "BOAMP 26-96260" })]);
    expect(r.nouveaux).toHaveLength(1);
  });

  it("même objet vu sur TED après BOAMP, date limite à moins d'un jour (même passage ou déjà en base) : doublon", () => {
    const objet = "PRESTATIONS DE COMMUNICATION GLOBALE POUR LE COMPTE DE LA SPL SEINE PARK";
    const r = classer([
      avis({ sourceId: "26-108562", objet, acheteur: "SEINE PARK", dateLimite: new Date("2026-12-07T22:59:00Z") }),
      avis({ source: "ted", sourceId: "780380-2026", objet, acheteur: "SPL Seine Park", dateLimite: new Date("2026-12-07T21:00:00Z") }),
    ], [], MAINTENANT);
    expect(r.nouveaux.map((a) => a.sourceId)).toEqual(["26-108562"]);
    expect(r.doublons.map((a) => a.sourceId)).toEqual(["780380-2026"]);
    const r2 = classer([avis({ source: "ted", sourceId: "780380-2026", objet, acheteur: "Seine Park" })],
      [existant({ source: "boamp", objet: objet.toLowerCase(), acheteur: "SEINE PARK" })], MAINTENANT);
    expect(r2.doublons).toHaveLength(1);
  });

  it("même intitulé, acheteurs différents : deux avis distincts, tous deux gardés", () => {
    const objet = "Marché de prestations de communication institutionnelle 2027";
    const r = classer([
      avis({ sourceId: "26-1", objet, acheteur: "Ville de Lyon", dateLimite: new Date("2026-12-01T12:00:00Z") }),
      avis({ sourceId: "26-2", objet, acheteur: "Ville de Nantes", dateLimite: new Date("2026-12-01T12:00:00Z") }),
      avis({ source: "ted", sourceId: "9-2026", objet, acheteur: "Région Bretagne", dateLimite: new Date("2026-12-20T12:00:00Z") }),
    ], [], MAINTENANT);
    expect(r.nouveaux.map((a) => a.sourceId)).toEqual(["26-1", "26-2", "9-2026"]);
  });

  it("une ligne dont la date limite est passée ne bloque pas un nouvel avis au même intitulé", () => {
    const objet = "Marché de prestations de communication institutionnelle 2027";
    const r = classer([avis({ source: "ted", sourceId: "9-2026", objet, acheteur: "Ville de Lyon", dateLimite: new Date("2026-12-20T12:00:00Z") })],
      [existant({ source: "boamp", objet, acheteur: "Ville de Lyon", dateLimite: "2026-10-01T10:00:00.000Z" })], MAINTENANT);
    expect(r.nouveaux).toHaveLength(1);
    expect(r.doublons).toHaveLength(0);
  });

  it("un objet trop court n'est jamais un critère de doublon", () => {
    const r = classer([avis({ sourceId: "a", objet: "Conception création" }), avis({ source: "ted", sourceId: "b", objet: "Conception création" })], []);
    expect(r.nouveaux).toHaveLength(2);
  });

  it("le même avis deux fois dans la collecte : une seule fois", () => {
    const r = classer([avis({ sourceId: "26-7" }), avis({ sourceId: "26-7" })], []);
    expect(r.nouveaux).toHaveLength(1);
    expect(r.doublons).toHaveLength(0);
  });
});

describe("même avis au BOAMP et au JOUE sous deux intitulés", () => {
  const limite = new Date("2026-12-14T10:00:00Z");

  it("même acheteur (« C N S A » = « CNSA ») et même date limite, autre source : doublon", () => {
    const r = classer([
      avis({ sourceId: "26-108304", objet: "Conception-création et réalisation de dispositifs hors médias", acheteur: "C N S A", dateLimite: limite }),
      avis({ source: "ted", sourceId: "776725-2026", objet: "Conception création", acheteur: "CNSA", dateLimite: limite }),
    ], []);
    expect(r.nouveaux.map((a) => a.sourceId)).toEqual(["26-108304"]);
    expect(r.doublons.map((a) => a.sourceId)).toEqual(["776725-2026"]);
  });

  it("déjà en base sous une autre source (accents et casse ignorés) : doublon", () => {
    const r = classer([avis({ source: "ted", sourceId: "777309-2026", objet: "PRESTATIONS DE COMMUNICATION ET D’ORGANISATION", acheteur: "Haute Autorité de Santé", dateLimite: new Date("2026-11-23T10:00:00Z") })],
      [existant({ source: "boamp", sourceId: "26-108076", acheteur: "HAUTE AUTORITE DE SANTE", dateLimite: "2026-11-23T10:00:00.000Z" })]);
    expect(r.doublons).toHaveLength(1);
  });

  it("deux avis BOAMP du même acheteur à la même date limite restent deux avis", () => {
    const r = classer([
      avis({ sourceId: "26-1", objet: "Lot photo pour la saison culturelle 2027 de la ville", acheteur: "Ville de Lyon", dateLimite: limite }),
      avis({ sourceId: "26-2", objet: "Lot vidéo pour la saison culturelle 2027 de la ville", acheteur: "Ville de Lyon", dateLimite: limite }),
    ], []);
    expect(r.nouveaux).toHaveLength(2);
  });

  it("date limite différente : pas un doublon", () => {
    const r = classer([avis({ source: "ted", sourceId: "x", objet: "Court", acheteur: "CNSA", dateLimite: new Date("2026-12-15T10:00:00Z") })],
      [existant({ source: "boamp", acheteur: "CNSA", dateLimite: limite })]);
    expect(r.nouveaux).toHaveLength(1);
  });
});
