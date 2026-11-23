import { describe, it, expect } from "vitest";
import { contenuTelephone, extraireHashtags, lireContenuTelephone, raisonsTelephone } from "./finir-telephone";

describe("extraireHashtags", () => {
  it("hashtags de la légende puis du commentaire, sans doublon (casse ignorée), ni ancres, ni nombres seuls", () => {
    expect(extraireHashtags("Nouveau #Café à #Lyon ! https://x.fr/page#ancre #2026", "#lyon #brunch_dimanche")).toEqual(["#Café", "#Lyon", "#brunch_dimanche"]);
    expect(extraireHashtags(null, undefined, "")).toEqual([]);
  });
});

describe("raisonsTelephone", () => {
  it("demande, réseau sans publication automatique, compte absent ou expiré ; rien sinon", () => {
    expect(raisonsTelephone({ finirSurTelephone: true }, [])).toEqual(["demande"]);
    expect(raisonsTelephone({}, ["plateforme_non_supportee"])).toEqual(["sans_publication_auto"]);
    expect(raisonsTelephone({ finirSurTelephone: false }, ["compte_absent"])).toEqual(["sans_compte"]);
    expect(raisonsTelephone({ finirSurTelephone: null }, ["compte_expire", "date_passee"])).toEqual(["compte_expire"]);
    expect(raisonsTelephone({}, ["visuel_requis"])).toEqual([]);
  });
});

describe("contenuTelephone", () => {
  it("légende, premier commentaire, hashtags et médias numérotés dans l'ordre", () => {
    const c = contenuTelephone({
      post: { body: "  Le texte #A  ", platform: "Instagram", postFormat: "reel", premierCommentaire: " " },
      medias: [{ url: "https://cdn/v/film.mp4", genre: "video" }, { url: "", genre: "image" }],
      raisons: ["demande"],
    });
    expect(c).toEqual({
      version: 1, reseau: "instagram", format: "reel", legende: "Le texte #A", premierCommentaire: null,
      hashtags: ["#A"], medias: [{ ordre: 1, url: "https://cdn/v/film.mp4", nom: "film.mp4", genre: "video" }], raisons: ["demande"],
    });
  });

  it("format déduit des médias quand il n'est pas explicite ; média sans nom lisible : media-N", () => {
    const c = contenuTelephone({
      post: { body: "x", platform: "tiktok", postFormat: null },
      medias: [{ url: "https://cdn/", genre: "image" }, { url: "https://cdn/b.png", nom: "B.png", genre: "image" }],
      raisons: ["sans_publication_auto"],
    });
    expect(c.format).toBe("carousel");
    expect(c.medias.map((m) => m.nom)).toEqual(["media-1", "B.png"]);
  });

  it("relu depuis actionData ; absent ou illisible : null", () => {
    const c = contenuTelephone({ post: { body: "x", platform: "linkedin" }, medias: [], raisons: ["sans_compte"] });
    expect(lireContenuTelephone({ postContent: "x", telephone: c })).toEqual(c);
    expect(lireContenuTelephone({ postContent: "x" })).toBeNull();
    expect(lireContenuTelephone({ telephone: { version: 2 } })).toBeNull();
    expect(lireContenuTelephone(null)).toBeNull();
  });
});

describe("contenuTelephone — nom de fichier mal encodé", () => {
  it("une adresse au pourcentage invalide ne fait pas planter : nom brut gardé", () => {
    const c = contenuTelephone({ post: { body: "x", platform: "Instagram" }, medias: [{ url: "https://cdn/v/photo%E0%A4.jpg", genre: "image" }], raisons: [] });
    expect(c.medias[0].nom).toBe("photo%E0%A4.jpg");
  });
});
