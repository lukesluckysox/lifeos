import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Sun, Moon, Download, LogOut, Trash2, Plug, Check, X, AlertTriangle, ArrowUpRight } from "lucide-react";
import { Link } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/components/AuthProvider";
import { useTheme } from "@/components/ThemeProvider";
import { useAccent, type Accent } from "@/components/AccentProvider";

interface PlaidItem {
  id: number;
  itemId: string;
  institutionName?: string;
  createdAt: number;
}

export default function Settings() {
  const { user, logout, loginWithSpotify } = useAuth();
  const { theme, toggle } = useTheme();
  const { accent, setAccent } = useAccent();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);

  const { data: plaidItems = [], isLoading: plaidLoading } = useQuery<PlaidItem[]>({
    queryKey: ["/api/plaid/items"],
    queryFn: async () => (await apiRequest("GET", "/api/plaid/items")).json(),
    enabled: !!user,
  });

  const disconnectPlaid = async (itemId: string) => {
    await apiRequest("DELETE", `/api/plaid/items/${itemId}`);
    await queryClient.invalidateQueries({ queryKey: ["/api/plaid/items"] });
  };

  const disconnectSpotify = async () => {
    await apiRequest("POST", "/api/spotify/disconnect");
    window.location.reload();
  };

  const exportData = async () => {
    setExporting(true);
    try {
      const res = await apiRequest("GET", "/api/auth/export");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `radius-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  const deleteAccount = async () => {
    setDeleting(true);
    try {
      await apiRequest("DELETE", "/api/auth/account");
      window.location.href = "/";
    } catch {
      setDeleting(false);
    }
  };

  if (!user) return null;

  return (
    <div className="animate-fade-in" data-testid="page-settings">
      <section className="pt-2 max-w-2xl">
        <div className="eyebrow mb-4">Settings</div>
        <h1 className="font-display text-[clamp(1.5rem,3.5vw,2.5rem)] leading-[1.05] tracking-tight">
          Your <span className="text-teal italic">Radius</span>.
        </h1>
        <p className="mt-3 text-base text-muted-foreground max-w-xl leading-relaxed">
          Manage your account, connected services, and data.
        </p>
      </section>

      <div className="hairline my-10" />

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-12">
        <div className="space-y-12 min-w-0">

      {/* Account */}
      <Section title="Account">
        <Row label="Name" value={user.displayName || "—"} />
        <Row label="Email" value={user.email || "—"} />
        <Row
          label="Member since"
          value={user.createdAt ? new Date(user.createdAt).toLocaleDateString("en-US", { month: "long", year: "numeric" }) : "—"}
        />
        <Row
          label="Theme"
          value={
            <button
              type="button"
              onClick={toggle}
              data-testid="button-toggle-theme"
              className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-xs hover:border-teal/40 transition-colors"
            >
              {theme === "dark" ? <Moon size={12} /> : <Sun size={12} />}
              {theme === "dark" ? "Dark" : "Light"}
            </button>
          }
        />
        <Row
          label="Accent"
          value={<AccentPicker accent={accent} setAccent={setAccent} />}
        />
      </Section>

      {/* Connections */}
      <Section title="Connections">
        {/* Spotify */}
        <div className="rounded-lg border border-border bg-card/40 p-4 flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-medium">Spotify</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {user.spotifyId ? "Connected" : "Not connected"}
            </div>
          </div>
          {user.spotifyId ? (
            <button
              type="button"
              onClick={disconnectSpotify}
              className="text-xs text-muted-foreground hover:text-rose transition-colors font-mono uppercase tracking-wider"
              data-testid="button-disconnect-spotify"
            >
              Disconnect
            </button>
          ) : (
            <button
              type="button"
              onClick={loginWithSpotify}
              className="text-xs text-teal hover:text-teal/80 transition-colors font-mono uppercase tracking-wider inline-flex items-center gap-1"
              data-testid="button-connect-spotify"
            >
              <Plug size={11} />
              Connect
            </button>
          )}
        </div>

        {/* Plaid items */}
        <div className="rounded-lg border border-border bg-card/40 p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-sm font-medium">Brokerages & banks</div>
              <div className="text-xs text-muted-foreground mt-0.5">via Plaid · read-only</div>
            </div>
            <span className="font-mono text-[10px] text-muted-foreground tabular">
              {plaidItems.length} connected
            </span>
          </div>
          {plaidLoading ? (
            <div className="text-xs text-muted-foreground">Loading…</div>
          ) : plaidItems.length === 0 ? (
            <div className="text-xs text-muted-foreground italic">
              No brokerages connected yet. Add one from the Finance page.
            </div>
          ) : (
            <ul className="space-y-2 mt-1">
              {plaidItems.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center justify-between gap-3 text-sm py-2 border-t border-border/40 first:border-t-0"
                  data-testid={`row-plaid-item-${p.id}`}
                >
                  <div className="flex items-center gap-2">
                    <Check size={12} className="text-teal shrink-0" />
                    <span>{p.institutionName || "Connected institution"}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => disconnectPlaid(p.itemId)}
                    className="text-xs text-muted-foreground hover:text-rose transition-colors font-mono uppercase tracking-wider"
                    data-testid={`button-disconnect-plaid-${p.id}`}
                  >
                    Disconnect
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Section>

      {/* Data */}
      <Section title="Your data">
        <p className="text-xs text-muted-foreground leading-relaxed">
          Radius reads your money, music, and places, but never sells your data and never trains on it. You can take it with you, or delete it all, anytime.
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          <button
            type="button"
            onClick={exportData}
            disabled={exporting}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-card hover:border-teal/40 transition-colors px-3 py-2 text-xs disabled:opacity-50"
            data-testid="button-export-data"
          >
            <Download size={12} />
            {exporting ? "Preparing…" : "Export my data"}
          </button>
          <button
            type="button"
            onClick={logout}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-card hover:border-teal/40 transition-colors px-3 py-2 text-xs"
            data-testid="button-logout"
          >
            <LogOut size={12} />
            Sign out
          </button>
        </div>
      </Section>

      {/* Danger zone */}
        <Section title="Danger zone">
        {!confirmingDelete ? (
          <button
            type="button"
            onClick={() => setConfirmingDelete(true)}
            className="inline-flex items-center gap-2 rounded-md border border-rose/30 bg-rose/5 hover:bg-rose/10 transition-colors px-3 py-2 text-xs text-rose"
            data-testid="button-delete-account"
          >
            <Trash2 size={12} />
            Delete account
          </button>
        ) : (
          <div className="rounded-lg border border-rose/30 bg-rose/5 p-4 space-y-3" data-testid="panel-delete-confirm">
            <div className="flex items-start gap-2 text-sm text-rose">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <div>
                <div className="font-medium">This permanently deletes everything.</div>
                <div className="text-xs text-rose/80 mt-1">
                  Your account, holdings, watchlist, places, subscriptions, and all connected services. There's no undo.
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={deleteAccount}
                disabled={deleting}
                className="inline-flex items-center gap-2 rounded-md bg-rose text-white hover:bg-rose/90 transition-colors px-3 py-2 text-xs disabled:opacity-50"
                data-testid="button-delete-account-confirm"
              >
                <Trash2 size={12} />
                {deleting ? "Deleting…" : "Yes, delete everything"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                className="inline-flex items-center gap-2 rounded-md border border-border bg-card hover:border-border/60 transition-colors px-3 py-2 text-xs"
                data-testid="button-delete-account-cancel"
              >
                <X size={12} />
                Cancel
              </button>
            </div>
          </div>
        )}
        </Section>
        </div>

        {/* Right rail — About Radius */}
        <aside className="space-y-8" data-testid="aside-settings-about">
          <div className="rounded-xl border border-border bg-card/40 p-5 space-y-3">
            <div className="eyebrow">About Radius</div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Your money, your music, your places — in one place. Radius pulls signal from the apps you already use and lays it out as one dashboard.
            </p>
            <Link href="/whats-new">
              <span
                data-testid="link-settings-whats-new"
                className="inline-flex items-center gap-1 text-xs text-teal hover:text-teal/80 transition-colors font-mono uppercase tracking-wider cursor-pointer"
              >
                What’s new <ArrowUpRight size={11} />
              </span>
            </Link>
          </div>
          <div className="rounded-xl border border-border bg-card/40 p-5 space-y-3">
            <div className="eyebrow">Sibling app</div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Atlas is the journal half of the system — voice notes, daily traces, and patterns over time.
            </p>
            <a
              href="https://traces.up.railway.app"
              target="_blank"
              rel="noopener noreferrer"
              data-testid="link-settings-atlas"
              className="inline-flex items-center gap-1 text-xs text-teal hover:text-teal/80 transition-colors font-mono uppercase tracking-wider"
            >
              Open Atlas <ArrowUpRight size={11} />
            </a>
          </div>
          <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground/60">
            v0.4 · made in Hawaii
          </div>
        </aside>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="eyebrow">{title}</div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5 border-b border-border/40 last:border-b-0">
      <span className="text-xs text-muted-foreground font-mono uppercase tracking-wider">{label}</span>
      <span className="text-sm">{value}</span>
    </div>
  );
}

const ACCENTS: { id: Accent; label: string; hsl: string }[] = [
  { id: "teal",   label: "Teal",   hsl: "hsl(184 42% 52%)" },
  { id: "gold",   label: "Gold",   hsl: "hsl(38 62% 52%)"  },
  { id: "violet", label: "Violet", hsl: "hsl(258 52% 60%)" },
  { id: "rose",   label: "Rose",   hsl: "hsl(350 46% 58%)" },
  { id: "slate",  label: "Slate",  hsl: "hsl(220 14% 60%)" },
];

function AccentPicker({ accent, setAccent }: { accent: Accent; setAccent: (a: Accent) => void }) {
  return (
    <div className="flex items-center gap-1.5" data-testid="accent-picker">
      {ACCENTS.map((a) => (
        <button
          key={a.id}
          type="button"
          title={a.label}
          data-testid={`accent-swatch-${a.id}`}
          onClick={() => setAccent(a.id)}
          style={{ background: a.hsl }}
          className={`w-5 h-5 rounded-full transition-all ${
            accent === a.id
              ? "ring-2 ring-offset-2 ring-offset-card scale-110"
              : "opacity-60 hover:opacity-90 hover:scale-105"
          }`}
          aria-label={a.label}
        />
      ))}
    </div>
  );
}
