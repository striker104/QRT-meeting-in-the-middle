import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import TravelMap from './components/TravelMap';
import { AttendeeScenario, CityTravelPlan, EventSummary, OptimizationResult, FlightPrice, AccommodationPrice, UberItinerary } from './types';
import { sampleScenario, cityCoordinates } from './data/sampleScenario';
import { streamMeetingPlan } from './api/openRouterClient';
import { getFlightPrices, getAccommodationPrice } from './api/getPrices';
import { getUberPrices } from './api/getUberPrices';
import { getCityNameFromAirportCode } from './data/airportCodes';

type ViewState = 'onboarding' | 'optimising' | 'analysis' | 'world';

const BASE_TRAVEL_HOURS: Record<string, number> = {
  Mumbai: 20.5,
  Shanghai: 4.6,
  'Hong Kong': 13.7,
  Singapore: 2.1,
  Sydney: 23.9,
  Dubai: 11.4,
  Tokyo: 6.2,
  London: 17.3
};

const MIN_DURATION_HOURS = 1;

const dateTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  timeZoneName: 'short'
});

const meetingCoordinateDirectory: Record<string, [number, number]> = {
  ...cityCoordinates,
  'New York': [-74.006, 40.7128],
  London: [-0.1276, 51.5072],
  Dubai: [55.2708, 25.2048],
  Tokyo: [139.6917, 35.6895],
  Bangkok: [100.5018, 13.7563],
  'Ho Chi Minh City': [106.6297, 10.8231],
  Hanoi: [105.8342, 21.0285],
  'Kuala Lumpur': [101.6869, 3.1390]
};

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function parseScenarioInput(raw: string): AttendeeScenario {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error('Unable to parse JSON. Please check the syntax and try again.');
  }

  if (typeof parsed !== 'object' || !parsed) {
    throw new Error('Scenario must be a JSON object.');
  }

  const { attendees, availability_window: availabilityWindow, event_duration: eventDuration } =
    parsed as {
      attendees?: Record<string, unknown>;
      availability_window?: { start?: unknown; end?: unknown };
      event_duration?: { days?: unknown; hours?: unknown };
    };

  if (!attendees || typeof attendees !== 'object') {
    throw new Error('Provide an "attendees" object with city names and attendee counts.');
  }

  const normalisedAttendees: Record<string, number> = {};
  for (const [city, value] of Object.entries(attendees)) {
    const trimmedCity = city.trim();
    const numericValue = Number(value);

    if (!trimmedCity) {
      throw new Error('Each attendee entry must have a city name.');
    }

    if (!Number.isFinite(numericValue) || numericValue <= 0) {
      throw new Error(`Attendee count for "${trimmedCity}" must be a positive number.`);
    }

    normalisedAttendees[trimmedCity] = Math.round(numericValue);
  }

  if (!availabilityWindow || typeof availabilityWindow !== 'object') {
    throw new Error('Provide an "availability_window" with "start" and "end" timestamps.');
  }

  const availabilityStart = String(availabilityWindow.start ?? '').trim();
  const availabilityEnd = String(availabilityWindow.end ?? '').trim();

  if (!availabilityStart || !availabilityEnd) {
    throw new Error('Availability window must include both "start" and "end" timestamps.');
  }

  if (!eventDuration || typeof eventDuration !== 'object') {
    throw new Error('Provide an "event_duration" with "days" and "hours".');
  }

  const durationDays = Number(eventDuration.days ?? 0);
  const durationHours = Number(eventDuration.hours ?? 0);

  if (Number.isNaN(durationDays) || durationDays < 0 || Number.isNaN(durationHours) || durationHours < 0) {
    throw new Error('Event duration must include non-negative "days" and "hours" values.');
  }

  if (Object.keys(normalisedAttendees).length === 0) {
    throw new Error('List at least one attendee city to run the optimisation.');
  }

  return {
    attendees: normalisedAttendees,
    availability_window: {
      start: availabilityStart,
      end: availabilityEnd
    },
    event_duration: {
      days: durationDays,
      hours: durationHours
    }
  };
}

function deriveTravelHours(scenario: AttendeeScenario) {
  return Object.keys(scenario.attendees).reduce<Record<string, number>>((acc, city, index) => {
    const base = BASE_TRAVEL_HOURS[city] ?? 7 + index * 1.8;
    acc[city] = Number(base.toFixed(1));
    return acc;
  }, {});
}

function expandTravelTimes(travelHours: Record<string, number>, scenario: AttendeeScenario) {
  const expanded: number[] = [];

  Object.entries(travelHours).forEach(([city, hours]) => {
    const travellers = scenario.attendees[city] ?? 1;
    for (let i = 0; i < travellers; i += 1) {
      expanded.push(hours);
    }
  });

  if (expanded.length === 0) {
    expanded.push(0);
  }

  return expanded.sort((a, b) => a - b);
}

function calculateMedian(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  const mid = Math.floor(values.length / 2);

  if (values.length % 2 === 0) {
    return (values[mid - 1] + values[mid]) / 2;
  }

  return values[mid];
}

function deriveEventDates(scenario: AttendeeScenario) {
  const availabilityStart = new Date(scenario.availability_window.start);
  const availabilityEnd = new Date(scenario.availability_window.end);

  const totalDurationHours =
    scenario.event_duration.days * 24 + scenario.event_duration.hours || MIN_DURATION_HOURS;

  if (Number.isNaN(availabilityStart.getTime())) {
    return {
      start: scenario.availability_window.start,
      end: scenario.availability_window.end
    };
  }

  const tentativeEnd = new Date(availabilityStart.getTime() + totalDurationHours * 60 * 60 * 1000);

  if (!Number.isNaN(availabilityEnd.getTime()) && tentativeEnd > availabilityEnd) {
    return {
      start: availabilityStart.toISOString(),
      end: availabilityEnd.toISOString()
    };
  }

  return {
    start: availabilityStart.toISOString(),
    end: tentativeEnd.toISOString()
  };
}

function chooseMeetingHub(travelHours: Record<string, number>) {
  const entries = Object.entries(travelHours).sort(([, hoursA], [, hoursB]) => hoursA - hoursB);
  const bestCity = entries.length > 0 ? entries[0][0] : null;

  return bestCity ?? 'Singapore';
}

// Helper function to convert OptimizationResult to EventSummary for backward compatibility
function convertToEventSummary(result: OptimizationResult): EventSummary {
  return {
    event_location: result.event_location,
    event_dates: result.event_dates,
    event_span: {
      start: result.event_span.start,
      end: result.event_span.end
    },
    total_co2: result.total_co2_tonnes,
    average_travel_hours: result.average_travel_hours,
    median_travel_hours: result.median_travel_hours,
    max_travel_hours: result.max_travel_hours,
    min_travel_hours: result.min_travel_hours,
    attendee_travel_hours: result.attendee_travel_hours
  };
}

