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
 * ⚠️⚠️ LE DISCRIMINANT D'ÉTAT EST OBLIGATOIRE POUR TOUTE ENTRÉE, SANS
 * EXCEPTION — CETTE TABLE EST VOLONTAIREMENT INCAPABLE DE RÉSOUDRE UNE VILLE
 * SEULE. Un nom de ville en apparence unique (« Denver », « Miami », « Dallas »,
 * « Nashville », « Philadelphia », « Las Vegas »…) a presque toujours un
 * homonyme dans un AUTRE État, dans un AUTRE fuseau : Las Vegas, NM (Montagne)
 * ≠ Las Vegas, NV (Pacifique) ; Miami, OK (Central) ≠ Miami, FL (Est) ; Denver,
 * NC (Est) ≠ Denver, CO (Montagne) ; Philadelphia, MS (Central) ≠ Philadelphia,
 * PA (Est) ; Dallas, OR (Pacifique) ≠ Dallas, TX (Central) ; Nashville, IN
 * (Est) ≠ Nashville, TN (Central). Traiter ces villes comme « non ambiguës »
 * (un `string` plutôt qu'un `Record<État, fuseau>`) a produit exactement ces
 * six collisions en production — chacune un message envoyé 3h en dehors des
 * heures réelles du prospect, sans aucun signal (le garde-fou de pays valide,
 * le fuseau appartenant bien aux États-Unis). Cataloguer les homonymes au fur
 * et à mesure qu'on les découvre ne suffit pas : il en existe des centaines.
 * La seule défense qui rend la classe entière de bug impossible est
 * structurelle : AUCUNE entrée n'est jamais un `string` nu, TOUTES exigent un
 * État. Une ville renseignée sans État rend donc `null` — y compris les
 * grandes villes archi-connues comme New York ou Chicago — et l'appelant
 * retombe sur l'intersection du pays, sûre.
 *
 * Ce choix coûte de la couverture, mesuré : sur 42 villes renseignées en
 * production, 29 portent leur État (69%), et pour les seuls leads américains
 * et canadiens (ceux qui motivent cette table), 5 sur 7. Exiger le
 * discriminant fait donc retomber deux leads sur le repli sûr — visible,
 * signalé, sans conséquence (l'intersection du pays reste correcte, juste
 * plus large). L'alternative — résoudre les villes non ambiguës en apparence
 * sans État — est une classe entière d'erreurs de 3h invisibles. Le calcul
 * n'est pas symétrique : un lead sur le repli sûr est un lead qu'on recontacte
 * avec une fenêtre plus large ; un lead réveillé à 3h du matin ne se
 * recontacte plus.
 *
 * Un nom de ville n'a donc JAMAIS besoin d'être classé « ambigu » ou « pas
 * ambigu » au moment où on l'ajoute — cette classification elle-même s'est
 * révélée être le bug (elle suppose une connaissance exhaustive des homonymes
 * qu'aucun contributeur n'a). La règle est désormais uniforme et ne dépend
 * d'aucun jugement au cas par cas.
 */
type EntreeVille = Record<string, string>;

const VILLES_PAR_PAYS: Record<string, Record<string, EntreeVille>> = {
  US: {
    "new york": { ny: "America/New_York" },
    "brooklyn": { ny: "America/New_York" },
    "boston": { ma: "America/New_York" },
    "philadelphia": { pa: "America/New_York" },
    "atlanta": { ga: "America/New_York" },
    "miami": { fl: "America/New_York" },
    "orlando": { fl: "America/New_York" },
    "detroit": { mi: "America/Detroit" },
    "charlotte": { nc: "America/New_York" },
    "raleigh": { nc: "America/New_York" },
    // Washington, DC (siège du pouvoir fédéral) vs Washington, Indiana
    // (comté de Daviess, fuseau Central) : deux villes, deux fuseaux.
    "washington": { dc: "America/New_York", in: "America/Chicago" },

    "chicago": { il: "America/Chicago" },
    "houston": { tx: "America/Chicago" },
    "dallas": { tx: "America/Chicago" },
    "austin": { tx: "America/Chicago" },
    "san antonio": { tx: "America/Chicago" },
    "new orleans": { la: "America/Chicago" },
    "minneapolis": { mn: "America/Chicago" },
    "kansas city": { mo: "America/Chicago" },
    "nashville": { tn: "America/Chicago" },
    "memphis": { tn: "America/Chicago" },
    "milwaukee": { wi: "America/Chicago" },

    "denver": { co: "America/Denver" },
    "phoenix": { az: "America/Phoenix" },
    "salt lake city": { ut: "America/Denver" },
    "albuquerque": { nm: "America/Denver" },
    "boise": { id: "America/Boise" },

    "los angeles": { ca: "America/Los_Angeles" },
    "san francisco": { ca: "America/Los_Angeles" },
    "san diego": { ca: "America/Los_Angeles" },
    "san jose": { ca: "America/Los_Angeles" },
    "seattle": { wa: "America/Los_Angeles" },
    "sacramento": { ca: "America/Los_Angeles" },
    "las vegas": { nv: "America/Los_Angeles" },
    "oakland": { ca: "America/Los_Angeles" },
    // Portland, Oregon (Pacifique) vs Portland, Maine (Est) : homonymes
    // classiques des profils LinkedIn américains — jamais fusionnés.
    "portland": { or: "America/Los_Angeles", me: "America/New_York" },

    "anchorage": { ak: "America/Anchorage" },
    "honolulu": { hi: "Pacific/Honolulu" },
  },
  CA: {
    "toronto": { on: "America/Toronto" },
    "ottawa": { on: "America/Toronto" },
    "montreal": { qc: "America/Toronto" },
    "quebec": { qc: "America/Toronto" },
    "hamilton": { on: "America/Toronto" },
    "london": { on: "America/Toronto" },

    "winnipeg": { mb: "America/Winnipeg" },
    "regina": { sk: "America/Regina" },
    "saskatoon": { sk: "America/Regina" },

    "edmonton": { ab: "America/Edmonton" },
    "calgary": { ab: "America/Edmonton" },

    "vancouver": { bc: "America/Vancouver" },
    "victoria": { bc: "America/Vancouver" },
    "surrey": { bc: "America/Vancouver" },

    "halifax": { ns: "America/Halifax" },
    "moncton": { nb: "America/Moncton" },

    "st john's": { nl: "America/St_Johns" },
    "st johns": { nl: "America/St_Johns" },

    "whitehorse": { yt: "America/Whitehorse" },
    // Yellowknife (Territoires du Nord-Ouest) n'a pas de zone IANA propre :
    // elle observe l'heure des Rocheuses via America/Edmonton.
    "yellowknife": { nt: "America/Edmonton" },
    "iqaluit": { nu: "America/Iqaluit" },
  },
};

/**
 * Formes d'État/province reconnues en toutes lettres → code 2 lettres. Un
 * code déjà à 2 lettres (« NY », « TX », « ON »…) est accepté tel quel sans
 * passer par cette table (voir `normaliserEtat`). Table de référence factuelle
 * (nom ↔ abréviation USPS / provinces canadiennes) — ce n'est PAS une
 * supposition géographique ou horaire, juste un dictionnaire de noms.
 */
const NOM_ETAT_VERS_CODE: Record<string, string> = {
  // États américains + DC
  alabama: "al", alaska: "ak", arizona: "az", arkansas: "ar", california: "ca",
  colorado: "co", connecticut: "ct", delaware: "de", florida: "fl", georgia: "ga",
  hawaii: "hi", idaho: "id", illinois: "il", indiana: "in", iowa: "ia",
  kansas: "ks", kentucky: "ky", louisiana: "la", maine: "me", maryland: "md",
  massachusetts: "ma", michigan: "mi", minnesota: "mn", mississippi: "ms",
  missouri: "mo", montana: "mt", nebraska: "ne", nevada: "nv",
  "new hampshire": "nh", "new jersey": "nj", "new mexico": "nm", "new york": "ny",
  "north carolina": "nc", "north dakota": "nd", ohio: "oh", oklahoma: "ok",
  oregon: "or", pennsylvania: "pa", "rhode island": "ri", "south carolina": "sc",
  "south dakota": "sd", tennessee: "tn", texas: "tx", utah: "ut", vermont: "vt",
  virginia: "va", washington: "wa", "west virginia": "wv", wisconsin: "wi",
  wyoming: "wy", "district of columbia": "dc", "washington dc": "dc",
  // Provinces et territoires canadiens
  alberta: "ab", "british columbia": "bc", manitoba: "mb", "new brunswick": "nb",
  "newfoundland and labrador": "nl", "newfoundland": "nl",
  "northwest territories": "nt", "nova scotia": "ns", nunavut: "nu",
  ontario: "on", "prince edward island": "pe", quebec: "qc", "quebec city": "qc",
  saskatchewan: "sk", yukon: "yt",
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
 * en code 2 lettres, pour l'utiliser comme clé dans une entrée de la table.
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
 * les pays multi-fuseaux couverts ci-dessus, ET uniquement quand un
 * discriminant d'État reconnu accompagne la ville. `null` = ville inconnue,
 * absente, pays hors périmètre, État absent ou non reconnu, OU couple
 * ville/État non déclaré (homonyme dans un autre État). L'appelant retombe
 * alors sur l'intersection du pays via `zonesForCountry`, qui reste sûre. Ne
 * devine jamais — ni le pays le plus probable, ni l'État le plus probable, ni
 * la ville la plus peuplée.
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

  // Le discriminant d'État est OBLIGATOIRE pour TOUTE entrée, sans exception
  // — voir le commentaire d'en-tête sur les homonymes inter-États.
  if (!etat) return null;

  const code = normaliserEtat(etat);
  if (!code) return null;

  return entree[code] ?? null;
}

/**
 * Expose la table brute pour les besoins du test de désambiguïsation
 * (`prospection-target-cities.test.ts`), qui parcourt toutes les entrées pour
 * vérifier qu'aucune ne se résout sans discriminant d'État, et que chaque
 * couple ville/État déclaré rend le bon fuseau. Ne fait pas partie de
 * l'interface produit — `zoneForCity` seule est consommée en aval.
 */
export function villesPourTest(): Record<string, Record<string, EntreeVille>> {
  return VILLES_PAR_PAYS;
}
