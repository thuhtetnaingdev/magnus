#!/usr/bin/env node
import { useState, useEffect, useRef } from 'react';
import { render, Text, Box, useInput, useApp } from 'ink';
import TextInput from 'ink-text-input';
import SelectInput from 'ink-select-input';
import Gradient from 'ink-gradient';
import BigText from 'ink-big-text';
import { MarkdownViewer } from './markdown-viewer.js';
import { validateEnv } from './env.js';
import {
  invokeLLMWithStream,
  type LLMRequest,
  type LLMProvider,
  type LLMMessage,
} from './llm/client.llm.js';
import { toolRegistry } from './tools/tool.registry.js';
import { getToolCallingSystemPrompt } from './prompts/system.tool-calling.js';
import { ConversationHistory, type Message } from './llm/history.llm.js';
import { ConversationUIState } from './ui/conversation-state.js';
import logger from './utils/logger.js';
import { z } from 'zod';

interface ToolCall {
  name: string;
  parameters: Record<string, any>;
}

interface ParsedResponse {
  thinking?: string;
  action?: ToolCall | ToolCall[];
  response?: string;
}

function App() {
  const [conversationHistory, setConversationHistory] = useState<ConversationHistory | null>(null);
  const [conversationUIState, setConversationUIState] = useState<ConversationUIState | null>(null);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [env, setEnv] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [toolResults, setToolResults] = useState<string[]>([]);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [showModal, setShowModal] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  const [isInterruptible, setIsInterruptible] = useState(false);
  const [isCancelled, setIsCancelled] = useState(false);
  const isCancelledRef = useRef(false);
  const { exit } = useApp();

  useInput((inputKey, key) => {
    // Always allow Ctrl+C to exit
    if (key.ctrl && inputKey === 'c') {
      exit();
      return;
    }

    // Handle Escape key
    if (key.escape) {
      if (showModal) {
        setShowModal(false);
      } else if (isLoading && isInterruptible) {
        // Cancel the current LLM request immediately
        logger.info('User pressed ESC — cancelling stream...');
        isCancelledRef.current = true; // cancel flag reference
        setIsCancelled(true); // keep React state for UI update
      }
      return;
    }

    // Clear UI state with Ctrl+K (only when modal is not open)
    if (!showModal && key.ctrl && inputKey.toLowerCase() === 'k') {
      if (conversationUIState && conversationHistory) {
        // Clear both UI state and LLM history independently
        conversationUIState.clear();
        logger.info('Conversation cleared - both UI and LLM history reset');
      }
      return;
    }

    // Open modal with Ctrl+P (only when modal is not open)
    if (!showModal && key.ctrl && inputKey.toLowerCase() === 'p') {
      setShowModal(true);
    }
  });

  useEffect(() => {
    try {
      const validatedEnv = validateEnv();
      setEnv(validatedEnv);

      // Initialize conversation history with system prompt
      const history = new ConversationHistory(
        getToolCallingSystemPrompt(process.cwd(), process.platform)
      );
      setConversationHistory(history);

      // Initialize UI conversation state
      const uiState = new ConversationUIState();
      setConversationUIState(uiState);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
      logger.error(`Environment loading failed: ${errorMessage}`);
      setError(errorMessage);
    }
  }, []);

  const parseToolCall = (content: string): ParsedResponse | null => {
    const thinkingMatch = content.match(/### THINKING\s*\n([\s\S]*?)(?=\n### (ACTION|RESPONSE)|$)/);
    const actionMatch = content.match(/### ACTION\s*\n([\s\S]*?)(?=\n### RESPONSE|$)/);
    const responseMatch = content.match(/### RESPONSE\s*\n([\s\S]*?)$/);

    const result: ParsedResponse = {};

    if (thinkingMatch) {
      result.thinking = thinkingMatch[1];
    }

    // Try to find JSON tool calls in ACTION section
    if (actionMatch) {
      const actionContent = actionMatch[1];

      try {
        // Try to parse the entire ACTION section as JSON
        const parsedJSON = JSON.parse(actionContent.trim());

        if (Array.isArray(parsedJSON)) {
          // Multiple tool calls in array
          const toolCalls: ToolCall[] = [];

          for (const toolObj of parsedJSON) {
            if (
              typeof toolObj === 'object' &&
              toolObj !== null &&
              'name' in toolObj &&
              'parameters' in toolObj
            ) {
              toolCalls.push({
                name: toolObj.name,
                parameters: toolObj.parameters,
              });
            }
          }

          if (toolCalls.length === 1) {
            result.action = toolCalls[0];
          } else if (toolCalls.length > 1) {
            result.action = toolCalls;
          }
        } else if (
          typeof parsedJSON === 'object' &&
          parsedJSON !== null &&
          'name' in parsedJSON &&
          'parameters' in parsedJSON
        ) {
          // Single tool call
          result.action = {
            name: parsedJSON.name,
            parameters: parsedJSON.parameters,
          };
        }

        logger.debug(`Successfully parsed JSON tool call(s)`);
      } catch (e) {
        logger.warn(`Failed to parse JSON tool call: ${actionContent}`);
      }
    }

    if (responseMatch) {
      result.response = responseMatch[1];
    }

    return Object.keys(result).length > 0 ? result : null;
  };

  const convertParametersToTypes = (
    parameters: Record<string, any>,
    schema: any
  ): Record<string, any> => {
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
            result[key] = Array.isArray(value) ? value.map(v => Number(v)) : Number(value);
          } else if (actualSchema._def && actualSchema._def.typeName === 'ZodBoolean') {
            // Handle boolean values - convert strings like "true", "false", "1", "0"
            const convertBoolean = (v: any) => {
              const lowerValue = String(v).toLowerCase();
              return lowerValue === 'true' || lowerValue === '1';
            };
            result[key] = Array.isArray(value) ? value.map(convertBoolean) : convertBoolean(value);
          } else if (actualSchema._def && actualSchema._def.typeName === 'ZodArray') {
            // Handle array types - parse JSON strings or use existing arrays
            // This handles cases where LLM sends array parameters as JSON strings
            // Example: dependencies="[\"dep1\", \"dep2\"]" instead of multiple <dependencies> elements
            if (typeof value === 'string') {
              try {
                // Try to parse as JSON array
                const parsed = JSON.parse(value);
                if (Array.isArray(parsed)) {
                  result[key] = parsed;
                } else {
                  // If not a valid JSON array, treat as single element array
                  result[key] = [value];
                }
              } catch {
                // If JSON parsing fails, treat as single element array
                result[key] = [value];
              }
            } else if (Array.isArray(value)) {
              result[key] = value;
            } else {
              // Convert single value to array
              result[key] = [value];
            }
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

  const executeTool = async (
    toolCall: ToolCall
  ): Promise<{ success: boolean; result: string; error?: string }> => {
    const tool = toolRegistry.getTool(toolCall.name);
    if (!tool) {
      const error = `Tool '${toolCall.name}' not found. Available tools: ${toolRegistry
        .getAllTools()
        .map(t => t.name)
        .join(', ')}`;
      logger.error(error);
      return { success: false, result: '', error };
    }

    try {
      // Convert string parameters to appropriate types based on tool schema
      const typedParameters = convertParametersToTypes(toolCall.parameters, tool.parameters);

      logger.debug(
        `Executing tool: ${toolCall.name} with parameters: ${JSON.stringify(typedParameters)}`
      );
      // The tool now handles its own parameter validation internally
      const result = await tool.execute(typedParameters as any);
      logger.debug(
        `Tool ${toolCall.name} executed successfully, result size: ${
          JSON.stringify(result).length
        } chars`
      );
      return { success: true, result: JSON.stringify(result, null, 2) };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Tool execution failed: ${toolCall.name} - ${errorMessage}`);
      return { success: false, result: '', error: errorMessage };
    }
  };

  const executeToolsParallel = async (
    toolCalls: ToolCall[]
  ): Promise<{
    success: boolean;
    results: { [key: string]: string };
    errors: { [key: string]: string };
  }> => {
    const results: { [key: string]: string } = {};
    const errors: { [key: string]: string } = {};

    // Execute all tools in parallel
    const executionPromises = toolCalls.map(async toolCall => {
      const result = await executeTool(toolCall);
      if (result.success) {
        results[toolCall.name] = result.result;
      } else {
        errors[toolCall.name] = result.error || 'Unknown error';
      }
      return result;
    });

    await Promise.all(executionPromises);

    const success = Object.keys(errors).length === 0;
    return { success, results, errors };
  };

  const handleRecursiveToolCalling = async (
    provider: LLMProvider,
    initialMessages: LLMMessage[],
    maxIterations: number = 100
  ): Promise<string> => {
    const currentMessages = [...initialMessages];
    let iteration = 0;
    isCancelledRef.current = false;
    setIsCancelled(false);
    setIsInterruptible(true);

    while (iteration < maxIterations) {
      // Check if the request was cancelled
      if (isCancelledRef.current) {
        logger.info('LLM request was cancelled, stopping execution');
        setIsInterruptible(false);
        return 'Request cancelled by user.';
      }

      iteration++;
      logger.info(`Starting recursive LLM call iteration ${iteration}`);

      const request: LLMRequest = {
        model: env.OPENAI_MODEL,
        messages: currentMessages,
        stream: true,
        max_tokens: 8192,
        temperature: 0,
      };

      let assistantResponse = '';
      let buffer = '';

      // Start token appending transaction
      if (conversationHistory) {
        conversationHistory.startAppendToken();
      }

      try {
        await invokeLLMWithStream(
          provider,
          request,
          async chunk => {
            try {
              buffer += chunk;
              const lines = buffer.split('\n');

              // Keep the last incomplete line in buffer
              buffer = lines.pop() || '';

              for (const line of lines) {
                if (line.startsWith('data: ') && line !== 'data: [DONE]') {
                  const data = JSON.parse(line.slice(6));
                  const content = data.choices?.[0]?.delta?.content;
                  if (content) {
                    assistantResponse += content;

                    // Append token to conversation history
                    if (conversationHistory) {
                      conversationHistory.appendToken(content);

                      // Update UI state for real-time rendering (limited to recent messages)
                      if (conversationUIState) {
                        const lastMessage = conversationUIState.getLastMessage();
                        if (lastMessage && lastMessage.role === 'assistant') {
                          // Update existing assistant message in UI
                          lastMessage.content += content;
                        } else {
                          // Add new assistant message to UI
                          conversationUIState.addMessage('assistant', content);
                        }
                        updateHistoryVersion();
                      }
                    }
                  }
                }
              }
            } catch (e) {
              // Ignore parsing errors for streaming
            }
          },
          () => isCancelledRef.current
        );
      } catch (e) {
        if (isCancelledRef.current) {
          logger.info('LLM request was cancelled during streaming');
          setIsInterruptible(false);
          return 'Request cancelled by user.';
        }
        throw e;
      }

      logger.info(`LLM response received in iteration ${iteration}`);
      logger.debug(`Assistant response: ${assistantResponse}`);

      // Commit token appending transaction
      if (conversationHistory) {
        conversationHistory.commitAppendToken();
      }

      // Add assistant response to current messages for next iteration
      if (assistantResponse) {
        currentMessages.push({ role: 'assistant', content: assistantResponse });
      }

      // Check if we need to execute a tool
      const parsedResponse = parseToolCall(assistantResponse);

      if (parsedResponse?.action) {
        if (Array.isArray(parsedResponse.action)) {
          // Parallel tool execution
          logger.info(
            `Parallel tool calls detected in iteration ${iteration}: ${parsedResponse.action.map(tc => tc.name).join(', ')}`
          );

          // Execute tools in parallel
          const parallelExecution = await executeToolsParallel(parsedResponse.action);

          if (parallelExecution.success) {
            // Add all successful tool results to conversation
            let toolResultMessage = `Parallel tool execution completed successfully:\n\n`;

            Object.entries(parallelExecution.results).forEach(([toolName, result]) => {
              setToolResults(prev => [...prev, result]);
              logger.info(`Tool execution completed: ${toolName}`);
              logger.info(
                `Tool result: ${result.substring(0, 500)}${result.length > 500 ? '...' : ''}`
              );

              toolResultMessage += `**${toolName}**:\n\`\`\`json\n${result}\n\`\`\`\n\n`;
            });

            if (conversationHistory) {
              await conversationHistory.addMessageWithSummarization('user', toolResultMessage);
            }
            // Update UI state
            if (conversationUIState) {
              conversationUIState.addMessage('user', toolResultMessage);
            }
            // Update UI state
            if (conversationUIState) {
              conversationUIState.addMessage('user', toolResultMessage);
            }
            currentMessages.push({ role: 'user', content: toolResultMessage });
          } else {
            // Some tools failed - pass errors back to LLM
            let errorMessage = `Parallel tool execution completed with errors:\n\n`;

            Object.entries(parallelExecution.results).forEach(([toolName, result]) => {
              errorMessage += `**${toolName}** (success):\n\`\`\`json\n${result}\n\`\`\`\n\n`;
            });

            Object.entries(parallelExecution.errors).forEach(([toolName, error]) => {
              logger.error(`Tool execution failed: ${toolName} - ${error}`);
              errorMessage += `**${toolName}** (failed): ${error}\n\n`;
            });

            errorMessage += `Please analyze these errors and try again with corrected parameters. Focus on fixing the specific errors mentioned above.`;

            if (conversationHistory) {
              await conversationHistory.addMessageWithSummarization('user', errorMessage);
            }
            // Update UI state
            if (conversationUIState) {
              conversationUIState.addMessage('user', errorMessage);
            }
            // Update UI state
            if (conversationUIState) {
              conversationUIState.addMessage('user', errorMessage);
            }
            currentMessages.push({ role: 'user', content: errorMessage });
          }
        } else {
          // Single tool execution (original behavior)
          logger.info(
            `Tool call detected in iteration ${iteration}: ${
              parsedResponse.action.name
            } with params: ${JSON.stringify(parsedResponse.action.parameters)}`
          );

          // Execute the tool
          const toolExecution = await executeTool(parsedResponse.action);

          if (toolExecution.success) {
            setToolResults(prev => [...prev, toolExecution.result]);
            logger.info(`Tool execution completed: ${parsedResponse.action.name}`);
            logger.info(
              `Tool result: ${toolExecution.result.substring(0, 500)}${toolExecution.result.length > 500 ? '...' : ''}`
            );

            // Add successful tool result to conversation for next iteration
            const toolResultMessage = `Tool execution result:\n\`\`\`json\n${toolExecution.result}\n\`\`\``;
            if (conversationHistory) {
              await conversationHistory.addMessageWithSummarization('user', toolResultMessage);
            }
            currentMessages.push({ role: 'user', content: toolResultMessage });
          } else {
            // Tool failed - pass error back to LLM for correction
            logger.error(
              `Tool execution failed: ${parsedResponse.action.name} - ${toolExecution.error}`
            );

            const errorMessage = `Tool '${parsedResponse.action.name}' failed with error: ${toolExecution.error}

Please analyze this error and try again with the SAME tool using corrected parameters. Focus on:
1. Fixing the specific error mentioned above
2. Ensuring all required parameters are provided and correctly formatted
3. Verifying file paths exist and are accessible (use absolute paths)
4. Using appropriate parameter types (strings, numbers, booleans)
5. Double-checking parameter names and values match the tool's schema
${toolExecution.error?.includes('timed out') ? '6. The operation timed out - try breaking it into smaller, simpler steps or reducing the scope of changes' : ''}

Try the '${parsedResponse.action.name}' tool again with corrected parameters. Only use a different tool if the current tool is fundamentally unsuitable for this task.

Original failed tool call: ${parsedResponse.action.name} with parameters: ${JSON.stringify(parsedResponse.action.parameters, null, 2)}`;

            if (conversationHistory) {
              await conversationHistory.addMessageWithSummarization('user', errorMessage);
            }
            currentMessages.push({ role: 'user', content: errorMessage });
          }
        }

        // Check cancellation before next iteration
        if (isCancelledRef.current) {
          logger.info('LLM request was cancelled, stopping execution');
          setIsInterruptible(false);
          return 'Request cancelled by user.';
        }
        logger.info(`Continuing to next iteration for additional tool calls`);
      } else {
        // No tool call detected - this is the final response
        logger.info(`No tool call detected in iteration ${iteration} - ending recursion`);
        isCancelledRef.current = false;
        setIsInterruptible(false);
        return assistantResponse;
      }
    }

    logger.warn(`Reached maximum iteration limit of ${maxIterations}`);
    isCancelledRef.current = false;
    setIsInterruptible(false);
    return 'Maximum iteration limit reached. Please try a more specific query.';
  };

  const updateHistoryVersion = () => {
    setHistoryVersion(prev => prev + 1);
  };

  const handleInitializeProject = async () => {
    if (!conversationHistory) return;

    setShowModal(false);
    setIsLoading(true);
    setIsInitializing(true);

    try {
      const { handleInitializeProject: initializeProject } = await import(
        './initialization/project-initializer.js'
      );
      await initializeProject(
        conversationHistory,
        env,
        updateHistoryVersion,
        handleRecursiveToolCalling
      );
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to initialize project';
      logger.error(`Project initialization error: ${errorMessage}`);
      setError(errorMessage);
    } finally {
      setIsLoading(false);
      setIsInitializing(false);
      setIsInterruptible(false);
    }
  };

  const handleModalSelect = (item: { label: string; value: string }) => {
    if (item.value === 'clear') {
      conversationHistory?.clear();
      conversationUIState?.clear();
      setToolResults([]);
      updateHistoryVersion();
    } else if (item.value === 'initialize') {
      handleInitializeProject();
      return; // Don't close modal immediately - handleInitializeProject does it
    }
    setShowModal(false);
  };

  const handleSubmit = async () => {
    const currentInput = input.trim();
    if (!currentInput || isLoading || !env) return;

    logger.info(
      `User input received: ${currentInput.substring(0, 50)}${currentInput.length > 50 ? '...' : ''}`
    );

    if (!conversationHistory) {
      logger.error('Conversation history not initialized');
      return;
    }

    await conversationHistory.addMessageWithSummarization('user', currentInput);

    // Update UI state
    if (conversationUIState) {
      conversationUIState.addMessage('user', currentInput);
    }

    updateHistoryVersion();
    setInput('');
    setIsLoading(true);

    try {
      const provider: LLMProvider = {
        apiUrl: `${env.OPENAI_API_BASE}/chat/completions`,
        apiKey: env.OPENAI_API_KEY,
      };

      // Start recursive tool calling process
      await handleRecursiveToolCalling(provider, conversationHistory.getHistoryForLLM());
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to get response from AI';
      logger.error(`API Error: ${errorMessage}`);
      setError(errorMessage);
    } finally {
      setIsLoading(false);
      setIsInterruptible(false);
      logger.info('Request processing completed');
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

  const modal = (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      padding={1}
      width={30}
      alignItems="center"
      justifyContent="center"
    >
      <Text color="cyanBright">⚙ Menu</Text>
      <SelectInput
        items={[
          { label: 'Initialize project', value: 'initialize' },
          { label: 'Clear session', value: 'clear' },
        ]}
        onSelect={handleModalSelect}
      />
      <Text color="gray">Press Esc to close</Text>
    </Box>
  );

  return (
    <Box flexDirection="column" padding={1}>
      {showModal ? (
        modal
      ) : (
        <>
          <Box flexDirection="column" marginBottom={1}>
            <Box marginBottom={1} flexDirection="column">
              <Gradient name="vice">
                <BigText text="Magnus" />
              </Gradient>
              <Text color="gray">Your AI assistant with tool access.</Text>
              <Text color="dim">Type your message and press Enter to begin.</Text>
            </Box>
            {conversationUIState &&
              conversationUIState.getDisplayMessages().map((message, index) => (
                <Box key={index} flexDirection="column" marginY={1}>
                  <Box flexDirection="row">
                    <Text color={message.role === 'assistant' ? 'magentaBright' : 'greenBright'}>
                      {message.role === 'assistant' ? 'Assistant ▸' : 'You ▸'}
                    </Text>
                  </Box>
                  <Box
                    marginLeft={2}
                    borderStyle="round"
                    borderColor={message.role === 'assistant' ? 'gray' : 'green'}
                  >
                    {message.role === 'assistant' ? (
                      <MarkdownViewer content={message.content} />
                    ) : (
                      <Text>{message.content}</Text>
                    )}
                  </Box>
                </Box>
              ))}
          </Box>

          {isInitializing && (
            <Box>
              <Text color="yellow">Initializing project and creating MAGNUS.md...</Text>
            </Box>
          )}
          {isLoading && !isInitializing && (
            <Box>
              <Text color="yellow">Processing...</Text>
              {isInterruptible && <Text color="gray"> (Press ESC to cancel)</Text>}
            </Box>
          )}
          {!isLoading && (
            <Box flexDirection="column">
              <Box>
                <Text color="greenBright">❯ </Text>
                <TextInput
                  value={input}
                  onChange={setInput}
                  onSubmit={handleSubmit}
                  placeholder="Type your message..."
                  focus={true}
                  showCursor={true}
                />
              </Box>
              <Box marginTop={1}>
                <Text color="dim">💡 Press Ctrl+P for options</Text>
              </Box>
            </Box>
          )}
        </>
      )}
    </Box>
  );
}

render(<App />);
