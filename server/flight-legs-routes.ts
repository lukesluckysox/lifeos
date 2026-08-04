import type { Express } from "express";
import { storage } from "./storage";
import { requireAuth } from "./auth";

/**
 * ⚠️ DO NOT REGISTER THIS FILE — CONFIRMED UNNECESSARY.
 *
 * This was a speculative /api/flight-legs implementation, built before
 * I'd seen the real client/src/pages/Flights.tsx. That page already has
 * a complete, working flight log at /api/flights (GET/POST/DELETE),
 * with its own BoardingPassScanner integration, stats, and map. This
 * file targets a path (/api/flight-legs) that doesn't exist and isn't
 * needed. Registering it alongside the real routes would just add a
 * second, unused, duplicate flight table (flight_legs vs. whatever
 * table your real /api/flights already uses) with no UI ever pointing
 * at it.
 *
 * Left in this folder only for reference. See INTEGRATION.md's "Flight
 * paths map" section for what to actually do: drop in the new
 * FlightPathsMap.tsx map component and the updated Flights.tsx (which
 * wires that map in, in place of the old ArcMap).
 *
 * Original (now-obsolete) caveat, kept below for history:
 *
 * server/storage.ts already has listFlightLegs / addFlightLeg /
 * removeFlightLeg methods, and your repo has a BoardingPassScanner.tsx
 * component — which strongly implies flight-leg CRUD routes already
 * exist somewhere in your real routes.ts (I only had partial visibility
 * into that file and never saw them, so I can't confirm the exact path).
 *
 * Before wiring this in:
 *   1. Search routes.ts for "flight" or "boarding" to see if
 *      /api/flight-legs (or similarly-named routes) already exist.
 *   2. If they do — DON'T register this file. Just point
 *      FlightPathsMap's data source at your existing endpoint instead
 *      (adjust the queryFn wherever you render <FlightPathsMap />).
 *      Registering both would silently shadow one implementation with
 *      the other on the same path.
 *   3. If they don't exist yet, register this file the same way as
 *      registerHouseholdRoutes / registerCashAccountRoutes:
 *
 *      import { registerFlightLegRoutes } from "./flight-legs-routes";
 *      ...
 *      registerFlightLegRoutes(app);
 */
export function registerFlightLegRoutes(app: Express) {
  app.get("/api/flight-legs", requireAuth, async (req, res) => {
    try {
      const legs = await storage.listFlightLegs(req.user!.id);
      res.json(legs);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/flight-legs", requireAuth, async (req, res) => {
    try {
      const { origin, destination, originName, destinationName, airline, flightNumber, departureDate, cabin, miles, notes } = req.body || {};
      if (!origin || !destination || !departureDate) {
        return res.status(400).json({ message: "origin, destination, and departureDate are required." });
      }
      const leg = await storage.addFlightLeg(req.user!.id, {
        origin: String(origin),
        destination: String(destination),
        originName: originName ? String(originName) : undefined,
        destinationName: destinationName ? String(destinationName) : undefined,
        airline: airline ? String(airline) : undefined,
        flightNumber: flightNumber ? String(flightNumber) : undefined,
        departureDate: String(departureDate),
        cabin: cabin ? String(cabin) : undefined,
        miles: miles !== undefined ? Number(miles) : undefined,
        notes: notes ? String(notes) : undefined,
      });
      res.json(leg);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/flight-legs/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const r = await storage.removeFlightLeg(req.user!.id, id);
      res.json({ ok: true, changes: r.changes });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });
}
