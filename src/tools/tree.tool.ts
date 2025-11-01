import { z } from 'zod';
import { readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { createTool, type ToolDefinition } from './tool.base.js';

// Zod schema for tree tool parameters
const TreeParametersSchema = z.object({
  path: z
    .string()
    .optional()
    .default('.')
    .describe(
      'The directory to generate tree structure for (defaults to current working directory)'
    ),
  maxDepth: z
    .number()
    .int()
    .min(1)
    .max(10)
    .optional()
    .default(3)
    .describe('Maximum depth to traverse (1-10, defaults to 3)'),
  includeHidden: z
    .boolean()
    .optional()
    .default(false)
    .describe('Include hidden files and directories (defaults to false)'),
});

export type TreeParameters = z.infer<typeof TreeParametersSchema>;

export interface TreeTool extends ToolDefinition<typeof TreeParametersSchema> {
  name: 'tree';
}

interface TreeNode {
  name: string;
  type: 'file' | 'directory';
  children?: TreeNode[];
}

export const treeTool = createTool({
  name: 'tree' as const,
  description:
    'Generate a tree structure showing the project directory hierarchy for better project overview and file understandability',
  parameters: TreeParametersSchema,
  execute: async ({ path, maxDepth, includeHidden }) => {
    const rootPath = resolve(path);

    function buildTree(currentPath: string, currentDepth: number = 0): TreeNode[] {
      if (currentDepth >= maxDepth) {
        return [];
      }

      try {
        const items = readdirSync(currentPath);
        const tree: TreeNode[] = [];

        for (const item of items) {
          // Skip hidden files/directories unless explicitly included
          if (!includeHidden && item.startsWith('.')) {
            continue;
          }

          const fullPath = join(currentPath, item);

          try {
            const stats = statSync(fullPath);

            if (stats.isDirectory()) {
              // Skip common directories that aren't relevant for project structure
              if (['node_modules', '.git', 'dist', 'build', 'coverage'].includes(item)) {
                continue;
              }

              const node: TreeNode = {
                name: item,
                type: 'directory',
                children: buildTree(fullPath, currentDepth + 1),
              };
              tree.push(node);
            } else if (stats.isFile()) {
              // Only include files that might be relevant for project understanding
              const relevantExtensions = [
                '.ts',
                '.tsx',
                '.js',
                '.jsx',
                '.json',
                '.md',
                '.txt',
                '.yml',
                '.yaml',
                '.toml',
                '.toml',
                '.lock',
                '.env',
                '.gitignore',
                '.dockerignore',
              ];

              const hasRelevantExtension = relevantExtensions.some(ext => item.endsWith(ext));

              // Include files with relevant extensions or important config files
              if (
                hasRelevantExtension ||
                ['package.json', 'tsconfig.json', 'README.md'].includes(item)
              ) {
                tree.push({
                  name: item,
                  type: 'file',
                });
              }
            }
          } catch (statError) {
            // Skip items we can't stat
            continue;
          }
        }

        // Sort directories first, then files, both alphabetically
        tree.sort((a, b) => {
          if (a.type === 'directory' && b.type === 'file') return -1;
          if (a.type === 'file' && b.type === 'directory') return 1;
          return a.name.localeCompare(b.name);
        });

        return tree;
      } catch (dirError) {
        throw new Error(`Cannot read directory: ${currentPath}`);
      }
    }

    function formatTree(nodes: TreeNode[], prefix: string = '', isLast: boolean[] = []): string {
      let result = '';

      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        const isLastNode = i === nodes.length - 1;

        // Build the current line
        let line = prefix;

        // Add tree structure characters
        for (const last of isLast) {
          line += last ? '    ' : '│   ';
        }

        line += isLastNode ? '└── ' : '├── ';

        // Add file/directory name with appropriate icon
        const icon = node.type === 'directory' ? '📁 ' : '📄 ';
        line += icon + node.name;

        result += line + '\n';

        // Recursively format children
        if (node.type === 'directory' && node.children && node.children.length > 0) {
          result += formatTree(node.children, prefix, [...isLast, isLastNode]);
        }
      }

      return result;
    }

    const treeStructure = buildTree(rootPath);
    const formattedTree = formatTree(treeStructure);

    return {
      tree: formattedTree,
      rootPath,
      maxDepth,
      totalItems: countItems(treeStructure),
    };
  },
});

function countItems(nodes: TreeNode[]): { directories: number; files: number } {
  let directories = 0;
  let files = 0;

  function count(node: TreeNode): void {
    if (node.type === 'directory') {
      directories++;
      if (node.children) {
        node.children.forEach(count);
      }
    } else {
      files++;
    }
  }

  nodes.forEach(count);

  return { directories, files };
}
