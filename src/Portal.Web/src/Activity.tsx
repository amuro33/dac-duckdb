import { useEffect, useState } from "react";
import { RefreshCw, Search, RotateCcw } from "lucide-react";
import { json, fmt, when } from "./api";
import { PageHeading, ErrorBox, Empty, Modal, Loading } from "./ui";
import type { Run } from "./types";
export function Activity({ replay }: { replay: (r: Run) => void }) {
  const [runs, setRuns] = useState<Run[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all"),
    [selected, setSelected] = useState<Run>();
  async function load() {
    setBusy(true);
    try {
      setRuns(await json("/api/workspace/runs?limit=200"));
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
  const filtered = runs.filter(
    (r) =>
      (r.path + " " + JSON.stringify(r.request ?? {}))
        .toLowerCase()
        .includes(search.toLowerCase()) &&
      (filter === "all" ||
        (filter === "errors" ? r.status >= 400 : r.status < 400)),
  );
  return (
    <>
      <PageHeading
        title="실행 이력"
        description="최근 200회 실행 · 요청 설정, 상태, 서버 응답 시간. 결과 데이터는 저장하지 않습니다."
        actions={
          <button onClick={load}>
            <RefreshCw size={14} />
            새로고침
          </button>
        }
      />
      <ErrorBox error={error} />
      <section className="panel">
        <div className="table-tools">
          <div className="segmented">
            {[
              ["all", "전체"],
              ["success", "성공"],
              ["errors", "오류"],
            ].map(([k, v]) => (
              <button
                key={k}
                className={filter === k ? "active" : ""}
                onClick={() => setFilter(k)}
              >
                {v}
              </button>
            ))}
          </div>
          <label className="search-input">
            <Search size={14} />
            <input
              aria-label="실행 경로 검색"
              placeholder="query_id · DB · 바인딩 값 검색"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
        </div>
        {busy ? (
          <Loading />
        ) : !filtered.length ? (
          <Empty
            title="실행 이력이 없습니다"
            description="API 콘솔이나 분석 스튜디오에서 실행한 요청이 여기에 기록됩니다."
          />
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>상태</th>
                  <th>요청</th>
                  <th>응답 시간</th>
                  <th>결과 행 / 포인트</th>
                  <th>실행 시각</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <span
                        className={
                          "status-code " + (r.status >= 400 ? "bad" : "")
                        }
                      >
                        {r.status}
                      </span>
                    </td>
                    <td>
                      <button
                        className="request-link"
                        onClick={() => setSelected(r)}
                      >
                        <span>{r.method}</span>
                        {r.path.split("?")[0]}
                      </button>
                    </td>
                    <td className="numeric">{fmt(r.durationMs)} ms</td>
                    <td className="numeric">{fmt(r.rowCount)}</td>
                    <td>{when(r.createdAt)}</td>
                    <td>
                      <button
                        className="icon-button"
                        aria-label="요청 다시 열기"
                        onClick={() => replay(r)}
                      >
                        <RotateCcw size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {selected && (
        <Modal title="실행 상세" onClose={() => setSelected(undefined)}>
          <p className="mono tiny">{selected.id}</p>
          <dl className="details">
            <dt>Path</dt>
            <dd>{selected.path}</dd>
            {selected.queryVersion != null && (
              <>
                <dt>SQL 버전</dt>
                <dd>{selected.queryVersion}</dd>
              </>
            )}
            <dt>Status</dt>
            <dd>{selected.status}</dd>
            <dt>Latency</dt>
            <dd>{selected.durationMs} ms</dd>
          </dl>
          <pre>{JSON.stringify(selected.request ?? {}, null, 2)}</pre>
          <div className="modal-actions">
            <button className="primary" onClick={() => replay(selected)}>
              설정으로 다시 열기
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
