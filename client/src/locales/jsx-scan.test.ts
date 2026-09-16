import { describe, it, expect } from "vitest";
import { textesEnDurDansSource } from "./jsx-scan";

const textes = (src: string) => textesEnDurDansSource("x.tsx", src).map((t) => t.texte);

describe("détection des textes en dur", () => {
  it("voit un noeud texte JSX", () => {
    expect(textes(`const A = () => <p>Bonjour toi</p>;`)).toEqual(["Bonjour toi"]);
  });

  it("voit un littéral affiché depuis un ternaire", () => {
    // L'ANGLE MORT. La première version ne regardait que les noeuds JsxText et manquait
    // toutes les formes `{cond ? 'A' : 'B'}` — 88 occurrences, dont les boutons
    // « Update pillar » / « Add pillar » de brand-dna-editor.
    const trouves = textes(`const A = ({e}) => <button>{e ? 'Update pillar' : 'Add pillar'}</button>;`);

    expect(trouves).toContain("Update pillar");
    expect(trouves).toContain("Add pillar");
  });

  it("voit un littéral affiché derrière un &&", () => {
    expect(textes(`const A = ({e}) => <div>{e && 'Échec du chargement'}</div>;`)).toEqual([
      "Échec du chargement",
    ]);
  });

  it("voit les attributs lus par un humain", () => {
    const trouves = textes(`const A = () => <input placeholder="Ton nom" title="Un titre" />;`);

    expect(trouves).toEqual(expect.arrayContaining(["Ton nom", "Un titre"]));
  });

  it("ignore une expression d'attribut, qui n'est pas du texte affiché", () => {
    // Bug visé : signaler `className={a ? 'text-red' : 'text-blue'}` inonderait la garde
    // de faux positifs et la rendrait inutilisable.
    expect(textes(`const A = ({a}) => <div className={a ? 'text-red' : 'text-blue'} />;`)).toEqual(
      [],
    );
  });

  it("ignore un appel à t(), qui est précisément la forme correcte", () => {
    // Bug visé, et il inverserait le sens de la garde : descendre dans les appels de
    // fonction ferait signaler la traduction bien faite.
    expect(textes(`const A = ({t}) => <p>{t('brandDna.pillarName')}</p>;`)).toEqual([]);
  });

  it("ignore le contenu d'une balise style", () => {
    // Bug visé : un bloc @keyframes inséré via <style> comptait comme du texte à traduire.
    const src = "const A = () => <style>{`@keyframes x { 0% { left: -40%; } }`}</style>;";
    expect(textes(src)).toEqual([]);
  });

  it("ignore ce qui n'a pas deux lettres de suite", () => {
    expect(textes(`const A = () => <span>· 42 — /</span>;`)).toEqual([]);
  });

  it("ne signale pas une variable affichée", () => {
    expect(textes(`const A = ({nom}) => <p>{nom}</p>;`)).toEqual([]);
  });
});
