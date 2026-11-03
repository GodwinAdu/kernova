# ADR-002: Intent as a First-Class Object

## Status
Accepted

## Date
July 8, 2026

## Context

Current AI platforms understand text, images, audio, video, and tools. But they don't understand **Intent** as a structured object.

Most systems use:
- Prompts (unstructured strings)
- Chat messages (conversation-oriented)
- Function calls (tool-oriented)

None of these capture the full picture of what a user wants to achieve, with constraints, priorities, deadlines, risk assessment, and approval requirements.

## Decision

Intent is a first-class object in Kernova with the following structure:
- Goal (natural language)
- Type (query, action, workflow, creation, etc.)
- Priority
- Constraints (budget, time, quality, security)
- Risk assessment
- Dependencies
- Approval requirements
- Evidence trail
- Result

Everything the AI does traces back to an Intent. This makes the system explainable and auditable.

## Reasoning

1. **Auditability** — You can always answer "why did the AI do this?"
2. **Governance** — Policies can be applied to intents before execution
3. **Prioritization** — The system can reason about what to do first
4. **Decomposition** — Complex goals break into child intents
5. **Human approval** — Natural point for human-in-the-loop
6. **Measurement** — Intent success/failure is measurable
7. **Replayability** — Failed intents can be retried with different strategies

## Consequences

### Easier
- Explaining what the system did and why
- Adding governance and approval workflows
- Measuring system effectiveness
- Debugging failures

### Harder
- Simple use cases require more structure (mitigated by sensible defaults)
- Developers must think in terms of goals, not prompts (this is intentional — it's better)

## Alternatives Rejected

- **Prompt-based:** Not auditable, not governable, not decomposable
- **Message-based:** Conversation-oriented, doesn't capture constraints or risk
- **Task-based:** Too simple, doesn't capture intent hierarchy or evidence
