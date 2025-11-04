import logger from '../utils/logger.js';

export interface LLMMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface LLMRequest {
  model: string;
  messages: LLMMessage[];
  stream?: boolean;
  max_tokens?: number;
  temperature?: number;
}

export interface LLMProvider {
  apiUrl: string;
  apiKey: string;
}

export async function invokeLLM(
  provider: LLMProvider, 
  request: LLMRequest,
  signal?: AbortSignal
): Promise<Response> {
  logger.info(
    `Invoking LLM at ${provider.apiUrl} with model ${request.model} with env ${provider.apiKey}`
  );
  const response = await fetch(provider.apiUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${provider.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ...request,
      stream: true,
    }),
    signal,
  });

  if (!response.ok) {
    let errorDetail = `HTTP error! status: ${response.status}`;
    try {
      const errorText = await response.text();
      errorDetail += ` - ${errorText}`;
    } catch (e) {
      // If we can't read the response body, just use the status
    }
    throw new Error(errorDetail);
  }

  return response;
}

export async function invokeLLMWithStream(
  provider: LLMProvider,
  request: LLMRequest,
  onChunk: (chunk: string) => void,
  onCancel?: () => boolean
): Promise<void> {
  const controller = new AbortController();
  
  // Set up a listener to abort when cancellation is requested
  let abortCheckInterval: NodeJS.Timeout | undefined;
  if (onCancel) {
    abortCheckInterval = setInterval(() => {
      if (onCancel()) {
        controller.abort();
      }
    }, 100); // Check every 100ms
  }

  try {
    const response = await invokeLLM(provider, request, controller.signal);

    if (!response.body) {
      throw new Error('Response body is null');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        // Check for cancellation before reading
        if (onCancel && onCancel()) {
          reader.cancel();
          throw new Error('Request cancelled');
        }

        const { done, value } = await reader.read();

        if (done) break;

        // Check for cancellation after reading
        if (onCancel && onCancel()) {
          reader.cancel();
          throw new Error('Request cancelled');
        }

        const chunk = decoder.decode(value, { stream: true });
        onChunk(chunk);
      }
    } finally {
      reader.releaseLock();
    }
  } finally {
    if (abortCheckInterval) {
      clearInterval(abortCheckInterval);
    }
  }
}
