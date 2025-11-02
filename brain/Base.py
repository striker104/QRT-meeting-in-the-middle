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
    )
    # We DO NOT filter for STOPS==0 here

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

# --- 4. "Hash Map" Creator ---

def create_compatibility_map(schedules_df):
    """
    Scans all schedules ONCE to build a fast lookup set of all
    valid (from, to) city pairs.
    """
    print("Building flight compatibility map (hash map)...")
    try:
        # This map is for DIRECT flights only, used for the pre-filter
        pairs_df = schedules_df.filter(pl.col("STOPS") == 0).select(["DEPCITY", "ARRCITY"]).unique().collect()
        compatibility_set = set(pairs_df.rows())
        print(f"Compatibility map built. Found {len(compatibility_set)} unique direct routes.")
        return compatibility_set
    except Exception as e:
        print(f"CRITICAL ERROR: Could not build compatibility map. {e}")
        sys.exit(1)

# --- 5. Core Scoring Engines ---

def find_flights(home_code, meeting_city_code, window_start, window_end):
    """Finds all direct AND 1-stop flights for a single leg (e.g., BOM -> SIN)"""
    
    # --- 1. Get Direct Flights (D0) ---
    direct_flights_lazy = schedules_lazy_df.filter(
        (pl.col("DEPCITY") == home_code) & 
        (pl.col("ARRCITY") == meeting_city_code) & 
        (pl.col("STOPS") == 0) &
        (pl.col("DEPART_TIME_UTC") >= window_start) &
        (pl.col("ARRIVE_TIME_UTC") <= window_end)
    )
    
    join_keys_left = ["DEPAPT", "ARRAPT", "AIRCRAFT_TYPE_CLEAN"]
    join_keys_right = ["DEPARTURE_AIRPORT", "ARRIVAL_AIRPORT", "AIRCRAFT_TYPE"]

    direct_flights_with_co2 = direct_flights_lazy.join(
        emissions_lazy_df, left_on=join_keys_left, right_on=join_keys_right, how="inner"
    ).select(
        pl.col("CO2_PER_PERSON_TONNES").alias("LEG_CO2"),
        pl.col("TRAVEL_HOURS").alias("LEG_TRAVEL_HOURS"),
        pl.col("DEPART_TIME_UTC"),
        pl.col("ARRIVE_TIME_UTC"),
        pl.lit("Direct").alias("Route_Type")
    )

    # --- 2. Get 1-Stop Flights (D1) ---
    min_layover = timedelta(hours=1, minutes=30)
    max_layover = timedelta(hours=8)

    leg1_lazy = schedules_lazy_df.filter(
        (pl.col("DEPCITY") == home_code) & 
        (pl.col("STOPS") == 0) &
        (pl.col("DEPART_TIME_UTC") >= window_start)
    ).join(
        emissions_lazy_df, left_on=join_keys_left, right_on=join_keys_right, how="inner"
    )

    leg2_lazy = schedules_lazy_df.filter(
        (pl.col("ARRCITY") == meeting_city_code) & 
        (pl.col("STOPS") == 0) &
        (pl.col("ARRIVE_TIME_UTC") <= window_end)
    ).join(
        emissions_lazy_df, left_on=join_keys_left, right_on=join_keys_right, how="inner"
    )

    connections_lazy = leg1_lazy.join(
        leg2_lazy, 
        left_on="ARRAPT", 
        right_on="DEPAPT", 
        suffix="_leg2"
    ).filter(
        (pl.col("DEPART_TIME_UTC_leg2") > pl.col("ARRIVE_TIME_UTC") + min_layover) &
        (pl.col("DEPART_TIME_UTC_leg2") < pl.col("ARRIVE_TIME_UTC") + max_layover)
    )

    connections_with_layover = connections_lazy.with_columns(
        (pl.col("DEPART_TIME_UTC_leg2") - pl.col("ARRIVE_TIME_UTC")).dt.total_hours().alias("layover")
    )
    
    one_stop_flights = connections_with_layover.select(
        (pl.col("CO2_PER_PERSON_TONNES") + pl.col("CO2_PER_PERSON_TONNES_leg2")).alias("LEG_CO2"),
        (pl.col("TRAVEL_HOURS") + pl.col("TRAVEL_HOURS_leg2") + pl.col("layover")).alias("LEG_TRAVEL_HOURS"),
        pl.col("DEPART_TIME_UTC"), 
        pl.col("ARRIVE_TIME_UTC_leg2").alias("ARRIVE_TIME_UTC"),
        pl.lit("1-Stop").alias("Route_Type")
    )

    all_flights = pl.concat([
        direct_flights_with_co2,
        one_stop_flights
    ])
    
    return all_flights

