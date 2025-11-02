import polars as pl
import json
import statistics
from datetime import datetime, timedelta, date
import sys
import itertools
from pathlib import Path
import time

# --- 1. Mappings ---
CITY_TO_CODE_MAP = {
    "Mumbai": "BOM",
    "Shanghai": "SHA",
    "Hong Kong": "HKG",
    "Singapore": "SIN",
    "Sydney": "SYD",
    "London": "LON",
    "Paris": "PAR",
    "Zurich": "ZRH",
    "Geneva": "GVA",
    "Dubai": "DXB",
    "Aarhus": "AAR",
    "Wroclaw": "WRO",
    "Budapest": "BUD"
}

# --- 2. File Paths ---
SCHEDULES_BASE_DIR = Path("challenge_data/schedules")
emissions_file = "challenge_data/emissions.csv"

# --- 3. Caching ---
ROUND_TRIP_CACHE = {}

# --- 4. Feature Engineering Functions ---
def get_schedule_files_for_window(start_date: date, end_date: date) -> list[Path]:
    """ Generates a list of file paths that exist within the given date window, following the /YYYY/MM/DD.csv structure. """
    print(f"Locating schedule files from {start_date} to {end_date}...")
    file_list = []
    current_day = start_date
    while current_day <= end_date:
        # Format the path: /shared/challenge_data/schedules/2025/05/01.csv
        year_str = str(current_day.year)
        month_str = f"{current_day.month:02d}"  # e.g., 5 -> "05"
        day_str = f"{current_day.day:02d}"  # e.g., 1 -> "01"
        file_path = SCHEDULES_BASE_DIR / year_str / month_str / f"{day_str}.csv"
        # IMPORTANT: Check if the file actually exists before adding it
        if file_path.exists():
            file_list.append(file_path)
        current_day += timedelta(days=1)
    return file_list

def get_lazy_schedules(file_list: list[Path]):
    """ Loads specific schedules, cleans them, and filters for Passenger/Operating flights. """
    SCHEDULE_COLS = [
        "CARRIER",
        "FLTNO",
        "DEPAPT",
        "ARRAPT",
        "ELPTIM",
        "SCHEDULED_DEPARTURE_DATE_TIME_UTC",
        "SCHEDULED_ARRIVAL_DATE_TIME_UTC",
        "STOPS",
        "EQUIPMENT_CD_ICAO",
        "DEPCITY",
        "ARRCITY",
        "SERVICE",
        "OPERATING"
    ]
    return pl.scan_csv(
        file_list,
        infer_schema_length=1000,
        null_values=[""],
        schema_overrides={"ARRDAY": pl.String}  # <-- FIX for 'P' in ARRDAY
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
    ).filter(
        (pl.col("SERVICE") == "J") & (pl.col("OPERATING") != "N")
    )

def get_lazy_emissions():
    """ Loads and cleans the emissions lookup table. """
    EMISSIONS_COLS = [
        "DEPARTURE_AIRPORT",
        "ARRIVAL_AIRPORT",
        "AIRCRAFT_TYPE",
        "SEATS",
        "ESTIMATED_CO2_TOTAL_TONNES"
    ]
    return pl.scan_csv(
        emissions_file,
        infer_schema_length=1000,
        null_values=[""]
    ).select(EMISSIONS_COLS).with_columns(
        (
            pl.col("ESTIMATED_CO2_TOTAL_TONNES") / pl.col("SEATS")
        ).alias("CO2_PER_PERSON_TONNES")
    ).filter(pl.col("SEATS") > 0).unique(
        subset=["DEPARTURE_AIRPORT", "ARRIVAL_AIRPORT", "AIRCRAFT_TYPE"]
    )

# --- 5. "Hash Map" Creator ---
def create_compatibility_map(schedules_df):
    """ Scans all schedules ONCE to build a fast lookup set of all valid (from, to) city pairs. """
    print("Building flight compatibility map (hash map)...")
    try:
        # Hash map is built on the *already filtered* (J, not N) data
        pairs_df = schedules_df.filter(pl.col("STOPS") == 0).select(["DEPCITY", "ARRCITY"]).unique().collect()
        compatibility_set = set(pairs_df.rows())
        print(f"Compatibility map built. Found {len(compatibility_set)} unique direct routes.")
        return compatibility_set
    except Exception as e:
        print(f"CRITICAL ERROR: Could not build compatibility map. {e}")
        sys.exit(1)

