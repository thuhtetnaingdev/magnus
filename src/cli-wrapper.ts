#!/usr/bin/env node
import { isatty } from 'tty';

// Handle command line arguments
const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Agentic Tool Calling CLI
========================

Usage: ts-cli [options]

Options:
  -h, --help     Show this help message
  -v, --version  Show version information

Environment Variables:
  OPENAI_API_KEY     Required - Your OpenAI API key
  OPENAI_API_BASE    Optional - API base URL (default: https://api.openai.com/v1)
  OPENAI_MODEL       Optional - Model to use (default: gpt-3.5-turbo)

Features:
- Interactive agentic tool calling with AI
- File search and analysis tools (grep, glob, read)
- Code editing with aider tool
- Command execution (cli tool)
- Recursive tool calling workflow
- Project structure exploration

Example:
  export OPENAI_API_KEY=your_key_here
  ts-cli

For more information, visit the project repository.
`);
  process.exit(0);
}

if (args.includes('--version') || args.includes('-v')) {
  // Simple version display without package.json import
  console.log('ts-cli v1.0.0');
  process.exit(0);
}

// Check if we're in an interactive terminal
if (isatty(process.stdin.fd) && isatty(process.stdout.fd)) {
  // Interactive mode - use the full Ink interface
  import('./index.js').catch(error => {
    console.error('Failed to start interactive mode:', error.message);
    console.log('\nTry running in a proper terminal environment.');
    process.exit(1);
  });
} else {
  // Non-interactive mode - provide helpful message
  console.log(`
Agentic Tool Calling CLI
========================

This CLI tool requires an interactive terminal environment.

Run 'ts-cli --help' for usage information.
Or run in a proper terminal: ts-cli

Required environment variable: OPENAI_API_KEY
`);
  process.exit(1);
}
