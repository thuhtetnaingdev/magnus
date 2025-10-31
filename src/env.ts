import { z } from "zod";
import { config } from "dotenv";

config();

const envSchema = z.object({
  OPENAI_API_KEY: z.string().min(1, "OPENAI_API_KEY is required"),
  OPENAI_API_BASE: z.string().default("https://api.openai.com/v1"),
  OPENAI_MODEL: z.string().default("gpt-3.5-turbo"),
  LLM_API_KEY: z.string().optional(),
  LLM_API_BASE: z.string().optional(),
  LLM_MODEL: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(): Env {
  return envSchema.parse(process.env);
}
