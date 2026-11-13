import { useCallback, useEffect, useRef, useState } from "react";
import {
  Play,
  Save,
  Download,
  RotateCcw,
  SlidersHorizontal,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  X,
  Info,
} from "lucide-react";
import { data, execute, json, download, csv, fmt } from "./api";
import { PageHeading, ErrorBox, Empty, Loading, Modal } from "./ui";
import { Chart } from "./Chart";
import {
  canReuseAppearance,
  summarizeRender,
  duration,
  type RenderBatch,
  type RenderMeasure,
} from "./chartPerformance";
import {
  initial,
  type Config,
  type Spec,
  type Column,
  type Panel,
} from "./types";
export function Analysis({
  start,
  notify,
}: {
  start: Config;
  notify: (s: string) => void;
}) {
  const [draft, setDraft] = useState<Config>(start),
    [applied, setApplied] = useState<Config>(),
    [columns, setColumns] = useState<Column[]>([]),
    [spec, setSpec] = useState<Spec>(),
    [busy, setBusy] = useState(false),
    [metaBusy, setMetaBusy] = useState(false),
    [error, setError] = useState(""),
    [ms, setMs] = useState(0),
    [page, setPage] = useState(0),
    [tab, setTab] = useState("charts"),
    [point, setPoint] = useState<any>(),
    [expanded, setExpanded] = useState<Panel>(),
    [save, setSave] = useState(false),
    [saveName, setSaveName] = useState(""),
    [saveDescription, setSaveDescription] = useState(""),
    [saving, setSaving] = useState(false),
    [saveError, setSaveError] = useState(""),
    [exportBusy, setExportBusy] = useState(false);
  const [batch, setBatch] = useState<RenderBatch>({
    id: 0,
    kind: "query",
    actionStartedAt: 0,
    renderStartedAt: 0,
    receiveMs: null,
  });
  const activeBatch = useRef(batch);
  const [metrics, setMetrics] = useState<Record<string, RenderMeasure>>({});
  function beginBatch(
    kind: RenderBatch["kind"],
    actionStartedAt = performance.now(),
    receiveMs: number | null = null,
  ) {
    const next = {
      id: activeBatch.current.id + 1,
      kind,
      actionStartedAt,
      renderStartedAt: performance.now(),
      receiveMs,
    };
    activeBatch.current = next;
    setBatch(next);
    setMetrics({});
  }
  const onRendered = useCallback((m: RenderMeasure) => {
    if (m.batchId === activeBatch.current.id)
      setMetrics((old) => ({ ...old, [m.key]: m }));
  }, []);
  const visible = spec?.charts.slice(page * 4, page * 4 + 4) ?? [];
  const timing = summarizeRender(
    batch,
    metrics,
    visible.map((c) => c.key),
  );
  const visiblePoints = visible.reduce(
    (n, c) => n + c.series.reduce((m, s) => m + s.points.length, 0),
    0,
  );
  function changePage(next: number) {
    beginBatch("page");
    setPage(next);
    setPoint(undefined);
  }
  const abort = useRef<AbortController | null>(null);
  const initialRun = useRef(true);
  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    const a = new AbortController();
    setMetaBusy(true);
    const q = new URLSearchParams({ source: draft.source });
    if (draft.datasetId) q.set("datasetId", draft.datasetId);
    if (draft.sampleSize) q.set("sampleSize", String(draft.sampleSize));
    data("/api/chart/columns?" + q, "GET", undefined, false, a.signal)
      .then((r) => {
        setColumns(r.columns);
        if (initialRun.current) {
          initialRun.current = false;
          run(start);
        }
      })
      .catch((e) => {
        if (!a.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!a.signal.aborted) setMetaBusy(false);
      });
    return () => a.abort();
  }, [draft.source, draft.sampleSize, draft.datasetId]);
  async function run(config = draft) {
    const actionStartedAt = performance.now();
    abort.current?.abort();
    if (spec && applied && canReuseAppearance(applied, config)) {
      beginBatch("appearance", actionStartedAt);
      setSpec({
        ...spec,
        pointSize: config.pointSize ?? null,
        labelFontSize: config.labelFontSize ?? 11,
      });
      setApplied({ ...config });
      setError("");
      setTab("charts");
      setExpanded(undefined);
      setBusy(false);
      return;
    }
    const a = new AbortController();
    abort.current = a;
    setBusy(true);
    setError("");
    try {
      const r = await execute(
        "/api/chart/scatter",
        "POST",
        config,
        true,
        a.signal,
      );
      if (a.signal.aborted) return;
      if (r.status >= 400) throw Error(r.data?.detail ?? "분석 실패");
      beginBatch("query", actionStartedAt, performance.now() - actionStartedAt);
      setTab("charts");
      setExpanded(undefined);
      setSpec(r.data);
      setApplied({ ...config });
      setMs(r.durationMs);
      setPage(0);
      setPoint(undefined);
    } catch (e: any) {
      if (!a.signal.aborted) setError(e.message);
    } finally {
      if (abort.current === a) setBusy(false);
    }
  }
  function chooseSource(source: string, sampleSize = draft.sampleSize) {
    const joined = source === "joined";
    setDraft({
      ...draft,
      source,
      datasetId: null,
      sampleSize,
      lotId: null,
      category: joined ? "lot_id" : "lotId",
      legend: source === "defects" ? "severity" : "product",
      x: joined ? "inspected_at" : "inspectedAt",
      xType: "date",
      labelColumn: null,
      y: source === "eds" ? "yieldPct" : joined ? "yield_pct" : "defectCount",
    });
  }
  const dirty = !!applied && JSON.stringify(applied) !== JSON.stringify(draft);
  async function exportFile(format: string, index = 0) {
    if (!applied) return;
    setExportBusy(true);
    try {
      const r = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: applied, format, categoryIndex: index }),
        signal: AbortSignal.timeout(240000),
      });
      if (!r.ok) {
        const d = await r.json();
        throw Error(d.detail ?? "내보내기 실패");
      }
      download(await r.blob(), `waferscope-${index + 1}.${format}`);
      notify(`${format.toUpperCase()} 파일을 저장했습니다.`);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setExportBusy(false);
    }
  }
  async function saveView() {
    if (!applied) return;
    setSaving(true);
    setSaveError("");
    try {
      await json("/api/workspace/views", {
        method: "POST",
        body: JSON.stringify({
          name: saveName,
          description: saveDescription,
          config: applied,
          pinned: false,
        }),
      });
      setSave(false);
      notify("분석 뷰를 PostgreSQL에 저장했습니다.");
    } catch (e: any) {
      setSaveError(e.message);
    } finally {
      setSaving(false);
    }
  }
  const select = (
    field: keyof Config,
    label: string,
    none = false,
    numeric = false,
  ) => (
    <label>
      {label}
      <select
        aria-label={label}
        value={String(draft[field] ?? "")}
        disabled={metaBusy}
        onChange={(e) =>
          setDraft({ ...draft, [field]: e.target.value || null })
        }
      >
        {none && <option value="">선택 안 함</option>}
        {columns
          .filter((c) => !numeric || c.type === "number")
          .map((c) => (
            <option key={c.name} value={c.name}>
              {c.name} · {c.type}
            </option>
          ))}
      </select>
    </label>
  );
  return (
    <>
      <PageHeading
        eyebrow="ANALYSIS STUDIO"
        title="웨이퍼 분석"
        description="컬럼을 선택하고 분석을 실행하세요. 설정과 결과를 명확히 구분합니다."
        actions={
          <>
            <button
              disabled={!spec || exportBusy}
              onClick={() => exportFile("html")}
            >
              <Download size={14} />
              HTML
            </button>
            <button
              disabled={!applied || busy}
              onClick={() => {
                setSaveName(
                  `${applied?.source.toUpperCase()} · ${applied?.category ?? "전체"} 분석`,
                );
                setSaveError("");
                setSave(true);
              }}
            >
              <Save size={14} />뷰 저장
            </button>
          </>
        }
      />
      <div className="studio">
        <aside className="mapping-panel">
          <div className="mapping-title">
            <SlidersHorizontal size={15} />
            분석 설정
            <span className={"config-state " + (dirty ? "dirty" : "")}>
              {dirty ? "변경됨" : "적용됨"}
            </span>
          </div>
          <label>
            데이터 소스
            <select
              aria-label="데이터 소스"
              value={draft.source}
              onChange={(e) => chooseSource(e.target.value)}
            >
              <option value="eds">EDS 검사</option>
              <option value="defects">결함 이력</option>
              <option value="joined">EDS × Defect</option>
              {draft.source === "transformed" && (
                <option value="transformed">Kafka · 변환 결과</option>
              )}
            </select>
          </label>
          <label>
            데이터 규모
            <select
              aria-label="데이터 규모"
              disabled={draft.source === "transformed"}
              value={draft.sampleSize ?? ""}
              onChange={(e) =>
                chooseSource(
                  draft.source,
                  e.target.value ? Number(e.target.value) : null,
                )
              }
            >
              <option value="">
                {draft.source === "transformed"
                  ? "저장된 전체 변환 결과"
                  : "기본 Oracle 데이터"}
              </option>
              {[1000, 10000, 100000, 1000000].map((n) => (
                <option value={n} key={n}>
                  {fmt(n)}행 · 테스트 데이터
                </option>
              ))}
            </select>
          </label>
          <label>
            Lot 필터
            <input
              aria-label="분석 Lot 필터"
              disabled={draft.source === "transformed"}
              placeholder={draft.sampleSize ? "BENCH-001" : "LOT-101"}
              value={draft.lotId ?? ""}
              onChange={(e) =>
                setDraft({ ...draft, lotId: e.target.value || null })
              }
            />
          </label>
          {draft.datasetId && (
            <p className="mapping-note">
              고정된 변환 데이터셋
              <br />
              {draft.datasetId}
            </p>
          )}
          <div className="section-divider">GROUPING</div>
          {select("category", "Category · 독립 차트", true)}
          {select("legend", "Legend · 시리즈", true)}
          <div className="section-divider">AXES</div>
          {select("x", "X 컬럼")}
          <label>
            X 타입
            <select
              aria-label="X 타입"
              value={draft.xType}
              onChange={(e) => setDraft({ ...draft, xType: e.target.value })}
            >
              <option value="string">문자열</option>
              <option value="number">숫자</option>
              <option value="date">날짜 · UTC</option>
            </select>
          </label>
          {select("y", "Y 컬럼", false, true)}
          <div className="section-divider">차트 옵션</div>
          <label>
            <span className="option-heading">
              포인트 크기{" "}
              <output>
                {draft.pointSize == null ? "자동" : `${draft.pointSize}px`}
              </output>
            </span>
            <input
              aria-label="포인트 크기"
              type="range"
              min="2"
              max="20"
              step="0.5"
              value={
                draft.pointSize ?? (spec && spec.plottedRows > 5000 ? 3.5 : 6)
              }
              onChange={(e) =>
                setDraft({ ...draft, pointSize: Number(e.target.value) })
              }
            />
          </label>
          <button
            className="text-button"
            disabled={draft.pointSize == null}
            onClick={() => setDraft({ ...draft, pointSize: null })}
          >
            크기 자동 조절
          </button>
          <label className="checkbox-option">
            <input
              type="checkbox"
              aria-label="포인트 라벨 표시"
              checked={draft.showLabels ?? false}
              onChange={(e) =>
                setDraft({ ...draft, showLabels: e.target.checked })
              }
            />
            포인트 라벨 표시
          </label>
          {draft.showLabels && (
            <>
              <label>
                라벨 컬럼
                <select
                  aria-label="라벨 컬럼"
                  value={draft.labelColumn ?? ""}
                  onChange={(e) =>
                    setDraft({ ...draft, labelColumn: e.target.value || null })
                  }
                >
                  <option value="">Y값 · {draft.y}</option>
                  {columns
                    .filter((c) => c.type !== "other")
                    .map((c) => (
                      <option key={c.name} value={c.name}>
                        {c.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                라벨 글자 크기 · {draft.labelFontSize ?? 11}px
                <input
                  aria-label="라벨 글자 크기"
                  type="range"
                  min="8"
                  max="20"
                  step="1"
                  value={draft.labelFontSize ?? 11}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      labelFontSize: Number(e.target.value),
                    })
                  }
                />
              </label>
              <p className="mapping-note">
                겹치는 라벨은 자동으로 숨깁니다. 많은 포인트에 라벨을 표시하면
                그리기가 느려질 수 있습니다.
              </p>
            </>
          )}
          <p className="mapping-note">
            옵션을 바꾼 뒤 분석 실행을 눌러 적용하세요.
          </p>
          <button
            className="primary full"
            disabled={busy || metaBusy}
            onClick={() => run()}
          >
            <Play size={14} />
            {busy ? "분석 중…" : "분석 실행"}
          </button>
          {busy ? (
            <button
              className="full"
              onClick={() => {
                abort.current?.abort();
                setBusy(false);
              }}
            >
              요청 취소
            </button>
          ) : (
            <button
              className="text-button full"
              onClick={() => setDraft(applied ?? initial)}
            >
              <RotateCcw size={12} />
              설정 되돌리기
            </button>
          )}
          <p className="mapping-note">
            Category마다 별도 차트.
            <br />
            Legend마다 별도 시리즈.
            <br />
            포인트를 클릭해 값을 확인하세요.
          </p>
        </aside>
        <div className="studio-results">
          <ErrorBox error={error} />
          {dirty && (
            <div className="notice">
              <Info size={15} />
              설정이 변경되었습니다. 아래 결과는 마지막 실행 기준입니다.
            </div>
          )}
          {busy && <Loading />}
          {spec && applied ? (
            <>
              <div className="result-strip">
                <div>
                  <small>원본 행</small>
                  <strong>{fmt(spec.sourceRows)}</strong>
                </div>
                <div>
                  <small>표시 포인트</small>
                  <strong>{fmt(spec.plottedRows)}</strong>
                </div>
                <div>
                  <small>결측 제외</small>
                  <strong>{fmt(spec.skippedRows)}</strong>
                </div>
                <div>
                  <small title="최근 조회의 서버 처리 시간. 조회·수신에는 네트워크와 JSON 해석이 포함됩니다.">
                    최근 서버 처리
                  </small>
                  <strong>
                    {fmt(ms)} <em>ms</em>
                  </strong>
                </div>
              </div>
              <div
                className="performance-strip"
                data-batch-id={batch.id}
                data-complete={timing.complete}
                data-kind={batch.kind}
                data-receive-ms={batch.receiveMs ?? ""}
                data-render-ms={timing.renderMs ?? ""}
                data-total-ms={timing.totalMs ?? ""}
                data-visible-points={visiblePoints}
              >
                <div className="performance-scope">
                  {
                    {
                      query: "전체 조회",
                      appearance: "옵션 변경",
                      page: "페이지 이동",
                      tab: "차트 다시 표시",
                    }[batch.kind]
                  }{" "}
                  · 현재 {visible.length}/{spec.charts.length}개 차트 ·{" "}
                  {fmt(visiblePoints)}/{fmt(spec.plottedRows)}점 · 샘플링 없음
                </div>
                <div>
                  <small>조회 · 수신</small>
                  <strong>
                    {batch.receiveMs == null
                      ? "재조회 없음"
                      : duration(batch.receiveMs)}
                  </strong>
                </div>
                <div title="응답 수신 후 현재 페이지의 모든 차트가 finished 이벤트를 보내고 두 번의 animation frame을 지난 시점까지의 경과 시간입니다.">
                  <small>현재 페이지 그리기</small>
                  <strong>
                    {tab !== "charts"
                      ? "차트 탭에서 측정"
                      : !visible.length
                        ? "표시할 점 없음"
                        : timing.failed
                          ? "그리기 실패"
                          : timing.complete
                            ? duration(timing.renderMs)
                            : `그리는 중 (${timing.completed}/${visible.length})`}
                  </strong>
                </div>
                <div title="실행 또는 페이지 이동부터 현재 페이지 차트 표시까지의 총 경과 시간. 물리적 화면 출력이나 FPS 측정값은 아닙니다.">
                  <small>전체 표시</small>
                  <strong>
                    {tab !== "charts" || timing.failed
                      ? "—"
                      : duration(timing.totalMs)}
                  </strong>
                </div>
              </div>
              <div className="result-toolbar">
                <div className="segmented">
                  <button
                    className={tab === "charts" ? "active" : ""}
                    onClick={() => {
                      if (tab !== "charts") beginBatch("tab");
                      setTab("charts");
                    }}
                  >
                    차트 <span>{spec.charts.length}</span>
                  </button>
                  <button
                    className={tab === "data" ? "active" : ""}
                    onClick={() => setTab("data")}
                  >
                    데이터 / 설정
                  </button>
                </div>
                <button
                  onClick={() =>
                    download(
                      new Blob(
                        [
                          csv(
                            spec.charts.flatMap((c) =>
                              c.series.flatMap((s) =>
                                s.points.map((p) => ({
                                  category: c.name,
                                  legend: s.name,
                                  x: p.x,
                                  y: p.y,
                                  ...(spec.showLabels
                                    ? { label: p.label ?? "" }
                                    : {}),
                                })),
                              ),
                            ),
                          ),
                        ],
                        { type: "text/csv" },
                      ),
                      "waferscope-points.csv",
                    )
                  }
                >
                  <Download size={13} />
                  포인트 CSV
                </button>
              </div>
              {tab === "data" ? (
                <div className="panel code-panel">
                  <h3>적용된 요청</h3>
                  <pre>{JSON.stringify(applied, null, 2)}</pre>
                  <h3>응답 메타데이터</h3>
                  <pre>
                    {JSON.stringify({ ...spec, charts: undefined }, null, 2)}
                  </pre>
                </div>
              ) : !spec.charts.length ? (
                <Empty
                  title="표시할 포인트가 없습니다"
                  description="필터와 축 컬럼을 확인해 주세요."
                />
              ) : (
                <>
                  <div className="chart-grid">
                    {spec.charts
                      .slice(page * 4, page * 4 + 4)
                      .map((panel, i) => (
                        <article className="chart-card" key={panel.key}>
                          <div className="chart-head">
                            <div>
                              <h3>{panel.name}</h3>
                              <small>
                                {panel.series.length} series ·{" "}
                                {fmt(
                                  panel.series.reduce(
                                    (n, s) => n + s.points.length,
                                    0,
                                  ),
                                )}{" "}
                                points
                              </small>
                            </div>
                            <div>
                              <button
                                className="icon-button"
                                aria-label={`${panel.name} 확대`}
                                onClick={() => setExpanded(panel)}
                              >
                                <Maximize2 size={14} />
                              </button>
                              <button
                                disabled={exportBusy}
                                className="text-button"
                                onClick={() => exportFile("png", page * 4 + i)}
                              >
                                PNG
                              </button>
                              <button
                                disabled={exportBusy}
                                className="text-button"
                                onClick={() => exportFile("svg", page * 4 + i)}
                              >
                                SVG
                              </button>
                            </div>
                          </div>
                          <Chart
                            spec={spec}
                            panel={panel}
                            onPoint={setPoint}
                            batchId={batch.id}
                            onRendered={onRendered}
                          />
                        </article>
                      ))}
                  </div>
                  <div className="pagination">
                    <span>
                      독립 차트 {page * 4 + 1}–
                      {Math.min(page * 4 + 4, spec.charts.length)} /{" "}
                      {spec.charts.length}
                    </span>
                    <button
                      disabled={page === 0}
                      onClick={() => changePage(page - 1)}
                      aria-label="이전 차트"
                    >
                      <ChevronLeft size={14} />
                    </button>
                    <button
                      disabled={(page + 1) * 4 >= spec.charts.length}
                      onClick={() => changePage(page + 1)}
                      aria-label="다음 차트"
                    >
                      <ChevronRight size={14} />
                    </button>
                  </div>
                </>
              )}
              {point && (
                <div className="point-detail">
                  <strong>선택한 포인트</strong>
                  <span>{point.series}</span>
                  <span>
                    X:{" "}
                    {applied.xType === "date"
                      ? new Date(point.x).toISOString()
                      : String(point.x)}
                  </span>
                  <span>Y: {point.y}</span>
                  <button
                    className="icon-button"
                    onClick={() => setPoint(undefined)}
                    aria-label="포인트 닫기"
                  >
                    <X size={14} />
                  </button>
                </div>
              )}
            </>
          ) : (
            !busy && (
              <Empty
                title="분석을 실행해 보세요"
                description="원본과 컬럼을 선택하면 결과가 여기에 표시됩니다."
              />
            )
          )}
        </div>
      </div>
      {save && (
        <Modal title="분석 뷰 저장" onClose={() => !saving && setSave(false)}>
          <p className="muted">
            마지막으로 실행한 설정을 저장합니다. 데이터는 열 때 다시 조회합니다.
          </p>
          <ErrorBox error={saveError} />
          <label>
            이름
            <input
              autoFocus
              maxLength={80}
              aria-label="뷰 이름"
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
            />
          </label>
          <label>
            분석 메모
            <textarea
              maxLength={1000}
              aria-label="분석 메모"
              placeholder="이 분석의 목적이나 발견한 점을 기록하세요."
              value={saveDescription}
              onChange={(e) => setSaveDescription(e.target.value)}
            />
          </label>
          <div className="modal-actions">
            <button onClick={() => setSave(false)}>취소</button>
            <button
              className="primary"
              disabled={saving || !saveName.trim()}
              onClick={saveView}
            >
              저장
            </button>
          </div>
        </Modal>
      )}
      {expanded && spec && (
        <Modal title={expanded.name} onClose={() => setExpanded(undefined)}>
          <div className="expanded-plot">
            <Chart spec={spec} panel={expanded} onPoint={setPoint} />
          </div>
        </Modal>
      )}
    </>
  );
}
