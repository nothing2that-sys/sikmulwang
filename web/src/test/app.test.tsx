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
  buildDiscoverSearch,
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
        <PlantCard
          plant={demoCatalog[0]}
          groupLabel="개체 · 예시 1개"
          search="?q=%EB%AA%AC%EC%8A%A4%ED%85%8C%EB%9D%BC"
        />
      </MemoryRouter>,
    );
    expect(screen.getByText("개발용 샘플")).toBeVisible();
    expect(screen.getByText("정보 부족")).toBeVisible();
    expect(
      screen.getByRole("link", { name: "몬스테라 상세정보" }),
    ).toHaveAttribute(
      "href",
      "/discover/demo-monstera?q=%EB%AA%AC%EC%8A%A4%ED%85%8C%EB%9D%BC",
    );
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
    expect(screen.getByRole("searchbox")).toHaveValue("");
    await userEvent.selectOptions(screen.getByLabelText("재배 장소"), "야외");
    await userEvent.selectOptions(screen.getByLabelText("계절"), "봄");
    expect(screen.getByRole("heading", { name: "상추" })).toBeVisible();
    expect(
      screen.queryByRole("heading", { name: "바질" }),
    ).not.toBeInTheDocument();
  });
  it("preserves URL search and filters across detail navigation and return", async () => {
    app("/discover?q=바질&category=허브&place=베란다&season=여름");
    expect(screen.getByRole("searchbox")).toHaveValue("바질");
    expect(screen.getByLabelText("식물 유형")).toHaveValue("허브");
    expect(screen.getByLabelText("재배 장소")).toHaveValue("베란다");
    expect(screen.getByLabelText("계절")).toHaveValue("여름");
    expect(screen.getByText("1종")).toBeVisible();

    await userEvent.click(screen.getByRole("link", { name: "바질 상세정보" }));
    expect(
      screen.getByRole("heading", { level: 1, name: "바질" }),
    ).toBeVisible();
    await userEvent.click(screen.getByRole("link", { name: "식물 찾기로" }));
    expect(
      screen.getByRole("heading", { level: 1, name: "식물 찾기" }),
    ).toBeVisible();
    expect(screen.getByRole("searchbox")).toHaveValue("바질");
    expect(screen.getByLabelText("식물 유형")).toHaveValue("허브");
    expect(screen.getByLabelText("재배 장소")).toHaveValue("베란다");
    expect(screen.getByLabelText("계절")).toHaveValue("여름");
    expect(screen.getByText("1종")).toBeVisible();
  });
  it("returns cleanly to discover list when detail is opened directly", async () => {
    app("/discover/demo-basil");
    await userEvent.click(screen.getByRole("link", { name: "식물 찾기로" }));
    expect(
      screen.getByRole("heading", { level: 1, name: "식물 찾기" }),
    ).toBeVisible();
    expect(screen.getByRole("searchbox")).toHaveValue("");
    expect(screen.getByText("3종")).toBeVisible();
    expect(
      buildDiscoverSearch(
        new URLSearchParams("q=바질&season=여름&evil=https://example.com"),
      ),
    ).toBe("?q=%EB%B0%94%EC%A7%88&season=%EC%97%AC%EB%A6%84");
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
  it("requires a registered season and offers text-only journal entry", async () => {
    app('/journal/new');
    expect(await screen.findByRole('heading', { name: '오늘의 초록 이야기' })).toBeVisible();
    expect(screen.getByRole('button', { name: '일기 저장' })).toBeDisabled();
    expect(screen.getByLabelText('사진 첨부')).toBeDisabled();
  });
  it("does not expose operational backup actions", () => {
    app("/settings");
    for (const button of screen.getAllByRole("button"))
      expect(button).toBeDisabled();
  });
  it("cleans up update dialog and shows update error when waiting worker becomes redundant", async () => {
    vi.stubEnv("PROD", true);
    const waiting = Object.assign(new EventTarget(), {
      state: "installed" as ServiceWorkerState,
      postMessage: vi.fn(() => {
        waiting.state = "redundant";
        waiting.dispatchEvent(new Event("statechange"));
      }),
    });
    const registration = Object.assign(new EventTarget(), {
      installing: null,
      waiting,
      active: { state: "activated" },
      update: vi.fn().mockResolvedValue(undefined),
    });
    const container = Object.assign(new EventTarget(), {
      controller: {},
      register: vi.fn().mockResolvedValue(registration),
    });
    vi.stubGlobal("navigator", { serviceWorker: container, onLine: true });
    try {
      app("/settings");
      const openBtn = await screen.findByRole("button", {
        name: "업데이트 안내",
      });
      await userEvent.click(openBtn);
      expect(
        screen.getByRole("dialog", { name: "새 버전으로 전환할까요?" }),
      ).toBeVisible();
      await userEvent.click(
        screen.getByRole("button", { name: "업데이트하고 새로고침" }),
      );
      expect(
        screen.queryByRole("dialog", { name: "새 버전으로 전환할까요?" }),
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole("alert"),
      ).toHaveTextContent(
        "새 버전 업데이트에 실패했어요. 현재 오프라인 화면은 계속 이용할 수 있어요.",
      );
      expect(screen.getByText("앱 셸 오프라인 준비됨")).toBeVisible();
      expect(
        screen.getByText("새 버전 업데이트 실패 · 기존 오프라인 화면 유지됨"),
      ).toBeVisible();
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
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
