import type { TrackElement } from "@twick/timeline";
import type { PropertiesPanelProps } from "../../types";

/**
 * "Before track" tag — fork-only host-app feature.
 *
 * Marks the selected element as belonging to the "before video" experience by
 * setting `metadata.beforeTrack: true` (cleared when unchecked). The editor does
 * nothing with the flag itself; the host's render pipeline drops every element
 * carrying it when a session has no before recording.
 *
 * Rendered for media/text elements only and gated by
 * `StudioConfig.enableBeforeTrackTag` (see properties-panel-container).
 */
export function BeforeTrackToggle({ selectedElement, updateElement }: PropertiesPanelProps) {
  const checked = Boolean(selectedElement?.getMetadata?.()?.beforeTrack);

  const handleChange = (next: boolean) => {
    if (!selectedElement) return;
    // Preserve any existing metadata (assetKey, segment, locked, …) — only flip
    // the beforeTrack flag.
    const meta: Record<string, unknown> = { ...(selectedElement.getMetadata?.() || {}) };
    if (next) meta.beforeTrack = true;
    else delete meta.beforeTrack;
    selectedElement.setMetadata(meta);
    updateElement?.(selectedElement as TrackElement);
  };

  return (
    <div className="panel-container">
      <div className="panel-section">
        <div className="checkbox-control">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => handleChange(e.target.checked)}
              className="checkbox-purple"
            />
            Before track
          </label>
        </div>
        <p className="label-small" style={{ marginTop: 4, opacity: 0.7, lineHeight: 1.4 }}>
          Tag content that belongs to the “before” video. It’s dropped from the
          render when a student has no before recording.
        </p>
      </div>
    </div>
  );
}
