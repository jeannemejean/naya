/**
 * Migration unique : chiffre les jetons sociaux existants encore stockés en clair.
 *
 * À lancer UNE FOIS par base (après avoir défini TOKEN_ENCRYPTION_KEY) :
 *   NODE_ENV=development tsx server/scripts/encrypt-existing-tokens.ts
 *
 * Idempotent : un jeton déjà chiffré (préfixe "enc:v1:") est ignoré.
 * Sûr à relancer.
 */

import "dotenv/config";
import { db } from "../db";
import { socialAccounts } from "@shared/schema";
import { eq } from "drizzle-orm";
import { isEncrypted, encryptToken, encryptNullable } from "../services/token-crypto";

async function main() {
  const rows = await db.select().from(socialAccounts);
  let migrated = 0;
  let skipped = 0;

  for (const row of rows) {
    const accessPlain = !isEncrypted(row.accessToken);
    const refreshPlain = row.refreshToken != null && !isEncrypted(row.refreshToken);

    if (!accessPlain && !refreshPlain) {
      skipped++;
      continue;
    }

    await db
      .update(socialAccounts)
      .set({
        accessToken: accessPlain ? encryptToken(row.accessToken) : row.accessToken,
        refreshToken: refreshPlain ? encryptNullable(row.refreshToken) : row.refreshToken,
      })
      .where(eq(socialAccounts.id, row.id));

    migrated++;
    console.log(`  ✓ compte #${row.id} (${row.platform}) chiffré`);
  }

  console.log(`\nTerminé — ${migrated} compte(s) chiffré(s), ${skipped} déjà chiffré(s)/vide(s).`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Échec de la migration :", err);
  process.exit(1);
});
