import type { AccessNodeCategory } from '../types.ts';

/** Allowed preferred undirected edges (canonical sorted pair keys). */
const ALLOWED: Set<string> = new Set([
  pair('ENTRY', 'FOYER'),
  pair('ENTRY', 'CORRIDOR'),
  pair('ENTRY', 'LIVING'),
  pair('FOYER', 'CORRIDOR'),
  pair('FOYER', 'LIVING'),
  pair('CORRIDOR', 'LIVING'),
  pair('CORRIDOR', 'BEDROOM'),
  pair('CORRIDOR', 'COMMON_BATHROOM'),
  pair('CORRIDOR', 'KITCHEN'),
  pair('LIVING', 'BEDROOM'),
  pair('LIVING', 'KITCHEN'),
  pair('BEDROOM', 'ENSUITE_BATHROOM'),
  pair('KITCHEN', 'UTILITY'),
  pair('LIVING', 'BALCONY'),
  pair('BEDROOM', 'BALCONY'),
  pair('FOYER', 'COMMON_BATHROOM'),
]);

const FORBIDDEN: Set<string> = new Set([
  pair('COMMON_BATHROOM', 'COMMON_BATHROOM'),
  pair('COMMON_BATHROOM', 'ENSUITE_BATHROOM'),
  pair('ENSUITE_BATHROOM', 'ENSUITE_BATHROOM'),
  pair('COMMON_BATHROOM', 'BEDROOM'),
  pair('COMMON_BATHROOM', 'KITCHEN'),
  pair('ENSUITE_BATHROOM', 'KITCHEN'),
  pair('COMMON_BATHROOM', 'LIVING'),
  pair('ENSUITE_BATHROOM', 'LIVING'),
  pair('BEDROOM', 'BEDROOM'),
  pair('ENTRY', 'BEDROOM'),
  pair('ENTRY', 'COMMON_BATHROOM'),
  pair('ENTRY', 'ENSUITE_BATHROOM'),
  pair('ENTRY', 'KITCHEN'),
  pair('UTILITY', 'BEDROOM'),
  pair('BALCONY', 'CORRIDOR'),
  pair('BALCONY', 'ENTRY'),
  pair('BALCONY', 'FOYER'),
  pair('BALCONY', 'KITCHEN'),
  pair('BALCONY', 'COMMON_BATHROOM'),
  pair('BALCONY', 'ENSUITE_BATHROOM'),
  pair('BALCONY', 'UTILITY'),
  pair('BALCONY', 'BALCONY'),
]);

function pair(a: AccessNodeCategory, b: AccessNodeCategory): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function isAllowedEdge(a: AccessNodeCategory, b: AccessNodeCategory): boolean {
  if (a === b && isBathroom(a)) return false;
  const key = pair(a, b);
  if (FORBIDDEN.has(key)) return false;
  return ALLOWED.has(key);
}

export function isForbiddenEdge(a: AccessNodeCategory, b: AccessNodeCategory): boolean {
  return !isAllowedEdge(a, b);
}

export function isBathroom(cat: AccessNodeCategory): boolean {
  return cat === 'COMMON_BATHROOM' || cat === 'ENSUITE_BATHROOM';
}

/** Valid primary parents for a category (for tree construction). */
export function allowedParents(child: AccessNodeCategory): AccessNodeCategory[] {
  switch (child) {
    case 'FOYER':
      return ['ENTRY'];
    case 'CORRIDOR':
      return ['ENTRY', 'FOYER'];
    case 'LIVING':
      return ['CORRIDOR', 'FOYER', 'ENTRY'];
    case 'KITCHEN':
      return ['LIVING', 'CORRIDOR'];
    case 'BEDROOM':
      return ['CORRIDOR', 'LIVING'];
    case 'COMMON_BATHROOM':
      return ['CORRIDOR', 'FOYER'];
    case 'ENSUITE_BATHROOM':
      return ['BEDROOM'];
    case 'UTILITY':
      return ['KITCHEN'];
    case 'BALCONY':
      return ['LIVING', 'BEDROOM'];
    case 'ENTRY':
      return [];
  }
}

export function maxDegree(cat: AccessNodeCategory): number {
  if (isBathroom(cat)) return 1;
  if (cat === 'BALCONY') return 1;
  if (cat === 'ENTRY') return 2;
  if (cat === 'UTILITY') return 2;
  return 8;
}

/** Privacy depth preference from ENTRY (higher = more private). */
export function privacyDepth(cat: AccessNodeCategory): number {
  switch (cat) {
    case 'ENTRY': return 0;
    case 'FOYER': return 1;
    case 'CORRIDOR': return 1;
    case 'LIVING': return 2;
    case 'KITCHEN': return 2;
    case 'UTILITY': return 3;
    case 'BALCONY': return 3;
    case 'COMMON_BATHROOM': return 3;
    case 'BEDROOM': return 4;
    case 'ENSUITE_BATHROOM': return 5;
  }
}
