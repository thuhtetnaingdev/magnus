import { z } from "zod";
import { readFileSync, statSync } from "fs";
import { resolve } from "path";
import { createTool, type ToolDefinition } from "./tool.base.js";

// Zod schema for read tool parameters
const ReadParametersSchema = z.object({
  path: z
    .string()
    .min(1, "Path cannot be empty")
    .describe("The file path to read (absolute or relative to current working directory)"),
  limit: z
    .number()
    .int()
    .min(1)
    .max(10000)
    .optional()
    .default(2000)
    .describe("Maximum number of lines to read (default: 2000, max: 10000)"),
  offset: z
    .number()
    .int()
    .min(0)
    .optional()
    .default(0)
    .describe("Line number to start reading from (0-based, default: 0)"),
});

export type ReadParameters = z.infer<typeof ReadParametersSchema>;

export interface ReadTool extends ToolDefinition<typeof ReadParametersSchema> {
  name: "read";
}

export const readTool = createTool({
  name: "read" as const,
  description: "Read and display the contents of a file with line numbers",
  parameters: ReadParametersSchema,
  execute: async ({ path, limit, offset }) => {
    const filePath = resolve(path);
    
    // Check if file exists and is readable
    try {
      const stats = statSync(filePath);
      
      if (!stats.isFile()) {
        throw new Error(`Path is not a file: ${filePath}`);
      }
      
      // Check file size to avoid reading huge files
      if (stats.size > 10 * 1024 * 1024) { // 10MB limit
        throw new Error(`File too large: ${filePath} (${stats.size} bytes)`);
      }
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        throw new Error(`File not found: ${filePath}`);
      }
      throw error;
    }
    
    // Read the file
    const content = readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    
    // Apply offset and limit
    const startLine = Math.min(offset, lines.length);
    const endLine = Math.min(startLine + limit, lines.length);
    const slicedLines = lines.slice(startLine, endLine);
    
    // Format output with line numbers
    const formattedLines = slicedLines.map((line, index) => ({
      lineNumber: startLine + index + 1, // 1-based line numbers for display
      content: line,
    }));
    
    return {
      file: filePath,
      totalLines: lines.length,
      linesRead: slicedLines.length,
      startLine: startLine + 1,
      endLine: endLine,
      content: formattedLines,
      truncated: endLine < lines.length,
    };
  },
});