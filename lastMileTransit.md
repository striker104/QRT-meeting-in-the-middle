Got it—let’s keep your current Mapbox GL visualization and plug in free (or free-tier) APIs that won’t make you wrestle with SDK sprawl. For a Proof of Concept, you mainly need: (1) reliable times + paths for ground/transit, (2) priced flight options, (3) one simple way to draw all of it on your existing map.

Here’s a clean, minimal-headache, free-tier stack that plays nicely with your TravelMap.tsx:

Final stack (PoC-friendly)

Keep
	•	Mapbox GL JS (you’re already using it). Use it just for the basemap + rendering.
Why: No refactor, great performance, easy styling.

Ground (walk/drive/bike + ferries where available)
	•	OpenRouteService Directions API (free tier)
Modes: driving-car, foot-walking, cycling-regular. Returns geometry (GeoJSON/polyline), distance, duration.
Why: Generous free plan for PoC, simple responses, no billing setup.

Public Transit (bus/train/metro/tram/ferry)
	•	Navitia.io Journey API (free key, rate-limited)
Returns full intermodal journeys with step geometries, durations, headsigns, and fares when the feed provides them.
Why: Easiest way to get actual transit itineraries worldwide (best in Europe), good enough for a PoC.

Flights (realistic prices + times)
	•	Amadeus Self-Service APIs (free sandbox → limited free live tier)
Use: Flight Offers Search → Flight Offers Price.
Why: You’ll get legit priced options you can sum into a door-to-door cost. The free tier is enough to demo.

Geocoding / Airports
	•	Mapbox Geocoding for city → coords (you already have the token).
	•	Lightweight airport picker: ship a tiny static JSON of IATA + lat/lng (top 2–3 per city/region). For PoC it’s simpler than wiring an “airports nearby” API.

Optional (skip for PoC): Uber estimates. Access is inconsistent; don’t depend on it. If you really want a price, show a heuristic (“est. £15–25”) and a deep link.

⸻

How it hangs together (simple flow)
	1.	City → airport(s)
	•	Pick up to 3 origin airports near each attendee city (from your static airports list). Same for the destination city.
	2.	Ground legs (to/from airports)
	•	If mode in [walking, cycling, driving] → call OpenRouteService to get a LineString + duration.
	•	If mode === transit → call Navitia for a journey; you’ll get each step as geometry (bus/train/ferry/walk).
	3.	Air leg
	•	For each originAirport × destAirport pair, query Amadeus for flights on the chosen date; confirm a priced offer. Keep 1–3 best options.
	4.	Aggregate
	•	Sum ground durations + flight duration (+ modest connection buffers).
	•	Sum known prices (flight price; transit fare when Navitia provides one). Leave unknowns as null with a “price unknown” badge.
	5.	Render in your existing map
	•	Convert every leg to GeoJSON LineString with a properties.mode and properties.price/duration.
	•	Add them to a single source and style by mode (color) and weight (attendees or confidence).
	•	Reuse your current animation approach (you already animate LineStrings—perfect).

⸻

Minimal server endpoints (one afternoon)

Create a thin server (Node/Express) so keys stay private:

GET /api/ground?mode=driving|walking|cycling&start=lng,lat&end=lng,lat
  -> calls OpenRouteService Directions; returns { geometry, distance_m, duration_s, provider: "ors" }

GET /api/transit?from=lng,lat&to=lng,lat&datetime=ISO
  -> calls Navitia Journey; returns [{ geometry, duration_s, fare_minor? , segments:[...]}]

POST /api/flights
  body: { origins:[IATA], destinations:[IATA], date:"YYYY-MM-DD" }
  -> Amadeus search + price; returns [{ price_minor, currency, itinerary:{geometry?, duration_s}}]

Front-end in TravelMap.tsx:
	•	Replace your current generateCurve() lines with the real GeoJSON returned from these endpoints.
	•	Keep your existing markers and animation; just animate along the API polyline instead of the bezier you’re synthesizing.

⸻

Display details (no headaches)
	•	Layering: one source, multiple layers by mode:
	•	mode = "walk" dashed, thin
	•	mode = "transit" solid, medium
	•	mode = "drive" solid
	•	mode = "flight" wide, semi-transparent
	•	Popups: on click, show: Mode • Duration • Price (if any) • Operator (for transit) • Flight number(s)
	•	Legend: a tiny corner legend mapping color → mode (static HTML/CSS).

⸻

Why this combo is the least painful (and free)
	•	You keep Mapbox GL (no rewrite).
	•	ORS + Navitia cover ground + transit without billing setup; responses are easy to draw.
	•	Amadeus gives you realistic prices for the only mode that absolutely needs them (flights).
	•	You avoid complex partner onboarding (Skyscanner/Kiwi) and uncertain ride-hail APIs.
	•	Everything reduces to: “fetch → normalize to GeoJSON → add to one Mapbox source”.

⸻

Tiny TypeScript shapes you can use

type LegMode = 'walk'|'cycle'|'drive'|'transit'|'flight';

type LegFeature = GeoJSON.Feature<GeoJSON.LineString, {
  mode: LegMode;
  provider: 'ors'|'navitia'|'amadeus';
  duration_s: number;
  price_minor?: number | null;
  currency?: string;
  details?: Record<string, any>; // operator, flight nos, etc.
}>;

type TripFeatureCollection = GeoJSON.FeatureCollection<GeoJSON.LineString, LegFeature['properties']>;

Add them to one Mapbox source (trip-legs) and style by ['get','mode'].

⸻

Action checklist
	1.	Sign up & grab keys: OpenRouteService, Navitia, Amadeus (self-service).
	2.	Add a tiny /api server with the 3 endpoints above (proxy + normalization).
	3.	Swap your synthetic curves for real leg polylines from those endpoints.
	4.	Add simple legend + popups.
	5.	For unknown prices, show “—” and a tooltip “Price unavailable from this operator”.

If you want, I can sketch the exact Express handlers and the Mapbox layer styling snippet you can paste straight into TravelMap.tsx.