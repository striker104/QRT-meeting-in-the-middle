import polars as pl
import json

# --- 1. Define Our "Needed" Columns ---
# We only select what we need to save memory.
SCHEDULE_COLS = [
    "CARRIER", "FLTNO", "DEPAPT", "ARRAPT", "ELPTIM",
    "SCHEDULED_DEPARTURE_DATE_TIME_UTC", "STOPS", "EQUIPMENT_CD_ICAO"
]

EMISSIONS_COLS = [
    "CARRIER_CODE", "FLIGHT_NUMBER", "DEPARTURE_AIRPORT", "ARRIVAL_AIRPORT",
    "SCHEDULED_DEPARTURE_DATE", "AIRCRAFT_TYPE",
    "SEATS", "ESTIMATED_CO2_TOTAL_TONNES"
]

# --- 2. Define File Paths ---
# We use a wildcard "*" to scan ALL schedule files.
# This is how we handle all 100GB of data at once.
schedule_files = "challenge_data/schedules/*/*/*.csv" 
emissions_file = "challenge_data/emissions.csv"

# --- 3. Feature Engineering & Alignment ---

def get_lazy_schedules(path):
    """
    Loads lazy schedules and engineers new features.
    """
    return pl.scan_csv(
        path, 
        infer_schema_length=10000,
        null_values=[""] # Treat empty strings as null
    ).select(SCHEDULE_COLS).with_columns(
        # A) Convert 'ELPTIM' (e.g., 1125) to total hours (e.g., 11.416)
        (
            (pl.col("ELPTIM") / 100).floor() + # Get the hours
            (pl.col("ELPTIM") % 100) / 60      # Get minutes and convert to fraction of hour
        ).alias("TRAVEL_HOURS"),
        
        # B) Convert the full UTC timestamp into just a YYYY-MM-DD date string.
        # This is CRITICAL for joining with the emissions file.
        pl.col("SCHEDULED_DEPARTURE_DATE_TIME_UTC")
            .str.to_datetime(strict=False) # Use strict=False to handle potential bad data
            .dt.date()
            .cast(pl.String)
            .alias("JOIN_DATE")
    ).filter(
        # C) We only care about direct flights
        pl.col("STOPS") == 0
    )

def get_lazy_emissions(path):
    """
    Loads lazy emissions and engineers new features.
    """
    return pl.scan_csv(
        path, 
        infer_schema_length=10000,
        null_values=[""]
    ).select(EMISSIONS_COLS).with_columns(
        # A) Calculate our "Insight" metric: CO2 per person
        (
            pl.col("ESTIMATED_CO2_TOTAL_TONNES") / pl.col("SEATS")
        ).alias("CO2_PER_PERSON_TONNES"),
        
        # B) Convert the date to the same YYYY-MM-DD string format
        # for the join.
        pl.col("SCHEDULED_DEPARTURE_DATE")
            .str.to_date(format="%Y-%m-%d", strict=False)
            .cast(pl.String)
            .alias("JOIN_DATE")
    ).filter(
        # C) Avoid divide-by-zero errors if seat data is missing
        pl.col("SEATS") > 0
    )

if __name__ == "__main__":
    
    print("Creating Lazy DataFrames...")
    
    schedules_df = get_lazy_schedules(schedule_files)
    emissions_df = get_lazy_emissions(emissions_file)
    
    print("Lazy DataFrames created with new features.")

    # --- 4. The "Master" DataFrame Join ---
    # This is our core "model". We join on all the keys that
    # make a flight unique: Route, Date, Airline, Flight #, Aircraft.
    
    print("Defining the master join...")
    
    master_flights_df = schedules_df.join(
        emissions_df,
        left_on=[
            "CARRIER",
            "FLTNO",
            "DEPAPT",
            "ARRAPT",
            "EQUIPMENT_CD_ICAO",
            "JOIN_DATE"
        ],
        right_on=[
            "CARRIER_CODE",
            "FLIGHT_NUMBER",
            "DEPARTURE_AIRPORT",
            "ARRIVAL_AIRPORT",
            "AIRCRAFT_TYPE",
            "JOIN_DATE"
        ],
        how="inner" # "inner" join means we only keep flights found in both files
    )
    
    print("Master flights lazy DataFrame is ready.")

    # --- 5. Test the Engine ---
    # Let's run a test query, just like the workshop!
    # This proves our whole engine works.
    
    print("Testing: Finding London (LHR) to Mumbai (BOM) flights...")
    
    try:
        london_to_mumbai = master_flights_df.filter(
            (pl.col("DEPAPT") == "LHR") & (pl.col("ARRAPT") == "BOM")
        ).select(
            # These are the only 3 columns we'll need for our final score
            pl.col("TRAVEL_HOURS"),
            pl.col("CO2_PER_PERSON_TONNES"),
            pl.col("ESTIMATED_CO2_TOTAL_TONNES") # Good for reference
        )
        
        # .collect() is the command that says "OK, run the query!"
        result = london_to_mumbai.collect()
        
        print("--- Test Results ---")
        print(result)

    except Exception as e:
        print(f"\nAn error occurred. This is common with 100GB of data!")
        print(f"Error: {e}")
        print("This might be a data type mismatch or a bad row. We can debug this.")
