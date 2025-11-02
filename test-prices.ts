// Standalone test script for getFlightPrices
// Run with: npx tsx test-prices.ts
// Or: node --loader ts-node/esm test-prices.ts

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const PERPLEXITY_MODEL = 'perplexity/sonar-pro';

type FlightItineraryEntry = [
  string, // origin
  string, // destination
  string, // carrier
  number, // flightNumber
  string, // departureTime
  number, // passengers
  'out' | 'in', // direction
  'Direct' | '1-Stop' // stopType
];

interface FlightPrice {
  origin: string;
  destination: string;
  carrier: string;
  flightNumber: number;
  departureTime: string;
  passengers: number;
  direction: 'out' | 'in';
  stopType: 'Direct' | '1-Stop';
  priceUSD?: number;
  priceCurrency?: string;
  error?: string;
}

function formatFlightForPrompt(flight: FlightItineraryEntry, index: number): string {
  const [origin, destination, carrier, flightNumber, departureTime, passengers, direction, stopType] = flight;
  const date = new Date(departureTime);
  const dateStr = date.toLocaleDateString('en-US', { 
    weekday: 'short', 
    year: 'numeric', 
    month: 'short', 
    day: 'numeric' 
  });
  const timeStr = date.toLocaleTimeString('en-US', { 
    hour: '2-digit', 
    minute: '2-digit',
    timeZoneName: 'short'
  });

  return `Flight ${index + 1}:
- Route: ${origin} → ${destination}
- Carrier: ${carrier} ${flightNumber}
- Departure: ${dateStr} at ${timeStr}
- Passengers: ${passengers}
- Direction: ${direction === 'out' ? 'Outbound' : 'Return'}
- Stops: ${stopType}`;
}

function buildFlightPricePrompt(flights: FlightItineraryEntry[]): string {
  const flightDetails = flights.map((flight, index) => formatFlightForPrompt(flight, index)).join('\n\n');

  return `I need you to find the current price for each of these flights using real-time flight price data.

For each flight, provide the price in USD. Return ONLY a valid JSON array (no markdown, no explanation, just the JSON array).

Required JSON array format:
[
  {
    "flightIndex": 0,
    "origin": "BOM",
    "destination": "SGN",
    "carrier": "TG",
    "flightNumber": 352,
    "priceUSD": 850.00,
    "priceCurrency": "USD"
  },
  {
    "flightIndex": 1,
    "origin": "SGN",
    "destination": "BOM",
    "carrier": "VN",
    "flightNumber": 607,
    "priceUSD": 920.00,
    "priceCurrency": "USD"
  }
]

If a price cannot be found for a specific flight, include it in the array with:
- "priceUSD": null
- "error": "Brief explanation"

Here are the flights to price:

${flightDetails}

Return ONLY the JSON array, nothing else.`;
}

