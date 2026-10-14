import { useState } from "react";
import { Link } from "react-router-dom";
import {
  PageContainer,
  PageHeading,
} from "../../components/layout/PageContainer";
import {
  EmptyState,
  PhaseNotice,
  StatusBadge,
} from "../../components/common/Feedback";
import { PlantCard } from "../../components/common/PlantCard";
import { demoCatalog } from "../discover/demo-catalog";

export function PlantsPage() {
  const [place, setPlace] = useState("전체");
  return (
    <PageContainer>
      <PageHeading
        eyebrow="우리 집 작은 정원"
        title="내 식물"
        description="식물마다 다른 공간, 다른 이야기를 모아요."
      />
      <div className="segmented" aria-label="장소별 보기">
        {["전체", "실내", "베란다", "야외"].map((value) => (
          <button
            type="button"
            key={value}
            aria-pressed={value === place}
            onClick={() => setPlace(value)}
          >
            {value}
          </button>
        ))}
      </div>
      <section className="card space-section">
        <EmptyState
          title={
            place === "전체"
              ? "아직 함께하는 식물이 없어요"
              : `${place}에 등록된 식물이 없어요`
          }
          description="식물 등록은 Phase 1 이후 제공됩니다. 지금은 샘플로 화면 구성을 둘러볼 수 있어요."
          action={
            <Link className="button" to="/plants/preview">
              식물 상세 화면 미리보기
            </Link>
          }
        />
      </section>
      <details className="sample-details">
        <summary>개체·그룹 카드 구성 보기</summary>
        <PhaseNotice>
          다음 카드는 실제 개인 식물이 아닌 개발용 예시입니다.
        </PhaseNotice>
        <div className="plant-grid">
          {demoCatalog
            .filter((plant) => place === "전체" || plant.place === place)
            .map((plant, index) => (
              <PlantCard
                key={plant.id}
                plant={plant}
                groupLabel={index === 0 ? "개체 · 예시 1개" : "그룹 · 예시 3개"}
              />
            ))}
        </div>
      </details>
    </PageContainer>
  );
}
export function PlantPreviewPage() {
  const [tab, setTab] = useState("타임라인");
  const descriptions: Record<string, string> = {
    타임라인: "관리 이벤트와 자유 일기를 통합해서 표시할 영역입니다.",
    "관리 계획": "실제 급수와 토양 관찰을 구별하는 관리 일정 영역입니다.",
    "성장 사진": "서로 다른 날짜의 사진을 비교할 영역입니다.",
    "식물 정보": "종·재배 장소·개체 또는 그룹·시즌 정보를 표시할 영역입니다.",
  };
  return (
    <PageContainer>
      <PageHeading
        eyebrow="개발용 레이아웃"
        title="식물 상세 미리보기"
        description="이 화면은 등록된 식물이 아니에요."
      />
      <PhaseNotice>
        개인 식물·시즌·관리 기록을 생성하거나 저장하지 않습니다.
      </PhaseNotice>
      <section className="card">
        <StatusBadge>데모 개체</StatusBadge>
        <h2>나의 첫 초록</h2>
        <dl className="detail-list">
          <div>
            <dt>재배 장소</dt>
            <dd>실내 (예시)</dd>
          </div>
          <div>
            <dt>재배 시작일</dt>
            <dd>미입력</dd>
          </div>
          <div>
            <dt>시즌</dt>
            <dd>등록 전</dd>
          </div>
        </dl>
        <div className="button-row">
          <Link className="button secondary" to="/check">
            상태 점검 안내
          </Link>
          <Link className="button secondary" to="/journal/new">
            일기 폼 미리보기
          </Link>
        </div>
      </section>
      <div className="segmented space-section" aria-label="식물 상세 보기">
        {Object.keys(descriptions).map((value) => (
          <button
            type="button"
            key={value}
            aria-pressed={tab === value}
            onClick={() => setTab(value)}
          >
            {value}
          </button>
        ))}
      </div>
      <section className="card space-section" aria-live="polite">
        <h2>{tab}</h2>
        <p>{descriptions[tab]}</p>
        <p className="muted">아직 저장된 데이터가 없어요.</p>
      </section>
    </PageContainer>
  );
}
