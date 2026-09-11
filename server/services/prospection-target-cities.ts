/**
 * Ville (profil enrichi Bright Data) → fuseau IANA, pour les pays MULTI-FUSEAUX
 * seulement. Un pays mono-fuseau n'a rien à gagner de la ville : son intersection
 * (`zonesForCountry`) est déjà un fuseau unique.
 *
 * Pourquoi cette table existe : `zonesForCountry("US")` et `zonesForCountry("CA")`
 * sont exhaustifs (29 et 23 fuseaux) et leur intersection avec les heures ouvrées
 * de l'utilisatrice est vide — États-Unis et Canada deviennent injoignables. La ville,
 * quand elle est lisible, permet de retomber sur UN SEUL fuseau plutôt que sur
 * l'intersection totale du pays.
 *
 * ⚠️ Cette table est nécessairement PARTIELLE — elle ne couvre que les grandes
 * villes des pays multi-fuseaux présents en base (US, CA). Une ville absente de
 * la table n'est PAS une erreur : `zoneForCity` rend `null`, et l'appelant
 * retombe sur l'intersection du pays, qui reste sûre. Ne JAMAIS deviner un
 * fuseau à partir d'un nom de ville approximatif ou d'une heuristique
 * géographique — seules les entrées explicitement listées ici sont résolues.
 *
 * Chaque fuseau déclaré ci-dessous appartient réellement au pays sous lequel il
 * est listé (vérifié par `prospection-target-cities.test.ts` contre
 * `zonesForCountry`) — un fuseau IANA valide mais mal rattaché serait pire
 * qu'une ville non résolue : il enverrait un message hors des heures ouvrées
 * réelles du prospect.
 *
 * ⚠️ HOMONYMES ENTRE ÉTATS. Un même nom de ville existe parfois dans plusieurs
 * États avec des fuseaux DIFFÉRENTS (Portland, OR = Pacifique ≠ Portland, ME =
 * Est ; Washington, DC = Est ≠ Washington, IN = Central). Fusionner ces
 * homonymes sous une seule clé revient à deviner un fuseau pour la moitié des
 * cas — précisément ce que cette table interdit. Une entrée ambiguë est donc
 * un `Record<codeÉtat2Lettres, fuseau>` plutôt qu'un `string` : la forme SANS
 * État reste `null` (on ne sait pas laquelle), et seule la forme avec État
 * discriminant résout un fuseau. Ne résous JAMAIS un homonyme en choisissant
 * la ville la plus peuplée — ce raisonnement « c'est probablement celle-là »
 * est exactement ce qu'on cherche à éliminer.
 */
type EntreeVille = string | Record<string, string>;

const VILLES_PAR_PAYS: Record<string, Record<string, EntreeVille>> = {
  US: {
    "new york": "America/New_York",
    "brooklyn": "America/New_York",
    "boston": "America/New_York",
    "philadelphia": "America/New_York",
    "atlanta": "America/New_York",
    "miami": "America/New_York",
    "orlando": "America/New_York",
    "detroit": "America/Detroit",
    "charlotte": "America/New_York",
    "raleigh": "America/New_York",
    // Washington, DC (siège du pouvoir fédéral) vs Washington, Indiana
    // (comté de Daviess, fuseau Central) : deux villes, deux fuseaux.
    "washington": { dc: "America/New_York", in: "America/Chicago" },

    "chicago": "America/Chicago",
    "houston": "America/Chicago",
    "dallas": "America/Chicago",
    "austin": "America/Chicago",
    "san antonio": "America/Chicago",
    "new orleans": "America/Chicago",
    "minneapolis": "America/Chicago",
    "kansas city": "America/Chicago",
    "nashville": "America/Chicago",
    "memphis": "America/Chicago",
    "milwaukee": "America/Chicago",

    "denver": "America/Denver",
    "phoenix": "America/Phoenix",
    "salt lake city": "America/Denver",
    "albuquerque": "America/Denver",
    "boise": "America/Boise",

    "los angeles": "America/Los_Angeles",
    "san francisco": "America/Los_Angeles",
    "san diego": "America/Los_Angeles",
    "san jose": "America/Los_Angeles",
    "seattle": "America/Los_Angeles",
    "sacramento": "America/Los_Angeles",
    "las vegas": "America/Los_Angeles",
    "oakland": "America/Los_Angeles",
    // Portland, Oregon (Pacifique) vs Portland, Maine (Est) : homonymes
    // classiques des profils LinkedIn américains — jamais fusionnés.
    "portland": { or: "America/Los_Angeles", me: "America/New_York" },

    "anchorage": "America/Anchorage",
    "honolulu": "Pacific/Honolulu",
  },
  CA: {
    "toronto": "America/Toronto",
    "ottawa": "America/Toronto",
    "montreal": "America/Toronto",
    "quebec": "America/Toronto",
    "hamilton": "America/Toronto",
    "london": "America/Toronto",

    "winnipeg": "America/Winnipeg",
    "regina": "America/Regina",
    "saskatoon": "America/Regina",

    "edmonton": "America/Edmonton",
    "calgary": "America/Edmonton",

    "vancouver": "America/Vancouver",
    "victoria": "America/Vancouver",
    "surrey": "America/Vancouver",

    "halifax": "America/Halifax",
    "moncton": "America/Moncton",

    "st john's": "America/St_Johns",
    "st johns": "America/St_Johns",

    "whitehorse": "America/Whitehorse",
    // Yellowknife (Territoires du Nord-Ouest) n'a pas de zone IANA propre :
    // elle observe l'heure des Rocheuses via America/Edmonton.
    "yellowknife": "America/Edmonton",
    "iqaluit": "America/Iqaluit",
  },
};

