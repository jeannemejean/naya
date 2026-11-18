import bcrypt from "bcryptjs";
import session from "express-session";
import connectPg from "connect-pg-simple";
import type { Express, RequestHandler } from "express";
import { nanoid } from "nanoid";
import jwt from "jsonwebtoken";
import { storage } from "./storage";
import type { User } from "@shared/schema";

// Session configuration
export function getSession() {
  const sessionTtl = 7 * 24 * 60 * 60 * 1000; // 1 week in ms
  const pgStore = connectPg(session);
  const sessionStore = new pgStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: false,
    ttl: sessionTtl / 1000, // connect-pg-simple expects seconds
    tableName: "sessions",
  });

  return session({
    secret: process.env.SESSION_SECRET || "naya-default-secret-change-in-production",
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    // La session web se prolonge à chaque requête : on ne perd pas la connexion en l'utilisant.
    rolling: true,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: sessionTtl,
    },
  });
}

// Password hashing
export async function hashPassword(password: string): Promise<string> {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(password, salt);
}

// Password verification
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// Generate user ID
export function generateUserId(): string {
  return nanoid();
}

// JWT — pour l'app mobile
export function generateJWT(userId: string): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not set");
  return jwt.sign({ userId }, secret, { expiresIn: "30d" });
}

// Renouvellement glissant (18 nov. 2026) : le jeton mobile durait 30 jours sans jamais se
// renouveler ; à son expiration, l'app recevait des 401 partout et montrait des écrans vides.
// Un jeton valide qui expire dans moins de 15 jours est remplacé à la volée (en-tête
// X-Naya-Token, que l'app enregistre) : tant que l'app sert, la connexion tient.
export const RENOUVELER_SOUS_S = 15 * 24 * 3600;
export function jetonARenouveler(exp: number | undefined, maintenantS: number): boolean {
  return typeof exp === "number" && exp - maintenantS < RENOUVELER_SOUS_S;
}

export function verifyJWT(token: string): { userId: string; exp?: number } | null {
  try {
    const secret = process.env.JWT_SECRET;
    if (!secret) return null;
    return jwt.verify(token, secret) as { userId: string; exp?: number };
  } catch {
    return null;
  }
}

// Setup auth middleware
export async function setupAuth(app: Express) {
  app.set("trust proxy", 1);
  app.use(getSession());
}

// Middleware unifié : cookie session (web) OU Bearer JWT (mobile)
export const isAuthenticated: RequestHandler = async (req, res, next) => {
  // Web : session cookie
  if (req.session?.userId) {
    (req as any).userId = req.session.userId;
    // Use cached user from session to avoid a DB round-trip on every request
    if ((req.session as any).cachedUser) {
      (req as any).user = (req.session as any).cachedUser;
      return next();
    }
    try {
      const user = await storage.getUser(req.session.userId);
      if (!user) return res.status(401).json({ message: "Unauthorized" });
      (req as any).user = user;
      (req.session as any).cachedUser = user;
      return next();
    } catch {
      return res.status(401).json({ message: "Unauthorized" });
    }
  }

  // Mobile : Bearer JWT
  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ")) {
    const payload = verifyJWT(auth.slice(7));
    if (payload) {
      try {
        const user = await storage.getUser(payload.userId);
        if (!user) return res.status(401).json({ message: "Unauthorized" });
        (req as any).userId = payload.userId;
        if (jetonARenouveler(payload.exp, Math.floor(Date.now() / 1000))) {
          try { res.setHeader("X-Naya-Token", generateJWT(payload.userId)); } catch { /* sans secret : on garde l'ancien */ }
        }
        // Rétrocompatibilité : les routes existantes lisent req.session.userId
        req.session.userId = payload.userId;
        (req as any).user = user;
        return next();
      } catch {
        return res.status(401).json({ message: "Unauthorized" });
      }
    }
  }

  return res.status(401).json({ message: "Unauthorized" });
};

// Extend Express session type
declare module "express-session" {
  interface SessionData {
    userId: string;
  }
}