def get_all_valid_round_trips(home_code, meeting_city_code, window_start, window_end, event_duration_hours):
    """
    Finds ALL valid round trips (direct and 1-stop) for an attendee.
    """
    if home_code == meeting_city_code:
        return pl.DataFrame({
            "TOTAL_CO2": [0.0],
            "TOTAL_TRAVEL_HOURS": [0.0],
            "first_arrival": [None],
            "last_departure": [None],
            "Outbound_Route": ["Local"],
            "Inbound_Route": ["Local"]
        }).lazy()

    flights_to_lazy = find_flights(home_code, meeting_city_code, window_start, window_end).lazy()
    flights_from_lazy = find_flights(meeting_city_code, home_code, window_start, window_end).lazy()

    all_round_trips_lazy = flights_to_lazy.join(
        flights_from_lazy, how="cross", suffix="_return"
    ).filter(
        pl.col("DEPART_TIME_UTC_return") > (pl.col("ARRIVE_TIME_UTC") + timedelta(hours=event_duration_hours))
    ).select(
        (pl.col("LEG_CO2") + pl.col("LEG_CO2_return")).alias("TOTAL_CO2"),
        (pl.col("LEG_TRAVEL_HOURS") + pl.col("LEG_TRAVEL_HOURS_return")).alias("TOTAL_TRAVEL_HOURS"),
        pl.col("ARRIVE_TIME_UTC").alias("first_arrival"),
        pl.col("DEPART_TIME_UTC_return").alias("last_departure"),
        pl.col("Route_Type").alias("Outbound_Route"),
        pl.col("Route_Type_return").alias("Inbound_Route")
    )
    
    return all_round_trips_lazy

# --- 6. Final JSON Builder Function ---