/**
 * Formes d'État/région reconnues en toutes lettres → code postal 2 lettres.
 * Ne couvre que ce dont les entrées ambiguës ci-dessus ont besoin pour
 * désambiguïser — pas une liste USPS complète. Un code déjà à 2 lettres
 * (« OR », « ME », « DC », « IN ») est accepté tel quel sans passer par
 * cette table (voir `normaliserEtat`).
 */
const NOM_ETAT_VERS_CODE: Record<string, string> = {
  oregon: "or",
  maine: "me",
  indiana: "in",
  "district of columbia": "dc",
  "washington dc": "dc",
};

/**
 * Normalise un texte libre : minuscule, accents retirés, points abrégés
 * retirés (« St. John's » → « st john's »), espaces de bord retirés, espaces
 * internes réduits à un seul.
 */
function normaliserTexte(texte: string): string {
  return texte
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\./g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/**
 * Coupe un nom de ville brut sur sa première virgule pour isoler le
 * discriminant d'État/région (« New York, NY » → ville "new york", état
 * "ny" ; « San Francisco, California » → ville "san francisco", état
 * "california"). Les deux parties sont normalisées indépendamment.
 */
function decouperVilleEtat(villeBrute: string): { ville: string; etat: string | null } {
  const indexVirgule = villeBrute.indexOf(",");
  if (indexVirgule === -1) {
    return { ville: normaliserTexte(villeBrute), etat: null };
  }
  const ville = normaliserTexte(villeBrute.slice(0, indexVirgule));
  const etatBrut = normaliserTexte(villeBrute.slice(indexVirgule + 1));
  return { ville, etat: etatBrut || null };
}

/**
 * Convertit un discriminant d'État déjà normalisé (minuscule, sans accent)
 * en code 2 lettres, pour l'utiliser comme clé dans une entrée ambiguë.
 * Accepte un code déjà à 2 lettres tel quel, sinon cherche la forme longue
 * dans `NOM_ETAT_VERS_CODE`. Rend `null` si l'État est inconnu — l'appelant
 * doit alors rendre `null` plutôt que deviner.
 */
function normaliserEtat(etatNormalise: string): string | null {
  if (etatNormalise.length === 2) return etatNormalise;
  return NOM_ETAT_VERS_CODE[etatNormalise] ?? null;
}

/**
 * Résout une ville de profil enrichi vers son fuseau IANA — uniquement pour
 * les pays multi-fuseaux couverts ci-dessus. `null` = ville inconnue,
 * absente, pays hors périmètre, OU nom ambigu (plusieurs villes homonymes
 * dans des fuseaux différents) sans discriminant d'État reconnu. L'appelant
 * retombe alors sur l'intersection du pays via `zonesForCountry`, qui reste
 * sûre. Ne devine jamais — ni le pays le plus probable, ni la ville la plus
 * peuplée.
 */
export function zoneForCity(countryCode: string, city: string | null): string | null {
  if (!countryCode) return null;
  if (!city) return null;

  const table = VILLES_PAR_PAYS[countryCode.trim().toUpperCase()];
  if (!table) return null;

  const { ville, etat } = decouperVilleEtat(city);
  if (!ville) return null;

  const entree = table[ville];
  if (entree === undefined) return null;

  if (typeof entree === "string") {
    // Non ambigu : un éventuel suffixe d'État est ignoré, il ne change rien.
    return entree;
  }

  // Ambigu : un discriminant d'État reconnu est obligatoire.
  if (!etat) return null;
  const code = normaliserEtat(etat);
  if (!code) return null;
  return entree[code] ?? null;
}

/**
 * Expose la table brute pour les besoins du test de désambiguïsation
 * (`prospection-target-cities.test.ts`), qui parcourt toutes les entrées
 * ambiguës pour vérifier que chacune retombe sur `null` sans État et sur le
 * bon fuseau avec État. Ne fait pas partie de l'interface produit —
 * `zoneForCity` seule est consommée en aval.
 */
export function villesPourTest(): Record<string, Record<string, EntreeVille>> {
  return VILLES_PAR_PAYS;
}
