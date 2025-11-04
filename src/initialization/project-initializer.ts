import { ConversationHistory } from '../llm/history.llm.js';
import { LLMProvider } from '../llm/client.llm.js';
import logger from '../utils/logger.js';

export const getInitializationPrompt = (): string => {
  return `Please initialize this project by:
1. Using the tree tool to get the project structure
2. Using the read tool to examine key files like package.json, README.md, etc.
3. Using the glob tool to find relevant files
4. Creating a comprehensive MAGNUS.md file that documents:
   - Project overview and purpose
   - Directory structure
   - Key files and their purposes
   - Available tools and their usage
   - How to run and build the project

The MAGNUS.md should be in root directory and formatted in markdown. Focus on clarity and usefulness for new developers. ./MAGNUS.md`;
};

export const createLLMProvider = (env: any): LLMProvider => {
  return {
    apiUrl: `${env.OPENAI_API_BASE}/chat/completions`,
    apiKey: env.OPENAI_API_KEY,
  };
};

export const handleInitializeProject = async (
  conversationHistory: ConversationHistory,
  env: any,
  updateHistoryVersion: () => void,
  handleRecursiveToolCalling: (provider: LLMProvider, messages: any[]) => Promise<string>
): Promise<void> => {
  if (!conversationHistory) {
    throw new Error('Conversation history not initialized');
  }

  try {
    // Add the initialization request to conversation history
    await conversationHistory.addMessageWithSummarization('user', getInitializationPrompt());
    updateHistoryVersion();

    const provider = createLLMProvider(env);

    // Start recursive tool calling process to initialize the project
    await handleRecursiveToolCalling(provider, conversationHistory.getHistoryForLLM());
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Failed to initialize project';
    logger.error(`Project initialization error: ${errorMessage}`);
    throw new Error(errorMessage);
  }
};
