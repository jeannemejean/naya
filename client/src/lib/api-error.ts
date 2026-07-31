import { ERROR_CODES, type ErrorCode, type ErrorParams } from "@shared/error-codes";

/** Signature minimale du `t` de react-i18next, suffisante pour tester sans i18next. */
export type Translate = (key: string, params?: ErrorParams) => string;

/** Erreur portant un code stable émis par le serveur, jamais un texte à afficher. */
export class ApiError extends Error {
  constructor(
    public readonly code: ErrorCode,
    public readonly params?: ErrorParams,
  ) {
    super(code);
    this.name = "ApiError";
  }
}

export function normalizeErrorCode(value: unknown): ErrorCode | null {
  return typeof value === "string" && (ERROR_CODES as readonly string[]).includes(value)
    ? (value as ErrorCode)
    : null;
}

/** Lit le code d'une réponse en échec et lève une ApiError. Ne renvoie jamais. */
export async function throwApiError(res: Response, fallback: ErrorCode): Promise<never> {
  const body = (await res.json().catch(() => ({}))) as { error?: unknown; params?: ErrorParams };
  throw new ApiError(normalizeErrorCode(body?.error) ?? fallback, body?.params);
}

/** Message traduit à afficher pour une erreur, quelle qu'elle soit. */
export function translateError(t: Translate, err: unknown, fallback: ErrorCode): string {
  const apiErr = err instanceof ApiError ? err : null;
  return t(`errors.${apiErr?.code ?? fallback}`, apiErr?.params);
}
