import type { FlightItineraryEntry } from '../types';

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const PERPLEXITY_MODEL = 'perplexity/sonar-pro';

type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

type OpenRouterChoice = {
  message: ChatMessage;
};

type OpenRouterResponse = {
  choices: OpenRouterChoice[];
};

export interface FlightPrice {
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

export interface FlightPriceOptions {
  signal?: AbortSignal;
}

function resolveReferer() {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }

  return 'https://qrt.local';
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

function buildPriceRequestMessages(flights: FlightItineraryEntry[]): ChatMessage[] {
  const systemPrompt = `You are a flight price lookup assistant. You search for current flight prices using real-time web data.
CRITICAL: You must respond with ONLY a valid JSON array. No markdown formatting, no code blocks, no explanations - just the raw JSON array.
Search for actual current prices for these specific flights. If exact matches aren't found, estimate based on similar routes, carriers, and dates.
Always return prices in USD when possible.`;

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: buildFlightPricePrompt(flights) }
  ];
}

export async function getFlightPrices(
  flights: FlightItineraryEntry[],
  options: FlightPriceOptions = {}
): Promise<FlightPrice[]> {
  const apiKey = import.meta.env.VITE_OPENROUTER_API_KEY?.trim();

  if (!apiKey) {
    throw new Error('Missing OpenRouter API key. Set VITE_OPENROUTER_API_KEY in your .env file.');
  }

  if (flights.length === 0) {
    return [];
  }

  const messages = buildPriceRequestMessages(flights);

  const response = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': resolveReferer(),
      'X-Title': 'QRT Flight Price Lookup'
    },
    body: JSON.stringify({
      model: PERPLEXITY_MODEL,
      messages,
      temperature: 0.1 // Lower temperature for more consistent price data
      // Note: Not using response_format as Perplexity may wrap arrays in objects
    }),
    signal: options.signal
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenRouter request failed: ${response.status} ${response.statusText} – ${errorText}`);
  }

  const data = (await response.json()) as OpenRouterResponse;
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error('OpenRouter response did not contain a completion message.');
  }

  // Parse the response - Perplexity may return JSON wrapped in markdown or plain JSON
  let parsedContent: any;
  try {
    // Clean the content - remove markdown code blocks if present
    let cleanedContent = content.trim();
    
    // Remove markdown code blocks
    const codeBlockMatch = cleanedContent.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (codeBlockMatch) {
      cleanedContent = codeBlockMatch[1].trim();
    }
    
    // Remove any leading/trailing text that's not JSON
    const jsonMatch = cleanedContent.match(/\[[\s\S]*\]/); // Try array first
    if (!jsonMatch) {
      const objectMatch = cleanedContent.match(/\{[\s\S]*\}/); // Try object
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
    // Single object response - check if it's a wrapper or actual flight data
    if (parsedContent.origin && parsedContent.destination) {
      priceArray = [parsedContent];
    } else {
      // Try to find array in nested properties
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
    
    // Find matching price data
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
      // Extract price - try multiple possible field names
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