async function getFlightPrices(flights: FlightItineraryEntry[]): Promise<FlightPrice[]> {
  const apiKey = process.env.VITE_OPENROUTER_API_KEY?.trim() || process.env.OPENROUTER_API_KEY?.trim();

  if (!apiKey) {
    throw new Error('Missing OpenRouter API key. Set VITE_OPENROUTER_API_KEY or OPENROUTER_API_KEY environment variable.');
  }

  if (flights.length === 0) {
    return [];
  }

  const messages = [
    {
      role: 'system' as const,
      content: `You are a flight price lookup assistant. You search for current flight prices using real-time web data.
CRITICAL: You must respond with ONLY a valid JSON array. No markdown formatting, no code blocks, no explanations - just the raw JSON array.
Search for actual current prices for these specific flights. If exact matches aren't found, estimate based on similar routes, carriers, and dates.
Always return prices in USD when possible.`
    },
    {
      role: 'user' as const,
      content: buildFlightPricePrompt(flights)
    }
  ];

  const response = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://qrt.local',
      'X-Title': 'QRT Flight Price Lookup'
    },
    body: JSON.stringify({
      model: PERPLEXITY_MODEL,
      messages,
      temperature: 0.1
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenRouter request failed: ${response.status} ${response.statusText} – ${errorText}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error('OpenRouter response did not contain a completion message.');
  }

  // Parse the response
  let parsedContent: any;
  try {
    let cleanedContent = content.trim();
    
    const codeBlockMatch = cleanedContent.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (codeBlockMatch) {
      cleanedContent = codeBlockMatch[1].trim();
    }
    
    const jsonMatch = cleanedContent.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      const objectMatch = cleanedContent.match(/\{[\s\S]*\}/);
      if (objectMatch) {
        cleanedContent = objectMatch[0];
      }
    } else {
      cleanedContent = jsonMatch[0];
    }
    
    parsedContent = JSON.parse(cleanedContent);
  } catch (error) {
    console.error('Failed to parse price response:', content);
    throw new Error(`Failed to parse flight price response as JSON: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }

  // Handle different response formats
  let priceArray: any[] = [];
  if (Array.isArray(parsedContent)) {
    priceArray = parsedContent;
  } else if (parsedContent.flights && Array.isArray(parsedContent.flights)) {
    priceArray = parsedContent.flights;
  } else if (parsedContent.prices && Array.isArray(parsedContent.prices)) {
    priceArray = parsedContent.prices;
  } else if (parsedContent.data && Array.isArray(parsedContent.data)) {
    priceArray = parsedContent.data;
  } else if (typeof parsedContent === 'object' && !Array.isArray(parsedContent)) {
    if (parsedContent.origin && parsedContent.destination) {
      priceArray = [parsedContent];
    } else {
      const keys = Object.keys(parsedContent);
      const arrayKey = keys.find(key => Array.isArray(parsedContent[key]));
      if (arrayKey) {
        priceArray = parsedContent[arrayKey];
      }
    }
  }

  // Map the response to FlightPrice format
  return flights.map((flight, index) => {
    const [origin, destination, carrier, flightNumber, departureTime, passengers, direction, stopType] = flight;
    
    const priceData = priceArray.find(
      (p: any) =>
        p.flightIndex === index ||
        (p.origin === origin && p.destination === destination && p.flightNumber === flightNumber) ||
        (p.origin === origin && p.destination === destination && p.carrier === carrier)
    );

    const flightPrice: FlightPrice = {
      origin,
      destination,
      carrier,
      flightNumber,
      departureTime,
      passengers,
      direction,
      stopType
    };

    if (priceData) {
      const priceUSD = priceData.priceUSD ?? priceData.price_usd ?? priceData.price ?? null;
      const currency = priceData.priceCurrency ?? priceData.currency ?? priceData.priceCurrency ?? 'USD';

      if (priceUSD !== null && typeof priceUSD === 'number') {
        flightPrice.priceUSD = priceUSD;
        flightPrice.priceCurrency = currency;
      } else {
        flightPrice.error = priceData.error || 'Price not available';
      }
    } else {
      flightPrice.error = 'Flight price data not found in response';
    }

    return flightPrice;
  });
}

// Test data
const testData = [
  {
    "rank": 1,
    "event_location": "SGN",
    "phase_1_score": 5.88,
    "event_dates": {
      "start": "2025-05-06T01:20:00+00:00",
      "end": "2025-05-06T05:20:00+00:00"
    },
    "event_span": {
      "start": "2025-05-01T10:15:00+00:00",
      "end": "2025-05-06T15:40:00+00:00",
      "total_hours": 125.42
    },
    "total_co2_tonnes": 4.02,
    "average_co2_per_person_tonnes": 0.4,
    "average_travel_hours": 12.03,
    "median_travel_hours": 8.5,
    "max_travel_hours": 22.17,
    "min_travel_hours": 4.25,
    "attendee_travel_hours": {
      "Singapore": 4.25,
      "Hong Kong": 5.33,
      "Mumbai": 18.33,
      "Sydney": 22.17,
      "Shanghai": 8.5
    },
    "itinerary": [
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
  }
];

// Main test function
async function main() {
  const apiKey = process.env.VITE_OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEY;
  
  if (!apiKey) {
    console.error('❌ Error: VITE_OPENROUTER_API_KEY or OPENROUTER_API_KEY not found!');
    console.error('\nSet it as an environment variable:');
    console.error('  export VITE_OPENROUTER_API_KEY="your-key-here"');
    console.error('\nOr run with:');
    console.error('  VITE_OPENROUTER_API_KEY="your-key-here" npx tsx test-prices.ts');
    process.exit(1);
  }

  const firstResult = testData[0];
  console.log('🧪 Testing getFlightPrices\n');
  console.log('═'.repeat(60));
  console.log(`📍 Event Location: ${firstResult.event_location}`);
  console.log(`📊 Rank: ${firstResult.rank}`);
  console.log(`✈️  Number of flights: ${firstResult.itinerary.length}`);
  console.log('═'.repeat(60));
  console.log('\n📋 Flights to price:');
  firstResult.itinerary.forEach((flight, i) => {
    const [origin, destination, carrier, flightNum] = flight;
    console.log(`  ${i + 1}. ${origin} → ${destination} (${carrier} ${flightNum})`);
  });
  
  console.log('\n⏳ Fetching prices from Perplexity Sonar Pro...\n');
  
  try {
    const startTime = Date.now();
    const prices = await getFlightPrices(firstResult.itinerary);
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    
    console.log(`✅ Success! Retrieved prices in ${duration}s\n`);
    console.log('═'.repeat(60));
    console.log('💰 PRICE RESULTS');
    console.log('═'.repeat(60));
    console.log(JSON.stringify(prices, null, 2));
    
    // Calculate totals
    const flightsWithPrices = prices.filter(f => f.priceUSD !== undefined);
    const flightsWithErrors = prices.filter(f => f.error);
    
    const totalPrice = flightsWithPrices.reduce((sum, flight) => {
      return sum + (flight.priceUSD! * flight.passengers);
    }, 0);
    
    const avgPricePerFlight = flightsWithPrices.length > 0 
      ? flightsWithPrices.reduce((sum, f) => sum + f.priceUSD!, 0) / flightsWithPrices.length 
      : 0;
    
    console.log('\n═'.repeat(60));
    console.log('📊 SUMMARY');
    console.log('═'.repeat(60));
    console.log(`✓ Flights with prices: ${flightsWithPrices.length}/${prices.length}`);
    console.log(`✗ Flights with errors: ${flightsWithErrors.length}`);
    console.log(`💰 Total price (all passengers): $${totalPrice.toFixed(2)}`);
    console.log(`📈 Average price per flight: $${avgPricePerFlight.toFixed(2)}`);
    console.log(`👥 Total passengers: ${prices.reduce((sum, f) => sum + f.passengers, 0)}`);
    
    if (flightsWithErrors.length > 0) {
      console.log('\n⚠️  Errors:');
      flightsWithErrors.forEach((flight, i) => {
        console.log(`  ${i + 1}. ${flight.origin} → ${flight.destination}: ${flight.error}`);
      });
    }
    
  } catch (error) {
    console.error('\n❌ Error:', error instanceof Error ? error.message : error);
    if (error instanceof Error && error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
    process.exit(1);
  }
}

main();
