import { describe, it, expect, vi } from "vitest";
import { identiteCampagne } from "./resolution";

const prefs = { prospectionSenderEmail: "jeanne@jmd.com", prospectionSenderName: "Jeanne", linkedinUnipileAccountId: "uni-j" };
function deps(campagne: any, projet: any, connexion: any) {
  return {
    getProspectionCampaign: vi.fn(async () => campagne),
    getProject: vi.fn(async (id: number, u: string) => (projet && projet.id === id && u === "u" ? projet : undefined)),
    getConnexionProjet: vi.fn(async () => connexion),
  };
}

describe("identiteCampagne", () => {
  it("campagne sans projet ou de projet perso : réglages de l'utilisatrice", async () => {
    const r = await identiteCampagne("u", 10, prefs, deps({ id: 10, userId: "u", projectId: null }, null, null));
    expect(r.portee).toBeNull();
    expect(r.identite.email?.fromEmail).toBe("jeanne@jmd.com");
    const r2 = await identiteCampagne("u", 10, prefs, deps({ id: 10, userId: "u", projectId: 5 }, { id: 5, projectKind: "personal" }, null));
    expect(r2.portee).toBeNull();
  });
  it("campagne d'un projet client : connexion du client seulement", async () => {
    const d = deps({ id: 10, userId: "u", projectId: 7 }, { id: 7, projectKind: "client" }, { senderEmail: "marc@client.fr", senderName: "Marc" });
    const r = await identiteCampagne("u", 10, prefs, d);
    expect(r.portee).toBe(7);
    expect(r.identite.email?.fromEmail).toBe("marc@client.fr");
    expect(r.identite.linkedin).toBeNull();
    expect(r.identite.signature).toBe("Marc");
    expect(d.getConnexionProjet).toHaveBeenCalledWith("u", 7);
  });
  it("client sans connexion : rien, jamais l'utilisatrice", async () => {
    const r = await identiteCampagne("u", 10, prefs, deps({ id: 10, userId: "u", projectId: 7 }, { id: 7, projectKind: "client" }, undefined));
    expect(r).toEqual({ portee: 7, identite: { email: null, linkedin: null, signature: null } });
  });
  it("campagne d'une autre utilisatrice : rien du tout", async () => {
    const r = await identiteCampagne("u", 10, prefs, deps({ id: 10, userId: "autre", projectId: null }, null, null));
    expect(r.identite).toEqual({ email: null, linkedin: null, signature: null });
  });
  it("campagne introuvable : aucun projet connu, périmètre de l'utilisatrice", async () => {
    const r = await identiteCampagne("u", 10, prefs, deps(undefined, null, null));
    expect(r.portee).toBeNull();
    expect(r.identite.email?.fromEmail).toBe("jeanne@jmd.com");
  });
});

import { signatureCampagne, SignatureClientManquanteError } from "./resolution";
describe("signatureCampagne — même signature à l'aperçu, à l'enrichissement et à l'envoi", () => {
  const vide = { email: null, linkedin: null };
  it("utilisatrice : sa signature habituelle", () => {
    expect(signatureCampagne({ portee: null, identite: { ...vide, signature: null } }, () => "Jeanne")).toBe("Jeanne");
  });
  it("client avec signature : celle du client", () => {
    expect(signatureCampagne({ portee: 7, identite: { ...vide, signature: "Marc" } }, () => "Jeanne")).toBe("Marc");
  });
  it("client sans signature : refus, jamais celle de l'utilisatrice", () => {
    expect(() => signatureCampagne({ portee: 7, identite: { ...vide, signature: null } }, () => "Jeanne")).toThrow(SignatureClientManquanteError);
  });
});
