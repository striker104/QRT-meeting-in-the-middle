# QRT Meeting In The Middle

Animated Mapbox GL prototype that visualises how attendees from global offices converge on a proposed meet-up hub. The dataset is intentionally static right now—the goal is to provide a visual wrapper that your teammates can plug real scheduling logic into later.

here is the link to the repo with some of the data: https://github.com/orrygoob/durhack2025-flight-data.git

## Getting Started

1. Install dependencies:
   ```bash
   npm install
   ```
2. Add your API keys to a `.env` file in the project root:
   ```bash
   VITE_MAPBOX_TOKEN=pk.your_token_here
   VITE_UBER_SERVER_TOKEN=your_uber_server_token_here
   VITE_OPENROUTER_API_KEY=your_openrouter_api_key_here
   ```
   
   **Uber API Setup:**
   - Sign up at [Uber Developer Portal](https://developer.uber.com/)
   - Create a new application to get your Server Token
   - Add it to your `.env` file as `VITE_UBER_SERVER_TOKEN`
   - The app uses the Uber Sandbox API (`https://sandbox-api.uber.com`) for testing
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
