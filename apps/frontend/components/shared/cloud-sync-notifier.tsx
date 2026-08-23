"use client";

import { useEffect } from "react";
import { useCloudSyncStore } from "@/hooks/use-cloud-sync-store";

const POLL_MS = 30_000;
const RETRY_FAILED_MS = 15_000;

/**
 * Polls /cloud-backup/status while the dashboard is open and keeps the shared
 * sync store fresh for the navbar indicator and the Settings section. Polls
 * every 30s, and retries sooner when the last call failed (e.g. the backend
 * just restarted), so a machine coming back online is picked up quickly.
 */
export default function CloudSyncNotifier() {
  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const check = async () => {
      if (cancelled) return;
      const result = await useCloudSyncStore.getState().refresh();
      if (cancelled) return;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = setTimeout(() => void check(), result ? POLL_MS : RETRY_FAILED_MS);
    };
    void check();

    const onFocus = () => void check();
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      window.removeEventListener("focus", onFocus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}