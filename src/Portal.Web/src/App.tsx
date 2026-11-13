import { useEffect, useState, lazy, Suspense } from "react";
import {
  LayoutDashboard,
  Radio,
  Database,
  ChartScatter,
  Bookmark,
  Terminal,
  History,
  Search,
  ChevronRight,
  HelpCircle,
  X,
  Command,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { EngineVs } from "./EngineVs";
import { Streams } from "./Streams";
import { Overview } from "./Overview";
import { Views } from "./Views";
import { DataExplorer } from "./DataExplorer";
import { Console, type ConsoleRequest } from "./Console";
import { Activity } from "./Activity";
import { Modal, ErrorBox } from "./ui";
import { initial, type Config, type Run, type View } from "./types";
import { json } from "./api";
const Analysis = lazy(() =>
  import("./Analysis").then((m) => ({ default: m.Analysis })),
);
const pages = [
  ["overview", "Overview", "운영 개요", LayoutDashboard],
  ["data", "Datasets", "데이터 탐색", Database],
  ["analysis", "Analysis", "분석 스튜디오", ChartScatter],
  ["engines", "Engine VS", "엔진 대결 · Drill", Terminal],
  ["streams", "Data streams", "데이터 스트림", Radio],
  ["views", "Saved views", "저장된 뷰", Bookmark],
  ["console", "API console", "API 콘솔", Terminal],
  ["activity", "Activity", "실행 이력", History],
] as const;
export default function App() {
  const [page, setPage] = useState(
      location.hash.slice(1).split("?")[0] || "overview",
    ),
    [config, setConfig] = useState<Config>(initial),
    [session, setSession] = useState(0),
    [consoleStart, setConsoleStart] = useState<ConsoleRequest>(),
    [toast, setToast] = useState(""),
    [command, setCommand] = useState(false),
    [help, setHelp] = useState(false),
    [search, setSearch] = useState(""),
    [collapsed, setCollapsed] = useState(false),
    [error, setError] = useState("");
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
        (id ? "?view=" + id : c.datasetId ? "?dataset=" + c.datasetId : ""),
    );
    setPage("analysis");
  }
  useEffect(() => {
    async function hash() {
      const [route, params] = location.hash.slice(1).split("?");
      setPage(pages.some((p) => p[0] === route) ? route : "overview");
      const query = new URLSearchParams(params);
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
    <div className={"app " + (collapsed ? "collapsed" : "")}>
      <aside className="sidebar">
        <a className="logo" href="#overview">
          <img src="/favicon.svg" alt="" />
          <span>
            WaferScope<small>Data workbench</small>
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
              title={ko}
              aria-current={page === id ? "page" : undefined}
            >
              <Icon size={18} />
              <span>{en}</span>
            </a>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button onClick={() => setHelp(true)}>
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
          <button
            className="icon-button collapse-toggle"
            aria-label="사이드바 전환"
            onClick={() => setCollapsed((v) => !v)}
          >
            {collapsed ? (
              <PanelLeftOpen size={17} />
            ) : (
              <PanelLeftClose size={17} />
            )}
          </button>
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
          <span className="local-tag">LOCAL ONLY</span>
          <span className="avatar" title="공유된 로컬 개발 워크스페이스">
            WS
          </span>
        </header>
        <main>
          <ErrorBox error={error} />
          {page === "overview" && (
            <Overview navigate={navigate} analyze={analyze} />
          )}{" "}
          {page === "data" && <DataExplorer analyze={analyze} />}{" "}
          {page === "analysis" && (
            <Suspense
              fallback={<div className="loading">분석 모듈을 불러오는 중…</div>}
            >
              <Analysis key={session} start={config} notify={setToast} />
            </Suspense>
          )}{" "}
          {page === "engines" && <EngineVs />}
          {page === "streams" && <Streams analyze={analyze} />}
          {page === "views" && (
            <Views analyze={analyze} notify={setToast} />
          )}{" "}
          {page === "console" && <Console key={session} start={consoleStart} />}{" "}
          {page === "activity" && <Activity replay={replay} />}
          <footer className="app-footer">
            <span>WaferScope / Engineering workspace</span>
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
        <Modal title="WaferScope 워크스페이스" onClose={() => setHelp(false)}>
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
              저장된 뷰는 설정을 저장합니다. 열면 현재 원본을 다시 조회합니다.
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
