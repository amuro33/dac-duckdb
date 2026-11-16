import { useEffect, useRef, useState } from "react";
import { Play, Copy, Check, Terminal, RefreshCw } from "lucide-react";
import { execute, data, json, fmt, when } from "./api";
import { PageHeading, ErrorBox } from "./ui";
import type { Run } from "./types";
export type ConsoleRequest = { path: string; method: string; body?: unknown };
type Query = {
  query_id: string;
  database_name: string;
  name: string;
  description: string;
  query_version: number;
  route: string;
  method: string;
  default_body: Record<string, unknown>;
  bindings: {
    name: string;
    type: string;
    nullable: boolean;
    min?: number;
    max?: number;
  }[];
};
export function Console({ start }: { start?: ConsoleRequest }) {
  const [queries, setQueries] = useState<Query[]>([]),
    [catalogBusy, setCatalogBusy] = useState(true),
    [search, setSearch] = useState("");
  const [req, setReq] = useState<ConsoleRequest>(
      start ?? { path: "", method: "POST" },
    ),
    [body, setBody] = useState(JSON.stringify(start?.body ?? {}, null, 2)),
    [busy, setBusy] = useState(false),
    [result, setResult] = useState<any>(),
    [error, setError] = useState(""),
    [copied, setCopied] = useState(false),
    [responseTab, setResponseTab] = useState("json");
  const [history, setHistory] = useState<Run[]>([]),
    [historyError, setHistoryError] = useState(""),
    [historyId, setHistoryId] = useState("");
  const abort = useRef<AbortController | null>(null);
  const selected = queries.find((q) => q.route === req.path);
  function select(r: ConsoleRequest, id = "") {
    setReq(r);
    setBody(JSON.stringify(r.body ?? {}, null, 2));
    setError("");
    setResult(undefined);
    setHistoryId(id);
  }
  async function loadHistory() {
    try {
      setHistory(
        (await json<Run[]>("/api/workspace/runs?limit=200")).filter((r) =>
          r.path.startsWith("/api/dac/select/"),
        ),
      );
      setHistoryError("");
    } catch (e: any) {
      setHistoryError(e.message);
    }
  }
  useEffect(() => {
    const a = new AbortController();
    data("/api/dac/queries", "GET", undefined, false, a.signal)
      .then((items: Query[]) => {
        setQueries(items);
        if (!start && items.length) {
          const first =
            items.find((q) => q.query_id === "EDS_BY_LOT") ?? items[0];
          select({
            path: first.route,
            method: "POST",
            body: first.default_body,
          });
        }
      })
      .catch((e) => {
        if (!a.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!a.signal.aborted) setCatalogBusy(false);
      });
    loadHistory();
    return () => {
      a.abort();
      abort.current?.abort();
    };
  }, []);
  async function send() {
    if (busy || !req.path) return;
    setError("");
    let parsed;
    try {
      if (req.method === "POST") {
        parsed = JSON.parse(body);
        if (
          parsed === null ||
          Array.isArray(parsed) ||
          typeof parsed !== "object"
        )
          throw Error();
      }
    } catch {
      setError("JSON 객체 형식의 요청 본문을 입력해 주세요.");
      return;
    }
    const a = new AbortController();
    abort.current = a;
    setBusy(true);
    setResult(undefined);
    try {
      setResult(await execute(req.path, req.method, parsed, true, a.signal));
      await loadHistory();
    } catch (e: any) {
      if (!a.signal.aborted) setError(e.message);
    } finally {
      if (abort.current === a) setBusy(false);
    }
  }
  const rows = result
    ? Array.isArray(result.data)
      ? result.data
      : Array.isArray(result.data?.data)
        ? result.data.data
        : []
    : [];
  const keys =
    rows[0] && typeof rows[0] === "object" ? Object.keys(rows[0]) : [];
  return (
    <>
      <PageHeading
        title="DAC 쿼리 콘솔"
        description="저장된 query_id 선택 → 기본 바디 수정 → 실행 → History에서 다시 사용"
      />
      <div className="console-layout">
        <aside className="request-list">
          <h3>저장 쿼리</h3>
          <input
            className="catalog-search"
            aria-label="저장 쿼리 검색"
            placeholder="query_id / 이름 검색"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {catalogBusy && <p role="status">쿼리 목록을 불러오는 중…</p>}
          {!catalogBusy && !queries.length && (
            <p>등록된 쿼리가 없거나 목록을 불러오지 못했습니다.</p>
          )}
          {queries
            .filter((q) =>
              (q.query_id + q.name)
                .toLowerCase()
                .includes(search.toLowerCase()),
            )
            .map((q) => (
              <button
                key={q.query_id}
                disabled={busy}
                className={req.path === q.route ? "selected" : ""}
                onClick={() =>
                  select({
                    path: q.route,
                    method: "POST",
                    body: q.default_body,
                  })
                }
              >
                <span className="post">POST</span>
                <span className="query-list-label">
                  <strong className="query-id">{q.query_id}</strong>
                  <small className="query-name">{q.name}</small>
                </span>
              </button>
            ))}
          <p>
            ⌘ / Ctrl + Enter
            <br />
            요청 편집기에서 실행
          </p>
        </aside>
        <div className="console-work">
          {selected && (
            <div className="query-description">
              <strong className="query-id">{selected.query_id}</strong>
              <span className="query-name">{selected.name}</span>
              <p>{selected.description}</p>
              <small>
                {selected.database_name} · SQL 버전{" "}
                {selected.query_version}
              </small>
            </div>
          )}
          {start && !selected && !catalogBusy && (
            <p className="notice">이력에서 불러온 기존 API 요청입니다.</p>
          )}
          <div className="request-bar">
            <span className="post request-method">{req.method}</span>
            <input
              aria-label="API 경로"
              readOnly
              value={req.path}
              placeholder="왼쪽에서 저장 쿼리를 선택하세요"
            />
            <button
              className="primary"
              disabled={busy || !req.path}
              onClick={send}
            >
              <Play size={14} />
              {busy ? "실행 중" : "Send"}
            </button>
            {busy && (
              <button
                onClick={() => {
                  abort.current?.abort();
                  setBusy(false);
                }}
              >
                취소
              </button>
            )}
          </div>
          <ErrorBox error={error} />
          {historyId && (
            <p className="notice">
              이력 {historyId.slice(0, 8)}의 요청 바디입니다. 실행하면 새로운
              이력으로 저장됩니다.
            </p>
          )}
          {selected && (
            <details className="query-bindings">
              <summary>바인딩 파라미터 · {selected.bindings.length}개</summary>
              <ul>
                {selected.bindings.map((b) => (
                  <li key={b.name}>
                    <code>{b.name}</code> · {b.type}
                    {b.nullable ? " / null 허용" : " / 값 필수"}
                    {b.min != null ? ` · ${b.min}–${b.max}` : ""}
                  </li>
                ))}
              </ul>
              <p>
                database_name과 query_id는 선택한 쿼리와 일치해야 합니다. 바인딩
                키는 바디 최상위에 작성합니다.
              </p>
            </details>
          )}
          {req.method === "POST" && (
            <div className="request-body">
              <div>
                REQUEST BODY <span>application/json</span>
                {selected && <><button disabled={busy} onClick={()=>{try{sessionStorage.setItem("analysis-api-seed",JSON.stringify({queryId:selected.query_id,body:JSON.parse(body)}));location.hash="analysis?api=1"}catch(e:any){setError(e.message)}}}>분석 소스로</button></>}
                {selected && <button disabled={busy} onClick={() => { try { const parsed = JSON.parse(body); if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw Error("JSON 객체를 입력하세요."); sessionStorage.setItem("workflow-query-seed", JSON.stringify({queryId:selected.query_id,body:parsed})); location.hash = "workflows"; } catch(e:any) { setError(e.message); } }}>워크플로우로 연결</button>}
                {selected && (
                  <button
                    disabled={busy}
                    onClick={() => {
                      setBody(JSON.stringify(selected.default_body, null, 2));
                      setHistoryId("");
                      setResult(undefined);
                    }}
                  >
                    기본 바디 복원
                  </button>
                )}
              </div>
              <textarea
                spellCheck={false}
                aria-label="JSON 요청 본문"
                disabled={busy}
                value={body}
                onChange={(e) => {
                  setBody(e.target.value);
                  setResult(undefined);
                }}
                onKeyDown={(e) => {
                  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                    e.preventDefault();
                    send();
                  }
                }}
              />
            </div>
          )}
          <div className="response-heading">
            <div className="segmented">
              <button
                className={responseTab === "json" ? "active" : ""}
                onClick={() => setResponseTab("json")}
              >
                JSON
              </button>
              <button
                className={responseTab === "table" ? "active" : ""}
                onClick={() => setResponseTab("table")}
              >
                Table
              </button>
            </div>
            {result && (
              <>
                <span
                  className={
                    "status-code " + (result.status >= 400 ? "bad" : "")
                  }
                >
                  {result.status}
                </span>
                <span className="mono tiny">{fmt(result.durationMs)} ms</span>
                <button
                  className="icon-button push-right"
                  aria-label="응답 복사"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(
                        JSON.stringify(result.data, null, 2),
                      );
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    } catch {
                      setError("클립보드 접근을 허용해 주세요.");
                    }
                  }}
                >
                  {copied ? <Check size={15} /> : <Copy size={15} />}
                </button>
              </>
            )}
          </div>
          {!result ? (
            <div className="response-empty">
              <Terminal size={28} />
              <h3>첫 번째 요청을 실행해 보세요.</h3>
              <p>왼쪽에서 쿼리를 선택한 뒤 기본 바디를 수정해 실행하세요.</p>
            </div>
          ) : responseTab === "json" ? (
            <pre className="response-json">
              {JSON.stringify(result.data, null, 2)}
            </pre>
          ) : keys.length ? (
            <>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      {keys.map((k) => (
                        <th key={k}>{k}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 50).map((r: any, i: number) => (
                      <tr key={i}>
                        {keys.map((k) => (
                          <td key={k}>
                            {typeof r[k] === "object"
                              ? JSON.stringify(r[k])
                              : String(r[k] ?? "NULL")}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="tiny muted">
                {fmt(rows.length)}행 중 최대 50행 미리보기. 전체 응답은 JSON
                탭에서 확인하세요.
              </p>
            </>
          ) : (
            <div className="quiet-empty">
              테이블로 표시할 행 배열이 없습니다. JSON 탭을 사용하세요.
            </div>
          )}
          {result && (
            <p className="trace-id">
              Run ID <span>{result.runId}</span>
            </p>
          )}

          <section className="console-history">
            <div className="panel-heading">
              <h3>History · DAC 실행 이력</h3>
              <button onClick={loadHistory} disabled={busy}>
                <RefreshCw size={14} />
                이력 새로고침
              </button>
            </div>
            <p className="tiny muted">
              최근 전체 실행 200건 중 DAC 쿼리 실행. 요청 바디와 상태를
              저장합니다. 결과 데이터 자체는 저장하지 않습니다.
            </p>
            <ErrorBox error={historyError} />
            {!history.length && <p>아직 실행한 DAC 쿼리가 없습니다.</p>}
            <div className="console-history-list">
              {history.map((r) => (
                <button
                  className="history-request"
                  disabled={busy}
                  key={r.id}
                  onClick={() =>
                    select(
                      { path: r.path, method: r.method, body: r.request },
                      r.id,
                    )
                  }
                >
                  <span
                    className={"status-code " + (r.status >= 400 ? "bad" : "")}
                  >
                    {r.status}
                  </span>
                  <span>
                    <strong>{r.path.split("/").pop()}</strong>
                    <small>
                      {when(r.createdAt)} · {fmt(r.durationMs)}ms ·{" "}
                      {fmt(r.rowCount)}행
                    </small>
                  </span>
                  <span>바디 불러오기 ↗</span>
                </button>
              ))}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
