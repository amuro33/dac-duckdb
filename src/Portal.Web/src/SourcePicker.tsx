import { Identity, sourceIdentifier } from "./identity";
import { useEffect, useRef, useState } from "react";
import { json, data, fmt, when } from "./api";
import { ErrorBox } from "./ui";
import type { Column } from "./types";
import "./sources.css";
export type SourceSnapshot = {
  id: string;
  name: string;
  kind: string;
  origin: any;
  columns: Column[];
  row_count: number;
  checksum: string;
  created_at: string;
};
export function SourcePicker({
  initialId,
  onSelect,
  label = "데이터 소스",
  disabled = false,
}: {
  initialId?: string | null;
  onSelect: (s: SourceSnapshot) => void;
  label?: string;
  disabled?: boolean;
}) {
  const [kind, setKind] = useState("workflow"),
    [workflows, setWorkflows] = useState<any[]>([]),
    [queries, setQueries] = useState<any[]>([]),
    [snapshots, setSnapshots] = useState<SourceSnapshot[]>([]),
    [history, setHistory] = useState<any[]>([]);
  const [workflow, setWorkflow] = useState(
      new URLSearchParams(location.hash.split("?")[1]).get("workflow") || "",
    ),
    [query, setQuery] = useState(""),
    [version, setVersion] = useState(""),
    [versions, setVersions] = useState<any[]>([]),
    [runs, setRuns] = useState<any[]>([]),
    [runId, setRunId] = useState(""),
    [body, setBody] = useState("{}"),
    [queryBody, setQueryBody] = useState("{}");
  const [active, setActive] = useState<SourceSnapshot | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [progress, setProgress] = useState(""),
    [preview, setPreview] = useState<any[]>([]),
    [metaBusy, setMetaBusy] = useState(false);
  const previewRequest = useRef(0);
  const apiSeed = useRef<any>(null);
  const callback = useRef(onSelect);
  callback.current = onSelect;
  const cancel = useRef<AbortController | null>(null);
  const locked = busy || disabled;
  async function select(s: SourceSnapshot) {
    const request = ++previewRequest.current;
    setPreview([]);
    setActive(s);
    callback.current(s);
    try {
      const r = await json(`/api/sources/${s.id}/rows?limit=5`);
      if (request === previewRequest.current) setPreview(r.data);
    } catch (e: any) {
      setError(e.message);
    }
  }
  async function refresh() {
    const [ws, ss] = await Promise.all([
      json("/api/workflows"),
      json("/api/sources"),
    ]);
    setWorkflows(ws);
    setSnapshots(ss);
    setWorkflow((w) => w || ws.find((x: any) => x.published_version)?.id || ws[0]?.id || "");
  }
  useEffect(() => {
    let live = true;
    try {
      const raw = sessionStorage.getItem("analysis-api-seed");
      if (raw) {
        apiSeed.current = JSON.parse(raw);
        setKind("api");
        sessionStorage.removeItem("analysis-api-seed");
      }
    } catch {}
    refresh().catch((e) => {
      if (live) setError(e.message);
    });
    data("/api/dac/queries")
      .then((q) => {
        if (live) {
          setQueries(q);
          setQuery(apiSeed.current?.queryId || q[0]?.query_id || "");
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    json("/api/workspace/runs?limit=200")
      .then((h) => {
        if (live) setHistory(h);
      })
      .catch(() => {});
    return () => {
      live = false;
      previewRequest.current++;
      cancel.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (initialId && initialId !== active?.id)
      json<SourceSnapshot>("/api/sources/" + initialId)
        .then((s) => { setKind("saved"); return select(s); })
        .catch((e) => setError(e.message));
  }, [initialId]);
  useEffect(() => {
    const q = queries.find((q) => q.query_id === query);
    if (q) {
      setQueryBody(
        JSON.stringify(
          apiSeed.current?.queryId === q.query_id
            ? apiSeed.current.body
            : q.default_body,
          null,
          2,
        ),
      );
      apiSeed.current = null;
    }
  }, [query, queries]);
  useEffect(() => {
    if (!workflow) return;
    const a = new AbortController();
    setMetaBusy(true);
    setRunId("");
    setRuns([]);
    setVersion("");
    Promise.all([
      json(`/api/workflows/${workflow}/versions`, { signal: a.signal }),
      json(`/api/workflows/${workflow}/runs`, { signal: a.signal }),
    ])
      .then(([v, r]) => {
        setVersions(v);
        setVersion(v[0]?.version.toString() || "");
        setRuns(r.filter((x: any) => x.status === "succeeded"));
        if (!v.length) setBody("{}");
      })
      .catch((e) => {
        if (!a.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!a.signal.aborted) setMetaBusy(false);
      });
    return () => a.abort();
  }, [workflow]);
  useEffect(() => {
    if (!workflow || !version) return;
    const a = new AbortController();
    setMetaBusy(true);
    json(`/api/workflows/${workflow}/versions/${version}`, { signal: a.signal })
      .then((r) => setBody(JSON.stringify(r.definition.inputs, null, 2)))
      .catch((e) => {
        if (!a.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!a.signal.aborted) setMetaBusy(false);
      });
    return () => a.abort();
  }, [workflow, version]);
  async function capture() {
    const a = new AbortController();
    cancel.current = a;
    setBusy(true);
    setError("");
    try {
      let request: any;
      if (kind === "workflow") {
        let id = runId;
        if (!id) {
          if (!version)
            throw Error("게시 버전이나 성공한 실행 기록을 선택하세요.");
          const inputs = JSON.parse(body);
          setProgress("워크플로우 실행 접수");
          id = (
            await json(`/api/workflow/${workflow}`, {
              method: "POST",
              body: JSON.stringify({ version: Number(version), inputs }),
              signal: a.signal,
            })
          ).runId;
          while (true) {
            a.signal.throwIfAborted();
            const r = await json("/api/workflow-runs/" + id, {
              signal: a.signal,
            });
            setProgress("워크플로우 · " + r.status);
            if (r.status === "succeeded") break;
            if (!["queued", "running"].includes(r.status))
              throw Error(r.error || "워크플로우 실행 실패");
            await new Promise<void>((resolve) => {
              const end = () => {
                clearTimeout(t);
                a.signal.removeEventListener("abort", end);
                resolve();
              };
              const t = setTimeout(end, 500);
              a.signal.addEventListener("abort", end, { once: true });
            });
          }
        }
        request = { kind: "workflow", runId: id };
      } else
        request = { kind: "api", queryId: query, body: JSON.parse(queryBody) };
      setProgress("결과를 공통 데이터 소스로 저장 중");
      const s = await json<SourceSnapshot>("/api/sources", {
        method: "POST",
        body: JSON.stringify(request),
        signal: a.signal,
      });
      await select(s);
      await refresh();
    } catch (e: any) {
      if (!a.signal.aborted) setError(e.message);
    } finally {
      if (!a.signal.aborted) {
        setBusy(false);
        setProgress("");
      }
    }
  }
  return (
    <section className="source-picker">
      <div className="source-heading">
        <strong>{label}</strong>
        <span>Workflow / API → 고정된 결과 데이터</span>
      </div>
      <ErrorBox error={error} />
      <div className="source-tabs">
        {[
          ["workflow", "워크플로우"],
          ["api", "DAC API"],
          ["saved", "저장된 소스"],
        ].map(([k, n]) => (
          <button
            key={k}
            type="button"
            disabled={locked}
            className={kind === k ? "active" : ""}
            onClick={() => {
              setKind(k);
              setError("");
            }}
          >
            {n}
          </button>
        ))}
      </div>
      {kind === "saved" ? (
        <label>
          결과 데이터 선택
          <select
            aria-label={label + " 저장된 소스"}
            disabled={locked}
            value={active?.id || ""}
            onChange={(e) => {
              const s = snapshots.find((s) => s.id === e.target.value);
              if (s) select(s);
            }}
          >
            <option value="">선택하세요</option>
            {snapshots.map((s) => (
              <option key={s.id} value={s.id}>
                {sourceIdentifier(s)} · {s.name} · {fmt(s.row_count)}행 · {when(s.created_at)}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <>
          <div className="source-fields">
            {kind === "workflow" ? (
              <>
                <label>
                  workflow_id
                  <select
                    aria-label={label + " 워크플로우"}
                    disabled={locked}
                    value={workflow}
                    onChange={(e) => setWorkflow(e.target.value)}
                  >
                    <option value="">선택하세요</option>
                    {workflows.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.id} · {w.name} ·{" "}
                        {w.published_version
                          ? "v" + w.published_version
                          : "미게시"}
                      </option>
                    ))}
                  </select>
                  {workflow && <Identity id={workflow} description={workflows.find(w => w.id === workflow)?.name} />}
                </label>
                <label>
                  결과 가져오기
                  <select
                    aria-label={label + " 실행 선택"}
                    disabled={locked || metaBusy}
                    value={runId}
                    onChange={(e) => setRunId(e.target.value)}
                  >
                    <option value="">게시 버전 새로 실행</option>
                    {runs.map((r) => (
                      <option key={r.id} value={r.id}>
                        {when(r.created_at)} ·{" "}
                        {r.version ? "v" + r.version : "초안"} ·{" "}
                        {r.id.slice(0, 8)}
                      </option>
                    ))}
                  </select>
                </label>
                {!runId && (
                  <label>
                    게시 버전
                    <select
                      aria-label={label + " 게시 버전"}
                      disabled={locked || metaBusy}
                      value={version}
                      onChange={(e) => setVersion(e.target.value)}
                    >
                      <option value="">게시 필요</option>
                      {versions.map((v) => (
                        <option key={v.version} value={v.version}>
                          v{v.version}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </>
            ) : (
              <>
                <label>
                  query_id
                  <select
                    aria-label={label + " query_id"}
                    disabled={locked}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  >
                    {queries.map((q) => (
                      <option key={q.query_id} value={q.query_id}>
                        {q.query_id} · {q.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  히스토리 바디 복사
                  <select
                    aria-label={label + " API 이력"}
                    disabled={locked}
                    value=""
                    onChange={(e) => {
                      const h = history.find((h) => h.id === e.target.value);
                      if (h) setQueryBody(JSON.stringify(h.request, null, 2));
                    }}
                  >
                    <option value="">기본 바디 / 직접 입력</option>
                    {history
                      .filter((h) => h.path === "/api/dac/select/" + query)
                      .map((h) => (
                        <option key={h.id} value={h.id}>
                          {h.status} · {when(h.createdAt)} ·{" "}
                          {h.request?.lot_id || "전체"}
                        </option>
                      ))}
                  </select>
                </label>
              </>
            )}
          </div>
          {(kind === "api" || !runId) && (
            <label className="source-body">
              {kind === "api" ? "API 요청 바디" : "워크플로우 실행 입력"}
              <textarea
                aria-label={label + " 요청 바디"}
                spellCheck={false}
                disabled={locked || metaBusy}
                value={kind === "api" ? queryBody : body}
                onChange={(e) =>
                  kind === "api"
                    ? setQueryBody(e.target.value)
                    : setBody(e.target.value)
                }
              />
            </label>
          )}
          <div className="source-actions">
            <button
              className="primary"
              disabled={
                locked ||
                metaBusy ||
                (kind === "workflow"
                  ? !workflow || (!runId && !version)
                  : !query)
              }
              onClick={capture}
            >
              {busy ? progress : "데이터 불러오기"}
            </button>
            <small>
              최대 1만 행. 새 실행은 현재 데이터를 조회하며, 선택한 결과는 이후
              고정됩니다.
            </small>
          </div>
        </>
      )}
      {active && (
        <div className="source-active">
          <div>
            <Identity id={sourceIdentifier(active)} description={active.name} />
            <span>
              {fmt(active.row_count)}행 · {active.columns.length}컬럼 ·{" "}
              {when(active.created_at)}
            </span>
          </div>
          <code title={active.checksum}>snapshot_id · {active.id}</code>
          <div className="source-links">
            <a href={"#analysis?snapshot=" + active.id}>분석 열기 ↗</a>
            {active.kind === "workflow" && active.origin.version && <a href={"#engines?workflow=" + active.origin.workflowId + "&run=" + active.origin.runId}>Engine Benchmark ↗</a>}
          </div>
          <details>
            <summary>출처 · 컬럼 · 5행 미리보기</summary>
            <pre>
              {JSON.stringify(
                { origin: active.origin, columns: active.columns, preview },
                null,
                2,
              )}
            </pre>
          </details>
        </div>
      )}
    </section>
  );
}
