const warned = new Set<string>();

/** console.warn, once per distinct message (stubs and missing map data would otherwise spam every frame). */
export function warnOnce(message: string) {
  if (warned.has(message)) return;
  warned.add(message);
  console.warn(message);
}
