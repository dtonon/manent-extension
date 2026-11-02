// Visits every object of a parsed JSON tree, stops descending when visit returns true
export function walkJson(root: unknown, visit: (o: any) => boolean | void) {
  const stack: unknown[] = [root];
  while (stack.length) {
    const o = stack.pop();
    if (!o || typeof o !== 'object') continue;
    if (visit(o) === true) continue;
    for (const v of Object.values(o)) if (v && typeof v === 'object') stack.push(v);
  }
}

export function containsValue(root: unknown, value: string, maxDepth = 15): boolean {
  const stack: [unknown, number][] = [[root, 0]];
  while (stack.length) {
    const [o, depth] = stack.pop()!;
    if (!o || typeof o !== 'object' || depth > maxDepth) continue;
    for (const v of Object.values(o)) {
      if (v === value) return true;
      if (v && typeof v === 'object') stack.push([v, depth + 1]);
    }
  }
  return false;
}
