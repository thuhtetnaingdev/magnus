import { z } from 'zod';
import { execSync } from 'child_process';
import { createTool } from './tool.base.js';

const cliParameters = z.object({
  command: z.string().min(1),
  args: z
    .union([z.string(), z.array(z.string())])
    .default([])
    .transform(val => {
      if (typeof val === 'string') {
        // Split string by spaces, handling quoted arguments
        return val.split(/\s+/).filter(arg => arg.trim());
      }
      return val;
    }),
  cwd: z.string().optional(),
});

export const cliTool = createTool({
  name: 'cli',
  description: 'Execute command-line interface commands',
  parameters: cliParameters,
  execute: async ({ command, args, cwd }) => {
    try {
      const fullCommand = [command, ...args].join(' ');
      const result = execSync(fullCommand, {
        cwd: cwd || process.cwd(),
        encoding: 'utf-8',
        stdio: 'pipe',
      });

      return {
        stdout: result,
        stderr: '',
        exitCode: 0,
      };
    } catch (error: any) {
      return {
        stdout: error.stdout || '',
        stderr: error.stderr || error.message,
        exitCode: error.status || 1,
      };
    }
  },
});
