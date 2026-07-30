# Socle de langue Naya — plan d'implémentation

> **Pour les agents :** SOUS-SKILL REQUISE — utiliser `superpowers:subagent-driven-development` (recommandé) ou `superpowers:executing-plans` pour exécuter ce plan tâche par tâche. Les étapes utilisent la syntaxe case à cocher (`- [ ]`).

**Objectif :** faire de la langue une donnée du compte, lue au démarrage de l'interface web, avec le français par défaut et aucun repli silencieux d'une langue vers l'autre.

**Architecture :** toute la logique de résolution de langue vit dans un module pur `shared/language.ts`, importé aussi bien par le serveur que par le client — un seul endroit décide de la langue. L'interface se synchronise sur le compte via un hook monté à la racine. Les messages d'erreur que l'écran affiche deviennent des codes stables déclarés dans `shared/error-codes.ts`, traduits côté client.

**Stack :** TypeScript, React + react-i18next côté client, Express côté serveur, Vitest pour les tests, Drizzle pour l'accès base.

Spec de référence : `docs/superpowers/specs/2026-07-30-naya-langue-socle-design.md`

## Contraintes globales

Ces règles s'appliquent à **toutes** les tâches :

- **Langue par défaut : `fr`.** Jamais `en`, nulle part, y compris dans les valeurs de repli.
- **Langues supportées : `fr` et `en` uniquement.** Toute autre valeur est traitée comme absente.
- **Aucun texte venu du serveur n'est affiché à l'écran.** Le serveur renvoie un code ; le client affiche `errors.<code>`. Le champ `message` reste dans les réponses pour les journaux.
- **Toute clé ajoutée à un dictionnaire doit l'être dans les DEUX** (`client/src/locales/fr.ts` et `en.ts`). Le test de la tâche 2 échoue sinon.
- **Aucune migration de base.** `userPreferences.language` existe déjà (`shared/schema.ts:150`, défaut `fr`). Ne rien appliquer sur la production.
- **Les tests sont des tests de logique pure.** Le dépôt n'a ni jsdom, ni testing-library, ni supertest : on ne teste ni les hooks React ni les routes Express. La logique testable est extraite dans des modules purs ; le câblage est vérifié à la main (tâche 8).
- **Commande de test :** `npx vitest run <chemin>` pour un fichier, `npm test` pour tout.
- **Ne PAS convertir** les 886 lignes de français en dur du client : c'est le sous-projet 2. Seule exception autorisée, tâche 6, justifiée sur place.

## Structure des fichiers

| Fichier | Responsabilité |
|---|---|
| `shared/language.ts` (créé) | Type `Language`, constantes, `normalizeLanguage`, `resolveLanguage`. Seul endroit qui décide d'une langue. |
| `shared/language.test.ts` (créé) | Tests du module ci-dessus. |
| `shared/error-codes.ts` (créé) | Liste close des codes d'erreur émis par le serveur et affichés par le client. |
| `client/src/locales/locales.test.ts` (créé) | Garantit que `fr.ts` et `en.ts` portent le même jeu de clés, et que chaque code d'erreur a sa traduction. |
| `client/src/lib/i18n.ts` (modifié) | Initialisation i18next : défaut `fr`, repli supprimé. |
| `client/src/lib/api-error.ts` (créé) | `ApiError`, `throwApiError`, `translateError` — un seul chemin pour transformer une réponse d'erreur en message traduit. |
| `client/src/lib/api-error.test.ts` (créé) | Tests du module ci-dessus. |
| `client/src/hooks/useLanguageSync.ts` (créé) | Aligne la langue de l'interface sur celle du compte. Monté une fois. |
| `client/src/hooks/useLanguageToggle.ts` (créé) | Unique chemin d'écriture de la langue (interface + compte). |
| `client/src/App.tsx` (modifié) | Monte `useLanguageSync`. |
| `client/src/hooks/useAuth.ts` (modifié) | Expose `language`. |
| `client/src/components/sidebar.tsx` (modifié) | Consomme `useLanguageToggle`. |
| `client/src/pages/onboarding.tsx` (modifié) | Consomme `useLanguageToggle`. |
| `client/src/components/auth-dialog.tsx` (modifié) | Affiche `errors.<code>` au lieu du texte serveur. |
| `client/src/pages/settings.tsx` (modifié) | Idem, connexion d'un compte social. |
| `client/src/pages/content-calendar.tsx` (modifié) | Idem, publication d'un contenu. |
| `server/routes.ts` (modifié) | Ajoute `language` au payload `/api/auth/user` ; émet des codes sur 4 endpoints. |

---

### Tâche 1 : le module de langue partagé

**Fichiers :**
- Créer : `shared/language.ts`
- Test : `shared/language.test.ts`

**Interfaces :**
- Consomme : rien.
- Produit : `type Language = 'fr' | 'en'` · `SUPPORTED_LANGUAGES: readonly Language[]` · `DEFAULT_LANGUAGE: Language` · `normalizeLanguage(value: unknown): Language | null` · `resolveLanguage(input: { account?: unknown; cached?: unknown }): Language`

- [ ] **Étape 1 : écrire le test qui échoue**

Créer `shared/language.test.ts` :

