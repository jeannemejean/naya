// Listes affichées par le calendrier de contenu pour `platform` et `contentType`.
// Isolées de `content-calendar.tsx` pour rester testables en environnement `node` (le
// composant tire react-big-calendar, react-query, etc., côté navigateur — ce dépôt n'a
// pas jsdom) — même motif que `./content-calendar-limit.ts`.
//
// `value` est typé contre `PlateformeConnue`/`TypeContenuConnu` (@shared/content-platforms) :
// une entrée qui ne figure pas dans ces unions est une erreur de compilation. Le serveur
// consulte EXACTEMENT ces mêmes unions (`server/services/content-import/parse.ts`,
// `comblerChamps`) avant d'écrire une plateforme ou un type de contenu importés — les deux
// listes ne peuvent donc jamais diverger par un simple oubli de mise à jour d'un seul
// côté, pour les valeurs qui existent ici. Le test de complétude
// (`content-calendar-platforms.test.ts`) couvre le sens inverse : une plateforme ajoutée
// à `@shared/content-platforms` sans entrée correspondante ICI ne casserait aucun
// typage (un tableau plus court reste assignable), c'est le test qui le détecte.
import type { PlateformeConnue, TypeContenuConnu } from '@shared/content-platforms';

export const PLATFORMS: Array<{ value: PlateformeConnue; label: string; color: string; dotColor: string; charLimit: number }> = [
  { value: 'instagram', label: 'Instagram', color: 'bg-gradient-to-r from-purple-500 to-pink-500', dotColor: '#a855f7', charLimit: 2200 },
  { value: 'linkedin', label: 'LinkedIn', color: 'bg-naya-salvia', dotColor: '#2563eb', charLimit: 3000 },
  { value: 'twitter', label: 'Twitter', color: 'bg-naya-olive-70', dotColor: '#2B2D1C', charLimit: 280 },
  { value: 'facebook', label: 'Facebook', color: 'bg-naya-salvia', dotColor: '#1d4ed8', charLimit: 63206 },
  { value: 'email', label: 'Email', color: 'bg-naya-olive', dotColor: '#16a34a', charLimit: 10000 },
  { value: 'blog', label: 'Blog', color: 'bg-naya-olive-70', dotColor: '#374151', charLimit: 50000 },
];

export const CONTENT_TYPES: Array<{ value: TypeContenuConnu; label: string }> = [
  { value: 'post', label: 'Social Post' },
  { value: 'story', label: 'Story' },
  { value: 'email', label: 'Email' },
  { value: 'article', label: 'Article' },
];
