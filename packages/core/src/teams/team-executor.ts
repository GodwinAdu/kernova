/**
 * Team Executor — Orchestrates Multi-Agent Task Execution
 *
 * The brain of the team system. Takes a high-level goal, decomposes it,
 * assigns tasks to agents, manages delegation chains, reviews results,
 * and produces a final output.
 *
 * Supports multiple strategies:
 * - sequential: A → B → C in fixed order
 * - hierarchical: Lead decomposes, assigns, reviews
 * - collaborative: Agents freely delegate to each other
 * - round-robin: Tasks distributed evenly
 * - broadcast: All agents work, best result wins
 * - pipeline: Output of one feeds into next
 */

import type {
  TeamConfig,
  TeamTask,
  TeamMember,
  TeamExecuteOptions,
  TeamExecutionTrace,
  TeamProgressEvent,
  DelegationStrategy,
  AgentId,
  TaskId,
  AgentMessage,
} from './types.js';
import { MessageBus } from './message-bus.js';
import { SharedWorkspace } from './shared-workspace.js';

/** Function that actually calls an agent and gets a response */
export type AgentExecutor = (
  agentName: string,
  input: string,
  context: AgentExecutionContext,
) => Promise<AgentExecutionResult>;

export interface AgentExecutionContext {
  threadId: string;
  workspace: SharedWorkspace;
  messageBus: MessageBus;
  teamMembers: TeamMember[];
  currentTask: TeamTask;
  delegateTo: (agentName: string, goal: string, context?: Record<string, unknown>) => Promise<string>;
}

export interface AgentExecutionResult {
  content: string;
  metadata?: Record<string, unknown>;
  delegations?: Array<{ agent: string; task: string; result: string }>;
  tokensUsed?: number;
  costUsd?: number;
}

export interface TeamExecutorOptions {
  /** Max concurrent tasks across the team */
  maxConcurrency?: number;
  /** Default timeout per agent task in ms */
  defaultTaskTimeout?: number;
  /** Max retries per task */
  maxRetries?: number;
  /** Max delegation depth */
  maxDelegationDepth?: number;
}

const DEFAULT_OPTIONS: Required<TeamExecutorOptions> = {
  maxConcurrency: 5,
  defaultTaskTimeout: 120000, // 2 min
  maxRetries: 2,
  maxDelegationDepth: 5,
};

export class TeamExecutor {
  private config: TeamConfig;
  private executor: AgentExecutor;
  private messageBus: MessageBus;
  private workspace: SharedWorkspace;
  private options: Required<TeamExecutorOptions>;
  private tasks: Map<TaskId, TeamTask> = new Map();
  private taskCounter = 0;
  private activeTasks = 0;

  constructor(
    config: TeamConfig,
    executor: AgentExecutor,
    options?: TeamExecutorOptions,
  ) {
    this.config = config;
    this.executor = executor;
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.messageBus = new MessageBus();
    this.workspace = new SharedWorkspace(config.workspace);
  }

  /** Execute a team task using the configured strategy */
  async execute(options: TeamExecuteOptions): Promise<TeamExecutionTrace> {
    const strategy = options.strategy ?? this.config.strategy;
    const trace: TeamExecutionTrace = {
      teamId: this.config.id,
      rootTaskId: '',
      startedAt: new Date().toISOString(),
      status: 'running',
      tasks: [],
      messages: [],
    };

    // Set up progress reporting
    const emit = (event: Omit<TeamProgressEvent, 'timestamp'>) => {
      const full: TeamProgressEvent = { ...event, timestamp: new Date().toISOString() };
      options.onProgress?.(full);
    };

    // Store initial context in workspace
    if (options.context) {
      for (const [key, value] of Object.entries(options.context)) {
        this.workspace.set(`context.${key}`, value, 'system');
      }
    }
    this.workspace.set('goal', options.goal, 'system');

    try {
      let result: string;

      switch (strategy) {
        case 'hierarchical':
          result = await this.executeHierarchical(options, trace, emit);
          break;
        case 'sequential':
          result = await this.executeSequential(options, trace, emit);
          break;
        case 'pipeline':
          result = await this.executePipeline(options, trace, emit);
          break;
        case 'collaborative':
          result = await this.executeCollaborative(options, trace, emit);
          break;
        case 'round-robin':
          result = await this.executeRoundRobin(options, trace, emit);
          break;
        case 'broadcast':
          result = await this.executeBroadcast(options, trace, emit);
          break;
        default:
          result = await this.executeHierarchical(options, trace, emit);
      }

      trace.status = 'completed';
      trace.completedAt = new Date().toISOString();
      trace.result = result;
      trace.messages = this.messageBus.getAllHistory();

      emit({ type: 'completed' });
    } catch (error) {
      trace.status = 'failed';
      trace.completedAt = new Date().toISOString();
      emit({ type: 'error', error: error instanceof Error ? error.message : String(error) });
    }

    return trace;
  }

