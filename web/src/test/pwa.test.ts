import { afterEach, expect, it, vi } from "vitest";
import { applyPwaUpdate, registerPwa } from "../lib/pwa";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("does not register or cache development server resources", async () => {
  vi.stubEnv("PROD", false);
  const status = vi.fn();
  const updateState = vi.fn();
  const dispose = await registerPwa({
    status,
    update: vi.fn(),
    updateState,
  });
  expect(status).toHaveBeenCalledWith("development");
  expect(updateState).toHaveBeenCalledWith("idle");
  dispose();
});

it("reports unsupported service workers without claiming offline ready", async () => {
  vi.stubEnv("PROD", true);
  vi.stubGlobal("navigator", {});
  const status = vi.fn();
  await registerPwa({ status, update: vi.fn() });
  expect(status).toHaveBeenCalledWith("unsupported");
  expect(status).not.toHaveBeenCalledWith("ready");
});

it("reports registration failure and cleans up listener", async () => {
  vi.stubEnv("PROD", true);
  const container = Object.assign(new EventTarget(), {
    controller: null,
    register: vi.fn().mockRejectedValue(new Error("denied")),
  });
  const remove = vi.spyOn(container, "removeEventListener");
  vi.stubGlobal("navigator", { serviceWorker: container, onLine: true });
  const status = vi.fn();
  const dispose = await registerPwa({ status, update: vi.fn() });
  expect(status).toHaveBeenCalledWith("error");
  expect(status).not.toHaveBeenCalledWith("ready");
  dispose();
  expect(remove).toHaveBeenCalledWith("controllerchange", expect.any(Function));
});

it("transitions from registering to error when initial install precache fails", async () => {
  vi.stubEnv("PROD", true);
  const installing = Object.assign(new EventTarget(), {
    state: "installing" as ServiceWorkerState,
    postMessage: vi.fn(),
  });
  const registration = Object.assign(new EventTarget(), {
    installing,
    waiting: null,
    active: null,
    update: vi.fn().mockResolvedValue(undefined),
  });
  const container = Object.assign(new EventTarget(), {
    controller: null,
    register: vi.fn().mockResolvedValue(registration),
  });
  vi.stubGlobal("navigator", { serviceWorker: container, onLine: true });
  const status = vi.fn();
  const dispose = await registerPwa({ status, update: vi.fn() });
  expect(status).toHaveBeenLastCalledWith("registering");
  installing.state = "redundant";
  installing.dispatchEvent(new Event("statechange"));
  expect(status).toHaveBeenLastCalledWith("error");
  expect(status).not.toHaveBeenCalledWith("ready");
  dispose();
});

it("immediately reports error when initial worker already failed before subscription", async () => {
  vi.stubEnv("PROD", true);
  const redundantWorker = Object.assign(new EventTarget(), {
    state: "redundant" as ServiceWorkerState,
    postMessage: vi.fn(),
  });
  const registrationWithRedundant = Object.assign(new EventTarget(), {
    installing: redundantWorker,
    waiting: null,
    active: null,
    update: vi.fn().mockResolvedValue(undefined),
  });
  const container1 = Object.assign(new EventTarget(), {
    controller: null,
    register: vi.fn().mockResolvedValue(registrationWithRedundant),
  });
  vi.stubGlobal("navigator", { serviceWorker: container1, onLine: true });
  const status1 = vi.fn();
  const dispose1 = await registerPwa({ status: status1, update: vi.fn() });
  expect(status1).toHaveBeenLastCalledWith("error");
  dispose1();

  const emptyRegistration = Object.assign(new EventTarget(), {
    installing: null,
    waiting: null,
    active: null,
    update: vi.fn().mockResolvedValue(undefined),
  });
  const container2 = Object.assign(new EventTarget(), {
    controller: null,
    register: vi.fn().mockResolvedValue(emptyRegistration),
  });
  vi.stubGlobal("navigator", { serviceWorker: container2, onLine: true });
  const status2 = vi.fn();
  const dispose2 = await registerPwa({ status: status2, update: vi.fn() });
  expect(status2).toHaveBeenLastCalledWith("error");
  dispose2();
});

