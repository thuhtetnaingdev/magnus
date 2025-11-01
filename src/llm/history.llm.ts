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
    this.messages = [];
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
}
