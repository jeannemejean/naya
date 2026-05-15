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
    <div className="min-h-screen naya-paper flex flex-col">

      {/* ── Header ── */}
      <header className="px-8 py-4 border-b border-naya-olive-10 bg-naya-cream/90 backdrop-blur-sm flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <img src="/naya-mark-elephant.png" alt="Naya" className="w-14 h-14 object-contain" />
          <span className="wordmark text-sm tracking-[0.22em]">NAYA</span>
        </div>
        <button
          onClick={() => handleOpenAuth("login")}
          data-testid="auth-login"
          className="eyebrow text-[10px] hover:text-naya-olive transition-colors duration-base ease-quiet border-b border-transparent hover:border-naya-olive-35 pb-px cursor-pointer"
        >
          {t('landing.meetNaya')}
        </button>
      </header>

      {/* ── Hero ── */}
      <section className="flex-1 flex flex-col items-center justify-center text-center px-6 pt-24 pb-20">

        {/* Eyebrow */}
        <p className="eyebrow text-[10px] text-naya-olive-35 mb-8 tracking-[0.25em]">
          {t('landing.heroEyebrow')}
        </p>

        {/* Title */}
        <h1
          className="font-display font-light uppercase tracking-[0.08em] text-naya-olive leading-[1.05] mb-8"
          style={{ fontSize: 'clamp(2.6rem, 6vw, 5rem)', maxWidth: 780 }}
        >
          {t('landing.heroTitle')}
        </h1>

        {/* Description */}
        <p className="text-base text-naya-olive-55 leading-[1.75] mb-10 max-w-[460px]">
          {t('landing.heroDescription')}
        </p>

        {/* CTAs */}
        <div className="flex items-center gap-3 flex-wrap justify-center">
          <Button
            variant="display"
            size="lg"
            onClick={() => handleOpenAuth("register")}
            data-testid="auth-register-hero"
          >
            {t('landing.meetNaya')}
          </Button>
          <button
            onClick={() => handleOpenAuth("login")}
            className="eyebrow text-[10px] tracking-[0.18em] text-naya-olive-55 hover:text-naya-olive transition-colors border-b border-naya-olive-18 hover:border-naya-olive-35 pb-px cursor-pointer"
          >
            {t('landing.seeHowItWorks')} →
          </button>
        </div>

        {/* Subtle social proof / credibility line */}
        <p className="mt-12 text-[11px] text-naya-olive-18 font-display uppercase tracking-[0.18em]">
          {t('landing.heroCredibility')}
        </p>
      </section>

      {/* ── Hairline separator ── */}
      <div className="border-t border-naya-olive-10" />

      {/* ── Features ── */}
      <section className="bg-naya-cream px-6 py-20">
        <div className="max-w-[960px] mx-auto">

          {/* Section header */}
          <div className="text-center mb-16">
            <p className="eyebrow text-[10px] tracking-[0.25em] text-naya-olive-35 mb-5">
              {t('landing.notJustSmart')}
            </p>
            <p className="text-base text-naya-olive-55 leading-[1.75] max-w-[440px] mx-auto">
              {t('landing.notJustSmartDescription')}
            </p>
          </div>

          {/* Feature grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-px bg-naya-olive-10 border border-naya-olive-10">
            {features.map(({ icon: Icon, key }) => (
              <div
                key={key}
                className="bg-naya-cream p-9 hover:bg-naya-olive-06 transition-colors duration-300 ease-quiet group"
              >
                {/* Icon container */}
                <div className="w-10 h-10 flex items-center justify-center border border-naya-olive-18 rounded-sm mb-7 group-hover:border-naya-olive-35 transition-colors">
                  <Icon size={20} strokeWidth={1.4} className="text-naya-olive-55" />
                </div>
                {/* Title */}
                <p className="font-display uppercase tracking-[0.18em] text-[10px] text-naya-olive mb-3">
                  {t(`landing.${key}`)}
                </p>
                {/* Description */}
                <p className="text-[13px] text-naya-olive-55 leading-[1.7]">
                  {t(`landing.${key}Description`)}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA inverse ── */}
      <section className="naya-paper-inverse px-6 py-24">
        <div className="max-w-[520px] mx-auto text-center">
          <p className="eyebrow text-[10px] tracking-[0.25em] text-naya-cream/40 mb-6">
            {t('landing.ctaTitle')}
          </p>
          <p className="text-[15px] text-naya-cream/60 leading-[1.75] mb-10">
            {t('landing.ctaSubtitle')}
          </p>
          <button
            onClick={() => handleOpenAuth("register")}
            className="inline-flex items-center gap-2 px-9 h-12 bg-naya-cream text-naya-olive font-display uppercase tracking-[0.18em] text-[10px] rounded-md hover:opacity-90 transition-opacity duration-base cursor-pointer"
          >
            {t('landing.startWithNaya')}
          </button>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="px-8 py-7 bg-naya-olive border-t border-naya-olive-35 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <img src="/naya-mark-elephant.png" alt="" className="w-12 h-12 object-contain opacity-40" />
          <span className="wordmark text-xs text-naya-cream/60 tracking-[0.22em]">NAYA</span>
        </div>
        <p className="text-[11px] text-naya-cream/30 font-display uppercase tracking-[0.15em]">
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
