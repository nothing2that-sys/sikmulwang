import { Component, type ReactNode } from "react";
import { Routes, Route } from "react-router-dom";
import { PwaProvider } from "./providers/PwaProvider";
import { AppShell } from "../components/layout/AppShell";
import { ErrorState } from "../components/common/Feedback";
import { TodayPage, WeekPage, CheckPage } from "../features/today/TodayPage";
import {
  DiscoverPage,
  DemoPlantDetailPage,
} from "../features/discover/DiscoverPage";
import { PlantsPage, PlantPreviewPage } from "../features/plants/PlantsPage";
import { JournalPage } from "../features/journal/JournalPage";
import { JournalComposePage } from "../features/journal/JournalComposePage";
import { SettingsPage } from "../features/settings/SettingsPage";
import { NotFoundPage } from "./router/NotFoundPage";

import { DbProvider } from "../lib/db/DbContext";

class AppErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed)
      return (
        <main className="page-container">
          <h1>화면을 준비하지 못했어요</h1>
          <ErrorState
            description="표시 오류가 발생했어요. 페이지를 다시 열어 주세요."
            onRetry={() => window.location.reload()}
          />
        </main>
      );
    return this.props.children;
  }
}

export function App() {
  return (
    <AppErrorBoundary>
      <PwaProvider>
        <DbProvider>
          <AppShell>
            <Routes>
              <Route path="/" element={<TodayPage />} />
              <Route path="/discover" element={<DiscoverPage />} />
              <Route path="/discover/:id" element={<DemoPlantDetailPage />} />
              <Route path="/plants" element={<PlantsPage />} />
              <Route path="/plants/preview" element={<PlantPreviewPage />} />
              <Route path="/journal" element={<JournalPage />} />
              <Route path="/journal/new" element={<JournalComposePage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/week" element={<WeekPage />} />
              <Route path="/check" element={<CheckPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </AppShell>
        </DbProvider>
      </PwaProvider>
    </AppErrorBoundary>
  );
}