it("preserves ready status and marks update error when update install fails over an active worker", async () => {
  vi.stubEnv("PROD", true);
  const activeWorker = Object.assign(new EventTarget(), {
    state: "activated" as ServiceWorkerState,
  });
  const failedUpdateWorker = Object.assign(new EventTarget(), {
    state: "installing" as ServiceWorkerState,
  });
  const registration = Object.assign(new EventTarget(), {
    installing: null as ServiceWorker | null,
    waiting: null,
    active: activeWorker,
    update: vi.fn().mockResolvedValue(undefined),
  });
  const container = Object.assign(new EventTarget(), {
    controller: activeWorker,
    register: vi.fn().mockResolvedValue(registration),
  });
  vi.stubGlobal("navigator", { serviceWorker: container, onLine: true });
  const status = vi.fn();
  const update = vi.fn();
  const updateState = vi.fn();
  const dispose = await registerPwa({ status, update, updateState });
  expect(status).toHaveBeenLastCalledWith("ready");

  registration.installing = failedUpdateWorker as unknown as ServiceWorker;
  registration.dispatchEvent(new Event("updatefound"));
  failedUpdateWorker.state = "redundant";
  failedUpdateWorker.dispatchEvent(new Event("statechange"));

  expect(status).toHaveBeenLastCalledWith("ready");
  expect( status ).not.toHaveBeenCalledWith("error");
  expect(update).toHaveBeenLastCalledWith(null);
  expect(updateState).toHaveBeenLastCalledWith("error");
  dispose();
});

it("announces a waiting update only for an already controlled page", async () => {
  vi.stubEnv("PROD", true);
  const waiting = { postMessage: vi.fn() };
  const registration = Object.assign(new EventTarget(), {
    waiting,
    active: {},
    update: vi.fn().mockResolvedValue(undefined),
  });
  const container = Object.assign(new EventTarget(), {
    controller: {},
    register: vi.fn().mockResolvedValue(registration),
  });
  vi.stubGlobal("navigator", { serviceWorker: container, onLine: true });
  const update = vi.fn();
  const status = vi.fn();
  const updateState = vi.fn();
  const dispose = await registerPwa({ status, update, updateState });
  expect(container.register).toHaveBeenCalledWith("/sw.js", {
    updateViaCache: "none",
  });
  expect(update).toHaveBeenCalledWith(waiting);
  expect(updateState).toHaveBeenCalledWith("available");
  expect(status).toHaveBeenCalledWith("ready");
  expect(waiting.postMessage).not.toHaveBeenCalled();
  dispose();
});

it("handles missing or redundant waiting worker during user-confirmed update without reloading", () => {
  const update = vi.fn();
  const updateState = vi.fn();

  expect(applyPwaUpdate(null, { update, updateState })).toBe(false);
  expect(update).toHaveBeenLastCalledWith(null);
  expect(updateState).toHaveBeenLastCalledWith("error");

  const redundant = Object.assign(new EventTarget(), {
    state: "redundant" as ServiceWorkerState,
    postMessage: vi.fn(),
  }) as unknown as ServiceWorker;
  expect(applyPwaUpdate(redundant, { update, updateState })).toBe(false);
  expect(redundant.postMessage).not.toHaveBeenCalled();
  expect(updateState).toHaveBeenLastCalledWith("error");

  const failingWorker = Object.assign(new EventTarget(), {
    state: "installed" as ServiceWorkerState,
    postMessage: vi.fn(),
  });
  expect(
    applyPwaUpdate(failingWorker as unknown as ServiceWorker, {
      update,
      updateState,
    }),
  ).toBe(true);
  expect(updateState).toHaveBeenLastCalledWith("applying");
  expect(failingWorker.postMessage).toHaveBeenCalledWith({
    type: "SKIP_WAITING",
  });
  failingWorker.state = "redundant";
  failingWorker.dispatchEvent(new Event("statechange"));
  expect(update).toHaveBeenLastCalledWith(null);
  expect(updateState).toHaveBeenLastCalledWith("error");
});
