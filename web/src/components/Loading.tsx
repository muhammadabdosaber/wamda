/**
 * The shared loading state.
 *
 * Replaces a literal `…`, which said nothing about what was happening or how
 * long it might take. Ported from the design export's loader screen: a faint
 * static ring around a slowly pulsing disc, with a line of text under it.
 *
 * The export's skeleton is a FORM -- input, textarea, chips, button -- because
 * it was drawn for the capture screen. Notes and Tasks are lists, so the
 * skeletons here take the shape of the rows that are actually about to
 * arrive. A form skeleton on a list promises a layout the data never takes,
 * which is worse than no skeleton at all.
 *
 * Motion needs no guard of its own: the `prefers-reduced-motion` block at the
 * top of global.css strips every animation in the app.
 */
export function Loading({ label, skeleton }: { label: string; skeleton?: "notes" | "tasks" }) {
  return (
    <div className="loading">
      {/* Decorative. The label below is what assistive tech announces -- a
          pulsing circle has nothing to say to a screen reader. */}
      <span className="loading-mark" aria-hidden="true">
        <span className="loading-ring" />
        <span className="loading-dot" />
      </span>

      {/* `status` so the wait is announced when this appears, rather than the
          screen going silent until content lands. */}
      <p className="loading-label" role="status">
        {label}
      </p>

      {skeleton === "notes" && (
        <div className="skeleton-list" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div className="skeleton-card" key={i}>
              <span className="skeleton skeleton-title" />
              <span className="skeleton skeleton-line" />
              <span className="skeleton skeleton-line skeleton-line-short" />
              <div className="skeleton-chips">
                <span className="skeleton skeleton-chip" />
                <span className="skeleton skeleton-chip" />
              </div>
            </div>
          ))}
        </div>
      )}

      {skeleton === "tasks" && (
        <div className="skeleton-list" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div className="skeleton-row" key={i}>
              <span className="skeleton skeleton-check" />
              <span className="skeleton skeleton-line" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