```ts
import { describe, it, expect } from "vitest";
import { DEFAULT_LANGUAGE, normalizeLanguage, resolveLanguage } from "./language";

describe("normalizeLanguage", () => {
  it("accepte les deux langues supportées", () => {
    expect(normalizeLanguage("fr")).toBe("fr");
    expect(normalizeLanguage("en")).toBe("en");
  });

  it("rejette tout le reste", () => {
    expect(normalizeLanguage("de")).toBeNull();
    expect(normalizeLanguage("")).toBeNull();
    expect(normalizeLanguage(null)).toBeNull();
    expect(normalizeLanguage(undefined)).toBeNull();
    expect(normalizeLanguage(42)).toBeNull();
    expect(normalizeLanguage("FR")).toBeNull(); // pas de tolérance à la casse : la base écrit en minuscules
  });
});

describe("resolveLanguage", () => {
  it("le compte l'emporte sur le cache local", () => {
    expect(resolveLanguage({ account: "en", cached: "fr" })).toBe("en");
    expect(resolveLanguage({ account: "fr", cached: "en" })).toBe("fr");
  });

  it("retombe sur le cache quand le compte est absent", () => {
    expect(resolveLanguage({ cached: "en" })).toBe("en");
    expect(resolveLanguage({ account: null, cached: "en" })).toBe("en");
  });

  it("retombe sur le français quand rien n'est exploitable", () => {
    expect(resolveLanguage({})).toBe("fr");
    expect(resolveLanguage({ account: null, cached: null })).toBe("fr");
    expect(resolveLanguage({ account: "de", cached: "es" })).toBe("fr");
  });

  it("ignore une valeur de compte invalide et utilise le cache", () => {
    expect(resolveLanguage({ account: "de", cached: "en" })).toBe("en");
  });

  it("le défaut est le français", () => {
    expect(DEFAULT_LANGUAGE).toBe("fr");
  });
});
```

- [ ] **Étape 2 : lancer le test et vérifier qu'il échoue**

Lancer : `npx vitest run shared/language.test.ts`
Attendu : ÉCHEC — `Failed to resolve import "./language"`.

- [ ] **Étape 3 : écrire l'implémentation minimale**

Créer `shared/language.ts` :

```ts
// Seul endroit du code qui décide d'une langue. Importé par le serveur ET par le client
// pour qu'il n'existe jamais deux réponses différentes à « quelle langue ? ».

export type Language = "fr" | "en";

export const SUPPORTED_LANGUAGES: readonly Language[] = ["fr", "en"] as const;

/** Le français est la langue par défaut de Naya (cf. CLAUDE.md). */
export const DEFAULT_LANGUAGE: Language = "fr";

/** Renvoie la langue si elle est supportée, sinon null. Aucune tolérance à la casse. */
export function normalizeLanguage(value: unknown): Language | null {
  return typeof value === "string" && (SUPPORTED_LANGUAGES as readonly string[]).includes(value)
    ? (value as Language)
    : null;
}

/**
 * Résout la langue à appliquer, par ordre de priorité :
 *   1. `account` — la préférence enregistrée sur le compte, qui gagne toujours ;
 *   2. `cached`  — le cache local du navigateur, qui évite un clignotement avant la réponse serveur ;
 *   3. le français.
 */
export function resolveLanguage(input: { account?: unknown; cached?: unknown }): Language {
  return normalizeLanguage(input.account) ?? normalizeLanguage(input.cached) ?? DEFAULT_LANGUAGE;
}
```

- [ ] **Étape 4 : lancer le test et vérifier qu'il passe**

Lancer : `npx vitest run shared/language.test.ts`
Attendu : SUCCÈS, 5 tests verts.

- [ ] **Étape 5 : committer**

```bash
git add shared/language.ts shared/language.test.ts
git commit -m "feat(langue): module partagé de résolution de langue"
```

---

### Tâche 2 : complétude des dictionnaires et suppression du repli

C'est le test de cette tâche qui rend sûre la suppression du repli : sans repli, une clé manquante s'affiche crûment, donc il faut garantir qu'aucune ne manque.

**Fichiers :**
- Créer : `client/src/locales/locales.test.ts`
- Modifier : `client/src/lib/i18n.ts`

**Interfaces :**
- Consomme : `resolveLanguage`, `DEFAULT_LANGUAGE` (tâche 1).
- Produit : rien de nouveau. `i18n` reste l'export par défaut de `client/src/lib/i18n.ts`.

- [ ] **Étape 1 : écrire le test qui échoue**

Créer `client/src/locales/locales.test.ts` :

