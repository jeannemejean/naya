import { Switch, Route } from "wouter";
import { lazy, Suspense, useEffect } from "react";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { ProjectProvider } from "@/lib/project-context";
import { useAuth } from "@/hooks/useAuth";
import { useGlobalSearch } from "@/hooks/useGlobalSearch";
import GlobalSearch from "@/components/global-search";
import NotFound from "@/pages/not-found";
import Landing from "@/pages/landing";
import Privacy from "@/pages/privacy";
import Terms from "@/pages/terms";
import DataDeletion from "@/pages/data-deletion";
import Paywall from "@/pages/paywall";
import Welcome from "@/pages/welcome";
import Dashboard from "@/pages/dashboard";
import NayaCompanion from "@/components/NayaCompanion";
import { ErrorBoundary } from "@/components/ErrorBoundary";

// Écran de chargement neutre — affiché tant que l'auth se résout (jamais Landing ni 404).
function LoadingScreen({ label = "Naya" }: { label?: string }) {
  return (
    <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', background: 'var(--background)' }}>
      <span style={{ fontFamily: '"Montserrat", system-ui, sans-serif', fontSize: '1.5rem', color: 'var(--muted-foreground)', letterSpacing: '0.15em', animation: 'fade-in 0.3s ease both' }}>
        {label}
      </span>
    </div>
  );
}

// Lazy-loaded pages (chargées à la demande)
const ContentCalendar = lazy(() => import("@/pages/content-calendar"));
const ReadingHub = lazy(() => import("@/pages/reading-hub"));
const Outreach = lazy(() => import("@/pages/outreach"));
const Analytics = lazy(() => import("@/pages/analytics"));
const Strategy = lazy(() => import("@/pages/strategy"));
const Onboarding = lazy(() => import("@/pages/onboarding"));
const Projects = lazy(() => import("@/pages/projects"));
const Settings = lazy(() => import("@/pages/settings"));
const Planning = lazy(() => import("@/pages/planning"));
const Campaigns = lazy(() => import("@/pages/campaigns"));
const CampaignWorkspace = lazy(() => import("@/pages/outreach/CampaignWorkspace"));

function Router() {
 const { isAuthenticated, isLoading, hasAccess } = useAuth();
 const qc = useQueryClient();
 const { isOpen, setIsOpen, openSearch } = useGlobalSearch();

 // Prefetch brand-dna as soon as auth confirms — avoids spinner on first dashboard visit
 useEffect(() => {
 if (isAuthenticated) {
 qc.prefetchQuery({ queryKey: ["/api/brand-dna"] });
 qc.prefetchQuery({ queryKey: ["/api/projects?limit=200"] });
 }
 }, [isAuthenticated, qc]);
 // Bouton flottant Naya sur toutes les pages authentifiées (dashboard inclus)
 const showFloatingCompanion = isAuthenticated && hasAccess;

 return (
 <>
 <Suspense fallback={<LoadingScreen />}>
 <Switch>
 <Route path="/privacy" component={Privacy} />
 <Route path="/terms" component={Terms} />
 <Route path="/data-deletion" component={DataDeletion} />
 {isLoading ? (
 <Route><LoadingScreen label="Naya prépare ton espace…" /></Route>
 ) : !isAuthenticated ? (
 <>
 <Route path="/" component={Landing} />
 <Route component={Landing} />
 </>
 ) : !hasAccess ? (
 <>
 <Route path="/welcome" component={Welcome} />
 <Route component={Paywall} />
 </>
 ) : (
 <>
 <Route path="/">
 {() => <Dashboard onSearchClick={openSearch} />}
 </Route>
 <Route path="/onboarding" component={Onboarding} />
 <Route path="/content-calendar">
 {() => <ContentCalendar onSearchClick={openSearch} />}
 </Route>
 <Route path="/reading-hub">
 {() => <ReadingHub onSearchClick={openSearch} />}
 </Route>
 <Route path="/outreach">
 {() => <Outreach onSearchClick={openSearch} />}
 </Route>
 <Route path="/outreach/campaigns/:id">
 {(params) => <CampaignWorkspace id={Number(params.id)} />}
 </Route>
 <Route path="/analytics">
 {() => <Analytics onSearchClick={openSearch} />}
 </Route>
 <Route path="/strategy">
 {() => <Strategy onSearchClick={openSearch} />}
 </Route>
 <Route path="/projects">
 {() => <Projects onSearchClick={openSearch} />}
 </Route>
 <Route path="/settings">
 {() => <Settings onSearchClick={openSearch} />}
 </Route>
 <Route path="/planning">
 {() => <Planning onSearchClick={openSearch} />}
 </Route>
 <Route path="/campaigns">
 {() => <Campaigns onSearchClick={openSearch} />}
 </Route>
 </>
 )}
 <Route component={NotFound} />
 </Switch>
 </Suspense>
 
 {/* Global Search - only when authenticated */}
 {isAuthenticated && (
 <GlobalSearch open={isOpen} onOpenChange={setIsOpen} />
 )}

 {/* Companion IA — bouton flottant (absent du dashboard qui a sa propre barre) */}
 {showFloatingCompanion && <NayaCompanion />}
 </>
 );
}

function App() {
 return (
 <QueryClientProvider client={queryClient}>
 <ThemeProvider>
 <ProjectProvider>
 <TooltipProvider>
 <Toaster />
 <ErrorBoundary>
 <Router />
 </ErrorBoundary>
 </TooltipProvider>
 </ProjectProvider>
 </ThemeProvider>
 </QueryClientProvider>
 );
}

export default App;
