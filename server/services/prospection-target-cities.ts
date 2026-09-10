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
 */
const VILLES_PAR_PAYS: Record<string, Record<string, string>> = {
  US: {
    "new york": "America/New_York",
    "brooklyn": "America/New_York",
    "boston": "America/New_York",
    "philadelphia": "America/New_York",
    "washington": "America/New_York",
    "atlanta": "America/New_York",
    "miami": "America/New_York",
    "orlando": "America/New_York",
    "detroit": "America/Detroit",
    "charlotte": "America/New_York",
    "raleigh": "America/New_York",

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
    "portland": "America/Los_Angeles",
    "sacramento": "America/Los_Angeles",
    "las vegas": "America/Los_Angeles",
    "oakland": "America/Los_Angeles",

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
 * Normalise un nom de ville pour la recherche : minuscule, accents retirés,
 * suffixe d'État/région coupé sur la première virgule (« New York, NY »,
 * « San Francisco, California »), espaces de bord retirés.
 */
function normaliserVille(ville: string): string {
  const avantVirgule = ville.split(",")[0];
  return avantVirgule
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/**
 * Résout une ville de profil enrichi vers son fuseau IANA — uniquement pour les
 * pays multi-fuseaux couverts ci-dessus. `null` = ville inconnue, absente, ou
 * pays hors périmètre : l'appelant retombe alors sur l'intersection du pays via
 * `zonesForCountry`, qui reste sûre. Ne devine jamais.
 */
export function zoneForCity(countryCode: string, city: string | null): string | null {
  if (!countryCode) return null;
  if (!city) return null;

  const villeNormalisee = normaliserVille(city);
  if (!villeNormalisee) return null;

  const table = VILLES_PAR_PAYS[countryCode.trim().toUpperCase()];
  if (!table) return null;

  return table[villeNormalisee] ?? null;
}
