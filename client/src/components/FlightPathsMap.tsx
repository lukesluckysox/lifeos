/**
 * Dark editorial world map showing flown routes as geodesic arcs between
 * airports. Same stack as PathsMap.tsx (Leaflet + CartoDB Dark Matter
 * tiles, no API key needed) — this is the flight-log equivalent, driven
 * by flight_legs instead of Atlas paths.
 *
 * Routes are drawn as true great-circle arcs (spherical interpolation),
 * not straight Mercator lines — on a Web Mercator map a straight line
 * between two far-apart points looks wrong; a geodesic curve looks like
 * an actual flight path. Known limitation: very long transpacific/
 * transatlantic routes crossing the antimeridian (~180° longitude) can
 * render oddly — most routes look correct.
 */
import { useMemo } from "react";
import { MapContainer, TileLayer, CircleMarker, Polyline, Tooltip } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { lookupAirport } from "@/lib/airports";

export type FlightLeg = {
  id: number | string;
  origin: string;
  destination: string;
  airline?: string | null;
  flightNumber?: string | null;
  date?: string | null;
  miles?: number | null;
  /** Set by the household-shared variant to tag whose flight this is. */
  sharedBy?: string | null;
};

type Props = {
  flights: FlightLeg[];
};

const ROUTE_COLOR = "#4f98a3"; // matches --accent-teal used elsewhere
const HOME_COLOR = "#f5a623"; // gold — origin-heaviest airport, i.e. "home base"

function toRad(d: number) { return (d * Math.PI) / 180; }
function toDeg(r: number) { return (r * 180) / Math.PI; }

/** Spherical linear interpolation between two lat/lon points — a true great-circle arc. */
function greatCircleIntermediates(
  lat1: number, lon1: number, lat2: number, lon2: number, segments = 32
): [number, number][] {
  const φ1 = toRad(lat1), λ1 = toRad(lon1);
  const φ2 = toRad(lat2), λ2 = toRad(lon2);
  const d = 2 * Math.asin(
    Math.sqrt(
      Math.sin((φ2 - φ1) / 2) ** 2 +
      Math.cos(φ1) * Math.cos(φ2) * Math.sin((λ2 - λ1) / 2) ** 2
    )
  );
  if (d === 0) return [[lat1, lon1]];
  const points: [number, number][] = [];
  for (let i = 0; i <= segments; i++) {
    const f = i / segments;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2);
    const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2);
    const z = A * Math.sin(φ1) + B * Math.sin(φ2);
    const φi = Math.atan2(z, Math.sqrt(x * x + y * y));
    const λi = Math.atan2(y, x);
    points.push([toDeg(φi), toDeg(λi)]);
  }
  return points;
}

function haversineMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3958.8; // Earth radius, miles
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

