import { describe, it, expect, vi } from "vitest";
import { rattacherLead, clesPersonne, memePersonne, type DepsRattachement } from "./rattachement";
import type { EvenementNormalise } from "./ingestion";

const base: EvenementNormalise = { kind: "message", accountId: "acc", fromSelf: false, sentAt: new Date("2026-11-02T10:00:00Z") };

function deps(over: Partial<DepsRattachement> = {}): DepsRattachement {
  return {
    leadParFil: vi.fn(async () => null),
    leadParProviderId: vi.fn(async () => null),
    leadParPublicId: vi.fn(async () => null),
    leadContacteParEmail: vi.fn(async () => null),
    ...over,
  };
}

describe("rattacherLead", () => {
  it("priorité : fil > providerId > publicId > email", async () => {
    const tous = deps({
      leadParFil: vi.fn(async () => 1),
      leadParProviderId: vi.fn(async () => 2),
      leadParPublicId: vi.fn(async () => 3),
      leadContacteParEmail: vi.fn(async () => 4),
    });
    const evt = { ...base, chatId: "c", senderProviderId: "p", senderPublicId: "pub", senderEmail: "a@b.fr" };
    expect(await rattacherLead(evt, tous)).toEqual({ leadId: 1, via: "fil" });

    const sansFil = deps({ leadParProviderId: vi.fn(async () => 2), leadParPublicId: vi.fn(async () => 3), leadContacteParEmail: vi.fn(async () => 4) });
    expect(await rattacherLead(evt, sansFil)).toEqual({ leadId: 2, via: "providerId" });

    const parPublic = deps({ leadParPublicId: vi.fn(async () => 3), leadContacteParEmail: vi.fn(async () => 4) });
    expect(await rattacherLead(evt, parPublic)).toEqual({ leadId: 3, via: "publicId" });

    const parEmail = deps({ leadContacteParEmail: vi.fn(async () => 4) });
    expect(await rattacherLead(evt, parEmail)).toEqual({ leadId: 4, via: "email" });
  });

  it("fil : cherche par fil, chat et message auquel on répond", async () => {
    const d = deps();
    await rattacherLead({ ...base, kind: "mail", threadId: "t1", inReplyTo: ["m1", "m2"] }, d);
    expect(d.leadParFil).toHaveBeenCalledWith(["t1", "m1", "m2"]);
  });

  it("email d'un lead jamais contacté → null (le filtre « contacté » est dans la dépendance)", async () => {
    const d = deps();
    expect(await rattacherLead({ ...base, kind: "mail", senderEmail: "jamais@contacte.fr" }, d)).toBeNull();
    expect(d.leadContacteParEmail).toHaveBeenCalledWith("jamais@contacte.fr");
  });

  it("email avec majuscules / espaces → normalisé puis trouvé", async () => {
    const d = deps({ leadContacteParEmail: vi.fn(async (e: string) => (e === "marc@client.fr" ? 9 : null)) });
    expect(await rattacherLead({ ...base, kind: "mail", senderEmail: "  Marc@Client.FR " }, d)).toEqual({ leadId: 9, via: "email" });
  });

  it("rien d'identifiable → null sans appel", async () => {
    const d = deps();
    expect(await rattacherLead(base, d)).toBeNull();
    expect(d.leadParFil).not.toHaveBeenCalled();
    expect(d.leadParProviderId).not.toHaveBeenCalled();
  });
});

describe("doublons de leads (M3) — clesPersonne / memePersonne", () => {
  it("même email (casse, espaces) → même personne", () => {
    expect(memePersonne(clesPersonne({ email: " Marc@Acme.fr" }), clesPersonne({ email: "marc@acme.fr" }))).toBe(true);
  });
  it("même identifiant LinkedIn interne → même personne", () => {
    expect(memePersonne(clesPersonne({ pid: "ACo-1" }), clesPersonne({ pid: "ACo-1", email: "x@y.z" }))).toBe(true);
  });
  it("même profil public (URL différente, casse, slash final) → même personne", () => {
    expect(memePersonne(
      clesPersonne({ url: "https://www.linkedin.com/in/Marc-Dupont/" }),
      clesPersonne({ url: "http://linkedin.com/in/marc-dupont" }),
    )).toBe(true);
  });
  it("rien en commun, ou clés absentes des deux côtés → pas la même personne", () => {
    expect(memePersonne(clesPersonne({ email: "a@b.c" }), clesPersonne({ email: "d@e.f" }))).toBe(false);
    expect(memePersonne(clesPersonne({}), clesPersonne({}))).toBe(false);
    expect(memePersonne(clesPersonne({ url: "https://linkedin.com/in/marc-dupont-1" }), clesPersonne({ url: "https://linkedin.com/in/marc-dupont" }))).toBe(false);
  });
});
