import { engineNames, type Engine } from "./engines";
export function EnginePicker({ value }: {value: Engine; onChange: (e: Engine) => void; disabled?: boolean}) {
 return <div className="engine-picker"><small>현재 데이터 처리: {engineNames[value]}</small><p><a href="#engines">DuckDB · Spark · DataFusion VS 비교 ↗</a></p></div>;
}
