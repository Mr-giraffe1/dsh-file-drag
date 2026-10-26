/**
 * Host half of the drag-to-reference bundle.
 *
 * The feature is purely a browser interaction: the Client half registers a
 * drag layer and a session-scoped composer drop zone. This empty `apply`
 * exists so the bundle owns a Loader row and its `dsh.client` half is
 * discovered and loaded by the Web runtime.
 */
export function apply() {}
