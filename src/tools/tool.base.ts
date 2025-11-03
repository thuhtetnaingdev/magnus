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

// Helper function to convert Zod type to readable type name
export function getZodTypeName(field: any): string {
  if (!field || !field._def) return 'unknown';
  
  const def = field._def;
  
  // Handle optional types
  if (def.typeName === 'ZodOptional') {
    return `optional ${getZodTypeName(def.innerType)}`;
  }
  
  // Handle default types
  if (def.typeName === 'ZodDefault') {
    return getZodTypeName(def.innerType);
  }
  
  // Handle array types
  if (def.typeName === 'ZodArray') {
    return `array of ${getZodTypeName(def.type)}`;
  }
  
  // Handle union types
  if (def.typeName === 'ZodUnion') {
    const types = def.options.map((opt: any) => getZodTypeName(opt)).join(' or ');
    return types;
  }
  
  // Handle transform effects (like string to array conversion)
  if (def.typeName === 'ZodEffects') {
    // Try to get the underlying type
    if (def.schema) {
      return getZodTypeName(def.schema);
    }
    return 'transformed';
  }
  
  // Basic types
  switch (def.typeName) {
    case 'ZodString':
      return 'string';
    case 'ZodNumber':
      return 'number';
    case 'ZodBoolean':
      return 'boolean';
    case 'ZodObject':
      return 'object';
    case 'ZodLiteral':
      return `literal "${def.value}"`;
    case 'ZodEnum':
      return def.values.join(' | ');
    default:
      return def.typeName.replace('Zod', '').toLowerCase();
  }
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