# --- 6. Core Scoring Engines ---
def find_flights(home_code, meeting_city_code, window_start, window_end, include_connecting: bool = True):
    """Finds all direct AND (if specified) 1-stop flights for a single leg (e.g., BOM -> SIN)"""
    
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
        emissions_lazy_df,
        left_on=join_keys_left,
        right_on=join_keys_right,
        how="inner"
    ).select(
        pl.col("CO2_PER_PERSON_TONNES").alias("LEG_CO2"),
        pl.col("TRAVEL_HOURS").alias("LEG_TRAVEL_HOURS"),
        pl.col("DEPART_TIME_UTC"),
        pl.col("ARRIVE_TIME_UTC"),
        pl.lit("Direct").alias("Route_Type"),
        # Add flight details
        pl.col("CARRIER"),
        pl.col("FLTNO"),
        pl.col("DEPAPT"),
        pl.col("ARRAPT")
    ).filter(pl.col("LEG_CO2").is_not_null()
    ).filter(pl.col("LEG_TRAVEL_HOURS").is_not_null())

    # --- [NEW] Check if we should stop here ---
    if not include_connecting:
        return direct_flights_with_co2 # Return *only* direct flights

    # --- 2. Get 1-Stop Flights (D1) ---
    min_layover = timedelta(hours=1, minutes=30)
    max_layover = timedelta(hours=8)
    
    leg1_lazy = schedules_lazy_df.filter(
        (pl.col("DEPCITY") == home_code) &
        (pl.col("STOPS") == 0) &
        (pl.col("DEPART_TIME_UTC") >= window_start)
    ).join(
        emissions_lazy_df,
        left_on=join_keys_left,
        right_on=join_keys_right,
        how="inner"
    )
    
    leg2_lazy = schedules_lazy_df.filter(
        (pl.col("ARRCITY") == meeting_city_code) &
        (pl.col("STOPS") == 0) &
        (pl.col("ARRIVE_TIME_UTC") <= window_end)
    ).join(
        emissions_lazy_df,
        left_on=join_keys_left,
        right_on=join_keys_right,
        how="inner"
    )
    
    connections_lazy = leg1_lazy.join(
        leg2_lazy,
        left_on="ARRAPT",
        right_on="DEPAPT",
        suffix="_leg2"
    )
    
    connections_with_layover = connections_lazy.with_columns(
        (pl.col("DEPART_TIME_UTC_leg2") - pl.col("ARRIVE_TIME_UTC")).dt.total_hours().alias("layover")
    )
    
    valid_connections = connections_with_layover.filter(
        (pl.col("layover") > min_layover.total_seconds() / 3600) &
        (pl.col("layover") < max_layover.total_seconds() / 3600)
    )
    
    one_stop_flights = valid_connections.select(
        (pl.col("CO2_PER_PERSON_TONNES") + pl.col("CO2_PER_PERSON_TONNES_leg2")).alias("LEG_CO2"),
        (pl.col("TRAVEL_HOURS") + pl.col("TRAVEL_HOURS_leg2") + pl.col("layover")).alias("LEG_TRAVEL_HOURS"),
        pl.col("DEPART_TIME_UTC"),
        pl.col("ARRIVE_TIME_UTC_leg2").alias("ARRIVE_TIME_UTC"),
        pl.lit("1-Stop").alias("Route_Type"),
        # Add flight details (Leg 1 carrier/fltno, final dest)
        pl.col("CARRIER"),
        pl.col("FLTNO"),
        pl.col("DEPAPT"),
        pl.col("ARRAPT_leg2").alias("ARRAPT")
    ).filter(pl.col("LEG_CO2").is_not_null()
    ).filter(pl.col("LEG_TRAVEL_HOURS").is_not_null()
    )

    all_flights = pl.concat([direct_flights_with_co2, one_stop_flights])
    return all_flights