def get_final_json_for_city(city_code, rank, phase_1_score, scenario_dict, optimize_span=False):
    """
    This function builds the complete, detailed JSON object for one city.
    If optimize_span is True, it runs the (fast) itertools logic.
    If False, it just picks the best CO2 flights for each person.
    """
    print(f"\n--- Building JSON for Rank {rank}: {city_code} ---")
    
    attendees = scenario_dict["attendees"]
    window_start = scenario_dict["window_start"]
    window_end = scenario_dict["window_end"]
    event_duration_hours = scenario_dict["event_duration_hours"]

    city_trip_options = []
    
    for home_city_name in attendees.keys():
        home_code = CITY_TO_CODE_MAP.get(home_city_name)
        if not home_code: continue

        limit = 5 if optimize_span else 1 
        
        top_n_trips = get_all_valid_round_trips(
            home_code, city_code, window_start, window_end, event_duration_hours
        ).sort("TOTAL_CO2").limit(limit).collect().to_dicts()
        
        if not top_n_trips:
            print(f"  ERROR: Could not find any flights from {home_code} to {city_code}.")
            return None 
        
        trips_with_context = []
        for trip in top_n_trips:
            new_trip = trip.copy()
            new_trip['home_city'] = home_city_name
            new_trip['attendee_count'] = attendees[home_city_name]
            trips_with_context.append(new_trip)
        
        city_trip_options.append(trips_with_context)
            
    # --- Find the Best Itinerary ---
    best_itinerary = None
    if optimize_span:
        print(f"  Running Phase 2 (Span Optimization) for {city_code}... testing {5**len(city_trip_options)} combinations.")
        best_itinerary_score = float('inf')
        
        for combination in itertools.product(*city_trip_options):
            
            arrival_times = [trip['first_arrival'] for trip in combination if trip['first_arrival'] is not None]
            departure_times = [trip['last_departure'] for trip in combination if trip['last_departure'] is not None]
            
            if not arrival_times or not departure_times: event_span_hours = 0
            else:
                event_span_hours = (max(departure_times) - min(arrival_times)).total_seconds() / 3600
                
            if event_span_hours < best_itinerary_score:
                best_itinerary_score = event_span_hours
                best_itinerary = combination
    else:
        best_itinerary = [options[0] for options in city_trip_options]

    if not best_itinerary:
        print(f"  FAILED: Could not find an itinerary for {city_code}.")
        return None

    # --- Now, calculate all metrics for the chosen itinerary ---
    
    final_trips_list = []
    for trip in best_itinerary:
        for _ in range(trip['attendee_count']):
            final_trips_list.append(trip)
    
    total_co2 = sum(trip['TOTAL_CO2'] for trip in final_trips_list)
    travel_hours_list = [trip['TOTAL_TRAVEL_HOURS'] for trip in final_trips_list]
    
    avg_travel_hours = statistics.mean(travel_hours_list)
    median_travel_hours = statistics.median(travel_hours_list)
    max_travel_hours = max(travel_hours_list)
    min_travel_hours = min(travel_hours_list)
    
    num_attendees = len(final_trips_list)
    avg_co2_per_person = total_co2 / num_attendees
    
    arrival_times = [trip['first_arrival'] for trip in final_trips_list if trip['first_arrival'] is not None]
    departure_times = [trip['last_departure'] for trip in final_trips_list if trip['last_departure'] is not None]

    if not arrival_times or not departure_times:
        span_start_time = window_start
        span_end_time = window_end
        meeting_start_time = window_start
        event_span_hours = 0
    else:
        span_start_time = min(arrival_times)
        span_end_time = max(departure_times)
        meeting_start_time = max(arrival_times)
        event_span_hours = (span_end_time - span_start_time).total_seconds() / 3600
    
    meeting_end_time = meeting_start_time + timedelta(hours=event_duration_hours)

    attendee_travel_map = {}
    df = pl.DataFrame(final_trips_list)
    avg_by_city = df.group_by("home_city").agg(
        pl.col("TOTAL_TRAVEL_HOURS").mean().alias("avg_travel")
    )
    for row in avg_by_city.to_dicts():
        attendee_travel_map[row['home_city']] = round(row['avg_travel'], 2)

    # --- Build the Output Dictionary ---
    output_object = {
        "rank": rank,
        "event_location": city_code,
        "phase_1_score": round(phase_1_score, 2),
        "event_dates": {
            "start": meeting_start_time.isoformat(),
            "end": meeting_end_time.isoformat()
        },
        "event_span": {
            "start": span_start_time.isoformat(),
            "end": span_end_time.isoformat(),
            "total_hours": round(event_span_hours, 2)
        },
        "total_co2_tonnes": round(total_co2, 2),
        "average_co2_per_person_tonnes": round(avg_co2_per_person, 2),
        "average_travel_hours": round(avg_travel_hours, 2),
        "median_travel_hours": round(median_travel_hours, 2),
        "max_travel_hours": round(max_travel_hours, 2),
        "min_travel_hours": round(min_travel_hours, 2),
        "attendee_travel_hours": attendee_travel_map
    }
    
    return output_object

# --- 7. Main Execution ---

schedules_lazy_df = get_lazy_schedules()
emissions_lazy_df = get_lazy_emissions()
COMPATIBILITY_MAP = create_compatibility_map(schedules_lazy_df)


