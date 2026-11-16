import { useState } from "react";
import { SourcePicker, type SourceSnapshot } from "./SourcePicker";
import { Analysis as AnalysisStudio } from "./Analysis";
import { initial, type Config } from "./types";
import { Empty } from "./ui";
export function sourceConfig(s: SourceSnapshot): Config {
  const x =
    s.columns.find((c) => c.type === "date") ??
    s.columns.find((c) => c.type === "string") ??
    s.columns[0];
  const y =
    s.columns.find(
      (c) =>
        c.type === "number" && /yield|defect_count|avg_value/i.test(c.name),
    ) ?? s.columns.find((c) => c.type === "number");
  return {
    ...initial,
    source: "snapshot",
    datasetId: s.id,
    x: x?.name || "",
    xType:
      x?.type === "date" ? "date" : x?.type === "number" ? "number" : "string",
    y: y?.name || "",
    category: null,
    legend: null,
    lotId: null,
    sampleSize: null,
  };
}
export function SourceAnalysis({
  start,
  notify,
}: {
  start: Config;
  notify: (s: string) => void;
}) {
  const [snapshot, setSnapshot] = useState<SourceSnapshot | null>(null),
    [config, setConfig] = useState<Config | null>(null),
    [legacy, setLegacy] = useState(start.source !== "snapshot");
  if (legacy)
    return (
      <>
        <p className="source-note">
          기존 저장 분석 / 스트림 데이터입니다.{" "}
          <button onClick={() => setLegacy(false)}>
            워크플로우·API 소스로 변경
          </button>
        </p>
        <AnalysisStudio start={start} notify={notify} />
      </>
    );
  return (
    <>
      <details className="source-selector" open={!snapshot}>
        <summary>
          데이터 소스{" "}
          {snapshot
            ? "· " +
              snapshot.name +
              " · " +
              snapshot.row_count.toLocaleString() +
              "행"
            : "· 워크플로우 / API 선택"}
        </summary>
        <SourcePicker
          initialId={start.datasetId}
          onSelect={(s) => {
            setSnapshot(s);
            setConfig(
              start.datasetId === s.id && start.x && start.y
                ? start
                : sourceConfig(s),
            );
            const savedView = new URLSearchParams(location.hash.split("?")[1]).has("view");
            if (!savedView || start.datasetId !== s.id)
              history.replaceState(null, "", "#analysis?snapshot=" + s.id);
          }}
        />
      </details>
      {config && config.y ? (
        <AnalysisStudio key={config.datasetId} start={config} notify={notify} />
      ) : (
        <Empty
          title={
            snapshot
              ? "숫자 컬럼이 없습니다"
              : "분석할 데이터 소스를 선택하세요"
          }
          description={
            snapshot
              ? "산점도의 Y축에는 숫자 컬럼이 필요합니다. 다른 API나 워크플로우 결과를 선택하세요."
              : "게시된 워크플로우를 실행하거나 API 결과를 불러온 후 컬럼으로 차트를 구성합니다."
          }
        />
      )}
    </>
  );
}
