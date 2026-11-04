/**
 * Request context — who and what a tool call is running for.
 *
 * Every agent request and trigger run is submitted inside this context, so a tool can tell
 * a person's request from an autonomous run (a trigger) and see the thread and user, for
 * example to require stronger permissions for actions nobody asked for.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type { KernovaKernel } from '@kernova/core';

export interface RequestContext {
  /** Conversation thread (`trigger_<name>` for trigger runs) */
  threadId?: string;
  /** The user the request is for, when known */
  userId?: string;
  /** The trigger that started the run, for autonomous runs */
  trigger?: string;
  /** True when no person asked for this run (triggers and schedules) */
  autonomous: boolean;
  /** Route of the agent handling the request */
  agent?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** The context of the request the current code is running for, if any */
export function currentRequest(): RequestContext | undefined {
  return storage.getStore();
}

/** Runs `fn` inside a request context */
export function runInRequestContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

type SubmitInput = Parameters<KernovaKernel['submit']>[0];

/** Submits an intent to the kernel inside a request context taken from its metadata */
export function submitInContext(kernel: KernovaKernel, input: SubmitInput): ReturnType<KernovaKernel['submit']> {
  const meta = (input.metadata ?? {}) as Record<string, unknown>;
  const owner = typeof input.owner === 'string' && input.owner !== 'system' ? input.owner : undefined;
  return runInRequestContext({
    threadId: typeof meta.threadId === 'string' ? meta.threadId : undefined,
    userId: owner,
    trigger: typeof meta.triggerName === 'string' ? meta.triggerName : undefined,
    autonomous: meta.autonomous === true,
    agent: typeof meta.agentRoute === 'string' ? meta.agentRoute : undefined,
  }, () => kernel.submit(input));
}

/** The request-related fields of a tool's context */
export function toolRequestFields(): {
  threadId?: string;
  user?: { id: string };
  trigger?: string;
  autonomous: boolean;
  agent?: string;
} {
  const context = storage.getStore();
  return {
    ...(context?.threadId && { threadId: context.threadId }),
    ...(context?.userId && { user: { id: context.userId } }),
    ...(context?.trigger && { trigger: context.trigger }),
    autonomous: context?.autonomous ?? false,
    ...(context?.agent && { agent: context.agent }),
  };
}
