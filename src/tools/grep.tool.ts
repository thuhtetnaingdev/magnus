export interface GrepTool {
  name: "grep";
  description: "Search for patterns in files using regular expressions";
  parameters: {
    pattern: string;
    path?: string;
    include?: string;
  };
  execute: (params: {
    pattern: string;
    path?: string;
    include?: string;
  }) => Promise<{
    matches: Array<{
      file: string;
      line: number;
      content: string;
    }>;
  }>;
}

import { readFileSync, readdirSync, statSync } from "fs";
import { join, resolve } from "path";

export const grepTool: GrepTool = {
  name: "grep",
  description: "Search for patterns in files using regular expressions",
  parameters: {
    pattern: "The regex pattern to search for in file contents",
    path: "The directory to search in (defaults to current working directory)",
    include: "File pattern to include in the search (e.g. '*.js', '*.{ts,tsx}')",
  },
  execute: async ({ pattern, path = ".", include }) => {
    const searchPath = resolve(path);
    const regex = new RegExp(pattern, "g");
    const matches: Array<{
      file: string;
      line: number;
      content: string;
    }> = [];

    function searchDirectory(dirPath: string): void {
      try {
        const items = readdirSync(dirPath);
        
        for (const item of items) {
          const fullPath = join(dirPath, item);
          
          try {
            const stats = statSync(fullPath);
            
            if (stats.isDirectory()) {
              // Skip node_modules and .git directories
              if (!item.startsWith(".") && item !== "node_modules" && item !== ".git") {
                searchDirectory(fullPath);
              }
            } else if (stats.isFile()) {
              // Check if file matches include pattern
              if (include) {
                const includeRegex = new RegExp(
                  include
                    .replace(/\*/g, ".*")
                    .replace(/\?/g, ".")
                    .replace(/\{([^}]+)\}/g, "($1)")
                    .replace(/,/g, "|")
                );
                if (!includeRegex.test(item)) {
                  continue;
                }
              }
              
              // Skip binary files and large files
              if (stats.size > 1024 * 1024) { // Skip files larger than 1MB
                continue;
              }
              
              try {
                const content = readFileSync(fullPath, "utf8");
                const lines = content.split("\n");
                
                for (let i = 0; i < lines.length; i++) {
                  const line = lines[i];
                  if (regex.test(line)) {
                    matches.push({
                      file: fullPath,
                      line: i + 1,
                      content: line.trim(),
                    });
                    // Reset regex lastIndex for next test
                    regex.lastIndex = 0;
                  }
                }
              } catch (readError) {
                // Skip files that can't be read (binary files, etc.)
                continue;
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
    
    return { matches };
  },
};