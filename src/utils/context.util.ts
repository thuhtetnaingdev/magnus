/**
 * Calculate the approximate token count for a given text
 * This is a simple approximation - roughly 4 characters per token
 * For production use, you'd want to use the actual tokenizer from the model provider
 */
export function calculateTokenCount(text: string): number {
  // Simple approximation: ~4 characters per token
  // This is a rough estimate and may not be accurate for all models
  return Math.ceil(text.length / 4);
}

/**
 * Calculate the total context length from an array of messages
 */
export function getCurrentContextLength(messages: Array<{ role: string; content: string }>): number {
  let totalTokens = 0;
  
  for (const message of messages) {
    // Add tokens for role and content
    totalTokens += calculateTokenCount(message.role);
    totalTokens += calculateTokenCount(message.content);
    
    // Add some overhead for message formatting (typically 3-4 tokens per message)
    totalTokens += 4;
  }
  
  return totalTokens;
}
