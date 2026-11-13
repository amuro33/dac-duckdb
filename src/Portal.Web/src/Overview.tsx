import { useEffect, useState } from "react";
import {
  ArrowUpRight,
  Database,
  Activity,
  Clock,
  Bookmark,
  RefreshCw,
} from "lucide-react";
import { data, json, fmt, when } from "./api";
import { PageHeading, ErrorBox, Loading, LinkButton } from "./ui";
import { large, initial, type Config, type View, type Run } from "./types";
export function Overview({
  navigate,
  analyze,
}: {
  navigate: (p: string) => void;
  analyze: (c: Config) => void;
}) {
  const [state, setState] = useState<any>();
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    setError("");
    Promise.all([
      data("/api/dac/summary", "GET", undefined, false, abort.signal),
      json("/api/workspace/metrics", { signal: abort.signal }),
      json("/api/workspace/health", { signal: abort.signal }),
      json<View[]>("/api/workspace/views", { signal: abort.signal }),
      json<Run[]>("/api/workspace/runs?limit=5", { signal: abort.signal }),
      data(
        "/api/dac/get_eds_data?limit=1000",
        "GET",
        undefined,
        false,
        abort.signal,
      ),
    ])
      .then(([summary, metrics, health, views, runs, eds]) =>
        setState({
          summary,
          metrics,
          health,
          views,
          runs,
          eds,
          time: new Date(),
        }),
      )
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      });
    return () => abort.abort();
  }, [refresh]);
  const bins = Array.from({ length: 10 }, (_, i) => ({
    label: `${80 + i * 2}–${82 + i * 2}`,
    count:
      state?.eds.filter(
        (e: any) =>
          e.yieldPct >= 80 + i * 2 &&
          (i === 9 ? e.yieldPct <= 100 : e.yieldPct < 82 + i * 2),
      ).length ?? 0,
  }));
  const max = Math.max(1, ...bins.map((b) => b.count));
  return (
    <>
      <PageHeading
        title="검사 데이터 개요"
        description="검사 데이터부터 결과 공유까지, 하나의 워크스페이스에서."
        actions={
          <button onClick={() => setRefresh((n) => n + 1)}>
            <RefreshCw size={14} />
            새로고침
          </button>
        }
      />
      <ErrorBox error={error} />
      {!state && !error ? (
        <Loading />
      ) : (
        state && (
          <>
            <div className="metrics">
              <div>
                <span>
                  <Database size={14} />
                  검사 웨이퍼
                </span>
                <strong>{fmt(state.summary.waferCount)}</strong>
                <small>기본 Oracle 데이터셋</small>
              </div>
              <div>
                <span>
                  <Activity size={14} />
                  평균 수율
                </span>
                <strong>
                  {fmt(state.summary.averageYield)}
                  <em>%</em>
                </strong>
                <small>기본 데이터의 웨이퍼 평균</small>
              </div>
              <div>
                <span>
                  <Clock size={14} />
                  실행 P95 · 24h
                </span>
                <strong>
                  {fmt(state.metrics.p95Ms)}
                  <em>ms</em>
                </strong>
                <small>
                  {fmt(state.metrics.runs)}회 실행 · 오류 {state.metrics.errors}
                  회
                </small>
              </div>
              <div>
                <span>
                  <Bookmark size={14} />
                  저장된 분석
                </span>
                <strong>{state.metrics.views}</strong>
                <small>PostgreSQL에 영구 보관</small>
              </div>
            </div>
            <div className="overview-grid">
              <section className="panel">
                <div className="panel-head">
                  <div>
                    <h2>수율 분포</h2>
                    <p>기본 검사 데이터 · 2% 구간</p>
                  </div>
                  <span className="pill">
                    {state.summary.waferCount} wafers
                  </span>
                </div>
                <div className="histogram">
                  {bins.map((b) => (
                    <div className="hist-bin" key={b.label}>
                      <span>{b.count}</span>
                      <div
                        style={{
                          height: `${Math.max(1, (b.count / max) * 130)}px`,
                        }}
                      />
                      <small>{b.label}</small>
                    </div>
                  ))}
                </div>
                <div className="panel-foot">
                  기본 EDS {state.summary.waferCount}행 기준
                  <LinkButton onClick={() => analyze(initial)}>
                    검사 데이터 분석
                  </LinkButton>
                </div>
              </section>
              <section className="panel status-panel">
                <div className="panel-head">
                  <div>
                    <h2>연결 상태</h2>
                    <p>의존 서비스를 실제 조회한 결과</p>
                  </div>
                  <span className="mono tiny">LIVE</span>
                </div>
                {state.health.services.map((s: any) => (
                  <div className="service" key={s.name}>
                    <span className={"dot " + (s.healthy ? "ok" : "bad")} />
                    <div>
                      <strong>
                        {s.name === "dac"
                          ? "Data service"
                          : s.name === "chart"
                            ? "Chart service"
                            : "Workspace storage"}
                      </strong>
                      <small>
                        {s.name === "dac"
                          ? "Oracle · DuckDB"
                          : s.name === "chart"
                            ? "Scatter · SVG / PNG"
                            : "PostgreSQL"}
                      </small>
                    </div>
                    <span className="mono">
                      {s.healthy ? `${s.latencyMs} ms` : "연결 오류"}
                    </span>
                  </div>
                ))}
                <p className="status-time">
                  마지막 확인 {state.time.toLocaleTimeString("ko-KR")}
                </p>
              </section>
            </div>
            <section className="launch-strip">
              <div>
                <h2>백만 행의 데이터에서 패턴 찾기</h2>
                <p>
                  실제 Oracle 테스트 테이블 · 선택 범위 전체 조회 · 10개 Lot
                </p>
              </div>
              <button className="primary" onClick={() => analyze(large)}>
                대용량 분석 열기
                <ArrowUpRight size={16} />
              </button>
            </section>
            <div className="overview-grid lower">
              <section className="panel">
                <div className="panel-head">
                  <h2>최근 저장한 뷰</h2>
                  <LinkButton onClick={() => navigate("views")}>
                    전체 보기
                  </LinkButton>
                </div>
                {state.views.length ? (
                  state.views.slice(0, 3).map((v: View) => (
                    <button
                      className="list-row"
                      key={v.id}
                      onClick={() => analyze(v.config)}
                    >
                      <span className="view-symbol">
                        <Bookmark size={17} />
                      </span>
                      <div>
                        <strong>{v.name}</strong>
                        <small>
                          {v.config.source.toUpperCase()} · {when(v.updatedAt)}
                        </small>
                      </div>
                      <ArrowUpRight size={15} />
                    </button>
                  ))
                ) : (
                  <div className="quiet-empty">
                    분석 설정을 저장하면 여기에 나타납니다.
                    <button
                      className="text-button"
                      onClick={() => analyze(initial)}
                    >
                      첫 분석 만들기 →
                    </button>
                  </div>
                )}
              </section>
              <section className="panel">
                <div className="panel-head">
                  <h2>최근 실행</h2>
                  <LinkButton onClick={() => navigate("activity")}>
                    실행 이력
                  </LinkButton>
                </div>
                {state.runs.length ? (
                  state.runs.slice(0, 3).map((r: Run) => (
                    <div className="list-row" key={r.id}>
                      <span
                        className={
                          "status-code " + (r.status >= 400 ? "bad" : "")
                        }
                      >
                        {r.status}
                      </span>
                      <div>
                        <strong className="mono">
                          {r.path.split("?")[0].split("/").pop()}
                        </strong>
                        <small>{when(r.createdAt)}</small>
                      </div>
                      <span className="mono">{fmt(r.durationMs)} ms</span>
                    </div>
                  ))
                ) : (
                  <div className="quiet-empty">
                    실행 이력이 아직 없습니다. 데이터 조회나 분석을 실행해
                    보세요.
                  </div>
                )}
              </section>
            </div>
          </>
        )
      )}
    </>
  );
}