  /** Get the shared workspace */
  getWorkspace(): SharedWorkspace {
    return this.workspace;
  }

  /** Get the message bus */
  getMessageBus(): MessageBus {
    return this.messageBus;
  }

  // ─── Strategy Implementations ──────────────────────────────────────

  /**
   * HIERARCHICAL: Lead agent decomposes the task, assigns sub-tasks to
   * members, reviews their output, and produces the final result.
   */
  private async executeHierarchical(
    options: TeamExecuteOptions,
    trace: TeamExecutionTrace,
    emit: (e: Omit<TeamProgressEvent, 'timestamp'>) => void,
  ): Promise<string> {
    const lead = this.config.members.find(m => m.role === 'lead') ?? this.config.members[0];
    if (!lead) throw new Error('No team lead defined');

    // Step 1: Lead decomposes the task
    const decompositionTask = this.createTask({
      teamId: this.config.id,
      goal: `You are the team lead. Break down this goal into sub-tasks for your team members:\n\n` +
            `GOAL: ${options.goal}\n\n` +
            `TEAM MEMBERS:\n${this.config.members.filter(m => m.agent !== lead.agent).map(m =>
              `- ${m.agent} (${m.role}): ${m.description || m.specialization?.join(', ') || 'general'}`,
            ).join('\n')}\n\n` +
            `Respond with a JSON array of tasks: [{"agent": "agent-name", "task": "description"}]\n` +
            `Only delegate tasks that match each agent's specialization. You can keep tasks for yourself if needed.`,
      assignee: lead.agent,
      assignedBy: 'system',
      depth: 0,
    });
    trace.rootTaskId = decompositionTask.id;
    trace.tasks.push(decompositionTask);
    emit({ type: 'task-assigned', agent: lead.agent, task: decompositionTask });

    const decompositionResult = await this.executeTask(decompositionTask, options.threadId || 'default');
    emit({ type: 'task-completed', agent: lead.agent, task: decompositionTask });

    // Step 2: Parse sub-tasks from lead's response
    const subtasks = this.parseSubtasks(decompositionResult, options.goal);

    // Step 3: Execute sub-tasks (potentially in parallel)
    const results: Array<{ agent: string; task: string; result: string }> = [];

    for (const subtask of subtasks) {
      const member = this.config.members.find(m => m.agent === subtask.agent);
      if (!member) continue;

      const task = this.createTask({
        teamId: this.config.id,
        goal: subtask.task,
        assignee: subtask.agent,
        assignedBy: lead.agent,
        depth: 1,
        parentTask: decompositionTask.id,
      });
      trace.tasks.push(task);
      emit({ type: 'task-assigned', agent: subtask.agent, task });
      emit({ type: 'delegation', agent: lead.agent, task });

      const result = await this.executeTask(task, options.threadId || 'default');
      results.push({ agent: subtask.agent, task: subtask.task, result });
      emit({ type: 'task-completed', agent: subtask.agent, task });

      // Store result in workspace
      this.workspace.set(`results.${subtask.agent}`, result, subtask.agent);
    }

    // Step 4: Lead reviews and synthesizes
    const reviewTask = this.createTask({
      teamId: this.config.id,
      goal: `You are the team lead. Review the team's work and produce the final output.\n\n` +
            `ORIGINAL GOAL: ${options.goal}\n\n` +
            `TEAM RESULTS:\n${results.map(r =>
              `--- ${r.agent} (task: ${r.task}) ---\n${r.result}`,
            ).join('\n\n')}\n\n` +
            `Synthesize everything into a cohesive final response. If any work is unsatisfactory, note what should be improved.`,
      assignee: lead.agent,
      assignedBy: 'system',
      depth: 0,
    });
    trace.tasks.push(reviewTask);
    emit({ type: 'review', agent: lead.agent, task: reviewTask });

    const finalResult = await this.executeTask(reviewTask, options.threadId || 'default');
    emit({ type: 'task-completed', agent: lead.agent, task: reviewTask });

    return finalResult;
  }

