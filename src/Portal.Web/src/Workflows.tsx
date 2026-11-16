import { useEffect, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  MarkerType,
  type NodeProps,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  GitBranch,
  Play,
  Save,
  Upload,
  Plus,
  Undo2,
  Redo2,
  LayoutGrid,
  Trash2,
  Copy,
  Square,
  CheckCircle2,
} from "lucide-react";
import { json, data, download, csv, when, fmt } from "./api";
import { ErrorBox } from "./ui";
import {
  arrange,
  canConnect,
  ports,
  labels,
  executionSignature,
  type Workflow,
  type Definition,
  type WNode,
  type Kind,
  type Query,
} from "./workflow-model";
import "./workflows.css";
const cacheKey = "api-content-builder.workflow-draft.v1";
function Card({
  data,
  selected,
}: NodeProps<Node<{ node: WNode; status?: string; rows?: number }>>) {
  const n = data.node;
  return (
    <div className={"wf-node " + n.kind + (selected ? " selected" : "")}>
      {ports(n.kind).map((port, i) => (
        <Handle
          key={port}
          id={port}
          type="target"
          position={Position.Left}
          style={{ top: `${((i + 1) * 100) / (ports(n.kind).length + 1)}%` }}
          title={port}
        />
      ))}
      <div className="wf-node-top">
        <span>{labels[n.kind]}</span>
        <small>{n.id}</small>
      </div>
      <strong>
        {n.kind === "query"
          ? n.config.queryId
          : n.kind === "join"
            ? `${n.config.joinType.toUpperCase()} JOIN`
            : n.kind === "merge"
              ? "UNION ALL BY NAME"
              : n.kind === "filter"
                ? "조건으로 행 필터링"
                : "워크플로우 결과"}
      </strong>
      <p>
        {n.kind === "query"
          ? `SQL v${n.config.queryVersion} · ${n.config.body?.database_name || "database"}`
          : n.kind === "join"
            ? "왼쪽 · 오른쪽 데이터 연결"
            : n.kind === "merge"
              ? "동일 이름 컬럼 정렬 · 중복 유지"
              : n.kind === "filter"
                ? `${n.config.rules?.length || 0}개 조건 · AND`
                : "결과 저장 · API 조회"}
      </p>
      {data.status && (
        <div className={"wf-state " + data.status}>
          {data.status}
          {data.rows != null && ` · ${fmt(data.rows)} rows`}
        </div>
      )}
      {n.kind !== "output" && (
        <Handle id="out" type="source" position={Position.Right} />
      )}
    </div>
  );
}
const nodeTypes = { workflow: Card };
function JsonEditor({
  label,
  value,
  onChange,
  help,
  onValidity,
}: {
  label: string;
  value: any;
  onChange: (v: any) => void;
  help?: string;
  onValidity: (label: string, valid: boolean) => void;
}) {
  const [text, setText] = useState(JSON.stringify(value, null, 2)),
    [error, setError] = useState("");
  const validity = useRef(onValidity);
  validity.current = onValidity;
  const lastValue = useRef(JSON.stringify(value));
  useEffect(() => () => validity.current(label, true), [label]);
  useEffect(() => {
    if (lastValue.current !== JSON.stringify(value)) {
      setText(JSON.stringify(value, null, 2));
      setError("");
      validity.current(label, true);
      lastValue.current = JSON.stringify(value);
    }
  }, [JSON.stringify(value)]);
  return (
    <label className="wf-field">
      {label}
      <textarea
        aria-label={label}
        spellCheck={false}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          try {
            const parsed = JSON.parse(e.target.value);
            if (!parsed || Array.isArray(parsed) || typeof parsed !== "object")
              throw Error("JSON 객체를 입력하세요.");
            lastValue.current = JSON.stringify(parsed);
            onChange(parsed);
            setError("");
            onValidity(label, true);
          } catch (e: any) {
            setError(e.message);
            onValidity(label, false);
          }
        }}
      />
      {error ? (
        <small className="wf-invalid">
          입력 중 · 유효한 JSON만 저장됩니다: {error}
        </small>
      ) : (
        help && <small>{help}</small>
      )}
    </label>
  );
}
export function WorkflowEditor({
  workflowId,
  onBack,
}: {
  workflowId: string;
  onBack: () => void;
}) {
  const [invalid, setInvalid] = useState<Record<string, boolean>>({});
  const onValidity = (label: string, valid: boolean) =>
    setInvalid((v) => ({ ...v, [label]: !valid }));
  const invalidJson = Object.values(invalid).some(Boolean);
  const [queries, setQueries] = useState<Query[]>([]),
    [histories, setHistories] = useState<any[]>([]);
  const [doc, setDoc] = useState<Workflow | null>(null),
    [name, setName] = useState("Lot 품질 분석"),
    [def, setDef] = useState<Definition | null>(null),
    [saved, setSaved] = useState("");
  const [selected, setSelected] = useState("eds"),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [ready, setReady] = useState(false);
  const [past, setPast] = useState<Definition[]>([]),
    [future, setFuture] = useState<Definition[]>([]),
    [runs, setRuns] = useState<any[]>([]),
    [run, setRun] = useState<any>(null),
    [runId, setRunId] = useState("");
  const [inputsText, setInputsText] = useState("{}"),
    [version, setVersion] = useState(""),
    [versions, setVersions] = useState<any[]>([]),
    [result, setResult] = useState<any>(null),
    [offset, setOffset] = useState(0),
    [pane, setPane] = useState<"node" | "inputs">("node");
  const flow = useRef<{
      fitView: (options: { padding: number }) => Promise<boolean>;
    } | null>(null);
  const dirty = !!def && JSON.stringify({ name, definition: def }) !== saved;
  function edit(next: Definition) {
    if (def) setPast((p) => [...p.slice(-29), structuredClone(def)]);
    setFuture([]);
    setDef(next);
    setMessage("");
  }
  function changeNode(config: Record<string, any>) {
    if (def)
      edit({
        ...def,
        nodes: def.nodes.map((n) => (n.id === selected ? { ...n, config } : n)),
      });
  }
  async function open(w: Workflow) {
    setDoc(w);
    setName(w.name);
    setDef(w.definition);
    setSaved(JSON.stringify({ name: w.name, definition: w.definition }));
    setPast([]);
    setFuture([]);
    setSelected(w.definition.nodes[0]?.id || "");
    setRun(null);
    setRunId("");
    setVersion("");
    setInputsText(JSON.stringify(w.definition.inputs, null, 2));
  }
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const [q, h] = await Promise.all([
          data("/api/dac/queries"),
          json("/api/workspace/runs?limit=200"),
        ]);
        if (!mounted) return;
        setQueries(q);
        setHistories(h);
        const w = await json<Workflow>("/api/workflows/" + workflowId);
        if (!mounted) return;
        const cache =
          localStorage.getItem(cacheKey + ":" + workflowId) ||
          localStorage.getItem(cacheKey);
        let restored = false;
        if (cache) {
          try {
            const c = JSON.parse(cache);
            if (
              c.doc?.id === workflowId &&
              c.definition?.nodes &&
              c.definition?.edges &&
              JSON.stringify({ name: c.name, definition: c.definition }) !==
                c.saved
            ) {
              setDef(c.definition);
              setDoc(c.doc);
              setName(c.name);
              setSaved(c.saved || "");
              setInputsText(JSON.stringify(c.definition.inputs, null, 2));
              setSelected(c.definition.nodes[0]?.id || "");
              setMessage("이 워크플로우의 저장하지 않은 변경을 복원했습니다.");
              restored = true;
            }
          } catch {
            /* Invalid browser cache does not replace the server definition. */
          }
        }
        if (!restored) await open(w);
        setReady(true);
      } catch (e: any) {
        if (mounted) setError(e.message);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);
  useEffect(() => {
    if (ready && def) {
      try {
        localStorage.setItem(
          cacheKey + ":" + workflowId,
          JSON.stringify({ definition: def, doc, name, saved }),
        );
      } catch {
        setError("브라우저 임시 저장 공간이 부족합니다. 서버에 저장하세요.");
      }
    }
  }, [def, doc, name, saved, ready]);
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
  useEffect(() => {
    if (!doc) {
      setRuns([]);
      setVersions([]);
      return;
    }
    let live = true;
    Promise.all([
      json(`/api/workflows/${doc.id}/runs`),
      json(`/api/workflows/${doc.id}/versions`),
    ])
      .then(([r, v]) => {
        if (live) {
          setRuns(r);
          setVersions(v);
        }
      })
      .catch((e) => setError(e.message));
    return () => {
      live = false;
    };
  }, [doc?.id, doc?.published_version, run?.status]);
  useEffect(() => {
    if (!runId) return;
    let live = true,
      timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const r = await json("/api/workflow-runs/" + runId);
        if (!live) return;
        setRun(r);
        if (["queued", "running"].includes(r.status))
          timer = setTimeout(poll, 650);
      } catch (e: any) {
        if (live) setError(e.message);
      }
    }
    poll();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [runId]);
  useEffect(() => {
    setOffset(0);
  }, [selected, runId]);
  useEffect(() => {
    setResult(null);
    if (
      !runId ||
      !run?.nodes?.some(
        (n: any) => n.node_id === selected && n.status === "succeeded",
      )
    )
      return;
    let live = true;
    json(
      `/api/workflow-runs/${runId}/nodes/${selected}/data?offset=${offset}&limit=50`,
    )
      .then((r) => {
        if (live) setResult(r);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [runId, run?.status, selected, offset]);
  async function action(fn: () => Promise<void>) {
    setError("");
    setMessage("");
    setBusy(true);
    try {
      await fn();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (invalidJson) throw Error("잘못된 JSON 입력을 수정하세요.");
    if (!def) throw Error("정의를 불러오는 중입니다.");
    const w = await json<Workflow>(
      doc ? "/api/workflows/" + doc.id : "/api/workflows",
      {
        method: doc ? "PUT" : "POST",
        body: JSON.stringify({
          name,
          definition: def,
          revision: doc?.revision || 0,
        }),
      },
    );
    setDoc(w);
    setSaved(JSON.stringify({ name, definition: def }));
    return w;
  }
  async function start(published: boolean) {
    if (!def) return;
    const inputs = JSON.parse(inputsText);
    if (!inputs || Array.isArray(inputs) || typeof inputs !== "object")
      throw Error("실행 입력은 JSON 객체여야 합니다.");
    const w = published ? doc : await save();
    if (!w) throw Error("먼저 게시하세요.");
    const r = await json(
      published ? `/api/workflow/${w.id}` : `/api/workflows/${w.id}/test`,
      {
        method: "POST",
        body: JSON.stringify({
          inputs,
          version: version ? Number(version) : null,
        }),
      },
    );
    setRun(null);
    setRunId(r.runId);
    setMessage(
      published ? "게시 버전을 실행합니다." : "저장된 초안을 테스트합니다.",
    );
  }
  function connect(source: string, target: string, port: string) {
    if (!def) return;
    if (!canConnect(def, source, target, port)) {
      setError("순환 연결 또는 유효하지 않은 포트입니다.");
      return;
    }
    edit({
      ...def,
      edges: [
        ...def.edges.filter((e) => !(e.target === target && e.port === port)),
        { source, target, port },
      ],
    });
  }
  function add(kind: Kind) {
    if (!def || !queries.length) return;
    if (kind === "output" && def.nodes.some((n) => n.kind === "output")) {
      setError("Output은 하나만 사용할 수 있습니다.");
      return;
    }
    const q = queries[0];
    const id = kind + "_" + crypto.randomUUID().slice(0, 6);
    const config =
      kind === "query"
        ? {
            queryId: q.query_id,
            queryVersion: q.query_version,
            body: q.default_body,
          }
        : kind === "join"
          ? { joinType: "left", keys: [{ left: "lot_id", right: "lot_id" }] }
          : kind === "filter"
            ? { rules: [{ column: "yield_pct", op: "gte", value: 95 }] }
            : {};
    edit({
      ...def,
      nodes: [
        ...def.nodes,
        { id, kind, config, x: 120 + def.nodes.length * 30, y: 400 },
      ],
    });
    setSelected(id);
    setPane("node");
  }
  const node = def?.nodes.find((n) => n.id === selected),
    nodeRun = run?.nodes?.find((n: any) => n.node_id === selected);
  const nodeHistories = histories.filter(
    (h) => h.path === `/api/dac/select/${node?.config.queryId}`,
  );
  const matchesRun =
    !!run?.definition &&
    !!def &&
    executionSignature(def) === executionSignature(run.definition);
  const active = run && ["queued", "running"].includes(run.status);
  return (
    <div className="wf-page">
      <div className="wf-heading">
        <div>
          <h1>
            Workflows <span>데이터를 연결하는 작업 공간</span>
          </h1>
        </div>
        <span className="wf-engine">DuckDB · 최대 10,000행 / 노드</span>
      </div>
      <ErrorBox error={error} />
      {message && (
        <div className="wf-message" role="status">
          <CheckCircle2 size={15} />
          {message}
        </div>
      )}
      <div className="wf-toolbar">
        <button
          disabled={busy}
          onClick={() => {
            if (
              dirty &&
              !confirm(
                "저장하지 않은 변경이 있습니다. 목록으로 돌아갈까요? 변경은 이 브라우저에 임시 보관됩니다.",
              )
            )
              return;
            onBack();
          }}
        >
          ← 목록으로
        </button>
        <span className="wf-editor-name">{name || "이름을 입력하세요"}</span>
        <div className="wf-spacer" />
        <span className={dirty ? "wf-unsaved" : "wf-saved"}>
          {dirty ? "● 저장 전 변경" : "✓ 저장됨"}
        </span>
        <button
          disabled={busy || !def || invalidJson}
          onClick={() =>
            action(async () => {
              await save();
              setMessage("초안을 서버에 저장했습니다.");
            })
          }
        >
          <Save size={15} />
          저장
        </button>
        <button
          disabled={busy || !def || invalidJson}
          onClick={() =>
            action(async () => {
              await json("/api/workflows/validate", {
                method: "POST",
                body: JSON.stringify(def),
              });
              setMessage(
                "연결 · 참조 · 노드 설정 검증 통과. 컬럼 타입은 실행 시 검증합니다.",
              );
            })
          }
        >
          검증
        </button>
        <button
          disabled={busy || !def || invalidJson}
          onClick={() =>
            action(async () => {
              await json("/api/workflows/validate", {
                method: "POST",
                body: JSON.stringify(def),
              });
              const w = await save();
              const p = await json<Workflow>(`/api/workflows/${w.id}/publish`, {
                method: "POST",
                body: JSON.stringify({ revision: w.revision }),
              });
              setDoc(p);
                        setMessage(
                `v${p.published_version} 게시 완료. API에서 실행할 수 있습니다.`,
              );
            })
          }
        >
          <Upload size={15} />
          게시
        </button>
        <button
          className="primary"
          disabled={busy || !def || active || invalidJson}
          onClick={() => action(() => start(false))}
        >
          <Play size={15} />
          초안 테스트
        </button>
      </div>
      {!def ? (
        <div className="loading">워크플로우 편집기를 준비하고 있습니다…</div>
      ) : (
        <>
          <div className="wf-titlebar">
            <input
              aria-label="워크플로우 이름"
              placeholder="저장할 워크플로우 이름 (1~80자)"
              title="이 이름으로 저장됩니다. 변경 후 저장을 누르세요."
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
            />
            <span>
              {doc
                ? `revision ${doc.revision} · ${doc.published_version ? "published v" + doc.published_version : "미게시"}`
                : "로컬 초안"}{" "}
              · {def.nodes.length} nodes
            </span>
            <button
              onClick={() =>
                setPane((p) => (p === "inputs" ? "node" : "inputs"))
              }
            >
              실행 입력 / API
            </button>
          </div>
          <div className="wf-studio">
            <section className="wf-canvas-wrap" aria-label="워크플로우 캔버스">
              <div className="wf-palette">
                {(["query", "join", "merge", "filter", "output"] as Kind[]).map(
                  (k) => (
                    <button
                      key={k}
                      disabled={def.nodes.length >= 30 || busy}
                      onClick={() => add(k)}
                    >
                      <Plus size={13} />
                      {labels[k]}
                    </button>
                  ),
                )}
                <div className="wf-spacer" />
                <button
                  aria-label="실행 취소"
                  disabled={!past.length || busy}
                  onClick={() => {
                    setFuture((f) => [def, ...f]);
                    setDef(past[past.length - 1]);
                    setPast((p) => p.slice(0, -1));
                  }}
                >
                  <Undo2 size={15} />
                </button>
                <button
                  aria-label="다시 실행"
                  disabled={!future.length || busy}
                  onClick={() => {
                    setPast((p) => [...p, def]);
                    setDef(future[0]);
                    setFuture((f) => f.slice(1));
                  }}
                >
                  <Redo2 size={15} />
                </button>
                <button
                  aria-label="자동 정렬"
                  onClick={() => {
                    edit(arrange(def));
                    setTimeout(
                      () => flow.current?.fitView({ padding: 0.18 }),
                      80,
                    );
                  }}
                >
                  <LayoutGrid size={15} />
                </button>
              </div>
              <ReactFlow
                nodeTypes={nodeTypes}
                nodes={def.nodes.map((n) => ({
                  id: n.id,
                  type: "workflow",
                  width: 218,
                  height: 148,
                  measured: { width: 218, height: 148 },
                  position: { x: n.x, y: n.y },
                  selected: n.id === selected,
                  data: {
                    node: n,
                    status: matchesRun
                      ? run?.nodes?.find((r: any) => r.node_id === n.id)?.status
                      : undefined,
                    rows: matchesRun
                      ? run?.nodes?.find((r: any) => r.node_id === n.id)
                          ?.row_count
                      : undefined,
                  },
                }))}
                edges={def.edges.map((e) => ({
                  id: `${e.target}-${e.port}`,
                  source: e.source,
                  target: e.target,
                  sourceHandle: "out",
                  targetHandle: e.port,
                  label: e.port === "after" ? "API 값 전달" : e.port,
                  markerEnd: { type: MarkerType.ArrowClosed },
                  type: "smoothstep",
                  style: { stroke: "#818cf8", strokeWidth: 2 },
                }))}
                onInit={(i) => {
                  flow.current = { fitView: (options) => i.fitView(options) };
                }}
                onNodeClick={(_, n) => {
                  setSelected(n.id);
                  setPane("node");
                }}
                onNodesChange={(changes) => {
                  if (!changes.some((c) => c.type === "position" && c.position))
                    return;
                  setDef((d) =>
                    d
                      ? {
                          ...d,
                          nodes: d.nodes.map((n) => {
                            const c = changes.find(
                              (c) => c.type === "position" && c.id === n.id,
                            );
                            return c && c.type === "position" && c.position
                              ? { ...n, x: c.position.x, y: c.position.y }
                              : n;
                          }),
                        }
                      : d,
                  );
                }}
                onNodeDragStart={() => {
                  setPast((p) => [...p.slice(-29), structuredClone(def)]);
                  setFuture([]);
                }}
                onConnect={(c) =>
                  connect(c.source, c.target, c.targetHandle || "input")
                }
                isValidConnection={(c) =>
                  canConnect(def, c.source, c.target, c.targetHandle || "input")
                }
                onEdgeDoubleClick={(_, e) =>
                  edit({
                    ...def,
                    edges: def.edges.filter(
                      (x) => `${x.target}-${x.port}` !== e.id,
                    ),
                  })
                }
                fitView
                minZoom={0.25}
                maxZoom={1.5}
                deleteKeyCode={null}
              >
                <Background gap={20} size={1} />
                <Controls showInteractive={false} />
                <MiniMap pannable zoomable />
              </ReactFlow>
              <div className="wf-canvas-hint">
                포트를 끌어 연결 · 연결선을 두 번 눌러 해제 · 노드를 선택해 설정
              </div>
            </section>
            <aside className="wf-inspector">
              <div className="wf-tabs">
                <button
                  className={pane === "node" ? "active" : ""}
                  onClick={() => setPane("node")}
                >
                  노드 설정
                </button>
                <button
                  className={pane === "inputs" ? "active" : ""}
                  onClick={() => setPane("inputs")}
                >
                  실행 입력 / API
                </button>
              </div>
              {pane === "inputs" ? (
                <div className="wf-inspector-body">
                  <h3>워크플로우 입력</h3>
                  <p className="wf-muted">
                    기본값은 게시 버전에 포함됩니다. 실행할 때 값을 덮어쓸 수
                    있습니다.
                  </p>
                  <JsonEditor
                    onValidity={onValidity}
                    label="기본 실행 입력"
                    value={def.inputs}
                    onChange={(v) => edit({ ...def, inputs: v })}
                  />
                  <label className="wf-field">
                    이번 실행 입력
                    <textarea
                      aria-label="이번 실행 입력"
                      value={inputsText}
                      onChange={(e) => setInputsText(e.target.value)}
                    />
                  </label>
                  <h3>게시된 API</h3>
                  {doc?.published_version ? (
                    <>
                      <code className="wf-endpoint">
                        POST /api/workflow/{doc.id}
                      </code>
                      <label className="wf-field">
                        실행할 버전
                        <select
                          value={version}
                          onChange={(e) => setVersion(e.target.value)}
                        >
                          <option value="">
                            최신 게시 버전 (v{doc.published_version})
                          </option>
                          {versions.map((v) => (
                            <option key={v.version} value={v.version}>
                              v{v.version} · {when(v.created_at)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <pre>
                        {JSON.stringify(
                          {
                            version: Number(version) || doc.published_version,
                            inputs: def.inputs,
                          },
                          null,
                          2,
                        )}
                      </pre>
                      <button
                        disabled={busy || active}
                        onClick={() => action(() => start(true))}
                      >
                        <Play size={14} />
                        게시 버전 실행
                      </button>
                      <p className="wf-muted">
                        현재 편집 내용과 별개로 선택한 게시 버전을 실행합니다.
                        202 응답의 runId로 상태와 결과를 조회합니다.
                      </p>
                    </>
                  ) : (
                    <p className="wf-muted">
                      검증 후 게시하면 호출할 API가 생성됩니다.
                    </p>
                  )}
                </div>
              ) : node ? (
                <div className="wf-inspector-body" key={node.id}>
                  <div className="wf-inspector-title">
                    <span>
                      {labels[node.kind]} / {node.id}
                    </span>
                    <div>
                      <button
                        aria-label="노드 복제"
                        disabled={
                          node.kind === "output" || def.nodes.length >= 30
                        }
                        onClick={() => {
                          const clone = {
                            ...structuredClone(node),
                            id:
                              node.kind + "_" + crypto.randomUUID().slice(0, 6),
                            x: node.x + 30,
                            y: node.y + 140,
                          };
                          edit({ ...def, nodes: [...def.nodes, clone] });
                          setSelected(clone.id);
                        }}
                      >
                        <Copy size={14} />
                      </button>
                      <button
                        aria-label="노드 삭제"
                        onClick={() => {
                          edit({
                            ...def,
                            nodes: def.nodes.filter((n) => n.id !== node.id),
                            edges: def.edges.filter(
                              (e) =>
                                e.source !== node.id && e.target !== node.id,
                            ),
                          });
                          setSelected("");
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                  {ports(node.kind).map((port) => (
                    <label className="wf-field" key={port}>
                      {port === "after" ? "앞 API 연결 (선택)" : port + " 입력"}
                      <select
                        aria-label={port + " 입력"}
                        value={
                          def.edges.find(
                            (e) => e.target === node.id && e.port === port,
                          )?.source || ""
                        }
                        onChange={(e) =>
                          e.target.value
                            ? connect(e.target.value, node.id, port)
                            : edit({
                                ...def,
                                edges: def.edges.filter(
                                  (e) =>
                                    !(e.target === node.id && e.port === port),
                                ),
                              })
                        }
                      >
                        <option value="">연결 없음</option>
                        {def.nodes
                          .filter(
                            (n) => n.id !== node.id && n.kind !== "output",
                          )
                          .map((n) => (
                            <option key={n.id} value={n.id}>
                              {n.id} ·{" "}
                              {n.kind === "query"
                                ? n.config.queryId
                                : labels[n.kind]}
                            </option>
                          ))}
                      </select>
                    </label>
                  ))}
                  {node.kind === "query" && (
                    <>
                      <label className="wf-field">
                        query_id
                        <select
                          aria-label="워크플로우 query_id"
                          value={node.config.queryId}
                          onChange={(e) => {
                            const q = queries.find(
                              (q) => q.query_id === e.target.value,
                            )!;
                            changeNode({
                              queryId: q.query_id,
                              queryVersion: q.query_version,
                              body: q.default_body,
                            });
                          }}
                        >
                          {queries.map((q) => (
                            <option key={q.query_id} value={q.query_id}>
                              {q.query_id} · {q.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <small className="wf-muted">
                        고정 SQL 버전: {node.config.queryVersion}
                      </small>
                      <label className="wf-field">
                        히스토리에서 바디 복사
                        <select
                          aria-label="히스토리에서 바디 복사"
                          value=""
                          onChange={(e) => {
                            const h = nodeHistories.find(
                              (h) => h.id === e.target.value,
                            );
                            if (h)
                              changeNode({
                                ...node.config,
                                body: h.request,
                                historyId: h.id,
                              });
                          }}
                        >
                          <option value="">실행 이력 선택…</option>
                          {nodeHistories.map((h) => (
                            <option value={h.id} key={h.id}>
                              {h.status} · {when(h.createdAt)} ·{" "}
                              {h.request?.lot_id || "전체"} ·{" "}
                              {h.rowCount ?? "—"}행
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="wf-inline-actions">
                        <button
                          onClick={() => {
                            const q = queries.find(
                              (q) => q.query_id === node.config.queryId,
                            )!;
                            changeNode({
                              ...node.config,
                              body: q.default_body,
                              historyId: undefined,
                            });
                          }}
                        >
                          기본 바디
                        </button>
                        <button
                          onClick={() => {
                            const q = queries.find(
                              (q) => q.query_id === node.config.queryId,
                            )!;
                            changeNode({
                              ...node.config,
                              queryVersion: q.query_version,
                            });
                            setMessage(
                              "현재 카탈로그 버전으로 갱신했습니다. 바디도 확인하세요.",
                            );
                          }}
                        >
                          SQL 버전 갱신
                        </button>
                      </div>
                      <JsonEditor
                        onValidity={onValidity}
                        label="쿼리 요청 바디"
                        value={node.config.body}
                        onChange={(body) =>
                          changeNode({
                            ...node.config,
                            body,
                            historyId: undefined,
                          })
                        }
                      />
                      {node.config.historyId && (
                        <p className="wf-muted">
                          복사한 이력: {node.config.historyId}
                        </p>
                      )}
                      <details className="wf-binding-help">
                        <summary>입력 · 앞 API 결과 연결</summary>
                        <p>
                          문자열 템플릿 대신 값 위치에 아래 객체를 넣습니다.
                          숫자·문자·null 타입을 유지합니다.
                        </p>
                        <pre>{'{ "lot_id": { "$input": "lot_id" } }'}</pre>
                        <p>
                          앞 API를 after 입력에 연결한 뒤, 결과 행의 값을
                          사용합니다.
                        </p>
                        <pre>
                          {
                            '{ "lot_id": { "$node": "eds", "column": "lot_id", "row": 0 } }'
                          }
                        </pre>
                        <p>
                          row는 0부터 시작합니다. 여러 행 반복 호출은 지원하지
                          않습니다.
                        </p>
                      </details>
                    </>
                  )}
                  {node.kind === "join" && (
                    <>
                      <label className="wf-field">
                        조인 방식
                        <select
                          aria-label="조인 방식"
                          value={node.config.joinType}
                          onChange={(e) =>
                            changeNode({
                              ...node.config,
                              joinType: e.target.value,
                            })
                          }
                        >
                          <option value="inner">INNER · 일치하는 행</option>
                          <option value="left">LEFT · 왼쪽 행 유지</option>
                          <option value="full">FULL · 양쪽 모든 행</option>
                        </select>
                      </label>
                      <p className="wf-muted">
                        오른쪽 결과 컬럼에는 right_ 접두사가 붙습니다. null
                        키끼리는 매칭하지 않습니다.
                      </p>
                      {node.config.keys.map((k: any, i: number) => (
                        <div className="wf-rule" key={i}>
                          <input
                            aria-label={"왼쪽 조인 키 " + (i + 1)}
                            value={k.left}
                            placeholder="왼쪽 컬럼"
                            onChange={(e) =>
                              changeNode({
                                ...node.config,
                                keys: node.config.keys.map(
                                  (x: any, j: number) =>
                                    i === j
                                      ? { ...x, left: e.target.value }
                                      : x,
                                ),
                              })
                            }
                          />
                          <span>=</span>
                          <input
                            aria-label={"오른쪽 조인 키 " + (i + 1)}
                            value={k.right}
                            placeholder="오른쪽 컬럼"
                            onChange={(e) =>
                              changeNode({
                                ...node.config,
                                keys: node.config.keys.map(
                                  (x: any, j: number) =>
                                    i === j
                                      ? { ...x, right: e.target.value }
                                      : x,
                                ),
                              })
                            }
                          />
                          <button
                            aria-label={"조인 키 삭제 " + (i + 1)}
                            onClick={() =>
                              changeNode({
                                ...node.config,
                                keys: node.config.keys.filter(
                                  (_: any, j: number) => i !== j,
                                ),
                              })
                            }
                          >
                            ×
                          </button>
                        </div>
                      ))}
                      <button
                        disabled={node.config.keys.length >= 8}
                        onClick={() =>
                          changeNode({
                            ...node.config,
                            keys: [
                              ...node.config.keys,
                              { left: "", right: "" },
                            ],
                          })
                        }
                      >
                        + 조인 키
                      </button>
                    </>
                  )}
                  {node.kind === "merge" && (
                    <p className="wf-muted">
                      컬럼 이름으로 맞춰 행을 이어 붙입니다. 없는 컬럼은 null로
                      채우고 중복 행은 유지합니다. 같은 이름의 타입이 다르면
                      실행을 중단합니다.
                    </p>
                  )}
                  {node.kind === "filter" && (
                    <>
                      <p className="wf-muted">
                        모든 조건을 만족하는 행만 통과합니다 (AND).
                      </p>
                      {node.config.rules.map((r: any, i: number) => (
                        <div className="wf-filter-rule" key={i}>
                          <input
                            aria-label={"필터 컬럼 " + (i + 1)}
                            placeholder="컬럼 이름"
                            value={r.column}
                            onChange={(e) =>
                              changeNode({
                                ...node.config,
                                rules: node.config.rules.map(
                                  (x: any, j: number) =>
                                    i === j
                                      ? { ...x, column: e.target.value }
                                      : x,
                                ),
                              })
                            }
                          />
                          <select
                            aria-label={"필터 연산 " + (i + 1)}
                            value={r.op}
                            onChange={(e) =>
                              changeNode({
                                ...node.config,
                                rules: node.config.rules.map(
                                  (x: any, j: number) =>
                                    i === j ? { ...x, op: e.target.value } : x,
                                ),
                              })
                            }
                          >
                            {[
                              "eq",
                              "ne",
                              "gt",
                              "gte",
                              "lt",
                              "lte",
                              "contains",
                              "isNull",
                              "notNull",
                            ].map((op) => (
                              <option key={op}>{op}</option>
                            ))}
                          </select>
                          {!["isNull", "notNull"].includes(r.op) && (
                            <input
                              aria-label={"필터 값 " + (i + 1)}
                              value={String(r.value ?? "")}
                              onChange={(e) =>
                                changeNode({
                                  ...node.config,
                                  rules: node.config.rules.map(
                                    (x: any, j: number) =>
                                      i === j
                                        ? {
                                            ...x,
                                            value:
                                              typeof x.value === "number"
                                                ? Number(e.target.value)
                                                : typeof x.value === "boolean"
                                                  ? e.target.value === "true"
                                                  : e.target.value,
                                          }
                                        : x,
                                  ),
                                })
                              }
                            />
                          )}
                          <select
                            aria-label={"필터 값 타입 " + (i + 1)}
                            value={typeof r.value}
                            onChange={(e) =>
                              changeNode({
                                ...node.config,
                                rules: node.config.rules.map(
                                  (x: any, j: number) =>
                                    i === j
                                      ? {
                                          ...x,
                                          value:
                                            e.target.value === "number"
                                              ? 0
                                              : e.target.value === "boolean"
                                                ? true
                                                : "",
                                        }
                                      : x,
                                ),
                              })
                            }
                          >
                            <option value="number">숫자</option>
                            <option value="string">문자 / 날짜</option>
                            <option value="boolean">Boolean</option>
                          </select>
                          <button
                            onClick={() =>
                              changeNode({
                                ...node.config,
                                rules: node.config.rules.filter(
                                  (_: any, j: number) => j !== i,
                                ),
                              })
                            }
                          >
                            조건 삭제
                          </button>
                        </div>
                      ))}
                      <button
                        disabled={node.config.rules.length >= 20}
                        onClick={() =>
                          changeNode({
                            ...node.config,
                            rules: [
                              ...node.config.rules,
                              { column: "", op: "eq", value: "" },
                            ],
                          })
                        }
                      >
                        + 조건 추가
                      </button>
                    </>
                  )}
                  {node.kind === "output" && (
                    <p className="wf-muted">
                      이 노드의 결과를 실행 기록에 보존합니다. 아래 결과
                      테이블과 데이터 조회 API에서 확인할 수 있습니다.
                    </p>
                  )}
                </div>
              ) : (
                <div className="wf-inspector-body wf-muted">
                  캔버스에서 노드를 선택하세요.
                </div>
              )}
            </aside>
          </div>
          <section className="wf-execution">
            <div className="wf-execution-head">
              {run?.status === "succeeded" && <div className="wf-inline-actions"><button disabled={busy} onClick={()=>action(async()=>{const snapshot=await json("/api/sources",{method:"POST",body:JSON.stringify({kind:"workflow",runId:run.id})});location.hash="analysis?snapshot="+snapshot.id})}>분석 소스로 사용</button>{run.version && <a href={"#engines?workflow="+run.workflow_id+"&run="+run.id}>Engine Benchmark ↗</a>}</div>}
              <h2>
                실행 기록{" "}
                <small>
                  {run
                    ? `${run.version ? "v" + run.version : "초안"} · ${run.status}`
                    : "아직 실행하지 않았습니다"}
                </small>
              </h2>
              <select
                aria-label="워크플로우 실행 이력"
                value={runId}
                onChange={(e) => setRunId(e.target.value)}
              >
                <option value="">실행 선택…</option>
                {runId && !runs.some((r) => r.id === runId) && (
                  <option value={runId}>현재 실행</option>
                )}
                {runs.map((r) => (
                  <option key={r.id} value={r.id}>
                    {when(r.created_at)} · {r.status} ·{" "}
                    {r.version ? "v" + r.version : "초안"}
                  </option>
                ))}
              </select>
              {active && (
                <button
                  onClick={() =>
                    action(async () => {
                      await json(`/api/workflow-runs/${runId}/cancel`, {
                        method: "POST",
                      });
                      setMessage(
                        "취소를 요청했습니다. 실행 상태에서 완료 여부를 확인하세요.",
                      );
                    })
                  }
                >
                  <Square size={13} />
                  취소
                </button>
              )}
            </div>
            {run && (
              <>
                {!matchesRun && (
                  <div className="wf-snapshot-note">
                    선택한 실행은 현재 초안과 다른 정의입니다. 아래 결과는 실행
                    당시의 데이터입니다.{" "}
                    <button
                      onClick={() => {
                        if (
                          dirty &&
                          !confirm(
                            "현재 변경을 버리고 실행 당시 정의를 불러올까요?",
                          )
                        )
                          return;
                        edit(structuredClone(run.definition));
                        setInputsText(JSON.stringify(run.inputs, null, 2));
                        setMessage(
                          "실행 당시 정의를 초안으로 불러왔습니다. 저장 전 검토하세요.",
                        );
                      }}
                    >
                      실행 정의 불러오기
                    </button>
                  </div>
                )}
                <details className="wf-run-details">
                  <summary>실행 ID · 입력값</summary>
                  <div className="wf-run-meta">
                    <code>{run.id}</code>
                    <span>입력 {JSON.stringify(run.inputs)}</span>
                  </div>
                </details>
                {run.error && <ErrorBox error={run.error} />}
                <div
                  className="wf-steps"
                  role="tablist"
                  aria-label="실행 노드"
                  aria-orientation="horizontal"
                >
                  {run.nodes?.map((n: any) => (
                    <button
                      className={selected === n.node_id ? "active" : ""}
                      key={n.node_id}
                      role="tab"
                      id={`run-tab-${n.node_id}`}
                      aria-selected={selected === n.node_id}
                      aria-controls="workflow-node-result"
                      tabIndex={
                        selected === n.node_id ||
                        (!nodeRun && run.nodes[0]?.node_id === n.node_id)
                          ? 0
                          : -1
                      }
                      title={`${n.node_id} · ${n.status} · ${fmt(n.duration_ms)} ms · ${fmt(n.row_count)}행`}
                      onKeyDown={(event) => {
                        if (
                          !["ArrowLeft", "ArrowRight", "Home", "End"].includes(
                            event.key,
                          )
                        )
                          return;
                        event.preventDefault();
                        const tabs = Array.from(
                          event.currentTarget.parentElement!.querySelectorAll<HTMLButtonElement>(
                            '[role="tab"]',
                          ),
                        );
                        const index = tabs.indexOf(event.currentTarget);
                        const next =
                          event.key === "Home"
                            ? 0
                            : event.key === "End"
                              ? tabs.length - 1
                              : (index +
                                  (event.key === "ArrowRight" ? 1 : -1) +
                                  tabs.length) %
                                tabs.length;
                        tabs[next].focus();
                        tabs[next].click();
                        tabs[next].scrollIntoView({
                          block: "nearest",
                          inline: "nearest",
                        });
                      }}
                      onClick={() => {
                        setSelected(n.node_id);
                        setPane("node");
                      }}
                    >
                      <span className={"wf-status-dot " + n.status} />
                      <strong>{n.node_id}</strong>
                      <span className="wf-tab-status">{n.status}</span>
                    </button>
                  ))}
                </div>
                <div
                  role="tabpanel"
                  id="workflow-node-result"
                  aria-labelledby={nodeRun ? `run-tab-${selected}` : undefined}
                  aria-label={nodeRun ? undefined : "노드 실행 결과"}
                  tabIndex={0}
                >
                  <div className="wf-result-heading">
                    <strong>{nodeRun?.status || "실행되지 않은 노드"}</strong>
                    {nodeRun && <small>{fmt(nodeRun.duration_ms)} ms</small>}
                    {nodeRun?.query_version && (
                      <small>SQL v{nodeRun.query_version}</small>
                    )}
                    {result && (
                      <>
                        <span>{fmt(result.total)}행</span>
                        <button
                          onClick={() =>
                            download(
                              new Blob([csv(result.rows)], {
                                type: "text/csv;charset=utf-8",
                              }),
                              `workflow-${selected}-page.csv`,
                            )
                          }
                        >
                          현재 페이지 CSV
                        </button>
                      </>
                    )}
                  </div>
                  {nodeRun?.error && <ErrorBox error={nodeRun.error} />}{" "}
                  {nodeRun?.request && (
                    <details className="wf-resolved">
                      <summary>실제로 실행한 요청 바디</summary>
                      <pre>{JSON.stringify(nodeRun.request, null, 2)}</pre>
                    </details>
                  )}
                  {result ? (
                    <>
                      <div className="wf-result-table">
                        <table>
                          <thead>
                            <tr>
                              {result.columns.map((c: any) => (
                                <th key={c.name}>
                                  {c.name}
                                  <small>{c.type}</small>
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {result.rows.map((r: any, i: number) => (
                              <tr key={i}>
                                {result.columns.map((c: any) => (
                                  <td key={c.name}>
                                    {r[c.name] == null ? (
                                      <span className="wf-muted">null</span>
                                    ) : (
                                      String(r[c.name])
                                    )}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {!result.rows.length && (
                          <p className="wf-muted">
                            조건에 맞는 데이터가 없습니다. 컬럼 정보는
                            유지됩니다.
                          </p>
                        )}
                      </div>
                      <div className="wf-pagination">
                        <span>
                          {offset + 1}–{Math.min(offset + 50, result.total)} /{" "}
                          {fmt(result.total)}
                        </span>
                        <button
                          disabled={!offset}
                          onClick={() => setOffset((o) => Math.max(0, o - 50))}
                        >
                          이전
                        </button>
                        <button
                          disabled={offset + 50 >= result.total}
                          onClick={() => setOffset((o) => o + 50)}
                        >
                          다음
                        </button>
                      </div>
                    </>
                  ) : (
                    <p className="wf-muted">
                      완료된 노드를 선택하면 스키마와 데이터를 확인할 수
                      있습니다.
                    </p>
                  )}
                </div>
              </>
            )}
            {!run && (
              <div className="wf-empty">
                <GitBranch size={28} />
                <p>
                  초안을 테스트하면 각 노드의 실행 시간과 결과가 여기에
                  표시됩니다.
                </p>
                <small>
                  브라우저를 닫아도 서버 실행은 계속됩니다. 실행 이력에서 다시
                  확인할 수 있습니다.
                </small>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
