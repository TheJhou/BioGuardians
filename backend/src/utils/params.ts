// Safely parse a query param that may be string | ParsedQs | array | undefined.
export function parseParam(value: unknown, radix = 10): number | undefined {
  if (!value) return undefined;
  const str = Array.isArray(value) ? String(value[0]) : String(value);
  const num = parseInt(str, radix);
  return isNaN(num) ? undefined : num;
}

export function getParam(value: unknown): string | undefined {
  if (!value) return undefined;
  return Array.isArray(value) ? String(value[0]) : String(value);
}
