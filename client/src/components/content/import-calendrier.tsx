// Dialogue de collage d'un calendrier de contenu (Tâche 6 du chantier « saisie manuelle »).
//
// Seule partie de ce chantier que l'utilisatrice voit : elle colle un texte libre (son
// calendrier écrit ailleurs — Notion, un brouillon, un email), et Naya le découpe en posts
// via POST /api/content/import (tâches 1-4). Ce composant ne décide rien du découpage : il
// envoie le texte, et affiche ce que le serveur a fait.
//
// Décisions suivies de ce chantier (voir task-6-brief.md) :
// - Le reçu ne passe PAS par un toast : `TOAST_LIMIT = 1` (client/src/hooks/use-toast.ts)
//   écraserait un second appel, et le reçu porte plusieurs faits à la fois. Le reçu REMPLACE
//   le champ de collage dans le dialogue, qui reste ouvert — pas affiché à côté, pour qu'on
//   ne puisse pas recoller par réflexe sur un texte déjà traité.
// - Le texte collé n'est JAMAIS perdu sur un échec : `texte` n'est effacé qu'après un import
//   qui a créé AU MOINS un post, affiché et refermé (voir `changerOuverture`) — jamais sur
//   une erreur HTTP, et jamais non plus sur un import à 0 post (fonctionnellement un échec :
//   rien n'a été ajouté à son calendrier, même si le serveur a répondu 200).
// - Un 400/404 est un échec DÉFINITIF (réessayer à l'identique produit la même erreur) : on
//   affiche le message du serveur, jamais une invite générique à réessayer qui mentirait.
//   Motif repris de `client/src/pages/project/BrandLinksPanel.tsx` (`messageDefinitif`).
// - La longueur est contrôlée AVANT l'envoi (`import-calendrier-limite.ts`, testé isolément) :
//   au-delà de la limite, le bouton est désactivé sans attendre un appel modèle pour un refus
//   déjà prévisible.
// - Le chrome statique (titre, placeholder, libellés de bouton) passe par `t()` — ce dépôt a
//   un cliquet (`client/src/locales/jsx-guard.test.ts`) qui interdit tout texte en dur dans un
//   fichier `.tsx` NOUVEAU. Le reçu lui-même (`import-calendrier-recu.ts`) reste en français
//   brut, non traduit : c'est une chaîne de variable (`{ligne}`), pas un littéral JSX, donc le
//   cliquet ne le voit pas — et le dupliquer en anglais referait la même logique
//   d'accord/énumération pour une langue qu'on ne demande pas ici.
import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ClipboardPaste } from "lucide-react";
import { fetchJson } from "@/lib/fetchJson";
import { tenterUneFois } from "@/lib/one-shot-guard";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MAX_CARACTERES, texteTropLong } from "./import-calendrier-limite";
import { construireRecu, type ReponseImportCalendrier } from "./import-calendrier-recu";

interface ImportCalendrierProps {
  projectId: number | null;
}

// Un échec HTTP arrive ici sous la forme posée par `throwIfResNotOk`
// (client/src/lib/queryClient.ts), relayée telle quelle par `fetchJson` :
// `new Error(`${status}: ${corpsBrut}`)`. Même extraction que `BrandLinksPanel.tsx` :
// le corps JSON embarqué dans le message, pour en lire `message`.
function messageDefinitif(error: unknown, statuts: readonly number[]): string | null {
  if (!(error instanceof Error)) return null;
  if (!statuts.some((s) => error.message.startsWith(`${s}:`))) return null;
  const corps = error.message.match(/\{[\s\S]*\}/);
  if (!corps) return null;
  try {
    const { message } = JSON.parse(corps[0]);
    return typeof message === "string" ? message : null;
  } catch {
    return null;
  }
}

/**
 * Message affiché sous le champ de collage après un échec. Trois cas distingués :
 * - 429 : quota IA épuisé pour le mois — un état connu, pas une panne ; le serveur ne rend
 *   qu'un code (`ai_monthly_limit_reached`), pas de phrase, donc on la fournit ici (même
 *   phrase que `NayaCompanion.tsx`, pour rester cohérente dans l'app).
 * - 400 / 404 : échec DÉFINITIF — le serveur a déjà formulé la bonne phrase (la limite ET la
 *   longueur reçue pour un texte trop long ; le projet introuvable sinon) — jamais de
 *   « réessaie » inventé qui mentirait sur ces deux cas.
 * - tout le reste (502 compris, réseau, 500) : un aléa pour lequel réessayer PEUT marcher —
 *   seul cas où une invite à réessayer est honnête.
 */
function messageEchec(error: unknown): string {
  if (error instanceof Error && error.message.startsWith("429:")) {
    return "Tu as atteint ta limite d'utilisation de l'IA pour ce mois-ci. Je serai de nouveau disponible le mois prochain.";
  }
  return messageDefinitif(error, [400, 404, 502]) ?? "L'import a échoué : réessaie.";
}

