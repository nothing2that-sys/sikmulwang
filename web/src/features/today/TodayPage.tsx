import { useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  CalendarDays,
  CloudSun,
  Search,
  Stethoscope,
  Sprout,
  AlertCircle,
} from "lucide-react";
import {
  PageContainer,
  PageHeading,
} from "../../components/layout/PageContainer";
import { EmptyState, PhaseNotice } from "../../components/common/Feedback";
import { SectionHeader } from "../../components/common/SectionHeader";
import { TaskCard, type TaskPreview } from "../../components/common/TaskCard";
import { useDb } from "../../lib/db/DbContext";

const demoTasks: TaskPreview[] = [
  {
    id: "one",
    plantName: "데모 몬스테라",
    title: "흙 상태 확인하기",
    description: "실제 급수와 토양 관찰을 구별하는 카드 예시예요.",
  },
  {
    id: "two",
    plantName: "데모 바질",
    title: "잎 상태 살펴보기",
    description: "사용자 기록이 아닌 화면 확인용 샘플이에요.",
  },
  {
    id: "three",
    plantName: "데모 상추",
    title: "재배 공간 살펴보기",
    description: "관리 일정 계산은 아직 연결되지 않았어요.",
  },
  {
    id: "four",
    plantName: "데모 화분",
    title: "다음 점검 예시",
    description: "전체 작업 목록에서만 보이는 네 번째 샘플이에요.",
  },
];

export function TodayPage() {
  const { error, plantings, refresh } = useDb();
  const [demo, setDemo] = useState(false);
  const [all, setAll] = useState(false);

  const date = new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(new Date());

  const plantCount = plantings.length;

  return (
    <PageContainer>
      <PageHeading
        eyebrow={date}
        title="오늘도, 초록과 함께"
        description="작은 돌봄부터 시작해 볼까요?"
      />

      {error && (
        <section className="card space-section" role="alert" style={{ marginBottom: "1rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", color: "var(--danger)" }}>
            <AlertCircle size={20} aria-hidden="true" />
            <h2>데이터베이스 접근 오류</h2>
          </div>
          <p className="field-error" style={{ marginTop: "0.5rem" }}>
            {error.message}
          </p>
          <div className="button-row" style={{ marginTop: "1rem" }}>
            <button type="button" className="button" onClick={() => refresh()}>
              다시 시도
            </button>
          </div>
        </section>
      )}

      <div className="today-grid">
        <section className="care-panel card">
          <SectionHeader
            title="오늘의 돌봄"
            action={
              <span className="count-pill">
                {demo ? "데모 4개" : plantCount > 0 ? `등록 식물 ${plantCount}개` : "0개"}
              </span>
            }
          />
          <p className="muted">
            {demo
              ? "개발용 예시입니다. 확인할 실제 식물은 0개입니다."
              : plantCount > 0
              ? `오늘 확인할 식물 ${plantCount}개 · 관리 일정 엔진(Phase 2) 준비 중`
              : "오늘 확인할 식물 0개 · 등록된 식물이 없어요"}
          </p>

          {demo ? (
            <div className="task-list">
              {(all ? demoTasks : demoTasks.slice(0, 3)).map((task) => (
                <TaskCard key={task.id} task={task} />
              ))}
              <button className="text-link" onClick={() => setAll(!all)}>
                {all ? "주요 작업 3개만 보기" : "데모 작업 모두 보기 (4개)"}
              </button>
            </div>
          ) : plantCount > 0 ? (
            <div className="card space-section" style={{ background: "var(--background)" }}>
              <h3>함께하는 식물 ({plantCount}개)</h3>
              <p className="card-summary">
                내 식물이 로컬 저장소에 안전하게 등록되어 있어요. 맞춤형 돌봄 규칙 엔진(Phase 2)이 준비되면 매일의 점검 일정이 여기에 표시됩니다.
              </p>
              <div style={{ marginTop: "0.75rem" }}>
                <Link className="button" to="/plants">
                  내 식물 목록 관리하기
                  <ArrowRight size={17} aria-hidden="true" style={{ marginLeft: "0.25rem" }} />
                </Link>
              </div>
            </div>
          ) : (
            <EmptyState
              title="첫 식물을 만나볼까요?"
              description="나에게 맞는 식물을 둘러보세요. 식물 등록과 관리 기록은 Phase 1 이후에 연결됩니다."
              action={
                <Link className="button" to="/discover">
                  <Search size={18} aria-hidden="true" />
                  식물 둘러보기
                </Link>
              }
            />
          )}

          <label className="demo-toggle">
            <input
              type="checkbox"
              checked={demo}
              onChange={(event) => {
                setDemo(event.target.checked);
                setAll(false);
              }}
            />
            개발용 관리 카드 보기
          </label>
        </section>

        <aside className="today-aside">
          <section className="weather-card card">
            <CloudSun size={35} aria-hidden="true" />
            <h2>우리 동네 날씨</h2>
            <p>지역 미설정 · 외기 예보 미연결</p>
            <p className="field-hint">
              외기 예보는 실내 온도나 흙 상태를 뜻하지 않아요.
            </p>
            <Link className="text-link" to="/settings">
              지역 및 환경 안내 <ArrowRight size={17} aria-hidden="true" />
            </Link>
          </section>

          <section className="week-card card">
            <CalendarDays aria-hidden="true" />
            <h2>이번 주도 천천히</h2>
            <p>
              {plantCount > 0
                ? `등록된 식물 ${plantCount}개 · 주간 일정 엔진(Phase 2) 준비 중`
                : "등록된 식물이 없어 예정된 작업이 없어요."}
            </p>
            <Link className="text-link" to="/week">
              이번 주 작업 보기 <ArrowRight size={17} aria-hidden="true" />
            </Link>
          </section>
        </aside>
      </div>

      <section className="space-section">
        <SectionHeader title="초록 생활의 시작" />
        <div className="shortcut-grid">
          <Link className="shortcut" to="/discover?season=가을">
            <Sprout aria-hidden="true" />
            <div>
              <h3>계절별 식물 둘러보기</h3>
              <p>필터를 바꾸며 개발용 샘플을 탐색해요.</p>
            </div>
            <ArrowRight aria-hidden="true" />
          </Link>
          <Link className="shortcut" to="/check">
            <Stethoscope aria-hidden="true" />
            <div>
              <h3>식물 상태 점검</h3>
              <p>진단 기능의 준비 상태를 확인해요.</p>
            </div>
            <ArrowRight aria-hidden="true" />
          </Link>
        </div>
      </section>
    </PageContainer>
  );
}

