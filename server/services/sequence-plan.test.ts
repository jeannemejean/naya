import { describe, it, expect } from "vitest";
import { parseSequencePlan } from "./sequence-plan";

describe("parseSequencePlan", () => {
  it("parse un plan multicanal conditionnel", () => {
    const raw = `Voici le plan : {"rationale":"LinkedIn d'abord car cible active.","steps":[
      {"channel":"linkedin","delayDays":0,"intention":"Invitation d'ouverture","condition":"always"},
      {"channel":"email","delayDays":3,"intention":"Email de valeur","condition":"if_invite_not_accepted"},
      {"channel":"linkedin","delayDays":3,"intention":"Message de suivi","condition":"if_invite_accepted"}
    ]}`;
    const plan = parseSequencePlan(raw);
    expect(plan.rationale).toContain("LinkedIn");
    expect(plan.steps).toHaveLength(3);
    expect(plan.steps[0]).toEqual({ channel: "linkedin", delayDays: 0, intention: "Invitation d'ouverture", condition: "always" });
    expect(plan.steps[1].channel).toBe("email");
  });
  it("normalise canal/condition inconnus et borne à 6 étapes", () => {
    const raw = `{"rationale":"x","steps":[${Array.from({length:8},(_,i)=>`{"channel":"sms","delayDays":-2,"intention":"i${i}","condition":"maybe"}`).join(",")}]}`;
    const plan = parseSequencePlan(raw);
    expect(plan.steps).toHaveLength(6);
    expect(plan.steps[0].channel).toBe("email");       // canal inconnu → email
    expect(plan.steps[0].delayDays).toBe(0);           // délai négatif → 0
    expect(plan.steps[0].condition).toBe("always");    // condition inconnue → always
  });
  it("JSON invalide → plan vide sûr", () => {
    expect(parseSequencePlan("pas du json")).toEqual({ rationale: "", steps: [] });
  });
});
