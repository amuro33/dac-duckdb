import { useEffect, useRef, useState } from "react";
import {
  Play,
  Plus,
  X,
  ChevronDown,
  Save,
  GitBranch,
  Pin,
  Download,
  RefreshCw,
} from "lucide-react";
import { execute, data, json, fmt, when, csv, download } from "./api";
import { ErrorBox } from "./ui";
import type { Run } from "./types";
import { objectBody, bindingValue, responseRows } from "./console-model";
import "./console.css";
export type ConsoleRequest = { path: string; method: string; body?: unknown };
type Binding = {
  name: string;
  type: string;
  nullable: boolean;
  min?: number;
  max?: number;
};
type Query = {
  query_id: string;
  database_name: string;
  name: string;
  description: string;
  query_version: number;
  route: string;
  method: string;
  default_body: Record<string, unknown>;
  bindings: Binding[];
};
type Source = {
  id: string;
  name: string;
  kind: string;
  row_count: number;
  created_at: string;
};
type Tab = {
  id: string;
  path: string;
  method: string;
  body: string;
  source?: Source;
  result?: any;
  busy?: boolean;
  error?: string;
  notice?: string;
  historyId?: string;
  requestTab: string;
  responseTab: string;
};
const storageKey = "acb-console-drafts-v1";
function newTab(r: ConsoleRequest): Tab {
  return {
    id: crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
    path: r.path,
    method: r.method,
    body: JSON.stringify(r.body ?? {}, null, 2),
    requestTab: "Body",
    responseTab: "Table",
  };
}
function restore(): Tab[] {
  try {
    const value = JSON.parse(sessionStorage.getItem(storageKey) ?? "[]");
    return Array.isArray(value)
      ? value
          .filter(
            (t) =>
              typeof t.path === "string" &&
              typeof t.body === "string" &&
              ["POST", "GET"].includes(t.method),
          )
          .slice(0, 20)
          .map((t) => ({
            ...newTab({ path: t.path, method: t.method }),
            body: t.body,
          }))
      : [];
  } catch {
    return [];
  }
}
export function Console({ start }: { start?: ConsoleRequest }) {
  const [tabs, setTabs] = useState<Tab[]>(() =>
    start ? [newTab(start)] : restore(),
  );
  const [active, setActive] = useState("");
  const [queries, setQueries] = useState<Query[]>([]),
    [sources, setSources] = useState<Source[]>([]),
    [history, setHistory] = useState<Run[]>([]);
  const [search, setSearch] = useState(""),
    [side, setSide] = useState("Queries"),
    [loadError, setLoadError] = useState(""),
    [loading, setLoading] = useState(true),
    [menu, setMenu] = useState(false);
  const controllers = useRef(new Map<string, AbortController>());
  const tab = tabs.find((t) => t.id === active) ?? tabs[0];
  const selected = queries.find((q) => q.route === tab?.path);
  const patch = (id: string, value: Partial<Tab>) =>
    setTabs((ts) => ts.map((t) => (t.id === id ? { ...t, ...value } : t)));
  async function refresh() {
    const [h, s] = await Promise.all([
      json<Run[]>("/api/workspace/runs?limit=200"),
      json<Source[]>("/api/sources"),
    ]);
    setHistory(h.filter((r) => r.path.startsWith("/api/dac/select/")));
    setSources(s);
  }
  useEffect(() => {
    const a = new AbortController();
    data("/api/dac/queries", "GET", undefined, false, a.signal)
      .then((qs: Query[]) => {
        setQueries(qs);
        const first = qs.find((q) => q.query_id === "EDS_BY_LOT") ?? qs[0];
        setTabs((ts) =>
          ts.length
            ? ts
            : first
              ? [
                  newTab({
                    path: first.route,
                    method: "POST",
                    body: first.default_body,
                  }),
                ]
              : [],
        );
      })
      .catch((e) => {
        if (!a.signal.aborted) setLoadError(e.message);
      })
      .finally(() => setLoading(false));
    refresh().catch((e) => setLoadError(e.message));
    return () => {
      a.abort();
      controllers.current.forEach((c) => c.abort());
    };
  }, []);
  useEffect(() => {
    try {
      sessionStorage.setItem(
        storageKey,
        JSON.stringify(
          tabs
            .filter((t) => !t.source)
            .map(({ path, method, body }) => ({ path, method, body })),
        ),
      );
    } catch {
      setLoadError(
        "임시 저장 공간이 부족합니다. 요청 바디를 파일로 저장하세요.",
      );
    }
  }, [tabs]);
  function open(r: ConsoleRequest, historyId?: string, duplicate = false) {
    const found =
      !duplicate &&
      !historyId &&
      tabs.find((t) => !t.source && t.path === r.path);
    if (found) {
      setActive(found.id);
      return;
    }
    if (tabs.length >= 20) {
      setLoadError("요청 탭은 최대 20개입니다. 사용하지 않는 탭을 닫으세요.");
      return;
    }
    const t = { ...newTab(r), historyId };
    setTabs((ts) => [...ts, t]);
    setActive(t.id);
    setMenu(false);
  }
  async function openSource(s: Source) {
    const existing = tabs.find((t) => t.source?.id === s.id);
    if (existing) {
      setActive(existing.id);
      return;
    }
    if (tabs.length >= 20) {
      setLoadError("요청 탭은 최대 20개입니다.");
      return;
    }
    const t = {
      ...newTab({ path: "/api/sources/" + s.id, method: "GET" }),
      source: s,
      busy: true,
    };
    setTabs((ts) => [...ts, t]);
    setActive(t.id);
    const a = new AbortController();
    controllers.current.set(t.id, a);
    try {
      const result = await json(t.path + "/rows?limit=10000", {
        signal: a.signal,
      });
      patch(t.id, { result: { data: result }, busy: false });
    } catch (e: any) {
      patch(t.id, {
        busy: false,
        error: a.signal.aborted ? "불러오기를 취소했습니다." : e.message,
      });
    } finally {
      controllers.current.delete(t.id);
    }
  }
  async function send(pin = false) {
    if (!tab || tab.busy || tab.source) return;
    const t = tab;
    let body;
    try {
      body = t.method === "POST" ? objectBody(t.body) : undefined;
    } catch (e: any) {
      patch(t.id, { error: e.message });
      return;
    }
    const a = new AbortController();
    controllers.current.set(t.id, a);
    setMenu(false);
    patch(t.id, { busy: true, error: "", notice: "", result: undefined });
    try {
      if (pin) {
        if (!selected) throw Error("저장 쿼리를 선택하세요.");
        const s = await json<Source>("/api/sources", {
          method: "POST",
          body: JSON.stringify({
            kind: "api",
            queryId: selected.query_id,
            body,
          }),
          signal: a.signal,
        });
        patch(t.id, { notice: `새로 조회한 결과를 저장했습니다: ${s.name}` });
        await refresh();
        await openSource(s);
      } else {
        const result = await execute(t.path, t.method, body, true, a.signal);
        patch(t.id, { result });
        await refresh();
      }
    } catch (e: any) {
      patch(t.id, {
        error: a.signal.aborted
          ? "요청을 취소했습니다. 서버 실행 이력은 새로고침으로 확인하세요."
          : e.message,
      });
    } finally {
      controllers.current.delete(t.id);
      patch(t.id, { busy: false });
    }
  }
  function updateBody(value: string) {
    if (tab)
      patch(tab.id, {
        body: value,
        notice: "",
        historyId: undefined,
        result: undefined,
      });
  }
  function seed(target: "workflow" | "analysis") {
    if (!tab || !selected) return;
    try {
      sessionStorage.setItem(
        target === "workflow" ? "workflow-query-seed" : "analysis-api-seed",
        JSON.stringify({
          queryId: selected.query_id,
          body: objectBody(tab.body),
        }),
      );
      location.hash = target === "workflow" ? "workflows" : "analysis?api=1";
    } catch (e: any) {
      patch(tab.id, { error: e.message });
    }
  }
  let parsed: Record<string, unknown> | undefined;
  try {
    if (tab) parsed = objectBody(tab.body);
  } catch {}
  function bindings() {
    return (
      <div className="acb-bindings">
        {selected?.bindings.map((b) => (
          <label key={b.name}>
            <code title={`${b.type}${b.nullable ? " · null 허용" : ""}`}>
              {b.name}
            </code>
            <input
              aria-label={`바인딩 ${b.name}`}
              key={
                tab!.id + ":" + b.name + ":" + JSON.stringify(parsed?.[b.name])
              }
              defaultValue={
                parsed?.[b.name] === null
                  ? "null"
                  : String(parsed?.[b.name] ?? "")
              }
              disabled={!parsed || tab?.busy}
              onBlur={(e) => {
                try {
                  const value = bindingValue(
                    e.target.value,
                    b.type,
                    b.nullable,
                  );
                  if (
                    typeof value === "number" &&
                    ((b.min != null && value < b.min) ||
                      (b.max != null && value > b.max))
                  )
                    throw Error(
                      `${b.name}: ${b.min ?? "—"} ~ ${b.max ?? "—"} 범위입니다.`,
                    );
                  if (parsed && value !== parsed[b.name])
                    updateBody(
                      JSON.stringify({ ...parsed, [b.name]: value }, null, 2),
                    );
                  patch(tab!.id, { error: "" });
                } catch (err: any) {
                  patch(tab!.id, { error: err.message });
                  e.target.value = String(parsed?.[b.name] ?? "null");
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
            />
          </label>
        ))}
        {!parsed && <p>Body의 JSON을 먼저 수정하세요.</p>}
      </div>
    );
  }
  const rows = responseRows(tab?.result?.data);
  const keys = tab?.result?.data?.columns?.map((c: any) => c.name) ?? [
    ...new Set(rows.flatMap(Object.keys)),
  ];
  return (
    <div
      className="api-console"
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
          e.preventDefault();
          void send();
        }
        if (e.key === "Escape") setMenu(false);
      }}
    >
      <aside className="acb-sidebar">
        <div className="acb-section-head">
          <strong>API console</strong>
          <button
            aria-label="새 요청 탭"
            onClick={() => {
              const q = selected ?? queries[0];
              if (q)
                open(
                  { path: q.route, method: "POST", body: q.default_body },
                  undefined,
                  true,
                );
            }}
          >
            <Plus size={14} />
          </button>
        </div>
        <input
          className="acb-search"
          aria-label="저장 쿼리 검색"
          placeholder="query_id / 이름 검색"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="acb-subtabs">
          {["Queries", "History"].map((s) => (
            <button
              key={s}
              className={side === s ? "active" : ""}
              onClick={() => setSide(s)}
            >
              {s}
              {s === "History" && <small>{history.length}</small>}
            </button>
          ))}
          <button
            aria-label="목록 새로고침"
            onClick={() => refresh().catch((e) => setLoadError(e.message))}
          >
            <RefreshCw size={12} />
          </button>
        </div>
        <div className="acb-sidebar-scroll">
          <ErrorBox error={loadError} />
          {loading && <p role="status">쿼리 목록을 불러오는 중…</p>}
          {side === "Queries" ? (
            <>
              <div className="acb-group">
                ⌄ Oracle · XEPDB1 <small>{queries.length}</small>
              </div>
              {queries
                .filter((q) =>
                  (q.query_id + q.name)
                    .toLowerCase()
                    .includes(search.toLowerCase()),
                )
                .map((q) => (
                  <button
                    className={
                      "acb-query " +
                      (selected === q && !tab?.source ? "selected" : "")
                    }
                    key={q.query_id}
                    onClick={() =>
                      open({
                        path: q.route,
                        method: "POST",
                        body: q.default_body,
                      })
                    }
                  >
                    <span className="post">POST</span>
                    <span>
                      <strong>{q.query_id}</strong>
                      <small>{q.name}</small>
                    </span>
                  </button>
                ))}
              <div className="acb-group">
                ⌄ Saved sources <small>{sources.length}</small>
              </div>
              {sources
                .filter((s) =>
                  s.name.toLowerCase().includes(search.toLowerCase()),
                )
                .map((s) => (
                  <button
                    className={
                      "acb-query " +
                      (tab?.source?.id === s.id ? "selected" : "")
                    }
                    key={s.id}
                    onClick={() => void openSource(s)}
                  >
                    <span className="acb-src">SRC</span>
                    <span>
                      <strong>{s.name}</strong>
                      <small>
                        {fmt(s.row_count)} rows · {when(s.created_at)}
                      </small>
                    </span>
                  </button>
                ))}
              {!sources.length && (
                <p className="acb-hint">
                  실행하고 소스 고정으로 첫 소스를 저장하세요.
                </p>
              )}
            </>
          ) : (
            <>
              <p className="acb-hint">
                최근 전체 실행 200건 중 DAC 이력. 선택하면 요청 바디가 새 탭에
                열립니다.
              </p>
              {history
                .filter((r) =>
                  r.path.toLowerCase().includes(search.toLowerCase()),
                )
                .map((r) => (
                  <button
                    className="acb-query"
                    key={r.id}
                    onClick={() =>
                      open(
                        { path: r.path, method: r.method, body: r.request },
                        r.id,
                      )
                    }
                  >
                    <span className={r.status >= 400 ? "acb-failed" : "acb-ok"}>
                      {r.status}
                    </span>
                    <span>
                      <strong>{r.path.split("/").pop()}</strong>
                      <small>
                        {when(r.createdAt)} · {fmt(r.durationMs)} ms
                      </small>
                    </span>
                  </button>
                ))}
            </>
          )}
        </div>
        <div className="acb-sidebar-foot">
          ⌘ / Ctrl + Enter 실행 · 탭 자동 임시 저장
        </div>
      </aside>
      <section className="acb-work">
        <div className="acb-tabs" aria-label="열린 요청">
          {tabs.map((t) => (
            <div className={t.id === tab?.id ? "active" : ""} key={t.id}>
              <button
                aria-pressed={t.id === tab?.id}
                onClick={() => {
                  setActive(t.id);
                  setMenu(false);
                }}
                title={t.source?.name ?? t.path}
              >
                <span className={t.source ? "acb-src" : "post"}>
                  {t.source ? "SRC" : t.method}
                </span>
                {t.source?.name ?? t.path.split("/").pop()}
                {t.busy ? " …" : ""}
              </button>
              <button
                aria-label={`${t.source?.name ?? t.path.split("/").pop()} 탭 닫기`}
                onClick={() => {
                  if (
                    t.busy &&
                    !window.confirm("진행 중인 요청을 취소하고 탭을 닫을까요?")
                  )
                    return;
                  controllers.current.get(t.id)?.abort();
                  setTabs((ts) => ts.filter((x) => x.id !== t.id));
                }}
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
        {!tab ? (
          <div className="acb-empty">
            왼쪽에서 query_id를 선택해 요청을 시작하세요.
          </div>
        ) : (
          <>
            <div className="acb-context">
              <div>
                <strong>
                  {tab.source
                    ? tab.source.name
                    : (selected?.query_id ?? tab.path.split("/").pop())}
                </strong>
                <small>
                  {tab.source
                    ? "고정 스냅샷 · 읽기 전용"
                    : `${selected?.name ?? "API 요청"} · SQL v${selected?.query_version ?? "—"}`}
                </small>
              </div>
              <div className="acb-actions">
                {tab.source ? (
                  <a href={`#analysis?snapshot=${tab.source.id}`}>
                    Analysis에서 열기 ↗
                  </a>
                ) : (
                  <>
                    <button
                      onClick={() => {
                        download(
                          new Blob([tab.body], { type: "application/json" }),
                          `${selected?.query_id ?? "request"}.json`,
                        );
                        patch(tab.id, {
                          notice:
                            "요청 바디를 JSON 파일로 저장했습니다. 탭은 브라우저 세션에 자동 저장됩니다.",
                        });
                      }}
                    >
                      <Save size={13} />
                      저장
                    </button>
                    <button
                      disabled={!selected || tab.busy}
                      onClick={() => seed("workflow")}
                    >
                      <GitBranch size={13} />
                      워크플로우로 연결
                    </button>
                    <button
                      disabled={!selected || tab.busy}
                      title="현재 바디로 새로 조회한 결과를 고정 데이터 소스로 저장합니다."
                      onClick={() => void send(true)}
                    >
                      <Pin size={13} />
                      실행하고 소스 고정
                    </button>
                  </>
                )}
              </div>
            </div>
            <ErrorBox error={tab.error ?? ""} />
            {tab.notice && (
              <p className="acb-notice" role="status">
                {tab.notice}
              </p>
            )}
            {tab.historyId && (
              <p className="acb-notice">
                이력 {tab.historyId.slice(0, 8)}의 바디 · 실행하면 새 이력으로
                저장됩니다.
              </p>
            )}
            {!tab.source && (
              <>
                <div className="acb-url">
                  <span className="post">{tab.method}</span>
                  <input
                    aria-label="API 경로"
                    readOnly
                    value={location.origin + tab.path}
                  />
                  {tab.busy ? (
                    <button
                      onClick={() => controllers.current.get(tab.id)?.abort()}
                    >
                      취소
                    </button>
                  ) : (
                    <div className="acb-send">
                      <button
                        className="primary"
                        disabled={!tab.path}
                        onClick={() => void send()}
                      >
                        <Play size={12} />
                        Send
                      </button>
                      <button
                        className="primary"
                        aria-label="실행 옵션"
                        aria-expanded={menu}
                        onClick={() => setMenu(!menu)}
                      >
                        <ChevronDown size={13} />
                      </button>
                      {menu && (
                        <div className="acb-send-menu">
                          <button onClick={() => void send()}>실행</button>
                          <button
                            disabled={!selected}
                            onClick={() => void send(true)}
                          >
                            실행하고 소스 고정
                          </button>
                          <button
                            disabled={!selected}
                            onClick={() => seed("analysis")}
                          >
                            분석 소스로 열기
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <div className="acb-subtabs">
                  {["Params", "Body", "Headers", "Binding Docs"].map((s) => (
                    <button
                      key={s}
                      className={tab.requestTab === s ? "active" : ""}
                      onClick={() => patch(tab.id, { requestTab: s })}
                    >
                      {s}
                      {s === "Params" && (
                        <small>{selected?.bindings.length ?? 0}</small>
                      )}
                    </button>
                  ))}
                  <span className="acb-spacer" />
                  <button
                    disabled={tab.busy || !selected}
                    onClick={() =>
                      updateBody(
                        JSON.stringify(selected?.default_body, null, 2),
                      )
                    }
                  >
                    기본 바디 복원
                  </button>
                  <button
                    disabled={tab.busy}
                    onClick={() => {
                      try {
                        updateBody(
                          JSON.stringify(objectBody(tab.body), null, 2),
                        );
                      } catch (e: any) {
                        patch(tab.id, { error: e.message });
                      }
                    }}
                  >
                    Beautify
                  </button>
                </div>
                <div className="acb-editor">
                  {tab.requestTab === "Body" ? (
                    <textarea
                      aria-label="JSON 요청 본문"
                      spellCheck={false}
                      disabled={tab.busy || tab.method !== "POST"}
                      value={
                        tab.method === "POST"
                          ? tab.body
                          : "GET 요청에는 본문이 없습니다."
                      }
                      onChange={(e) => updateBody(e.target.value)}
                    />
                  ) : tab.requestTab === "Params" ? (
                    <>
                      <p className="acb-hint">
                        바디 바인딩 · 입력 후 Enter 또는 다른 필드 선택 시
                        Body에 반영됩니다.
                      </p>
                      {bindings()}
                    </>
                  ) : tab.requestTab === "Headers" ? (
                    <>
                      <dl>
                        <dt>Content-Type</dt>
                        <dd>
                          application/json; charset=utf-8
                          {tab.method !== "POST" && " (GET에는 전송하지 않음)"}
                        </dd>
                      </dl>
                      <p className="acb-hint">
                        등록된 DAC API로 전달하는 고정 헤더입니다. 임의
                        인증·호스트 헤더는 지원하지 않습니다.
                      </p>
                    </>
                  ) : (
                    <>
                      <p>{selected?.description}</p>
                      {selected?.bindings.map((b) => (
                        <p key={b.name}>
                          <code>{b.name}</code> · {b.type} ·{" "}
                          {b.nullable ? "null 허용" : "필수"}
                          {b.min != null ? ` · ${b.min}–${b.max}` : ""}
                        </p>
                      ))}
                      <p className="acb-hint">
                        database_name과 query_id는 선택한 쿼리와 일치해야
                        합니다.
                      </p>
                    </>
                  )}
                </div>
              </>
            )}
            <div className="acb-subtabs acb-response-bar">
              {[
                "Table",
                "Body",
                ...(!tab.source ? ["Headers", "Timeline"] : []),
              ].map((s) => (
                <button
                  key={s}
                  className={tab.responseTab === s ? "active" : ""}
                  onClick={() => patch(tab.id, { responseTab: s })}
                >
                  {s}
                </button>
              ))}
              <span className="acb-spacer" />
              {tab.result && (
                <>
                  <span
                    className={
                      "acb-status " + (tab.result.status >= 400 ? "failed" : "")
                    }
                  >
                    {tab.source
                      ? "SNAPSHOT"
                      : tab.result.status === 200
                        ? "200 OK"
                        : tab.result.status}
                  </span>
                  {!tab.source && (
                    <>
                      <span>{fmt(tab.result.durationMs)} ms</span>
                      <span title="JSON 응답 본문의 UTF-8 크기">
                        {fmt((tab.result.responseBytes ?? 0) / 1024)} KB
                      </span>
                    </>
                  )}
                  <span>{fmt(rows.length)} rows</span>
                  <button
                    disabled={!rows.length}
                    onClick={() =>
                      download(
                        new Blob([csv(rows)], {
                          type: "text/csv;charset=utf-8",
                        }),
                        `${selected?.query_id ?? "source"}.csv`,
                      )
                    }
                  >
                    <Download size={12} />
                    CSV
                  </button>
                </>
              )}
            </div>
            <div className="acb-response">
              {tab.busy ? (
                <div className="acb-empty" role="status">
                  요청을 실행하고 있습니다…
                </div>
              ) : !tab.result ? (
                <div className="acb-empty">
                  <strong>조회할 query_id를 선택하고 Send</strong>
                  <p>요청 바디와 실행 상태는 History에 저장됩니다.</p>
                </div>
              ) : tab.responseTab === "Body" ? (
                <pre>{JSON.stringify(tab.result.data, null, 2)}</pre>
              ) : tab.responseTab === "Headers" ? (
                <dl>
                  {Object.entries(tab.result.responseHeaders ?? {}).map(
                    ([k, v]) => (
                      <div key={k}>
                        <dt>{k}</dt>
                        <dd>{String(v)}</dd>
                      </div>
                    ),
                  )}
                </dl>
              ) : tab.responseTab === "Timeline" ? (
                <div className="acb-timeline">
                  <strong>API 처리 · {fmt(tab.result.durationMs)} ms</strong>
                  <p>
                    Portal에서 측정한 업스트림 요청 + JSON 읽기 시간입니다.
                    브라우저 왕복·이력 저장 시간은 제외됩니다.
                  </p>
                  <code>Run ID {tab.result.runId}</code>
                </div>
              ) : keys.length ? (
                <>
                  <table>
                    <thead>
                      <tr>
                        {keys.map((k: string) => (
                          <th key={k}>{k}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.slice(0, 200).map((r, i) => (
                        <tr key={i}>
                          {keys.map((k: string) => (
                            <td key={k}>
                              {r[k] === null
                                ? "NULL"
                                : typeof r[k] === "object"
                                  ? JSON.stringify(r[k])
                                  : String(r[k] ?? "")}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {rows.length > 200 && (
                    <p className="acb-hint">
                      {fmt(rows.length)}행 중 200행 미리보기 · CSV는 전체 행을
                      내보냅니다.
                    </p>
                  )}
                </>
              ) : (
                <div className="acb-empty">
                  표시할 행이 없습니다. Body에서 응답을 확인하세요.
                </div>
              )}
            </div>
          </>
        )}
      </section>
      <aside className="acb-inspector">
        <div className="acb-section-head">
          <strong>Inspector</strong>
        </div>
        {tab?.source ? (
          <div className="acb-inspector-content">
            <h3>고정 데이터 소스</h3>
            <p>{tab.source.name}</p>
            <p>
              {fmt(tab.source.row_count)} rows · {when(tab.source.created_at)}
            </p>
            <code>{tab.source.id}</code>
            <a href={`#analysis?snapshot=${tab.source.id}`}>
              Analysis에서 열기 ↗
            </a>
          </div>
        ) : (
          <div className="acb-inspector-content">
            <h3>바인딩 파라미터</h3>
            {bindings()}
            <h3>최근 실행</h3>
            {history
              .filter((r) => r.path === tab?.path)
              .slice(0, 5)
              .map((r) => (
                <button
                  className="acb-recent"
                  key={r.id}
                  title={`${when(r.createdAt)} · 이 바디로 새 탭 열기`}
                  onClick={() =>
                    open(
                      { path: r.path, method: r.method, body: r.request },
                      r.id,
                    )
                  }
                >
                  <span className={r.status >= 400 ? "acb-failed" : "acb-ok"}>
                    ●
                  </span>
                  <span>
                    {r.status} · {fmt(r.rowCount)} rows
                  </span>
                  <small>{fmt(r.durationMs)} ms</small>
                </button>
              ))}
            {!history.some((r) => r.path === tab?.path) && (
              <p>아직 실행 이력이 없습니다.</p>
            )}
            <div className="acb-next">
              <strong>다음 단계</strong>
              <p>
                바디를 워크플로우 Query 노드에 연결하거나, 새로 조회한 결과를
                고정 소스로 저장해 Analysis에서 차트로 열어 보세요.
              </p>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}
