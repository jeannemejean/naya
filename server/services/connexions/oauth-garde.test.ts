import { describe, it, expect } from "vitest";
import { conflitIdentite, pagesLinkedinPourClient } from "./oauth-garde";

const comptes = [
  { id: 1, platform: "instagram", accountId: "ig-jeanne", projectId: null },
  { id: 2, platform: "instagram", accountId: "ig-b", projectId: 9 },
  { id: 3, platform: "linkedin_page_100", accountId: "100", projectId: null },
  { id: 4, platform: "linkedin_page_200", accountId: "200", projectId: 9 },
  { id: 5, platform: "linkedin_page_300", accountId: "300", projectId: 7 },
];

describe("conflitIdentite — un compte n'appartient qu'à un seul périmètre", () => {
  it("le compte de l'utilisatrice ne peut pas devenir celui d'un client", () => {
    expect(conflitIdentite(comptes, { platform: "instagram", accountId: "ig-jeanne", projectId: 7 })).toBe("compte_de_l_utilisatrice");
  });
  it("le compte d'un autre client non plus", () => {
    expect(conflitIdentite(comptes, { platform: "instagram", accountId: "ig-b", projectId: 7 })).toBe("compte_d_un_autre_projet");
  });
  it("reconnecter un compte dans son propre périmètre, ou un compte nouveau : permis", () => {
    expect(conflitIdentite(comptes, { platform: "instagram", accountId: "ig-b", projectId: 9 })).toBeNull();
    expect(conflitIdentite(comptes, { platform: "instagram", accountId: "ig-nouveau", projectId: 7 })).toBeNull();
  });
  it("un compte de client ne peut pas devenir celui de l'utilisatrice", () => {
    expect(conflitIdentite(comptes, { platform: "instagram", accountId: "ig-b", projectId: null })).toBe("compte_d_un_autre_projet");
  });
});

describe("pagesLinkedinPourClient — jamais les pages déjà rattachées ailleurs", () => {
  it("garde les pages nouvelles et celles du client lui-même", () => {
    const pages = [{ id: "100", name: "JMD" }, { id: "200", name: "Client B" }, { id: "300", name: "Client A" }, { id: "400", name: "Nouvelle" }];
    expect(pagesLinkedinPourClient(pages, comptes, 7).map((p) => p.id)).toEqual(["300", "400"]);
  });
});
