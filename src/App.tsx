import { useState } from 'react';
import TravelMap from './components/TravelMap';
import { AttendeeScenario, CityTravelPlan } from './types';

type BackendEventSummary = {
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
};

type ActiveTab = 'info' | 'world';

type FeatureCard = {
  id: string;
  label: string;
  title: string;
  description: string;
  meta?: string;
  cta?: string;
};

const tabOptions: { id: ActiveTab; label: string }[] = [
  { id: 'info', label: 'Info board' },
  { id: 'world', label: 'World view' }
];

const sampleBackendSummary: BackendEventSummary = {
  event_location: 'New York',
  event_dates: {
    start: '2025-12-10T09:30:00Z',
    end: '2025-12-11T13:20:00Z'
  },
  event_span: {
    start: '2025-12-09T17:30:00Z',
    end: '2025-12-11T22:27:00Z'
  },
  total_co2: 125,
  average_travel_hours: 10.9,
  median_travel_hours: 5.7,
  max_travel_hours: 26.3,
  min_travel_hours: 0.5,
  attendee_travel_hours: {
    Mumbai: 20.5,
    Shanghai: 4.6,
    'Hong Kong': 13.7,
    Singapore: 2.1,
    Sydney: 23.9
  }
};

const dateTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  timeZoneName: 'short'
});

const clockFormatter = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
  timeZone: 'UTC'
});

const meetingCoordinateDirectory: Record<string, [number, number]> = {
  'New York': [-74.006, 40.7128]
};

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

  return `${totalCo2.toLocaleString('en-GB')} tCO2e`;
}

function buildScenario(summary: BackendEventSummary): AttendeeScenario {
  const attendees: Record<string, number> = {};

  Object.keys(summary.attendee_travel_hours).forEach((city) => {
    attendees[city] = 1;
  });

  return {
    attendees,
    availability_window: {
      start: summary.event_span.start,
      end: summary.event_span.end
    },
    event_duration: {
      days: 0,
      hours: 0
    }
  };
}

