# Naya

OS IA pour entrepreneurs et builders indépendants.

## Stack

| Couche | Technologie |
|--------|-------------|
| Web frontend | React + TypeScript + Vite + Tailwind + shadcn/ui |
| Mobile | React Native + Expo Router |
| Backend | Node.js + Express + TypeScript |
| Base de données | PostgreSQL + Drizzle ORM |
| IA | Anthropic Claude Sonnet `claude-sonnet-4-6` |
| Auth web | Session cookie (express-session + bcrypt) |
| Auth mobile | JWT (AsyncStorage) |
| Déploiement | Railway (web + API) + EAS Build (mobile) |

---

## Setup local

### 1. Prérequis

- Node.js 20+
- PostgreSQL (ou compte [Neon](https://neon.tech) gratuit)
- Clé API [Anthropic](https://console.anthropic.com)

### 2. Cloner et installer

```bash
git clone <repo>
cd NayaVision-29
npm install
```

### 3. Variables d'environnement

```bash
cp .env.example .env
# Remplis les valeurs dans .env
```

Champs requis :
- `DATABASE_URL` — connexion PostgreSQL
- `ANTHROPIC_API_KEY` — clé Claude
- `SESSION_SECRET` — chaîne aléatoire ≥ 32 chars (`openssl rand -base64 32`)
- `JWT_SECRET` — chaîne aléatoire ≥ 64 chars (`openssl rand -base64 64`)

### 4. Base de données

```bash
npm run db:push
```

### 5. Lancer en développement

```bash
npm run dev
```

L'app tourne sur `http://localhost:5000`.

---

## App Mobile

```bash
cd mobile
npm install
```

Mettre l'IP LAN de ton Mac dans `mobile/.env` :
```env
EXPO_PUBLIC_API_URL=http://192.168.1.XX:5000
```

```bash
npx expo start
```

Scanner le QR code avec **Expo Go** (iOS/Android).

---

## Commandes

```bash
npm run dev        # développement (web + serveur)
npm run build      # build production
npm run start      # lancer le build de prod
npm run db:push    # appliquer les migrations Drizzle
npm run check      # vérification TypeScript
```

---

## Déploiement Railway

### Prérequis
- Compte [Railway](https://railway.app)
- DB PostgreSQL provisionnée (Railway PostgreSQL ou [Neon](https://neon.tech))
- Clés API Anthropic et OpenAI

### Étapes

**1. Créer le projet Railway**

Depuis [railway.app](https://railway.app) : `New Project → Deploy from GitHub repo`

**2. Ajouter une DB PostgreSQL**

Dans Railway : `New Service → Database → PostgreSQL`
Le `DATABASE_URL` est automatiquement injecté dans les variables d'environnement.

**3. Configurer les variables d'environnement**

Dans Railway → ton service → Variables :

| Variable | Valeur |
|----------|--------|
| `ANTHROPIC_API_KEY` | `sk-ant-...` |
| `OPENAI_API_KEY` | `sk-...` |
| `SESSION_SECRET` | résultat de `openssl rand -base64 32` |
| `JWT_SECRET` | résultat de `openssl rand -base64 64` |
| `NODE_ENV` | `production` |
| `EXPO_PUBLIC_API_URL` | `https://ton-app.up.railway.app` |

`PORT` et `DATABASE_URL` sont injectés automatiquement par Railway.

**4. Appliquer le schéma DB**

```bash
# En local, avec le DATABASE_URL de production
DATABASE_URL=postgresql://... npm run db:push
```

**5. Déployer**

Railway déploie automatiquement à chaque push sur la branche principale.
Build : `npm run build` → Start : `npm run start`

### Health check

Railway surveille `GET /api/health` toutes les 100s.
- `200 { status: 'ok', db: 'connected' }` → service healthy
- `503 { status: 'error', db: 'disconnected' }` → Railway redémarre le service

### Rollback

Railway → Deployments → sélectionner un déploiement précédent → `Redeploy`.

---

## Architecture

```
naya/
├── server/          ← API Express + PostgreSQL
│   ├── index.ts
│   ├── routes.ts
│   ├── auth.ts                    ← Auth (session cookie + JWT)
│   ├── db.ts
│   ├── storage.ts
│   └── services/
│       ├── claude.ts              ← Appels Claude
│       ├── naya-context.ts        ← buildNayaContext() — contexte IA complet
│       ├── milestone-engine.ts    ← Jalons conditionnels
│       └── companion.ts           ← /api/companion/chat
├── client/          ← React + Vite
│   └── src/
│       ├── pages/
│       └── components/
│           └── NayaCompanion.tsx  ← Chat IA flottant
├── mobile/          ← React Native + Expo
│   └── app/
│       └── (tabs)/
│           ├── index.tsx          ← Aujourd'hui
│           ├── companion.tsx      ← Companion IA
│           ├── capture.tsx        ← Quick Capture
│           ├── projects.tsx       ← Projets + Roadmap jalons
│           └── profile.tsx
└── shared/
    ├── schema.ts    ← Schéma DB Drizzle (source de vérité)
    └── types.ts
```
