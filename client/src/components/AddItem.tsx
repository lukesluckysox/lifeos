import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

interface AddItemProps {
  kind: "music" | "concert" | "artist" | "place" | "food" | "film" | "show";
  /** Label shown on the button (e.g. "Add track", "Add artist"). */
  label: string;
  /** Placeholder for title field. */
  titlePlaceholder?: string;
  /** Placeholder for subtitle field. Pass empty string to hide. */
  subtitlePlaceholder?: string;
  /** Whether to expose a URL field. */
  showUrl?: boolean;
  /** Query keys to invalidate after a successful add. */
  invalidateKeys?: (string | undefined)[][];
  /** Visual size: compact (icon-only chip) or full (button with label). */
  size?: "compact" | "full";
  className?: string;
}

export function AddItem({
  kind, label,
  titlePlaceholder = "Title",
  subtitlePlaceholder = "Detail",
  showUrl = false,
  invalidateKeys = [],
  size = "full",
  className = "",
}: AddItemProps) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [url, setUrl] = useState("");

  const add = useMutation({
    mutationFn: async () => {
      const body: any = { kind, title: title.trim() };
      if (subtitle.trim()) body.subtitle = subtitle.trim();
      if (url.trim()) body.url = url.trim();
      const r = await apiRequest("POST", "/api/user-items", body);
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/user-items"] });
      for (const k of invalidateKeys) qc.invalidateQueries({ queryKey: k });
      setTitle(""); setSubtitle(""); setUrl(""); setOpen(false);
    },
  });

  if (!open) {
    if (size === "compact") {
      return (
        <button
          type="button"
          onClick={() => setOpen(true)}
          data-testid={`button-add-${kind}`}
          className={`inline-flex items-center gap-1 text-[11px] font-mono uppercase tracking-[0.15em] text-muted-foreground hover:text-foreground transition-colors ${className}`}
        >
          <Plus size={12} /> {label || "add"}
        </button>
      );
    }
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid={`button-add-${kind}`}
        className={`inline-flex items-center gap-1.5 rounded-md border border-dashed border-border bg-card/30 px-3 py-1.5 text-xs text-muted-foreground hover:border-teal/40 hover:text-foreground transition-colors ${className}`}
      >
        <Plus size={13} />
        {label}
      </button>
    );
  }

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (title.trim()) add.mutate(); }}
      className={`rounded-md border border-border bg-card p-3 space-y-2 ${className}`}
      data-testid={`form-add-${kind}`}
    >
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium">{label}</div>
        <button
          type="button"
          onClick={() => { setOpen(false); setTitle(""); setSubtitle(""); setUrl(""); }}
          data-testid={`button-cancel-add-${kind}`}
          className="text-muted-foreground hover:text-foreground"
        >
          <X size={14} />
        </button>
      </div>
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={titlePlaceholder}
        data-testid={`input-title-${kind}`}
        className="w-full bg-background border border-border rounded px-2 py-1.5 text-sm focus:outline-none focus:border-teal/60"
      />
      {subtitlePlaceholder !== "" && (
        <input
          value={subtitle}
          onChange={(e) => setSubtitle(e.target.value)}
          placeholder={subtitlePlaceholder}
          data-testid={`input-subtitle-${kind}`}
          className="w-full bg-background border border-border rounded px-2 py-1.5 text-sm focus:outline-none focus:border-teal/60"
        />
      )}
      {showUrl && (
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https:// (optional)"
          data-testid={`input-url-${kind}`}
          className="w-full bg-background border border-border rounded px-2 py-1.5 text-sm focus:outline-none focus:border-teal/60"
        />
      )}
      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          type="submit"
          disabled={!title.trim() || add.isPending}
          data-testid={`button-save-${kind}`}
          className="rounded-md bg-teal/15 border border-teal/30 text-teal px-3 py-1 text-xs font-medium hover:bg-teal/25 disabled:opacity-40 transition-colors"
        >
          {add.isPending ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}
