import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { Wifi, WifiOff } from "lucide-react";
import { Header } from "./Header";
import { BottomNavigation } from "./Navigation";
import { useOnline } from "../../hooks/useOnline";
import { usePwa } from "../../app/providers/PwaProvider";
import { ConfirmDialog } from "../common/ConfirmDialog";

export function AppShell({ children }: { children: ReactNode }) {
  const online = useOnline();
  const location = useLocation();
  const main = useRef<HTMLElement>(null);
  const previous = useRef(location.pathname);
  const { status, worker } = usePwa();
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    if (previous.current !== location.pathname) {
      previous.current = location.pathname;
      main.current?.querySelector<HTMLElement>("h1")?.focus();
      window.scrollTo(0, 0);
    }
    document.title = `${main.current?.querySelector("h1")?.textContent ?? "내 공간의 초록"} | 식물왕`;
  }, [location.pathname]);
  return (
    <div className="app-shell">
      <a
        className="skip-link"
        href="#main-content"
        onClick={(event) => {
          event.preventDefault();
          main.current?.focus();
        }}
      >
        본문으로 건너뛰기
      </a>
      <Header />
      <BottomNavigation />
      <div className="connection-status" role="status">
        {online ? (
          <Wifi size={15} aria-hidden="true" />
        ) : (
          <WifiOff size={15} aria-hidden="true" />
        )}
        <span>
          {online ? "온라인" : "오프라인 · 기본 화면을 이용할 수 있어요"}
        </span>
        {status === "error" && (
          <span>오프라인 준비 실패 · 온라인에서 다시 열어 주세요</span>
        )}
      </div>
      {worker && (
        <div className="update-notice" role="status">
          <p>새 버전이 준비됐어요. 화면의 임시 입력은 새로고침하면 사라져요.</p>
          <button className="button secondary" onClick={() => setConfirm(true)}>
            업데이트 안내
          </button>
        </div>
      )}
      <main id="main-content" tabIndex={-1} ref={main}>
        {children}
      </main>
      <footer className="footer">
        작은 돌봄이 자라는 곳 · 식물왕
        <span>Phase 0 미리보기 · 개인 데이터 저장 기능은 준비 중</span>
      </footer>
      <ConfirmDialog
        open={confirm}
        title="새 버전으로 전환할까요?"
        confirmLabel="업데이트하고 새로고침"
        onCancel={() => setConfirm(false)}
        onConfirm={() => worker?.postMessage({ type: "SKIP_WAITING" })}
      >
        <p>
          작성 중인 미리보기 입력은 저장되지 않습니다. 필요한 내용을 먼저 복사해
          주세요.
        </p>
      </ConfirmDialog>
    </div>
  );
}
