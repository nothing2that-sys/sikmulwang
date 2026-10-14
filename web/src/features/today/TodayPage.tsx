import { useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  CalendarDays,
  CloudSun,
  Search,
  Stethoscope,
  Sprout,
} from "lucide-react";
import {
  PageContainer,
  PageHeading,
} from "../../components/layout/PageContainer";
import { EmptyState, PhaseNotice } from "../../components/common/Feedback";
import { SectionHeader } from "../../components/common/SectionHeader";
import { TaskCard, type TaskPreview } from "../../components/common/TaskCard";

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
  const [demo, setDemo] = useState(false);
  const [all, setAll] = useState(false);
  const date = new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(new Date());
  return (
    <PageContainer>
      <PageHeading
        eyebrow={date}
        title="오늘도, 초록과 함께"
        description="작은 돌봄부터 시작해 볼까요?"
      />
      <div className="today-grid">
        <section className="care-panel card">
          <SectionHeader
            title="오늘의 돌봄"
            action={
              <span className="count-pill">{demo ? "데모 4개" : "0개"}</span>
            }
          />
          <p className="muted">
            {demo
              ? "개발용 예시입니다. 확인할 실제 식물은 0개입니다."
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
            <p>등록된 식물이 없어 예정된 작업이 없어요.</p>
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
  return (
    <PageContainer>
      <PageHeading
        eyebrow="이번 주"
        title="일주일의 돌봄"
        description="실제 관리 일정은 식물 등록과 관리 엔진 연결 후 제공돼요."
      />
      <EmptyState
        title="예정된 작업이 없어요"
        description="현재는 개인 식물과 관리 작업을 저장하지 않습니다."
        action={
          <Link className="button secondary" to="/">
            오늘로 돌아가기
          </Link>
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
