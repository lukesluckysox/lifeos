import { useQuery } from "@tanstack/react-query";
import { Bookmark, ExternalLink, Music as MusicIcon, MapPin, Calendar, Utensils, Tv, Film, LineChart, Trash2 } from "lucide-react";
import { SectionHeader } from "@/components/SectionHeader";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface UserItem {
  id: number;
  kind: string;
  title: string;
  subtitle?: string | null;
  url?: string | null;
  meta?: Record<string, any> | null;
  createdAt?: number;
}


type Kind = "music" | "finance" | "concert" | "food" | "film" | "show" | "place" | "event";

interface Bookmark {
  kind: Kind;
  externalId: string;
  title: string;
  meta?: Record<string, any> | null;
  createdAt?: number;
}

interface BookmarksResp {
  bookmarks: Bookmark[];
}

const KIND_META: Record<Kind, { label: string; icon: any; tone: string }> = {
  music:   { label: "Music",     icon: MusicIcon, tone: "text-teal" },
  concert: { label: "Concerts",  icon: Calendar,  tone: "text-gold" },
  place:   { label: "Places",    icon: MapPin,    tone: "text-teal" },
  event:   { label: "Events",    icon: Calendar,  tone: "text-gold" },
  food:    { label: "Food",      icon: Utensils,  tone: "text-rose" },
  finance: { label: "Finance",   icon: LineChart, tone: "text-teal" },
  film:    { label: "Film",      icon: Film,      tone: "text-gold" },
  show:    { label: "Shows",     icon: Tv,        tone: "text-teal" },
};

const ORDER: Kind[] = ["place", "event", "concert", "music", "food", "finance", "film", "show"];

export default function Saved() {
  const { data, isLoading } = useQuery<BookmarksResp>({
    queryKey: ["/api/bookmarks"],
    queryFn: async () => (await apiRequest("GET", "/api/bookmarks")).json(),
  });

  const bookmarks = data?.bookmarks ?? [];

  const { data: userItemsResp } = useQuery<UserItem[]>({
    queryKey: ["/api/user-items"],
    queryFn: async () => (await apiRequest("GET", "/api/user-items")).json(),
  });
  const userItems = userItemsResp ?? [];

  async function removeUserItem(id: number) {
    try {
      await apiRequest("DELETE", `/api/user-items/${id}`);
      queryClient.invalidateQueries({ queryKey: ["/api/user-items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/concerts-for-you"] });
    } catch { /* swallow */ }
  }

  // Group by kind
  const groups = ORDER.map((k) => ({
    kind: k,
    items: bookmarks.filter((b) => b.kind === k),
  })).filter((g) => g.items.length > 0);

  const total = bookmarks.length;

  async function remove(b: Bookmark) {
    try {
      await apiRequest("DELETE", `/api/bookmarks/${b.kind}/${encodeURIComponent(b.externalId)}`);
      queryClient.invalidateQueries({ queryKey: ["/api/bookmarks"] });
    } catch {
      /* swallow */
    }
  }

  return (
    <div className="space-y-14 animate-fade-in">
      <section>
        <div className="eyebrow mb-3">Saved</div>
        <h1 className="font-display text-[clamp(1.875rem,3.5vw,2.75rem)] leading-[1.02] tracking-tight max-w-3xl">
          The shortlist. Everything you starred for later.
        </h1>
        <div className="mt-4 inline-flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-muted-foreground">
          <Bookmark size={12} className="text-gold" />
          <span data-testid="text-saved-total">{total} bookmark{total === 1 ? "" : "s"}</span>
        </div>
      </section>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-lg border border-border bg-card/40 p-5 h-28 animate-pulse" />
          ))}
        </div>
      ) : (groups.length === 0 && userItems.length === 0) ? (
        <div className="rounded-lg border border-dashed border-border bg-card/40 p-10 text-center max-w-xl">
          <Bookmark size={20} className="mx-auto mb-3 text-muted-foreground" />
          <div className="font-display text-lg">Nothing saved yet.</div>
          <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
            Tap the bookmark icon on any recommendation card &mdash; in Places, Music, Finance, Food &mdash; to keep it here.
          </p>
        </div>
      ) : null}

      {/* Your additions — manually-added items via AddItem */}
      {userItems.length > 0 && (
        <section data-testid="section-user-items">
          <SectionHeader
            eyebrow="Your additions"
            title={`Manually added \u00b7 ${userItems.length}`}
            description="Items you added by hand from Music, Concerts, Places, Watch, Film."
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {userItems.map((u) => (
              <div
                key={`useritem-${u.id}`}
                data-testid={`card-user-item-${u.id}`}
                className="rounded-lg border border-border bg-card p-4 flex flex-col gap-2"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{u.kind}</div>
                    <div className="font-display text-base leading-tight truncate" title={u.title}>{u.title}</div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {u.url && (
                      <a
                        href={u.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-muted-foreground hover:text-foreground transition-colors"
                        data-testid={`link-user-item-${u.id}`}
                        aria-label="Open link"
                      >
                        <ExternalLink size={13} />
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={() => removeUserItem(u.id)}
                      data-testid={`button-remove-user-item-${u.id}`}
                      className="text-muted-foreground hover:text-rose transition-colors"
                      aria-label="Remove"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
                {u.subtitle && (
                  <div className="text-xs text-muted-foreground truncate" title={u.subtitle}>{u.subtitle}</div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {groups.length > 0 && (
        groups.map((g) => {
          const meta = KIND_META[g.kind];
          const Icon = meta.icon;
          return (
            <section key={g.kind} data-testid={`section-saved-${g.kind}`}>
              <SectionHeader
                eyebrow={meta.label}
                title={`${meta.label} \u00b7 ${g.items.length}`}
                description={`Things you starred from ${meta.label.toLowerCase()}.`}
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {g.items.map((b) => {
                  const m = (b.meta || {}) as Record<string, any>;
                  const url: string | undefined = m.url;
                  const subline = [m.venue, m.city, m.date, m.album, m.note]
                    .filter(Boolean)
                    .slice(0, 2)
                    .join(" \u00b7 ");
                  return (
                    <div
                      key={`${b.kind}-${b.externalId}`}
                      data-testid={`card-saved-${b.kind}-${b.externalId}`}
                      className="rounded-lg border border-border bg-card p-4 flex flex-col gap-2"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2 min-w-0">
                          <Icon size={13} className={`${meta.tone} shrink-0`} />
                          <div className="font-display text-base leading-tight truncate" title={b.title}>
                            {b.title}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {url && (
                            <a
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-muted-foreground hover:text-foreground transition-colors"
                              data-testid={`link-saved-${b.kind}-${b.externalId}`}
                              aria-label="Open link"
                            >
                              <ExternalLink size={13} />
                            </a>
                          )}
                          <button
                            type="button"
                            onClick={() => remove(b)}
                            data-testid={`button-remove-saved-${b.kind}-${b.externalId}`}
                            className="text-muted-foreground hover:text-rose transition-colors"
                            aria-label="Remove bookmark"
                            title="Remove from saved"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                      {subline && (
                        <div className="text-xs text-muted-foreground truncate" title={subline}>
                          {subline}
                        </div>
                      )}
                      {b.createdAt && (
                        <div className="mt-auto pt-2 font-mono text-[10px] text-muted-foreground uppercase tracking-wider">
                          saved {new Date(b.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}
