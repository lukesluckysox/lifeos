import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

export type RatingKind = "show" | "film" | "artist" | "place" | "event";
export type Signal = -1 | 0 | 1 | 2;

export interface Rating {
  id: number;
  kind: RatingKind;
  externalId: string;
  title: string;
  signal: Signal;
  meta: Record<string, any> | null;
  createdAt: number;
}

const RATINGS_KEY = ["/api/ratings"] as const;

export function useRatings(kind?: RatingKind) {
  return useQuery<Rating[]>({
    queryKey: kind ? ["/api/ratings", kind] : RATINGS_KEY,
    queryFn: async () => {
      const url = kind ? `/api/ratings?kind=${kind}` : "/api/ratings";
      const res = await apiRequest("GET", url);
      return res.json();
    },
    staleTime: 30_000,
  });
}

export function useSetRating() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      kind: RatingKind;
      externalId: string;
      title: string;
      signal: Signal;
      meta?: Record<string, any>;
    }) => {
      const res = await apiRequest("POST", "/api/ratings", payload);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/ratings"] });
    },
  });
}

export function useRemoveRating() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ kind, externalId }: { kind: RatingKind; externalId: string }) => {
      const res = await apiRequest("DELETE", `/api/ratings/${kind}/${encodeURIComponent(externalId)}`);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/ratings"] });
    },
  });
}

/** Index ratings by `kind:externalId` for O(1) lookup. */
export function ratingIndex(ratings: Rating[] | undefined): Map<string, Rating> {
  const m = new Map<string, Rating>();
  if (!ratings) return m;
  for (const r of ratings) m.set(`${r.kind}:${r.externalId}`, r);
  return m;
}
