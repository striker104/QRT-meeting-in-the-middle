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

const UBER_SANDBOX_API_URL = 'https://sandbox-api.uber.com';

interface UberApiPriceEstimate {
  localized_display_name: string;
  distance: number;
  display_name: string;
  product_id: string;
  high_estimate: number;
  low_estimate: number;
  duration: number;
  estimate: string;
  currency_code: string;
}

interface UberApiPriceResponse {
  prices: UberApiPriceEstimate[];
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
  const serverToken = import.meta.env.VITE_UBER_SERVER_TOKEN?.trim();
  
  // Check if we have Uber server token
  if (!serverToken) {
    console.warn('Uber server token not found. Using mock data. Set VITE_UBER_SERVER_TOKEN in your .env file.');
    // Return mock data for development
    return getMockUberPrices(airportCode, cityName, direction);
  }

  const airportCoords = getAirportCoordinates(airportCode);
  if (!airportCoords) {
    console.warn(`Could not find coordinates for airport ${airportCode}, using mock data`);
    return getMockUberPrices(airportCode, cityName, direction);
  }

  try {
    // Determine start and end coordinates based on direction
    const startLat = direction === 'from' ? airportCoords[1] : cityCoordinates[1];
    const startLng = direction === 'from' ? airportCoords[0] : cityCoordinates[0];
    const endLat = direction === 'from' ? cityCoordinates[1] : airportCoords[1];
    const endLng = direction === 'from' ? cityCoordinates[0] : airportCoords[0];

    // Build the API URL with query parameters
    const url = new URL(`${UBER_SANDBOX_API_URL}/v1/estimates/price`);
    url.searchParams.set('start_latitude', startLat.toString());
    url.searchParams.set('start_longitude', startLng.toString());
    url.searchParams.set('end_latitude', endLat.toString());
    url.searchParams.set('end_longitude', endLng.toString());

    console.log(`Fetching Uber prices from Uber Sandbox API: ${url.toString()}`);

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${serverToken}`,
        'Content-Type': 'application/json',
        'Accept-Language': 'en_US'
      },
      signal: options.signal
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Uber API error: ${response.status} ${response.statusText} - ${errorText}`);
      // Fall back to mock data if API fails
      return getMockUberPrices(airportCode, cityName, direction);
    }

    const data = (await response.json()) as UberApiPriceResponse;
    
    if (!data.prices || data.prices.length === 0) {
      console.warn('No price estimates returned from Uber API, using mock data');
      return getMockUberPrices(airportCode, cityName, direction);
    }

    // Convert Uber API response to our format
    const rides: UberRide[] = data.prices.map((price) => {
      // Calculate average price if we have both high and low estimates
      const avgPrice = price.high_estimate && price.low_estimate 
        ? (price.high_estimate + price.low_estimate) / 2 
        : price.high_estimate || price.low_estimate;

      // Convert price to USD if needed (assuming prices are already in USD for sandbox)
      let priceUSD = avgPrice;
      if (price.currency_code && price.currency_code !== 'USD') {
        // In a real app, you'd want to convert currencies here
        console.warn(`Price is in ${price.currency_code}, not converting to USD`);
      }

      return {
        rideType: price.product_id,
        displayName: price.display_name || price.localized_display_name,
        duration: price.duration || 0,
        distance: price.distance ? Math.round(price.distance * 1000) : 0, // Convert km to meters
        priceUSD: priceUSD,
        priceRange: price.high_estimate && price.low_estimate ? {
          low: price.low_estimate,
          high: price.high_estimate
        } : undefined,
        currency: price.currency_code || 'USD',
        estimate: price.estimate
      };
    });

    // Filter to only the cheapest option
    const cheapestRide = rides
      .filter(ride => ride.priceUSD !== undefined && ride.priceUSD > 0)
      .sort((a, b) => (a.priceUSD || Infinity) - (b.priceUSD || Infinity))[0];

    if (!cheapestRide) {
      console.warn('No valid rides found after filtering, using mock data');
      return getMockUberPrices(airportCode, cityName, direction);
    }

    console.log(`Got Uber price estimate: ${cheapestRide.displayName} - $${cheapestRide.priceUSD}`);

    if (direction === 'from') {
      return {
        fromAirport: [cheapestRide],
        toAirport: []
      };
    } else {
      return {
        fromAirport: [],
        toAirport: [cheapestRide]
      };
    }
  } catch (error) {
    console.error('Error fetching Uber prices:', error);
    // Fall back to mock data on error
    if ((error as Error).name !== 'AbortError') {
      return getMockUberPrices(airportCode, cityName, direction);
    }
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

  // Filter to only the cheapest option
  const cheapestRide = adjustedRides
    .filter(ride => ride.priceUSD !== undefined)
    .sort((a, b) => (a.priceUSD || Infinity) - (b.priceUSD || Infinity))[0];

  if (!cheapestRide) {
    return {
      fromAirport: [],
      toAirport: [],
      error: 'No rides available'
    };
  }

  if (direction === 'from') {
    return {
      fromAirport: [cheapestRide],
      toAirport: []
    };
  } else {
    return {
      fromAirport: [],
      toAirport: [cheapestRide]
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

