export type DemoPlant = {
  id: string;
  name: string;
  category: "관엽" | "허브" | "채소";
  place: "실내" | "베란다" | "야외";
  season: "봄" | "여름" | "가을" | "겨울";
  difficulty: string;
  reason: string;
  visual: "leaf" | "sprout" | "flower";
};

export const demoCatalog: DemoPlant[] = [
  {
    id: "demo-monstera",
    name: "몬스테라",
    category: "관엽",
    place: "실내",
    season: "가을",
    difficulty: "보통",
    reason: "실내 관엽 필터 결과를 확인하기 위한 가상 예시입니다.",
    visual: "leaf",
  },
  {
    id: "demo-basil",
    name: "바질",
    category: "허브",
    place: "베란다",
    season: "여름",
    difficulty: "보통",
    reason: "베란다 허브 필터 결과를 확인하기 위한 가상 예시입니다.",
    visual: "sprout",
  },
  {
    id: "demo-lettuce",
    name: "상추",
    category: "채소",
    place: "야외",
    season: "봄",
    difficulty: "쉬움",
    reason: "야외 채소 필터 결과를 확인하기 위한 가상 예시입니다.",
    visual: "flower",
  },
];

export type CatalogFilters = {
  query: string;
  category: string;
  place: string;
  season: string;
};
const discoverFilterKeys = ["q", "category", "place", "season"] as const;
export function buildDiscoverSearch(params: URLSearchParams): string {
  const next = new URLSearchParams();
  for (const key of discoverFilterKeys) {
    const value = params.get(key);
    if (value) next.set(key, value);
  }
  const search = next.toString();
  return search ? `?${search}` : "";
}
export function filterDemoCatalog(filters: CatalogFilters): DemoPlant[] {
  return demoCatalog.filter(
    (plant) =>
      plant.name.includes(filters.query.trim()) &&
      (!filters.category || plant.category === filters.category) &&
      (!filters.place || plant.place === filters.place) &&
      (!filters.season || plant.season === filters.season),
  );
}
