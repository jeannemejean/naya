/**
 * Passe un compte en role='owner' (accès total sans abonnement).
 *
 *   NODE_ENV=development tsx server/scripts/set-owner-role.ts <email>
 *   railway run npx tsx server/scripts/set-owner-role.ts <email>   (en prod)
 */

import "dotenv/config";
import { storage } from "../storage";

const email = process.argv[2];
if (!email) {
  console.error("Usage: tsx server/scripts/set-owner-role.ts <email>");
  process.exit(1);
}

(async () => {
  const ok = await storage.setUserRoleByEmail(email, "owner");
  console.log(ok ? `✓ ${email} est maintenant owner` : `✗ aucun user avec l'email ${email}`);
  process.exit(0);
})();
