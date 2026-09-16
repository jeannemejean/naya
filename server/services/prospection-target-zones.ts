/**
 * Pays (ISO 3166-1 alpha-2) → fuseaux IANA qu'il couvre.
 *
 * DONNÉE, pas logique. Un pays multi-fuseaux liste TOUS ses fuseaux : l'appelant
 * en prend l'intersection plutôt que de deviner lequel s'applique. La ville n'est
 * volontairement pas utilisée — l'intersection est toujours valable et n'exige
 * aucune table de villes à maintenir.
 *
 * `null` (pays absent) ≠ tableau vide : absent veut dire « on ne sait pas », et
 * l'appelant doit REFUSER, pas se replier sur le fuseau de l'utilisatrice.
 *
 * ⚠️ Un pays PRÉSENT mais incomplet est pire qu'un pays absent : il produit une
 * fenêtre d'heures ouvrées silencieusement fausse (intersection trop étroite),
 * alors qu'un pays absent produit `null` et un refus sûr. En conséquence,
 * chaque pays listé ici doit être EXHAUSTIF — tous les fuseaux que la base IANA
 * (`/usr/share/zoneinfo/zone.tab`, faisant autorité) rattache à ce pays.
 * C'est `prospection-target-zones.test.ts` qui garantit cette exhaustivité
 * (comparaison automatique avec zone.tab) : ne JAMAIS ajouter un pays « à la
 * main » sans faire tourner ce test, ni s'y fier pour une complétion par
 * mémoire — c'est précisément ce qui a produit des tables incomplètes pour le
 * Brésil et le Mexique par le passé.
 *
 * Liste volontairement partielle en pays : elle couvre les pays présents en base
 * plus des marchés voisins, mais chaque pays présent est exhaustif en fuseaux.
 */
const ZONES_PAR_PAYS: Record<string, string[]> = {
  // Europe
  FR: ["Europe/Paris"], BE: ["Europe/Brussels"], CH: ["Europe/Zurich"],
  DE: ["Europe/Berlin", "Europe/Busingen"], IT: ["Europe/Rome"], NL: ["Europe/Amsterdam"],
  GB: ["Europe/London"], IE: ["Europe/Dublin"], PT: ["Europe/Lisbon", "Atlantic/Azores", "Atlantic/Madeira"],
  ES: ["Europe/Madrid", "Atlantic/Canary", "Africa/Ceuta"], LU: ["Europe/Luxembourg"],
  SE: ["Europe/Stockholm"], NO: ["Europe/Oslo"], DK: ["Europe/Copenhagen"],
  PL: ["Europe/Warsaw"], AT: ["Europe/Vienna"], GR: ["Europe/Athens"],
  // Amériques
  US: ["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
       "America/Anchorage", "Pacific/Honolulu", "America/Adak", "America/Boise",
       "America/Detroit", "America/Indiana/Indianapolis", "America/Indiana/Knox",
       "America/Indiana/Marengo", "America/Indiana/Petersburg", "America/Indiana/Tell_City",
       "America/Indiana/Vevay", "America/Indiana/Vincennes", "America/Indiana/Winamac",
       "America/Juneau", "America/Kentucky/Louisville", "America/Kentucky/Monticello",
       "America/Menominee", "America/Metlakatla", "America/Nome",
       "America/North_Dakota/Beulah", "America/North_Dakota/Center",
       "America/North_Dakota/New_Salem", "America/Phoenix", "America/Sitka",
       "America/Yakutat"],
  CA: ["America/St_Johns", "America/Halifax", "America/Toronto", "America/Winnipeg",
       "America/Edmonton", "America/Vancouver", "America/Atikokan", "America/Blanc-Sablon",
       "America/Cambridge_Bay", "America/Creston", "America/Dawson", "America/Dawson_Creek",
       "America/Fort_Nelson", "America/Glace_Bay", "America/Goose_Bay", "America/Inuvik",
       "America/Iqaluit", "America/Moncton", "America/Rankin_Inlet", "America/Regina",
       "America/Resolute", "America/Swift_Current", "America/Whitehorse"],
  MX: ["America/Mexico_City", "America/Tijuana", "America/Bahia_Banderas", "America/Cancun",
       "America/Chihuahua", "America/Ciudad_Juarez", "America/Hermosillo", "America/Matamoros",
       "America/Mazatlan", "America/Merida", "America/Monterrey", "America/Ojinaga"],
  BR: ["America/Sao_Paulo", "America/Manaus", "America/Rio_Branco", "America/Araguaina",
       "America/Bahia", "America/Belem", "America/Boa_Vista", "America/Campo_Grande",
       "America/Cuiaba", "America/Eirunepe", "America/Fortaleza", "America/Maceio",
       "America/Noronha", "America/Porto_Velho", "America/Recife", "America/Santarem"],
  AR: ["America/Argentina/Buenos_Aires", "America/Argentina/Catamarca",
       "America/Argentina/Cordoba", "America/Argentina/Jujuy", "America/Argentina/La_Rioja",
       "America/Argentina/Mendoza", "America/Argentina/Rio_Gallegos", "America/Argentina/Salta",
       "America/Argentina/San_Juan", "America/Argentina/San_Luis", "America/Argentina/Tucuman",
       "America/Argentina/Ushuaia"],
  CL: ["America/Santiago", "Pacific/Easter", "America/Coyhaique", "America/Punta_Arenas"],
  // Afrique / Moyen-Orient
  EG: ["Africa/Cairo"], MA: ["Africa/Casablanca"], TN: ["Africa/Tunis"],
  DZ: ["Africa/Algiers"], SN: ["Africa/Dakar"], CI: ["Africa/Abidjan"],
  ZA: ["Africa/Johannesburg"], MG: ["Indian/Antananarivo"], MU: ["Indian/Mauritius"],
  AE: ["Asia/Dubai"], KW: ["Asia/Kuwait"], SA: ["Asia/Riyadh"], QA: ["Asia/Qatar"],
  IL: ["Asia/Jerusalem"], TR: ["Europe/Istanbul"], LB: ["Asia/Beirut"],
  // Asie / Océanie
  IN: ["Asia/Kolkata"], HK: ["Asia/Hong_Kong"], SG: ["Asia/Singapore"],
  JP: ["Asia/Tokyo"], KR: ["Asia/Seoul"], CN: ["Asia/Shanghai", "Asia/Urumqi"],
  TH: ["Asia/Bangkok"], VN: ["Asia/Ho_Chi_Minh"],
  ID: ["Asia/Jakarta", "Asia/Makassar", "Asia/Jayapura", "Asia/Pontianak"],
  AU: ["Australia/Perth", "Australia/Adelaide", "Australia/Brisbane", "Australia/Sydney",
       "Antarctica/Macquarie", "Australia/Broken_Hill", "Australia/Darwin", "Australia/Eucla",
       "Australia/Hobart", "Australia/Lindeman", "Australia/Lord_Howe", "Australia/Melbourne"],
  NZ: ["Pacific/Auckland", "Pacific/Chatham"],
};

export function zonesForCountry(countryCode: string): string[] | null {
  if (!countryCode) return null;
  return ZONES_PAR_PAYS[countryCode.trim().toUpperCase()] ?? null;
}

/**
 * Codes pays déclarés dans la table — exposé uniquement pour permettre au test
 * d'exhaustivité d'itérer sur chaque pays et de le comparer à zone.tab. Ne fait
 * pas partie de l'interface produit (`zonesForCountry` seule est consommée en
 * aval).
 */
export function knownCountryCodes(): string[] {
  return Object.keys(ZONES_PAR_PAYS);
}
