// Shared browser storage. Keys are versioned as `makeshift:<name>:v<n>`, so
// bumping a version ignores data saved in an older shape.
export type StorageArea = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type StorageAccess = () => StorageArea | null;
export type WriteResult =
  | { ok: true }
  | { ok: false; reason: "unavailable" | "quota" | "error" };

// Null during server rendering, or when the browser blocks storage access.
export const browserStorage: StorageAccess = () => {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

export function storageKey(name: string, version: number): string {
  if (!/^[a-z0-9-]+$/.test(name))
    throw new Error(`Invalid storage name: ${name}`);
  if (!Number.isInteger(version) || version < 1)
    throw new Error(`Invalid storage version: ${version}`);
  return `makeshift:${name}:v${version}`;
}

// Checks the name rather than instanceof, so DOMExceptions from other realms
// still match. Firefox reports quota errors under its own name.
function quotaExceeded(error: unknown): boolean {
  const name = (error as { name?: unknown } | null)?.name;
  return name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED";
}

export function readStored<T>(
  name: string,
  version: number,
  fallback: T,
  validate: (value: unknown) => value is T,
  storage: StorageAccess = browserStorage,
): T {
  const key = storageKey(name, version);
  try {
    const raw = storage()?.getItem(key);
    if (raw == null) return fallback;
    const value: unknown = JSON.parse(raw);
    return validate(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

export function writeStored(
  name: string,
  version: number,
  value: unknown,
  storage: StorageAccess = browserStorage,
): WriteResult {
  const key = storageKey(name, version);
  try {
    const area = storage();
    if (!area) return { ok: false, reason: "unavailable" };
    const serialized: string | undefined = JSON.stringify(value);
    if (serialized === undefined) return { ok: false, reason: "error" };
    area.setItem(key, serialized);
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: quotaExceeded(error) ? "quota" : "error" };
  }
}

export function removeStored(
  name: string,
  version: number,
  storage: StorageAccess = browserStorage,
): boolean {
  const key = storageKey(name, version);
  try {
    const area = storage();
    if (!area) return false;
    area.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
