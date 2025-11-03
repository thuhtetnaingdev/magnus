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

#### Sequential Tool Calling
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

#### Parallel Tool Calling
```
### THINKING
[Reasoning process - explain why parallel execution is appropriate]

### ACTION
<tool_name1>
<parameter1>value1</parameter1>
<parameter2>value2</parameter2>
</tool_name1>
<tool_name2>
<parameter1>value1</parameter1>
<parameter2>value2</parameter2>
</tool_name2>

### RESPONSE
[Final answer]
```

**Critical Requirements**:

- Section headers must be exactly `### THINKING`, `### ACTION`, `### RESPONSE`
- ACTION section contains ONLY XML tool call(s)
- Each parameter on separate lines
- One blank line between sections
- For parallel calls: tools must be independent (no dependencies)

### Parallel Tool Calling Strategy

#### When to Use Parallel Tool Calling
- **Independent Operations**: Tools that don't depend on each other's results
- **Exploration Tasks**: Multiple searches or file operations that can run concurrently
- **Performance Optimization**: When waiting for sequential execution would be inefficient
- **Comprehensive Analysis**: Gathering multiple perspectives on a project simultaneously

#### When to Use Sequential Tool Calling
- **Dependent Operations**: When one tool's output is needed for another tool
- **Complex Workflows**: Multi-step processes that require verification at each step
- **Code Modification**: When using aider tool for code changes (should be sequential)
- **Error Recovery**: When previous tool execution failed and needs correction

#### Best Practices for Parallel Tool Calling
1. **Analyze Dependencies**: Ensure tools are truly independent before using parallel execution
2. **Limit Scope**: Don't overload with too many parallel tools (2-3 is usually optimal)
3. **Monitor Performance**: Be aware that some tools (like aider) may be resource-intensive
4. **Plan for Errors**: Handle cases where some tools succeed while others fail
5. **Use Thoughtfully**: Parallel execution is powerful but should be used strategically

### Recursive Tool Calling Workflow

The system now supports both sequential and parallel tool calling, allowing the LLM to make multiple tool calls either sequentially or concurrently:

#### Sequential Tool Calling
1. **Initial Request**: User sends query
2. **LLM Response**: LLM analyzes and may include tool call in ACTION section
3. **Tool Execution**: System executes the tool and gets result
4. **Recursive Check**: If tool call detected, result is added to conversation and LLM is called again
5. **Iteration**: Process repeats (max 10 iterations) until no more tool calls
6. **Final Response**: LLM provides final answer in RESPONSE section

#### Parallel Tool Calling
1. **Initial Request**: User sends query
2. **LLM Response**: LLM analyzes and includes multiple independent tool calls in ACTION section
3. **Parallel Execution**: System executes all tools concurrently using Promise.all
4. **Results Aggregation**: All tool results are collected and combined
5. **Next Iteration**: Combined results are added to conversation and LLM is called again
6. **Final Response**: LLM provides final answer in RESPONSE section

This enables complex multi-step workflows like:

- **Sequential**: Search for files → Read specific file → Analyze content
- **Sequential**: Find patterns → Get more context → Provide comprehensive answer
- **Parallel**: Search for files AND get project structure simultaneously
- **Parallel**: Read package.json AND examine directory structure concurrently
- **Mixed**: Parallel exploration followed by sequential analysis

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
import { z } from 'zod';
import { createTool } from './tool.base.js';

const MyToolParametersSchema = z.object({
  pattern: z.string().min(1).describe('Pattern description'),
  path: z.string().optional().default('.').describe('Path description'),
});