```ts
import { describe, it, expect } from "vitest";
import fr from "./fr";
import en from "./en";

/** Aplatit un dictionnaire imbriqué en liste de chemins : { a: { b: "x" } } → ["a.b"]. */
function flattenKeys(obj: unknown, prefix = ""): string[] {
  if (obj === null || typeof obj !== "object") return [prefix];
  return Object.entries(obj as Record<string, unknown>).flatMap(([key, value]) =>
    flattenKeys(value, prefix ? `${prefix}.${key}` : key),
  );
}

describe("dictionnaires de traduction", () => {
  const frKeys = flattenKeys(fr).sort();
  const enKeys = flattenKeys(en).sort();

  it("aucune clé française ne manque à l'anglais", () => {
    const manquantes = frKeys.filter((k) => !enKeys.includes(k));
    expect(manquantes).toEqual([]);
  });

  it("aucune clé anglaise ne manque au français", () => {
    const manquantes = enKeys.filter((k) => !frKeys.includes(k));
    expect(manquantes).toEqual([]);
  });

  it("aucune valeur n'est vide", () => {
    const vides = [...flattenValues(fr, "fr"), ...flattenValues(en, "en")];
    expect(vides).toEqual([]);
  });
});

/** Renvoie les chemins dont la valeur est une chaîne vide ou blanche. */
function flattenValues(obj: unknown, langue: string, prefix = ""): string[] {
  if (typeof obj === "string") return obj.trim() === "" ? [`${langue}:${prefix}`] : [];
  if (obj === null || typeof obj !== "object") return [];
  return Object.entries(obj as Record<string, unknown>).flatMap(([key, value]) =>
    flattenValues(value, langue, prefix ? `${prefix}.${key}` : key),
  );
}
```

- [ ] **Étape 2 : lancer le test et vérifier son état réel**

Lancer : `npx vitest run client/src/locales/locales.test.ts`
Attendu : SUCCÈS. Les deux dictionnaires ont été mesurés symétriques (1142 clés de chaque côté) avant l'écriture de ce plan.

**Si le test échoue :** c'est exactement ce qu'il doit attraper. Ajouter les clés manquantes dans le dictionnaire concerné, en traduisant réellement — ne jamais recopier la valeur de l'autre langue pour faire passer le test. Puis relancer.

- [ ] **Étape 3 : modifier la configuration i18n**

Dans `client/src/lib/i18n.ts`, remplacer les lignes `lng:` et `fallbackLng:` :

```ts
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '@/locales/en';
import fr from '@/locales/fr';
import { resolveLanguage } from '@shared/language';

i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      fr: { translation: fr },
    },
    // Le cache local évite un clignotement avant la réponse de /api/auth/user.
    // useLanguageSync corrigera ensuite depuis le compte, qui fait autorité.
    lng: resolveLanguage({ cached: localStorage.getItem('naya_language') }),
    // Pas de repli d'une langue vers l'autre : une clé manquante doit se VOIR.
    // Sûr parce que client/src/locales/locales.test.ts garantit la symétrie des dictionnaires.
    fallbackLng: false,
    interpolation: {
      escapeValue: false,
    },
  });

i18n.on('languageChanged', (lng) => {
  localStorage.setItem('naya_language', lng);
});

export default i18n;
```

- [ ] **Étape 4 : vérifier que le typage et le build passent**

Lancer : `npx tsc --noEmit && npm run build`
Attendu : aucune erreur. Ce fichier n'est pas testé directement — il touche `localStorage`, absent de l'environnement Node de Vitest. Sa logique décisionnelle vit dans `resolveLanguage`, testée en tâche 1 ; c'est précisément la raison de cette extraction.

- [ ] **Étape 5 : committer**

```bash
git add client/src/locales/locales.test.ts client/src/lib/i18n.ts
git commit -m "feat(langue): français par défaut, repli entre langues supprimé"
```

---

### Tâche 3 : le serveur expose la langue du compte

**Fichiers :**
- Modifier : `server/routes.ts:975-1001` (handler `GET /api/auth/user`)

**Interfaces :**
- Consomme : `normalizeLanguage`, `DEFAULT_LANGUAGE` (tâche 1) ; `storage.getUserPreferences(userId)` qui renvoie `Promise<UserPreferences | undefined>`.
- Produit : le payload de `GET /api/auth/user` porte désormais `language: 'fr' | 'en'`, toujours présent, jamais nul.

- [ ] **Étape 1 : ajouter l'import**

En tête de `server/routes.ts`, à côté des autres imports `@shared` :

```ts
import { normalizeLanguage, DEFAULT_LANGUAGE } from "@shared/language";
```

- [ ] **Étape 2 : enrichir le payload**

Dans le handler `app.get('/api/auth/user', ...)`, après la ligne `const aiBlocked = await isAiBlocked(userId).catch(() => false);`, ajouter la lecture des préférences, puis le champ dans la réponse :

```ts
      const prefs = await storage.getUserPreferences(userId).catch(() => undefined);
      const { hashedPassword, ...userWithoutPassword } = user;
      res.json({
        ...userWithoutPassword,
        // Langue du compte : fait autorité sur le cache du navigateur (cf. useLanguageSync).
        language: normalizeLanguage(prefs?.language) ?? DEFAULT_LANGUAGE,
        access: {
          allowed,
          status: sub?.status ?? null,
          trialEndsAt: sub?.trialEndsAt ?? null,
          cancelAtPeriodEnd: sub?.cancelAtPeriodEnd ?? false,
        },
        ai: { blocked: aiBlocked }, // booléen seulement — aucun montant exposé
      });
```

Le `.catch(() => undefined)` est délibéré : une panne de lecture des préférences ne doit pas casser l'authentification, elle doit dégrader vers le français.

