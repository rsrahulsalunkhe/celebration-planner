export interface Option<T extends string = string> {
  value: T;
  label: string;
}

/** Builds options from a value-to-label map, keeping the map's key order. */
export function toOptions<T extends string>(labels: Record<T, string>): Option<T>[] {
  return (Object.keys(labels) as T[]).map((value) => ({ value, label: labels[value] }));
}
