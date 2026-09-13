import { useCallback, useEffect, useRef, useState } from "react";
import { storage } from "../libs/storage";
import { getStorageState } from "../libs/storageState";
import { kissLog } from "../libs/log";
import { syncData } from "../libs/sync";
import { useDebouncedCallback } from "./DebouncedCallback";
import { isOptions } from "../libs/browser";

/** Read without writing defaults; share edits by key. Keep defaultVal stable. */
export function useStorage(key, defaultVal = null, syncKey = "") {
  const [snapshot, setSnapshot] = useState({
    data: defaultVal,
    isLoading: true,
  });
  const scopeRef = useRef(null);
  const scheduleSyncRef = useRef(null);
  const isCurrent = useCallback(
    (scope, revision) =>
      scopeRef.current === scope &&
      scope.active &&
      scope.state.revision === revision,
    []
  );

  const runSync = useCallback(
    (scope, revision, value) =>
      scope.state.enqueueSync(async () => {
        if (!isCurrent(scope, revision) || !scope.state.dirty) return;
        const requestEditVersion = scope.state.editVersion;
        try {
          const result = await syncData(syncKey, value, {
            deferCommit: true,
            isRequestCurrent: () => isCurrent(scope, revision),
          });
          if (!result) return;
          const accepted = await scope.state.enqueueWrite(() =>
            result.commit({
              applyValue: async () => {
                if (result.isNew) await storage.setObj(key, result.value);
              },
              rollbackValue: () => storage.setObj(key, value),
              isCurrent: () => isCurrent(scope, revision),
              shouldRetry: () =>
                scope.state.snapshot.data !== null &&
                scope.state.editVersion !== requestEditVersion,
              getRetryTimestamp: () => scope.state.editTimestamp,
            })
          );
          if (accepted && isCurrent(scope, revision)) {
            if (result.isNew) scope.state.acceptValue(result.value);
            else scope.state.markSynced(revision);
            // Legacy encryption is network work, outside the local write queue.
            await result.migrateLegacy?.();
          } else if (scope.active && scope.state.dirty) {
            // Retry the retained edit with its original dirty timestamp. Rejecting
            // a response must not change the timestamp conflict policy.
            scheduleSyncRef.current(
              scope,
              scope.state.revision,
              scope.state.snapshot.data
            );
          }
        } catch (error) {
          kissLog("Sync failed", syncKey, error);
          if (error.storageRecoveryFailed && scope.active) {
            await scope.state
              .load()
              .catch((readError) =>
                kissLog("Reload after sync failure", readError)
              );
          }
        }
      }),
    [isCurrent, key, syncKey]
  );
  const debouncedSync = useDebouncedCallback(runSync, 3000);
  scheduleSyncRef.current = debouncedSync;

  useEffect(() => {
    const state = getStorageState(key, defaultVal);
    const scope = { key, state, active: true };
    scopeRef.current = scope;
    const unsubscribe = state.subscribe((next) => {
      if (scope.active) setSnapshot(next);
    });
    state.ensureLoaded().catch((error) => {
      if (scope.active) kissLog(`storage load error for key: ${key}`, error);
    });
    return () => {
      scope.active = false;
      debouncedSync.cancel();
      unsubscribe();
    };
  }, [key, defaultVal, debouncedSync]);

  const save = useCallback(
    (valueOrFn) => {
      const scope = scopeRef.current;
      if (!scope?.active || scope.key !== key) return Promise.resolve();
      return scope.state
        .save(valueOrFn)
        .then((saved) => {
          if (
            saved &&
            isCurrent(scope, saved.revision) &&
            syncKey &&
            isOptions()
          ) {
            debouncedSync(scope, saved.revision, saved.value);
          }
        })
        .catch((error) => {
          kissLog(`storage save error for key: ${key}`, error);
        });
    },
    [key, syncKey, isCurrent, debouncedSync]
  );

  const update = useCallback(
    (partialDataOrFn) =>
      save((previous) => {
        const partial =
          typeof partialDataOrFn === "function"
            ? partialDataOrFn(previous)
            : partialDataOrFn;
        const base =
          typeof previous === "object" && previous !== null ? previous : {};
        return { ...base, ...partial };
      }),
    [save]
  );

  const remove = useCallback(async () => {
    const scope = scopeRef.current;
    if (!scope?.active || scope.key !== key) return;
    debouncedSync.cancel();
    try {
      await scope.state.remove();
    } catch (error) {
      kissLog(`storage remove error for key: ${key}`, error);
    }
  }, [key, debouncedSync]);

  const reload = useCallback(async () => {
    const scope = scopeRef.current;
    if (!scope?.active || scope.key !== key) return;
    try {
      await scope.state.load();
    } catch (error) {
      if (scope.active) kissLog(`storage reload error for key: ${key}`, error);
    }
  }, [key]);

  return { ...snapshot, save, update, remove, reload };
}
