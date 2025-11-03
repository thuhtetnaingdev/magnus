#!/usr/bin/env node
import { useState, useEffect } from 'react';
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
        // Cancel the current LLM request
        setIsCancelled(true);
        logger.info('LLM request cancelled by user');
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

    // Try to find XML tool calls in ACTION section
    if (actionMatch) {
      const actionContent = actionMatch[1];
      // Find ALL tool calls
      const xmlMatches = [...actionContent.matchAll(/<([\w*]+)>[\s\S]*?<\/\1>/g)];
      
      if (xmlMatches.length > 0) {
        const toolCalls: ToolCall[] = [];
        
        for (const match of xmlMatches) {
          const toolCallText = match[0];
          try {
            // Extract tool name from opening tag
            const toolNameMatch = toolCallText.match(/<(\*?[\w]+)>/);
            if (!toolNameMatch) {
              logger.warn(`Could not extract tool name from: ${toolCallText}`);
              continue;
            }

            const toolName = toolNameMatch[1];
            const parameters: any = {};

            // Extract parameters from the current tool call
            const toolStart = toolCallText.indexOf(`<${toolName}>`);
            const toolEnd = toolCallText.indexOf(`</${toolName}>`);

            if (toolStart !== -1 && toolEnd !== -1) {
              const toolContent = toolCallText.substring(toolStart + `<${toolName}>`.length, toolEnd);

              // Extract parameter values from this tool's content
              const paramMatches = toolContent.matchAll(/<(\w+)>([\s\S]*?)<\/\1>/g);
              for (const paramMatch of paramMatches) {
                const paramName = paramMatch[1];
                const paramValue = paramMatch[2].trim();
                
                // Handle multiple parameters with same name by collecting into array
                if (parameters[paramName]) {
                  if (Array.isArray(parameters[paramName])) {
                    parameters[paramName].push(paramValue);
                  } else {
                    // Convert existing single value to array
                    parameters[paramName] = [parameters[paramName], paramValue];
                  }
                } else {
                  parameters[paramName] = paramValue;
                }
              }
            }

            toolCalls.push({
              name: toolName,
              parameters: parameters,
            });

            logger.debug(`Successfully parsed tool call: ${toolName}`);
          } catch (e) {
            logger.warn(`Failed to parse XML tool call: ${toolCallText}`);
          }
        }

        if (toolCalls.length === 1) {
          result.action = toolCalls[0];
        } else if (toolCalls.length > 1) {
          result.action = toolCalls;
        }
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

  const executeTool = async (toolCall: ToolCall): Promise<{ success: boolean; result: string; error?: string }> => {
    const tool = toolRegistry.getTool(toolCall.name);
    if (!tool) {
      const error = `Tool '${toolCall.name}' not found. Available tools: ${toolRegistry.getAllTools().map(t => t.name).join(', ')}`;
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

  const executeToolsParallel = async (toolCalls: ToolCall[]): Promise<{ success: boolean; results: { [key: string]: string }; errors: { [key: string]: string } }> => {
    const results: { [key: string]: string } = {};
    const errors: { [key: string]: string } = {};
    
    // Execute all tools in parallel
    const executionPromises = toolCalls.map(async (toolCall) => {
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
    setIsCancelled(false);
    setIsInterruptible(true);

    while (iteration < maxIterations) {
      // Check if the request was cancelled
      if (isCancelled) {
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

      await invokeLLMWithStream(provider, request, async chunk => {
        // Check if the request was cancelled during streaming
        if (isCancelled) {
          throw new Error('Request cancelled');
        }
        
        try {
          buffer += chunk;
          const lines = buffer.split('\n');

          // Keep the last incomplete line in buffer
          buffer = lines.pop() || '';

          for (const line of lines) {
            // Check cancellation for each line
            if (isCancelled) {
              throw new Error('Request cancelled');
            }
            
            if (line.startsWith('data: ') && line !== 'data: [DONE]') {
              const data = JSON.parse(line.slice(6));
              const content = data.choices?.[0]?.delta?.content;
              if (content) {
                assistantResponse += content;

                // Append token to conversation history
                if (conversationHistory) {
                  conversationHistory.appendToken(content);
                  // Trigger UI update for real-time rendering
                  updateHistoryVersion();
                }
              }
            }
          }
        } catch (e) {
          // If cancelled, re-throw to break out of the streaming
          if (isCancelled) {
            throw new Error('Request cancelled');
          }
          // Ignore other parsing errors for streaming
        }
      });

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
              conversationHistory.addMessage('user', toolResultMessage);
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
              conversationHistory.addMessage('user', errorMessage);
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
              conversationHistory.addMessage('user', toolResultMessage);
            }
            currentMessages.push({ role: 'user', content: toolResultMessage });
          } else {
            // Tool failed - pass error back to LLM for correction
            logger.error(`Tool execution failed: ${parsedResponse.action.name} - ${toolExecution.error}`);
            
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
              conversationHistory.addMessage('user', errorMessage);
            }
            currentMessages.push({ role: 'user', content: errorMessage });
          }
        }

        // Check cancellation before next iteration
        if (isCancelled) {
          logger.info('LLM request was cancelled, stopping execution');
          setIsInterruptible(false);
          return 'Request cancelled by user.';
        }
        logger.info(`Continuing to next iteration for additional tool calls`);
      } else {
        // No tool call detected - this is the final response
        logger.info(`No tool call detected in iteration ${iteration} - ending recursion`);
        setIsInterruptible(false);
        return assistantResponse;
      }
    }

    logger.warn(`Reached maximum iteration limit of ${maxIterations}`);
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
      // Add a system message to guide the initialization process
      const initializationPrompt = `Please initialize this project by:
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

      // Add the initialization request to conversation history
      conversationHistory.addMessage('user', initializationPrompt);
      updateHistoryVersion();

      const provider: LLMProvider = {
        apiUrl: `${env.OPENAI_API_BASE}/chat/completions`,
        apiKey: env.OPENAI_API_KEY,
      };

      // Start recursive tool calling process to initialize the project
      await handleRecursiveToolCalling(provider, conversationHistory.getHistoryForLLM());
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

    conversationHistory.addMessage('user', currentInput);
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
            {conversationHistory &&
              conversationHistory
                .getHistory()
                .filter(
                  message =>
                    message.content.trim().length > 0 &&
                    message.role !== 'system' &&
                    !message.content.includes('Tool execution result:')
                )
                .map((message, index) => (
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
              {isInterruptible && (
                <Text color="gray"> (Press ESC to cancel)</Text>
              )}
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
