import { z } from 'zod';
import { existsSync } from 'fs';
import { execSync } from 'child_process';
import { createTool } from './tool.base.js';

const buildParameters = z.object({
  path: z.string().optional().default('.').describe('Path to the project directory'),
  clean: z.boolean().optional().default(false).describe('Clean build artifacts before building'),
  verbose: z.boolean().optional().default(false).describe('Show verbose output'),
});

export const buildTool = createTool({
  name: 'build',
  description: 'Automatically detect project type and run appropriate build command',
  parameters: buildParameters,
  execute: async ({ path, clean, verbose }) => {
    const projectPath = path || '.';

    // Detect project type based on configuration files
    const projectType = detectProjectType(projectPath);

    if (!projectType) {
      return {
        success: false,
        message: 'Could not detect project type. No recognized build configuration found.',
        projectType: 'unknown',
        buildCommand: null,
        output: '',
      };
    }

    let buildCommand: string | null = null;
    let cleanCommand: string | null = null;

    // Determine build commands based on project type
    switch (projectType) {
      case 'node-typescript':
        buildCommand = 'npm run build';
        cleanCommand = 'npm run clean';
        break;
      case 'node-javascript':
        buildCommand = 'npm run build';
        break;
      case 'go':
        buildCommand = 'go build ./...';
        cleanCommand = 'go clean';
        break;
      case 'python':
        buildCommand = 'python -m build';
        break;
      case 'rust':
        buildCommand = 'cargo build';
        cleanCommand = 'cargo clean';
        break;
      case 'java':
        buildCommand = existsSync(`${projectPath}/gradlew`) ? './gradlew build' : './mvnw compile';
        cleanCommand = existsSync(`${projectPath}/gradlew`) ? './gradlew clean' : './mvnw clean';
        break;
    }

    try {
      let output = `Detected project type: ${projectType}\n`;

      // Run clean if requested
      if (clean && cleanCommand) {
        output += `Running clean: ${cleanCommand}\n`;
        const cleanResult = execSync(cleanCommand, {
          cwd: projectPath,
          encoding: 'utf-8',
          stdio: verbose ? 'inherit' : 'pipe',
        });
        output += cleanResult;
      }

      // Run build command
      if (buildCommand) {
        output += `Running build: ${buildCommand}\n`;
        const buildResult = execSync(buildCommand, {
          cwd: projectPath,
          encoding: 'utf-8',
          stdio: verbose ? 'inherit' : 'pipe',
        });
        output += buildResult;
      }

      return {
        success: true,
        message: `Build completed successfully for ${projectType} project`,
        projectType,
        buildCommand,
        output,
      };
    } catch (error: any) {
      return {
        success: false,
        message: `Build failed for ${projectType} project`,
        projectType,
        buildCommand,
        output: error.stdout || error.stderr || error.message,
        error: error.message,
      };
    }
  },
});

function detectProjectType(projectPath: string): string | null {
  // Check for package.json (Node.js projects)
  if (existsSync(`${projectPath}/package.json`)) {
    try {
      const packageJson = JSON.parse(
        execSync(`cat ${projectPath}/package.json`, { encoding: 'utf-8' })
      );

      // Check if it's TypeScript
      if (
        packageJson.devDependencies?.typescript ||
        packageJson.dependencies?.typescript ||
        existsSync(`${projectPath}/tsconfig.json`)
      ) {
        return 'node-typescript';
      }

      // Check for build script
      if (packageJson.scripts?.build) {
        return 'node-javascript';
      }

      return 'node';
    } catch {
      return 'node';
    }
  }

  // Check for Go
  if (existsSync(`${projectPath}/go.mod`)) {
    return 'go';
  }

  // Check for Python
  if (
    existsSync(`${projectPath}/pyproject.toml`) ||
    existsSync(`${projectPath}/setup.py`) ||
    existsSync(`${projectPath}/requirements.txt`)
  ) {
    return 'python';
  }

  // Check for Rust
  if (existsSync(`${projectPath}/Cargo.toml`)) {
    return 'rust';
  }

  // Check for Java
  if (
    existsSync(`${projectPath}/build.gradle`) ||
    existsSync(`${projectPath}/build.gradle.kts`) ||
    existsSync(`${projectPath}/pom.xml`)
  ) {
    return 'java';
  }

  // Check for Makefile
  if (existsSync(`${projectPath}/Makefile`)) {
    return 'make';
  }

  return null;
}
