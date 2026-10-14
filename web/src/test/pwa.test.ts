import { afterEach, expect, it, vi } from 'vitest';
import { registerPwa } from '../lib/pwa';

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it('does not register or cache development server resources', async () => {
  vi.stubEnv('PROD', false);
  const status = vi.fn();
  const dispose = await registerPwa({ status, update: vi.fn() });
  expect(status).toHaveBeenCalledWith('development');
  dispose();
});

it('reports unsupported service workers without claiming offline ready', async () => {
  vi.stubEnv('PROD', true);
  vi.stubGlobal('navigator', {});
  const status = vi.fn();
  await registerPwa({ status, update: vi.fn() });
  expect(status).toHaveBeenCalledWith('unsupported');
  expect(status).not.toHaveBeenCalledWith('ready');
});

it('reports registration failure and cleans up listener', async () => {
  vi.stubEnv('PROD', true);
  const container = Object.assign(new EventTarget(), { controller: null, register: vi.fn().mockRejectedValue(new Error('denied')) });
  const remove = vi.spyOn(container, 'removeEventListener');
  vi.stubGlobal('navigator', { serviceWorker: container, onLine: true });
  const status = vi.fn();
  const dispose = await registerPwa({ status, update: vi.fn() });
  expect(status).toHaveBeenCalledWith('error');
  expect(status).not.toHaveBeenCalledWith('ready');
  dispose();
  expect(remove).toHaveBeenCalledWith('controllerchange', expect.any(Function));
});

it('announces a waiting update only for an already controlled page', async () => {
  vi.stubEnv('PROD', true);
  const waiting = { postMessage: vi.fn() };
  const registration = Object.assign(new EventTarget(), { waiting, active: {}, update: vi.fn().mockResolvedValue(undefined) });
  const container = Object.assign(new EventTarget(), { controller: {}, register: vi.fn().mockResolvedValue(registration) });
  vi.stubGlobal('navigator', { serviceWorker: container, onLine: true });
  const update = vi.fn();
  const status = vi.fn();
  const dispose = await registerPwa({ status, update });
  expect(container.register).toHaveBeenCalledWith('/sw.js', { updateViaCache: 'none' });
  expect(update).toHaveBeenCalledWith(waiting);
  expect(status).toHaveBeenCalledWith('ready');
  expect(waiting.postMessage).not.toHaveBeenCalled();
  dispose();
});
