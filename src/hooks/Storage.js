import { useCallback, useEffect, useRef, useState } from "react";
import { storage } from "../libs/storage";
import { kissLog } from "../libs/log";
import { syncData } from "../libs/sync";
import { subscribeStorageRefresh } from "../libs/storageRefresh";
import { useDebouncedCallback } from "./DebouncedCallback";
import { isOptions } from "../libs/browser";

function isSameStorageValue(a, b) {
  if (Object.is(a, b)) return true;

  if (
    a &&
    b &&
    typeof a === "object" &&
    typeof b === "object" &&
    Array.isArray(a) === Array.isArray(b)
  ) {
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch (err) {
      return false;
    }
  }

  return false;
}

/**
 * Read persisted values without writing them back. Only user edits schedule
 * remote sync; values received from remote sync are persisted once.
 * Keep defaultVal stable between renders.
 */
export function useStorage(key, defaultVal = null, syncKey = "") {
  const [isLoading, setIsLoading] = useState(true);
  const [data, setData] = useState(defaultVal);
  const dataRef = useRef(defaultVal);
  const scopeRef = useRef(null);
  const writeQueueRef = useRef(Promise.resolve());

  const isCurrent = useCallback(
    (scope, revision) =>
      scopeRef.current === scope && scope.active && scope.revision === revision,
    []
  );

  const setValue = useCallback((value) => {
    dataRef.current = value;
    setData(() => value);
  }, []);

  // Preserve the order of writes even when their asynchronous backends vary.
  const queueWrite = useCallback((write) => {
    const pending = writeQueueRef.current.then(write);
    writeQueueRef.current = pending.catch(() => {});
    return pending;
  }, []);

  const runSync = useCallback(
    async (scope, revision, keyToSync, valueToSync) => {
      if (!isCurrent(scope, revision)) return;
      try {
        const res = await syncData(keyToSync, valueToSync);
        if (!res?.isNew || !isCurrent(scope, revision)) return;

        const remoteRevision = ++scope.revision;
        await queueWrite(async () => {
          if (!isCurrent(scope, remoteRevision)) return;
          await storage.setObj(scope.key, res.value);
        });
        if (isCurrent(scope, remoteRevision)) {
          setValue(res.value);
        }
      } catch (error) {
        kissLog("Sync failed", keyToSync, error);
      }
    },
    [isCurrent, queueWrite, setValue]
  );
  const debouncedSync = useDebouncedCallback(runSync, 3000);

  const load = useCallback(
    async (initialize = false) => {
      const scope = scopeRef.current;
      if (!scope?.active || scope.key !== key) return;
      const revision = scope.revision;
      const readId = ++scope.readId;
      const isLatestRead = () =>
        isCurrent(scope, revision) && scope.readId === readId;

      try {
        // A reload must observe any user writes already queued by this hook.
        await writeQueueRef.current;
        if (!isLatestRead()) return;
        const storedVal = await storage.getObj(key);
        if (!isLatestRead()) return;

        const nextData = storedVal ?? defaultVal;
        if (initialize && (storedVal === undefined || storedVal === null)) {
          await queueWrite(async () => {
            if (isLatestRead()) await storage.setObj(key, defaultVal);
          });
        }
        if (!isLatestRead()) return;

        if (!isSameStorageValue(dataRef.current, nextData)) {
          scope.revision += 1;
          debouncedSync.cancel();
          setValue(nextData);
        }
      } catch (err) {
        kissLog(`storage load error for key: ${key}`, err);
        throw err;
      } finally {
        if (
          scopeRef.current === scope &&
          scope.active &&
          scope.readId === readId
        ) {
          setIsLoading(false);
        }
      }
    },
    [key, defaultVal, isCurrent, queueWrite, debouncedSync, setValue]
  );
  const reload = useCallback(() => load().catch(() => {}), [load]);

  useEffect(() => {
    const scope = { key, active: true, revision: 0, readId: 0 };
    scopeRef.current = scope;
    setValue(defaultVal);
    setIsLoading(true);
    const unsubscribe = subscribeStorageRefresh(key, () => load());
    load(true).catch(() => {});

    return () => {
      scope.active = false;
      debouncedSync.cancel();
      unsubscribe();
    };
  }, [key, defaultVal, load, setValue, debouncedSync]);

  const save = useCallback(
    (valueOrFn) => {
      const scope = scopeRef.current;
      if (!scope?.active || scope.key !== key) return;
      const nextData =
        typeof valueOrFn === "function"
          ? valueOrFn(dataRef.current)
          : valueOrFn;
      if (isSameStorageValue(dataRef.current, nextData)) return;

      const revision = ++scope.revision;
      debouncedSync.cancel();
      setValue(nextData);
      setIsLoading(false);
      if (nextData === null) return;

      // Complete explicit user writes even if their component closes meanwhile.
      queueWrite(() => storage.setObj(key, nextData))
        .then(() => {
          if (isCurrent(scope, revision) && syncKey && isOptions()) {
            debouncedSync(scope, revision, syncKey, nextData);
          }
        })
        .catch((err) => {
          kissLog(`storage save error for key: ${key}`, err);
        });
    },
    [key, syncKey, isCurrent, queueWrite, debouncedSync, setValue]
  );

  const update = useCallback(
    (partialDataOrFn) => {
      save((prevData) => {
        const partialData =
          typeof partialDataOrFn === "function"
            ? partialDataOrFn(prevData)
            : partialDataOrFn;
        const baseObj =
          typeof prevData === "object" && prevData !== null ? prevData : {};
        return { ...baseObj, ...partialData };
      });
    },
    [save]
  );

  const remove = useCallback(async () => {
    const scope = scopeRef.current;
    if (!scope?.active || scope.key !== key) return;
    const revision = ++scope.revision;
    debouncedSync.cancel();
    try {
      await queueWrite(() => storage.del(key));
      if (isCurrent(scope, revision)) {
        setValue(null);
        setIsLoading(false);
      }
    } catch (err) {
      kissLog(`storage remove error for key: ${key}`, err);
    }
  }, [key, isCurrent, queueWrite, debouncedSync, setValue]);

  return { data, save, update, remove, reload, isLoading };
}