  /**
   * SEQUENTIAL: Tasks flow from one agent to the next in member order.
   * Each agent builds on the previous agent's output.
   */
  private async executeSequential(
    options: TeamExecuteOptions,
    trace: TeamExecutionTrace,
    emit: (e: Omit<TeamProgressEvent, 'timestamp'>) => void,
  ): Promise<string> {
    let currentInput = options.goal;
    let lastResult = '';

    for (let i = 0; i < this.config.members.length; i++) {
      const member = this.config.members[i];
      const isFirst = i === 0;
      const isLast = i === this.config.members.length - 1;

      const task = this.createTask({
        teamId: this.config.id,
        goal: isFirst
          ? currentInput
          : `Previous agent's output:\n${lastResult}\n\nYour job: Continue working on this. Original goal: ${options.goal}`,
        assignee: member.agent,
        assignedBy: i === 0 ? 'system' : this.config.members[i - 1].agent,
        depth: i,
      });
      trace.tasks.push(task);
      emit({ type: 'task-assigned', agent: member.agent, task });

      lastResult = await this.executeTask(task, options.threadId || 'default');
      emit({ type: 'task-completed', agent: member.agent, task });

      this.workspace.set(`step.${i}.result`, lastResult, member.agent);
    }

    return lastResult;
  }

  /**
   * PIPELINE: Output of one agent is explicitly the input to the next.
   * Stricter than sequential — each agent has a defined role in the pipeline.
   */
  private async executePipeline(
    options: TeamExecuteOptions,
    trace: TeamExecutionTrace,
    emit: (e: Omit<TeamProgressEvent, 'timestamp'>) => void,
  ): Promise<string> {
    let pipelineData = options.goal;

    for (let i = 0; i < this.config.members.length; i++) {
      const member = this.config.members[i];

      const task = this.createTask({
        teamId: this.config.id,
        goal: `You are step ${i + 1}/${this.config.members.length} in a pipeline.\n` +
              `Your role: ${member.description || member.specialization?.join(', ') || member.role}\n\n` +
              `INPUT:\n${pipelineData}\n\n` +
              `Process this input according to your role and produce output for the next step.`,
        assignee: member.agent,
        assignedBy: i === 0 ? 'system' : this.config.members[i - 1].agent,
        depth: 0,
      });
      trace.tasks.push(task);
      emit({ type: 'task-assigned', agent: member.agent, task });

      pipelineData = await this.executeTask(task, options.threadId || 'default');
      emit({ type: 'task-completed', agent: member.agent, task });

      this.workspace.set(`pipeline.${i}`, pipelineData, member.agent);
    }

    return pipelineData;
  }

  /**
   * COLLABORATIVE: All agents can freely delegate to each other.
   * Starts with the lead, who can delegate, and delegees can further delegate.
   */
  private async executeCollaborative(
    options: TeamExecuteOptions,
    trace: TeamExecutionTrace,
    emit: (e: Omit<TeamProgressEvent, 'timestamp'>) => void,
  ): Promise<string> {
    const lead = this.config.members.find(m => m.role === 'lead') ?? this.config.members[0];

    const task = this.createTask({
      teamId: this.config.id,
      goal: `${options.goal}\n\n` +
            `You can delegate sub-tasks to your team members by using the delegateTo function:\n` +
            `${this.config.members.filter(m => m.agent !== lead.agent).map(m =>
              `- ${m.agent}: ${m.description || m.specialization?.join(', ') || 'general'}`,
            ).join('\n')}`,
      assignee: lead.agent,
      assignedBy: 'system',
      depth: 0,
    });
    trace.rootTaskId = task.id;
    trace.tasks.push(task);
    emit({ type: 'task-assigned', agent: lead.agent, task });

    // The executor will have delegateTo available in context
    const result = await this.executeTask(task, options.threadId || 'default');
    emit({ type: 'task-completed', agent: lead.agent, task });

    return result;
  }

