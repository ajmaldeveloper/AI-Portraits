/** Reads `.value` off a native change/input event's target, for the
 * Polaris web-component form fields (which aren't typed React inputs). */
export function eventValue(event: Event): string {
  const target = event.currentTarget as { value?: string } | null;

  return target?.value ?? "";
}