export function FlightPathsMap({ flights }: Props) {
  const { routes, airportVisits, unresolved, totalMiles, homeCode } = useMemo(() => {
    const routes: Array<{ id: string; path: [number, number][]; leg: FlightLeg }> = [];
    const visits = new Map<string, { code: string; lat: number; lon: number; city: string; count: number }>();
    const unresolved = new Set<string>();
    let miles = 0;

    for (const leg of flights) {
      const o = lookupAirport(leg.origin);
      const d = lookupAirport(leg.destination);
      if (!o) unresolved.add((leg.origin || "").toUpperCase());
      if (!d) unresolved.add((leg.destination || "").toUpperCase());
      if (!o || !d) continue;

      const path = greatCircleIntermediates(o.lat, o.lon, d.lat, d.lon, 48);
      routes.push({ id: String(leg.id), path, leg });
      miles += leg.miles ?? haversineMiles(o.lat, o.lon, d.lat, d.lon);

      for (const [code, coord] of [[leg.origin.toUpperCase(), o], [leg.destination.toUpperCase(), d]] as const) {
        const existing = visits.get(code);
        if (existing) existing.count++;
        else visits.set(code, { code, lat: coord.lat, lon: coord.lon, city: coord.city, count: 1 });
      }
    }

    let homeCode: string | null = null;
    let homeCount = 0;
    for (const v of visits.values()) {
      if (v.count > homeCount) { homeCount = v.count; homeCode = v.code; }
    }

    return {
      routes,
      airportVisits: Array.from(visits.values()),
      unresolved: Array.from(unresolved),
      totalMiles: Math.round(miles),
      homeCode,
    };
  }, [flights]);

  const { center, zoom } = useMemo(() => {
    if (airportVisits.length === 0) return { center: [20, 0] as [number, number], zoom: 2 };
    const lats = airportVisits.map(a => a.lat);
    const lons = airportVisits.map(a => a.lon);
    const cLat = (Math.min(...lats) + Math.max(...lats)) / 2;
    const cLon = (Math.min(...lons) + Math.max(...lons)) / 2;
    const span = Math.max(Math.max(...lats) - Math.min(...lats), Math.max(...lons) - Math.min(...lons));
    let z = 2;
    if (span < 2) z = 7;
    else if (span < 8) z = 5;
    else if (span < 25) z = 4;
    else if (span < 70) z = 3;
    return { center: [cLat, cLon] as [number, number], zoom: z };
  }, [airportVisits]);

  if (routes.length === 0) {
    return (
      <div
        className="rounded-lg border border-border bg-card/40 h-[320px] grid place-items-center text-sm text-muted-foreground text-center px-6"
        data-testid="empty-flight-paths-map"
      >
        {flights.length === 0
          ? "No flights logged yet — scan a boarding pass or add one manually to see it here."
          : "Logged flights use airport codes not in the map's lookup table yet — see the note below."}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div
        className="rounded-lg border border-border overflow-hidden relative"
        data-testid="flight-paths-map"
        style={{ height: 380 }}
      >
        <MapContainer
          center={center}
          zoom={zoom}
          scrollWheelZoom={false}
          style={{ height: "100%", width: "100%", background: "#0a0a0a" }}
          worldCopyJump
          attributionControl={false}
        >
          <TileLayer
            url="https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png"
            subdomains={["a", "b", "c", "d"]}
            maxZoom={19}
          />
          <TileLayer
            url="https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png"
            subdomains={["a", "b", "c", "d"]}
            maxZoom={19}
            opacity={0.6}
          />
          {routes.map(r => (
            <Polyline
              key={r.id}
              positions={r.path}
              pathOptions={{ color: ROUTE_COLOR, weight: 1.5, opacity: 0.75 }}
            >
              <Tooltip direction="top" opacity={1}>
                <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 11 }}>
                  <div style={{ fontWeight: 600 }}>
                    {r.leg.origin.toUpperCase()} → {r.leg.destination.toUpperCase()}
                  </div>
                  {(r.leg.airline || r.leg.flightNumber) && (
                    <div style={{ opacity: 0.7, fontSize: 10 }}>
                      {[r.leg.airline, r.leg.flightNumber].filter(Boolean).join(" ")}
                    </div>
                  )}
                  {r.leg.date && <div style={{ opacity: 0.6, fontSize: 10 }}>{r.leg.date}</div>}
                  {r.leg.sharedBy && (
                    <div style={{ opacity: 0.6, fontSize: 10, marginTop: 2 }}>{r.leg.sharedBy}</div>
                  )}
                </div>
              </Tooltip>
            </Polyline>
          ))}
          {airportVisits.map(a => (
            <CircleMarker
              key={a.code}
              center={[a.lat, a.lon]}
              radius={a.code === homeCode ? 7 : 4 + Math.min(a.count, 5)}
              pathOptions={{
                color: a.code === homeCode ? HOME_COLOR : ROUTE_COLOR,
                fillColor: a.code === homeCode ? HOME_COLOR : ROUTE_COLOR,
                fillOpacity: 0.9,
                weight: 1.5,
              }}
            >
              <Tooltip direction="top" offset={[0, -4]} opacity={1}>
                <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 11 }}>
                  <div style={{ fontWeight: 600 }}>{a.code} · {a.city}</div>
                  <div style={{ opacity: 0.7, fontSize: 10 }}>
                    {a.count} visit{a.count === 1 ? "" : "s"}{a.code === homeCode ? " · home base" : ""}
                  </div>
                </div>
              </Tooltip>
            </CircleMarker>
          ))}
        </MapContainer>
        <div
          className="absolute bottom-3 left-3 z-[400] bg-background/85 backdrop-blur rounded-md border border-border px-3 py-2 text-[10px] font-mono uppercase tracking-wider"
          data-testid="flight-map-summary"
        >
          <div className="flex items-center gap-3">
            <span className="text-muted-foreground">{routes.length} flight{routes.length === 1 ? "" : "s"}</span>
            <span className="text-muted-foreground">{airportVisits.length} airports</span>
            <span className="text-teal tabular">{totalMiles.toLocaleString()} mi</span>
          </div>
        </div>
      </div>

      {unresolved.length > 0 && (
        <div
          className="text-[11px] text-muted-foreground italic px-1"
          data-testid="text-flight-map-unresolved"
        >
          Not shown on the map — unknown airport code{unresolved.length === 1 ? "" : "s"}: {unresolved.join(", ")}.
          Add {unresolved.length === 1 ? "it" : "them"} to client/src/lib/airports.ts to include{" "}
          {unresolved.length === 1 ? "it" : "them"}.
        </div>
      )}
    </div>
  );
}
