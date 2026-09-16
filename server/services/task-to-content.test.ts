import { describe, it, expect } from "vitest";
import {
  construireContenuDepuisTache,
  CHAMPS_DEDUCTIBLES,
  VALEUR_A_PRECISER,
} from "./task-to-content";

/**
 * Transformation d'une note d'espace de travail en ligne du calendrier de contenu.
 *
 * La table `content` impose title, body, platform, contentType, pillar et goal, tous
 * NOT NULL. Une note brute n'en porte que deux. Jeanne a choisi que Naya déduise les
 * quatre autres — donc qu'elle se trompe parfois, donc que ces champs se signalent.
 */

const tache = { id: 12, projectId: 7, type: "content", title: "Écrire un post LinkedIn" };
const note = { title: "Pourquoi je code avec Naya", content: "Le corps du post…" };

describe("construireContenuDepuisTache", () => {
  it("le titre et le corps viennent de l'utilisatrice, jamais de la déduction", () => {
    const r = construireContenuDepuisTache({ tache, note, deduit: {} });

    expect(r.ligne.title).toBe("Pourquoi je code avec Naya");
    expect(r.ligne.body).toBe("Le corps du post…");
    expect(r.ligne.deducedFields).not.toContain("title");
    expect(r.ligne.deducedFields).not.toContain("body");
  });

  it("sans titre de note, le titre de la tâche prend le relais — et n'est pas marqué déduit", () => {
    // Reprendre le titre de la tâche n'est pas une supposition : c'est une donnée écrite
    // par l'utilisatrice, ailleurs. La marquer « déduite » diluerait le sens du marqueur.
    const r = construireContenuDepuisTache({ tache, note: { title: "", content: "Texte" }, deduit: {} });

    expect(r.ligne.title).toBe("Écrire un post LinkedIn");
    expect(r.ligne.deducedFields).not.toContain("title");
  });

  it("un champ rendu par la déduction est utilisé ET marqué", () => {
    const r = construireContenuDepuisTache({
      tache,
      note,
      deduit: { platform: "linkedin", pillar: "Coulisses de build" },
    });

    expect(r.ligne.platform).toBe("linkedin");
    expect(r.ligne.pillar).toBe("Coulisses de build");
    expect(r.ligne.deducedFields).toEqual(expect.arrayContaining(["platform", "pillar"]));
  });

  it("un champ que la déduction n'a pas rendu reçoit un marqueur lisible, et reste marqué", () => {
    // La colonne est NOT NULL : il FAUT une valeur. Inventer un pilier plausible serait
    // pire qu'écrire « à préciser » — un pilier plausible ne se remarque pas, et fausse
    // les statistiques en silence.
    const r = construireContenuDepuisTache({ tache, note, deduit: { platform: "linkedin" } });

    expect(r.ligne.pillar).toBe(VALEUR_A_PRECISER);
    expect(r.ligne.goal).toBe(VALEUR_A_PRECISER);
    expect(r.ligne.deducedFields).toEqual(expect.arrayContaining(["pillar", "goal"]));
  });

  it("une déduction totalement vide marque les quatre champs", () => {
    const r = construireContenuDepuisTache({ tache, note, deduit: {} });

    expect(r.ligne.deducedFields).toEqual(expect.arrayContaining([...CHAMPS_DEDUCTIBLES]));
    expect(r.ligne.deducedFields).toHaveLength(CHAMPS_DEDUCTIBLES.length);
  });

  it("une valeur fournie par le modèle reste marquée : c'est une supposition", () => {
    // Le point de tout le dispositif, et j'ai d'abord écrit ce test à l'envers — en
    // attendant un tableau vide quand la déduction fournit les quatre champs.
    //
    // C'était contredire la raison d'être du marqueur. Un pilier rendu par le modèle n'est
    // pas plus choisi par l'utilisatrice qu'un « à préciser » : il est seulement plus
    // plausible, donc plus dangereux, puisqu'il ne se remarque pas.
    //
    // Dans ce flux, l'utilisatrice ne renseigne jamais ces quatre champs : ils sont donc
    // TOUJOURS marqués. Le tableau vide reste réservé à un futur flux où elle les
    // fournirait elle-même — d'où un tableau, jamais `null`.
    const r = construireContenuDepuisTache({
      tache,
      note,
      deduit: { platform: "linkedin", contentType: "post", pillar: "Build", goal: "visibilité" },
    });

    expect(r.ligne.deducedFields).toEqual(expect.arrayContaining([...CHAMPS_DEDUCTIBLES]));
    expect(Array.isArray(r.ligne.deducedFields)).toBe(true);
    expect(r.ligne.deducedFields).not.toBeNull();
  });

  it("le contenu part en brouillon, jamais publié", () => {
    // Demande de Jeanne : « à l'endroit des posts rédigés mais qui ne sont pas terminés ».
    const r = construireContenuDepuisTache({ tache, note, deduit: {} });

    expect(r.ligne.status).toBe("draft");
    expect(r.ligne.publishedAt ?? null).toBeNull();
    expect(r.ligne.scheduledFor ?? null).toBeNull();
  });

  it("le projet de la tâche est repris", () => {
    expect(construireContenuDepuisTache({ tache, note, deduit: {} }).ligne.projectId).toBe(7);
  });

  it("une note vide ne produit AUCUNE ligne", () => {
    // Bug visé : créer un contenu vide dans le calendrier parce que l'utilisatrice a
    // cliqué sur Enregistrer sans rien écrire.
    for (const vide of ["", "   ", "\n\t "]) {
      expect(
        construireContenuDepuisTache({ tache, note: { title: "T", content: vide }, deduit: {} }).ligne,
        `contenu « ${vide} »`,
      ).toBeNull();
    }
  });

  it("une valeur déduite blanche compte comme absente", () => {
    // Bug visé : le modèle rend une chaîne vide, on l'écrit telle quelle, et la colonne
    // NOT NULL reçoit "" — techniquement valide, humainement illisible.
    const r = construireContenuDepuisTache({ tache, note, deduit: { platform: "  ", pillar: "" } });

    expect(r.ligne.platform).toBe(VALEUR_A_PRECISER);
    expect(r.ligne.pillar).toBe(VALEUR_A_PRECISER);
    expect(r.ligne.deducedFields).toEqual(expect.arrayContaining(["platform", "pillar"]));
  });

  it("un champ inconnu rendu par le modèle est ignoré", () => {
    // Bug visé : recopier telles quelles les clés du modèle dans la ligne, et tenter
    // d'écrire une colonne qui n'existe pas.
    const r = construireContenuDepuisTache({
      tache,
      note,
      deduit: { platform: "linkedin", couleur: "bleu" } as any,
    });

    expect(r.ligne).not.toHaveProperty("couleur");
    expect(r.ligne.deducedFields).not.toContain("couleur");
  });
});
