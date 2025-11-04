# QRT Meeting In The Middle
<img width="637" height="720" alt="Screenshot 2025-11-04 at 16 35 30" src="https://github.com/user-attachments/assets/50e04b26-8800-43ed-8dfd-26bd0526f898" />
<img width="607" height="588" alt="Screenshot 2025-11-04 at 16 27 52" src="https://github.com/user-attachments/assets/e186de97-fd81-4b3c-8d81-8ca0228d972a" />
 


https://github.com/user-attachments/assets/86571e16-db81-438a-aa44-4279472fbee3


https://github.com/user-attachments/assets/2ea76375-a7b4-4ae0-83f1-b53574ef41df


<img width="1440" height="782" alt="Screenshot 2025-11-04 at 16 48 41" src="https://github.com/user-attachments/assets/1b2fd0aa-b163-4992-b133-0e15a01870dd" />



Animated Mapbox GL prototype that visualises how attendees from global offices converge on a proposed meet-up hub.
here is the link to the repo with some of the data: https://github.com/orrygoob/durhack2025-flight-data.git

## What this is:
- project made for durhack 2025 for QRT's Meeting in the Middle change
- uses a mathematical model visible in /brain to find the most optiomal route
- optimises based on **travel time fairness** and **CO2 emmisssions**
- backend built in python
- frontend built using vite
- they communicate through a flask server
- flight and accomodation costs with **perplexity/sonar-pro** through **openrouter**
- optmisation analysis with **MINI-MAX/M2** through **openrouter**

## Getting Started

### Frontend Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Add your API keys to a `.env` file in the project root:
   ```bash
   VITE_MAPBOX_TOKEN=pk.your_token_here
   VITE_UBER_SERVER_TOKEN=your_uber_server_token_here
   VITE_OPENROUTER_API_KEY=your_openrouter_api_key_here
   VITE_API_BASE_URL=http://localhost:5000
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

### Backend Setup

1. Install Python dependencies:
   ```bash
   cd server
   pip install -r requirements.txt
   ```

2. Make sure you have the flight data in the `brain/challenge_data/` directory (see the data repository link below).

3. Start the Flask server:
   ```bash
   python app.py
   ```
   
   The server will run on `http://localhost:5000` by default.

4. The frontend will automatically connect to the backend API for optimization requests.

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
