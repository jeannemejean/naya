import { describe, expect, it } from "vitest";
import { estCleFichierDe, estUrlMediaDe } from "./urls";

const B = "https://cdn.example.com";
const U = "3f2b8c1e-5a4d-4e6f-9a1b-2c3d4e5f6a7b";
const ID = "123e4567-e89b-42d3-a456-426614174000";

describe("estUrlMediaDe", () => {
  it("accepte l'URL exacte du compte", () => {
    expect(estUrlMediaDe("u1", `${B}/uploads/u1/images/${ID}.jpg`, B)).toBe(true);
    expect(estUrlMediaDe("u1", `${B}/uploads/u1/videos/${ID}`, B)).toBe(true);
    expect(estUrlMediaDe(U, `${B}/uploads/${U}/images/${ID}.png`, B)).toBe(true);
  });
  it("refuse l'objet d'un autre compte ou un userId préfixe", () => {
    expect(estUrlMediaDe("u1", `${B}/uploads/u2/images/${ID}.jpg`, B)).toBe(false);
    expect(estUrlMediaDe("u1", `${B}/uploads/u12/images/${ID}.jpg`, B)).toBe(false);
    expect(estUrlMediaDe("u12", `${B}/uploads/u1/images/${ID}.jpg`, B)).toBe(false);
  });
  it("refuse autre hôte, schéma, base vide", () => {
    expect(estUrlMediaDe("u1", `https://evil.com/uploads/u1/images/${ID}.jpg`, B)).toBe(false);
    expect(estUrlMediaDe("u1", `javascript:alert(1)`, B)).toBe(false);
    expect(estUrlMediaDe("u1", `${B}/uploads/u1/images/${ID}.jpg`, "")).toBe(false);
  });
  it("refuse .., //, antislash, query, fragment, dossier files", () => {
    expect(estUrlMediaDe("u1", `${B}/uploads/u1/../u2/images/${ID}.jpg`, B)).toBe(false);
    expect(estUrlMediaDe("u1", `${B}//uploads/u1/images/${ID}.jpg`, B)).toBe(false);
    expect(estUrlMediaDe("u1", `${B}/uploads/u1//images/${ID}.jpg`, B)).toBe(false);
    expect(estUrlMediaDe("u1", `${B}/uploads/u1/images/${ID}.jpg?x=1`, B)).toBe(false);
    expect(estUrlMediaDe("u1", `${B}/uploads/u1/images/${ID}.jpg#a`, B)).toBe(false);
    expect(estUrlMediaDe("u1", `${B}/uploads/u1\\images/${ID}.jpg`, B)).toBe(false);
    expect(estUrlMediaDe("u1", `${B}/uploads/u1/files/${ID}.jpg`, B)).toBe(false);
  });
});

describe("estCleFichierDe", () => {
  it("accepte la clé exacte du compte", () => {
    expect(estCleFichierDe("u1", `livrables/u1/${ID}.pdf`)).toBe(true);
    expect(estCleFichierDe("u1", `livrables/u1/${ID}`)).toBe(true);
  });
  it("refuse un autre compte, un préfixe, la traversée, query, antislash", () => {
    expect(estCleFichierDe("u1", `livrables/u2/${ID}.pdf`)).toBe(false);
    expect(estCleFichierDe("u1", `livrables/u12/${ID}.pdf`)).toBe(false);
    expect(estCleFichierDe("u1", `livrables/u1/../u2/${ID}.pdf`)).toBe(false);
    expect(estCleFichierDe("u1", `livrables/u1/${ID}.pdf?x`)).toBe(false);
    expect(estCleFichierDe("u1", `livrables/u1\\${ID}.pdf`)).toBe(false);
    expect(estCleFichierDe("u1", `/livrables/u1/${ID}.pdf`)).toBe(false);
    expect(estCleFichierDe("u1", `uploads/u1/images/${ID}.jpg`)).toBe(false);
  });
});
