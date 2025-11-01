import { AttendeeScenario, CityTravelPlan } from '../types';

export const sampleScenario: AttendeeScenario = {
  attendees: {
    Mumbai: 2,
    Shanghai: 3,
    'Hong Kong': 1,
    Singapore: 2,
    Sydney: 2
  },
  availability_window: {
    start: '2025-12-10T09:00:00Z',
    end: '2025-12-15T17:00:00Z'
  },
  event_duration: {
    days: 0,
    hours: 4
  }
};

export const cityCoordinates: Record<string, [number, number]> = {
  Mumbai: [72.8777, 19.076],
  Shanghai: [121.4737, 31.2304],
  'Hong Kong': [114.1694, 22.3193],
  Singapore: [103.8198, 1.3521],
  Sydney: [151.2093, -33.8688]
};

export const meetingLocation: CityTravelPlan = {
  city: 'Bangkok Hub',
  attendees: 0,
  coordinates: [100.5018, 13.7563]
};
