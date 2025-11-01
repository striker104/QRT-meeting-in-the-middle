import mapboxgl from 'mapbox-gl';
import { useEffect, useRef } from 'react';
import { AttendeeScenario, CityTravelPlan } from '../types';
import { cityCoordinates } from '../data/sampleScenario';
import 'mapbox-gl/dist/mapbox-gl.css';

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN ?? '';

interface TravelMapProps {
  scenario: AttendeeScenario;
  meetingLocation: CityTravelPlan;
}

const ROUTE_ANIMATION_DURATION = 3200;

export default function TravelMap({ scenario, meetingLocation }: TravelMapProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const animationRef = useRef<number>();

  useEffect(() => {
    if (!mapContainerRef.current) {
      return;
    }

    const token = import.meta.env.VITE_MAPBOX_TOKEN;
    if (!token) {
      console.warn(
        'Mapbox token is missing. Set VITE_MAPBOX_TOKEN in a .env file to view the map.'
      );
    }

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: meetingLocation.coordinates,
      zoom: 2.2,
      projection: 'globe'
    });

    mapRef.current = map;

    map.on('style.load', () => {
      map.setFog({
        color: '#0b1222',
        'high-color': '#1f3b73',
        'horizon-blend': 0.2,
        'space-color': '#000000',
        'star-intensity': 0.15
      });
    });

    let routesSource: mapboxgl.GeoJSONSource | null = null;
    let animationStart: number | null = null;

    map.on('load', () => {
      const travelPlans = Object.entries(scenario.attendees)
        .map(([city, attendeeCount]) => {
          const coordinates = cityCoordinates[city];
          if (!coordinates) {
            console.warn(`Coordinates missing for ${city}. Skipping visualisation for this city.`);
            return null;
          }
          return { city, attendees: attendeeCount, coordinates };
        })
        .filter((plan): plan is CityTravelPlan => Boolean(plan));

      const fullRoutes = travelPlans.map((plan) =>
        generateCurve(plan.coordinates, meetingLocation.coordinates)
      );

      const initialFeatures = travelPlans.map((plan, index) => ({
        type: 'Feature' as const,
        properties: {
          city: plan.city,
          attendees: plan.attendees
        },
        geometry: {
          type: 'LineString' as const,
          coordinates: getPartialRoute(fullRoutes[index], 0)
        }
      }));

      const collection = {
        type: 'FeatureCollection' as const,
        features: initialFeatures
      };

      if (!map.getSource('travel-routes')) {
        map.addSource('travel-routes', {
          type: 'geojson',
          data: collection
        });
      }

      routesSource = map.getSource('travel-routes') as mapboxgl.GeoJSONSource;
      routesSource.setData(collection);

      if (!map.getLayer('travel-routes')) {
        map.addLayer({
          id: 'travel-routes',
          type: 'line',
          source: 'travel-routes',
          layout: {
            'line-cap': 'round',
            'line-join': 'round'
          },
          paint: {
            'line-width': [
              'interpolate',
              ['linear'],
              ['get', 'attendees'],
              1,
              2,
              5,
              6
            ],
            'line-color': '#ed254e',
            'line-opacity': 0.85
          }
        });
      }

      createMeetingMarker(map, meetingLocation);

      travelPlans.forEach((plan) => {
        createCityMarker(map, plan);
      });

      const animateRoutes = (timestamp: number) => {
        if (animationStart === null) {
          animationStart = timestamp;
        }

        const elapsed = timestamp - animationStart;
        const progress = Math.min(elapsed / ROUTE_ANIMATION_DURATION, 1);

        const animatedFeatures = travelPlans.map((plan, index) => ({
          type: 'Feature' as const,
          properties: {
            city: plan.city,
            attendees: plan.attendees
          },
          geometry: {
            type: 'LineString' as const,
            coordinates: getPartialRoute(fullRoutes[index], progress)
          }
        }));

        routesSource?.setData({
          type: 'FeatureCollection',
          features: animatedFeatures
        });

        if (progress < 1) {
          animationRef.current = requestAnimationFrame(animateRoutes);
        }
      };

      animationRef.current = requestAnimationFrame(animateRoutes);
    });

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }

      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [scenario, meetingLocation]);

  return <div ref={mapContainerRef} className="map-container" />;
}

function createMeetingMarker(map: mapboxgl.Map, meetingLocation: CityTravelPlan) {
  const meetingElement = document.createElement('div');
  meetingElement.className = 'meeting-marker';
  meetingElement.innerHTML = `
    <div class="meeting-marker__pulse"></div>
    <span class="meeting-marker__label">${meetingLocation.city}</span>
  `;

  new mapboxgl.Marker({
    element: meetingElement,
    anchor: 'bottom'
  })
    .setLngLat(meetingLocation.coordinates)
    .setPopup(
      new mapboxgl.Popup({ offset: 18 }).setHTML(
        `<strong>${meetingLocation.city}</strong><br />Proposed gathering point`
      )
    )
    .addTo(map);
}

function createCityMarker(map: mapboxgl.Map, plan: CityTravelPlan) {
  const cityElement = document.createElement('div');
  cityElement.className = 'city-marker';
  cityElement.innerHTML = `
    <div class="city-marker__dot"></div>
    <div class="city-marker__label">
      <strong>${plan.city}</strong>
      <span>${plan.attendees} attendee${plan.attendees > 1 ? 's' : ''}</span>
    </div>
  `;

  new mapboxgl.Marker({ element: cityElement })
    .setLngLat(plan.coordinates)
    .addTo(map);
}

function generateCurve(
  start: [number, number],
  end: [number, number],
  segmentCount = 120
): [number, number][] {
  const coordinates: [number, number][] = [];
  const lonDelta = end[0] - start[0];
  const latDelta = end[1] - start[1];
  const arcHeight = Math.max(Math.abs(lonDelta), Math.abs(latDelta)) * 0.12;

  for (let i = 0; i <= segmentCount; i += 1) {
    const t = i / segmentCount;
    const lng = start[0] + lonDelta * t;
    const lat = start[1] + latDelta * t + Math.sin(Math.PI * t) * arcHeight;
    coordinates.push([lng, lat]);
  }

  return coordinates;
}

function getPartialRoute(path: [number, number][], progress: number): [number, number][] {
  if (path.length === 0) {
    return [];
  }

  if (progress <= 0) {
    return [path[0], path[0]];
  }

  const lastIndex = Math.max(1, Math.floor(progress * (path.length - 1)));
  return path.slice(0, lastIndex + 1);
}
