/**
 * Dark editorial world map showing Atlas paths as colored pins by type.
 * Uses Leaflet + CartoDB Dark Matter tiles (no API key needed).
 */
import { useMemo } from "react";
import { MapContainer, TileLayer, CircleMarker, Tooltip } from "react-leaflet";
import "leaflet/dist/leaflet.css";

export type MapPath = {
  id: string;
  type: string;
  name: string;
  location: string | null;
  latitude: number | null;
  longitude: number | null;
  atlasShareUrl?: string | null;
};

// Type → color mapping (matches the editorial dark palette)
const TYPE_COLOR: Record<string, string> = {
  national_park: "#34d399", // emerald — nature
  state: "#60a5fa",          // blue — boundary
  country: "#a78bfa",        // violet — region
  stadium: "#f59e0b",        // amber — culture
  concert: "#f472b6",        // pink — music
  beach: "#22d3ee",          // cyan — water
};
const DEFAULT_COLOR = "#94a3b8";

export function typeColor(type: string): string {
  return TYPE_COLOR[type] || DEFAULT_COLOR;
}

export function typeLabel(type: string): string {
  return type
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

type Props = {
  paths: MapPath[];
};

export function PathsMap({ paths }: Props) {
  const geoPaths = useMemo(
    () => paths.filter((p) => p.latitude != null && p.longitude != null),
    [paths]
  );

  // Compute a sensible default center + zoom from points
  const { center, zoom } = useMemo(() => {
    if (geoPaths.length === 0) {
      return { center: [20, 0] as [number, number], zoom: 2 };
    }
    const lats = geoPaths.map((p) => p.latitude!);
    const lngs = geoPaths.map((p) => p.longitude!);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    const cLat = (minLat + maxLat) / 2;
    const cLng = (minLng + maxLng) / 2;
    const span = Math.max(maxLat - minLat, maxLng - minLng);
    // crude zoom from span (in degrees)
    let z = 2;
    if (span < 1) z = 8;
    else if (span < 5) z = 6;
    else if (span < 20) z = 4;
    else if (span < 60) z = 3;
    return { center: [cLat, cLng] as [number, number], zoom: z };
  }, [geoPaths]);

  if (geoPaths.length === 0) {
    return (
      <div
        className="rounded-lg border border-border bg-card/40 h-[320px] grid place-items-center text-sm text-muted-foreground"
        data-testid="empty-paths-map"
      >
        No coordinates yet — log a place with location to see it on the map.
      </div>
    );
  }

  return (
    <div
      className="rounded-lg border border-border overflow-hidden relative"
      data-testid="paths-map"
      style={{ height: 360 }}
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
        {geoPaths.map((p) => (
          <CircleMarker
            key={p.id}
            center={[p.latitude!, p.longitude!]}
            radius={6}
            pathOptions={{
              color: typeColor(p.type),
              fillColor: typeColor(p.type),
              fillOpacity: 0.85,
              weight: 1.5,
            }}
          >
            <Tooltip direction="top" offset={[0, -4]} opacity={1}>
              <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 11 }}>
                <div style={{ fontWeight: 600 }}>{p.name}</div>
                <div style={{ opacity: 0.7, textTransform: "uppercase", fontSize: 10, letterSpacing: "0.1em" }}>
                  {typeLabel(p.type)}
                </div>
                {p.location && (
                  <div style={{ opacity: 0.6, fontSize: 10, marginTop: 2 }}>{p.location}</div>
                )}
              </div>
            </Tooltip>
          </CircleMarker>
        ))}
      </MapContainer>
      {/* Legend overlay */}
      <div
        className="absolute bottom-3 left-3 z-[400] bg-background/85 backdrop-blur rounded-md border border-border px-3 py-2 text-[10px] font-mono uppercase tracking-wider"
        data-testid="map-legend"
      >
        <div className="grid grid-cols-2 gap-x-3 gap-y-1">
          {Object.entries(TYPE_COLOR).map(([t, c]) => (
            <div key={t} className="flex items-center gap-1.5">
              <span style={{ background: c, width: 8, height: 8, borderRadius: 999, display: "inline-block" }} />
              <span className="text-muted-foreground">{typeLabel(t)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
