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

1. Créer un projet Railway
2. Connecter le dépôt GitHub
3. Ajouter un service PostgreSQL Railway (ou connecter Neon)
4. Renseigner les variables d'environnement (voir `.env.example`)
5. Railway détecte `railway.toml` et déploie automatiquement

Variables à renseigner dans Railway :
```
DATABASE_URL
ANTHROPIC_API_KEY
OPENAI_API_KEY
SESSION_SECRET
JWT_SECRET
NODE_ENV=production
PORT=5000
```

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
