import { TrackElement } from "@twick/timeline";
import { TextPanel } from "../panel/text-panel";
import { useTextPanel } from "../../hooks/use-text-panel";
import type { StudioConfig } from "../../types";

interface TextPanelContainerProps {
  selectedElement: TrackElement | null;
  addElement: (element: TrackElement) => void;
  updateElement: (element: TrackElement) => void;
  studioConfig?: StudioConfig;
}

export function TextPanelContainer({ studioConfig, ...props }: TextPanelContainerProps) {
  const textPanelProps = useTextPanel(props);
  return <TextPanel {...textPanelProps} variables={studioConfig?.textVariables} />;
}
