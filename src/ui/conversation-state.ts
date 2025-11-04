export interface UIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export class ConversationUIState {
  private messages: UIMessage[] = [];

  addMessage(role: 'user' | 'assistant', content: string): void {
    this.messages.push({
      role,
      content,
      timestamp: Date.now(),
    });

    // Automatic cleanup: keep only last 10 messages (excluding system)
    this.cleanupOldMessages();
  }

  addSystemMessage(content: string): void {
    // Insert system message at the beginning if not already present
    if (this.messages.length === 0 || this.messages[0].role !== 'system') {
      this.messages.unshift({
        role: 'system',
        content,
        timestamp: Date.now(),
      });
    } else {
      this.messages[0].content = content;
      this.messages[0].timestamp = Date.now();
    }
  }

  getMessages(): UIMessage[] {
    return [...this.messages];
  }

  getDisplayMessages(): UIMessage[] {
    // Filter out system messages and tool execution results for UI display
    return this.messages.filter(
      message =>
        message.content.trim().length > 0 &&
        message.role !== 'system' &&
        !message.content.includes('Tool execution result:')
    );
  }

  clear(): void {
    this.messages = [];
  }

  getLastMessage(): UIMessage | undefined {
    return this.messages[this.messages.length - 1];
  }

  private cleanupOldMessages(): void {
    const systemMessage = this.messages.find(msg => msg.role === 'system');
    const nonSystemMessages = this.messages.filter(msg => msg.role !== 'system');

    // Keep only last 10 non-system messages
    const recentMessages = nonSystemMessages.slice(-10);

    // Rebuild messages array
    this.messages = [];
    if (systemMessage) {
      this.messages.push(systemMessage);
    }
    this.messages.push(...recentMessages);
  }
}
