import { useEffect, useRef, useState } from "react";
import { AppState, AppStateStatus } from "react-native";
import {
  flushAttendanceQueue,
  pendingAttendanceCount,
  subscribeAttendanceQueue,
} from "../api/client";

// No NetInfo dependency: while marks are pending, retry on a short timer,
// which also covers "network regained".
const RETRY_INTERVAL_MS = 30 * 1000;

// Replays attendance marks saved while offline: on launch, on every
// foreground, and every 30s while any are still pending. Mounted once at
// the app root (same pattern as useAutoBiometricSync) so it runs
// regardless of which screen is open. Screens reload via
// subscribeAttendanceSynced.
export function useAttendanceQueueSync(token: string | null) {
  const appState = useRef<AppStateStatus>(AppState.currentState);

  useEffect(() => {
    if (!token) return;
    let timer: ReturnType<typeof setInterval> | null = null;

    function stopTimer() {
      if (timer) clearInterval(timer);
      timer = null;
    }

    async function sync() {
      const left = await flushAttendanceQueue(token!).catch(() => -1);
      if (left !== 0 && !timer) timer = setInterval(sync, RETRY_INTERVAL_MS);
      if (left === 0) stopTimer();
    }

    sync();
    // A mark queued while offline starts the retry timer.
    const unsubscribe = subscribeAttendanceQueue(() => {
      pendingAttendanceCount().then((n) => {
        if (n > 0 && !timer) timer = setInterval(sync, RETRY_INTERVAL_MS);
      });
    });
    const subscription = AppState.addEventListener("change", (next) => {
      if (appState.current !== "active" && next === "active") sync();
      appState.current = next;
    });

    return () => {
      stopTimer();
      unsubscribe();
      subscription.remove();
    };
  }, [token]);
}

export function usePendingAttendanceCount(): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let alive = true;
    const refresh = () => {
      pendingAttendanceCount().then((n) => alive && setCount(n)).catch(() => {});
    };
    refresh();
    const unsubscribe = subscribeAttendanceQueue(refresh);
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);
  return count;
}
