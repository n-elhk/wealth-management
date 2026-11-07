/** Transforme un paramètre de route (`:id`) en identifiant numérique. */
export function idRoute(v: unknown): number | null {
  const n = Number(v);
  return v !== undefined && v !== null && v !== '' && Number.isFinite(n) ? n : null;
}
