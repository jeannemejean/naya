import { describe, it, expect } from "vitest";
import { parseRelecture } from "./relecture";

describe("parseRelecture", () => {
  it("lit les défauts signalés par la relecture", () => {
    const d = parseRelecture(`{"ok":false,"defauts":[{"code":"declencheur_absent","raison":"Le lancement Daisy Wild n'est pas mentionné."}]}`);
    expect(d).toEqual([{ code: "relecture", raison: "Le lancement Daisy Wild n'est pas mentionné." }]);
  });
  it("ok:true → aucun défaut", () => {
    expect(parseRelecture(`{"ok":true,"defauts":[]}`)).toEqual([]);
  });
  it("une réponse illisible ne bloque jamais le message", () => {
    expect(parseRelecture("je ne sais pas")).toEqual([]);
    expect(parseRelecture(`{"ok":false}`)).toEqual([]);
  });
  it("borne le nombre de défauts et ignore les raisons vides", () => {
    const raw = JSON.stringify({ ok: false, defauts: [{ raison: "" }, ...Array.from({ length: 9 }, (_, i) => ({ raison: `raison numéro ${i}` }))] });
    expect(parseRelecture(raw)).toHaveLength(5);
  });
});
