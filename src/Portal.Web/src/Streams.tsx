import { useEffect, useState } from "react";
import { Play, Pause, RefreshCw, ArrowUpRight, Radio } from "lucide-react";
import { data, fmt } from "./api";
import { PageHeading, ErrorBox, Empty, Modal } from "./ui";
import type { Config } from "./types";
type Feed = {
  id: string;
  name: string;
  enabled: boolean;
  runs: number;
  config: {
    sampleSize: number | null;
    intervalSeconds: number;
    operation: string;
  };
  lastError?: string;
};
type Dataset = {
  id: string;
  feedId: string;
  name: string;
  status: string;
  createdAt: string;
  resultRows: number | null;
  transformMs: number | null;
  error?: string;
};
const statuses: Record<string, string> = {
  publishing: "발행 중",
  published: "수신 대기",
  processing: "변환 중",
  ready: "완료",
  failed: "실패",
};
export function Streams({ analyze }: { analyze: (c: Config) => void }) {
  const [feeds, setFeeds] = useState<Feed[]>([]),
    [datasets, setDatasets] = useState<Dataset[]>([]),
    [status, setStatus] = useState<any>(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [selected, setSelected] = useState<string>(),
    [detail, setDetail] = useState<any>();
  const [name, setName] = useState("EDS · Defect 주기 분석"),
    [size, setSize] = useState("1000"),
    [interval, setInterval] = useState(60),
    [operation, setOperation] = useState("join"),
    [joinType, setJoinType] = useState("left"),
    [minYield, setMinYield] = useState(""),
    [severity, setSeverity] = useState("");
  async function refresh(signal?: AbortSignal) {
    const [f, d, s] = await Promise.all([
      data("/api/streams/feeds", "GET", undefined, false, signal),
      data("/api/streams/datasets", "GET", undefined, false, signal),
      data("/api/streams/status", "GET", undefined, false, signal),
    ]);
    setFeeds(f);
    setDatasets(d);
    setStatus(s);
  }
  useEffect(() => {
    const a = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        await refresh(a.signal);
      } catch (e: any) {
        if (!a.signal.aborted) setError(e.message);
      } finally {
        if (!a.signal.aborted) timer = setTimeout(tick, 3000);
      }
    };
    tick();
    return () => {
      a.abort();
      clearTimeout(timer);
    };
  }, []);
  useEffect(() => {
    setDetail(undefined);
    if (!selected) return;
    const a = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        setDetail(
          await data(
            "/api/streams/datasets/" + selected,
            "GET",
            undefined,
            false,
            a.signal,
          ),
        );
      } catch (e: any) {
        if (!a.signal.aborted) setError(e.message);
      } finally {
        if (!a.signal.aborted) timer = setTimeout(tick, 2000);
      }
    };
    tick();
    return () => {
      a.abort();
      clearTimeout(timer);
    };
  }, [selected]);
  async function mutate(path: string, body?: unknown) {
    setBusy(true);
    setError("");
    try {
      await data(path, "POST", body ?? {}, true);
      await refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const open = (id: string) =>
    analyze({
      source: "transformed",
      datasetId: id,
      category: "lot_id",
      legend: "product",
      x: "inspected_at",
      y: "yield_pct",
      xType: "date",
      lotId: null,
      sampleSize: null,
    });
  return (
    <>
      <PageHeading
        eyebrow="DATA PIPELINE"
        title="데이터 스트림"
        description="Oracle 원본을 Kafka로 전달하고, 독립된 두 서비스가 구독합니다. 완료된 변환 결과를 차트에서 열 수 있습니다."
        actions={
          <button
            disabled={busy}
            onClick={() => refresh().catch((e) => setError(e.message))}
          >
            <RefreshCw size={14} />
            새로고침
          </button>
        }
      />
      <ErrorBox error={error} />
      {status?.kafka&&!status.kafka.connected&&<ErrorBox error="Kafka에 연결하지 못했습니다. 발행·수신은 복구 후 재개됩니다."/>}
      <div className="stream-flow">
        <span>Oracle · DAC</span>
        <i>→</i>
        <span>
          <Radio size={14} />
          Kafka · 실제 레코드
        </span>
        <i>→</i>
        <span>DuckDB 변환 / 독립 수신 검증</span>
        <i>→</i>
        <span>저장된 결과 · 차트</span>
      </div>
      <div className="stream-service-grid">
        {(status?.services ?? []).map((s: any) => (
          <div className="panel" key={s.role}>
            <span
              className={
                "dot " +
                (!s.error && Date.now() - Date.parse(s.updatedAt) < 30000
                  ? "ok"
                  : "warn")
              }
            />
            <strong>{s.role}</strong>
            <small>{new Date(s.updatedAt).toLocaleTimeString()} 확인</small>
          </div>
        ))}
      </div>
      <section className="panel stream-create">
        <div className="panel-heading">
          <h3>새 데이터 발행</h3>
          <span className="muted">주기적 전체 스냅샷 · 샘플링 없음</span>
        </div>
        <div className="stream-fields">
          <label>
            이름
            <input
              aria-label="스트림 이름"
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            원본 규모
            <select
              aria-label="스트림 원본 규모"
              value={size}
              onChange={(e) => setSize(e.target.value)}
            >
              <option value="base">기본 EDS / 결함</option>
              {[1000, 10000, 100000, 1000000].map((n) => (
                <option value={n} key={n}>
                  {fmt(n)}행씩 · EDS + 결함
                </option>
              ))}
            </select>
          </label>
          <label>
            발행 간격 · 초
            <input
              aria-label="발행 간격"
              type="number"
              min={10}
              max={86400}
              value={interval}
              onChange={(e) => setInterval(Number(e.target.value))}
            />
          </label>
          <label>
            변환
            <select
              aria-label="스트림 변환"
              value={operation}
              onChange={(e) => setOperation(e.target.value)}
            >
              <option value="join">Join · 가로 연결</option>
              <option value="merge">Merge · 세로 결합</option>
              <option value="filter">Filter · 조인 후 필터</option>
            </select>
          </label>
          <label>
            조인 방식
            <select
              aria-label="스트림 조인 방식"
              disabled={operation === "merge"}
              value={joinType}
              onChange={(e) => setJoinType(e.target.value)}
            >
              <option value="left">Left</option>
              <option value="inner">Inner</option>
              <option value="full">Full</option>
            </select>
          </label>
          <label>
            최소 수율
            <input
              aria-label="스트림 최소 수율"
              type="number"
              min={0}
              max={100}
              placeholder="전체"
              value={minYield}
              onChange={(e) => setMinYield(e.target.value)}
            />
          </label>
          <label>
            심각도
            <select
              aria-label="스트림 심각도"
              value={severity}
              onChange={(e) => setSeverity(e.target.value)}
            >
              <option value="">전체</option>
              {["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
          <button
            className="primary"
            disabled={busy || !name.trim() || interval < 10 || interval > 86400}
            onClick={() =>
              mutate("/api/streams/feeds", {
                name,
                sampleSize: size === "base" ? null : Number(size),
                intervalSeconds: interval,
                operation,
                joinType,
                minYield: minYield === "" ? null : Number(minYield),
                severity: severity || null,
                enabled: true,
              })
            }
          >
            <Play size={14} />
            발행 시작
          </button>
        </div>
        <p className="muted">
          중지하면 진행 중인 스냅샷은 완료하고 다음 발행부터 멈춥니다. 합성
          원본을 반복 발행하는 모드이며 변경분 수집(CDC)은 아닙니다.
        </p>
      </section>
      <section className="panel stream-section">
        <h3>
          등록된 스트림 <small>{feeds.length}</small>
        </h3>
        {!feeds.length ? (
          <Empty
            title="등록된 스트림이 없습니다"
            description="위에서 원본과 변환 조건을 선택해 발행을 시작하세요."
          />
        ) : (
          <div className="stream-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>이름</th>
                  <th>규모 / 주기</th>
                  <th>발행 완료</th>
                  <th>상태</th>
                  <th>제어</th>
                </tr>
              </thead>
              <tbody>
                {feeds.map((f) => (
                  <tr key={f.id}>
                    <td>
                      <strong>{f.name}</strong>
                      {f.lastError && (
                        <small className="stream-error">{f.lastError}</small>
                      )}
                    </td>
                    <td>
                      {f.config.sampleSize
                        ? fmt(f.config.sampleSize)
                        : "기본 원본"}{" "}
                      · {f.config.intervalSeconds}초
                    </td>
                    <td>{fmt(f.runs)}회</td>
                    <td>{f.enabled ? "발행 예약" : "중지됨"}</td>
                    <td>
                      <button
                        disabled={busy}
                        aria-label={`${f.name} ${f.enabled ? "중지" : "시작"}`}
                        onClick={() =>
                          mutate(
                            `/api/streams/feeds/${f.id}/${f.enabled ? "stop" : "start"}`,
                          )
                        }
                      >
                        {f.enabled ? <Pause size={12} /> : <Play size={12} />}{" "}
                        {f.enabled ? "중지" : "시작"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <div className="stream-consumers">
        {(status?.consumers ?? []).map((c: any) => (
          <div key={c.consumerGroup}>
            <small>{c.consumerGroup}</small>
            <strong>{fmt(c.rows)}행</strong>
            <span>{fmt(c.batches)}개 배치 영속 수신</span>
          </div>
        ))}
      </div>
      <section className="panel stream-section">
        <h3>
          데이터셋 처리 이력 <small>최근 100개</small>
        </h3>
        {!datasets.length ? (
          <Empty
            title="아직 수신한 데이터가 없습니다"
            description="발행이 시작되면 데이터셋별 수신과 변환 상태가 표시됩니다."
          />
        ) : (
          <div className="stream-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>데이터셋</th>
                  <th>상태</th>
                  <th>변환 결과</th>
                  <th>처리 시간</th>
                  <th>결과</th>
                </tr>
              </thead>
              <tbody>
                {datasets.map((d) => (
                  <tr key={d.id} data-dataset-id={d.id} data-status={d.status}>
                    <td>
                      <strong>{d.name}</strong>
                      <small>
                        {d.id.slice(0, 8)} ·{" "}
                        {new Date(d.createdAt).toLocaleString()}
                      </small>
                      {d.error && (
                        <small className="stream-error">{d.error}</small>
                      )}
                    </td>
                    <td>
                      <span className={"stream-state " + d.status}>
                        {statuses[d.status] ?? d.status}
                      </span>
                    </td>
                    <td>{fmt(d.resultRows)}행</td>
                    <td>
                      {d.transformMs == null
                        ? "—"
                        : `${fmt(Math.round(d.transformMs))} ms`}
                    </td>
                    <td>
                      <div className="stream-actions">
                        <button onClick={() => setSelected(d.id)}>
                          수신 상세
                        </button>
                        {d.status === "ready" && (
                          <button onClick={() => open(d.id)}>
                            차트 열기 <ArrowUpRight size={12} />
                          </button>
                        )}
                        {d.status === "failed" && (
                          <button
                            disabled={busy}
                            onClick={() =>
                              mutate(`/api/streams/datasets/${d.id}/retry`)
                            }
                          >
                            변환 재시도
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {(status?.quarantine ?? []).some((q: any) => q.records > 0) && (
        <div className="notice">
          검증 실패로 격리된 메시지가 있습니다. 데이터셋 오류와 stream_failures
          기록을 확인하세요.
        </div>
      )}
      {selected && (
        <Modal
          title="데이터셋 수신 상세"
          onClose={() => setSelected(undefined)}
        >
          <p className="muted">{selected}</p>
          <p>
            EDS와 결함의 모든 배치가 도착한 뒤 변환합니다. 두 소비자 그룹은 각각
            같은 원본 전체를 받습니다.
          </p>
          {detail ? (
            <div className="stream-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>소비자 / 원본</th>
                    <th>행 수</th>
                    <th>배치</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.consumers.map((c: any) => (
                    <tr key={c.consumerGroup + c.source}>
                      <td>
                        {c.consumerGroup}
                        <small>{c.source}</small>
                      </td>
                      <td>
                        {fmt(c.receivedRows)} / {fmt(c.expectedRows)}
                      </td>
                      <td>
                        {fmt(c.batches)} / {fmt(c.expectedBatches)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p>조회 중…</p>
          )}
        </Modal>
      )}
    </>
  );
}
