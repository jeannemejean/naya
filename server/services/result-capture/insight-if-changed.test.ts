import { describe, it, expect } from "vitest";
import { insightIfChanged } from "./insight-if-changed";
import { buildImmediateInsight, type TaskAnswer } from "./insight";

// Petits constructeurs locaux — plus explicites que le `rep` d'insight.test.ts, parce
// qu'ici on a besoin de contrôler précisément le nombre d'observations ET le ratio
// faits/total pour placer chaque scénario juste au bon côté d'un seuil.
const admin = (done: boolean, hour = 10): TaskAnswer => ({ category: "admin", scheduledHour: hour, done });
const matin = (done: boolean): TaskAnswer => ({ category: null, scheduledHour: 9, done });
const aprem = (done: boolean): TaskAnswer => ({ category: null, scheduledHour: 16, done });

describe("insightIfChanged", () => {
  it("deux réponses successives qui produisent la même observation → la seconde se tait", () => {
    // « admin » ne passe jamais, avec ou sans la dernière réponse : le texte de la
    // phrase ne dépend que du nom de catégorie, pas du compte — ratio 0/6 puis 0/7,
    // toujours <= SEUIL_BAS. Rien de neuf appris.
    const sans: TaskAnswer[] = Array.from({ length: 6 }, () => admin(false));
    const avec: TaskAnswer[] = [...sans, admin(false)];
    expect(insightIfChanged(avec, sans)).toBeNull();
  });

  it("une réponse qui fait basculer l'observation → elle parle", () => {
    // « sans » : le groupe admin viole encore (ratio 1/5 = 0.2 <= 0.25) → phrase
    // « admin » retournée AVANT même que le déséquilibre matin/après-midi (déjà
    // présent mais masqué, car le contrôle catégorie est fait en premier) soit atteint.
    // « avec » : la réponse qui arrive est admin=true → ratio 2/6 = 0.333 > 0.25, la
    // catégorie ne viole plus → on tombe sur le déséquilibre matin/après-midi, qui
    // était là depuis le début. Deux phrases non nulles, et différentes.
    const sans: TaskAnswer[] = [
      admin(false), admin(false), admin(false), admin(false), admin(true),
      matin(true), matin(true), matin(true), matin(true), matin(true),
      aprem(false), aprem(false), aprem(false), aprem(false), aprem(false),
    ];
    const avec: TaskAnswer[] = [...sans, admin(true)];

    // Lecture directe de la phrase "sans", via la fonction déjà éprouvée — pas via
    // insightIfChanged(sans, sans), qui comparerait la même liste à elle-même et
    // renverrait toujours null quel que soit le contenu de la phrase.
    const resultSans = buildImmediateInsight(sans);
    const resultAvec = insightIfChanged(avec, sans);

    expect(resultSans).not.toBeNull();
    expect(resultSans!.toLowerCase()).toContain("admin");
    expect(resultAvec).not.toBeNull();
    expect(resultAvec!.toLowerCase()).toMatch(/matin|après-midi/);
    expect(resultAvec).not.toBe(resultSans);
  });

  it("null avant puis une phrase après (le seuil de 5 observations vient d'être franchi) → elle parle", () => {
    const sans: TaskAnswer[] = Array.from({ length: 4 }, () => admin(false)); // < MIN_OBSERVATIONS
    const avec: TaskAnswer[] = [...sans, admin(false)]; // 5 : le seuil est franchi
    const r = insightIfChanged(avec, sans);
    expect(r).not.toBeNull();
    expect(r!.toLowerCase()).toContain("admin");
  });

  it("une phrase avant puis null après → elle se tait (ne jamais renvoyer une phrase qui n'est plus vraie)", () => {
    // « sans » : ratio 1/5 = 0.2 <= 0.25, viole → phrase. Aucun déséquilibre
    // matin/après-midi (tout est à la même heure, le groupe après-midi est vide).
    const sans: TaskAnswer[] = [
      admin(false), admin(false), admin(false), admin(false), admin(true),
    ];
    // « avec » : la réponse qui arrive est admin=true → ratio 2/6 = 0.333 > 0.25, plus
    // aucune violation, et toujours aucun déséquilibre matin/après-midi (aprem vide).
    const avec: TaskAnswer[] = [...sans, admin(true)];
    expect(insightIfChanged(avec, sans)).toBeNull();
  });

  it("null des deux côtés → silence", () => {
    const sans: TaskAnswer[] = Array.from({ length: 3 }, () => admin(false));
    const avec: TaskAnswer[] = [...sans, admin(false)]; // 4 : toujours < MIN_OBSERVATIONS
    expect(insightIfChanged(avec, sans)).toBeNull();
  });
});
