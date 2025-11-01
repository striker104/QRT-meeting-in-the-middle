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

  const featureCards = [
    {
      id: 'hub',
      label: 'Meeting hub',
      title: meetingLocation.city,
      meta: formatDateRange(eventSummary.event_dates),
      description: `${travelHoursByCity.length} global offices align to this schedule.`,
      cta: 'View itinerary'
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

  const filterLabels = ['City', 'Metric', 'Window', 'CO₂ profile'];

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
        <button className="sub-nav__cta" type="button">
          Tune in
        </button>
      </div>

      <main className="page">
        <section className="feature-deck">
          <article className="feature-card feature-card--hero">
            <span className="feature-card__tag">{featureCards[0].label}</span>
            <h2 className="feature-card__title">{featureCards[0].title}</h2>
            <p className="feature-card__meta">{featureCards[0].meta}</p>
            <p className="feature-card__description">{featureCards[0].description}</p>
            <button className="feature-card__cta" type="button">
              {featureCards[0].cta}
            </button>
          </article>

          <div className="feature-card-list">
            {featureCards.slice(1).map((card) => (
              <article className="feature-card feature-card--compact" key={card.id}>
                <span className="feature-card__tag">{card.label}</span>
                <h3 className="feature-card__title">{card.title}</h3>
                <p className="feature-card__description">{card.description}</p>
                <p className="feature-card__meta">{card.meta}</p>
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

        <section className="content-grid">
          <div className="info-column">
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
          </div>

          <div className="map-column">
            <div className="map-frame">
              <TravelMap scenario={scenario} meetingLocation={meetingLocation} />
            </div>
            <footer className="map-legend">
              <strong>How to read this view</strong>
              <p>Arcs ease-in to illustrate routes, sized by attendee intensity.</p>
              <div className="map-legend__row">
                <span className="map-legend__swatch" />
                <span>Active travel corridor</span>
              </div>
            </footer>
          </div>
        </section>

        <section className="city-grid">
          <header className="section-header">
            <h3>Departure offices</h3>
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
        </section>
      </main>
    </div>
  );
}
