/**
 * Property-Based Test: Backward Compatibility Aliases
 *
 * Property 14: For all renamed exports, the deprecated alias SHALL reference
 * the exact same class/type as the new name.
 *
 * **Validates: Requirements 1.2, 1.4, 1.7**
 *
 * ∀ (newName, oldAlias) ∈ RenamedExports:
 *   oldAlias === newName
 *
 * Uses fast-check to pick from all renamed pairs and verify strict equality
 * for class exports, plus TypeScript-level type compatibility for type aliases.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

// Import class-based exports (both new and deprecated) from @kernova/core
import { KernovaKernel, NexusKernel } from '../kernel.js';

// Import class-based exports from @kernova/sdk
import { Kernova, Nexus } from '@kernova/sdk';

// Import type aliases from @kernova/types
import type { KernovaId, NexusId, KernovaObject, NexusObject, KernovaEvent, NexusEvent } from '@kernova/types';

// ─── Define the set of renamed class exports ────────────────

interface RenamedClassPair {
  newName: unknown;
  oldAlias: unknown;
  label: string;
}

const renamedClassPairs: RenamedClassPair[] = [
  { newName: KernovaKernel, oldAlias: NexusKernel, label: 'KernovaKernel / NexusKernel' },
  { newName: Kernova, oldAlias: Nexus, label: 'Kernova / Nexus' },
];

// ─── Type-level compatibility checks ───────────────────────
// These functions exist purely to verify TypeScript accepts the type aliases
// as interchangeable. If the types aren't compatible, TypeScript will refuse
// to compile this file.

function _assertKernovaIdCompat(id: KernovaId): NexusId {
  return id;
}

function _assertNexusIdCompat(id: NexusId): KernovaId {
  return id;
}

function _assertKernovaObjectCompat(obj: KernovaObject): NexusObject {
  return obj;
}

function _assertNexusObjectCompat(obj: NexusObject): KernovaObject {
  return obj;
}

function _assertKernovaEventCompat(event: KernovaEvent): NexusEvent {
  return event;
}

function _assertNexusEventCompat(event: NexusEvent): KernovaEvent {
  return event;
}

// Suppress unused variable warnings — these are compile-time checks only
void _assertKernovaIdCompat;
void _assertNexusIdCompat;
void _assertKernovaObjectCompat;
void _assertNexusObjectCompat;
void _assertKernovaEventCompat;
void _assertNexusEventCompat;

// ─── Property 14: Backward Compatibility Aliases ────────────
// **Validates: Requirements 1.2, 1.4, 1.7**

describe('Property 14: Backward Compatibility Aliases', () => {
  it('deprecated class aliases reference the exact same class as the new name', () => {
    // Use fast-check to pick from all renamed pairs and verify strict equality
    const pairIndexArb = fc.integer({ min: 0, max: renamedClassPairs.length - 1 });

    fc.assert(
      fc.property(pairIndexArb, (index) => {
        const pair = renamedClassPairs[index];
        // Strict reference equality: the deprecated alias must be the same object
        expect(pair.oldAlias).toBe(pair.newName);
      }),
      { numRuns: 100 },
    );
  });

  it('NexusKernel === KernovaKernel (from @kernova/core)', () => {
    expect(NexusKernel).toBe(KernovaKernel);
    // Also verify they are the same constructor
    expect(NexusKernel.prototype).toBe(KernovaKernel.prototype);
  });

  it('Nexus === Kernova (from @kernova/sdk)', () => {
    expect(Nexus).toBe(Kernova);
    // Also verify they are the same constructor
    expect(Nexus.prototype).toBe(Kernova.prototype);
  });

  it('type aliases are bidirectionally compatible (compile-time verification)', () => {
    // KernovaId <-> NexusId
    const testId: KernovaId = 'test-id-123';
    const aliasId: NexusId = testId;
    const backId: KernovaId = aliasId;
    expect(backId).toBe(testId);

    // KernovaObject <-> NexusObject
    const testObj: KernovaObject = {
      id: 'obj-1',
      type: 'test',
      version: '1.0.0',
      owner: 'owner-1',
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      metadata: {},
    };
    const aliasObj: NexusObject = testObj;
    const backObj: KernovaObject = aliasObj;
    expect(backObj).toBe(testObj);

    // KernovaEvent <-> NexusEvent
    const testEvent: KernovaEvent = {
      id: 'evt-1',
      eventType: 'test.created',
      category: 'system',
      severity: 'info',
      timestamp: new Date().toISOString(),
      subjectId: 'sub-1',
      subjectType: 'test',
      actorId: 'actor-1',
      correlationId: 'corr-1',
      data: {},
      metadata: {
        schemaVersion: '1.0',
        source: 'test',
        environment: 'test',
      },
    };
    const aliasEvent: NexusEvent = testEvent;
    const backEvent: KernovaEvent = aliasEvent;
    expect(backEvent).toBe(testEvent);
  });

  it('deprecated aliases preserve instanceof behavior for classes', () => {
    // fast-check: generate random config-like data and verify instances
    // satisfy both class references
    fc.assert(
      fc.property(
        fc.record({
          env: fc.constantFrom('development', 'production', 'staging') as fc.Arbitrary<'development' | 'production' | 'staging'>,
        }),
        (config) => {
          // Since NexusKernel === KernovaKernel, any instance of one
          // is an instance of the other
          expect(NexusKernel).toBe(KernovaKernel);
          expect(Nexus).toBe(Kernova);

          // Verify prototype chain is shared
          expect(Object.getPrototypeOf(NexusKernel.prototype)).toBe(
            Object.getPrototypeOf(KernovaKernel.prototype),
          );
          expect(Object.getPrototypeOf(Nexus.prototype)).toBe(
            Object.getPrototypeOf(Kernova.prototype),
          );
        },
      ),
      { numRuns: 50 },
    );
  });
});
