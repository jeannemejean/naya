import { Switch, Route, useLocation } from "wouter";
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
import Dashboard from "@/pages/dashboard";
import NayaCompanion from "@/components/NayaCompanion";

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

function Router() {
  const { isAuthenticated, isLoading } = useAuth();
  const qc = useQueryClient();
  const { isOpen, setIsOpen, openSearch } = useGlobalSearch();
  const [location] = useLocation();

  // Prefetch brand-dna as soon as auth confirms — avoids spinner on first dashboard visit
  useEffect(() => {
    if (isAuthenticated) {
      qc.prefetchQuery({ queryKey: ["/api/brand-dna"] });
      qc.prefetchQuery({ queryKey: ["/api/projects?limit=200"] });
    }
  }, [isAuthenticated, qc]);
  // Le dashboard a sa propre barre Companion dans le header — pas de bouton flottant
  const showFloatingCompanion = isAuthenticated && location !== "/";

  return (
    <>
      <Suspense fallback={
        <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', background: 'var(--background)' }}>
          <span style={{ fontFamily: '"Unbounded", system-ui, sans-serif', fontSize: '1.5rem', color: 'var(--muted-foreground)', letterSpacing: '0.15em', animation: 'fade-in 0.3s ease both' }}>
            Naya
          </span>
        </div>
      }>
      <Switch>
        {isLoading || !isAuthenticated ? (
          <Route path="/" component={Landing} />
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
            <Router />
          </TooltipProvider>
        </ProjectProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