- [ ] **Étape 3 : vérifier le typage**

Lancer : `npx tsc --noEmit`
Attendu : aucune erreur.

- [ ] **Étape 4 : vérifier à la main**

Lancer le serveur : `npm run dev`
Puis, connecté dans le navigateur, ouvrir `http://localhost:3000/api/auth/user` et vérifier que la réponse contient `"language": "fr"`.

Il n'existe aucun test de route dans ce dépôt (ni supertest, ni montage d'Express en test) ; la vérification de ce câblage est manuelle, par conception.

- [ ] **Étape 5 : committer**

```bash
git add server/routes.ts
git commit -m "feat(langue): /api/auth/user expose la langue du compte"
```

---

### Tâche 4 : l'interface se synchronise sur le compte

**Fichiers :**
- Créer : `client/src/hooks/useLanguageSync.ts`
- Modifier : `client/src/hooks/useAuth.ts`
- Modifier : `client/src/App.tsx:138-152`

**Interfaces :**
- Consomme : `resolveLanguage` (tâche 1) ; `language` dans le payload `/api/auth/user` (tâche 3).
- Produit : `useAuth()` renvoie en plus `language: Language | undefined` · `useLanguageSync(): void`.

- [ ] **Étape 1 : exposer la langue dans useAuth**

Dans `client/src/hooks/useAuth.ts`, étendre le type et le retour :

```ts
import type { Language } from "@shared/language";

type AuthUser = User & {
  access?: { allowed: boolean; status: string | null; trialEndsAt: string | null; cancelAtPeriodEnd: boolean };
  ai?: { blocked: boolean };
  language?: Language;
};
```

et dans l'objet retourné par `useAuth`, ajouter après `aiBlocked` :

```ts
    language: user?.language,
```

- [ ] **Étape 2 : créer le hook de synchronisation**

Créer `client/src/hooks/useLanguageSync.ts` :

```ts
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";
import { resolveLanguage } from "@shared/language";

/**
 * Aligne la langue de l'interface sur celle du compte dès que /api/auth/user répond.
 * Le compte fait autorité : il gagne toujours contre le cache du navigateur.
 * À monter UNE SEULE FOIS, à la racine de l'application.
 */
export function useLanguageSync(): void {
  const { i18n } = useTranslation();
  const { language } = useAuth();

  useEffect(() => {
    if (!language) return; // pas encore connecté, ou réponse pas encore arrivée
    const cible = resolveLanguage({ account: language });
    if (cible !== i18n.language) {
      void i18n.changeLanguage(cible);
    }
  }, [language, i18n]);
}
```

- [ ] **Étape 3 : monter le hook à la racine**

Dans `client/src/App.tsx`, le hook a besoin d'être **sous** `QueryClientProvider` (il consomme `useAuth`, qui est une requête). Introduire un composant intermédiaire juste au-dessus de `<Router />` :

```tsx
function LanguageGate({ children }: { children: React.ReactNode }) {
  useLanguageSync();
  return <>{children}</>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <ProjectProvider>
          <TooltipProvider>
            <Toaster />
            <ErrorBoundary>
              <LanguageGate>
                <Router />
              </LanguageGate>
            </ErrorBoundary>
          </TooltipProvider>
        </ProjectProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
```

Ajouter l'import en tête du fichier :

```ts
import { useLanguageSync } from "@/hooks/useLanguageSync";
```

- [ ] **Étape 4 : vérifier typage, tests et build**

Lancer : `npx tsc --noEmit && npm test && npm run build`
Attendu : aucune erreur, toute la suite verte.

La logique de priorité de ce hook est celle de `resolveLanguage`, déjà couverte par la tâche 1. Le hook lui-même n'est pas testable ici (pas de jsdom) ; son comportement est vérifié à la main en tâche 8.

- [ ] **Étape 5 : committer**

```bash
git add client/src/hooks/useLanguageSync.ts client/src/hooks/useAuth.ts client/src/App.tsx
git commit -m "feat(langue): l'interface se synchronise sur la langue du compte"
```

---

### Tâche 5 : un seul chemin d'écriture de la langue

Aujourd'hui la sidebar écrit sur le compte, l'onboarding non — alors que l'utilisateur y est déjà connecté. On extrait le chemin commun pour qu'il n'en existe qu'un.

**Fichiers :**
- Créer : `client/src/hooks/useLanguageToggle.ts`
- Modifier : `client/src/components/sidebar.tsx:49-63`
- Modifier : `client/src/pages/onboarding.tsx:312`

**Interfaces :**
- Consomme : `Language`, `SUPPORTED_LANGUAGES` (tâche 1).
- Produit : `useLanguageToggle(): { current: Language; toggle(): void }`.

- [ ] **Étape 1 : créer le hook**

Créer `client/src/hooks/useLanguageToggle.ts` :