async function mockOptimiseScenario(scenario: AttendeeScenario): Promise<OptimizationResult[]> {
  await sleep(1200);

  // Return the exact test data provided
  return [
    {
      rank: 1,
      event_location: "SGN",
      phase_1_score: 5.88,
      event_dates: {
        start: "2025-05-06T01:20:00+00:00",
        end: "2025-05-06T05:20:00+00:00"
      },
      event_span: {
        start: "2025-05-01T10:15:00+00:00",
        end: "2025-05-06T15:40:00+00:00",
        total_hours: 125.42
      },
      total_co2_tonnes: 4.02,
      average_co2_per_person_tonnes: 0.4,
      average_travel_hours: 12.03,
      median_travel_hours: 8.5,
      max_travel_hours: 22.17,
      min_travel_hours: 4.25,
      attendee_travel_hours: {
        "Singapore": 4.25,
        "Hong Kong": 5.33,
        "Mumbai": 18.33,
        "Sydney": 22.17,
        "Shanghai": 8.5
      },
      itinerary: [
        ["BOM", "SGN", "TG", 352, "2025-05-02T21:10:00+00:00", 2, "out", "1-Stop"],
        ["SGN", "BOM", "VN", 607, "2025-05-04T09:55:00+00:00", 2, "in", "1-Stop"],
        ["PVG", "SGN", "VN", 525, "2025-05-01T07:10:00+00:00", 3, "out", "Direct"],
        ["SGN", "PVG", "VN", 524, "2025-05-02T00:30:00+00:00", 3, "in", "Direct"],
        ["HKG", "SGN", "VN", 595, "2025-05-01T10:45:00+00:00", 1, "out", "Direct"],
        ["SGN", "HKG", "VN", 594, "2025-05-02T06:45:00+00:00", 1, "in", "Direct"],
        ["SIN", "SGN", "TR", 302, "2025-05-01T08:00:00+00:00", 2, "out", "Direct"],
        ["SGN", "SIN", "TR", 323, "2025-05-02T08:35:00+00:00", 2, "in", "Direct"],
        ["SYD", "SGN", "TR", 13, "2025-05-05T10:45:00+00:00", 2, "out", "1-Stop"],
        ["SGN", "SYD", "JQ", 62, "2025-05-06T15:40:00+00:00", 2, "in", "Direct"]
      ]
    },
    {
      rank: 2,
      event_location: "HAN",
      phase_1_score: 6.19,
      event_dates: {
        start: "2025-05-06T18:05:00+00:00",
        end: "2025-05-06T22:05:00+00:00"
      },
      event_span: {
        start: "2025-05-01T08:35:00+00:00",
        end: "2025-05-07T13:10:00+00:00",
        total_hours: 148.58
      },
      total_co2_tonnes: 4.09,
      average_co2_per_person_tonnes: 0.41,
      average_travel_hours: 13.93,
      median_travel_hours: 11.62,
      max_travel_hours: 30.92,
      min_travel_hours: 4.08,
      attendee_travel_hours: {
        "Shanghai": 13.25,
        "Sydney": 30.92,
        "Hong Kong": 4.08,
        "Singapore": 6.83,
        "Mumbai": 10.0
      },
      itinerary: [
        ["BOM", "HAN", "VJ", 910, "2025-05-02T19:10:00+00:00", 2, "out", "Direct"],
        ["HAN", "BOM", "VJ", 907, "2025-05-07T13:10:00+00:00", 2, "in", "Direct"],
        ["SHA", "HAN", "MU", 5309, "2025-05-02T02:00:00+00:00", 3, "out", "1-Stop"],
        ["HAN", "PVG", "MF", 870, "2025-05-07T08:40:00+00:00", 3, "in", "1-Stop"],
        ["HKG", "HAN", "VN", 593, "2025-05-01T06:30:00+00:00", 1, "out", "Direct"],
        ["HAN", "HKG", "VN", 592, "2025-05-02T03:30:00+00:00", 1, "in", "Direct"],
        ["SIN", "HAN", "VN", 660, "2025-05-01T05:05:00+00:00", 2, "out", "Direct"],
        ["HAN", "SIN", "VN", 661, "2025-05-02T00:35:00+00:00", 2, "in", "Direct"],
        ["SYD", "HAN", "JQ", 61, "2025-05-06T05:10:00+00:00", 2, "out", "1-Stop"],
        ["HAN", "SYD", "VN", 661, "2025-05-07T00:35:00+00:00", 2, "in", "1-Stop"]
      ]
    },
    {
      rank: 3,
      event_location: "KUL",
      phase_1_score: 6.48,
      event_dates: {
        start: "2025-05-05T13:55:00+00:00",
        end: "2025-05-05T17:55:00+00:00"
      },
      event_span: {
        start: "2025-05-01T10:25:00+00:00",
        end: "2025-05-07T11:15:00+00:00",
        total_hours: 144.83
      },
      total_co2_tonnes: 4.39,
      average_co2_per_person_tonnes: 0.44,
      average_travel_hours: 17.57,
      median_travel_hours: 20.42,
      max_travel_hours: 27.08,
      min_travel_hours: 2.42,
      attendee_travel_hours: {
        "Hong Kong": 13.92,
        "Singapore": 2.42,
        "Shanghai": 20.42,
        "Sydney": 27.08,
        "Mumbai": 20.75
      },
      itinerary: [
        ["BOM", "KUL", "TG", 352, "2025-05-02T21:10:00+00:00", 2, "out", "1-Stop"],
        ["KUL", "BOM", "8D", 722, "2025-05-05T08:30:00+00:00", 2, "in", "1-Stop"],
        ["PVG", "KUL", "CZ", 6077, "2025-05-01T00:45:00+00:00", 3, "out", "1-Stop"],
        ["KUL", "PVG", "VJ", 826, "2025-05-03T05:35:00+00:00", 3, "in", "1-Stop"],
        ["HKG", "KUL", "TR", 973, "2025-05-01T11:20:00+00:00", 1, "out", "1-Stop"],
        ["KUL", "HKG", "MH", 78, "2025-05-02T11:50:00+00:00", 1, "in", "Direct"],
        ["SIN", "KUL", "TR", 468, "2025-05-05T12:40:00+00:00", 2, "out", "Direct"],
        ["KUL", "SIN", "TR", 469, "2025-05-07T11:15:00+00:00", 2, "in", "Direct"],
        ["SYD", "KUL", "BA", 16, "2025-05-01T04:40:00+00:00", 2, "out", "1-Stop"],
        ["KUL", "SYD", "TR", 469, "2025-05-05T14:55:00+00:00", 2, "in", "1-Stop"]
      ]
    }
  ];
}

function formatDateRange(range: { start: string; end: string }) {
  const start = new Date(range.start);
  const end = new Date(range.end);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return 'Unavailable';
  }

  return `${dateTimeFormatter.format(start)} → ${dateTimeFormatter.format(end)}`;
}

function formatHours(totalHours: number) {
  if (!Number.isFinite(totalHours)) {
    return 'n/a';
  }

  const totalMinutes = Math.round(totalHours * 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0 && minutes === 0) {
    return '0 h';
  }

  if (hours === 0) {
    return `${minutes} min`;
  }

  if (minutes === 0) {
    return `${hours} h`;
  }

  return `${hours} h ${minutes} min`;
}

function formatCo2(totalCo2: number) {
  if (!Number.isFinite(totalCo2)) {
    return 'n/a';
  }

  return `${totalCo2.toLocaleString('en-GB')} tCO₂e`;
}

