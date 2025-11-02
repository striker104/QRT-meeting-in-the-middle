import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import TravelMap from './components/TravelMap';
import { AttendeeScenario, CityTravelPlan, EventSummary, OptimizationResult } from './types';
import { sampleScenario, cityCoordinates } from './data/sampleScenario';
import { streamMeetingPlan } from './api/openRouterClient';

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
  Bangkok: [100.5018, 13.7563]
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

  const travelHours = deriveTravelHours(scenario);
  const expandedTimes = expandTravelTimes(travelHours, scenario);

  const totalTravellers = Object.values(scenario.attendees).reduce((sum, count) => sum + count, 0) || 1;
  const weightedTravelHours = Object.entries(travelHours).reduce((sum, [city, hours]) => {
    const travellers = scenario.attendees[city] ?? 1;
    return sum + hours * travellers;
  }, 0);

  const average = weightedTravelHours / totalTravellers;
  const median = calculateMedian(expandedTimes);
  const max = Math.max(...expandedTimes);
  const min = Math.min(...expandedTimes);

  const totalCo2 = Math.round(weightedTravelHours * 2.2);
  const plannedDates = deriveEventDates(scenario);
  const meetingHub = chooseMeetingHub(travelHours);
  const totalSpanHours = (new Date(scenario.availability_window.end).getTime() - new Date(scenario.availability_window.start).getTime()) / (1000 * 60 * 60);

  // Return array with single mock result (can be expanded to return multiple ranked results)
  return [
    {
      rank: 1,
      event_location: meetingHub,
      phase_1_score: 5.5,
      event_dates: plannedDates,
      event_span: {
        start: scenario.availability_window.start,
        end: scenario.availability_window.end,
        total_hours: totalSpanHours
      },
      total_co2_tonnes: totalCo2,
      average_co2_per_person_tonnes: Number((totalCo2 / totalTravellers).toFixed(2)),
      average_travel_hours: Number(average.toFixed(2)),
      median_travel_hours: Number(median.toFixed(2)),
      max_travel_hours: Number(max.toFixed(2)),
      min_travel_hours: Number(min.toFixed(2)),
      attendee_travel_hours: travelHours,
      itinerary: [] // Empty itinerary for mock - will be populated by real API
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

function deriveMeetingLocation(summary: EventSummary): CityTravelPlan {
  const coordinates =
    meetingCoordinateDirectory[summary.event_location] ?? meetingCoordinateDirectory.London;

  if (!meetingCoordinateDirectory[summary.event_location]) {
    console.warn(
      `Missing coordinates for ${summary.event_location}. Falling back to London coordinates.`
    );
  }

  return {
    city: summary.event_location,
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
  const [executiveBrief, setExecutiveBrief] = useState('');
  const [hasRequestedBrief, setHasRequestedBrief] = useState(false);
  const [briefModel, setBriefModel] = useState<string | null>(null);
  const [isFetchingBrief, setIsFetchingBrief] = useState(false);
  const [briefError, setBriefError] = useState<string | null>(null);
  const activeBriefRequest = useRef<AbortController | null>(null);

  // Get the currently selected result
  const selectedResult = optimizationResults[selectedResultIndex] ?? null;
  const eventSummary = selectedResult ? convertToEventSummary(selectedResult) : null;

  useEffect(() => {
    return () => {
      activeBriefRequest.current?.abort();
    };
  }, []);

  const generateBrief = useCallback(async (summary: EventSummary) => {
    activeBriefRequest.current?.abort();

    const controller = new AbortController();
    activeBriefRequest.current = controller;

    setIsFetchingBrief(true);
    setBriefError(null);
    setBriefModel(null);
    setExecutiveBrief('');
    setHasRequestedBrief(true);

    try {
      const result = await streamMeetingPlan(summary, {
        signal: controller.signal,
        onToken: (token) => {
          setExecutiveBrief((prev) => prev + token);
        }
      });

      setExecutiveBrief(result.content);
      setBriefModel(result.model);
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        setBriefError(
          error instanceof Error ? error.message : 'Failed to generate the meeting brief.'
        );
        setExecutiveBrief('');
      }
    } finally {
      if (activeBriefRequest.current === controller) {
        activeBriefRequest.current = null;
      }
      setIsFetchingBrief(false);
    }
  }, []);

  useEffect(() => {
    if (view === 'analysis' && eventSummary && !hasRequestedBrief) {
      generateBrief(eventSummary);
    }
  }, [view, eventSummary, hasRequestedBrief, generateBrief]);

  const runOptimisation = useCallback(async (nextScenario: AttendeeScenario) => {
    setScenario(nextScenario);
    setView('optimising');
    setOptimiserError(null);
    setOptimizationResults([]);
    setSelectedResultIndex(0);
    setExecutiveBrief('');
    setBriefModel(null);
    setBriefError(null);
    setHasRequestedBrief(false);
    setIsFetchingBrief(false);
    activeBriefRequest.current?.abort();
    activeBriefRequest.current = null;

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
    activeBriefRequest.current?.abort();
    setScenarioInput(JSON.stringify(scenario ?? sampleScenario, null, 2));
    setScenario(null);
    setOptimizationResults([]);
    setSelectedResultIndex(0);
    setExecutiveBrief('');
    setBriefModel(null);
    setBriefError(null);
    setHasRequestedBrief(false);
    setIsFetchingBrief(false);
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

  const analysisBriefFallback =
    executiveBrief ||
    (briefError
      ? '_Unable to produce a briefing. Please try again shortly._'
      : isFetchingBrief
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
                {optimizationResults.map((result, index) => (
                  <button
                    key={result.rank}
                    className={`rank-button ${index === selectedResultIndex ? 'rank-button--active' : ''}`}
                    type="button"
                    onClick={() => {
                      setSelectedResultIndex(index);
                      setHasRequestedBrief(false);
                      setExecutiveBrief('');
                    }}
                  >
                    Rank {result.rank}
                    <span className="rank-button__score">Score: {result.phase_1_score.toFixed(2)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <header className="analysis-hero">
            <div className="analysis-hero__info">
              <span className="analysis-hero__tag">Optimised outcome #{selectedResult.rank}</span>
              <h1>{selectedResult.event_location}</h1>
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
                {briefModel ? (
                  <span className="analysis-brief-card__model">{briefModel}</span>
                ) : null}
              </header>
              <div className="analysis-brief-card__body">
                <ReactMarkdown>{analysisBriefFallback}</ReactMarkdown>
              </div>
              {briefError ? (
                <p className="analysis-brief-card__error">{briefError}</p>
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
              <h1>{selectedResult.event_location}</h1>
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
                    {hours > selectedResult.average_travel_hours ? 'Long haul' : 'Quick hop'}
                  </span>
                </article>
              ))}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
