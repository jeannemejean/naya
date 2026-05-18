import { useState } from "react";
import { Target, Brain, Calendar, MessageSquare, BarChart3, Lightbulb } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation } from "@tanstack/react-query";
import AuthDialog from "@/components/auth-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiRequest } from "@/lib/queryClient";

export default function Landing() {
  const { t, i18n } = useTranslation();
  const [authDialogOpen, setAuthDialogOpen] = useState(false);
  const [authDialogTab,  setAuthDialogTab]  = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const { data: config } = useQuery<{ waitlistMode: boolean }>({
    queryKey: ["/api/config"],
    staleTime: Infinity,
  });

  const waitlistMode = config?.waitlistMode ?? false;

  const waitlistMutation = useMutation({
    mutationFn: (emailVal: string) =>
      apiRequest("POST", "/api/waitlist", { email: emailVal, language: i18n.language }).then(r => r.json()),
    onSuccess: (data: any) => {
      if (data.error === "already_registered") {
        setSubmitError(t("landing.waitlistDuplicate"));
      } else {
        setSubmitted(true);
        setSubmitError(null);
      }
    },
    onError: () => setSubmitError(t("landing.waitlistError")),
  });

  const handleOpenAuth = (tab: "login" | "register" = "login") => {
    setAuthDialogTab(tab);
    setAuthDialogOpen(true);
  };

  const handleWaitlistSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !email.includes("@")) return;
    setSubmitError(null);
    waitlistMutation.mutate(email.trim());
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
        {!waitlistMode && (
          <button
            onClick={() => handleOpenAuth("login")}
            data-testid="auth-login"
            className="eyebrow text-[10px] hover:text-naya-olive transition-colors duration-base ease-quiet border-b border-transparent hover:border-naya-olive-35 pb-px cursor-pointer"
          >
            {t('landing.meetNaya')}
          </button>
        )}
      </header>

      {/* ── Hero ── */}
      <section className="flex-1 flex flex-col items-center justify-center text-center px-6 pt-24 pb-20">

        <p className="eyebrow text-[10px] text-naya-olive-35 mb-8 tracking-[0.25em]">
          {waitlistMode ? t('landing.waitlistEyebrow') : t('landing.heroEyebrow')}
        </p>

        <h1
          className="font-display font-light uppercase tracking-[0.08em] text-naya-olive leading-[1.05] mb-8"
          style={{ fontSize: 'clamp(2.6rem, 6vw, 5rem)', maxWidth: 780 }}
        >
          {t('landing.heroTitle')}
        </h1>

        <p className="text-base text-naya-olive-55 leading-[1.75] mb-10 max-w-[460px]">
          {t('landing.heroDescription')}
        </p>

        {/* ── CTAs : waitlist mode ou auth normal ── */}
        {waitlistMode ? (
          <div className="w-full max-w-[400px]">
            {submitted ? (
              <div className="text-center space-y-2 py-4">
                <p className="font-display uppercase tracking-[0.18em] text-[13px] text-naya-olive">
                  {t('landing.waitlistConfirm')}
                </p>
                <p className="text-sm text-naya-olive-55">
                  {t('landing.waitlistConfirmSub')}
                </p>
              </div>
            ) : (
              <form onSubmit={handleWaitlistSubmit} className="flex flex-col sm:flex-row gap-2">
                <Input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder={t('landing.waitlistPlaceholder')}
                  required
                  className="flex-1 bg-white border-naya-olive-18 focus:border-naya-olive text-sm"
                />
                <Button
                  type="submit"
                  variant="display"
                  disabled={waitlistMutation.isPending}
                  className="shrink-0"
                >
                  {waitlistMutation.isPending
                    ? t('landing.waitlistCtaLoading')
                    : t('landing.waitlistCta')}
                </Button>
              </form>
            )}
            {submitError && (
              <p className="mt-2 text-[12px] text-red-500 text-center">{submitError}</p>
            )}
          </div>
        ) : (
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
        )}

        <p className="mt-12 text-[11px] text-naya-olive-18 font-display uppercase tracking-[0.18em]">
          {t('landing.heroCredibility')}
        </p>
      </section>

      {/* ── Hairline separator ── */}
      <div className="border-t border-naya-olive-10" />

      {/* ── Features ── */}
      <section className="bg-naya-cream px-6 py-20">
        <div className="max-w-[960px] mx-auto">
          <div className="text-center mb-16">
            <p className="eyebrow text-[10px] tracking-[0.25em] text-naya-olive-35 mb-5">
              {t('landing.notJustSmart')}
            </p>
            <p className="text-base text-naya-olive-55 leading-[1.75] max-w-[440px] mx-auto">
              {t('landing.notJustSmartDescription')}
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-px bg-naya-olive-10 border border-naya-olive-10">
            {features.map(({ icon: Icon, key }) => (
              <div
                key={key}
                className="bg-naya-cream p-9 hover:bg-naya-olive-06 transition-colors duration-300 ease-quiet group"
              >
                <div className="w-10 h-10 flex items-center justify-center border border-naya-olive-18 rounded-sm mb-7 group-hover:border-naya-olive-35 transition-colors">
                  <Icon size={20} strokeWidth={1.4} className="text-naya-olive-55" />
                </div>
                <p className="font-display uppercase tracking-[0.18em] text-[10px] text-naya-olive mb-3">
                  {t(`landing.${key}`)}
                </p>
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
          {waitlistMode ? (
            submitted ? (
              <p className="font-display uppercase tracking-[0.18em] text-[11px] text-naya-cream/60">
                {t('landing.waitlistConfirm')}
              </p>
            ) : (
              <form onSubmit={handleWaitlistSubmit} className="flex flex-col sm:flex-row gap-2 max-w-[360px] mx-auto">
                <Input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder={t('landing.waitlistPlaceholder')}
                  required
                  className="flex-1 bg-naya-olive/20 border-naya-cream/20 text-naya-cream placeholder:text-naya-cream/40 focus:border-naya-cream/50 text-sm"
                />
                <button
                  type="submit"
                  disabled={waitlistMutation.isPending}
                  className="shrink-0 inline-flex items-center justify-center gap-2 px-6 h-10 bg-naya-cream text-naya-olive font-display uppercase tracking-[0.18em] text-[10px] rounded-md hover:opacity-90 transition-opacity duration-base cursor-pointer disabled:opacity-50"
                >
                  {waitlistMutation.isPending ? t('landing.waitlistCtaLoading') : t('landing.waitlistCta')}
                </button>
              </form>
            )
          ) : (
            <button
              onClick={() => handleOpenAuth("register")}
              className="inline-flex items-center gap-2 px-9 h-12 bg-naya-cream text-naya-olive font-display uppercase tracking-[0.18em] text-[10px] rounded-md hover:opacity-90 transition-opacity duration-base cursor-pointer"
            >
              {t('landing.startWithNaya')}
            </button>
          )}
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

      {!waitlistMode && (
        <AuthDialog
          open={authDialogOpen}
          onOpenChange={setAuthDialogOpen}
          defaultTab={authDialogTab}
        />
      )}
    </div>
  );
}
