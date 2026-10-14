import { useState } from "react";
import { Link } from "react-router-dom";
import { Camera, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import {
  PageContainer,
  PageHeading,
} from "../../components/layout/PageContainer";
import {
  EmptyState,
  PhaseNotice,
  StatusBadge,
} from "../../components/common/Feedback";
import { FormField } from "../../components/common/FormField";
import { calendarCells } from "./calendar";

export function JournalPage() {
  const [view, setView] = useState("타임라인");
  const [month, setMonth] = useState(
    () => new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  );
  return (
    <PageContainer>
      <PageHeading
        eyebrow="쌓여가는 초록의 하루"
        title="일기장"
        description="새잎부터 첫 수확까지, 나만의 이야기를 남길 곳."
        action={
          <Link className="button" to="/journal/new">
            <Plus size={18} aria-hidden="true" />
            작성 폼 미리보기
          </Link>
        }
      />
      <PhaseNotice>
        일기·사진 저장 및 초안 복구는 Phase 3에서 제공됩니다. 현재는 화면
        미리보기예요.
      </PhaseNotice>
      <div className="journal-toolbar">
        <div className="segmented" aria-label="일기 보기 방식">
          {["타임라인", "달력"].map((value) => (
            <button
              type="button"
              key={value}
              aria-pressed={view === value}
              onClick={() => setView(value)}
            >
              {value}
            </button>
          ))}
        </div>
        <FormField
          id="journal-plant"
          label="식물별 보기"
          hint="등록된 식물이 없어 전체만 볼 수 있어요."
        >
          <select
            id="journal-plant"
            aria-describedby="journal-plant-hint"
            disabled
          >
            <option>전체 식물</option>
          </select>
        </FormField>
      </div>
      {view === "타임라인" ? (
        <section className="card">
          <EmptyState
            title="첫 이야기를 기다리고 있어요"
            description="저장된 일기가 없습니다. 작성 화면의 구성을 먼저 살펴보세요."
          />
          <details>
            <summary>사진 일기 카드 예시 보기</summary>
            <article className="journal-card">
              <div className="photo-placeholder">
                <Camera size={36} aria-hidden="true" />
                <span>사진 배치 예시 · 실제 사진 없음</span>
              </div>
              <div>
                <StatusBadge>개발용 예시</StatusBadge>
                <h3>작은 새잎을 만난 날</h3>
                <p>
                  가상 식물의 가상 일기입니다. 사용자 데이터로 저장되지
                  않습니다.
                </p>
                <p className="field-hint">
                  일기 날짜: 2026-10-14 · 작성 시각: 2026-10-15 09:00 (예시)
                </p>
              </div>
            </article>
          </details>
        </section>
      ) : (
        <section className="card calendar-panel">
          <div className="calendar-heading">
            <button
              className="icon-button"
              type="button"
              aria-label="이전 달"
              onClick={() =>
                setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))
              }
            >
              <ChevronLeft aria-hidden="true" />
            </button>
            <h2 aria-live="polite">
              {month.getFullYear()}년 {month.getMonth() + 1}월
            </h2>
            <button
              className="icon-button"
              type="button"
              aria-label="다음 달"
              onClick={() =>
                setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))
              }
            >
              <ChevronRight aria-hidden="true" />
            </button>
          </div>
          <table className="calendar">
            <caption className="sr-only">
              {month.getFullYear()}년 {month.getMonth() + 1}월 일기 달력 ·
              저장된 일기 없음
            </caption>
            <thead>
              <tr>
                {["일", "월", "화", "수", "목", "금", "토"].map((day) => (
                  <th key={day} scope="col">
                    {day}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from(
                {
                  length:
                    calendarCells(month.getFullYear(), month.getMonth())
                      .length / 7,
                },
                (_, row) => (
                  <tr key={row}>
                    {calendarCells(month.getFullYear(), month.getMonth())
                      .slice(row * 7, row * 7 + 7)
                      .map((day, column) => (
                        <td key={column}>{day}</td>
                      ))}
                  </tr>
                ),
              )}
            </tbody>
          </table>
          <p className="muted">이번 달에 저장된 일기가 없어요.</p>
        </section>
      )}
    </PageContainer>
  );
}
