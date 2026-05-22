import { Switch, Route, Router } from "wouter";
import { useHashLocationWithQuery } from "@/hooks/useHashLocationWithQuery";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/ThemeProvider";
import { ModeProvider } from "@/components/ModeProvider";
import { QuietModeProvider } from "@/components/QuietModeProvider";
import { LocationProvider } from "@/components/LocationProvider";
import { AppShell } from "@/components/AppShell";
import Home from "@/pages/Home";
import Music from "@/pages/Music";
import Watch from "@/pages/Watch";
import Events from "@/pages/Events";
import Places from "@/pages/Places";
import Finance from "@/pages/Finance";
import Saved from "@/pages/Saved";
import NotFound from "@/pages/not-found";
import { useEffect } from "react";

/**
 * Redirects via direct hash mutation. We bypass wouter's navigate because
 * with hash routing, a target like "/watch?tab=film" can land outside the
 * hash. Writing the hash directly guarantees the query lives inside it.
 */
function Redirect({ to }: { to: string }) {
  useEffect(() => {
    const target = `#${to.startsWith("/") ? to : "/" + to}`;
    if (window.location.hash !== target) {
      window.history.replaceState(null, "", target);
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    }
  }, [to]);
  return null;
}

function AppRouter() {
  return (
    <AppShell>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/music" component={Music} />
        <Route path="/watch" component={Watch} />
        <Route path="/events" component={Events} />
        <Route path="/places" component={Places} />
        <Route path="/finance" component={Finance} />
        <Route path="/saved" component={Saved} />
        {/* Legacy redirects — collapsed into parent pages */}
        <Route path="/film">{() => <Redirect to="/watch?tab=film" />}</Route>
        <Route path="/food">{() => <Redirect to="/places?tab=food" />}</Route>
        <Route path="/subscriptions">{() => <Redirect to="/finance?tab=subscriptions" />}</Route>
        <Route component={NotFound} />
      </Switch>
    </AppShell>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <ModeProvider>
          <QuietModeProvider>
            <LocationProvider>
              <TooltipProvider>
                <Toaster />
                <Router hook={useHashLocationWithQuery}>
                  <AppRouter />
                </Router>
              </TooltipProvider>
            </LocationProvider>
          </QuietModeProvider>
        </ModeProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