def get_all_valid_round_trips(home_code, meeting_city_code, window_start, window_end, event_duration_hours, include_connecting: bool = True):
    """ Finds ALL valid round trips (direct and 1-stop) for an attendee. *** THIS FUNCTION IS NOW CACHED *** """
    
    # --- [NEW] Add include_connecting to the cache key ---
    cache_key = (home_code, meeting_city_code, window_start.isoformat(), window_end.isoformat(), event_duration_hours, include_connecting)
    if cache_key in ROUND_TRIP_CACHE:
        return ROUND_TRIP_CACHE[cache_key]

    if home_code == meeting_city_code:
        result_df = pl.DataFrame({
            "TOTAL_CO2": [0.0],
            "TOTAL_TRAVEL_HOURS": [0.0],
            "first_arrival": [None],
            "last_departure": [None],
            "Outbound_Route": ["Local"],
            "Inbound_Route": ["Local"],
            "outbound_carrier": [None],
            "outbound_fltno": [None],
            "outbound_dep_utc": [None],
            "outbound_dep_apt": [None],
            "outbound_arr_apt": [None],
            "inbound_carrier": [None],
            "inbound_fltno": [None],
            "inbound_dep_utc": [None],
            "inbound_dep_apt": [None],
            "inbound_arr_apt": [None],
        })
        ROUND_TRIP_CACHE[cache_key] = result_df
        return result_df

    # --- [NEW] Pass the include_connecting flag down ---
    flights_to_lazy = find_flights(
        home_code, meeting_city_code, window_start, window_end, include_connecting=include_connecting
    ).lazy()
    flights_from_lazy = find_flights(
        meeting_city_code, home_code, window_start, window_end, include_connecting=include_connecting
    ).lazy()

    all_round_trips_lazy = flights_to_lazy.join(
        flights_from_lazy,
        how="cross",
        suffix="_return"
    ).filter(
        pl.col("DEPART_TIME_UTC_return") > (pl.col("ARRIVE_TIME_UTC") + timedelta(hours=event_duration_hours))
    )

    final_trips_df = all_round_trips_lazy.select(
        (pl.col("LEG_CO2") + pl.col("LEG_CO2_return")).alias("TOTAL_CO2"),
        (pl.col("LEG_TRAVEL_HOURS") + pl.col("LEG_TRAVEL_HOURS_return")).alias("TOTAL_TRAVEL_HOURS"),
        pl.col("ARRIVE_TIME_UTC").alias("first_arrival"),
        pl.col("DEPART_TIME_UTC_return").alias("last_departure"),
        pl.col("Route_Type").alias("Outbound_Route"),
        pl.col("Route_Type_return").alias("Inbound_Route"),
        pl.col("CARRIER").alias("outbound_carrier"),
        pl.col("FLTNO").alias("outbound_fltno"),
        pl.col("DEPART_TIME_UTC").alias("outbound_dep_utc"),
        pl.col("DEPAPT").alias("outbound_dep_apt"),
        pl.col("ARRAPT").alias("outbound_arr_apt"),
        pl.col("CARRIER_return").alias("inbound_carrier"),
        pl.col("FLTNO_return").alias("inbound_fltno"),
        pl.col("DEPART_TIME_UTC_return").alias("inbound_dep_utc"),
        pl.col("DEPAPT_return").alias("inbound_dep_apt"),
        pl.col("ARRAPT_return").alias("inbound_arr_apt"),
    ).collect()

    ROUND_TRIP_CACHE[cache_key] = final_trips_df
    return final_trips_df

