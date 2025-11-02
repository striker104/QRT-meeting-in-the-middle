import polars as pl
import json
import statistics
from datetime import datetime, timedelta
import sys
import itertools

# --- 1. Mappings ---
CITY_TO_CODE_MAP = {
    "Mumbai": "BOM", "Shanghai": "SHA", "Hong Kong": "HKG",
    "Singapore": "SIN", "Sydney": "SYD", "London": "LON",
    "Paris": "PAR", "Zurich": "ZRH", "Geneva": "GVA",
    "Dubai": "DXB", "Aarhus": "AAR", "Wroclaw": "WRO",
    "Budapest": "BUD"
}

# --- 2. File Paths ---
schedule_files = "challenge_data/*/*.csv" 
emissions_file = "challenge_data/emissions.csv"

# --- 3. Feature Engineering Functions ---

def get_lazy_schedules():
    SCHEDULE_COLS = [
        "CARRIER", "FLTNO", "DEPAPT", "ARRAPT", "ELPTIM",
        "SCHEDULED_DEPARTURE_DATE_TIME_UTC", "SCHEDULED_ARRIVAL_DATE_TIME_UTC",
        "STOPS", "EQUIPMENT_CD_ICAO", "DEPCITY", "ARRCITY"
    ]
    return pl.scan_csv(
        schedule_files, infer_schema_length=1000, null_values=[""]
    ).select(SCHEDULE_COLS).with_columns(
        (
            (pl.col("ELPTIM") / 100).floor() + (pl.col("ELPTIM") % 100) / 60
        ).alias("TRAVEL_HOURS"),
        pl.col("SCHEDULED_DEPARTURE_DATE_TIME_UTC")
            .str.to_datetime(strict=False)
            .dt.replace_time_zone("UTC")
            .alias("DEPART_TIME_UTC"),
        pl.col("SCHEDULED_ARRIVAL_DATE_TIME_UTC")
            .str.to_datetime(strict=False)
            .dt.replace_time_zone("UTC")
            .alias("ARRIVE_TIME_UTC"),
        pl.col("EQUIPMENT_CD_ICAO").str.slice(-3).alias("AIRCRAFT_TYPE_CLEAN")
    ).filter(pl.col("STOPS") == 0)

def get_lazy_emissions():
    EMISSIONS_COLS = [
        "DEPARTURE_AIRPORT", "ARRIVAL_AIRPORT",
        "AIRCRAFT_TYPE", "SEATS", "ESTIMATED_CO2_TOTAL_TONNES"
    ]
    return pl.scan_csv(
        emissions_file, infer_schema_length=1000, null_values=[""]
    ).select(EMISSIONS_COLS).with_columns(
        (
            pl.col("ESTIMATED_CO2_TOTAL_TONNES") / pl.col("SEATS")
        ).alias("CO2_PER_PERSON_TONNES")
    ).filter(pl.col("SEATS") > 0).unique(
        subset=["DEPARTURE_AIRPORT", "ARRIVAL_AIRPORT", "AIRCRAFT_TYPE"]
    )

# --- 4. Core Scoring Engines ---

def get_all_valid_round_trips(home_code, meeting_city_code, window_start, window_end, event_duration_hours):
    """
    Finds ALL valid round trips for an attendee and returns the lazy frame.
    """
    if home_code == meeting_city_code:
        # Return a lazy frame with one "0" row
        return pl.DataFrame({
            "TOTAL_CO2": [0.0],
            "TOTAL_TRAVEL_HOURS": [0.0],
            "first_arrival": [None],
            "last_departure": [None]
        }).lazy()

    flights_to_lazy = schedules_lazy_df.filter(
        (pl.col("DEPCITY") == home_code) & 
        (pl.col("ARRCITY") == meeting_city_code) & 
        (pl.col("DEPART_TIME_UTC") >= window_start) &
        (pl.col("ARRIVE_TIME_UTC") <= window_end)
    )
    
    flights_from_lazy = schedules_lazy_df.filter(
        (pl.col("DEPCITY") == meeting_city_code) & 
        (pl.col("ARRCITY") == home_code) &
        (pl.col("DEPART_TIME_UTC") >= window_start) &
        (pl.col("ARRIVE_TIME_UTC") <= window_end)
    )

    join_keys_left = ["DEPAPT", "ARRAPT", "AIRCRAFT_TYPE_CLEAN"]
    join_keys_right = ["DEPARTURE_AIRPORT", "ARRIVAL_AIRPORT", "AIRCRAFT_TYPE"]

    flights_to_with_co2_lazy = flights_to_lazy.join(
        emissions_lazy_df, left_on=join_keys_left, right_on=join_keys_right, how="inner"
    )
    
    flights_from_with_co2_lazy = flights_from_lazy.join(
        emissions_lazy_df, left_on=join_keys_left, right_on=join_keys_right, how="inner"
    )

    all_round_trips_lazy = flights_to_with_co2_lazy.join(
        flights_from_with_co2_lazy, how="cross", suffix="_return"
    ).filter(
        pl.col("DEPART_TIME_UTC_return") > (pl.col("ARRIVE_TIME_UTC") + timedelta(hours=event_duration_hours))
    ).select(
        (pl.col("CO2_PER_PERSON_TONNES") + pl.col("CO2_PER_PERSON_TONNES_return")).alias("TOTAL_CO2"),
        (pl.col("TRAVEL_HOURS") + pl.col("TRAVEL_HOURS_return")).alias("TOTAL_TRAVEL_HOURS"),
        pl.col("ARRIVE_TIME_UTC").alias("first_arrival"),
        pl.col("DEPART_TIME_UTC_return").alias("last_departure")
    )
    
    return all_round_trips_lazy

