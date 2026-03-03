import type { NotificationDefinition } from './types';
import * as definitions from './definitions';

// Create the registry as a Map
const registry = new Map<string, NotificationDefinition<unknown>>();

// Register all definitions by iterating over exports
const allDefinitions = Object.values(definitions) as NotificationDefinition<unknown>[];

for (const def of allDefinitions) {
  if (def && typeof def === 'object' && 'type' in def && 'formatters' in def) {
    registry.set(def.type, def);
  }
}

/**
 * Get a notification definition by type
 */
export function getDefinition<T = Record<string, unknown>>(
  type: string
): NotificationDefinition<T> | undefined {
  return registry.get(type) as NotificationDefinition<T> | undefined;
}

/**
 * Get all registered notification types
 */
export function getAllTypes(): string[] {
  return Array.from(registry.keys());
}

/**
 * Check if a notification type is registered
 */
export function hasDefinition(type: string): boolean {
  return registry.has(type);
}

export { registry };
