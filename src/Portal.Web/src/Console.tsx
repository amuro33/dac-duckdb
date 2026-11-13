import { useEffect, useRef, useState } from "react";
import { Play, Copy, Check, Terminal } from "lucide-react";
import { execute, fmt } from "./api";
import { PageHeading, ErrorBox } from "./ui";
import { initial } from "./types";
export type ConsoleRequest = { path: string; method: string; body?: unknown };
const presets: { name: string; request: ConsoleRequest }[] = [
  {
    name: "EDS 검사 조회",
    request: { method: "GET", path: "/api/dac/get_eds_data?limit=100" },
  },
  {
    name: "결함 조회",
    request: { method: "GET", path: "/api/dac/get_defect_data?limit=100" },
  },
  { name: "Lot 목록", request: { method: "GET", path: "/api/dac/lots" } },
  {
    name: "DuckDB · Left join",
    request: {
      method: "POST",
      path: "/api/dac/transform",
      body: {
        operation: "join",
        joinType: "left",
        lotId: "LOT-101",
        limit: 1000,
      },
    },
  },
  {
    name: "DuckDB · Merge",
    request: {
      method: "POST",
      path: "/api/dac/transform",
      body: { operation: "merge", lotId: "LOT-101", limit: 1000 },
    },
  },
  {
    name: "DuckDB · Filter",
    request: {
      method: "POST",
      path: "/api/dac/transform",
      body: {
        operation: "filter",
        joinType: "inner",
        lotId: "LOT-101",
        minYield: 94,
        severity: "HIGH",
        limit: 1000,
      },
    },
  },
  {
    name: "차트 데이터 변환",
    request: { method: "POST", path: "/api/chart/scatter", body: initial },
  },
  {
    name: "백만 행 테이블 · 첫 100행",
    request: {
      method: "GET",
      path: "/api/dac/chart_samples?source=eds&size=1000000&limit=100",
    },
  },
];
export function Console({ start }: { start?: ConsoleRequest }) {
  const [req, setReq] = useState(start ?? presets[0].request),
    [body, setBody] = useState(JSON.stringify(start?.body ?? {}, null, 2)),
    [busy, setBusy] = useState(false),
    [result, setResult] = useState<any>(),
    [error, setError] = useState(""),
    [copied, setCopied] = useState(false),
    [responseTab, setResponseTab] = useState("json");
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  function select(r: ConsoleRequest) {
    setReq(r);
    setBody(JSON.stringify(r.body ?? {}, null, 2));
    setError("");
  }
  async function send() {
    setError("");
    let parsed;
    try {
      if (req.method === "POST") parsed = JSON.parse(body);
    } catch {
      setError("JSON 문법을 확인해 주세요.");
      return;
    }
    abort.current?.abort();
    const a = new AbortController();
    abort.current = a;
    setBusy(true);
    try {
      setResult(await execute(req.path, req.method, parsed, true, a.signal));
    } catch (e: any) {
      if (!a.signal.aborted) setError(e.message);
    } finally {
      setBusy(false);
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
        title="API 요청"
        description="등록된 API만 실행할 수 있습니다. 실행 결과는 이력에 기록됩니다."
      />
      <div className="console-layout">
        <aside className="request-list">
          <h3>COLLECTION</h3>
          {presets.map((p) => (
            <button
              className={req.path === p.request.path ? "selected" : ""}
              key={p.name}
              onClick={() => select(p.request)}
            >
              <span className={p.request.method === "GET" ? "get" : "post"}>
                {p.request.method}
              </span>
              {p.name}
            </button>
          ))}
          <p>
            ⌘ / Ctrl + Enter
            <br />
            요청 편집기에서 실행
          </p>
        </aside>
        <div className="console-work">
          <div className="request-bar">
            <select
              aria-label="HTTP 메서드"
              value={req.method}
              onChange={(e) => setReq({ ...req, method: e.target.value })}
            >
              <option>GET</option>
              <option>POST</option>
            </select>
            <input
              aria-label="API 경로"
              value={req.path}
              onChange={(e) => setReq({ ...req, path: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") send();
              }}
            />
            <button className="primary" disabled={busy} onClick={send}>
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
          {req.method === "POST" && (
            <div className="request-body">
              <div>
                REQUEST BODY <span>application/json</span>
              </div>
              <textarea
                spellCheck={false}
                aria-label="JSON 요청 본문"
                value={body}
                onChange={(e) => setBody(e.target.value)}
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
              <p>왼쪽 프리셋을 선택하거나 경로와 본문을 수정할 수 있습니다.</p>
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
        </div>
      </div>
    </>
  );
}
