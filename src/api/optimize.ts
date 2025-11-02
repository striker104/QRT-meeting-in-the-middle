import type { AttendeeScenario, OptimizationResult } from '../types';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5001';

export interface OptimizeRequest {
  attendees: Record<string, number>;
  availability_window: {
    start: string;
    end: string;
  };
  event_duration: {
    days: number;
    hours: number;
  };
  weight_co2?: number;
  weight_avg_vs_std?: number;
}

export async function optimizeScenario(
  scenario: AttendeeScenario,
  options: {
    weight_co2?: number;
    weight_avg_vs_std?: number;
    signal?: AbortSignal;
  } = {}
): Promise<OptimizationResult[]> {
  const requestBody: OptimizeRequest = {
    attendees: scenario.attendees,
    availability_window: scenario.availability_window,
    event_duration: scenario.event_duration,
    weight_co2: options.weight_co2 ?? 0.5,
    weight_avg_vs_std: options.weight_avg_vs_std ?? 1.0,
  };

  const response = await fetch(`${API_BASE_URL}/api/optimize`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
    signal: options.signal,
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
  }

  const results = (await response.json()) as OptimizationResult[];

  // Validate that we got results
  if (!Array.isArray(results) || results.length === 0) {
    throw new Error('No optimization results returned');
  }

  return results;
}