  /**
   * ROUND-ROBIN: Split the work evenly across all members.
   * Good for when all agents have similar capabilities.
   */
  private async executeRoundRobin(
    options: TeamExecuteOptions,
    trace: TeamExecutionTrace,
    emit: (e: Omit<TeamProgressEvent, 'timestamp'>) => void,
  ): Promise<string> {
    // First, have one agent split the work
    const lead = this.config.members[0];

    const splitTask = this.createTask({
      teamId: this.config.id,
      goal: `Split this goal into ${this.config.members.length} equal parts:\n${options.goal}\n\n` +
            `Respond with a JSON array of ${this.config.members.length} sub-tasks: ["task1", "task2", ...]`,
      assignee: lead.agent,
      assignedBy: 'system',
      depth: 0,
    });
    trace.tasks.push(splitTask);

    const splitResult = await this.executeTask(splitTask, options.threadId || 'default');

    // Parse the split
    let parts: string[];
    try {
      const match = splitResult.match(/\[[\s\S]*\]/);
      parts = match ? JSON.parse(match[0]) : [options.goal];
    } catch {
      parts = [options.goal];
    }

    // Assign each part round-robin
    const results: string[] = [];
    for (let i = 0; i < parts.length; i++) {
      const member = this.config.members[i % this.config.members.length];
      const task = this.createTask({
        teamId: this.config.id,
        goal: parts[i],
        assignee: member.agent,
        assignedBy: 'system',
        depth: 1,
      });
      trace.tasks.push(task);
      emit({ type: 'task-assigned', agent: member.agent, task });

      const result = await this.executeTask(task, options.threadId || 'default');
      results.push(result);
      emit({ type: 'task-completed', agent: member.agent, task });
    }

    // Combine results
    return results.join('\n\n---\n\n');
  }

  /**
   * BROADCAST: All agents work on the same task independently.
   * The best result is selected (by the lead or by scoring).
   */
  private async executeBroadcast(
    options: TeamExecuteOptions,
    trace: TeamExecutionTrace,
    emit: (e: Omit<TeamProgressEvent, 'timestamp'>) => void,
  ): Promise<string> {
    // All agents work in parallel
    const promises = this.config.members.map(async (member) => {
      const task = this.createTask({
        teamId: this.config.id,
        goal: options.goal,
        assignee: member.agent,
        assignedBy: 'system',
        depth: 0,
      });
      trace.tasks.push(task);
      emit({ type: 'task-assigned', agent: member.agent, task });

      const result = await this.executeTask(task, options.threadId || 'default');
      emit({ type: 'task-completed', agent: member.agent, task });

      return { agent: member.agent, result };
    });

    const results = await Promise.all(promises);

    // If there's a lead, have them pick the best
    const lead = this.config.members.find(m => m.role === 'lead');
    if (lead) {
      const judgeTask = this.createTask({
        teamId: this.config.id,
        goal: `You are judging submissions from your team. Pick the best response or synthesize them.\n\n` +
              `ORIGINAL GOAL: ${options.goal}\n\n` +
              `SUBMISSIONS:\n${results.map((r, i) =>
                `--- ${r.agent} (${i + 1}) ---\n${r.result}`,
              ).join('\n\n')}\n\n` +
              `Provide the best final answer.`,
        assignee: lead.agent,
        assignedBy: 'system',
        depth: 1,
      });
      trace.tasks.push(judgeTask);
      emit({ type: 'review', agent: lead.agent, task: judgeTask });

      const finalResult = await this.executeTask(judgeTask, options.threadId || 'default');
      emit({ type: 'task-completed', agent: lead.agent, task: judgeTask });
      return finalResult;
    }

    // No lead — return all results combined
    return results.map(r => `[${r.agent}]\n${r.result}`).join('\n\n---\n\n');
  }

