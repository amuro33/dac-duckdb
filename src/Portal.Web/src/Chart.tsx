import { useEffect, useRef, useState } from "react";
import * as echarts from "echarts/core";
import { ScatterChart } from "echarts/charts";
import {
  GridComponent,
  LegendComponent,
  TooltipComponent,
  DataZoomComponent,
} from "echarts/components";
import { LabelLayout } from "echarts/features";
import { CanvasRenderer } from "echarts/renderers";
echarts.use([
  ScatterChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  DataZoomComponent,
  CanvasRenderer,
  LabelLayout,
]);
import type { Panel, Spec } from "./types";
import {
  duration,
  packCoordinates,
  type RenderMeasure,
} from "./chartPerformance";
const palette = [
  "#387a8a",
  "#d39b4b",
  "#8263a0",
  "#5b927b",
  "#cc6f67",
  "#7483b3",
  "#b18c66",
  "#557966",
  "#b67998",
  "#6f929e",
];
function color(key: string) {
  let h = 0;
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) | 0;
  return palette[Math.abs(h) % palette.length];
}
export function Chart({
  spec,
  panel,
  onPoint,
  batchId = 0,
  onRendered,
}: {
  spec: Spec;
  panel: Panel;
  onPoint?: (v: unknown) => void;
  batchId?: number;
  onRendered?: (m: RenderMeasure) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<echarts.EChartsType | null>(null);
  const previous = useRef<{ spec: Spec; panel: Panel } | undefined>(undefined);
  const callback = useRef(onPoint);
  callback.current = onPoint;
  const report = useRef(onRendered);
  report.current = onRendered;
  const frame = useRef(0);
  const [measurement, setMeasurement] = useState<RenderMeasure>();
  const [renderError, setRenderError] = useState("");
  useEffect(
    () => () => {
      cancelAnimationFrame(frame.current);
      instanceRef.current?.dispose();
      instanceRef.current = null;
      previous.current = undefined;
    },
    [],
  );
  useEffect(() => {
    const dom = ref.current!;
    const started = performance.now();
    const instance = instanceRef.current ?? echarts.init(dom);
    if (!instanceRef.current) {
      instanceRef.current = instance;
      instance.on("click", (v: any) =>
        callback.current?.({
          series: v.seriesName,
          x: v.value?.[0],
          y: v.value?.[1],
        }),
      );
    }
    const old = previous.current;
    const appearance =
      !!old &&
      old.panel === panel &&
      old.spec.x === spec.x &&
      old.spec.y === spec.y &&
      old.spec.xType === spec.xType &&
      old.spec.showLabels === spec.showLabels &&
      old.spec.labelColumn === spec.labelColumn;
    const mode =
      !spec.showLabels && spec.plottedRows > 20000 ? "large" : "normal";
    const points = panel.series.reduce((n, s) => n + s.points.length, 0);
    cancelAnimationFrame(frame.current);
    delete dom.dataset.renderMs;
    delete dom.dataset.renderReady;
    dom.dataset.renderStarted = String(started);
    dom.dataset.pointCount = String(points);
    dom.dataset.labels = String(!!spec.showLabels);
    dom.dataset.renderMode = mode;
    dom.dataset.update = appearance ? "appearance" : "data";
    setMeasurement(undefined);
    setRenderError("");
    let complete = false,
      preparedAt = started,
      active = true;
    const finished = () => {
      if (complete || !active) return;
      complete = true;
      const ended = performance.now();
      dom.dataset.renderMs = (ended - started).toFixed(1);
      frame.current = requestAnimationFrame(() => {
        frame.current = requestAnimationFrame(() => {
          if (!active) return;
          const m: RenderMeasure = {
            batchId,
            key: panel.key,
            startedAt: started,
            finishedAt: ended,
            readyAt: performance.now(),
            prepareMs: preparedAt - started,
            renderMs: ended - started,
            points,
            mode,
            update: appearance ? "appearance" : "data",
          };
          dom.dataset.renderReady = "true";
          setMeasurement(m);
          report.current?.(m);
        });
      });
    };
    instance.on("finished", finished);
    try {
      if (appearance) {
        preparedAt = performance.now();
        instance.setOption({
          series: panel.series.map((s) => ({
            id: s.key,
            symbolSize: spec.pointSize ?? (spec.plottedRows > 5000 ? 3.5 : 6),
            label: { fontSize: spec.labelFontSize ?? 11 },
          })),
        });
      } else {
        const categories =
          spec.xType === "string"
            ? [
                ...new Set(
                  panel.series.flatMap((s) => s.points.map((p) => String(p.x))),
                ),
              ]
            : [];
        const option = {
          animation: false,
          useUTC: true,
          backgroundColor: "transparent",
          textStyle: { fontFamily: "Arial, sans-serif", fontSize: 11 },
          tooltip: { trigger: "item", confine: true, renderMode: "richText" },
          legend: {
            type: "scroll",
            top: 4,
            left: 16,
            right: 16,
            itemWidth: 8,
            itemHeight: 8,
            textStyle: { fontSize: 11, color: "#66737d" },
          },
          grid: { left: 62, right: 28, top: 54, bottom: 70 },
          xAxis: {
            type:
              spec.xType === "date"
                ? "time"
                : spec.xType === "number"
                  ? "value"
                  : "category",
            name: spec.x,
            nameLocation: "middle",
            nameGap: 34,
            nameTextStyle: { color: "#8b949d", fontSize: 10 },
            axisLine: { lineStyle: { color: "#ced5d9" } },
            axisLabel: {
              color: "#84909b",
              hideOverlap: true,
              ...(spec.xType === "date"
                ? { formatter: "{yyyy}-{MM}-{dd}\n{HH}:{mm}" }
                : {}),
            },
            splitLine: { show: true, lineStyle: { color: "#edf0f2" } },
            ...(spec.xType === "string"
              ? { data: categories }
              : { scale: true }),
          },
          yAxis: {
            type: "value",
            name: spec.y,
            scale: true,
            axisLabel: { color: "#84909b" },
            splitLine: { lineStyle: { color: "#edf0f2" } },
            nameTextStyle: { color: "#8b949d", fontSize: 10 },
          },
          dataZoom: [
            { type: "inside" },
            {
              type: "slider",
              height: 14,
              bottom: 4,
              borderColor: "transparent",
              backgroundColor: "#f3f5f6",
              fillerColor: "#dfe9eb",
              handleSize: 14,
            },
          ],
          series: panel.series.map((s) => ({
            id: s.key,
            name: s.name,
            type: "scatter",
            symbolSize: spec.pointSize ?? (spec.plottedRows > 5000 ? 3.5 : 6),
            data:
              !spec.showLabels && spec.xType !== "string"
                ? packCoordinates(s.points)
                : s.points.map((p) =>
                    spec.showLabels ? [p.x, p.y, p.label ?? ""] : [p.x, p.y],
                  ),
            dimensions: spec.showLabels ? ["x", "y", "label"] : ["x", "y"],
            encode: { x: 0, y: 1 },
            label: {
              show: !!spec.showLabels,
              position: "top",
              distance: 4,
              fontSize: spec.labelFontSize ?? 11,
              color: "#435462",
              formatter: (p: any) => String(p.value[2] ?? ""),
            },
            labelLayout: { hideOverlap: true },
            itemStyle: { color: color(s.key), opacity: 0.7 },
            emphasis: { focus: "series" },
            large: !spec.showLabels && spec.plottedRows > 20000,
            largeThreshold: 2000,
            progressive: spec.showLabels ? 0 : 10000,
          })),
        };
        preparedAt = performance.now();
        instance.setOption(option, { notMerge: true });
      }
      previous.current = { spec, panel };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setRenderError(message);
      complete = true;
      const end = performance.now();
      report.current?.({
        batchId,
        key: panel.key,
        startedAt: started,
        finishedAt: end,
        readyAt: end,
        prepareMs: 0,
        renderMs: end - started,
        points,
        mode,
        update: "data",
        error: message,
      });
    }
    let resizeFrame = 0;
    const resize = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (
        Math.abs(width - instance.getWidth()) > 0.5 ||
        Math.abs(height - instance.getHeight()) > 0.5
      ) {
        cancelAnimationFrame(resizeFrame);
        resizeFrame = requestAnimationFrame(() => instance.resize());
      }
    });
    resize.observe(dom);
    return () => {
      active = false;
      cancelAnimationFrame(frame.current);
      cancelAnimationFrame(resizeFrame);
      resize.disconnect();
      instance.off("finished", finished);
    };
  }, [spec, panel, batchId]);
  return (
    <>
      <div
        ref={ref}
        className="plot"
        role="img"
        aria-label={`${panel.name} 산점도`}
      />
      <div
        className="chart-render-stat"
        title="데이터 준비·ECharts 처리 시작부터 finished까지. 화면 표시 시간은 상단에서 별도 측정합니다."
      >
        {renderError ? (
          <span role="alert">그리기 실패: {renderError}</span>
        ) : measurement ? (
          <>
            <span>
              그리기 <b>{duration(measurement.renderMs)}</b>
            </span>
            <span>
              {measurement.update === "appearance" ? "인스턴스 재사용 · " : ""}
              {measurement.mode === "large" ? "Canvas 대량" : "Canvas"} · 준비{" "}
              {duration(measurement.prepareMs)}
            </span>
          </>
        ) : (
          <span>차트 그리는 중…</span>
        )}
      </div>
    </>
  );
}
