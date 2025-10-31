# CRUSH.md - Agent Guide for Agentic Tool Calling CLI

This document provides essential information for AI agents working in this TypeScript CLI application for agentic tool calling.

## Project Overview

This is a TypeScript CLI application that implements an interactive agentic tool calling system. It provides a React-based CLI interface using Ink, with tools for code search and file operations.

## Essential Commands

### Development
- `npm run dev` - Run development server with ts-node
- `npm run build` - Build TypeScript to JavaScript
- `npm start` - Run built application
- `npm run demo` - Run demo with environment variable check

### Environment Setup
- Copy `.env.example` to `.env` and set required environment variables:
  - `OPENAI_API_KEY` - Required for LLM API access
  - `OPENAI_API_BASE` - Optional, defaults to "https://api.openai.com/v1"
  - `OPENAI_MODEL` - Optional, defaults to "gpt-3.5-turbo"

## Project Structure

```
src/
├── env.ts              # Environment validation with Zod
├── index.tsx           # Main CLI application (React/Ink)
├── llm/
│   ├── client.llm.ts   # LLM API client with streaming
│   └── history.llm.ts  # Conversation history management
├── prompts/
│   └── system.tool-calling.ts  # System prompt for tool calling
├── tools/
│   ├── tool.registry.ts        # Tool registration system
│   ├── grep.tool.ts            # Regex-based file content search
│   └── glob.tool.ts            # File pattern matching
└── utils/
    └── logger.ts       # Winston-based logging
```

## Code Patterns and Conventions

### TypeScript Configuration
- **Module System**: ES Modules (`"type": "module"`)
- **Target**: ES2020
- **JSX**: React JSX with `"jsx": "react-jsx"`
- **Strict**: Enabled with strict type checking
- **Output**: `dist/` directory

### Tool System Architecture
- **Zod-Based Validation**: Tools use Zod schemas for parameter validation and descriptions
- **Tool Interface**: Each tool implements `ToolDefinition` with Zod schema for parameters
- **Registry Pattern**: Central tool registry manages available tools
- **XML Format**: Tools are called using XML-style tags in the ACTION section
- **Automatic Validation**: Parameter validation happens automatically via Zod schemas

### Key Dependencies
- **React/Ink**: CLI UI framework
- **Winston**: Structured logging
- **Zod**: Environment validation
- **dotenv**: Environment variable loading

## Tool System Details

### Available Tools
1. **grep** - Search file contents with regex patterns
   - Parameters: `pattern` (required), `path` (optional), `include` (optional file pattern)
   - Recursively searches directories, skips `node_modules` and `.git`

2. **glob** - Find files by name patterns
   - Parameters: `pattern` (required), `path` (optional), `include` (optional file pattern)
   - Uses standard glob patterns

3. **read** - Read and display file contents with line numbers
   - Parameters: `path` (required), `limit` (optional, default: 2000), `offset` (optional, default: 0)
   - Supports large files with line limits and offsets
   - Returns formatted content with 1-based line numbers

### Tool Calling Format
Agents must follow this exact format:

```
### THINKING
[Reasoning process]

### ACTION
<tool_name>
<parameter1>value1</parameter1>
<parameter2>value2</parameter2>
</tool_name>

### RESPONSE
[Final answer]
```

**Critical Requirements**:
- Section headers must be exactly `### THINKING`, `### ACTION`, `### RESPONSE`
- ACTION section contains ONLY XML tool call
- Each parameter on separate lines
- One blank line between sections

## Development Workflow

### Adding New Tools
1. Create tool file in `src/tools/` using the Zod-based pattern
2. Define Zod schema for parameters with descriptions
3. Use `createTool` helper from `tool.base.ts`
4. Implement `execute` method with validated parameters
5. Register tool in `tool.registry.ts`
6. Parameter descriptions are automatically extracted from Zod schemas for the system prompt

### Zod Tool Pattern Example
```typescript
import { z } from "zod";
import { createTool } from "./tool.base.js";

const MyToolParametersSchema = z.object({
  pattern: z.string().min(1).describe("Pattern description"),
  path: z.string().optional().default(".").describe("Path description"),
});

export const myTool = createTool({
  name: "mytool" as const,
  description: "Tool description",
  parameters: MyToolParametersSchema,
  execute: async ({ pattern, path }) => {
    // Implementation with validated parameters
  },
});
```

### Testing
- Current test script is placeholder: `npm test`
- Manual testing via CLI: `npm run dev`
- Check logs in `logs/` directory for debugging

### Building and Running
1. Set environment variables in `.env`
2. `npm run build` to compile TypeScript
3. `npm start` to run the application
4. Use `npm run dev` for development with hot reload

## Gotchas and Important Notes

### Environment Variables
- Application fails to start without `OPENAI_API_KEY`
- Environment validation happens at startup via Zod schema
- Logs show environment loading status

### Tool Execution
- **Zod Validation**: All tool parameters are automatically validated using Zod schemas
- **Type Safety**: Parameter types are enforced at runtime with descriptive error messages
- **Default Values**: Zod schemas can define default values for optional parameters
- **Parameter Descriptions**: Descriptions are extracted from Zod schemas for the system prompt
- Tools run synchronously in the main thread
- Large files (>1MB) are skipped in grep searches
- Binary files are automatically skipped
- Tool results are limited to prevent memory issues

### Tool Usage Examples

#### Read Tool Examples
```xml
<!-- Read entire file -->
<read>
<path>src/index.tsx</path>
</read>

<!-- Read file with line limit -->
<read>
<path>package.json</path>
<limit>10</limit>
</read>

<!-- Read file starting from specific line -->
<read>
<path>src/tools/read.tool.ts</path>
<offset>5</offset>
<limit>5</limit>
</read>
```

#### Grep Tool Examples
```xml
<!-- Search for functions -->
<grep>
<pattern>function\s+\w+</pattern>
<include>*.ts</include>
</grep>

<!-- Search in specific directory -->
<grep>
<pattern>console\.log</pattern>
<path>src</path>
</grep>
```

#### Glob Tool Examples
```xml
<!-- Find all TypeScript files -->
<glob>
<pattern>**/*.ts</pattern>
</glob>

<!-- Find files in specific directory -->
<glob>
<pattern>*.tool.ts</pattern>
<path>src/tools</path>
</glob>
```

### UI/UX
- CLI uses React/Ink for interactive interface
- Press `Enter` to submit input
- Press `Escape` or `Ctrl+C` to exit
- Real-time streaming of LLM responses

### Logging
- Winston logger configured for development/production
- Logs to console and files in `logs/` directory
- Development: debug level, Production: warn level

## File Path Conventions

- Use absolute paths when referencing files
- Source code lives in `src/` directory
- Built output goes to `dist/`
- Logs are stored in `logs/`
- Environment file: `.env` (not committed)

## Agent Guidelines

When working in this codebase:

1. **Always use tools first** - Search code with grep/glob before making assumptions
2. **Follow the tool calling format** - Strict adherence to the XML format is required
3. **Check environment setup** - Verify `.env` exists with required variables
4. **Use TypeScript patterns** - Follow existing code style and type safety
5. **Test interactively** - Run `npm run dev` to test tool functionality

This project demonstrates a complete agentic tool calling system that can be extended with additional tools and capabilities.