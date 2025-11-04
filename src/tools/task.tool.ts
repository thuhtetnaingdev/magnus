import { z } from 'zod';
import { createTool, type ToolDefinition } from './tool.base.js';

// Simple in-memory task store for demonstration
// In production, this would be replaced with persistent storage
const taskStore = new Map<string, any>();

// Helper function to update task execution status
export function updateTaskExecutionStatus(taskId: string, status: 'executing' | 'completed' | 'failed'): void {
  const task = taskStore.get(taskId);
  if (task) {
    task.status = status;
    if (status === 'executing' && !task.execution_started_at) {
      task.execution_started_at = new Date().toISOString();
    } else if (status === 'completed' || status === 'failed') {
      task.executed_at = new Date().toISOString();
    }
    taskStore.set(taskId, task);
  }
}

// Zod schema for task tool parameters
const TaskParametersSchema = z.object({
  task: z
    .string()
    .min(1, 'Task description cannot be empty. Please provide a clear description of what needs to be done.')
    .describe('The task description that needs to be confirmed before execution'),
  confirmation_required: z
    .boolean()
    .optional()
    .default(true)
    .describe('Whether confirmation is required before executing the task (default: true)'),
  estimated_complexity: z
    .enum(['low', 'medium', 'high'])
    .optional()
    .default('medium')
    .describe('Estimated complexity of the task (low, medium, high)'),
  dependencies: z
    .array(z.string())
    .optional()
    .default([])
    .describe('List of dependencies or prerequisites for this task'),
});

export type TaskParameters = z.infer<typeof TaskParametersSchema>;

export interface TaskTool extends ToolDefinition<typeof TaskParametersSchema> {
  name: 'task';
}

