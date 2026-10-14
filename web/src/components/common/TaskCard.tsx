import { Droplets } from "lucide-react";
import { StatusBadge } from "./Feedback";

export type TaskPreview = {
  id: string;
  plantName: string;
  title: string;
  description: string;
};
export function TaskCard({ task }: { task: TaskPreview }) {
  return (
    <article className="task-card">
      <span className="task-icon">
        <Droplets aria-hidden="true" />
      </span>
      <div>
        <div className="card-meta">
          <span>{task.plantName}</span>
          <StatusBadge>데모</StatusBadge>
        </div>
        <h3>{task.title}</h3>
        <p>{task.description}</p>
        <p id={`task-${task.id}-hint`} className="field-hint">
          관리 기록은 Phase 1 기반 이후 제공됩니다.
        </p>
        <button
          className="button secondary"
          type="button"
          disabled
          aria-describedby={`task-${task.id}-hint`}
        >
          물주기 기록 준비 중
        </button>
      </div>
    </article>
  );
}
