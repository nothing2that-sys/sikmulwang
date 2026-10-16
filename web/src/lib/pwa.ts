export type PwaStatus =
  | "development"
  | "unsupported"
  | "registering"
  | "ready"
  | "error";
export type PwaUpdateState = "idle" | "available" | "applying" | "error";
export type PwaEvents = {
  status: (status: PwaStatus) => void;
  update: (worker: ServiceWorker | null) => void;
  updateState?: (state: PwaUpdateState) => void;
};

//+_+// Validate waiting worker and handle redundant/missing worker on user-confirmed update
export function applyPwaUpdate(
  worker: ServiceWorker | null | undefined,
  events: Pick<PwaEvents, "update" | "updateState">,
): boolean {
  if (!worker || worker.state === "redundant") {
    events.update(null);
    events.updateState?.("error");
    return false;
  }
  events.updateState?.("applying");
  const onStateChange = () => {
    if (worker.state === "redundant") {
      worker.removeEventListener?.("statechange", onStateChange);
      events.update(null);
      events.updateState?.("error");
    }
  };
  worker.addEventListener?.("statechange", onStateChange);
  try {
    worker.postMessage({ type: "SKIP_WAITING" });
  } catch {
    worker.removeEventListener?.("statechange", onStateChange);
    events.update(null);
    events.updateState?.("error");
    return false;
  }
  if ((worker.state as ServiceWorkerState) === "redundant") {
    worker.removeEventListener?.("statechange", onStateChange);
    events.update(null);
    events.updateState?.("error");
    return false;
  }
  return true;
}

export async function registerPwa(events: PwaEvents): Promise<() => void> {
  if (!import.meta.env.PROD) {
    events.status("development");
    events.updateState?.("idle");
    return () => {};
  }
  if (!("serviceWorker" in navigator)) {
    events.status("unsupported");
    events.updateState?.("idle");
    return () => {};
  }
  const serviceWorker = navigator.serviceWorker;
  let previousController = serviceWorker.controller;
  let registration: ServiceWorkerRegistration | undefined;
  let interval: ReturnType<typeof setInterval> | undefined;
  const trackedWorkers = new Set<ServiceWorker>();
  const workerCleanups: Array<() => void> = [];

  const hasActiveShell = () =>
    Boolean(
      (registration?.active && registration.active.state !== "redundant") ||
        serviceWorker.controller,
    );

  const onController = () => {
    if (previousController) {
      window.location.reload();
    } else {
      previousController = serviceWorker.controller;
      if (previousController) events.status("ready");
    }
  };
  serviceWorker.addEventListener("controllerchange", onController);

  const inspect = () => {
    const waiting = registration?.waiting;
    if (!waiting) return;
    if (waiting.state === "redundant") {
      events.update(null);
      if (hasActiveShell()) {
        events.status("ready");
        events.updateState?.("error");
      } else {
        events.status("error");
      }
      return;
    }
    if (serviceWorker.controller) {
      events.update(waiting);
      events.updateState?.("available");
    } else {
      events.status("ready");
    }
  };

  //+_+// Inspect worker state immediately and on subsequent state transitions
  const evaluateWorker = (worker: ServiceWorker) => {
    if (worker.state === "installed") {
      if (serviceWorker.controller) {
        events.status("ready");
        events.update(registration?.waiting ?? worker);
        events.updateState?.("available");
      } else {
        events.status("ready");
      }
      return;
    }
    if (worker.state === "activated") {
      events.status("ready");
      return;
    }
    if (worker.state === "redundant") {
      events.update(null);
      if (hasActiveShell() && registration?.active !== worker) {
        events.status("ready");
        events.updateState?.("error");
      } else {
        events.status("error");
      }
    }
  };

  const trackWorker = (worker: ServiceWorker | null | undefined) => {
    if (!worker) return;
    evaluateWorker(worker);
    if (trackedWorkers.has(worker) || !worker.addEventListener) return;
    trackedWorkers.add(worker);
    const onStateChange = () => evaluateWorker(worker);
    worker.addEventListener("statechange", onStateChange);
    workerCleanups.push(() =>
      worker.removeEventListener?.("statechange", onStateChange),
    );
  };

  const onUpdateFound = () => {
    const worker = registration?.installing;
    if (worker) {
      trackWorker(worker);
      return;
    }
    if (registration?.waiting) {
      trackWorker(registration.waiting);
      inspect();
      return;
    }
    if (hasActiveShell()) {
      events.status("ready");
      events.update(null);
      events.updateState?.("error");
    } else {
      events.status("error");
    }
  };

  const check = () => {
    if (navigator.onLine) {
      void registration?.update().catch(() => {
        if (hasActiveShell()) {
          events.status("ready");
          events.updateState?.("error");
        }
      });
    }
  };

  try {
    events.status("registering");
    registration = await serviceWorker.register("/sw.js", {
      updateViaCache: "none",
    });
    registration.addEventListener?.("updatefound", onUpdateFound);
    if (registration.active && registration.active.state !== "redundant") {
      events.status("ready");
      trackWorker(registration.active);
    }
    if (registration.waiting) {
      trackWorker(registration.waiting);
      inspect();
    }
    if (registration.installing) {
      trackWorker(registration.installing);
    }
    if (
      !registration.installing &&
      !registration.waiting &&
      !hasActiveShell()
    ) {
      events.status("error");
    }
    interval = setInterval(check, 60_000);
    window.addEventListener("online", check);
  } catch {
    events.update(null);
    if (hasActiveShell()) {
      events.status("ready");
      events.updateState?.("error");
    } else {
      events.status("error");
    }
  }

  return () => {
    serviceWorker.removeEventListener(
      "controllerchange",
      onController,
    );
    registration?.removeEventListener?.("updatefound", onUpdateFound);
    for (const cleanup of workerCleanups) cleanup();
    window.removeEventListener("online", check);
    if (interval) clearInterval(interval);
  };
}
