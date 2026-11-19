import { describe, it, expect, vi } from "vitest";

// Stockage mocké : une ligne user_preferences en mémoire.
const etat = vi.hoisted(() => ({ ligne: null as { filConducteurDepuis: Date | null } | null }));
vi.mock("../../db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => Promise.resolve(etat.ligne ? [etat.ligne] : []) }) }),
    insert: () => ({
      values: () => ({
        onConflictDoNothing: () => { if (!etat.ligne) etat.ligne = { filConducteurDepuis: null }; return Promise.resolve(); },
      }),
    }),
    update: () => ({
      set: (v: any) => ({
        where: () => ({
          returning: () => {
            if (etat.ligne && !etat.ligne.filConducteurDepuis) {
              etat.ligne.filConducteurDepuis = v.filConducteurDepuis;
              return Promise.resolve([{ filConducteurDepuis: v.filConducteurDepuis }]);
            }
            return Promise.resolve([]);
          },
        }),
      }),
    }),
  },
}));

import { filActifPour, mailsActifsPour, miseEnRoute } from "./interrupteur";

describe("filActifPour", () => {
  it("reconnaît les ids de la liste, espaces tolérés", () => {
    const env = { FIL_CONDUCTEUR_USERS: " a, b " } as NodeJS.ProcessEnv;
    expect(filActifPour("a", env)).toBe(true);
    expect(filActifPour("b", env)).toBe(true);
    expect(filActifPour("c", env)).toBe(false);
  });
  it("faux quand la variable est vide ou absente", () => {
    expect(filActifPour("a", { FIL_CONDUCTEUR_USERS: "" } as NodeJS.ProcessEnv)).toBe(false);
    expect(filActifPour("a", {} as NodeJS.ProcessEnv)).toBe(false);
  });
});

// 19 nov. 2026 : Jeanne coupe les tâches « Répondre à » ; on les rallume par FIL_MAILS_USERS.
describe("mailsActifsPour", () => {
  it("faux par défaut, même pour une utilisatrice du fil", () => {
    expect(mailsActifsPour("a", { FIL_CONDUCTEUR_USERS: "a" } as NodeJS.ProcessEnv)).toBe(false);
  });
  it("vrai seulement si elle est aussi dans FIL_MAILS_USERS", () => {
    const env = { FIL_CONDUCTEUR_USERS: "a,b", FIL_MAILS_USERS: " a " } as NodeJS.ProcessEnv;
    expect(mailsActifsPour("a", env)).toBe(true);
    expect(mailsActifsPour("b", env)).toBe(false);
    expect(mailsActifsPour("c", { FIL_MAILS_USERS: "c" } as NodeJS.ProcessEnv)).toBe(false);
  });
});

describe("miseEnRoute", () => {
  it("pose la date au premier appel (nouveau) et la conserve ensuite", async () => {
    etat.ligne = null;
    const t1 = new Date("2026-11-12T08:00:00Z");
    const t2 = new Date("2026-11-13T08:00:00Z");
    const a = await miseEnRoute("u1", t1);
    expect(a).toEqual({ depuis: t1, nouveau: true });
    const b = await miseEnRoute("u1", t2);
    expect(b).toEqual({ depuis: t1, nouveau: false });
  });
});
