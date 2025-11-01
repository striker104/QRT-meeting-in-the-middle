# QRT Meeting In The Middle

Animated Mapbox GL prototype that visualises how attendees from global offices converge on a proposed meet-up hub. The dataset is intentionally static right now—the goal is to provide a visual wrapper that your teammates can plug real scheduling logic into later.

## Getting Started

1. Install dependencies:
   ```bash
   npm install
   ```
2. Add your Mapbox access token to a `.env` file in the project root:
   ```bash
   echo "VITE_MAPBOX_TOKEN=pk.your_token_here" > .env
   ```
3. Launch the dev server:
   ```bash
   npm run dev
   ```
4. Open the printed local URL (default `http://localhost:5173`).

## What You’ll See

- Animated globe with curved travel corridors flowing into the preset hub (`Bangkok Hub`).
- Red route lines draw in over a few seconds, then stay visible as the proposed paths.
- Line thickness scales with attendee volume so busier corridors stand out.
- Sidebar summarising availability window, event duration, and attendee counts per office.
- On-map legend clarifying the meaning of the visual cues.

## Tweaking The Scenario

- Update `src/data/sampleScenario.ts` to adjust origin offices, attendee counts, or the hub coordinates.
- Tweak animation feel (speed, curvature, marker styling) inside `src/components/TravelMap.tsx`.
- Plug in live scheduling or optimisation results by replacing the exported sample data with dynamic values.
