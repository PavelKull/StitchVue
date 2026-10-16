export function eventSessionIsCurrent(eventSession: number | undefined, current: number): boolean {
  return eventSession === current;
}

export function keepCurrentSession<T extends { session?: number }>(items: readonly T[], current: number): T[] {
  return items.filter((item) => eventSessionIsCurrent(item.session, current));
}