function deriveMeetingLocation(summary: BackendEventSummary): CityTravelPlan {
  const coordinates =
    meetingCoordinateDirectory[summary.event_location] ?? [
      -0.1276, 51.5072
    ];

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
  const eventSummary = sampleBackendSummary;

  const nowUtc = clockFormatter.format(new Date());
  const meetingLocation = deriveMeetingLocation(eventSummary);
  const scenario = buildScenario(eventSummary);

  const travelHoursByCity = Object.entries(eventSummary.attendee_travel_hours).sort(
    ([, hoursA], [, hoursB]) => hoursB - hoursA
  );

  const travelStats = [
    {
      label: 'Average travel time',
      value: formatHours(eventSummary.average_travel_hours)
    },
    {
      label: 'Median travel time',
      value: formatHours(eventSummary.median_travel_hours)
    },
    {
      label: 'Longest journey',
      value: formatHours(eventSummary.max_travel_hours)
    },
    {
      label: 'Shortest journey',
      value: formatHours(eventSummary.min_travel_hours)
    }
  ];

  const longestRoute = travelHoursByCity[0];

  const featureCards: FeatureCard[] = [
    {
      id: 'hub',
      label: 'Meeting hub',
      title: meetingLocation.city,
      meta: formatDateRange(eventSummary.event_dates),
      description: `${travelHoursByCity.length} global offices align to this schedule.`,
      cta: 'Simulate the journey'
    },
    {
      id: 'longest',
      label: `Longest journey${longestRoute ? ` — ${longestRoute[0]}` : ''}`,
      title: longestRoute ? formatHours(longestRoute[1]) : 'n/a',
      description: 'Time on the move from our farthest office.',
      meta: 'Route animation traces live connectivity.'
    },
    {
      id: 'footprint',
      label: 'Total CO₂e',
      title: formatCo2(eventSummary.total_co2),
      description: 'Aggregate footprint across the traveller mix.',
      meta: `Median leg ${formatHours(eventSummary.median_travel_hours)}`
    }
  ];

  const heroCard = featureCards[0];
  const secondaryCards = featureCards.slice(1);
  const filterLabels = ['City', 'Metric', 'Window', 'CO₂ profile'];

  const [activeTab, setActiveTab] = useState<ActiveTab>('info');
  const [showFullMap, setShowFullMap] = useState(false);

  const handleSimulateJourney = () => setShowFullMap(true);
  const handleCloseSimulation = () => setShowFullMap(false);

  return (
    <div className="app">
      <header className="top-nav">
        <div className="top-nav__brand">
          <span className="top-nav__glyph">≡</span>
          <span className="top-nav__logo">qrt</span>
        </div>
        <nav className="top-nav__links">
          {['Archive', 'Schedule', 'Teams', 'Projects', 'Support', 'About'].map((entry) => (
            <a key={entry} href="#" className="top-nav__link">
              {entry}
            </a>
          ))}
        </nav>
        <div className="top-nav__clock">
          <span>UTC</span>
          <strong>{nowUtc}</strong>
        </div>
      </header>

      <div className="sub-nav">
        <span className="sub-nav__tag">meeting in the middle</span>
        <span className="sub-nav__title">Global session storyboard</span>
        <button className="sub-nav__cta" type="button" onClick={handleSimulateJourney}>
          Simulate the journey
        </button>
      </div>

      <main className="page">
        <section className="tab-bar">
          {tabOptions.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`tab-button${activeTab === tab.id ? ' tab-button--active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </section>

        {activeTab === 'info' && (
          <>
            <section className="feature-deck">
              <article className="feature-card feature-card--hero">
                <span className="feature-card__tag">{heroCard.label}</span>
                <h2 className="feature-card__title">{heroCard.title}</h2>
                {heroCard.meta ? <p className="feature-card__meta">{heroCard.meta}</p> : null}
                <p className="feature-card__description">{heroCard.description}</p>
                {heroCard.cta ? (
                  <button
                    className="feature-card__cta"
                    type="button"
                    onClick={handleSimulateJourney}
                  >
                    {heroCard.cta}
                  </button>
                ) : null}
              </article>

              <div className="feature-card-list">
                {secondaryCards.map((card) => (
                  <article className="feature-card feature-card--compact" key={card.id}>
                    <span className="feature-card__tag">{card.label}</span>
                    <h3 className="feature-card__title">{card.title}</h3>
                    <p className="feature-card__description">{card.description}</p>
                    {card.meta ? <p className="feature-card__meta">{card.meta}</p> : null}
                  </article>
                ))}
              </div>
            </section>

            <section className="filter-row">
              {filterLabels.map((label) => (
                <button className="filter-pill" type="button" key={label}>
                  <span>{label}</span>
                  <span className="filter-pill__icon">⌄</span>
                </button>
              ))}
            </section>

            <section className="info-panels">
              <article className="info-card">
                <header>
                  <span className="info-card__kicker">Travel benchmarks</span>
                  <h3 className="info-card__title">Journey analytics</h3>
                </header>
                <ul className="info-card__list">
                  {travelStats.map((stat) => (
                    <li key={stat.label}>
                      <span>{stat.label}</span>
                      <strong>{stat.value}</strong>
                    </li>
                  ))}
                </ul>
              </article>

              <article className="info-card">
                <header>
                  <span className="info-card__kicker">Window</span>
                  <h3 className="info-card__title">Availability span</h3>
                </header>
                <p className="info-card__copy">{formatDateRange(eventSummary.event_span)}</p>
                <p className="info-card__copy info-card__copy--muted">
                  Sync with local leads to confirm corridor readiness ahead of the session.
                </p>
              </article>
            </section>
          </>
        )}

        {activeTab === 'world' && (
          <section className="world-layout">
            <div className="world-summary">
              <span className="world-summary__tag">Global roster</span>
              <h3 className="world-summary__title">World view</h3>
              <p className="world-summary__copy">
                Scan the cities contributing to this session and spot the journeys demanding the
                highest coordination effort.
              </p>
              <ul className="world-summary__metrics">
                {travelStats.map((stat) => (
                  <li key={stat.label}>
                    <span>{stat.label}</span>
                    <strong>{stat.value}</strong>
                  </li>
                ))}
              </ul>
              <button
                className="world-summary__cta"
                type="button"
                onClick={handleSimulateJourney}
              >
                Simulate the journey
              </button>
            </div>

            <div className="world-city-grid">
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
                      {hours > eventSummary.average_travel_hours ? 'Long haul' : 'Quick hop'}
                    </span>
                  </article>
                ))}
              </div>
            </div>
          </section>
        )}
      </main>

      {showFullMap && (
        <div className="map-screen" role="dialog" aria-modal="true">
          <div className="map-screen__header">
            <button className="map-screen__button" type="button" onClick={handleCloseSimulation}>
              ← Back to board
            </button>
            <span>Route animation playback</span>
          </div>
          <div className="map-screen__map">
            <TravelMap
              key="full-map"
              scenario={scenario}
              meetingLocation={meetingLocation}
            />
            <div className="map-screen__legend">
              <strong>How to read this view</strong>
              <p>Red arcs accelerate in to highlight the proposed travel corridors.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
