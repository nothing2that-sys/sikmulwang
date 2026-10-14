import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { registerPwa, type PwaStatus } from "../../lib/pwa";

type PwaContextValue = { status: PwaStatus; worker: ServiceWorker | null };
const PwaContext = createContext<PwaContextValue>({
  status: "development",
  worker: null,
});
export function PwaProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<PwaStatus>("registering");
  const [worker, setWorker] = useState<ServiceWorker | null>(null);
  useEffect(() => {
    let mounted = true;
    let dispose: (() => void) | undefined;
    void registerPwa({
      status: (value) => {
        if (mounted) setStatus(value);
      },
      update: (value) => {
        if (mounted) setWorker(value);
      },
    }).then((cleanup) => {
      if (mounted) dispose = cleanup;
      else cleanup();
    });
    return () => {
      mounted = false;
      dispose?.();
    };
  }, []);
  return (
    <PwaContext.Provider value={{ status, worker }}>
      {children}
    </PwaContext.Provider>
  );
}
export function usePwa() {
  return useContext(PwaContext);
}
