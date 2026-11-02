// Routes de la boîte de réponses et de la désinscription publique. Les routes publiques sont
// enregistrées depuis `registerRoutes`, donc AVANT le fallback SPA/statique de index.ts.
import express, { type Express } from "express";
import { timingSafeEqual } from "node:crypto";
import { storage } from "./storage";
import { leadDuJeton } from "./services/desinscription";
import { normaliser, traiterEvenement, depsDepuisStorage } from "./services/reponses/ingestion";

function memeSecret(recu: string | undefined, attendu: string): boolean {
  if (!recu) return false;
  const a = Buffer.from(recu), b = Buffer.from(attendu);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Message d'erreur sans les paramètres SQL (qui contiendraient le corps des messages). */
const erreurSure = (e: any) => String(e?.message ?? e).split(/\bparams:/)[0].slice(0, 200);

const page = (titre: string, corps: string) => `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${titre}</title>
<style>body{font-family:system-ui,sans-serif;max-width:28rem;margin:4rem auto;padding:0 1rem;color:#222;line-height:1.5}
button{font:inherit;padding:.6rem 1.2rem;border:0;border-radius:.5rem;background:#222;color:#fff;cursor:pointer}</style>
</head><body>${corps}</body></html>`;

export function registerReponsesRoutes(app: Express) {
  // Publiques : pas d'isAuthenticated (le destinataire n'a pas de compte).
  // Un GET ne désinscrit jamais (les antivirus et aperçus suivent les liens).
  app.get("/desinscription/:jeton", (req, res) => {
    if (leadDuJeton(req.params.jeton) === null) {
      return res.status(404).type("html").send(page("Lien invalide", "<h1>Lien invalide</h1><p>Ce lien de désinscription n'est pas valide.</p>"));
    }
    res.type("html").send(page("Se désinscrire", `<h1>Se désinscrire</h1>
<p>Vous ne recevrez plus de messages de cet expéditeur.</p>
<form method="post"><button type="submit">Se désinscrire</button></form>`));
  });

  app.post("/desinscription/:jeton", async (req, res) => {
    const leadId = leadDuJeton(req.params.jeton);
    if (leadId === null) {
      return res.status(404).type("html").send(page("Lien invalide", "<h1>Lien invalide</h1><p>Ce lien de désinscription n'est pas valide.</p>"));
    }
    try {
      // Même chemin que le webhook SendGrid : définitif, la séquence entière s'arrête.
      await storage.updateLeadSequenceState(leadId, { status: "unsubscribed", nextRunAt: null } as any);
    } catch (e: any) {
      console.error(`[Desinscription] échec lead ${leadId} : ${String(e?.message ?? e)}`);
      return res.status(500).type("html").send(page("Erreur", "<h1>Une erreur est survenue</h1><p>Merci de réessayer dans un instant.</p>"));
    }
    res.type("html").send(page("Désinscription confirmée", "<h1>Vous êtes désinscrit</h1><p>Vous ne recevrez plus de messages.</p>"));
  });

  // Webhook Unipile (réponses, acceptations, suivi email, statut des comptes). Public,
  // authentifié par l'en-tête secret posé à la création du webhook (ensureWebhooks).
  // Le corps est lu en JSON quel que soit le Content-Type (index.ts monte le même parseur
  // avant express.json() global ; celui-ci ne s'applique que si le corps n'a pas été lu).
  // Jamais coupé par PROSPECTION_SENDING_ENABLED : c'est de la réception.
  app.post("/api/unipile/webhook", express.json({ type: () => true, limit: "2mb" }), (req, res) => {
    const secret = process.env.UNIPILE_WEBHOOK_SECRET;
    if (!secret) return res.status(503).json({ message: "webhook non configuré" });
    if (!memeSecret(req.get("Unipile-Auth"), secret)) return res.status(401).json({ message: "non autorisé" });
    // 200 tout de suite (Unipile attend une réponse en moins de 30 s), traitement ensuite.
    res.status(200).json({ ok: true });
    const evt = normaliser(req.body);
    if (!evt) return;
    traiterEvenement(evt, depsDepuisStorage(storage)).catch((e: any) => {
      console.error(`[Reponses] webhook ${evt.kind} non traité (compte ${evt.accountId}) : ${erreurSure(e)}`);
    });
  });
}
