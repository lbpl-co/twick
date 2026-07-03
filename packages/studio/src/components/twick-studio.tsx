/**
 * TwickStudio Component
 *
 * The main studio component that provides a complete video editing interface.
 * Integrates all major components including canvas, toolbar, media library,
 * and properties panel into a cohesive editing environment.
 *
 * @component
 * @example
 * ```tsx
 * <LivePlayerProvider>
 *   <TimelineProvider initialData={initialData} contextId="studio-demo">
 *     <TwickStudio />
 *   </TimelineProvider>
 * </LivePlayerProvider>
 * ```
 */

import { Toolbar } from "./toolbar";
import StudioHeader from "./header";
import { useStudioManager } from "../hooks/use-studio-manager";
import ElementPanelContainer from "./container/element-panel-container";
import { useTimelineContext } from "@twick/timeline";
import { MediaProvider } from "../context/media-context";
import { PropertiesPanelContainer } from "./container/properties-panel-container";
import VideoEditor from "@twick/video-editor";
import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { StudioConfig } from "../types";
import useStudioOperation from "../hooks/use-studio-operation";

export function TwickStudio({ studioConfig }: { studioConfig?: StudioConfig }) {
  const {
    selectedTool,
    setSelectedTool,
    selectedElement,
    addElement,
    updateElement,
  } = useStudioManager();
  const { editor, present, videoResolution, setVideoResolution } =
    useTimelineContext();
  const {
    onNewProject,
    onLoadProject,
    onSaveProject,
    onExportVideo,
    onExportCaptions,
    onExportChapters,
  } = useStudioOperation(studioConfig);

  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);

  const twickStudiConfig: StudioConfig = useMemo(
    () => ({
      canvasMode: true,
      ...(studioConfig || {}),
      videoProps: {
        ...(studioConfig?.videoProps || {}),
        width: videoResolution.width,
        height: videoResolution.height,
        backgroundColor:
          present?.backgroundColor ??
          editor.getBackgroundColor() ??
          studioConfig?.videoProps?.backgroundColor,
      },
    }),
    [videoResolution, studioConfig, present?.backgroundColor, editor]
  );

  return (
    <MediaProvider studioConfig={twickStudiConfig}>
      <div className="studio-container">
        {/* Header — hidden when the host app provides its own chrome */}
        {!twickStudiConfig.hideHeader && (
          <StudioHeader
            setVideoResolution={setVideoResolution}
            onNewProject={onNewProject}
            onLoadProject={onLoadProject}
            onSaveProject={onSaveProject}
            onExportVideo={onExportVideo}
            onExportCaptions={onExportCaptions}
            onExportChapters={onExportChapters}
          />
        )}
        {/* Main Content */}
        <div className="studio-content">
          {/* Left Toolbar */}
          <Toolbar
            selectedTool={selectedTool}
            setSelectedTool={setSelectedTool}
            customTools={twickStudiConfig.customTools}
            hiddenTools={twickStudiConfig.hiddenTools}
            leftCollapsed={leftCollapsed}
            setLeftCollapsed={setLeftCollapsed}
          />

          {/* Left Panel (Element Library) */}
          <div className={`studio-left-panel${leftCollapsed ? " studio-left-panel--collapsed" : ""}`}>
            <div className="studio-panel-content">
              <ElementPanelContainer
                videoResolution={videoResolution}
                selectedTool={selectedTool}
                setSelectedTool={setSelectedTool}
                selectedElement={selectedElement}
                addElement={addElement}
                updateElement={updateElement}
                uploadConfig={twickStudiConfig.uploadConfig}
                studioConfig={twickStudiConfig}
              />
            </div>
          </div>

          {/* Center - Canvas and Transport */}
          <main className="main-container">
            <div className="canvas-wrapper">
              <div
                className="canvas-container"
                style={{
                  maxWidth: twickStudiConfig.playerProps?.maxWidth ?? "100%",
                }}
              >
                <VideoEditor editorConfig={twickStudiConfig} />
              </div>
            </div>
          </main>

          {/* Right Panel (Inspector + Props Toolbar) */}
          <div className={`studio-right-panel${rightCollapsed ? " studio-right-panel--collapsed" : ""}`}>
            <button
              className="studio-panel-toggle-strip"
              onClick={() => setRightCollapsed((c) => !c)}
              title={rightCollapsed ? "Show panel" : "Hide panel"}
            >
              {rightCollapsed ? <ChevronLeft size={12} /> : <ChevronRight size={12} />}
            </button>
            <div className="studio-panel-content">
              <PropertiesPanelContainer
                selectedElement={selectedElement}
                updateElement={updateElement}
                addCaptionsToTimeline={() => {}}
                videoResolution={videoResolution}
                studioConfig={twickStudiConfig}
              />
            </div>
          </div>
        </div>
      </div>
    </MediaProvider>
  );
}
