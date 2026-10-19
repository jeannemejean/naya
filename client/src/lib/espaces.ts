// Rattachement des adresses aux 5 espaces du « cocon » (module pur, sans React).

export type EspaceId = "aujourdhui" | "projets" | "creer" | "veille" | "chiffres";

export interface Onglet {
  id: string;
  cle: string; // clé i18n
  href: string;
  prefixes: string[]; // adresses (et leurs sous-adresses) qui activent l'onglet
  proprietaire?: true; // visible seulement par la propriétaire
}

export interface Espace {
  id: EspaceId;
  cle: string;
  href: string;
  onglets: Onglet[];
}

const onglet = (espace: EspaceId, id: string, href: string, extra: Partial<Onglet> = {}): Onglet => ({
  id,
  cle: `espaces.${espace}.onglets.${id}`,
  href,
  prefixes: [href],
  ...extra,
});

const espace = (id: EspaceId, href: string, onglets: Onglet[]): Espace => ({
  id,
  cle: `espaces.${id}.nom`,
  href,
  onglets,
});

export const ESPACES: Espace[] = [
  espace("aujourdhui", "/", [
    onglet("aujourdhui", "aujourdhui", "/"),
    onglet("aujourdhui", "semaine", "/planning"),
  ]),
  espace("projets", "/projects", [
    onglet("projets", "projets", "/projects"),
    onglet("projets", "strategie", "/strategy"),
    onglet("projets", "fondations", "/fondations"),
    onglet("projets", "prospection", "/outreach"),
  ]),
  espace("creer", "/atelier", [
    onglet("creer", "atelier", "/atelier"),
    onglet("creer", "calendrier", "/content-calendar"),
    onglet("creer", "campagnes", "/campaigns"),
  ]),
  espace("veille", "/veille", [
    onglet("veille", "tendances", "/veille"),
    onglet("veille", "lecture", "/reading-hub"),
    onglet("veille", "savoir", "/savoir", { proprietaire: true }),
    onglet("veille", "profils", "/admin/profils-veille", { proprietaire: true }),
  ]),
  espace("chiffres", "/analytics", [
    onglet("chiffres", "chiffres", "/analytics"),
    onglet("chiffres", "mesure", "/mesure"),
  ]),
];

// « /projects » couvre « /projects/12 » mais pas « /projectsfoo » ; « / » ne couvre que lui-même.
function correspond(chemin: string, prefixe: string): boolean {
  if (prefixe === "/") return chemin === "/";
  return chemin === prefixe || chemin.startsWith(`${prefixe}/`);
}

export function espaceDuChemin(chemin: string): { espace: EspaceId; onglet: string } | null {
  const propre = chemin.split(/[?#]/)[0];
  let meilleur: { espace: EspaceId; onglet: string; longueur: number } | null = null;
  for (const e of ESPACES) {
    for (const o of e.onglets) {
      for (const p of o.prefixes) {
        // Le préfixe le plus long l'emporte.
        if (correspond(propre, p) && (!meilleur || p.length > meilleur.longueur)) {
          meilleur = { espace: e.id, onglet: o.id, longueur: p.length };
        }
      }
    }
  }
  return meilleur ? { espace: meilleur.espace, onglet: meilleur.onglet } : null;
}

export function ongletsVisibles(espace: Espace, estProprietaire: boolean): Onglet[] {
  return espace.onglets.filter((o) => !o.proprietaire || estProprietaire);
}