export const taskTool = createTool({
  name: 'task' as const,
  description: 'Create and confirm tasks before execution - enables confirmation workflows for coding tasks',
  parameters: TaskParametersSchema,
  execute: async ({ task, confirmation_required, estimated_complexity, dependencies }) => {
    // Create task object with metadata
    const taskObject = {
      id: `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      description: task,
      status: 'pending_confirmation' as const,
      created_at: new Date().toISOString(),
      confirmation_required,
      estimated_complexity,
      dependencies,
      confirmed_at: null as string | null,
      executed_at: null as string | null,
      execution_started_at: null as string | null,
    };

    // Store task
    taskStore.set(taskObject.id, taskObject);

    // If confirmation is required, return the task for confirmation
    if (confirmation_required) {
      return {
        type: 'task_created',
        task: taskObject,
        message: `Task created and awaiting confirmation. Please confirm before proceeding with execution.`,
        confirmation_prompt: `Do you want to proceed with this task?\nTask: ${task}\nComplexity: ${estimated_complexity}\nDependencies: ${dependencies.length > 0 ? dependencies.join(', ') : 'none'}`,
        next_steps: [
          'Review the task description and dependencies',
          'Confirm if the task scope is appropriate',
          'Provide confirmation to proceed with execution',
        ],
      };
    }

    // If no confirmation required, mark as confirmed and ready for execution
    (taskObject as any).status = 'confirmed';
    taskObject.confirmed_at = new Date().toISOString();

    return {
      type: 'task_ready',
      task: taskObject,
      message: `Task confirmed and ready for execution.`,
      execution_prompt: `Ready to execute: ${task}`,
    };
  },
});

// Zod schema for task confirmation tool parameters
const TaskConfirmationParametersSchema = z.object({
  task_id: z
    .string()
    .min(1, 'Task ID cannot be empty. Use task_list tool to see available task IDs.')
    .describe('The ID of the task to confirm or reject'),
  action: z
    .enum(['confirm', 'reject', 'modify'])
    .describe('Action to take: confirm, reject, or modify the task'),
  modifications: z
    .string()
    .optional()
    .describe('Modifications to the task description (required if action is "modify")'),
});

export type TaskConfirmationParameters = z.infer<typeof TaskConfirmationParametersSchema>;

export interface TaskConfirmationTool extends ToolDefinition<typeof TaskConfirmationParametersSchema> {
  name: 'task_confirm';
}

export const taskConfirmationTool = createTool({
  name: 'task_confirm' as const,
  description: 'Confirm, reject, or modify pending tasks before execution',
  parameters: TaskConfirmationParametersSchema,
  execute: async ({ task_id, action, modifications }) => {
    // In a real implementation, this would interact with a task store
    // For now, we'll simulate the confirmation workflow

    // Get task from store
    const task = taskStore.get(task_id);
    if (!task) {
      throw new Error(`Task not found: ${task_id}. Use task_list tool to see available tasks.`);
    }

    switch (action) {
      case 'confirm':
        // Update task in store
        task.status = 'confirmed';
        task.confirmed_at = new Date().toISOString();
        taskStore.set(task_id, task);
        
        return {
          type: 'task_confirmed',
          task_id,
          message: `Task ${task_id} confirmed. Ready for execution.`,
          status: 'confirmed',
          confirmed_at: task.confirmed_at,
          next_steps: [
            'Proceed with task execution using appropriate tools',
            'Use the task ID for reference in subsequent operations',
            'Task status will automatically update to "executing" when you start implementation',
          ],
        };

      case 'reject':
        // Update task in store
        task.status = 'rejected';
        taskStore.set(task_id, task);
        
        return {
          type: 'task_rejected',
          task_id,
          message: `Task ${task_id} rejected. Task will not be executed.`,
          status: 'rejected',
          rejected_at: new Date().toISOString(),
          reason: 'User rejected the task',
        };

      case 'modify':
        if (!modifications) {
          throw new Error('Modifications are required when action is "modify". Please provide the updated task description.');
        }
        
        // Update task in store
        const originalDescription = task.description;
        task.description = modifications;
        task.status = 'modified';
        taskStore.set(task_id, task);
        
        return {
          type: 'task_modified',
          task_id,
          message: `Task ${task_id} modified. Please review the updated task.`,
          status: 'modified',
          modified_at: new Date().toISOString(),
          original_description: originalDescription,
          modified_description: modifications,
          next_steps: [
            'Review the modified task description',
            'Confirm the modified task to proceed',
          ],
        };

      default:
        throw new Error(`Invalid action: ${action}. Must be one of: confirm, reject, modify`);
    }
  },
});

// Zod schema for task list tool parameters
const TaskListParametersSchema = z.object({
  status: z
    .enum(['all', 'pending_confirmation', 'confirmed', 'rejected', 'modified', 'executing', 'completed'])
    .optional()
    .default('all')
    .describe('Filter tasks by status (all, pending_confirmation, confirmed, rejected, modified, executing, completed)'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .default(20)
    .describe('Maximum number of tasks to return (default: 20, max: 100)'),
});

export type TaskListParameters = z.infer<typeof TaskListParametersSchema>;

export interface TaskListTool extends ToolDefinition<typeof TaskListParametersSchema> {
  name: 'task_list';
}

export const taskListTool = createTool({
  name: 'task_list' as const,
  description: 'List tasks with filtering by status - shows pending, confirmed, and completed tasks',
  parameters: TaskListParametersSchema,
  execute: async ({ status, limit }) => {
    const allTasks = Array.from(taskStore.values());
    
    // Filter by status
    const filteredTasks = status === 'all' 
      ? allTasks 
      : allTasks.filter(task => task.status === status);
    
    // Sort by creation date (newest first)
    const sortedTasks = filteredTasks.sort((a, b) => 
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
    
    // Apply limit
    const limitedTasks = sortedTasks.slice(0, limit);
    
    // Count by status for summary
    const statusCounts: Record<string, number> = {};
    allTasks.forEach(task => {
      statusCounts[task.status] = (statusCounts[task.status] || 0) + 1;
    });

    return {
      type: 'task_list',
      total_tasks: allTasks.length,
      filtered_tasks: limitedTasks.length,
      status_filter: status,
      status_counts: statusCounts,
      tasks: limitedTasks.map(task => ({
        id: task.id,
        description: task.description,
        status: task.status,
        created_at: task.created_at,
        confirmed_at: task.confirmed_at,
        executed_at: task.executed_at,
        execution_started_at: task.execution_started_at,
        estimated_complexity: task.estimated_complexity,
        dependencies: task.dependencies,
      })),
      message: `Found ${limitedTasks.length} tasks${status !== 'all' ? ` with status "${status}"` : ''}. Total tasks: ${allTasks.length}`,
    };
  },
});