import { useEffect, useState } from "react";
import { EngineVs as LegacyEngineVs } from "./LegacyEngineVs";
import { json, fmt, when, csv, download } from "./api";
import { PageHeading, ErrorBox } from "./ui";
import { engineNames } from "./engines";
import "./sources.css";
const engines = ["duckdb", "spark", "datafusion"] as const;
export function EngineVs() {
  const params = new URLSearchParams(location.hash.split("?")[1]);
  const [workflows, setWorkflows] = useState<any[]>([]), [workflow, setWorkflow] = useState(params.get("workflow") || ""),
    [versions, setVersions] = useState<any[]>([]), [version, setVersion] = useState(""),
    [runs, setRuns] = useState<any[]>([]), [previous, setPrevious] = useState(params.get("run") || ""),
    [inputs, setInputs] = useState("{}"), [loading, setLoading] = useState(false),
    [definition, setDefinition] = useState<any>(null), [history, setHistory] = useState<any[]>([]),
    [runId, setRunId] = useState(() => sessionStorage.getItem("workflow-benchmark-run") || ""),
    [run, setRun] = useState<any>(null), [error, setError] = useState(""), [sending, setSending] = useState(false), [legacy, setLegacy] = useState(false);
  const busy = sending || ["queued", "running"].includes(run?.status);
  useEffect(() => { json("/api/workflows").then(w => { setWorkflows(w); setWorkflow(id => id || w.find((x:any) => x.published_version)?.id || ""); }).catch(e => setError(e.message)); }, []);
  useEffect(() => {
    if (!workflow) return;
    const controller = new AbortController();setLoading(true);setDefinition(null);setVersion("");
    Promise.all([json(`/api/workflows/${workflow}/versions`,{signal:controller.signal}),json(`/api/workflows/${workflow}/runs`,{signal:controller.signal})])
      .then(([v,r]) => {setVersions(v);setVersion(v[0]?.version.toString() || "");setRuns(r.filter((x:any)=>x.status === "succeeded" && x.version));})
      .catch(e=>{if(!controller.signal.aborted)setError(e.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return ()=>controller.abort();
  },[workflow]);
  useEffect(()=>{
    if(!workflow || !version)return;
    const controller=new AbortController();setLoading(true);
    json(`/api/workflows/${workflow}/versions/${version}`,{signal:controller.signal}).then(v=>{setDefinition(v.definition);setInputs(JSON.stringify(v.definition.inputs,null,2));})
      .catch(e=>{if(!controller.signal.aborted)setError(e.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return ()=>controller.abort();
  },[workflow,version]);
  useEffect(()=>{json("/api/source-comparisons").then(h=>setHistory(h.filter((x:any)=>x.config.operation === "workflow"))).catch(e=>setError(e.message));},[run?.status]);
  useEffect(()=>{
    if(!runId)return;
    sessionStorage.setItem("workflow-benchmark-run",runId);
    let live=true,timer:ReturnType<typeof setTimeout>;
    async function poll(){try{const r=await json("/api/source-comparisons/"+runId);if(!live)return;setRun(r);if(["queued","running"].includes(r.status))timer=setTimeout(poll,700);}catch(e:any){if(live)setError(e.message);}}
    poll();return()=>{live=false;clearTimeout(timer);};
  },[runId]);
  async function benchmark(){
    setSending(true);setError("");
    try{
      const body=previous?{runId:previous}:{workflowId:workflow,version:Number(version),inputs:JSON.parse(inputs)};
      const response=await json("/api/workflow-benchmarks",{method:"POST",body:JSON.stringify(body)});
      setRun({status:"queued",config:{workflowName:workflows.find(w=>w.id===workflow)?.name,version},results:{}});setRunId(response.id);
    }catch(e:any){setError(e.message);}finally{setSending(false);}
  }
  const results=run?.results || {}, complete=engines.every(e=>results[e]?.state === "succeeded"), best=complete?Math.min(...engines.map(e=>results[e].totalMs)):0;
  if(legacy)return <><button onClick={()=>setLegacy(false)}>← Workflow Benchmark</button><LegacyEngineVs/></>;
  return <div className="source-results">
    <PageHeading title="Engine Benchmark" description="게시된 워크플로우를 같은 입력으로 재실행하고 세 엔진의 계산 결과와 시간을 비교합니다." actions={<button onClick={()=>setLegacy(true)}>기존 스트림 벤치마크</button>}/>
    <ErrorBox error={error}/>
    <section className="source-picker">
      <div className="source-heading"><strong>벤치마크할 워크플로우</strong><span>연산은 Workflows에서 정의합니다</span></div>
      <div className="source-fields">
        <label>워크플로우<select aria-label="벤치마크 워크플로우" disabled={busy} value={workflow} onChange={e=>{setWorkflow(e.target.value);setPrevious("");}}><option value="">선택하세요</option>{workflows.filter(w=>w.published_version).map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
        <label>입력 준비<select aria-label="벤치마크 실행 선택" disabled={busy||loading} value={previous} onChange={e=>setPrevious(e.target.value)}><option value="">게시 버전 새로 실행</option>{runs.map(r=><option key={r.id} value={r.id}>{when(r.created_at)} · v{r.version} · {r.id.slice(0,8)}</option>)}</select></label>
        {!previous&&<label>게시 버전<select aria-label="벤치마크 게시 버전" disabled={busy||loading} value={version} onChange={e=>setVersion(e.target.value)}><option value="">선택하세요</option>{versions.map(v=><option key={v.version} value={v.version}>v{v.version}</option>)}</select></label>}
      </div>
      {!previous&&<label className="source-body">워크플로우 실행 입력<textarea aria-label="벤치마크 입력" disabled={busy||loading} spellCheck={false} value={inputs} onChange={e=>setInputs(e.target.value)}/></label>}
      {!previous&&definition&&<p className="source-note">{definition.nodes.length}개 노드 · {definition.nodes.filter((n:any)=>n.kind==="query").length}개 API · {definition.nodes.filter((n:any)=>["join","merge","filter"].includes(n.kind)).length}개 변환</p>}
      {previous&&<p className="source-note">선택한 성공 실행에 저장된 정의·입력·Query 결과를 재사용합니다. 현재 초안이나 최신 API를 다시 읽지 않습니다.</p>}
      <div className="source-actions"><button className="primary" disabled={busy||loading||!workflow||(!previous&&!version)} onClick={benchmark}>{busy?"서버에서 벤치마크 실행 중…":"워크플로우 벤치마크 실행"}</button>{workflow&&<a href={"#workflows?id="+workflow}>워크플로우 편집 ↗</a>}</div>
      <p className="source-note">새 실행은 API 연계와 전체 워크플로우를 먼저 실행해 기준 결과를 만듭니다. 이후 Query 결과를 고정하고, 각 엔진이 Join·Filter·Merge를 연결 순서대로 직접 계산합니다. 준비 실행 시간은 엔진 비교에서 제외합니다. 화면을 닫아도 서버 실행은 계속됩니다.</p>
    </section>
    <div className="source-run-toolbar"><select aria-label="벤치마크 기록" value={runId} onChange={e=>{setRun(null);setRunId(e.target.value);}}><option value="">실행 기록 선택</option>{runId&&!history.some(h=>h.id===runId)&&<option value={runId}>현재 실행</option>}{history.map(h=><option key={h.id} value={h.id}>{when(h.created_at)} · {h.config.workflowName} · v{h.config.version} · {h.status}</option>)}</select>
    {complete&&<button onClick={()=>download(new Blob([csv(engines.map(e=>({engine:e,workflow:run.config.workflowName,version:run.config.version,runId:run.config.runId,totalMs:results[e].totalMs,engineMs:results[e].engineMs,preparationMs:results[e].preparationMs,rowCount:results[e].rowCount,resultHash:results[e].resultHash,matchesBaseline:results[e].matchesBaseline})))],{type:"text/csv;charset=utf-8"}),"workflow-benchmark.csv")}>비교 CSV</button>}</div>
    {run&&<section className="source-workload"><h3>{run.config.workflowName} · v{run.config.version} · {run.status}</h3><p className="source-note">표시 중인 기록의 조건입니다. 위 선택을 바꿔도 기존 결과는 변경되지 않습니다.</p>{run.config.baselineNodeMs!=null?<p>기준 실행 노드 합계 {fmt(run.config.baselineNodeMs)} ms · 고정 Query 입력 {fmt(run.config.queryRows)}행</p>:busy&&<p>워크플로우 입력 준비 또는 실행 대기 중…</p>}<details><summary>실행 정의 · 입력 · 기준 실행 ID</summary><pre>{JSON.stringify(run.config,null,2)}</pre></details></section>}
    <ErrorBox error={run?.error||""}/>
    <div className="vs-grid">{engines.map(e=>{const r=results[e];return <section className="panel vs-card" key={e}><div className="eyebrow">{r?.state||"대기"}</div><h2>{engineNames[e]}</h2><div className="vs-time">{r?.totalMs!=null?(r.totalMs/1000).toFixed(3):"—"} <small>초</small></div><p>노드별 입력 준비 + 엔진 실행 합계</p><dl><dt>입력 준비</dt><dd>{fmt(r?.preparationMs)} ms</dd><dt>엔진 계산·결과 수집</dt><dd>{fmt(r?.engineMs)} ms</dd><dt>큐 대기 (별도)</dt><dd>{fmt(r?.queueMs)} ms</dd><dt>Output 행</dt><dd>{fmt(r?.rowCount)}</dd></dl>{r?.error&&<ErrorBox error={r.error}/>} {complete&&<p className="notice">{r.totalMs===best?"이번 실행 최단 시간":`최단 시간의 ${(r.totalMs/best).toFixed(2)}배`} · 기준 Output {r.matchesBaseline?"일치":"불일치"}</p>}
    {r?.nodes&&<details><summary>노드별 실행 결과</summary><div className="table-wrap"><table><thead><tr><th>노드</th><th>유형</th><th>행</th><th>시간 ms</th></tr></thead><tbody>{r.nodes.map((n:any)=><tr key={n.nodeId}><td>{n.nodeId}</td><td>{n.kind}</td><td>{fmt(n.rowCount)}</td><td>{n.state==="captured"?"고정 입력":n.state==="forwarded"?"전달":fmt(n.totalMs)}</td></tr>)}</tbody></table></div></details>}
    {r?.state==="succeeded"&&<details><summary>환경 · 입력 해시 · Output 미리보기</summary><pre>{JSON.stringify({details:r.details,inputHashes:r.inputHashes,resultHash:r.resultHash,preview:r.preview},null,2)}</pre></details>}</section>})}</div>
    {complete&&<p className="notice">{results.equivalent?"세 엔진의 전체 Output이 일치합니다.":"엔진 간 Output이 다릅니다. 노드별 결과를 확인하세요."} 숫자는 소수 6자리로 정규화하고 행 순서는 제외하며 중복을 유지합니다.</p>}
    <p className="source-note">노드마다 결과를 수집하고 다음 입력을 준비하는 실행 방식입니다. 전체 그래프를 단일 SQL로 최적화한 성능과는 다릅니다. API 호출·기준 실행·네트워크 시간은 엔진 시간에 포함하지 않습니다. Query→Output만 있으면 고정 입력 조회를 측정합니다. Spark 워커 2개는 동일 물리 서버에 있습니다. 노드당 최대 1만 행/8MB입니다.</p>
    <section className="source-workload"><h3>Apache Drill</h3><a href={`${location.protocol}//${location.hostname}:8047`} target="_blank" rel="noreferrer">자체 SQL 콘솔 열기 ↗</a></section>
  </div>;
}
