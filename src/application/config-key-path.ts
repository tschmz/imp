export function getValueAtKeyPath(root: unknown, keyPath: string): unknown {
  const segments = keyPath.split(".");

  if (segments.includes("*")) {
    return getValuesAtWildcardKeyPath(root, segments);
  }

  let current: unknown = root;

  for (const segment of segments) {
    current = getChildValue(current, segment);

    if (current === undefined) {
      return undefined;
    }
  }

  return current;
}

function getValuesAtWildcardKeyPath(root: unknown, segments: string[]): unknown[] {
  if (segments.length === 0) {
    return [root];
  }

  const [segment, ...remainingSegments] = segments;
  if (segment === "*") {
    return getWildcardChildValues(root).flatMap((value) => getValuesAtWildcardKeyPath(value, remainingSegments));
  }

  const child = getChildValue(root, segment);
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
  const lastSegment = segments.pop();

  if (!lastSegment) {
    throw new Error(`Config key not found: ${keyPath}`);
  }

  let current: unknown = root;

  for (const segment of segments) {
    current = getOrCreateChildValue(current, segment);

    if (current === undefined) {
      throw new Error(`Config key not found: ${keyPath}`);
    }
  }

  if (typeof current !== "object" || current === null) {
    throw new Error(`Config key not found: ${keyPath}`);
  }

  if (Array.isArray(current)) {
    const index = getArrayIndex(current, lastSegment);

    if (index === undefined) {
      throw new Error(`Config key not found: ${keyPath}`);
    }

    current[index] = value;
    return;
  }

  (current as Record<string, unknown>)[lastSegment] = value;
}

function getChildValue(current: unknown, segment: string): unknown {
  if (typeof current !== "object" || current === null) {
    return undefined;
  }

  if (Array.isArray(current)) {
    const index = getArrayIndex(current, segment);
    return index === undefined ? undefined : current[index];
  }

  return (current as Record<string, unknown>)[segment];
}

function getOrCreateChildValue(current: unknown, segment: string): unknown {
  if (typeof current !== "object" || current === null) {
    return undefined;
  }

  if (Array.isArray(current)) {
    const index = getArrayIndex(current, segment);
    return index === undefined ? undefined : current[index];
  }

  const record = current as Record<string, unknown>;
  if (!Object.hasOwn(record, segment)) {
    record[segment] = {};
  }

  return record[segment];
}

function getArrayIndex(items: unknown[], segment: string): number | undefined {
  const numericIndex = Number(segment);
  if (Number.isInteger(numericIndex) && String(numericIndex) === segment) {
    return numericIndex >= 0 && numericIndex < items.length ? numericIndex : undefined;
  }

  const matchedIndex = items.findIndex((item) => hasMatchingId(item, segment));
  return matchedIndex >= 0 ? matchedIndex : undefined;
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