# --- 7. Final JSON Builder Function ---
def get_final_json_for_city(city_code, rank, phase_1_score, scenario_dict, optimize_span=False, consider_connecting_flights: bool = True):
    """ This function builds the complete, detailed JSON object for one city. """
    print(f"\n--- Building JSON for Rank {rank}: {city_code} ---")
    attendees = scenario_dict["attendees"]
    window_start = scenario_dict["window_start"]
    window_end = scenario_dict["window_end"]
    event_duration_hours = scenario_dict["event_duration_hours"]

    city_trip_options = []
    for home_city_name in attendees.keys():
        home_code = CITY_TO_CODE_MAP.get(home_city_name)
        if not home_code:
            continue
        limit = 5 if optimize_span else 1
        
        # --- [NEW] Pass the connecting flights flag ---
        all_trips_df = get_all_valid_round_trips(
            home_code, city_code, window_start, window_end, event_duration_hours,
            include_connecting=consider_connecting_flights
        )
        
        top_n_trips = all_trips_df.sort("TOTAL_CO2").limit(limit).to_dicts()
        if not top_n_trips:
            print(f" ERROR: Could not find any flights from {home_code} to {city_code}.")
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
        print(f" Running Phase 2 (Span Optimization) for {city_code}... testing {5**len(city_trip_options)} combinations.")
        best_itinerary_score = float('inf')
        for combination in itertools.product(*city_trip_options):
            arrival_times = [trip['first_arrival'] for trip in combination if trip['first_arrival'] is not None]
            departure_times = [trip['last_departure'] for trip in combination if trip['last_departure'] is not None]
            if not arrival_times or not departure_times:
                event_span_hours = 0
            else:
                event_span_hours = (max(departure_times) - min(arrival_times)).total_seconds() / 3600
            if event_span_hours < best_itinerary_score:
                best_itinerary_score = event_span_hours
                best_itinerary = combination
    else:
        best_itinerary = [options[0] for options in city_trip_options]

    if not best_itinerary:
        print(f" FAILED: Could not find an itinerary for {city_code}.")
        return None

    # --- Now, calculate all metrics for the chosen itinerary ---
    final_trips_list_unrolled = []
    for trip in best_itinerary:
        for _ in range(trip['attendee_count']):
            final_trips_list_unrolled.append(trip)

    total_co2 = sum(trip['TOTAL_CO2'] for trip in final_trips_list_unrolled)
    travel_hours_list = [trip['TOTAL_TRAVEL_HOURS'] for trip in final_trips_list_unrolled]
    avg_travel_hours = statistics.mean(travel_hours_list)
    median_travel_hours = statistics.median(travel_hours_list)
    max_travel_hours = max(travel_hours_list)
    min_travel_hours = min(travel_hours_list)
    num_attendees = len(final_trips_list_unrolled)
    avg_co2_per_person = total_co2 / num_attendees

    arrival_times = [trip['first_arrival'] for trip in final_trips_list_unrolled if trip['first_arrival'] is not None]
    departure_times = [trip['last_departure'] for trip in final_trips_list_unrolled if trip['last_departure'] is not None]
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
    df = pl.DataFrame(final_trips_list_unrolled)
    avg_by_city = df.group_by("home_city").agg(
        pl.col("TOTAL_TRAVEL_HOURS").mean().alias("avg_travel")
    )
    for row in avg_by_city.to_dicts():
        attendee_travel_map[row['home_city']] = round(row['avg_travel'], 2)

    # --- Build the "shopping list" for pricing ---
    itinerary_list = []
    # Use best_itinerary (not unrolled) to get unique city pairs
    for trip in best_itinerary:
        # Add outbound flight if not local
        if trip['Outbound_Route'] != 'Local':
            itinerary_list.append([
                trip['outbound_dep_apt'],
                trip['outbound_arr_apt'],
                trip['outbound_carrier'],
                trip['outbound_fltno'],
                trip['outbound_dep_utc'].isoformat() if trip['outbound_dep_utc'] else None,
                trip['attendee_count'],
                "out",
                trip['Outbound_Route']
            ])
        # Add inbound flight if not local
        if trip['Inbound_Route'] != 'Local':
            itinerary_list.append([
                trip['inbound_dep_apt'],
                trip['inbound_arr_apt'],
                trip['inbound_carrier'],
                trip['inbound_fltno'],
                trip['inbound_dep_utc'].isoformat() if trip['inbound_dep_utc'] else None,
                trip['attendee_count'],
                "in",
                trip['Inbound_Route']
            ])

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
        "attendee_travel_hours": attendee_travel_map,
        "itinerary": itinerary_list
    }
    return output_object

