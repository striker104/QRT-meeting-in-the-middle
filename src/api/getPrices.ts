import type { FlightItineraryEntry, AccommodationPrice } from '../types';

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

export interface AccommodationPriceOptions {
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

  // Log the raw flight data being sent
  console.log('🟢 RAW FLIGHT DATA RECEIVED:', JSON.stringify(flights, null, 2));
  
  const messages = buildPriceRequestMessages(flights);
  
  // Log the messages being sent to Perplexity
  console.log('🟢 MESSAGES SENT TO PERPLEXITY:', JSON.stringify(messages, null, 2));
  
  const requestBody = {
    model: PERPLEXITY_MODEL,
    messages,
    temperature: 0.1
  };
  
  // Log the full request body
  console.log('🟢 REQUEST BODY TO OPENROUTER:', JSON.stringify(requestBody, null, 2));

  const response = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': resolveReferer(),
      'X-Title': 'QRT Flight Price Lookup'
    },
    body: JSON.stringify(requestBody),
    signal: options.signal
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenRouter request failed: ${response.status} ${response.statusText} – ${errorText}`);
  }

  const data = (await response.json()) as OpenRouterResponse;
  
  // Log the exact raw response from Perplexity/OpenRouter
  console.log('🔵 RAW PERPLEXITY RESPONSE:', JSON.stringify(data, null, 2));
  
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error('OpenRouter response did not contain a completion message.');
  }
  
  // Log the exact content string from Perplexity
  console.log('🔵 PERPLEXITY CONTENT STRING:', content);

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
    
    // Log the parsed content
    console.log('🔵 PARSED CONTENT:', JSON.stringify(parsedContent, null, 2));
  } catch (error) {
    console.error('❌ Failed to parse price response. Raw content:', content);
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
  
  // Log the final price array extracted from Perplexity response
  console.log('🔵 EXTRACTED PRICE ARRAY:', JSON.stringify(priceArray, null, 2));

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

function buildAccommodationPricePrompt(
  city: string,
  numberOfPeople: number,
  checkIn: string,
  checkOut: string,
  hotelStars: number
): string {
  const checkInDate = new Date(checkIn);
  const checkOutDate = new Date(checkOut);
  const checkInStr = checkInDate.toLocaleDateString('en-US', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
  const checkOutStr = checkOutDate.toLocaleDateString('en-US', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
  
  const nights = Math.ceil((checkOutDate.getTime() - checkInDate.getTime()) / (1000 * 60 * 60 * 24));

  return `I need you to find the current price for business-suitable hotel accommodation using real-time hotel price data.

IMPORTANT: This is for a BUSINESS MEETING. You must find hotels that are appropriate for business travel, corporate events, and professional meetings. Prioritize hotels that:
- Are located in business districts or convenient for corporate travelers
- Have meeting facilities, business centers, or conference capabilities
- Offer professional amenities (WiFi, workspace, conference rooms)
- Are suitable for hosting business meetings and corporate events
- Are commonly used by business travelers and corporate clients

Accommodation details:
- City: ${city}
- Number of people: ${numberOfPeople}
- Check-in: ${checkInStr}
- Check-out: ${checkOutStr}
- Number of nights: ${nights}
- Hotel star rating: ${hotelStars} stars
- Purpose: Business meeting/corporate event

Return ONLY a valid JSON object (no markdown, no explanation, just the JSON object).

Required JSON format:
{
  "city": "${city}",
  "numberOfPeople": ${numberOfPeople},
  "checkIn": "${checkIn}",
  "checkOut": "${checkOut}",
  "hotelStars": ${hotelStars},
  "priceUSD": 450.00,
  "pricePerNightUSD": 150.00,
  "numberOfNights": ${nights},
  "priceCurrency": "USD",
  "hotelName": "Grand Business Hotel Downtown",
  "bookingLink": "https://example.com/book/hotel-id"
}

