import { z } from "zod";
import { execSync } from "child_process";
import { createTool } from "./tool.base.js";

const cliParameters = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  cwd: z.string().optional(),
});

export const cliTool = createTool({
  name: "cli",
  description: "Execute command-line interface commands",
  parameters: cliParameters,
  execute: async ({ command, args, cwd }) => {
    try {
      const fullCommand = [command, ...args].join(" ");
      const result = execSync(fullCommand, {
        cwd: cwd || process.cwd(),
        encoding: "utf-8",
        stdio: "pipe",
      });
      
      return {
        stdout: result,
        stderr: "",
        exitCode: 0,
      };
    } catch (error: any) {
      return {
        stdout: error.stdout || "",
        stderr: error.stderr || error.message,
        exitCode: error.status || 1,
      };
    }
  },
});
