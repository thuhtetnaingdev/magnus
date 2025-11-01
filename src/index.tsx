#!/usr/bin/env node
import { useState, useEffect } from "react";
import { render, Text, Box, useInput, useApp } from "ink";
import { validateEnv } from "./env.js";
import {
  invokeLLMWithStream,
  type LLMRequest,
  type LLMProvider,
  type LLMMessage,
} from "./llm/client.llm.js";
import { toolRegistry } from "./tools/tool.registry.js";
import { getToolCallingSystemPrompt } from "./prompts/system.tool-calling.js";
import { ConversationHistory, type Message } from "./llm/history.llm.js";
import logger from "./utils/logger.js";
import { z } from "zod";

interface ToolCall {
  name: string;
  parameters: Record<string, any>;
}

interface ParsedResponse {
  thinking?: string;
  action?: ToolCall;
  response?: string;
}

function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationHistory, setConversationHistory] =
    useState<ConversationHistory | null>(null);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [env, setEnv] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [toolResults, setToolResults] = useState<string[]>([]);
  const { exit } = useApp();

  useInput((inputKey, key) => {
    if (isLoading) return;

    if (key.escape || (key.ctrl && inputKey === "c")) {
      exit();
      return;
    }

    if (key.return) {
      if (input.trim()) {
        handleSubmit();
      }
    } else if (key.backspace || key.delete) {
      setInput((prev) => prev.slice(0, -1));
    } else if (inputKey && inputKey.length > 0) {
      // Handle paste operations (multiple characters at once)
      setInput((prev) => prev + inputKey);
    }
  });

  useEffect(() => {
    try {
      logger.info("Loading environment variables...");
      const validatedEnv = validateEnv();
      setEnv(validatedEnv);

      // Initialize conversation history with system prompt
      const history = new ConversationHistory(getToolCallingSystemPrompt(process.cwd(), process.platform));
      setConversationHistory(history);

      logger.info("Environment loaded successfully");
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Unknown error occurred";
      logger.error(`Environment loading failed: ${errorMessage}`);
      setError(errorMessage);
    }
  }, []);

  const parseToolCall = (content: string): ParsedResponse | null => {
    const thinkingMatch = content.match(
      /### THINKING\s*\n([\s\S]*?)(?=\n### (ACTION|RESPONSE)|$)/
    );
    const actionMatch = content.match(
      /### ACTION\s*\n([\s\S]*?)(?=\n### RESPONSE|$)/
    );
    const responseMatch = content.match(/### RESPONSE\s*\n([\s\S]*?)$/);

    const result: ParsedResponse = {};

    if (thinkingMatch) {
      result.thinking = thinkingMatch[1];
    }

    // Try to find XML tool calls in different formats
    let toolCallText = "";

    // First try: XML in ACTION section
    if (actionMatch) {
      const actionContent = actionMatch[1];
      // Find ALL tool calls and take the last one (most recent)
      const xmlMatches = [...actionContent.matchAll(/<([\w*]+)>[\s\S]*?<\/\1>/g)];
      if (xmlMatches.length > 0) {
        // Use the last tool call found (most recent)
        const lastMatch = xmlMatches[xmlMatches.length - 1];
        toolCallText = lastMatch[0];
        logger.debug(`Found action section with XML tool call: ${toolCallText}`);
      }
    }

    // Second try: Direct XML without ACTION section
    if (!toolCallText) {
      const directXmlMatch = content.match(/<([\w*]+)>[\s\S]*?<\/\1>/);
      if (directXmlMatch) {
        toolCallText = directXmlMatch[0];
        logger.debug(`Found direct XML tool call: ${toolCallText}`);
      }
    }

    // Parse the tool call if found
    if (toolCallText) {
      try {
        // Extract tool name from opening tag
        const toolNameMatch = toolCallText.match(/<(\*?[\w]+)>/);
        if (!toolNameMatch) {
          logger.warn(`Could not extract tool name from: ${toolCallText}`);
          return result;
        }

        const toolName = toolNameMatch[1];
        const parameters: any = {};

        // Extract only parameters from the current tool call
        // Find the tool opening tag and closing tag to isolate the current tool
        const toolStart = toolCallText.indexOf(`<${toolName}>`);
        const toolEnd = toolCallText.indexOf(`</${toolName}>`);
        
        if (toolStart !== -1 && toolEnd !== -1) {
          const toolContent = toolCallText.substring(toolStart, toolEnd + `</${toolName}>`.length);
          
          // Extract parameter values only from this tool's content
          const paramMatches = toolContent.matchAll(/<(\w+)>([^<]*)<\/\1>/g);
          for (const match of paramMatches) {
            const paramName = match[1];
            const paramValue = match[2];
            parameters[paramName] = paramValue;
          }
        } else {
          // Fallback: extract all parameters (original behavior)
          const paramMatches = toolCallText.matchAll(/<(\w+)>([^<]*)<\/\1>/g);
          for (const match of paramMatches) {
            const paramName = match[1];
            const paramValue = match[2];
            parameters[paramName] = paramValue;
          }
        }

        result.action = {
          name: toolName,
          parameters: parameters,
        };

        logger.debug(`Successfully parsed tool call: ${toolName}`);
      } catch (e) {
        logger.warn(`Failed to parse XML tool call: ${toolCallText}`);
      }
    }

    if (responseMatch) {
      result.response = responseMatch[1];
    }

    return Object.keys(result).length > 0 ? result : null;
  };

  const convertParametersToTypes = (parameters: Record<string, string>, schema: any): Record<string, any> => {
    const result: Record<string, any> = {};
    
    for (const [key, value] of Object.entries(parameters)) {
      if (schema instanceof z.ZodObject) {
        const fieldSchema = schema.shape[key];
        if (fieldSchema) {
          // Get the actual type by unwrapping ZodDefault if present
          let actualSchema = fieldSchema;
          while (actualSchema._def && actualSchema._def.typeName === 'ZodDefault') {
            actualSchema = actualSchema._def.innerType;
          }
          
          // Get the inner type for optional fields
          if (actualSchema._def && actualSchema._def.typeName === 'ZodOptional') {
            actualSchema = actualSchema._def.innerType;
          }
          
          // Convert based on actual Zod schema type
          if (actualSchema._def && actualSchema._def.typeName === 'ZodNumber') {
            result[key] = Number(value);
          } else if (actualSchema._def && actualSchema._def.typeName === 'ZodBoolean') {
            // Handle boolean values - convert strings like "true", "false", "1", "0"
            const lowerValue = value.toLowerCase();
            result[key] = lowerValue === 'true' || lowerValue === '1';
          } else {
            // Keep as string for other types
            result[key] = value;
          }
        } else {
          // Unknown parameter, keep as string
          result[key] = value;
        }
      } else {
        // No schema info, keep as string
        result[key] = value;
      }
    }
    
    return result;
  };

  const executeTool = async (toolCall: ToolCall): Promise<string> => {
    const tool = toolRegistry.getTool(toolCall.name);
    if (!tool) {
      logger.error(`Tool not found: ${toolCall.name}`);
      return `Error: Tool '${toolCall.name}' not found`;
    }

    try {
      // Convert string parameters to appropriate types based on tool schema
      const typedParameters = convertParametersToTypes(toolCall.parameters, tool.parameters);
      
      logger.debug(
        `Executing tool: ${toolCall.name} with parameters: ${JSON.stringify(
          typedParameters
        )}`
      );
      // The tool now handles its own parameter validation internally
      const result = await tool.execute(typedParameters as any);
      logger.debug(
        `Tool ${toolCall.name} executed successfully, result size: ${
          JSON.stringify(result).length
        } chars`
      );
      return JSON.stringify(result, null, 2);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error(`Tool execution failed: ${toolCall.name} - ${errorMessage}`);
      return `Error executing tool '${toolCall.name}': ${errorMessage}`;
    }
  };

  const handleRecursiveToolCalling = async (
    provider: LLMProvider,
    initialMessages: LLMMessage[],
    maxIterations: number = 10
  ): Promise<string> => {
    let currentMessages = [...initialMessages];
    let iteration = 0;

    while (iteration < maxIterations) {
      iteration++;
      logger.info(`Starting recursive LLM call iteration ${iteration}`);

      const request: LLMRequest = {
        model: env.OPENAI_MODEL,
        messages: currentMessages,
        stream: true,
        max_tokens: 92000,
        temperature: 0,
      };

      let assistantResponse = "";
      let buffer = "";

      await invokeLLMWithStream(provider, request, async (chunk) => {
        try {
          buffer += chunk;
          const lines = buffer.split("\n");
          
          // Keep the last incomplete line in buffer
          buffer = lines.pop() || "";
          
          for (const line of lines) {
            if (line.startsWith("data: ") && line !== "data: [DONE]") {
              const data = JSON.parse(line.slice(6));
              const content = data.choices?.[0]?.delta?.content;
              if (content) {
                assistantResponse += content;
                setMessages((prev) => {
                  const newMessages = [...prev];
                  if (
                    newMessages[newMessages.length - 1]?.role === "assistant"
                  ) {
                    newMessages[newMessages.length - 1].content =
                      assistantResponse;
                  } else {
                    newMessages.push({
                      role: "assistant",
                      content: assistantResponse,
                    });
                  }
                  return newMessages;
                });
              }
            }
          }
        } catch (e) {
          // Ignore parsing errors for streaming
        }
      });

      logger.info(`LLM response received in iteration ${iteration}`);
      logger.debug(`Assistant response: ${assistantResponse}`);

      // Add assistant response to conversation history
      if (assistantResponse && conversationHistory) {
        conversationHistory.addMessage("assistant", assistantResponse);
        currentMessages.push({ role: "assistant", content: assistantResponse });
      }

      // Check if we need to execute a tool
      const parsedResponse = parseToolCall(assistantResponse);

      if (parsedResponse?.action) {
        logger.info(
          `Tool call detected in iteration ${iteration}: ${
            parsedResponse.action.name
          } with params: ${JSON.stringify(parsedResponse.action.parameters)}`
        );

        // Execute the tool
        const toolResult = await executeTool(parsedResponse.action);
        setToolResults((prev) => [...prev, toolResult]);

        logger.info(`Tool execution completed: ${parsedResponse.action.name}`);
        logger.info(
          `Tool result: ${toolResult.substring(0, 500)}${
            toolResult.length > 500 ? "..." : ""
          }`
        );

        // Add tool result to conversation for next iteration
        const toolResultMessage = `Tool execution result:\n\`\`\`json\n${toolResult}\n\`\`\``;
        if (conversationHistory) {
          conversationHistory.addMessage("user", toolResultMessage);
        }
        currentMessages.push({ role: "user", content: toolResultMessage });

        logger.info(`Continuing to next iteration for additional tool calls`);
      } else {
        // No tool call detected - this is the final response
        logger.info(`No tool call detected in iteration ${iteration} - ending recursion`);
        return assistantResponse;
      }
    }

    logger.warn(`Reached maximum iteration limit of ${maxIterations}`);
    return "Maximum iteration limit reached. Please try a more specific query.";
  };

  const handleSubmit = async () => {
    if (!input.trim() || isLoading || !env) return;

    logger.info(
      `User input received: ${input.substring(0, 50)}${
        input.length > 50 ? "..." : ""
      }`
    );

    if (!conversationHistory) {
      logger.error("Conversation history not initialized");
      return;
    }

    const userMessage: Message = { role: "user", content: input };
    setMessages((prev) => [...prev, userMessage]);
    conversationHistory.addMessage("user", input);
    const userInput = input;
    setInput("");
    setIsLoading(true);

    try {
      const provider: LLMProvider = {
        apiUrl: `${env.OPENAI_API_BASE}/chat/completions`,
        apiKey: env.OPENAI_API_KEY,
      };

      // Start recursive tool calling process
      await handleRecursiveToolCalling(
        provider,
        conversationHistory.getHistoryForLLM()
      );
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to get response from AI";
      setError(errorMessage);
    } finally {
      setIsLoading(false);
      logger.info("Request processing completed");
    }
  };

  if (error) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="red">Error: {error}</Text>
        <Text>Please check your environment variables and try again.</Text>
      </Box>
    );
  }

  if (!env) {
    return (
      <Box padding={1}>
        <Text>Loading environment...</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Box flexDirection="column" marginBottom={1}>
        {messages.length === 0 && (
          <Box marginBottom={1}>
            <Text color="yellow">Welcome to Agentic Tool Calling CLI!</Text>
            <Text> I have access to tools like grep for code search.</Text>
            <Text> Type your message and press Enter to start.</Text>
          </Box>
        )}
        {messages
          .filter((message) => message.content.trim().length > 0)
          .map((message, index) => (
            <Box key={index} marginBottom={1} flexDirection="row">
              <Text color="cyan">{">"}</Text>
              <Text color="cyan"> </Text>
              <Text color={message.role === "assistant" ? "cyan" : "white"}>
                {message.content}
              </Text>
            </Box>
          ))}
      </Box>

      {!isLoading && (
        <Box>
          <Text color="cyan">{"> "}</Text>
          <Text>{input}</Text>
        </Box>
      )}
    </Box>
  );
}

render(<App />);
