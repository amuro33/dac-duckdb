import { useEffect, useRef, useState } from "react";
import { data, fmt, csv, download } from "./api";
import { PageHeading, ErrorBox } from "./ui";
import { engineNames, type Engine, type Execution } from "./engines";
const engines: Engine[] = ["duckdb", "spark", "datafusion"];
type Run = {
  state: string;
  id?: string;
  execution?: Execution;
  rows?: number;
  error?: string;
};
const storageKey = "waferscope.engine-comparison.v1";
function restore() {
  try {
    const value = JSON.parse(sessionStorage.getItem(storageKey) ?? "null");
    if (
      !value ||
      typeof value.selected !== "string" ||
      !value.runs ||
      typeof value.runs !== "object"
    )
      return undefined;
    const runs: Record<string, Run> = {};
    for (const engine of engines) {
      const run = value.runs[engine];
      if (run && typeof run.state === "string")
        runs[engine] = {
          ...run,
          state:
            run.state === "완료" || run.state === "실패"
              ? run.state
              : run.id
                ? "상태 확인 필요"
                : "미실행",
        };
    }
    return {
      selected: value.selected,
      runs,
      order: Array.isArray(value.order) && value.order.length === 3 && new Set(value.order).size === 3 && value.order.every((e: Engine) => engines.includes(e)) ? value.order as Engine[] : engines,
      savedAt: typeof value.savedAt === "string" ? value.savedAt : "",
    };
  } catch {
    return undefined;
  }
}
export function EngineVs() {
  const [restored] = useState(restore);
  const [savedAt, setSavedAt] = useState(restored?.savedAt ?? "");
  const [datasets, setDatasets] = useState<any[]>([]),
    [selected, setSelected] = useState<string>(restored?.selected ?? "");
  const [runs, setRuns] = useState<Record<string, Run>>(restored?.runs ?? {}),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const cancel = useRef<AbortController | undefined>(undefined);
  const round = useRef(restored ? (engines.indexOf(restored.order[0]) + 1) % 3 : 0);
  const [order, setOrder] = useState<Engine[]>(restored?.order ?? engines);
  const update = (engine: Engine, run: Run) =>
    setRuns((old) => ({ ...old, [engine]: run }));
  useEffect(() => {
    try {
      sessionStorage.setItem(
        storageKey,
        JSON.stringify({ selected, runs, savedAt, order }),
      );
    } catch {
      /* The live result remains usable if browser storage is unavailable. */
    }
  }, [selected, runs, savedAt, order]);
  async function syncResults() {
    setError("");
    setBusy(true);
    try {
      await Promise.all(
        engines.map(async (engine) => {
          const run = runs[engine];
          if (!run?.id) return;
          const detail = await data(`/api/streams/datasets/${run.id}`);
          const result = detail.result[0];
          update(engine, {
            id: run.id,
            state:
              detail.dataset.status === "ready"
                ? "완료"
                : detail.dataset.status === "failed"
                  ? "실패"
                  : "서버 실행 중",
            execution: result?.execution,
            rows: result?.resultRows,
            error: result?.error,
          });
        }),
      );
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function refresh() {
    try {
      const result = await data("/api/streams/datasets");
      const ready = result.filter((d: any) => d.status === "ready");
      setDatasets(ready);
      setSelected((old) => old || ready[0]?.id || "");
    } catch (e: any) {
      setError(e.message);
    }
  }
  useEffect(() => {
    refresh();
    return () => cancel.current?.abort();
  }, []);
  async function compare() {
    const a = new AbortController();
    cancel.current = a;
    setBusy(true);
    setError("");
    setSavedAt(new Date().toISOString());
    const sequence = [
      ...engines.slice(round.current % 3),
      ...engines.slice(0, round.current % 3),
    ];
    round.current++;
    setOrder(sequence);
    setRuns(Object.fromEntries(engines.map((e) => [e, { state: "대기" }])));
    try {
      for (const engine of sequence) {
        if (a.signal.aborted) break;
        let id: string | undefined;
        try {
          update(engine, { state: "요청 중" });
          id = (
            await data(
              `/api/streams/datasets/${selected}/analyze`,
              "POST",
              { engine },
              true,
              a.signal,
            )
          ).id;
          const deadline = Date.now() + 25 * 60 * 1000;
          while (!a.signal.aborted) {
            const detail = await data(
              `/api/streams/datasets/${id}`,
              "GET",
              undefined,
              false,
              a.signal,
            );
            const d = detail.dataset;
            if (d.status === "failed")
              throw Error(detail.result[0]?.error ?? "실행 실패");
            if (d.status === "ready") {
              update(engine, {
                state: "완료",
                id,
                execution: detail.result[0]?.execution,
                rows: detail.result[0]?.resultRows,
              });
              break;
            }
            if (Date.now() > deadline)
              throw Error(
                "대기 시간 초과 · Data streams에서 작업을 확인하세요",
              );
            update(engine, {
              state: d.status === "processing" ? "실행 중" : "서버 대기",
              id,
            });
            await new Promise<void>((resolve) => {
              const finish = () => {
                clearTimeout(timer);
                a.signal.removeEventListener("abort", finish);
                resolve();
              };
              const timer = setTimeout(finish, 1000);
              a.signal.addEventListener("abort", finish, { once: true });
            });
          }
        } catch (e: any) {
          update(engine, {
            state: a.signal.aborted ? "대기 중단" : "실패",
            id,
            error: a.signal.aborted
              ? "서버에 접수된 작업은 계속됩니다."
              : e.message,
          });
        }
      }
    } finally {
      if (a.signal.aborted)
        setRuns((old) =>
          Object.fromEntries(
            Object.entries(old).map(([key, r]) => [
              key,
              r.state === "완료" || r.state === "실패"
                ? r
                : {
                    ...r,
                    state: r.id ? "대기 중단" : "미실행",
                    error: r.id
                      ? "서버 작업은 계속됩니다. 결과 상태 갱신으로 확인하세요."
                      : undefined,
                  },
            ]),
          ),
        );
      setBusy(false);
    }
  }
  const complete = engines.every(
    (e) => runs[e]?.state === "완료" && runs[e]?.execution,
  );
  const sameRows =
    complete &&
    engines.every((e) => runs[e].rows != null) &&
    new Set(engines.map((e) => runs[e].rows)).size === 1;
  const best = complete
    ? Math.min(...engines.map((e) => runs[e].execution!.totalMs))
    : 0;
  const source = datasets.find((d) => d.id === selected);
  const drill = `http://${location.hostname}:8047`;
  return (
    <>
      <PageHeading
          title="DuckDB vs Spark vs DataFusion"
        description="같은 원본 스냅샷과 변환 조건으로 세 엔진의 실제 처리 시간을 비교합니다."
        actions={
          <button disabled={busy} onClick={refresh}>
            원본 새로고침
          </button>
        }
      />
      <ErrorBox error={error} />
      {Object.keys(runs).length > 0 && (
        <section className="panel vs-source">
          <strong>
            최근 비교 {savedAt ? new Date(savedAt).toLocaleString("ko-KR") : ""}
          </strong>
          <p>
            이 브라우저 탭의 비교 결과를 복원합니다. 서버에 접수된 작업은 화면을
            닫아도 계속됩니다.
          </p>
          <button disabled={busy} onClick={syncResults}>
            결과 상태 갱신
          </button>
          <button
            disabled={busy || !engines.some((e) => runs[e]?.execution)}
            onClick={() =>
              download(
                new Blob(
                  [
                    csv(
                      engines
                        .filter((e) => runs[e]?.execution)
                        .map((e) => ({
                          engine: engineNames[e],
                          sourceDatasetId: selected,
                          resultDatasetId: runs[e].id,
                          startedAt: savedAt,
                          state: runs[e].state,
                          rows: runs[e].rows,
                          preparationMs: runs[e].execution!.preparationMs,
                          engineMs: runs[e].execution!.engineMs,
                          totalMs: runs[e].execution!.totalMs,
                        })),
                    ),
                  ],
                  { type: "text/csv;charset=utf-8" },
                ),
                "engine-comparison.csv",
              )
            }
          >
            비교 결과 CSV
          </button>
        </section>
      )}
      <section className="panel vs-source">
        <label>
          비교할 원본 스냅샷
          <select
            aria-label="비교 원본"
            value={selected}
            disabled={busy}
            onChange={(e) => {
              setSelected(e.target.value);
              setRuns({});
            }}
          >
            {selected && !datasets.some((d) => d.id === selected) && (
              <option value={selected}>
                저장된 원본 · {selected.slice(0, 8)}
              </option>
            )}
            {datasets.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name ?? d.id.slice(0, 8)} · {d.config?.operation} ·{" "}
                {fmt(d.resultRows)} 결과 행 · {d.id.slice(0, 8)}
              </option>
            ))}
          </select>
        </label>
        {!selected && (
          <p>
            완료된 데이터셋이 필요합니다.{" "}
            <a href="#streams">Data streams에서 수집하기</a>
          </p>
        )}
        {source && (
          <details>
            <summary>공통 입력과 변환 조건 확인</summary>
            <pre>
              {JSON.stringify(
                {
                  inputDatasetId: source.inputDatasetId ?? source.id,
                  ...source.config,
                  engine: undefined,
                },
                null,
                2,
              )}
            </pre>
          </details>
        )}
        <button
          className="primary"
          disabled={busy || !selected}
          onClick={compare}
        >
          3개 엔진 비교 실행
        </button>
        {busy && (
          <button onClick={() => cancel.current?.abort()}>대기 중단</button>
        )}
        <p className="mapping-note">
          동일 서버의 자원 경합을 줄이기 위해 순차 실행합니다. 실행 순서:{" "}
          {order.map((e) => engineNames[e]).join(" → ")}. 다음 비교에서는 순서를
          바꿉니다.
        </p>
      </section>
      <div className="vs-grid">
        {engines.map((engine) => {
          const r = runs[engine];
          const timing = r?.execution;
          return (
            <section className="panel vs-card" key={engine}>
              <div className="eyebrow">{r?.state ?? "준비"}</div>
              <h2>{engineNames[engine]}</h2>
              <div className="vs-time">
                {timing ? (timing.totalMs / 1000).toFixed(3) : "—"}{" "}
                <small>초</small>
              </div>
              <p>총 처리 시간</p>
              <dl>
                <dt>입력 준비</dt>
                <dd>
                  {timing ? fmt(Math.round(timing.preparationMs)) + " ms" : "—"}
                </dd>
                <dt>엔진 실행·결과 생성</dt>
                <dd>
                  {timing ? fmt(Math.round(timing.engineMs)) + " ms" : "—"}
                </dd>
                <dt>전송·조정</dt>
                <dd>
                  {timing
                    ? fmt(
                        Math.round(
                          Math.max(
                            0,
                            timing.totalMs -
                              timing.preparationMs -
                              timing.engineMs,
                          ),
                        ),
                      ) + " ms"
                    : "—"}
                </dd>
                <dt>결과 행</dt>
                <dd>{r?.rows == null ? "—" : fmt(r.rows)}</dd>
              </dl>
              {complete && (
                <p className="notice">
                  {timing!.totalMs === best
                    ? "이번 비교 최단 시간"
                    : `최단 시간 대비 ${(timing!.totalMs / Math.max(best, 0.001)).toFixed(2)}배`}
                </p>
              )}
              {r?.error && <ErrorBox error={r.error} />}
              {r?.id && r.state === "완료" && (
                <a href={`#analysis?dataset=${r.id}`}>
                  결과 데이터 분석 열기 ↗
                </a>
              )}
              {timing?.details && (
                <details>
                  <summary>실행 계획·환경</summary>
                  <pre>{JSON.stringify(timing.details, null, 2)}</pre>
                </details>
              )}
            </section>
          );
        })}
      </div>
      {complete && (
        <p className="notice">
          {sameRows
            ? "세 엔진의 결과 행 수가 같습니다. 값 전체의 동일성 검증은 별도입니다."
            : "결과 행 수가 다릅니다. 변환 결과를 확인하세요."}
        </p>
      )}
      <p className="mapping-note">
        측정 범위: 입력 준비부터 결과 저장까지. Kafka 최초 수집과 서버 대기
        시간은 제외합니다. Spark는 같은 물리 서버의 워커 2개이며 최초 세션
        기동·캐시 상태가 결과에 영향을 줍니다. 엔진별 입력 변환·전송 비용도 총
        시간에 포함됩니다.
      </p>
      <section className="panel vs-source">
        <h2>Apache Drill · 자체 웹 콘솔</h2>
        <p>SQL Query, Storage, Profiles를 Drill의 원래 화면에서 사용합니다.</p>
        <a
          className="text-button"
          href={drill}
          target="_blank"
          rel="noreferrer"
        >
          Drill 웹 콘솔 열기 ↗
        </a>
      </section>
    </>
  );
}
