import { render, screen, within } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import axe from "axe-core";
import { App } from "../app/App";
import { PlantCard } from "../components/common/PlantCard";
import {
  LoadingState,
  ErrorState,
  EmptyState,
  StatusBadge,
} from "../components/common/Feedback";
import { FormField } from "../components/common/FormField";
import {
  demoCatalog,
  filterDemoCatalog,
} from "../features/discover/demo-catalog";
import { calendarCells, localDate } from "../features/journal/calendar";

function app(path = "/") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

describe("Phase 0 shell and navigation", () => {
  it("renders empty home and four named navigation targets", () => {
    app();
    expect(
      screen.getByRole("heading", { level: 1, name: "오늘도, 초록과 함께" }),
    ).toBeVisible();
    const nav = screen.getByRole("navigation", { name: "주 메뉴" });
    expect(within(nav).getAllByRole("link")).toHaveLength(4);
    expect(within(nav).getByRole("link", { name: "오늘" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(
      screen.getByText("오늘 확인할 식물 0개 · 등록된 식물이 없어요"),
    ).toBeVisible();
  });
  it("moves pages and updates active menu and heading focus", async () => {
    app();
    await userEvent.click(
      within(screen.getByRole("navigation")).getByRole("link", {
        name: "식물 찾기",
      }),
    );
    expect(
      screen.getByRole("heading", { level: 1, name: "식물 찾기" }),
    ).toHaveFocus();
    expect(
      within(screen.getByRole("navigation")).getByRole("link", {
        name: "식물 찾기",
      }),
    ).toHaveAttribute("aria-current", "page");
  });
  it("keeps demo tasks opt-in and caps initial list at three", async () => {
    app();
    expect(
      screen.queryByRole("heading", { name: "흙 상태 확인하기" }),
    ).not.toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("checkbox", { name: "개발용 관리 카드 보기" }),
    );
    expect(
      screen.getAllByRole("button", { name: "물주기 기록 준비 중" }),
    ).toHaveLength(3);
    expect(
      screen.getAllByRole("button", { name: "물주기 기록 준비 중" })[0],
    ).toBeDisabled();
    await userEvent.click(
      screen.getByRole("button", { name: "데모 작업 모두 보기 (4개)" }),
    );
    expect(
      screen.getAllByRole("button", { name: "물주기 기록 준비 중" }),
    ).toHaveLength(4);
  });
  it("shows unknown URL as 404", () => {
    app("/unknown");
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "페이지를 찾을 수 없어요",
      }),
    ).toBeVisible();
  });
});

describe("catalog exploration", () => {
  it("renders demo provenance and informational plant card", () => {
    render(
      <MemoryRouter>
        <PlantCard plant={demoCatalog[0]} groupLabel="개체 · 예시 1개" />
      </MemoryRouter>,
    );
    expect(screen.getByText("개발용 샘플")).toBeVisible();
    expect(screen.getByText("정보 부족")).toBeVisible();
    expect(
      screen.getByRole("link", { name: "몬스테라 상세정보" }),
    ).toHaveAttribute("href", "/discover/demo-monstera");
  });
  it("combines search, type, place, season and reset", async () => {
    app("/discover");
    await userEvent.type(screen.getByRole("searchbox"), "바질");
    expect(screen.getByText("1종")).toBeVisible();
    await userEvent.selectOptions(screen.getByLabelText("식물 유형"), "채소");
    expect(screen.getByText("일치하는 샘플이 없어요")).toBeVisible();
    await userEvent.click(
      screen.getByRole("button", { name: "검색 및 필터 초기화" }),
    );
    await userEvent.selectOptions(screen.getByLabelText("재배 장소"), "야외");
    await userEvent.selectOptions(screen.getByLabelText("계절"), "봄");
    expect(screen.getByRole("heading", { name: "상추" })).toBeVisible();
    expect(
      screen.queryByRole("heading", { name: "바질" }),
    ).not.toBeInTheDocument();
  });
  it("preserves URL season and labels details unverified", () => {
    app("/discover?season=겨울");
    expect(screen.getByLabelText("계절")).toHaveValue("겨울");
    expect(screen.getByText("0종")).toBeVisible();
  });
  it("filters deterministically without modifying catalog", () => {
    expect(
      filterDemoCatalog({
        query: " 바질 ",
        category: "허브",
        place: "베란다",
        season: "여름",
      }),
    ).toEqual([demoCatalog[1]]);
    expect(demoCatalog).toHaveLength(3);
  });
});

