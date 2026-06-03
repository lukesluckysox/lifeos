/**
 * BoardingPassScanner
 *
 * Decodes IATA BCBP (Bar Coded Boarding Pass) format from:
 *  - Camera capture (mobile-native via `capture="environment"`)
 *  - File upload (JPEG / PNG / PDF)
 *
 * Uses @zxing/library for PDF417 barcode detection (runs entirely client-side).
 * Falls back to manual entry if decode or parse fails.
 *
 * Parsed fields:  origin, destination, airline, flightNumber, departureDate, cabin
 */

import { useRef, useState } from "react";
import { BrowserMultiFormatReader, BarcodeFormat, DecodeHintType, NotFoundException } from "@zxing/library";
import { Camera, Upload, X, AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";

/* ── IATA BCBP month lookup (Julian day → ISO date) ─────────────── */
// Julian day of year → approximate month/day (non-leap year baseline)
function julianToISO(julianDay: number): string {
  const now = new Date();
  const year = now.getFullYear();
  // Try current year first; if result is >60 days in the past, use next year
  const d = new Date(year, 0, julianDay);
  if (now.getTime() - d.getTime() > 60 * 24 * 60 * 60 * 1000) {
    return new Date(year + 1, 0, julianDay).toISOString().slice(0, 10);
  }
  return d.toISOString().slice(0, 10);
}

/* ── Cabin code map ──────────────────────────────────────────────── */
const CABIN_MAP: Record<string, string> = {
  F: "First", A: "First", P: "First",
  J: "Business", C: "Business", D: "Business", I: "Business", Z: "Business",
  W: "Premium Economy",
  Y: "Economy", B: "Economy", E: "Economy", H: "Economy", K: "Economy",
  L: "Economy", M: "Economy", N: "Economy", Q: "Economy", S: "Economy",
  T: "Economy", U: "Economy", V: "Economy", X: "Economy",
};

/* ── IATA BCBP parser ────────────────────────────────────────────── */
export interface ParsedBoardingPass {
  origin: string;
  destination: string;
  airline: string;
  flightNumber: string;
  departureDate: string;  // ISO YYYY-MM-DD
  cabin: string;
  raw: string;
}

/** Extract the BCBP string from various encodings:
 *  - Direct BCBP string (starts with 'M')
 *  - URL-wrapped: https://...?bcbp=M1... or https://...#M1...
 *  - JSON-wrapped: { "bcbp": "M1..." } or { "data": "M1..." }
 *  - Southwest / airline-specific compact formats
 */
function extractBCBP(raw: string): string {
  const s = raw.trim();
  // Already a BCBP
  if (s.startsWith("M")) return s;
  // URL: extract fragment or query param that looks like BCBP
  try {
    const url = new URL(s);
    const fragment = url.hash.replace("#", "");
    if (fragment.startsWith("M")) return fragment;
    for (const [, v] of url.searchParams.entries()) {
      if (v.startsWith("M") && v.length > 40) return v;
    }
    // Path segment that starts with M
    const pathMatch = url.pathname.match(/\/(M[^/]+)/);
    if (pathMatch) return pathMatch[1];
  } catch { /* not a URL */ }
  // JSON
  try {
    const obj = JSON.parse(s);
    for (const key of ["bcbp", "data", "barcode", "raw", "payload"]) {
      if (typeof obj[key] === "string" && obj[key].startsWith("M")) return obj[key];
    }
  } catch { /* not JSON */ }
  // Last resort: find first occurrence of 'M1' or 'M2' in the string
  const mIdx = s.search(/M[1-9]/);
  if (mIdx !== -1) return s.slice(mIdx);
  return s;
}

function parseBCBP(rawInput: string): ParsedBoardingPass | null {
  const raw = extractBCBP(rawInput);
  // Minimum viable BCBP: must start with 'M' (Mandatory field indicator)
  // Format: M{legCount}{name padded 20}{eTicket padded 7}{origin 3}{dest 3}{airline 3}{flight# padded 5}{julianDay 3}{cabin 1}...
  const s = raw.trim();
  if (!s.startsWith("M")) return null;

  try {
    // Field 4: from (3 chars) — offset 30
    // Field 5: to (3 chars) — offset 33
    // Field 6: operating carrier (3 chars) — offset 36
    // Field 7: flight number (5 chars, right-justified) — offset 39
    // Field 11: departure date (Julian, 3 chars) — offset 44
    // Field 10: cabin (1 char) — offset 47

    const origin = s.slice(30, 33).trim().toUpperCase();
    const destination = s.slice(33, 36).trim().toUpperCase();
    const airline = s.slice(36, 39).trim().toUpperCase();
    const flightRaw = s.slice(39, 44).trim();
    const flightNumber = airline + " " + flightRaw.replace(/^0+/, "");
    const julianRaw = s.slice(44, 47).trim();
    const julian = parseInt(julianRaw, 10);
    const departureDate = !isNaN(julian) && julian > 0 ? julianToISO(julian) : "";
    const cabinCode = s.slice(47, 48).trim().toUpperCase();
    const cabin = CABIN_MAP[cabinCode] ?? "Economy";

    // Sanity check — origin/dest must be 3 alpha chars
    if (!/^[A-Z]{3}$/.test(origin) || !/^[A-Z]{3}$/.test(destination)) return null;

    return { origin, destination, airline, flightNumber, departureDate, cabin, raw: rawInput };
  } catch {
    return null;
  }
}

/* ── Component ───────────────────────────────────────────────────── */
interface BoardingPassScannerProps {
  onParsed: (pass: ParsedBoardingPass) => void;
  onClose: () => void;
}

type ScanState = "idle" | "scanning" | "success" | "error";

export function BoardingPassScanner({ onParsed, onClose }: BoardingPassScannerProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [state, setScanState] = useState<ScanState>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [preview, setPreview] = useState<string | null>(null);

  async function decodeImage(file: File) {
    setScanState("scanning");
    setErrorMsg("");

    // Show preview
    const objUrl = URL.createObjectURL(file);
    setPreview(objUrl);

    try {
      // Load image element
      const img = new Image();
      img.src = objUrl;
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = reject;
      });

      // Explicitly hint ZXing to try PDF417, QR, and Aztec — all boarding pass formats
      const hints = new Map();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [
        BarcodeFormat.PDF_417,
        BarcodeFormat.QR_CODE,
        BarcodeFormat.AZTEC,   // used by some transit/boarding passes
        BarcodeFormat.DATA_MATRIX,
      ]);
      hints.set(DecodeHintType.TRY_HARDER, true);

      const reader = new BrowserMultiFormatReader(hints);

      // decodeFromImage works directly on HTMLImageElement — no canvas needed
      const result = await reader.decodeFromImage(img);
      const raw = result.getText();

      const parsed = parseBCBP(raw);
      if (!parsed) {
        setScanState("error");
        setErrorMsg(`Barcode decoded but couldn't read boarding pass data. Raw: ${raw.slice(0, 60)}…`);
        return;
      }

      setScanState("success");
      setTimeout(() => onParsed(parsed), 600);
    } catch (e) {
      if (e instanceof NotFoundException) {
        setScanState("error");
        setErrorMsg("No barcode detected. Try a clearer, well-lit photo with the full barcode visible.");
      } else {
        setScanState("error");
        setErrorMsg("Something went wrong reading the image. Try a different photo or format.");
      }
    }
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    decodeImage(file);
    // Reset input so same file can be re-selected
    e.target.value = "";
  }

  return (
    <div className="dash-card overflow-hidden" data-testid="boarding-pass-scanner">
      <div className="dash-card-header flex items-center justify-between px-5 py-3">
        <span className="text-sm font-semibold">Scan boarding pass</span>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors p-1">
          <X size={14} />
        </button>
      </div>

      <div className="px-5 py-5 space-y-4">
        {/* State feedback */}
        {state === "scanning" && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 size={14} className="animate-spin" />
            Reading barcode…
          </div>
        )}
        {state === "success" && (
          <div className="flex items-center gap-2 text-sm text-green">
            <CheckCircle2 size={14} />
            Boarding pass decoded — filling form…
          </div>
        )}
        {state === "error" && (
          <div className="flex items-start gap-2 text-sm text-rose">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Preview thumbnail */}
        {preview && state !== "success" && (
          <img
            src={preview}
            alt="Boarding pass preview"
            className="w-full max-h-40 object-contain rounded-lg border border-border bg-card/40"
          />
        )}

        {/* Buttons */}
        {state !== "success" && (
          <div className="grid grid-cols-2 gap-3">
            {/* Camera — opens native camera on mobile */}
            <button
              type="button"
              onClick={() => cameraRef.current?.click()}
              disabled={state === "scanning"}
              className="flex flex-col items-center gap-2 rounded-xl border border-border bg-card/60 hover:bg-card hover:border-blue/30 transition-colors px-4 py-5 disabled:opacity-40"
              data-testid="button-scan-camera"
            >
              <Camera size={22} className="text-blue" />
              <span className="text-xs font-medium">Take photo</span>
              <span className="text-[10px] text-muted-foreground font-mono">Use camera</span>
            </button>

            {/* File upload */}
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={state === "scanning"}
              className="flex flex-col items-center gap-2 rounded-xl border border-border bg-card/60 hover:bg-card hover:border-blue/30 transition-colors px-4 py-5 disabled:opacity-40"
              data-testid="button-scan-upload"
            >
              <Upload size={22} className="text-blue" />
              <span className="text-xs font-medium">Upload image</span>
              <span className="text-[10px] text-muted-foreground font-mono">From gallery</span>
            </button>
          </div>
        )}

        {/* Hidden inputs */}
        {/* Camera input — capture="environment" opens rear camera on mobile */}
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={handleFile}
          data-testid="input-camera-capture"
        />
        {/* File input — no capture attr so it shows gallery / file picker */}
        <input
          ref={fileRef}
          type="file"
          accept="image/*,application/pdf"
          className="hidden"
          onChange={handleFile}
          data-testid="input-file-upload"
        />

        {/* Tips */}
        {state === "idle" && (
          <div className="rounded-lg border border-border/50 bg-card/20 px-3 py-2.5 text-[11px] text-muted-foreground leading-relaxed">
            Works with <span className="text-foreground font-medium">PDF417</span> (the wide rectangular barcode) and <span className="text-foreground font-medium">QR codes</span>. Works on physical passes, Apple Wallet screenshots, and airline app screenshots.
          </div>
        )}

        {/* Retry after error */}
        {state === "error" && (
          <button
            onClick={() => { setScanState("idle"); setPreview(null); }}
            className="text-xs text-blue hover:text-blue/80 transition-colors font-mono uppercase tracking-wider"
          >
            Try again
          </button>
        )}
      </div>
    </div>
  );
}
