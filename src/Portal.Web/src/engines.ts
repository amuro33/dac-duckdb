import { data } from "./api";
import type { Config } from "./types";

export const engineNames = {
  duckdb: "DuckDB",
  spark: "Apache Spark",
  datafusion: "Apache DataFusion",
  drill: "Apache Drill",
};
export type Engine = keyof typeof engineNames;
export type Execution = {
  engine: Engine;
  preparationMs: number;
  engineMs: number;
  totalMs: number;
  resultFiles: number;
  details?: any;
};

function pause(signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    signal.throwIfAborted();
    const stop = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", stop);
      resolve();
    }, 1000);
    signal.addEventListener("abort", stop, { once: true });
  });
}

// Preserve the original immutable Kafka snapshot when changing the compute engine.
export async function prepareAnalysis(
  config: Config,
  signal: AbortSignal,
  progress: (s: string) => void,
): Promise<{ config: Config; execution?: Execution; createdDataset?: boolean }> {
  if (config.source !== "joined" && config.source !== "transformed")
    return { config };
  let id = config.datasetId;
  let feedId: string | undefined;
  let engine = config.engine ?? "duckdb";
  if (config.source === "transformed") {
    const original = await data(
      `/api/streams/datasets/${id}`,
      "GET",
      undefined,
      false,
      signal,
    );
    const actual: Engine = original.dataset.config.engine ?? "duckdb";
    engine = config.engine ?? actual;
    if (engine === actual)
      return {
        config: { ...config, engine, datasetEngine: actual },
        execution: original.result[0]?.execution,
      };
    progress(`${engineNames[engine]} · 같은 원본으로 재분석 요청 중`);
    id = (
      await data(
        `/api/streams/datasets/${id}/analyze`,
        "POST",
        { engine },
        true,
        signal,
      )
    ).id;
  } else {
    progress(`${engineNames[engine]} · 원본 수집 요청 중`);
    feedId = (
      await data(
        "/api/streams/feeds",
        "POST",
        {
          name: `분석 · ${engineNames[engine]}`,
          sampleSize: config.sampleSize,
          lotId: config.lotId,
          intervalSeconds: 60,
          operation: "join",
          joinType: "full",
          engine,
          maxRuns: 1,
        },
        true,
        signal,
      )
    ).id;
    id = undefined;
  }
  const deadline = Date.now() + 25 * 60 * 1000;
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    if (!id) {
      const datasets = await data(
        "/api/streams/datasets",
        "GET",
        undefined,
        false,
        signal,
      );
      id = datasets.find((d: any) => d.feedId === feedId)?.id;
    }
    if (id) {
      const detail = await data(
        `/api/streams/datasets/${id}`,
        "GET",
        undefined,
        false,
        signal,
      );
      const state = detail.dataset.status;
      if (state === "failed")
        throw Error(detail.result[0]?.error ?? "변환 실패");
      if (state === "ready")
        return {
          createdDataset: true,
          config: {
            ...config,
            source: "transformed",
            datasetId: id,
            engine,
            datasetEngine: engine,
            sampleSize: null,
            lotId: null,
          },
          execution: detail.result[0]?.execution,
        };
      const label: Record<string, string> = {
        publishing: "원본 수집·Kafka 발행",
        published: "입력 수신·실행 대기",
        processing: "변환·결과 저장",
      };
      progress(
        `${engineNames[engine]} · ${label[state] ?? state} · ${id.slice(0, 8)}`,
      );
    }
    await pause(signal);
  }
  throw Error(
    "분석 대기 시간이 초과되었습니다. Data streams에서 서버 작업 상태를 확인하세요.",
  );
}
