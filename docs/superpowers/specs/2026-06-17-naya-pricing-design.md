# Spec — Tarification & abonnement Naya

**Date :** 2026-06-17
**Statut :** validé (design) — en attente relecture finale
**Objectif :** un abonnement unique à **29 €/mois** pour accéder à Naya, ouvert au public, avec essai gratuit de 7 jours, via Stripe. Critère directeur : **robuste, pérenne, ultra-stable.**

---

## 1. Décisions cadrées

| Sujet | Décision |
|-------|----------|
| Prestataire | **Stripe** (Checkout hébergé + Customer Portal + webhooks) |
| Prix | 29 €/mois, plan unique, référencé par `STRIPE_PRICE_ID` |
| Essai | **7 jours**, carte demandée à l'inscription, 1er prélèvement à J+7 |
| Rollout | **Ouvert au public** : sortie du `WAITLIST_MODE` |
| Plateforme | **Web uniquement** (mobile plus tard ; pas d'IAP Apple/Google maintenant) |
| TVA | Stripe Tax activé (calcul auto) + factures auto. Déclaration = responsabilité de Jeanne. |
| Accès gratuit | `owner` (Jeanne) + `comped` (testeurs via code d'accès) |
| Comptes existants | tous → `user` (donc paywall) ; Jeanne → `owner` |

---

## 2. Principe d'architecture : Stripe = source de vérité, DB = cache synchronisé

L'accès ne doit **jamais** se désynchroniser de la réalité de facturation. Trois canaux de synchro redondants :

1. **Webhooks Stripe** signés → mise à jour de la table `subscriptions`.
2. **Au retour de Checkout** : relecture immédiate de la session/abonnement Stripe et synchro (sans attendre le webhook).
3. **Réconciliation paresseuse** : si le statut local est absent/incertain (ou plus vieux qu'un seuil), refetch depuis Stripe à la volée lors d'un appel à `/api/auth/user`.

Garanties de stabilité :
- **Idempotence** des webhooks : table `processed_stripe_events` (on ignore un event déjà traité).
- **Vérification de signature** sur la route webhook (`STRIPE_WEBHOOK_SECRET`).
- **Version d'API Stripe figée** dans le code via `apiVersion` (on épingle la version courante au moment de l'implémentation, pas de `latest`) → pas de casse lors des montées de version Stripe.
- **Idempotency keys** sur la création de session Checkout.
- Prix/plan **hors code** (env) → un changement de tarif ne nécessite aucun déploiement.

---

## 3. Modèle de données (Drizzle / `shared/schema.ts`)

### `users` — ajout
```
role: text("role").notNull().default("user")   // 'user' | 'owner' | 'comped'
```
`owner` et `comped` → accès total sans abonnement actif.

### `subscriptions` — nouvelle table (1 ligne / user)
```
id                  serial PK
userId              varchar unique  FK users.id
stripeCustomerId    text
stripeSubscriptionId text
status              text            // mirror du status Stripe: trialing|active|past_due|canceled|incomplete|unpaid
priceId             text
currentPeriodEnd    timestamp
trialEndsAt         timestamp
cancelAtPeriodEnd   boolean default false
createdAt / updatedAt timestamp
```

### `access_codes` — nouvelle table (comps testeurs)
```
id                serial PK
code              text unique
label             text            // ex. "testeurs beta"
maxRedemptions    integer         // null = illimité
redemptionCount   integer default 0
expiresAt         timestamp       // null = pas d'expiration
isActive          boolean default true
createdAt         timestamp
```

### `access_code_redemptions` — nouvelle table (anti double-usage + audit)
```
id          serial PK
codeId      integer FK access_codes.id
userId      varchar FK users.id
redeemedAt  timestamp default now()
unique(codeId, userId)
```

---

## 4. Règle d'accès (unique, centralisée)

Un utilisateur a accès si **au moins une** condition est vraie :
- `user.role` ∈ { `owner`, `comped` }, **ou**
- `subscription.status` ∈ { `trialing`, `active` }, **ou**
- `subscription.status` = `past_due` **et** `now < currentPeriodEnd` (tolérance le temps des relances Stripe).

Sinon → **paywall**.

Cette règle est implémentée **une seule fois** (helper `hasNayaAccess(user, subscription)`) et réutilisée côté back (middleware) et exposée au front.

---

## 5. Parcours & flux

### 5.1 Inscription + abonnement (compte d'abord)
1. `POST /api/auth/register` (email + mot de passe) — déjà existant.
2. `POST /api/billing/checkout` → crée (ou réutilise) le **Customer Stripe**, crée une **Checkout Session** (`mode: subscription`, `line_items: [STRIPE_PRICE_ID]`, `subscription_data.trial_period_days: 7`, `customer`, `success_url`, `cancel_url`, Stripe Tax activé). Renvoie l'URL Checkout.
3. Redirection vers Stripe → saisie carte → retour `success_url` (`/welcome?session_id=...`).
4. Page de retour : appelle `/api/billing/sync?session_id=...` (synchro immédiate) puis **poll** `/api/auth/user` jusqu'à `trialing` → entre dans l'app.

### 5.2 Code d'accès (testeurs)
- Sur le paywall : champ « J'ai un code d'accès » → `POST /api/billing/redeem-code { code }`.
- Validation : code actif, non expiré, `redemptionCount < maxRedemptions`, pas déjà utilisé par ce user.
- Succès : `users.role = 'comped'`, insert dans `access_code_redemptions`, `redemptionCount++`.
- Le front refetch `/api/auth/user` → accès.

### 5.3 Gestion de l'abonnement
- `POST /api/billing/portal` → crée une **Billing Portal Session** Stripe → redirige. Annulation, moyen de paiement, factures : 100 % géré par Stripe.
- Bouton « Gérer mon abonnement » dans **Réglages**.

### 5.4 Webhooks — `POST /api/stripe/webhook`
Événements traités → upsert `subscriptions` :
- `checkout.session.completed`
- `customer.subscription.created` / `.updated` / `.deleted`
- `invoice.paid` / `invoice.payment_failed`

Détail technique : route montée avec **`express.raw({type:'application/json'})` AVANT `express.json()`** (Stripe exige le corps brut pour vérifier la signature).

---

## 6. Gating front (`client/src/App.tsx`)
- Non authentifié → **landing** (CTA « Commencer l'essai gratuit » → inscription → checkout).
- Authentifié **avec accès** (règle §4) → app complète.
- Authentifié **sans accès** → page **`Paywall`** : bouton « S'abonner — 7 jours gratuits » (relance checkout) + champ code d'accès.
- Le statut d'accès est porté par `/api/auth/user` (`{ ...user, access: { allowed, status, trialEndsAt } }`).

## 7. Gating back
- Middleware **`requireActiveSubscription`** appliqué aux routes de données métier (après `isAuthenticated`). S'applique web **et** mobile (JWT). Les routes d'auth, billing, webhook et le redeem de code en sont exclues.

---

## 8. Sortie du waitlist
- `WAITLIST_MODE` / `VITE_WAITLIST_MODE` → `false`.
- Landing : CTA principal = abonnement (le formulaire waitlist reste dans le code, dormant, réactivable).
- Migration : `users.role` par défaut `user` ; passer le compte de Jeanne en `owner` (script ponctuel ou requête SQL ciblée).

---

## 9. Configuration (env)
| Variable | Rôle |
|----------|------|
| `STRIPE_SECRET_KEY` | clé API serveur |
| `STRIPE_WEBHOOK_SECRET` | vérif. signature webhook |
| `STRIPE_PRICE_ID` | le prix 29 €/mois (créé dans le dashboard) |
| `STRIPE_PORTAL_RETURN_URL` | retour après le portail |
| `APP_URL` | déjà présent — base des success/cancel URLs |

Côté dashboard Stripe (actions de Jeanne, guidées) : créer le produit/prix 29 €/mois, activer **Stripe Tax**, activer le **Customer Portal**, configurer l'endpoint webhook.

---

## 10. Découpage en unités (isolation)
- `server/services/stripe.ts` — client Stripe (version figée) + helpers (createCustomer, createCheckoutSession, createPortalSession, fetchSubscription).
- `server/services/billing.ts` — logique métier : `syncSubscriptionFromStripe`, `hasNayaAccess`, redeem de code.
- `server/routes/billing.ts` (ou section dédiée de routes.ts) — endpoints `/api/billing/*`.
- `server/routes/stripe-webhook.ts` — route webhook isolée (corps brut).
- `server/middleware/requireActiveSubscription.ts`.
- `client/src/pages/paywall.tsx` + `client/src/pages/welcome.tsx` (retour checkout) + bouton portail dans Réglages.
- Storage : méthodes `getSubscription(userId)`, `upsertSubscription`, `setUserRole`, `redeemAccessCode`, `createAccessCode`.

---

## 11. Stratégie de test (sur branche Neon de dev + Stripe test mode)
- Mode **test Stripe** + **Test Clock** : simuler J+7 (fin d'essai → 1er prélèvement) et un renouvellement.
- Webhooks locaux via **Stripe CLI** (`stripe listen --forward-to localhost:3000/api/stripe/webhook`).
- Cas couverts : inscription→trial→accès ; échec de paiement→past_due→coupure à period end ; annulation via portail→accès jusqu'à period end→coupure ; redeem code→comped ; owner bypass ; idempotence webhook (rejouer un event) ; réconciliation (vider le cache local → refetch Stripe).
- `tsc` : 0 erreur ; aucun test ne déclenche d'action prod.

---

## 12. Hors périmètre (YAGNI)
- Plusieurs offres / paliers, annuel, codes promo Stripe, parrainage, facturation par siège.
- Achats in-app mobile (Apple/Google).
- Réactivation automatique post-annulation autre que via le portail Stripe.
