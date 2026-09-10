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
 * Liste volontairement partielle : elle couvre les pays présents en base plus les
 * marchés voisins. Ajouter un pays est une modification de donnée, sans risque.
 */
const ZONES_PAR_PAYS: Record<string, string[]> = {
  // Europe
  FR: ["Europe/Paris"], BE: ["Europe/Brussels"], CH: ["Europe/Zurich"],
  DE: ["Europe/Berlin"], IT: ["Europe/Rome"], NL: ["Europe/Amsterdam"],
  GB: ["Europe/London"], IE: ["Europe/Dublin"], PT: ["Europe/Lisbon", "Atlantic/Azores"],
  ES: ["Europe/Madrid", "Atlantic/Canary"], LU: ["Europe/Luxembourg"],
  SE: ["Europe/Stockholm"], NO: ["Europe/Oslo"], DK: ["Europe/Copenhagen"],
  PL: ["Europe/Warsaw"], AT: ["Europe/Vienna"], GR: ["Europe/Athens"],
  // Amériques
  US: ["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
       "America/Anchorage", "Pacific/Honolulu"],
  CA: ["America/St_Johns", "America/Halifax", "America/Toronto", "America/Winnipeg",
       "America/Edmonton", "America/Vancouver"],
  MX: ["America/Mexico_City", "America/Tijuana"],
  BR: ["America/Sao_Paulo", "America/Manaus", "America/Rio_Branco"],
  AR: ["America/Argentina/Buenos_Aires"], CL: ["America/Santiago", "Pacific/Easter"],
  // Afrique / Moyen-Orient
  EG: ["Africa/Cairo"], MA: ["Africa/Casablanca"], TN: ["Africa/Tunis"],
  DZ: ["Africa/Algiers"], SN: ["Africa/Dakar"], CI: ["Africa/Abidjan"],
  ZA: ["Africa/Johannesburg"], MG: ["Indian/Antananarivo"], MU: ["Indian/Mauritius"],
  AE: ["Asia/Dubai"], KW: ["Asia/Kuwait"], SA: ["Asia/Riyadh"], QA: ["Asia/Qatar"],
  IL: ["Asia/Jerusalem"], TR: ["Europe/Istanbul"], LB: ["Asia/Beirut"],
  // Asie / Océanie
  IN: ["Asia/Kolkata"], HK: ["Asia/Hong_Kong"], SG: ["Asia/Singapore"],
  JP: ["Asia/Tokyo"], KR: ["Asia/Seoul"], CN: ["Asia/Shanghai"],
  TH: ["Asia/Bangkok"], VN: ["Asia/Ho_Chi_Minh"], ID: ["Asia/Jakarta", "Asia/Makassar", "Asia/Jayapura"],
  AU: ["Australia/Perth", "Australia/Adelaide", "Australia/Brisbane", "Australia/Sydney"],
  NZ: ["Pacific/Auckland"],
};

export function zonesForCountry(countryCode: string): string[] | null {
  if (!countryCode) return null;
  return ZONES_PAR_PAYS[countryCode.trim().toUpperCase()] ?? null;
}