CRITICAL: You MUST provide:
1. A specific hotel name (not generic, use the actual hotel name)
2. A direct booking link or hotel website URL where users can book/view the hotel (prefer booking.com, hotels.com, expedia.com, or the hotel's official website)

If a price cannot be found, include:
- "priceUSD": null
- "error": "Brief explanation"

Search for actual current prices for SPECIFIC BUSINESS-SUITABLE hotels in ${city} with ${hotelStars} star rating that are appropriate for corporate meetings and business travel. The hotel should accommodate ${numberOfPeople} ${numberOfPeople === 1 ? 'person' : 'people'} for ${nights} ${nights === 1 ? 'night' : 'nights'} from ${checkInStr} to ${checkOutStr}. 

IMPORTANT: Provide a REAL hotel name and a WORKING booking link where users can directly book or view the hotel. The link should be a direct URL to the hotel's booking page or a major booking platform (booking.com, hotels.com, expedia.com, agoda.com, etc.) with the specific hotel and dates.

Focus on hotels that business travelers would choose for corporate events, meetings, and professional gatherings. Return the total price for the entire stay in USD.

Return ONLY the JSON object, nothing else.`;
}

function buildAccommodationPriceRequestMessages(
  city: string,
  numberOfPeople: number,
  checkIn: string,
  checkOut: string,
  hotelStars: number
): ChatMessage[] {
  const systemPrompt = `You are a hotel accommodation price lookup assistant specializing in BUSINESS TRAVEL and CORPORATE MEETINGS. You search for current hotel prices using real-time web data.

CRITICAL: You must respond with ONLY a valid JSON object. No markdown formatting, no code blocks, no explanations - just the raw JSON object.

When searching for hotels, ALWAYS prioritize properties that are suitable for business travel:
- Hotels in business districts or central business areas
- Properties with meeting facilities, conference rooms, or business centers
- Hotels commonly used by corporate travelers
- Accommodations appropriate for hosting business meetings and professional events
- Hotels with professional amenities (reliable WiFi, workspace areas, business services)

MANDATORY REQUIREMENTS:
- You MUST provide a SPECIFIC hotel name (the actual name of the hotel, not generic descriptions)
- You MUST provide a WORKING booking link (direct URL to booking.com, hotels.com, expedia.com, agoda.com, or the hotel's official booking page)
- The booking link should be a real, clickable URL where users can book the specific hotel for the given dates

Search for actual current prices for SPECIFIC BUSINESS-SUITABLE hotels based on the provided criteria. If exact matches aren't found, estimate based on similar business hotels, locations, and dates.

Always return prices in USD when possible. Return the total price for the entire stay, and also provide the price per night.`;

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: buildAccommodationPricePrompt(city, numberOfPeople, checkIn, checkOut, hotelStars) }
  ];
}

export async function getAccommodationPrice(
  city: string,
  numberOfPeople: number,
  checkIn: string,
  checkOut: string,
  hotelStars: number,
  options: AccommodationPriceOptions = {}
): Promise<AccommodationPrice> {
  const apiKey = import.meta.env.VITE_OPENROUTER_API_KEY?.trim();

  if (!apiKey) {
    throw new Error('Missing OpenRouter API key. Set VITE_OPENROUTER_API_KEY in your .env file.');
  }

  const messages = buildAccommodationPriceRequestMessages(city, numberOfPeople, checkIn, checkOut, hotelStars);
  
  console.log('🏨 ACCOMMODATION REQUEST:', { city, numberOfPeople, checkIn, checkOut, hotelStars });
  console.log('🏨 MESSAGES SENT TO PERPLEXITY:', JSON.stringify(messages, null, 2));
  
  const requestBody = {
    model: PERPLEXITY_MODEL,
    messages,
    temperature: 0.1
  };
  
  console.log('🏨 REQUEST BODY TO OPENROUTER:', JSON.stringify(requestBody, null, 2));

  const response = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': resolveReferer(),
      'X-Title': 'QRT Accommodation Price Lookup'
    },
    body: JSON.stringify(requestBody),
    signal: options.signal
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenRouter request failed: ${response.status} ${response.statusText} – ${errorText}`);
  }

  const data = (await response.json()) as OpenRouterResponse;
  
  console.log('🏨 RAW PERPLEXITY RESPONSE:', JSON.stringify(data, null, 2));
  
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error('OpenRouter response did not contain a completion message.');
  }
  
  console.log('🏨 PERPLEXITY CONTENT STRING:', content);

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
    const jsonMatch = cleanedContent.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      cleanedContent = jsonMatch[0];
    }
    
    parsedContent = JSON.parse(cleanedContent);
    
    console.log('🏨 PARSED CONTENT:', JSON.stringify(parsedContent, null, 2));
  } catch (error) {
    console.error('❌ Failed to parse accommodation price response. Raw content:', content);
    throw new Error(`Failed to parse accommodation price response as JSON: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }

  const checkInDate = new Date(checkIn);
  const checkOutDate = new Date(checkOut);
  const numberOfNights = Math.ceil((checkOutDate.getTime() - checkInDate.getTime()) / (1000 * 60 * 60 * 24));

  const accommodationPrice: AccommodationPrice = {
    city,
    numberOfPeople,
    checkIn,
    checkOut,
    hotelStars,
    numberOfNights
  };

  // Extract price - try multiple possible field names
  const priceUSD = parsedContent.priceUSD ?? parsedContent.price_usd ?? parsedContent.price ?? parsedContent.totalPrice ?? null;
  const pricePerNightUSD = parsedContent.pricePerNightUSD ?? parsedContent.pricePerNight ?? parsedContent.price_per_night ?? parsedContent.nightlyRate ?? null;
  const currency = parsedContent.priceCurrency ?? parsedContent.currency ?? 'USD';
  
  // Extract hotel name - try multiple possible field names
  const hotelName = parsedContent.hotelName ?? parsedContent.hotel_name ?? parsedContent.name ?? parsedContent.hotel ?? null;
  
  // Extract booking link - try multiple possible field names
  const bookingLink = parsedContent.bookingLink ?? parsedContent.booking_link ?? parsedContent.link ?? parsedContent.url ?? parsedContent.website ?? parsedContent.bookingUrl ?? parsedContent.booking_url ?? null;

  if (priceUSD !== null && typeof priceUSD === 'number') {
    accommodationPrice.priceUSD = priceUSD;
    accommodationPrice.priceCurrency = currency;
    if (pricePerNightUSD !== null && typeof pricePerNightUSD === 'number') {
      accommodationPrice.pricePerNightUSD = pricePerNightUSD;
    }
    if (hotelName && typeof hotelName === 'string') {
      accommodationPrice.hotelName = hotelName;
    }
    if (bookingLink && typeof bookingLink === 'string') {
      accommodationPrice.bookingLink = bookingLink;
    }
  } else {
    accommodationPrice.error = parsedContent.error || 'Price not available';
  }

  return accommodationPrice;
}

