export function objectBody(text: string): Record<string, unknown> {
  const value = JSON.parse(text);
  if (!value || Array.isArray(value) || typeof value !== "object")
    throw Error("JSON 객체 형식의 요청 본문을 입력해 주세요.");
  return value;
}
export function bindingValue(
  value: string,
  type: string,
  nullable: boolean,
): unknown {
  if (nullable && value === "null") return null;
  if (/int|number|decimal|float|double/i.test(type)) {
    if (!value.trim() || !Number.isFinite(Number(value)))
      throw Error("숫자를 입력하세요.");
    if (/int/i.test(type) && !Number.isInteger(Number(value)))
      throw Error("정수를 입력하세요.");
    return Number(value);
  }
  return value;
}
export function responseRows(data: any): Record<string, unknown>[] {
  const rows = Array.isArray(data) ? data : data?.data;
  return Array.isArray(rows) &&
    rows.every((r) => r && typeof r === "object" && !Array.isArray(r))
    ? rows
    : [];
}
