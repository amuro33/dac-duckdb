export async function json<T = any>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const r = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
    signal: options.signal ?? AbortSignal.timeout(240000),
  });
  if (!r.ok) {
    let d;
    try {
      d = await r.json();
    } catch {}
    throw new Error(d?.detail ?? `요청 실패 (${r.status})`);
  }
  if (r.status === 204) return undefined as T;
  return r.json();
}
export async function execute(
  path: string,
  method = "GET",
  body?: unknown,
  record = true,
  signal?: AbortSignal,
) {
  return json<{ status: number; data: any; durationMs: number; runId: string; rowCount?: number; responseBytes?: number; responseHeaders?: Record<string, string> }>(
    "/api/execute",
    {
      method: "POST",
      body: JSON.stringify({ path, method, body, record }),
      signal,
    },
  );
}
export async function data(
  path: string,
  method = "GET",
  body?: unknown,
  record = false,
  signal?: AbortSignal,
) {
  const r = await execute(path, method, body, record, signal);
  if (r.status >= 400)
    throw Error(r.data?.detail ?? `서비스 응답 오류 (${r.status})`);
  return r.data;
}
export function download(blob: Blob, name: string) {
  const u = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = u;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 1000);
}
export function csv(rows: Record<string, unknown>[]) {
  const keys = [...new Set(rows.flatMap(Object.keys))];
  const escape = (v: unknown) => {
    let s =
      v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
    if (/^[=+@\-\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replaceAll('"', '""') + '"';
  };
  return (
    "\ufeff" +
    [
      keys.map(escape).join(","),
      ...rows.map((r) => keys.map((k) => escape(r[k])).join(",")),
    ].join("\r\n")
  );
}
export const fmt = (n: number | null | undefined) =>
  n == null ? "—" : n.toLocaleString("ko-KR", { maximumFractionDigits: 1 });
export const when = (v: string) =>
  new Date(v).toLocaleString("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
