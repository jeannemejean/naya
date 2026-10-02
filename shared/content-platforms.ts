// Plateformes et types de contenu reconnus par le calendrier éditorial — module PUR,
// partagé client ↔ serveur, pour qu'il n'existe jamais deux réponses différentes à
// « quelles valeurs l'interface sait-elle afficher ? ».
//
// Le client (`client/src/pages/content-calendar.tsx`, tableaux PLATFORMS / CONTENT_TYPES)
// type ses entrées contre ces unions : une valeur de `content.platform` ou
// `content.contentType` qui n'y figure pas n'a AUCUNE entrée dans l'interface, et
// `getPlatformInfo` (content-calendar.tsx) replie silencieusement sur PLATFORMS[0]
// (Instagram) faute de correspondance. Un post TikTok écrit tel quel s'afficherait
// donc « Instagram », avec le point de couleur et la limite de caractères d'Instagram
// — rien ne dirait que la plateforme n'est pas reconnue.
//
// Le serveur (`server/services/content-import/parse.ts`, `comblerChamps`) valide contre
// ces mêmes listes AVANT d'écrire : une valeur rendue par le modèle d'extraction mais
// absente d'ici (le prompt d'extraction propose "tiktok", "youtube", "newsletter",
// "carousel", "reel", "video" — que l'interface ne connaît pas tous) est traitée comme
// une absence et comblée par la valeur par défaut, DÉCLARÉE dans `deducedFields`.
export const PLATEFORMES_CONNUES = ["instagram", "linkedin", "twitter", "facebook", "email", "blog"] as const;
export type PlateformeConnue = (typeof PLATEFORMES_CONNUES)[number];

export const TYPES_CONTENU_CONNUS = ["post", "story", "email", "article"] as const;
export type TypeContenuConnu = (typeof TYPES_CONTENU_CONNUS)[number];

export function estPlateformeConnue(v: string): v is PlateformeConnue {
  return (PLATEFORMES_CONNUES as readonly string[]).includes(v);
}

export function estTypeContenuConnu(v: string): v is TypeContenuConnu {
  return (TYPES_CONTENU_CONNUS as readonly string[]).includes(v);
}
