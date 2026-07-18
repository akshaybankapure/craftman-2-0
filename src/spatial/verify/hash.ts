export function stableHash(parts: Array<string | number | boolean>): string {
  let hash = 2166136261 >>> 0;
  const text = parts.join("|");
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
