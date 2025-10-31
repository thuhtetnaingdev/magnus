# Aider Tool

This tool integrates aider (https://aider.chat) into the agentic tool calling system, allowing AI agents to execute code editing commands using aider.

## Features

- **OpenAI-Compatible Models**: Uses any OpenAI-compatible model for code generation
- **Environment Integration**: Automatically uses OPENAI_API_KEY, OPENAI_API_BASE, and OPENAI_MODEL from environment
- **Code Editing**: Executes aider commands to make code changes based on natural language instructions
- **File Focus**: Can target specific files for editing
- **Error Handling**: Robust error handling with timeout protection

## Usage

### Parameters

- `instruction` (required): Natural language instruction for what code changes to make
- `files` (optional): Array of file paths to focus on (defaults to all files)
- `model` (optional): OpenAI-compatible model to use (defaults to OPENAI_MODEL from env)

### Example Usage

```typescript
// Edit all files to add error handling
await aiderTool.execute({
  instruction: "Add comprehensive error handling to all functions",
});

// Edit specific files
await aiderTool.execute({
  instruction: "Refactor the UserService class to use dependency injection",
  files: ["src/services/user.service.ts", "src/services/user.service.test.ts"],
  model: "gpt-4",
});
```

## Requirements

- **aider**: Must be installed and available in PATH (`pip install aider-chat`)
- **OpenAI API Key**: Must be set in environment variables
- **OpenAI-Compatible Model**: Model must be accessible via the configured API base

## Environment Variables

- `OPENAI_API_KEY`: Your OpenAI API key
- `OPENAI_API_BASE`: Base URL for OpenAI-compatible API (default: https://api.openai.com/v1)
- `OPENAI_MODEL`: Default model to use (default: gpt-3.5-turbo)

## Aider Flags Used

The tool automatically uses these aider flags:
- `--yes`: Auto-confirm all prompts
- `--no-auto-commits`: Don't auto-commit changes
- `--no-git`: Don't use git integration
- `--model`: Specified model or default from environment
- `--message`: The instruction provided

## Security Notes

- The tool executes aider commands which can modify files
- Always review changes before committing
- Use in controlled environments only
- Consider using version control to track changes