```ts
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { normalizeLanguage, DEFAULT_LANGUAGE, type Language } from "@shared/language";

/**
 * Unique chemin d'écriture de la langue : bascule l'interface ET enregistre sur le compte.
 * Tout sélecteur de langue d'un écran authentifié DOIT passer par ce hook.
 */
export function useLanguageToggle() {
  const { i18n } = useTranslation();
  const queryClient = useQueryClient();
  const current = normalizeLanguage(i18n.language) ?? DEFAULT_LANGUAGE;

  const enregistrer = useMutation({
    mutationFn: (lang: Language) =>
      apiRequest("PATCH", "/api/preferences", { language: lang }).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/preferences"] });
      // /api/auth/user porte aussi la langue : sans cette invalidation, useLanguageSync
      // rebasculerait l'interface sur l'ancienne valeur au prochain rafraîchissement.
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
    },
  });

  const appliquer = (lang: Language) => {
    void i18n.changeLanguage(lang);
    enregistrer.mutate(lang);
  };

  return {
    current,
    toggle: () => appliquer(current === "fr" ? "en" : "fr"),
  };
}
```

L'invalidation de `/api/auth/user` est indispensable : sans elle, le cache de React Query garde l'ancienne langue et `useLanguageSync` annulerait la bascule au premier remontage.

- [ ] **Étape 2 : câbler la sidebar**

Dans `client/src/components/sidebar.tsx`, supprimer `saveLanguageMutation`, `currentLang` et `toggleLanguage`, et les remplacer par :

```ts
  const { current: currentLang, toggle: toggleLanguage } = useLanguageToggle();
```

Ajouter l'import `import { useLanguageToggle } from "@/hooks/useLanguageToggle";`. Retirer les imports devenus inutilisés (`useMutation` s'il ne sert plus ailleurs dans le fichier — vérifier avant de supprimer).

- [ ] **Étape 3 : câbler l'onboarding**

Dans `client/src/pages/onboarding.tsx`, remplacer la ligne 312 :

```ts
  const toggleLanguage = () => i18n.changeLanguage(i18n.language === "fr" ? "en" : "fr");
```

par :

```ts
  const { toggle: toggleLanguage } = useLanguageToggle();
```

Ajouter l'import `import { useLanguageToggle } from "@/hooks/useLanguageToggle";`.

Ne PAS toucher au sélecteur de `client/src/pages/landing.tsx:116` : la landing est publique, il n'y a pas de compte sur lequel écrire. Son comportement reste inchangé.

- [ ] **Étape 4 : vérifier typage, tests et build**

Lancer : `npx tsc --noEmit && npm test && npm run build`
Attendu : aucune erreur, suite verte.

- [ ] **Étape 5 : committer**

```bash
git add client/src/hooks/useLanguageToggle.ts client/src/components/sidebar.tsx client/src/pages/onboarding.tsx
git commit -m "feat(langue): chemin d'écriture unique, l'onboarding persiste aussi"
```

---

### Tâche 6 : codes d'erreur — authentification

**Fichiers :**
- Créer : `shared/error-codes.ts`
- Créer : `client/src/lib/api-error.ts`
- Créer : `client/src/lib/api-error.test.ts`
- Modifier : `client/src/locales/fr.ts` et `client/src/locales/en.ts` (ajout du bloc `errors`)
- Modifier : `client/src/locales/locales.test.ts` (couverture des codes)
- Modifier : `server/routes.ts:882-960` (register et login)
- Modifier : `client/src/components/auth-dialog.tsx:30-95`

**Interfaces :**
- Consomme : rien des tâches précédentes.
- Produit : `ERROR_CODES: readonly ErrorCode[]` · `type ErrorCode` · `type ErrorParams = Record<string, string | number>` · `class ApiError extends Error { code: ErrorCode; params?: ErrorParams }` · `normalizeErrorCode(value: unknown): ErrorCode | null` · `throwApiError(res: Response, fallback: ErrorCode): Promise<never>` · `translateError(t: Translate, err: unknown, fallback: ErrorCode): string` avec `type Translate = (key: string, params?: ErrorParams) => string`.

Certains messages du serveur portent une variable — le nom du réseau, par exemple. Le code seul ne suffit donc pas : l'erreur transporte aussi ses paramètres, et `translateError` les passe à `t`.

- [ ] **Étape 1 : écrire les tests qui échouent**

Créer `client/src/lib/api-error.test.ts` :

```ts
import { describe, it, expect } from "vitest";
import { ApiError, translateError, normalizeErrorCode } from "./api-error";

/** Faux `t` : renvoie ce qu'il a reçu, pour observer la clé ET les paramètres. */
const t = (key: string, params?: Record<string, string | number>) =>
  params ? `${key}|${JSON.stringify(params)}` : key;

describe("normalizeErrorCode", () => {
  it("accepte un code connu", () => {
    expect(normalizeErrorCode("invalid_credentials")).toBe("invalid_credentials");
  });

  it("rejette un code inconnu ou mal typé", () => {
    expect(normalizeErrorCode("boom")).toBeNull();
    expect(normalizeErrorCode(undefined)).toBeNull();
    expect(normalizeErrorCode(12)).toBeNull();
  });
});

describe("translateError", () => {
  it("traduit le code porté par une ApiError", () => {
    expect(translateError(t, new ApiError("invalid_credentials"), "login_failed")).toBe(
      "errors.invalid_credentials",
    );
  });

  it("transmet les paramètres de l'erreur à la traduction", () => {
    expect(
      translateError(t, new ApiError("social_account_not_connected", { platform: "linkedin" }), "content_publish_failed"),
    ).toBe('errors.social_account_not_connected|{"platform":"linkedin"}');
  });

  it("retombe sur le code de repli pour une erreur quelconque", () => {
    expect(translateError(t, new Error("réseau coupé"), "login_failed")).toBe("errors.login_failed");
    expect(translateError(t, null, "register_failed")).toBe("errors.register_failed");
  });
});
```

