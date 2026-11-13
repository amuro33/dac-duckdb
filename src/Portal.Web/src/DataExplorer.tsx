import { useEffect, useMemo, useState } from "react";
import {
  Download,
  Search,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Play,
} from "lucide-react";
import { data, csv, download, fmt } from "./api";
import { PageHeading, ErrorBox, Loading, Empty } from "./ui";
import { initial, type Config } from "./types";
export function DataExplorer({ analyze }: { analyze: (c: Config) => void }) {
  const [source, setSource] = useState("eds");
  const [lot, setLot] = useState("");
  const [rows, setRows] = useState<Record<string, any>[]>([]);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState({ key: "", desc: false });
  const [loadedLot, setLoadedLot] = useState("");
  async function load(signal?: AbortSignal) {
    setBusy(true);
    setError("");
    try {
      const r = await data(
        `/api/dac/${source === "eds" ? "get_eds_data" : "get_defect_data"}?limit=1000${lot ? "&lotId=" + encodeURIComponent(lot) : ""}`,
        "GET",
        undefined,
        true,
        signal,
      );
      setRows(r);
      setLoadedLot(lot);
      setPage(0);
    } catch (e: any) {
      if (!signal?.aborted) setError(e.message);
    } finally {
      if (!signal?.aborted) setBusy(false);
    }
  }
  useEffect(() => {
    const a = new AbortController();
    load(a.signal);
    return () => a.abort();
  }, [source]);
  const keys = rows.length ? Object.keys(rows[0]) : [];
  const filtered = useMemo(() => {
    const out = rows.filter((r) =>
      Object.values(r).some((v) =>
        String(v).toLowerCase().includes(search.toLowerCase()),
      ),
    );
    if (sort.key)
      out.sort((a, b) => {
        const x = a[sort.key],
          y = b[sort.key];
        return (
          (typeof x === "number" && typeof y === "number"
            ? x - y
            : String(x ?? "").localeCompare(String(y ?? ""))) *
          (sort.desc ? -1 : 1)
        );
      });
    return out;
  }, [rows, search, sort]);
  return (
    <>
      <PageHeading
        title="검사·결함 데이터"
        description="기본 Oracle 검사·결함 데이터 조회. 검색·정렬·CSV 내보내기를 지원합니다."
        actions={
          <button
            onClick={() =>
              analyze({
                ...initial,
                source,
                lotId: loadedLot || null,
                x: "inspectedAt",
                xType: "date",
                y: source === "eds" ? "yieldPct" : "defectCount",
                legend: source === "eds" ? "product" : "severity",
              })
            }
          >
            <Play size={14} />이 데이터 분석
          </button>
        }
      />
      <section className="panel">
        <div className="explorer-controls">
          <div className="segmented">
            <button
              className={source === "eds" ? "active" : ""}
              onClick={() => setSource("eds")}
            >
              EDS 검사
            </button>
            <button
              className={source === "defects" ? "active" : ""}
              onClick={() => setSource("defects")}
            >
              결함 이력
            </button>
          </div>
          <input
            aria-label="Lot 필터"
            placeholder="Lot ID · 예: LOT-101"
            value={lot}
            onChange={(e) => setLot(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") load();
            }}
          />
          <button onClick={() => load()} disabled={busy}>
            조회
          </button>
          <button
            className="push-right"
            disabled={!filtered.length}
            onClick={() =>
              download(
                new Blob([csv(filtered)], { type: "text/csv;charset=utf-8" }),
                `waferscope-${source}.csv`,
              )
            }
          >
            <Download size={14} />
            CSV
          </button>
        </div>
        <div className="table-tools">
          <span>
            {fmt(filtered.length)} / {fmt(rows.length)} rows · 최대 1,000행 조회
          </span>
          <label className="search-input">
            <Search size={14} />
            <input
              placeholder="결과 내 검색"
              aria-label="결과 내 검색"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
            />
          </label>
        </div>
        <ErrorBox error={error} />
        {busy ? (
          <Loading />
        ) : !filtered.length ? (
          <Empty
            title="조회 결과가 없습니다"
            description="Lot ID 또는 검색어를 변경해 보세요."
          />
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th className="row-number">#</th>
                  {keys.map((k) => (
                    <th key={k}>
                      <button
                        onClick={() =>
                          setSort({
                            key: k,
                            desc: sort.key === k ? !sort.desc : false,
                          })
                        }
                      >
                        {k}
                        <ArrowUpDown size={11} />
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.slice(page * 25, page * 25 + 25).map((r, i) => (
                  <tr key={i}>
                    <td className="row-number">{page * 25 + i + 1}</td>
                    {keys.map((k) => (
                      <td
                        key={k}
                        className={typeof r[k] === "number" ? "numeric" : ""}
                      >
                        {r[k] == null ? (
                          <span className="muted">NULL</span>
                        ) : k.toLowerCase().includes("yield") ? (
                          <span
                            className={r[k] < 92 ? "yield-low" : "yield-ok"}
                          >
                            {r[k]}%
                          </span>
                        ) : (
                          String(r[k])
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="pagination">
          <span>
            페이지 {page + 1} / {Math.max(1, Math.ceil(filtered.length / 25))}
          </span>
          <button
            aria-label="이전 페이지"
            disabled={page === 0}
            onClick={() => setPage((p) => p - 1)}
          >
            <ChevronLeft size={15} />
          </button>
          <button
            aria-label="다음 페이지"
            disabled={(page + 1) * 25 >= filtered.length}
            onClick={() => setPage((p) => p + 1)}
          >
            <ChevronRight size={15} />
          </button>
        </div>
      </section>
    </>
  );
}
