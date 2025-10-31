# Agentic CLI Tool

An interactive command-line interface that combines the power of LLM integration with a rich terminal UI built on React and Ink. This tool enables intelligent file system operations and code assistance through an agentic architecture.

## Features

- **Interactive Terminal UI**: Built with React and Ink for a modern, responsive CLI experience
- **Tool System**: Extensible architecture with built-in tools for file operations
- **LLM Integration**: Seamless integration with language models for intelligent assistance
- **Real-time Feedback**: Live updates and status indicators during operations
- **Cross-platform**: Works on macOS, Linux, and Windows

## Prerequisites

- Node.js (version 18 or higher)
- npm (version 8 or higher)
- An OpenAI API key or compatible LLM service

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd agentic-cli-tool
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp .env.example .env
# Edit .env and add your API keys
```

### Environment Variables

Create a `.env` file in the root directory with:

```env
OPENAI_API_KEY=your_openai_api_key_here
# Optional: For alternative LLM providers
ANTHROPIC_API_KEY=your_anthropic_api_key_here
```

## Usage

### Basic Usage

Run the interactive CLI:
```bash
npm start
```

### Development Mode

Run with hot reload for development:
```bash
npm run dev
```

### Build and Run

Build the project and run the compiled version:
```bash
npm run build
npm run start:prod
```

## Project Structure

```
agentic-cli-tool/
├── src/
│   ├── components/          # React components for the UI
│   ├── tools/              # Tool implementations
│   ├── services/           # LLM and external service integrations
│   ├── types/              # TypeScript type definitions
│   └── utils/              # Utility functions
├── dist/                   # Compiled output
├── package.json
├── tsconfig.json
└── README.md
```

## Available Tools

### grep
Search for patterns in files using regex
- **Usage**: Search file contents with regular expressions
- **Options**: Case-sensitive/insensitive, file type filtering

### glob
File pattern matching and listing
- **Usage**: Find files using glob patterns (e.g., `**/*.ts`)
- **Options**: Recursive search, exclude patterns

### read
Read and display file contents
- **Usage**: View file contents with syntax highlighting
- **Options**: Line numbers, encoding selection

### tree
Display directory structure
- **Usage**: Visualize folder hierarchy
- **Options**: Depth limiting, file size display

### aider
AI-powered code assistance
- **Usage**: Get help with code modifications and explanations
- **Options**: Context-aware suggestions, multi-file operations

## Development Workflow

1. **Fork the repository** and create your feature branch
2. **Install dependencies**: `npm install`
3. **Make your changes** following the existing code style
4. **Test your changes**: `npm test`
5. **Build the project**: `npm run build`
6. **Submit a pull request** with a clear description

### Adding New Tools

1. Create a new tool file in `src/tools/`
2. Implement the tool interface
3. Register the tool in the tool registry
4. Add tests for your tool
5. Update this README with tool documentation

## Configuration

The application can be configured through:

- **Environment variables** (API keys, service URLs)
- **Config file** (`config.json` in the project root)
- **Command-line flags** (use `--help` for options)

### Example Configuration

```json
{
  "llm": {
    "provider": "openai",
    "model": "gpt-4",
    "maxTokens": 2000
  },
  "tools": {
    "maxResults": 100,
    "timeout": 30000
  }
}
```

## Contributing

We welcome contributions! Please see our [Contributing Guidelines](CONTRIBUTING.md) for details.

### Quick Start for Contributors

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit your changes: `git commit -m 'Add amazing feature'`
4. Push to the branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

### Code Style

- Use TypeScript for all new code
- Follow the existing code style and formatting
- Add tests for new features
- Update documentation as needed

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Support

If you encounter any issues or have questions:
- Check the [Issues](https://github.com/your-repo/issues) page
- Create a new issue with a detailed description
- Join our community discussions

## Acknowledgments

- Built with [Ink](https://github.com/vadimdemedes/ink) for the React-based CLI UI
- Powered by OpenAI and other LLM providers
- Inspired by modern developer tools and agentic AI systems
