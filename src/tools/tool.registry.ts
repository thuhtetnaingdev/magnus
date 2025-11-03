import { grepTool } from './grep.tool.js';
import { globTool } from './glob.tool.js';
import { readTool } from './read.tool.js';
import { treeTool } from './tree.tool.js';
import { aiderTool } from './aider.tool.js';
import { cliTool } from './cli.tool.js';

export type Tool =
  | typeof grepTool
  | typeof globTool
  | typeof readTool
  | typeof treeTool
  | typeof aiderTool
  | typeof cliTool;

export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();

  constructor() {
    this.registerTool(grepTool);
    this.registerTool(globTool);
    this.registerTool(readTool);
    this.registerTool(treeTool);
    this.registerTool(aiderTool);
    this.registerTool(cliTool);
  }

  registerTool(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  getTool(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  getAllTools(): Tool[] {
    return Array.from(this.tools.values());
  }

  getToolNames(): string[] {
    return Array.from(this.tools.keys());
  }
}

export const toolRegistry = new ToolRegistry();
