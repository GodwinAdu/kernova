/**
 * TeamExecutorLocal — Lightweight team executor for the framework server.
 *
 * This is a self-contained version that doesn't require @kernova/core's dist
 * to be rebuilt. It implements the same logic as core's TeamExecutor but
 * with fewer dependencies.
 */

export interface TeamMember {
  agent: string;
  role: 'lead' | 'member' | 'reviewer' | 'specialist';
  description?: string;
  specialization?: string[];
  canDelegate?: boolean;
  canApprove?: boolean;
  maxConcurrentTasks?: number;
}

export interface TeamConfig {
  id: string;
  name: string;
  description?: string;
  strategy: string;
  members: TeamMember[];
  maxDelegationDepth?: number;
  taskTimeout?: number;
  requireLeadApproval?: boolean;
  workspace?: { persistent?: boolean; maxEntries?: number };
}

export interface TeamTask {
  id: string;
  goal: string;
  assignee: string;
  assignedBy: string;
  status: string;
  result?: string;
  depth: number;
  createdAt: string;
  completedAt?: string;
}

export interface TeamProgressEvent {
  type: string;
  agent?: string;
  task?: TeamTask;
  timestamp: string;
}

type AgentExecutor = (agentName: string, input: string, ctx: any) => Promise<{ content: string; metadata?: Record<string, unknown> }>;

export class TeamExecutorLocal {
  private config: TeamConfig;
  private executor: AgentExecutor;
  private tasks: TeamTask[] = [];
  private taskCounter = 0;
  private workspace: Map<string, unknown> = new Map();

  constructor(config: TeamConfig, executor: AgentExecutor) {
    this.config = config;
    this.executor = executor;
  }

  async execute(options: {
    goal: string;
    context?: Record<string, unknown>;
    timeout?: number;
    strategy?: string;
    onProgress?: (event: TeamProgressEvent) => void;
  }) {
    const strategy = options.strategy || this.config.strategy;
    const emit = (type: string, agent?: string, task?: TeamTask) => {
      options.onProgress?.({ type, agent, task, timestamp: new Date().toISOString() });
    };

    // Store context
    if (options.context) {
      for (const [k, v] of Object.entries(options.context)) {
        this.workspace.set(k, v);
      }
    }

    let result: string;

    switch (strategy) {
      case 'hierarchical':
        result = await this.runHierarchical(options.goal, emit);
        break;
      case 'sequential':
        result = await this.runSequential(options.goal, emit);
        break;
      case 'pipeline':
        result = await this.runPipeline(options.goal, emit);
        break;
      case 'collaborative':
        result = await this.runCollaborative(options.goal, emit);
        break;
      case 'broadcast':
        result = await this.runBroadcast(options.goal, emit);
        break;
      default:
        result = await this.runHierarchical(options.goal, emit);
    }

    return {
      teamId: this.config.id,
      rootTaskId: this.tasks[0]?.id || '',
      startedAt: this.tasks[0]?.createdAt || new Date().toISOString(),
      completedAt: new Date().toISOString(),
      status: 'completed',
      tasks: this.tasks,
      messages: [],
      result,
    };
  }

  private createTask(goal: string, assignee: string, assignedBy: string, depth: number): TeamTask {
    const task: TeamTask = {
      id: `task_${Date.now()}_${++this.taskCounter}`,
      goal,
      assignee,
      assignedBy,
      status: 'pending',
      depth,
      createdAt: new Date().toISOString(),
    };
    this.tasks.push(task);
    return task;
  }

  private async runAgent(task: TeamTask): Promise<string> {
    task.status = 'in-progress';
    try {
      const result = await this.executor(task.assignee, task.goal, {
        workspace: this.workspace,
        teamMembers: this.config.members,
      });
      task.status = 'completed';
      task.result = result.content;
      task.completedAt = new Date().toISOString();
      return result.content;
    } catch (err) {
      task.status = 'failed';
      task.completedAt = new Date().toISOString();
      return `[Error: ${err instanceof Error ? err.message : String(err)}]`;
    }
  }

  // ─── Strategies ─────────────────────────────────────────

