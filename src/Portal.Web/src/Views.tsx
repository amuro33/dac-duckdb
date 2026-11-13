import { useEffect, useState } from "react";
import {
  Star,
  MoreHorizontal,
  Search,
  Trash2,
  Copy,
  ArrowUpRight,
  Bookmark,
  Plus,
} from "lucide-react";
import { json, when } from "./api";
import { PageHeading, ErrorBox, Empty, Modal, Loading } from "./ui";
import { initial, type Config, type View } from "./types";
export function Views({
  analyze,
  notify,
}: {
  analyze: (c: Config, id?: string) => void;
  notify: (s: string) => void;
}) {
  const [views, setViews] = useState<View[]>([]),
    [busy, setBusy] = useState(true),
    [error, setError] = useState(""),
    [search, setSearch] = useState(""),
    [edit, setEdit] = useState<View>(),
    [remove, setRemove] = useState<View>(),
    [saving, setSaving] = useState(false),
    [modalError, setModalError] = useState("");
  async function load() {
    setBusy(true);
    try {
      setViews(await json("/api/workspace/views"));
      setError("");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    load();
  }, []);
  async function update(v: View) {
    setSaving(true);
    setModalError("");
    try {
      await json("/api/workspace/views/" + v.id, {
        method: "PUT",
        body: JSON.stringify(v),
      });
      setEdit(undefined);
      await load();
      notify("뷰를 업데이트했습니다.");
    } catch (e: any) {
      setModalError(e.message);
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }
  async function destroy() {
    if (!remove) return;
    setSaving(true);
    try {
      await json(
        `/api/workspace/views/${remove.id}?version=${remove.version}`,
        { method: "DELETE" },
      );
      setRemove(undefined);
      await load();
      notify("뷰를 삭제했습니다.");
    } catch (e: any) {
      setModalError(e.message);
    } finally {
      setSaving(false);
    }
  }
  const filtered = views.filter((v) =>
    (v.name + " " + v.description).toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <>
      <PageHeading
        eyebrow="SAVED VIEWS"
        title="저장된 분석"
        description="분석 설정과 메모를 저장하고, 최신 데이터로 다시 실행하세요."
        actions={
          <button className="primary" onClick={() => analyze(initial)}>
            <Plus size={15} />새 분석
          </button>
        }
      />
      <ErrorBox error={error} />
      <div className="table-tools">
        <span>{views.length} saved views</span>
        <label className="search-input">
          <Search size={14} />
          <input
            aria-label="뷰 검색"
            placeholder="이름 또는 메모 검색"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
      </div>
      {busy ? (
        <Loading />
      ) : !filtered.length ? (
        <Empty
          title="저장된 분석이 없습니다"
          description="분석 스튜디오에서 실행한 설정을 ‘뷰 저장’으로 보관하세요."
          action={
            <button onClick={() => analyze(initial)}>분석 스튜디오 열기</button>
          }
        />
      ) : (
        <div className="view-grid">
          {filtered.map((v) => (
            <article className="view-card" key={v.id}>
              <div className="view-card-top">
                <span className="view-symbol">
                  <Bookmark size={18} />
                </span>
                <span className="pill">{v.config.source.toUpperCase()}</span>
                <button
                  className={
                    "icon-button push-right " + (v.pinned ? "starred" : "")
                  }
                  disabled={saving}
                  aria-label={v.pinned ? "고정 해제" : "뷰 고정"}
                  onClick={() => update({ ...v, pinned: !v.pinned })}
                >
                  <Star size={16} fill={v.pinned ? "currentColor" : "none"} />
                </button>
                <button
                  className="icon-button"
                  aria-label="뷰 편집"
                  onClick={() => {
                    setEdit({ ...v });
                    setModalError("");
                  }}
                >
                  <MoreHorizontal size={19} />
                </button>
              </div>
              <h2>{v.name}</h2>
              <p>{v.description || "분석 메모가 없습니다."}</p>
              <div className="view-mapping">
                <span>
                  Category <strong>{v.config.category ?? "전체"}</strong>
                </span>
                <span>
                  Legend <strong>{v.config.legend ?? "전체"}</strong>
                </span>
                <span>
                  Axes{" "}
                  <strong>
                    {v.config.x} → {v.config.y}
                  </strong>
                </span>
              </div>
              <div className="view-card-foot">
                <small>
                  {when(v.updatedAt)} · v{v.version}
                </small>
                <button
                  className="text-button"
                  onClick={() => analyze(v.config, v.id)}
                >
                  열기
                  <ArrowUpRight size={14} />
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
      {edit && (
        <Modal
          title="저장된 뷰 편집"
          onClose={() => !saving && setEdit(undefined)}
        >
          <ErrorBox error={modalError} />
          <label>
            이름
            <input
              aria-label="편집 뷰 이름"
              autoFocus
              maxLength={80}
              value={edit.name}
              onChange={(e) => setEdit({ ...edit, name: e.target.value })}
            />
          </label>
          <label>
            메모
            <textarea
              aria-label="편집 메모"
              maxLength={1000}
              value={edit.description}
              onChange={(e) =>
                setEdit({ ...edit, description: e.target.value })
              }
            />
          </label>
          <div className="modal-actions">
            <button
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(
                    location.origin + "/#analysis?view=" + edit.id,
                  );
                  notify("뷰 링크를 복사했습니다.");
                } catch {
                  notify("브라우저가 클립보드 접근을 허용하지 않았습니다.");
                }
              }}
            >
              <Copy size={14} />
              링크
            </button>
            <button
              className="danger"
              onClick={() => {
                setRemove(edit);
                setEdit(undefined);
                setModalError("");
              }}
            >
              <Trash2 size={14} />
              삭제
            </button>
            <button
              className="primary push-right"
              disabled={saving || !edit.name.trim()}
              onClick={() => update(edit)}
            >
              변경 저장
            </button>
          </div>
        </Modal>
      )}
      {remove && (
        <Modal
          title="분석 뷰를 삭제할까요?"
          onClose={() => !saving && setRemove(undefined)}
        >
          <ErrorBox error={modalError} />
          <p>
            ‘{remove.name}’의 저장된 설정과 메모가 삭제됩니다. 원본 데이터와
            실행 이력은 유지됩니다.
          </p>
          <div className="modal-actions">
            <button onClick={() => setRemove(undefined)}>취소</button>
            <button className="danger" disabled={saving} onClick={destroy}>
              삭제 확인
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
