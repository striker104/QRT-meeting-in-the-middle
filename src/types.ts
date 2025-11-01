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