  private async runHierarchical(
    goal: string,
    emit: (type: string, agent?: string, task?: TeamTask) => void,
  ): Promise<string> {
    const lead = this.config.members.find(m => m.role === 'lead') || this.config.members[0];
    const members = this.config.members.filter(m => m.agent !== lead.agent);

    // Step 1: Lead decomposes
    const decomposeTask = this.createTask(
      `Break down this goal into sub-tasks for your team:\n\nGOAL: ${goal}\n\nTEAM:\n${members.map(m =>
        `- ${m.agent}: ${m.description || m.specialization?.join(', ') || m.role}`,
      ).join('\n')}\n\nRespond with JSON: [{"agent":"name","task":"description"}]`,
      lead.agent,
      'system',
      0,
    );
    emit('task-assigned', lead.agent, decomposeTask);
    const decomposeResult = await this.runAgent(decomposeTask);
    emit('task-completed', lead.agent, decomposeTask);

    // Step 2: Parse and assign
    const subtasks = this.parseSubtasks(decomposeResult, goal, members);
    const results: Array<{ agent: string; task: string; result: string }> = [];

    for (const st of subtasks) {
      const task = this.createTask(st.task, st.agent, lead.agent, 1);
      emit('task-assigned', st.agent, task);
      emit('delegation', lead.agent, task);
      const result = await this.runAgent(task);
      results.push({ agent: st.agent, task: st.task, result });
      emit('task-completed', st.agent, task);
    }

    // Step 3: Lead reviews
    const reviewTask = this.createTask(
      `Review team output and synthesize final result.\n\nORIGINAL GOAL: ${goal}\n\nRESULTS:\n${results.map(r =>
        `--- ${r.agent} ---\n${r.result}`,
      ).join('\n\n')}\n\nProvide the final cohesive response.`,
      lead.agent,
      'system',
      0,
    );
    emit('review', lead.agent, reviewTask);
    const finalResult = await this.runAgent(reviewTask);
    emit('task-completed', lead.agent, reviewTask);

    return finalResult;
  }

  private async runSequential(
    goal: string,
    emit: (type: string, agent?: string, task?: TeamTask) => void,
  ): Promise<string> {
    let current = goal;

    for (let i = 0; i < this.config.members.length; i++) {
      const member = this.config.members[i];
      const input = i === 0
        ? current
        : `Previous output:\n${current}\n\nOriginal goal: ${goal}\n\nContinue.`;
      const task = this.createTask(input, member.agent, i === 0 ? 'system' : this.config.members[i - 1].agent, i);
      emit('task-assigned', member.agent, task);
      current = await this.runAgent(task);
      emit('task-completed', member.agent, task);
    }

    return current;
  }

  private async runPipeline(
    goal: string,
    emit: (type: string, agent?: string, task?: TeamTask) => void,
  ): Promise<string> {
    let data = goal;

    for (let i = 0; i < this.config.members.length; i++) {
      const member = this.config.members[i];
      const task = this.createTask(
        `Step ${i + 1}/${this.config.members.length}. Role: ${member.description || member.role}\n\nINPUT:\n${data}`,
        member.agent,
        i === 0 ? 'system' : this.config.members[i - 1].agent,
        0,
      );
      emit('task-assigned', member.agent, task);
      data = await this.runAgent(task);
      emit('task-completed', member.agent, task);
    }

    return data;
  }

  private async runCollaborative(
    goal: string,
    emit: (type: string, agent?: string, task?: TeamTask) => void,
  ): Promise<string> {
    const lead = this.config.members.find(m => m.role === 'lead') || this.config.members[0];

    const task = this.createTask(
      `${goal}\n\nYou are coordinating. Available team: ${this.config.members
        .filter(m => m.agent !== lead.agent)
        .map(m => `${m.agent} (${m.description || m.role})`)
        .join(', ')}`,
      lead.agent,
      'system',
      0,
    );
    emit('task-assigned', lead.agent, task);
    const result = await this.runAgent(task);
    emit('task-completed', lead.agent, task);

    return result;
  }

  private async runBroadcast(
    goal: string,
    emit: (type: string, agent?: string, task?: TeamTask) => void,
  ): Promise<string> {
    const results: Array<{ agent: string; result: string }> = [];

    for (const member of this.config.members) {
      const task = this.createTask(goal, member.agent, 'system', 0);
      emit('task-assigned', member.agent, task);
      const result = await this.runAgent(task);
      results.push({ agent: member.agent, result });
      emit('task-completed', member.agent, task);
    }

    // If there's a lead, have them pick the best
    const lead = this.config.members.find(m => m.role === 'lead');
    if (lead) {
      const judgeTask = this.createTask(
        `Judge these submissions:\n\nGOAL: ${goal}\n\n${results.map((r, i) =>
          `--- ${r.agent} ---\n${r.result}`,
        ).join('\n\n')}\n\nPick the best or synthesize.`,
        lead.agent,
        'system',
        1,
      );
      emit('review', lead.agent, judgeTask);
      const final = await this.runAgent(judgeTask);
      emit('task-completed', lead.agent, judgeTask);
      return final;
    }

    return results.map(r => `[${r.agent}]\n${r.result}`).join('\n\n---\n\n');
  }

  private parseSubtasks(
    response: string,
    fallback: string,
    members: TeamMember[],
  ): Array<{ agent: string; task: string }> {
    try {
      const match = response.match(/\[[\s\S]*\]/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.map(item => ({
            agent: item.agent || members[0]?.agent || 'unknown',
            task: item.task || item.description || String(item),
          }));
        }
      }
    } catch { /* ignore parse errors */ }

    // Fallback: assign to first non-lead member
    if (members.length > 0) {
      return [{ agent: members[0].agent, task: fallback }];
    }
    return [];
  }
}
