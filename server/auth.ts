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
  const sessionTtl = 7 * 24 * 60 * 60 * 1000; // 1 week
  const pgStore = connectPg(session);
  const sessionStore = new pgStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: false,
    ttl: sessionTtl,
    tableName: "sessions",
  });

  return session({
    secret: process.env.SESSION_SECRET || "naya-default-secret-change-in-production",
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
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

export function verifyJWT(token: string): { userId: string } | null {
  try {
    const secret = process.env.JWT_SECRET;
    if (!secret) return null;
    return jwt.verify(token, secret) as { userId: string };
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
    try {
      const user = await storage.getUser(req.session.userId);
      if (!user) return res.status(401).json({ message: "Unauthorized" });
      (req as any).user = user;
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
