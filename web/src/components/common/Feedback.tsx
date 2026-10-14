import { Leaf, LoaderCircle, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";

export function StatusBadge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "warning" | "danger";
}) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Leaf aria-hidden="true" size={32} />
      </span>
      <h2>{title}</h2>
      <p>{description}</p>
      {action}
    </div>
  );
}

export function LoadingState({
  message = "화면을 준비하고 있어요",
}: {
  message?: string;
}) {
  return (
    <div className="feedback" role="status">
      <LoaderCircle aria-hidden="true" className="loading-icon" />
      <p>{message}</p>
    </div>
  );
}

export function ErrorState({
  title = "화면을 불러오지 못했어요",
  description,
  onRetry,
}: {
  title?: string;
  description: string;
  onRetry?: () => void;
}) {
  return (
    <div className="feedback error" role="alert">
      <TriangleAlert aria-hidden="true" />
      <h2>{title}</h2>
      <p>{description}</p>
      {onRetry && (
        <button type="button" className="button" onClick={onRetry}>
          다시 시도
        </button>
      )}
    </div>
  );
}

export function PhaseNotice({ children }: { children: ReactNode }) {
  return (
    <div className="phase-notice">
      <StatusBadge>미리보기</StatusBadge>
      <p>{children}</p>
    </div>
  );
}
