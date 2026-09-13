import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { useStorage } from "./Storage";
import { storage } from "../libs/storage";
import { syncData } from "../libs/sync";
import { isOptions } from "../libs/browser";
import { refreshStorageKeys } from "../libs/storageRefresh";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("../libs/storage", () => ({
  storage: {
    getObj: jest.fn(),
    setObj: jest.fn(),
    del: jest.fn(),
  },
}));

jest.mock("../libs/sync", () => ({
  syncData: jest.fn(),
}));

jest.mock("../libs/browser", () => ({
  isOptions: jest.fn(),
}));

jest.mock("../libs/log", () => ({
  kissLog: jest.fn(),
}));

const DEFAULT_VALUE = { local: true };
const LOCAL_KEY = "local-setting";
const REMOTE_KEY = "kiss-setting_v2.json";
const hosts = new Set();
let storedValues;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createHookHost({ key = LOCAL_KEY, strict = false } = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const hookResult = {};
  let mounted = true;

  function TestComponent({ storageKey }) {
    Object.assign(
      hookResult,
      useStorage(storageKey, DEFAULT_VALUE, REMOTE_KEY)
    );
    return null;
  }

  const host = {
    hookResult,
    render: (storageKey = key) => {
      act(() => {
        const component = <TestComponent storageKey={storageKey} />;
        root.render(strict ? <StrictMode>{component}</StrictMode> : component);
      });
    },
    unmount: () => {
      if (!mounted) return;
      mounted = false;
      act(() => {
        root.unmount();
      });
      container.remove();
      hosts.delete(host);
    },
  };
  hosts.add(host);
  return host;
}

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
  });
}

async function advanceTime(duration = 3000) {
  await act(async () => {
    jest.advanceTimersByTime(duration);
  });
}

async function mountHost(options) {
  const host = createHookHost(options);
  host.render();
  await flushEffects();
  expect(host.hookResult.isLoading).toBe(false);
  return host;
}

