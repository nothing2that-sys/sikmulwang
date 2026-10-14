export type PwaStatus =
  "development" | "unsupported" | "registering" | "ready" | "error";
export type PwaEvents = {
  status: (status: PwaStatus) => void;
  update: (worker: ServiceWorker) => void;
};

export async function registerPwa(events: PwaEvents): Promise<() => void> {
  if (!import.meta.env.PROD) {
    events.status("development");
    return () => {};
  }
  if (!("serviceWorker" in navigator)) {
    events.status("unsupported");
    return () => {};
  }
  let previousController = navigator.serviceWorker.controller;
  const onController = () => {
    if (previousController) window.location.reload();
    else previousController = navigator.serviceWorker.controller;
  };
  navigator.serviceWorker.addEventListener("controllerchange", onController);
  let registration: ServiceWorkerRegistration | undefined;
  let interval: ReturnType<typeof setInterval> | undefined;
  const inspect = () => {
    if (registration?.waiting && navigator.serviceWorker.controller)
      events.update(registration.waiting);
  };
  const onUpdateFound = () => {
    const worker = registration?.installing;
    worker?.addEventListener("statechange", () => {
      if (worker.state === "installed") {
        if (navigator.serviceWorker.controller) inspect();
        else events.status("ready");
      }
      if (worker.state === "redundant" && !registration?.active)
        events.status("error");
    });
  };
  const check = () => {
    if (navigator.onLine) void registration?.update().catch(() => {});
  };
  try {
    events.status("registering");
    registration = await navigator.serviceWorker.register("/sw.js", {
      updateViaCache: "none",
    });
    inspect();
    registration.addEventListener("updatefound", onUpdateFound);
    if (registration.installing) onUpdateFound();
    if (registration.active || registration.waiting) events.status("ready");
    interval = setInterval(check, 60_000);
    window.addEventListener("online", check);
  } catch {
    events.status("error");
  }
  return () => {
    navigator.serviceWorker.removeEventListener(
      "controllerchange",
      onController,
    );
    registration?.removeEventListener("updatefound", onUpdateFound);
    window.removeEventListener("online", check);
    if (interval) clearInterval(interval);
  };
}
