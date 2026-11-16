import { useEffect, useState, useRef, lazy, Suspense } from "react";
import {
  Radio,
  GitBranch,
  ChartScatter,
  Terminal,
  History,
  Search,
  ChevronRight,
  HelpCircle,
  X,
  Command,
} from "lucide-react";
import { EngineVs } from "./EngineVs";
import { Streams } from "./Streams";
import { Views } from "./Views";
import { Console, type ConsoleRequest } from "./Console";
import { Activity } from "./Activity";
import { Modal, ErrorBox } from "./ui";
import { initial, type Config, type Run, type View } from "./types";
import { json } from "./api";
const Analysis = lazy(() =>
  import("./SourceAnalysis").then((m) => ({ default: m.SourceAnalysis })),
);
const Workflows = lazy(() => import("./WorkflowLibrary").then(m => ({default:m.WorkflowLibrary})));
const pages = [
  ["console", "API console", "API 콘솔", Terminal],
  ["workflows", "Workflows", "워크플로우", GitBranch],
  ["analysis", "Analysis", "분석 스튜디오", ChartScatter],
  ["engines", "Engine Benchmark", "워크플로우 엔진 벤치마크 · Drill", Terminal],
  ["streams", "Data streams", "데이터 스트림", Radio],
  ["activity", "Activity", "실행 이력", History],
] as const;
export default function App() {
  const [page, setPage] = useState(
      location.hash.slice(1).split("?")[0] || "console",
    ),
    [config, setConfig] = useState<Config>(initial),
    [session, setSession] = useState(0),
    [consoleStart, setConsoleStart] = useState<ConsoleRequest>(),
    [toast, setToast] = useState(""),
    [command, setCommand] = useState(false),
    [help, setHelp] = useState(false),
    [search, setSearch] = useState(""),
    [error, setError] = useState("");
  const [analysisTab, setAnalysisTab] = useState("run");
  const analysisLocation = useRef("");
  function selectAnalysisTab(tab: string) {
    if (tab === analysisTab) return;
    if (tab === "saved") {
      analysisLocation.current = location.hash;
      location.hash = "analysis?tab=views";
    } else {
      history.replaceState(null, "", analysisLocation.current || "#analysis");
      setAnalysisTab("run");
    }
  }
  function navigate(p: string) {
    location.hash = p;
    setPage(p);
    setCommand(false);
    setSearch("");
    setError("");
  }
  function analyze(c: Config, id?: string) {
    setConfig(c);
    setSession((s) => s + 1);
    navigate(
      "analysis" +
        (id ? "?view=" + id : c.datasetId ? (c.source === "snapshot" ? "?snapshot=" : "?dataset=") + c.datasetId : ""),
    );
    setPage("analysis");
    setAnalysisTab("run");
  }
  useEffect(() => {
    async function hash() {
      if (location.hash === "#views") {
        history.replaceState(null, "", "#analysis?tab=views");
      }
      const [route, params] = location.hash.slice(1).split("?");
      const valid = pages.some((p) => p[0] === route);
      setPage(valid ? route : "console");
      if (!valid) history.replaceState(null, "", location.pathname + location.search + "#console");
      const query = new URLSearchParams(params);
      if (route === "analysis") {
        const saved = query.get("tab") === "views";
        setAnalysisTab(saved ? "saved" : "run");
        if (saved) return;
        if (analysisLocation.current === location.hash) return;
        analysisLocation.current = location.hash;
      }
      if (route === "analysis" && (query.has("workflow") || query.has("api"))) { setConfig({...initial});setSession(s=>s+1); }
      if (route === "engines") setSession(s=>s+1);
      const snapshot = query.get("snapshot");
      if (route === "analysis" && snapshot) { setConfig({...initial, source:"snapshot", datasetId:snapshot});setSession(s=>s+1); }
      const dataset = query.get("dataset");
      if (route === "analysis" && dataset) {
        setConfig({
          source: "transformed",
          datasetId: dataset,
          category: "lot_id",
          legend: "product",
          x: "inspected_at",
          y: "yield_pct",
          xType: "date",
          lotId: null,
          sampleSize: null,
        });
        setSession((s) => s + 1);
      }
      const id = query.get("view");
      if (route === "analysis" && id) {
        try {
          const views = await json<View[]>("/api/workspace/views");
          const v = views.find((v) => v.id === id);
          if (!v) throw Error("이 분석 뷰가 삭제되었거나 존재하지 않습니다.");
          setConfig(v.config);
          setSession((s) => s + 1);
        } catch (e: any) {
          setError(e.message);
        }
      }
    }
    hash();
    window.addEventListener("hashchange", hash);
    return () => window.removeEventListener("hashchange", hash);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setCommand((v) => !v);
      }
      if (e.key === "Escape") {
        setCommand(false);
        setHelp(false);
      }
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, []);
  function replay(r: Run) {
    if (r.path.startsWith("/api/chart/render")) analyze(r.request as Config);
    else {
      setConsoleStart({
        path: r.path,
        method: r.method,
        body: r.request ?? undefined,
      });
      setSession((s) => s + 1);
      navigate("console");
    }
  }
  const current = pages.find((p) => p[0] === page) ?? pages[0];
  return (
    <div className={"app rail-shell " + (page === "console" ? "console-shell" : "")}>
      <aside className="sidebar">
        <a className="logo" href="#console" aria-label="API Content Builder">
          <img src="/favicon.svg" alt="" />
          <span>
            API Content<small>Builder</small>
          </span>
        </a>
        <div className="workspace-label">
          <span className="workspace-avatar">W</span>
          <span>
            Engineering lab<small>Local workspace</small>
          </span>
        </div>
        <nav>
          {pages.map(([id, en, ko, Icon]) => (
            <a
              key={id}
              href={"#" + id}
              className={page === id ? "active" : ""}
              title={en + " · " + ko}
              aria-label={en}
              aria-current={page === id ? "page" : undefined}
            >
              <Icon size={18} />
              <span>{en}</span>
            </a>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button aria-label="워크스페이스 안내" title="워크스페이스 안내" onClick={() => setHelp(true)}>
            <HelpCircle size={17} />
            <span>워크스페이스 안내</span>
          </button>
          <div className="environment">
            <span className="dot ok" />
            <span>LOCAL · DEVELOPMENT</span>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          {<><a className="console-brand" href="#console"><img src="/favicon.svg" alt=""/>API Content Builder</a><span className="console-workspace">W · Engineering lab</span></>}
          <div className="breadcrumbs">
            Workspace
            <ChevronRight size={12} />
            <strong>{current[1]}</strong>
          </div>
          <button className="command-button" onClick={() => setCommand(true)}>
            <Search size={14} />
            <span>이동할 화면 찾기</span>
            <kbd>⌘ K</kbd>
          </button>
          <select className="console-environment" aria-label="연결 환경" title="현재 구성된 환경은 로컬 Oracle 하나입니다." value="local" onChange={() => {}}><option value="local">Local · Oracle XEPDB1</option></select>
          <span className="avatar" title="공유된 로컬 개발 워크스페이스">
            AB
          </span>
        </header>
        <main>
          <ErrorBox error={error} />
          {page === "analysis" && (
            <>
              <div className="analysis-tabs" role="tablist" aria-label="분석 작업">
                {[["run", "분석하기"], ["saved", "저장된 뷰"]].map(([id, label], index) => (
                  <button key={id} id={"analysis-tab-" + id} role="tab"
                    aria-selected={analysisTab === id} aria-controls={"analysis-panel-" + id}
                    tabIndex={analysisTab === id ? 0 : -1}
                    onClick={() => selectAnalysisTab(id)}
                    onKeyDown={e => {
                      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
                      e.preventDefault();
                      const next = e.key === "Home" ? "run" : e.key === "End" ? "saved" : index === 0 ? "saved" : "run";
                      selectAnalysisTab(next);
                      document.getElementById("analysis-tab-" + next)?.focus();
                    }}>{label}</button>
                ))}
              </div>
              <div id="analysis-panel-run" role="tabpanel" aria-labelledby="analysis-tab-run" hidden={analysisTab !== "run"}>
                <Suspense fallback={<div className="loading">분석 모듈을 불러오는 중…</div>}>
                  <Analysis key={session} start={config} notify={setToast} />
                </Suspense>
              </div>
              <div id="analysis-panel-saved" role="tabpanel" aria-labelledby="analysis-tab-saved" hidden={analysisTab !== "saved"}>
                {analysisTab === "saved" && <Views analyze={analyze} notify={setToast} />}
              </div>
            </>
          )}
          {page === "workflows" && <Suspense fallback={<div className="loading">워크플로우를 불러오는 중…</div>}><Workflows /></Suspense>}
          {page === "engines" && <EngineVs key={session} />}
          {page === "streams" && <Streams analyze={analyze} />}
          {page === "console" && <Console key={session} start={consoleStart} />}{" "}
          {page === "activity" && <Activity replay={replay} />}
          <footer className="app-footer">
            <span>API Content Builder / Workspace</span>
            <span>데이터 · 분석 · 재현</span>
          </footer>
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          {toast}
          <button aria-label="알림 닫기" onClick={() => setToast("")}>
            <X size={14} />
          </button>
        </div>
      )}
      {command && (
        <Modal title="화면 바로가기" onClose={() => setCommand(false)}>
          <input
            autoFocus
            aria-label="화면 검색"
            placeholder="화면 이름으로 검색…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="command-results">
            {pages
              .filter((p) =>
                (p[1] + p[2]).toLowerCase().includes(search.toLowerCase()),
              )
              .map(([id, en, ko, Icon]) => (
                <button key={id} onClick={() => navigate(id)}>
                  <Icon size={17} />
                  <strong>{en}</strong>
                  <span>{ko}</span>
                  <ChevronRight size={15} />
                </button>
              ))}
          </div>
        </Modal>
      )}
      {help && (
        <Modal title="API Content Builder" onClose={() => setHelp(false)}>
          <p>
            반도체 검사·결함 데이터를 조회하고, 분석 설정을 저장하고, 결과를
            재현하는 로컬 개발 애플리케이션입니다.
          </p>
          <div className="help-flow">
            Oracle → DAC / DuckDB → Chart worker → Web · Image
            <br />
            PostgreSQL → 저장된 뷰 · 실행 이력
          </div>
          <ul>
            <li>분석 설정은 ‘분석 실행’을 눌러 적용합니다.</li>
            <li>
              1천·1만·10만·100만 행 모두 선택 범위 전체를 처리합니다. Lot 필터와
              X/Y 결측값을 제외한 모든 행을 차트에 전달합니다.
            </li>
            <li>
              Analysis의 저장된 뷰 탭에서 분석을 다시 엽니다. 워크플로우/API 소스는 저장 당시의 고정 데이터를 사용합니다.
            </li>
            <li>API 콘솔의 실패 응답도 실행 이력에 남습니다.</li>
            <li>
              현재는 인증 없는 로컬 단일 워크스페이스입니다. 운영용 다중 사용자
              서비스는 아닙니다.
            </li>
          </ul>
          <p className="tiny muted">
            실제 기업 데이터나 연동을 사용하지 않습니다. 모든 샘플은 합성
            데이터입니다.
          </p>
        </Modal>
      )}
    </div>
  );
}
