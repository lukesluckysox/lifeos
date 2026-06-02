import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Plane, Plus, Trash2, MapPin, TrendingUp, ScanLine } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/components/AuthProvider";
import { BoardingPassScanner, type ParsedBoardingPass } from "@/components/BoardingPassScanner";

/* ── Types ─────────────────────────────────────────────────────────── */
interface FlightLeg {
  id: number; origin: string; destination: string;
  origin_name?: string; destination_name?: string;
  airline?: string; flight_number?: string;
  departure_date: string; cabin?: string; miles?: number; notes?: string;
}

const CABINS = ["Economy", "Premium Economy", "Business", "First"];

/* ── Great-circle distance (Haversine) ──────────────────────────────── */
const AIRPORT_COORDS: Record<string, [number, number]> = {
  HNL:[21.3245,-157.9251],LAX:[33.9425,-118.4081],SFO:[37.6213,-122.379],
  JFK:[40.6413,-73.7781],LGA:[40.7772,-73.8726],EWR:[40.6895,-74.1745],
  ORD:[41.9742,-87.9073],ATL:[33.6407,-84.4277],DFW:[32.8998,-97.0403],
  MIA:[25.7959,-80.287],SEA:[47.4502,-122.3088],DEN:[39.8561,-104.6737],
  BOS:[42.3656,-71.0096],IAD:[38.9531,-77.4565],DCA:[38.8521,-77.0377],
  LHR:[51.477,-0.4613],CDG:[49.0097,2.5479],AMS:[52.3086,4.7639],
  FRA:[50.0379,8.5622],MAD:[40.4936,-3.5668],BCN:[41.2971,2.0785],
  FCO:[41.8003,12.2389],NRT:[35.7647,140.3864],HND:[35.5494,139.7798],
  ICN:[37.4692,126.4505],PEK:[40.0799,116.6031],PVG:[31.1443,121.8083],
  SIN:[1.3644,103.9915],BKK:[13.6811,100.7472],SYD:[-33.9399,151.1753],
  MEL:[-37.6733,144.8433],DXB:[25.2532,55.3657],DOH:[25.2731,51.608],
  GRU:[-23.4356,-46.4731],EZE:[-34.8222,-58.5358],YYZ:[43.6777,-79.6248],
  YVR:[49.1967,-123.1815],MEX:[19.4363,-99.0721],CUN:[21.0365,-86.8771],
  HKG:[22.3080,113.9185],TPE:[25.0777,121.2327],KUL:[2.7456,101.7099],
  MNL:[14.5086,121.0194],CGK:[-6.1256,106.6559],BOM:[19.0896,72.8656],
  DEL:[28.5562,77.1],SVO:[55.9726,37.4146],IST:[41.2753,28.7519],
  CAI:[30.1219,31.4056],JNB:[-26.1392,28.246],CPT:[-33.9649,18.6017],
};

