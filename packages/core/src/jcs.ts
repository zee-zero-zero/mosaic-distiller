// Provides the JSON Canonicalization Scheme of RFC 8785 for the values a rule pack holds: objects,
// arrays, strings, booleans, null and integers (a pack has no floating-point numbers). Keys are
// sorted by UTF-16 code units, as the RFC says, and strings are written as JSON.stringify writes
// them, which is the RFC's rule.

export function canonicalize(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "string":
      return JSON.stringify(value);
    case "number":
      if (!Number.isInteger(value)) throw new Error("JCS: only integers are supported");
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) return "[" + value.map(canonicalize).join(",") + "]";
      const obj = value as Record<string, unknown>;
      const keys = Object.keys(obj).sort();
      return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalize(obj[k])).join(",") + "}";
    }
    default:
      throw new Error("JCS: unsupported value");
  }
}
