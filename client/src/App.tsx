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
import { AuthProvider, useAuth } from "@/components/AuthProvider";
import { AppShell } from "@/components/AppShell";
import Home from "@/pages/Home";
import Music from "@/pages/Music";
import Watch from "@/pages/Watch";
import Events from "@/pages/Events";
import Places from "@/pages/Places";
import Finance from "@/pages/Finance";
import Saved from "@/pages/Saved";
import Landing from "@/pages/Landing";
import NotFound from "@/pages/not-found";
import { useEffect } from "react";
import { Logo } from "@/components/Logo";

/**
 * Redirects via direct hash mutation.
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

function LoadingSpinner() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <Logo size={32} className="text-teal animate-pulse" />
    </div>
  );
}

function AppRouter() {
  const { user, loading } = useAuth();

  if (loading) return <LoadingSpinner />;
  if (!user) return <Landing />;

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
        {/* Legacy redirects */}
        <Route path="/film">{() => <Redirect to="/watch?tab=film" />}</Route>
        <Route path="/food">{() => <Redirect to="/places?tab=food" />}</Route>
        <Route path="/subscriptions">{() => <Redirect to="/finance?tab=subscriptions" />}</Route>
        <Route component={NotFound} />
      </Switch>
    </AppShell>
  );
}

/**
 * Plaid OAuth bank redirect handler.
 *
 * Plaid redirects OAuth banks (Chase, BoA, etc.) back to the registered
 * PLAID_REDIRECT_URI with `?oauth_state_id=xxx`. Our app uses hash
 * routing, so this lands on `/` (Home page) and PlaidConnect — which
 * lives on the Finance page — never mounts to resume the flow. Result:
 * blue blank screen.
 *
 * On app startup, if we see `?oauth_state_id=` in the URL search, we
 * rewrite the URL to `#/finance?oauth_state_id=xxx` so the user lands
 * on the Finance page and PlaidConnect can pick up the OAuth state.
 */
function redirectPlaidOAuthIfPresent() {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  const oauthStateId = params.get("oauth_state_id");
  if (!oauthStateId) return;

  // CRITICAL: capture the ORIGINAL href before we rewrite it. Plaid Link's
  // receivedRedirectUri must EXACTLY match the redirect_uri registered in
  // the Plaid Dashboard (e.g. https://thelifeos.up.railway.app/?oauth_state_id=xxx).
  // If we pass the rewritten URL (with #/finance), Plaid rejects it and
  // renders blank — the dreaded blue screen.
  //
  // Stash on window so PlaidConnect can read it after React mounts.
  // (No localStorage — sandbox blocks it.)
  (window as any).__plaidOriginalRedirectUri = window.location.href;

  const target = `#/finance?oauth_state_id=${encodeURIComponent(oauthStateId)}`;
  window.history.replaceState(null, "", window.location.pathname + target);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

// Run once at module load — before React mounts — so the router sees
// the corrected hash on first render.
redirectPlaidOAuthIfPresent();

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
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
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