Ajouter à `client/src/locales/locales.test.ts`, dans le `describe` existant :

```ts
  it("chaque code d'erreur a sa traduction dans les deux langues", () => {
    const sansTraduction = ERROR_CODES.flatMap((code) => [
      frKeys.includes(`errors.${code}`) ? [] : [`fr:errors.${code}`],
      enKeys.includes(`errors.${code}`) ? [] : [`en:errors.${code}`],
    ].flat());
    expect(sansTraduction).toEqual([]);
  });
```

et l'import correspondant en tête du fichier : `import { ERROR_CODES } from "@shared/error-codes";`

- [ ] **Étape 2 : lancer les tests et vérifier qu'ils échouent**

Lancer : `npx vitest run client/src/lib/api-error.test.ts client/src/locales/locales.test.ts`
Attendu : ÉCHEC — modules `./api-error` et `@shared/error-codes` introuvables.

- [ ] **Étape 3 : écrire les implémentations**

Créer `shared/error-codes.ts` :

```ts
// Liste CLOSE des codes d'erreur que le serveur émet et que l'interface affiche.
// Règle : l'interface n'affiche jamais un texte venu du serveur, seulement `errors.<code>`.
// Tout code ajouté ici DOIT recevoir sa traduction dans fr.ts ET en.ts — le test
// client/src/locales/locales.test.ts échoue sinon.

export const ERROR_CODES = [
  // authentification
  "missing_credentials",
  "email_already_registered",
  "invalid_credentials",
  "register_failed",
  "login_failed",
  // comptes sociaux (câblés en tâche 7)
  "social_not_configured",
  "social_connect_failed",
  // publication de contenu (câblée en tâche 7)
  "content_not_found",
  "content_already_published",
  "social_account_not_connected",
  "social_token_expired",
  "content_publish_failed",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export type ErrorParams = Record<string, string | number>;
```

Créer `client/src/lib/api-error.ts` :

```ts
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
```

- [ ] **Étape 4 : ajouter les traductions**

Dans `client/src/locales/fr.ts`, ajouter un bloc `errors` au premier niveau de l'objet :

```ts
  errors: {
    missing_credentials: "Renseigne ton email et ton mot de passe.",
    email_already_registered: "Un compte existe déjà avec cet email.",
    invalid_credentials: "Email ou mot de passe incorrect.",
    register_failed: "La création du compte a échoué. Réessaie.",
    login_failed: "La connexion a échoué. Réessaie.",
    social_not_configured: "Ce réseau n'est pas configuré sur le serveur.",
    social_connect_failed: "La connexion au réseau a échoué. Réessaie.",
    content_not_found: "Ce contenu est introuvable.",
    content_already_published: "Ce contenu est déjà publié.",
    social_account_not_connected: "Aucun compte {{platform}} connecté. Connecte-le d'abord dans les réglages.",
    social_token_expired: "Ta connexion {{platform}} a expiré. Reconnecte le compte.",
    content_publish_failed: "La publication a échoué. Vérifie la connexion du compte.",
  },
```

Dans `client/src/locales/en.ts`, le bloc correspondant :

```ts
  errors: {
    missing_credentials: "Enter your email and password.",
    email_already_registered: "An account already exists with this email.",
    invalid_credentials: "Incorrect email or password.",
    register_failed: "Account creation failed. Please try again.",
    login_failed: "Sign-in failed. Please try again.",
    social_not_configured: "This network is not configured on the server.",
    social_connect_failed: "Connecting to the network failed. Please try again.",
    content_not_found: "This content could not be found.",
    content_already_published: "This content is already published.",
    social_account_not_connected: "No {{platform}} account connected. Connect it in settings first.",
    social_token_expired: "Your {{platform}} connection has expired. Reconnect the account.",
    content_publish_failed: "Publishing failed. Check the account connection.",
  },
```

Les deux clés à `{{platform}}` reçoivent leur valeur via les `params` de l'`ApiError` — c'est exactement ce que `translateError` transmet à `t`.

- [ ] **Étape 5 : le serveur émet des codes**

Dans `server/routes.ts`, handlers `POST /api/auth/register` et `POST /api/auth/login`, ajouter le champ `error` à côté du `message` existant. Le `message` reste pour les journaux, il n'est plus affiché.

```ts
        return res.status(400).json({ error: "missing_credentials", message: "Email and password are required" });
        return res.status(400).json({ error: "email_already_registered", message: "Email already registered" });
        res.status(500).json({ error: "register_failed", message: "Failed to register user" });
        return res.status(401).json({ error: "invalid_credentials", message: "Invalid email or password" });
        res.status(500).json({ error: "login_failed", message: "Failed to login" });
```