# --- 9. Main Function ---
def find_best_meeting(input_json_path, weight_co2, weight_avg_vs_std, consider_connecting_flights: bool = True):
    """ This is the main function for our API. It takes a json file path and a CO2 weight (0.0 to 1.0) and returns the Top 3 recommendations. """
    # We must declare these as global so that all the helper
    # functions (find_flights, etc.) can see them.
    global schedules_lazy_df, emissions_lazy_df, COMPATIBILITY_MAP

    # Clear the cache for each new run
    global ROUND_TRIP_CACHE
    ROUND_TRIP_CACHE = {}

    # A) Validate weights
    if not 0.0 <= weight_co2 <= 1.0:
        raise ValueError("weight_co2 must be between 0.0 and 1.0")
    if not 0.0 <= weight_avg_vs_std <= 1.0:
        raise ValueError("weight_avg_vs_std must be between 0.0 and 1.0")
    weight_fairness = 1.0 - weight_co2
    weight_std = 1.0 - weight_avg_vs_std
    print(f"\n--- RUNNING ANALYSIS ---")
    print(f"Weights: CO2={weight_co2}, Fairness={weight_fairness}")
    # --- [NEW] Print the connecting flight status ---
    print(f"Considering Connecting Flights: {consider_connecting_flights}")


    # B) Load our input JSON
    try:
        with open(input_json_path, 'r') as f:
            scenario = json.load(f)
        print(f"Loaded scenario: {scenario['attendees']}")
    except FileNotFoundError:
        print(f"ERROR: '{input_json_path}' not found.")
        return [{"error": f"File not found: {input_json_path}"}]

    # C) Get scenario parameters
    attendees = scenario["attendees"]
    # --- FIX for 'Z' ---
    window_start = datetime.fromisoformat(scenario["availability_window"]["start"].replace("Z", "+00:00"))
    window_end = datetime.fromisoformat(scenario["availability_window"]["end"].replace("Z", "+00:00"))
    event_duration_hours = scenario["event_duration"]["days"] * 24 + scenario["event_duration"]["hours"]
    scenario_dict = {
        "attendees": attendees,
        "window_start": window_start,
        "window_end": window_end,
        "event_duration_hours": event_duration_hours
    }
    print(f"Using availability window: {window_start} to {window_end}")

    # --- (NEW) PHASE 0: Load Data Based on Window ---
    print("\n--- PHASE 0: Loading data for specified window ---")
    # Use .date() to convert datetime to date for the helper function
    relevant_files = get_schedule_files_for_window(window_start.date(), window_end.date())
    if not relevant_files:
        print(f"ERROR: No schedule files found in the window {window_start.date()} to {window_end.date()}.")
        return [{"error": "No schedule files found for the specified availability window."}]
    print(f"Found {len(relevant_files)} schedule files to load.")

    # Now we build our "hash maps" using only the relevant files
    schedules_lazy_df = get_lazy_schedules(relevant_files)
    emissions_lazy_df = get_lazy_emissions()
    COMPATIBILITY_MAP = create_compatibility_map(schedules_lazy_df)
    print("Filtered data loaded. Starting Phase 1...")
    # --- END OF NEW PHASE 0 ---

    city_scores = []
    print("\n--- PHASE 1: Finding Best City (using Averages) ---")

    # D) Get all potential meeting cities
    all_home_codes = [CITY_TO_CODE_MAP.get(city) for city in attendees.keys() if CITY_TO_CODE_MAP.get(city)]
    print("Scanning for all reachable cities...")
    POTENTIAL_MEETING_CITIES = schedules_lazy_df.filter(
        (pl.col("DEPCITY").is_in(all_home_codes)) & (pl.col("STOPS") == 0)
    ).select(pl.col("ARRCITY")).unique().collect().to_series().to_list()
    POTENTIAL_MEETING_CITIES = list(set(POTENTIAL_MEETING_CITIES + all_home_codes))
    print(f"Found {len(POTENTIAL_MEETING_CITIES)} potential meeting cities to test.")

    for city_code in POTENTIAL_MEETING_CITIES:
        city_start_time = time.time()  # <-- TIMER START

        # --- "PRE-FILTER" STEP (Checks for DIRECT flights) ---
        possible = True
        for home_city_name in attendees.keys():
            home_code = CITY_TO_CODE_MAP.get(home_city_name)
            if not home_code or home_code == city_code:
                continue
            # --- THIS IS THE PRINT YOU WANTED (UNCOMMENTED) ---
            if (home_code, city_code) not in COMPATIBILITY_MAP:
                possible = False
                print(f" SKIPPED (Pre-filter): {city_code} (No direct flight from {home_code})")
                break
            if (city_code, home_code) not in COMPATIBILITY_MAP:
                possible = False
                print(f" SKIPPED (Pre-filter): {city_code} (No direct flight back to {home_code})")
                break
        if not possible:
            continue
        # --- END OF PRE-FILTER ---

        attendee_avg_scores = []
        for home_city_name, count in attendees.items():
            home_code = CITY_TO_CODE_MAP.get(home_city_name)
            
            # --- [NEW] Pass the connecting flights flag ---
            all_trips_df = get_all_valid_round_trips(
                home_code, city_code, window_start, window_end, event_duration_hours,
                include_connecting=consider_connecting_flights
            )
            
            if all_trips_df.is_empty():
                print(f" SKIPPED (Post-filter): {city_code} (No valid round-trip found from {home_code} in time window)")
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
            avg_travel = statistics.mean(travel_hours_list)
            std_dev_travel = statistics.stdev(travel_hours_list) if len(travel_hours_list) > 1 else 0
            fairness_score = (weight_avg_vs_std * avg_travel) + (weight_std * std_dev_travel)
            total_score = (weight_co2 * total_co2) + (weight_fairness * fairness_score)

            # --- TIMER END AND PRINT ---
            city_end_time = time.time()
            elapsed_s = city_end_time - city_start_time
            print(f" SUCCESS: Score for {city_code}: {total_score:.2f} (CO2: {total_co2:.2f}, Fairness: {fairness_score:.2f} [Avg Travel: {avg_travel:.2f}, Std: {std_dev_travel:.2f}]) (Took {elapsed_s:.2f}s)")
            city_scores.append({
                "city": city_code,
                "score": total_score,
            })

    # E) Find the winner of Phase 1
    if not city_scores:
        print("\nNo valid meeting locations found for this scenario.")
        return [{"error": "No valid meeting locations found."}]

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
        
        # --- [NEW] Pass the connecting flights flag ---
        city_json = get_final_json_for_city(
            city_code,
            rank=i,
            phase_1_score=phase_1_score,
            scenario_dict=scenario_dict,
            optimize_span=is_winner,
            consider_connecting_flights=consider_connecting_flights
        )
        if city_json:
            final_output_list.append(city_json)

    return final_output_list

# --- 10. Example of how to call our new function ---
if __name__ == "__main__":
    input_file = "hackathon_test.json"
    if not Path(input_file).exists():
        print(f"ERROR: Input file '{input_file}' not found.")
        print("Please create it before running the script.")
        sys.exit(1)

    # --- Example: Run with a 50/50 weight ---
    user_co2_weight = 0.5
    user_avg_vs_std_weight = 0.5
    
    # --- [NEW] This is the toggle you asked for! ---
    # Set to True to include 1-stop flights (original logic)
    # Set to False to run the "simple" version (direct flights only)
    USER_CONSIDER_CONNECTING_FLIGHTS = False

    print(f"Running main script with CO2 weight: {user_co2_weight}")
    
    final_results = find_best_meeting(
        input_file, 
        user_co2_weight, 
        user_avg_vs_std_weight,
        consider_connecting_flights=USER_CONSIDER_CONNECTING_FLIGHTS # <-- Pass the new switch
    )
    
    print("\n--- FINAL HACKATHON OUTPUT ---")
    print(json.dumps(final_results, indent=4))
