export interface GlobTool {
  name: "glob";
  description: "Search for files by name patterns using glob patterns";
  parameters: {
    pattern: string;
    path?: string;
  };
  execute: (params: {
    pattern: string;
    path?: string;
  }) => Promise<{
    files: Array<{
      path: string;
      name: string;
    }>;
  }>;
}

import { readdirSync, statSync } from "fs";
import { join, resolve, basename } from "path";

export const globTool: GlobTool = {
  name: "glob",
  description: "Search for files by name patterns using glob patterns",
  parameters: {
    pattern: "The glob pattern to match files against (e.g. '**/*.ts', 'grep*.ts', '*.tool.ts')",
    path: "The directory to search in (defaults to current working directory)",
  },
  execute: async ({ pattern, path = "." }) => {
    const searchPath = resolve(path);
    const files: Array<{ path: string; name: string }> = [];

    // Simple glob pattern matching without complex regex
    function matchesPattern(filePath: string, globPattern: string): boolean {
      const segments = filePath.split("/");
      const patternSegments = globPattern.split("/");
      
      let patternIndex = 0;
      let segmentIndex = 0;
      
      while (patternIndex < patternSegments.length && segmentIndex < segments.length) {
        const patternSegment = patternSegments[patternIndex];
        const pathSegment = segments[segmentIndex];
        
        if (patternSegment === "**") {
          // ** matches zero or more segments
          patternIndex++;
          if (patternIndex === patternSegments.length) {
            // ** at the end matches everything
            return true;
          }
          // Skip segments until we find a match for the next pattern
          while (segmentIndex < segments.length) {
            if (matchesPattern(segments.slice(segmentIndex).join("/"), patternSegments.slice(patternIndex).join("/"))) {
              return true;
            }
            segmentIndex++;
          }
          return false;
        } else if (patternSegment.includes("*")) {
          // Handle * wildcards in segment
          const regex = new RegExp(
            "^" + 
            patternSegment
              .replace(/\*/g, "[^/]*")
              .replace(/\?/g, "[^/]")
              .replace(/\./g, "\\.")
            + "$"
          );
          if (!regex.test(pathSegment)) {
            return false;
          }
        } else if (patternSegment !== pathSegment) {
          return false;
        }
        
        patternIndex++;
        segmentIndex++;
      }
      
      return patternIndex === patternSegments.length && segmentIndex === segments.length;
    }

    function searchDirectory(dirPath: string): void {
      try {
        const items = readdirSync(dirPath);
        
        for (const item of items) {
          const fullPath = join(dirPath, item);
          
          try {
            const stats = statSync(fullPath);
            
            if (stats.isDirectory()) {
              // Skip hidden directories and node_modules
              if (!item.startsWith(".") && item !== "node_modules" && item !== ".git") {
                searchDirectory(fullPath);
              }
            } else if (stats.isFile()) {
              // Get relative path from search root
              const relativePath = fullPath.replace(searchPath + "/", "");
              
              // Test if relative path matches the pattern
              if (matchesPattern(relativePath, pattern)) {
                files.push({
                  path: fullPath,
                  name: basename(fullPath),
                });
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
    
    return { files };
  },
};