function haversineKm(c1: [number,number], c2: [number,number]): number {
  const R = 6371;
  const dLat = (c2[0]-c1[0]) * Math.PI/180;
  const dLon = (c2[1]-c1[1]) * Math.PI/180;
  const a = Math.sin(dLat/2)**2 + Math.cos(c1[0]*Math.PI/180)*Math.cos(c2[0]*Math.PI/180)*Math.sin(dLon/2)**2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

function estimateMiles(origin: string, dest: string): number {
  const c1 = AIRPORT_COORDS[origin.toUpperCase()];
  const c2 = AIRPORT_COORDS[dest.toUpperCase()];
  if (!c1 || !c2) return 0;
  return Math.round(haversineKm(c1, c2) * 0.621371);
}

/* ── Arc Map ─────────────────────────────────────────────────────── */
function ArcMap({ legs }: { legs: FlightLeg[] }) {
  const W = 800, H = 380;
  const project = (lat: number, lon: number): [number, number] => [
    ((lon + 180) / 360) * W,
    ((90 - lat) / 180) * H,
  ];

  const arcs = legs.flatMap(leg => {
    const c1 = AIRPORT_COORDS[leg.origin.toUpperCase()];
    const c2 = AIRPORT_COORDS[leg.destination.toUpperCase()];
    if (!c1 || !c2) return [];
    const [x1, y1] = project(c1[0], c1[1]);
    const [x2, y2] = project(c2[0], c2[1]);
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2 - Math.abs(x2 - x1) * 0.18;
    return [{ x1, y1, x2, y2, mx, my, id: leg.id }];
  });

  const dots = new Set(legs.flatMap(l => [l.origin.toUpperCase(), l.destination.toUpperCase()]));

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden" data-testid="flight-arc-map">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 320 }}>
        <rect width={W} height={H} fill="hsl(var(--card))" />
        {Array.from({ length: 13 }, (_, i) => i * 30).map(lon => {
          const x = (lon / 360) * W;
          return <line key={lon} x1={x} y1={0} x2={x} y2={H} stroke="hsl(var(--border))" strokeWidth="0.5" opacity="0.4" />;
        })}
        {[-60, -30, 0, 30, 60].map(lat => {
          const y = ((90 - lat) / 180) * H;
          return <line key={lat} x1={0} y1={y} x2={W} y2={y} stroke="hsl(var(--border))" strokeWidth="0.5" opacity="0.4" />;
        })}
        {arcs.map(a => (
          <path
            key={a.id}
            d={`M${a.x1},${a.y1} Q${a.mx},${a.my} ${a.x2},${a.y2}`}
            fill="none"
            stroke="hsl(var(--accent-blue))"
            strokeWidth="1.5"
            strokeLinecap="round"
            opacity="0.7"
          />
        ))}
        {Array.from(dots).map(iata => {
          const c = AIRPORT_COORDS[iata];
          if (!c) return null;
          const [x, y] = project(c[0], c[1]);
          return (
            <g key={iata}>
              <circle cx={x} cy={y} r={3} fill="hsl(var(--accent-blue))" opacity="0.9" />
              <text x={x + 4} y={y - 4} fontSize="7" fill="hsl(var(--muted-foreground))" fontFamily="monospace">{iata}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/* ── Blank form state ─────────────────────────────────────────────── */
const BLANK_FORM = { origin: "", destination: "", departureDate: "", airline: "", flightNumber: "", cabin: "Economy", notes: "" };

/* ── Page ─────────────────────────────────────────────────────────── */
export default function Flights() {
  const { user } = useAuth();
  const [showAdd, setShowAdd] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [form, setForm] = useState(BLANK_FORM);

  const { data: legs = [], isLoading } = useQuery<FlightLeg[]>({
    queryKey: ["/api/flights"],
    queryFn: async () => (await apiRequest("GET", "/api/flights")).json(),
    enabled: !!user,
  });

  const addMutation = useMutation({
    mutationFn: async () => {
      const miles = estimateMiles(form.origin, form.destination);
      await apiRequest("POST", "/api/flights", { ...form, origin: form.origin.toUpperCase(), destination: form.destination.toUpperCase(), miles: miles || undefined });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/flights"] });
      setShowAdd(false);
      setForm(BLANK_FORM);
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/flights/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/flights"] }),
  });

  /* Handle boarding pass scan result — pre-fill form and open it */
  function handleScanned(pass: ParsedBoardingPass) {
    setShowScanner(false);
    setForm({
      origin: pass.origin,
      destination: pass.destination,
      departureDate: pass.departureDate,
      airline: pass.airline,
      flightNumber: pass.flightNumber,
      cabin: pass.cabin,
      notes: "",
    });
    setShowAdd(true);
  }

  /* Stats */
  const totalMiles = legs.reduce((s, l) => s + (l.miles || estimateMiles(l.origin, l.destination)), 0);
  const byYear = useMemo(() => {
    const m: Record<string, { legs: number; miles: number }> = {};
    legs.forEach(l => {
      const yr = l.departure_date.slice(0, 4);
      m[yr] = m[yr] ?? { legs: 0, miles: 0 };
      m[yr].legs++;
      m[yr].miles += l.miles || estimateMiles(l.origin, l.destination);
    });
    return Object.entries(m).sort(([a], [b]) => b.localeCompare(a));
  }, [legs]);
  const airports = new Set(legs.flatMap(l => [l.origin, l.destination]));

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="eyebrow mb-2">Travel</div>
          <h1 className="font-display text-3xl">Flights</h1>
          <p className="mt-1 text-sm text-muted-foreground">Your flight history, miles logged, and routes mapped.</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Scan boarding pass */}
          <button
            onClick={() => { setShowScanner(!showScanner); setShowAdd(false); }}
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium hover:border-blue/30 hover:text-blue transition-colors"
            data-testid="button-scan-boarding-pass"
          >
            <ScanLine size={14} /> Scan pass
          </button>
          {/* Manual log */}
          <button
            onClick={() => { setShowAdd(!showAdd); setShowScanner(false); }}
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium hover:border-blue/30 hover:text-blue transition-colors"
            data-testid="button-log-flight"
          >
            <Plus size={14} /> Log flight
          </button>
        </div>
      </div>

      {/* Boarding pass scanner */}
      {showScanner && (
        <BoardingPassScanner
          onParsed={handleScanned}
          onClose={() => setShowScanner(false)}
        />
      )}

      {/* Add flight form */}
      {showAdd && (
        <div className="dash-card overflow-hidden" data-testid="form-add-flight">
          <div className="dash-card-header px-5 py-3 flex items-center justify-between">
            <span className="text-sm font-semibold">Log a flight</span>
            {/* Subtle "scanned" indicator when form was pre-filled */}
            {form.origin && form.destination && (
              <span className="text-[10px] font-mono uppercase tracking-wider text-blue border border-blue/30 rounded px-2 py-0.5">
                {form.airline ? "Scanned" : "Manual"}
              </span>
            )}
          </div>
          <div className="px-5 py-4 space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { key: "origin", label: "From (IATA)", placeholder: "HNL" },
                { key: "destination", label: "To (IATA)", placeholder: "LAX" },
                { key: "departureDate", label: "Date", placeholder: "", type: "date" },
                { key: "airline", label: "Airline", placeholder: "United" },
              ].map(f => (
                <div key={f.key}>
                  <label className="eyebrow block mb-1">{f.label}</label>
                  <input
                    type={f.type ?? "text"}
                    value={(form as any)[f.key]}
                    onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                    placeholder={f.placeholder}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono uppercase placeholder:normal-case placeholder:font-sans focus:outline-none focus:border-blue/50 transition-colors"
                    data-testid={`input-flight-${f.key}`}
                  />
                </div>
              ))}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div>
                <label className="eyebrow block mb-1">Cabin</label>
                <select
                  value={form.cabin}
                  onChange={e => setForm(p => ({ ...p, cabin: e.target.value }))}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:border-blue/50 transition-colors"
                >
                  {CABINS.map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="eyebrow block mb-1">Flight # (optional)</label>
                <input
                  value={form.flightNumber}
                  onChange={e => setForm(p => ({ ...p, flightNumber: e.target.value }))}
                  placeholder="UA 1234"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:border-blue/50 transition-colors"
                />
              </div>
              <div>
                <label className="eyebrow block mb-1">Notes</label>
                <input
                  value={form.notes}
                  onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
                  placeholder="Optional"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:border-blue/50 transition-colors"
                />
              </div>
            </div>
            {form.origin && form.destination && estimateMiles(form.origin, form.destination) > 0 && (
              <div className="text-xs text-muted-foreground font-mono">
                ≈ {estimateMiles(form.origin, form.destination).toLocaleString()} miles estimated
              </div>
            )}
            <div className="flex items-center gap-3">
              <button
                onClick={() => addMutation.mutate()}
                disabled={!form.origin || !form.destination || !form.departureDate || addMutation.isPending}
                className="rounded-lg bg-blue text-white px-4 py-2 text-sm font-medium disabled:opacity-40 transition-opacity"
                data-testid="button-save-flight"
              >
                {addMutation.isPending ? "Saving..." : "Save flight"}
              </button>
              <button onClick={() => { setShowAdd(false); setForm(BLANK_FORM); }} className="text-sm text-muted-foreground hover:text-foreground">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Stats */}
      {legs.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Total miles", value: totalMiles.toLocaleString(), icon: <TrendingUp size={13} className="text-blue" /> },
            { label: "Flights logged", value: legs.length.toString(), icon: <Plane size={13} className="text-blue" /> },
            { label: "Airports", value: airports.size.toString(), icon: <MapPin size={13} className="text-blue" /> },
          ].map(s => (
            <div key={s.label} className="dash-card p-4">
              <div className="flex items-center gap-1.5 eyebrow mb-1">{s.icon}{s.label}</div>
              <div className="font-display text-2xl tabular">{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Arc Map */}
      {legs.length > 0 && <ArcMap legs={legs} />}

      {/* By year */}
      {byYear.length > 0 && (
        <div className="space-y-2">
          <div className="eyebrow mb-3">By year</div>
          {byYear.map(([year, data]) => {
            const maxMiles = Math.max(...byYear.map(([, d]) => d.miles));
            return (
              <div key={year} className="flex items-center gap-4">
                <div className="font-mono text-sm tabular w-12 text-muted-foreground">{year}</div>
                <div className="flex-1 h-6 bg-secondary/50 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue/70 rounded-full transition-all duration-500"
                    style={{ width: `${(data.miles / maxMiles) * 100}%` }}
                  />
                </div>
                <div className="font-mono text-xs tabular text-right w-32 text-muted-foreground">
                  {data.miles.toLocaleString()} mi · {data.legs} flights
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Flight list */}
      <div className="space-y-2">
        <div className="eyebrow mb-3">All flights</div>
        {isLoading && <div className="text-sm text-muted-foreground animate-pulse">Loading...</div>}
        {!isLoading && legs.length === 0 && (
          <div className="rounded-xl border border-dashed border-border p-10 text-center">
            <Plane size={32} className="mx-auto text-muted-foreground/30 mb-3" />
            <div className="text-sm font-medium mb-1">No flights logged yet</div>
            <div className="text-xs text-muted-foreground mb-4">Scan a boarding pass or log a flight manually.</div>
            <button
              onClick={() => setShowScanner(true)}
              className="inline-flex items-center gap-2 rounded-lg border border-blue/30 bg-blue/10 text-blue px-4 py-2 text-sm font-medium hover:bg-blue/20 transition-colors"
            >
              <ScanLine size={14} /> Scan boarding pass
            </button>
          </div>
        )}
        {legs.map(leg => {
          const miles = leg.miles || estimateMiles(leg.origin, leg.destination);
          return (
            <div key={leg.id} className="flex items-center gap-4 rounded-lg border border-border bg-card/60 px-4 py-3" data-testid={`flight-row-${leg.id}`}>
              <div className="font-mono text-xs text-muted-foreground w-20 shrink-0">
                {new Date(leg.departure_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" })}
              </div>
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <span className="font-mono font-semibold text-sm">{leg.origin}</span>
                <Plane size={11} className="text-muted-foreground/50 shrink-0" />
                <span className="font-mono font-semibold text-sm">{leg.destination}</span>
                {leg.airline && <span className="text-xs text-muted-foreground truncate">{leg.airline}{leg.flight_number ? ` · ${leg.flight_number}` : ""}</span>}
              </div>
              {leg.cabin && leg.cabin !== "Economy" && (
                <span className="hidden sm:inline text-[10px] font-mono uppercase tracking-wider text-gold border border-gold/30 rounded px-1.5 py-0.5 shrink-0">{leg.cabin}</span>
              )}
              {miles > 0 && (
                <div className="font-mono text-xs tabular text-muted-foreground shrink-0 w-20 text-right">
                  {miles.toLocaleString()} mi
                </div>
              )}
              <button
                onClick={() => removeMutation.mutate(leg.id)}
                className="text-muted-foreground/40 hover:text-rose transition-colors shrink-0"
                data-testid={`remove-flight-${leg.id}`}
              >
                <Trash2 size={13} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
