/** Extract a single string from an Express route param (which types as string | string[]). */
export function param(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}
