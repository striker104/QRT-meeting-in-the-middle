import type { EventSummary } from '../types';

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL =
  import.meta.env.VITE_OPENROUTER_MODEL?.trim() || 'openai/gpt-4o-mini';

const SYSTEM_PROMPT =
  'You are the senior travel strategy executive at QRT. Convert optimisation output into a concise, executive-ready travel plan. Balance fairness across offices and keep carbon exposure front of mind. Ground every justification in the provided metrics. Always respond in Markdown with short section headings and bullet lists where they add clarity. Keep a confident, decisive tone.';

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

export interface MeetingPlanOptions {
  model?: string;
  temperature?: number;
  signal?: AbortSignal;
}

export interface MeetingPlanResult {
  content: string;
  response: OpenRouterResponse;
  model: string;
}

export interface MeetingPlanStreamOptions extends MeetingPlanOptions {
  onToken?: (token: string) => void;
}

function formatIsoUtc(isoDate: string) {
  const date = new Date(isoDate);
  return Number.isNaN(date.getTime()) ? isoDate : date.toUTCString();
}

function formatHours(hours: number) {
  return Number.isFinite(hours) ? `${hours.toFixed(1)} h` : 'n/a';
}

function buildTravelTimeLines(travelTimes: Record<string, number>) {
  return Object.entries(travelTimes)
    .sort(([, a], [, b]) => b - a)
    .map(([city, hours]) => `- ${city}: ${formatHours(hours)}`)
    .join('\n');
}

function buildUserPrompt(summary: EventSummary) {
  const travelLines = buildTravelTimeLines(summary.attendee_travel_hours);

  return [
    'Justify the choice of the event hub that was found with the optimisation algorithm.',
    '',
    `Event hub under review: ${summary.event_location}`,
    `Primary meeting window (UTC): ${formatIsoUtc(summary.event_dates.start)} → ${formatIsoUtc(
      summary.event_dates.end
    )}`,
    `Arrival / departure buffer (UTC): ${formatIsoUtc(summary.event_span.start)} → ${formatIsoUtc(
      summary.event_span.end
    )}`,
    '',
    'Aggregate metrics:',
    `- Total emissions: ${summary.total_co2.toLocaleString()} tCO₂e`,
    `- Average travel time: ${formatHours(summary.average_travel_hours)}`,
    `- Median travel time: ${formatHours(summary.median_travel_hours)}`,
    `- Longest journey: ${formatHours(summary.max_travel_hours)}`,
    `- Shortest journey: ${formatHours(summary.min_travel_hours)}`,
    '',
    'Travel time by origin (hours):',
    travelLines,
    '',
    'Draft a brief to display on the interface s UI. Structure it as a easily readable paragraph and really rationally jutify the choice based on the metrics provided. Emphasise fairness and carbon exposure in your reasoning.',
  ].join('\n');
}

function resolveReferer() {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }

  return 'https://qrt.local';
}

export function buildMeetingPlanPrompt(summary: EventSummary): ChatMessage[] {
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: buildUserPrompt(summary) }
  ];
}

function resolveModelOverride(model?: string | null) {
  return model?.trim() || DEFAULT_MODEL;
}

export async function requestMeetingPlan(
  summary: EventSummary,
  options: MeetingPlanOptions = {}
): Promise<MeetingPlanResult> {
  const apiKey = import.meta.env.VITE_OPENROUTER_API_KEY?.trim();

  if (!apiKey) {
    throw new Error('Missing OpenRouter API key. Set VITE_OPENROUTER_API_KEY in your .env file.');
  }

  const model = resolveModelOverride(options.model);
  const messages = buildMeetingPlanPrompt(summary);

  const response = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': resolveReferer(),
      'X-Title': 'QRT Meeting Planner'
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: options.temperature ?? 0.4
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

  return {
    content,
    response: data,
    model
  };
}

export async function streamMeetingPlan(
  summary: EventSummary,
  options: MeetingPlanStreamOptions = {}
): Promise<MeetingPlanResult> {
  const apiKey = import.meta.env.VITE_OPENROUTER_API_KEY?.trim();

  if (!apiKey) {
    throw new Error('Missing OpenRouter API key. Set VITE_OPENROUTER_API_KEY in your .env file.');
  }

  const model = resolveModelOverride(options.model);
  const messages = buildMeetingPlanPrompt(summary);

  const response = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': resolveReferer(),
      'X-Title': 'QRT Meeting Planner'
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: options.temperature ?? 0.4,
      stream: true
    }),
    signal: options.signal
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenRouter request failed: ${response.status} ${response.statusText} – ${errorText}`);
  }

  if (!response.body) {
    throw new Error('Streaming not supported: response body is empty.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let done = false;
  let accumulated = '';
  let resolvedModel = model;

  const processBuffer = () => {
    let eventBoundary = buffer.indexOf('\n\n');

    while (eventBoundary !== -1) {
      const rawEvent = buffer.slice(0, eventBoundary);
      buffer = buffer.slice(eventBoundary + 2);

      const dataLines = rawEvent
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.startsWith('data:'));

      for (const line of dataLines) {
        const payload = line.slice(5).trim();

        if (!payload) {
          continue;
        }

        if (payload === '[DONE]') {
          done = true;
          return;
        }

        try {
          const parsed = JSON.parse(payload);
          if (parsed.model && typeof parsed.model === 'string') {
            resolvedModel = parsed.model;
          }

          const delta: string =
            parsed.choices?.[0]?.delta?.content ??
            parsed.choices?.[0]?.message?.content ??
            '';

          if (delta) {
            accumulated += delta;
            for (const char of delta) {
              options.onToken?.(char);
            }
          }
        } catch (error) {
          console.warn('Failed to parse OpenRouter stream chunk', error);
        }
      }

      eventBoundary = buffer.indexOf('\n\n');
    }
  };

  while (!done) {
    const { value, done: streamDone } = await reader.read();
    if (streamDone) {
      buffer += decoder.decode();
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    processBuffer();
  }

  if (buffer.trim().length > 0) {
    processBuffer();
  }

  return {
    content: accumulated,
    response: {
      choices: [
        {
          message: {
            role: 'assistant',
            content: accumulated
          }
        }
      ]
    },
    model: resolvedModel
  };
}
