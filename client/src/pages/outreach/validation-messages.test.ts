import { describe, it, expect } from "vitest";
import {
  attendValidation, estPretAPartir, estValide, messagesAValider, miseAJourMessage,
  prospectsAValider, depasseLimite,
} from "./validation-messages";

describe("estValide", () => {
  it("refuse null, vide et une date illisible", () => {
    expect(estValide(null)).toBe(false);
    expect(estValide(undefined)).toBe(false);
    expect(estValide("")).toBe(false);
    expect(estValide("pas une date")).toBe(false);
  });
  it("accepte une date ISO venue du JSON", () => {
    expect(estValide("2026-10-09T08:00:00.000Z")).toBe(true);
  });
});

describe("prospectsAValider", () => {
  const base = { stage: "messages_ready", validatedAt: null, archivedAt: null };
  it("garde seulement les messages prêts, non validés, non archivés", () => {
    const leads = [
      { id: 1, ...base },
      { id: 2, ...base, validatedAt: "2026-10-09T08:00:00Z" },
      { id: 3, ...base, stage: "identified" },
      { id: 4, ...base, archivedAt: "2026-10-01T00:00:00Z" },
      { id: 5, ...base, stage: "connection_sent" },
    ];
    expect(prospectsAValider(leads).map((l) => l.id)).toEqual([1]);
  });
  it("une validation illisible laisse le prospect à valider", () => {
    expect(attendValidation({ id: 1, ...base, validatedAt: "x" })).toBe(true);
  });
  it("prêt à partir = validé ET toujours à l'étape messages prêts", () => {
    expect(estPretAPartir({ id: 1, ...base, validatedAt: "2026-10-09T08:00:00Z" })).toBe(true);
    expect(estPretAPartir({ id: 1, ...base, stage: "connected", validatedAt: "2026-10-09T08:00:00Z" })).toBe(false);
  });
});

describe("messagesAValider", () => {
  it("préfère les champs actuels, se rabat sur message1/message2", () => {
    expect(messagesAValider({ id: 1, linkedinMessage: "A", message1: "vieux", message2: "B" })).toEqual([
      { champ: "linkedinMessage", canal: "linkedin", texte: "A" },
      { champ: "emailMessage", canal: "email", texte: "B" },
    ]);
  });
  it("aucun message → liste vide", () => {
    expect(messagesAValider({ id: 1 })).toEqual([]);
  });
});

describe("miseAJourMessage", () => {
  it("écrit aussi le champ historique", () => {
    expect(miseAJourMessage("linkedinMessage", "x")).toEqual({ linkedinMessage: "x", message1: "x" });
    expect(miseAJourMessage("emailMessage", "y")).toEqual({ emailMessage: "y", message2: "y" });
  });
});

describe("depasseLimite", () => {
  it("ne concerne que la note LinkedIn au-delà de 200 caractères", () => {
    expect(depasseLimite({ canal: "linkedin", texte: "a".repeat(201) })).toBe(true);
    expect(depasseLimite({ canal: "linkedin", texte: "a".repeat(200) })).toBe(false);
    expect(depasseLimite({ canal: "email", texte: "a".repeat(900) })).toBe(false);
  });
});