export function WeekPage() {
  const { plantings } = useDb();
  return (
    <PageContainer>
      <PageHeading
        eyebrow="이번 주"
        title="일주일의 돌봄"
        description="실제 관리 일정은 관리 엔진(Phase 2) 연결 후 자동 계산됩니다."
      />
      <EmptyState
        title={plantings.length > 0 ? "예정된 자동 일정이 아직 없어요" : "예정된 작업이 없어요"}
        description={
          plantings.length > 0
            ? `현재 등록된 ${plantings.length}개의 식물은 로컬에 저장되어 있으며, 돌봄 규칙 엔진(Phase 2) 준비 후 일정이 계산됩니다.`
            : "현재는 개인 식물과 관리 작업을 저장하지 않습니다."
        }
        action={
          <div className="button-row">
            <Link className="button" to="/plants">
              내 식물 보기
            </Link>
            <Link className="button secondary" to="/">
              오늘로 돌아가기
            </Link>
          </div>
        }
      />
    </PageContainer>
  );
}

export function CheckPage() {
  return (
    <PageContainer>
      <PageHeading
        eyebrow="식물 상태"
        title="상태 점검 준비 중"
        description="병해충 후보 안내는 공식 자료 검증 후 제공됩니다."
      />
      <PhaseNotice>
        현재는 사진 진단, 병해충 판단, 약제 안내를 수행하지 않습니다.
      </PhaseNotice>
      <section className="card space-section">
        <h2>앞으로 확인할 정보</h2>
        <ul className="plain-list">
          <li>어떤 식물인지, 어느 부위가 달라졌는지</li>
          <li>실내·실외 노출과 최근 관리 이력</li>
          <li>공식 자료의 출처와 판단할 수 없는 부분</li>
        </ul>
        <Link className="text-link" to="/plants">
          내 식물 화면 보기 <ArrowRight aria-hidden="true" size={17} />
        </Link>
      </section>
    </PageContainer>
  );
}