function formatPrice(priceUSD: number | undefined): string {
  if (priceUSD === undefined || !Number.isFinite(priceUSD)) {
    return '—';
  }

  return `$${priceUSD.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (remainingMinutes === 0) {
    return `${hours} h`;
  }
  return `${hours} h ${remainingMinutes} min`;
}

function formatDistance(meters: number): string {
  const km = meters / 1000;
  if (km < 1) {
    return `${Math.round(meters)} m`;
  }
  return `${km.toFixed(1)} km`;
}

function calculateTotalPrice(prices: FlightPrice[]): number {
  return prices.reduce((total, flight) => {
    if (flight.priceUSD !== undefined && Number.isFinite(flight.priceUSD)) {
      return total + flight.priceUSD * flight.passengers;
    }
    return total;
  }, 0);
}

function calculateAccommodationTotal(accommodation: AccommodationPrice | undefined): number {
  if (!accommodation) return 0;
  
  // If we have pricePerNightUSD, calculate: nights × people × pricePerNight
  if (accommodation.pricePerNightUSD && accommodation.numberOfNights && accommodation.numberOfPeople) {
    return accommodation.pricePerNightUSD * accommodation.numberOfNights * accommodation.numberOfPeople;
  }
  
  // Otherwise use the provided priceUSD
  if (accommodation.priceUSD !== undefined && Number.isFinite(accommodation.priceUSD)) {
    return accommodation.priceUSD;
  }
  
  return 0;
}

function calculateCombinedTotal(flightPrices: FlightPrice[], accommodation: AccommodationPrice | undefined): number {
  const flightTotal = calculateTotalPrice(flightPrices);
  const accommodationTotal = calculateAccommodationTotal(accommodation);
  return flightTotal + accommodationTotal;
}

function deriveMeetingLocation(summary: EventSummary): CityTravelPlan {
  // Convert airport code to city name if needed
  const cityName = getCityNameFromAirportCode(summary.event_location);
  const coordinates =
    meetingCoordinateDirectory[cityName] ?? meetingCoordinateDirectory[summary.event_location] ?? meetingCoordinateDirectory.London;

  if (!meetingCoordinateDirectory[cityName] && !meetingCoordinateDirectory[summary.event_location]) {
    console.warn(
      `Missing coordinates for ${summary.event_location} (${cityName}). Falling back to London coordinates.`
    );
  }

  return {
    city: cityName,
    attendees: 0,
    coordinates
  };
}

export default function App() {
  const [view, setView] = useState<ViewState>('onboarding');
  const [scenarioInput, setScenarioInput] = useState(() => JSON.stringify(sampleScenario, null, 2));
  const [scenarioError, setScenarioError] = useState<string | null>(null);
  const [optimiserError, setOptimiserError] = useState<string | null>(null);
  const [scenario, setScenario] = useState<AttendeeScenario | null>(null);
  const [optimizationResults, setOptimizationResults] = useState<OptimizationResult[]>([]);
  const [selectedResultIndex, setSelectedResultIndex] = useState(0);
  const [executiveBriefs, setExecutiveBriefs] = useState<Map<number, string>>(new Map());
  const [briefModels, setBriefModels] = useState<Map<number, string>>(new Map());
  const [briefErrors, setBriefErrors] = useState<Map<number, string>>(new Map());
  const [fetchingBriefRanks, setFetchingBriefRanks] = useState<Set<number>>(new Set());
  const [flightPrices, setFlightPrices] = useState<Map<number, FlightPrice[]>>(new Map());
  const [isFetchingPrices, setIsFetchingPrices] = useState(false);
  const [priceError, setPriceError] = useState<string | null>(null);
  const [accommodationPrices, setAccommodationPrices] = useState<Map<number, AccommodationPrice>>(new Map());
  const [isFetchingAccommodation, setIsFetchingAccommodation] = useState(false);
  const [accommodationError, setAccommodationError] = useState<string | null>(null);
  const [hotelStars, setHotelStars] = useState<number>(4);
  const [expandedFlightKey, setExpandedFlightKey] = useState<string | null>(null);
  const [uberItineraries, setUberItineraries] = useState<Map<string, UberItinerary>>(new Map());
  const [isFetchingUber, setIsFetchingUber] = useState<Set<string>>(new Set());
  const activeBriefRequests = useRef<Map<number, AbortController>>(new Map());
  const activePriceRequests = useRef<Map<number, AbortController>>(new Map());
  const activeAccommodationRequests = useRef<Map<number, AbortController>>(new Map());

  // Get the currently selected result
  const selectedResult = optimizationResults[selectedResultIndex] ?? null;
  const eventSummary = selectedResult ? convertToEventSummary(selectedResult) : null;

  useEffect(() => {
    return () => {
      activeBriefRequests.current.forEach((controller) => controller.abort());
      activePriceRequests.current.forEach((controller) => controller.abort());
      activeAccommodationRequests.current.forEach((controller) => controller.abort());
    };
  }, []);

  const generateBrief = useCallback(async (summary: EventSummary, rank: number) => {
    // Cancel any existing request for this rank
    activeBriefRequests.current.get(rank)?.abort();

    const controller = new AbortController();
    activeBriefRequests.current.set(rank, controller);

    setFetchingBriefRanks((prev) => new Set(prev).add(rank));
    setBriefErrors((prev) => {
      const newMap = new Map(prev);
      newMap.delete(rank);
      return newMap;
    });
    setBriefModels((prev) => {
      const newMap = new Map(prev);
      newMap.delete(rank);
      return newMap;
    });
    setExecutiveBriefs((prev) => {
      const newMap = new Map(prev);
      newMap.set(rank, '');
      return newMap;
    });

    try {
      const result = await streamMeetingPlan(summary, {
        signal: controller.signal,
        onToken: (token) => {
          setExecutiveBriefs((prev) => {
            const newMap = new Map(prev);
            const current = newMap.get(rank) || '';
            newMap.set(rank, current + token);
            return newMap;
          });
        }
      });

      setExecutiveBriefs((prev) => {
        const newMap = new Map(prev);
        newMap.set(rank, result.content);
        return newMap;
      });
      setBriefModels((prev) => {
        const newMap = new Map(prev);
        newMap.set(rank, result.model);
        return newMap;
      });
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        setBriefErrors((prev) => {
          const newMap = new Map(prev);
          newMap.set(rank, error instanceof Error ? error.message : 'Failed to generate the meeting brief.');
          return newMap;
        });
        setExecutiveBriefs((prev) => {
          const newMap = new Map(prev);
          newMap.set(rank, '');
          return newMap;
        });
      }
    } finally {
      if (activeBriefRequests.current.get(rank) === controller) {
        activeBriefRequests.current.delete(rank);
      }
      setFetchingBriefRanks((prev) => {
        const newSet = new Set(prev);
        newSet.delete(rank);
        return newSet;
      });
    }
  }, []);

  useEffect(() => {
    if (view === 'analysis' && selectedResult && eventSummary) {
      const rank = selectedResult.rank;
      const hasBrief = executiveBriefs.has(rank);
      const isFetching = fetchingBriefRanks.has(rank);
      
      // Only generate if we don't have a brief and aren't already fetching
      if (!hasBrief && !isFetching) {
        generateBrief(eventSummary, rank);
      }
    }
  }, [view, selectedResult, eventSummary, executiveBriefs, fetchingBriefRanks, generateBrief]);

  // Fetch prices for all optimization results
  const fetchPricesForResults = useCallback(async (results: OptimizationResult[]) => {
    console.log('🔄 fetchPricesForResults called with', results.length, 'results');
    
    // Cancel any existing price requests
    activePriceRequests.current.forEach((controller) => controller.abort());
    activePriceRequests.current.clear();

    setIsFetchingPrices(true);
    setPriceError(null);

    // Fetch prices for each result
    const pricePromises = results.map(async (result) => {
      console.log(`📋 Rank ${result.rank}: ${result.itinerary.length} flights in itinerary`);
      
      if (result.itinerary.length === 0) {
        console.log(`⏭️ Skipping rank ${result.rank} - no flights`);
        return { rank: result.rank, prices: [] };
      }

      console.log(`🚀 Fetching prices for rank ${result.rank}...`);
      const controller = new AbortController();
      activePriceRequests.current.set(result.rank, controller);

      try {
        const prices = await getFlightPrices(result.itinerary, {
          signal: controller.signal
        });
        console.log(`✅ Got ${prices.length} prices for rank ${result.rank}`);
        return { rank: result.rank, prices };
      } catch (error) {
        if ((error as Error).name !== 'AbortError') {
          console.error(`❌ Failed to fetch prices for rank ${result.rank}:`, error);
          return { rank: result.rank, prices: [], error: error instanceof Error ? error.message : 'Failed to fetch prices' };
        }
        return { rank: result.rank, prices: [] };
      }
    });

    try {
      const priceResults = await Promise.all(pricePromises);
      const newPricesMap = new Map<number, FlightPrice[]>();
      
      priceResults.forEach(({ rank, prices }) => {
        newPricesMap.set(rank, prices);
        console.log(`💰 Rank ${rank}: ${prices.length} prices stored`);
      });

      console.log('✅ All prices fetched! Map size:', newPricesMap.size);
      setFlightPrices(newPricesMap);
    } catch (error) {
      console.error('❌ Price fetching error:', error);
      setPriceError('Failed to fetch some flight prices');
    } finally {
      setIsFetchingPrices(false);
      console.log('🏁 Price fetching complete');
    }
  }, []);

  useEffect(() => {
    console.log('📊 useEffect triggered. optimizationResults.length:', optimizationResults.length);
    if (optimizationResults.length > 0) {
      console.log('🎯 Calling fetchPricesForResults...');
      void fetchPricesForResults(optimizationResults);
    }
  }, [optimizationResults, fetchPricesForResults]);

  // Fetch accommodation prices for all optimization results
  const fetchAccommodationForResults = useCallback(async (results: OptimizationResult[], stars: number) => {
    console.log('🏨 fetchAccommodationForResults called with', results.length, 'results, stars:', stars);
    
    // Cancel any existing accommodation requests
    activeAccommodationRequests.current.forEach((controller) => controller.abort());
    activeAccommodationRequests.current.clear();

    setIsFetchingAccommodation(true);
    setAccommodationError(null);

    // Calculate total attendees from current scenario
    const currentTotalAttendees = scenario 
      ? Object.values(scenario.attendees).reduce((sum, count) => sum + count, 0)
      : 0;

    // Fetch accommodation for each result
    const accommodationPromises = results.map(async (result) => {
      console.log(`🏨 Fetching accommodation for rank ${result.rank}...`);
      
      const cityName = getCityNameFromAirportCode(result.event_location);
      const checkIn = result.event_span.start;
      const checkOut = result.event_span.end;
      const numberOfPeople = currentTotalAttendees;

      const controller = new AbortController();
      activeAccommodationRequests.current.set(result.rank, controller);

      try {
        const accommodation = await getAccommodationPrice(
          cityName,
          numberOfPeople,
          checkIn,
          checkOut,
          stars,
          {
            signal: controller.signal
          }
        );
        console.log(`✅ Got accommodation price for rank ${result.rank}:`, accommodation.priceUSD);
        return { rank: result.rank, accommodation };
      } catch (error) {
        if ((error as Error).name !== 'AbortError') {
          console.error(`❌ Failed to fetch accommodation for rank ${result.rank}:`, error);
          return { 
            rank: result.rank, 
            accommodation: {
              city: cityName,
              numberOfPeople,
              checkIn,
              checkOut,
              hotelStars: stars,
              error: error instanceof Error ? error.message : 'Failed to fetch accommodation'
            } as AccommodationPrice
          };
        }
        return { rank: result.rank, accommodation: null };
      }
    });

    try {
      const accommodationResults = await Promise.all(accommodationPromises);
      const newAccommodationMap = new Map<number, AccommodationPrice>();
      
      accommodationResults.forEach(({ rank, accommodation }) => {
        if (accommodation) {
          newAccommodationMap.set(rank, accommodation);
          console.log(`💰 Rank ${rank}: Accommodation price stored`);
        }
      });

      console.log('✅ All accommodation prices fetched! Map size:', newAccommodationMap.size);
      setAccommodationPrices(newAccommodationMap);
    } catch (error) {
      console.error('❌ Accommodation fetching error:', error);
      setAccommodationError('Failed to fetch some accommodation prices');
    } finally {
      setIsFetchingAccommodation(false);
      console.log('🏁 Accommodation fetching complete');
    }
  }, [scenario]);

  useEffect(() => {
    if (optimizationResults.length > 0 && hotelStars > 0) {
      console.log('🏨 Calling fetchAccommodationForResults...');
      void fetchAccommodationForResults(optimizationResults, hotelStars);
    }
  }, [optimizationResults, hotelStars, fetchAccommodationForResults]);

  const runOptimisation = useCallback(async (nextScenario: AttendeeScenario) => {
    setScenario(nextScenario);
    setView('optimising');
    setOptimiserError(null);
    setOptimizationResults([]);
    setSelectedResultIndex(0);
    setFlightPrices(new Map());
    setAccommodationPrices(new Map());
    setExecutiveBriefs(new Map());
    setBriefModels(new Map());
    setBriefErrors(new Map());
    setFetchingBriefRanks(new Set());
    setPriceError(null);
    setAccommodationError(null);
    setIsFetchingPrices(false);
    setIsFetchingAccommodation(false);
    activeBriefRequests.current.forEach((controller) => controller.abort());
    activeBriefRequests.current.clear();
    activePriceRequests.current.forEach((controller) => controller.abort());
    activePriceRequests.current.clear();
    activeAccommodationRequests.current.forEach((controller) => controller.abort());
    activeAccommodationRequests.current.clear();

    try {
      const results = await mockOptimiseScenario(nextScenario);
      if (results.length === 0) {
        throw new Error('No optimization results returned');
      }
      setOptimizationResults(results);
      setSelectedResultIndex(0);
      setView('analysis');
    } catch (error) {
      console.error('Optimisation failed', error);
      setOptimiserError('We could not run the optimiser. Please adjust the scenario and try again.');
      setView('onboarding');
    }
  }, []);

  const handleScenarioSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setScenarioError(null);
    setOptimiserError(null);

    try {
      const parsedScenario = parseScenarioInput(scenarioInput);
      setScenarioInput(JSON.stringify(parsedScenario, null, 2));
      void runOptimisation(parsedScenario);
    } catch (error) {
      setScenarioError(error instanceof Error ? error.message : 'Invalid scenario input.');
    }
  };

  const handleResetToOnboarding = () => {
    activeBriefRequests.current.forEach((controller) => controller.abort());
    activePriceRequests.current.forEach((controller) => controller.abort());
    activeAccommodationRequests.current.forEach((controller) => controller.abort());
    activePriceRequests.current.clear();
    activeBriefRequests.current.clear();
    activeAccommodationRequests.current.clear();
    setScenarioInput(JSON.stringify(scenario ?? sampleScenario, null, 2));
    setScenario(null);
    setOptimizationResults([]);
    setSelectedResultIndex(0);
    setFlightPrices(new Map());
    setAccommodationPrices(new Map());
    setExecutiveBriefs(new Map());
    setBriefModels(new Map());
    setBriefErrors(new Map());
    setFetchingBriefRanks(new Set());
    setPriceError(null);
    setAccommodationError(null);
    setIsFetchingPrices(false);
    setIsFetchingAccommodation(false);
    setView('onboarding');
  };

  const travelStats = useMemo(() => {
    if (!selectedResult) {
      return [];
    }

    return [
      {
        label: 'Average travel time',
        value: formatHours(selectedResult.average_travel_hours)
      },
      {
        label: 'Median travel time',
        value: formatHours(selectedResult.median_travel_hours)
      },
      {
        label: 'Longest journey',
        value: formatHours(selectedResult.max_travel_hours)
      },
      {
        label: 'Shortest journey',
        value: formatHours(selectedResult.min_travel_hours)
      }
    ];
  }, [selectedResult]);

  const travelHoursByCity = useMemo(
    () =>
      selectedResult
        ? Object.entries(selectedResult.attendee_travel_hours).sort(([, a], [, b]) => b - a)
        : [],
    [selectedResult]
  );

  const totalAttendees = useMemo(
    () => (scenario ? Object.values(scenario.attendees).reduce((sum, count) => sum + count, 0) : 0),
    [scenario]
  );

  const meetingLocation = useMemo(
    () => (eventSummary ? deriveMeetingLocation(eventSummary) : null),
    [eventSummary]
  );

  // Handle flight row click to expand and fetch Uber data
  const handleFlightClick = useCallback(async (
    flight: {
      origin: string;
      destination: string;
      carrier: string;
      flightNumber: number;
      departureTime: string;
      passengers: number;
      direction: 'out' | 'in';
    },
    selectedResult: OptimizationResult
  ) => {
    // Create a unique key for this flight
    const flightKey = `${flight.origin}-${flight.destination}-${flight.carrier}-${flight.flightNumber}-${flight.direction}`;
    
    // Toggle expansion
    if (expandedFlightKey === flightKey) {
      setExpandedFlightKey(null);
      return;
    }
    
    setExpandedFlightKey(flightKey);
    
    // Check if we already have Uber data for this flight
    if (uberItineraries.has(flightKey)) {
      return;
    }
    
    // Fetch Uber data for both directions
    setIsFetchingUber((prev) => new Set(prev).add(flightKey));
    
    try {
      const destinationCity = getCityNameFromAirportCode(flight.destination);
      
      // Get city coordinates for the destination (where the flight lands)
      const destinationCoords = meetingCoordinateDirectory[destinationCity] ?? meetingCoordinateDirectory[flight.destination];
      
      if (!destinationCoords) {
        throw new Error(`Could not find coordinates for airport ${flight.destination} (${destinationCity})`);
      }
      
      // Fetch Uber prices for both directions (from airport to city, and from city to airport)
      const [fromAirportResult, toAirportResult] = await Promise.all([
        getUberPrices(flight.destination, destinationCity, destinationCoords, 'from', {}),
        getUberPrices(flight.destination, destinationCity, destinationCoords, 'to', {})
      ]);
      
      // Combine the results - prioritize results that have data
      const combinedItinerary: UberItinerary = {
        fromAirport: fromAirportResult.fromAirport.length > 0 ? fromAirportResult.fromAirport : toAirportResult.fromAirport,
        toAirport: toAirportResult.toAirport.length > 0 ? toAirportResult.toAirport : fromAirportResult.toAirport,
        error: fromAirportResult.error || toAirportResult.error
      };
      
      setUberItineraries((prev) => {
        const newMap = new Map(prev);
        newMap.set(flightKey, combinedItinerary);
        return newMap;
      });
    } catch (error) {
      console.error('Error fetching Uber prices:', error);
      setUberItineraries((prev) => {
        const newMap = new Map(prev);
        newMap.set(flightKey, {
          fromAirport: [],
          toAirport: [],
          error: error instanceof Error ? error.message : 'Failed to fetch Uber prices'
        });
        return newMap;
      });
    } finally {
      setIsFetchingUber((prev) => {
        const newSet = new Set(prev);
        newSet.delete(flightKey);
        return newSet;
      });
    }
  }, [expandedFlightKey, uberItineraries]);

  // Get brief data for the currently selected result
  const currentBrief = selectedResult ? executiveBriefs.get(selectedResult.rank) : undefined;
  const currentBriefModel = selectedResult ? briefModels.get(selectedResult.rank) : undefined;
  const currentBriefError = selectedResult ? briefErrors.get(selectedResult.rank) : undefined;
  const isCurrentBriefFetching = selectedResult ? fetchingBriefRanks.has(selectedResult.rank) : false;

  const analysisBriefFallback =
    currentBrief ||
    (currentBriefError
      ? '_Unable to produce a briefing. Please try again shortly._'
      : isCurrentBriefFetching
        ? '_Compiling insights…_'
        : '_No briefing generated._');

  return (
    <div className="app">
      {view === 'onboarding' && (
        <div className="onboarding-screen">
          <div className="onboarding-card">
            <header className="onboarding-card__header">
              <span className="onboarding-card__tag">meeting in the middle</span>
              <h1>Welcome to Meeting in the Middle</h1>
              <p>
                Paste or adapt the attendee scenario to begin. We&apos;ll compute the fairest hub and
                hand the mic to our AI strategist for the executive playback.
              </p>
            </header>

            <form className="scenario-form" onSubmit={handleScenarioSubmit}>
              <label htmlFor="scenario-input">Attendee scenario JSON</label>
              <textarea
                id="scenario-input"
                className="scenario-form__textarea"
                value={scenarioInput}
                onChange={(event) => setScenarioInput(event.target.value)}
                spellCheck={false}
                rows={16}
              />
              <div className="scenario-form__footer">
                <div className="scenario-form__messages">
                  {scenarioError ? <p className="form-error">{scenarioError}</p> : null}
                  {optimiserError ? <p className="form-error">{optimiserError}</p> : null}
                </div>
                <button className="primary-button primary-button--large" type="submit">
                  Run optimisation
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {view === 'optimising' && (
        <div className="loading-screen">
          <div className="loading-card">
            <span className="loading-card__tag">Optimising</span>
            <h2>The optimiser is finding the best route</h2>
            <div className="loading-card__spinner" aria-hidden="true" />
            <p>Hold tight—this takes just a moment.</p>
          </div>
        </div>
      )}

      {view === 'analysis' && selectedResult && eventSummary && scenario && meetingLocation ? (
        <div className="analysis-screen">
          {optimizationResults.length > 1 && (
            <div className="analysis-rank-selector">
              <label>Select solution:</label>
              <div className="analysis-rank-buttons">
                {optimizationResults.map((result, index) => {
                  const prices = flightPrices.get(result.rank) ?? [];
                  const totalPrice = calculateTotalPrice(prices);
                  const hasPrices = prices.length > 0 && prices.some(p => p.priceUSD !== undefined);
                  
                  return (
                    <button
                      key={result.rank}
                      className={`rank-button ${index === selectedResultIndex ? 'rank-button--active' : ''}`}
                      type="button"
                      onClick={() => {
                        setSelectedResultIndex(index);
                      }}
                    >
                      Rank {result.rank}
                      <span className="rank-button__score">Score: {result.phase_1_score.toFixed(2)}</span>
                      {hasPrices && (
                        <span className="rank-button__price">Total: {formatPrice(totalPrice)}</span>
                      )}
                      {isFetchingPrices && !hasPrices && (
                        <span className="rank-button__loading">Finding prices…</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {isFetchingPrices && (
            <div className="price-loading-indicator">
              <div className="price-loading-indicator__spinner" aria-hidden="true" />
              <p>Finding flight prices…</p>
            </div>
          )}
          {priceError && (
            <div className="price-error-message">
              <p>{priceError}</p>
            </div>
          )}
          {accommodationError && (
            <div className="price-error-message">
              <p>{accommodationError}</p>
            </div>
          )}
          {isFetchingAccommodation && (
            <div className="price-loading-indicator">
              <div className="price-loading-indicator__spinner" aria-hidden="true" />
              <p>Finding accommodation prices…</p>
            </div>
          )}
          <div className="accommodation-controls">
            <label>Hotel star rating:</label>
            <div className="star-rating">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  className={`star-button ${star <= hotelStars ? 'star-button--filled' : ''}`}
                  onClick={() => setHotelStars(star)}
                  aria-label={`${star} star${star !== 1 ? 's' : ''}`}
                >
                  <span className="star-icon">★</span>
                </button>
              ))}
              <span className="star-rating-label">{hotelStars} {hotelStars === 1 ? 'star' : 'stars'}</span>
            </div>
          </div>
          <header className="analysis-hero">
            <div className="analysis-hero__info">
              <span className="analysis-hero__tag">Optimised outcome #{selectedResult.rank}</span>
              <h1>{getCityNameFromAirportCode(selectedResult.event_location)}</h1>
              <p className="analysis-hero__headline">{formatDateRange(selectedResult.event_dates)}</p>
              <p className="analysis-hero__detail">
                Availability window: {formatDateRange(selectedResult.event_span)}
              </p>
              <p className="analysis-hero__detail">
                {totalAttendees} attendees across {Object.keys(scenario.attendees).length} cities
              </p>
            </div>

            <div className="analysis-hero__metrics">
              <div className="analysis-stat">
                <span>Total CO₂e</span>
                <strong>{formatCo2(selectedResult.total_co2_tonnes)}</strong>
              </div>
              <div className="analysis-stat">
                <span>Avg CO₂ per person</span>
                <strong>{formatCo2(selectedResult.average_co2_per_person_tonnes)}</strong>
              </div>
              {(() => {
                const prices = flightPrices.get(selectedResult.rank) ?? [];
                const totalPrice = calculateTotalPrice(prices);
                const hasPrices = prices.length > 0 && prices.some(p => p.priceUSD !== undefined);
                const flightsWithPrices = prices.filter(p => p.priceUSD !== undefined).length;
                
                // ALWAYS show price stat if we have prices OR are fetching
                if (hasPrices || isFetchingPrices || selectedResult.itinerary.length > 0) {
                  return (
                    <div className="analysis-stat analysis-stat--price analysis-stat--highlight">
                      <div className="analysis-stat__content">
                        <span>Total flight cost</span>
                        {hasPrices ? (
                          <>
                            <strong className="price-display">{formatPrice(totalPrice)}</strong>
                            <span className="analysis-stat__subtext">
                              {flightsWithPrices} of {prices.length} flights priced
                            </span>
                          </>
                        ) : (
                          <>
                            <strong className="price-display" style={{ opacity: 0.5 }}>—</strong>
                            <span className="analysis-stat__subtext">Finding prices…</span>
                          </>
                        )}
                      </div>
                    </div>
                  );
                }
                return null;
              })()}
              {(() => {
                const accommodation = accommodationPrices.get(selectedResult.rank);
                const accommodationTotal = calculateAccommodationTotal(accommodation);
                const hasAccommodationPrice = accommodationTotal > 0 || (accommodation?.priceUSD !== undefined || accommodation?.pricePerNightUSD !== undefined);
                
                if (hasAccommodationPrice || isFetchingAccommodation || selectedResult.rank > 0) {
                  return (
                    <div className="analysis-stat analysis-stat--price analysis-stat--highlight">
                      <div className="analysis-stat__content">
                        <span>Accommodation cost ({hotelStars}★)</span>
                        {accommodationTotal > 0 && accommodation ? (
                          <>
                            <strong className="price-display">{formatPrice(accommodationTotal)}</strong>
                            {accommodation.pricePerNightUSD && accommodation.numberOfNights && accommodation.numberOfPeople && (
                              <span className="analysis-stat__subtext">
                                {formatPrice(accommodation.pricePerNightUSD)}/night × {accommodation.numberOfNights} nights × {accommodation.numberOfPeople} {accommodation.numberOfPeople === 1 ? 'guest' : 'guests'}
                              </span>
                            )}
                          </>
                        ) : (
                          <>
                            <strong className="price-display" style={{ opacity: 0.5 }}>—</strong>
                            <span className="analysis-stat__subtext">Finding prices…</span>
                          </>
                        )}
                      </div>
                    </div>
                  );
                }
                return null;
              })()}
              {(() => {
                const prices = flightPrices.get(selectedResult.rank) ?? [];
                const accommodation = accommodationPrices.get(selectedResult.rank);
                const flightTotal = calculateTotalPrice(prices);
                const accommodationTotal = calculateAccommodationTotal(accommodation);
                const combinedTotal = calculateCombinedTotal(prices, accommodation);
                const hasFlightPrices = prices.length > 0 && prices.some(p => p.priceUSD !== undefined);
                const hasAccommodationPrice = accommodationTotal > 0 || (accommodation?.priceUSD !== undefined || accommodation?.pricePerNightUSD !== undefined);
                
                if ((hasFlightPrices || hasAccommodationPrice) && combinedTotal > 0) {
                  return (
                    <div className="analysis-stat analysis-stat--price analysis-stat--highlight analysis-stat--combined">
                      <div className="analysis-stat__content">
                        <span>Total trip cost</span>
                        <strong className="price-display price-display--large">{formatPrice(combinedTotal)}</strong>
                        <span className="analysis-stat__subtext">
                          {hasFlightPrices && formatPrice(flightTotal)} {hasFlightPrices && hasAccommodationPrice ? '+ ' : ''}{hasAccommodationPrice && formatPrice(accommodationTotal)}
                        </span>
                      </div>
                    </div>
                  );
                }
                return null;
              })()}
              {travelStats.map((stat) => (
                <div key={stat.label} className="analysis-stat">
                  <span>{stat.label}</span>
                  <strong>{stat.value}</strong>
                </div>
              ))}
            </div>
          </header>

          <main className="analysis-main">
            <section className="analysis-brief-card">
              <header className="analysis-brief-card__header">
                <span className="analysis-brief-card__tag">Executive briefing</span>
                {currentBriefModel ? (
                  <span className="analysis-brief-card__model">{currentBriefModel}</span>
                ) : null}
              </header>
              <div className="analysis-brief-card__body">
                <ReactMarkdown>{analysisBriefFallback}</ReactMarkdown>
              </div>
              {currentBriefError ? (
                <p className="analysis-brief-card__error">{currentBriefError}</p>
              ) : null}
            </section>

            <aside className="analysis-sidebar">
              <div className="analysis-side-card">
                <h3>Travel spread</h3>
                <ul className="analysis-travel-list">
                  {travelHoursByCity.map(([city, hours]) => (
                    <li key={city}>
                      <span>{city}</span>
                      <strong>{formatHours(hours)}</strong>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="analysis-side-card">
                <h3>Meeting notes</h3>
                <ul className="analysis-note-list">
                  <li>
                    <span>Primary window</span>
                    <strong>{formatDateRange(selectedResult.event_dates)}</strong>
                  </li>
                  <li>
                    <span>Availability buffer</span>
                    <strong>{formatDateRange(selectedResult.event_span)}</strong>
                  </li>
                  {selectedResult.itinerary.length > 0 && (
                    <li>
                      <span>Total flights</span>
                      <strong>{selectedResult.itinerary.length}</strong>
                    </li>
                  )}
                  <li>
                    <span>Total attendees</span>
                    <strong>{totalAttendees}</strong>
                  </li>
                </ul>
              </div>
              {(() => {
                const prices = flightPrices.get(selectedResult.rank) ?? [];
                const hasPrices = prices.length > 0 && prices.some(p => p.priceUSD !== undefined);
                
                // Create a combined list: merge itinerary with price data
                const allFlights = selectedResult.itinerary.map((itineraryEntry) => {
                  const [origin, destination, carrier, flightNumber, departureTime, passengers, direction, stopType] = itineraryEntry;
                  const priceEntry = prices.find(
                    p => p.origin === origin && 
                         p.destination === destination && 
                         p.carrier === carrier && 
                         p.flightNumber === flightNumber &&
                         p.direction === direction
                  );
                  
                  return {
                    origin,
                    destination,
                    carrier,
                    flightNumber,
                    departureTime,
                    passengers,
                    direction,
                    stopType,
                    priceUSD: priceEntry?.priceUSD,
                    error: priceEntry?.error
                  };
                });
                
                const totalPrice = allFlights.reduce((sum, f) => sum + (f.priceUSD ? f.priceUSD * f.passengers : 0), 0);
                const outboundFlights = allFlights.filter(f => f.direction === 'out');
                const returnFlights = allFlights.filter(f => f.direction === 'in');
                
                // ALWAYS show the price card if we have itinerary OR are fetching
                if (selectedResult.itinerary.length > 0 || isFetchingPrices || prices.length > 0) {
                  return (
                    <div className="analysis-side-card analysis-side-card--price">
                      <div className="price-card-header">
                        <h3>
                          <span className="price-card-icon">✈️</span>
                          Flight costs
                        </h3>
                        {hasPrices && (
                          <div className="price-badge">
                            {allFlights.filter(p => p.priceUSD !== undefined).length}/{allFlights.length}
                          </div>
                        )}
                      </div>
                      {isFetchingPrices && !hasPrices ? (
                        <div className="price-loading-mini">
                          <div className="price-loading-mini__spinner" aria-hidden="true" />
                          <p>Finding prices…</p>
                        </div>
                      ) : hasPrices ? (
                        <>
                          <div className="price-summary price-summary--enhanced">
                            <div className="price-summary__label">Total cost</div>
                            <div className="price-summary__value">{formatPrice(totalPrice)}</div>
                            <div className="price-summary__breakdown">
                              {outboundFlights.filter(f => f.priceUSD !== undefined).length > 0 && (
                                <span className="price-breakdown-item">
                                  Outbound: {formatPrice(outboundFlights.reduce((sum, f) => sum + (f.priceUSD ? f.priceUSD * f.passengers : 0), 0))}
                                </span>
                              )}
                              {returnFlights.filter(f => f.priceUSD !== undefined).length > 0 && (
                                <span className="price-breakdown-item">
                                  Return: {formatPrice(returnFlights.reduce((sum, f) => sum + (f.priceUSD ? f.priceUSD * f.passengers : 0), 0))}
                                </span>
                              )}
                            </div>
                          </div>
                          {allFlights.length > 0 && (
                            <div className="price-list-container">
                              <ul className="price-list price-list--enhanced">
                                {allFlights.slice(0, 10).map((flight, index) => {
                                  const flightTotal = flight.priceUSD ? flight.priceUSD * flight.passengers : 0;
                                  return (
                                    <li key={index} className="price-list__item price-list__item--enhanced">
                                      <div className="price-list__route-info">
                                        <span className="price-list__route">
                                          <span className="route-arrow">{flight.origin}</span>
                                          <span className="route-connector">→</span>
                                          <span className="route-arrow">{flight.destination}</span>
                                        </span>
                                        <span className="price-list__meta">
                                          {flight.carrier} {flight.flightNumber} • {flight.passengers} {flight.passengers === 1 ? 'passenger' : 'passengers'} • {flight.direction === 'out' ? 'Outbound' : 'Return'}
                                        </span>
                                      </div>
                                      <div className="price-list__price-container">
                                        {flight.priceUSD !== undefined ? (
                                          <>
                                            <span className="price-list__price-per-person">
                                              {formatPrice(flight.priceUSD)} × {flight.passengers}
                                            </span>
                                            <strong className="price-list__price price-list__price--enhanced">
                                              {formatPrice(flightTotal)}
                                            </strong>
                                          </>
                                        ) : (
                                          <span className="price-list__error">{flight.error || 'Price unavailable'}</span>
                                        )}
                                      </div>
                                    </li>
                                  );
                                })}
                              </ul>
                              {allFlights.length > 10 && (
                                <div className="price-list-footer">
                                  <span className="price-list-footer__text">
                                    +{allFlights.length - 10} more flights
                                  </span>
                                </div>
                              )}
                            </div>
                          )}
                        </>
                      ) : allFlights.length > 0 ? (
                        <div className="price-loading-mini">
                          <p>Waiting for prices to load…</p>
                        </div>
                      ) : (
                        <div className="price-loading-mini">
                          <p>No flight data available yet</p>
                        </div>
                      )}
                    </div>
                  );
                }
                return null;
              })()}
              {(() => {
                const accommodation = accommodationPrices.get(selectedResult.rank);
                const accommodationTotal = calculateAccommodationTotal(accommodation);
                const hasAccommodationPrice = accommodationTotal > 0 || (accommodation?.priceUSD !== undefined || accommodation?.pricePerNightUSD !== undefined);
                
                if (hasAccommodationPrice || isFetchingAccommodation || selectedResult.rank > 0) {
                  return (
                    <div className="analysis-side-card analysis-side-card--price">
                      <div className="price-card-header">
                        <h3>
                          <span className="price-card-icon">🏨</span>
                          Accommodation costs
                        </h3>
                      </div>
                      {isFetchingAccommodation && !hasAccommodationPrice ? (
                        <div className="price-loading-mini">
                          <div className="price-loading-mini__spinner" aria-hidden="true" />
                          <p>Finding prices…</p>
                        </div>
                      ) : hasAccommodationPrice && accommodation && accommodationTotal > 0 ? (
                        <>
                          <div className="price-summary price-summary--enhanced">
                            <div className="price-summary__label">Total cost</div>
                            <div className="price-summary__value">{formatPrice(accommodationTotal)}</div>
                            <div className="price-summary__breakdown">
                              <span className="price-breakdown-item">
                                {hotelStars}★ hotel
                              </span>
                              {accommodation.pricePerNightUSD && accommodation.numberOfNights && accommodation.numberOfPeople && (
                                <>
                                  <span className="price-breakdown-item">
                                    {formatPrice(accommodation.pricePerNightUSD)}/night
                                  </span>
                                  <span className="price-breakdown-item">
                                    × {accommodation.numberOfNights} nights
                                  </span>
                                  <span className="price-breakdown-item">
                                    × {accommodation.numberOfPeople} {accommodation.numberOfPeople === 1 ? 'guest' : 'guests'}
                                  </span>
                                </>
                              )}
                            </div>
                          </div>
                          <div className="accommodation-details">
                            {accommodation.hotelName && (
                              <div className="accommodation-detail-item accommodation-detail-item--hotel">
                                <span className="accommodation-detail-label">Hotel</span>
                                <strong className="hotel-name">{accommodation.hotelName}</strong>
                              </div>
                            )}
                            {accommodation.bookingLink && (
                              <div className="accommodation-detail-item accommodation-detail-item--booking">
                                <a 
                                  href={accommodation.bookingLink} 
                                  target="_blank" 
                                  rel="noopener noreferrer"
                                  className="booking-link"
                                >
                                  Book hotel →
                                </a>
                              </div>
                            )}
                            <div className="accommodation-detail-item">
                              <span className="accommodation-detail-label">City</span>
                              <strong>{accommodation.city}</strong>
                            </div>
                            <div className="accommodation-detail-item">
                              <span className="accommodation-detail-label">Check-in</span>
                              <strong>{new Date(accommodation.checkIn).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</strong>
                            </div>
                            <div className="accommodation-detail-item">
                              <span className="accommodation-detail-label">Check-out</span>
                              <strong>{new Date(accommodation.checkOut).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</strong>
                            </div>
                          </div>
                        </>
                      ) : accommodation?.error ? (
                        <div className="price-loading-mini">
                          <p className="price-error">{accommodation.error}</p>
                        </div>
                      ) : (
                        <div className="price-loading-mini">
                          <p>Waiting for prices to load…</p>
                        </div>
                      )}
                    </div>
                  );
                }
                return null;
              })()}
              {(() => {
                const prices = flightPrices.get(selectedResult.rank) ?? [];
                const accommodation = accommodationPrices.get(selectedResult.rank);
                const flightTotal = calculateTotalPrice(prices);
                const accommodationTotal = calculateAccommodationTotal(accommodation);
                const combinedTotal = calculateCombinedTotal(prices, accommodation);
                const hasFlightPrices = prices.length > 0 && prices.some(p => p.priceUSD !== undefined);
                const hasAccommodationPrice = accommodationTotal > 0 || (accommodation?.priceUSD !== undefined || accommodation?.pricePerNightUSD !== undefined);
                
                if ((hasFlightPrices || hasAccommodationPrice) && combinedTotal > 0) {
                  return (
                    <div className="analysis-side-card analysis-side-card--price analysis-side-card--combined">
                      <div className="price-card-header">
                        <h3>
                          {/* <span className="price-card-icon">💰</span> */}
                          Total trip cost
                        </h3>
                      </div>
                      <div className="price-summary price-summary--enhanced price-summary--combined">
                        <div className="price-summary__label">Grand total</div>
                        <div className="price-summary__value price-summary__value--large">{formatPrice(combinedTotal)}</div>
                        <div className="price-summary__breakdown">
                          {hasFlightPrices && (
                            <span className="price-breakdown-item">
                              Flights: {formatPrice(flightTotal)}
                            </span>
                          )}
                          {hasAccommodationPrice && accommodationTotal > 0 && (
                            <span className="price-breakdown-item">
                              Accommodation: {formatPrice(accommodationTotal)}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                }
                return null;
              })()}
            </aside>
          </main>

          <footer className="analysis-actions">
            <button
              className="primary-button primary-button--huge"
              type="button"
              onClick={() => setView('world')}
            >
              Simulate the journey
            </button>
            <button className="ghost-button" type="button" onClick={handleResetToOnboarding}>
              Start a new plan
            </button>
          </footer>
        </div>
      ) : null}

      {view === 'world' && scenario && selectedResult && eventSummary && meetingLocation ? (
        <div className="world-screen">
          <header className="world-header">
            <button className="ghost-button" type="button" onClick={() => setView('analysis')}>
              ← Back to analysis
            </button>
            <div className="world-header__titles">
              <span className="world-header__tag">Journey simulation</span>
              <h1>{getCityNameFromAirportCode(selectedResult.event_location)}</h1>
              <p>{formatDateRange(selectedResult.event_dates)}</p>
            </div>
          </header>

          <div className="world-map-card">
            <TravelMap scenario={scenario} meetingLocation={meetingLocation} />
            <div className="world-map-card__legend">
              <strong>How to read this view</strong>
              <p>Routes animate towards the proposed hub. Line weight mirrors traveller volume.</p>
            </div>
          </div>

          <section className="world-metrics">
            <article className="world-metric">
              <span>Total CO₂e</span>
              <strong>{formatCo2(selectedResult.total_co2_tonnes)}</strong>
            </article>
            <article className="world-metric">
              <span>Avg CO₂ per person</span>
              <strong>{formatCo2(selectedResult.average_co2_per_person_tonnes)}</strong>
            </article>
            {(() => {
              const prices = flightPrices.get(selectedResult.rank) ?? [];
              const totalPrice = calculateTotalPrice(prices);
              const hasPrices = prices.length > 0 && prices.some(p => p.priceUSD !== undefined);
              
              // ALWAYS show price metric if we have prices OR are fetching
              if (hasPrices || isFetchingPrices || selectedResult.itinerary.length > 0) {
                return (
                  <article className="world-metric world-metric--price world-metric--highlight">
                    {/* <div className="world-metric__icon">💰</div> */}
                    <div className="world-metric__content">
                      <span>Total flight cost</span>
                      {hasPrices ? (
                        <strong className="world-price-display">{formatPrice(totalPrice)}</strong>
                      ) : (
                        <strong className="world-price-display" style={{ opacity: 0.5 }}>—</strong>
                      )}
                    </div>
                  </article>
                );
              }
              return null;
            })()}
            {(() => {
              const accommodation = accommodationPrices.get(selectedResult.rank);
              const hasAccommodationPrice = accommodation?.priceUSD !== undefined;
              
              if (hasAccommodationPrice || isFetchingAccommodation || selectedResult.rank > 0) {
                return (
                  <article className="world-metric world-metric--price world-metric--highlight">
                    {/* <div className="world-metric__icon">🏨</div> */}
                    <div className="world-metric__content">
                      <span>Accommodation cost ({hotelStars}★)</span>
                      {hasAccommodationPrice && accommodation ? (
                        <strong className="world-price-display">{formatPrice(accommodation.priceUSD)}</strong>
                      ) : (
                        <strong className="world-price-display" style={{ opacity: 0.5 }}>—</strong>
                      )}
                    </div>
                  </article>
                );
              }
              return null;
            })()}
            {travelStats.map((stat) => (
              <article key={stat.label} className="world-metric">
                <span>{stat.label}</span>
                <strong>{stat.value}</strong>
              </article>
            ))}
          </section>

          <section className="world-city-grid">
            <header className="section-header">
              <h4>Departure offices</h4>
              <span>{travelHoursByCity.length} cities tracked</span>
            </header>
            <div className="city-grid__content">
              {travelHoursByCity.map(([city, hours], index) => (
                <article className="city-card" key={city}>
                  <span className="city-card__index">{String(index + 1).padStart(2, '0')}</span>
                  <div className="city-card__meta">
                    <span className="city-card__city">{city}</span>
                    <span className="city-card__time">{formatHours(hours)}</span>
                  </div>
                  <span className="city-card__tag">
                    {hours >= 5 ? 'Long haul' : 'Quick hop'}
                  </span>
                </article>
              ))}
            </div>
          </section>

          {(() => {
            const prices = flightPrices.get(selectedResult.rank) ?? [];
            const hasPrices = prices.length > 0 && prices.some(p => p.priceUSD !== undefined);
            
            // Create a combined list: use prices if available, otherwise use itinerary
            // Merge itinerary entries with price data
            const allFlights: Array<{
              origin: string;
              destination: string;
              carrier: string;
              flightNumber: number;
              departureTime: string;
              passengers: number;
              direction: 'out' | 'in';
              stopType: 'Direct' | '1-Stop';
              priceUSD?: number;
              error?: string;
            }> = selectedResult.itinerary.map((itineraryEntry) => {
              const [origin, destination, carrier, flightNumber, departureTime, passengers, direction, stopType] = itineraryEntry;
              // Find matching price if available
              const priceEntry = prices.find(
                p => p.origin === origin && 
                     p.destination === destination && 
                     p.carrier === carrier && 
                     p.flightNumber === flightNumber &&
                     p.direction === direction
              );
              
              return {
                origin,
                destination,
                carrier,
                flightNumber,
                departureTime,
                passengers,
                direction,
                stopType,
                priceUSD: priceEntry?.priceUSD,
                error: priceEntry?.error
              };
            });
            
            // ALWAYS show flight details if we have itinerary OR prices
            if (hasPrices || selectedResult.itinerary.length > 0 || isFetchingPrices) {
              const outboundFlights = allFlights.filter(f => f.direction === 'out');
              const returnFlights = allFlights.filter(f => f.direction === 'in');
              const outboundTotal = outboundFlights.reduce((sum, f) => sum + (f.priceUSD ? f.priceUSD * f.passengers : 0), 0);
              const returnTotal = returnFlights.reduce((sum, f) => sum + (f.priceUSD ? f.priceUSD * f.passengers : 0), 0);
              
              return (
                <section className="world-flight-details">
                  <header className="section-header section-header--enhanced">
                    <div>
                      <h4>
                        <span className="section-header__icon">✈️</span>
                        Flight details & pricing
                      </h4>
                      <p className="section-header__subtitle">
                        {allFlights.length} flights • {allFlights.filter(p => p.priceUSD !== undefined).length} priced
                      </p>
                    </div>
                    {hasPrices && (
                      <div className="section-header__total">
                        <span className="section-header__total-label">Total</span>
                        <strong className="section-header__total-value">{formatPrice(calculateTotalPrice(prices))}</strong>
                      </div>
                    )}
                  </header>
                  <div className="flight-details__content">
                    {outboundFlights.length > 0 && (
                      <div className="flight-group flight-group--outbound">
                        <div className="flight-group__header">
                          <h5>
                            <span className="flight-group__icon">🛫</span>
                            Outbound flights
                          </h5>
                          {outboundTotal > 0 && (
                            <span className="flight-group__total">{formatPrice(outboundTotal)}</span>
                          )}
                        </div>
                        <div className="flight-table">
                          {outboundFlights.map((flight, index) => {
                            const date = new Date(flight.departureTime);
                            const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                            const timeStr = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
                            const flightTotal = flight.priceUSD ? flight.priceUSD * flight.passengers : 0;
                            const flightKey = `${flight.origin}-${flight.destination}-${flight.carrier}-${flight.flightNumber}-${flight.direction}`;
                            const isExpanded = expandedFlightKey === flightKey;
                            const uberData = uberItineraries.get(flightKey);
                            const isFetchingUberData = isFetchingUber.has(flightKey);
                            
                            return (
                              <div key={index} className={`flight-row-wrapper ${isExpanded ? 'flight-row-wrapper--expanded' : ''}`}>
                                <div 
                                  className="flight-row flight-row--enhanced flight-row--clickable"
                                  onClick={() => handleFlightClick(flight, selectedResult)}
                                  role="button"
                                  tabIndex={0}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                      e.preventDefault();
                                      handleFlightClick(flight, selectedResult);
                                    }
                                  }}
                                >
                                  <div className="flight-row__route">
                                    <div className="flight-row__airports-wrapper">
                                      <span className="flight-row__airports">{flight.origin}</span>
                                      <div className="flight-row__connector">
                                        <div className="flight-row__connector-line"></div>
                                        <span className="flight-row__connector-arrow">→</span>
                                      </div>
                                      <span className="flight-row__airports">{flight.destination}</span>
                                    </div>
                                    <span className="flight-row__carrier">{flight.carrier} {flight.flightNumber}</span>
                                  </div>
                                  <div className="flight-row__details">
                                    <div className="flight-row__date-wrapper">
                                      <span className="flight-row__date">{dateStr}</span>
                                      <span className="flight-row__time">{timeStr}</span>
                                    </div>
                                    <span className="flight-row__stops">{flight.stopType}</span>
                                  </div>
                                  <div className="flight-row__pricing">
                                    <span className="flight-row__passengers">{flight.passengers} {flight.passengers === 1 ? 'passenger' : 'passengers'}</span>
                                    {flight.priceUSD !== undefined ? (
                                      <div className="flight-row__price-breakdown">
                                        <span className="flight-row__price-per-person">{formatPrice(flight.priceUSD)} × {flight.passengers}</span>
                                        <strong className="flight-row__price">{formatPrice(flightTotal)}</strong>
                                      </div>
                                    ) : (
                                      <span className="flight-row__error">{flight.error || 'Price unavailable'}</span>
                                    )}
                                  </div>
                                  <div className="flight-row__expand-icon">
                                    {isExpanded ? '▼' : '▶'}
                                  </div>
                                </div>
                                {isExpanded && (
                                  <div className="flight-row__expanded">
                                    <div className="uber-itinerary">
                                      <h4 className="uber-itinerary__title">
                                        <span className="uber-itinerary__icon">🚗</span>
                                        Uber ride options
                                      </h4>
                                      {isFetchingUberData ? (
                                        <div className="uber-itinerary__loading">
                                          <div className="price-loading-mini__spinner" aria-hidden="true" />
                                          <p>Finding Uber prices…</p>
                                        </div>
                                      ) : uberData?.error ? (
                                        <div className="uber-itinerary__error">
                                          <p>{uberData.error}</p>
                                        </div>
                                      ) : (
                                        <div className="uber-itinerary__content">
                                          {uberData?.fromAirport && uberData.fromAirport.length > 0 && (
                                            <div className="uber-itinerary__section">
                                              <h5 className="uber-itinerary__section-title">From airport to city center</h5>
                                              <div className="uber-rides-list">
                                                {uberData.fromAirport.map((ride, rideIndex) => (
                                                  <div key={rideIndex} className="uber-ride-card">
                                                    <div className="uber-ride-card__header">
                                                      <span className="uber-ride-card__name">{ride.displayName}</span>
                                                      {ride.priceUSD && (
                                                        <strong className="uber-ride-card__price">{formatPrice(ride.priceUSD)}</strong>
                                                      )}
                                                    </div>
                                                    <div className="uber-ride-card__details">
                                                      <span className="uber-ride-card__detail">
                                                        <span className="uber-ride-card__detail-label">Duration:</span>
                                                        {formatDuration(ride.duration)}
                                                      </span>
                                                      <span className="uber-ride-card__detail">
                                                        <span className="uber-ride-card__detail-label">Distance:</span>
                                                        {formatDistance(ride.distance)}
                                                      </span>
                                                      {ride.estimate && (
                                                        <span className="uber-ride-card__detail">
                                                          <span className="uber-ride-card__detail-label">Estimate:</span>
                                                          {ride.estimate}
                                                        </span>
                                                      )}
                                                    </div>
                                                  </div>
                                                ))}
                                              </div>
                                            </div>
                                          )}
                                          {uberData?.toAirport && uberData.toAirport.length > 0 && (
                                            <div className="uber-itinerary__section">
                                              <h5 className="uber-itinerary__section-title">From city center to airport</h5>
                                              <div className="uber-rides-list">
                                                {uberData.toAirport.map((ride, rideIndex) => (
                                                  <div key={rideIndex} className="uber-ride-card">
                                                    <div className="uber-ride-card__header">
                                                      <span className="uber-ride-card__name">{ride.displayName}</span>
                                                      {ride.priceUSD && (
                                                        <strong className="uber-ride-card__price">{formatPrice(ride.priceUSD)}</strong>
                                                      )}
                                                    </div>
                                                    <div className="uber-ride-card__details">
                                                      <span className="uber-ride-card__detail">
                                                        <span className="uber-ride-card__detail-label">Duration:</span>
                                                        {formatDuration(ride.duration)}
                                                      </span>
                                                      <span className="uber-ride-card__detail">
                                                        <span className="uber-ride-card__detail-label">Distance:</span>
                                                        {formatDistance(ride.distance)}
                                                      </span>
                                                      {ride.estimate && (
                                                        <span className="uber-ride-card__detail">
                                                          <span className="uber-ride-card__detail-label">Estimate:</span>
                                                          {ride.estimate}
                                                        </span>
                                                      )}
                                                    </div>
                                                  </div>
                                                ))}
                                              </div>
                                            </div>
                                          )}
                                          {(!uberData?.fromAirport || uberData.fromAirport.length === 0) && (!uberData?.toAirport || uberData.toAirport.length === 0) && (
                                            <div className="uber-itinerary__empty">
                                              <p>No Uber options available</p>
                                            </div>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    {returnFlights.length > 0 && (
                      <div className="flight-group flight-group--return">
                        <div className="flight-group__header">
                          <h5>
                            <span className="flight-group__icon">🛬</span>
                            Return flights
                          </h5>
                          {returnTotal > 0 && (
                            <span className="flight-group__total">{formatPrice(returnTotal)}</span>
                          )}
                        </div>
                        <div className="flight-table">
                          {returnFlights.map((flight, index) => {
                            const date = new Date(flight.departureTime);
                            const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                            const timeStr = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
                            const flightTotal = flight.priceUSD ? flight.priceUSD * flight.passengers : 0;
                            const flightKey = `${flight.origin}-${flight.destination}-${flight.carrier}-${flight.flightNumber}-${flight.direction}`;
                            const isExpanded = expandedFlightKey === flightKey;
                            const uberData = uberItineraries.get(flightKey);
                            const isFetchingUberData = isFetchingUber.has(flightKey);
                            
                            return (
                              <div key={index} className={`flight-row-wrapper ${isExpanded ? 'flight-row-wrapper--expanded' : ''}`}>
                                <div 
                                  className="flight-row flight-row--enhanced flight-row--clickable"
                                  onClick={() => handleFlightClick(flight, selectedResult)}
                                  role="button"
                                  tabIndex={0}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                      e.preventDefault();
                                      handleFlightClick(flight, selectedResult);
                                    }
                                  }}
                                >
                                  <div className="flight-row__route">
                                    <div className="flight-row__airports-wrapper">
                                      <span className="flight-row__airports">{flight.origin}</span>
                                      <div className="flight-row__connector">
                                        <div className="flight-row__connector-line"></div>
                                        <span className="flight-row__connector-arrow">→</span>
                                      </div>
                                      <span className="flight-row__airports">{flight.destination}</span>
                                    </div>
                                    <span className="flight-row__carrier">{flight.carrier} {flight.flightNumber}</span>
                                  </div>
                                  <div className="flight-row__details">
                                    <div className="flight-row__date-wrapper">
                                      <span className="flight-row__date">{dateStr}</span>
                                      <span className="flight-row__time">{timeStr}</span>
                                    </div>
                                    <span className="flight-row__stops">{flight.stopType}</span>
                                  </div>
                                  <div className="flight-row__pricing">
                                    <span className="flight-row__passengers">{flight.passengers} {flight.passengers === 1 ? 'passenger' : 'passengers'}</span>
                                    {flight.priceUSD !== undefined ? (
                                      <div className="flight-row__price-breakdown">
                                        <span className="flight-row__price-per-person">{formatPrice(flight.priceUSD)} × {flight.passengers}</span>
                                        <strong className="flight-row__price">{formatPrice(flightTotal)}</strong>
                                      </div>
                                    ) : (
                                      <span className="flight-row__error">{flight.error || 'Price unavailable'}</span>
                                    )}
                                  </div>
                                  <div className="flight-row__expand-icon">
                                    {isExpanded ? '▼' : '▶'}
                                  </div>
                                </div>
                                {isExpanded && (
                                  <div className="flight-row__expanded">
                                    <div className="uber-itinerary">
                                      <h4 className="uber-itinerary__title">
                                        <span className="uber-itinerary__icon">🚗</span>
                                        Uber ride options
                                      </h4>
                                      {isFetchingUberData ? (
                                        <div className="uber-itinerary__loading">
                                          <div className="price-loading-mini__spinner" aria-hidden="true" />
                                          <p>Finding Uber prices…</p>
                                        </div>
                                      ) : uberData?.error ? (
                                        <div className="uber-itinerary__error">
                                          <p>{uberData.error}</p>
                                        </div>
                                      ) : (
                                        <div className="uber-itinerary__content">
                                          {uberData?.fromAirport && uberData.fromAirport.length > 0 && (
                                            <div className="uber-itinerary__section">
                                              <h5 className="uber-itinerary__section-title">From airport to city center</h5>
                                              <div className="uber-rides-list">
                                                {uberData.fromAirport.map((ride, rideIndex) => (
                                                  <div key={rideIndex} className="uber-ride-card">
                                                    <div className="uber-ride-card__header">
                                                      <span className="uber-ride-card__name">{ride.displayName}</span>
                                                      {ride.priceUSD && (
                                                        <strong className="uber-ride-card__price">{formatPrice(ride.priceUSD)}</strong>
                                                      )}
                                                    </div>
                                                    <div className="uber-ride-card__details">
                                                      <span className="uber-ride-card__detail">
                                                        <span className="uber-ride-card__detail-label">Duration:</span>
                                                        {formatDuration(ride.duration)}
                                                      </span>
                                                      <span className="uber-ride-card__detail">
                                                        <span className="uber-ride-card__detail-label">Distance:</span>
                                                        {formatDistance(ride.distance)}
                                                      </span>
                                                      {ride.estimate && (
                                                        <span className="uber-ride-card__detail">
                                                          <span className="uber-ride-card__detail-label">Estimate:</span>
                                                          {ride.estimate}
                                                        </span>
                                                      )}
                                                    </div>
                                                  </div>
                                                ))}
                                              </div>
                                            </div>
                                          )}
                                          {uberData?.toAirport && uberData.toAirport.length > 0 && (
                                            <div className="uber-itinerary__section">
                                              <h5 className="uber-itinerary__section-title">From city center to airport</h5>
                                              <div className="uber-rides-list">
                                                {uberData.toAirport.map((ride, rideIndex) => (
                                                  <div key={rideIndex} className="uber-ride-card">
                                                    <div className="uber-ride-card__header">
                                                      <span className="uber-ride-card__name">{ride.displayName}</span>
                                                      {ride.priceUSD && (
                                                        <strong className="uber-ride-card__price">{formatPrice(ride.priceUSD)}</strong>
                                                      )}
                                                    </div>
                                                    <div className="uber-ride-card__details">
                                                      <span className="uber-ride-card__detail">
                                                        <span className="uber-ride-card__detail-label">Duration:</span>
                                                        {formatDuration(ride.duration)}
                                                      </span>
                                                      <span className="uber-ride-card__detail">
                                                        <span className="uber-ride-card__detail-label">Distance:</span>
                                                        {formatDistance(ride.distance)}
                                                      </span>
                                                      {ride.estimate && (
                                                        <span className="uber-ride-card__detail">
                                                          <span className="uber-ride-card__detail-label">Estimate:</span>
                                                          {ride.estimate}
                                                        </span>
                                                      )}
                                                    </div>
                                                  </div>
                                                ))}
                                              </div>
                                            </div>
                                          )}
                                          {(!uberData?.fromAirport || uberData.fromAirport.length === 0) && (!uberData?.toAirport || uberData.toAirport.length === 0) && (
                                            <div className="uber-itinerary__empty">
                                              <p>No Uber options available</p>
                                            </div>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    {hasPrices && (
                      <div className="flight-total flight-total--enhanced">
                        <div className="flight-total__content">
                          <span className="flight-total__label">Total flight cost</span>
                          <div className="flight-total__breakdown">
                            {outboundTotal > 0 && <span>Outbound: {formatPrice(outboundTotal)}</span>}
                            {returnTotal > 0 && <span>Return: {formatPrice(returnTotal)}</span>}
                          </div>
                        </div>
                        <strong className="flight-total__value">
                          {formatPrice(allFlights.reduce((sum, f) => sum + (f.priceUSD ? f.priceUSD * f.passengers : 0), 0))}
                        </strong>
                      </div>
                    )}
                  </div>
                </section>
              );
            }
            return null;
          })()}
        </div>
      ) : null}
    </div>
  );
}
