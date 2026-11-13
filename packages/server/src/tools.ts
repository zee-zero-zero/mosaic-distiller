// Provides the two tools of §4.2 and §4.3: their exact descriptions, their JSON-Schema input
// schemas, and parseDistillArguments, which checks the top-level shape of a `distill` call
// ourselves (the SDK's schema helpers would let unknown arguments through). The engine checks
// everything below that level and the limits.
import type { DistillRequest } from "@mosaic-distiller/core";

export const DISTILL_DESCRIPTION =
  "Replaces sensitive values in text with fake ones before the text is shared: secrets and API " +
  "keys, e-mail addresses, North American phone numbers, card numbers, IBANs, national ID " +
  "numbers, IP addresses, and any words in `dictionaries`. Pass the user's text unchanged as " +
  "`text`. Show the user the returned distillate, not the original. Replaced values become " +
  "realistic fakes such as person1@example.com; they are not real. It removes known sensitive " +
  "shapes and listed terms only: it does not find unlisted names and is not anonymisation.";

export const CAPABILITIES_DESCRIPTION =
  "Reports what the distiller can do: its modes, profiles, rule-pack version and the categories " +
  "it detects. Call it before relying on a mode or a category.";

export const DISTILL_SCHEMA = {
  type: "object",
  properties: {
    text: { type: "string", description: "The text to distil, as one segment." },
    segments: {
      type: "array",
      description: "Several pieces of text, each kept apart. Use instead of text.",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          text: { type: "string" },
          kind: { type: "string" },
        },
        required: ["id", "text"],
        additionalProperties: false,
      },
    },
    dictionaries: {
      type: "array",
      description: "The caller's own sensitive words.",
      items: {
        type: "object",
        properties: {
          name: { type: "string", pattern: "^[a-z0-9_]{1,32}$" },
          terms: { type: "array", items: { type: "string" } },
          template: { type: "string", description: "A fake value that contains {n}." },
        },
        required: ["name", "terms"],
        additionalProperties: false,
      },
    },
    objective: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["store", "forward", "task"] },
        task: { type: "string" },
      },
      required: ["kind"],
      additionalProperties: false,
    },
    profile: { type: "string", enum: ["agent", "document"] },
    mode: { type: "string", enum: ["rules"] },
  },
  additionalProperties: false,
} as const;

export const CAPABILITIES_SCHEMA = {
  type: "object",
  properties: {},
  additionalProperties: false,
} as const;

const DISTILL_ARGUMENTS = [
  "text",
  "segments",
  "dictionaries",
  "objective",
  "profile",
  "mode",
] as const;

export type ParsedArguments =
  { ok: true; request: DistillRequest } | { ok: false; code: "INVALID_ARGUMENTS" };

const INVALID: ParsedArguments = { ok: false, code: "INVALID_ARGUMENTS" };

/**
 * Checks the top level of a `distill` call: an object, only known names, exactly one of `text`
 * and `segments`, of the right type. `text` becomes the segment with id "1" (§4.2).
 */
export function parseDistillArguments(args: unknown): ParsedArguments {
  if (args === null || typeof args !== "object" || Array.isArray(args)) return INVALID;
  const a = args as Record<string, unknown>;
  for (const k of Object.keys(a)) {
    if (!(DISTILL_ARGUMENTS as readonly string[]).includes(k)) return INVALID;
  }
  const hasText = Object.prototype.hasOwnProperty.call(a, "text");
  const hasSegments = Object.prototype.hasOwnProperty.call(a, "segments");
  if (hasText === hasSegments) return INVALID;
  const request: Record<string, unknown> = {};
  if (hasText) {
    if (typeof a.text !== "string") return INVALID;
    request.segments = [{ id: "1", text: a.text }];
  } else {
    if (!Array.isArray(a.segments)) return INVALID;
    request.segments = a.segments;
  }
  for (const k of ["dictionaries", "objective", "profile", "mode"] as const) {
    if (Object.prototype.hasOwnProperty.call(a, k)) request[k] = a[k];
  }
  return { ok: true, request: request as unknown as DistillRequest };
}
