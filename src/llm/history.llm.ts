export interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}

export class ConversationHistory {
  private messages: Message[] = [];

  constructor(systemPrompt?: string) {
    if (systemPrompt) {
      this.messages.push({ role: "system", content: systemPrompt });
    }
  }

  addMessage(role: "user" | "assistant", content: string): void {
    this.messages.push({ role, content });
  }

  addSystemMessage(content: string): void {
    // Insert system message at the beginning if not already present
    if (this.messages.length === 0 || this.messages[0].role !== "system") {
      this.messages.unshift({ role: "system", content });
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
      content: msg.content
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
      if (this.messages[i].role === "user") {
        return this.messages[i];
      }
    }
    return undefined;
  }

  getLastAssistantMessage(): Message | undefined {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      if (this.messages[i].role === "assistant") {
        return this.messages[i];
      }
    }
    return undefined;
  }
}
