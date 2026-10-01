/**
 * @file Runtime validation helpers for socket payloads. Every value received
 * from a client is untrusted: handlers check types and bounds with these
 * guards before using anything.
 */
import type { Direction } from '../../shared/settings.js';

/** Tells whether a value is one of the four directions. */
export function isDirection(value: unknown): value is Direction {
  return value === 2 || value === 4 || value === 6 || value === 8;
}

/**
 * Tells whether a value is an integer within bounds.
 * @param value - Untrusted value.
 * @param min - Inclusive minimum.
 * @param max - Inclusive maximum.
 */
export function isIntIn(value: unknown, min: number, max: number): value is number {
  return Number.isInteger(value) && (value as number) >= min && (value as number) <= max;
}
