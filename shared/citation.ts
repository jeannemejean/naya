/**
 * Texte NOUVEAU d'un message reçu : sans l'historique cité (« Le jeu. 5 nov. 2026 à 19:10,
 * X <x> a écrit : », « On … wrote: », lignes « > », blocs Gmail / Outlook / Apple Mail).
 *
 * Partagé par le serveur (tri : une citation de notre pied « Se désinscrire » ne doit jamais
 * désinscrire le prospect ; extrait de la liste) et le client (bulle du fil). Pure, sans IA.
 * Ne perd jamais rien : l'original reste stocké et affichable, ceci n'est qu'une lecture.
 */

/** Lignes qui ouvrent une citation (FR / EN, Gmail, Outlook, Apple Mail). */
const DEBUT_CITATION = [
  /^\s*>/,
  /^\s*le .{3,120}a [ée]crit\s*:\s*$/i,
  /^\s*on .{3,160}wrote\s*:\s*$/i,
  /^\s*-{2,}\s*(original message|message d'origine|forwarded message|message transféré)/i,
  /^\s*_{8,}\s*$/, // séparateur Outlook avant « De : »
  /^\s*(de|from)\s*:\s.+/i,
  /^\s*se d[ée]sinscrire\s*:/i,
];

/** Une attribution porte toujours une date ou une heure (jamais « Le client a écrit : »). */
const MARQUE_DATE = /\b\d{4}\b|\b\d{1,2}[:h]\d{2}\b|\b\d{1,2}\/\d{1,2}\b/i;
const FIN_ATTRIBUTION = /(?:\sa [ée]crit|\bwrote)\s*:/gi;
const DEBUT_ATTRIBUTION = /(?:^|\s)(le|on)\s/gi;
const LONGUEUR_MAX_ATTRIBUTION = 320;

/**
 * Attribution coupée en plein texte ou sur plusieurs lignes (Gmail replie souvent
 * « … <x@y.fr> » à la ligne suivante, et certains corps n'ont plus de retour à la ligne) :
 * index de son début, ou -1. Parmi les « Le / On » qui précèdent « a écrit : », on garde le
 * plus proche qui contient encore une date (« Marie Le Gall <x> a écrit » ne coupe pas au
 * milieu du nom ; « Le projet me plaît. Le jeu. 5 nov. … » garde la première phrase).
 */
function debutAttribution(texte: string): number {
  for (const fin of texte.matchAll(FIN_ATTRIBUTION)) {
    const finIndex = fin.index! + fin[0].length;
    let retenu = -1;
    for (const m of texte.matchAll(DEBUT_ATTRIBUTION)) {
      const debut = m.index! + (m[0].length - m[1].length - 1);
      if (debut >= fin.index!) break;
      if (finIndex - debut > LONGUEUR_MAX_ATTRIBUTION) continue;
      if (MARQUE_DATE.test(texte.slice(debut, finIndex))) retenu = debut;
    }
    if (retenu !== -1) return retenu;
  }
  return -1;
}

/** Le texte écrit par l'expéditeur, sans la citation du message auquel il répond. */
export function texteNouveau(body: string | null | undefined): string {
  const lignes = (body || "").split(/\r?\n/);
  const fin = lignes.findIndex((l) => DEBUT_CITATION.some((re) => re.test(l)));
  const garde = (fin === -1 ? lignes : lignes.slice(0, fin)).join("\n");
  const attribution = debutAttribution(garde);
  return (attribution === -1 ? garde : garde.slice(0, attribution)).trim();
}

/** Vrai quand le message contient une citation retirée par `texteNouveau`. */
export function aUneCitation(body: string | null | undefined): boolean {
  const nouveau = texteNouveau(body);
  return nouveau !== "" && nouveau !== (body || "").trim();
}

/**
 * Texte à montrer : le nouveau texte, ou le message entier si tout est citation (un transfert
 * pur) — jamais une bulle vide.
 */
export function texteAffiche(body: string | null | undefined): string {
  return texteNouveau(body) || (body || "").trim();
}

/** Aperçu d'une ligne de liste : texte nouveau, espaces repliés, coupé à `max` caractères. */
export function extraitDe(body: string | null | undefined, max = 160): string | null {
  const t = texteAffiche(body).replace(/\s+/g, " ").trim();
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}
