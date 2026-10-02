// Trois constantes existent en DEUX exemplaires, serveur et client (ou deux fichiers
// serveur), sans qu'aucun mécanisme ne les lie structurellement — seulement un
// commentaire de part et d'autre qui promet qu'elles s'accordent. `vitest.config.ts`
// ramasse `server/**`, `shared/**` ET `client/**` dans la MÊME exécution : ce fichier
// unique importe les deux exemplaires de chaque paire et affirme leur égalité, la seule
// protection réelle contre une divergence silencieuse.
//
// La paire LIMITE_CONTENUS est la DANGEREUSE des trois : la page demande
// `limit=LIMITE_CONTENUS_PAGE` (200) INCONDITIONNELLEMENT à chaque chargement du
// calendrier (`client/src/pages/content-calendar.tsx`). Si `LIMITE_CONTENUS_MAX` baisse
// côté serveur sans que personne ne touche au client, `GET /api/content` rend 400
// ("limit invalide") à chaque appel, et le calendrier entier cesse d'afficher quoi que
// ce soit — sans qu'aucun test de `routes.ts` (qui ne connaît que des mocks de base) ne
// le voie. Les deux autres paires sont moins dangereuses (une longueur de titre tronquée
// différemment, une limite de collage légèrement désaccordée), mais la méthode de
// protection est la même pour les trois : une égalité affirmée ici.
import { describe, it, expect } from "vitest";

import { MAX_CARACTERES as MAX_CARACTERES_SERVEUR, LONGUEUR_MAX_TITRE as LONGUEUR_MAX_TITRE_PARSE } from "./services/content-import/parse";
import { LONGUEUR_MAX_TITRE as LONGUEUR_MAX_TITRE_COLLISION } from "./services/brand-links/collision";
import { LIMITE_CONTENUS_MAX } from "./services/content-limit";

import { MAX_CARACTERES as MAX_CARACTERES_CLIENT } from "../client/src/components/content/import-calendrier-limite";
import { LIMITE_CONTENUS_PAGE } from "../client/src/pages/content-calendar-limit";

describe("constantes dupliquées sans lien structurel — une seule divergence doit faire tomber ces tests", () => {
  it("MAX_CARACTERES (limite du texte collé à l'import) : content-import/parse.ts et import-calendrier-limite.ts (client) s'accordent", () => {
    expect(MAX_CARACTERES_CLIENT).toBe(MAX_CARACTERES_SERVEUR);
  });

  it("LONGUEUR_MAX_TITRE : content-import/parse.ts et brand-links/collision.ts s'accordent", () => {
    expect(LONGUEUR_MAX_TITRE_PARSE).toBe(LONGUEUR_MAX_TITRE_COLLISION);
  });

  it("LIMITE_CONTENUS : le plafond serveur de GET /api/content (LIMITE_CONTENUS_MAX) et le `limit` demandé inconditionnellement par la page (LIMITE_CONTENUS_PAGE) s'accordent — LA paire dangereuse, voir le commentaire de tête", () => {
    expect(LIMITE_CONTENUS_PAGE).toBe(LIMITE_CONTENUS_MAX);
  });
});