if __name__ == "__main__":
    
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
    
    scenario_dict = {
        "attendees": attendees,
        "window_start": window_start,
        "window_end": window_end,
        "event_duration_hours": event_duration_hours
    }
    
    print(f"Using availability window: {window_start} to {window_end}")
    
    city_scores = []
    
    print("\n--- PHASE 1: Finding Best City (using Averages) ---")
    
    # C) Get all potential meeting cities
    all_home_codes = [CITY_TO_CODE_MAP[city] for city in attendees.keys()]
    
    print("Scanning for all reachable cities...")
    POTENTIAL_MEETING_CITIES = schedules_lazy_df.filter(
        (pl.col("DEPCITY").is_in(all_home_codes)) & (pl.col("STOPS") == 0)
    ).select(pl.col("ARRCITY")).unique().collect().to_series().to_list()
    
    POTENTIAL_MEETING_CITIES = list(set(POTENTIAL_MEETING_CITIES + all_home_codes))
    print(f"Found {len(POTENTIAL_MEETING_CITIES)} potential meeting cities to test.")

    
    for city_code in POTENTIAL_MEETING_CITIES:
        
        # --- "PRE-FILTER" STEP (Checks for DIRECT flights) ---
        possible = True
        for home_city_name in attendees.keys():
            home_code = CITY_TO_CODE_MAP[home_city_name]
            if home_code == city_code: 
                continue
            
            # This check is what makes it fast
            if (home_code, city_code) not in COMPATIBILITY_MAP:
                possible = False
                print(f"  SKIPPED: {city_code} (No direct flight from {home_code})")
                break
            if (city_code, home_code) not in COMPATIBILITY_MAP:
                possible = False
                print(f"  SKIPPED: {city_code} (No direct flight back to {home_code})")
                break
        
        if not possible:
            continue 
        # --- END OF PRE-FILTER ---

        print(f"Scoring city: {city_code}...")
        
        attendee_avg_scores = []
        
        for home_city_name, count in attendees.items():
            home_code = CITY_TO_CODE_MAP[home_city_name]
            
            # This now finds DIRECT and 1-STOP flights
            all_trips_df = get_all_valid_round_trips(
                home_code, city_code, window_start, window_end, event_duration_hours
            ).collect()
            
            if all_trips_df.is_empty():
                print(f"  FAILED (Post-Filter): No *valid window* round-trip found from {home_code} to {city_code}.")
                possible = False
                break 
            else:
                avg_co2 = all_trips_df["TOTAL_CO2"].mean()
                avg_travel = all_trips_df["TOTAL_TRAVEL_HOURS"].mean()
                
                for _ in range(count):
                    attendee_avg_scores.append({
                        "home_city": home_city_name,
                        "avg_co2": avg_co2,
                        "avg_travel": avg_travel
                    })
        
        if possible and attendee_avg_scores:
            total_co2 = sum(s['avg_co2'] for s in attendee_avg_scores)
            travel_hours_list = [s['avg_travel'] for s in attendee_avg_scores]
            std_dev_travel = statistics.stdev(travel_hours_list) if len(travel_hours_list) > 1 else 0
            
            W_CO2 = 1.0
            W_FAIRNESS = 10.0 
            total_score = (W_CO2 * total_co2) + (W_FAIRNESS * std_dev_travel)
            
            print(f"  SUCCESS: Score for {city_code}: {total_score:.2f} (Avg CO2: {total_co2:.2f}, Avg Fairness: {std_dev_travel:.2f})")
            
            city_scores.append({
                "city": city_code,
                "score": total_score,
            })
        
    # E) Find the winner of Phase 1
    if not city_scores:
        print("\nNo valid meeting locations found for this scenario.")
        sys.exit(1)
        
    # --- Sort and get Top 3 ---
    city_scores.sort(key=lambda x: x['score'])
    top_3_cities = city_scores[:3]
    
    print(f"\n--- PHASE 1 WINNERS: {[city['city'] for city in top_3_cities]} ---")
    
    # --- PHASE 2: Build Final JSON for Top 3 ---
    
    final_output_list = []
    
    for i, city_data in enumerate(top_3_cities, start=1):
        city_code = city_data['city']
        phase_1_score = city_data['score']
        
        # Only run span optimization for the #1 winner
        is_winner = (i == 1)
        
        city_json = get_final_json_for_city(
            city_code, 
            rank=i, 
            phase_1_score=phase_1_score,
            scenario_dict=scenario_dict,
            optimize_span=is_winner
        )
        
        if city_json:
            final_output_list.append(city_json)

    # --- Print the final JSON ---
    print("\n--- FINAL HACKATHON OUTPUT (JSON) ---")
    # We dump the whole list
    print(json.dumps(final_output_list, indent=4))
