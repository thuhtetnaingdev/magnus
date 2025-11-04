import { z } from 'zod';
import { createTool, type ToolDefinition } from './tool.base.js';
import { invokeLLMWithStream, type LLMProvider, type LLMMessage } from '../llm/client.llm.js';
import { validateEnv } from '../env.js';

// Zod schema for summarize tool parameters
const SummarizeParametersSchema = z.object({
  content: z
    .string()
    .min(1, 'Content cannot be empty')
    .describe('The content to summarize (can be text, code, or conversation history)'),
  context_type: z
    .enum(['conversation', 'code', 'documentation', 'general'])
    .default('general')
    .describe('Type of content being summarized for better context preservation'),
  max_length: z
    .number()
    .min(50)
    .max(8000)
    .default(1000)
    .describe('Maximum length of the summary in characters'),
  preserve_key_points: z
    .boolean()
    .default(true)
    .describe('Whether to preserve key technical details and decision points'),
  compression_ratio: z
    .enum(['light', 'medium', 'heavy'])
    .default('medium')
    .describe(
      'Level of compression: light (30% reduction), medium (60% reduction), heavy (80% reduction)'
    ),
});

export type SummarizeParameters = z.infer<typeof SummarizeParametersSchema>;

export interface SummarizeTool extends ToolDefinition<typeof SummarizeParametersSchema> {
  name: 'summarize';
}

async function generateSummary(
  content: string,
  contextType: string,
  maxLength: number,
  preserveKeyPoints: boolean,
  compressionRatio: string
): Promise<string> {
  const env = validateEnv();

  // Calculate target length based on compression ratio
  const compressionMap = {
    light: 0.7,
    medium: 0.4,
    heavy: 0.2,
  };
  const targetRatio = compressionMap[compressionRatio as keyof typeof compressionMap];
  const targetLength = Math.min(maxLength, Math.floor(content.length * targetRatio));

  // Build context-aware summarization prompt
  const systemPrompt = `You are an expert at creating context-aware summaries that preserve critical information while reducing length. 

CONTEXT TYPE: ${contextType}
COMPRESSION LEVEL: ${compressionRatio}
TARGET LENGTH: ~${targetLength} characters
PRESERVE KEY POINTS: ${preserveKeyPoints}

SUMMARIZATION GUIDELINES:
1. For CONVERSATION context: Preserve user requests, AI responses, key decisions, and action items
2. For CODE context: Keep function signatures, key logic, error handling, and architectural decisions
3. For DOCUMENTATION context: Maintain essential concepts, examples, and critical instructions
4. For GENERAL context: Focus on main ideas, conclusions, and important details

CONTEXT PRESERVATION RULES:
- Always preserve technical specifications, file paths, and tool names
- Keep error messages and solutions when present
- Maintain decision rationale and implementation choices
- Preserve sequential order and causality relationships
- Retain specific values, IDs, and configuration details

FORMAT YOUR RESPONSE AS A CLEAR, READABLE SUMMARY WITHOUT METADATA OR EXPLANATIONS.`;

  const messages: LLMMessage[] = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: `Please summarize the following ${contextType} content:\n\n${content}`,
    },
  ];

  const provider: LLMProvider = {
    apiUrl: `${env.OPENAI_API_BASE}/chat/completions`,
    apiKey: env.OPENAI_API_KEY,
  };

  const request = {
    model: env.OPENAI_MODEL,
    messages,
    stream: false,
    max_tokens: Math.ceil(targetLength / 4), // Approximate token count
    temperature: 0.3, // Lower temperature for more consistent summaries
  };

  try {
    let fullResponse = '';

    await invokeLLMWithStream(provider, request, async (chunk: string) => {
      // Parse SSE chunk
      const lines = chunk.split('\n');
      for (const line of lines) {
        if (line.startsWith('data: ') && line !== 'data: [DONE]') {
          try {
            const data = JSON.parse(line.slice(6));
            const content = data.choices?.[0]?.delta?.content;
            if (content) {
              fullResponse += content;
            }
          } catch (e) {
            // Ignore parsing errors
          }
        }
      }
    });

    return fullResponse.trim();
  } catch (error) {
    throw new Error(
      `Failed to generate summary: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

export const summarizeTool = createTool({
  name: 'summarize' as const,
  description:
    'Generate context-aware summaries that preserve critical information while reducing length. Supports different content types and compression levels to minimize context loss.',
  parameters: SummarizeParametersSchema,
  execute: async ({
    content,
    context_type,
    max_length,
    preserve_key_points,
    compression_ratio,
  }) => {
    try {
      // Validate content length
      if (content.length > 100000) {
        return {
          success: false,
          error:
            'Content too large for summarization (max 100,000 characters). Consider breaking into smaller chunks.',
          suggestions: [
            'Split the content into smaller sections',
            'Use a heavier compression ratio',
            'Focus on specific portions of the content',
          ],
        };
      }

      const summary = await generateSummary(
        content,
        context_type,
        max_length,
        preserve_key_points,
        compression_ratio
      );

      // Calculate compression metrics
      const originalLength = content.length;
      const summaryLength = summary.length;
      const actualCompression = Math.round((1 - summaryLength / originalLength) * 100);

      return {
        success: true,
        summary,
        metadata: {
          original_length: originalLength,
          summary_length: summaryLength,
          compression_percentage: actualCompression,
          context_type,
          compression_ratio,
          key_points_preserved: preserve_key_points,
        },
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : 'Unknown error occurred during summarization',
        suggestions: [
          'Check if the content is valid text',
          'Try with a smaller content size',
          'Verify OpenAI API configuration',
        ],
      };
    }
  },
});
