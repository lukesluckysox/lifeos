import type { Express } from "express";
import { storage } from "./storage";
import { requireAuth } from "./auth";

/**
 * Visited places — native replacement for the Atlas "Experience"/Path
 * concept. Instead of logging a place in the separate Atlas/Trace app
 * and pulling it into LifeOS via the OAuth connect flow (/api/atlas/*,
 * atlas_links table), you log it here directly and PathsMap.tsx renders
 * it unchanged — the response below is shaped to match its existing
 * MapPath type exactly:
 *
 *   { id: string; type: string; name: string; location: string | null;
 *     latitude: number | null; longitude: number | null }
 *
 * Known types PathsMap.tsx renders with dedicated colors: national_park,
 * state, country, stadium, concert, beach. Anything else falls back to
 * its DEFAULT_COLOR — freeform types work, they just won't get a
 * distinct color.
 *
 * Call this once from server/routes.ts's registerRoutes(), same as the
 * other new route modules:
 *
 *   import { registerVisitedPlaceRoutes } from "./visited-places-routes";
 *   ...
 *   registerVisitedPlaceRoutes(app);
 *
 * This does NOT touch the existing /api/paths (Atlas-backed) route —
 * that keeps working until you're ready to switch Places.tsx over to
 * /api/visited-places and retire the Atlas connect flow at your own
 * pace. See INTEGRATION.md for the swap.
 */
export function registerVisitedPlaceRoutes(app: Express) {
  app.get("/api/visited-places", requireAuth, async (req, res) => {
    try {
      const places = await storage.listVisitedPlaces(req.user!.id);
      res.json({
        source: "native",
        paths: places.map(toMapPath),
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/visited-places", requireAuth, async (req, res) => {
    try {
      const { type, name, location, latitude, longitude, visitedDate, note } = req.body || {};
      if (!type || typeof type !== "string" || !type.trim()) {
        return res.status(400).json({ message: "type is required." });
      }
      if (!name || typeof name !== "string" || !name.trim()) {
        return res.status(400).json({ message: "name is required." });
      }
      const lat = latitude !== undefined && latitude !== null ? Number(latitude) : null;
      const lon = longitude !== undefined && longitude !== null ? Number(longitude) : null;
      if ((lat !== null && !Number.isFinite(lat)) || (lon !== null && !Number.isFinite(lon))) {
        return res.status(400).json({ message: "latitude/longitude must be numbers." });
      }
      const place = await storage.addVisitedPlace(req.user!.id, {
        type: type.trim(),
        name: name.trim(),
        location: location ? String(location).trim() : undefined,
        latitude: lat,
        longitude: lon,
        visitedDate: visitedDate ? String(visitedDate) : undefined,
        note: note ? String(note).trim() : undefined,
      });
      res.json(toMapPath(place));
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/visited-places/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });
      const patch: any = {};
      if (req.body?.type !== undefined) patch.type = String(req.body.type).trim();
      if (req.body?.name !== undefined) patch.name = String(req.body.name).trim();
      if (req.body?.location !== undefined) patch.location = req.body.location ? String(req.body.location).trim() : null;
      if (req.body?.latitude !== undefined) {
        const lat = req.body.latitude === null ? null : Number(req.body.latitude);
        if (lat !== null && !Number.isFinite(lat)) return res.status(400).json({ message: "latitude must be a number." });
        patch.latitude = lat;
      }
      if (req.body?.longitude !== undefined) {
        const lon = req.body.longitude === null ? null : Number(req.body.longitude);
        if (lon !== null && !Number.isFinite(lon)) return res.status(400).json({ message: "longitude must be a number." });
        patch.longitude = lon;
      }
      if (req.body?.visitedDate !== undefined) patch.visitedDate = req.body.visitedDate ? String(req.body.visitedDate) : null;
      if (req.body?.note !== undefined) patch.note = req.body.note ? String(req.body.note).trim() : null;

      const place = await storage.updateVisitedPlace(req.user!.id, id, patch);
      if (!place) return res.status(404).json({ message: "Place not found." });
      res.json(toMapPath(place));
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/visited-places/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const r = await storage.removeVisitedPlace(req.user!.id, id);
      res.json({ ok: true, changes: r.changes });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });
}

function toMapPath(p: any) {
  return {
    id: String(p.id),
    type: p.type,
    name: p.name,
    location: p.location ?? null,
    latitude: p.latitude ?? null,
    longitude: p.longitude ?? null,
    visitedDate: p.visitedDate ?? null,
    note: p.note ?? null,
  };
}
