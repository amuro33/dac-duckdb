import { useEffect, useState } from "react";
import { data } from "./api";
import { engineNames, type Engine } from "./engines";

export function EnginePicker({
  value,
  onChange,
  disabled = false,
}: {
  value: Engine;
  onChange: (e: Engine) => void;
  disabled?: boolean;
}) {
  const [status, setStatus] = useState<any>();
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    data("/api/streams/engines", "GET", undefined, false, controller.signal)
      .then(setStatus)
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, []);
  const selected =
    value === "duckdb" ? status?.duckdb : status?.remote?.[value];
  return (
    <label className="engine-picker">
      변환 엔진
      <select
        aria-label="변환 엔진"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as Engine)}
      >
        {(Object.keys(engineNames) as Engine[]).map((engine) => {
          const health =
            engine === "duckdb" ? status?.duckdb : status?.remote?.[engine];
          return (
            <option
              key={engine}
              value={engine}
              disabled={health?.available === false}
            >
              {engineNames[engine]}
              {health?.available === false ? " · 연결 안 됨" : ""}
            </option>
          );
        })}
      </select>
      <small className="engine-note">
        {error
          ? "엔진 상태를 확인하지 못했습니다"
          : selected?.available === false
            ? "선택한 엔진에 연결할 수 없습니다"
            : value === "spark"
              ? `워커 ${selected?.workerCount ?? "—"}개 · 물리 서버 ${selected?.physicalHosts ?? "—"}대${selected?.deployment === "colocated-containers" ? " · 같은 서버의 컨테이너" : ""}`
              : value === "duckdb"
                ? "서비스 내부 SQL 실행 · 2 threads"
                : value === "datafusion"
                  ? "Arrow 기반 쿼리 실행 · 단일 프로세스"
                  : "별도 SQL 조회 서비스 · 단일 Drillbit"}
      </small>
    </label>
  );
}