export function ImportCalendrier({ projectId }: ImportCalendrierProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [texte, setTexte] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [recu, setRecu] = useState<string[] | null>(null);
  // `true` dès qu'un import réussi a créé AU MOINS un post. Distingue un import à 0
  // post (fonctionnellement un échec — voir `changerOuverture`) d'un import qui a
  // réellement écrit quelque chose : `recu` seul ne permet pas cette distinction, il
  // contient les LIGNES affichées, pas le compte de posts.
  const [posteCree, setPosteCree] = useState(false);
  const queryClient = useQueryClient();

  // Verrou anti-double-clic : une `useRef`, pas un `state` — un double clic déclenché avant
  // le prochain rendu doit être bloqué DANS LE MÊME TICK, ce qu'un `state` ne garantit pas
  // (voir le commentaire de `@/lib/one-shot-guard`). `importMutation.isPending` reflète l'état
  // dans le JSX (bouton désactivé) mais ne fait pas foi pour la garde elle-même.
  const verrou = useRef(false);

  const importMutation = useMutation({
    mutationFn: (payload: { projectId: number; text: string }) =>
      fetchJson<ReponseImportCalendrier>("/api/content/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    onSuccess: (data) => {
      setErreur(null);
      setRecu(construireRecu(data));
      setPosteCree(data.posts.length > 0);
      if (projectId !== null) {
        // Préfixe partagé avec la requête de lecture (`['/api/content', selectedProjectId,
        // campaignFilter]` dans content-calendar.tsx) : invalider ce préfixe suffit, react-query
        // matche par préfixe de clé.
        queryClient.invalidateQueries({ queryKey: ["/api/content", projectId] });
      }
    },
    // throwOnError n'est pas en cause ici (il ne s'applique qu'aux `useQuery`), mais un
    // onError est de toute façon requis sur toute mutation de ce dépôt : sans lui, un échec
    // silencieux laisserait l'utilisatrice face à un bouton qui ne fait rien.
    onError: (error: unknown) => {
      setErreur(messageEchec(error));
    },
  });

  const longueur = texte.length;
  const tropLong = texteTropLong(longueur);
  const texteVide = texte.trim().length === 0;
  const boutonDesactive =
    texteVide || tropLong || projectId === null || importMutation.isPending;

  const lancerImport = () => {
    if (boutonDesactive || projectId === null) return;
    setErreur(null);
    // `tenterUneFois` : le `.catch` avale le rejet que `mutateAsync` propage en plus
    // d'appeler `onError` — sans lui, un rejet non observé logue un avertissement navigateur
    // alors que l'échec est déjà affiché par `onError`.
    tenterUneFois(verrou, () =>
      importMutation.mutateAsync({ projectId, text: texte }).catch(() => {}),
    );
  };

  // Fermeture du dialogue : l'erreur et le reçu ne sont remis à zéro que si un reçu est
  // affiché (import terminé, lu et fermé) — jamais après un échec réseau/serveur, pour ne
  // jamais perdre un texte qu'elle vient peut-être de coller depuis un endroit déjà fermé.
  //
  // Le TEXTE, lui, n'est effacé que si l'import a réellement créé au moins un post
  // (`posteCree`). Un import à 0 post pose quand même un reçu (ce n'est pas une erreur
  // HTTP), mais c'est fonctionnellement un échec pour elle : rien n'a été ajouté à son
  // calendrier. L'effacer ici romprait la promesse de tête de fichier — le texte collé
  // n'est jamais perdu sur un échec.
  const changerOuverture = (ouvert: boolean) => {
    setOpen(ouvert);
    if (!ouvert && recu) {
      if (posteCree) setTexte("");
      setErreur(null);
      setRecu(null);
      setPosteCree(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={changerOuverture}>
      <Button
        variant="outline"
        className="flex items-center gap-2"
        onClick={() => setOpen(true)}
      >
        <ClipboardPaste className="h-4 w-4" />
        {t("contentCalendar.importCalendrier.openImport")}
      </Button>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("contentCalendar.importCalendrier.title")}</DialogTitle>
        </DialogHeader>

        {recu ? (
          <div className="space-y-4">
            <div className="space-y-2 text-sm">
              {recu.map((ligne) => (
                <p key={ligne}>{ligne}</p>
              ))}
            </div>
            <DialogFooter>
              <Button onClick={() => changerOuverture(false)}>
                {t("contentCalendar.importCalendrier.close")}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-3">
            <Textarea
              value={texte}
              // L'erreur affichée (ex. "Texte trop long : 45000 caractères reçus") décrit
              // le texte AU MOMENT du dernier envoi. Si elle ne persiste qu'elle coupe son
              // texte, "45000" resterait affiché sous un compteur qui montre déjà "39000" —
              // deux énoncés contradictoires à l'écran. Toute frappe efface l'erreur : elle
              // redevient exacte dès le prochain essai, plutôt que de rester figée sur un
              // état du texte qui n'existe plus.
              onChange={(e) => { setTexte(e.target.value); setErreur(null); }}
              placeholder={t("contentCalendar.importCalendrier.placeholder")}
              className="min-h-[240px]"
              disabled={importMutation.isPending}
            />
            <div className="flex items-center justify-between text-xs">
              <span className="text-destructive">{erreur ?? ""}</span>
              <span className={tropLong ? "text-destructive" : "text-muted-foreground"}>
                {longueur} / {MAX_CARACTERES}
              </span>
            </div>
            <DialogFooter>
              <Button onClick={lancerImport} disabled={boutonDesactive}>
                {importMutation.isPending
                  ? t("contentCalendar.importCalendrier.submitting")
                  : t("contentCalendar.importCalendrier.submit")}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
