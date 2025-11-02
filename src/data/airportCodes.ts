// Comprehensive airport code to city name mapping
// This covers major airports worldwide and can be extended as needed

export const airportCodeToCity: Record<string, string> = {
  // Asia-Pacific
  'SGN': 'Ho Chi Minh City',
  'HAN': 'Hanoi',
  'KUL': 'Kuala Lumpur',
  'BKK': 'Bangkok',
  'SIN': 'Singapore',
  'HKG': 'Hong Kong',
  'PVG': 'Shanghai',
  'SHA': 'Shanghai',
  'PEK': 'Beijing',
  'CAN': 'Guangzhou',
  'CTU': 'Chengdu',
  'SZX': 'Shenzhen',
  'NRT': 'Tokyo',
  'HND': 'Tokyo',
  'ICN': 'Seoul',
  'GMP': 'Seoul',
  'BOM': 'Mumbai',
  'DEL': 'Delhi',
  'BLR': 'Bangalore',
  'MAA': 'Chennai',
  'CCU': 'Kolkata',
  'SYD': 'Sydney',
  'MEL': 'Melbourne',
  'BNE': 'Brisbane',
  'PER': 'Perth',
  'ADL': 'Adelaide',
  'AKL': 'Auckland',
  'WLG': 'Wellington',
  'CGK': 'Jakarta',
  'DPS': 'Denpasar',
  'MNL': 'Manila',
  'CEB': 'Cebu',
  'BWN': 'Bandar Seri Begawan',
  'PNH': 'Phnom Penh',
  'RGN': 'Yangon',
  'KTM': 'Kathmandu',
  'DAC': 'Dhaka',
  'CMB': 'Colombo',
  'KHI': 'Karachi',
  'ISB': 'Islamabad',
  'LHE': 'Lahore',
  
  // Middle East
  'DXB': 'Dubai',
  'AUH': 'Abu Dhabi',
  'DOH': 'Doha',
  'BAH': 'Manama',
  'KWI': 'Kuwait City',
  'JED': 'Jeddah',
  'RUH': 'Riyadh',
  'DMM': 'Dammam',
  'TLV': 'Tel Aviv',
  'AMM': 'Amman',
  'BEY': 'Beirut',
  'DAM': 'Damascus',
  'BGW': 'Baghdad',
  'THR': 'Tehran',
  'IKA': 'Tehran',
  
  // Europe
  'LHR': 'London',
  'LGW': 'London',
  'STN': 'London',
  'LTN': 'London',
  'CDG': 'Paris',
  'ORY': 'Paris',
  'FRA': 'Frankfurt',
  'MUC': 'Munich',
  'AMS': 'Amsterdam',
  'FCO': 'Rome',
  'MXP': 'Milan',
  'BCN': 'Barcelona',
  'MAD': 'Madrid',
  'LIS': 'Lisbon',
  'OPO': 'Porto',
  'ATH': 'Athens',
  'VIE': 'Vienna',
  'ZRH': 'Zurich',
  'GVA': 'Geneva',
  'BRU': 'Brussels',
  'DUB': 'Dublin',
  'MAN': 'Manchester',
  'EDI': 'Edinburgh',
  'BHX': 'Birmingham',
  'CPH': 'Copenhagen',
  'OSL': 'Oslo',
  'ARN': 'Stockholm',
  'HEL': 'Helsinki',
  'DME': 'Moscow',
  'SVO': 'Moscow',
  'LED': 'Saint Petersburg',
  'IST': 'Istanbul',
  'SAW': 'Istanbul',
  'WAW': 'Warsaw',
  'PRG': 'Prague',
  'BUD': 'Budapest',
  'BEG': 'Belgrade',
  'SOF': 'Sofia',
  'BUH': 'Bucharest',
  'OTP': 'Bucharest',
  
  // North America
  'JFK': 'New York',
  'LGA': 'New York',
  'EWR': 'New York',
  'LAX': 'Los Angeles',
  'SFO': 'San Francisco',
  'SEA': 'Seattle',
  'LAS': 'Las Vegas',
  'PHX': 'Phoenix',
  'DEN': 'Denver',
  'ORD': 'Chicago',
  'MIA': 'Miami',
  'ATL': 'Atlanta',
  'DFW': 'Dallas',
  'IAH': 'Houston',
  'BOS': 'Boston',
  'IAD': 'Washington',
  'DCA': 'Washington',
  'YYZ': 'Toronto',
  'YVR': 'Vancouver',
  'YUL': 'Montreal',
  'MEX': 'Mexico City',
  'CUN': 'Cancún',
  'PTY': 'Panama City',
  
  // South America
  'GRU': 'São Paulo',
  'GIG': 'Rio de Janeiro',
  'EZE': 'Buenos Aires',
  'SCL': 'Santiago',
  'LIM': 'Lima',
  'BOG': 'Bogotá',
  'UIO': 'Quito',
  'CCS': 'Caracas',
  
  // Africa
  'JNB': 'Johannesburg',
  'CPT': 'Cape Town',
  'CAI': 'Cairo',
  'LAG': 'Lagos',
  'NBO': 'Nairobi',
  'ADD': 'Addis Ababa',
  'CMN': 'Casablanca',
  'TUN': 'Tunis',
  'ALG': 'Algiers',
};

// Helper function to get city name from airport code
export function getCityNameFromAirportCode(code: string): string {
  if (!code) return code;
  
  // Normalize the code (uppercase, trim)
  const normalizedCode = code.trim().toUpperCase();
  
  // Look up in the mapping
  const cityName = airportCodeToCity[normalizedCode];
  
  if (cityName) {
    return cityName;
  }
  
  // Fallback: return the code as-is if not found
  // This ensures we don't break if an unknown airport code is encountered
  return normalizedCode;
}

