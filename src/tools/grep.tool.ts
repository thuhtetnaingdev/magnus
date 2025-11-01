import { z } from 'zod';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { createTool, type ToolDefinition } from './tool.base.js';

// Zod schema for grep tool parameters
const GrepParametersSchema = z.object({
  pattern: z
    .string()
    .min(1, 'Pattern cannot be empty')
    .describe('The regex pattern to search for in file contents'),
  path: z
    .string()
    .optional()
    .default('.')
    .describe('The directory to search in (defaults to current working directory)'),
  include: z
    .string()
    .optional()
    .describe("File pattern to include in the search (e.g. '*.js', '*.{ts,tsx}')"),
});

export type GrepParameters = z.infer<typeof GrepParametersSchema>;

export interface GrepTool extends ToolDefinition<typeof GrepParametersSchema> {
  name: 'grep';
}

export const grepTool = createTool({
  name: 'grep' as const,
  description: 'Search for patterns in files using regular expressions',
  parameters: GrepParametersSchema,
  execute: async ({ pattern, path, include }) => {
    const searchPath = resolve(path);
    const regex = new RegExp(pattern, 'g');
    const matches: Array<{
      file: string;
      line: number;
      content: string;
    }> = [];

    function searchDirectory(dirPath: string): void {
      try {
        const items = readdirSync(dirPath);

        for (const item of items) {
          const fullPath = join(dirPath, item);

          try {
            const stats = statSync(fullPath);

            if (stats.isDirectory()) {
              // Skip node_modules and .git directories
              if (!item.startsWith('.') && item !== 'node_modules' && item !== '.git') {
                searchDirectory(fullPath);
              }
            } else if (stats.isFile()) {
              // Check if file matches include pattern
              if (include) {
                const includeRegex = new RegExp(
                  include
                    .replace(/\*/g, '.*')
                    .replace(/\?/g, '.')
                    .replace(/\{([^}]+)\}/g, '($1)')
                    .replace(/,/g, '|')
                );
                if (!includeRegex.test(item)) {
                  continue;
                }
              }

              // Skip binary files and large files
              if (stats.size > 1024 * 1024) {
                // Skip files larger than 1MB
                continue;
              }

              try {
                const content = readFileSync(fullPath, 'utf8');
                const lines = content.split('\n');

                for (let i = 0; i < lines.length; i++) {
                  const line = lines[i];
                  if (regex.test(line)) {
                    matches.push({
                      file: fullPath,
                      line: i + 1,
                      content: line.trim(),
                    });
                    // Reset regex lastIndex for next test
                    regex.lastIndex = 0;
                  }
                }
              } catch (readError) {
                // Skip files that can't be read (binary files, etc.)
                continue;
              }
            }
          } catch (statError) {
            // Skip items we can't stat
            continue;
          }
        }
      } catch (dirError) {
        throw new Error(`Cannot read directory: ${dirPath}`);
      }
    }

    searchDirectory(searchPath);

    return { matches };
  },
});
