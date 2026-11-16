import { useEffect, useState } from "react";
import {
  Plus,
  Search,
  GitBranch,
  Pencil,
  Trash2,
  Copy,
  RefreshCw,
} from "lucide-react";
import { json, data, when } from "./api";
import { Modal, ErrorBox } from "./ui";
import { WorkflowEditor } from "./Workflows";
import {
  example,
  type Definition,
  type Query,
  type Workflow,
} from "./workflow-model";
import "./workflows.css";
const draftKey = "api-content-builder.workflow-draft.v1";
const routeId = () =>
  new URLSearchParams(location.hash.split("?")[1]).get("id");
type Item = {
  id: string;
  name: string;
  revision: number;
  published_version: number;
  updated_at: string;
};
export function WorkflowLibrary() {
  const [editorId, setEditorId] = useState<string | null>(routeId),
    [items, setItems] = useState<Item[]>([]),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false),
    [name, setName] = useState(""),
    [template, setTemplate] = useState("blank"),
    [seed, setSeed] = useState<any>(null),
    [removing, setRemoving] = useState<Item | null>(null),
    [renaming, setRenaming] = useState<Item | null>(null),
    [modalError, setModalError] = useState("");
  async function refresh() {
    setLoading(true);
    try {
      setItems(await json("/api/workflows"));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    const change = () => setEditorId(routeId());
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  useEffect(() => {
    if (!editorId) {
      setError("");
      refresh();
    }
  }, [editorId]);
  useEffect(() => {
    const raw = sessionStorage.getItem("workflow-query-seed");
    if (raw) {
      try {
        const s = JSON.parse(raw);
        setSeed(s);
        setName(s.queryId + " workflow");
        setCreating(true);
        setTemplate("query");
      } catch {
        sessionStorage.removeItem("workflow-query-seed");
      }
    }
  }, []);
  function edit(id: string) {
    location.hash = "workflows?id=" + encodeURIComponent(id);
    setEditorId(id);
  }
  function back() {
    location.hash = "workflows";
    setEditorId(null);
  }
  function close() {
    if (busy) return;
    setCreating(false);
    setRemoving(null);
    setRenaming(null);
    setModalError("");
    if (seed) {
      sessionStorage.removeItem("workflow-query-seed");
      setSeed(null);
    }
  }
  async function modalAction(fn: () => Promise<void>) {
    setBusy(true);
    setModalError("");
    try {
      await fn();
    } catch (e: any) {
      setModalError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function create() {
    let definition: Definition = {
      inputs: {},
      nodes: [{ id: "output", kind: "output", x: 400, y: 150, config: {} }],
      edges: [],
    };
    if (template !== "blank") {
      const queries: Query[] = await data("/api/dac/queries");
      if (!queries.length) throw Error("등록된 쿼리가 없습니다.");
      if (template === "example") definition = example(queries);
      else {
        const q = queries.find((q) => q.query_id === seed?.queryId);
        if (!q) throw Error("선택한 query_id가 카탈로그에 없습니다.");
        definition = {
          inputs: {},
          nodes: [
            {
              id: "query",
              kind: "query",
              x: 40,
              y: 80,
              config: {
                queryId: q.query_id,
                queryVersion: q.query_version,
                body: seed.body,
              },
            },
            { id: "output", kind: "output", x: 370, y: 80, config: {} },
          ],
          edges: [{ source: "query", target: "output", port: "input" }],
        };
      }
    }
    const w = await json<Workflow>("/api/workflows", {
      method: "POST",
      body: JSON.stringify({ name: name.trim(), definition }),
    });
    setCreating(false);
    setSeed(null);
    sessionStorage.removeItem("workflow-query-seed");
    edit(w.id);
  }
  if (editorId)
    return (
      <WorkflowEditor key={editorId} workflowId={editorId} onBack={back} />
    );
  const filtered = items.filter((w) =>
    (w.name + " " + w.id).toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <div className="wf-page wf-library">
      <div className="wf-heading">
        <div>
          <h1>
            Workflows <span>저장하고, 관리하고, API로 실행하세요</span>
          </h1>
        </div>
        <button
          className="primary wf-create"
          onClick={() => {
            setName("");
            setTemplate("blank");
            setModalError("");
            setCreating(true);
          }}
        >
          <Plus size={16} />
          워크플로우 추가
        </button>
      </div>
      <ErrorBox error={error} />
      {message && (
        <div className="wf-message" role="status">
          {message}
        </div>
      )}
      <div className="wf-library-tools">
        <label>
          <Search size={16} />
          <input
            aria-label="워크플로우 검색"
            placeholder="workflow_id 또는 이름 검색"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <span>{filtered.length}개 워크플로우</span>
        <button
          disabled={loading}
          onClick={() => {
            setError("");
            refresh();
          }}
          aria-label="워크플로우 목록 새로고침"
        >
          <RefreshCw size={15} />
        </button>
      </div>
      {loading ? (
        <div className="loading">워크플로우 목록을 불러오는 중…</div>
      ) : filtered.length ? (
        <div className="wf-library-table">
          <table>
            <thead>
              <tr>
                <th>workflow_id / 이름</th>
                <th>게시 상태</th>
                <th>실행 API</th>
                <th>수정일</th>
                <th>관리</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((w) => (
                <tr key={w.id} data-workflow-id={w.id}>
                  <td>
                    <button className="wf-name-link" onClick={() => edit(w.id)}>
                      <GitBranch size={16} />
                      <strong className="entity-id">{w.id}</strong>
                    </button>
                    <small className="entity-description">{w.name}</small>
                  </td>
                  <td>
                    <span
                      className={
                        "wf-publish-badge " +
                        (w.published_version ? "published" : "")
                      }
                    >
                      {w.published_version
                        ? "게시 v" + w.published_version
                        : "초안"}
                    </span>
                  </td>
                  <td>
                    <code className="wf-library-endpoint">
                      POST /api/workflow/{w.id}
                    </code>
                    {w.published_version ? (
                      <button
                        aria-label={w.name + " 실행 주소 복사"}
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(
                              location.origin + "/api/workflow/" + w.id,
                            );
                            setMessage(
                              "실행 주소를 복사했습니다. POST 요청으로 호출하세요.",
                            );
                          } catch {
                            setError(
                              "주소를 자동 복사할 수 없습니다. 표시된 실행 주소를 선택해 복사하세요.",
                            );
                          }
                        }}
                      >
                        <Copy size={13} />
                      </button>
                    ) : (
                      <small className="wf-muted">게시 후 실행 가능</small>
                    )}
                  </td>
                  <td>
                    <time>{when(w.updated_at)}</time>
                  </td>
                  <td>
                    <div className="wf-row-actions"><a href={"#analysis?workflow="+w.id}>분석 소스로 ↗</a>{w.published_version && <a href={"#engines?workflow="+w.id}>Engine Benchmark ↗</a>}
                      <button
                        onClick={() => edit(w.id)}
                        aria-label={w.name + " 수정"}
                      >
                        <Pencil size={14} />
                        수정
                      </button>
                      <button
                        onClick={() => {
                          setRenaming(w);
                          setName(w.name);
                          setModalError("");
                        }}
                        aria-label={w.name + " 이름 변경"}
                      >
                        이름 변경
                      </button>
                      <button
                        className="wf-delete"
                        onClick={() => {
                          setRemoving(w);
                          setModalError("");
                        }}
                        aria-label={w.name + " 삭제"}
                      >
                        <Trash2 size={14} />
                        삭제
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="wf-library-empty">
          <GitBranch size={32} />
          <h3>
            {search ? "검색 결과가 없습니다" : "첫 워크플로우를 만들어보세요"}
          </h3>
          <p>
            {search
              ? "다른 이름이나 workflow_id로 검색하세요."
              : "이름을 정한 뒤 쿼리와 변환 노드를 연결합니다. 저장한 워크플로우는 이 목록에서 관리할 수 있습니다."}
          </p>
          {!search && (
            <button
              className="primary"
              onClick={() => {
                setName("");
                setTemplate("blank");
                setCreating(true);
              }}
            >
              워크플로우 추가
            </button>
          )}
        </div>
      )}
      <p className="wf-library-note">
        이름은 자유롭게 변경할 수 있으며 workflow_id와 실행 주소는 유지됩니다.
        저장은 초안을 갱신하고, 게시는 실행할 버전을 만듭니다.
      </p>
      {(creating || renaming) && (
        <Modal
          title={creating ? "워크플로우 추가" : "워크플로우 이름 변경"}
          onClose={close}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              modalAction(async () => {
                if (creating) await create();
                else if (renaming) {
                  const w = await json<Workflow>(
                    "/api/workflows/" + renaming.id,
                  );
                  await json("/api/workflows/" + w.id, {
                    method: "PUT",
                    body: JSON.stringify({
                      name: name.trim(),
                      definition: w.definition,
                      revision: renaming.revision,
                    }),
                  });
                  setRenaming(null);
                  setMessage("이름을 변경했습니다. 실행 주소는 유지됩니다.");
                  await refresh();
                }
              });
            }}
          >
            <ErrorBox error={modalError} />
            <label className="wf-field">
              워크플로우 이름
              <input
                aria-label="저장할 워크플로우 이름"
                required
                maxLength={80}
                value={name}
                disabled={busy}
                placeholder="예: Lot별 수율과 결함 분석"
                onChange={(e) => setName(e.target.value)}
              />
              <small>1~80자. 목록과 편집기에 표시되는 이름입니다.</small>
            </label>
            {creating && (
              <label className="wf-field">
                시작 방법
                <select
                  aria-label="워크플로우 시작 방법"
                  value={template}
                  disabled={busy}
                  onChange={(e) => setTemplate(e.target.value)}
                >
                  <option value="blank">빈 워크플로우</option>
                  <option value="example">
                    예제 · EDS + Defect → Join → Filter
                  </option>
                  {seed && (
                    <option value="query">
                      API 콘솔 요청 · {seed.queryId}
                    </option>
                  )}
                </select>
              </label>
            )}
            <div className="wf-modal-actions">
              <button type="button" disabled={busy} onClick={close}>
                취소
              </button>
              <button
                className="primary"
                disabled={busy || !name.trim()}
                type="submit"
              >
                {busy ? "저장 중…" : creating ? "만들고 편집" : "이름 저장"}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {removing && (
        <Modal title="워크플로우 삭제" onClose={close}>
          <ErrorBox error={modalError} />
          <p>
            <strong>{removing.id}</strong> ({removing.name})을 삭제할까요?
          </p>
          <p className="wf-muted">
            목록에서 제거되고 게시된 실행 API도 사용할 수 없게 됩니다. 기존 실행
            기록은 보존됩니다. 대기·실행 중인 작업이 있으면 삭제할 수 없습니다.
          </p>
          <div className="wf-modal-actions">
            <button disabled={busy} onClick={close}>
              취소
            </button>
            <button
              className="wf-delete-confirm"
              disabled={busy}
              onClick={() =>
                modalAction(async () => {
                  await json(
                    `/api/workflows/${removing.id}?revision=${removing.revision}`,
                    { method: "DELETE" },
                  );
                  localStorage.removeItem(draftKey + ":" + removing.id);
                  setRemoving(null);
                  setMessage("워크플로우를 삭제했습니다.");
                  await refresh();
                })
              }
            >
              {busy ? "삭제 중…" : "삭제 확인"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