Appliquer chacune à la ligne correspondante — il y a **deux** occurrences de `"Invalid email or password"` (mot de passe faux et email inconnu), toutes deux en `invalid_credentials`, et **deux** occurrences de `"Email and password are required"` (une par endpoint), toutes deux en `missing_credentials`.

- [ ] **Étape 6 : le client affiche des clés**

Dans `client/src/components/auth-dialog.tsx`, remplacer les blocs d'erreur des deux mutations.

Pour `loginMutation` :

```ts
      if (!res.ok) {
        await throwApiError(res, "login_failed");
      }
```

et son `onError` :

```ts
    onError: (error: unknown) => {
      toast({
        title: t("errors.login_failed"),
        description: translateError(t, error, "login_failed"),
        variant: "destructive",
      });
    },
```

Pour `registerMutation`, identique avec `"register_failed"` :

```ts
      if (!res.ok) {
        await throwApiError(res, "register_failed");
      }
```

```ts
    onError: (error: unknown) => {
      toast({
        title: t("errors.register_failed"),
        description: translateError(t, error, "register_failed"),
        variant: "destructive",
      });
    },
```

Ajouter en tête du fichier :

```ts
import { useTranslation } from "react-i18next";
import { throwApiError, translateError } from "@/lib/api-error";
```

et, dans le composant, `const { t } = useTranslation();`.

**Exception de périmètre, assumée :** ce fichier contient aussi quatre libellés de succès écrits en anglais en dur (`"Welcome back!"`, `"You've successfully logged in."`, `"Welcome to Naya!"`, `"Your account has been created successfully."`). Les convertir en clés `auth.*` fait partie de cette tâche, uniquement parce que laisser un titre anglais au-dessus d'une description traduite serait un défaut **introduit par ce travail**. Aucune autre chaîne en dur du dépôt n'est touchée. Ajouter dans les deux dictionnaires :

```ts
  // fr.ts
  auth: {
    welcomeBackTitle: "Content de te revoir",
    welcomeBackBody: "Tu es connectée.",
    accountCreatedTitle: "Bienvenue dans Naya",
    accountCreatedBody: "Ton compte est créé.",
  },
```

```ts
  // en.ts
  auth: {
    welcomeBackTitle: "Welcome back",
    welcomeBackBody: "You're signed in.",
    accountCreatedTitle: "Welcome to Naya",
    accountCreatedBody: "Your account has been created.",
  },
```

et remplacer les quatre chaînes des `onSuccess` par les `t("auth.…")` correspondants.

- [ ] **Étape 7 : lancer les tests et vérifier qu'ils passent**

Lancer : `npx vitest run client/src/lib/api-error.test.ts client/src/locales/locales.test.ts && npx tsc --noEmit && npm run build`
Attendu : tests verts, aucune erreur de typage, build propre.

- [ ] **Étape 8 : committer**

```bash
git add shared/error-codes.ts client/src/lib/api-error.ts client/src/lib/api-error.test.ts client/src/locales/fr.ts client/src/locales/en.ts client/src/locales/locales.test.ts server/routes.ts client/src/components/auth-dialog.tsx
git commit -m "feat(langue): codes d'erreur traduits sur l'authentification"
```

---

### Tâche 7 : codes d'erreur — comptes sociaux et publication

Les codes et leurs traductions ont été déclarés en tâche 6. Cette tâche ne fait que les émettre côté serveur et les afficher côté client.

**Fichiers :**
- Modifier : `server/routes.ts:738-772` (`GET /api/social/oauth/:platform/url`) et `server/routes.ts:8371+` (`POST /api/content/:id/publish`)
- Modifier : `client/src/pages/settings.tsx:195-206`
- Modifier : `client/src/pages/content-calendar.tsx:355-374`

**Interfaces :**
- Consomme : `throwApiError`, `translateError`, `ApiError` (tâche 6).
- Produit : rien de nouveau.

- [ ] **Étape 1 : le serveur émet les codes sur l'OAuth social**

Dans `server/routes.ts`, endpoint `GET /api/social/oauth/:platform/url`, remplacer les trois réponses d'échec :

```ts
    if (!validPlatforms.includes(platform)) {
      return res.status(400).json({ error: "social_connect_failed", message: `Plateforme non supportée: ${platform}` });
    }
    if (!isPlatformConfigured(platform as any)) {
      return res.status(503).json({
        error: "social_not_configured",
        message: `${platform} n'est pas encore configuré sur ce serveur. Ajoute les variables d'environnement.`,
        notConfigured: true,
      });
    }
```

et, dans le `catch` de ce même handler :

```ts
    } catch (err: any) {
      res.status(500).json({ error: "social_connect_failed", message: err.message });
    }
```

Le champ `notConfigured` est conservé : d'autres endroits de l'interface le lisent encore.

- [ ] **Étape 2 : le serveur émet les codes sur la publication**

Dans `server/routes.ts`, endpoint `POST /api/content/:id/publish`, les quatre réponses d'échec deviennent :

