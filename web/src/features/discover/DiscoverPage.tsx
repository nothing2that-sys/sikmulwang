import { useSearchParams, Link, useParams } from "react-router-dom";
import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import {
  PageContainer,
  PageHeading,
} from "../../components/layout/PageContainer";
import { FormField } from "../../components/common/FormField";
import {
  EmptyState,
  PhaseNotice,
  StatusBadge,
} from "../../components/common/Feedback";
import { PlantCard } from "../../components/common/PlantCard";
import { demoCatalog, filterDemoCatalog } from "./demo-catalog";
import { NotFoundPage } from "../../app/router/NotFoundPage";

export function DiscoverPage() {
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState("");
  const category = params.get("category") ?? "";
  const place = params.get("place") ?? "";
  const season = params.get("season") ?? "";
  const results = filterDemoCatalog({ query, category, place, season });
  function update(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  }
  return (
    <PageContainer>
      <PageHeading
        eyebrow="나의 다음 초록"
        title="식물 찾기"
        description="어떤 식물과 함께하고 싶으세요?"
      />
      <PhaseNotice>
        개발용 샘플 3종입니다. 장소·계절·난이도는 UI 검증용 가상 값이며
        농촌진흥청 자료나 실제 재배 추천이 아닙니다.
      </PhaseNotice>
      <section className="card filter-panel" aria-label="식물 검색 및 필터">
        <FormField id="search" label="식물 이름 검색">
          <input
            id="search"
            type="search"
            placeholder="예: 몬스테라"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </FormField>
        <div className="filter-grid">
          {[
            {
              key: "category",
              label: "식물 유형",
              values: ["관엽", "허브", "채소"],
              selected: category,
            },
            {
              key: "place",
              label: "재배 장소",
              values: ["실내", "베란다", "야외"],
              selected: place,
            },
            {
              key: "season",
              label: "계절",
              values: ["봄", "여름", "가을", "겨울"],
              selected: season,
            },
          ].map((filter) => (
            <FormField key={filter.key} id={filter.key} label={filter.label}>
              <select
                id={filter.key}
                value={filter.selected}
                onChange={(event) => update(filter.key, event.target.value)}
              >
                <option value="">전체</option>
                {filter.values.map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </FormField>
          ))}
        </div>
        <button
          className="text-link"
          type="button"
          onClick={() => {
            setQuery("");
            setParams({});
          }}
        >
          검색 및 필터 초기화
        </button>
      </section>
      <div className="section-heading">
        <h2>샘플 탐색 결과</h2>
        <p role="status">{results.length}종</p>
      </div>
      {results.length ? (
        <div className="plant-grid">
          {results.map((plant) => (
            <PlantCard key={plant.id} plant={plant} />
          ))}
        </div>
      ) : (
        <EmptyState
          title="일치하는 샘플이 없어요"
          description="검색어나 필터를 바꿔 보세요. 현재는 개발용 샘플만 탐색합니다."
        />
      )}
      <section className="card space-section">
        <h2>왜 추천하나요?</h2>
        <p>
          개인화 추천은 아직 연결되지 않았어요. 검증된 출처와 재배 환경이
          없으므로 현재 적합성은 모두 <strong>정보 부족</strong>입니다.
        </p>
      </section>
    </PageContainer>
  );
}
export function DemoPlantDetailPage() {
  const { id } = useParams();
  const plant = demoCatalog.find((item) => item.id === id);
  if (!plant) return <NotFoundPage />;
  return (
    <PageContainer>
      <Link className="text-link back-link" to="/discover">
        <ArrowLeft size={18} aria-hidden="true" />
        식물 찾기로
      </Link>
      <PageHeading
        eyebrow="개발용 샘플 상세"
        title={plant.name}
        description="화면 구조 확인을 위한 가상 카탈로그예요."
      />
      <PhaseNotice>
        공식 식물 정보가 아닙니다. 실제 재배 적기·물주기 간격·관리 가이드로
        사용하지 마세요.
      </PhaseNotice>
      <div className="detail-grid">
        <PlantCard plant={plant} />
        <section className="card">
          <h2>추천 근거</h2>
          <StatusBadge>정보 부족</StatusBadge>
          <p>{plant.reason}</p>
          <dl className="detail-list">
            <div>
              <dt>출처</dt>
              <dd>제품 자체 개발용 샘플</dd>
            </div>
            <div>
              <dt>공식 자료 / 이용허락</dt>
              <dd>미검증 · 채택하지 않음</dd>
            </div>
            <div>
              <dt>내 환경 난이도</dt>
              <dd>판단 불가</dd>
            </div>
            <div>
              <dt>확인일</dt>
              <dd>해당 없음 · 공식 데이터 검토 전</dd>
            </div>
          </dl>
          <p id="register-hint">
            실제 등록과 영속 저장은 Phase 1 이후 제공됩니다.
          </p>
          <button className="button" disabled aria-describedby="register-hint">
            내 식물 등록 준비 중
          </button>
        </section>
      </div>
    </PageContainer>
  );
}
