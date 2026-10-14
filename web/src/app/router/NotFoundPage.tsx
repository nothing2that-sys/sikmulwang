import { Link } from "react-router-dom";
import {
  PageContainer,
  PageHeading,
} from "../../components/layout/PageContainer";
import { EmptyState } from "../../components/common/Feedback";
export function NotFoundPage() {
  return (
    <PageContainer>
      <PageHeading
        eyebrow="404"
        title="페이지를 찾을 수 없어요"
        description="주소를 확인하거나 오늘 화면으로 돌아가 주세요."
      />
      <EmptyState
        title="이 길에는 아직 식물이 없네요"
        description="다른 메뉴에서 초록 생활을 이어가 보세요."
        action={
          <Link className="button" to="/">
            오늘로 돌아가기
          </Link>
        }
      />
    </PageContainer>
  );
}
