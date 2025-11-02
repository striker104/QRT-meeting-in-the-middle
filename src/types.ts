export interface AttendeeScenario {
  attendees: Record<string, number>;
  availability_window: {
    start: string;
    end: string;
  };
  event_duration: {
    days: number;
    hours: number;
  };
}

export interface CityTravelPlan {
  city: string;
  attendees: number;
  coordinates: [number, number];
}

// Legacy EventSummary interface - kept for backward compatibility
export interface EventSummary {
  event_location: string;
  event_dates: {
    start: string;
    end: string;
  };
  event_span: {
    start: string;
    end: string;
  };
  total_co2: number;
  average_travel_hours: number;
  median_travel_hours: number;
  max_travel_hours: number;
  min_travel_hours: number;
  attendee_travel_hours: Record<string, number>;
}

// Flight itinerary entry: [origin, destination, carrier, flightNumber, departureDateTime, passengers, direction, stopType]
export type FlightItineraryEntry = [
  string, // origin airport code (e.g., "BOM")
  string, // destination airport code (e.g., "SGN")
  string, // carrier code (e.g., "TG")
  number, // flight number (e.g., 352)
  string, // departure datetime ISO string (e.g., "2025-05-02T21:10:00+00:00")
  number, // number of passengers
  'out' | 'in', // direction
  'Direct' | '1-Stop' // stop type
];

// New optimization result format
export interface OptimizationResult {
  rank: number;
  event_location: string; // airport code (e.g., "SGN")
  phase_1_score: number;
  event_dates: {
    start: string;
    end: string;
  };
  event_span: {
    start: string;
    end: string;
    total_hours: number;
  };
  total_co2_tonnes: number;
  average_co2_per_person_tonnes: number;
  average_travel_hours: number;
  median_travel_hours: number;
  max_travel_hours: number;
  min_travel_hours: number;
  attendee_travel_hours: Record<string, number>;
  itinerary: FlightItineraryEntry[];
}
