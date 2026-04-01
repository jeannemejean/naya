import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Target, Brain, Calendar, MessageSquare, BarChart3, Lightbulb } from "lucide-react";
import { useTranslation } from "react-i18next";
import AuthDialog from "@/components/auth-dialog";

export default function Landing() {
  const { t } = useTranslation();
  const [authDialogOpen, setAuthDialogOpen] = useState(false);
  const [authDialogTab, setAuthDialogTab] = useState<"login" | "register">("login");

  const handleOpenAuth = (tab: "login" | "register" = "login") => {
    setAuthDialogTab(tab);
    setAuthDialogOpen(true);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-muted/30 to-background">
      {/* Editorial Header — Clean & elegant */}
      <header className="px-8 py-6 border-b border-border bg-card/80 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <div className="w-10 h-10 bg-gradient-to-br from-primary to-primary/80 rounded-xl flex items-center justify-center shadow-sm">
              <span className="text-white font-display text-lg">N</span>
            </div>
            <span className="text-2xl font-display text-foreground tracking-tight">Naya</span>
          </div>
          <Button
            onClick={() => handleOpenAuth("login")}
            variant="ghost"
            className="text-foreground/70 hover:text-foreground hover:bg-muted/50"
            data-testid="auth-login"
          >
            {t('landing.meetNaya')}
          </Button>
        </div>
      </header>

      {/* Hero Section — Magazine editorial style */}
      <section className="px-8 py-24 md:py-32">
        <div className="max-w-5xl mx-auto text-center space-editorial">
          <h1 className="text-6xl md:text-7xl font-display text-foreground mb-8 leading-[1.1] tracking-tight">
            {t('landing.heroTitle')}
            <span className="text-primary block mt-4 italic">{t('landing.heroSubtitle')}</span>
          </h1>
          <p className="text-xl md:text-2xl text-muted-foreground mb-12 max-w-3xl mx-auto font-serif leading-relaxed">
            {t('landing.heroDescription')}
          </p>
          <div className="flex flex-col sm:flex-row gap-5 justify-center items-center">
            <Button
              size="lg"
              className="bg-primary hover:bg-primary/90 text-white text-base px-10 py-7 rounded-xl shadow-editorial hover-lift"
              onClick={() => handleOpenAuth("register")}
              data-testid="auth-register-hero"
            >
              {t('landing.meetNaya')}
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="text-base px-10 py-7 rounded-xl border-2 hover:bg-muted/30"
              onClick={() => handleOpenAuth("login")}
            >
              {t('landing.seeHowItWorks')}
            </Button>
          </div>
        </div>
      </section>

      {/* Features Section — Clean grid with generous spacing */}
      <section className="px-8 py-24 bg-card">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-20 space-y-4">
            <h2 className="text-4xl md:text-5xl font-display text-foreground tracking-tight">
              {t('landing.notJustSmart')}
            </h2>
            <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto font-serif leading-relaxed">
              {t('landing.notJustSmartDescription')}
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8 md:gap-10">
            <Card className="border-border shadow-editorial hover-lift bg-card">
              <CardHeader className="space-y-4 pb-6">
                <div className="w-14 h-14 bg-primary/10 rounded-2xl flex items-center justify-center">
                  <Target className="w-7 h-7 text-primary" />
                </div>
                <CardTitle className="font-display text-2xl">{t('landing.pilotBoard')}</CardTitle>
                <CardDescription className="text-base leading-relaxed text-muted-foreground">
                  {t('landing.pilotBoardDescription')}
                </CardDescription>
              </CardHeader>
            </Card>

            <Card className="border-border shadow-editorial hover-lift bg-card">
              <CardHeader className="space-y-4 pb-6">
                <div className="w-14 h-14 bg-secondary/10 rounded-2xl flex items-center justify-center">
                  <Brain className="w-7 h-7 text-secondary" />
                </div>
                <CardTitle className="font-display text-2xl">{t('landing.weeklyIntelligence')}</CardTitle>
                <CardDescription className="text-base leading-relaxed text-muted-foreground">
                  {t('landing.weeklyIntelligenceDescription')}
                </CardDescription>
              </CardHeader>
            </Card>

            <Card className="border-border shadow-editorial hover-lift bg-card">
              <CardHeader className="space-y-4 pb-6">
                <div className="w-14 h-14 bg-accent/10 rounded-2xl flex items-center justify-center">
                  <BarChart3 className="w-7 h-7 text-accent" />
                </div>
                <CardTitle className="font-display text-2xl">{t('landing.campaignEngine')}</CardTitle>
                <CardDescription className="text-base leading-relaxed text-muted-foreground">
                  {t('landing.campaignEngineDescription')}
                </CardDescription>
              </CardHeader>
            </Card>

            <Card className="border-border shadow-editorial hover-lift bg-card">
              <CardHeader className="space-y-4 pb-6">
                <div className="w-14 h-14 bg-info/10 rounded-2xl flex items-center justify-center">
                  <Calendar className="w-7 h-7 text-info" />
                </div>
                <CardTitle className="font-display text-2xl">{t('landing.contentCalendar')}</CardTitle>
                <CardDescription className="text-base leading-relaxed text-muted-foreground">
                  {t('landing.contentCalendarDescription')}
                </CardDescription>
              </CardHeader>
            </Card>

            <Card className="border-border shadow-editorial hover-lift bg-card">
              <CardHeader className="space-y-4 pb-6">
                <div className="w-14 h-14 bg-primary/10 rounded-2xl flex items-center justify-center">
                  <MessageSquare className="w-7 h-7 text-primary" />
                </div>
                <CardTitle className="font-display text-2xl">{t('landing.outreachCrm')}</CardTitle>
                <CardDescription className="text-base leading-relaxed text-muted-foreground">
                  {t('landing.outreachCrmDescription')}
                </CardDescription>
              </CardHeader>
            </Card>

            <Card className="border-border shadow-editorial hover-lift bg-card">
              <CardHeader className="space-y-4 pb-6">
                <div className="w-14 h-14 bg-secondary/10 rounded-2xl flex items-center justify-center">
                  <Lightbulb className="w-7 h-7 text-secondary" />
                </div>
                <CardTitle className="font-display text-2xl">{t('landing.operatingProfile')}</CardTitle>
                <CardDescription className="text-base leading-relaxed text-muted-foreground">
                  {t('landing.operatingProfileDescription')}
                </CardDescription>
              </CardHeader>
            </Card>
          </div>
        </div>
      </section>

      {/* CTA Section — Elegant gradient with generous spacing */}
      <section className="px-8 py-28 bg-gradient-to-br from-primary via-primary/90 to-primary/80">
        <div className="max-w-4xl mx-auto text-center space-y-8">
          <h2 className="text-4xl md:text-5xl font-display text-white tracking-tight leading-tight">
            {t('landing.ctaTitle')}
          </h2>
          <p className="text-xl text-white/90 font-serif leading-relaxed max-w-2xl mx-auto">
            {t('landing.ctaSubtitle')}
          </p>
          <Button
            size="lg"
            variant="secondary"
            className="text-base px-12 py-7 rounded-xl shadow-editorial hover-lift bg-white hover:bg-white/95 text-foreground mt-4"
            onClick={() => handleOpenAuth("register")}
          >
            {t('landing.startWithNaya')}
          </Button>
        </div>
      </section>

      {/* Footer — Minimal & elegant */}
      <footer className="px-8 py-12 bg-foreground/95 text-background/80">
        <div className="max-w-7xl mx-auto text-center space-y-6">
          <div className="flex items-center justify-center space-x-4">
            <div className="w-9 h-9 bg-primary/90 rounded-xl flex items-center justify-center shadow-sm">
              <span className="text-white font-display text-base">N</span>
            </div>
            <span className="text-2xl font-display text-background">Naya</span>
          </div>
          <p className="text-sm text-background/60 font-serif">
            {t('landing.footer')}
          </p>
        </div>
      </footer>

      <AuthDialog
        open={authDialogOpen}
        onOpenChange={setAuthDialogOpen}
        defaultTab={authDialogTab}
      />
    </div>
  );
}