export const myTool = createTool({
  name: 'mytool' as const,
  description: 'Tool description',
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
- **Recursive Tool Calling**: The system supports recursive tool calling - LLM can continue calling tools until it has all needed information
- **Maximum Iterations**: Recursive calls limited to 10 iterations to prevent infinite loops
- Tools run synchronously in the main thread
- Large files (>1MB) are skipped in grep searches
- Binary files are automatically skipped
- Tool results are limited to prevent memory issues

### Tool Usage Examples

#### Sequential Tool Examples

```xml
<!-- Read entire file -->
<read>
<path>src/index.tsx</path>
</read>

<!-- Search for functions -->
<grep>
<pattern>function\s+\w+</pattern>
<include>*.ts</include>
</grep>

<!-- Find all TypeScript files -->
<glob>
<pattern>**/*.ts</pattern>
</glob>
```

#### Parallel Tool Examples

```xml
<!-- Multiple independent searches -->
<glob>
<pattern>**/*.ts</pattern>
<path>src</path>
</glob>
<tree>
<path>.</path>
<maxDepth>2</maxDepth>
</tree>

<!-- Comprehensive project analysis -->
<read>
<path>/Users/username/project/package.json</path>
</read>
<glob>
<pattern>**/*.ts</pattern>
<path>.</path>
</glob>
<tree>
<path>.</path>
<maxDepth>3</maxDepth>
</tree>

<!-- Mixed exploration -->
<grep>
<pattern>(auth|login|authenticate)</pattern>
<path>.</path>
<include>*.{ts,js,tsx,jsx}</include>
</grep>
<glob>
<pattern>**/*.ts</pattern>
<path>.</path>
</glob>
```

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

#### Aider Tool Examples

```xml
<!-- Execute aider with instruction and files (diff mode) -->
<aider>
<instruction>Create a new function that handles user authentication</instruction>
<files>/Users/username/project/src/auth.ts</files>
<editFormat>diff</editFormat>
</aider>

<!-- Multiple files: Use separate <files> tags for each file -->
<aider>
<instruction>Create a new component that follows the pattern from existing components</instruction>
<files>/Users/username/project/src/components/NewComponent.tsx</files>
<files>/Users/username/project/src/components/ExistingComponent.tsx</files>
<editFormat>diff</editFormat>
</aider>

<!-- Execute aider with specific model -->
<aider>
<instruction>Refactor the database connection logic</instruction>
<files>/Users/username/project/src/db.ts</files>
<model>gpt-4</model>
<editFormat>diff</editFormat>
</aider>

<!-- Execute aider with whole mode (when diff fails multiple times) -->
<aider>
<instruction>Update function with complex changes</instruction>
<files>/Users/username/project/src/complex.ts</files>
<editFormat>whole</editFormat>
</aider>

<!-- Enhanced: Reference multiple files for context -->
<aider>
<instruction>In auth.ts, implement the login function using the JWT pattern from utils/jwt.ts. The function should validate credentials and return a token.</instruction>
<files>/Users/username/project/src/auth.ts</files>
<files>/Users/username/project/src/utils/jwt.ts</files>
<editFormat>diff</editFormat>
</aider>

<!-- Enhanced: Modify multiple related files -->
<aider>
<instruction>Update the User interface in types.ts to include email field, then update the createUser function in api.ts to handle the new field</instruction>
<files>/Users/username/project/src/types.ts</files>
<files>/Users/username/project/src/api.ts</files>
<editFormat>diff</editFormat>
</aider>

<!-- Best: Reference specific patterns and line numbers -->
<aider>
<instruction>In auth.ts, implement the login function using the JWT pattern from utils/jwt.ts:45-78. Follow the same error handling pattern as validateUser in auth.ts:23-35. The function should validate credentials and return a token with the same structure as generateToken in utils/jwt.ts:12-25.</instruction>
<files>/Users/username/project/src/auth.ts</files>
<files>/Users/username/project/src/utils/jwt.ts</files>
<editFormat>diff</editFormat>
</aider>

<!-- With comprehensive references -->
<aider>
<instruction>Create a new API endpoint in api/users.ts that follows the same pattern as api/products.ts:15-45. Use the same validation pattern from utils/validation.ts:8-22 and error handling from utils/errors.ts:5-18. The endpoint should handle GET requests and return paginated results like api/products.ts:30-40.</instruction>
<files>/Users/username/project/src/api/users.ts</files>
<files>/Users/username/project/src/api/products.ts</files>
<files>/Users/username/project/src/utils/validation.ts</files>
<files>/Users/username/project/src/utils/errors.ts</files>
<editFormat>diff</editFormat>
</aider>
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
