/**
 * Curated IATA airport code → coordinates lookup, for plotting flight
 * legs on FlightPathsMap without an external geocoding API (matching
 * PathsMap.tsx's "no API key needed" approach with CartoDB tiles).
 *
 * This is a hand-picked set of ~180 major US and international hubs —
 * not the full ~7,000-airport IATA database. It'll cover the large
 * majority of real routes, but a regional or small-city airport may be
 * missing. FlightPathsMap surfaces any unresolved codes explicitly
 * rather than silently dropping them, so it's obvious when to add one.
 *
 * To add an airport: `XXX: { lat, lon, city }` — city is optional but
 * shows in the map tooltip.
 */
export interface AirportCoord {
  lat: number;
  lon: number;
  city: string;
}

export const AIRPORTS: Record<string, AirportCoord> = {
  // ── Hawaii (home base) ──────────────────────────────────────────────────
  HNL: { lat: 21.3187, lon: -157.9224, city: "Honolulu" },
  OGG: { lat: 20.8986, lon: -156.4305, city: "Kahului, Maui" },
  KOA: { lat: 19.7388, lon: -156.0456, city: "Kona" },
  LIH: { lat: 21.9760, lon: -159.3389, city: "Lihue, Kauai" },
  ITO: { lat: 19.7214, lon: -155.0485, city: "Hilo" },

  // ── US West ─────────────────────────────────────────────────────────────
  LAX: { lat: 33.9416, lon: -118.4085, city: "Los Angeles" },
  SFO: { lat: 37.6213, lon: -122.3790, city: "San Francisco" },
  SAN: { lat: 32.7338, lon: -117.1933, city: "San Diego" },
  SJC: { lat: 37.3639, lon: -121.9289, city: "San Jose" },
  OAK: { lat: 37.7213, lon: -122.2207, city: "Oakland" },
  SMF: { lat: 38.6954, lon: -121.5908, city: "Sacramento" },
  SNA: { lat: 33.6757, lon: -117.8682, city: "Orange County" },
  BUR: { lat: 34.2007, lon: -118.3585, city: "Burbank" },
  ONT: { lat: 34.0560, lon: -117.6012, city: "Ontario, CA" },
  SEA: { lat: 47.4502, lon: -122.3088, city: "Seattle" },
  PDX: { lat: 45.5898, lon: -122.5951, city: "Portland" },
  LAS: { lat: 36.0840, lon: -115.1537, city: "Las Vegas" },
  PHX: { lat: 33.4342, lon: -112.0116, city: "Phoenix" },
  TUS: { lat: 32.1161, lon: -110.9410, city: "Tucson" },
  DEN: { lat: 39.8561, lon: -104.6737, city: "Denver" },
  SLC: { lat: 40.7899, lon: -111.9791, city: "Salt Lake City" },
  BOI: { lat: 43.5644, lon: -116.2228, city: "Boise" },
  ABQ: { lat: 35.0402, lon: -106.6091, city: "Albuquerque" },
  ANC: { lat: 61.1743, lon: -149.9982, city: "Anchorage" },

  // ── US Central / South ──────────────────────────────────────────────────
  DFW: { lat: 32.8998, lon: -97.0403, city: "Dallas–Fort Worth" },
  DAL: { lat: 32.8471, lon: -96.8518, city: "Dallas Love Field" },
  IAH: { lat: 29.9902, lon: -95.3368, city: "Houston" },
  HOU: { lat: 29.6454, lon: -95.2789, city: "Houston Hobby" },
  AUS: { lat: 30.1975, lon: -97.6664, city: "Austin" },
  SAT: { lat: 29.5337, lon: -98.4698, city: "San Antonio" },
  MSY: { lat: 29.9934, lon: -90.2580, city: "New Orleans" },
  MCI: { lat: 39.2976, lon: -94.7139, city: "Kansas City" },
  STL: { lat: 38.7487, lon: -90.3700, city: "St. Louis" },
  OKC: { lat: 35.3931, lon: -97.6007, city: "Oklahoma City" },
  TUL: { lat: 36.1984, lon: -95.8881, city: "Tulsa" },
  MSP: { lat: 44.8848, lon: -93.2223, city: "Minneapolis" },
  OMA: { lat: 41.3032, lon: -95.8941, city: "Omaha" },

  // ── US Midwest / Northeast ──────────────────────────────────────────────
  ORD: { lat: 41.9742, lon: -87.9073, city: "Chicago O'Hare" },
  MDW: { lat: 41.7868, lon: -87.7522, city: "Chicago Midway" },
  DTW: { lat: 42.2124, lon: -83.3534, city: "Detroit" },
  CLE: { lat: 41.4117, lon: -81.8498, city: "Cleveland" },
  CMH: { lat: 39.9980, lon: -82.8919, city: "Columbus" },
  IND: { lat: 39.7169, lon: -86.2956, city: "Indianapolis" },
  MKE: { lat: 42.9472, lon: -87.8966, city: "Milwaukee" },
  CVG: { lat: 39.0489, lon: -84.6678, city: "Cincinnati" },
  PIT: { lat: 40.4915, lon: -80.2329, city: "Pittsburgh" },
  BUF: { lat: 42.9405, lon: -78.7322, city: "Buffalo" },
  JFK: { lat: 40.6413, lon: -73.7781, city: "New York" },
  LGA: { lat: 40.7769, lon: -73.8740, city: "New York LaGuardia" },
  EWR: { lat: 40.6895, lon: -74.1745, city: "Newark" },
  BOS: { lat: 42.3656, lon: -71.0096, city: "Boston" },
  PHL: { lat: 39.8744, lon: -75.2424, city: "Philadelphia" },
  BWI: { lat: 39.1774, lon: -76.6684, city: "Baltimore" },
  IAD: { lat: 38.9531, lon: -77.4565, city: "Washington Dulles" },
  DCA: { lat: 38.8512, lon: -77.0402, city: "Washington National" },
  PVD: { lat: 41.7240, lon: -71.4283, city: "Providence" },
  ALB: { lat: 42.7483, lon: -73.8017, city: "Albany" },
  ROC: { lat: 43.1189, lon: -77.6724, city: "Rochester" },
  BDL: { lat: 41.9389, lon: -72.6832, city: "Hartford" },

  // ── US Southeast ────────────────────────────────────────────────────────
  ATL: { lat: 33.6407, lon: -84.4277, city: "Atlanta" },
  CLT: { lat: 35.2144, lon: -80.9473, city: "Charlotte" },
  RDU: { lat: 35.8776, lon: -78.7875, city: "Raleigh–Durham" },
  RIC: { lat: 37.5052, lon: -77.3197, city: "Richmond" },
  ORF: { lat: 36.8946, lon: -76.2012, city: "Norfolk" },
  CHS: { lat: 32.8986, lon: -80.0405, city: "Charleston" },
  SAV: { lat: 32.1276, lon: -81.2021, city: "Savannah" },
  JAX: { lat: 30.4941, lon: -81.6879, city: "Jacksonville" },
  MCO: { lat: 28.4312, lon: -81.3081, city: "Orlando" },
  TPA: { lat: 27.9755, lon: -82.5332, city: "Tampa" },
  FLL: { lat: 26.0726, lon: -80.1527, city: "Fort Lauderdale" },
  MIA: { lat: 25.7959, lon: -80.2870, city: "Miami" },
  PBI: { lat: 26.6832, lon: -80.0956, city: "West Palm Beach" },
  RSW: { lat: 26.5362, lon: -81.7552, city: "Fort Myers" },
  BNA: { lat: 36.1263, lon: -86.6774, city: "Nashville" },
  MEM: { lat: 35.0424, lon: -89.9767, city: "Memphis" },
  BHM: { lat: 33.5629, lon: -86.7535, city: "Birmingham" },

  // ── Canada ──────────────────────────────────────────────────────────────
  YYZ: { lat: 43.6777, lon: -79.6248, city: "Toronto" },
  YVR: { lat: 49.1947, lon: -123.1792, city: "Vancouver" },
  YUL: { lat: 45.4706, lon: -73.7408, city: "Montreal" },
  YYC: { lat: 51.1315, lon: -114.0106, city: "Calgary" },
  YOW: { lat: 45.3225, lon: -75.6692, city: "Ottawa" },

  // ── Mexico / Central America / Caribbean ───────────────────────────────
  MEX: { lat: 19.4363, lon: -99.0721, city: "Mexico City" },
  CUN: { lat: 21.0365, lon: -86.8771, city: "Cancún" },
  GDL: { lat: 20.5218, lon: -103.3111, city: "Guadalajara" },
  SJD: { lat: 23.1518, lon: -109.7213, city: "Los Cabos" },
  PVR: { lat: 20.6801, lon: -105.2544, city: "Puerto Vallarta" },
  SJU: { lat: 18.4394, lon: -66.0018, city: "San Juan" },
  NAS: { lat: 25.0389, lon: -77.4661, city: "Nassau" },
  MBJ: { lat: 18.5037, lon: -77.9134, city: "Montego Bay" },
  PTY: { lat: 9.0714, lon: -79.3835, city: "Panama City" },
  SJO: { lat: 9.9939, lon: -84.2088, city: "San José, CR" },

  // ── South America ───────────────────────────────────────────────────────
  BOG: { lat: 4.7016, lon: -74.1469, city: "Bogotá" },
  LIM: { lat: -12.0219, lon: -77.1143, city: "Lima" },
  SCL: { lat: -33.3930, lon: -70.7858, city: "Santiago" },
  GRU: { lat: -23.4356, lon: -46.4731, city: "São Paulo" },
  GIG: { lat: -22.8100, lon: -43.2506, city: "Rio de Janeiro" },
  EZE: { lat: -34.8222, lon: -58.5358, city: "Buenos Aires" },
  UIO: { lat: -0.1292, lon: -78.3575, city: "Quito" },

  // ── UK / Ireland ────────────────────────────────────────────────────────
  LHR: { lat: 51.4700, lon: -0.4543, city: "London Heathrow" },
  LGW: { lat: 51.1537, lon: -0.1821, city: "London Gatwick" },
  MAN: { lat: 53.3537, lon: -2.2750, city: "Manchester" },
  EDI: { lat: 55.9500, lon: -3.3725, city: "Edinburgh" },
  DUB: { lat: 53.4213, lon: -6.2701, city: "Dublin" },

  // ── Western Europe ──────────────────────────────────────────────────────
  CDG: { lat: 49.0097, lon: 2.5479, city: "Paris" },
  ORY: { lat: 48.7233, lon: 2.3794, city: "Paris Orly" },
  AMS: { lat: 52.3105, lon: 4.7683, city: "Amsterdam" },
  FRA: { lat: 50.0379, lon: 8.5622, city: "Frankfurt" },
  MUC: { lat: 48.3538, lon: 11.7861, city: "Munich" },
  BER: { lat: 52.3667, lon: 13.5033, city: "Berlin" },
  ZRH: { lat: 47.4647, lon: 8.5492, city: "Zurich" },
  GVA: { lat: 46.2381, lon: 6.1090, city: "Geneva" },
  VIE: { lat: 48.1103, lon: 16.5697, city: "Vienna" },
  BRU: { lat: 50.9014, lon: 4.4844, city: "Brussels" },
  MAD: { lat: 40.4983, lon: -3.5676, city: "Madrid" },
  BCN: { lat: 41.2971, lon: 2.0785, city: "Barcelona" },
  LIS: { lat: 38.7813, lon: -9.1359, city: "Lisbon" },
  FCO: { lat: 41.8003, lon: 12.2389, city: "Rome" },
  MXP: { lat: 45.6306, lon: 8.7281, city: "Milan" },
  VCE: { lat: 45.5053, lon: 12.3519, city: "Venice" },

  // ── Nordics ─────────────────────────────────────────────────────────────
  CPH: { lat: 55.6180, lon: 12.6560, city: "Copenhagen" },
  ARN: { lat: 59.6519, lon: 17.9186, city: "Stockholm" },
  OSL: { lat: 60.1976, lon: 11.1004, city: "Oslo" },
  HEL: { lat: 60.3172, lon: 24.9633, city: "Helsinki" },
  KEF: { lat: 63.9850, lon: -22.6056, city: "Reykjavík" },

  // ── Eastern Europe ──────────────────────────────────────────────────────
  WAW: { lat: 52.1657, lon: 20.9671, city: "Warsaw" },
  PRG: { lat: 50.1008, lon: 14.2600, city: "Prague" },
  BUD: { lat: 47.4298, lon: 19.2611, city: "Budapest" },
  ATH: { lat: 37.9364, lon: 23.9445, city: "Athens" },
  IST: { lat: 41.2753, lon: 28.7519, city: "Istanbul" },

  // ── Middle East ─────────────────────────────────────────────────────────
  DXB: { lat: 25.2532, lon: 55.3657, city: "Dubai" },
  AUH: { lat: 24.4330, lon: 54.6511, city: "Abu Dhabi" },
  DOH: { lat: 25.2609, lon: 51.6138, city: "Doha" },
  TLV: { lat: 32.0055, lon: 34.8854, city: "Tel Aviv" },

  // ── Africa ──────────────────────────────────────────────────────────────
  CAI: { lat: 30.1219, lon: 31.4056, city: "Cairo" },
  JNB: { lat: -26.1367, lon: 28.2411, city: "Johannesburg" },
  CPT: { lat: -33.9648, lon: 18.6017, city: "Cape Town" },
  NBO: { lat: -1.3192, lon: 36.9278, city: "Nairobi" },
  CMN: { lat: 33.3675, lon: -7.5900, city: "Casablanca" },

  // ── South / Southeast Asia ──────────────────────────────────────────────
  DEL: { lat: 28.5562, lon: 77.1000, city: "Delhi" },
  BOM: { lat: 19.0896, lon: 72.8656, city: "Mumbai" },
  SIN: { lat: 1.3644, lon: 103.9915, city: "Singapore" },
  BKK: { lat: 13.6900, lon: 100.7501, city: "Bangkok" },
  KUL: { lat: 2.7456, lon: 101.7099, city: "Kuala Lumpur" },
  CGK: { lat: -6.1256, lon: 106.6559, city: "Jakarta" },
  MNL: { lat: 14.5086, lon: 121.0195, city: "Manila" },
  SGN: { lat: 10.8188, lon: 106.6520, city: "Ho Chi Minh City" },
  HAN: { lat: 21.2212, lon: 105.8072, city: "Hanoi" },
  DPS: { lat: -8.7482, lon: 115.1672, city: "Bali" },

  // ── East Asia ───────────────────────────────────────────────────────────
  NRT: { lat: 35.7647, lon: 140.3864, city: "Tokyo Narita" },
  HND: { lat: 35.5494, lon: 139.7798, city: "Tokyo Haneda" },
  KIX: { lat: 34.4347, lon: 135.2441, city: "Osaka" },
  ICN: { lat: 37.4602, lon: 126.4407, city: "Seoul" },
  PVG: { lat: 31.1443, lon: 121.8083, city: "Shanghai" },
  PEK: { lat: 40.0799, lon: 116.6031, city: "Beijing" },
  HKG: { lat: 22.3080, lon: 113.9185, city: "Hong Kong" },
  TPE: { lat: 25.0777, lon: 121.2328, city: "Taipei" },

  // ── Oceania / Pacific ───────────────────────────────────────────────────
  SYD: { lat: -33.9399, lon: 151.1753, city: "Sydney" },
  MEL: { lat: -37.6690, lon: 144.8410, city: "Melbourne" },
  BNE: { lat: -27.3842, lon: 153.1175, city: "Brisbane" },
  AKL: { lat: -37.0082, lon: 174.7850, city: "Auckland" },
  NAN: { lat: -17.7554, lon: 177.4434, city: "Nadi, Fiji" },
  PPT: { lat: -17.5537, lon: -149.6070, city: "Tahiti" },
  GUM: { lat: 13.4834, lon: 144.7960, city: "Guam" },
};

/** Normalizes and looks up an IATA code (case-insensitive, trims whitespace). */
export function lookupAirport(code: string): AirportCoord | undefined {
  return AIRPORTS[(code || "").trim().toUpperCase()];
}