# --- 5. Main Execution ---

# These are global variables so our function can see them
schedules_lazy_df = get_lazy_schedules()
emissions_lazy_df = get_lazy_emissions()

if __name__ == "__main__":
    
    print("Initializing Lazy DataFrames...")
    print("DataFrames are ready.")
    
    # A) Load our input JSON
    input_file = "hackathon_test.json" 
    try:
        with open(input_file, 'r') as f:
            scenario = json.load(f)
        print(f"Loaded scenario: {scenario['attendees']}")
    except FileNotFoundError:
        print(f"ERROR: '{input_file}' not found. Please create it first.")
        sys.exit(1)

    # B) Get scenario parameters
    attendees = scenario["attendees"]
    window_start = datetime.fromisoformat(scenario["availability_window"]["start"])
    window_end = datetime.fromisoformat(scenario["availability_window"]["end"])
    event_duration_hours = scenario["event_duration"]["days"] * 24 + scenario["event_duration"]["hours"]
    
    print(f"Using availability window: {window_start} to {window_end}")
    
    city_scores = []
    
    print("\n--- PHASE 1: Finding Best City (using Averages) ---")
    
    # C) Loop through and score each potential city
    # --- NEW: Automatically find all potential cities ---
    all_home_codes = [CITY_TO_CODE_MAP[city] for city in attendees.keys()]
    
    print("Scanning for all reachable cities...")
    POTENTIAL_MEETING_CITIES = schedules_lazy_df.filter(
        pl.col("DEPCITY").is_in(all_home_codes)
    ).select(pl.col("ARRCITY")).unique().collect().to_series().to_list()
    
    # Also add the home cities themselves as potential locations
    POTENTIAL_MEETING_CITIES = list(set(POTENTIAL_MEETING_CITIES + all_home_codes))
    print(f"Found {len(POTENTIAL_MEETING_CITIES)} potential meeting cities to test.")

    
    for city_code in POTENTIAL_MEETING_CITIES:
        print(f"Scoring city: {city_code}...")
        
        attendee_avg_scores = []
        possible = True
        
        for home_city_name, count in attendees.items():
            home_code = CITY_TO_CODE_MAP.get(home_city_name)
            if not home_code:
                print(f"  Warning: No code for city '{home_city_name}'. Skipping.")
                continue
            
            # Find ALL valid trips
            all_trips_df = get_all_valid_round_trips(
                home_code, city_code, window_start, window_end, event_duration_hours
            ).collect()
            
            if all_trips_df.is_empty():
                # print(f"  FAILED: No valid round-trip found from {home_code} to {city_code}.")
                possible = False
                break 
            else:
                # Calculate the AVERAGE scores for this attendee
                avg_co2 = all_trips_df["TOTAL_CO2"].mean()
                avg_travel = all_trips_df["TOTAL_TRAVEL_HOURS"].mean()
                
                for _ in range(count):
                    attendee_avg_scores.append({
                        "avg_co2": avg_co2,
                        "avg_travel": avg_travel
                    })
        
        # D) Calculate the final scores for this city
        if possible and attendee_avg_scores:
            total_co2 = sum(s['avg_co2'] for s in attendee_avg_scores)
            
            travel_hours_list = [s['avg_travel'] for s in attendee_avg_scores]
            std_dev_travel = statistics.stdev(travel_hours_list) if len(travel_hours_list) > 1 else 0
            
            # --- Our Scoring Weights ---
            W_CO2 = 1.0
            W_FAIRNESS = 10.0 
            
            total_score = (W_CO2 * total_co2) + (W_FAIRNESS * std_dev_travel)
            
            print(f"  SUCCESS: Score for {city_code}: {total_score:.2f} (Avg CO2: {total_co2:.2f}, Avg Fairness: {std_dev_travel:.2f})")
            city_scores.append({
                "city": city_code,
                "score": total_score
            })
        
    # E) Find the winner of Phase 1
    if not city_scores:
        print("\nNo valid meeting locations found for this scenario.")
        sys.exit(1)
        
    winner = min(city_scores, key=lambda x: x['score'])
    winner_city_code = winner['city']
    print(f"\n--- PHASE 1 WINNER: {winner_city_code} (Score: {winner['score']:.2f}) ---")
    
    # --- PHASE 2: Find Best Itinerary (Minimizing Span) ---
    print(f"\n--- PHASE 2: Finding Best Itinerary for {winner_city_code} (Minimizing Span) ---")
    
    all_attendee_trip_options = []
    possible = True
    
    for home_city_name, count in attendees.items():
        home_code = CITY_TO_CODE_MAP.get(home_city_name)
        if not home_code: continue

        # Get the Top 5 trips (by CO2) for this attendee
        top_n_trips = get_all_valid_round_trips(
            home_code, winner_city_code, window_start, window_end, event_duration_hours
        ).sort("TOTAL_CO2").limit(5).collect().to_dicts()
        
        if not top_n_trips:
            print(f"  ERROR: Could not find any flights from {home_code} to {winner_city_code}.")
            possible = False
            break
        
        # *** NEW: "Tag" each trip with the home city name ***
        for _ in range(count):
            trips_with_context = []
            for trip in top_n_trips:
                new_trip = trip.copy()
                new_trip['home_city'] = home_city_name
                trips_with_context.append(new_trip)
            all_attendee_trip_options.append(trips_with_context)
            
    if possible:
        best_itinerary_score = float('inf')
        best_itinerary = None
        
        # Test all combinations
        for combination in itertools.product(*all_attendee_trip_options):
            
            arrival_times = [trip['first_arrival'] for trip in combination if trip['first_arrival'] is not None]
            departure_times = [trip['last_departure'] for trip in combination if trip['last_departure'] is not None]
            
            if not arrival_times or not departure_times:
                event_span_hours = 0
            else:
                first_arrival = min(arrival_times)
                last_departure = max(departure_times)
                event_span_hours = (last_departure - first_arrival).total_seconds() / 3600
                
            # This is our Phase 2 score. We ONLY care about span.
            if event_span_hours < best_itinerary_score:
                best_itinerary_score = event_span_hours
                best_itinerary = combination
    
    # F) Print the final, optimized result
    if best_itinerary:
        total_co2 = sum(trip['TOTAL_CO2'] for trip in best_itinerary)
        travel_hours_list = [trip['TOTAL_TRAVEL_HOURS'] for trip in best_itinerary]
        std_dev_travel = statistics.stdev(travel_hours_list) if len(travel_hours_list) > 1 else 0
        
        print("\n--- FINAL WINNING ITINERARY ---")
        print(f"The best city is: {winner_city_code}")
        print(f"Total CO2: {total_co2:.2f} tonnes")
        print(f"Travel Fairness (Std Dev): {std_dev_travel:.2f} hours")
        print(f"Optimized Event Span: {best_itinerary_score:.2f} hours")
        
        # *** NEW: Print a clean table of the itinerary ***
        print("\n--- Recommended Itinerary ---")
        itinerary_df = pl.DataFrame(best_itinerary)
        final_table = itinerary_df.select(
            pl.col("home_city").alias("Attendee"),
            pl.col("TOTAL_TRAVEL_HOURS").round(2).alias("Travel (Hours)"),
            pl.col("TOTAL_CO2").round(2).alias("CO2 (Tonnes)"),
            pl.col("first_arrival").alias("Arrives At (UTC)"),
            pl.col("last_departure").alias("Departs At (UTC)")
        ).sort("first_arrival") # Sort by who arrives first
        
        print(final_table)
        
    else:
        print(f"Could not find an optimized itinerary for {winner_city_code}.")
