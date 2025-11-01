import TravelMap from './components/TravelMap';
import { meetingLocation, sampleScenario } from './data/sampleScenario';
import { AttendeeScenario } from './types';

const dateFormatter = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  timeZoneName: 'short'
});

function formatAvailabilityWindow(scenario: AttendeeScenario) {
  const start = new Date(scenario.availability_window.start);
  const end = new Date(scenario.availability_window.end);

  return `${dateFormatter.format(start)} → ${dateFormatter.format(end)}`;
}

function formatDuration(scenario: AttendeeScenario) {
  const parts = [];
  if (scenario.event_duration.days) {
    parts.push(`${scenario.event_duration.days} day${scenario.event_duration.days > 1 ? 's' : ''}`);
  }
  if (scenario.event_duration.hours) {
    parts.push(
      `${scenario.event_duration.hours} hour${scenario.event_duration.hours > 1 ? 's' : ''}`
    );
  }
  return parts.join(' ');
}

export default function App() {
  const totalAttendees = Object.values(sampleScenario.attendees).reduce(
    (acc, count) => acc + count,
    0
  );

  return (
    <div className="app">
      <aside className="sidebar">
        <header className="sidebar__header">
          <h1>QRT Meeting Navigator</h1>
          <p>
            Visualise how global teams converge on a central hub. Each route is animated to show
            attendee journeys from their home office to the proposed event location.
          </p>
        </header>

        <section className="scenario-card">
          <span className="scenario-card__title">Scenario snapshot</span>
          <div className="scenario-card__meta">
            <div>
              <strong>Availability window</strong>
              <div>{formatAvailabilityWindow(sampleScenario)}</div>
            </div>
            <div>
              <strong>Session length</strong>
              <div>{formatDuration(sampleScenario)}</div>
            </div>
            <div>
              <strong>Participants</strong>
              <div>{totalAttendees} travellers across {Object.keys(sampleScenario.attendees).length} offices</div>
            </div>
            <div>
              <strong>Proposed hub</strong>
              <div>{meetingLocation.city}</div>
            </div>
          </div>
        </section>

        <section className="scenario-card">
          <span className="scenario-card__title">Departure offices</span>
          <div className="attendee-list">
            {Object.entries(sampleScenario.attendees).map(([city, count]) => (
              <div className="attendee-row" key={city}>
                <span className="attendee-row__city">{city}</span>
                <span className="attendee-row__count">
                  {count} attendee{count > 1 ? 's' : ''}
                </span>
              </div>
            ))}
          </div>
        </section>
      </aside>

      <main className="map-wrapper">
        <TravelMap scenario={sampleScenario} meetingLocation={meetingLocation} />

        <div className="map-overlay">
          <strong>How to read this view</strong>
          <span>Animated dots show live progress for each traveller.</span>
          <div className="legend">
            <div className="legend__item">
              <span className="legend__swatch legend__swatch--route" />
              Travel corridor
            </div>
            <div className="legend__item">
              <span className="legend__swatch legend__swatch--traveller" />
              Traveller position
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
