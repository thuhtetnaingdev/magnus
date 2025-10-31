export interface LLMMessage {
  role: "user" | "assistant" | "system";
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
  request: LLMRequest
): Promise<Response> {
  const response = await fetch(provider.apiUrl, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${provider.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      ...request,
      stream: true
    })
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  return response;
}

export async function invokeLLMWithStream(
  provider: LLMProvider,
  request: LLMRequest,
  onChunk: (chunk: string) => void
): Promise<void> {
  const response = await invokeLLM(provider, request);
  
  if (!response.body) {
    throw new Error("Response body is null");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  try {
    while (true) {
      const { done, value } = await reader.read();
      
      if (done) break;
      
      const chunk = decoder.decode(value, { stream: true });
      onChunk(chunk);
    }
  } finally {
    reader.releaseLock();
  }
}