describe("journal and planned functionality", () => {
  it("switches calendar and navigates months", async () => {
    app("/journal");
    await userEvent.click(screen.getByRole("button", { name: "달력" }));
    const caption = screen.getByRole("table").textContent;
    await userEvent.click(screen.getByRole("button", { name: "다음 달" }));
    expect(screen.getByRole("table").textContent).not.toEqual(caption);
    expect(screen.getByLabelText("식물별 보기")).toBeDisabled();
  });
  it("accepts memory-only input, cancels then confirms clearing", async () => {
    app("/journal/new");
    await userEvent.type(screen.getByLabelText("제목 (선택)"), "테스트 제목");
    await userEvent.click(
      screen.getByRole("button", { name: "미리보기 입력 비우기" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "취소" }));
    expect(screen.getByLabelText("제목 (선택)")).toHaveValue("테스트 제목");
    await userEvent.click(
      screen.getByRole("button", { name: "미리보기 입력 비우기" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: /^입력 비우기$/ }),
    );
    expect(screen.getByLabelText("제목 (선택)")).toHaveValue("");
    expect(screen.getByRole("button", { name: "저장 준비 중" })).toBeDisabled();
  });
  it("does not expose operational backup actions", () => {
    app("/settings");
    for (const button of screen.getAllByRole("button"))
      expect(button).toBeDisabled();
  });
  it("builds complete leap month and local date", () => {
    const cells = calendarCells(2024, 1);
    expect(cells.filter(Boolean)).toHaveLength(29);
    expect(cells.length % 7).toBe(0);
    expect(localDate(new Date(2026, 9, 14))).toBe("2026-10-14");
  });
});

describe("common feedback", () => {
  it("provides loading status and retry feedback", async () => {
    const retry = vi.fn();
    render(
      <>
        <LoadingState />
        <ErrorState description="연결 오류" onRetry={retry} />
        <StatusBadge tone="danger">위험</StatusBadge>
      </>,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "화면을 준비하고 있어요",
    );
    expect(screen.getByRole("alert")).toHaveTextContent("연결 오류");
    await userEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(retry).toHaveBeenCalledOnce();
  });
  it("shows labeled field error and empty state", () => {
    render(
      <>
        <FormField id="test" label="이름" error="필수 입력">
          <input id="test" aria-invalid="true" aria-describedby="test-error" />
        </FormField>
        <EmptyState title="아직 없어요" description="다시 확인하세요" />
      </>,
    );
    expect(screen.getByLabelText("이름")).toHaveAttribute(
      "aria-describedby",
      "test-error",
    );
    expect(screen.getByRole("alert")).toHaveTextContent("필수 입력");
    expect(screen.getByRole("heading", { name: "아직 없어요" })).toBeVisible();
  });
});

describe("page accessibility structure", () => {
  for (const path of [
    "/",
    "/discover",
    "/plants",
    "/journal",
    "/journal/new",
    "/settings",
    "/plants/preview",
    "/discover/demo-basil",
    "/missing",
  ]) {
    it(`has no axe structural violations at ${path}`, async () => {
      app(path);
      const results = await axe.run(document.body, {
        rules: { "color-contrast": { enabled: false } },
      });
      expect(results.violations.map((violation) => violation.id)).toEqual([]);
    });
  }
});
