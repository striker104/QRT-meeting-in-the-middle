import { UberItinerary, UberRide } from '../types';
import { getCityNameFromAirportCode } from '../data/airportCodes';

// Airport coordinates mapping - using city center coordinates as approximation
// In a production app, you'd want to use actual airport coordinates
const airportCoordinates: Record<string, [number, number]> = {
  // Asia-Pacific
  'SGN': [106.6297, 10.8231], // Ho Chi Minh City
  'HAN': [105.8342, 21.0285], // Hanoi
  'KUL': [101.6869, 3.1390], // Kuala Lumpur
  'BKK': [100.5018, 13.7563], // Bangkok
  'SIN': [103.8198, 1.3521], // Singapore
  'HKG': [114.1694, 22.3193], // Hong Kong
  'PVG': [121.4737, 31.2304], // Shanghai
  'SHA': [121.4737, 31.2304], // Shanghai
  'BOM': [72.8777, 19.076], // Mumbai
  'SYD': [151.2093, -33.8688], // Sydney
  'NRT': [139.6917, 35.6895], // Tokyo
  'HND': [139.6917, 35.6895], // Tokyo
  'ICN': [126.9780, 37.5665], // Seoul
  // Europe
  'LHR': [-0.1276, 51.5072], // London
  'LGW': [-0.1276, 51.5072], // London
  'CDG': [2.3522, 48.8566], // Paris
  'FRA': [8.6821, 50.1109], // Frankfurt
  'AMS': [4.9041, 52.3676], // Amsterdam
  // Middle East
  'DXB': [55.2708, 25.2048], // Dubai
  // North America
  'JFK': [-73.7781, 40.6413], // New York JFK
  'LAX': [-118.2437, 34.0522], // Los Angeles
  'SFO': [-122.4194, 37.7749], // San Francisco
};

function getAirportCoordinates(airportCode: string): [number, number] | null {
  const coords = airportCoordinates[airportCode.toUpperCase()];
  if (coords) {
    return coords;
  }
  
  // Fallback: try to get city coordinates
  const cityName = getCityNameFromAirportCode(airportCode);
  // This is a basic fallback - in production you'd want a more comprehensive mapping
  return null;
}

export interface UberPriceOptions {
  signal?: AbortSignal;
}

/**
 * Get Uber ride estimates from airport to city center or vice versa
 */
export async function getUberPrices(
  airportCode: string,
  cityName: string,
  cityCoordinates: [number, number],
  direction: 'from' | 'to',
  options: UberPriceOptions = {}
): Promise<UberItinerary> {
  const apiKey = import.meta.env.VITE_UBER_API_KEY?.trim();
  
  // Check if we have Uber API key
  if (!apiKey) {
    // Return mock data for development
    return getMockUberPrices(airportCode, cityName, direction);
  }

  const airportCoords = getAirportCoordinates(airportCode);
  if (!airportCoords) {
    return {
      fromAirport: [],
      toAirport: [],
      error: `Could not find coordinates for airport ${airportCode}`
    };
  }

  try {
    // Determine start and end coordinates based on direction
    const startCoords = direction === 'from' ? airportCoords : cityCoordinates;
    const endCoords = direction === 'from' ? cityCoordinates : airportCoords;

    // Use Uber API to get price estimates
    // Note: Uber API requires OAuth authentication, so we'll use a proxy or mock for now
    // In production, you'd need to implement proper OAuth flow
    
    // For now, return mock data
    return getMockUberPrices(airportCode, cityName, direction);
  } catch (error) {
    console.error('Error fetching Uber prices:', error);
    return {
      fromAirport: [],
      toAirport: [],
      error: error instanceof Error ? error.message : 'Failed to fetch Uber prices'
    };
  }
}

/**
 * Mock Uber prices for development/demo purposes
 */
function getMockUberPrices(
  airportCode: string,
  cityName: string,
  direction: 'from' | 'to'
): UberItinerary {
  const baseRides: UberRide[] = [
    {
      rideType: 'UberX',
      displayName: 'UberX',
      duration: 1800, // 30 minutes
      distance: 25000, // 25 km
      priceUSD: 25.50,
      estimate: '25-30 min'
    },
    {
      rideType: 'UberXL',
      displayName: 'UberXL',
      duration: 1800,
      distance: 25000,
      priceUSD: 35.00,
      estimate: '25-30 min'
    },
    {
      rideType: 'UberComfort',
      displayName: 'Uber Comfort',
      duration: 1800,
      distance: 25000,
      priceUSD: 32.00,
      estimate: '25-30 min'
    },
    {
      rideType: 'UberBlack',
      displayName: 'Uber Black',
      duration: 1800,
      distance: 25000,
      priceUSD: 65.00,
      estimate: '25-30 min'
    }
  ];

  // Adjust prices slightly based on airport/city combination
  const adjustedRides = baseRides.map(ride => {
    const multiplier = getPriceMultiplier(airportCode, cityName);
    return {
      ...ride,
      priceUSD: ride.priceUSD ? ride.priceUSD * multiplier : undefined,
      duration: Math.round(ride.duration * (0.8 + Math.random() * 0.4)), // Add some variation
      distance: Math.round(ride.distance * (0.9 + Math.random() * 0.2))
    };
  });

  if (direction === 'from') {
    return {
      fromAirport: adjustedRides,
      toAirport: []
    };
  } else {
    return {
      fromAirport: [],
      toAirport: adjustedRides
    };
  }
}

/**
 * Get price multiplier based on airport/city combination
 */
function getPriceMultiplier(airportCode: string, cityName: string): number {
  // Major airports tend to be further from city centers
  const majorAirports = ['JFK', 'LAX', 'LHR', 'CDG', 'DXB'];
  if (majorAirports.includes(airportCode.toUpperCase())) {
    return 1.3;
  }
  
  // Asian cities tend to have cheaper rides
  const asianCities = ['Singapore', 'Ho Chi Minh City', 'Hanoi', 'Kuala Lumpur', 'Bangkok', 'Hong Kong', 'Shanghai', 'Mumbai'];
  if (asianCities.includes(cityName)) {
    return 0.7;
  }
  
  return 1.0;
}

