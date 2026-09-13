import { kissLog } from "./log";

const listeners = new Map();

export function subscribeStorageWrite(key, listener) {
  if (!listeners.has(key)) listeners.set(key, new Set());
  const subscribers = listeners.get(key);
  subscribers.add(listener);
  return () => {
    subscribers.delete(listener);
    if (!subscribers.size) listeners.delete(key);
  };
}

export function publishStorageWrite(key, value, hasSyncMetadata = false) {
  listeners.get(key)?.forEach((listener) => {
    try {
      listener(value, hasSyncMetadata);
    } catch (error) {
      // A UI subscriber cannot turn a completed persistence into a failed write.
      kissLog("Storage subscriber failed", key, error);
    }
  });
}
