import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  applyPwaUpdate,
  registerPwa,
  type PwaStatus,
  type PwaUpdateState,
} from "../../lib/pwa";

type PwaContextValue = {
  status: PwaStatus;
  worker: ServiceWorker | null;
  updateState: PwaUpdateState;
  applyUpdate: () => void;
};
const PwaContext = createContext<PwaContextValue>({
  status: "development",
  worker: null,
  updateState: "idle",
  applyUpdate: () => {},
});
export function PwaProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<PwaStatus>("registering");
  const [worker, setWorker] = useState<ServiceWorker | null>(null);
  const [updateState, setUpdateState] = useState<PwaUpdateState>("idle");
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
      updateState: (value) => {
        if (mounted) setUpdateState(value);
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
  const applyUpdate = () => {
    applyPwaUpdate(worker, {
      update: (value) => setWorker(value),
      updateState: (value) => setUpdateState(value),
    });
  };
  return (
    <PwaContext.Provider value={{ status, worker, updateState, applyUpdate }}>
      {children}
    </PwaContext.Provider>
  );
}
export function usePwa() {
  return useContext(PwaContext);
}
