// Base factice pour les tests du fil : une vraie instance drizzle (les requêtes se construisent
// et `toSQL()` marche) sur un pool qui refuse toute requête. Aucun test ne touche une vraie base,
// même avec le .env chargé. Usage :
//   vi.mock("../../db", async () => await import("./__fixtures__/db-factice"));
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";

const refuser = async () => { throw new Error("base factice : aucune requête en test"); };
export const pool: any = { query: refuser, connect: refuser, on: () => {}, end: async () => {} };
export const db = drizzle(pool, { schema });
