import { useState } from "react";
import { Link } from "react-router-dom";
import {
  PageContainer,
  PageHeading,
} from "../../components/layout/PageContainer";
import { PhaseNotice } from "../../components/common/Feedback";
import { FormField } from "../../components/common/FormField";
import { ConfirmDialog } from "../../components/common/ConfirmDialog";
import { localDate } from "./calendar";

export function JournalComposePage() {
  const [date, setDate] = useState(() => localDate(new Date()));
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [clear, setClear] = useState(false);
  return (
    <PageContainer>
      <PageHeading
        eyebrow="일기 폼 미리보기"
        title="오늘의 초록 이야기"
        description="입력은 이 화면의 메모리에만 있고, 페이지를 떠나거나 새로고침하면 사라져요."
      />
      <PhaseNotice>
        저장되지 않는 미리보기입니다. 실제 일기나 개인정보를 입력하지 마세요.
        사진 선택·저장·초안 복원은 아직 제공하지 않습니다.
      </PhaseNotice>
      <form
        className="card compose-form"
        onSubmit={(event) => event.preventDefault()}
      >
        <FormField
          id="entry-date"
          label="일기 날짜"
          hint="식물을 관찰한 날짜예요. 작성 시각과 별도로 관리됩니다."
        >
          <input
            id="entry-date"
            type="date"
            value={date}
            aria-describedby="entry-date-hint"
            onChange={(event) => setDate(event.target.value)}
          />
        </FormField>
        <FormField
          id="entry-plant"
          label="식물 및 재배 시즌"
          hint="Phase 1에서 식물을 등록한 뒤 선택할 수 있어요."
        >
          <select id="entry-plant" disabled aria-describedby="entry-plant-hint">
            <option>등록된 식물 없음</option>
          </select>
        </FormField>
        <FormField id="entry-title" label="제목 (선택)">
          <input
            id="entry-title"
            value={title}
            maxLength={100}
            placeholder="예시 제목을 입력해 보세요"
            onChange={(event) => setTitle(event.target.value)}
          />
        </FormField>
        <FormField id="entry-body" label="일기 내용">
          <textarea
            id="entry-body"
            value={body}
            rows={5}
            maxLength={2000}
            placeholder="미리보기용 글을 입력해 보세요"
            onChange={(event) => setBody(event.target.value)}
          />
        </FormField>
        <fieldset>
          <legend>태그 (선택)</legend>
          <div className="tag-options">
            {["새잎", "성장", "파종", "수확"].map((tag) => (
              <label key={tag}>
                <input
                  type="checkbox"
                  checked={tags.includes(tag)}
                  onChange={(event) =>
                    setTags(
                      event.target.checked
                        ? [...tags, tag]
                        : tags.filter((value) => value !== tag),
                    )
                  }
                />
                {tag}
              </label>
            ))}
          </div>
        </fieldset>
        <FormField
          id="entry-photo"
          label="사진 첨부"
          hint="Phase 3 예정 · 사진 파일은 선택하거나 저장하지 않습니다."
        >
          <input
            id="entry-photo"
            type="file"
            accept="image/*"
            disabled
            aria-describedby="entry-photo-hint"
          />
        </FormField>
        <p className="field-hint">작성 시각: 저장 기능 연결 후 기록됩니다.</p>
        <p id="save-hint">현재 입력은 저장되지 않습니다.</p>
        <div className="button-row">
          <button className="button" disabled aria-describedby="save-hint">
            저장 준비 중
          </button>
          <button
            className="button secondary"
            type="button"
            onClick={() => setClear(true)}
          >
            미리보기 입력 비우기
          </button>
          <Link className="text-link" to="/journal">
            일기장으로
          </Link>
        </div>
      </form>
      <ConfirmDialog
        open={clear}
        title="미리보기 입력을 비울까요?"
        confirmLabel="입력 비우기"
        onCancel={() => setClear(false)}
        onConfirm={() => {
          setTitle("");
          setBody("");
          setTags([]);
          setDate(localDate(new Date()));
          setClear(false);
        }}
      >
        <p>화면에 입력한 제목, 내용, 태그와 날짜를 초기화합니다.</p>
      </ConfirmDialog>
    </PageContainer>
  );
}
