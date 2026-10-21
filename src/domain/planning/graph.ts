/** Dependency-graph helpers shared by schema validation and the scheduler. */

export interface GraphNode {
  id: string;
  dependsOn: readonly string[];
}

export interface OrderResult {
  /** Nodes in dependency order (dependencies first), ties kept in input order. */
  order: string[];
  /** One dependency cycle as an id path (first id repeated at the end), or `null`. */
  cycle: string[] | null;
}

/**
 * Orders nodes so every dependency comes before its dependents and finds a
 * cycle if there is one. References to ids that are not nodes are ignored
 * here; check them separately. Deterministic for a given input order.
 */
export function orderByDependencies(nodes: readonly GraphNode[]): OrderResult {
  const known = new Set(nodes.map((n) => n.id));
  const remaining = nodes.map((n) => ({
    id: n.id,
    deps: new Set(n.dependsOn.filter((d) => known.has(d))),
  }));
  const done = new Set<string>();
  const order: string[] = [];

  while (remaining.length > 0) {
    const index = remaining.findIndex((n) => [...n.deps].every((d) => done.has(d)));
    if (index === -1) break;
    const [next] = remaining.splice(index, 1);
    if (next) {
      order.push(next.id);
      done.add(next.id);
    }
  }
  if (remaining.length === 0) return { order, cycle: null };

  // Everything left is on, or downstream of, a cycle: walk dependencies until one repeats.
  const stuck = new Map(
    remaining.map((n) => [n.id, [...n.deps].filter((d) => !done.has(d))]),
  );
  const path: string[] = [];
  let current = remaining[0]?.id;
  while (current !== undefined) {
    const seenAt = path.indexOf(current);
    if (seenAt !== -1) return { order, cycle: [...path.slice(seenAt), current] };
    path.push(current);
    current = stuck.get(current)?.[0];
  }
  return { order, cycle: null };
}

export function findCycle(nodes: readonly GraphNode[]): string[] | null {
  return orderByDependencies(nodes).cycle;
}
