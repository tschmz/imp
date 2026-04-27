export function getValueAtKeyPath(root: unknown, keyPath: string): unknown {
  const segments = keyPath.split(".");

  if (segments.includes("*")) {
    return getValuesAtWildcardKeyPath(root, segments);
  }

  return getValueAtSegments(root, segments);
}

function getValueAtSegments(current: unknown, segments: string[]): unknown {
  if (segments.length === 0) {
    return current;
  }

  if (Array.isArray(current)) {
    const match = getArrayMatch(current, segments);
    if (!match) {
      return undefined;
    }

    return getValueAtSegments(match.value, segments.slice(match.consumed));
  }

  const [segment, ...remainingSegments] = segments;
  const child = getObjectChildValue(current, segment);
  if (child === undefined) {
    return undefined;
  }

  return getValueAtSegments(child, remainingSegments);
}

function getValuesAtWildcardKeyPath(root: unknown, segments: string[]): unknown[] {
  if (segments.length === 0) {
    return [root];
  }

  const [segment, ...remainingSegments] = segments;
  if (segment === "*") {
    return getWildcardChildValues(root).flatMap((value) => getValuesAtWildcardKeyPath(value, remainingSegments));
  }

  if (Array.isArray(root)) {
    const match = getArrayMatch(root, segments);
    if (!match) {
      return [];
    }

    return getValuesAtWildcardKeyPath(match.value, segments.slice(match.consumed));
  }

  const child = getObjectChildValue(root, segment);
  if (child === undefined) {
    return [];
  }

  return getValuesAtWildcardKeyPath(child, remainingSegments);
}

function getWildcardChildValues(current: unknown): unknown[] {
  if (typeof current !== "object" || current === null) {
    return [];
  }

  if (Array.isArray(current)) {
    return current;
  }

  return Object.values(current);
}

export function setValueAtKeyPath(root: unknown, keyPath: string, value: unknown): void {
  const segments = keyPath.split(".");
  if (segments.length === 0 || segments.some((segment) => segment.length === 0)) {
    throw new Error(`Config key not found: ${keyPath}`);
  }

  setValueAtSegments(root, segments, value, keyPath);
}

function setValueAtSegments(current: unknown, segments: string[], value: unknown, keyPath: string): void {
  if (typeof current !== "object" || current === null) {
    throw new Error(`Config key not found: ${keyPath}`);
  }

  if (Array.isArray(current)) {
    const match = getArrayMatch(current, segments);
    if (!match) {
      throw new Error(`Config key not found: ${keyPath}`);
    }

    if (match.consumed === segments.length) {
      current[match.index] = value;
      return;
    }

    setValueAtSegments(match.value, segments.slice(match.consumed), value, keyPath);
    return;
  }

  const [segment, ...remainingSegments] = segments;
  if (remainingSegments.length === 0) {
    (current as Record<string, unknown>)[segment] = value;
    return;
  }

  const child = getOrCreateObjectChildValue(current, segment);
  if (child === undefined) {
    throw new Error(`Config key not found: ${keyPath}`);
  }

  setValueAtSegments(child, remainingSegments, value, keyPath);
}

function getObjectChildValue(current: unknown, segment: string | undefined): unknown {
  if (segment === undefined) {
    return undefined;
  }

  if (typeof current !== "object" || current === null) {
    return undefined;
  }

  return (current as Record<string, unknown>)[segment];
}

function getOrCreateObjectChildValue(current: unknown, segment: string | undefined): unknown {
  if (segment === undefined) {
    return undefined;
  }

  if (typeof current !== "object" || current === null) {
    return undefined;
  }

  const record = current as Record<string, unknown>;
  if (!Object.hasOwn(record, segment)) {
    record[segment] = {};
  }

  return record[segment];
}

function getArrayMatch(
  items: unknown[],
  segments: string[],
): { index: number; value: unknown; consumed: number } | undefined {
  const [segment] = segments;
  if (segment === undefined) {
    return undefined;
  }

  const numericIndex = Number(segment);
  if (Number.isInteger(numericIndex) && String(numericIndex) === segment) {
    return numericIndex >= 0 && numericIndex < items.length
      ? { index: numericIndex, value: items[numericIndex], consumed: 1 }
      : undefined;
  }

  for (let consumed = segments.length; consumed >= 1; consumed -= 1) {
    const expectedId = segments.slice(0, consumed).join(".");
    const index = items.findIndex((item) => hasMatchingId(item, expectedId));
    if (index >= 0) {
      return { index, value: items[index], consumed };
    }
  }

  return undefined;
}

function hasMatchingId(value: unknown, expectedId: string): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string" &&
    value.id === expectedId
  );
}
