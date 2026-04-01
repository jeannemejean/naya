import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
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
import ContentCalendar from "@/pages/content-calendar";
import ReadingHub from "@/pages/reading-hub";
import Outreach from "@/pages/outreach";
import Analytics from "@/pages/analytics";
import Strategy from "@/pages/strategy";
import Onboarding from "@/pages/onboarding";
import Projects from "@/pages/projects";
import Settings from "@/pages/settings";
import Planning from "@/pages/planning";
import Campaigns from "@/pages/campaigns";
import NayaCompanion from "@/components/NayaCompanion";

function Router() {
  const { isAuthenticated, isLoading } = useAuth();
  const { isOpen, setIsOpen, openSearch } = useGlobalSearch();

  return (
    <>
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
      
      {/* Global Search - only when authenticated */}
      {isAuthenticated && (
        <GlobalSearch open={isOpen} onOpenChange={setIsOpen} />
      )}

      {/* Companion IA — bouton flottant */}
      {isAuthenticated && <NayaCompanion />}
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
