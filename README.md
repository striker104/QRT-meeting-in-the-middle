# QRT Meeting In The Middle Hackathon Project

### This is a full-stack decision-support tool built for the DurHack 2025 "Meeting in the Middle" challenge.

Our tool ingests any meeting scenario and finds the optimal host city by running a powerful optimization algorithm. The core of our solution is a **"cost function"** that finds the best trade-off between **Carbon Emissions (CO2)** and **Travel Fairness**.

Unlike a simple calculator, our tool provides deep insights via an interactive dashboard. The user can use **sliders** to instantly adjust the "weight" given to:
* **🌍 CO2 Impact:** Prioritizes the lowest total carbon footprint.
* **🏃 Individual Fairness:** Minimizes the *maximum* travel time (no one has a terrible journey).
* **🤝 Group Fairness:** Minimizes the *standard deviation* of all travel times, ensuring the team is treated as a cohesive group.

---

### Key Features

* **🧠 AI-Powered Recommendations**
    We don't just give one answer. The tool calculates and presents the **Top 3 optimal locations**. For each, we use an AI (via OpenRouter) to automatically generate a **clear, data-driven rationale** explaining *why* it's a good choice based on your chosen slider weights.

* **💸 "Beyond Flights" Total Cost Analysis**
    We augment the OAG data by fetching real-time costs for **accommodation** (with a star-rating filter) and **"last-mile" Uber transit** (calculating airport-to-hotel time and cost), providing a true "door-to-door" analysis.

* **📊 Rich Metrics Dashboard**
    For each potential location, we provide all the metrics the judges ask for: Total CO2, Avg/Median/Max/Min Travel Hours, Total Event Cost (Flights + Hotels + Uber), and **Event Span** (minimizing the time from the first arrival to the last departure).

* **🗺️ Animated Visualizer**
    A polished Mapbox GL frontend provides an intuitive, animated "flow map" showing how all attendees converge on the proposed meeting hub.



___
***Input Form + Slider Showcase***

<table>
  <tr>
    <td><img height="850" alt="Screenshot 2025-11-04 at 16 35 30" src="https://github.com/user-attachments/assets/50e04b26-8800-43ed-8dfd-26bd0526f898" /></td>
    <td><img height="850" alt="Screenshot 2025-11-04 at 16 27 52" src="https://github.com/user-attachments/assets/7236433b-c114-4f22-8439-5e181af1b7f7" /></td>
  </tr>

</table>

---

***Location Selection, Metrics,Flight cost, Hotel rating select, Generative justification Showcase***

https://github.com/user-attachments/assets/86571e16-db81-438a-aa44-4279472fbee3

___

***Animated Map box that shows path to chosen location***

https://github.com/user-attachments/assets/2ea76375-a7b4-4ae0-83f1-b53574ef41df

___

***Flight Cost***

<img width="1440" height="782" alt="Screenshot 2025-11-04 at 16 48 41" src="https://github.com/user-attachments/assets/1b2fd0aa-b163-4992-b133-0e15a01870dd" />



Animated Mapbox GL prototype that visualises how attendees from global offices converge on a proposed meet-up hub.
here is the link to the repo with some of the data: https://github.com/orrygoob/durhack2025-flight-data.git

---

## Tech Stack

| Category | Technology | Purpose |
| :--- | :--- | :--- |
| **Backend** | **Python** | The core language for all optimization logic. |
| | **Polars** | High-performance data processing (`import polars as pl`) for the massive OAG flight schedule datasets. |
| | **Flask** | A lightweight web server (`from flask import Flask`) to create the API that connects the frontend to the Python logic. |
| | **Flask-CORS** | Used (`from flask_cors import CORS`) to allow the frontend web app to make requests to the backend API. |
| **Frontend** | **React** | The JavaScript library used to build the interactive user interface (inferred from `.tsx` files like `App.tsx`). |
| | **TypeScript** | The language for the entire frontend (inferred from all `.ts`/`.tsx` files), providing type safety. |
| | **(Vite)** | *(Inferred from your previous README)* The build tool used to serve and bundle the React + TypeScript frontend. |
| | **Mapbox GL** | Used to render the interactive globe and flight-path visualizations (inferred from `TravelMap.tsx`). |
| **Data & APIs** | **OpenRouter** | API client (`openRouterClient.ts`) to connect to AI models for generating justifications and analysis. |
| | **Uber API** | API client (`getUberPrices.ts`) to fetch "last-mile" transit costs and times. |
| | **OAG Data** | The core flight schedule and CO2 data (`challenge_data/schedules`) that the algorithm runs on. |

---
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
