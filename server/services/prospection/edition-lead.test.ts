import { describe, it, expect, vi, beforeEach } from "vitest";

const storageMock = {
  getProspectionCampaign: vi.fn(async () => ({ id: 5, userId: "u1", projectId: 7 })),
  getSequenceSteps: vi.fn(async () => [
    { id: 11, channel: "linkedin", condition: "always", role: "invitation" },
    { id: 12, channel: "email", condition: "if_invite_not_accepted", role: "email_ouverture" },
  ]),
  getLeadStepMessage: vi.fn(async () => ({ subject: "Objet", body: "ancien", edited: false })),
  upsertLeadStepMessage: vi.fn(async () => {}),
  addMessageFeedback: vi.fn(async () => ({})),
};
vi.mock("../../storage", () => ({ storage: storageMock }));
vi.mock("./regles-apprises", () => ({ extraireSiPret: vi.fn(async () => 0) }));

const { tracerEditionMessages, tracerValidation, messagesARevoir, accepterMessagesARevoir } = await import("./edition-lead");

const avant = { id: 1, prospectionCampaignId: 5, linkedinMessage: "Version Naya LinkedIn", emailMessage: "Version Naya mail" };

beforeEach(() => vi.clearAllMocks());

describe("tracerEditionMessages", () => {
  it("un message LinkedIn modifié dans la fiche part tel quel et devient un exemple", async () => {
    await tracerEditionMessages("u1", avant, { linkedinMessage: "Ma version" });
    expect(storageMock.upsertLeadStepMessage).toHaveBeenCalledWith(expect.objectContaining({ leadId: 1, stepId: 11, body: "Ma version", edited: true }));
    expect(storageMock.addMessageFeedback).toHaveBeenCalledWith(expect.objectContaining({
      action: "modifie", original: "Version Naya LinkedIn", final: "Ma version", role: "invitation", projectId: 7,
    }));
  });
  it("garde l'objet existant de l'email", async () => {
    await tracerEditionMessages("u1", avant, { emailMessage: "Mon mail" });
    expect(storageMock.upsertLeadStepMessage).toHaveBeenCalledWith(expect.objectContaining({ stepId: 12, subject: "Objet", body: "Mon mail" }));
  });
  it("rien à faire si le texte n'a pas changé ou si le prospect n'a pas de campagne", async () => {
    await tracerEditionMessages("u1", avant, { linkedinMessage: "Version Naya LinkedIn" });
    await tracerEditionMessages("u1", { ...avant, prospectionCampaignId: null }, { linkedinMessage: "x" });
    expect(storageMock.upsertLeadStepMessage).not.toHaveBeenCalled();
    expect(storageMock.addMessageFeedback).not.toHaveBeenCalled();
  });
});

describe("tracerValidation", () => {
  it("chaque première touche non éditée validée est un exemple « validé tel quel »", async () => {
    await tracerValidation("u1", avant);
    expect(storageMock.addMessageFeedback).toHaveBeenCalledTimes(2);
    expect(storageMock.addMessageFeedback).toHaveBeenCalledWith(expect.objectContaining({ action: "valide_tel_quel", final: "ancien", role: "invitation" }));
  });
  it("une touche déjà éditée n'est pas recomptée", async () => {
    storageMock.getLeadStepMessage.mockResolvedValue({ subject: null, body: "édité", edited: true } as any);
    await tracerValidation("u1", avant);
    expect(storageMock.addMessageFeedback).not.toHaveBeenCalled();
  });
});

describe("messages à revoir à la validation", () => {
  it("liste les premières touches générées et marquées à revoir", async () => {
    storageMock.getLeadStepMessage.mockImplementation(async (_l: number, stepId: number) =>
      stepId === 11 ? ({ body: "x", edited: false, qualite: "a_revoir", defauts: [{ code: "tic", raison: "Formule d'IA" }] }) as any : ({ body: "y", edited: false, qualite: "ok" }) as any);
    const r = await messagesARevoir("u1", avant);
    expect(r).toEqual([expect.objectContaining({ stepId: 11, defauts: [{ code: "tic", raison: "Formule d'IA" }] })]);
  });
  it("une touche éditée n'est jamais à revoir", async () => {
    storageMock.getLeadStepMessage.mockResolvedValue({ body: "x", edited: true, qualite: "a_revoir" } as any);
    expect(await messagesARevoir("u1", avant)).toEqual([]);
  });
  it("valider quand même : la touche est acceptée telle quelle (éditée), sans devenir un exemple", async () => {
    storageMock.getLeadStepMessage.mockResolvedValue({ body: "x", subject: "o", edited: false, qualite: "a_revoir" } as any);
    await accepterMessagesARevoir("u1", avant);
    expect(storageMock.upsertLeadStepMessage).toHaveBeenCalledWith(expect.objectContaining({ stepId: 11, body: "x", edited: true }));
    expect(storageMock.addMessageFeedback).not.toHaveBeenCalled();
  });
  it("la validation ne fait pas d'un message à revoir un exemple", async () => {
    storageMock.getLeadStepMessage.mockResolvedValue({ body: "x", edited: false, qualite: "a_revoir" } as any);
    await tracerValidation("u1", avant);
    expect(storageMock.addMessageFeedback).not.toHaveBeenCalled();
  });
});
