/**
 * Chiffrement des jetons d'accès au repos (AES-256-GCM).
 *
 * Les jetons OAuth des réseaux sociaux (Instagram, Facebook, LinkedIn, X) ne doivent
 * jamais être stockés en clair — exigence des Meta Platform Terms / Data Protection.
 *
 * Variable d'environnement requise :
 *   TOKEN_ENCRYPTION_KEY = clé de 32 octets, en hex (64 caractères) OU base64.
 *   Générer : `openssl rand -hex 32`
 *
 * Format de sortie : "enc:v1:<iv_hex>:<tag_hex>:<ciphertext_hex>"
 * Le préfixe permet de distinguer un jeton chiffré d'un ancien jeton en clair
 * (rétro-compatibilité : un jeton non préfixé est retourné tel quel à la lecture).
 */

import crypto from "node:crypto";

const PREFIX = "enc:v1:";
const ALGO = "aes-256-gcm";

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;

  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "TOKEN_ENCRYPTION_KEY manquante — impossible de chiffrer les jetons. " +
        "Générer une clé : openssl rand -hex 32",
    );
  }

  let key: Buffer;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    key = Buffer.from(raw, "hex");
  } else {
    key = Buffer.from(raw, "base64");
  }

  if (key.length !== 32) {
    throw new Error(
      `TOKEN_ENCRYPTION_KEY invalide : 32 octets attendus, ${key.length} reçus ` +
        "(utiliser 64 caractères hex ou une base64 de 32 octets).",
    );
  }

  cachedKey = key;
  return key;
}

/** True si la valeur est déjà au format chiffré géré par ce module. */
export function isEncrypted(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(PREFIX);
}

/** Chiffre un jeton en clair. Idempotent : une valeur déjà chiffrée est renvoyée telle quelle. */
export function encryptToken(plain: string): string {
  if (isEncrypted(plain)) return plain;
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("hex")}:${tag.toString("hex")}:${ciphertext.toString("hex")}`;
}

/** Variante nullable pour les champs optionnels (ex: refreshToken). */
export function encryptNullable(plain: string | null | undefined): string | null {
  if (plain === null || plain === undefined || plain === "") return plain ?? null;
  return encryptToken(plain);
}

/**
 * Déchiffre un jeton. Une valeur non préfixée (ancien jeton en clair) est renvoyée
 * telle quelle pour assurer la rétro-compatibilité avant migration.
 */
export function decryptToken(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (!isEncrypted(value)) return value; // legacy plaintext

  const parts = value.slice(PREFIX.length).split(":");
  if (parts.length !== 3) {
    throw new Error("Jeton chiffré malformé");
  }
  const [ivHex, tagHex, dataHex] = parts;
  const key = getKey();
  const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  const plain = Buffer.concat([
    decipher.update(Buffer.from(dataHex, "hex")),
    decipher.final(),
  ]);
  return plain.toString("utf8");
}
