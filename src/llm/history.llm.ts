import { getCurrentContextLength } from '../utils/context.util.js';
import { summarizeTool } from '../tools/summarize.tool.js';

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export class ConversationHistory {
  private messages: Message[] = [];
  private pendingTokenBuffer: string = '';
  private isAppending: boolean = false;

  constructor(systemPrompt?: string) {
    if (systemPrompt) {
      this.messages.push({ role: 'system', content: systemPrompt });
    }
  }

  addMessage(role: 'user' | 'assistant', content: string): void {
    this.messages.push({ role, content });
  }

  addSystemMessage(content: string): void {
    // Insert system message at the beginning if not already present
    if (this.messages.length === 0 || this.messages[0].role !== 'system') {
      this.messages.unshift({ role: 'system', content });
    } else {
      this.messages[0].content = content;
    }
  }

  getHistory(): Message[] {
    return [...this.messages];
  }

  getHistoryForLLM(): any[] {
    return this.messages.map(msg => ({
      role: msg.role,
      content: msg.content,
    }));
  }

  clear(): void {
    this.messages = this.messages.filter(msg => msg.role === 'system');
  }

  getLastMessage(): Message | undefined {
    return this.messages[this.messages.length - 1];
  }

  getLastUserMessage(): Message | undefined {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      if (this.messages[i].role === 'user') {
        return this.messages[i];
      }
    }
    return undefined;
  }

  getLastAssistantMessage(): Message | undefined {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      if (this.messages[i].role === 'assistant') {
        return this.messages[i];
      }
    }
    return undefined;
  }

  startAppendToken(): void {
    this.isAppending = true;
    this.pendingTokenBuffer = '';
  }

  appendToken(token: string): void {
    if (!this.isAppending) {
      throw new Error('Cannot append token - must call startAppendToken() first');
    }
    this.pendingTokenBuffer += token;
  }

  commitAppendToken(): void {
    if (!this.isAppending) {
      throw new Error('Cannot commit - must call startAppendToken() first');
    }

    if (this.pendingTokenBuffer.length > 0) {
      const lastMessage = this.getLastMessage();

      if (lastMessage && lastMessage.role === 'assistant') {
        // Append to existing assistant message
        lastMessage.content += this.pendingTokenBuffer;
      } else {
        // Create new assistant message
        this.messages.push({ role: 'assistant', content: this.pendingTokenBuffer });
      }
    }

    // Reset state
    this.isAppending = false;
    this.pendingTokenBuffer = '';
  }

  cancelAppendToken(): void {
    this.isAppending = false;
    this.pendingTokenBuffer = '';
  }

  getCurrentContextLength(): number {
    return getCurrentContextLength(this.messages);
  }

  private async summarizeHistoryIfNeeded(): Promise<void> {
    const currentLength = this.getCurrentContextLength();

    if (currentLength > 60000) {
      // Separate system message from other messages
      const systemMessage = this.messages.find(msg => msg.role === 'system');
      const nonSystemMessages = this.messages.filter(msg => msg.role !== 'system');

      // Take the last 1/4 of messages (keep recent context)
      const messagesToKeep = nonSystemMessages.slice(
        Math.floor((nonSystemMessages.length * 3) / 4)
      );
      const messagesToSummarize = nonSystemMessages.slice(
        0,
        Math.floor((nonSystemMessages.length * 3) / 4)
      );

      // Convert messages to text for summarization
      const textToSummarize = messagesToSummarize
        .map(msg => `${msg.role.toUpperCase()}: ${msg.content}`)
        .join('\n\n');

      try {
        // Use the summarize tool to compress the older messages
        const summaryResult = await summarizeTool.execute({
          content: textToSummarize,
          context_type: 'conversation',
          max_length: 8000,
          preserve_key_points: true,
          compression_ratio: 'heavy',
        });

        if (summaryResult.success) {
          // Rebuild the message history with summary + recent messages
          this.messages = [];

          // Add back system message if it existed
          if (systemMessage) {
            this.messages.push(systemMessage);
          }

          // Add the summary as a user message (provides context for the LLM)
          this.messages.push({
            role: 'user',
            content: `[SUMMARIZED CONTEXT - ${messagesToSummarize.length} messages compressed]:\n\n${summaryResult.summary}`,
          });

          // Add back the recent messages that weren't summarized
          this.messages.push(...messagesToKeep);
        } else {
          console.warn('Failed to summarize conversation history:', summaryResult.error);
        }
      } catch (error) {
        console.error('Error during conversation summarization:', error);
      }
    }
  }

  async addMessageWithSummarization(role: 'user' | 'assistant', content: string): Promise<void> {
    this.addMessage(role, content);
    await this.summarizeHistoryIfNeeded();
  }

  async addSystemMessageWithSummarization(content: string): Promise<void> {
    this.addSystemMessage(content);
    await this.summarizeHistoryIfNeeded();
  }
}
