import { z } from 'zod';
import { spawn } from 'child_process';
import { createTool, type ToolDefinition } from './tool.base.js';
import { validateEnv } from '../env.js';

// Zod schema for aider tool parameters
const AiderParametersSchema = z.object({
  instruction: z
    .string()
    .min(1, 'Instruction cannot be empty')
    .describe('The instruction for aider to execute (what code changes to make)'),
  files: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform(val => {
      if (typeof val === 'string') return [val];
      return val || [];
    })
    .describe('File path(s) to focus on (can be string or array of strings)'),
  model: z
    .string()
    .optional()
    .describe('OpenAI-compatible model to use (defaults to OPENAI_MODEL from env)'),
});

export type AiderParameters = z.infer<typeof AiderParametersSchema>;

export interface AiderTool extends ToolDefinition<typeof AiderParametersSchema> {
  name: 'aider';
}

function executeAiderCommand(
  instruction: string,
  files: string[],
  model?: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      const env = validateEnv();

      // Build the aider command
      const args = [
        '--yes', // Auto-confirm all prompts
        '--no-auto-commits', // Don't auto-commit
        '--no-git', // Don't use git
        '--model',
        model || 'openai/' + env.OPENAI_MODEL,
        '--message',
        instruction,
        ...files,
      ];

      // Set environment variables for OpenAI
      const envVars = {
        ...process.env,
        OPENAI_API_KEY: env.OPENAI_API_KEY,
        OPENAI_API_BASE: env.OPENAI_API_BASE,
      };

      const aiderProcess = spawn('aider', args, {
        env: envVars,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      aiderProcess.stdout.on('data', data => {
        stdout += data.toString();
      });

      aiderProcess.stderr.on('data', data => {
        stderr += data.toString();
      });

      aiderProcess.on('close', code => {
        if (code === 0) {
          resolve(stdout || 'Aider completed successfully');
        } else {
          reject(new Error(`Aider process exited with code ${code}: ${stderr || stdout}`));
        }
      });

      aiderProcess.on('error', error => {
        reject(new Error(`Failed to start aider process: ${error.message}`));
      });

      // Set a timeout for the aider process (10 minutes)
      const timeout = setTimeout(
        () => {
          aiderProcess.kill();
          reject(new Error('Aider process timed out after 10 minutes'));
        },
        10 * 60 * 1000
      );

      aiderProcess.on('close', () => {
        clearTimeout(timeout);
      });
    } catch (error) {
      reject(error);
    }
  });
}

export const aiderTool = createTool({
  name: 'aider' as const,
  description:
    'Execute aider commands to edit code using AI. Uses OpenAI-compatible models for code generation and editing.',
  parameters: AiderParametersSchema,
  execute: async ({ instruction, files, model }) => {
    try {
      const result = await executeAiderCommand(instruction, files, model);
      return {
        success: true,
        output: result,
        message: 'Aider executed successfully',
      };
    } catch (error) {
      return {
        success: false,
        output: null,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  },
});
