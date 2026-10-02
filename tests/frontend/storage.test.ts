import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  browserStorage,
  readStored,
  removeStored,
  storageKey,
  writeStored,
  type StorageArea,
} from "../../frontend/src/lib/storage";

interface Settings {
  volume: number;
}
const isSettings = (v: unknown): v is Settings =>
  !!v &&
  typeof v === "object" &&
  typeof (v as Settings).volume === "number";
const DEFAULT: Settings = { volume: 0.7 };

function memoryStorage(entries: Record<string, string> = {}) {
  const items = new Map(Object.entries(entries));
  const area: StorageArea = {
    getItem: (k) => items.get(k) ?? null,
    setItem: (k, v) => void items.set(k, v),
    removeItem: (k) => void items.delete(k),
  };
  return { items, access: () => area };
}
function failingStorage(name: string) {
  const area: StorageArea = {
    getItem: () => null,
    setItem: () => {
      const error = new Error("storage failed");
      error.name = name;
      throw error;
    },
    removeItem: () => undefined,
  };
  return () => area;
}

afterEach(() => vi.unstubAllGlobals());

describe("storageKey", () => {
  it("builds versioned makeshift keys", () => {
    expect(storageKey("settings", 1)).toBe("makeshift:settings:v1");
    expect(storageKey("midi-takes", 12)).toBe("makeshift:midi-takes:v12");
  });

  it("rejects names and versions that would produce ambiguous keys", () => {
    for (const name of ["", "Settings", "a:b", "a b"])
      expect(() => storageKey(name, 1)).toThrow();
    for (const version of [0, -1, 1.5, Number.NaN])
      expect(() => storageKey("settings", version)).toThrow();
  });
});

describe("readStored", () => {
  it("round-trips a validated value", () => {
    const { access } = memoryStorage();
    expect(writeStored("settings", 1, { volume: 0.3 }, access)).toEqual({
      ok: true,
    });
    expect(readStored("settings", 1, DEFAULT, isSettings, access)).toEqual({
      volume: 0.3,
    });
  });

  it("returns the default for missing, corrupt or invalid values", () => {
    const { access } = memoryStorage({
      "makeshift:corrupt:v1": "{not json",
      "makeshift:invalid:v1": JSON.stringify({ volume: "loud" }),
      "makeshift:null:v1": "null",
    });
    for (const name of ["missing", "corrupt", "invalid", "null"])
      expect(readStored(name, 1, DEFAULT, isSettings, access)).toBe(DEFAULT);
  });

  it("ignores data saved under a different version", () => {
    const { access } = memoryStorage({
      "makeshift:settings:v1": JSON.stringify({ volume: 0.3 }),
    });
    expect(readStored("settings", 2, DEFAULT, isSettings, access)).toBe(
      DEFAULT,
    );
  });

  it("returns the default when reading throws", () => {
    const access = () => ({
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => undefined,
      removeItem: () => undefined,
    });
    expect(readStored("settings", 1, DEFAULT, isSettings, access)).toBe(
      DEFAULT,
    );
  });
});

describe("writeStored", () => {
  it("reports quota errors instead of throwing", () => {
    for (const name of ["QuotaExceededError", "NS_ERROR_DOM_QUOTA_REACHED"])
      expect(
        writeStored("settings", 1, DEFAULT, failingStorage(name)),
      ).toEqual({ ok: false, reason: "quota" });
  });

  it("reports other write and serialization failures", () => {
    expect(
      writeStored("settings", 1, DEFAULT, failingStorage("SecurityError")),
    ).toEqual({ ok: false, reason: "error" });
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const { access, items } = memoryStorage();
    expect(writeStored("settings", 1, circular, access)).toEqual({
      ok: false,
      reason: "error",
    });
    expect(items.size).toBe(0);
  });

  it("rejects values that do not serialize to JSON", () => {
    const { access, items } = memoryStorage();
    for (const value of [undefined, () => 1, Symbol("x")])
      expect(writeStored("settings", 1, value, access)).toEqual({
        ok: false,
        reason: "error",
      });
    expect(items.size).toBe(0);
    expect(readStored("settings", 1, DEFAULT, isSettings, access)).toBe(
      DEFAULT,
    );
  });

  it("recognizes DOMException quota errors from native and jsdom realms", () => {
    const { window } = new JSDOM("", { url: "http://localhost" });
    for (const error of [
      new DOMException("full", "QuotaExceededError"),
      new window.DOMException("full", "QuotaExceededError"),
    ]) {
      const access = () => ({
        getItem: () => null,
        setItem: () => {
          throw error;
        },
        removeItem: () => undefined,
      });
      expect(writeStored("settings", 1, DEFAULT, access)).toEqual({
        ok: false,
        reason: "quota",
      });
    }
  });
});

describe("removeStored", () => {
  it("removes only the requested version", () => {
    const { access, items } = memoryStorage({
      "makeshift:settings:v1": "1",
      "makeshift:settings:v2": "2",
    });
    expect(removeStored("settings", 1, access)).toBe(true);
    expect([...items.keys()]).toEqual(["makeshift:settings:v2"]);
  });
});

describe("server rendering and unavailable storage", () => {
  it("does not touch window when it is undefined", () => {
    expect(typeof window).toBe("undefined");
    expect(browserStorage()).toBeNull();
    expect(readStored("settings", 1, DEFAULT, isSettings)).toBe(DEFAULT);
    expect(writeStored("settings", 1, DEFAULT)).toEqual({
      ok: false,
      reason: "unavailable",
    });
    expect(removeStored("settings", 1)).toBe(false);
  });

  it("treats blocked localStorage access as unavailable", () => {
    vi.stubGlobal("window", {
      get localStorage(): Storage {
        throw new Error("SecurityError");
      },
    });
    expect(browserStorage()).toBeNull();
    expect(readStored("settings", 1, DEFAULT, isSettings)).toBe(DEFAULT);
    expect(writeStored("settings", 1, DEFAULT)).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });

  it("uses window.localStorage in the browser", () => {
    const { window } = new JSDOM("", { url: "http://localhost" });
    vi.stubGlobal("window", window);
    expect(writeStored("settings", 1, { volume: 0.3 })).toEqual({ ok: true });
    expect(window.localStorage.getItem("makeshift:settings:v1")).toBe(
      '{"volume":0.3}',
    );
    expect(readStored("settings", 1, DEFAULT, isSettings)).toEqual({
      volume: 0.3,
    });
  });
});
