import { useState } from "react";
import { Target, Brain, Calendar, MessageSquare, BarChart3, Lightbulb } from "lucide-react";
import { useTranslation } from "react-i18next";
import AuthDialog from "@/components/auth-dialog";
import { Button } from "@/components/ui/button";

export default function Landing() {
  const { t } = useTranslation();
  const [authDialogOpen, setAuthDialogOpen] = useState(false);
  const [authDialogTab,  setAuthDialogTab]  = useState<"login" | "register">("login");

  const handleOpenAuth = (tab: "login" | "register" = "login") => {
    setAuthDialogTab(tab);
    setAuthDialogOpen(true);
  };

  const features = [
    { icon: Target,        key: "pilotBoard" },
    { icon: Brain,         key: "weeklyIntelligence" },
    { icon: BarChart3,     key: "campaignEngine" },
    { icon: Calendar,      key: "contentCalendar" },
    { icon: MessageSquare, key: "outreachCrm" },
    { icon: Lightbulb,     key: "operatingProfile" },
  ] as const;

  return (
    <div className="min-h-screen naya-paper">

      {/* ── Header ── */}
      <header className="px-10 py-5 border-b border-naya-olive-10 bg-naya-cream/90 backdrop-blur-sm flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <img
            src="/naya-mark-elephant.png"
            alt="Naya"
            className="w-12 h-12 object-contain"
          />
          <span className="wordmark text-sm">NAYA</span>
        </div>

        <button
          onClick={() => handleOpenAuth("login")}
          data-testid="auth-login"
          className="eyebrow hover:text-naya-olive transition-colors duration-base ease-quiet border-b border-transparent hover:border-naya-olive-35 pb-px cursor-pointer"
        >
          {t('landing.meetNaya')}
        </button>
      </header>

      {/* ── Hero ── */}
      <section className="px-10 pt-20 pb-18 max-w-[740px] mx-auto">
        <p className="eyebrow mb-6">Intelligence stratégique · For builders</p>

        <h1 className="h1 text-[clamp(2rem,4vw,3.5rem)] mb-5">
          {t('landing.heroTitle')}
        </h1>

        <p className="text-base text-naya-olive-70 leading-[1.7] mb-10 max-w-[500px]">
          {t('landing.heroDescription')}
        </p>

        <div className="flex gap-2.5 flex-wrap">
          <Button
            variant="display"
            size="lg"
            onClick={() => handleOpenAuth("register")}
            data-testid="auth-register-hero"
          >
            {t('landing.meetNaya')}
          </Button>
          <Button
            variant="secondary"
            size="lg"
            onClick={() => handleOpenAuth("login")}
          >
            {t('landing.seeHowItWorks')}
          </Button>
        </div>
      </section>

      {/* ── Hairline ── */}
      <div className="border-t border-naya-olive-10 max-w-[900px] mx-auto" />

      {/* ── Features ── */}
      <section className="px-10 py-18 bg-naya-cream">
        <div className="max-w-[900px] mx-auto">
          <div className="mb-14">
            <p className="eyebrow mb-4">{t('landing.notJustSmart')}</p>
            <p className="text-base text-naya-olive-70 leading-[1.65] max-w-[480px]">
              {t('landing.notJustSmartDescription')}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-px bg-naya-olive-10 border border-naya-olive-10">
            {features.map(({ icon: Icon, key }) => (
              <div
                key={key}
                className="bg-naya-cream p-8 hover:bg-naya-olive-06 transition-colors duration-base ease-quiet"
              >
                <div className="w-11 h-11 flex items-center justify-center border border-naya-olive-18 rounded-sm mb-6">
                  <Icon size={22} strokeWidth={1.5} className="text-naya-olive-55" />
                </div>
                <p className="font-display uppercase tracking-xwide text-[11px] text-naya-olive mb-3">
                  {t(`landing.${key}`)}
                </p>
                <p className="text-sm text-naya-olive-70 leading-[1.65]">
                  {t(`landing.${key}Description`)}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA — olive paper ── */}
      <section className="px-10 py-20 naya-paper-inverse">
        <div className="max-w-[560px] mx-auto text-center">
          <h2 className="font-display uppercase tracking-xwide text-xl font-light text-naya-cream mb-4">
            {t('landing.ctaTitle')}
          </h2>
          <p className="text-base text-naya-cream/65 leading-[1.65] mb-9">
            {t('landing.ctaSubtitle')}
          </p>
          <button
            onClick={() => handleOpenAuth("register")}
            className="inline-flex items-center gap-2 px-8 h-11 bg-naya-cream text-naya-olive font-display uppercase tracking-xwide text-[11px] rounded-md hover:opacity-90 transition-opacity duration-base cursor-pointer"
          >
            {t('landing.startWithNaya')}
          </button>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="px-10 py-8 bg-naya-olive flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <img
            src="/naya-mark-elephant.png"
            alt=""
            className="w-9 h-9 object-contain opacity-60"
          />
          <span className="wordmark text-[11px] text-naya-cream/80">
            NAYA
          </span>
        </div>
        <p className="text-[13px] text-naya-cream/40">
          {t('landing.footer')}
        </p>
      </footer>

      <AuthDialog
        open={authDialogOpen}
        onOpenChange={setAuthDialogOpen}
        defaultTab={authDialogTab}
      />
    </div>
  );
}