describe("useStorage persistence and refresh", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.resetAllMocks();
    storedValues = new Map([[LOCAL_KEY, DEFAULT_VALUE]]);
    storage.getObj.mockImplementation(async (key) => storedValues.get(key));
    storage.setObj.mockImplementation(async (key, value) => {
      storedValues.set(key, value);
    });
    storage.del.mockImplementation(async (key) => {
      storedValues.delete(key);
    });
    syncData.mockResolvedValue(undefined);
    isOptions.mockReturnValue(true);
  });

  afterEach(() => {
    for (const host of hosts) host.unmount();
    jest.useRealTimers();
  });

  test("loads existing values without writing or syncing them", async () => {
    storedValues.set(LOCAL_KEY, { persisted: true });
    const host = await mountHost({ strict: true });
    await advanceTime(6000);

    expect(host.hookResult.data).toEqual({ persisted: true });
    expect(storage.setObj).not.toHaveBeenCalled();
    expect(syncData).not.toHaveBeenCalled();
  });

  test("initializes a missing default once under StrictMode without syncing", async () => {
    storedValues.delete(LOCAL_KEY);
    const host = await mountHost({ strict: true });
    await advanceTime(6000);

    expect(host.hookResult.data).toEqual(DEFAULT_VALUE);
    expect(storage.setObj).toHaveBeenCalledTimes(1);
    expect(storage.setObj).toHaveBeenCalledWith(LOCAL_KEY, DEFAULT_VALUE);
    expect(syncData).not.toHaveBeenCalled();
  });

  test("reloads changed and missing persisted values without writing or syncing", async () => {
    const host = await mountHost();
    storedValues.set(LOCAL_KEY, { reloaded: true });
    await act(async () => {
      await host.hookResult.reload();
    });
    expect(host.hookResult.data).toEqual({ reloaded: true });

    storedValues.delete(LOCAL_KEY);
    await act(async () => {
      await host.hookResult.reload();
    });
    await advanceTime(6000);

    expect(host.hookResult.data).toEqual(DEFAULT_VALUE);
    expect(storage.setObj).not.toHaveBeenCalled();
    expect(syncData).not.toHaveBeenCalled();
  });

  test("persists batched user edits and syncs only the latest after a real debounce", async () => {
    const host = await mountHost({ strict: true });
    const replace = jest.fn((prev) => ({ ...prev, count: 1 }));
    const merge = jest.fn((prev) => ({ count: prev.count + 1 }));

    await act(async () => {
      host.hookResult.save(replace);
      host.hookResult.update(merge);
    });
    expect(replace).toHaveBeenCalledTimes(1);
    expect(merge).toHaveBeenCalledTimes(1);
    expect(host.hookResult.data).toEqual({ local: true, count: 2 });
    expect(storage.setObj).toHaveBeenCalledTimes(2);

    await advanceTime(2999);
    expect(syncData).not.toHaveBeenCalled();
    await advanceTime(1);
    expect(syncData).toHaveBeenCalledTimes(1);
    expect(syncData).toHaveBeenCalledWith(REMOTE_KEY, {
      local: true,
      count: 2,
    });
  });

  test("persists user edits outside Options without starting remote sync", async () => {
    isOptions.mockReturnValue(false);
    const host = await mountHost();
    await act(async () => {
      host.hookResult.save({ changed: true });
    });
    await advanceTime();

    expect(storage.setObj).toHaveBeenCalledWith(LOCAL_KEY, { changed: true });
    expect(syncData).not.toHaveBeenCalled();
  });

  test("persists a new remote result once without scheduling another sync", async () => {
    syncData.mockResolvedValue({ isNew: true, value: { remote: true } });
    const host = await mountHost();
    await act(async () => {
      host.hookResult.save({ changed: true });
    });
    await advanceTime();
    await advanceTime(6000);

    expect(host.hookResult.data).toEqual({ remote: true });
    expect(storedValues.get(LOCAL_KEY)).toEqual({ remote: true });
    expect(storage.setObj).toHaveBeenCalledTimes(2);
    expect(storage.setObj).toHaveBeenLastCalledWith(LOCAL_KEY, {
      remote: true,
    });
    expect(syncData).toHaveBeenCalledTimes(1);
  });

  test("ignores an initial read that finishes after a user edit", async () => {
    const initialRead = deferred();
    storage.getObj.mockReturnValueOnce(initialRead.promise);
    const host = createHookHost();
    host.render();
    await flushEffects();

    await act(async () => {
      host.hookResult.save({ changed: true });
      initialRead.resolve(null);
    });

    expect(host.hookResult.data).toEqual({ changed: true });
    expect(host.hookResult.isLoading).toBe(false);
    expect(storage.setObj).toHaveBeenCalledTimes(1);
    expect(storedValues.get(LOCAL_KEY)).toEqual({ changed: true });
  });

  test("ignores an old reload without cancelling a newer user sync", async () => {
    const host = await mountHost();
    const oldRead = deferred();
    storage.getObj.mockReturnValueOnce(oldRead.promise);
    const pendingReload = host.hookResult.reload();
    await flushEffects();

    await act(async () => {
      host.hookResult.save({ changed: true });
      oldRead.resolve({ stale: true });
      await pendingReload;
    });
    await advanceTime();

    expect(host.hookResult.data).toEqual({ changed: true });
    expect(syncData).toHaveBeenCalledWith(REMOTE_KEY, { changed: true });
    expect(storage.setObj).toHaveBeenCalledTimes(1);
  });

  test("ignores a remote response after a newer user edit", async () => {
    const oldSync = deferred();
    syncData.mockReturnValueOnce(oldSync.promise);
    const host = await mountHost();
    await act(async () => {
      host.hookResult.save({ edit: 1 });
    });
    await advanceTime();

    await act(async () => {
      host.hookResult.save({ edit: 2 });
      oldSync.resolve({ isNew: true, value: { stale: true } });
    });
    await advanceTime();

    expect(host.hookResult.data).toEqual({ edit: 2 });
    expect(storedValues.get(LOCAL_KEY)).toEqual({ edit: 2 });
    expect(storage.setObj).toHaveBeenCalledTimes(2);
    expect(syncData).toHaveBeenLastCalledWith(REMOTE_KEY, { edit: 2 });
  });

  test("keeps the result of the newest overlapping reload", async () => {
    const host = await mountHost();
    const oldRead = deferred();
    storage.getObj.mockReturnValueOnce(oldRead.promise);
    const pendingReload = host.hookResult.reload();
    await flushEffects();

    storedValues.set(LOCAL_KEY, { latest: true });
    await act(async () => {
      await host.hookResult.reload();
      oldRead.resolve({ stale: true });
      await pendingReload;
    });

    expect(host.hookResult.data).toEqual({ latest: true });
    expect(storage.setObj).not.toHaveBeenCalled();
  });

  test("keeps a newer save after an already started remote write", async () => {
    const remoteWrite = deferred();
    const host = await mountHost();
    syncData.mockResolvedValueOnce({ isNew: true, value: { remote: true } });
    await act(async () => {
      host.hookResult.save({ edit: 1 });
    });
    storage.setObj.mockImplementationOnce(async (key, value) => {
      await remoteWrite.promise;
      storedValues.set(key, value);
    });
    await advanceTime();

    await act(async () => {
      host.hookResult.save({ edit: 2 });
    });
    expect(storage.setObj).toHaveBeenCalledTimes(2);
    await act(async () => {
      remoteWrite.resolve();
    });

    expect(storage.setObj).toHaveBeenCalledTimes(3);
    expect(storedValues.get(LOCAL_KEY)).toEqual({ edit: 2 });
    expect(host.hookResult.data).toEqual({ edit: 2 });
  });

  test("preserves a pending user sync when reload reads the same value", async () => {
    const host = await mountHost();
    await act(async () => {
      host.hookResult.save({ changed: true });
    });
    storedValues.set(LOCAL_KEY, { changed: true });
    await act(async () => {
      await host.hookResult.reload();
    });
    await advanceTime();

    expect(storage.setObj).toHaveBeenCalledTimes(1);
    expect(syncData).toHaveBeenCalledWith(REMOTE_KEY, { changed: true });
  });

  test("cancels a pending sync when reload adopts a different persisted value", async () => {
    const host = await mountHost();
    await act(async () => {
      host.hookResult.save({ changed: true });
    });
    storedValues.set(LOCAL_KEY, { remote: true });
    await act(async () => {
      await host.hookResult.reload();
    });
    await advanceTime();

    expect(host.hookResult.data).toEqual({ remote: true });
    expect(storage.setObj).toHaveBeenCalledTimes(1);
    expect(syncData).not.toHaveBeenCalled();
  });

  test("waits for pending writes before reloading", async () => {
    const host = await mountHost();
    const pendingWrite = deferred();
    storage.setObj.mockImplementationOnce(async (key, value) => {
      await pendingWrite.promise;
      storedValues.set(key, value);
    });
    await act(async () => {
      host.hookResult.save({ changed: true });
    });
    const pendingReload = host.hookResult.reload();
    await flushEffects();
    expect(storage.getObj).toHaveBeenCalledTimes(1);

    await act(async () => {
      pendingWrite.resolve();
      await pendingReload;
    });
    expect(host.hookResult.data).toEqual({ changed: true });
    expect(storage.getObj).toHaveBeenCalledTimes(2);
  });

  test("removes storage without writing null or accepting an old sync result", async () => {
    const oldSync = deferred();
    syncData.mockReturnValueOnce(oldSync.promise);
    const host = await mountHost();
    await act(async () => {
      host.hookResult.save({ changed: true });
    });
    await advanceTime();

    await act(async () => {
      await host.hookResult.remove();
      oldSync.resolve({ isNew: true, value: { stale: true } });
    });
    await advanceTime(6000);

    expect(host.hookResult.data).toBe(null);
    expect(storedValues.has(LOCAL_KEY)).toBe(false);
    expect(storage.del).toHaveBeenCalledWith(LOCAL_KEY);
    expect(storage.setObj).toHaveBeenCalledTimes(1);
    expect(syncData).toHaveBeenCalledTimes(1);
  });

  test("invalidates an old key's read when the hook changes keys", async () => {
    const oldRead = deferred();
    storage.getObj.mockReturnValueOnce(oldRead.promise);
    storedValues.set("other-key", { other: true });
    const host = createHookHost();
    host.render();
    await flushEffects();
    host.render("other-key");
    await flushEffects();
    await act(async () => {
      oldRead.resolve({ stale: true });
    });

    expect(host.hookResult.data).toEqual({ other: true });
    expect(storage.setObj).not.toHaveBeenCalled();
  });

  test("finishes queued user persistence after unmount without remote sync", async () => {
    const host = await mountHost();
    act(() => {
      host.hookResult.save({ changed: true });
    });
    host.unmount();
    await flushEffects();
    await advanceTime();

    expect(storedValues.get(LOCAL_KEY)).toEqual({ changed: true });
    expect(syncData).not.toHaveBeenCalled();
  });

  test("refreshes every mounted subscriber once across multiple keys", async () => {
    storedValues.set("other-key", { other: true });
    const first = await mountHost();
    const second = await mountHost();
    const other = await mountHost({ key: "other-key" });
    const removed = await mountHost();
    removed.unmount();
    storage.getObj.mockClear();
    storedValues.set(LOCAL_KEY, { refreshed: true });
    storedValues.set("other-key", { updated: true });

    await act(async () => {
      await refreshStorageKeys([LOCAL_KEY, "other-key", LOCAL_KEY]);
    });
    await advanceTime();

    expect(first.hookResult.data).toEqual({ refreshed: true });
    expect(second.hookResult.data).toEqual({ refreshed: true });
    expect(other.hookResult.data).toEqual({ updated: true });
    expect(storage.getObj).toHaveBeenCalledTimes(3);
    expect(storage.setObj).not.toHaveBeenCalled();
    expect(syncData).not.toHaveBeenCalled();
  });

  test("rejects a refresh failure and preserves the displayed value", async () => {
    const host = await mountHost();
    const readError = new Error("Storage read failed");
    storage.getObj.mockRejectedValueOnce(readError);

    await act(async () => {
      await expect(refreshStorageKeys([LOCAL_KEY])).rejects.toBe(readError);
    });

    expect(host.hookResult.data).toEqual(DEFAULT_VALUE);
    expect(storage.setObj).not.toHaveBeenCalled();
  });

  test("keeps direct reload compatible with callers that do not handle errors", async () => {
    const host = await mountHost();
    storage.getObj.mockRejectedValueOnce(new Error("Storage read failed"));

    await act(async () => {
      await expect(host.hookResult.reload()).resolves.toBeUndefined();
    });

    expect(host.hookResult.data).toEqual(DEFAULT_VALUE);
  });
});