  // ─── Task Management ───────────────────────────────────────────────

  private createTask(params: {
    teamId: string;
    goal: string;
    assignee: string;
    assignedBy: string;
    depth: number;
    parentTask?: string;
  }): TeamTask {
    const task: TeamTask = {
      id: `task_${Date.now()}_${++this.taskCounter}`,
      teamId: params.teamId,
      goal: params.goal,
      assignee: params.assignee,
      assignedBy: params.assignedBy,
      status: 'pending',
      depth: params.depth,
      parentTask: params.parentTask,
      createdAt: new Date().toISOString(),
      attempts: 0,
      maxRetries: this.options.maxRetries,
    };

    this.tasks.set(task.id, task);
    return task;
  }

  private async executeTask(task: TeamTask, threadId: string): Promise<string> {
    task.status = 'in-progress';
    task.startedAt = new Date().toISOString();
    task.attempts++;

    try {
      // Build delegateTo function for this task's context
      const delegateTo = async (agentName: string, goal: string, context?: Record<string, unknown>): Promise<string> => {
        if (task.depth >= (this.config.maxDelegationDepth ?? this.options.maxDelegationDepth)) {
          return `[Cannot delegate: maximum delegation depth (${this.config.maxDelegationDepth ?? this.options.maxDelegationDepth}) reached]`;
        }

        // Verify the target agent is a team member
        const targetMember = this.config.members.find(m => m.agent === agentName);
        if (!targetMember) {
          return `[Cannot delegate to "${agentName}": not a team member. Available: ${this.config.members.map(m => m.agent).join(', ')}]`;
        }

        // Create sub-task
        const subtask = this.createTask({
          teamId: this.config.id,
          goal,
          assignee: agentName,
          assignedBy: task.assignee,
          depth: task.depth + 1,
          parentTask: task.id,
        });

        // Store context in workspace if provided
        if (context) {
          for (const [key, value] of Object.entries(context)) {
            this.workspace.set(`delegation.${subtask.id}.${key}`, value, task.assignee);
          }
        }

        // Send delegation message
        await this.messageBus.send({
          from: task.assignee,
          to: agentName,
          type: 'delegate',
          content: goal,
          taskId: subtask.id,
        });

        // Execute the sub-task
        const result = await this.executeTask(subtask, threadId);

        // Send result message back
        await this.messageBus.send({
          from: agentName,
          to: task.assignee,
          type: 'result',
          content: result,
          taskId: subtask.id,
        });

        return result;
      };

      // Execute via the registered agent executor
      const executionContext: AgentExecutionContext = {
        threadId,
        workspace: this.workspace,
        messageBus: this.messageBus,
        teamMembers: this.config.members,
        currentTask: task,
        delegateTo,
      };

      const result = await this.executor(task.assignee, task.goal, executionContext);

      task.status = 'completed';
      task.result = result.content;
      task.resultData = result.metadata;
      task.completedAt = new Date().toISOString();

      return result.content;
    } catch (error) {
      // Retry logic
      if (task.attempts < task.maxRetries) {
        return this.executeTask(task, threadId);
      }

      task.status = 'failed';
      task.completedAt = new Date().toISOString();
      throw error;
    }
  }

  /** Parse sub-tasks from the lead's decomposition response */
  private parseSubtasks(response: string, fallbackGoal: string): Array<{ agent: string; task: string }> {
    try {
      // Try to find JSON array in response
      const match = response.match(/\[[\s\S]*\]/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.map(item => ({
            agent: item.agent || this.config.members[1]?.agent || this.config.members[0].agent,
            task: item.task || item.description || item.goal || String(item),
          }));
        }
      }
    } catch {
      // JSON parsing failed
    }

    // Fallback: assign the whole goal to the first non-lead member
    const nonLead = this.config.members.find(m => m.role !== 'lead');
    if (nonLead) {
      return [{ agent: nonLead.agent, task: fallbackGoal }];
    }

    return [{ agent: this.config.members[0].agent, task: fallbackGoal }];
  }
}
