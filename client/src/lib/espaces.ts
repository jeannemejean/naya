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
    // La vue horaire (/planning) s'ouvre depuis la Semaine : l'onglet reste allumé.
    onglet("aujourdhui", "semaine", "/semaine", { prefixes: ["/semaine", "/planning"] }),
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

// Page projet (/projects/<id>) : ses onglets fondations, veille et mesure (?onglet=…, voir
// pages/project/onglets.ts) sont rangés dans l'espace qui leur correspond. Les anciennes
// adresses /fondations, /veille, /mesure y redirigent : l'onglet de navigation reste allumé.
const ONGLETS_PAGE_PROJET: Record<string, { espace: EspaceId; onglet: string }> = {
  fondations: { espace: "projets", onglet: "fondations" },
  veille: { espace: "veille", onglet: "tendances" },
  mesure: { espace: "chiffres", onglet: "mesure" },
};

export function estPageProjet(chemin: string): boolean {
  return /^\/projects\/[^/?#]+$/.test(chemin.split(/[?#]/)[0]);
}

/** `chemin` peut porter sa requête (`/projects/4?onglet=veille`) : elle ne compte que sur une page projet. */
export function espaceDuChemin(chemin: string): { espace: EspaceId; onglet: string } | null {
  const propre = chemin.split(/[?#]/)[0];
  if (estPageProjet(propre)) {
    const requete = chemin.split("#")[0].split("?")[1] ?? "";
    const o = new URLSearchParams(requete).get("onglet");
    // hasOwn : « ?onglet=toString » ne doit pas tomber sur le prototype.
    return o && Object.hasOwn(ONGLETS_PAGE_PROJET, o) ? ONGLETS_PAGE_PROJET[o] : { espace: "projets", onglet: "projets" };
  }
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

// Anciennes adresses qui redirigent vers un onglet du projet actif (pages/project/onglets.ts),
// ou vers /projects s'il n'y en a pas.
const REDIRECTIONS_PROJET = new Set(["/fondations", "/veille", "/mesure"]);

/**
 * Lien du bouton d'un espace. Sans projet actif, une cible qui redirige vers la page projet
 * ferait atterrir dans Projets : on prend alors le premier onglet visible qui n'en est pas une.
 * (Les onglets, eux, gardent leur adresse.)
 */
export function hrefEspace(espace: Espace, projetActif: number | null, estProprietaire = false): string {
  if (projetActif != null || !REDIRECTIONS_PROJET.has(espace.href)) return espace.href;
  const repli = ongletsVisibles(espace, estProprietaire).find((o) => !REDIRECTIONS_PROJET.has(o.href));
  return repli?.href ?? espace.href;
}
