import { Link } from "wouter";

export default function Terms() {
  return (
    <div className="min-h-screen naya-paper text-naya-olive">
      {/* Header */}
      <header
        className="px-6 sm:px-10 py-7 flex items-center justify-between border-b border-naya-olive-10 sticky top-0 z-20"
        style={{ background: "rgba(247,244,236,0.92)", backdropFilter: "blur(8px)" }}
      >
        <Link href="/" className="flex items-center gap-3 cursor-pointer">
          <img src="/naya-mark-elephant.png" alt="Naya" className="w-16 h-16 object-contain" />
          <span className="wordmark text-sm">NAYA</span>
        </Link>
        <Link href="/" className="font-mono text-[11px] text-naya-olive-35 hover:text-naya-olive transition-colors tracking-[0.04em] cursor-pointer">
          ← Retour
        </Link>
      </header>

      {/* Content */}
      <main className="max-w-2xl mx-auto px-6 sm:px-10 py-16 sm:py-24">

        <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-naya-olive-35 mb-8">
          Conditions d'utilisation
        </p>

        <h1
          className="font-display font-light uppercase text-naya-olive leading-[1.1] mb-4"
          style={{ fontSize: "clamp(1.6rem, 3.5vw, 2.6rem)", letterSpacing: "0.07em" }}
        >
          Les règles, simplement.
        </h1>

        <p className="font-mono text-[11px] text-naya-olive-35 tracking-[0.02em] mb-14">
          Dernière mise à jour : juin 2026
        </p>

        <div className="space-y-10 text-[15px] leading-[1.75] text-naya-olive-70">

          <section>
            <h2 className="font-display text-[13px] uppercase tracking-[0.12em] text-naya-olive mb-4">
              1. Acceptation
            </h2>
            <p>
              Naya est un OS stratégique IA pour fondateurs et entrepreneurs indépendants, édité et opéré par Jeanne Méjean (Agence JMD). En créant un compte ou en utilisant Naya, vous acceptez les présentes conditions. Si vous n'êtes pas d'accord, n'utilisez pas le service. Ces conditions complètent notre{" "}
              <Link href="/privacy" className="text-naya-olive border-b border-naya-olive-18 hover:border-naya-olive transition-colors">
                politique de confidentialité
              </Link>.
            </p>
          </section>

          <section>
            <h2 className="font-display text-[13px] uppercase tracking-[0.12em] text-naya-olive mb-4">
              2. Le service
            </h2>
            <p className="mb-4">
              Naya vous aide à piloter votre activité : réflexion stratégique assistée par IA, planification, génération de contenu, prospection, et — lorsque vous les connectez — création, programmation et <strong>publication de contenu en votre nom</strong> sur vos comptes de réseaux sociaux (Instagram, Facebook, LinkedIn, TikTok et X).
            </p>
            <p>
              Le service évolue : des fonctionnalités peuvent être ajoutées, modifiées ou retirées.
            </p>
          </section>

          <section>
            <h2 className="font-display text-[13px] uppercase tracking-[0.12em] text-naya-olive mb-4">
              3. Votre compte
            </h2>
            <p>
              Vous devez avoir au moins 18 ans et fournir des informations exactes. Vous êtes responsable de la confidentialité de vos identifiants et de toute activité réalisée depuis votre compte. Prévenez-nous immédiatement en cas d'usage non autorisé.
            </p>
          </section>

          <section>
            <h2 className="font-display text-[13px] uppercase tracking-[0.12em] text-naya-olive mb-4">
              4. Abonnement, essai et paiement
            </h2>
            <ul className="space-y-2 pl-4">
              {[
                "Naya est proposé par abonnement à 29 €/mois, avec une période d'essai gratuite de 7 jours.",
                "Les paiements sont traités par Stripe. L'abonnement est reconduit automatiquement chaque mois jusqu'à résiliation.",
                "Vous pouvez résilier à tout moment depuis votre espace de facturation ; l'accès reste actif jusqu'à la fin de la période en cours.",
                "Sauf disposition légale impérative, les sommes versées ne sont pas remboursables au prorata.",
              ].map((item, i) => (
                <li key={i} className="flex gap-3 items-start">
                  <span className="font-mono text-[10px] text-naya-olive-35 pt-1 shrink-0">—</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2 className="font-display text-[13px] uppercase tracking-[0.12em] text-naya-olive mb-4">
              5. Comptes tiers connectés
            </h2>
            <p className="mb-4">
              Lorsque vous connectez un réseau social, vous autorisez Naya à agir <strong>en votre nom</strong> pour les seules actions que vous déclenchez (publier, programmer, lire vos statistiques). Vous gardez le contrôle : vous validez le contenu et pouvez déconnecter un compte à tout moment.
            </p>
            <p>
              Votre utilisation de chaque réseau reste soumise aux conditions de la plateforme concernée — notamment les <strong>Conditions des plateformes Meta</strong> (Instagram, Facebook), le <strong>LinkedIn API Terms of Use</strong>, les <strong>TikTok Developer Terms</strong> et les conditions de X. Vous êtes responsable du respect de ces règles et du contenu que vous publiez via Naya.
            </p>
          </section>

          <section>
            <h2 className="font-display text-[13px] uppercase tracking-[0.12em] text-naya-olive mb-4">
              6. Usage acceptable
            </h2>
            <p className="mb-4">
              Vous vous engagez à ne pas utiliser Naya pour :
            </p>
            <ul className="space-y-2 pl-4">
              {[
                "Publier du contenu illégal, trompeur, diffamatoire, haineux ou portant atteinte aux droits d'autrui.",
                "Envoyer du spam ou contourner les limites et politiques des API des plateformes connectées.",
                "Usurper une identité, ou accéder au service de manière non autorisée.",
                "Perturber, surcharger ou tenter de compromettre l'infrastructure du service.",
              ].map((item, i) => (
                <li key={i} className="flex gap-3 items-start">
                  <span className="font-mono text-[10px] text-naya-olive-35 pt-1 shrink-0">—</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2 className="font-display text-[13px] uppercase tracking-[0.12em] text-naya-olive mb-4">
              7. Contenu généré par IA
            </h2>
            <p>
              Naya peut générer des textes, suggestions et visuels à l'aide de modèles d'IA. Ces résultats peuvent comporter des erreurs ou imprécisions. Vous restez seul responsable de la <strong>relecture et de la validation</strong> de tout contenu avant publication. Naya ne garantit ni l'exactitude, ni l'adéquation des contenus générés.
            </p>
          </section>

          <section>
            <h2 className="font-display text-[13px] uppercase tracking-[0.12em] text-naya-olive mb-4">
              8. Propriété intellectuelle
            </h2>
            <p>
              Vous conservez la propriété du contenu que vous créez et publiez via Naya. Vous nous accordez une licence limitée, le temps nécessaire à l'exécution du service (stockage, mise en forme, publication sur les comptes que vous connectez). La plateforme Naya, sa marque, son design et son code restent notre propriété.
            </p>
          </section>

          <section>
            <h2 className="font-display text-[13px] uppercase tracking-[0.12em] text-naya-olive mb-4">
              9. Données personnelles
            </h2>
            <p>
              Le traitement de vos données est décrit dans notre{" "}
              <Link href="/privacy" className="text-naya-olive border-b border-naya-olive-18 hover:border-naya-olive transition-colors">
                politique de confidentialité
              </Link>. Vous pouvez demander la suppression de vos données via la page{" "}
              <Link href="/data-deletion" className="text-naya-olive border-b border-naya-olive-18 hover:border-naya-olive transition-colors">
                Suppression des données
              </Link>.
            </p>
          </section>

          <section>
            <h2 className="font-display text-[13px] uppercase tracking-[0.12em] text-naya-olive mb-4">
              10. Garanties et responsabilité
            </h2>
            <p>
              Le service est fourni « en l'état », sans garantie de disponibilité ininterrompue ni d'absence d'erreur. Naya dépend d'API tierces (réseaux sociaux, fournisseurs d'IA) dont les changements ou interruptions échappent à notre contrôle. Dans la limite permise par la loi, notre responsabilité est limitée au montant que vous avez payé au cours des douze derniers mois.
            </p>
          </section>

          <section>
            <h2 className="font-display text-[13px] uppercase tracking-[0.12em] text-naya-olive mb-4">
              11. Suspension et résiliation
            </h2>
            <p>
              Vous pouvez fermer votre compte à tout moment. Nous pouvons suspendre ou résilier un accès en cas de violation des présentes conditions ou des règles des plateformes connectées. À la résiliation, vos données sont supprimées conformément à notre politique de confidentialité.
            </p>
          </section>

          <section>
            <h2 className="font-display text-[13px] uppercase tracking-[0.12em] text-naya-olive mb-4">
              12. Modifications
            </h2>
            <p>
              Nous pouvons faire évoluer ces conditions. En cas de changement important, nous vous en informerons. Continuer à utiliser Naya après l'entrée en vigueur des nouvelles conditions vaut acceptation.
            </p>
          </section>

          <section>
            <h2 className="font-display text-[13px] uppercase tracking-[0.12em] text-naya-olive mb-4">
              13. Droit applicable
            </h2>
            <p>
              Les présentes conditions sont régies par le droit français. À défaut de résolution amiable, tout litige relève de la compétence des tribunaux français.
            </p>
          </section>

          <section>
            <h2 className="font-display text-[13px] uppercase tracking-[0.12em] text-naya-olive mb-4">
              14. Contact
            </h2>
            <p>
              Pour toute question relative à ces conditions :{" "}
              <a href="mailto:naya.ai.app@gmail.com" className="text-naya-olive border-b border-naya-olive-18 hover:border-naya-olive transition-colors">
                naya.ai.app@gmail.com
              </a>
            </p>
          </section>

        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-naya-olive-10 px-6 sm:px-10 py-7 flex items-center justify-between gap-4 flex-wrap max-w-2xl mx-auto">
        <span className="wordmark text-[10px] text-naya-olive-35">NAYA · 2026</span>
        <Link href="/privacy" className="font-mono text-[11px] text-naya-olive-35 hover:text-naya-olive transition-colors cursor-pointer tracking-[0.02em]">
          Confidentialité →
        </Link>
      </footer>
    </div>
  );
}
