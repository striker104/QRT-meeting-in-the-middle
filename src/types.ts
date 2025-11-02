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
