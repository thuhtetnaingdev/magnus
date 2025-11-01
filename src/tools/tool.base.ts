import { z } from 'zod';

export interface ToolDefinition<TParams extends z.ZodTypeAny> {
  name: string;
  description: string;
  parameters: TParams;
  execute: (params: z.infer<TParams>) => Promise<any>;
}

export function createTool<TName extends string, TParams extends z.ZodTypeAny>(
  definition: ToolDefinition<TParams> & { name: TName }
): ToolDefinition<TParams> & { name: TName } {
  return {
    ...definition,
    execute: async (params: any) => {
      const validatedParams = definition.parameters.parse(params);
      return await definition.execute(validatedParams);
    },
  };
}

// Helper function to extract parameter descriptions from Zod schemas
export function getParameterDescriptions<TParams extends z.ZodTypeAny>(
  schema: TParams
): Record<string, string> {
  const descriptions: Record<string, string> = {};

  if (schema instanceof z.ZodObject) {
    const shape = schema.shape;
    for (const [key, field] of Object.entries(shape)) {
      if (field instanceof z.ZodType) {
        // Extract description from Zod schema
        const description = field.description || `Parameter: ${key}`;
        descriptions[key] = description;
      }
    }
  }

  return descriptions;
}
