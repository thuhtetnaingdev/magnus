import { z } from 'zod';
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
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
  reference_files: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform(val => {
      if (typeof val === 'string') return [val];
      return val || [];
    })
    .describe('Reference file path(s) for context (can be string or array of strings)'),
  model: z
    .string()
    .optional()
    .describe('OpenAI-compatible model to use (defaults to OPENAI_MODEL from env)'),
  editFormat: z
    .enum(['diff', 'whole'])
    .describe('Edit format mode: "diff" for patch-style edits, "whole" for full file replacement. Use "whole" for large tasks or when aider fails multiple times with "diff" mode.'),
  timeout: z
    .number()
    .optional()
    .describe('Timeout in seconds (defaults to 600 for large tasks, 180 for small tasks)'),
});

export type AiderParameters = z.infer<typeof AiderParametersSchema>;

export interface AiderTool extends ToolDefinition<typeof AiderParametersSchema> {
  name: 'aider';
}

function executeAiderCommand(
  instruction: string,
  files: string[],
  model?: string,
  editFormat?: 'diff' | 'whole',
  timeoutSeconds?: number
): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      const env = validateEnv();

      // Determine timeout based on task complexity
      const defaultTimeout = timeoutSeconds || (files.length > 5 || instruction.length > 1000 ? 600 : 180);
      const timeoutMs = defaultTimeout * 1000;

      // Build the aider command
      const args = [
        '--yes', // Auto-confirm all prompts
        '--no-auto-commits', // Don't auto-commit
        '--no-git', // Don't use git
        '--model',
        model || 'openai/' + env.OPENAI_MODEL,
        '--message',
        instruction,
      ];

      // Check for .modal.setting.yml in current directory, then home directory
      let modalSettingsPath: string | null = null;
      const currentDirPath = join(process.cwd(), '.modal.setting.yml');
      const homeDirPath = join(process.env.HOME || process.env.USERPROFILE || '', '.modal.setting.yml');
      
      if (existsSync(currentDirPath)) {
        modalSettingsPath = currentDirPath;
      } else if (homeDirPath && existsSync(homeDirPath)) {
        modalSettingsPath = homeDirPath;
      }
      
      if (modalSettingsPath) {
        args.push('--model-metadata-file', modalSettingsPath);
      }

      // Add edit format parameter if specified
      if (editFormat) {
        args.push('--edit-format', editFormat);
      }

      // Add files at the end
      args.push(...files);

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

      // Set a timeout for the aider process with enhanced error handling
      const timeout = setTimeout(
        () => {
          aiderProcess.kill('SIGTERM'); // Try graceful shutdown first
          
          // Force kill after 10 seconds if graceful shutdown fails
          const forceKillTimeout = setTimeout(() => {
            aiderProcess.kill('SIGKILL');
          }, 10000);

          aiderProcess.on('close', () => {
            clearTimeout(forceKillTimeout);
          });

          const timeoutMessage = `Aider process timed out after ${defaultTimeout} seconds. `;
          
          if (files.length > 5) {
            reject(new Error(timeoutMessage + 'Large task detected. Consider breaking into smaller tasks or using "whole" edit format.'));
          } else if (instruction.length > 1000) {
            reject(new Error(timeoutMessage + 'Long instruction detected. Consider simplifying the instruction or breaking into smaller tasks.'));
          } else {
            reject(new Error(timeoutMessage + 'The task may be too complex. Try using "whole" edit format or break into smaller tasks.'));
          }
        },
        timeoutMs
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
    'Execute aider commands to edit code using AI. Uses OpenAI-compatible models for code generation and editing. Edit format must be specified: "diff" for patch-style edits, "whole" for full file replacement. Use "whole" for large tasks or when aider fails multiple times with "diff" mode. Automatically adjusts timeout based on task complexity.',
  parameters: AiderParametersSchema,
  execute: async ({ instruction, files, reference_files, model, editFormat, timeout }) => {
    try {
      // Combine files and reference_files, removing duplicates
      const allFiles = Array.from(new Set([...files, ...reference_files]));
      
      // Auto-detect if this is a large task and adjust edit format if needed
      let finalEditFormat = editFormat;
      if (!editFormat) {
        // Auto-select "whole" format for large tasks
        if (allFiles.length > 5 || instruction.length > 1000) {
          finalEditFormat = 'whole';
        } else {
          finalEditFormat = 'diff';
        }
      }
      
      const result = await executeAiderCommand(instruction, allFiles, model, finalEditFormat, timeout);
      return {
        success: true,
        output: result,
        message: 'Aider executed successfully',
        metadata: {
          filesProcessed: allFiles.length,
          editFormat: finalEditFormat,
          instructionLength: instruction.length,
        }
      };
    } catch (error) {
      return {
        success: false,
        output: null,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        suggestions: error instanceof Error && error.message.includes('timed out') ? [
          'Try breaking the task into smaller, more focused changes',
          'Use "whole" edit format for complex changes',
          'Increase the timeout parameter for large tasks',
          'Reduce the number of files being modified in a single call'
        ] : []
      };
    }
  },
});