```ts
        return res.status(404).json({ error: "content_not_found", message: "Content not found" });
        return res.status(400).json({ error: "content_already_published", message: "Content is already published" });
        return res.status(400).json({
          error: "social_account_not_connected",
          params: { platform: content.platform },
          message: `No connected ${content.platform} account found. Please connect your account first.`,
        });
        return res.status(400).json({
          error: "social_token_expired",
          params: { platform: content.platform },
          message: `${content.platform} account token has expired. Please reconnect your account.`,
        });
```

Les deux dernières portent `params` : c'est ce qui permet à l'interface d'afficher « Aucun compte **linkedin** connecté » sans jamais rendre le texte du serveur.

- [ ] **Étape 3 : le client affiche les messages traduits**

Dans `client/src/pages/settings.tsx`, la mutation `connectMutation` :

```ts
    mutationFn: async (platform: string) => {
      const res = await fetch(`/api/social/oauth/${platform}/url`, { credentials: 'include' });
      if (!res.ok) await throwApiError(res, 'social_connect_failed');
      const data = await res.json();
      if (data.notConfigured) throw new ApiError('social_not_configured');
      window.location.href = data.url;
    },
    onError: (err: unknown) => {
      toast({
        title: t('errors.social_connect_failed'),
        description: translateError(t, err, 'social_connect_failed'),
        variant: 'destructive',
      });
    },
```

Dans `client/src/pages/content-calendar.tsx`, la mutation `publishContentMutation` :

```ts
      if (!response.ok) {
        await throwApiError(response, 'content_publish_failed');
      }
```

```ts
    onError: (error: unknown) => {
      toast({
        title: t('contentCalendar.failedToPublish'),
        description: translateError(t, error, 'content_publish_failed'),
        variant: 'destructive',
      });
    },
```

Ajouter les imports `throwApiError`, `translateError`, `ApiError` depuis `@/lib/api-error` dans les deux fichiers. `settings.tsx` doit aussi disposer de `const { t } = useTranslation();` s'il ne l'a pas déjà — le vérifier avant d'ajouter.

Le titre français en dur `'Connexion impossible'` de `settings.tsx:205` disparaît au profit de `t('errors.social_connect_failed')`.

- [ ] **Étape 4 : vérifier l'ensemble**

Lancer : `npm test && npx tsc --noEmit && npm run build`
Attendu : suite verte, aucune erreur, build propre.

- [ ] **Étape 5 : committer**

```bash
git add server/routes.ts client/src/pages/settings.tsx client/src/pages/content-calendar.tsx
git commit -m "feat(langue): codes d'erreur traduits sur les comptes sociaux et la publication"
```

---

### Tâche 8 : vérification manuelle de bout en bout

Aucun code produit. Cette tâche existe parce que l'essentiel du câblage — hooks React et routes Express — n'est couvert par aucun test dans ce dépôt.

**Fichiers :** aucun.

**Interfaces :**
- Consomme : tout ce qui précède.
- Produit : un compte rendu à Jeanne.

- [ ] **Étape 1 : lancer la suite complète**

Lancer : `npm test && npx tsc --noEmit && npm run build`
Attendu : tout vert. Ne pas continuer sinon.

- [ ] **Étape 2 : démarrer le serveur local**

Lancer : `npm run dev` (port 3000).
Vérifier d'abord que `.env` pointe bien sur la branche Neon de développement (l'hôte doit commencer par `ep-jolly-sky-an1x7ddn`), jamais sur la production.

- [ ] **Étape 3 : dérouler la liste de vérification**

| Manipulation | Attendu |
|---|---|
| Navigation privée, sans cache, ouvrir l'app | L'interface s'ouvre en **français** |
| Se connecter avec un mauvais mot de passe | Message d'erreur **en français**, titre compris |
| Se connecter, basculer en anglais depuis la sidebar, recharger | Toujours en **anglais** |
| Ouvrir dans un autre navigateur, même compte | **Anglais** — la langue vient du compte, pas du poste |
| Rebasculer en français, ouvrir `/api/auth/user` | Le payload contient `"language": "fr"` |
| Parcourir dashboard, planning, outreach, réglages dans les deux langues | Aucune clé brute affichée (`dashboard.title` visible à l'écran) |

Le dernier point est le plus important : sans repli, une clé manquante appelée dynamiquement (`t(variable)`) s'affiche crûment. Le test statique ne peut pas les voir. Si une clé brute apparaît, la corriger dans les deux dictionnaires et relancer le test de complétude.

- [ ] **Étape 4 : rendre compte**

Rapporter à Jeanne : ce qui a été vérifié, ce qui a été trouvé, et — attendu — le fait que l'app reste largement en français quand elle est en anglais. C'est normal : les 886 chaînes en dur sont le sous-projet 2. Ce socle rend la bascule fiable, pas l'interface bilingue.

- [ ] **Étape 5 : arrêter le serveur local**

---

## Ce que ce plan ne fait pas

- Les 886 lignes de français en dur sur 60 fichiers — sous-projet 2, avec un garde-fou automatique contre la réapparition du problème.
- La langue de génération de l'IA dans la quinzaine de services qui court-circuitent `buildNayaContext`, la transcription Whisper figée sur `fr` (`server/routes.ts:3181`), la traduction avec mémoire du contenu déjà stocké, la langue propre aux campagnes — sous-projet 3.
- L'app mobile, qui n'a aucun i18n.
