import { effectiveFlag } from './debug-flags.js?v=20261027-build678';
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.186.0/build/three.module.js';
import { volumeTexturePlan, reduceSliceArea, packedRgSlice, packCtSlice, gpuRunsForTexture } from './medical-volume.js?v=20261027-build678';
import { ensureSegmentBaseRuns } from './segment-runs.js?v=20261027-build678';
import { gpuVolumeTarget, gpuVolumeEditDescriptors, volumeCache, volumeCacheBudget, volumeCacheBudgetInfo } from './gpu-volume-data.js?v=20261027-build678';
import { pruneOtherFilterSettings } from './gpu-volume-cache.js?v=20261027-build678';
import { packEntry, storeEntry, loadEntry, pruneSiblings, removeOldBuilds, storeStatus, noteStore, partsOf, keyOfParts, explainMiss, isStandardOpen } from './vr-prep-cache.js?v=20261027-build678';
import { vrStateSignature } from './vr-data-key.js?v=20261027-build678'; // the state of the page now, to tell whether a practice level is still in its standard state //: the finished VR data is kept on the device (vr-prep-cache.js)
import { SEGMENT_PRESET_ORDER, gpuSegmentOrder, segmentHasProcessedMask, segmentState, segmentEditState, segmentSourceSignature } from './segments.js?v=20261027-build678';
import { sceneState, analysisRegions, activeSeries } from './state.js?v=20261027-build678';
import { datasetFingerprint } from './project-file.js?v=20261027-build678';
import { HAND_PICK_TOL, sectionRayHit, recordVrPoint, resolveTriggerTarget, createTriggerPress, dragShouldStart, DRAG_RECORD, sectionFollowStart, sectionFollowStep, sectionWristTurn, snapPlaneCenterIntoBox, chooseSectionForRay, rayLocalPlaneX, squareBandContains, squareContains, createHoverPulse, qMul, qInv, qRot, qAngleDeg, clampPlaneCenter, HAPTIC, normalizePointMode, surfaceVoxelFromHit, voxelToLocal, voxelSize, createStickGate, deleteSelected, createUndoStack, applyUndo, pointIsHidden } from './vr-point.js?v=20261027-build678';
import { createVrPointMarkers, createSurfaceCursor } from './vr-point-markers.js?v=20261027-build678';
import { buildClsData } from './point-cls.js?v=20261027-build678';
import { createHiddenClsManager } from './hidden-cls-state.js?v=20261027-build678';
import { onDatasetChange } from './dataset-reset.js?v=20261027-build678';
import { WHEEL_ITEMS, DEFAULT_WHEEL, normalizeWheelItems, migrateWheelSectionFlip, setWheelItem, moveWheelItem, clearWheelItem, createRingMenu, createWheelStick, createButtonPress } from './vr-ring.js?v=20261027-build678';
import { getComments, onCommentsChange, commentMatchesSeries, removeComment, restoreComment, updateCommentPosition, updateCommentText, updateCommentColor } from './comments.js?v=20261027-build678';
import { POINT_PALETTE, pointColor, normalizeColor } from './point-colors.js?v=20261027-build678';
import { combineClassificationDistance, fourthChannelBytes } from './distance-field.js?v=20261027-build678';
import { BRICK as PREP_BRICK, computeBricksOf, halveData, buildEditMaskOf, createVolumePrep } from './vr-volume-prep.js?v=20261027-build678'; // the heavy pure steps of the preparation (bricks, the 256 copy, classification, distance field) run in a worker
import { createSwapGuard, runDataSwap, createUploadQueue, createSettleGate, createFrameGapMonitor, swapPlan, SWAP_STAGES, SETTLE_TIMEOUT_MS, LOAD_TIMEOUT_MS, CACHE_READ_TIMEOUT_MS, VR_STORE_FLUSH_MS, withTimeout } from './vr-data-switch.js?v=20261027-build678'; // switching the data inside a running session
import { classifiedAt, marchClassificationHitInfo } from './vr-pick.js?v=20261027-build678';
import { createSkipState, skipGrid } from './vr-skip-occupancy.js?v=20261027-build678'; // the creep-skip occupancy bits of the combined texture (VR max-zoom cost)
import { createComboRebuild } from './vr-combo-rebuild.js?v=20261027-build678'; // the combined texture rebuilt off the frame when the shown segments change
import { setBusySlot, reportBusyProgress } from './progress-modal.js?v=20261027-build678';
import { tr } from './i18n.js?v=20261027-build678';
import { wrapMenuText, stackMenuRows } from './vr-menu-text.js?v=20261027-build678';
import { activeEventLevel, levelForSample, chooseEventLevel, levelSwitchItems, EVENT_LEVELS, eventModeOn, missionLines, simpleMenuSegments, triggerModeRow, triggerMode, TRIGGER_AT_START, resetPress, resetArmed, RESET_ARM_MS, simpleMenuLayout, SIMPLE_MENU, sliceOpacityValue, sliceDrawState } from './event-mode.js?v=20261027-build678'; // 体験会モード - the chosen level's mission on the help board, the かんたん menu
import { VIEW_TOGGLE_ID, VIEW_TOGGLE_BUTTON, SECTION_DELETE_ID, createViewToggle, createDoublePress, ringIdsFor } from './vr-view-toggle.js?v=20261027-build678';
import { vrSpacingNote, vrVolumeText } from './vr-spacing-note.js?v=20261027-build678';
import { NORM_LONG, physicalExtentsMm, longestMm, realMagnification, realHolderScale, startHolderScale, lv0HolderScale, tutorialHolderScale, smallForTutorial, TUT_VOLUME_FWD, TUT_VOLUME_DOWN, magnificationText, createScaleTag, clampScale, pinchScale, scaleLimits, oversizeNote, planeFrameLocalScale, planeTagLocalScale, scaleLineText } from './vr-real-scale.js?v=20261027-build678';
import { createAutoQuality, autoFloor, STEP_LEVELS, marchStep } from './vr-auto-quality.js?v=20261027-build678';
import { createVrHuLine } from './vr-hu-line.js?v=20261027-build678';
import { huMenuTexts, voxelFromHits } from './vr-hu-line-core.js?v=20261027-build678';
import { setHuLineDeferred } from './hu-line-model.js?v=20261027-build678';
import { createVrMeasure, LABEL_LIT_SCALE } from './vr-measure.js?v=20261027-build678';
import { resetUserState } from './event-fresh.js?v=20261027-build678'; // 最初から in the tutorial (practice data only, see tutorial-ui.js resetTutorialAll)
import { tutorialModeOn, createTutorialVr, createSlideViewer, panelTabs, TAB_H, PAGE_H, layoutLevelSlide, levelBoardH, menuAnnotation, menuTargetRect } from './tutorial-vr.js?v=20261027-build678'; // チュートリアル on the help board (only made when tutorialMode is on);: the read-only guide, the level slide, the menu pointer
import { levelSlide, createSlideImages } from './tutorial-slides.js?v=20261027-build678'; // the 体験会 level slides (ev board: the slide's picture)
import { TUT_SAMPLE } from './tutorial-data.js?v=20261027-build678'; // the live tutorial runs on its practice data only
import { emit, scaleChanged, poseMoved } from './tutorial-signal.js?v=20261027-build678'; // tutorial: one-line signals at the action sites (no-op without a listener)
import { horizAngleDeg } from './tutorial-orient.js?v=20261027-build678'; // the tutorial's entry guidance (look right / left): head turn toward a board
import { createControllerHints, createEdgeArrow, createBoardArrow, boardSide, edgeArrowShown } from './tutorial-3d.js?v=20261027-build678'; // the tutorial's 3D guides (controller button, edge arrow, arrow over the menu)
import { MAX_SECTION_PLANES, nextPlaneColor, frameDepthTest, ARROW_LEN, ARROW_FLASH_MS, arrowFade, arrowShown, tagBehindTissue, sectionPage, pageOfPlane, SECTION_ROWS_PER_PAGE, FLING_UNDO_MS, FLING_DEBUG_MS, createVelocityTracker, flingDecision, frameOutOfView, outOfViewNow, createOutOfViewTracker, outOfViewRelease, flingDebugLines, capVelocity, flyStep, makeSectionSnapshot, restorePlan, createSectionUndo, undoButtonPlace } from './vr-section-frame.js?v=20261027-build678';
import { createUndoButton } from './vr-undo-button.js?v=20261027-build678';
import { createFlingDebugTag } from './vr-fling-debug.js?v=20261027-build678';
import { EMPTY_PINCH, isHand, wristScrollGain, wristScrollSign, wristScrollKeep, NEAR_KINDS, boxDist, centeredBoxDist, squareOutlineDist, pickNearGrab, HAND_RAY_MODES, normalizeHandRay } from './vr-hand.js?v=20261027-build678'; // hand tracking (Quest 3): pure helpers
import { createHandInput, HAND_LABEL_MOVE_M } from './vr-hand-view.js?v=20261027-build678'; // the hand's ray, wrist menu, fingertips
import { LABEL_HIDE_DEFAULT, normalizeLabelHide, gpuOcclusionActive, depthVoxelSize, boardVisible, GHOST_ALPHA, occludedPass } from './vr-depth.js?v=20261027-build678';
import { brickOccupancy, writeBrickOccupancy } from './vr-brick-occupancy.js?v=20261027-build678';
import { createProbeGate } from './measure-label.js?v=20261027-build678';
import { sliceIndex, sliceRange, boxFromRange, createSegScan, segScanStart, segScanStep, segsSubset, segsFromUniforms, contentKeyChanged, KEY_LEN } from './vr-content-box.js?v=20261027-build678'; // the proxy box = the box of what can be drawn
import { setRegionLabel, setRegionLabelOffset, voxelFromLocalVr, clampVoxel, labelLocal, offsetForLocal, vrVoxelStep, rectEdgePoint, leaderVisible, labelSegmentsShown } from './analysis-label.js?v=20261027-build678';
import { createVrSelfCheck, selfCheckTexts } from './vr-self-check.js?v=20261027-build678'; // 詳細 > 自己診断 (automated frame-time scenarios)
import { createScaleGuard, createFlapGuard, variantFallback } from './vr-flicker-guard.js?v=20261027-build678'; // flicker safety guard
import { eyeMetrics, capFromPpv, nextCap, foveaRect, outsideFovea, foveaWorth, qualityText, FOVEA_K, CAP_MIN } from './vr-render-scale.js?v=20261027-build678'; // data-resolution render scale + offscreen foveation
import { getMeasureStart, startMeasure, cancelMeasure, pickMeasureEnd, onMeasureStartChange, removeMeasurement, restoreMeasurements, measurementsOfPoint, seriesSpacing } from './measurements.js?v=20261027-build678';
import { APP_BUILD } from './version.js?v=20261027-build678';
import { wc, ww } from './ui-shell.js?v=20261027-build678';
import { VOLUME_FWD, VOLUME_DOWN, MENU_OFFSET, HELP_OFFSET, HU_PANEL_OFFSET, EV_OFFSET, EV_WIDTH, EV_RES, MENU_WIDTH, HELP_WIDTH, HELP_RES, HIST_OFFSET, HIST_WIDTH, FOLLOW_ANGLE, FOLLOW_DIST } from './vr-layout.js?v=20261027-build678';
import { onHistogramChange, getHistogramRange, getHistogramLog, setHistogramLog, setHistogramRange } from './histogram-ui.js?v=20261027-build678';
import { createVrLabelHistogram, UNLABELED_COLOR, labelSlot, labelRegion } from './vr-label-histogram.js?v=20261027-build678';
import { rangeRes } from './vr-histogram-layout.js?v=20261027-build678';
import { getHuMode, setHuMode, HU_MODE_FILTERED, HU_MODE_RAW } from './effective-hu.js?v=20261027-build678';
import { createVrHistogramPanel } from './vr-histogram-panel.js?v=20261027-build678';
import { lightingGLSL, lightingVertexGLSL, materialVec, MATERIALS, materialKey } from './lighting.js?v=20261027-build678'; // one lighting model for the desktop volume, this VR / AR volume and the 3D-view meshes

const BG=new THREE.Color(0.035,0.045,0.05);
const BRICK=PREP_BRICK;
// gives the main thread back (an XR frame callback, input) between the slices of a long step inside a running session; scheduler.yield where the browser has it, else a timer
const yieldMain=()=>globalThis.scheduler?.yield?globalThis.scheduler.yield():new Promise(r=>setTimeout(r,0));
const VR_TARGET_SIDE=512;

export async function vrSupported(mode='immersive-vr'){
 try{return !!navigator.xr&&await navigator.xr.isSessionSupported(mode)}catch{return false}
}

const vertexShader=`
uniform vec3 halfExt;
out vec3 vPos;
out vec3 vOrigin;
out vec3 vLightOff; // the shared headlight (lighting.js) in object space: the eye's right / up axes (rows of viewMatrix, per eye in XR) turned into the volume's frame, so a grabbed or flipped volume keeps its light above the viewer
void main(){
 vPos=position*halfExt;
 mat4 invModel=inverse(modelMatrix);
 vOrigin=(invModel*vec4(cameraPosition,1.0)).xyz;
 ${lightingVertexGLSL('invModel')}
 gl_Position=projectionMatrix*modelViewMatrix*vec4(vPos,1.0);
}`;

const fragmentShader=`
precision highp float;
precision highp sampler3D;
precision highp usampler3D;
// VRL_MEDIUMP (Quest 3, default; ?vrprec=highp or the debug switch turns it off: VR_MEDIUMP below) = fp16 (Adreno 740: twice the ALU rate, half the
// registers) for the per-step segment values qc / f0..f3 / curF (q - 0.5 is taken in highp, so the sign of the 0.5 test stays exact), the shading results,
// the composited colour acc and the result index texture regionTex (nearest, 0..14). highp stays on everything along the ray (t, tcO / tcD, positions,
// depth, the jump dd), on the HU path (vol / sliceVol rg8-packed u16, bricks, distTex) and on every filtered value tested against 0.5: q / qm / fm / gQ
// (clsTex, cls4Tex) and editTex. Measured with fp16 emulated (packHalf2x16 round trip; SwiftShader runs mediump at fp32): a classification byte rounded to
// fp16 flips the 0.5 test where a thin segment only just crosses it (golden fat-sheet scene: 7.5 % of the drawn pixels > 2/255), editTex the same on a
// mask-only segment (0.4 %); with those highp: all golden scenes 0.06 % > 2/255 (isolated pixels on the fat sheets, the secant on fp16 f), practice data
// 0 % (max 2/255, no banding through translucent layers). Without the define VRL_MP = highp: the same program as before. VRL_SEG_OFF: a disabled
// segment's offset (1e9 overflows fp16; 4 > any |q - 0.5|)
#ifdef VRL_MEDIUMP
#define VRL_MP mediump
#define VRL_SEG_OFF 4.0
#else
#define VRL_MP highp
#define VRL_SEG_OFF 1e9
#endif
uniform sampler3D vol;
uniform sampler3D bricks; // per 8^3 brick: R, G = HU min / max; B = occupancy nibble of the mask-only segments
uniform vec3 halfExt;
uniform vec3 texDims;
uniform vec3 brickDims;
uniform float stepSize;
const float ACC_STOP=0.95; // rays stop once 95 % opaque (was 98.5 %): dense fat saturates early, so fewer steps
// diagnostics: 0 normal, 1 box only (no marching), 2 loop
// count heat map (blue = few iterations, red = 1024 or more), 3 no shading at
// hits (no refinement, no gradient), 4 no empty-space skipping
uniform int diag;
uniform vec3 calib; // slope, intercept, signedBias
uniform vec4 segA[4]; // min, max, opacity, enabled
uniform vec4 segC[4]; // rgb, w=1: simple display (no refinement, no gradient)
uniform vec4 segM[4]; // material of the segment (lighting.js materialVec): ambient, spec, shininess, spare
// CT shading of the SLICE (setting ctShade, menu: スライスの塗り 単色 / CT濃淡, default CT濃淡). Solid (0) = exactly the slice as before the setting existed, nothing below changes it.
// CT shading (1), slice opacity above 0 %: the CT image with the segment's tint over it, but the tint colour is the segment colour x the CT value (ctLumHU), so a strong tint keeps the shading instead of covering it.
// At 0 % opacity (sliceSegOnly = 1, set by the host with sliceOpacity 1; also when the slice is cleared by the thumbstick click) only the segments' own region is drawn on the plane, no grey CT image, nothing outside it:
// solid = the flat segment colour at sliceTint opacity; CT shading = segment colour x CT value at the fixed opacity SEG_ALPHA (not tied to sliceTint, so the shading reads at the default 45 % too).
// ctLumHU is normalised to the segment's own HU range (segA min..max) and floored at CT_SHADE_MIN so a low value never goes black. ctShadeBright is a gamma on that factor (pow(lum,1/b)): above 1 it lifts the dark end most and leaves the top at 1, so the bright end never clips; below 1 it darkens. ctShadeContrast then spreads that value about the middle of its range (pivot = (min+1)/2, min = CT_SHADE_MIN^(1/b)) by the factor c, clamped to 0.05..1: above 1 the dark and bright parts move apart again after the gamma has pulled them together; exactly 1 returns the gamma value untouched. The 3D surface and the cut-face cap always keep the flat segment colour.
uniform float sliceSegOnly;
uniform float ctShade;
uniform float ctShadeBright; // setting ctShadeBright (menu: 濃淡の明るさ 50..200 %, default 180 %): gamma on the CT factor, 1 = as before
uniform float ctShadeContrast; // setting ctShadeContrast (menu: 濃淡のコントラスト 50..200 %, default 170 %): spread of the CT factor about the middle of its range, 1 = as before (the value is returned unchanged)
#define CT_SHADE_MIN 0.35
#define SEG_ALPHA 0.95 // 0 % + CT shading: the fill's opacity, whatever sliceTint is (the shader source is a plain template, so event-mode.js SLICE_SEG_ALPHA is checked equal by a unit test)
#define CT_SHADE_SPAN 1500.0 // a segment's max can be open-ended (bone 698..61535): the window's top is at most this far above its min
// hand-held section, object space: the kept side is
// dot(cutPlane.xyz,p) >= cutPlane.w (the far side from the eye). cutOn clips
// the volume; sliceOpacity > 0 draws the oblique CT slice on the plane,
// resampled every frame from sliceVol (the 512 data) with the app's window
// processed segments / edits: the same keep/exclude runs the
// WebGPU volume uses (gpuVolumeEditDescriptors), rasterised to RGBA, channel s
// = 1 where segment s is allowed (only for segments in editMask). Linear
// filtering + 0.5 gives a smooth boundary instead of voxel steps (diagnostic
// switch in 詳細: smooth / nearest / off)
uniform int editMask;
// segments decided by their mask alone (Closing / hole filling can add voxels outside the HU range)
uniform int editMaskOnly;
uniform sampler3D editTex;
// up to SECTION_PLANES sections: planeCount planes, bit i of planeCut = plane
// i clips (its removed half is dot(n,p) < w); every plane shows its slice,
// composited in depth order inside the kept interval. Only the planeCount planes in use are tested (the per-ray loops skip i >= planeCount)
#define SECTION_PLANES 10
uniform vec4 cutPlanes[SECTION_PLANES];
uniform int planeCount;
uniform int planeCut;
uniform float sliceOpacity;
// capOn paints the cut face flat in the segment colour (lit by the
// plane normal, as the app's section cap); sliceTint > 0 colours the slice
// where a visible segment is (same test as the volume, mask included)
uniform int capOn;
uniform float sliceTint;
uniform vec2 sliceWindow; // center, width
uniform float sliceAir; // HU at or below which the slice is transparent
// surface search 1 = fast (2 secant guesses + 1 bisection on the
// interpolated value), 0 = exact (6 bisections)
uniform int refine;
uniform sampler3D sliceVol;
in vec3 vPos;
in vec3 vOrigin;
in vec3 vLightOff;
out highp vec4 outColor;
${lightingGLSL()}// the depth of the first thing the ray shows (a surface hit or the cut face) is written to gl_FragDepth, so lines / labels drawn later are depth tested against the tissue
// (a label behind it is clipped at the outline). The same two matrices as the vertex shader's gl_Position. Pixels without a hit keep the box face's depth (gl_FragCoord.z, as before),
// a ray that shows nothing is discarded (no depth, AR stays see-through). depthBias() (object space, = depthBias in vr-depth.js: DEPTH_BIAS_RAY * the voxel's extent along the ray + DEPTH_BIAS_MIN * voxelMin) pushes the
// written depth behind the surface so things lying ON it (points at voxel centres / lines recorded on a surface or a cut face, also with an anisotropic spacing) stay in front.
uniform mat4 projectionMatrix;
uniform mat4 modelViewMatrix;
const float DEPTH_BIAS_RAY=0.5;
const float DEPTH_BIAS_MIN=1.5;
float gDepthT=-1.0;
void depthMark(float tt,float a){if(gDepthT<0.0&&a>0.02)gDepthT=tt;}
vec2 hitBox(vec3 o,vec3 d){
 vec3 inv=1.0/d;vec3 a=(-halfExt-o)*inv;vec3 b=(halfExt-o)*inv;
 vec3 lo=min(a,b);vec3 hi=max(a,b);
 return vec2(max(lo.x,max(lo.y,lo.z)),min(hi.x,min(hi.y,hi.z)));
}
// entry-face normal: the box face the ray enters through, as the OUTWARD unit normal (object space; the camera is outside the box). A surface hit on that face itself (tissue reaches the edge of the volume: a
// cropped / cut scan) has no iso-surface there, so the one-sided gradient is only noise and the face rendered as a porous granular patch with the inside showing through (sample2 / sample3).
// main() flat-shades a hit within one step of the entry face with this normal (faceEnd); the six gradient fetches are not made for it.
vec3 entryFaceNormal(vec3 o,vec3 d){
 vec3 inv=1.0/d;vec3 a=(-halfExt-o)*inv;vec3 b=(halfExt-o)*inv;
 vec3 lo=min(a,b);
 vec3 n=vec3(0.0);
 if(lo.x>=lo.y&&lo.x>=lo.z)n.x=-sign(d.x);else if(lo.y>=lo.z)n.y=-sign(d.y);else n.z=-sign(d.z);
 return n;
}
// content box (vr-content-box.js), object space centre / half extents; boxH.x = 0: none. A ray that misses it is discarded at once (it
// crosses only air: the box holds everything that can be drawn) and the march ends at its exit. The proxy geometry stays the full box: the ray
// direction is interpolated from the proxy's faces and the march is sensitive to its last bit (a different proxy re-phases the jumps), so the
// entry, the ray parameter and every sample position stay those of the full box: a ray that is not discarded renders exactly as before
// (tools/vr-render-golden.mjs, content-box proof). boxEntry = 1 (reference only, not used by the app) also starts the march at the content box
uniform vec3 boxC;
uniform vec3 boxH;
uniform int boxEntry;
vec2 hitContent(vec3 o,vec3 d){
 vec3 inv=1.0/d;vec3 a=(boxC-boxH-o)*inv;vec3 b=(boxC+boxH-o)*inv;
 vec3 lo=min(a,b);vec3 hi=max(a,b);
 return vec2(max(lo.x,max(lo.y,lo.z)),min(hi.x,min(hi.y,hi.z)));
}
vec3 gInv=vec3(0.0); // 0.5 / halfExt, set once in main (was three divisions per call)
vec3 texCoord(vec3 p){return vec3(p.x*gInv.x+0.5,0.5-p.y*gInv.y,p.z*gInv.z+0.5);}
// analysis results: colour index per voxel (0 none, 1..14 = regionC), read only where a colour is
// chosen (surface hit, cut face, slice tint), never per step; the hit is sampled a little inside the surface.
// Compiled only with VRL_REGIONS (a session without results runs the shader as before: the branch alone cost
// about 14 % on SwiftShader)
#ifdef VRL_REGIONS
uniform VRL_MP sampler3D regionTex;
uniform vec3 regionC[14];
uniform int regionSeg[14];
vec3 regionColor(vec3 p,vec3 base,int s){
 int i=int(texture(regionTex,clamp(texCoord(p),vec3(0.0),vec3(0.999999))).r*255.0+0.5);
 return i>0&&i<=14&&((regionSeg[i-1]>>s)&1)==1?regionC[i-1]:base;
}
#else
vec3 regionColor(vec3 p,vec3 base,int s){return base;}
#endif
float huAt(vec3 tc0){
 vec3 tc=clamp(tc0,vec3(0.0),vec3(0.999999));
 vec2 q=texture(vol,tc).rg*255.0;
 return (q.x+q.y*256.0-calib.z)*calib.x+calib.y;
}
// brightness factor (CT_SHADE_MIN..1) of segment s at a given HU, used by sliceColor only; 1 when the setting is off or the segment is shown in the simple (flat) mode
float ctLumHU(float hu,int s){
 if(ctShade<0.5||diag==3||segC[s].w>0.5)return 1.0; // diag 3 = 陰影なし (flat): no CT factor either
 vec4 a=segA[s];
 float g=1.0/max(ctShadeBright,0.1),l=pow(mix(CT_SHADE_MIN,1.0,clamp((hu-a.x)/max(min(a.y-a.x,CT_SHADE_SPAN),1.0),0.0,1.0)),g);
 if(ctShadeContrast==1.0)return l; // 100 % = the gamma value itself, bit for bit
 float p=0.5*(pow(CT_SHADE_MIN,g)+1.0);return clamp(p+(l-p)*ctShadeContrast,0.05,1.0);
}
bool editAllows(int s,vec3 tc){
 if(((editMask>>s)&1)==0)return true;
 return texture(editTex,clamp(tc,vec3(0.0),vec3(0.999999)))[s]>=0.5;
}
// precomputed classification: per segment, 0.5 + (HU distance
// inside its range)/2048, folded with the processing mask, one byte each.
// The trilinear value crosses 0.5 where the HU crosses the threshold (linear
// map), so one fetch replaces HU decode + range test + mask fetch.
uniform int useCls;
uniform sampler3D clsTex;
uniform ivec4 clsChan; // channel of each segment (-1: none); only active segments are stored
// with four stored segments the combined texture (channels 0..2 + distance alpha) cannot hold the fourth one; its
// classification bytes come from this R8 texture (VRL_CLS4 variants, chan 3): read into q.a after the alpha served the jump test
uniform sampler3D cls4Tex;
// exact creep skip (docs/vr-skip-occupancy.js). One bit per dual cell (the trilinear footprint c0..c0+1 of a sample) of the combined texture, 4x4x4 cells per texel (RG32UI,
// bit = x + 4y + 16z, low word z 0..1): set when every shown channel is below 0.5 and the alpha byte is <= 2 at all eight corners, i.e. when the loop below would classify the sample as
// outside every shown segment without a jump. Such a sample costs no clsTex fetch (the texel is read once per block, then bits). useSkip is 0 until the bits describe exactly the texture the GPU holds.
uniform int useSkip;
uniform highp usampler3D skipTex;
// distance field: per segment channel (same layout as clsTex) a
// lower bound, in voxels, of the distance to the voxels around that
// segment's surface (distance-field.js). With useDist > 0 the ray jumps
// (d - 2) voxels whenever the smallest enabled distance d is at least 3
// (sphere tracing: no surface can lie inside the jump), and samples at the
// fine step only near surfaces. voxelMin = object-space size of the smallest
// voxel side of that grid. Nearest sampling.
uniform sampler3D distTex;
uniform int useDist;
uniform int distInCls; // the combined distance field (min over the shown segments) is the classification texture's alpha: one fetch per step
uniform float voxelMin;
uniform vec3 voxelSize; // object-space voxel size per axis (the coarser of the rendered grid and the data grid), for the depth bias
float depthBias(vec3 d){return DEPTH_BIAS_RAY*dot(abs(d),voxelSize)+DEPTH_BIAS_MIN*voxelMin;}
float distAt(vec3 tc){
 vec4 q=texture(distTex,clamp(tc,vec3(0.0),vec3(0.999999)))*255.0;float m=255.0;
 for(int s=0;s<4;s++){int c=clsChan[s];if(c>=0&&segA[s].w>0.5)m=min(m,q[c]);}
 return m;
}
// the value the last segmentIndexAt sampled: HU, or the
// classification vector; the surface search reuses it as the outside sample
float gHu=0.0;vec4 gQ=vec4(0.0);
int segmentIndexFromQ(vec4 q){
 gQ=q;
 for(int s=0;s<4;s++){int c=clsChan[s];if(c>=0&&segA[s].w>0.5&&q[c]>=0.5)return s;}
 return -1;
}
int segmentIndexAt(vec3 tc){
 if(useCls>0){
  vec4 q=texture(clsTex,clamp(tc,vec3(0.0),vec3(0.999999)));
#ifdef VRL_CLS4
  q.a=texture(cls4Tex,clamp(tc,vec3(0.0),vec3(0.999999))).r;
#endif
  return segmentIndexFromQ(q);
 }
 float v=huAt(tc);gHu=v;
 for(int s=0;s<4;s++){vec4 a=segA[s];if(a.w>0.5&&(((editMaskOnly>>s)&1)==1||(v>=a.x&&v<=a.y))&&editAllows(s,tc))return s;}
 return -1;
}
// signed distance-like value of segment s at the last sample: >= 0 inside
float segValue(int s);
// the largest enabled-segment value at the last sample (negative when the sample is in no segment)
float maxSegValue(){float m=-1e9;for(int s=0;s<4;s++)if(segA[s].w>0.5)m=max(m,segValue(s));return m;}
float segValue(int s){if(useCls>0){int c=clsChan[s];return c>=0?gQ[c]-0.5:-1.0;}vec4 a=segA[s];return gHu<a.x?gHu-a.x:a.y-gHu;}
// 0 = no enabled segment in the brick, 1 = mixed, 2+s = every
// sample in the brick is segment s (range holds the brick's min..max, no
// earlier enabled segment overlaps, no processing mask on s): a ray already
// inside s crosses it without sampling. Bricks carry one voxel of overlap.
// a mask-only segment is a candidate of the brick only when the brick holds a voxel of its mask
// (occupancy bit s in the B channel), not for every brick: the HU range says nothing about such a segment
int brickClass(vec3 tc){
 vec3 mm=texture(bricks,clamp(tc,vec3(0.0),vec3(0.999999))).rgb;int occ=int(mm.z+0.5);
 for(int s=0;s<4;s++){vec4 a=segA[s];if(a.w>0.5&&(((editMaskOnly>>s)&1)==1?((occ>>s)&1)==1:(a.y>=mm.x&&a.x<=mm.y))){if(mm.x>=a.x&&mm.y<=a.y&&((editMask>>s)&1)==0)return 2+s;return 1;}}
 return 0;
}
bool brickMayContain(vec3 tc){return brickClass(tc)>0;}
// distance along dir (object space) to leave the current brick
float brickExit(vec3 tc,vec3 dir){
 vec3 dtc=vec3(dir.x/(2.0*halfExt.x),-dir.y/(2.0*halfExt.y),dir.z/(2.0*halfExt.z));
 vec3 cell=floor(clamp(tc,vec3(0.0),vec3(0.999999))*brickDims);
 float best=1e20;
 for(int i=0;i<3;i++){
  if(abs(dtc[i])>1e-8){
   float edge=(dtc[i]>0.0?cell[i]+1.0:cell[i])/brickDims[i];
   float dt=(edge-tc[i])/dtc[i];
   if(dt>1e-7)best=min(best,dt);
  }
 }
 return best;
}
float sliceHU(vec3 p){
 vec2 q=texture(sliceVol,clamp(texCoord(p),vec3(0.0),vec3(0.999999))).rg*255.0;
 return (q.x+q.y*256.0-calib.z)*calib.x+calib.y;
}
float sliceGray(vec3 p){
 return clamp((sliceHU(p)-(sliceWindow.x-0.5*sliceWindow.y))/max(sliceWindow.y,1e-3),0.0,1.0);
}
vec4 sliceColor(vec3 p){
 float hu=sliceHU(p),a=smoothstep(sliceAir,sliceAir+10.0,hu);
 if(sliceSegOnly>0.5){int si=(ctShade>0.5||sliceTint>0.0)?segmentIndexAt(texCoord(p)):-1;return si<0?vec4(0.0):vec4(regionColor(p,segC[si].rgb,si)*ctLumHU(hu,si),ctShade>0.5?SEG_ALPHA:sliceTint);} // 0 % opacity: the segments' region only, no air floor, no grey CT image
 if(a<=0.0)return vec4(0.0);
 float g=clamp((hu-(sliceWindow.x-0.5*sliceWindow.y))/max(sliceWindow.y,1e-3),0.0,1.0);
 if(sliceTint>0.0){int si=segmentIndexAt(texCoord(p));if(si>=0)return vec4(mix(vec3(g),regionColor(p,segC[si].rgb,si)*ctLumHU(hu,si),sliceTint),a);}
 return vec4(vec3(g),a);
}
float gHuMean=0.0; // set by gradientAt (see there)
// gradient normal. Central differences (six fetches) by default. VRL_TETRA = tetrahedral (four fetches at (+,-,-) (-,-,+) (-,+,-) (+,+,+)
// voxels): measured on the synthetic fat volume it changes ~98 % of the shaded pixels and looks noisier, and it saves 2 fetches per ray only, so it is off.
#ifdef VRL_TETRA
vec3 gradientAt(vec3 tc){
 vec3 d=1.0/max(texDims,vec3(1.0));
 float a=huAt(tc+vec3(d.x,-d.y,-d.z)),b=huAt(tc+vec3(-d.x,-d.y,d.z)),c=huAt(tc+vec3(-d.x,d.y,-d.z)),e=huAt(tc+d);
 gHuMean=(a+b+c+e)*0.25;
 float gx=a-b-c+e,gy=-a-b+c+e,gz=-a+b-c+e;
 vec3 voxel=2.0*halfExt/max(texDims,vec3(1.0));
 vec3 g=vec3(gx/max(voxel.x,1e-6),-gy/max(voxel.y,1e-6),gz/max(voxel.z,1e-6));
 float l=length(g);return l<1e-6?vec3(0.0,0.0,1.0):g/l;
}
#else
vec3 gradientAt(vec3 tc){
 vec3 d=1.0/max(texDims,vec3(1.0));
 float xp=huAt(tc+vec3(d.x,0.0,0.0)),xm=huAt(tc-vec3(d.x,0.0,0.0)),yp=huAt(tc+vec3(0.0,d.y,0.0)),ym=huAt(tc-vec3(0.0,d.y,0.0)),zp=huAt(tc+vec3(0.0,0.0,d.z)),zm=huAt(tc-vec3(0.0,0.0,d.z));
 gHuMean=(xp+xm+yp+ym+zp+zm)*(1.0/6.0); // the mean of the fetches the gradient needs anyway = the HU at the hit, to tell which threshold of the segment's range the surface is (the outward normal of a hit behind a translucent layer)
 float gx=xp-xm;
 float gy=yp-ym;
 float gz=zp-zm;
 vec3 voxel=2.0*halfExt/max(texDims,vec3(1.0));
 vec3 g=vec3(gx/max(voxel.x,1e-6),-gy/max(voxel.y,1e-6),gz/max(voxel.z,1e-6));
 float l=length(g);return l<1e-6?vec3(0.0,0.0,1.0):g/l;
}
#endif
void main(){
 gl_FragDepth=gl_FragCoord.z;
 vec3 o=vOrigin;vec3 dir=normalize(vPos-vOrigin);
 gInv=0.5/halfExt;vec3 tcO=texCoord(o),tcD=vec3(dir.x*gInv.x,-dir.y*gInv.y,dir.z*gInv.z); // texture coordinate along the ray = tcO + tcD * t
 vec2 bounds=hitBox(o,dir);
 if(bounds.x>bounds.y)discard;
 float t=max(bounds.x,0.0);float endT=bounds.y;float step=max(stepSize,1e-5);
 if(boxH.x>0.0){vec2 cb=hitContent(o,dir);if(cb.x>cb.y||cb.y<0.0)discard;endT=min(endT,cb.y);if(boxEntry==1)t=max(t,cb.x);}
 if(diag==1){outColor=vec4(0.2,0.35,0.5,1.0);return;}
 float capT=-1.0;int capPlane=-1;float sliceT[SECTION_PLANES];int nSlice=0;
#ifndef VRL_NO_EVENTS
 // the section work is per RAY, never per sample, and only for the planeCount planes in use (the loops stop at planeCount). The NoEvents variant (planeCount = 0, vr-view.js
 // variantKey) has no plane code at all. A plane that neither clips nor shows a slice (sliceOpacity 0) is skipped: its crossing is read by nothing. Same arithmetic, same order: pixel-identical.
 float crossT[SECTION_PLANES]; // -1e30 = no crossing (a plane not in use, or parallel to the ray): never inside the kept interval (t >= 0); only [0, planeCount) is ever read
 for(int i=0;i<SECTION_PLANES;i++){
  if(i>=planeCount)break;
  crossT[i]=-1e30;bool clip=((planeCut>>i)&1)==1;if(!clip&&sliceOpacity<=0.0)continue;
  vec4 pl=cutPlanes[i];float side=dot(pl.xyz,o)-pl.w;float slope=dot(pl.xyz,dir);
  if(abs(slope)>1e-8){
   float cross=-side/slope;crossT[i]=cross;
   if(clip){if(slope>0.0){if(cross>t){t=cross;capT=cross;capPlane=i;}}else endT=min(endT,cross);}
  }else if(clip&&side<0.0)discard;
 }
#endif
 if(t>endT+1e-6)discard;
 if(capOn==0||capT>endT){capT=-1.0;capPlane=-1;}
 // entry face: a surface hit with t <= faceEnd lies on the box face the ray entered through (camera outside the box, the march starts at that face: no section plane / content box moved it): -1 = none (every hit has t >= 0)
 float faceEnd=(bounds.x>0.0&&t<=bounds.x+1e-4)?bounds.x+step:-1.0;
 // faceT = the entry sample on that face (-1 = none). The distance field treats the box exterior as the same class (edge replicated), so a solid region reaching the face
 // has a large distance there and the first sample jumped past the face: the hit was found voxels deep, gradient-lit (the uncapped granular box faces). At faceT a jump is not
 // taken when the sample is inside a shown segment; any other sample jumps as before (same image off the box faces)
 float faceT=faceEnd>=0.0?t:-1.0;
#ifndef VRL_NO_EVENTS
 // slices inside the kept interval, sorted front to back
 if(sliceOpacity>0.0){
  for(int i=0;i<SECTION_PLANES;i++){if(i>=planeCount)break;if(crossT[i]>=t-1e-5&&crossT[i]<=endT+1e-5){sliceT[nSlice]=crossT[i];nSlice++;}}
  for(int i=1;i<SECTION_PLANES;i++){if(i>=nSlice)break;float k=sliceT[i];int j=i-1;while(j>=0&&sliceT[j]>k){sliceT[j+1]=sliceT[j];j--;}sliceT[j+1]=k;}
 }
#endif
 int nextSlice=0;
 float previousT=t;int lastIndex=-1;VRL_MP vec4 acc=vec4(0.0);int iters=0;
 float t0=t,jumpLen=0.0;bool hitEnd=false; // diagnostics (diag 5): path skipped by jumps, ray ended by a hit
 // brickEnd = t where the current non-empty brick is left; the
 // brick min/max is fetched once per brick instead of once per sample
 float brickEnd=-1.0;int uniformSeg=-1;bool prevValid=false;float prevF=0.0;float lastDd=99.0;float distInc=ceil(1.5*ceil(step/max(voxelMin,1e-6)));
#ifndef VRL_NO_GENERAL
 if(distInCls>0&&useCls>0&&diag!=4){
#else
 // variant without the general loop (compiled when the combined field is in use)
 {
#endif
  // tight loop for the combined-field path. Same arithmetic as the general loop below
  // without its per-step slice / cap / brick / uniform-brick bookkeeping, the segment work done on the fetched vector and the
  // surface search testing the fetched classification directly (pixel-identical; practice data 609 -> 177 ms on SwiftShader)
  // a hit that ends the ray (opaque segment) is searched and shaded after the loop, so the search does not run
  // inside the divergent march; semi-transparent hits are handled inline as before. Same arithmetic, same order.
  bool prevSkip=false;highp ivec3 skBlk=ivec3(-1);highp uvec2 skBits=uvec2(0u); // prevF of the last skipped sample is fetched only when a hit needs it (prevSkip)
  int hitIdx=-1;float hitLo=0.0;float hitHi=0.0;float hitF0=0.0;float hitF1=0.0;bool hitIso=false;bool hitSimple=false;int hitNb=6;
  // per-ray constant: enabled channels as a mask (1 enabled, 0 not)
  // one-hot channel selectors per segment (no dynamic indexing of fv[c] / clsChan[s] inside the march); off = 1e9 for a disabled segment
  VRL_MP vec4 sel0=vec4(0.0),sel1=vec4(0.0),sel2=vec4(0.0),sel3=vec4(0.0);VRL_MP float off0=VRL_SEG_OFF,off1=VRL_SEG_OFF,off2=VRL_SEG_OFF,off3=VRL_SEG_OFF;
  {int c=clsChan[0];if(c>=0&&segA[0].w>0.5){sel0[c]=1.0;off0=0.0;}}
  {int c=clsChan[1];if(c>=0&&segA[1].w>0.5){sel1[c]=1.0;off1=0.0;}}
  {int c=clsChan[2];if(c>=0&&segA[2].w>0.5){sel2[c]=1.0;off2=0.0;}}
  {int c=clsChan[3];if(c>=0&&segA[3].w>0.5){sel3[c]=1.0;off3=0.0;}}
  // rays with a slice or a cut face use a second copy of the march with those events (the same code in one
  // loop made SwiftShader's compiled loop twice as slow for every ray, so the two stay separate)
#ifndef VRL_NO_EVENTS
  if(nSlice==0&&capT<0.0){
#endif
  for(int iter=0;iter<4096;iter++){
   if(t>endT||acc.a>ACC_STOP)break;
   iters++;
#ifdef VRL_OPAQUE
   // exact creep skip. The sample's trilinear footprint is the dual cell fl..fl+1 (pp = texel coordinate - 0.5); when its bit says "outside every shown segment, alpha <= 2" the original
   // loop would fetch, find no segment and no jump, and move on: do that without the fetch (prevF, the secant's outside value, is fetched at previousT only if a hit follows). A sample within 1/64 of a cell
   // face, or in the border cells (clamp-to-edge), is fetched as before (texel addressing precision). t advances by the same single add: pixel-identical.
   if(useSkip>0){
    vec3 pp=(tcO+tcD*t)*texDims-0.5;vec3 fl=floor(pp);vec3 fr=pp-fl;
    if(all(greaterThan(fr,vec3(1.0/64.0)))&&all(lessThan(fr,vec3(63.0/64.0)))&&all(greaterThanEqual(fl,vec3(0.0)))&&all(lessThan(fl,texDims-1.0))){
     highp ivec3 sc=ivec3(fl);highp ivec3 sb=sc>>2;
     if(sb!=skBlk){skBlk=sb;skBits=texelFetch(skipTex,sb,0).rg;}
     highp ivec3 sl=sc&3;highp int sbit=sl.x+(sl.y<<2)+(sl.z<<4);
     highp uint sw=sbit<32?skBits.x:skBits.y;
     if(((sw>>uint(sbit&31))&1u)!=0u){prevValid=true;prevSkip=true;lastIndex=-1;previousT=t;t+=step;continue;}
    }
   }
#endif
   vec4 q=texture(clsTex,clamp(tcO+tcD*t,vec3(0.0),vec3(0.999999)));float dd=q.a*255.0;
   if(dd>=2.7&&t<=faceT){vec4 qf=q;
#ifdef VRL_CLS4
    qf.a=texture(cls4Tex,clamp(tcO+tcD*t,vec3(0.0),vec3(0.999999))).r;
#endif
    VRL_MP vec4 qfc=qf-0.5;if(max(max(dot(qfc,sel0)-off0,dot(qfc,sel1)-off1),max(dot(qfc,sel2)-off2,dot(qfc,sel3)-off3))>=0.0)dd=0.0;} // the entry sample on a box face inside a segment: no jump (faceT)
   // a jump is never shorter than a normal step
   if(dd>=2.7){float nextJ=max(t+(dd-1.8)*voxelMin,t+step);jumpLen+=nextJ-t;previousT=nextJ-step*0.05;prevValid=false;t=nextJ;continue;}
#ifdef VRL_CLS4
   q.a=texture(cls4Tex,clamp(tcO+tcD*t,vec3(0.0),vec3(0.999999))).r; // channel 3 = the fourth segment (only on sampled steps, never on jumps)
#endif
   VRL_MP vec4 qc=q-0.5;VRL_MP float f0=dot(qc,sel0)-off0,f1=dot(qc,sel1)-off1,f2=dot(qc,sel2)-off2,f3=dot(qc,sel3)-off3;
   int idx=-1;VRL_MP float curF=-1.0;
   if(f0>=0.0){idx=0;curF=f0;}else if(f1>=0.0){idx=1;curF=f1;}else if(f2>=0.0){idx=2;curF=f2;}else if(f3>=0.0){idx=3;curF=f3;}
   gQ=q;
   if(idx!=lastIndex){
    if(idx>=0){
#ifdef VRL_OPAQUE
     if(prevSkip&&prevValid){vec4 qp=texture(clsTex,clamp(tcO+tcD*previousT,vec3(0.0),vec3(0.999999)));
#ifdef VRL_CLS4
      qp.a=texture(cls4Tex,clamp(tcO+tcD*previousT,vec3(0.0),vec3(0.999999))).r;
#endif
      VRL_MP vec4 qpc=qp-0.5;VRL_MP float g0=dot(qpc,sel0)-off0,g1=dot(qpc,sel1)-off1,g2=dot(qpc,sel2)-off2,g3=dot(qpc,sel3)-off3;prevF=max(max(g0,g1),max(g2,g3));} // the skipped sample's value, as the original loop computed it
#endif
     float lo=previousT;float hi=t;bool simple=diag==3||segC[idx].w>0.5;
     VRL_MP float f1=curF;bool iso=refine==1&&((editMask>>idx)&1)==0&&prevValid&&prevF<0.0;
     int nb=prevValid?6:2; // right after a jump the bracket is ~0.05 step wide: two bisections are enough (was six)
#ifdef VRL_OPAQUE
     // segments are always opaque (alpha 1): every hit ends the ray and is searched and shaded after the loop
     {hitIdx=idx;hitLo=lo;hitHi=hi;hitF0=prevF;hitF1=f1;hitIso=iso;hitSimple=simple;hitNb=nb;lastIndex=idx;break;}
#else
     VRL_MP float alpha=clamp(segA[idx].z,0.03,1.0);
     if((1.0-acc.a)*alpha+acc.a>ACC_STOP&&!simple){hitIdx=idx;hitLo=lo;hitHi=hi;hitF0=prevF;hitF1=f1;hitIso=iso;hitNb=nb;lastIndex=idx;break;}
     int cIdx=clsChan[idx];
     if(!simple&&iso){float f0=prevF;
      for(int r=0;r<3;r++){float mid=(lo+hi)*0.5;if(r<2&&abs(f1-f0)>1e-6)mid=clamp(lo+(hi-lo)*(-f0/(f1-f0)),lo+(hi-lo)*0.02,hi-(hi-lo)*0.02);
       vec4 qm=texture(clsTex,clamp(tcO+tcD*mid,vec3(0.0),vec3(0.999999)));
#ifdef VRL_CLS4
      qm.a=texture(cls4Tex,clamp(tcO+tcD*mid,vec3(0.0),vec3(0.999999))).r;
#endif
      float fm=qm[cIdx]-0.5;bool inside=fm>=0.0;
       for(int s=0;s<4;s++){if(s>=idx)break;int c=clsChan[s];if(c>=0&&segA[s].w>0.5&&qm[c]>=0.5)inside=false;}
       if(inside){hi=mid;f1=fm;}else{lo=mid;f0=fm;}}}
     else if(!simple)for(int r=0;r<6;r++){if(r>=nb)break;float mid=(lo+hi)*0.5;vec4 qm=texture(clsTex,clamp(tcO+tcD*mid,vec3(0.0),vec3(0.999999)));
#ifdef VRL_CLS4
      qm.a=texture(cls4Tex,clamp(tcO+tcD*mid,vec3(0.0),vec3(0.999999))).r;
#endif
      bool inside=qm[cIdx]>=0.5;
       for(int s=0;s<4;s++){if(s>=idx)break;int c=clsChan[s];if(c>=0&&segA[s].w>0.5&&qm[c]>=0.5)inside=false;}
       if(inside)hi=mid;else lo=mid;}
     vec3 hp=o+dir*hi;vec3 tc=texCoord(hp);
     bool face=!simple&&hi<=faceEnd;vec3 n=simple?-dir:(face?entryFaceNormal(o,dir):gradientAt(tc));
     vec3 viewDir=normalize(o-hp);bool later=acc.a>0.0&&!simple&&!face;VRL_MP vec2 shade=vrlShade(later?(gHuMean<0.5*(segA[idx].x+segA[idx].y)?-n:n):n,viewDir,vLightOff,vrlDepth01(hi,o,halfExt),later?1.0:0.0,segM[idx].xyz);VRL_MP float diffuse=shade.x;VRL_MP float spec=shade.y;
     VRL_MP vec3 lit=regionColor(hp+dir*(0.75*voxelMin),segC[idx].rgb,idx)*diffuse+vec3(spec);
     VRL_MP float contribution=(1.0-acc.a)*alpha;acc=vec4(acc.rgb+lit*contribution,acc.a+contribution);depthMark(hi,contribution);
#endif
    }
    lastIndex=idx;
   }
   prevSkip=false;prevValid=true;prevF=idx>=0?curF:max(max(f0,f1),max(f2,f3));
   previousT=t;t+=step;
  }
#ifndef VRL_NO_EVENTS
  }else{
  for(int iter=0;iter<4096;iter++){
   if(t>endT||acc.a>ACC_STOP)break;
   iters++;
   // slices and the cut face as in the general loop (same order: slices up to t + step, then the cap, then the sample)
   while(nextSlice<nSlice&&sliceT[nextSlice]<=t+step){
    VRL_MP vec4 sc=sliceColor(o+dir*sliceT[nextSlice]);nextSlice++;
    VRL_MP float contribution=(1.0-acc.a)*sliceOpacity*sc.a;acc=vec4(acc.rgb+sc.rgb*contribution,acc.a+contribution);
   }
   if(capT>=0.0){
    vec3 cp=o+dir*capT;float capAt=capT;int ci=segmentIndexAt(texCoord(cp));capT=-1.0;
    if(ci>=0){
     vec3 n=cutPlanes[capPlane].xyz;vec3 viewDir=-dir;VRL_MP float diffuse=vrlShade(n,viewDir,vLightOff,vrlDepth01(capAt,o,halfExt),0.0,segM[ci].xyz).x;
     VRL_MP vec3 lit=mix(regionColor(cp,segC[ci].rgb,ci),vec3(1.0),0.22)*diffuse;
     VRL_MP float contribution=(1.0-acc.a)*clamp(segA[ci].z,0.03,1.0);acc=vec4(acc.rgb+lit*contribution,acc.a+contribution);depthMark(capAt,contribution);
     lastIndex=ci;previousT=t;t+=step;continue;
    }
   }
#ifdef VRL_OPAQUE
   // exact creep skip. The sample's trilinear footprint is the dual cell fl..fl+1 (pp = texel coordinate - 0.5); when its bit says "outside every shown segment, alpha <= 2" the original
   // loop would fetch, find no segment and no jump, and move on: do that without the fetch (prevF, the secant's outside value, is fetched at previousT only if a hit follows). A sample within 1/64 of a cell
   // face, or in the border cells (clamp-to-edge), is fetched as before (texel addressing precision). t advances by the same single add: pixel-identical.
   if(useSkip>0){
    vec3 pp=(tcO+tcD*t)*texDims-0.5;vec3 fl=floor(pp);vec3 fr=pp-fl;
    if(all(greaterThan(fr,vec3(1.0/64.0)))&&all(lessThan(fr,vec3(63.0/64.0)))&&all(greaterThanEqual(fl,vec3(0.0)))&&all(lessThan(fl,texDims-1.0))){
     highp ivec3 sc=ivec3(fl);highp ivec3 sb=sc>>2;
     if(sb!=skBlk){skBlk=sb;skBits=texelFetch(skipTex,sb,0).rg;}
     highp ivec3 sl=sc&3;highp int sbit=sl.x+(sl.y<<2)+(sl.z<<4);
     highp uint sw=sbit<32?skBits.x:skBits.y;
     if(((sw>>uint(sbit&31))&1u)!=0u){prevValid=true;prevSkip=true;lastIndex=-1;previousT=t;t+=step;continue;}
    }
   }
#endif
   vec4 q=texture(clsTex,clamp(tcO+tcD*t,vec3(0.0),vec3(0.999999)));float dd=q.a*255.0;
   if(dd>=2.7&&t<=faceT){vec4 qf=q;
#ifdef VRL_CLS4
    qf.a=texture(cls4Tex,clamp(tcO+tcD*t,vec3(0.0),vec3(0.999999))).r;
#endif
    VRL_MP vec4 qfc=qf-0.5;if(max(max(dot(qfc,sel0)-off0,dot(qfc,sel1)-off1),max(dot(qfc,sel2)-off2,dot(qfc,sel3)-off3))>=0.0)dd=0.0;} // the entry sample on a box face inside a segment: no jump (faceT)
   // a jump is never shorter than a normal step
   if(dd>=2.7){float nextJ=max(t+(dd-1.8)*voxelMin,t+step);jumpLen+=nextJ-t;previousT=nextJ-step*0.05;prevValid=false;t=nextJ;continue;}
#ifdef VRL_CLS4
   q.a=texture(cls4Tex,clamp(tcO+tcD*t,vec3(0.0),vec3(0.999999))).r; // channel 3 = the fourth segment (only on sampled steps, never on jumps)
#endif
   VRL_MP vec4 qc=q-0.5;VRL_MP float f0=dot(qc,sel0)-off0,f1=dot(qc,sel1)-off1,f2=dot(qc,sel2)-off2,f3=dot(qc,sel3)-off3;
   int idx=-1;VRL_MP float curF=-1.0;
   if(f0>=0.0){idx=0;curF=f0;}else if(f1>=0.0){idx=1;curF=f1;}else if(f2>=0.0){idx=2;curF=f2;}else if(f3>=0.0){idx=3;curF=f3;}
   gQ=q;
   if(idx!=lastIndex){
    if(idx>=0){
#ifdef VRL_OPAQUE
     if(prevSkip&&prevValid){vec4 qp=texture(clsTex,clamp(tcO+tcD*previousT,vec3(0.0),vec3(0.999999)));
#ifdef VRL_CLS4
      qp.a=texture(cls4Tex,clamp(tcO+tcD*previousT,vec3(0.0),vec3(0.999999))).r;
#endif
      VRL_MP vec4 qpc=qp-0.5;VRL_MP float g0=dot(qpc,sel0)-off0,g1=dot(qpc,sel1)-off1,g2=dot(qpc,sel2)-off2,g3=dot(qpc,sel3)-off3;prevF=max(max(g0,g1),max(g2,g3));} // the skipped sample's value, as the original loop computed it
#endif
     float lo=previousT;float hi=t;bool simple=diag==3||segC[idx].w>0.5;
     VRL_MP float f1=curF;bool iso=refine==1&&((editMask>>idx)&1)==0&&prevValid&&prevF<0.0;
     int nb=prevValid?6:2; // right after a jump the bracket is ~0.05 step wide: two bisections are enough (was six)
#ifdef VRL_OPAQUE
     // segments are always opaque (alpha 1): every hit ends the ray and is searched and shaded after the loop
     {hitIdx=idx;hitLo=lo;hitHi=hi;hitF0=prevF;hitF1=f1;hitIso=iso;hitSimple=simple;hitNb=nb;lastIndex=idx;break;}
#else
     VRL_MP float alpha=clamp(segA[idx].z,0.03,1.0);
     if((1.0-acc.a)*alpha+acc.a>ACC_STOP&&!simple){hitIdx=idx;hitLo=lo;hitHi=hi;hitF0=prevF;hitF1=f1;hitIso=iso;hitNb=nb;lastIndex=idx;break;}
     int cIdx=clsChan[idx];
     if(!simple&&iso){float f0=prevF;
      for(int r=0;r<3;r++){float mid=(lo+hi)*0.5;if(r<2&&abs(f1-f0)>1e-6)mid=clamp(lo+(hi-lo)*(-f0/(f1-f0)),lo+(hi-lo)*0.02,hi-(hi-lo)*0.02);
       vec4 qm=texture(clsTex,clamp(tcO+tcD*mid,vec3(0.0),vec3(0.999999)));
#ifdef VRL_CLS4
      qm.a=texture(cls4Tex,clamp(tcO+tcD*mid,vec3(0.0),vec3(0.999999))).r;
#endif
      float fm=qm[cIdx]-0.5;bool inside=fm>=0.0;
       for(int s=0;s<4;s++){if(s>=idx)break;int c=clsChan[s];if(c>=0&&segA[s].w>0.5&&qm[c]>=0.5)inside=false;}
       if(inside){hi=mid;f1=fm;}else{lo=mid;f0=fm;}}}
     else if(!simple)for(int r=0;r<6;r++){if(r>=nb)break;float mid=(lo+hi)*0.5;vec4 qm=texture(clsTex,clamp(tcO+tcD*mid,vec3(0.0),vec3(0.999999)));
#ifdef VRL_CLS4
      qm.a=texture(cls4Tex,clamp(tcO+tcD*mid,vec3(0.0),vec3(0.999999))).r;
#endif
      bool inside=qm[cIdx]>=0.5;
       for(int s=0;s<4;s++){if(s>=idx)break;int c=clsChan[s];if(c>=0&&segA[s].w>0.5&&qm[c]>=0.5)inside=false;}
       if(inside)hi=mid;else lo=mid;}
     vec3 hp=o+dir*hi;vec3 tc=texCoord(hp);
     bool face=!simple&&hi<=faceEnd;vec3 n=simple?-dir:(face?entryFaceNormal(o,dir):gradientAt(tc));
     vec3 viewDir=normalize(o-hp);bool later=acc.a>0.0&&!simple&&!face;VRL_MP vec2 shade=vrlShade(later?(gHuMean<0.5*(segA[idx].x+segA[idx].y)?-n:n):n,viewDir,vLightOff,vrlDepth01(hi,o,halfExt),later?1.0:0.0,segM[idx].xyz);VRL_MP float diffuse=shade.x;VRL_MP float spec=shade.y;
     VRL_MP vec3 lit=regionColor(hp+dir*(0.75*voxelMin),segC[idx].rgb,idx)*diffuse+vec3(spec);
     VRL_MP float contribution=(1.0-acc.a)*alpha;acc=vec4(acc.rgb+lit*contribution,acc.a+contribution);depthMark(hi,contribution);
#endif
    }
    lastIndex=idx;
   }
   prevSkip=false;prevValid=true;prevF=idx>=0?curF:max(max(f0,f1),max(f2,f3));
   previousT=t;t+=step;
  }
  }
#endif
  if(hitIdx>=0){
   int idx=hitIdx;float lo=hitLo;float hi=hitHi;float f0=hitF0;float f1=hitF1;int cIdx=clsChan[idx];
   if(hitSimple){}
   else if(hitIso){
    for(int r=0;r<3;r++){float mid=(lo+hi)*0.5;if(r<2&&abs(f1-f0)>1e-6)mid=clamp(lo+(hi-lo)*(-f0/(f1-f0)),lo+(hi-lo)*0.02,hi-(hi-lo)*0.02);
     vec4 qm=texture(clsTex,clamp(tcO+tcD*mid,vec3(0.0),vec3(0.999999)));
#ifdef VRL_CLS4
      qm.a=texture(cls4Tex,clamp(tcO+tcD*mid,vec3(0.0),vec3(0.999999))).r;
#endif
      float fm=qm[cIdx]-0.5;bool inside=fm>=0.0;
     for(int s=0;s<4;s++){if(s>=idx)break;int c=clsChan[s];if(c>=0&&segA[s].w>0.5&&qm[c]>=0.5)inside=false;}
     if(inside){hi=mid;f1=fm;}else{lo=mid;f0=fm;}}}
   else if(!hitSimple)for(int r=0;r<6;r++){if(r>=hitNb)break;float mid=(lo+hi)*0.5;vec4 qm=texture(clsTex,clamp(tcO+tcD*mid,vec3(0.0),vec3(0.999999)));
#ifdef VRL_CLS4
      qm.a=texture(cls4Tex,clamp(tcO+tcD*mid,vec3(0.0),vec3(0.999999))).r;
#endif
      bool inside=qm[cIdx]>=0.5;
     for(int s=0;s<4;s++){if(s>=idx)break;int c=clsChan[s];if(c>=0&&segA[s].w>0.5&&qm[c]>=0.5)inside=false;}
     if(inside)hi=mid;else lo=mid;}
   vec3 hp=o+dir*hi;vec3 tc=texCoord(hp);
   bool face=!hitSimple&&hi<=faceEnd;vec3 n=hitSimple?-dir:(face?entryFaceNormal(o,dir):gradientAt(tc));
   vec3 viewDir=normalize(o-hp);bool later=acc.a>0.0&&!hitSimple&&!face;VRL_MP vec2 shade=vrlShade(later?(gHuMean<0.5*(segA[idx].x+segA[idx].y)?-n:n):n,viewDir,vLightOff,vrlDepth01(hi,o,halfExt),later?1.0:0.0,segM[idx].xyz);VRL_MP float diffuse=shade.x;VRL_MP float spec=shade.y;
   VRL_MP float alpha=clamp(segA[idx].z,0.03,1.0);
   VRL_MP vec3 lit=regionColor(hp+dir*(0.75*voxelMin),segC[idx].rgb,idx)*diffuse+vec3(spec);
   float contribution=(1.0-acc.a)*alpha;acc=vec4(acc.rgb+lit*contribution,acc.a+contribution);hitEnd=true;
   depthMark(hi,1.0);
  }
#ifndef VRL_NO_GENERAL
 }else
 for(int iter=0;iter<4096;iter++){
  if(t>endT||acc.a>ACC_STOP)break;
  iters++;
  while(nextSlice<nSlice&&sliceT[nextSlice]<=t+step){
   // a slice lies before the next sample: composite it in depth order
   VRL_MP vec4 sc=sliceColor(o+dir*sliceT[nextSlice]);nextSlice++;
   VRL_MP float contribution=(1.0-acc.a)*sliceOpacity*sc.a;acc=vec4(acc.rgb+sc.rgb*contribution,acc.a+contribution);
  }
  if(capT>=0.0){
   // cut face: flat, segment colour lightened, lit by the plane normal
   vec3 cp=o+dir*capT;float capAt=capT;int ci=segmentIndexAt(texCoord(cp));capT=-1.0;
   if(ci>=0){
    vec3 n=cutPlanes[capPlane].xyz;vec3 viewDir=-dir;VRL_MP float diffuse=vrlShade(n,viewDir,vLightOff,vrlDepth01(capAt,o,halfExt),0.0,segM[ci].xyz).x;
    VRL_MP vec3 lit=mix(regionColor(cp,segC[ci].rgb,ci),vec3(1.0),0.22)*diffuse;
    VRL_MP float contribution=(1.0-acc.a)*clamp(segA[ci].z,0.03,1.0);acc=vec4(acc.rgb+lit*contribution,acc.a+contribution);depthMark(capAt,contribution);
    lastIndex=ci;previousT=t;t+=step;continue;
   }
  }
  vec3 p=o+dir*t;vec3 tc0=texCoord(p);
  bool haveQ=false;vec4 qHere=vec4(0.0);
  if(distInCls>0&&useCls>0&&diag!=4){
   // one fetch serves the jump test (alpha) and the classification below. The alpha is filtered
   // trilinearly: every corner value is a lower bound of the distance to the seeds and the distance is
   // 1-Lipschitz, so the surface is at least dd - 1.74 voxels away; jump dd - 1.8 when that is 0.9 or more
   qHere=texture(clsTex,clamp(tc0,vec3(0.0),vec3(0.999999)));haveQ=true;float dd=qHere.a*255.0;
   if(dd>=2.7&&t<=faceT){vec4 qf=qHere;
#ifdef VRL_CLS4
    qf.a=texture(cls4Tex,clamp(tc0,vec3(0.0),vec3(0.999999))).r;
#endif
    if(segmentIndexFromQ(qf)>=0)dd=0.0;} // no jump at the entry sample on a box face inside a segment (faceT)
   if(dd>=2.7){float nextJ=t+(dd-1.8)*voxelMin;jumpLen+=nextJ-t;previousT=nextJ-step*0.05;prevValid=false;t=nextJ;continue;}
#ifdef VRL_CLS4
   qHere.a=texture(cls4Tex,clamp(tc0,vec3(0.0),vec3(0.999999))).r;
#endif
  }
  else if(useDist>0&&diag!=4){
   // the field is read only when a jump is possible. One step moves the sampled voxel by at most one per
   // axis (chamfer 5 = 1.5 in field units, floor: +2), so after a read of 0 the next value is at most 2 and the read is
   // skipped; the bound grows by distInc per skipped step (steps longer than a voxel: more). Same jumps, same image.
   if(lastDd>=1.0){float dd=distAt(tc0);lastDd=dd;
    if(dd>=3.0&&t<=faceT&&segmentIndexAt(tc0)>=0)dd=0.0; // no jump at the entry sample on a box face inside a segment (faceT)
    if(dd>=3.0){float nextJ=t+(dd-2.0)*voxelMin;jumpLen+=nextJ-t;previousT=nextJ-step*0.05;prevValid=false;t=nextJ;lastDd=99.0;continue;}
   }else{lastDd+=distInc;}
  }
  bool canSample=diag==4||useDist>0||t<brickEnd;
  if(!canSample){int bc=brickClass(tc0);canSample=bc>0;uniformSeg=bc>=2?bc-2:-1;if(canSample)brickEnd=t+brickExit(tc0,dir);}
  float nextT=t+step;
  if(!canSample){brickEnd=-1.0;prevValid=false;nextT=t+max(brickExit(tc0,dir)+step*0.05,step);lastIndex=-1;}
  else if(diag!=4&&uniformSeg>=0&&uniformSeg==lastIndex&&brickEnd>t+step){
   // inside a uniform brick of the segment the ray is already in: nothing changes until it is left
   nextT=brickEnd+step*0.05;previousT=max(t,brickEnd-step*0.05);prevValid=false;t=nextT;continue;
  }
  else{
   int idx=haveQ?segmentIndexFromQ(qHere):segmentIndexAt(tc0);
   float curF=idx>=0?segValue(idx):-1.0;
   if(idx!=lastIndex){
    if(idx>=0){
     float lo=previousT;float hi=t;bool simple=diag==3||segC[idx].w>0.5;
     // fast search: the boundary is an iso-value of the sampled
     // field (no processing mask on the segment, previous sample measured and
     // outside): two secant guesses + one bisection instead of six bisections
     float f1=segValue(idx);bool iso=refine==1&&((editMask>>idx)&1)==0&&prevValid&&prevF<0.0;
     if(!simple&&iso){float f0=prevF;
      for(int r=0;r<3;r++){float mid=(lo+hi)*0.5;if(r<2&&abs(f1-f0)>1e-6)mid=clamp(lo+(hi-lo)*(-f0/(f1-f0)),lo+(hi-lo)*0.02,hi-(hi-lo)*0.02);
       bool inside=segmentIndexAt(texCoord(o+dir*mid))==idx;float fm=segValue(idx);if(inside){hi=mid;f1=fm;}else{lo=mid;f0=fm;}}}
     else if(!simple)for(int r=0;r<6;r++){float mid=(lo+hi)*0.5;if(segmentIndexAt(texCoord(o+dir*mid))==idx)hi=mid;else lo=mid;}
     vec3 hp=o+dir*hi;vec3 tc=texCoord(hp);
     bool face=!simple&&hi<=faceEnd;vec3 n=simple?-dir:(face?entryFaceNormal(o,dir):gradientAt(tc));
     vec3 viewDir=normalize(o-hp);bool later=acc.a>0.0&&!simple&&!face;VRL_MP vec2 shade=vrlShade(later?(gHuMean<0.5*(segA[idx].x+segA[idx].y)?-n:n):n,viewDir,vLightOff,vrlDepth01(hi,o,halfExt),later?1.0:0.0,segM[idx].xyz);VRL_MP float diffuse=shade.x;VRL_MP float spec=shade.y;
     VRL_MP float alpha=clamp(segA[idx].z,0.03,1.0);
     VRL_MP vec3 lit=regionColor(hp+dir*(0.75*voxelMin),segC[idx].rgb,idx)*diffuse+vec3(spec);
     VRL_MP float contribution=(1.0-acc.a)*alpha;acc=vec4(acc.rgb+lit*contribution,acc.a+contribution);depthMark(hi,contribution);
    }
    lastIndex=idx;
   }
   // outside value for the next segment's search: the largest segment value
   // at this sample when no segment holds it (kept negative), else its own
   prevValid=true;prevF=idx>=0?curF:maxSegValue();
  }
  previousT=t;t=nextT;
 }
#else
 }
#endif
 while(nextSlice<nSlice&&acc.a<=ACC_STOP){
  VRL_MP vec4 sc=sliceColor(o+dir*sliceT[nextSlice]);nextSlice++;
  VRL_MP float contribution=(1.0-acc.a)*sliceOpacity*sc.a;acc=vec4(acc.rgb+sc.rgb*contribution,acc.a+contribution);
 }
 if(diag==2){float h=clamp(float(iters)/1024.0,0.0,1.0);outColor=vec4(h,1.0-abs(h*2.0-1.0),1.0-h,1.0);return;}
 if(acc.a>ACC_STOP)hitEnd=true;
 // probe (diag 5, the VR settings tab 4): R = samples / 1024, G = ray ended by a hit, B = share of the path skipped by jumps
 if(diag==5){outColor=vec4(clamp(float(iters)/1024.0,0.0,1.0),hitEnd?1.0:0.0,clamp(jumpLen/max(endT-t0,1e-6),0.0,1.0),1.0);return;}
 if(acc.a<0.004)discard;
 // a ray stopped at ACC_STOP is made fully opaque (AR passthrough would show the real world through the last 5 %)
 if(acc.a>ACC_STOP)acc/=acc.a;
 if(gDepthT>=0.0){vec4 cp=projectionMatrix*(modelViewMatrix*vec4(o+dir*(gDepthT+depthBias(dir)),1.0));if(cp.w>1e-6)gl_FragDepth=clamp(cp.z/cp.w*0.5+0.5,0.0,1.0);}
 // premultiplied, blended over the VR background (raw colour like the
 // WebGPU canvas: no colour-space conversion)
 outColor=acc;
}`;

// brick min/max in HU; one voxel of overlap so trilinear samples at a
// brick edge are covered. Four floats per brick (RGBA32F texture): min, max,
// mask-only occupancy (filled by prepareVrData), unused
function computeBricks(data,dims,calibration){return computeBricksOf(data,dims,calibration,BRICK)}

// processed-segment mask (RGBA, one channel per segment) on the given grid: the WebGPU edit runs mapped with the same gpuRunsForTexture (exclude runs dilated by one on a reduced
// grid, as the WebGPU volume does).: the page only collects what the segments hold (editDescsOf); vr-volume-prep.js buildEditMaskOf makes the bytes (in the worker for the
// VR data: the mapping and the fills were 0.2-0.6 s of main thread; here, synchronously, for the 3D markers' hidden test)
function editDescsOf(){
 const v=gpuVolumeTarget();if(!v)return null;
 const descs=gpuVolumeEditDescriptors(undefined,segAvail),out=[];
 gpuSegmentOrder().forEach((key,si)=>{const desc=descs[key];if(desc?.runs)out.push({si,mode:desc.mode,maskOnly:!!desc.maskOnly,runs:desc.runs})});
 return{descs:out,sourceDims:[v.columns,v.rows,v.slices]};
}
function buildEditMask(dims){const e=editDescsOf();return e?buildEditMaskOf(e.descs,e.sourceDims,dims):{activeMask:0,data:null}}
// rg8-packed u16 texture of the current volume, built with the same plan,
// area reduction and packing as the WebGPU upload, plus per-brick HU min/max
// what the data's geometry decides (the grid, the calibration, the box, the march step): no voxel is read. buildVolumeData and the cache path (the finished data read from the device) share it
function volumeMeta(maxDim){
 const v=gpuVolumeTarget(),s=v?.series;
 if(!v?.sourceBacked||!s)throw new Error('VR: open a DICOM series first');
 const plan=volumeTexturePlan(v,0,maxDim,VR_TARGET_SIDE),[tw,th,td]=plan.dims,first=s.slices[0],signed=!!first.signed;
 const slope=first.slope||1,intercept=first.intercept||0,bias=signed?32768:0,calibration=[slope,intercept,bias];
 const px=s.columns*s.spacingX,py=s.rows*s.spacingY,pz=s.slices.length*s.spacingZ,maxP=Math.max(px,py,pz,1),scale=3.3/maxP;
 const halfExt=[px*scale*.5,py*scale*.5,pz*scale*.5],step=marchStep(halfExt,[tw,th,td]);
 return{v,s,plan,dims:[tw,th,td],first,signed,calibration,halfExt,step,filtered:!!(v.filterSignature&&typeof v.sliceData==='function')};
}
async function buildVolumeData(maxDim,onProgress,{noBricks=false,sliceMs=0}={}){
 const {v,s,plan,dims:[tw,th,td],first,signed,calibration:calib0}=volumeMeta(maxDim);
 const filtered=!!(v.filterSignature&&typeof v.sliceData==='function');
 const sliceBytes=filtered?async z=>packCtSlice(await v.sliceData(z),first):z=>packedRgSlice(s.slices[z]);
 // when the 3D view's WebGPU texture holds the same data on the
 // same grid (series, filter signature, plan), copy it instead of reading
 // and filtering the DICOM slices again
 const mv=sceneState?.medicalVolume;let copied=null;
 if(mv?.texture&&typeof mv.readPackedTexture==='function'&&mv.seriesId===s.id&&mv.dataSignature!=='partial'&&(mv.dataSignature||'')===(v.filterSignature||'')&&mv.textureDims?.join()===plan.dims.join()){
  try{copied=await mv.readPackedTexture((a,b)=>onProgress?.(a,b,'gpu'))}catch(e){console.warn('VR: GPU copy failed, reading slices',e);copied=null}
 }
 const data=copied?.data||new Uint8Array(tw*th*td*2),sliceSize=tw*th*2;
 const spans=(n,t)=>{const a=new Uint32Array(t+1);for(let i=0;i<=t;i++)a[i]=Math.min(n,Math.round(i*n/t));for(let i=0;i<t;i++)if(a[i+1]<=a[i])a[i+1]=Math.min(n,a[i]+1);return a};
 const xs=spans(s.columns,tw),ys=spans(s.rows,th),rowSum=new Float64Array(tw),rowCnt=new Uint32Array(tw);
 const zMap=new Uint32Array(td);for(let z=0;z<td;z++)zMap[z]=td<=1?0:Math.round(z*(s.slices.length-1)/(td-1));
 // inside a running VR session (sliceMs > 0) the loop gives the main thread back after every ~sliceMs of work (a frame callback never waits behind 16 slices); on the page: every 16 slices as before
 let sliceAt=performance.now();
 for(let z=0;z<td&&!copied;z++){
  const packed=await sliceBytes(plan.reduced?zMap[z]:z),out=data.subarray(z*sliceSize,(z+1)*sliceSize);
  if(plan.reduced)reduceSliceArea(packed,s.columns,xs,ys,tw,th,tw*2,out,rowSum,rowCnt);else out.set(packed.subarray(0,sliceSize));
  if(sliceMs>0?performance.now()-sliceAt>=sliceMs||z===td-1:(z&15)===15||z===td-1){onProgress?.(z+1,td);await(sliceMs>0?yieldMain():new Promise(r=>setTimeout(r,0)));sliceAt=performance.now()}
 }
const calibration=calib0;
 const {bricks:mm,brickDims}=noBricks?{bricks:null,brickDims:null}:computeBricks(data,[tw,th,td],calibration);
 const px=s.columns*s.spacingX,py=s.rows*s.spacingY,pz=s.slices.length*s.spacingZ,maxP=Math.max(px,py,pz,1),scale=3.3/maxP;
 const halfExt=[px*scale*.5,py*scale*.5,pz*scale*.5],step=marchStep(halfExt,[tw,th,td]);
 return{data,dims:[tw,th,td],bricks:mm,brickDims,halfExt,step,calibration,filtered,source:copied?'gpu':'files'};
}

// VR settings kept per browser (resolution only applies when a session starts)
const SETTINGS_KEY='vrl-vr-settings-5',OLD_KEYS=['vrl-vr-settings-4','vrl-vr-settings-3'];
const DEFAULTS_VERSION=3,DEFAULTS_VERSION_KEYS=['sliceAir','sliceTint','sliceOpacity','menuMode','help','cut'],DEFAULTS_VERSION_STEPS=[[2,DEFAULTS_VERSION_KEYS],[3,['ctShadeBright','ctShadeContrast']]];
// menuMode 0 follows the head lazily, 1 stays where it is (the default now; help: 0 hidden / 1 follows / 2 fixed, default 2; cut: 0 off / 1 near side / 2 one side, default 2)
const DEFAULTS={cap:1,sliceAir:-600,sliceTint:0.45,menuMode:1,wheel:[...DEFAULT_WHEEL],wheelMig:0,cut:2,sliceOpacity:0.6,data:1,quality:0,vres:0,autoMin:0,foveation:2,rate:0,help:2,refine:1,labelSize:0,labelHide:LABEL_HIDE_DEFAULT,ctShade:1,ctShadeBright:1.8,ctShadeContrast:1.7,laserStyle:1}; // labelHide: 1 = distance labels / lines hidden for real behind the tissue (GPU depth), 0 = faded (CPU probes)
// ctShade: how the slice's segment fill is drawn — 1 = segment colour x CT value (default; also at 0 % / cleared, where only the segments' region is drawn), 0 = the flat segment colour as before; the 3D surface / cap never use it
// ctShadeBright: brightness of that shading, 0.5..2 in steps of 0.1 (default 1.8; it was 1.3, and the first CT shading is 1.0); only used with ctShade 1. Like ctShade it is not in EVENT_VIEW_KEYS (a menu preference, not a view value)
const CT_BRIGHT_MIN=0.5,CT_BRIGHT_MAX=2,CT_BRIGHT_STEP=0.1,ctBrightOf=v=>{v=+v;return Number.isFinite(v)?Math.min(CT_BRIGHT_MAX,Math.max(CT_BRIGHT_MIN,Math.round(v*10)/10)):DEFAULTS.ctShadeBright};
// laserStyle: the controller / hand laser's look, 0 = 線 (the 1 px line of), 1 = 帯・細 (the light-beam ribbon, 2 mm at the hand tapering to 0.6 mm at the tip; default), 2 = 帯・太 (the ribbon of: 3 mm, constant width);
// a menu preference (表示 tab) saved like the others, not in EVENT_VIEW_KEYS / DEFAULTS_VERSION_KEYS, no URL parameter; applies live (every frame)
const LASER_LOOKS=[{line:true},{w:0.001,t:0.3},{w:0.0015,t:1}],laserLookOf=v=>{const n=typeof v==='number'||typeof v==='string'&&v.trim()!==''?Math.round(+v):NaN;return n>=0&&n<=2?n:DEFAULTS.laserStyle};
// ctShadeContrast: contrast of that shading, 0.5..2 in steps of 0.1 (default 1.7; 1 = the shading as it was); only used with ctShade 1, a menu preference like ctShadeBright (not in EVENT_VIEW_KEYS)
const CT_CONTRAST_MIN=0.5,CT_CONTRAST_MAX=2,CT_CONTRAST_STEP=0.1,ctContrastOf=v=>{v=+v;return Number.isFinite(v)?Math.min(CT_CONTRAST_MAX,Math.max(CT_CONTRAST_MIN,Math.round(v*10)/10)):DEFAULTS.ctShadeContrast};
// an older key is migrated once, with the slice opacity reset to the new default
function loadSettings(){try{const n=localStorage.getItem(SETTINGS_KEY),o=n==null&&OLD_KEYS.map(k=>localStorage.getItem(k)).find(Boolean);const st=JSON.parse(n||o||'{}'),v={...DEFAULTS,...st,...(o?{sliceOpacity:DEFAULTS.sliceOpacity}:{})};v.dv=st.dv|0;v.wheel=normalizeWheelItems(v.wheel);const m=migrateWheelSectionFlip(v);v.wheel=m.wheel;v.wheelMig=m.wheelMig;const dm=migrateStartValues(v);if(m.changed||dm)saveSettings(v);return v}catch{return{...DEFAULTS,wheel:[...DEFAULT_WHEEL]}}}
// the one-time step to the start values above (see DEFAULTS_VERSION): true = v was changed (the caller saves it)
function migrateStartValues(v){const d=v.dv|0;if(d>=DEFAULTS_VERSION)return false;for(const[n,ks]of DEFAULTS_VERSION_STEPS)if(d<n)for(const k of ks)v[k]=DEFAULTS[k];v.dv=DEFAULTS_VERSION;return true}
function saveSettings(v){try{localStorage.setItem(SETTINGS_KEY,JSON.stringify(v))}catch{}}
// 体験会モード: what a visitor can change in the full menu's 表示 / 詳細 tabs and that shows in the picture (the section's cut / cap / slice look / air floor, the label size) goes back to its default
// by 最初の状態に戻す and by a new practice dataset (like menuMode / help: the board positions). Quality / data size / frame rate / diagnostics are the device's, not the visitor's: untouched.
const EVENT_VIEW_KEYS=['cut','cap','sliceAir','sliceTint','sliceOpacity','labelSize'];
const resetEventViewSettings=v=>{for(const k of EVENT_VIEW_KEYS)v[k]=DEFAULTS[k];v.menuMode=DEFAULTS.menuMode;v.help=DEFAULTS.help;return v};
const VRES=[0,1,0.7,0.5],STEP=STEP_LEVELS,FOVEATION=[0,0.5,1];
// VR window slider / button step in HU
const WIN_STEP=10,AIR_MIN=-1000,AIR_MAX=500;

// upscales the offscreen volume image; drawn with the volume box so only the
// covered pixels are touched
// the composite stays on the full box (not the content box): its bilinear upscale reaches one low-resolution texel past the
// silhouette, which at a low scale can be more than the content box's margin; a covered pixel costs one fetch there, not a march
const compositeVertex=`
uniform vec3 halfExt;
void main(){gl_Position=projectionMatrix*modelViewMatrix*vec4(position*halfExt,1.0);}`;
const compositeFragment=`
precision highp float;
uniform sampler2D img;
uniform highp sampler2D depthImg; // the offscreen pass's depth (the volume writes its first-hit depth, vr-depth.js); nearest-sampled and written to the main pass's depth buffer
uniform vec2 invSize; // resolution factor / offscreen target size
// offscreen foveation (fovOn = 1): the centre rect of each eye (rectL / rectR, framebuffer px x0 y0 x1 y1; the right eye from splitX on) comes from img at the
// full volume scale, everything else from img2 rendered at a lower scale (invSize2), blended over band px inside the rect edge. fovOn = 0: img only (as before)
uniform sampler2D img2;
uniform highp sampler2D depthImg2;
uniform vec2 invSize2;
uniform float fovOn;
uniform vec4 rectL;
uniform vec4 rectR;
uniform float splitX;
uniform float band;
// the used corner of each target (its rendered size - half a texel, / the target size): the bilinear upscale never reads the cleared
// texels past it, so the outer edge of the right / top eye border does not bleed towards transparent (the full-size target has no clamp-to-edge there)
uniform vec2 uvMax;
uniform vec2 uvMax2;
out highp vec4 outColor;
void main(){vec2 p=gl_FragCoord.xy,uv=min(p*invSize,uvMax);vec4 c;float d;
 if(fovOn>0.5){vec4 r=p.x<splitX?rectL:rectR;vec2 e=min(p-r.xy,r.zw-p);float wt=clamp(min(e.x,e.y)/band,0.0,1.0);
  if(wt>=1.0){c=texture(img,uv);d=texture(depthImg,uv).r;}
  else{vec2 uv2=min(p*invSize2,uvMax2);vec4 c2=texture(img2,uv2);float d2=texture(depthImg2,uv2).r;
   if(wt<=0.0){c=c2;d=d2;}else{vec4 c1=texture(img,uv);c=mix(c2,c1,wt);d=wt>=0.5?texture(depthImg,uv).r:d2;}}
 }else{c=texture(img,uv);d=texture(depthImg,uv).r;}
 if(c.a<=0.0)discard;gl_FragDepth=d;outColor=c;}`;
// the composite's uniforms (warm-up copy and the session's material)
const compositeUniforms=halfExt=>({img:{value:null},depthImg:{value:null},invSize:{value:new THREE.Vector2(1,1)},halfExt:{value:new THREE.Vector3(...halfExt)},
 img2:{value:null},depthImg2:{value:null},invSize2:{value:new THREE.Vector2(1,1)},fovOn:{value:0},rectL:{value:new THREE.Vector4()},rectR:{value:new THREE.Vector4()},splitX:{value:1e9},band:{value:1},uvMax:{value:new THREE.Vector2(1,1)},uvMax2:{value:new THREE.Vector2(1,1)}});

// background: a dark gradient dome and a floor grid (a few triangles, no
// cost next to the ray marching)
function makeBackground(){
 const g=new THREE.Group();
 const dome=new THREE.Mesh(new THREE.SphereGeometry(30,32,16),new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,toneMapped:false,
  vertexShader:'varying float h;void main(){h=normalize(position).y;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
  fragmentShader:'varying float h;void main(){vec3 lo=vec3(0.035,0.045,0.05);vec3 hi=vec3(0.10,0.14,0.20);gl_FragColor=vec4(mix(lo,hi,smoothstep(-0.1,0.8,h)),1.0);}'}));
 const grid=new THREE.GridHelper(12,24,0x3a5a70,0x1e2e3a);grid.material.transparent=true;grid.material.opacity=0.55;grid.renderOrder=-1;
 g.add(dome,grid);return g;
}

// Canvas-drawn menu. Beginner-first layout: header (title, follow
// or fixed, close), tabs, one status line, then the tab's widgets. Widgets:
// {type:'button',x,y,w,h,label,on,color,action}, {type:'label',x,y,text},
// {type:'slider',x,y,w,h,value(0..1),text,set(v)}. The trigger presses a
// button or drags a slider while held.: canvas size and width in
// metres are parameters (the left-hand section panel uses a small one).
// res = canvas pixels per layout pixel (the help / ev boards: HELP_RES): the widgets keep their W x H layout, the canvas is drawn res times finer
const MENU_W=1024,MENU_H=1180;
function makeMenu(W=MENU_W,H=MENU_H,widthM=0.5,res=1){
 const canvas=document.createElement('canvas');canvas.width=Math.round(W*res);canvas.height=Math.round(H*res);
 const ctx=canvas.getContext('2d'),tex=new THREE.CanvasTexture(canvas);tex.colorSpace=THREE.SRGBColorSpace;
 const mesh=new THREE.Mesh(new THREE.PlaneGeometry(widthM,widthM*H/W),new THREE.MeshBasicMaterial({map:tex,transparent:true,toneMapped:false}));
 let widgets=[],hover=-1,draw=()=>[],dirty=true;
 const render=()=>{
  ctx.setTransform(res,0,0,res,0,0);ctx.clearRect(0,0,W,H);ctx.fillStyle='rgba(14,20,27,.94)';ctx.beginPath();ctx.roundRect(0,0,W,H,30);ctx.fill();
  ctx.textBaseline='middle';
  widgets.forEach((w,i)=>{
   if(w.type==='draw'){ctx.save();try{w.draw(ctx)}catch(e){console.warn('[menu] draw widget',e)}ctx.restore();ctx.textBaseline='middle';return} // a widget that draws itself (the slide pictures and the tutorial's marks / pointers: tutorial-vr.js, tutorial-marks.js)
   if(w.type==='label'){ctx.fillStyle=w.color||'#cfe3f0';ctx.font=(w.bold?'bold ':'')+(w.size||30)+'px system-ui,sans-serif';ctx.textAlign='left';
    if(w.lines){w.lines.forEach((ln,k)=>ctx.fillText(ln,w.x,w.y+k*w.lh));return}
    ctx.fillText(w.text,w.x,w.y);return}
   if(w.type==='slider'){
    ctx.fillStyle='#26313b';ctx.beginPath();ctx.roundRect(w.x,w.y+w.h/2-10,w.w,20,10);ctx.fill();
    ctx.fillStyle='#2d6cdf';ctx.beginPath();ctx.roundRect(w.x,w.y+w.h/2-10,Math.max(20,w.w*w.value),20,10);ctx.fill();
    const kx=w.x+w.w*w.value;ctx.fillStyle=i===hover?'#fff':'#dfe8f0';ctx.beginPath();ctx.arc(kx,w.y+w.h/2,26,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#fff';ctx.font='30px system-ui,sans-serif';ctx.textAlign='left';ctx.fillText(w.text,w.x+w.w+30,w.y+w.h/2);return;
   }
   ctx.fillStyle=w.disabled?'#1a2129':w.on?(w.color||'#2d6cdf'):(i===hover?'#3a4652':'#26313b');ctx.beginPath();ctx.roundRect(w.x,w.y,w.w,w.h,16);ctx.fill();
   if(w.color&&!w.on&&!w.disabled){ctx.strokeStyle=w.color;ctx.lineWidth=4;ctx.stroke()}
   if(w.outline){ctx.strokeStyle=w.outline;ctx.lineWidth=8;ctx.stroke()}
   if(i===hover&&!w.disabled){ctx.strokeStyle='#fff';ctx.lineWidth=4;ctx.stroke()}
   // dark text on a light fill (e.g. the bone colour)
   let fg='#fff';if(w.on&&w.color){const c=new THREE.Color(w.color);if(0.2126*c.r+0.7152*c.g+0.0722*c.b>0.6)fg='#111'}
   if(w.disabled)fg='#6b7885';ctx.fillStyle=fg;ctx.font=(w.size||30)+'px system-ui,sans-serif';ctx.textAlign='center';ctx.fillText(w.label,w.x+w.w/2,w.y+w.h/2+1,Math.max(10,w.w-8)); // a long label shrinks horizontally instead of leaving its button
  });
  ctx.textAlign='left';ctx.textBaseline='alphabetic';tex.needsUpdate=true;dirty=false;
 };
 const at=uv=>({x:uv.x*W,y:(1-uv.y)*H});
 return{mesh,
  refresh(){widgets=draw();dirty=true},
  flush(){if(dirty)render()},
  measure(text,size=30,bold=false){ctx.font=(bold?'bold ':'')+size+'px system-ui,sans-serif';return ctx.measureText(String(text)).width}, // text width in canvas px, for wrapping before the layout
  onDraw(f){draw=f},
  hit(uv){const p=at(uv);return widgets.findIndex(w=>(w.action||w.set)&&!w.disabled&&p.x>=w.x-(w.type==='slider'?26:0)&&p.x<=w.x+w.w+(w.type==='slider'?26:0)&&p.y>=w.y&&p.y<=w.y+w.h)},
  widget(i){return widgets[i]},
  setHover(i){if(i!==hover){hover=i;dirty=true}},
  press(i){const w=widgets[i];if(!w?.action)return false;w.action();widgets=draw();dirty=true;return true},
  drag(i,uv){const w=widgets[i];if(!w?.set)return;const v=Math.min(1,Math.max(0,(at(uv).x-w.x)/w.w));w.set(v);widgets=draw();dirty=true},
  dispose(){tex.dispose();mesh.geometry.dispose();mesh.material.dispose()}};
}
// small tag on the left controller while the menu is closed (open it by
// pointing at it); a plain textured plane
function makeBadge(text){
 const canvas=document.createElement('canvas');canvas.width=512;canvas.height=120;const ctx=canvas.getContext('2d');
 ctx.fillStyle='rgba(45,108,223,.95)';ctx.beginPath();ctx.roundRect(0,0,512,120,28);ctx.fill();ctx.fillStyle='#fff';ctx.font='bold 34px system-ui,sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,256,62,490);
 const tex=new THREE.CanvasTexture(canvas);tex.colorSpace=THREE.SRGBColorSpace;
 const mesh=new THREE.Mesh(new THREE.PlaneGeometry(0.10,0.024),new THREE.MeshBasicMaterial({map:tex,transparent:true,toneMapped:false}));
 mesh.position.set(0,0.078,0.02);mesh.rotation.x=-0.6;mesh.userData.dispose=()=>{tex.dispose();mesh.geometry.dispose();mesh.material.dispose()};
 return mesh;
}

// brief cue on the controller that pressed the stick click (slice transparent / back): a small translucent tag above that hand, redrawn for each text
function makeToast(){
 const canvas=document.createElement('canvas');canvas.width=512;canvas.height=120;const ctx=canvas.getContext('2d');
 const tex=new THREE.CanvasTexture(canvas);tex.colorSpace=THREE.SRGBColorSpace;
 const mesh=new THREE.Mesh(new THREE.PlaneGeometry(0.10,0.024),new THREE.MeshBasicMaterial({map:tex,transparent:true,opacity:0.8,toneMapped:false}));
 mesh.position.set(0,0.108,0.02);mesh.rotation.x=-0.6;mesh.visible=false;
 const api={mesh,text:'',until:0,set(text){if(api.text===text)return;api.text=text;ctx.clearRect(0,0,512,120);ctx.fillStyle='rgba(14,20,27,.92)';ctx.beginPath();ctx.roundRect(0,0,512,120,28);ctx.fill();ctx.strokeStyle='#ffd27a';ctx.lineWidth=5;ctx.stroke();ctx.fillStyle='#fff';ctx.font='bold 40px system-ui,sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,256,62,480);tex.needsUpdate=true},dispose(){tex.dispose();mesh.geometry.dispose();mesh.material.dispose()}};
 return api;
}

// screenshots of the left eye: kept until the page offers them
// for saving after the session (a download from inside the headset view is
// not reliable)
const shots=[];
let lastBench=null;
function showBenchPanel(ja){
 if(!lastBench)return;
 document.getElementById('vr-bench-panel')?.remove();
 const panel=document.createElement('div');panel.id='vr-bench-panel';
 Object.assign(panel.style,{position:'fixed',left:'16px',bottom:'16px',zIndex:'9999',background:'#111a',backdropFilter:'blur(6px)',color:'#fff',padding:'12px',borderRadius:'12px',maxWidth:'min(92vw,640px)',font:'14px system-ui,sans-serif'});
 const text=[lastBench.head,...lastBench.lines].join('\n');
 const pre=document.createElement('pre');pre.style.cssText='margin:0 0 8px;white-space:pre-wrap;font:13px ui-monospace,monospace';pre.textContent=text;panel.append(pre);
 const row=document.createElement('div');row.style.cssText='display:flex;gap:8px';
 const copy=document.createElement('button');copy.type='button';copy.textContent=ja?'コピー':'Copy';copy.onclick=()=>{navigator.clipboard?.writeText(text).catch(()=>{})};
 const close=document.createElement('button');close.type='button';close.textContent=ja?'閉じる':'Close';close.onclick=()=>panel.remove();
 row.append(copy,close);panel.append(row);document.body.append(panel);
}
function showShotsPanel(ja){
 if(!shots.length)return;
 document.getElementById('vr-shots-panel')?.remove();
 const panel=document.createElement('div');panel.id='vr-shots-panel';
 Object.assign(panel.style,{position:'fixed',right:'16px',bottom:'16px',zIndex:'9999',background:'#111a',backdropFilter:'blur(6px)',color:'#fff',padding:'12px',borderRadius:'12px',maxWidth:'min(92vw,560px)',maxHeight:'70vh',overflow:'auto',font:'14px system-ui,sans-serif'});
 const head=document.createElement('div');head.style.cssText='display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:8px';
 head.innerHTML='<strong></strong><button type="button"></button>';head.querySelector('strong').textContent=(ja?'VRのスクリーンショット ':'VR screenshots ')+shots.length;
 const close=head.querySelector('button');close.textContent=ja?'閉じる':'Close';close.onclick=()=>panel.remove();panel.append(head);
 const grid=document.createElement('div');grid.style.cssText='display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px';
 for(const s of shots){const a=document.createElement('a');a.href=s.url;a.download=s.name;a.title=s.name;a.style.cssText='color:#9cf;text-decoration:none';
  const img=document.createElement('img');img.src=s.url;img.style.cssText='width:100%;border-radius:8px;display:block;background:#000';
  const cap=document.createElement('div');cap.textContent=(ja?'保存 ':'Save ')+s.name.slice(-10,-4);a.append(img,cap);grid.append(a)}
 panel.append(grid);document.body.append(panel);
}

// ---- preparation before the session ----
// Everything the VR view needs from the CPU side is built here, before the
// session starts, and kept for the same data / filter / segments / edits,
// so entering again (or switching VR <-> AR) skips it. requestSession must
// follow a click, so a fresh preparation ends with a start button.
const editIds=new WeakMap();let editIdNext=1;
const idOf=o=>{if(!o)return 0;let i=editIds.get(o);if(!i){i=editIdNext++;editIds.set(o,i)}return i};
export function vrDataKey(){
 const v=gpuVolumeTarget();if(!v?.series)return '';
 const segs=SEGMENT_PRESET_ORDER.map(k=>{const g=segmentState[k]||{},st=segmentEditState[k]||{};
  return [g.active?1:0,segAvail(g)?1:0,g.min,g.max,g.opening,g.closing,g.holeFill?1:0,g.minComponent,g.surfaceMm,g.thicknessMm,st.revision|0,idOf(st.baseRuns),idOf(st.keepRuns),idOf(st.excludeRuns),segmentSourceSignature(k)].join(',')});
 // the shown analysis results (colour, voxels) are part of the prepared data
 const regions=shownRegions().map(r=>r.id+':'+r.color+':'+r.voxels).join(',');
 return [v.series.id,v.filterSignature||'',gpuSegmentOrder().join('>'),...segs,regions].join('|'); // the slot assignment too (it follows from the enabled flags, kept explicit)
}
// analysis results for VR: the visible regions; colour index per voxel on the given grid (0 none,
// 1..14 = the distinct colours in list order, at most 14; a later region wins where two overlap), mapped with
// the same gpuRunsForTexture as the edit mask; the list (colour, segments, mm³) is shown read-only in the menu
const shownRegions=()=>analysisRegions.filter(r=>r.visible!==false&&(!r.segmentKeys?.length||r.segmentKeys.some(k=>segAvail(segmentState[k])))&&r.runsBySlice&&r.voxels>0); // = analysisRegionShown, with a segment the page keeps hidden counting as available in event mode (segAvail)
// the page collects the shown results (colour, the GPU slots of their segments, runs, volume, label id); vr-volume-prep.js buildRegionIndexOf makes the index (colour index
// per voxel, 1..14 = the distinct colours in list order, at most 14; ids = list position + 1 per voxel, the label of the result the laser points at, up to 255 results) in the worker
function regionItemsOf(){
 const slotKeys=gpuSegmentOrder(); // the GPU slot of each segment (segment-slots.js)
 return shownRegions().map(r=>({color:r.color,segMask:(r.segmentKeys||[]).reduce((m,key)=>{const sl=slotKeys.indexOf(key);return sl>=0?m|(1<<sl):m},0),runsBySlice:r.runsBySlice,mm3:r.mm3,segmentKeys:[...(r.segmentKeys||[])],rid:r.id})); // rid: the region's id, to find its pinned label (region.label)
}
let prepared=null,preparing=null,prepareGen=0,activePrep=null; // activePrep: the worker of the preparation in flight (abortVrPrepare ends it) // prepareGen: bumped by releaseVrPrepared, so a preparation that was running meanwhile is not stored
// volume + brick textures for one grid (full 512 or the 256 copy)
const makeVolumeTextures=d=>{
 const v=new THREE.Data3DTexture(d.data,...d.dims);v.format=THREE.RGFormat;v.type=THREE.UnsignedByteType;
 v.minFilter=v.magFilter=THREE.LinearFilter;v.unpackAlignment=1;v.needsUpdate=true;
 const b=new THREE.Data3DTexture(d.bricks,...d.brickDims);b.format=THREE.RGBAFormat;b.type=THREE.FloatType;
 b.minFilter=b.magFilter=THREE.NearestFilter;b.unpackAlignment=1;b.needsUpdate=true;
 return{v,b,dims:d.dims,brickDims:d.brickDims,src:d.data,cls:null,dist:null,combo:null,cls4:null,comboMask:-1};
};
const makeRegionTexture=P=>{const g=P.region;if(!g?.data)return null;const t=new THREE.Data3DTexture(g.data,...g.dims);t.format=THREE.RedFormat;t.type=THREE.UnsignedByteType;t.minFilter=t.magFilter=THREE.NearestFilter;t.unpackAlignment=1;t.needsUpdate=true;return t};
const makeEditTexture=P=>{if(!P.edit.data)return null;const e=new THREE.Data3DTexture(P.edit.data,...P.edit.dims);e.format=THREE.RGBAFormat;e.type=THREE.UnsignedByteType;e.unpackAlignment=1;return e};
const makeComboTexture=(data,dims)=>{const x=new THREE.Data3DTexture(data,...dims);x.format=THREE.RGBAFormat;x.type=THREE.UnsignedByteType;x.minFilter=x.magFilter=THREE.LinearFilter;x.unpackAlignment=1;x.needsUpdate=true;return x};
// the fourth stored segment's classification bytes (R8, trilinear like the combined texture)
const makeCls4Texture=(data,dims)=>{const x=new THREE.Data3DTexture(data,...dims);x.format=THREE.RedFormat;x.type=THREE.UnsignedByteType;x.minFilter=x.magFilter=THREE.LinearFilter;x.unpackAlignment=1;x.needsUpdate=true;return x};
// the creep-skip bits (vr-skip-occupancy.js) as an RG32UI texture, one texel per block of 4^3 cells, nearest; the dummy keeps an integer texture bound while the skip is off
const makeSkipTexture=(bits,grid)=>{const x=new THREE.Data3DTexture(bits,grid[0],grid[1],grid[2]);x.format=THREE.RGIntegerFormat;x.type=THREE.UnsignedIntType;x.internalFormat='RG32UI';x.minFilter=x.magFilter=THREE.NearestFilter;x.generateMipmaps=false;x.unpackAlignment=1;x.needsUpdate=true;return x};
let skipDummyTex=null;const skipDummy=()=>skipDummyTex||(skipDummyTex=makeSkipTexture(new Uint32Array(2),[1,1,1]));
// shown-segment mask for the combined texture's alpha (segMode 2 = hidden)
const vrSegShown=key=>segAvail(segmentState[key])&&segMode[key]!==2; // a segment that is drawn in VR (the same rule as shownMask / the shader's segA enabled flag)
const shownMask=()=>{let mask=0;const slotKeys=gpuSegmentOrder();for(let i=0;i<4;i++){const key=slotKeys[i],seg=segmentState[key];if(segAvail(seg)&&segMode[key]!==2)mask|=1<<i}return mask};
// shader variants (preprocessor guards in fragmentShader) sharing one uniforms object:
// combined = without the general loop (used when the combined field is in use), noEvents = also without the slice / cut-face loop (no section)
// the same three with VRL_CLS4 (four stored segments: the fourth from its own texture), compiled only when four are stored
// every variant is compiled with VRL_MEDIUMP (fp16 for Quest 3, see the fragment shader; read once at load, ON by default)
// fp16 is the DEFAULT now. ?vrprec=highp (or Settings > デバッグ: 'vrHighp') goes back to 32 bit; ?vrprec=mediump still accepted and wins over the switch
const vrPrecParam=typeof location!=='undefined'?(/[?&]vrprec=(mediump|highp)(&|$)/.exec(location.search)||[])[1]:undefined;
// 設定 > デバッグ 'vrNoSkip' starts the session with the creep skip off (A/B on the device; the 詳細 menu switches it live; no URL form: the public gate rejects unknown URL keys)
const VR_MEDIUMP=vrPrecParam==='mediump'||(vrPrecParam!=='highp'&&!effectiveFlag('vrHighp',false));
const volumeDefines=region=>({...(VR_MEDIUMP?{VRL_MEDIUMP:''}:{}),...(region?{VRL_REGIONS:''}:{})});
const VARIANT_DEFS={full:{},combined:{VRL_NO_GENERAL:'',VRL_OPAQUE:''},noEvents:{VRL_NO_GENERAL:'',VRL_NO_EVENTS:'',VRL_OPAQUE:''}};
const materialVariants=base=>{const mk=defs=>{const m=base.clone();m.uniforms=base.uniforms;m.defines={...base.defines,...defs};return m};const v={full:base};for(const [k,d] of Object.entries(VARIANT_DEFS)){if(k!=='full')v[k]=mk(d);v[k+'4']=mk({...d,VRL_CLS4:''})}return v};
const VARIANT_KEYS=['full','combined','noEvents'],VARIANT_KEYS4=VARIANT_KEYS.map(k=>k+'4');
const rayMaterialOf=m=>{const r=m.clone();r.uniforms=m.uniforms;r.defines={...m.defines};r.blending=THREE.NoBlending;r.transparent=false;return r};
const rayVariantsOf=vars=>Object.fromEntries(Object.entries(vars).map(([k,m])=>[k,rayMaterialOf(m)]));
const volumeUniforms=(vd,full,settings)=>({vol:{value:full.v},bricks:{value:full.b},halfExt:{value:new THREE.Vector3(...vd.halfExt)},boxC:{value:new THREE.Vector3()},boxH:{value:new THREE.Vector3()},boxEntry:{value:0},texDims:{value:new THREE.Vector3(...vd.dims)},brickDims:{value:new THREE.Vector3(...vd.brickDims)},
 stepSize:{value:vd.step},diag:{value:0},calib:{value:new THREE.Vector3(...vd.calibration)},segA:{value:[0,1,2,3].map(()=>new THREE.Vector4())},segC:{value:[0,1,2,3].map(()=>new THREE.Vector4())},ctShade:{value:1},ctShadeBright:{value:1.8},ctShadeContrast:{value:1.7},sliceSegOnly:{value:0},segM:{value:[0,1,2,3].map(()=>new THREE.Vector4(...materialVec('standard')))},
 cutPlanes:{value:Array.from({length:MAX_SECTION_PLANES},()=>new THREE.Vector4(0,0,1,0))},planeCount:{value:0},planeCut:{value:0},capOn:{value:1},sliceTint:{value:0.45},sliceOpacity:{value:0},sliceWindow:{value:new THREE.Vector2(0,1)},sliceAir:{value:-600},regionTex:{value:null},regionSeg:{value:new Array(14).fill(0)},regionC:{value:Array.from({length:14},()=>new THREE.Vector3())},sliceVol:{value:full.v},refine:{value:settings.refine|0},useCls:{value:0},clsTex:{value:null},cls4Tex:{value:null},useSkip:{value:0},skipTex:{value:skipDummy()},clsChan:{value:new THREE.Vector4(-1,-1,-1,-1)},editMask:{value:0},editMaskOnly:{value:0},editTex:{value:null},useDist:{value:0},distInCls:{value:0},distTex:{value:null},voxelMin:{value:1},voxelSize:{value:new THREE.Vector3(1,1,1)}});
// ---- GPU preparation before the session ----
// The renderer (an XR-compatible context), the textures of the grid in use, the
// combined classification + field texture for the shown segments, the edit mask
// and every shader variant are created, uploaded and compiled on the flat page,
// then the GPU is waited for; the session reuses the renderer, so nothing is
// compiled or uploaded on the first frames in the headset.
const segMode={};
// 体験会モード: a segment the practice data's project file keeps in the list but not shown (active, not enabled: e.g. 脂肪 / 肺 at the start) is still PREPARED for VR (classification, processing
// masks, analysis results) and listed in the かんたん menu, so that showing it in VR works at once and needs no new preparation. Outside event mode only shown segments count, as before.
// The session starts with what the page shows (initialVrModes: not enabled -> 非表示); segMode (VR-local) switches it from there.
const segAvail=g=>!!g?.active&&(!!g.enabled||eventModeOn());
const vrSegments=()=>eventModeOn()?Object.fromEntries(SEGMENT_PRESET_ORDER.map(k=>[k,{...segmentState[k],enabled:!!segmentState[k]?.active}])):segmentState;
const initialVrModes=()=>{if(!eventModeOn())return;for(const k of Object.keys(segMode))delete segMode[k];for(const k of SEGMENT_PRESET_ORDER){const g=segmentState[k];if(g?.active&&!g.enabled)segMode[k]=2}};
// the processing masks of the hidden segments (thin-region suppression, ...) are computed by the page on demand: have them before the VR data is keyed and built
async function ensureHiddenSegmentRuns(){
 if(!eventModeOn())return;
 for(const k of SEGMENT_PRESET_ORDER){const g=segmentState[k];if(g?.active&&!g.enabled&&segmentHasProcessedMask(k)){try{await ensureSegmentBaseRuns(k,undefined,null,true)}catch(e){console.warn('Processing mask of a hidden segment for VR failed:',e)}}}
}
// the volume shader's base material for a set of defines (shared by prepareVrGpu and the session: the session's materials share the compiled programs by their cache key)
const makeVolumeBase=(defs,uni)=>{const material=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader,fragmentShader,side:THREE.BackSide,toneMapped:false,uniforms:uni,defines:defs});
 material.transparent=false;material.depthWrite=true;material.blending=THREE.CustomBlending;material.blendSrc=THREE.OneFactor;material.blendDst=THREE.OneMinusSrcAlphaFactor;return material};
// can the browser link shader programs off the main thread (KHR_parallel_shader_compile)? three.js' compileAsync then waits without blocking; without it every link blocks the caller
const parallelCompile=r=>{try{return !!r.extensions.has('KHR_parallel_shader_compile')}catch{return false}};
// every program set a data switch inside the session could ask for (with / without analysis results, the four-segment variants) is compiled on the page, before the session, when compiling would
// block the main thread (no parallel compile); with a parallel compile the session compiles a new set itself, when a switch needs it. settings.precompileSets === false: never (tests)
const shouldPrecompileSets=(r,settings)=>settings?.precompileSets!==false&&!parallelCompile(r);
// compiles the direct materials, the
// offscreen (ray) copies and any extra material, asynchronously (the link runs off the main thread where the browser can); returns the materials (keep them alive: they own the programs)
async function compileVariantPrograms(renderer,direct,rays,extra=[],alive=()=>true){
 const keys=direct,mats=[...direct,...rays,...extra];
 const sc=new THREE.Scene(),geo=new THREE.BoxGeometry(2,2,2),cam=new THREE.PerspectiveCamera();
 for(const m of mats){const mesh=new THREE.Mesh(geo,m);mesh.frustumCulled=false;sc.add(mesh)}
 await renderer.compileAsync(sc,cam);
 if(!alive()){geo.dispose();return mats} // the session ended meanwhile (its renderer is being / was disposed): nothing more to compile
 // the offscreen passes (lowTarget / periTarget, the 詳細 probe, the screenshot) draw into a render target, whose output colour space is
 // part of three.js' program key: the ray variants are compiled for it too, so the first f < 1 frame (or the first use of a variant there) compiles nothing
 {const rt=new THREE.WebGLRenderTarget(4,4),sr=new THREE.Scene(),prevT=renderer.getRenderTarget();for(const m of mats.slice(keys.length,2*keys.length)){const x=new THREE.Mesh(geo,m);x.frustumCulled=false;sr.add(x)}
  renderer.setRenderTarget(rt);try{await renderer.compileAsync(sr,cam)}finally{renderer.setRenderTarget(prevT);rt.dispose()}}
 geo.dispose();
 return mats;
}
let gpuPrepared=null;
export async function prepareVrGpu(P,mode='vr',settings=loadSettings()){
 disposeGpuPrepared();const gen=prepareGen;
 const ar=mode==='ar',renderer=new THREE.WebGLRenderer({antialias:false,alpha:ar,preserveDrawingBuffer:false});
 renderer.setPixelRatio(1);renderer.setSize(8,8,false);
 Object.assign(renderer.domElement.style,{position:'fixed',left:'0',top:'0',width:'1px',height:'1px',opacity:'0',pointerEvents:'none'});
 document.body.appendChild(renderer.domElement);
 const gl=renderer.getContext(),t0=performance.now(),times={};
 const assets={key:P.key,mode,renderer,full:null,half:null,edit:null,region:null,warm:[],times};
 try{
  try{await gl.makeXRCompatible?.()}catch(e){console.warn('makeXRCompatible before the session failed (setSession will retry):',e)}
  const vd=P.vd,full=makeVolumeTextures(vd);assets.full=full;
  const half=P.half?makeVolumeTextures(P.half):null;assets.half=half;
  const useHalf=(settings.data|0)===1&&!!half,t=useHalf?half:full;
  // four stored segments use the combined texture as well (VRL_CLS4), with the fourth one's bytes in an R8 texture (16 MB at 256³)
  const four=!!P.cls?.chan.includes(3);
  // the session clamps the shader's shown set to the prepared texture's mask until a rebuild is uploaded, so the texture is built for the modes the session
  // starts with: in event mode initialVrModes (run again at the start, idempotent; a no-op outside event mode) re-derives them from the page here first
  initialVrModes();
  if(Math.max(...t.dims)<=256&&P.cls&&P.dist){const mask=shownMask();const pc=P.combo&&P.combo.mask===mask&&P.combo.dims.join()===t.dims.join()?P.combo:null; // prepareVrData already built these bytes in the worker (for the same mask and grid)
   const data=pc?pc.data:combineClassificationDistance(P.cls,P.dist,mask,null,{four});if(data){t.combo=makeComboTexture(data,t.dims);t.comboMask=mask;if(four)t.cls4=makeCls4Texture(pc&&P.cls4?P.cls4:fourthChannelBytes(P.cls),t.dims)}}
  if(P.combo&&!(t.combo&&P.combo.mask===t.comboMask&&P.combo.dims.join()===t.dims.join()))P.combo=null;if(P.cls4&&!(t.cls4&&P.combo))P.cls4=null; // the worker's combined bytes that this preparation did not use are not kept (they are tens of MB)
  assets.edit=makeEditTexture(P);assets.region=makeRegionTexture(P);
  for(const x of [full.v,full.b,half?.v,half?.b,t.combo,t.cls4,assets.edit,assets.region].filter(Boolean))renderer.initTexture(x);
  times.upload=performance.now()-t0;const t1=performance.now();
  // compile every program the session can use: the three volume variants, their offscreen (no blending) copies and the composite
  const u=volumeUniforms(vd,full,settings),dummy=new THREE.Data3DTexture(new Uint8Array(4),1,1,1);dummy.format=THREE.RGBAFormat;dummy.needsUpdate=true;
  u.clsTex.value=dummy;u.cls4Tex.value=dummy;u.editTex.value=dummy;u.distTex.value=dummy;u.regionTex.value=dummy;
  const base=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader,fragmentShader,side:THREE.BackSide,toneMapped:false,uniforms:u,defines:volumeDefines(P.region?.data)});
  base.transparent=false;base.depthWrite=true;base.blending=THREE.CustomBlending;base.blendSrc=THREE.OneFactor;base.blendDst=THREE.OneMinusSrcAlphaFactor;
  const vars=materialVariants(base),keys=four?[...VARIANT_KEYS,...VARIANT_KEYS4]:VARIANT_KEYS;
  const mats=await compileVariantPrograms(renderer,keys.map(k=>vars[k]),keys.map(k=>rayMaterialOf(vars[k])),
   [new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:compositeVertex,fragmentShader:compositeFragment,side:THREE.BackSide,toneMapped:false,depthWrite:true,transparent:false,blending:THREE.CustomBlending,blendSrc:THREE.OneFactor,blendDst:THREE.OneMinusSrcAlphaFactor,uniforms:compositeUniforms(vd.halfExt)})]);
  dummy.dispose();assets.warm=mats; // kept alive so the programs stay cached until the session has its own materials
  // the other program sets (and the four-segment variants) for a data switch inside the session, where compiling would block the main thread (shouldPrecompileSets); their materials stay alive with the others
  assets.warmMore=[];assets.compiledAll=false;
  if(shouldPrecompileSets(renderer,settings)){
   const own=!!P.region?.data;
   for(const regions of [own,!own]){
    const set=regions===own?vars:materialVariants(makeVolumeBase(volumeDefines(regions),u)),ks=regions===own?(four?[]:VARIANT_KEYS4):[...VARIANT_KEYS,...VARIANT_KEYS4];
    if(ks.length)assets.warmMore.push(...await compileVariantPrograms(renderer,ks.map(k=>set[k]),ks.map(k=>rayMaterialOf(set[k]))));
   }
   assets.compiledAll=true;
  }
  times.compile=performance.now()-t1;const t2=performance.now();
  // wait for the uploads and compilation to finish on the GPU while still on the page
  const fence=gl.fenceSync?.(gl.SYNC_GPU_COMMANDS_COMPLETE,0);if(fence){gl.flush();const until=performance.now()+30000;
   while(performance.now()<until){const r=gl.clientWaitSync(fence,0,0);if(r===gl.ALREADY_SIGNALED||r===gl.CONDITION_SATISFIED||r===gl.WAIT_FAILED)break;await new Promise(res=>setTimeout(res,5))}gl.deleteSync(fence)}
  times.wait=performance.now()-t2;times.total=performance.now()-t0;
  gpuPrepared=assets;
  if(gen!==prepareGen){disposeGpuPrepared();return null} // the data was released (another dataset opened) while this ran: nothing to keep
  return assets;
 }catch(e){console.warn('GPU preparation before VR failed; the session will prepare on its own.',e);try{renderer.dispose();renderer.domElement.remove()}catch{}return null}
}
export function disposeGpuPrepared(){
 const g=gpuPrepared;if(!g)return;gpuPrepared=null;
 for(const t of [g.full,g.half])if(t){t.v.dispose();t.b.dispose();t.combo?.dispose();t.cls4?.dispose()}
 g.edit?.dispose();g.region?.dispose();g.warm.forEach(m=>m.dispose());(g.warmMore||[]).forEach(m=>m.dispose());g.renderer.dispose();
 // dispose() alone leaves the WebGL context (and what it still holds) to the garbage collector: end it now
 try{g.renderer.forceContextLoss?.()}catch{}
 g.renderer.domElement.remove();
}
// another dataset was opened (or the data was cleared): the prepared VR data of the old one (the 256³ / 512³ rg8 arrays, bricks,
// classification bytes, region index, and the page-side renderer with its textures) and the hidden-judgement volume are dropped now, not at the
// next preparation (they were 100s of MB of CPU memory and a whole WebGL context's textures, for a headset session that may never come).
// A running session keeps its own copies (it ends with the page's data); the next VR start prepares again for the new data.
export function releaseVrPrepared(){
 if(running)return false;
 prepareGen++;prepared=null;preparing=null;disposeGpuPrepared();hiddenMgr.release();return true;
}
// the data of a RUNNING session is replaced (swapData): the page-side copies go now, whatever `running` says (the session's own textures are disposed by the swap itself,
// before the page opens the new data, so that two datasets are never held at once)
// the preparation in flight is cancelled (its worker ends, its result is not stored): the session ended during a switch, or a new session / switch is about to prepare its own data
function abortVrPrepare(){prepareGen++;preparing=null;try{activePrep?.dispose()}catch{}activePrep=null}
function releaseVrForSwap(){abortVrPrepare();prepareGen++;prepared=null;preparing=null;disposeGpuPrepared();hiddenMgr.release()}
// what is held right now (tests / ?debug): the prepared CPU data, the building one, the page-side GPU assets
export function vrPreparedState(){return{prepared:!!prepared,preparing:!!preparing,gpu:!!gpuPrepared,session:!!running}}
if(typeof document!=='undefined')onDatasetChange(()=>releaseVrPrepared());
export function vrReady(){return !!prepared&&prepared.key===vrDataKey()}
// remembered (it asked a whole new WebGL context for one number: seconds of main thread on SwiftShader, and a context start inside a running session); the session's own context answers once it exists
let maxTex3dKnown=0;
const maxTexture3D=()=>{if(maxTex3dKnown)return maxTex3dKnown;try{const c=document.createElement('canvas'),g=c.getContext('webgl2');const m=g?.getParameter(g.MAX_3D_TEXTURE_SIZE)||2048;g?.getExtension('WEBGL_lose_context')?.loseContext();return maxTex3dKnown=m}catch{return 2048}};
// phases reported as {phase, done, total}; timings (ms) returned with the data
// the heavy pure steps (bricks of both grids, the 256 copy, classification bytes, distance field, the combined texture for the shown segments, the
// mask-only occupancy) run in a worker (vr-volume-prep.js; the arrays go in and come back by transfer); the page-side steps that need page state (reading the slices,
// the processing mask, the analysis index) stay here. sliceMs > 0 (a switch inside a running session): the slice reading gives the main thread back every ~sliceMs.
const ownBuffer=a=>a.byteOffset===0&&a.byteLength===a.buffer.byteLength?a.buffer:a.slice().buffer;
// ---- the finished VR data on the device (vr-prep-cache.js). VR_PREP_VERSION: bump it when a step of prepareVrData / the worker changes what it produces.
// vr-volume: the 512 body (vd.data, as the VR draws it), the 256 copy and the bricks of both grids; vr-derived: the processing mask, classification, distance field, combined texture, fourth channel,
// analysis index, occupancy; vr-alias: "this practice level (its project file hashed) was last made into these two entries": it lets a switch start READING the entries while the page still loads the
// level (the real keys need the page's state; the prefetched entries are used only when the page's own keys come out the same). Every key is made of hashed parts (partsOf), so a miss can say what changed.
const VR_PREP_VERSION=2;
let vrCacheNotify=null; // the session sets it: the 詳細 tab redraws when a store makes progress
const vrCacheState={last:null,cap:null}; // last: what the latest preparation did with the cache (cinfo); cap: the storage numbers (refreshVrCapacity)
async function vrCacheContext(maxDim){
 try{
  const m=volumeMeta(maxDim),{v,s,plan}=m;
  const cache=await volumeCache();if(!cache)return{off:'IndexedDB'};
  if(!globalThis.crypto?.subtle)return{off:'crypto'};
  const dataset=datasetFingerprint(s),filter=v.filterSignature||'',planSig='vr-'+plan.dims.join('x')+(plan.reduced?'r':'');
  const parts={dataset,filter,plan:planSig,brick:PREP_BRICK,side:VR_TARGET_SIDE,prep:VR_PREP_VERSION,build:APP_BUILD},hashes=await partsOf(parts),keyV=await keyOfParts('vr-volume',hashes);
  return{cache,dataset,filter,planSig,keyV,hashes,description:s.description||''};
 }catch(e){console.warn('VR data cache unavailable',e);return{off:String((e&&e.message)||e).slice(0,60)}}
}
// the key of a practice level that needs no 2D load: its project file's bytes (asked from the page through an event: one fetch site) + the grid + the versions
async function vrPracticeKey(id){
 try{
  const detail={id,done:null};document.dispatchEvent(new CustomEvent('vrl-sample-key',{detail}));if(!detail.done)return null;
  const bytes=await detail.done;if(!bytes)return null;
  return await keyOfParts('vr-alias',await partsOf({id,project:bytes,plan:maxTexture3D(),side:VR_TARGET_SIDE,prep:VR_PREP_VERSION,build:APP_BUILD}));
 }catch{return null}
}
const vrAliasLoad=async(cache,pk)=>{const e=await loadEntry(cache,pk);return e&&e.meta&&e.meta.keyV&&e.meta.keyD?e.meta:null};
// fresh = written by a data switch (the page state is the level's own fresh opening): the alias is then STANDARD (protected from eviction in 体験会モード, see protectedKeys); an alias of the session's own start
// (the page may have been changed by the visitor) never replaces a standard one
async function vrAliasStore(cache,pk,id,keyV,keyD,fresh=false){
 const cur=await vrAliasLoad(cache,pk),was=!!(await cache.lookup(pk))?.info?.standard;
 if(was&&!fresh)return true;
 if(cur&&cur.keyV===keyV&&cur.keyD===keyD&&(was||!fresh))return true;
 const info={kind:'vr-alias',dataset:{id},filter:'',plan:'alias',standard:!!fresh,keyV,keyD,build:APP_BUILD,prep:VR_PREP_VERSION},ok=await storeEntry(cache,pk,info,packEntry({keyV,keyD},[]),{pause:async()=>{}});
 if(ok)await pruneSiblings(cache,info,pk);return ok;
}
// a switch to a practice level starts reading its finished VR data at once, beside the page's own load of the level (the old data is already released then); prepareVrData uses it when the keys agree
let activeSwapPf=null; // the read-ahead of a switch in flight: the session end cancels it (no ~300 MB read while the page reloads)
function startVrPrefetch(id){
 const pf={id,cancelled:false,ready:null,practiceKey:null,keyV:null,keyD:null,V:null,D:null,readMs:0,bytes:0};
 pf.ready=(async()=>{
  const t0=performance.now();
  try{
   const cache=await volumeCache();if(!cache||!globalThis.crypto?.subtle)return pf;
   const pk=await vrPracticeKey(id);if(!pk||pf.cancelled)return pf;pf.practiceKey=pk;
   const a=await vrAliasLoad(cache,pk);if(!a||pf.cancelled)return pf;pf.keyV=a.keyV;pf.keyD=a.keyD;
   const isCancelled=()=>pf.cancelled,[D,V]=await Promise.all([loadEntry(cache,a.keyD,{isCancelled}),loadEntry(cache,a.keyV,{isCancelled})]);
   if(pf.cancelled)return pf;pf.D=D;pf.V=V;
  }catch(e){console.warn('VR data prefetch failed',e)}
  finally{pf.readMs=performance.now()-t0}
  return pf;
 })();
 return pf;
}
const prod=d=>d.reduce((a,b)=>a*b,1);
const vrVolumeEntryOk=(V,dims)=>{try{const m=V.meta,a=V.arrays;if(m.dims.join()!==dims.join()||!a.bricks||a.bricks.length!==prod(m.brickDims)*4)return false;
 const wantHalf=Math.max(...dims)>256;if(wantHalf!==!!m.half)return false;
 if(a.data?a.data.length!==prod(dims)*2:!wantHalf)return false; // the 512 body is optional where a 256 copy exists (an entry without it: the page's 3D volume supplies it); a data without a copy needs its one grid
 if(m.half&&(!a.halfData||a.halfData.length!==prod(m.half.dims)*2||!a.halfBricks||a.halfBricks.length!==prod(m.half.brickDims)*4))return false;return true}catch{return false}};
const vrDerivedEntryOk=(D,small)=>{try{const m=D.meta,a=D.arrays,n=prod(small.dims);if(m.dims.join()!==small.dims.join())return false;
 if(m.cls&&(!a.clsData||a.clsData.length!==n*m.cls.C))return false;if(m.dist&&(!m.cls||!a.distData||a.distData.length!==n*m.dist.C))return false;
 if(m.edit.hasData&&(!a.editData||a.editData.length!==n*4))return false;if(m.combo&&(!a.combo||a.combo.length!==n*4))return false;return true}catch{return false}};
const vrDerivedFromEntry=(D,small)=>{const m=D.meta,a=D.arrays;
 return{edit:{dims:small.dims,data:a.editData||null,active:m.edit.active|0,maskOnly:m.edit.maskOnly|0},cls:m.cls?{data:a.clsData,C:m.cls.C,chan:m.cls.chan}:null,dist:m.dist?{data:a.distData,C:m.dist.C,chan:m.dist.chan}:null,
  region:{dims:small.dims,data:a.regionData||null,ids:a.regionIds||null,colors:m.region.colors,segs:m.region.segs,list:m.region.list},combo:m.combo?{data:a.combo,mask:m.combo.mask,dims:m.combo.dims}:null,cls4:a.cls4||null,occFull:a.occFull||null,occHalf:a.occHalf||null}};
// what the 詳細 tab / the prepare panel say about the cache (plain words; the numbers come from vrCacheState and storeStatus)
const VR_PART_NAMES={ja:{dataset:'データ',filter:'フィルター',plan:'グリッド',brick:'ブリック',side:'解像度',prep:'処理版',build:'ビルド',v:'体積',dims:'サイズ',order:'セグメント順',state:'セグメント範囲',mask:'表示セグメント',calib:'校正',edit:'加工マスク',region:'解析領域',bricks:'ブリック'},
 en:{dataset:'data',filter:'filter',plan:'grid',brick:'bricks',side:'resolution',prep:'prep version',build:'build',v:'volume',dims:'size',order:'segment order',state:'segment ranges',mask:'shown segments',calib:'calibration',edit:'processing mask',region:'analysis results',bricks:'bricks'}};
function vrWhyText(w,ja){
 if(!w)return '';
 const names=VR_PART_NAMES[ja?'ja':'en'];
 switch(w.code){
  case'first':return ja?'未保存（初めて）':'not saved yet';
  case'changed':return (ja?'キー不一致: ':'key changed: ')+(w.changed||[]).map(k=>names[k]||k).join(ja?'・':', ');
  case'interrupted':return ja?'保存が中断された（保存前に切替／終了）':'store interrupted (switched / ended before it finished)';
  case'failed':return (ja?'保存失敗: ':'store failed: ')+(w.detail||'');
  case'capacity':return ja?'容量不足で保存しなかった':'not saved: over the storage budget';
  case'evicted':return ja?'保存済みだが消えていた（容量・LRU）':'was saved but is gone (storage / LRU)';
  case'saving':return (ja?'保存中（未完了）':'still being saved')+(w.total?' '+Math.round((w.written||0)*100/w.total)+' %':'');
  case'damaged':return ja?'読めなかった（壊れている）':'could not be read';
  case'off':return (ja?'キャッシュ無効: ':'cache off: ')+(w.detail||'');
  default:return String(w.code);
 }
}
function vrStoreWord(key,ja){
 const st=key?storeStatus.map.get(key):null;if(!st)return '';
 switch(st.state){case'saving':return (ja?'保存中 ':'saving ')+Math.round((st.written||0)*100/Math.max(1,st.total||1))+' %';case'done':return ja?'保存完了':'saved';case'cancelled':return ja?'保存中断':'store interrupted';case'failed':return (ja?'保存失敗 ':'store failed ')+(st.error||'');case'skipped':return ja?'保存せず（容量）':'not saved (storage)';default:return ''}
}
function vrCacheText(ja){
 const c=vrCacheState.last;if(!c)return '';
 const mb=n=>Math.round(n/1048576),parts=[];
 if(c.volume==='hit'&&c.derived==='hit')parts.push((ja?'VR用データ: 再利用（体積・派生とも保存済みを読込）':'VR data: reused (volume and derived read from the device)')+(c.from==='prefetch'?(ja?' · 読込は2D読込と並行':' · read beside the 2D load'):'')+' · '+(ja?'読出 ':'read ')+(c.readMs/1000).toFixed(1)+' s');
 else{
  const w=[];if(c.volume!=='hit')w.push((ja?'体積: ':'volume: ')+(c.volume==='off'?vrWhyText(c.volumeWhy,ja):vrWhyText(c.volumeWhy,ja)));else w.push(ja?'体積: 再利用':'volume: reused');
  if(c.derived!=='hit')w.push((ja?'派生: ':'derived: ')+vrWhyText(c.derivedWhy,ja));else w.push(ja?'派生: 再利用':'derived: reused');
  parts.push((ja?'VR用データ: 新規作成（':'VR data: built (')+w.join(' / ')+')');
 }
 const sw=[c.keyD&&c.derived!=='hit'?vrStoreWord(c.keyD,ja):'',c.keyV&&c.volume!=='hit'?vrStoreWord(c.keyV,ja):''].filter(Boolean);
 if(sw.length)parts.push((ja?'保存 ':'store ')+sw.join(' / '));
 const cap=vrCacheState.cap;
 if(cap)parts.push((ja?'キャッシュ ':'cache ')+mb(cap.usedByCache)+' / '+mb(cap.budget)+' MB'+(cap.quota?(ja?'（ブラウザ上限 ':' (browser quota ')+mb(cap.quota)+' MB'+(cap.persisted===true?(ja?'・永続化済み':' · persistent'):cap.persisted===false?(ja?'・永続化なし':' · not persistent'):'')+')':'')+(cap.event&&!cap.enough?(ja?' ⚠ 4レベル分(約'+mb(cap.need)+' MB)に足りない':' ⚠ short of 4 levels (~'+mb(cap.need)+' MB)'):''));
 return parts.join('\n');
}
async function refreshVrCapacity(cache){
 try{const info=await volumeCacheBudgetInfo(),c=cache||await volumeCache(),usedByCache=c?await c.usage():0;vrCacheState.cap={...info,usedByCache};vrCacheNotify?.()}catch{/* none */}
}
// the stores run one after the other in the background (D first: it is what costs the most to make; then V), the IndexedDB writes on the page, in 1 MiB slices with a short pause after a few ms of work: they stop when the data
// is released (prepareGen moved): the arrays are not held for a next data and a half-written entry is removed. The status of every store is kept (storeStatus) for the 詳細 tab.
const vrStoreChain={p:Promise.resolve()};let vrStoreSlowMs=0; // vrStoreSlowMs: a test pauses between slices to make a store long
function scheduleVrCacheStore(vc,P,keyD,hashD,cinfo,gen,aliasId,fresh){
 const cancelled=()=>prepareGen!==gen,stats=(globalThis.__vrPrepCache||={writes:[]});
 const tasks=[];
 const keepBody=!P.half; // the body of the entry: the one grid of a data without a 256 copy; beside a 256 copy no 512 body is stored (the cross-sections' 512 grid comes from the page's own cached 3D volume)
 if(cinfo.derived==='miss'&&keyD)tasks.push({kind:'vr-derived',key:keyD,parts:hashD,meta:{dims:(P.half||P.vd).dims,edit:{hasData:!!P.edit.data,active:P.edit.active|0,maskOnly:P.edit.maskOnly|0},cls:P.cls?{C:P.cls.C,chan:P.cls.chan}:null,dist:P.dist?{C:P.dist.C,chan:P.dist.chan}:null,
  region:{colors:P.region.colors,segs:P.region.segs,list:P.region.list},combo:P.combo?{mask:P.combo.mask,dims:P.combo.dims}:null},arrays:[['editData',P.edit.data],['clsData',P.cls?.data],['distData',P.dist?.data],['regionData',P.region.data],['regionIds',P.region.ids],['combo',P.combo?.data],['cls4',P.cls4],['occFull',P.occFull],['occHalf',P.occHalf]]});
 if(cinfo.volume==='miss'){const vd=P.vd,h=P.half;tasks.push({kind:'vr-volume',key:vc.keyV,parts:vc.hashes,meta:{dims:vd.dims,brickDims:vd.brickDims,half:h?{dims:h.dims,brickDims:h.brickDims}:null},arrays:[['data',keepBody?vd.data:null],['bricks',vd.bricks],['halfData',h?.data],['halfBricks',h?.bricks]]})}
 for(const t of tasks)noteStore(t.key,{kind:t.kind,state:'saving',written:0,total:1,bytes:0});
 const run=async()=>{
  void removeOldBuilds(vc.cache,{build:APP_BUILD,prep:VR_PREP_VERSION}); // what an earlier build / preparation version stored can never be read again
  for(const t of tasks){
    if(cancelled()){noteStore(t.key,{state:'cancelled'});continue}
    const t0=performance.now();let ok=false,bytes=0;
    try{
     const packed=packEntry(t.meta,t.arrays);bytes=packed.bytes;
     const budget=await volumeCacheBudget(),info={kind:t.kind,dataset:vc.dataset,filter:vc.filter,plan:vc.planSig,description:vc.description,parts:t.parts,build:APP_BUILD,prep:VR_PREP_VERSION};
     noteStore(t.key,{state:'saving',written:0,total:packed.slices,bytes});
     if(bytes>budget){noteStore(t.key,{state:'skipped',why:'over budget'});stats.writes.push({kind:t.kind,bytes,skipped:'over budget'});continue}
     let lastN=0;const onProgress=(w,total)=>{noteStore(t.key,{written:w,total});const now=performance.now();if(now-lastN>700){lastN=now;vrCacheNotify?.()}};
     ok=await storeEntry(vc.cache,t.key,info,packed,{isCancelled:cancelled,onProgress,pause:ms=>new Promise(r=>setTimeout(r,ms+vrStoreSlowMs))});
     if(ok){await pruneOtherFilterSettings(vc.cache,{kind:t.kind,dataset:vc.dataset,plan:t.kind==='vr-volume'?vc.planSig:null,filter:vc.filter},t.key);await pruneSiblings(vc.cache,info,t.key);await vc.cache.prune(budget,{keep:t.key});noteStore(t.key,{state:'done'})}
     else noteStore(t.key,{state:cancelled()?'cancelled':'failed',error:cancelled()?undefined:'incomplete'});
    }catch(e){noteStore(t.key,{state:'failed',error:String((e&&e.message)||e).slice(0,60)});console.warn('VR data cache: store failed',e)}
    stats.writes.push({kind:t.kind,bytes,ok,ms:Math.round(performance.now()-t0)});vrCacheNotify?.();
   }
  // both entries of this data are on the device (read or just stored): the alias of the practice level points at them, so the next switch can read them before the page has loaded anything
  const have=k=>k&&(storeStatus.map.get(k)?.state==='done'||(k===keyD?cinfo.derived==='hit':cinfo.volume==='hit'));
  if(aliasId&&!cancelled()&&have(vc.keyV)&&have(keyD))await scheduleAlias(vc,aliasId,keyD,fresh);
  void refreshVrCapacity(vc.cache);
 };
 vrStoreChain.p=vrStoreChain.p.then(()=>run()).catch(()=>{});
}
// a data switch releases the data the saves are made from, and a save that is cut is never resumed (the level would then be built again the next time it is opened): so the switch first waits for the
// saves that are queued or running (the loading board says so). They keep their pacing (a few ms of work, then a pause: no frame is held up; the switch just waits a little longer). A device whose writes stall is not
// held for ever: after maxMs the saves are cut as before.
async function flushVrStores(onWait=()=>{},maxMs=VR_STORE_FLUSH_MS){
 const pending=[...storeStatus.map.values()].some(s=>s.state==='saving');if(!pending)return false;
 try{onWait();await withTimeout(vrStoreChain.p,maxMs,'save')}catch(e){console.warn('VR data cache: the saves did not finish before the switch',e)}
 return true;
}
async function scheduleAlias(vc,id,keyD,fresh=false){try{const pk=await vrPracticeKey(id);if(pk&&await vrAliasStore(vc.cache,pk,id,vc.keyV,keyD,fresh)&&fresh){ // a new standard alias: the entries the older one protected are no longer protected and go
   await pruneSiblings(vc.cache,{kind:'vr-volume',dataset:vc.dataset,filter:vc.filter},vc.keyV);await pruneSiblings(vc.cache,{kind:'vr-derived',dataset:vc.dataset,filter:vc.filter},keyD)}}catch(e){console.warn('VR data cache: alias failed',e)}}
export async function prepareVrData(onProgress=()=>{},{sliceMs=0,prefetch=null,fresh:freshOpen=false}={}){
 await ensureHiddenSegmentRuns();
 const key=vrDataKey();if(!key)throw new Error('VR: open a DICOM series first');
 // fresh = the page state is the level's own fresh opening (a data switch says so; any other route is recognised by the state signature the page recorded when the level finished opening)
 let fresh=freshOpen;if(!fresh){try{fresh=isStandardOpen({id:globalThis.__vrlOpenSample,sig:vrStateSignature()})}catch{fresh=false}}
 if(prepared?.key===key)return prepared;
 if(preparing?.key===key)return preparing.promise;
 const promise=(async()=>{
  prepared=null;const times={},tick=sliceMs>0?yieldMain:async()=>new Promise(r=>setTimeout(r,0));
  const prep=createVolumePrep();activePrep=prep;const alive=()=>{if(prep.disposed)throw new Error('VR preparation cancelled')}; // abortVrPrepare disposed it
  try{
   const aliasId=globalThis.__vrlOpenSample||null,tk0=performance.now(),ctx=await vrCacheContext(maxTexture3D()),vc=ctx.off?null:ctx;times.cacheKey=performance.now()-tk0;alive();
   const cinfo={volume:vc?'miss':'off',derived:vc?'miss':'off',volumeWhy:vc?null:{code:'off',detail:ctx.off},derivedWhy:vc?null:{code:'off',detail:ctx.off},readMs:0,from:'read',keyV:vc?vc.keyV:null,keyD:null},cgen=prepareGen;let keyD=null,hashD=null;
   vrCacheState.last=cinfo;
   const pf=prefetch&&vc?await withTimeout(prefetch.ready,CACHE_READ_TIMEOUT_MS,'read ahead').catch(()=>{prefetch.cancelled=true;return null}):null; // the entries a switch started to read beside the page's load (null: no alias / nothing there)
   const entryOf=async(kind,key,hit,hashes)=>{ // the prefetched entry when its key is the one the page's state gives, else read it now
    if(hit&&hit.key===key&&hit.entry)return hit.entry;
    const t=performance.now(),e=await loadEntry(vc.cache,key,{isCancelled:()=>prep.disposed,onProgress:(d,tot)=>onProgress({phase:'cache',done:d,total:tot})});cinfo.readMs+=performance.now()-t;return e};
   // ---- the volume entry (the 512 body, the 256 copy, the bricks): read instead of copied from the page's 3D volume and computed
   let V=null;
   if(vc){const hit=pf&&pf.keyV===vc.keyV&&pf.V?{key:pf.keyV,entry:pf.V}:null;if(hit){cinfo.from='prefetch';cinfo.readMs+=pf.readMs}V=await entryOf('vr-volume',vc.keyV,hit);alive()}
   let vd=null,half=null,t0=performance.now();const meta=volumeMeta(maxTexture3D());
   if(V&&vrVolumeEntryOk(V,meta.dims)){
    let body=V.arrays.data||null;
    if(!body){ // an entry without a 512 body: it is copied from the page's 3D volume, (the cross-sections always use the full grid)
     t0=performance.now();const bd=await buildVolumeData(maxTexture3D(),(a,b,src)=>onProgress({phase:src==='gpu'?'copy':'read',done:a,total:b}),{noBricks:true,sliceMs});
     times[bd.source==='gpu'?'copy':'read']=performance.now()-t0;alive();body=bd.data;
    }
    vd={data:body,dims:meta.dims,bricks:V.arrays.bricks,brickDims:V.meta.brickDims,halfExt:meta.halfExt,step:meta.step,calibration:meta.calibration,filtered:meta.filtered,source:'cache'};
    half=V.meta.half?{...vd,data:V.arrays.halfData,dims:V.meta.half.dims,step:marchStep(vd.halfExt,V.meta.half.dims),bricks:V.arrays.halfBricks,brickDims:V.meta.half.brickDims}:null;
    cinfo.volume='hit';times.half=0;
   }else{
    if(vc)cinfo.volumeWhy=V?{code:'damaged'}:await explainMiss(vc.cache,{kind:'vr-volume',key:vc.keyV,dataset:vc.dataset,parts:vc.hashes});
    t0=performance.now();
    vd=await buildVolumeData(maxTexture3D(),(a,b,src)=>onProgress({phase:src==='gpu'?'copy':'read',done:a,total:b}),{noBricks:true,sliceMs});
    times[vd.source==='gpu'?'copy':'read']=performance.now()-t0;alive();
    onProgress({phase:'half',done:0,total:1});await tick();t0=performance.now();
    const vr=await prep.volume({data:ownBuffer(vd.data),dims:vd.dims,calib:vd.calibration,brick:BRICK,half:Math.max(...vd.dims)>256});
    vd.data=new Uint8Array(vr.data);vd.bricks=vr.bricks;vd.brickDims=vr.brickDims;
    half=vr.half?{...vd,data:vr.half.data,dims:vr.half.dims,step:marchStep(vd.halfExt,vr.half.dims),bricks:vr.half.bricks,brickDims:vr.half.brickDims}:null;
    times.half=performance.now()-t0;alive();
   }
   // a result that was computed (not read) is stored on the device in the background; the finished data of a hit is only pointed at by the alias
   const finishP=Pn=>{
    vrCacheState.last=cinfo;if(cinfo.readMs)times.cache=cinfo.readMs;
    if(vc&&(cinfo.volume==='miss'||cinfo.derived==='miss'))scheduleVrCacheStore(vc,Pn,keyD,hashD,cinfo,cgen,aliasId,fresh);
    else if(vc&&aliasId&&keyD)vrStoreChain.p=vrStoreChain.p.then(()=>scheduleAlias(vc,aliasId,keyD,fresh)).then(()=>refreshVrCapacity(vc.cache)).catch(()=>{});
    vrCacheNotify?.();return Pn};
   onProgress({phase:'cls',done:0,total:1});await tick();t0=performance.now();
   // the shown-segment mask the combined texture is built for (prepareVrGpu uses it as it is when the session starts with the same one)
   initialVrModes();
   const small=half||vd,editDims=small.dims,order=gpuSegmentOrder(),segs=vrSegments(),state={};for(const k of order.slice(0,4)){const g=segs[k];state[k]=g?{active:!!g.active,enabled:!!g.enabled,min:g.min,max:g.max}:undefined}
   const comboMask=shownMask(),tCollect=performance.now(),ed=editDescsOf(); // tCollect: the page's own (synchronous) part of the job: collecting the runs and handing them over
   // the processing masks, the analysis index, the classification bytes, the distance field, the combined texture and the occupancy: one worker job (the page's part is collecting the runs)
   const regionItems=ed?regionItemsOf():[];
   // the device cache for everything that follows from the segments / masks / analysis results: the key is made of hashes of every input of this step (see vr-prep-cache.js)
   let D=null;
   if(vc){const tHash=performance.now();try{
    hashD=await partsOf({v:vc.keyV,dims:small.dims,order,state,mask:comboMask,calib:vd.calibration,edit:ed?{descs:ed.descs,sourceDims:ed.sourceDims}:null,region:regionItems,bricks:{f:vd.brickDims,h:half?half.brickDims:null}});
    keyD=await keyOfParts('vr-derived',hashD);cinfo.keyD=keyD;times.cacheKey=(times.cacheKey||0)+performance.now()-tHash;
    const hit=pf&&pf.keyD===keyD&&pf.D?{key:pf.keyD,entry:pf.D}:null;if(hit){cinfo.from='prefetch'}
    D=await entryOf('vr-derived',keyD,hit);alive();if(pf)pf.D=null;
    if(D&&!vrDerivedEntryOk(D,small)){D=null;cinfo.derivedWhy={code:'damaged'}}
    else if(!D)cinfo.derivedWhy=await explainMiss(vc.cache,{kind:'vr-derived',key:keyD,dataset:vc.dataset,parts:hashD});
   }catch(e){if(prep.disposed)throw e;console.warn('VR data cache: key / read failed',e);D=null;cinfo.derivedWhy={code:'failed',detail:String((e&&e.message)||e).slice(0,40)}}}
   if(pf){pf.V=null;pf.D=null} // whatever was read ahead is used or let go now
   if(D){ // the processing mask, the classification, the distance field, the combined texture, the fourth channel, the analysis index and the occupancy from the device cache
    const {edit,cls,dist,region,combo,cls4,occFull,occHalf}=vrDerivedFromEntry(D,small);
    writeBrickOccupancy(vd.bricks,occFull);if(half)writeBrickOccupancy(half.bricks,occHalf);
    cinfo.derived='hit';times.collect=performance.now()-tCollect;times.cls=0;
    return finishP({key,vd,half,edit,cls,dist,region,times,combo,cls4,occFull,occHalf,prepInfo:{worker:prep.stats.worker>0&&prep.stats.local===0,jobs:prep.stats,cache:cinfo}});
   }
   const job=prep.cls({src:ownBuffer(small.data),dims:small.dims,calib:vd.calibration,editDescs:ed?ed.descs:[],editSourceDims:ed?ed.sourceDims:small.dims,regionItems,order,state,
    brickDimsFull:vd.brickDims,brickDimsHalf:half?half.brickDims:null,mask:comboMask},(a,b)=>onProgress({phase:'dist',done:a,total:b}));
   times.collect=performance.now()-tCollect;
   const cj=await job;alive();
   for(const w of cj.warnings||[])console.error('VR preparation:',w);
   small.data=new Uint8Array(cj.src);
   const edit={dims:editDims,data:cj.edit.data||null,active:cj.edit.active|0,maskOnly:cj.edit.maskOnly|0};
   // mask-only occupancy into the B channel of both grids' bricks (the HU path skips empty bricks again)
   writeBrickOccupancy(vd.bricks,cj.occFull);if(half)writeBrickOccupancy(half.bricks,cj.occHalf);
   times.cls=performance.now()-t0;
   const cls=cj.cls,dist=cj.dist,region={dims:editDims,...cj.region};
   const combo=cj.combo?{data:cj.combo,mask:comboMask,dims:small.dims}:null,cls4=cj.cls4||null;
   return finishP({key,vd,half,edit,cls,dist,region,times,combo,cls4,occFull:cj.occFull,occHalf:cj.occHalf,prepInfo:{worker:prep.stats.worker>0&&prep.stats.local===0,jobs:prep.stats,cache:cinfo}});
  }finally{prep.dispose();if(activePrep===prep)activePrep=null}
 })();
 preparing={key,promise};
 const gen=prepareGen;
 try{const P=await promise;if(gen===prepareGen)prepared=P;return P}finally{if(preparing?.promise===promise)preparing=null} // released meanwhile: handed to the caller, not kept
}

// classification bytes for the 3D position-comment markers of the PC / iPad view (comment-3d.js), the same data and rule as VR's
// hidden test. Only vd (<= 256 grid, no bricks) -> edit mask -> cls (no distance field / regions); reuses the VR preparation when it is ready
// for the same key. State handling (one build at a time, 250 ms debounce, volume cached per series + filter, failures retried, previous
// result kept while rebuilding) is hidden-cls-state.js. hiddenClsFor(onReady) -> {cls,dims,halfExt} or null; onReady fires when it changed.
const hiddenVolumeKey=()=>{const v=gpuVolumeTarget();return v?.series?v.series.id+'|'+(v.filterSignature||''):''};
const hiddenClsKey=()=>{ // what the bytes depend on: the data, and per segment its range / shown state / edits
 const segs=SEGMENT_PRESET_ORDER.map(k=>{const g=segmentState[k]||{},st=segmentEditState[k]||{};
  return [g.active?1:0,g.enabled?1:0,g.min,g.max,st.revision|0,idOf(st.baseRuns),idOf(st.keepRuns),idOf(st.excludeRuns),segmentSourceSignature(k)].join(',')});
 return [hiddenVolumeKey(),gpuSegmentOrder().join('>'),...segs].join('|');
};
const hiddenMgr=createHiddenClsManager({
 volumeKey:hiddenVolumeKey,segKey:hiddenClsKey,
 loadVolume:async()=>{const v=gpuVolumeTarget();if(!v?.sourceBacked||!v.series){const e=new Error('no source-backed volume');e.permanent=true;throw e}return buildVolumeData(256,null,{noBricks:true})},
 buildCls:vd=>{
  const m=buildEditMask(vd.dims),edit={dims:vd.dims,data:m.activeMask?m.data:null,active:m.activeMask|0,maskOnly:m.maskOnly|0};
  return{cls:buildClsData(vd,vd.calibration,edit,segmentState,gpuSegmentOrder()),dims:vd.dims,halfExt:vd.halfExt};
 },
});
export function hiddenClsFor(onReady=()=>{}){
 if(prepared&&prepared.key===vrDataKey()&&!(eventModeOn()&&SEGMENT_PRESET_ORDER.some(k=>segmentState[k]?.active&&!segmentState[k].enabled))){const P=prepared;return{cls:P.cls,dims:(P.half||P.vd).dims,halfExt:P.vd.halfExt}}
 return hiddenMgr.get(onReady);
}
export function releaseHiddenCls(){hiddenMgr.release()}
// page panel: progress while preparing, then the start button (a click, so
// the session may start)
export function showPreparePanel({language='ja',mode='vr',onStart,onStep=()=>{}}){
 const ja=language==='ja';document.getElementById('vr-prepare-panel')?.remove();
 const panel=document.createElement('div');panel.id='vr-prepare-panel';
 Object.assign(panel.style,{position:'fixed',left:'50%',top:'50%',transform:'translate(-50%,-50%)',zIndex:'10000',background:'#141c24f2',color:'#fff',padding:'20px 24px',borderRadius:'14px',width:'min(92vw,440px)',font:'15px system-ui,sans-serif',boxShadow:'0 8px 30px #0008'});
 panel.innerHTML='<strong style="font-size:18px"></strong><div class="ph" style="margin:12px 0 6px;color:#cfe3f0"></div><div style="height:10px;background:#26313b;border-radius:5px;overflow:hidden"><div class="bar" style="height:100%;width:0;background:#2d6cdf"></div></div><div class="tm" style="margin-top:10px;color:#9fb3c3;font-size:13px;white-space:pre-line"></div><div style="display:flex;gap:10px;justify-content:flex-end;margin-top:16px"><button type="button" class="cancel"></button><button type="button" class="start" disabled></button></div>';
 const q=c=>panel.querySelector(c),names=ja?{copy:'3D画面から写す',read:'データ読み込み',cache:'保存済みVR用データを読込',half:'256³を作成',mask:'加工マスク',cls:'判定用データ',dist:'距離場'}:{copy:'Copy from the 3D view',read:'Reading data',cache:'Reading the saved VR data',half:'Building 256³',mask:'Processing mask',cls:'Classification',dist:'Distance field'};
 q('strong').textContent=(mode==='ar'?'AR':'VR')+(ja?'の準備':' preparation');q('.cancel').textContent=ja?'閉じる':'Close';q('.start').textContent=mode==='ar'?(ja?'ARを開始':'Start AR'):(ja?'VRを開始':'Start VR');
 Object.assign(q('.start').style,{background:'#2d6cdf',color:'#fff',border:'0',borderRadius:'8px',padding:'10px 18px',fontSize:'16px'});Object.assign(q('.cancel').style,{background:'#26313b',color:'#fff',border:'0',borderRadius:'8px',padding:'10px 14px'});
 const order=['read','half','mask','cls','dist'],allPhases=['copy','cache',...order];
 q('.cancel').onclick=()=>{panel.remove();onStep({step:'closed'})};
 q('.start').onclick=()=>{q('.start').disabled=true;panel.remove();onStart()}; // onStart shows the busy state at once (the session request follows)
 // the preparation runs in the central progress modal; the panel shows up when it is ready (timings, start button) or failed
 panel.style.display='none';document.body.append(panel);
 const title=q('strong').textContent,done_=()=>{setBusySlot('vr',false);panel.style.display=''};onStep({step:'prepare',text:''});
 setBusySlot('vr',true,{label:title});
 const report=({phase,done,total})=>{const lab=names[phase]+(phase==='read'||phase==='copy'?' '+done+' / '+total:phase==='cache'&&total?' '+Math.round(done*100/total)+' %':'');onStep({step:'prepare',text:lab});q('.ph').textContent=lab;const i=Math.max(0,order.indexOf(phase==='copy'?'read':phase)),f=(i+((phase==='read'||phase==='copy')&&total?done/total:0))/order.length;q('.bar').style.width=Math.round(f*100)+'%';reportBusyProgress('vr',f,1,q('.ph').textContent)};
 prepareVrData(report).then(async p=>{
  try{
  q('.bar').style.width='100%';
  // upload, compile and wait on the GPU before the session (skipped when already prepared for this data and mode)
  let g=gpuPrepared&&gpuPrepared.key===p.key&&gpuPrepared.mode===mode?gpuPrepared:null;
  if(!g){q('.ph').textContent=ja?'GPU の準備（転送・コンパイル）':'Preparing the GPU (upload, compile)';onStep({step:'prepare',text:q('.ph').textContent});reportBusyProgress('vr',1,1,q('.ph').textContent);g=await prepareVrGpu(p,mode)}
  q('.ph').textContent=ja?'準備ができました':'Ready';
  const gpuLine=g?.times?((ja?'GPU: ':'GPU: ')+(g.times.total/1000).toFixed(1)+' s'):'';
  q('.tm').textContent=allPhases.filter(k=>p.times[k]!=null).map(k=>names[k]+': '+(p.times[k]/1000).toFixed(1)+' s').concat(gpuLine?[gpuLine]:[]).concat(vrCacheText(ja)?[vrCacheText(ja)]:[]).join('\n');
  }catch(e){console.error(e);done_();onStep({step:'failed'});q('.ph').textContent=(ja?'準備に失敗: ':'Preparation failed: ')+String(e.message||e);return}
  done_();onStep({step:'ready'});q('.start').disabled=false;q('.start').focus();
 },e=>{console.error(e);done_();onStep({step:'failed'});q('.ph').textContent=(ja?'準備に失敗: ':'Preparation failed: ')+String(e.message||e)});
}

let running=null;
// lets the headset draw the menu (a status line) before a long synchronous step; falls back after 250 ms when no frame comes
const nextFrames=(session,n=2)=>new Promise(res=>{let left=n;const t=setTimeout(res,250),tick=()=>{if(--left<=0){clearTimeout(t);res()}else session.requestAnimationFrame(tick)};try{session.requestAnimationFrame(tick)}catch{clearTimeout(t);res()}});
// mode 'vr': own background; 'ar': immersive-ar passthrough on
// Quest, no background drawn and the clear is transparent
// where the trigger records a VR point: 'section' (the face of a section, default) or 'surface' (the first tissue surface); remembered
// while the page lives, not saved
let vrPointMode='surface'; // default 表面 (not persisted; kept while the page lives)
// 体験会モード (event-fresh.js): a new practice dataset / the menu's 最初の状態に戻す: the modes this module keeps for the next session go back to their start (every segment normal, point place 表面, no screenshots of the last visitor)
const onEventFresh=()=>{for(const k of Object.keys(segMode))delete segMode[k];vrPointMode='surface';shots.length=0;try{saveSettings(resetEventViewSettings(loadSettings()))}catch{}};
if(typeof document!=='undefined'){document.addEventListener('vrl-event-fresh',onEventFresh);
 // this module is loaded lazily: a practice dataset opened (and its fresh start announced) BEFORE it came in must not leave the last visitor's view settings in place (event-fresh.js counts the starts)
 if(eventModeOn()&&(globalThis.__vrlEventFreshCount|0)>0)onEventFresh()} // a board the last visitor pinned in place (grip) follows the head again
// the point menu's 「コメント」 (a hidden text field; the Quest system keyboard in an immersive session is unverified): off unless localStorage vrl-vr-point-comment is '1'
const VR_POINT_COMMENT=(()=>{try{return localStorage.getItem('vrl-vr-point-comment')==='1'}catch{return false}})();
export async function startVrView({language='ja',mode='vr',onStep=()=>{}}={}){
 if(running)return;
 const step=n=>{try{onStep(n)}catch(e){console.warn(e)}}; // 'session' (asking the headset) / 'in-session' (it exists) / 'ended' - the page shows the matching feedback
 const ja=language==='ja',settings=loadSettings();settings.diag=0;settings.editDiag=0;settings.clsDiag=0;settings.distDiag=0;settings.boxDiag=0;settings.skipDiag=effectiveFlag('vrNoSkip',false)?0:1;
 const vrWindow={c:+wc.value||0,w:Math.max(1,+ww.value||1)}; // VR-local CT window: starts from the app's sliders, not written back
 // a renderer prepared on the page (textures uploaded, programs compiled) is reused; otherwise a fresh one
 let gpu=gpuPrepared&&gpuPrepared.key===vrDataKey()&&gpuPrepared.mode===mode?gpuPrepared:null;if(gpu)gpuPrepared=null;else disposeGpuPrepared(); // let (the page-prepared assets are let go once the session holds them)
 const ar=mode==='ar',renderer=gpu?.renderer||new THREE.WebGLRenderer({antialias:false,alpha:ar,preserveDrawingBuffer:false});
 renderer.setPixelRatio(1);renderer.setSize(8,8,false);renderer.xr.enabled=true;try{const g=renderer.getContext();maxTex3dKnown||(maxTex3dKnown=g.getParameter(g.MAX_3D_TEXTURE_SIZE)||0)}catch{} // the limit from the session's own context (see maxTexture3D)
 renderer.xr.setReferenceSpaceType('local-floor');
 if(!gpu){Object.assign(renderer.domElement.style,{position:'fixed',left:'0',top:'0',width:'1px',height:'1px',opacity:'0',pointerEvents:'none'});document.body.appendChild(renderer.domElement)}
 const sessionAt=performance.now();let firstDrawMs=-1;
 // requestSession must run inside the click; the texture is built afterwards
 // while the headset shows progress
 let session;
 step('session');
 try{session=await navigator.xr.requestSession(ar?'immersive-ar':'immersive-vr',{optionalFeatures:['local-floor','hand-tracking']})}
 catch(e){if(gpu)gpuPrepared=gpu;else{renderer.dispose();renderer.domElement.remove()}throw e}
 running={session};step('in-session');if(ar)emit('ar-start');else emit('vr-start');
 const scene=new THREE.Scene();scene.background=ar?null:BG.clone();
 const background=makeBackground();if(ar){background.visible=false;renderer.setClearColor(0x000000,0)}else scene.add(background);
 // AR only: in-session switch passthrough <-> "VR view" (opaque background drawn instead of the transparent clear; nothing else is touched). A new session starts as passthrough.
 const vt=createViewToggle(ar),applyView=()=>{if(!vt.canToggle)return;const on=vt.vrView;scene.background=on?BG.clone():null;background.visible=on;if(on)scene.add(background);else scene.remove(background);renderer.setClearColor(on?BG:0x000000,on?1:0)};
 const camera=new THREE.PerspectiveCamera(70,1,0.01,50);
 const L=ja?{ptT:'位置コメント（VR ポイント）',laserL:'レーザーの見た目',laserV:['線','帯・細','帯・太'],hrT:'ハンドのレーザー',hrV:['標準','指差し'],ptMode:'記録する場所',ptModeV:['断面','表面'],ptHelpSurf:['トリガーを短く押す：レーザーが最初に当たる組織の表面に記録／点に当てて選択','表面＝表示中のセグメントの境界（不透明度は無視。断面で切った面も表面）','記録は押した瞬間の場所。0.5秒以上押すと記録しません','スティックを動かした直後0.3秒は記録しません（その手のみ）','「VR ポイント N」で保存（2D画面の一覧に出ます。本文は「編集」で変えられます）'],ptDone:'記録しました：',ptHelp:['トリガーを短く押す：選んだ断面の組織の所に当てて記録（空気の所は記録しません）／点に当てて選択（長押し：移動・削除・色・距離）／押して2cm動かすと断面を動かす','記録は押した瞬間の場所。0.5秒以上押すと記録しません','スティックを動かした直後0.3秒は記録しません（その手のみ）','「VR ポイント N」で保存（2D画面の一覧に出ます。本文は「編集」で変えられます）'],ptDel:'この点を削除',ptUndo:'元に戻す',ptSel:'選択中の点：',ptNoSel:'点にレーザーを当ててトリガーで選択',ptDeleted:'点を削除しました（「元に戻す」で戻せます）',ptRestored:'点を元に戻しました',ptList:'位置コメント一覧',ptNone:'まだありません',realSize:'実寸（1倍）にする',realSizeNo:'実寸にできません（30cm超）',title:'Virtual Rodent Lab',tabs:['表示','断面','スライス','画質','詳細','解析','位置','HU線','データ'],anT:'解析結果（体積）',anNone:'解析結果はありません（2D/3D画面の体積解析で作成し、表示中のものがVRに入ります）',anTotal:'合計',anPage:'ページ',lbSize:'ラベルの大きさ',lbSizeV:['小','中','大'],lbReset:'ラベルを元の位置に戻しました',lbMoveHelp:['ピン留めしたラベルをレーザーで指し、トリガーを押したまま動かすと移動できます','動かさずに短く押すとピンを外し、0.5 秒長押しすると元の位置に戻ります（位置は保存されます）'],lbHide:'ラベルの隠れ方',lbHideV:['実際に隠す','薄くする'],win:'断面に映すCT画像の設定（アプリ側の値は変わりません）',winHelp:'スライダーは10 HU単位、−／＋は10 HUずつ',airL:'透明にするCT値',airHelp:'この値以下のスライスは透明（−500：空気／−50：脂肪まで）',wcL:'ウィンドウ中心',wwL:'ウィンドウ幅',pApp:'アプリの値',pFull:'全範囲',pBone:'骨',pSoft:'軟部',follow:'ついて来る',fixed:'固定',menuPos:'メニューの位置',menuKey:'A/X：短く＝よく使う（リング）、長押し＝メニューの開閉',menuGrab:'メニュー・操作方法・HU分布・HU線の板を指してグリップ＝移動（固定に）',helpT:'操作方法',helpModes:['非表示','ついて来る','固定'],helpBasic:['グリップ：ボリュームをつかんで動かす・向きを変える','両手でグリップ：拡大・縮小','トリガー（短く）：点を記録／点を選択（点を長押し：移動・削除・色・距離）','A／X：短く＝よく使う（リング）、長押し＝メニュー','B／Y：断面を出す（長押しで追加）','スティック押し：短く＝スライス透明／長押し＝枠を隠す','メニューを指してグリップ：メニューを移動'],helpSec:['枠の中ならどこでも：トリガーで選択／押したまま動かして移動・回転','スティック上下：選んだ断面をスクロール','点を長押し：移動・削除・色・距離のリング','B／Y：断面の表示／非表示（長押しで追加）','トリガー（短く）：断面や組織に点を記録／点に当てて選択','スティック押し：短く＝スライス透明／長押し＝枠を隠す','A／X：短く＝よく使う（リング）、長押し＝メニュー'],helpMenu:'トリガー：メニューのボタン・スライダー',close:'閉じる',badge:'X：よく使う／長押し：メニュー',wheelEdit:'よく使う（リング）を設定',wheelT:'よく使う（リング）の項目',wheelHelp:'1＝上、時計回り。スロットを選んでから項目を押す',wheelEmpty:'空き',wheelPrev:'◀ 前へ',wheelNext:'次へ ▶',wheelClear:'空にする',wheelReset:'既定に戻す',back:'戻る',wheelNoMode:'断面モード／表面モードがありません（切り替えられません）',ptMove:'移動',ptDelete:'削除',ptComment:'コメント',modeNow:'記録する場所：',modeHint:'（A/X のリングで切り替え）',undoDone:'元に戻しました',undoFail:'元に戻せませんでした',undoNone:'戻す操作はありません',ptMoved:'点を移動しました（「元に戻す」で戻せます）',ptMoveHint:'移動中：置きたい所でトリガー（A/X で取り消し）',ptDist:'距離',ptDistHint:'終点のポイントを選んでください',ptDistStart:'始点を選びました：',ptDistDone:'距離を追加しました（「元に戻す」で戻せます）',ptDistExists:'この2点の距離はすでにあります',ptDistCancel:'距離の測定をやめました',ptDistSame:'始点とは別のポイントを選んでください',ptDistRefused:'これ以上距離を追加できません',ptDistOther:'別のシリーズのポイントとは測れません',
   seg:'セグメント',segModes:['通常','簡易','非表示'],noSeg:'表示中のセグメントがありません（アプリで閾値を設定）',home:'正面に戻す',clsD:'事前計算（診断）',distD:'距離場（診断）',skipD:'空き領域スキップ',bench:'ベンチ（約 35 秒）',anBench:'解析の重さ（約 12 秒）',benchRun:'ベンチ中 ',benchHelp:'断面を動かし回転させながら、16.5/30 cm × 表示中／骨＋脂肪／骨のみ × 100%／50% の fps。終了後、VR を出た画面に結果が出ます',samples:'サンプル数／画素 ',samplesNote:'（覆う画素の平均、48×48で計測）',refineL:'表面の探索',refineV:['高速','精密'],editD:'加工マスク（診断）',editDv:['なめらか','ボクセル','オフ'],shot:'スクリーンショット',exit:'終了',
   sec:'断面',addPlane:'＋追加',planeN:'断面',clipOn:'切る',clipOff:'切らない',remove:'消す',maxPlanes:'断面は10枚までです',byHelp:'B/Y：短く押す＝表示／非表示、長押し＝断面を追加',scrollHelp:['スティック上下：選んだ断面（一覧で色付き）を法線方向に動かします','何もない所でトリガーを押したまま動かすと、選んだ断面が動きます（枠は手の色で光ります）'],snapL:'選んだ断面を',snapModes:['軸位','冠状','矢状'],offOn:['オフ','オン'],cap:'キャップ',tint:'スライスの色付け',ctSh:'スライスの塗り',ctShV:['単色','CT濃淡'],ctBr:'濃淡の明るさ',ctCo:'濃淡のコントラスト',cut:'切り取り',cutModes:['オフ','手前','片側'],flip:'向きを反転',cutHelp:['オフ：切らずにスライスだけ映します','手前：見ている側を消します（向きは自動）','片側：矢印の側を消します。「反転」で入れ替え'],sl:'スライス不透明度',sliceT:'スライス：',sliceClear:'透明',
   handR:'右',handL:'左',secHelp:'枠の細い線・番号札・何もない所（3Dに触れていない所）をトリガーで押したまま動かすと、断面が手に付いて動く（番号の下＝最後に動かした手）',secOff:'「オン」かB/Yボタンで断面を出します',
   r:'ボリューム解像度',auto:'自動',am:'自動の下限',amv:['最低 50%','最低 35%','最低 25%'],dt:'データ',q:'描画の細かさ',qv:['標準','粗め','最粗'],f:'周辺の簡略化',fv:['なし','中','強'],hz:'リフレッシュレート',diag:'診断',dv:['通常','箱のみ','ループ数','陰影なし','スキップなし'],
   hist:'HU分布',histTitle:'HU分布',histAuto:'自動',histApprox:'概算',histBusy:'計算中',histX:'HU値',histY:'ボクセル数',histYLog:'ボクセル数（対数）',histNone:'セグメント外',histEmpty:'データがありません',histLin:'線形',histLog:'対数',
   stHeld:'断面：動かしています',stFixed:'断面：固定中',stNone:'グリップでつかむ・両手で拡大縮小',preparing:'VRボリューム準備中… ',uploading:'画像をGPUへ転送中…（数秒止まって見えることがあります）',compiling:'描画の準備中…（もう少しで表示されます）',failed:'VR準備に失敗: ',shotDone:'スクリーンショットを撮りました（終了後にページで保存）',filtered:' フィルター適用',
   dataOwn:'ご自身のデータを開いているため、ここでは切り替えられません（練習データの時だけ使えます）',dataT:'データ',dataHead:'練習データを切り替える',dataHelp:'押してから、もう一度押すと切り替わります（今の断面・ポイント・ラベルは消えます。VRは続いたままです）',dataAgain:'もう一度',dataHint:'もう一度押すと切り替え（今の断面・ポイントは消えます）：',dataNone:'データを切り替えている間は選べません',
   sw:{saving:'VR用データを保存中',title:'データを読み込み中',failed:'読み込みに失敗しました',retry:'メニューの「データ」からもう一度選んでください',note:'経過 {s} 秒（VRは続いています。そのままお待ちください）',
    stages:{release:'前のデータを手放し中',load:'データを読み込み中',settle:'読み込みの仕上げ中',prepare:'VR用に変換中',compile:'描画の準備中',upload:'GPUへ転送中',bind:'表示します',refine:'高精細版を転送中（表示は続きます）',done:'完了'},
    phases:{copy:'3D画面から写す',read:'データ読み込み',cache:'保存済みのVR用データを読込',half:'256³を作成',mask:'加工マスク',cls:'判定用データ・距離場',dist:'距離場'}}}
  :{ptT:'Position comments (VR points)',laserL:'Laser look',laserV:['Line','Beam thin','Beam wide'],hrT:'Hand laser',hrV:['Standard','Pointing'],ptMode:'Record on',ptModeV:['Section','Surface'],ptHelpSurf:['Short trigger press: records on the first tissue surface the laser meets; laser on a point selects it','Surface = edge of a shown segment (opacity ignored; a face cut by a section counts)','The place is the one at the moment of the press; holding 0.5 s or more records nothing','No recording for 0.3 s after the thumbstick is moved (that hand only)','Saved as “VR point N” (shown in the 2D page list, where the text can be edited)'],ptDone:'Recorded: ',ptHelp:['Short trigger press: laser on the selected section records where it shows tissue (not on air); laser on a point selects it; press and move 2 cm drags the section','The place is the one at the moment of the press; holding 0.5 s or more records nothing','No recording for 0.3 s after the thumbstick is moved (that hand only)','Saved as “VR point N” (shown in the 2D page list, where the text can be edited)'],ptDel:'Delete this point',ptUndo:'Undo',ptSel:'Selected point: ',ptNoSel:'Point the laser at a point and pull the trigger to select',ptDeleted:'Point deleted (Undo brings it back)',ptRestored:'Point restored',ptList:'Position comments',ptNone:'None yet',realSize:'Real size (×1)',realSizeNo:'No real size (over 30 cm)',title:'Virtual Rodent Lab',tabs:['View','Section','Slice','Quality','Details','Analysis','Points','HU line','Data'],anT:'Analysis results (volume)',anNone:'No analysis results (made with the volume analysis on the page; the visible ones come into VR)',anTotal:'Total',anPage:'Page',lbSize:'Label size',lbSizeV:['Small','Medium','Large'],lbReset:'Label put back',lbMoveHelp:['Point at a pinned label and hold the trigger while moving it to place it elsewhere','Without moving: a short press unpins it, holding 0.5 s puts it back (the place is saved)'],lbHide:'Label occlusion',lbHideV:['Hide behind','Fade'],win:'The CT image shown on the sections (the app values are not changed)',winHelp:'Sliders step 10 HU; −/＋ move 10 HU',airL:'Transparent at or below',airHelp:'Slice is transparent at or below this value (−500: air, −50: fat too)',wcL:'Window centre',wwL:'Window width',pApp:'App values',pFull:'Full range',pBone:'Bone',pSoft:'Soft tissue',follow:'Follow',fixed:'Fixed',menuPos:'Menu position',menuKey:'A/X: short = quick ring, hold = open / close the menu',menuGrab:'Point at the menu, help, HU or HU line board, grip: move it (becomes Fixed)',helpT:'Controls',helpModes:['Hidden','Follow','Fixed'],helpBasic:['Grip: grab and turn / move the volume','Grip with both hands: scale','Trigger (short): record / select a point (hold on a point: move, delete, colour, distance)','A / X: short = quick ring, hold = menu','B / Y: show a section (long press: add)','Stick click: short = slice clear, hold = hide frames','Point at the menu, grip: move it'],helpSec:['Anywhere in a frame: trigger selects, hold and move to slide / rotate','Thumbstick up / down: scroll the selected plane','Hold on a point: ring with move / delete / colour / distance','B / Y: show / hide sections (long press: add)','Trigger (short): records a point on a section or tissue; on a point selects it','Stick click: short = slice clear, hold = hide frames','A / X: short = quick ring, hold = menu'],helpMenu:'Trigger: menu buttons and sliders',close:'Close',badge:'X: quick / hold: menu',wheelEdit:'Set quick ring items',wheelT:'Quick ring items',wheelHelp:'1 = top, clockwise. Pick a slot, then an item',wheelEmpty:'Empty',wheelPrev:'◀ Prev',wheelNext:'Next ▶',wheelClear:'Clear',wheelReset:'Defaults',back:'Back',wheelNoMode:'No section / surface mode item (the mode cannot be switched)',ptMove:'Move',ptDelete:'Delete',ptComment:'Comment',modeNow:'Record on: ',modeHint:' (switch in the A/X ring)',undoDone:'Undone',undoFail:'Could not undo',undoNone:'Nothing to undo',ptMoved:'Point moved (Undo brings it back)',ptMoveHint:'Moving: trigger where it goes (A/X cancels)',ptDist:'Distance',ptDistHint:'Pick the end point',ptDistStart:'Start set: ',ptDistDone:'Distance added (Undo removes it)',ptDistExists:'This pair already has a distance',ptDistCancel:'Distance measurement cancelled',ptDistSame:'Pick a point other than the start',ptDistRefused:'No more distances can be added',ptDistOther:'Cannot measure to a point of another series',
   seg:'Segments',segModes:['Normal','Simple','Hidden'],noSeg:'No segment shown (set thresholds in the app)',home:'Bring to front',clsD:'Precomputed (diag.)',distD:'Distance field (diag.)',skipD:'Skip empty space',bench:'Benchmark (about 35 s)',anBench:'Analysis cost (about 12 s)',benchRun:'benchmark ',benchHelp:'fps while a section sweeps and the volume turns: 16.5/30 cm × shown / bone+fat / bone only × 100% / 50%; the result is shown after leaving VR',samples:'samples / pixel ',samplesNote:' (mean over covered pixels, 48×48 probe)',refineL:'Surface search',refineV:['Fast','Exact'],editD:'Processing mask (diag.)',editDv:['Smooth','Voxel','Off'],shot:'Screenshot',exit:'Exit',
   sec:'Sections',addPlane:'+ Add',planeN:'Plane ',clipOn:'Clips',clipOff:'No clip',remove:'Remove',maxPlanes:'Up to 10 planes',byHelp:'B/Y: press = show / hide, long press = add a plane',scrollHelp:['Thumbstick up / down moves the selected plane (highlighted in the list) on its normal','Hold the trigger on empty space and move: the selected plane moves (its frame glows in the hand colour)'],snapL:'Selected plane',snapModes:['Axial','Coronal','Sagittal'],offOn:['Off','On'],cap:'Cap',tint:'Slice colouring',ctSh:'Slice fill',ctShV:['Solid','CT shading'],ctBr:'Shading brightness',ctCo:'Shading contrast',cut:'Clip',cutModes:['Off','Near side','One side'],flip:'Flip side',cutHelp:['Off: nothing is cut, only the slice is shown','Near side: the side you look from is removed (follows you)','One side: the arrow side is removed; Flip swaps it'],sl:'Slice opacity',sliceT:'Slice: ',sliceClear:'transparent',
   handR:'R',handL:'L',secHelp:'Trigger on a thin frame line, number tag or empty space (not on the 3D object), hold and move: the section sticks to the hand (under the number: last hand)',secOff:'Turn it on here or press B/Y',
   r:'Volume resolution',auto:'Auto',am:'Auto floor',amv:['Min 50%','Min 35%','Min 25%'],dt:'Data',q:'Detail',qv:['Normal','Coarse','Coarsest'],f:'Foveation',fv:['Off','Mid','High'],hz:'Refresh rate',diag:'Diagnostics',dv:['Normal','Box only','Loop count','No shading','No skipping'],
   hist:'HU histogram',histTitle:'HU histogram',histAuto:'Auto',histApprox:'approx.',histBusy:'Calculating',histX:'HU',histY:'Voxels',histYLog:'Voxels (log)',histNone:'Unlabeled',histEmpty:'No data',histLin:'Linear',histLog:'Log',
   stHeld:'Section: being moved',stFixed:'Section: fixed',stNone:'Grip to grab, both hands to scale',preparing:'Preparing VR volume… ',uploading:'Uploading the image to the GPU… (the view may pause for a few seconds)',compiling:'Preparing the renderer… (almost there)',failed:'VR failed: ',shotDone:'Screenshot taken (save it on the page after exit)',filtered:' filtered',
   dataOwn:'Your own data is open, so it cannot be switched here (practice data only)',dataT:'Data',dataHead:'Switch the practice data',dataHelp:'Press, then press again to switch (the sections, points and labels now in view are dropped; VR keeps running)',dataAgain:'Again',dataHint:'Press again to switch (sections and points in view are dropped): ',dataNone:'Not available while the data is being switched',
   sw:{saving:'Saving the VR data',title:'Loading the data',failed:'Loading failed',retry:'Pick the data again from Data in the menu',note:'{s} s elapsed (VR keeps running; please wait)',
    stages:{release:'Releasing the previous data',load:'Loading the data',settle:'Finishing the load',prepare:'Converting for VR',compile:'Preparing the renderer',upload:'Sending to the GPU',bind:'Showing it',refine:'Sending the fine version (the view continues)',done:'Done'},
    phases:{copy:'Copy from the 3D view',read:'Reading data',cache:'Reading the saved VR data',half:'Building 256³',mask:'Processing mask',cls:'Classification, distance field',dist:'Distance field'}}};
 // the menu board starts closed (only the volume and the help board at launch); A/X long press or the ring's メニュー opens it as before.
 // 体験会モード: it starts open on the かんたん menu (tab 10: show / hide of the level's segments, the analysis labels, すべての設定 -> the full menu)
 // the live tutorial = the switch is on AND its practice data (TUT_SAMPLE, the Lv0 data) is the one open; on other data the board is the normal help (+ the read-only guide)
 const tutLive=tutorialModeOn()&&globalThis.__vrlOpenSample===TUT_SAMPLE;let tutEnded=false; // tutEnded: switching away from the tutorial's data ends the live tutorial (swapData)
 const evMenu=eventModeOn()||tutLive;if(evMenu&&!(settings.help|0))settings.help=DEFAULTS.help; // a practice session shows the operation panel (right) and the mission panel from the start, whatever an old setting said
 let evLabels=TRIGGER_AT_START==='label'; // the live tutorial opens the かんたん menu too (its ステップ4 / 5 use it; it is up from the start, never 「メニューを出して」).: the かんたん menu's trigger switch (event-mode.js): every VR / AR session starts in point mode, whatever the dataset or level (the board shows which one is on)
 const menu=makeMenu(MENU_W,MENU_H,MENU_WIDTH);menu.mesh.visible=evMenu;scene.add(menu.mesh);
 vrCacheNotify=()=>{if(running)menu.refresh()};void refreshVrCapacity(); // the 詳細 tab shows the state of the VR data cache (a store's progress, the storage numbers)
 const ui={sliceClear:false,tab:evMenu?10:0,open:evMenu,status:L.preparing,fpsLine:'',sizeLine:'',flash:'',flashUntil:0,benchLine:'',qualityLine:'',swapBusy:false,swapFailed:false,swapArm:null,swapLine:''};
 const holder=new THREE.Group();holder.position.set(0,1.3,-VOLUME_FWD);scene.add(holder);
 let refreshEdits=()=>{},disposeEdits=()=>{},useData=()=>{},disposeExtra=()=>{},refreshCombo=()=>{},comboTick=()=>{},comboShaderMask=()=>15,comboTs=[],refreshContentBox=()=>{},cbStat={ms:0,frames:0,bricks:0,sliceMs:0,segBricks:0,sliceBricks:0},comboT=null,comboMask=-1,cls4On=false,variants=null,rayVariants=null,mesh=null,material=null,volPick=null,regionList=[],volTex=null,brickTex=null,compMaterial=null,rayMesh=null,lowTarget=null,periTarget=null;const volScene=new THREE.Scene();volScene.matrixWorldAutoUpdate=false;let baseStep=0.002,baseScale=0.165/3.3,info='';
 let skipTick=()=>{}; // the creep-skip bits follow the combined texture (set up with the combo code below)
 // the data of the session can be REPLACED (swapData, in the try block at the end): everything bound to the data is a variable (P: the prepared CPU data, vd: its full grid, full / half: the
 // GPU assets of the two grids, the edit / region textures, the content-box index), the volume's mesh and material go out of the scene meanwhile (mesh / material null = no volume, as before the first
 // preparation: every use of them is guarded). msets: the shader program sets (with / without analysis results), compiled before they are used. swapGuard: generation numbers; uploadQueue: GPU uploads in
 // slices of a few ms per frame; frameGaps: the longest gap between two XR frames (and main-thread task) during a switch, for the device (詳細 tab, console).
 let P=null,vd=null,full=null,half=null,four=false,editTex=null,editActive=0,regionTex=null,regionColors=[],regionSegs=[],cbSliceIdx=null,cbScan=createSegScan(),fullReady=true,gpuWarm=gpu?[...gpu.warm,...(gpu.warmMore||[])]:[],meshObj=null,setKey='',swapData=async()=>false;
 const msets=new Map(),swapGuard=createSwapGuard(),frameGaps=createFrameGapMonitor(),swapMade=[];
 let swapOwn=null; // the longest synchronous pieces of THIS module's own switch work (ms): what the switch itself holds the main thread for, apart from the page's loading and the platform's waits
 const ownNote=(k,t0)=>{if(!swapOwn)return;const d=Math.round((performance.now()-t0)*10)/10;if(d>(swapOwn[k]||0))swapOwn[k]=d};
 const slabBox=new THREE.Box3(),slabAt=new THREE.Vector3();
 // texSubImage3D of z slices [z0, z1) of j.src (a texture the renderer never saw, wrapping the data) into j.tex (allocated with dataReady = false: storage only; never flagged needsUpdate)
 const uploadQueue=createUploadQueue({adaptive:true,copy:(j,z0,z1)=>{slabBox.min.set(0,0,z0);slabBox.max.set(j.dims[0],j.dims[1],z1);slabAt.set(0,0,z0);renderer.copyTextureToTexture(j.src,j.tex,slabBox,slabAt)}});
 const raycaster=new THREE.Raycaster(),tmpM=new THREE.Matrix4();
 const makeLaser=()=>{const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute([-1,0,0,1,0,0,-1,0,-1,1,0,-1],3));g.setIndex([0,1,2,1,3,2]);
  const m=new THREE.ShaderMaterial({uniforms:{color:{value:new THREE.Color(0x88ccff)},opacity:{value:1},width:{value:0.001},taper:{value:0.3}},transparent:true,blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.DoubleSide,toneMapped:false,
   vertexShader:'uniform float width,taper;varying vec2 vU;void main(){float t=-position.z;vec3 a=(modelMatrix*vec4(0.,0.,0.,1.)).xyz,b=(modelMatrix*vec4(0.,0.,-1.,1.)).xyz,d=b-a;float L=length(d);d=L>1e-6?d/L:vec3(0.,0.,-1.);vec3 c=mix(a,b,t),s=cross(d,cameraPosition-c);float sl=length(s);s=sl>1e-9?s/sl:vec3(1.,0.,0.);vU=vec2(position.x,t);gl_Position=projectionMatrix*viewMatrix*vec4(c+s*position.x*width*mix(1.,taper,t),1.);}',
   fragmentShader:'uniform vec3 color;uniform float opacity;varying vec2 vU;void main(){float x=abs(vU.x),e=1.-smoothstep(0.,1.,x),core=smoothstep(0.55,0.,x);float al=e*e*mix(1.,0.3,vU.y)*opacity;gl_FragColor=vec4(mix(color,vec3(1.),core*0.6),al);\n#include <colorspace_fragment>\n}'});
  m.color=m.uniforms.color.value;Object.defineProperty(m,'opacity',{get(){return m.uniforms.opacity.value},set(v){m.uniforms.opacity.value=v},configurable:true});
  const r=new THREE.Mesh(g,m);r.frustumCulled=false;r.raycast=()=>{};
  // the look is switchable (laserStyle): 0 = the old 1 px line (a child of the beam; the beam then draws nothing), 1 / 2 = the beam with its width / taper uniforms. ray.material.color / .opacity / .depthTest / .transparent and ray.renderOrder reach both
  const lm=new THREE.LineBasicMaterial({color:0x88ccff,transparent:true}),line=new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(),new THREE.Vector3(0,0,-1)]),lm);line.frustumCulled=false;line.raycast=()=>{};line.visible=false;r.add(line);lm.color=m.color;
  {let dt=true,ro=0;Object.defineProperty(m,'depthTest',{get:()=>dt,set(v){dt=v;lm.depthTest=v},configurable:true});Object.defineProperty(r,'renderOrder',{get:()=>ro,set(v){ro=v;line.renderOrder=v},configurable:true})}
  const mo=Object.getOwnPropertyDescriptor(m,'opacity');Object.defineProperty(m,'opacity',{get:mo.get,set(v){mo.set(v);lm.opacity=v},configurable:true});
  let cur=-1;r.userData.look=()=>cur;r.userData.setLook=v=>{const k=laserLookOf(v);if(k===cur)return;cur=k;const lk=LASER_LOOKS[k];if(lk.line){g.setDrawRange(0,0);line.visible=true}else{g.setDrawRange(0,Infinity);line.visible=false;m.uniforms.width.value=lk.w;m.uniforms.taper.value=lk.t}};r.userData.setLook(DEFAULTS.laserStyle);
  return r}; // never hit by its own raycast
 const controllers=[0,1].map(i=>{const c=renderer.xr.getController(i);scene.add(c);
  const ray=makeLaser();ray.scale.z=0.08;c.add(ray);c.userData.ray=ray;c.userData.gate=createStickGate();c.userData.stick=createWheelStick();return c});
 const HAND_COLORS={right:0xff7a3d,left:0x7c6cff},handColor=c=>HAND_COLORS[c.userData.source?.handedness]??0xdddddd;
 const dotGeo=new THREE.SphereGeometry(0.004,12,8);
 for(const c of controllers){
  c.userData.ray.material.transparent=true;
  const dot=new THREE.Mesh(dotGeo,new THREE.MeshBasicMaterial({color:0xffffff,toneMapped:false,transparent:true}));dot.visible=false;scene.add(dot);c.userData.dot=dot; // transparent: drawn in the same pass as the rings, so renderOrder can put it over them
  // no guide line any more (sections are not picked by nearness)
 }
 // hand tracking (optional 'hand-tracking'; vr-hand-view.js). Every hand branch below is guarded by isHand(c.userData.source); a controller never takes one
 // the hand laser's mode lives in the device settings (app-settings.js handRay, shared with 設定 > 描画 on the page; localStorage vrl.settings.v1); read every frame, so a change applies at once
 const noHits={menu:null,help:null,hist:null,wheel:null,pwheel:null,undoBtn:null,hu:null,ev:null,wrist:null}; // a hand whose laser is off (指差し, not pointing) hits nothing
 const handRayMode=()=>normalizeHandRay(globalThis.__vrlSettings?.get?.('handRay')),setHandRayMode=v=>{try{globalThis.__vrlSettings?.set?.('handRay',normalizeHandRay(v))}catch{}};
 const handIn=createHandInput(THREE,{renderer,scene,controllers,ja,getHead:()=>head,rayMode:()=>handRayMode(),colorOf:c=>handColor(c),release:c=>c.userData.release?.(true),handInHolder:c=>handInHolder(c),sectionOn:()=>section.on,avail:id=>id==='undo'?wheelAvail('undo'):id==='add'?wheelAvail('section-add'):id==='secUp'||id==='secDown'?!!(section.on&&section.selected&&planes.includes(section.selected)):true,
  grab:(c,t)=>{if(t){gripStartNear(c,t);return true}if(c.userData.wristOn)return false;gripStart(c);return true},ungrab:c=>{if(c.userData.drag?.fist){endDrag(c);return}gripEnd(c)},near:(c,nm)=>nearGrabTarget(c,nm),busy:c=>!!(c.userData.drag||c.userData.lblDrag||histAxis===c||dragging?.c===c||huLine.isDragging())}); // phase 2: the fist = the grip (gripStart / gripEnd below); never starts while this hand drags something
 session.addEventListener('end',()=>handIn.dispose(),{once:true});
 const holdOf=c=>handIn.holder(c); // what a grip holds is attached to this: a hand's palm anchor; a controller: itself (unchanged)
 const pulse=(c,v=0.35,ms=18)=>{if(isHand(c?.userData?.source)){handIn.flash(c,v,ms);return}try{c.userData.source?.gamepad?.hapticActuators?.[0]?.pulse?.(v,ms)}catch{}}; // a hand has no haptics: a visual swell instead
 const sliceToast=makeToast(),SLICE_TOAST_MS=1600;
 const badge=makeBadge(L.badge); // a plain cue on the left controller (not a laser target)
 const leftHand=()=>controllers.find(c=>c.userData.source?.handedness==='left')||controllers[0];
 const setRay=c=>{tmpM.identity().extractRotation(c.matrixWorld);raycaster.ray.origin.setFromMatrixPosition(c.matrixWorld);raycaster.ray.direction.set(0,0,-1).applyMatrix4(tmpM)};
 const menuHit=c=>{if(!ui.open)return null;setRay(c);return raycaster.intersectObject(menu.mesh,false)[0]||null};
 // head pose (world) from the XR camera
 const head=new THREE.Vector3(),headGaze=new THREE.Vector3(0,0,-1),headFwd=new THREE.Vector3(),headLeft=new THREE.Vector3(),tmpQh=new THREE.Quaternion();
 const readHead=()=>{renderer.xr.updateCamera(camera);const cam=renderer.xr.getCamera();cam.getWorldPosition(head);cam.getWorldQuaternion(tmpQh);headGaze.set(0,0,-1).applyQuaternion(tmpQh);headFwd.copy(headGaze);headFwd.y=0;if(headFwd.lengthSq()<1e-6)headFwd.set(0,0,-1);headFwd.normalize();headLeft.set(headFwd.z,0,-headFwd.x);if(frontLock&&frontRef.set){headFwd.copy(frontRef.fwd);headLeft.copy(frontRef.left)}};
 // the FRONT of the session (see markFront): while frontLock is on, every placement reads this direction instead of where the head looks now
 const frontRef={set:false,fwd:new THREE.Vector3(0,0,-1),left:new THREE.Vector3(-1,0,0)};let frontLock=false;
 const markFront=()=>{const o=frontLock;frontLock=false;readHead();frontLock=o;frontRef.fwd.copy(headFwd);frontRef.left.copy(headLeft);frontRef.set=true};
 const withFront=fn=>{const o=frontLock;frontLock=true;try{return fn()}finally{frontLock=o}};
 // menu placement: in front, a little left and below eye level so it does
 // not cover the volume; follow mode moves it back when the head turns away
 const menuTarget=new THREE.Vector3();let menuMoving=false,menuPlaced=false;
 const computeMenuTarget=()=>menuTarget.copy(head).addScaledVector(headFwd,MENU_OFFSET.fwd).addScaledVector(headLeft,MENU_OFFSET.left).add(new THREE.Vector3(0,-MENU_OFFSET.down,0));
 const placeMenuNow=()=>{readHead();computeMenuTarget();menu.mesh.position.copy(menuTarget);menu.mesh.lookAt(head);menuPlaced=true;menuMoving=false};
 // help board: the controls for the current state, front-right,
 // mirrored from the menu; follows lazily, or fixed, or hidden (settings.help);
 // no widgets, but the grip moves it like the menu
 // 体験会モード (event-mode.js): the chosen level's mission.: on its OWN board (ev, below), no longer a block of the help board; the help board keeps its normal height.
 // Shown while the mode is on and the chosen level has a mission text; not for Lv0 while the tutorial is on (Lv0 = the tutorial then). Without a mission there is no ev board at all.
 // the board shows the level's slide as it is: its picture (tutorial-slides.js, docs/tutorial/slides/<lv>.webp) over the whole 16:9 board (tutorial-vr.js layoutLevelSlide);
 // drawn when the picture arrives (until then its place is empty), then still. Not for Lv0 while the live tutorial runs.
 // the slide follows the level of the data in view (swapData: refreshEvBoard); the board itself is made the first time a level has a slide
 const evSlideFor=()=>{const l=activeEventLevel();return l&&!(l.id==='lv0'&&tutLive&&!tutEnded)?levelSlide(l.id):null};
 let evSlide=evSlideFor(),evPics=null,ev=null;
 // the help board is TAB_H taller than its page (PAGE_H = 560 px + the caption band under the slide): the strip under it holds the 手順一覧 | 詳細 tabs (tutorial-vr.js panelTabs)
 const help=makeMenu(820,PAGE_H+TAB_H,HELP_WIDTH,HELP_RES);help.mesh.visible=false;scene.add(help.mesh);
 const buildEv=()=>{if(ev||!evSlide)return;evPics||=createSlideImages({onLoad:()=>{if(ev){ev.refresh();ev.flush()}}});ev=makeMenu(820,levelBoardH(820),EV_WIDTH,EV_RES);
  scene.add(ev.mesh);ev.mesh.visible=false;ev.onDraw(()=>evSlide?layoutLevelSlide(evSlide,{W:820,getImage:evPics.get}).widgets:[]);ev.refresh();ev.flush()}; // static: drawn now and once more when the picture has loaded
 buildEv();
 let tutBad=false,sweepOn=false,tutPreview=null,tutMenuKey='',tutMenuRect=null; // tutMenuRect: where the step's button / knob is on the menu (menuTargetRect), for the 3D arrow over it; // sweepOn: the self-check's section sweep is running (it adds / toggles a plane itself: no tutorial signal)
 const tutFail=e=>{if(!tutBad){tutBad=true;helpShow='list';console.warn('[tutorial] board error, falling back to the normal help board',e)}};
 const lookV=new THREE.Vector3(),boardAngle=(mesh,placed)=>{if(!placed||!poseAt)return null;mesh.getWorldPosition(lookV);return horizAngleDeg(headGaze.x,headGaze.z,lookV.x-head.x,lookV.z-head.z)};
 const makeGlow=(board,wM,hM)=>{const g=new THREE.Mesh(new THREE.PlaneGeometry(wM*1.07,hM*1.07),new THREE.MeshBasicMaterial({color:0xE8508F,transparent:true,opacity:0,toneMapped:false,depthWrite:false}));g.position.z=-0.003;g.visible=false;board.add(g);return g};
 const glowHelp=makeGlow(help.mesh,HELP_WIDTH,HELP_WIDTH*(PAGE_H+TAB_H)/820),glowMenu=makeGlow(menu.mesh,MENU_WIDTH,MENU_WIDTH*MENU_H/MENU_W);
 const ctlHints=createControllerHints(THREE,{controllers,isHand:src=>isHand(src)}),edgeArrow=createEdgeArrow(THREE),boardArrow=createBoardArrow(THREE,menu.mesh);scene.add(edgeArrow.mesh);
 let tutVr=null;tutVr=tutLive?createTutorialVr({resetUserState,getSectionOn:()=>section.on,onMissionStart:id=>{if(id==='grip'&&smallForTutorial(holder.scale.x,realLongMm()))bringVolumeFront()},getMenuOpen:()=>ui.open,getLook:()=>({right:boardAngle(help.mesh,helpPlaced),left:boardAngle(menu.mesh,menuPlaced)}),getInput:()=>handIn.anyHand()?'hand':'ctrl',lang:ja?'ja':'en',onChange:()=>{if(tutVr)help.refresh()}}):null; // チュートリアル: the help board shows the carousel page (tutorial-vr.js); null = the board is as before
 let helpShow=tutVr?'detail':'list'; // which tab of the help board is up
 const helpTarget=new THREE.Vector3();let helpMoving=false,helpPlaced=false,helpHeld=null,helpKey='';
 const computeHelpTarget=()=>helpTarget.copy(head).addScaledVector(headFwd,HELP_OFFSET.fwd).addScaledVector(headLeft,HELP_OFFSET.left).add(new THREE.Vector3(0,-HELP_OFFSET.down,0));
 // the mission board (ev): placed at EV_OFFSET;: it follows the head like the help board (settings.help 1), fixed otherwise; grip moves it, 正面に戻す (= every placeHelpNow) puts it back
 const evTarget=new THREE.Vector3();let evPlaced=false,evHeld=null,evMoving=false;
 const computeEvTarget=()=>{evTarget.copy(head).addScaledVector(headFwd,EV_OFFSET.fwd).addScaledVector(headLeft,EV_OFFSET.left);evTarget.y-=EV_OFFSET.down}; // straight ahead behind the volume, a little above the gaze (vr-layout.js EV_OFFSET)
 const placeEvNow=()=>{if(!ev)return;readHead();computeEvTarget();if(evHeld){scene.attach(ev.mesh);evHeld=null}ev.mesh.position.copy(evTarget);ev.mesh.lookAt(head);evPlaced=true;evMoving=false};
 const placeHelpNow=()=>{readHead();computeHelpTarget();help.mesh.position.copy(helpTarget);help.mesh.lookAt(head);helpPlaced=true;helpMoving=false;placeEvNow()};
 const helpHit=c=>{if(!help.mesh.visible||help.mesh.parent===holdOf(c))return null;setRay(c);return raycaster.intersectObject(help.mesh,false)[0]||null};
 const evHit=c=>{if(!ev||!ev.mesh.visible||ev.mesh.parent===holdOf(c))return null;setRay(c);return raycaster.intersectObject(ev.mesh,false)[0]||null};
 // the HU line's live panel (huLine / huHits: made below, used only once the loop runs). Not a target while held by this hand or while a line is being stretched
 const huPanelHit=c=>{const p=huLine.panel;if(!p.visible||p.parent===holdOf(c)||huLine.isDragging())return null;setRay(c);huHits.length=0;p.raycast(raycaster,huHits);return huHits[0]||null};
 const histSlotKeys=()=>gpuSegmentOrder();
 const histColorOf=Lb=>{const s=labelSlot(Lb);if(s>=0)return segmentState[histSlotKeys()[s]]?.color||'#ffffff';const k=labelRegion(Lb);if(k>=0){const c=histP?.region?.colors?.[k];return c==null?UNLABELED_COLOR:'#'+(c>>>0).toString(16).padStart(6,'0')}return UNLABELED_COLOR};
 const histNameOf=Lb=>{const s=labelSlot(Lb);if(s>=0){const k=histSlotKeys()[s];return tr(k)||k}const k=labelRegion(Lb);if(k<0)return L.histNone;
  const c=histP?.region?.colors?.[k],ids=(histP?.region?.list||[]).filter(r=>r.color===c).map(r=>{const g=analysisRegions.find(x=>x.id===r.rid);return g?(g.merged?tr('mergedRegion'):tr('analysisRegion'))+' '+g.id:''}).filter(Boolean);
  return ids.length>2?ids.slice(0,2).join(', ')+' …':ids.join(', ')||(ja?'解析結果':'Result')};
 const histView={ready:false,hists:null,total:null,res:null,range:null,approx:false,dims:null,busy:false,message:''}; // reused: read at once by the board
 const getHistView=()=>{const r=labelHist.result,v=histView;v.busy=labelHist.busy;v.message=labelHist.error;v.range=getHistogramRange();v.ready=!!r;
  if(r){v.hists=r.hists;v.total=r.total;v.approx=r.reduced;v.dims=r.dims;v.res=rangeRes(r.hists,r.total,histSlotKeys(),r.shownMask,segmentState,histP?.region?.segs)}return v};
 const labelHist=createVrLabelHistogram({yieldFn:()=>histYield(),budget:()=>histBudget()});
 const hist=createVrHistogramPanel(THREE,{getView:getHistView,getProgress:()=>labelHist.progress,colorOf:histColorOf,nameOf:histNameOf,log:getHistogramLog,widthM:HIST_WIDTH,
  L:{title:L.histTitle,approx:L.histApprox,busy:L.histBusy,empty:L.histEmpty,xAxis:L.histX,yAxis:L.histY,yAxisLog:L.histYLog,auto:L.histAuto}});
 scene.add(hist.group);
 const unsubLabelHist=labelHist.onChange(()=>hist.invalidate());
 // the pass input: the prepared VR data and the path the shader takes for it NOW (read from the live uniforms, so the counting follows
 // the data setting 256 / 512 and 詳細 cls / 編集): classification (useCls: P.cls on P.half || P.vd) or HU (the grid in use = texDims, the ranges
 // segA, the processing mask editMask / editMaskOnly on P.edit with the edit texture's filter). histSig = what the pass depends on:
 // [shown mask, useCls, grid is P.half, editMask, editMaskOnly, edit filter linear, (HU path) min / max of the 4 slots]; compared every frame
 // while the board is open, with P, without allocating; a new pass when anything changed
 let histP=null,histFor=null; // histP: the session's prepared data (set once it is ready)
 const histSig=new Float64Array(14).fill(NaN),histSigNow=new Float64Array(14);
 const histSigInto=(P,u,o)=>{const cls=u.useCls.value>0&&!!P.cls,td=u.texDims.value,h=P.half;
  o[0]=(u.segA.value[0].w>0.5?1:0)|(u.segA.value[1].w>0.5?2:0)|(u.segA.value[2].w>0.5?4:0)|(u.segA.value[3].w>0.5?8:0); // = shownMask() as the shader sees it (segA.w), no allocation
  o[1]=cls?1:0;o[2]=cls?(h?1:0):(h&&td.x===h.dims[0]&&td.y===h.dims[1]&&td.z===h.dims[2]?1:0);
  o[3]=cls?0:u.editMask.value|0;o[4]=cls?0:u.editMaskOnly.value|0;o[5]=cls?0:(settings.editDiag|0)===1?0:1;
  for(let i=0;i<4;i++){const a=u.segA.value[i];o[6+2*i]=cls?0:a.x;o[7+2*i]=cls?0:a.y}};
 const histInput=()=>{const P=histP,s=histSig,g=s[2]>0?P.half:P.vd,v=gpuVolumeTarget(),mask=s[0];
  return{key:P.key+'|'+s.join(','),grid:g,shownMask:mask,volDims:v?[v.columns,v.rows,v.slices]:g.dims,
   region:P.region?.data?{data:P.region.data,dims:P.region.dims,segs:P.region.segs}:null,cls:s[1]>0?P.cls:null,
   hu:s[1]>0?null:{ranges:Array.from(s.subarray(6,14)),maskOnly:s[4],em:s[3],edit:P.edit?.data?{data:P.edit.data,dims:P.edit.dims,linear:s[5]>0}:null}}};
 const histRun=()=>{const P=histP;if(!P||!hist.isOpen||!material)return;histSigInto(P,material.uniforms,histSigNow);
  if(P===histFor){let same=true;for(let i=0;i<14;i++)if(histSigNow[i]!==histSig[i]){same=false;break}if(same)return}
  histFor=P;histSig.set(histSigNow);labelHist.run(histInput())};
 const histForce=()=>{histFor=null;histRun()}; // the self-check: the same pass again
 const histTarget=new THREE.Vector3();let histPlaced=false,histHeld=null;
 const computeHistTarget=()=>{histTarget.copy(head).addScaledVector(headFwd,HIST_OFFSET.fwd).addScaledVector(headLeft,HIST_OFFSET.left);histTarget.y-=HIST_OFFSET.down};
 const placeHistNow=()=>{if(histHeld){scene.attach(hist.group);histHeld=null}readHead();computeHistTarget();hist.group.position.copy(histTarget);hist.group.lookAt(head);histPlaced=true};
 const histRes=[];
 let histAxis=null;const histLocal=new THREE.Vector3(),histQ=new THREE.Quaternion(),histN=new THREE.Vector3(),histO=new THREE.Vector3(),histPlane=new THREE.Plane();
 const histTargetOf=hit=>{histLocal.copy(hit.point);hist.board.worldToLocal(histLocal);return hist.axisTargetAt(histLocal.x,histLocal.y)};
 // while dragging, that hand's laser ends on the board's plane and hovers nothing behind it (3D, points, menu, rings): the controller
 // loop uses histAxisBd (reused) for that hand instead of its board hits, as the old histDragOut did
 const histAxisOut={distance:0.6},histAxisBd={menu:null,help:null,hist:histAxisOut,wheel:null,pwheel:null,undoBtn:null,hu:null,ev:null};
 const histAxisFollow=()=>{const c=histAxis;if(!c)return;setRay(c);hist.board.getWorldQuaternion(histQ);hist.board.getWorldPosition(histO);histN.set(0,0,1).applyQuaternion(histQ);histPlane.setFromNormalAndCoplanarPoint(histN,histO);
  if(raycaster.ray.intersectPlane(histPlane,histLocal)){histAxisOut.distance=raycaster.ray.origin.distanceTo(histLocal);hist.board.worldToLocal(histLocal);hist.moveAxisDrag(histLocal.x)}};
 const histAxisEnd=commit=>{if(!histAxis)return;histAxis=null;if(!commit){hist.cancelAxisDrag();return}const w=hist.endAxisDrag();if(w)setHistogramRange({mode:'manual',lo:w[0],hi:w[1]})};
 const histHit=c=>{if(!hist.isOpen||hist.group.parent===holdOf(c))return null;setRay(c);histRes.length=0;return raycaster.intersectObject(hist.board,false,histRes)[0]||null}; // the laser stops on the board (it has no widgets)
 const unsubHist=onHistogramChange(()=>hist.invalidate()); // the PC display range / scale
 // the pass works at most ~2 ms at a time and then waits for the next XR frame (histYield, resolved in the frame loop; window rAF and idle
 // callbacks do not run during an XR session). The 100 ms timer keeps it going if XR frames stop (headset off).
 // the pass may work longer in a frame with headroom: HIST_HEAD of the frame period minus this frame's own JS + render submit time (the
 // pass runs right after the frame callback, before the frame is handed over), never under 2 ms nor over 4 ms. histCbMs / histPerMs are set at the end of every frame.
 // The counting itself runs in a worker (vr-label-histogram.js); the frame only copies one slice per message.
 let histCbMs=8,histPerMs=1000/72;const HIST_HEAD=0.55;
 const histBudget=()=>Math.max(2,Math.min(4,HIST_HEAD*histPerMs-histCbMs));
 const histWaiters=[];const histYield=()=>new Promise(r=>{histWaiters.push(r);setTimeout(r,100)});
 const releaseHistWaiters=()=>{if(!histWaiters.length)return;for(let i=0;i<histWaiters.length;i++)histWaiters[i]();histWaiters.length=0};
 const setHistOpen=on=>{if(on===hist.isOpen)return;if(!on)histAxisEnd(false);hist.setOpen(on);if(on){histRun();if(poseAt)placeHistNow();else histPlaced=false}else{if(histHeld){scene.attach(hist.group);histHeld=null}if(labelHist.busy){labelHist.cancel();histFor=null}releaseHistWaiters()}};
 // ring menus (vr-ring.js): the quick ring around the hand (A/X short) and the point ring (long press on a point)
 const wheel=createRingMenu(THREE),pointWheel=createRingMenu(THREE);scene.add(wheel.mesh);scene.add(pointWheel.mesh);
 // 実寸 (real size). scaleTag: 「×N（実寸比）」 under the volume's lowest bounding-box corner; the 実寸 button (表示 tab) sets 1x.
 // Scale limits: 1x .. 0.30 m longest side (vr-real-scale.js); data over 30 cm is fitted to 0.30 m and locked (no pinch scale), the tag still shows the true ratio
 const scaleTag=createScaleTag(THREE);scene.add(scaleTag.mesh);
 // the floating 「元に戻す」 board shown for FLING_UNDO_MS after a section was deleted (laser-clickable; hidden until then)
 const undoBtn=createUndoButton(THREE);scene.add(undoBtn.mesh);
 // the board that says 「読み込み中」 while the data is switched (the volume is hidden then): the data, the step, the time. Redrawn at most twice a second.
 let loadInfo=null,loadDrawn=0;
 const loadBoard=makeMenu(820,300,0.46,HELP_RES);loadBoard.mesh.visible=false;scene.add(loadBoard.mesh);
 loadBoard.onDraw(()=>{
  const li=loadInfo,w=[];if(!li)return w;
  const st=L.sw.stages[li.stage]||'',idx=Math.max(0,SWAP_STAGES.indexOf(li.stage)),f=Math.min(1,(idx+(li.sub||0))/SWAP_STAGES.length),secs=Math.round((performance.now()-li.t0)/1000);
  w.push({type:'label',x:36,y:62,text:li.error?L.sw.failed:L.sw.title,bold:true,size:40,color:li.error?'#ff8a80':'#fff'});
  w.push({type:'label',x:36,y:128,text:li.name,size:34,color:'#ffd27a'});
  w.push({type:'label',x:36,y:186,text:li.error?li.error:st+(li.text?' · '+li.text:''),size:28});
  w.push({type:'draw',draw:ctx=>{ctx.fillStyle='#26313b';ctx.beginPath();ctx.roundRect(36,212,748,18,9);ctx.fill();if(!li.error){ctx.fillStyle='#2d6cdf';ctx.beginPath();ctx.roundRect(36,212,Math.max(18,748*f),18,9);ctx.fill()}}});
  w.push({type:'label',x:36,y:272,text:li.error?L.sw.retry:L.sw.note.replace('{s}',secs),size:24,color:'#9fb3c3'});
  return w;
 });
 const placeLoadNow=()=>withFront(()=>{readHead();loadBoard.mesh.position.copy(head).addScaledVector(headFwd,VOLUME_FWD-0.05);loadBoard.mesh.position.y=head.y-0.05;loadBoard.mesh.lookAt(head)}); // in front of where the session was facing, not where the head looks now (the visitor may turn while it loads)
 // the level / data buttons: the first press arms the button (RESET_ARM_MS), the second one switches; the sections, points and labels of the data in view are not kept
 // where a switch spent its time and which caches helped, as one line (the 詳細 tab): the stage times (the stage log holds the START of each stage), the page's own caches, the VR data cache
 const stagesLine=(log,ls,pi,ja)=>{const st=[];for(let i=0;i<log.length-1;i++){const [n,t]=log[i];if(n.includes(':')||n==='bind'||n==='refine')continue;let e=log.slice(i+1).find(x=>!x[0].includes(':'));if(e)st.push(n+' '+((e[1]-t)/1000).toFixed(1))}
  const c=[];if(ls&&ls.sampleFiles!=null)c.push((ja?'練習DICOM':'DICOM')+' '+(ls.sampleCached|0)+'/'+ls.sampleFiles);if(ls&&ls.ensures&&ls.ensures.length){const en=ls.ensures,fh=en.filter(e=>e.filtered&&e.hit).length,fm=en.filter(e=>e.filtered&&!e.hit).length,pl=en.length-fh-fm;c.push((ja?'3D体積 フィルター済 ':'3D volume filtered ')+fh+(ja?' 再利用 / ':' hit / ')+fm+(ja?' 計算, 未フィルター ':' miss, unfiltered ')+pl)}if(ls&&(ls.runsHit||ls.runsMiss||ls.runsUncached))c.push((ja?'領域':'runs')+' '+(ls.runsHit|0)+(ja?'再利用/':' hit / ')+(ls.runsMiss|0)+(ja?'計算/':' miss / ')+(ls.runsUncached|0)+(ja?'対象外':' n/a'));
  return(st.length?(ja?' · 段階(秒) ':' · stages (s) ')+st.join(' '):'')+(c.length?(ja?' · キャッシュ ':' · caches ')+c.join(', '):'')};
 const levelNameOf=id=>{const l=levelForSample(id);return l?'Lv'+l.lv+' '+tr(l.nameKey):String(id)};
 const practiceOpen=()=>!!globalThis.__vrlOpenSample; // a practice dataset is open (the visitor's own DICOM is not: switching would discard its unsaved work with two presses)
 const swapArmedId=()=>{const a=ui.swapArm;return a&&performance.now()<a.until?a.id:null};
 const swapPress=setId=>{
  if(ui.swapBusy||!setId)return;
  if(setId===globalThis.__vrlOpenSample&&!(ui.swapFailed||!P||!mesh))return; // the data in view: nothing to do; but after a failed switch (nothing bound) the same level can be tried again
  const r=resetPress(swapArmedId()===setId?ui.swapArm.until:0,performance.now());
  if(r.fire){ui.swapArm=null;void swapData(setId)}else{ui.swapArm={id:setId,until:r.armedUntil};setTimeout(()=>{if(running)menu.refresh()},RESET_ARM_MS+80)}
  menu.refresh();
 };
 let flingDbg=null; // debug mode only: the measured values of the last section release (vr-fling-debug.js), made at the first release in debug mode; nothing otherwise
 const realLongMm=()=>activeSeries?longestMm(physicalExtentsMm({columns:activeSeries.columns,rows:activeSeries.rows,slices:activeSeries.slices.length},[activeSeries.spacingX,activeSeries.spacingY,activeSeries.spacingZ])):0;
 const setRealSize=()=>{const s=realHolderScale(realLongMm());if(!s)return;holder.scale.setScalar(s);if(twoHand){twoHand.s0=s;twoHand.d0=Math.max(handDist(),1e-3)}};
 let wheelOwner=null,pw=null; // pw = {c,id,mode}: mode 'main' (move / delete / colour / distance) or 'color' (the palette ring)
 // EVERY hand's laser stops on the whole dark disc of an open ring (items and blank space alike); slot = the item under the ray or null (blank).
 // Nothing behind the disc is hit while the ray is inside it (menu / help / points / planes / volume).
 const ringHit=(c,ring)=>{if(!ring.mesh.visible)return null;setRay(c);const x=raycaster.intersectObject(ring.mesh,false)[0];if(!x||!x.uv)return null;const k=ring.slotFromUv(x.uv);return k===null&&!ring.inDisk(x.uv)?null:{distance:x.distance,slot:k}};
 // the nearest of the menu, the help board and the ring items along the ray wins; {menu,help,wheel,pwheel}
 const bhOut={menu:null,help:null,hist:null,wheel:null,pwheel:null,undoBtn:null,hu:null,ev:null}; // reused (read at once by the caller, never kept)
 const boardHits=c=>{
  const o=bhOut;o.menu=menuHit(c);o.help=helpHit(c);o.hist=histHit(c);o.wheel=ringHit(c,wheel);o.pwheel=ringHit(c,pointWheel);o.undoBtn=undoBtn.mesh.visible?(setRay(c),undoBtn.hit(raycaster)):null; // drawn without a depth test, like the rings: not hidden by tissue
  o.hu=huPanelHit(c); // the HU line's live panel (no depth test either)
  o.ev=ev?evHit(c):null; // the mission board (depth tested like the help board)
  o.wrist=handIn.wristHit(c,raycaster,setRay); // the wrist menu (a hand's ray only; null for a controller)
  // the boards are depth tested, so tissue in front of a board hides it: a board the volume surface covers along the ray is not hit (no invisible buttons, the laser goes on to the tissue).
  // The rings are drawn without a depth test and stay hit. (the surface hit is marched only when a board is under the ray)
  if(o.menu||o.help||o.hist||o.ev){const tv=volumeHit(c)?.distance;if(!boardVisible(o.menu,tv))o.menu=null;if(!boardVisible(o.help,tv))o.help=null;if(!boardVisible(o.hist,tv))o.hist=null;if(!boardVisible(o.ev,tv))o.ev=null}
  let bd=Infinity,bk=null;for(const k of ['menu','help','hist','wheel','pwheel','undoBtn','hu','ev']){const x=o[k];if(x&&x.distance<bd){bd=x.distance;bk=k}}
  for(const k of ['menu','help','hist','wheel','pwheel','undoBtn','hu','ev'])if(k!==bk)o[k]=null;
  if(o.wrist){if(bk&&bd<o.wrist.distance)o.wrist=null;else if(bk)o[bk]=null} // the wrist menu takes part in the nearest-board choice
  return o};
 const HELP_LINE_PITCH=66; // 7 lines (the 断面 board too) on the 560 px board: the last one at 140 + 6 x 66 = 536
 help.onDraw(()=>{
  // two tabs under the page, 手順一覧 (this board's normal help text) | 詳細 (the step slides: the live tutorial while the switch is on, a READ-ONLY preview while it is off). On: starts on 詳細; off: on 手順一覧
  const tabs=tutBad?[]:panelTabs(helpShow,{act:id=>{if(id!==helpShow){helpShow=id;help.refresh()}}});
  if(helpShow==='detail'&&!tutBad){
   try{
    if(tutVr)return [...tutVr.widgets({W:820,H:PAGE_H}),...tabs]; // an exception = the normal help text
    tutPreview||=createSlideViewer({lang:ja?'ja':'en',onChange:()=>help.refresh()}); // the read-only operation guide (the deck's slides); made on the first press of 詳細 only (off: no cost before)
    return [...tutPreview.widgets({W:820,H:PAGE_H}),...tabs];
   }catch(e){tutFail(e)}
  }
  const hx=handIn.anyHand()?handIn.texts:null,w=[],lines=hx?(section.on?hx.helpSec:hx.helpBasic).slice():section.on?L.helpSec.slice():L.helpBasic.slice(); // hands: pinch / wrist menu lines
  if(ui.open)lines[lines.length-1]=hx?(ui.tab===10?hx.helpMenuSimple:hx.helpMenu):L.helpMenu; // 体験会モード: the かんたん menu (tab 10): buttons and the slice-opacity slider
  w.push({type:'label',x:36,y:60,text:L.helpT,bold:true,size:36,color:'#fff'});
  lines.forEach((t,i)=>w.push({type:'label',x:36,y:140+i*HELP_LINE_PITCH,text:'・'+t,size:30}));
  w.push(...tabs);
  return w;
 });
 // the XR camera sits at the origin (floor height) until the first
 // viewer pose arrives; the data is ready before that, so the
 // volume and menu were placed on the floor. Both now wait for a pose in the
 // loop; 詳細 shows the frame numbers and head height for a device check
 const poseOk=()=>{try{const f=renderer.xr.getFrame(),rs=renderer.xr.getReferenceSpace();return !!(f&&rs&&f.getViewerPose(rs))}catch{return false}};
 let frameNo=0,poseAt=0,placePending=false,swapPlace=false;ui.placeLine='';
 // menu grab: grip while pointing at the menu moves it with the hand; released, it stays there (position becomes fixed)
 let menuHeld=null;
 const setMenuOpen=open=>{if(open)emit('menu-open');else emit('menu-close');ui.open=open;menu.mesh.visible=open;if(open){placeMenuNow();ui.probeOnOpen=true}menu.refresh()}; // the 詳細 numbers are measured on the next frame after opening (not measured while closed)
 const bringVolumeFront=()=>{readHead();scene.attach(holder);grabbing.clear();twoHand=null;grabN=0;grab1=null;const tut=!!tutVr&&!tutBad; // while the tutorial runs the volume is within reach and large enough to grab (vr-real-scale.js tutorialHolderScale); every other start is as before
  holder.position.copy(head).addScaledVector(headFwd,tut?TUT_VOLUME_FWD:VOLUME_FWD).add(new THREE.Vector3(0,-(tut?TUT_VOLUME_DOWN:VOLUME_DOWN),0));holder.quaternion.identity();holder.scale.setScalar(tut?tutorialHolderScale(realLongMm()):globalThis.__vrlOpenSample===TUT_SAMPLE?lv0HolderScale(realLongMm(),baseScale):startHolderScale(realLongMm(),baseScale))}; // Lv0 (sample4) starts at x4, every other data at x1 //: starts at 1x (real size); oversize: fitted to 0.30 m; unknown size: the old default fit
 // everything that is placed for a new data (the volume, the menu, the help / mission / HU / histogram boards) goes to its default place counted from the FRONT of the session (markFront: the head's direction when the session placed the data, or when 正面に戻す was last pressed), the head's position as it is now; whatever the user had moved goes back
 const placeAllFront=()=>withFront(()=>{bringVolumeFront();placeMenuNow();placeHelpNow();if(hist.isOpen)placeHistNow();placeHuNow()});
 // grab: one hand moves/rotates (holder follows the controller); two hands
 // scale by the change in hand distance
 const grabbing=new Set();let twoHand=null,grabN=0,grab1=null;const grabP=new THREE.Vector3(),grabQ=new THREE.Quaternion();const tmpA=new THREE.Vector3(),tmpB=new THREE.Vector3();
 const handDist=()=>{holdOf(controllers[0]).getWorldPosition(tmpA);holdOf(controllers[1]).getWorldPosition(tmpB);return tmpA.distanceTo(tmpB)};
 const regrab=()=>{
  scene.attach(holder);if(twoHand&&scaleChanged(twoHand.sg,holder.scale.x))emit('scale');twoHand=null;
  // tutorial signals: 'grab' when a grip takes the volume, 'grab-move' when a one-hand hold ends having moved / turned it (tutorial-signal.js poseMoved)
  if(grab1&&poseMoved(grabP,grabQ,holder.position,holder.quaternion))emit('grab-move');grab1=null;
  if(grabbing.size>grabN)emit('grab');grabN=grabbing.size;
  if(grabbing.size===2)twoHand={d0:Math.max(handDist(),1e-3),s0:holder.scale.x,sg:holder.scale.x};
  else if(grabbing.size===1){grabP.copy(holder.position);grabQ.copy(holder.quaternion);grab1=true;holdOf([...grabbing][0]).attach(holder)}
 };
 const MAX_PLANES=MAX_SECTION_PLANES,LONG_PRESS=600; // 10 planes (4 before); PLANE_COLORS: vr-section-frame.js
 // thumbstick scroll: world m/s along the selected plane's normal at full deflection
 const SCROLL_SPEED=0.05;
 // selection: selected = the plane the thumbstick moves
 // sections are moved with the trigger (drag in holder space, c.userData.drag); the grip only moves the volume
 const section={on:false,selected:null},planes=[];
 const square=(h)=>new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0,-h,-h),new THREE.Vector3(0,h,-h),new THREE.Vector3(0,h,h),new THREE.Vector3(0,-h,h)]);
 // handle corner per plane index: (+y,+z), (+y,−z), (−y,−z), (−y,+z)
 const HANDLE_CORNERS=[[1,1],[1,-1],[-1,-1],[-1,1]],HANDLE=0.034;
 const makePlane=(color,cut)=>{
  const obj=new THREE.Group(),mat=new THREE.LineBasicMaterial({color,transparent:true,depthTest:false,depthWrite:false}),h=0.12; // the frame lies inside the volume, which now writes depth: no depth test, drawn after it (renderOrder 2).: depthTest is switched per frame (frameDepthTest: tested = hidden behind tissue under 「実際に隠す」, on top while lit / without GPU occlusion); depthWrite is never on (a thin frame must not clip the labels drawn after it)
  const frameLine=new THREE.LineLoop(square(h),mat);frameLine.renderOrder=2;obj.add(frameLine);
  // glow: a band over the frame in the colour of the hand that points at or holds it
  const go=h+0.0015,gi=h-0.0015,gs=new THREE.Shape([new THREE.Vector2(-go,-go),new THREE.Vector2(go,-go),new THREE.Vector2(go,go),new THREE.Vector2(-go,go)]);
  gs.holes.push(new THREE.Path([new THREE.Vector2(-gi,-gi),new THREE.Vector2(-gi,gi),new THREE.Vector2(gi,gi),new THREE.Vector2(gi,-gi)]));
  const glow=new THREE.Mesh(new THREE.ShapeGeometry(gs),new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:0.95,side:THREE.DoubleSide,depthTest:false,depthWrite:false,toneMapped:false}));glow.rotation.y=Math.PI/2;glow.renderOrder=3;glow.visible=false;obj.add(glow);
  // the inside of the frame is NOT drawn (no idle tint): the laser is hit-tested against it analytically (glassHit; it answers only where nothing else does) and it ends on the plane. While the laser is on it
  // (and nothing else), a very faint fill shows that the whole plane is grabbable; hidden otherwise.
  const glass=new THREE.Mesh(new THREE.PlaneGeometry(2*h,2*h),new THREE.MeshBasicMaterial({color,transparent:true,opacity:0.07,side:THREE.DoubleSide,depthTest:false,depthWrite:false,toneMapped:false}));glass.rotation.y=Math.PI/2;glass.renderOrder=1;glass.visible=false;obj.add(glass);
  // handle: small square outside a corner with the plane's number (menu 断面1..4), drawn by refreshHandles
  const canvas=document.createElement('canvas');canvas.width=96;canvas.height=96;const tex=new THREE.CanvasTexture(canvas);tex.colorSpace=THREE.SRGBColorSpace;
  const handle=new THREE.Mesh(new THREE.PlaneGeometry(HANDLE,HANDLE),new THREE.MeshBasicMaterial({map:tex,transparent:true,toneMapped:false,side:THREE.DoubleSide,depthTest:false,depthWrite:false}));
  handle.rotation.y=Math.PI/2;handle.renderOrder=3;handle.userData.ctx=canvas.getContext('2d');obj.add(handle);
  // one-side mode: side picks the kept half along local X; the
  // arrow points at the removed half.: shown only while the plane is lit / grabbed (the glow loop in the frame update), short (ARROW_LEN), own material (it fades; no depth test: it is on top whenever it is drawn)
  const aL=ARROW_LEN,amat=new THREE.LineBasicMaterial({color,transparent:true,opacity:0,depthTest:false,depthWrite:false});
  const arrow=new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0,0,0),new THREE.Vector3(aL,0,0),new THREE.Vector3(aL,0,0),new THREE.Vector3(0.72*aL,0.22*aL,0),new THREE.Vector3(aL,0,0),new THREE.Vector3(0.72*aL,-0.22*aL,0)]),amat);
  arrow.renderOrder=2;arrow.visible=false;obj.add(arrow);
  return{obj,mat,frameLine,arrow,amat,aOp:0,aFlash:0,glow,glass,handle,h,color,cut,side:1,hand:null};
 };
 const disposePlane=pl=>{pl.obj.removeFromParent();pl.obj.traverse(o=>{o.geometry?.dispose()});pl.mat.dispose();pl.amat.dispose();pl.glow.material.dispose();pl.glass.material.dispose();pl.handle.material.map.dispose();pl.handle.material.dispose()};
 // number + corner of every handle from the plane's index (after add / remove, not per frame)
 // under the number, the hand that holds or last held the plane (右 / 左)
 const drawHandle=(pl,i)=>{
  const hd=pl.handle,ctx=hd.userData.ctx,hand=pl.hand==='right'?L.handR:pl.hand==='left'?L.handL:'';
  ctx.clearRect(0,0,96,96);ctx.fillStyle='#'+pl.color.toString(16).padStart(6,'0');ctx.beginPath();ctx.roundRect(0,0,96,96,18);ctx.fill();
  ctx.fillStyle='#111';ctx.textAlign='center';ctx.textBaseline='middle';
  if(hand){ctx.font='bold '+(i>=9?46:54)+'px system-ui,sans-serif';ctx.fillText(String(i+1),48,32);ctx.fillStyle='#'+HAND_COLORS[pl.hand].toString(16).padStart(6,'0');ctx.beginPath();ctx.arc(48,74,20,0,Math.PI*2);ctx.fill();ctx.fillStyle='#fff';ctx.font='bold 28px system-ui,sans-serif';ctx.fillText(hand,48,76)}
  else{ctx.font='bold '+(i>=9?54:64)+'px system-ui,sans-serif';ctx.fillText(String(i+1),48,52)} // "10" in a smaller font
  hd.material.map.needsUpdate=true;
 };
 // the square may be larger (up to 1.5x) than the tag, so the tag has its own scale k (<= 1) inside the frame group: size HANDLE*k, offset from the corner (0.01+HANDLE/2)*k
 const placeHandle=(pl,hs)=>{const k=planeTagLocalScale(hs),o=pl.h+(0.01+HANDLE/2)*k,[sy,sz]=HANDLE_CORNERS[(pl.idx||0)%4];pl.handle.scale.setScalar(k);pl.handle.position.set(0,sy*o,sz*o)};
 const applyFrameScale=pl=>{const hs=holder.scale.x,fs=planeFrameLocalScale(hs);if(pl.obj.scale.x!==fs)pl.obj.scale.setScalar(fs);if(pl.tagHs!==hs){pl.tagHs=hs;placeHandle(pl,hs)}};
 const refreshHandles=()=>planes.forEach((pl,i)=>{
  pl.idx=i;drawHandle(pl,i);placeHandle(pl,holder.scale.x);pl.tagHs=holder.scale.x;
 });
 // side that removes the viewer's half right now (what 'near' shows)
 const chooseSide=pl=>{readHead();scene.updateMatrixWorld();pl.obj.getWorldPosition(tmpA);tmpB.set(1,0,0).transformDirection(pl.obj.matrixWorld);pl.side=tmpB.dot(tmpA.subVectors(head,tmpA))>0?-1:1};
 // grip never takes a section (it always moves the volume). A section is moved with the TRIGGER: press on its thin frame band or number tag,
 // on empty space (not on tissue), or press-and-move where the laser meets the selected section (a tap there records a point). The section follows
 // the hand rigidly (all 6 DoF, pivot = the hand; vr-point.js sectionFollowStep) with no clamping; it stays a child of the volume (holder).
 // On release the section centre is brought back inside the volume box (snapPlaneCenterIntoBox: the cut itself stays whenever the plane still meets the box).
 const snapSection=pl=>{
  if(!pl||!vrHalfExt)return;
  const n=qRot({x:pl.obj.quaternion.x,y:pl.obj.quaternion.y,z:pl.obj.quaternion.z,w:pl.obj.quaternion.w},{x:1,y:0,z:0}),k=snapPlaneCenterIntoBox(pl.obj.position,n,vrHalfExt);
  pl.obj.position.set(k.x,k.y,k.z);
 };
 const endDrag=c=>{const dg=c.userData.drag;if(!dg)return;c.userData.drag=null;snapSection(dg.pl);menu.refresh()};
 const endAllDrags=()=>{controllers.forEach(c=>{const dg=c.userData.drag;c.userData.drag=null;if(dg)snapSection(dg.pl);const pr=c.userData.press;if(pr&&pr.dragPl)pr.dragPl=null});menu.refresh()}; // presses for record / label / point / move go on
 const draggedBy=(pl,except)=>controllers.some(x=>x!==except&&x.userData.drag?.pl===pl);
 // thin frame band of a plane (vr-point.js squareBandContains): {t (world m), pl, y, z} or null. b = 6 mm, or 0.8 degrees at a distance
 const tmpBo=new THREE.Vector3(),tmpBq=new THREE.Vector3(),tmpBs=new THREE.Vector3();
 const frameBandHit=(c,pl)=>{
  setRay(c);pl.obj.updateWorldMatrix(true,false);
  const o=tmpBo.copy(raycaster.ray.origin),q=tmpBq.copy(o).add(raycaster.ray.direction);pl.obj.worldToLocal(o);pl.obj.worldToLocal(q);q.sub(o);
  const r=rayLocalPlaneX(o,q);if(!r)return null;
  const ws=pl.obj.getWorldScale(tmpBs).x||1,b=Math.max(0.006,r.t*Math.tan(0.8*Math.PI/180))/ws;
  return squareBandContains(r.y,r.z,pl.h,b)?{t:r.t,pl,y:r.y,z:r.z}:null;
 };
  // the empty inside of a frame (invisible 'glass'): the nearest visible plane whose square the laser passes through: {t,pl,y,z,glass:true} or null. Only used when nothing else answers (resolveTriggerTarget).
 const glassHit=(c,list)=>{
  let best=null;setRay(c);
  for(const pl of list){
   pl.obj.updateWorldMatrix(true,false);
   const o=tmpBo.copy(raycaster.ray.origin),q=tmpBq.copy(o).add(raycaster.ray.direction);pl.obj.worldToLocal(o);pl.obj.worldToLocal(q);q.sub(o);
   const r=rayLocalPlaneX(o,q);if(r&&squareContains(r.y,r.z,pl.h)&&(!best||r.t<best.t))best={t:r.t,pl,y:r.y,z:r.z,glass:true};
  }
  return best;
 };
 // number tag (the handle square) the laser hits: {t,pl} or null
 const tabList=[];
 const tabHit=(c,list)=>{if(!list.length)return null;setRay(c);tabList.length=0;for(const p of list)tabList.push(p.handle);const x=raycaster.intersectObjects(tabList,false)[0];if(!x)return null;const pl=list.find(p=>p.handle===x.object);return pl?{t:x.distance,pl}:null};
 // the hand's pose in holder space (= the volume's object space): position and orientation, plain {x,y,z,w} for vr-point.js
 const tmpHq=new THREE.Quaternion(),tmpCq=new THREE.Quaternion(),tmpCp=new THREE.Vector3();
 const handInHolder=c=>{
  holder.updateWorldMatrix(true,false);c.getWorldPosition(tmpCp);holder.worldToLocal(tmpCp);
  holder.getWorldQuaternion(tmpHq).invert();c.getWorldQuaternion(tmpCq);tmpHq.multiply(tmpCq);
  return{p:{x:tmpCp.x,y:tmpCp.y,z:tmpCp.z},q:{x:tmpHq.x,y:tmpHq.y,z:tmpHq.z,w:tmpHq.w}};
 };
 // the same for a hand's palm anchor (a fist holds the section with the palm, not with the pinch ray)
 const anchorInHolder=c=>{
  const a=holdOf(c);holder.updateWorldMatrix(true,false);a.getWorldPosition(tmpCp);holder.worldToLocal(tmpCp);
  holder.getWorldQuaternion(tmpHq).invert();a.getWorldQuaternion(tmpCq);tmpHq.multiply(tmpCq);
  return{p:{x:tmpCp.x,y:tmpCp.y,z:tmpCp.z},q:{x:tmpHq.x,y:tmpHq.y,z:tmpHq.z,w:tmpHq.w}};
 };
 // a hand's wrist orientation in holder space (its palm anchor: the wrist joint's orientation, lightly filtered) for the section turn of a pinch drag; null for a
 // controller or a hand whose wrist was never tracked. Why: a hand's pinch drag took the section's turn from the group = the system's target ray in 標準, which Quest aims from
 // the shoulder and which does not roll with the wrist, so twisting the hand did not turn the section (指差し carried the wrist's turn on its ray; a fist uses the anchor).
 const wristQ=c=>isHand(c.userData.source)&&holdOf(c)!==c?anchorInHolder(c).q:null;
 // press handling per frame: long press, and the section drag in holder space (vr-point.js sectionFollowStart / sectionFollowStep)
 const tmpHs=new THREE.Vector3();
 const startDrag=(c,pr,hp)=>{
  const pl=pr.dragPl;
  if(!pl||!vrHalfExt||!planes.includes(pl)||draggedBy(pl,c)){pr.dragPl=null;return}
  const o=pl.obj,Qp0={x:o.quaternion.x,y:o.quaternion.y,z:o.quaternion.z,w:o.quaternion.w},c0={x:o.position.x,y:o.position.y,z:o.position.z};
  const hand=c.userData.source?.handedness||null;if(hand!==pl.hand){pl.hand=hand;drawHandle(pl,planes.indexOf(pl))}
  if(section.selected!==pl){section.selected=pl;pulse(c,HAPTIC.select.amp,HAPTIC.select.ms)}
  const fl=sectionFollowStart({p0:hp.p,q0:hp.q,c0,Qp0});
  c.userData.drag={pl,rel:fl.rel,Qrel:fl.Qrel,wq0:wristQ(c),Q0:Qp0,volTouched:false}; // volTouched = a grip / two-hand gesture moved the volume during the drag (no throw then).: wq0 (hands): the wrist at the grab, Q0 the section's turn then
  emit('section-drag');pr.consumed=true; // a press that became a drag never records / selects on release
  menu.refresh();
 };
 const updatePress=(c,now)=>{
  const pr=c.userData.press;if(!pr)return;
  if(pr.tp.update(now)==='long'){
   // a long press on a point: the point ring (move / delete) around it, double pulse
   if(pr.res.kind==='point'){pr.consumed=true;openPointWheel(c,pr.res.ref.id);pulseTwice(c)}
   else if(pr.res.kind==='record'||pr.res.kind==='label')pr.consumed=true;
   else if(pr.res.kind==='mlabel'&&pr.res.ref?.pin){const ld=c.userData.lblDrag;if(ld&&!ld.moved)resetPin(c)} // a long press on a pinned card that was not moved puts it back at its default place
  }
  // while the volume is being held by this hand or by two hands (it moves / scales), the section is not moved: the reference is taken again each frame
  const volMoves=!!twoHand||grabbing.has(c);
  if(volMoves&&!c.userData.drag&&pr.dragPl){const hp=handInHolder(c);pr.p0=hp.p;pr.q0=hp.q;if(pr.wq0)pr.wq0=wristQ(c)||pr.wq0}
  else if(!c.userData.drag&&pr.dragPl&&!(pr.dragRec&&pr.consumed)){
   // the higher threshold (DRAG_RECORD) where a tap would record a point; a long press there neither records nor drags
   const hp=handInHolder(c);holder.getWorldScale(tmpHs);
   const dp=Math.hypot(hp.p.x-pr.p0.x,hp.p.y-pr.p0.y,hp.p.z-pr.p0.z)*tmpHs.x;
   const th=isHand(c.userData.source)?handIn.dragTh(c,pr):(pr.dragRec?DRAG_RECORD:undefined); // a hand: 2 cm / 5 deg (3 cm / 7 deg on a record point), only after the delayed ray passed the pinch
   const da=qAngleDeg(qMul(hp.q,qInv(pr.q0))),wq=pr.wq0?wristQ(c):null,dw=wq?qAngleDeg(qMul(wq,qInv(pr.wq0))):0; // a hand: the wrist's turn counts too (a pure twist barely turns the system's ray)
   if(th!==null&&dragShouldStart({dPosM:dp,dAngleDeg:dw>da?dw:da,heldMs:now-pr.t0},th))startDrag(c,pr,hp);
  }
  const dg=c.userData.drag;
  if(dg&&vrHalfExt&&volMoves){const hp=handInHolder(c),o=dg.pl.obj,f=sectionFollowStart({p0:hp.p,q0:hp.q,c0:o.position,Qp0:o.quaternion});dg.rel=f.rel;dg.Qrel=f.Qrel;if(dg.wq0){dg.wq0=wristQ(c)||dg.wq0;dg.Q0={x:o.quaternion.x,y:o.quaternion.y,z:o.quaternion.z,w:o.quaternion.w}}}
  else if(dg&&vrHalfExt){
   const hp=handInHolder(c),r=sectionFollowStep({rel:dg.rel,Qrel:dg.Qrel,p:hp.p,q:hp.q});
   const wq=dg.wq0?wristQ(c):null,Qp=wq?sectionWristTurn({qw0:dg.wq0,qw:wq,Qp0:dg.Q0}):r.Qp; // a hand: the position from the ray, the turn from the wrist since the grab; a controller: as before
   dg.pl.obj.position.set(r.c.x,r.c.y,r.c.z);dg.pl.obj.quaternion.set(Qp.x,Qp.y,Qp.z,Qp.w);
  }
 };
 // the section an empty-space grab moves (chooseSectionForRay): the visible section whose square the laser passes through (nearest), else the section
 // whose centre is nearest to the laser; the selected one when there is none
 const tmpEo=new THREE.Vector3(),tmpEq=new THREE.Vector3(),tmpEs=new THREE.Vector3();
 const sectionForEmpty=(c,vis)=>{
  setRay(c);const cands=[];
  for(const pl of vis){
   pl.obj.updateWorldMatrix(true,false);
   const o=tmpEo.copy(raycaster.ray.origin),q=tmpEq.copy(o).add(raycaster.ray.direction);pl.obj.worldToLocal(o);pl.obj.worldToLocal(q);q.sub(o);
   const ws=pl.obj.getWorldScale(tmpEs).x||1,r=rayLocalPlaneX(o,q),ql=q.lengthSq()||1,tc=-(o.x*q.x+o.y*q.y+o.z*q.z)/ql; // tc: ray parameter nearest to the centre
   const dist=(tc>0?o.clone().addScaledVector(q,tc).length():o.length())*ws;
   cands.push({id:pl,t:r&&Math.max(Math.abs(r.y),Math.abs(r.z))<=pl.h?r.t*ws:null,dist});
  }
  const pl=chooseSectionForRay(cands);return pl||(vis.includes(section.selected)?section.selected:vis[0]||null);
 };
 const tmpVo=new THREE.Vector3(),tmpVq=new THREE.Vector3();
 const diagAn={noRegion:false,noLabels:false};
 // VR position points (stage 3; vr-point.js): vrHalfExt / vrDims / vrFp are set when the data is ready (null before)
 let vrHalfExt=null,vrDims=null,vrFp=null,vrSpacing=null;const vpMarkers=createVrPointMarkers(THREE,scene),vpMeasure=createVrMeasure(THREE,scene),lblLit=new Set(); // lblLit: the distance labels lit this frame (laser on them / grabbed). vrSpacing: the series' voxel spacing [x,y,z] mm (the adopted one: z from the slice-spacing check), for the distances
 // surface mode (vrPointMode, kept while the page lives, default 表面). It is in force except while the 解析 tab is open (the trigger pins labels there)
 const surfaceActive=()=>vrPointMode==='surface'&&!(ui.open&&ui.tab===5),surfCursors=controllers.map(()=>createSurfaceCursor(THREE,scene)),tmpSc=new THREE.Vector3(),tmpSh=new THREE.Vector3(),tmpSs=new THREE.Vector3();
 // the cursor sits at the CENTRE of the voxel that will be recorded (sf.voxel), as a small dot
 const placeSurfCursor=(c,sf)=>{
  if(!mesh?.parent||!vrHalfExt||!vrDims){surfCursors[controllers.indexOf(c)].set(null);return}
  const l=voxelToLocal(sf.voxel,vrHalfExt,vrDims),vs=voxelSize(vrHalfExt,vrDims);mesh.localToWorld(tmpSc.set(l.x,l.y,l.z));mesh.getWorldScale(tmpSs);
  renderer.xr.getCamera().getWorldPosition(tmpSh);
  surfCursors[controllers.indexOf(c)].set(tmpSc,tmpSh,Math.min(vs[0]*tmpSs.x,vs[1]*tmpSs.y,vs[2]*tmpSs.z));
 };
 // the cursor of 断面 mode is the same small dot (surfCursors), at the recorded voxel's centre projected onto the selected section
 const tmpPn=new THREE.Vector3();
 const placeSecCursor=(c,sh)=>{
  const cur=surfCursors[controllers.indexOf(c)],pl=section.selected;
  if(!pl||!mesh?.parent||!vrHalfExt||!vrDims){cur.set(null);return}
  const l=voxelToLocal(sh.voxel,vrHalfExt,vrDims),vs=voxelSize(vrHalfExt,vrDims);mesh.localToWorld(tmpSc.set(l.x,l.y,l.z));mesh.getWorldScale(tmpSs);
  pl.obj.getWorldPosition(tmpSh);tmpPn.set(1,0,0).transformDirection(pl.obj.matrixWorld);tmpSc.addScaledVector(tmpPn,-tmpPn.dot(tmpSh.negate().add(tmpSc)));
  renderer.xr.getCamera().getWorldPosition(tmpSh);
  cur.set(tmpSc,tmpSh,Math.min(vs[0]*tmpSs.x,vs[1]*tmpSs.y,vs[2]*tmpSs.z));
 };
 // where this controller's laser meets the SELECTED section: {distance (world m), voxel, plane} or null;
 // the section planes are the shader's uniforms (volume object space, all sections shown; cutBits: the clipping ones)
 const sectionPointOf=c=>{
  if(!section.on||bench.noSection||!section.selected||!material||!mesh?.parent||!vrHalfExt||!vrDims)return null;
  const u=material.uniforms,n=u.planeCount.value,idx=planes.indexOf(section.selected);if(!n||idx<0||idx>=n)return null;
  setRay(c);const o=tmpVo.copy(raycaster.ray.origin),q=tmpVq.copy(o).add(raycaster.ray.direction);mesh.worldToLocal(o);mesh.worldToLocal(q);q.sub(o);
  // only the selected plane is a candidate (only: its number); the other planes still cut parts away
  const r=sectionRayHit(o,q,{halfExt:vrHalfExt,dims:vrDims,planes:u.cutPlanes.value,count:n,cutBits:u.planeCut.value,only:idx});
  return r?{t:r.t,distance:r.t,voxel:r.voxel,plane:r.plane,point:r.point}:null;
 };
 // record the place a laser points at on a section (断面) or on the first tissue surface (表面) as "VR ポイント N" (a position comment). own: that hand's trigger (its own laser; the caller has
 // already checked the priority and the thumbstick gate); null: the menu button, any controller whose laser is on a section (the pressing one
 // points at the menu). Nothing is recorded in 断面 without a section, or when no laser meets a section (表面: tissue surface) inside the volume (never a clamped or guessed place).
 const FRAME_HIDE_MS=300,framesHidden=()=>controllers.some(x=>x.userData.hideFrames&&(!!x.userData.source?.gamepad||isHand(x.userData.source))); // a held thumbstick click (a hand: the empty-space pinch held on the left hand) hides the section frames (see the controller loop)
 const toggleSliceClear=c=>{ui.sliceClear=!ui.sliceClear;pulse(c,0.4,40);sliceToast.set(L.sliceT+(ui.sliceClear?L.sliceClear:Math.round(settings.sliceOpacity*100)+'%'));sliceToast.until=performance.now()+SLICE_TOAST_MS;if(sliceToast.mesh.parent!==c)c.add(sliceToast.mesh);sliceToast.mesh.visible=true;menu.refresh();emit('slice-toggle');if(ui.sliceClear)emit('slice-clear')}; // slice-toggle = every switch (tutorial ステップ5)
 // the empty-space pinch of a hand (hands only; vr-hand.js EMPTY_PINCH). "Empty" = the laser hits nothing interactive (resolveTriggerTarget: 'empty' / 'none': no point, label,
 // frame, tissue, board, ring or wrist menu). RIGHT hand = the B/Y button (c.userData.vB is read by the B/Y code of the controller loop: short = sections shown / hidden, long = add one, the same
 // functions and progress ring); LEFT hand held FRAME_HIDE_MS = the thumbstick click's hold (the frames hidden while held; its short click, the slice transparent, is the double pinch below).
 // Dropped (nothing fires on release) when the hand travels more than 5 cm, the laser reaches a target, a drag / grab starts, or the wrist menu appears. Never with the palm turned to the face
 // (the system menu / home gesture), during a grab / drag, while the wrist menu is shown or a distance is being made.
 const onSectionRes=r=>r.kind==='section'||(r.kind==='record'&&!!r.ref?.plane); // the laser is on a section: its frame / tag / empty inside, or its plane (a point would be recorded there)
 const empP=new THREE.Vector3(),empQ=new THREE.Vector3(),isEmptyKind=k=>k==='empty'||k==='none';
 const empStart=(c,res,now)=>{
  if(!isEmptyKind(res.kind)||getMeasureStart()||handIn.palmToFace(c)||handIn.wristShown||handIn.grabbing(c)||c.userData.drag||c.userData.lblDrag||histAxis===c||dragging?.c===c)return;
  const hd=c.userData.source?.handedness;if(hd!=='right'&&hd!=='left')return;
  holdOf(c).getWorldPosition(empP);const e=c.userData.emp||={t0:0,x:0,y:0,z:0,right:false,hid:false};
  e.t0=now;e.x=empP.x;e.y=empP.y;e.z=empP.z;e.right=hd==='right';e.hid=false;c.userData.emp=e;c.userData.empOn=true;
  if(e.right){c.userData.vB=true;c.userData.vCancel=false}
 };
 const empStop=(c,cancel)=>{
  if(!c.userData.empOn)return;c.userData.empOn=false;const e=c.userData.emp;
  if(e.right){c.userData.vB=false;if(cancel)c.userData.vCancel=true} // B/Y: a cancelled press must not fire its short action on the release
  else if(e.hid){c.userData.hideFrames=false;pulse(c,0.2,25)}
 };
 const empFrame=(c,now)=>{
  if(!c.userData.empOn)return;const e=c.userData.emp,rk=c.userData.res?.kind;
  if(!c.userData.press||c.userData.drag||c.userData.lblDrag||!isEmptyKind(rk)||handIn.grabbing(c)||handIn.wristShown){empStop(c,true);return}
  holdOf(c).getWorldPosition(empP);empQ.set(empP.x-e.x,empP.y-e.y,empP.z-e.z);if(empQ.length()>EMPTY_PINCH.moveM){empStop(c,true);return}
  if(!e.right&&!e.hid&&now-e.t0>=FRAME_HIDE_MS){e.hid=true;c.userData.hideFrames=true;emit('frame-hide');pulse(c,0.3,25)}
 };
 const flashMsg=(t,ms=2500)=>{ui.flash=t;ui.flashUntil=performance.now()+ms;menu.refresh()};
 const pulseTwice=c=>{pulse(c,0.35,18);setTimeout(()=>pulse(c,0.35,18),90)};
 // selected point (a comment id, or null) and the last deletion (for the undo), both only for this VR session
 let vpSel=null;const undo=createUndoStack(),undoStore={removeComment,restoreComment,updateCommentPosition,updateCommentColor,removeMeasurement,restoreMeasurements};
 // records the place that was under the laser at the moment of the press (hit: {voxel}); a failure is silent (no vibration)
 // a point is recorded on a section only where the section shows tissue (a shown segment at that voxel: the Surface mode's tissue test at the section hit); on air / empty nothing is recorded.
 // Only the recording asks: selecting a point, dragging a frame, the double pinch and the HU line (its own pick / start) work anywhere on the section as before. A surface hit (no .plane) is tissue by definition.
 const sectionTissue=hit=>{const vp=volPick;if(!vp||!hit?.point)return false;const mask=shownMask(),chs=[];for(let i=0;i<4;i++)if(mask>>i&1&&vp.cls.chan[i]>=0)chs.push(vp.cls.chan[i]);return classifiedAt(hit.point,vp.halfExt,vp.dims,vp.cls,chs)};
 const recordPoint=(c,hit)=>{
  if(!hit?.voxel||!vrFp)return null;
  if(hit.plane!==undefined&&!sectionTissue(hit))return null;
  const rec=recordVrPoint({voxel:hit.voxel,series:vrFp,language:ja?'ja':'en'});
  if(!rec)return null;
  undo.push({type:'add',id:rec.id});emit('point-record');pulse(c,HAPTIC.record.amp,HAPTIC.record.ms);flashMsg(L.ptDone+rec.text+' · i '+hit.voxel.i+' · j '+hit.voxel.j+' · k '+hit.voxel.k,4000);return rec;
 };
 const selectPoint=(c,id)=>{vpSel=vpSel===id?null:id;pulse(c,HAPTIC.select.amp,HAPTIC.select.ms);menu.refresh()}; // one pulse (was two)
 const commentStore={getComments,removeComment,restoreComment};
 // delete a point (the same store operation as the 2D list) and remember it for the undo
 const deletePoint=id=>{
  const ms=measurementsOfPoint(id); // its distances go with it (the store's cascade) and come back with the undo
  const d=deleteSelected(id,commentStore);if(!d)return false;
  undo.push({type:'delete',c:d.c,index:d.index,ms});if(vpSel===id)vpSel=null;flashMsg(L.ptDeleted);return true;
 };
 const deleteSelectedPoint=()=>deletePoint(vpSel);
 // undo the last record / delete / move (20 steps); a failed op (the 2D side changed the list) is dropped
 const undoLast=()=>{
  const op=undo.pop();if(!op){flashMsg(L.undoNone);return false}
  if(!applyUndo(op,undoStore)){flashMsg(L.undoFail);return false}
  vpSel=op.type==='add'?null:op.type==='delete'?op.c.id:op.type.startsWith('measure')?vpSel:op.id;flashMsg(L.undoDone);emit('undo');return true;
 };
 // 体験会モード: the かんたん menu's 「最初の状態に戻す」 (event-mode.js resetPress: a second press within RESET_ARM_MS), IN PLACE: the session stays, nothing is decoded or uploaded again.
 // The page side (app.js -> data-load.js restoreProjectAnnotations) puts the project file's points / distances / pinned labels, the segments' visibility and the CT window back and empties the HU choice, histogram range and
 // this module's modes ('vrl-event-fresh'); the VR-local copies are re-derived from the page right after (initialVrModes: every segment's mode, the VR window from the sliders; the full menu's view settings: resetEventViewSettings). Here is what this session holds: sections (and a deleted one's undo), drags, wheels, the undo steps, the HU line, the histogram board,
 // the mode switch (ポイントモード), the VR window, the volume's place / scale and the boards' places (正面に戻す), and the menu is back on the かんたん page.
 let resetTimer=0;
 const resetToStart=()=>{
  const req=new CustomEvent('vrl-event-project-reset',{detail:{done:false}});document.dispatchEvent(req);
  endAllDrags();closeWheel();closePointWheel();for(const c of controllers){huLine.cancelDragOf(c);c.userData.press=null;c.userData.lblDrag=null;c.userData.moving=null}
  for(const pl of [...planes])removePlane(pl);section.on=false;section.selected=null;ui.secPage=0;ui.secSeen=null;for(const f of flying)disposePlane(f.pl);flying.length=0;secUndo.clear();undoBtn.hide();
  undo.clear();vpSel=null;cancelMeasure();
  huLine.setArmed(false,true);huLine.clear();setHistOpen(false);hist.invalidate();
  evLabels=TRIGGER_AT_START==='label';vrWindow.c=+wc.value||0;vrWindow.w=Math.max(1,+ww.value||1);ui.anPage=0;
  ui.sliceClear=false;sliceToast.until=0;sliceToast.mesh.visible=false;resetEventViewSettings(settings);saveSettings(settings);if(menuHeld){scene.attach(menu.mesh);menuHeld=null}if(helpHeld){scene.attach(help.mesh);helpHeld=null}if(evHeld){scene.attach(ev.mesh);evHeld=null}
  initialVrModes();bringVolumeFront();ui.open=true;menu.mesh.visible=true;ui.tab=10;placeMenuNow();placeHelpNow();placeHuNow();
  flashMsg(tr('evResetDone'),3500);return req.detail.done;
 };
 const pressReset=()=>{
  if(ui.swapBusy)return; // the data is being switched: nothing to reset
  const r=resetPress(ui.resetUntil||0,performance.now());ui.resetUntil=r.armedUntil;clearTimeout(resetTimer);
  if(r.fire)resetToStart();else{resetTimer=setTimeout(()=>{if(running)menu.refresh()},RESET_ARM_MS+80)}
  menu.refresh();
 };
 // hidden behind tissue: refreshed about 10 times a second (not every frame); the rule is vr-point.js pointIsHidden. The head is the middle of both eyes.
 // the distances' probes (9 per line, up to ~890 march steps each) are re-judged only when an input of pointIsHidden changed (createProbeGate), not every 100 ms
 const measGate=createProbeGate(0.005);let vpHidden=new Set(),vpHiddenAt=0,vpMeasHidden=new Set();const tmpEyeL=new THREE.Vector3(),tmpEyeR=new THREE.Vector3(),tmpHp=new THREE.Vector3();
 const occlusionGpu=()=>gpuOcclusionActive(settings.labelHide,renderer.capabilities); // 「実際に隠す」 and the renderer's depth is the standard one
 const updateHidden=now=>{
  vpHiddenAt=now;
  // the distance lines / labels are judged by the same rule (vpMeasure.probes(): 9 samples of every line + a dragged label) and drawn faint when hidden (vr-measure.js)
  const gpuOcc=occlusionGpu(),vp=volPick,pts=gpuOcc?[]:vpMarkers.centres(),mps=gpuOcc?[]:vpMeasure.probes(); // with the GPU depth occlusion the distances' probes are not needed at all;: nor are the point markers' (their depth test + ghost do it)
  if(!vp||!mesh?.parent||!material||(!pts.length&&!mps.length)){if(vpHidden.size)vpHidden=new Set();if(vpMeasHidden.size)vpMeasHidden=new Set();measGate.reset();return}
  const mask=shownMask(),chs=[];for(let i=0;i<4;i++)if(mask>>i&1&&vp.cls.chan[i]>=0)chs.push(vp.cls.chan[i]);
  const cams=renderer.xr.getCamera().cameras;
  if(cams&&cams.length>=2){cams[0].getWorldPosition(tmpEyeL);cams[1].getWorldPosition(tmpEyeR);tmpEyeL.add(tmpEyeR).multiplyScalar(0.5)}else tmpEyeL.copy(head);
  tmpEyeR.copy(tmpEyeL); // the eye in the world (kept for the probe gate: the head's sway is judged in metres)
  mesh.worldToLocal(tmpEyeL);
  const u=material.uniforms,opt={cls:vp.cls,dims:vp.dims,halfExt:vp.halfExt,chs,planes:u.cutPlanes.value,count:u.planeCount.value,cut:u.planeCut.value},next=new Set();
  for(const p of pts){tmpHp.copy(p.world);mesh.worldToLocal(tmpHp);if(pointIsHidden(tmpHp,tmpEyeL,opt))next.add(p.id)}
  vpHidden=next;
  if(!mps.length){if(vpMeasHidden.size)vpMeasHidden=new Set();measGate.reset();return}
  // the inputs of pointIsHidden for a probe: its place (and so the volume's matrix), the eye (tmpEyeL is local: moved by the volume too), the shown segments' classification, the section planes
  const pl=u.cutPlanes.value,np=u.planeCount.value;let key=mesh.matrixWorld.elements.join(',')+'|'+mask+'|'+np+'|'+u.planeCut.value+'|'+vp.dims.join(',')+'|'+gpuSegmentOrder().join('>')+'|'+SEGMENT_PRESET_ORDER.map(k=>{const g=segmentState[k]||{};return g.min+','+g.max+','+(segmentEditState[k]?.revision|0)}).join(';'); // the slot assignment too; thresholds / edits of the segments (the classification is rebuilt for them: vp.cls changes too)
  for(let i=0;i<np&&i<pl.length;i++)key+='|'+pl[i].x+','+pl[i].y+','+pl[i].z+','+pl[i].w;
  for(const p of mps)key+='|'+p.id+'@'+p.world.x.toFixed(4)+','+p.world.y.toFixed(4)+','+p.world.z.toFixed(4);
  if(!measGate.shouldRun(key,[vp.cls,mesh],tmpEyeR))return; // nothing changed: the previous judgement stands
  const nextM=new Set();for(const p of mps){tmpHp.copy(p.world);mesh.worldToLocal(tmpHp);if(pointIsHidden(tmpHp,tmpEyeL,opt))nextM.add(p.id)}
  vpMeasHidden=nextM;
 };
 const unsubComments=onCommentsChange(()=>{const ids=new Set(getComments().map(c=>c.id));if(vpSel&&!ids.has(vpSel))vpSel=null;for(const c of controllers)if(c.userData.moving&&!ids.has(c.userData.moving.id))c.userData.moving=null;if(pw&&!ids.has(pw.id))closePointWheel();if(ui.tab===6)menu.refresh()});
 const volumeHit=c=>{if(c)setRay(c);return volumeHitRay()};
 const volumeHitRay=()=>{
  const vp=volPick;if(!vp||!mesh?.parent||!material||diagAn.noLabels)return null; // diagnostic only: during the analysis bench the surface cursor and recording stop too
  const mask=shownMask(),chs=[];for(let i=0;i<4;i++)if(mask>>i&1&&vp.cls.chan[i]>=0)chs.push(vp.cls.chan[i]);if(!chs.length)return null;
  const o=tmpVo.copy(raycaster.ray.origin),q=tmpVq.copy(o).add(raycaster.ray.direction);mesh.worldToLocal(o);mesh.worldToLocal(q);q.sub(o);
  const u=material.uniforms,hi=marchClassificationHitInfo(o,q,vp.halfExt,vp.dims,vp.cls,chs,u.cutPlanes.value,u.planeCount.value,u.planeCut.value);
  if(!hi)return null;
  // what was hit — the segment (channel → segment) and the result at that voxel (list position, 0 = none)
  const si=vp.cls.chan.indexOf(hi.ch),[w,h]=vp.dims,id=vp.ids?vp.ids[hi.x+w*(hi.y+h*hi.z)]:0;
  // the hit voxel in the data's grid (surface mode records it; the same march, nothing is marched twice)
  const voxel=vrHalfExt&&vrDims&&surfaceActive()?surfaceVoxelFromHit(hi,o,q,{halfExt:vrHalfExt,dims:vrDims,clsDims:vp.dims}):null;
  return{distance:hi.t,key:gpuSegmentOrder()[si]||'',id,voxel,local:new THREE.Vector3(o.x+q.x*hi.t,o.y+q.y*hi.t,o.z+q.z*hi.t)};
 };
 // HU line (vr-hu-line.js): armed from the HU線 tab; the trigger on the volume (or the selected section when no tissue is under the laser) stretches a line, shared with the 2D / 3D views
 // The pick reuses what this frame's controller loop computed (c.userData.volHit / secHit, stamped with the frame number: vhFrame / secFrame) and marches again only when the
 // loop did not (the laser was on a board, or surface / label / section modes were all off); the press and the release use the newest frame's values.
 // the self-check's synthetic laser (selfCheck.env.huLine): a controller-less stand-in whose pick is the voxel the scenario sets
 const huSynth={c:{userData:{}},v:{i:0,j:0,k:0},a:{i:0,j:0,k:0},b:{i:0,j:0,k:0},snap:null,placed:true};
 const huLine=createVrHuLine(THREE,{mesh:()=>mesh,halfExt:()=>vrHalfExt,dims:()=>vrDims,language:ja?'ja':'en',pulse,flash:t=>flashMsg(t,3500),refresh:()=>menu.refresh(),
  texture:()=>vrReady()?prepared.vd:null, // the CPU copy of the VR texture (filtered slices when filters are on): the live values of the live panel
  onPanelShow:()=>{if(!huPlaced&&poseAt)placeHuNow()}, // placed in the air the first time it appears, then fixed (no follow)
  pick:(c,out)=>{if(c===huSynth.c){out.i=huSynth.v.i;out.j=huSynth.v.j;out.k=huSynth.v.k;return out}if(!vrHalfExt||!vrDims)return null;const u=c.userData,vh=u.vhFrame===frameNo?u.volHit:volumeHit(c),sh=vh?null:u.secFrame===frameNo?u.secHit:sectionPointOf(c);return voxelFromHits(vh,sh,vrHalfExt,vrDims,out)?out:null}});
 scene.add(huLine.panel);
 const huTarget=new THREE.Vector3(),huHits=[];let huPlaced=false,huHeld=null;
 const placeHuNow=()=>{readHead();huTarget.copy(head).addScaledVector(headFwd,HU_PANEL_OFFSET.fwd).addScaledVector(headLeft,HU_PANEL_OFFSET.left);huTarget.y-=HU_PANEL_OFFSET.down;if(huHeld){scene.attach(huLine.panel);huHeld=null}huLine.panel.position.copy(huTarget);huLine.panel.lookAt(head);huPlaced=true};
 setHuLineDeferred(true);
 const LABEL_W=0.12,LABEL_H=0.036,pins=new Map(),pinLit=new Set(),tmpLb=new THREE.Vector3(),tmpLe=new THREE.Vector3();
 const LABEL_SIZES=[0.5,0.7,1],labelScale=()=>LABEL_SIZES[settings.labelSize]??LABEL_SIZES[0];
 const HAND_CHIP={left:[0,-0.03,-0.03],right:[0,-0.03,-0.03]};
 const hoverLabelOf=c=>c.userData.hoverLabel||=Object.assign(makeLabel(),{hand:c});
 const evLabelOn=()=>evMenu&&triggerMode(evLabels,regionList.length>0)==='label'; // the trigger switch says 'label' (never without analysis results, never outside 体験会モード)
 const analysisOn=()=>(ui.open&&ui.tab===5)||evLabelOn(); // the analysis state: the analysis tab is open, or (体験会モード) the かんたん menu's 解析モード; pinned cards can be grabbed / moved only then
 const labelMode=()=>(ui.open&&ui.tab===5)||!section.on||evLabelOn();
 const makeLabel=(pin=false)=>{
  const canvas=document.createElement('canvas');canvas.width=512;canvas.height=154;const tex=new THREE.CanvasTexture(canvas);tex.colorSpace=THREE.SRGBColorSpace;
  const m=new THREE.Mesh(new THREE.PlaneGeometry(LABEL_W,LABEL_H),new THREE.MeshBasicMaterial({map:tex,transparent:true,toneMapped:false,depthTest:false,depthWrite:false}));m.renderOrder=5;m.visible=false;
  const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(),new THREE.Vector3()]),new THREE.LineBasicMaterial({color:0xffffff,transparent:true,depthTest:false,depthWrite:false}));line.frustumCulled=false;line.renderOrder=5;line.visible=false;
  // a PINNED label (a result's label left at its point) gets a ghost child of the card and of the leader (GreaterDepth, GHOST_ALPHA), used while the GPU depth occlusion is on (pinOcclusion)
  let mg=null,lg=null;
  if(pin){
   mg=new THREE.Mesh(m.geometry,Object.assign(m.material.clone(),{depthFunc:THREE.GreaterDepth,depthTest:true,depthWrite:false}));mg.renderOrder=m.renderOrder;mg.frustumCulled=false;mg.visible=false;m.add(mg);
   lg=new THREE.Line(line.geometry,Object.assign(line.material.clone(),{depthFunc:THREE.GreaterDepth,depthTest:true,depthWrite:false}));lg.renderOrder=line.renderOrder;lg.frustumCulled=false;lg.visible=false;line.add(lg);
  }
  scene.add(m);scene.add(line);return{m,line,mg,lg,ctx:canvas.getContext('2d'),tex,key:null,anchor:new THREE.Vector3(),world:new THREE.Vector3(),rid:null,off:null,lab:null,lit:false};
 };
 // pinned labels follow the 「ラベルの隠れ方」 setting like the distance labels: 実際に隠す = depth tested + faint ghost behind the tissue; otherwise as before (always drawn)
 const pinOcclusion=(lb,lit=false)=>{ // a lit card (the laser on it / held) and its leader are drawn on top, as the distance labels
  const occ=occludedPass(occlusionGpu(),lit);
  lb.m.material.depthTest=occ;lb.line.material.depthTest=occ;lb.mg.visible=occ;lb.lg.visible=occ;
  if(occ){lb.mg.material.opacity=lb.m.material.opacity*GHOST_ALPHA;lb.lg.material.opacity=lb.line.material.opacity*GHOST_ALPHA}
 };
 const spacingNote=()=>vrSpacingNote((gpuVolumeTarget()?.series||activeSeries)?.spacingCheck,language);
 let snFrame; // the note is judged once per frame for the cards (reset at the start of the label block of the frame loop)
 const spacingNoteF=()=>snFrame!==undefined?snFrame:(snFrame=spacingNote());
 const drawLabel=(lb,hit,faint,lit=false)=>{
  const r=hit.id?regionList[hit.id-1]:null,sn=r?spacingNoteF():null,seg=tr(hit.key)||hit.key,hc=lb.hand?handColor(lb.hand):0,key=(r?hit.id+'r'+r.rid:'n'+hit.key)+(faint?'f':'p')+hc+(lit?'L':'')+(sn?'w'+language:'');if(lb.key===key)return;lb.key=key;if(r&&faint)emit('label-show'); // only the hover card (faint) counts: a pinned card redrawn on re-entry does not
  const ctx=lb.ctx;ctx.clearRect(0,0,512,154);ctx.fillStyle='rgba(17,23,27,0.92)';ctx.beginPath();ctx.roundRect(4,4,504,146,26);ctx.fill();
  if(lb.hand){ctx.strokeStyle='#'+hc.toString(16).padStart(6,'0');ctx.lineWidth=6;ctx.stroke()}else if(lit){ctx.strokeStyle='#ffffff';ctx.lineWidth=8;ctx.stroke()}
  ctx.textBaseline='middle';ctx.fillStyle='#eef5f8';
  if(r){const hex='#'+r.color.toString(16).padStart(6,'0');ctx.fillStyle=hex;ctx.beginPath();ctx.arc(62,77,34,0,Math.PI*2);ctx.fill();
   ctx.fillStyle='#eef5f8';ctx.font='bold 44px system-ui,sans-serif';ctx.fillText(r.rid+'. '+r.segmentKeys.map(k=>tr(k)).join('+'),118,50);ctx.font='40px system-ui,sans-serif';ctx.fillText(vrVolumeText(r.mm3,sn),118,108)}
  else{ctx.font='bold 44px system-ui,sans-serif';ctx.fillText(seg,34,50);ctx.font='38px system-ui,sans-serif';ctx.fillStyle='#9fb3c3';ctx.fillText(ja?'解析結果なし':'no analysis result',34,108)}
  lb.tex.needsUpdate=true;lb.m.material.opacity=faint?0.85:1;lb.line.material.opacity=0.9;lb.faint=faint;
 };
 const placeLabel=lb=>{
  if(lb.hid){lb.m.visible=false;lb.line.visible=false;return} // the result's segments are all hidden: no card, no leader, so the laser cannot pick it either (pickPin skips invisible cards)
  const k=labelScale()*(lb.lit?LABEL_LIT_SCALE:1);lb.m.scale.setScalar(k);
  if(lb.hand){const o=HAND_CHIP[lb.hand.userData.source?.handedness]||HAND_CHIP.right;lb.m.position.set(o[0],o[1],o[2]);lb.hand.updateWorldMatrix(true,false);lb.hand.localToWorld(lb.m.position);lb.m.lookAt(head);lb.m.visible=true;lb.line.visible=false;return}
  lb.world.copy(lb.anchor);mesh.localToWorld(lb.world);
  if(lb.off&&vrHalfExt&&vrDims){ // a MOVED label sits where the user left it (anchor + offset in voxel units: independent of the volume's move / turn / scale); the leader runs from the anchor to the card's edge facing it
   const d=labelLocal(lb.anchor,lb.off,vrVoxelStep(vrHalfExt,vrDims));lb.m.position.set(d.x,d.y,d.z);mesh.localToWorld(lb.m.position);lb.m.lookAt(head);lb.m.updateMatrixWorld(true);
   tmpLb.copy(lb.world);lb.m.worldToLocal(tmpLb);const e=rectEdgePoint(tmpLb.x,tmpLb.y,LABEL_W/2,LABEL_H/2);tmpLe.set(e.x,e.y,0);lb.m.localToWorld(tmpLe);
   const a=lb.line.geometry.attributes.position;a.setXYZ(0,lb.world.x,lb.world.y,lb.world.z);a.setXYZ(1,tmpLe.x,tmpLe.y,tmpLe.z);a.needsUpdate=true;
   lb.m.visible=true;lb.line.visible=true;return;
  }
  tmpLb.subVectors(head,lb.world).normalize();lb.m.position.copy(lb.world).addScaledVector(tmpLb,0.012);lb.m.position.y+=labelScale()*0.045;lb.m.lookAt(head);
  const a=lb.line.geometry.attributes.position;a.setXYZ(0,lb.world.x,lb.world.y,lb.world.z);a.setXYZ(1,lb.m.position.x,lb.m.position.y-k*LABEL_H/2,lb.m.position.z);a.needsUpdate=true;
  lb.m.visible=true;lb.line.visible=true;
 };
 const hideLabel=lb=>{if(lb){lb.m.visible=lb.line.visible=false}};
 // the pinned labels live on the regions (region.label = {anchor,offset?}, voxel units): the trigger pins / unpins, the laser + trigger grabs a pinned card and moves it (a long press without moving puts it back)
 const regionByRid=rid=>analysisRegions.find(r=>r.id===rid)||null;
 // region id -> position in regionList + 1, rebuilt only when the list is replaced (a new prepare)
 let ridList=null,ridMap=null;const ridIndex=()=>{if(ridList!==regionList){ridList=regionList;ridMap=new Map(regionList.map((e,i)=>[e.rid,i+1]))}return ridMap};
 const regionOfHit=id=>{const e=id?regionList[id-1]:null;return e?regionByRid(e.rid):null};
 const dropPin=(rid,lb)=>{pins.delete(rid);lb.m.removeFromParent();lb.line.removeFromParent();lb.tex.dispose();lb.m.material.dispose();lb.m.geometry.dispose();lb.line.geometry.dispose();lb.line.material.dispose();lb.mg.material.dispose();lb.lg.material.dispose()};
 const syncPins=()=>{
  const ri=ridIndex();
  for(const [rid,lb] of pins){const reg=regionByRid(rid);if(!reg?.label||!ri.has(rid))dropPin(rid,lb)} // deleting the visited entry while iterating a Map is safe
  if(!vrHalfExt||!vrDims)return;
  for(const reg of analysisRegions){
   if(!reg.label)continue;const idx=ri.get(reg.id);if(!idx)continue; // only the shown results have a card
   let lb=pins.get(reg.id);if(!lb){lb=makeLabel(true);lb.rid=reg.id;pins.set(reg.id,lb)}
   lb.hid=!labelSegmentsShown(reg.segmentKeys,vrSegShown);
   drawLabel(lb,{id:idx,key:''},false,pinLit.has(reg.id));
   if(lb.lab!==reg.label){lb.lab=reg.label;const p=voxelToLocal(reg.label.anchor,vrHalfExt,vrDims);lb.anchor.set(p.x,p.y,p.z);lb.off=leaderVisible(reg.label)?reg.label.offset:null}
  }
 };
 const togglePin=(c,hit)=>{
  const reg=regionOfHit(hit?.id);if(!reg||!vrHalfExt||!vrDims)return false;
  if(reg.label){setRegionLabel(reg,null);pulse(c,0.2);return true}
  setRegionLabel(reg,{anchor:clampVoxel(voxelFromLocalVr(hit.local,vrHalfExt,vrDims),vrDims)});pulse(c);return true;
 };
 let measureHintHand=null;const tmpHintHand=new THREE.Vector3(); // {c,id}: the controller that started the distance at point id (the first-point hint floats above it, vr-measure.js)
 const makePinRes=()=>({id:0,pin:true,distance:0,hit:new THREE.Vector3(),pos:new THREE.Vector3()});
 const tmpPi=new THREE.Matrix4(),tmpPo=new THREE.Vector3(),tmpPd=new THREE.Vector3(),tmpPh=new THREE.Vector3(),tmpPl=new THREE.Vector3();
 // the pinned card a ray (world origin o, unit direction d) points at: out = {id:region id,pin:true,distance,hit,pos} (one object per hand, reused) or null.
 // only while the analysis tab is open (the caller), so a card never blocks point recording / section grabs in the other modes
 const pickPin=(o,d,out)=>{
  let bestLb=null,bestD=Infinity;
  for(const lb of pins.values()){
   if(!lb.m.visible)continue;lb.m.updateWorldMatrix(true,false);
   tmpPi.copy(lb.m.matrixWorld).invert();tmpPo.set(o.x,o.y,o.z).applyMatrix4(tmpPi);tmpPd.set(d.x,d.y,d.z).transformDirection(tmpPi);
   if(Math.abs(tmpPd.z)<1e-9)continue;const t=-tmpPo.z/tmpPd.z;if(!(t>0))continue;
   tmpPh.copy(tmpPo).addScaledVector(tmpPd,t);
   if(Math.abs(tmpPh.x)>LABEL_W*0.6||Math.abs(tmpPh.y)>LABEL_H*0.9)continue; // a little generous (the card is small)
   tmpPh.applyMatrix4(lb.m.matrixWorld);const dist=Math.hypot(tmpPh.x-o.x,tmpPh.y-o.y,tmpPh.z-o.z);
   if(dist<bestD){bestD=dist;bestLb=lb;out.hit.copy(tmpPh)}
  }
  if(!bestLb)return null;
  out.id=bestLb.rid;out.pin=true;out.distance=bestD;out.pos.copy(bestLb.m.position);return out;
 };
 // the nearer of a distance label and a pinned card
 const nearerLabel=(a,b)=>!a?b:!b?a:(b.distance<a.distance?b:a);
 // the held card follows the world point P: stored as the offset (voxel units) from its anchor
 const dragPin=(rid,P)=>{
  const reg=regionByRid(rid),lb=pins.get(rid);if(!reg?.label||!lb||!mesh||!vrHalfExt||!vrDims)return false;
  tmpPl.set(P.x,P.y,P.z);mesh.worldToLocal(tmpPl);
  return setRegionLabelOffset(reg,offsetForLocal(lb.anchor,tmpPl,vrVoxelStep(vrHalfExt,vrDims)));
 };
 const resetPin=c=>{const ld=c.userData.lblDrag,reg=regionByRid(ld?.id);if(!reg?.label?.offset)return false;ld.done=true; // the press is spent: a drift of the hand after the reset does not drag the card again
  setRegionLabelOffset(reg,null);pulseTwice(c);flashMsg(L.lbReset,2200);return true};
 const addPlane=(c=null,cut=true)=>{
  if(planes.length>=MAX_PLANES)return null;
  const color=nextPlaneColor(planes.map(p=>p.color));
  const pl=makePlane(color,cut);planes.push(pl);
  readHead();scene.add(pl.obj);
  if(c){c.getWorldPosition(pl.obj.position);tmpB.set(0,0,-1).transformDirection(c.matrixWorld);pl.obj.position.addScaledVector(tmpB,0.12)}
  else holder.getWorldPosition(pl.obj.position);
  tmpA.subVectors(head,pl.obj.position).normalize();pl.obj.quaternion.setFromUnitVectors(new THREE.Vector3(1,0,0),tmpA);pl.obj.scale.setScalar(1);
  holder.attach(pl.obj);pl.obj.scale.setScalar(planeFrameLocalScale(holder.scale.x));chooseSide(pl);section.on=true;section.selected=pl;planes.forEach(p=>{p.obj.visible=true});refreshHandles();menu.refresh();if(!sweepOn)emit('section-add');return pl;
 };
 const detachPlane=pl=>{for(const c of controllers){if(c.userData.drag?.pl===pl)c.userData.drag=null;const pr=c.userData.press;if(pr&&pr.res?.ref?.pl===pl)pr.res={kind:'none',ref:null};if(pr&&pr.dragPl===pl)pr.dragPl=null}const i=planes.indexOf(pl);if(i>=0)planes.splice(i,1);if(section.selected===pl)section.selected=planes[planes.length-1]||null;if(!planes.length)section.on=false;refreshHandles();menu.refresh()}; // out of the list (clip uniforms, numbers) but not disposed
 const removePlane=pl=>{detachPlane(pl);disposePlane(pl)};
 // ===== delete a section (thrown away / 断面を削除 / 削除 button) and 「元に戻す」 for FLING_UNDO_MS =====
 // The deleted plane leaves `planes` at once (the clip, the numbers and the colours follow the list), a snapshot goes on secUndo, the frame flies off along the throw and fades (FLING_FADE_S), then is disposed.
 // The undo board / the ring's 元に戻す put it back at its number (list index), colour, clip, side, hand and pose in the volume (vr-section-frame.js makeSectionSnapshot / restorePlan).
 const secUndo=createSectionUndo(),flying=[],tmpFv=new THREE.Vector3(),tmpFc=new THREE.Vector3();let undoAt=null;
 const startFly=(pl,v)=>{
  scene.attach(pl.obj);pl.obj.visible=true;pl.glow.visible=false;pl.arrow.visible=false;pl.mat.depthTest=false;pl.handle.material.depthTest=false;pl.mat.opacity=1;pl.handle.material.opacity=1;
  flying.push({pl,v:capVelocity(v),age:0});
 };
 const showUndoBoard=(c,n,front=false)=>{
  if(c&&!front){c.getWorldPosition(tmpFv)}else{readHead();tmpFv.copy(head).addScaledVector(headFwd,0.45);tmpFv.y-=0.12} // no hand (the 断面 tab's button), or: deleted out of view (the hand is behind the shoulder): in front of the face, nearer than the menu (0.78 m) and the volume (0.65 m)
  readHead();const pos=undoButtonPlace(tmpFv,head);undoAt={x:pos.x,y:pos.y,z:pos.z};
  undoBtn.show(pos,head,tr('vrSecUndo'),tr('vrSecDeletedShort').replace('{n}',n));
 };
 const deleteSection=(pl,{c=null,vel=null,front=false}={})=>{
  const i=planes.indexOf(pl);if(i<0)return false;
  // the saved position is where a normal release would have left it (snapSection: the centre brought back into the volume box); the flying frame itself keeps its current place
  const wasSel=section.selected===pl,rest=vrHalfExt?snapPlaneCenterIntoBox(pl.obj.position,qRot({x:pl.obj.quaternion.x,y:pl.obj.quaternion.y,z:pl.obj.quaternion.z,w:pl.obj.quaternion.w},{x:1,y:0,z:0}),vrHalfExt):pl.obj.position;
  const snap=makeSectionSnapshot({index:i,color:pl.color,cut:pl.cut,side:pl.side,hand:pl.hand,position:rest,quaternion:pl.obj.quaternion,wasSelected:wasSel});
  detachPlane(pl);
  if(wasSel)section.selected=planes[Math.min(i,planes.length-1)]||null; // the neighbour takes over the selection (detachPlane took the last one)
  if(vel)startFly(pl,vel);else disposePlane(pl);
  secUndo.push(snap,performance.now());showUndoBoard(c,i+1,front);
  flashMsg(tr('vrSecDeleted').replace('{n}',i+1),FLING_UNDO_MS);
  if(c)pulse(c,HAPTIC.ringConfirm.amp,HAPTIC.ringConfirm.ms);
  menu.refresh();return true;
 };
 const restoreSection=c=>{
  const now=performance.now(),e=secUndo.peek(now);
  if(!e){undoBtn.hide();return false}
  const plan=restorePlan(e.snap,planes.map(p=>p.color),planes.length,MAX_PLANES);
  if(!plan.ok){flashMsg(tr('vrSecUndoFull').replace('{max}',MAX_PLANES),3000);if(c)pulse(c,0.15,30);return false}
  secUndo.pop(now);
  const sn=e.snap,pl=makePlane(plan.color,sn.cut);
  pl.side=sn.side;pl.hand=sn.hand;pl.obj.position.set(sn.position.x,sn.position.y,sn.position.z);pl.obj.quaternion.set(sn.quaternion.x,sn.quaternion.y,sn.quaternion.z,sn.quaternion.w);
  holder.add(pl.obj);pl.obj.scale.setScalar(planeFrameLocalScale(holder.scale.x));
  planes.splice(plan.index,0,pl);section.on=true;planes.forEach(p=>{p.obj.visible=true});
  if(sn.wasSelected||!section.selected)section.selected=pl; // the 断面 tab's page follows the selected plane (ui.secSeen)
  refreshHandles();
  const nx=secUndo.peek(now);readHead();if(nx&&undoAt)undoBtn.show(undoAt,head,tr('vrSecUndo'),tr('vrSecDeletedShort').replace('{n}',nx.snap.index+1));else undoBtn.hide();
  flashMsg(tr('vrSecRestored').replace('{n}',plan.index+1),2500);
  if(c)pulse(c,HAPTIC.ringConfirm.amp,HAPTIC.ringConfirm.ms);
  menu.refresh();return true;
 };
 // the release of a section drag: a throw (fast, away from the volume centre, no grip / two-hand gesture) deletes it. The release event carries the pose of the last frame, so the
 // velocity comes from the frame samples only (no extra sample at the release).: the FRAME's velocity and its centre (world), not the controller's (a laser drag swings
 // the frame at the end of the laser: a wrist flick barely moves the controller), and the outward axis is volume centre -> frame (the hand is between the viewer and the volume)
 const flingDebugOn=()=>!!globalThis.__vrlSettings?.debugOn?.()||(typeof location!=='undefined'&&/[?&]debug(\b|=|&|$)/.test(location.search));
 const showFlingDebug=(d,at)=>{
  if(!flingDbg){flingDbg=createFlingDebugTag(THREE);scene.add(flingDbg.mesh)}
  readHead();const p={x:head.x+headFwd.x*0.55-headLeft.x*0.2,y:head.y+0.1,z:head.z+headFwd.z*0.55-headLeft.z*0.2}; // upper right of the view, nearer than the volume; fixed after the release
  flingDbg.show(flingDebugLines(d,ja),!!d.fling,p,head,performance.now(),FLING_DEBUG_MS);
  try{console.info('[vr fling]',JSON.stringify({...d,at:{x:+at.x.toFixed(3),y:+at.y.toFixed(3),z:+at.z.toFixed(3)}}))}catch{}
 };
 // the frame's 4 corners + centre (world) against the XR eyes' frustums (vr-section-frame.js frameOutOfView, 10 % margin); no XR eye = never out of view
 // asked EVERY FRAME while a section is dragged (the drag loop below feeds dg.oov, vr-section-frame.js createOutOfViewTracker): out of view and >= 0.35 m from the
 // head; the release deletes only after 200 ms of that without a break. No allocation per frame (the eye matrices go into two fixed arrays).
 const oovPts=[0,1,2,3,4].map(()=>new THREE.Vector3()),oovM=new THREE.Matrix4(),oovEyes=[new Array(16).fill(0),new Array(16).fill(0)],oovC=new THREE.Vector3();
 const sectionOutOfView=pl=>{
  const xc=renderer.xr.getCamera(),cams=xc?.cameras?.length?xc.cameras:(xc?[xc]:[]);if(!cams.length)return false;
  const h=0.12;[[0,-h,-h],[0,h,-h],[0,h,h],[0,-h,h],[0,0,0]].forEach((q,i)=>{oovPts[i].set(q[0],q[1],q[2]);pl.obj.localToWorld(oovPts[i])}); // square(h) of makePlane
  const n=Math.min(cams.length,2);for(let i=0;i<n;i++){const k=cams[i];oovM.multiplyMatrices(k.projectionMatrix,k.matrixWorldInverse);for(let j=0;j<16;j++)oovEyes[i][j]=oovM.elements[j]}
  if(!frameOutOfView(oovPts,n===2?oovEyes:[oovEyes[0]]))return false;
  xc.getWorldPosition(oovC);return outOfViewNow(true,oovPts[4].distanceTo(oovC)); // the centre's distance from the head
 };
 const tryFling=c=>{
  const dg=c.userData.drag,fv=c.userData.fv;if(!dg||!fv||!planes.includes(dg.pl))return false;
  const now=performance.now();readHead();dg.pl.obj.getWorldPosition(tmpFv);holder.getWorldPosition(tmpFc);
  const blocked=!!dg.volTouched||!!twoHand||grabbing.size>0,m=fv.measure(now);let r=flingDecision({v:m.v,from:tmpFv,center:tmpFc,head,blocked});
  if(!r.fling&&!blocked&&outOfViewRelease(dg.oov,now))r={...r,fling:true,reason:'out-of-view'}; // the whole frame out of view (>= 0.35 m from the head) for >= 200 ms up to the release = deleted (same exclusions as the throw)
  if(flingDebugOn())showFlingDebug({...r,n:m.n,spanMs:m.spanMs,ageMs:m.ageMs,why:m.why,hand:c.userData.fvHand?.measure(now).v?.speed??null},tmpFv); // every release, deleted or not
  if(!r.fling)return false;
  c.userData.drag=null;return deleteSection(dg.pl,{c,vel:m.v,front:r.reason==='out-of-view'});
 };
 // snap: the selected plane onto a volume axis, frame edges along the other two axes.
 // axis 0 axial (normal = volume z), 1 coronal (y), 2 sagittal (x); holder space = volume object space.
 // The normal keeps its sign (removed side unchanged), position unchanged, up = volume y (coronal: z)
 const AXES=[new THREE.Vector3(0,0,1),new THREE.Vector3(0,1,0),new THREE.Vector3(1,0,0)],tmpQa=new THREE.Quaternion(),tmpQb=new THREE.Quaternion(),tmpNh=new THREE.Vector3();
 const normalInHolder=(pl,out)=>{pl.obj.getWorldQuaternion(tmpQa);holder.getWorldQuaternion(tmpQb);return out.set(1,0,0).applyQuaternion(tmpQa).applyQuaternion(tmpQb.invert())};
 const snapPlane=(pl,axis)=>{
  if(!pl)return;scene.updateMatrixWorld();
  const n=AXES[axis].clone();if(n.dot(normalInHolder(pl,tmpNh))<0)n.negate();
  const u=axis===1?new THREE.Vector3(0,0,1):new THREE.Vector3(0,1,0),w=new THREE.Vector3().crossVectors(n,u);
  const qh=new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(n,u,w));
  // holder space -> the plane's parent (holder when fixed, the controller while held)
  (pl.obj.parent||holder).getWorldQuaternion(tmpQa).invert();holder.getWorldQuaternion(tmpQb);
  pl.obj.quaternion.copy(tmpQa.multiply(tmpQb).multiply(qh));menu.refresh();
 };
 // axis the plane's normal lies on (within about 1°), else -1: the snap buttons' on state
 const planeAxis=pl=>{if(!pl)return -1;const n=normalInHolder(pl,tmpNh);for(let i=0;i<3;i++)if(Math.abs(n.dot(AXES[i]))>0.9998)return i;return -1};
 const setSection=on=>{
  if(on&&!planes.length){addPlane();return}
  section.on=on;if(!on)endAllDrags();planes.forEach(p=>{p.obj.visible=on});menu.refresh();if(!sweepOn){emit('section-toggle');if(on)emit('section-add')} // a frame that was only hidden and is shown again counts as 'a section frame appeared' (the tutorial's ステップ3 / 5 wait for it)
 };
 // long-press progress ring shown on the pressing controller
 const ringGeo=new THREE.BufferGeometry().setFromPoints(Array.from({length:33},(_,i)=>new THREE.Vector3(Math.cos(i/32*Math.PI*2)*0.025,Math.sin(i/32*Math.PI*2)*0.025,0)));
 const ring=new THREE.Line(ringGeo,new THREE.LineBasicMaterial({color:0xffffff}));ring.position.set(0,0.035,0.02);ring.rotation.x=-0.6;ring.visible=false;
 let dragging=null,shotRequested=false;

 // the grip's actions (squeezestart / squeezeend of a controller, the fist of a hand): the bodies are the controller's own, unchanged; what is
 // grabbed is attached to holdOf(c) (the controller itself / a hand's palm anchor)
 const gripStart=c=>{
   if(ui.open&&!menuHeld&&boardHits(c).menu){holdOf(c).attach(menu.mesh);menuHeld=c;menuMoving=false;settings.menuMode=1;saveSettings(settings);pulse(c);menu.refresh();return}
   if(!helpHeld&&c.userData.helpHit){holdOf(c).attach(help.mesh);helpHeld=c;helpMoving=false;settings.help=2;saveSettings(settings);pulse(c);menu.refresh();return}
   if(!evHeld&&c.userData.evHit){holdOf(c).attach(ev.mesh);evHeld=c;pulse(c);return} // the mission board moves with the hand, not the volume behind it
   if(!histHeld&&c.userData.histHit){holdOf(c).attach(hist.group);histHeld=c;pulse(c);return} // the grip moves the histogram board (as the help board); never takes the volume
   if(!huHeld&&boardHits(c).hu){holdOf(c).attach(huLine.panel);huHeld=c;pulse(c);return} // the HU live panel moves with the hand, not the volume behind it
   grabbing.add(c);regrab(); // the grip always moves the volume (it never takes a section)
 };
 const gripEnd=c=>{
   if(menuHeld===c){scene.attach(menu.mesh);menuHeld=null;readHead();menu.mesh.lookAt(head);pulse(c,0.2);return}
   if(helpHeld===c){scene.attach(help.mesh);helpHeld=null;readHead();help.mesh.lookAt(head);pulse(c,0.2);return}
   if(evHeld===c){scene.attach(ev.mesh);evHeld=null;readHead();ev.mesh.lookAt(head);pulse(c,0.2);return}
   if(histHeld===c){scene.attach(hist.group);histHeld=null;readHead();hist.group.lookAt(head);pulse(c,0.2);return}
   if(huHeld===c){scene.attach(huLine.panel);huHeld=null;readHead();huLine.panel.lookAt(head);pulse(c,0.2);return}
   if(grabbing.delete(c))regrab();
 };
 for(const c of controllers){
  for(const t of ['selectstart','selectend'])c.addEventListener(t,e=>handIn.eventPose(c,e)); // first: a hand's select handlers see its filtered / delayed ray (three just wrote the raw pose); nothing for a controller.: a hand's system select feeds its pinch (vr-hand-view.js), which dispatches the hand's own selectstart / selectend ({handPinch:true})
  c.addEventListener('connected',e=>{c.userData.source=e.data;if(isHand(e.data)){handIn.connect(c,controllers.indexOf(c));if(badge.parent===c)c.remove(badge);help.refresh();return}if(c.userData.hs)handIn.drop(c);if(c.userData.source?.handedness==='left')c.add(badge)}); // a hand: no X badge, the hand help; the controller path as before
  c.addEventListener('disconnected',c.userData.release=e=>{
   endDrag(c);huLine.cancelDragOf(c);c.userData.press=null;c.userData.lblDrag=null;c.userData.moving=null;c.userData.axPress?.reset();c.userData.stickLock=false;
   if(wheelOwner===c)closeWheel();if(pw?.c===c)closePointWheel();
   if(histAxis===c)histAxisEnd(false); // a drag by a hand that went away is dropped (the range stays as it was)
   if(histHeld===c){scene.attach(hist.group);histHeld=null} // a board held by a hand that went away stays where it was
   if(evHeld===c){scene.attach(ev.mesh);evHeld=null}
   if(huHeld===c){scene.attach(huLine.panel);huHeld=null} // the same for the HU line's live panel
   // everything else this input held is released too: a volume held by a lost controller / hand stayed attached to it and jumped on reconnect
   if(grabbing.delete(c))regrab();if(menuHeld===c){scene.attach(menu.mesh);menuHeld=null}if(helpHeld===c){scene.attach(help.mesh);helpHeld=null}if(dragging?.c===c){dragging=null;saveSettings(settings)}
   c.userData.empOn=false;c.userData.vB=false;c.userData.vCancel=false;c.userData.hideFrames=false;c.userData.dpPend=null;c.userData.res=null;c.userData.wristScroll=null;c.userData.bDown=false;if(ring.parent===c)ring.visible=false; // no stale target at the next press, no B/Y release (section toggle) on reconnect
   if(e===true)return; // a hand whose tracking was lost > 200 ms (vr-hand-view.js): the same release, the input source stays
   c.userData.source=null;
   if(c.userData.hs){handIn.drop(c);help.refresh()}
  });
  c.addEventListener('squeezestart',()=>{
   if(isHand(c.userData.source))return; // a hand grabs with its fist (handIn: gripStart / gripEnd), not with a squeeze event
   gripStart(c);
  });
  c.addEventListener('squeezeend',()=>{
   if(isHand(c.userData.source))return;
   gripEnd(c);
  });
  // trigger: the menu / panels act on the press as before. Anything else: the target is resolved ONCE at the press (resolveTriggerTarget,
  // from last frame's candidates) and kept until the release. Short press (< 0.5 s) = the action of the target (record / label / select a point);
  // holding it = long press (a point: the point menu, stage 3); on a frame band, a number tag or empty space, moving the hand drags the section.
  c.addEventListener('selectstart',e=>{
   if(isHand(c.userData.source)&&(!e.handPinch||handIn.grabbing(c)||handIn.fistLike(c)))return; // a pinch the system sees inside a fist (the thumb on the index), or while the hand is closing into one, is not a trigger.: a hand presses only with the pinch of vr-hand-view.js (handPinch), never with the system's select itself
   endDrag(c);
   const bd=boardHits(c),h=bd.menu;
   if(h){const i=menu.hit(h.uv);if(i<0)return;const w=menu.widget(i);if(w.set){dragging={c,i};menu.drag(i,h.uv)}else menu.press(i);pulse(c);return}
   if(bd.wheel&&bd.wheel.slot!==null){confirmWheel(bd.wheel.slot,c);return}
   if(bd.pwheel&&bd.pwheel.slot!==null){confirmPoint(bd.pwheel.slot,c);return}
   if(bd.undoBtn){restoreSection(c);return} // 「元に戻す」 after a section was deleted
   if(bd.wrist){wristDo(handIn.wristId(bd.wrist.slot),c);return} // a wrist-menu button (a hand's ray only)
   if(bd.hist){ // an end of the x axis = drag the display range; 「自動」 = auto. Anything else on the board: nothing (no segment lines / editing), and the press does not reach what is behind it
    const t=histTargetOf(bd.hist);
    if(t==='auto'){setHistogramRange({mode:'auto'});pulse(c)}else if(t&&!histAxis&&hist.startAxisDrag(t,histLocal.x)){histAxis=c;histAxisOut.distance=bd.hist.distance;pulse(c)}
    return}
   if(bd.help){const i=help.hit(bd.help.uv);if(i>=0){help.press(i);pulse(c)}return} // the tutorial's buttons;: and the 手順一覧 | 詳細 tabs (with the tutorial off too)
   if(bd.hu||bd.ev)return; // the HU live panel has no buttons (no line start). A press on it or the help board does nothing and does not reach what is behind it
   if((bd.wheel||bd.pwheel)&&wheelOwner!==c&&pw?.c!==c)return; // blank part of a ring disc, not this hand's ring: nothing, and it does not pass through
   const r0=c.userData.res,res=r0&&r0.kind!=='board'?r0:{kind:'none',ref:null},now=performance.now(),hp=handInHolder(c);
   // this hand's ring is open: the press confirms the lit item, or only closes the ring
   if(res.kind==='ring-confirm'){if(wheelOwner===c)confirmWheel(res.ref,c);else confirmPoint(res.ref,c);return}
   if(res.kind==='ring-close'){if(wheelOwner===c)closeWheel();if(pw?.c===c)closePointWheel();return}
   if(huLine.isArmed()&&(res.kind!=='section'||res.ref?.glass)&&res.kind!=='move'&&res.kind!=='mlabel'&&huLine.start(c))return; // the HU line takes the trigger (a section's band / tag, a point being moved and a distance label keep their own action; the empty inside of a frame (glass) does not: the line starts on the slice there, as on empty space before)
   const pr={t0:now,res,hit0:res.kind==='record'||res.kind==='label'?res.ref:null,p0:hp.p,q0:hp.q,wq0:wristQ(c),gateOk:c.userData.gate.canRecord(now),consumed:false,dragPl:null,dragRec:false,tp:createTriggerPress()};
   // the section this press may drag: a band / tag = that section; on the selected section's point (section mode) = the selected one, with the higher threshold;
   // empty space (not on tissue) = the section the laser passes through
   if(section.on&&vrHalfExt&&!framesHidden()){ // frames hidden (thumbstick click held): no section is dragged
    if(res.kind==='section'&&res.ref.pl)pr.dragPl=res.ref.pl;
    else if(res.kind==='record'&&!surfaceActive()&&!labelMode()&&section.selected){pr.dragPl=section.selected;pr.dragRec=true}
    else if(res.kind==='empty')pr.dragPl=sectionForEmpty(c,planes.filter(p=>!draggedBy(p,c)));
    if(pr.dragPl&&draggedBy(pr.dragPl,c))pr.dragPl=null;
   }
   // a distance label under the laser: the press grabs it (it follows the laser at that distance until the release); no point / section action starts
   if(res.kind==='mlabel'){pr.consumed=true;pr.dragPl=null;c.userData.lblDrag={id:res.ref.id,pin:!!res.ref.pin,moved:false,pos0:res.ref.pos.clone(),dist:res.ref.distance,grab:{x:res.ref.pos.x-res.ref.hit.x,y:res.ref.pos.y-res.ref.hit.y,z:res.ref.pos.z-res.ref.hit.z}};pulse(c,HAPTIC.select.amp,HAPTIC.select.ms)}
   pr.tp.press(now);c.userData.press=pr;(c.userData.fv||=createVelocityTracker()).reset();(c.userData.fvHand||=createVelocityTracker()).reset(); // a new press starts a new velocity record
   // a frame band or number tag selects its section at the press (the selection never moves it)
   if(res.kind==='section'&&res.ref.pl){section.selected=res.ref.pl;pulse(c,HAPTIC.select.amp,HAPTIC.select.ms);menu.refresh()}
   // a pinch on a section twice within 300 ms = the slice transparent / back (ui.sliceClear, as the stick click); a pinch in empty space = B/Y (right) / the frame hold (left)
   if(isHand(c.userData.source)){
    if(onSectionRes(res)){if((c.userData.dpr||=createDoublePress({windowMs:EMPTY_PINCH.doubleMs})).update(true,now)){pr.consumed=true;pr.dragPl=null;pr.dragRec=false;c.userData.dpPend=null;toggleSliceClear(c)}}
    else empStart(c,res,now);
   }
  });
  c.addEventListener('selectend',e=>{
   if(isHand(c.userData.source)&&!e.handPinch)return; // a hand's press ends with its own pinch (vr-hand-view.js), not with the system's selectend
   if(histAxis===c){histAxisEnd(true);pulse(c,0.2);return} // the dragged end is committed (手動)
   if(huLine.end(c))return;
   const ld0=c.userData.lblDrag;c.userData.lblDrag=null;
   if(dragging?.c===c){dragging=null;saveSettings(settings)}
   const pr=c.userData.press;if(!pr)return;
   c.userData.press=null;if(!tryFling(c))endDrag(c); // a fast flick away from the volume deletes the section (no snap back into the box)
   const rel=pr.tp.release(performance.now());
   // a short tap on a pinned card (not moved, before the 0.5 s reset) unpins it, as a tap on its place always did
   if(ld0?.pin&&pr.res.kind==='mlabel'){if(rel==='tap'&&!ld0.moved&&!ld0.done){const reg=regionByRid(ld0.id);if(reg?.label){setRegionLabel(reg,null);pulse(c,0.2)}}return}
   if(rel!=='tap'||pr.consumed)return;
   const k=pr.res.kind;
   if(getMeasureStart()&&(k==='point'||k==='record'||k==='label'||k==='empty'||k==='none'||k==='tissue'||(k==='section'&&pr.res.ref?.glass))){endMeasureTap(c,k==='point'?pr.res.ref.id:null);return} // a distance is being made: a point = its END; anything else (a tap that would record, empty space, the empty inside of a frame) cancels, and records nothing
   if(k==='record'){if(pr.gateOk){if(isHand(c.userData.source)&&onSectionRes(pr.res))c.userData.dpPend={at:Math.max(performance.now(),pr.t0+EMPTY_PINCH.doubleMs),hit:pr.hit0};else recordPoint(c,pr.hit0)}} // a hand's short pinch on a section waits for the double-pinch window (a second pinch cancels it)
   else if(k==='label')togglePin(c,pr.hit0)
   else if(k==='point'){if(getComments().some(x=>x.id===pr.res.ref.id))selectPoint(c,pr.res.ref.id)}
   else if(k==='move')placeMoved(c,pr.res.ref);
  });
  c.addEventListener('selectend',e=>{if(isHand(c.userData.source)&&!e.handPinch)return;c.userData.wristScroll=null;if(isHand(c.userData.source)){empStop(c,false);c.userData.dpr?.update(false,performance.now())}}); // the empty-space pinch ends (B/Y short fires from the loop; the frame hold ends), the double-pinch press is over //: 断面 +/- of the wrist menu stops with the pinch (nothing for a controller).: the hand's own selectend
 }
 // a fist that forms with the palm in / near an object takes THAT object (no laser; vr-hand.js pickNearGrab: boards, then a section frame / tag,
 // then the volume's box). What is taken keeps its offset to the hand (attach keeps the world pose; a section: the drag record of the pose in holder space).
 // Hands only (the grab callback of handIn is called from the fist only). The bodies of the four boards are those of gripStart.
 const tmpNp=new THREE.Vector3(),tmpNl=new THREE.Vector3(),tmpNs=new THREE.Vector3();
 const boardDist=m=>{const g=m.geometry;if(!g.boundingBox)g.computeBoundingBox();tmpNl.copy(tmpNp);m.worldToLocal(tmpNl);m.getWorldScale(tmpNs);return boxDist(tmpNl,g.boundingBox.min,g.boundingBox.max)*(tmpNs.x||1)}; // metres from the palm to the board's rectangle
 const nearGrabTarget=(c,nm)=>{
  const mine=holdOf(c);if(mine===c||!isHand(c.userData.source))return null; // controllers never; a hand whose palm anchor is not placed yet
  mine.getWorldPosition(tmpNp);
  const o=c.userData.nearC||=NEAR_KINDS.map(kind=>({kind,d:Infinity,ref:null}));
  for(let i=0;i<o.length;i++){o[i].d=Infinity;o[i].ref=null}
  if(ui.open&&!menuHeld&&menu.mesh.parent!==mine)o[0].d=boardDist(menu.mesh);
  if(help.mesh.visible&&!helpHeld&&help.mesh.parent!==mine)o[1].d=boardDist(help.mesh);
  if(hist.isOpen&&!histHeld&&hist.group.parent!==mine)o[2].d=boardDist(hist.board);
  if(huLine.panel.visible&&!huHeld&&huLine.panel.parent!==mine&&!huLine.isDragging())o[3].d=boardDist(huLine.panel);
  if(ev&&ev.mesh.visible&&!evHeld&&ev.mesh.parent!==mine)o[6].d=boardDist(ev.mesh); // the mission board (NEAR_KINDS[6])
  if(vrHalfExt&&section.on){
   for(const pl of planes){
    if(draggedBy(pl,c))continue;
    pl.obj.updateWorldMatrix(true,false);tmpNl.copy(tmpNp);pl.obj.worldToLocal(tmpNl);pl.obj.getWorldScale(tmpNs);const k=tmpNs.x||1;
    const d=Math.min(squareOutlineDist(tmpNl,pl.h),tmpNl.distanceTo(pl.handle.position))*k; // the thin frame line or the number tag
    if(d<o[4].d){o[4].d=d;o[4].ref=pl}
   }
  }
  if(vrHalfExt&&mesh?.parent){tmpNl.copy(tmpNp);mesh.worldToLocal(tmpNl);mesh.getWorldScale(tmpNs);o[5].d=centeredBoxDist(tmpNl,vrHalfExt)*(tmpNs.x||1)} // inside the box = 0
  return pickNearGrab(o,nm);
 };
 const startFistSection=(c,pl)=>{
  if(!pl||!vrHalfExt||!planes.includes(pl)||draggedBy(pl,c))return false;
  const hp=anchorInHolder(c),o=pl.obj,Qp0={x:o.quaternion.x,y:o.quaternion.y,z:o.quaternion.z,w:o.quaternion.w},c0={x:o.position.x,y:o.position.y,z:o.position.z};
  const hand=c.userData.source?.handedness||null;if(hand!==pl.hand){pl.hand=hand;drawHandle(pl,planes.indexOf(pl))}
  if(section.selected!==pl)section.selected=pl;
  const fl=sectionFollowStart({p0:hp.p,q0:hp.q,c0,Qp0});
  emit('section-drag');c.userData.drag={pl,rel:fl.rel,Qrel:fl.Qrel,volTouched:false,fist:true}; // the same drag record as a pinch's (glow, status, draggedBy, snap on release); fist: the palm anchor drives it
  pulse(c,HAPTIC.select.amp,HAPTIC.select.ms);menu.refresh();return true;
 };
 const updateFistDrag=c=>{
  const dg=c.userData.drag;if(!dg||!dg.fist||!vrHalfExt)return;
  const hp=anchorInHolder(c);
  if(twoHand||grabbing.has(c)){const o=dg.pl.obj,f=sectionFollowStart({p0:hp.p,q0:hp.q,c0:o.position,Qp0:o.quaternion});dg.rel=f.rel;dg.Qrel=f.Qrel;return} // this hand's volume grip / a two-hand scale: the section is not moved, the reference is taken again (as in updatePress)
  const r=sectionFollowStep({rel:dg.rel,Qrel:dg.Qrel,p:hp.p,q:hp.q});
  dg.pl.obj.position.set(r.c.x,r.c.y,r.c.z);dg.pl.obj.quaternion.set(r.Qp.x,r.Qp.y,r.Qp.z,r.Qp.w);
 };
 const gripStartNear=(c,t)=>{
  switch(t.kind){
   case'menu':if(ui.open&&!menuHeld){holdOf(c).attach(menu.mesh);menuHeld=c;menuMoving=false;settings.menuMode=1;saveSettings(settings);pulse(c);menu.refresh();return}break;
   case'help':if(!helpHeld){holdOf(c).attach(help.mesh);helpHeld=c;helpMoving=false;settings.help=2;saveSettings(settings);pulse(c);menu.refresh();return}break;
   case'hist':if(!histHeld){holdOf(c).attach(hist.group);histHeld=c;pulse(c);return}break;
   case'hu':if(!huHeld){holdOf(c).attach(huLine.panel);huHeld=c;pulse(c);return}break;
   case'ev':if(!evHeld){holdOf(c).attach(ev.mesh);evHeld=c;pulse(c);return}break;
   case'section':if(startFistSection(c,t.ref))return;break;
   case'volume':grabbing.add(c);regrab();return;
  }
  gripStart(c); // the object went away meanwhile: the laser decides, as before
 };
 // ===== ring menus =====
 const itemOf=id=>WHEEL_ITEMS.find(i=>i.id===id),itemName=id=>id===VIEW_TOGGLE_ID?tr(vt.vrView?'vrToggleToAr':'vrToggleToVr'):id===SECTION_DELETE_ID?tr('vrSecDeleteRing'):id?(ja?itemOf(id).ja:itemOf(id).en):null;
 const ringIds=()=>ringIdsFor(settings.wheel,ar); // AR: the view toggle takes an empty slot of the saved layout, else a last slot (the saved layout itself is not changed)
 const toggleView=c=>{vt.toggle();applyView();if(c)pulse(c,HAPTIC.ringConfirm.amp,HAPTIC.ringConfirm.ms);flashMsg(tr(vt.vrView?'vrToggleNowVr':'vrToggleNowAr'),3500);menu.refresh()};
 const nextSection=()=>{if(planes.length<2)return;const i=planes.indexOf(section.selected);section.selected=planes[(i+1)%planes.length];menu.refresh()};
 const canFlipPlane=pl=>!!pl&&pl.cut&&settings.cut===2; // the 向きを反転 button of the 断面 tab is shown under the same condition
 const flipPlane=pl=>{if(canFlipPlane(pl)){pl.side=-pl.side;pl.aFlash=performance.now()+ARROW_FLASH_MS}}; // the arrow shows for a moment after 「切り口反転」 (the laser is on the menu then, so the plane is not lit)
 const wheelAvail=id=>{
  switch(id){
   case'undo':return undo.size>0||!!secUndo.peek(performance.now()); // also while a deleted section can be restored
   case SECTION_DELETE_ID:return!!(section.on&&section.selected&&planes.includes(section.selected));
   case'section-add':return planes.length<MAX_PLANES;
   case'point-delete':return!!vpSel;
   case'section-next':return planes.length>=2;
   case'snap-axial':case'snap-coronal':case'snap-sagittal':case'section-clip':return!!section.selected;
   case'section-flip':return canFlipPlane(section.selected);
   default:return true;
  }
 };
 const wheelOn=id=>id==='mode-section'?vrPointMode==='section':id==='mode-surface'?vrPointMode==='surface':id==='section-toggle'?section.on:id===VIEW_TOGGLE_ID?vt.vrView:false;
 let wheelKey='';
 const wheelKeyNow=()=>ringIds().map(id=>id?id+(wheelAvail(id)?1:0)+(wheelOn(id)?1:0):'-').join(',');
 const refreshWheel=()=>{const ids=ringIds();wheel.setItems(ids.map(itemName),ids.map(id=>!!id&&wheelAvail(id)),ids.map(id=>!!id&&wheelOn(id)));wheelKey=wheelKeyNow()};
 const lockStick=c=>{c.userData.stickLock=true}; // the thumbstick does not scroll the section until it is back at the centre
 const closeWheel=()=>{if(!wheelOwner)return;lockStick(wheelOwner);wheelOwner=null;wheel.mesh.visible=false};
 const closePointWheel=()=>{if(!pw)return;lockStick(pw.c);pw=null;pointWheel.mesh.visible=false};
 // the quick ring is placed ONCE where it is opened and stays there (world-fixed, facing the head at that moment): WHEEL_FRONT_M in front of the hand
 // along its laser, so the same hand can point at any sector (about 16 degrees to the ring's edge) and pull the trigger; it no longer follows the hand
 const WHEEL_FRONT_M=0.20; // 0.28 -> 0.20 (-29%); // distance in front of the hand (m) where the quick ring is fixed when it opens
 const openWheel=c=>{closeWheel();closePointWheel();wheelOwner=c;c.userData.stick.reset();c.userData.laserHl=null;refreshWheel();wheel.setHighlight(null);
  readHead();setRay(c);tmpRc.copy(raycaster.ray.origin).addScaledVector(raycaster.ray.direction,WHEEL_FRONT_M);wheel.placeAt(tmpRc,head);wheel.mesh.visible=true};
 // the point ring has 「色」; choosing it turns the ring into a palette ring (自動 + the 8 palette colours; the current one is dotted)
 const CTX=ja?{color:'色',auto:'自動',done:'色を変えました',doneAuto:'色を自動に戻しました'}:{color:'Colour',auto:'Auto',done:'Colour changed',doneAuto:'Colour set to auto'};
 const COLOR_IDS=['auto',...POINT_PALETTE.map(p=>p.hex)];
 const pwIds=()=>pw?.mode==='color'?COLOR_IDS:VR_POINT_COMMENT?['move','delete','comment','color','distance']:['move','delete','color','distance'];
 const openColorRing=()=>{
  const c0=getComments().find(x=>x.id===pw?.id);if(!c0)return;
  pw.mode='color';pw.c.userData.stick.reset();
  const cur=normalizeColor(c0.color);
  pointWheel.setItems(COLOR_IDS.map(k=>k==='auto'?{color:'#26313b',text:CTX.auto,name:CTX.auto}:{color:k,name:ja?POINT_PALETTE.find(p=>p.hex===k).ja:POINT_PALETTE.find(p=>p.hex===k).en}),COLOR_IDS.map(()=>true),COLOR_IDS.map(k=>k==='auto'?!cur:k===cur));
  pointWheel.setHighlight(null);
 };
 // set the colour (a hex, or null = auto); one undo step per change
 const changePointColor=(id,hex)=>{
  const c0=getComments().find(x=>x.id===id);if(!c0)return false;
  const from=normalizeColor(c0.color)||null;if(from===hex)return true;
  if(!updateCommentColor(id,hex))return false;
  undo.push({type:'color',id,from,to:hex});vpSel=id;flashMsg(hex?CTX.done:CTX.doneAuto,2500);return true;
 };
 const openPointWheel=(c,id)=>{
  closeWheel();closePointWheel();pw={c,id,mode:'main'};c.userData.stick.reset();c.userData.laserHl=null;
  // fixed at the point where it was opened (a little toward the head, scaled by the distance then); it does not follow the head or the point afterwards
  {const pt=vpMarkers.centres().find(x=>x.id===id);if(pt){readHead();const dist=Math.max(0.05,head.distanceTo(pt.world));tmpRd.subVectors(head,pt.world).normalize();tmpRc.copy(pt.world).addScaledVector(tmpRd,0.02);
   pointWheel.mesh.scale.setScalar(Math.min(2,Math.max(0.6,dist/0.5)));pointWheel.placeAt(tmpRc,head)}}
  const lab={move:L.ptMove,delete:L.ptDelete,comment:L.ptComment,color:CTX.color,distance:L.ptDist},ids=pwIds();
  pointWheel.setItems(ids.map(k=>lab[k]),ids.map(()=>true),[]);pointWheel.setHighlight(null);pointWheel.mesh.visible=true;
 };
 const editComment=id=>{
  if(!VR_POINT_COMMENT)return;const c0=getComments().find(x=>x.id===id);if(!c0)return;
  const inp=document.createElement('input');inp.type='text';inp.value=c0.text;Object.assign(inp.style,{position:'fixed',left:'-9999px',top:'0'});document.body.appendChild(inp);
  inp.addEventListener('change',()=>{updateCommentText(id,inp.value)});inp.addEventListener('blur',()=>inp.remove());inp.focus();
 };
 const wheelDo=(id,c)=>{
  switch(id){
   case'mode-section':vrPointMode='section';break;
   case'mode-surface':vrPointMode='surface';break;
   case'undo':if(secUndo.peek(performance.now()))restoreSection(c);else undoLast();break; // a section deleted in the last FLING_UNDO_MS comes back first
   case SECTION_DELETE_ID:deleteSection(section.selected,{c});break; // the selected / last touched section
   case'section-toggle':setSection(!section.on);break;
   case'section-add':if(planes.length<MAX_PLANES)addPlane(c);break;
   case'point-delete':deletePoint(vpSel);break;
   case'section-next':nextSection();break;
   case'snap-axial':snapPlane(section.selected,0);break;
   case'snap-coronal':snapPlane(section.selected,1);break;
   case'snap-sagittal':snapPlane(section.selected,2);break;
   case'section-clip':{const sp=section.selected;if(sp){sp.cut=!sp.cut;if(sp.cut&&settings.cut===2)chooseSide(sp);menu.refresh()}break}
   case'section-flip':flipPlane(section.selected);break;
   case'home':emit('home');markFront();bringVolumeFront();placeMenuNow();placeHelpNow();if(hist.isOpen)placeHistNow();placeHuNow();break;
   case'screenshot':shotRequested=true;break;
   case'menu':setMenuOpen(!ui.open);break;
   case VIEW_TOGGLE_ID:toggleView(null);break; // confirmWheel already pulsed
  }
  menu.refresh();
 };
 const confirmWheel=(k,c)=>{const id=ringIds()[k];if(!id||!wheelAvail(id))return false;closeWheel();pulse(c,HAPTIC.ringConfirm.amp,HAPTIC.ringConfirm.ms);wheelDo(id,c);return true};
 const confirmPoint=(k,c)=>{
  const key=pwIds()[k],id=pw?.id;if(!key||!id)return false;
  if(pw.mode==='color'){closePointWheel();pulse(c,HAPTIC.ringConfirm.amp,HAPTIC.ringConfirm.ms);changePointColor(id,key==='auto'?null:key);return true}
  if(key==='color'){pulse(c,HAPTIC.ringConfirm.amp,HAPTIC.ringConfirm.ms);openColorRing();return true} // the ring stays open, now showing the palette
  closePointWheel();pulse(c,HAPTIC.ringConfirm.amp,HAPTIC.ringConfirm.ms);
  if(key==='move'){const c0=getComments().find(x=>x.id===id);if(c0){c.userData.moving={id,from:{...c0.position}};flashMsg(L.ptMoveHint,4000)}}
  else if(key==='delete')deletePoint(id);
  else if(key==='comment')editComment(id);
  else if(key==='distance'){ // this point is the START; the next point picked is the END (the same flow as the PC / iPad)
   if(startMeasure(id)){measureHintHand={c,id};pulse(c,HAPTIC.measureStart.amp,HAPTIC.measureStart.ms);flashMsg(L.ptDistStart+(getComments().findIndex(x=>x.id===id)+1)+' · '+L.ptDistHint,5000)}
  }
  return true;
 };
 // the trigger tap while a distance is being made. id: the point under the laser (null = none)
 const endMeasureTap=(c,id)=>{
  if(!id){cancelMeasure();flashMsg(L.ptDistCancel,2000);return}
  const r=pickMeasureEnd(id);
  if(r.kind==='created'){undo.push({type:'measure-add',id:r.m.id});emit('measure-done');pulse(c,HAPTIC.measureEnd.amp,HAPTIC.measureEnd.ms);flashMsg(L.ptDistDone,3500)}
  else if(r.kind==='existed'){pulse(c,HAPTIC.measureEnd.amp,HAPTIC.measureEnd.ms);flashMsg(L.ptDistExists,3000)}
  else if(r.kind==='same')flashMsg(L.ptDistSame,2500); // no vibration: nothing was confirmed (still armed)
  else if(r.kind==='refused')flashMsg(L.ptDistRefused,3000);
  else if(r.kind==='other-series')flashMsg(L.ptDistOther,3000);
 };
 // a tap while moving a point: put it at the place under the laser at the press
 const placeMoved=(c,placement)=>{
  const mv=c.userData.moving;if(!mv||!placement?.voxel)return;
  const f=mv.from,v=placement.voxel;if(f&&f.i===v.i&&f.j===v.j&&f.k===v.k){c.userData.moving=null;return} // the same place: nothing to undo, no pulse
  const r=updateCommentPosition(mv.id,placement.voxel);c.userData.moving=null;if(!r)return;
  undo.push({type:'move',id:mv.id,from:mv.from,to:{...placement.voxel}});vpSel=mv.id;pulse(c,HAPTIC.moveDrop.amp,HAPTIC.moveDrop.ms);flashMsg(L.ptMoved,3000);
 };
 // A/X: short = (cancel a move) / close the point ring / close the quick ring / open the quick ring; long = open / close the menu
 const onAxShort=c=>{
  if(c.userData.moving){c.userData.moving=null;menu.refresh();return}
  if(!pw&&!wheelOwner&&getMeasureStart()){cancelMeasure();flashMsg(L.ptDistCancel,2000);return} // A/X cancels a distance in the making
  if(pw?.c===c){closePointWheel();return}
  if(wheelOwner===c){closeWheel();return}
  openWheel(c);
 };
 const onAxLong=c=>{
  if(wheelOwner===c)closeWheel();if(pw?.c===c)closePointWheel();
  if(!ui.open){setMenuOpen(true);pulseTwice(c)}else{setMenuOpen(false);pulse(c,HAPTIC.menuClose.amp,HAPTIC.menuClose.ms)}
 };
 // the wrist menu of a tracked left hand (vr-hand-view.js), pressed with the other hand's ray + pinch: the same calls as A/X short / long,
 // B/Y short / long and the ring's 取り消し; c = the pressing hand (the quick ring opens in front of it, a new section too)
 const wristDo=(id,c)=>{
  pulse(c,HAPTIC.select.amp,HAPTIC.select.ms);
  switch(id){
   case'ring':onAxShort(c);break;
   case'menu':onAxLong(c);break;
   case'section':setSection(!section.on);break;
   case'add':if(planes.length>=MAX_PLANES){pulse(c,0.15,30);flashMsg(L.maxPlanes,2000)}else{addPlane(c);pulse(c,0.6,50)}break;
   case'undo':wheelDo('undo',c);break;
   case'secDown':case'secUp':if(section.on&&section.selected)c.userData.wristScroll={id,sign:wristScrollSign(id),t0:performance.now()};else pulse(c,0.15,30);break; // held: the loop below adds it to the thumbstick scroll
  }
  menu.refresh();
 };
 const tmpRc=new THREE.Vector3(),tmpRd=new THREE.Vector3();
  const laserLit=(c,h)=>h&&h.slot!==null&&h.slot!==undefined?h.slot:null;
 const updateRings=(c,now,bd)=>{
  const bt=c.userData.source?.gamepad,ax=bt?.axes?.[2]||0,ay=bt?.axes?.[3]||0;
  if(c.userData.stickLock&&Math.hypot(ax,ay)<0.15)c.userData.stickLock=false;
  const isW=wheelOwner===c,isP=pw?.c===c;c.userData.ringHl=null;
  if(isW){
   const k=wheelKeyNow();if(k!==wheelKey)refreshWheel();
   const r=c.userData.stick.update(ax,ay,ringIds().map(id=>!!id&&wheelAvail(id)));
   const lh=laserLit(c,bd?.wheel),hlk=r.highlight!==null?r.highlight:lh; // the stick wins while it is tilted, else the sector under this hand's laser
   wheel.setHighlight(hlk);c.userData.ringHl=hlk;
   if(r.changed||lh!==c.userData.laserHl&&lh!==null)pulse(c,HAPTIC.ringHighlight.amp,HAPTIC.ringHighlight.ms);c.userData.laserHl=lh;
   if(r.confirm!==null)confirmWheel(r.confirm,c);
  }else if(isP){
   const pt=vpMarkers.centres().find(x=>x.id===pw.id);if(!pt){closePointWheel();return}
   const r=c.userData.stick.update(ax,ay,pwIds().map(()=>true));
   const lh=laserLit(c,bd?.pwheel),hlk=r.highlight!==null?r.highlight:lh;
   pointWheel.setHighlight(hlk);c.userData.ringHl=hlk;
   if(r.changed||lh!==c.userData.laserHl&&lh!==null)pulse(c,HAPTIC.ringHighlight.amp,HAPTIC.ringHighlight.ms);c.userData.laserHl=lh;
   if(r.confirm!==null)confirmPoint(r.confirm,c);
  }
 };
 const rates=[...(session.supportedFrameRates||[])].filter(r=>r>=60).sort((a,b)=>a-b);
 const targetRate=()=>session.frameRate||(rates.length?rates[Math.min(settings.rate,rates.length-1)]:72);
 // flicker safety: the render scale / path, the offscreen foveation and the volume variant may not alternate more than a few times a second (vr-flicker-guard.js)
 const scaleGuard=createScaleGuard(),fovGuard=createFlapGuard({fallback:(v,cur)=>cur}),variantGuard=createFlapGuard({fallback:variantFallback});let guardFreezes=0;
 const aq=createAutoQuality({min:autoFloor(settings.autoMin),baseStep:settings.quality|0});let autoFrames=0,autoAt=performance.now(); // starts at 100 % (72 fps there at the default size) and only drops when the frames say so
 let frames=0,fpsAt=performance.now(),fps=0;
 // benchmark — 12 phases (3 sizes × shown segments / bone only × 100 % / 50 %), 0.8 s settle + 2 s count each;
 // the state is restored afterwards and the result goes to the 画質 tab, the console, localStorage (vrl-vr-bench) and a
 // panel on the page after the session
 const bench={active:false,phases:[],i:-1,at:0,measureAt:0,frames:0,results:[],saved:null,noSection:false,tempPlane:null,plane:null,planeBase:null,t0:0};
 const shownLabel=modes=>SEGMENT_PRESET_ORDER.filter(k=>segAvail(segmentState[k])&&(modes[k]|0)!==2).map(k=>tr(k)).join('+')||'-';
 // analysis cost bench — four phases at the current size, resolution and view (0.8 s settle + 2 s count each):
 // as is / no result colours / no laser march and labels / neither; with labels on, both hands' rays are replaced by a
 // ray from the head to the volume centre so a label is drawn and placed every frame as when pointing at the volume
 const anBench={active:false,i:-1,at:0,measureAt:0,frames:0,results:[],phases:[{noRegion:false,noLabels:false},{noRegion:true,noLabels:false},{noRegion:false,noLabels:true},{noRegion:true,noLabels:true}]};
 const startAnBench=()=>{if(anBench.active||bench.active||!mesh)return;anBench.results=[];anBench.i=-1;anBench.active=true;anBenchNext()};
 const anBenchNext=()=>{anBench.i++;if(anBench.i>=anBench.phases.length){anBenchFinish();return}Object.assign(diagAn,anBench.phases[anBench.i]);anBench.at=performance.now();anBench.measureAt=0;anBench.frames=0;ui.benchLine=L.benchRun+(anBench.i+1)+' / '+anBench.phases.length;menu.refresh()};
 const anBenchTick=()=>{
  if(!anBench.active)return;const now=performance.now();
  if(!diagAn.noLabels){readHead();holder.getWorldPosition(tmpLb);raycaster.ray.origin.copy(head);raycaster.ray.direction.subVectors(tmpLb,head).normalize();
   for(const c of controllers){const hit=volumeHitRay();if(hit){const lb=hoverLabelOf(c);drawLabel(lb,hit,true);lb.anchor.copy(hit.local);placeLabel(lb)}}}
  if(!anBench.measureAt){if(now-anBench.at>=800){anBench.measureAt=now;anBench.frames=0}return}
  anBench.frames++;if(now-anBench.measureAt>=2000){anBench.results.push(anBench.frames*1000/(now-anBench.measureAt));anBenchNext()}
 };
 const anBenchFinish=()=>{
  anBench.active=false;diagAn.noRegion=false;diagAn.noLabels=false;const f=i=>anBench.results[i]!=null?Math.round(anBench.results[i]):'-';
  const line=(ja?'解析の重さ: そのまま ':'analysis cost: as is ')+f(0)+(ja?' / 結果の色なし ':' / no result colours ')+f(1)+(ja?' / 札・レーザー判定なし ':' / no labels or laser march ')+f(2)+(ja?' / 両方なし ':' / neither ')+f(3)+' fps · '+(ja?'結果 ':'results ')+regionList.length+(material?.defines?.VRL_REGIONS!==undefined?' (VRL_REGIONS)':'')+' · '+(ja?'札 ':'pins ')+pins.size+' · '+(holder.scale.x*3.3*100).toFixed(1)+' cm · '+(VRES[settings.vres]?Math.round(VRES[settings.vres]*100)+'%':L.auto);
  const headLine=(ja?'VR 解析ベンチ build ':'VR analysis bench build ')+APP_BUILD+' · '+targetRate()+' Hz';
  lastBench={head:headLine,lines:[line],when:Date.now()};try{localStorage.setItem('vrl-vr-bench',JSON.stringify(lastBench))}catch{}
  console.log('[VR analysis bench]',headLine,line);ui.benchLine=line;menu.refresh();
 };
 const startBench=()=>{
  if(bench.active||!mesh)return;
  endAllDrags();
  const canShow=k=>segAvail(segmentState[k]);
  bench.phases=[];for(const s of [0.165,0.3])for(const g of ['cur','bonefat','bone'])for(const r of [1,3]){if(g==='bonefat'&&!(canShow('bone')&&canShow('fat')))continue;bench.phases.push({s,g,r,sec:1})}
  bench.tempPlane=planes.length<MAX_PLANES?addPlane(null,planes.length===0):null;bench.plane=bench.tempPlane||planes[0];bench.planeBase=bench.plane.obj.position.clone();bench.noSection=false;bench.t0=performance.now();
  bench.saved={scale:holder.scale.x,vres:settings.vres,segMode:{...segMode},pos:holder.position.clone(),quat:holder.quaternion.clone()};
  bench.results=[];bench.i=-1;bench.active=true;nextBenchPhase();
 };
 const nextBenchPhase=()=>{
  bench.i++;if(bench.i>=bench.phases.length){finishBench();return}
  const ph=bench.phases[bench.i];
  bringVolumeFront();holder.scale.setScalar(ph.s/3.3);bench.noSection=!ph.sec;
  for(const key of SEGMENT_PRESET_ORDER){const sv=bench.saved.segMode[key]|0;segMode[key]=ph.g==='cur'?sv:(ph.g==='bone'?(key==='bone'?(sv===2?0:sv):2):((key==='bone'||key==='fat')?(sv===2?0:sv):2))}
  settings.vres=ph.r;applyQuality();
  bench.at=performance.now();bench.measureAt=0;bench.frames=0;
  ui.benchLine=L.benchRun+(bench.i+1)+' / '+bench.phases.length;menu.refresh();
 };
 const benchTick=()=>{
  if(!bench.active)return;const now=performance.now();
  // motion: the volume turns at 0.5 rad/s, the plane sweeps ±0.5 of the volume along its normal at 0.4 Hz
  const tt=(now-bench.t0)/1000;holder.quaternion.copy(bench.saved.quat);holder.rotateY(0.5*tt);
  if(bench.plane){tmpB.set(1,0,0).applyQuaternion(bench.plane.obj.quaternion);bench.plane.obj.position.copy(bench.planeBase).addScaledVector(tmpB,0.5*Math.sin(2*Math.PI*0.4*tt))}
  if(!bench.measureAt){if(now-bench.at>=800&&!comboT?.rb?.busy){bench.measureAt=now;bench.frames=0}return} // a phase that changed the shown segments is counted once their texture is rebuilt (it was synchronous)
  bench.frames++;
  if(now-bench.measureAt>=2000){const ph=bench.phases[bench.i];bench.results.push({...ph,fps:bench.frames*1000/(now-bench.measureAt)});nextBenchPhase()}
 };
 const finishBench=()=>{
  const sv=bench.saved;bench.active=false;bench.noSection=false;if(bench.plane&&!bench.tempPlane)bench.plane.obj.position.copy(bench.planeBase);if(bench.tempPlane){removePlane(bench.tempPlane);bench.tempPlane=null}bench.plane=null;
  Object.assign(segMode,sv.segMode);settings.vres=sv.vres;applyQuality();
  holder.position.copy(sv.pos);holder.quaternion.copy(sv.quat);holder.scale.setScalar(sv.scale);
  const cur=shownLabel(sv.segMode),rate=targetRate(),f=(s,g,r)=>{const x=bench.results.find(e=>e.s===s&&e.g===g&&e.r===r);return x?Math.round(x.fps):'-'};
  const lines=[];for(const sz of [0.165,0.3])lines.push((sz*100).toFixed(1).replace('.0','')+' cm '+(ja?'断面を動かしながら: ':'moving section: ')+cur+' 100% '+f(sz,'cur',1)+' / 50% '+f(sz,'cur',3)+' · '+tr('bone')+'+'+tr('fat')+' 100% '+f(sz,'bonefat',1)+' / 50% '+f(sz,'bonefat',3)+' · '+tr('bone')+' 100% '+f(sz,'bone',1)+' / 50% '+f(sz,'bone',3)+' fps');
  const head=(ja?'VR ベンチ build ':'VR benchmark build ')+APP_BUILD+' · '+rate+' Hz · '+(ja?'自動解像度の既定サイズ ':'default size ')+(baseScale*3.3*100).toFixed(1)+' cm';
  lastBench={head,lines,when:Date.now()};
  try{localStorage.setItem('vrl-vr-bench',JSON.stringify(lastBench))}catch{}
  console.log('[VR bench]',head,lines);
  ui.benchLine=lines.join(' | ');menu.refresh();
 };
 const applyQuality=()=>{
  if(material){aq.setFloor(autoFloor(settings.autoMin));aq.setBaseStep(settings.quality|0);material.uniforms.stepSize.value=baseStep*(STEP[VRES[settings.vres]?settings.quality:aq.stepIdx]??1);material.uniforms.diag.value=settings.diag|0;material.uniforms.refine.value=settings.refine|0;useData(settings.data|0)}
  renderer.xr.setFoveation?.(FOVEATION[settings.foveation]??1);
  if(rates.length&&session.updateTargetFrameRate)session.updateTargetFrameRate(rates[Math.min(settings.rate,rates.length-1)]).catch(()=>{});
  saveSettings(settings);frames=0;fpsAt=performance.now();
 };
 // VR self-check (vr-self-check.js). Scenarios: 基準 / 回転 / 断面 / 再描画 / 拡大 2倍・4倍・最大・最大 90°静止・接近 (+ whatever other modules register); env = what they may touch
 const SC=selfCheckTexts(ja),selfCheck=createVrSelfCheck({ja,getTargetHz:targetRate,meta:{build:APP_BUILD},onChange:()=>menu.refresh(),storage:{setItem:(k,v)=>{try{localStorage.setItem(k,v)}catch{}}},env:{holder,
  ready:()=>!mesh||!material?(ja?'ボリュームがありません':'No volume'):bench.active||anBench.active?(ja?'ベンチ実行中です':'A benchmark is running'):'',
  begin:()=>{endAllDrags();const sv={pos:holder.position.clone(),quat:holder.quaternion.clone(),scale:holder.scale.x,sm:{...segMode}};bringVolumeFront();return()=>{holder.position.copy(sv.pos);holder.quaternion.copy(sv.quat);holder.scale.setScalar(sv.scale);Object.assign(segMode,sv.sm)}},
  zoom:(()=>{let sv=null;const lm=()=>realLongMm(),s1=()=>startHolderScale(lm(),baseScale);return{
   info:()=>{if(!mesh||!material)return null;const lim=scaleLimits(lm());return{maxMag:lim.max/s1(),locked:lim.locked}},
   begin:()=>{sv={pos:holder.position.clone(),scale:holder.scale.x}},
   set:(mag,close)=>{holder.scale.setScalar(clampScale(s1()*mag,lm()));if(close){readHead();holder.position.copy(head).addScaledVector(headFwd,0.75*holder.scale.x*NORM_LONG)}}, // close-up: the longest side 0.75 x its length in front of the eyes (about 60 degrees of view)
   end:()=>{if(sv){holder.position.copy(sv.pos);holder.scale.setScalar(sv.scale);sv=null}}}})(),
  info:()=>({autoPct:Math.round(aq.f*100),vres:VRES[settings.vres]||0,sections:planes.length, // effective scale, data-resolution cap, auto level, periphery, covered px (both eyes), screen px per voxel (centre / far corner)
   effPct:Math.round(rs.eff*100),capPct:Math.round(rs.cap*100),levelPct:Math.round(aq.level*100),periPct:Math.round(rs.eff*rs.per*100),coverPx:Math.round(rs.cover),ppv:Number.isFinite(rs.ppv)?Math.round(rs.ppv*100)/100:null,ppvFar:Number.isFinite(rs.ppvFar)?Math.round(rs.ppvFar*100)/100:null,mag:+(holder.scale.x/startHolderScale(realLongMm(),baseScale)).toFixed(2),
   // the data grid in use and the content box (% of the data box per axis; null = the full box)
   grid:material?[material.uniforms.texDims.value.x,material.uniforms.texDims.value.y,material.uniforms.texDims.value.z].join('×'):null,boxPct:material&&material.uniforms.boxH.value.x>0&&vrHalfExt?[0,1,2].map(a=>Math.round(material.uniforms.boxH.value.getComponent(a)/vrHalfExt[a]*100)):null,
   boxMs:cbStat.frames?cbStat.ms:null,boxFrames:cbStat.frames||null,boxSliceMs:cbStat.sliceMs}), // the last segment scan (ms summed over its frames) and the last slice update
  // ray probe for the self-check (vr-self-check.js probeAfter): taken on the next frame (measureSamples: a 48×48 diag-5 render read back synchronously), resolved one frame later
  probe:()=>new Promise(res=>{if(!mesh||!material||!rayMesh)return res(null);probeReq={res,stage:0,out:null}}),
  sectionSweep:(()=>{let tmp=null,pl=null,base=null,wasOn=false;return{
   begin:()=>{if(!material||!vrHalfExt)return null;sweepOn=true;wasOn=section.on;tmp=planes.length<MAX_PLANES?addPlane(null,planes.length===0):null;pl=tmp||planes[0];if(!pl){sweepOn=false;return null}base=pl.obj.position.clone();return{set:u=>{tmpB.set(1,0,0).applyQuaternion(pl.obj.quaternion);pl.obj.position.copy(base).addScaledVector(tmpB,u*0.8*vrHalfExt[0])}}},
   end:()=>{if(pl&&!tmp)pl.obj.position.copy(base);if(tmp)removePlane(tmp);if(!wasOn&&planes.length)setSection(false);tmp=pl=null;sweepOn=false}}})(),
  renderToggle:(()=>{let sv={};return{begin:()=>{sv={...segMode}},set:on=>{for(const k in sv)segMode[k]=sv[k]===2?2:on?1:sv[k]},end:()=>{Object.assign(segMode,sv)}}})()}});
 selfCheck.env.histogram={isOpen:()=>hist.isOpen,open:()=>setHistOpen(true),close:()=>setHistOpen(false),forceCompute:histForce,busy:()=>labelHist.busy}; // ヒストグラム scenario (vr-histogram-panel.js)
 // HU線 scenario (vr-hu-line.js): the synthetic laser (huSynth) stretches a line across the middle of the data (20 % -> 80 % of the columns and rows,
 // the middle slice), then releases it (full read timed by the scenario); cancel() puts the line, the panel and the armed state back (huLine.restoreState)
 selfCheck.env.huLine={
  beginDrag:()=>{if(!vrDims)return ja?'データなし':'no data';huSynth.placed=huPlaced;huSynth.snap=huLine.snapshot();huLine.setArmed(true,true);const{columns:C,rows:R,slices:S}=vrDims,k=Math.round((S-1)/2);
   huSynth.a.i=Math.round(0.2*(C-1));huSynth.a.j=Math.round(0.3*(R-1));huSynth.a.k=k;huSynth.b.i=Math.round(0.8*(C-1));huSynth.b.j=Math.round(0.7*(R-1));huSynth.b.k=k;
   huSynth.v.i=huSynth.a.i;huSynth.v.j=huSynth.a.j;huSynth.v.k=k;return huLine.start(huSynth.c)?'':(ja?'線を引けません':'cannot draw a line')},
  moveTo:u=>{const A=huSynth.a,B=huSynth.b;huSynth.v.i=Math.round(A.i+(B.i-A.i)*u);huSynth.v.j=Math.round(A.j+(B.j-A.j)*u)},
  release:()=>{huSynth.v.i=huSynth.b.i;huSynth.v.j=huSynth.b.j;huLine.end(huSynth.c)},
  reading:()=>huLine.isReading(),
  cancel:()=>{if(huSynth.snap){huLine.restoreState(huSynth.snap);huSynth.snap=null;if(!huSynth.placed)huPlaced=false}}}; // never placed before: the next real line places it afresh
 menu.onDraw(()=>{
  const w=[],X=40,btn=(x,y,wd,label,on,action,extra={})=>w.push({type:'button',x,y,w:wd,h:72,label,on,action,...extra});
  const label=(x,y,text,extra={})=>w.push({type:'label',x,y,text,...extra});
  // choice row: name on the left, equal buttons on the right
  const CX=330,choice=(y,text,options,value,set)=>{label(X,y+36,text);const bw=Math.min(220,(MENU_W-X-CX-(options.length-1)*12)/options.length);options.forEach((o,i)=>btn(CX+i*(bw+12),y,bw,o.label,o.value===value,()=>{set(o.value)}))};
  // header
  label(X,52,L.title,{bold:true,size:36,color:'#fff'});
  btn(780,18,200,L.close,false,()=>setMenuOpen(false),{size:28});
  if(evMenu&&ui.tab!==10)btn(560,18,200,tr('evSimple'),false,()=>{ui.tab=10},{size:28}); // back to the かんたん menu
  // tabs
  // six tabs (解析 added) share the width
  if(ui.tab!==10){const tw=(MENU_W-2*X)/L.tabs.length,TAB_IDS=[0,1,2,3,4,5,6,9,11]; // the 8th tab (HU線);: it is tab 9 (7 is the quick ring editor, 8 the self-check page: neither in the bar)
   L.tabs.forEach((t,i)=>{const id=TAB_IDS[i];btn(X+i*tw,110,tw-12,t+(i===1&&section.on?' ●':'')+(id===9&&huLine.isArmed()?' ●':''),ui.tab===id,()=>{ui.tab=id},{size:L.tabs.length>8?22:L.tabs.length>7?24:28})})}
  const status=ui.flash&&performance.now()<ui.flashUntil?ui.flash:ui.status;
  label(X,ui.tab===10?SIMPLE_MENU.STATUS:228,status,{color:'#ffd27a'}); // the かんたん menu has no tab bar: its status line sits higher (SIMPLE_MENU)
  const y0=270;
  if(ui.tab===10){
   // 体験会 かんたん menu, the same for every level and dataset (layout and widget ids: event-mode.js simpleMenuLayout): 表示 / 非表示 per shown segment of the
   // loaded data, 断面, the mode switch (ポイントモード / 解析モード, only with analysis results), the analysis results (volumes), 正面に戻す / 元に戻す / すべての設定 / VR・AR 終了.
   // No advanced settings here.
   const act=SEGMENT_PRESET_ORDER.filter(k=>segAvail(segmentState[k])),keys=simpleMenuSegments(act),sn=spacingNote(),hasRes=regionList.length>0;
   const goHome=()=>{emit('home');markFront();bringVolumeFront();placeMenuNow();placeHelpNow();if(hist.isOpen)placeHistNow();placeHuNow()};
   const acts={section:v=>setSection(v),'trigger:point':()=>{evLabels=false},'trigger:label':()=>{evLabels=true;emit('trigger-label')},undo:()=>{undoLast()},home:goHome,reset:pressReset,all:()=>{ui.tab=0},exit:()=>session.end()};
   for(const l of EVENT_LEVELS)acts['level:'+l.id]=()=>swapPress(l.sample); // the data / level switch (arm, then switch)
   for(const key of keys)acts['seg:'+key]=v=>{emit('seg-toggle');const was=segMode[key]|0;segMode[key]=v?(was===2?0:was):2;if(v&&was===2)emit('seg-show');else if(!v&&was!==2)emit('seg-hide')}; // seg-hide / seg-show = the tissue really went hidden / shown (tutorial ステップ4)
   const simple=simpleMenuLayout({segments:keys.map(k=>({key:k,name:tr(k),color:segmentState[k].color,on:segMode[k]!==2})),sectionOn:section.on,sliceOpacity:settings.sliceOpacity,trigger:{show:triggerModeRow(hasRes),label:evLabelOn()},
    results:regionList.map(r=>({hex:'#'+r.color.toString(16).padStart(6,'0'),name:String(r.rid)+'. '+r.segmentKeys.map(k2=>tr(k2)).join('+'),text:vrVolumeText(r.mm3,sn)})),total:(sn?sn.mark+' ':'')+regionList.reduce((a,r)=>a+r.mm3,0).toFixed(2)+' mm³',resetArmed:resetArmed(ui.resetUntil||0,performance.now()),levels:eventModeOn()&&practiceOpen()?{items:levelSwitchItems(tr,globalThis.__vrlOpenSample,levelForSample(swapArmedId())?.id??null),busy:ui.swapBusy,hint:swapArmedId()?L.dataHint+levelNameOf(swapArmedId()):'',text:{title:L.dataT,again:L.dataAgain}}:null, // 元に戻す is always pressable: with nothing to undo it only says so (undoLast)
    text:{show:tr('evShow'),hide:tr('evHide'),section:L.sec,sliceOpacity:L.sl,trigger:tr('evMode'),trigPoint:tr('evModePoint'),trigLabel:tr('evModeAnalysis'),trigHintPoint:tr('evModeHintPoint'),trigHintLabel:tr('evModeHintAnalysis'),results:L.anT,total:L.anTotal,noSeg:L.noSeg,home:L.home,undo:L.ptUndo,reset:tr('evReset'),resetAgain:tr('evResetAgain'),all:tr('evAllSettings'),exit:tr(mode==='ar'?'evExitAr':'evExitVr')}});
   for(const it of simple){
    if(it.type==='label')label(it.x,it.y,it.text,{bold:it.bold,size:it.size,color:it.color});
    else if(it.type==='slider')w.push({...it,set:v=>{ui.sliceClear=false;settings.sliceOpacity=sliceOpacityValue(v);emit('slice-opacity')}}); // the full menu's slider widget (drag: trigger or pinch; saved on release), same setting as the スライス tab
    else{const m=/^(.+):(show|hide)$/.exec(it.id),action=m?()=>acts[m[1]]?.(m[2]==='show'):()=>acts[it.id]?.();w.push({...it,action})}
   }
   if(tutVr&&!tutBad){try{const an=menuAnnotation(w,tutVr.menuTarget(),tutVr.menuPhase());if(an)w.push(an);tutMenuRect=menuTargetRect(w,tutVr.menuTarget());if(tutMenuRect?.key)tutVr.setTissue(tr(tutMenuRect.key))}catch(e){tutFail(e)}} // the tutorial step's widget pulses with an arrow (the 非表示 / 表示 of a tissue, the slider knob)
  }else if(ui.tab===0){
   const active=SEGMENT_PRESET_ORDER.filter(k=>segAvail(segmentState[k])); // only the shown ones (at most 4 rows; a switched-off segment has nothing to set)
   if(!active.length)label(X,y0+40,L.noSeg);
   active.forEach((key,i)=>{const seg=segmentState[key],y=y0+i*76,m=segMode[key]|0;label(X,y+36,tr(key),{color:seg.color||'#fff',bold:true,size:28});
    L.segModes.forEach((t,j)=>btn(250+j*160,y,150,t,m===j,()=>{emit('seg-toggle');if(j===2&&m!==2)emit('seg-hide');else if(j!==2&&m===2)emit('seg-show');segMode[key]=j},{color:j===0?seg.color:undefined,size:28}));});
   const yb=MENU_H-110;
   // 持ち方 moved here from the 断面 tab (room for the snap row)
   choice(yb-400,L.helpT,L.helpModes.map((t,i)=>({label:t,value:i})),settings.help|0,v=>{settings.help=v;saveSettings(settings);if(v===1)helpMoving=true});
   {const hy=yb-480;btn(X,hy,230,L.hist,hist.isOpen,()=>setHistOpen(!hist.isOpen),{size:28}); // the board counts the VR data itself (フィルター後 / 元の値 no longer apply to it)
    const lg=getHistogramLog();btn(X+242,hy,130,L.histLin,!lg,()=>{setHistogramLog(false);hist.invalidate()},{size:26});btn(X+382,hy,130,L.histLog,lg,()=>{setHistogramLog(true);hist.invalidate()},{size:26})}
   btn(X,yb-320,520,L.wheelEdit,false,()=>{ui.tab=7;menu.refresh()},{size:28});
   {const lk=scaleLimits(realLongMm()).locked;btn(X+540,yb-320,MENU_W-2*X-540,lk?L.realSizeNo:L.realSize,false,()=>setRealSize(),{size:lk?22:28,disabled:lk})}
   choice(yb-240,L.menuPos,[{label:L.follow,value:0},{label:L.fixed,value:1}],settings.menuMode,v=>{settings.menuMode=v;saveSettings(settings)});
   // with hands the two controller lines give way to the hand laser's choice (標準 / 指差し) (the device setting handRay, also in 設定 > 描画 on the page); with controllers: the lines as before
   choice(yb-160,L.laserL,L.laserV.map((t,i)=>({label:t,value:i})),laserLookOf(settings.laserStyle),v=>{settings.laserStyle=v;saveSettings(settings)}); // 線 / 帯・細 / 帯・太 (rows are 80 px apart from here down so this one fits above the hand-laser row)
   if(handIn.anyHand())choice(yb-80,L.hrT,L.hrV.map((t,i)=>({label:t,value:HAND_RAY_MODES[i]})),handRayMode(),v=>setHandRayMode(v));
   else{label(X,yb-66,L.menuKey,{size:26,color:'#9fb3c3'});label(X,yb-32,L.menuGrab,{size:26,color:'#9fb3c3'})}
   btn(X,yb,300,L.home,false,()=>{markFront();bringVolumeFront();placeMenuNow();placeHelpNow();if(hist.isOpen)placeHistNow();placeHuNow();emit('home')});btn(X+320,yb,320,L.shot,false,()=>{shotRequested=true});btn(MENU_W-X-260,yb,260,L.exit,true,()=>session.end(),{color:'#b33'});
  }else if(ui.tab===1){
   choice(y0,L.sec,[{label:L.offOn[0],value:false},{label:L.offOn[1],value:true}],section.on,v=>{if(v!==section.on)setSection(v)});
   if(planes.length<MAX_PLANES)btn(800,y0,184,L.addPlane,false,()=>{addPlane()},{size:26});
   // one row per plane: colour name, clip on/off, flip (one-side), remove
   // up to 10 planes, listed 4 rows at a time (the rest of the tab keeps its place); the page follows the selected plane, ▲▼ turn it
   const si=planes.indexOf(section.selected);if(ui.secSeen!==section.selected){ui.secSeen=section.selected;if(si>=0)ui.secPage=pageOfPlane(si)}
   const pg=sectionPage(planes.length,ui.secPage);ui.secPage=pg.page;
   if(pg.pages>1){
    btn(810,y0+86,174,'▲',false,()=>{ui.secPage=pg.page-1;menu.refresh()},{size:26,disabled:pg.page<=0});
    label(822,y0+86+76+36,(pg.from+1)+'–'+pg.to+' / '+planes.length,{size:24,color:'#9fb3c3'});
    btn(810,y0+86+152,174,'▼',false,()=>{ui.secPage=pg.page+1;menu.refresh()},{size:26,disabled:pg.page>=pg.pages-1});
   }
   planes.forEach((pl,i)=>{if(i<pg.from||i>=pg.to)return;const y=y0+86+(i-pg.from)*76,col='#'+pl.color.toString(16).padStart(6,'0');
    // the name is a button that selects the plane (thumbstick target)
    btn(X,y,190,L.planeN+(i+1),pl===section.selected,()=>{section.selected=pl},{color:col,size:26});
    btn(250,y,190,pl.cut?L.clipOn:L.clipOff,pl.cut,()=>{pl.cut=!pl.cut;if(pl.cut&&settings.cut===2)chooseSide(pl)},{color:col,size:26});
    if(canFlipPlane(pl))btn(452,y,170,L.flip,false,()=>flipPlane(pl),{size:26});
    btn(640,y,150,L.remove,false,()=>deleteSection(pl),{size:26}); // undoable (the 「元に戻す」 board)
   });
   const yb2=y0+86+SECTION_ROWS_PER_PAGE*76; // 4 rows, as with the old 4-plane limit
   // snap: the selected plane onto axial / coronal / sagittal
   label(X,yb2+36,L.snapL);
   const sp=section.selected;if(sp)L.snapModes.forEach((t,i)=>btn(CX+i*152,yb2,140,t,planeAxis(sp)===i,()=>snapPlane(sp,i),{size:26}));
   // clip mode with a one-line explanation (the flip button was
   // not found; the slice sliders moved to the スライス tab)
   choice(yb2+90,L.cut,L.cutModes.map((t,i)=>({label:t,value:i})),settings.cut|0,v=>{if(v===2&&settings.cut!==2)planes.forEach(chooseSide);settings.cut=v;saveSettings(settings)});
   label(X,yb2+190,L.cutHelp[settings.cut|0]||'',{size:26,color:'#9fb3c3'});
   choice(yb2+220,L.cap,[{label:L.offOn[0],value:0},{label:L.offOn[1],value:1}],settings.cap?1:0,v=>{settings.cap=v;saveSettings(settings)});
   label(X,yb2+340,section.on?L.secHelp:L.secOff,{size:24});
   label(X,yb2+376,L.byHelp,{size:24,color:'#9fb3c3'});
   label(X,yb2+412,L.scrollHelp[0],{size:24,color:'#9fb3c3'});label(X,yb2+446,L.scrollHelp[1],{size:24,color:'#9fb3c3'});
  }else if(ui.tab===2){
   // VR-local window: slider 0..1 over the app's slider range, presets set it as given
   const cr=[+wc.min,+wc.max],[cMin,cMax]=Number.isFinite(cr[0])&&Number.isFinite(cr[1])&&cr[0]<cr[1]?cr:[-2000,4000],wMax=Number.isFinite(+ww.max)&&+ww.max>1?+ww.max:8000,cl=(v,a,b)=>Math.min(b,Math.max(a,v));
   label(X,y0+10,L.win,{size:26,color:'#9fb3c3'});
   label(X,y0+80,L.sl);w.push({type:'slider',x:CX+26,y:y0+44,w:300,h:72,value:settings.sliceOpacity,text:Math.round(settings.sliceOpacity*100)+'%',set:v=>{ui.sliceClear=false;settings.sliceOpacity=Math.round(v*20)/20;emit('slice-opacity')}});
   label(X,y0+162,L.tint);w.push({type:'slider',x:CX+26,y:y0+126,w:300,h:72,value:settings.sliceTint,text:settings.sliceTint?Math.round(settings.sliceTint*100)+'%':L.offOn[0],set:v=>{settings.sliceTint=Math.round(v*20)/20}});
   const row=(y,text,key,lo,hi)=>{label(X,y+36,text);const floor=key==='w'?1:-Infinity;w.push({type:'slider',x:CX+26,y,w:300,h:72,value:cl((vrWindow[key]-lo)/(hi-lo),0,1),text:String(Math.round(vrWindow[key])),set:v=>{vrWindow[key]=Math.max(floor,Math.round((lo+v*(hi-lo))/WIN_STEP)*WIN_STEP)}});
    btn(800,y,70,'−',false,()=>{vrWindow[key]=Math.max(floor,cl(vrWindow[key]-WIN_STEP,lo,hi))},{size:30});btn(890,y,70,'＋',false,()=>{vrWindow[key]=Math.max(floor,cl(vrWindow[key]+WIN_STEP,lo,hi))},{size:30})};
   row(y0+216,L.wcL,'c',cMin,cMax);row(y0+298,L.wwL,'w',1,wMax);
   [[L.pApp,+wc.value||0,Math.max(1,+ww.value||1)],[L.pFull,Math.round((cMin+cMax)/2),Math.max(1,Math.round(cMax-cMin))],[L.pBone,500,2000],[L.pSoft,40,400]].forEach(([t,c,wd],i)=>btn(X+i*244,y0+390,232,t,vrWindow.c===c&&vrWindow.w===wd,()=>{vrWindow.c=c;vrWindow.w=wd},{size:28}));
   label(X,y0+490,L.winHelp,{size:24,color:'#9fb3c3'});
   choice(y0+650,L.ctSh,[{label:L.ctShV[0],value:0},{label:L.ctShV[1],value:1}],settings.ctShade?1:0,v=>{settings.ctShade=v;saveSettings(settings)});
   {const b=ctBrightOf(settings.ctShadeBright);label(X,y0+770,L.ctBr);w.push({type:'slider',x:CX+26,y:y0+734,w:300,h:72,value:(b-CT_BRIGHT_MIN)/(CT_BRIGHT_MAX-CT_BRIGHT_MIN),text:Math.round(b*100)+'%',set:v=>{settings.ctShadeBright=ctBrightOf(CT_BRIGHT_MIN+v*(CT_BRIGHT_MAX-CT_BRIGHT_MIN))}}); // saved on release, like the other sliders
    btn(800,y0+734,70,'−',false,()=>{settings.ctShadeBright=ctBrightOf(b-CT_BRIGHT_STEP);saveSettings(settings)},{size:30});btn(890,y0+734,70,'＋',false,()=>{settings.ctShadeBright=ctBrightOf(b+CT_BRIGHT_STEP);saveSettings(settings)},{size:30})}
   // 濃淡のコントラスト, the row right below 濃淡の明るさ (the slice-tab rows above were packed closer to make room)
   {const c=ctContrastOf(settings.ctShadeContrast);label(X,y0+854,L.ctCo);w.push({type:'slider',x:CX+26,y:y0+818,w:300,h:72,value:(c-CT_CONTRAST_MIN)/(CT_CONTRAST_MAX-CT_CONTRAST_MIN),text:Math.round(c*100)+'%',set:v=>{settings.ctShadeContrast=ctContrastOf(CT_CONTRAST_MIN+v*(CT_CONTRAST_MAX-CT_CONTRAST_MIN))}}); // saved on release, like the other sliders
    btn(800,y0+818,70,'−',false,()=>{settings.ctShadeContrast=ctContrastOf(c-CT_CONTRAST_STEP);saveSettings(settings)},{size:30});btn(890,y0+818,70,'＋',false,()=>{settings.ctShadeContrast=ctContrastOf(c+CT_CONTRAST_STEP);saveSettings(settings)},{size:30})}
   {const lo=AIR_MIN,hi=AIR_MAX,a=Number.isFinite(+settings.sliceAir)?+settings.sliceAir:DEFAULTS.sliceAir,put=v=>{settings.sliceAir=cl(Math.round(v/WIN_STEP)*WIN_STEP,lo,hi)};
    label(X,y0+556,L.airL);w.push({type:'slider',x:CX+26,y:y0+520,w:300,h:72,value:cl((a-lo)/(hi-lo),0,1),text:a+' HU',set:v=>put(lo+v*(hi-lo))});
    btn(800,y0+520,70,'−',false,()=>put(a-WIN_STEP),{size:30});btn(890,y0+520,70,'＋',false,()=>put(a+WIN_STEP),{size:30});
    label(X,y0+618,L.airHelp,{size:24,color:'#9fb3c3'})}
  }else if(ui.tab===3){
   choice(y0,L.r,VRES.map((r,i)=>({label:r?Math.round(r*100)+'%':L.auto,value:i})),settings.vres,v=>{settings.vres=v;applyQuality()});
   choice(y0+90,L.am,L.amv.map((t,i)=>({label:t,value:i})),settings.autoMin|0,v=>{settings.autoMin=v;applyQuality()});
   choice(y0+180,L.dt,[{label:'256³',value:1},{label:'512³',value:0}],settings.data,v=>{settings.data=v;applyQuality()});
   choice(y0+270,L.q,L.qv.map((t,i)=>({label:t,value:i})),settings.quality,v=>{settings.quality=v;applyQuality()});
   choice(y0+360,L.f,L.fv.map((t,i)=>({label:t,value:i})),settings.foveation,v=>{settings.foveation=v;applyQuality()});
   if(rates.length>1)choice(y0+450,L.hz,rates.slice(0,4).map((r,i)=>({label:r+' Hz',value:i})),settings.rate,v=>{settings.rate=v;applyQuality()});
   if(ui.qualityLine)label(X,y0+735,ui.qualityLine,{size:24,color:'#cfe3f0'});
   btn(X,y0+550,460,L.bench,bench.active,()=>startBench(),{size:28});btn(X+480,y0+550,440,L.anBench,anBench.active,()=>startAnBench(),{size:28});if(ui.benchLine)label(X,y0+650,ui.benchLine,{size:26,color:'#9fb3c3'});label(X,y0+690,L.benchHelp,{size:22,color:'#9fb3c3'});
  }else if(ui.tab===5){
   label(X,y0+10,L.anT,{bold:true,size:30});
   if(!regionList.length)label(X,y0+70,L.anNone,{size:26,color:'#9fb3c3'});
   else{
    const sn=spacingNote(),per=sn?8:10,pages=Math.ceil(regionList.length/per),pg=Math.min(ui.anPage|0,pages-1);
    regionList.slice(pg*per,pg*per+per).forEach((r,k)=>{const y=y0+56+k*62,hex='#'+r.color.toString(16).padStart(6,'0');
     w.push({type:'button',x:X,y,w:56,h:50,label:'',on:true,color:hex,action:()=>{}});
     label(X+76,y+34,String(r.rid)+'. '+r.segmentKeys.map(k2=>tr(k2)).join('+'),{size:28,color:hex,bold:true});
     label(X+520,y+34,vrVolumeText(r.mm3,sn),{size:28,color:sn?'#ffd166':undefined})});
    const total=regionList.reduce((a,r)=>a+r.mm3,0);label(X,y0+56+per*62+40,L.anTotal+' '+(sn?sn.mark+' ':'')+total.toFixed(2)+' mm³ · '+regionList.length,{size:26,color:sn?'#ffd166':'#9fb3c3'});
    if(sn){label(X,y0+640,sn.mark+' '+sn.short,{size:26,bold:true,color:'#ffd166'});sn.lines.forEach((t,i)=>label(X,y0+672+i*26,t,{size:21,color:'#d9c28a'}))}
    if(pages>1){btn(MENU_W-X-300,y0+56+per*62,140,'◀',false,()=>{ui.anPage=Math.max(0,pg-1)},{size:28});btn(MENU_W-X-150,y0+56+per*62,140,'▶',false,()=>{ui.anPage=Math.min(pages-1,pg+1)},{size:28});label(MENU_W-X-470,y0+56+per*62+40,L.anPage+' '+(pg+1)+'/'+pages,{size:26,color:'#9fb3c3'})}
   }
   L.lbMoveHelp.forEach((t,i)=>label(X,y0+868+i*28,t,{size:21,color:'#9fb3c3'}));
   choice(y0+770,L.lbSize,L.lbSizeV.map((t,i)=>({label:t,value:i})),settings.labelSize??1,v=>{settings.labelSize=v;saveSettings(settings)});
  }else if(ui.tab===6){
   // VR position points (stage 3): record button (off without a section), how it works, the position comments of this series
   const surf=surfaceActive();label(X,y0+10,L.ptT,{bold:true,size:30});
   label(X,y0+60,L.modeNow+L.ptModeV[vrPointMode==='surface'?1:0]+L.modeHint,{size:28});
   choice(y0+104,L.lbHide,L.lbHideV.map((t,i)=>({label:t,value:1-i})),normalizeLabelHide(settings.labelHide),v=>{settings.labelHide=v;saveSettings(settings)});
   // select with the trigger (laser on a point), then delete here; the undo puts it back where it was in the list (as the 2D list)
   const selNo=vpSel?getComments().findIndex(c=>c.id===vpSel)+1:0;
   btn(X,y0+200,460,L.ptDel,false,()=>{deleteSelectedPoint()},{size:30,disabled:!selNo});
   btn(X+480,y0+200,300,L.ptUndo,false,()=>{undoLast()},{size:30,disabled:!undo.size});
   label(X,y0+302,selNo?L.ptSel+selNo:L.ptNoSel,{size:26,color:selNo?'#ffd23d':'#9fb3c3'});
   (surf?L.ptHelpSurf:L.ptHelp).forEach((t,i)=>label(X,y0+340+i*30,t,{size:22,color:'#9fb3c3'}));
   label(X,y0+500,L.ptList,{bold:true,size:28});
   const mine=getComments().map((c,n)=>({c,n})).filter(x=>vrFp&&commentMatchesSeries(x.c,vrFp)),shown=mine.slice(-5);
   if(!shown.length)label(X,y0+550,L.ptNone,{size:26,color:'#9fb3c3'});
   shown.forEach(({c,n},k)=>{const y=y0+520+k*60;
    w.push({type:'button',x:X,y,w:56,h:50,label:String(n+1),on:true,color:pointColor(c),outline:c.id===vpSel?'#ffd23d':null,size:26,action:()=>{}}); // the point's colour; the selected one gets a thick yellow outline
    label(X+76,y+34,(c.text||'—').slice(0,14),{size:28,bold:true});label(X+520,y+34,'i '+c.position.i+' · j '+c.position.j+' · k '+c.position.k,{size:26,color:'#9fb3c3'})});
   if(mine.length>shown.length)label(X,y0+520+shown.length*60+30,'… '+(mine.length-shown.length),{size:24,color:'#9fb3c3'});
  }else if(ui.tab===7){
   // the items of the quick ring (A/X short): pick a slot (1 = top, clockwise), then an item; saved in the settings
   const items=settings.wheel,slot=ui.wheelSlot|0,save=a=>{settings.wheel=a;saveSettings(settings);wheelKey='';menu.refresh()};
   label(X,y0+10,L.wheelT,{bold:true,size:30});label(X,y0+48,L.wheelHelp,{size:22,color:'#9fb3c3'});
   items.forEach((id,k)=>btn(X+(k%3)*310,y0+72+Math.floor(k/3)*76,300,(k+1)+'  '+(itemName(id)||L.wheelEmpty),slot===k,()=>{ui.wheelSlot=k;menu.refresh()},{size:24}));
   const yo=y0+240;
   btn(X,yo,200,L.wheelPrev,false,()=>{ui.wheelSlot=(slot+5)%6;save(moveWheelItem(items,slot,-1))},{size:26});
   btn(X+210,yo,200,L.wheelNext,false,()=>{ui.wheelSlot=(slot+1)%6;save(moveWheelItem(items,slot,1))},{size:26});
   btn(X+420,yo,230,L.wheelClear,false,()=>save(clearWheelItem(items,slot)),{size:26});
   btn(X+660,yo,280,L.wheelReset,false,()=>save([...DEFAULT_WHEEL]),{size:26});
   if(!items.includes('mode-section')&&!items.includes('mode-surface'))label(X,yo+100,L.wheelNoMode,{size:24,color:'#ffd27a'});
   WHEEL_ITEMS.forEach((it,i)=>btn(X+(i%2)*480,yo+120+Math.floor(i/2)*64,470,itemName(it.id)+(items.includes(it.id)?'  ✓':''),items[slot]===it.id,()=>save(setWheelItem(items,slot,it.id)),{size:24,h:58}));
   btn(X,MENU_H-100,260,L.back,false,()=>{ui.tab=0;menu.refresh()},{size:28});
  }else if(ui.tab===11){
   // the data of the session, switched in place (the same buttons as the かんたん menu's row; press, then press again)
   label(X,y0+10,L.dataHead,{bold:true,size:30});
   {const ls=wrapMenuText(L.dataHelp,MENU_W-2*X,z=>menu.measure(z,24));label(X,y0+56,ls[0],{lines:ls,lh:30,size:24,color:'#9fb3c3'})}
   if(!practiceOpen()&&!ui.swapBusy)label(X,y0+150,L.dataOwn,{size:26,color:'#ffd27a'});
   else{const al=swapArmedId();levelSwitchItems(tr,globalThis.__vrlOpenSample,levelForSample(al)?.id??null).forEach((it,i)=>{const y=y0+150+i*96;btn(X,y,MENU_W-2*X,it.armed?L.dataAgain+' · '+it.label:it.label,it.on||it.armed,()=>swapPress(it.sample),{size:30,disabled:ui.swapBusy,color:it.armed?'#c77a00':it.on?'#2d6cdf':undefined})})}
   if(ui.swapBusy)label(X,y0+150+4*96+40,L.dataNone,{size:26,color:'#ffd27a'});
   else if(swapArmedId())label(X,y0+150+4*96+40,L.dataHint+levelNameOf(swapArmedId()),{size:24,color:'#ffd27a'});
   if(ui.swapLine)label(X,y0+150+4*96+90,ui.swapLine,{size:22,color:'#cfe3f0'});
   {const ct=vrCacheText(ja);if(ct){const cl=wrapMenuText(ct.replace(/\n/g,' · '),MENU_W-2*X,z=>menu.measure(z,22));label(X,y0+150+4*96+150,cl[0],{lines:cl,lh:26,size:22,color:'#cfe3f0'})}}
  }else if(ui.tab===9){
   // HU line (vr-hu-line.js): arm / disarm, Filtered / Raw (the PC's setting), clear, how it works
   const H=huMenuTexts(ja?'ja':'en');
   label(X,y0+10,H.title,{bold:true,size:30});
   choice(y0+60,H.arm,[{label:H.off,value:false},{label:H.on,value:true}],huLine.isArmed(),v=>huLine.setArmed(v));
   choice(y0+150,H.mode,[{label:H.filtered,value:HU_MODE_FILTERED},{label:H.raw,value:HU_MODE_RAW}],getHuMode(),v=>{setHuMode(v);menu.refresh()});
   label(X,y0+232,H.modeNote,{size:22,color:'#9fb3c3'});
   btn(X,y0+262,460,H.clear,false,()=>huLine.clear(),{size:30,disabled:!huLine.hasLine()});
   label(X+480,y0+298,huLine.hasLine()?H.hasLine+(ja?'あり':'yes'):H.none,{size:26,color:'#9fb3c3'});
   {let y=y0+390;H.help.forEach(tx=>{const ls=wrapMenuText(tx,MENU_W-2*X,z=>menu.measure(z,24));label(X,y,ls[0],{lines:ls,lh:30,size:24,color:'#9fb3c3'});y+=ls.length*30+16})}
  }else if(ui.tab===8){
   const v=selfCheck.view(); // self-check page (opened from 詳細)
   label(X,y0+10,v.title,{bold:true,size:30});let yy=y0+66;v.lines.forEach(l=>{const ls=wrapMenuText(l.text,MENU_W-2*X,t=>menu.measure(t,26));label(X,yy,ls[0],{lines:ls,lh:30,size:26,color:l.color});yy+=ls.length*30+12});
   btn(X,MENU_H-200,560,v.buttonLabel,v.running,()=>selfCheck.toggle(),{size:30});btn(X,MENU_H-100,260,L.back,false,()=>{ui.tab=4;menu.refresh()},{size:28});
  }else if(ui.tab===4){
   // the long lines wrap inside the menu width (' · ' separators) and the rows are stacked from y0+10, all above the first button row (y0+200);
   // a block too tall for that is scaled down (line height and font) instead of overlapping
   {const mw=MENU_W-2*X,rows=[[ui.fpsLine,26,'#cfe3f0'],[ui.sizeLine,24,'#cfe3f0'],[ui.placeLine,22,'#9fb3c3'],[ui.diagLine||ui.sampleLine,22,ui.diagLine?'#cfe3f0':'#9fb3c3'],[ui.autoLine,22,'#9fb3c3'],[ui.swapLine,22,'#ffd27a'],...vrCacheText(ja).split('\n').map(t=>[t,22,'#cfe3f0'])].filter(r=>r[0])
     .map(([text,size,color])=>({lines:wrapMenuText(text,mw,t=>menu.measure(t,size)),size,color,lh:Math.round(size*1.15)}));
    const {ys,scale}=stackMenuRows(rows.map(r=>({n:r.lines.length,lh:r.lh})),y0+10,y0+192);
    rows.forEach((r,i)=>label(X,ys[i],r.lines[0],{lines:r.lines,lh:Math.round(r.lh*scale),size:Math.round(r.size*scale),color:r.color}))}
   choice(y0+200,L.diag,L.dv.slice(0,3).map((t,i)=>({label:t,value:i})),settings.diag,v=>{settings.diag=v;applyQuality()});
   choice(y0+470,L.clsD,[{label:L.offOn[1],value:0},{label:L.offOn[0],value:1}],settings.clsDiag|0,v=>{settings.clsDiag=v;applyQuality()});
   choice(y0+560,L.refineL,L.refineV.map((t,i)=>({label:t,value:1-i})),settings.refine|0,v=>{settings.refine=v;applyQuality()});
   choice(y0+650,L.distD,[{label:L.offOn[1],value:0},{label:L.offOn[0],value:1}],settings.distDiag|0,v=>{settings.distDiag=v;applyQuality()});
   choice(y0+830,L.skipD,[{label:L.offOn[0],value:0},{label:L.offOn[1],value:1}],settings.skipDiag|0,v=>{settings.skipDiag=v;menu.refresh()}); // A/B of the exact creep skip (same picture, fewer fetches)
   choice(y0+380,L.editD,L.editDv.map((t,i)=>({label:t,value:i})),settings.editDiag|0,v=>{settings.editDiag=v;refreshEdits()});
   choice(y0+290,'',L.dv.slice(3).map((t,i)=>({label:t,value:i+3})),settings.diag,v=>{settings.diag=v;applyQuality()});
   btn(X,y0+740,520,SC.button,selfCheck.active,()=>{ui.tab=8;menu.refresh()},{size:28});
   {const on=(settings.boxDiag|0)===0;btn(X+540,y0+740,MENU_W-2*X-540,(ja?'内容ボックス ':'content box ')+(on?L.offOn[1]:L.offOn[0]),on,()=>{settings.boxDiag=on?1:0;refreshContentBox();menu.refresh()},{size:26})} // diagnostic: オフ = the full data box as the proxy
  }
  return w;
 });
 await renderer.xr.setSession(session);
 applyQuality();menu.refresh();
 let lastT=0;const tmpS=new THREE.Vector3(); // scroll: previous frame time, parent scale
 const color=new THREE.Color(),tmpP=new THREE.Vector3(),tmpQ=new THREE.Vector3(),tmpN=new THREE.Vector3(),tmpE=new THREE.Vector3(),tmpD=new THREE.Vector3();
 // GPU time per pass (EXT_disjoint_timer_query_webgl2, when offered) and JS
 // time per frame, averaged over the fps window
 const gl=renderer.getContext(),timerExt=gl.getExtension('EXT_disjoint_timer_query_webgl2');
 const pending=[],sums={vol:0,main:0,js:0},counts={vol:0,main:0,js:0},ctrl={vol:0,main:0},ctrlN={vol:0,main:0};let sizes='';
 const timed=(kind,fn)=>{
  if(!timerExt||pending.length>12){fn();return}
  const q=gl.createQuery();gl.beginQuery(timerExt.TIME_ELAPSED_EXT,q);fn();gl.endQuery(timerExt.TIME_ELAPSED_EXT);pending.push({q,kind});
 };
 const pollTimers=()=>{
  while(pending.length){
   const {q,kind}=pending[0];
   if(!gl.getQueryParameter(q,gl.QUERY_RESULT_AVAILABLE))break;
   pending.shift();
   if(!gl.getParameter(timerExt.GPU_DISJOINT_EXT)){const ms=gl.getQueryParameter(q,gl.QUERY_RESULT)/1e6;sums[kind]+=ms;counts[kind]++;if(kind in ctrl){ctrl[kind]+=ms;ctrlN[kind]++}}
   gl.deleteQuery(q);
  }
 };
 const avg=k=>counts[k]?(sums[k]/counts[k]).toFixed(1):'–';
 // screenshot: the left eye's view rendered again at full resolution into
 // an offscreen target (menu and controller rays hidden), read back as PNG
 const takeScreenshot=()=>{
  const sub=renderer.xr.getCamera().cameras[0];if(!sub||!mesh)return;
  const v=sub.viewport,W=1600,H=Math.max(1,Math.round(W*v.w/Math.max(1,v.z)));
  const rt=new THREE.WebGLRenderTarget(W,H),prev=renderer.getRenderTarget(),hidden=[menu.mesh,badge,sliceToast.mesh,help.mesh,hist.group,huLine.panel,ev?.mesh,wheel.mesh,pointWheel.mesh,edgeArrow.mesh,...ctlHints.groups(),...controllers.map(c=>c.userData.ray)].filter(o=>o&&o.visible);
  hidden.forEach(o=>{o.visible=false});const matBefore=mesh.material;mesh.material=variants[cls4On?'full4':'full']; // the full variant of the data in use (VRL_CLS4 with four stored segments)
  renderer.xr.enabled=false;renderer.setRenderTarget(rt);renderer.setClearColor(vt.passthrough?0x000000:BG,vt.passthrough?0:1);renderer.clear();renderer.render(scene,sub);
  const px=new Uint8Array(W*H*4);renderer.readRenderTargetPixels(rt,0,0,W,H,px);
  renderer.setRenderTarget(prev);renderer.xr.enabled=true;mesh.material=matBefore;hidden.forEach(o=>{o.visible=true});rt.dispose();
  const cv=document.createElement('canvas');cv.width=W;cv.height=H;const cx=cv.getContext('2d'),img=cx.createImageData(W,H);
  for(let y=0;y<H;y++)img.data.set(px.subarray((H-1-y)*W*4,(H-y)*W*4),y*W*4);
  cx.putImageData(img,0,0);
  const d=new Date(),pad=n=>String(n).padStart(2,'0'),name='vrl-'+(vt.passthrough?'ar':'vr')+'-'+d.getFullYear()+pad(d.getMonth()+1)+pad(d.getDate())+'-'+pad(d.getHours())+pad(d.getMinutes())+pad(d.getSeconds())+'.png';
  cv.toBlob(b=>{if(b)shots.push({name,url:URL.createObjectURL(b)})},'image/png');
  ui.flash=L.shotDone+' ('+(shots.length+1)+')';ui.flashUntil=performance.now()+3000;menu.refresh();for(const c of controllers)pulse(c,0.5,40);
 };
 // lazy follow: a board moves back in front once the head
 // has turned well away or it is far off; returns the new 'moving' state
 const lazyFollow=(m,target,moving,hold)=>{
  // the boards sit 50 deg out (vr-layout.js): it follows only past FOLLOW_ANGLE of head turn, or when the head moved FOLLOW_DIST nearer / farther / up / down
  tmpD.subVectors(m.position,head);tmpD.y=0;tmpE.subVectors(target,head).setY(0);const rm=tmpD.length(),rt=tmpE.length();
  const ang=rm>1e-3&&rt>1e-3?tmpD.angleTo(tmpE):0;
  if(ang>FOLLOW_ANGLE||Math.abs(rm-rt)>FOLLOW_DIST||Math.abs(m.position.y-target.y)>FOLLOW_DIST)moving=true;
  if(moving&&!hold){m.position.lerp(target,0.08);m.lookAt(head);if(m.position.distanceTo(target)<0.01)moving=false}
  return moving;
 };
 // samples per pixel: the loop-count diagnostic drawn to a 48×48
 // target from the left eye once a second while 詳細 is open, averaged over
 // the covered pixels (8-bit: steps of 4 samples)
 // the same variants without VRL_REGIONS (sharing the uniforms), built on first use by the analysis bench
 let plain=null;
 const plainSets=()=>{if(!plain){const base=material.clone();base.uniforms=material.uniforms;base.defines=volumeDefines(false);const vars=materialVariants(base);plain={vars,ray:rayVariantsOf(vars)}}return plain};
 // the VRL_CLS4 twin of each variant while four stored segments are drawn through the combined texture
 const variantKey=()=>{const u=material.uniforms,k=!(u.distInCls.value>0&&u.useCls.value>0)||(settings.diag|0)?'full':u.planeCount.value===0?'noEvents':'combined';return cls4On?k+'4':k};
 const probeTarget=new THREE.WebGLRenderTarget(48,48,{depthBuffer:false}),probePx=new Uint8Array(48*48*4);let probe=null,probeReq=null;
 // render-scale state (vr-render-scale.js), preallocated: cap = data-resolution cap, cover = covered px (both eyes), ppv / ppvFar = screen px per voxel
 // (centre / far corner, smaller eye), eff = the volume scale in use, per = periphery factor of the offscreen foveation (1 = off)
 const rs={cap:1,cover:0,outside:0,ppv:0,ppvFar:0,eff:1,per:1,split:1e9,low:false,w:0,h:0,eyes:0},rsHalf=[1,1,1],rsDims=[1,1,1],rsEyes=[{},{}],rsBoxV={c:[0,0,0],h:[1,1,1]},rsFov=[[0,0,0,0,1],[0,0,0,0,1]];
 const qualityReadout=()=>(ja?'描画中: ':'drawing: ')+qualityText({auto:!VRES[settings.vres],modeF:VRES[settings.vres]||aq.level,eff:rs.eff,periphery:rs.per},ja)+(rs.cover>0&&Number.isFinite(rs.ppv)?(ja?' · 1ボクセル ':' · voxel ')+rs.ppv.toFixed(1)+' px':'');
 const PERI_MAX=Math.max(...FOVEA_K.filter(k=>k<1)),INV_ATT=[gl.COLOR_ATTACHMENT0,gl.DEPTH_ATTACHMENT];
 const newLowTarget=(w,h)=>new THREE.WebGLRenderTarget(w,h,{depthBuffer:true,depthTexture:new THREE.DepthTexture(w,h),minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter}); // the volume pass writes depth; the composite samples it (24 bit, nearest)
 // the targets are made once per session at full size and cleared once right away (the GPU allocates them now, not on the first f < 1 frame)
 const touchTarget=t=>{const prev=renderer.getRenderTarget(),wasXr=renderer.xr.enabled;renderer.xr.enabled=false;const cc=renderer.getClearColor(new THREE.Color()),ca=renderer.getClearAlpha();t.scissorTest=false;renderer.setRenderTarget(t);renderer.setClearColor(0x000000,0);renderer.clear(true,true,false);renderer.setRenderTarget(prev);renderer.xr.enabled=wasXr;renderer.setClearColor(cc,ca)};
 const ensureLowTargets=(w,h)=>{
  if(!lowTarget){lowTarget=newLowTarget(w,h);touchTarget(lowTarget)}else if(lowTarget.width!==w||lowTarget.height!==h){lowTarget.setSize(w,h);touchTarget(lowTarget)} // a new XR framebuffer size (not expected within a session)
  if((FOVEA_K[settings.foveation|0]??1)<1){const pw=Math.ceil(w*PERI_MAX),ph=Math.ceil(h*PERI_MAX);if(!periTarget){periTarget=newLowTarget(pw,ph);touchTarget(periTarget)}else if(periTarget.width!==pw||periTarget.height!==ph){periTarget.setSize(pw,ph);touchTarget(periTarget)}}
 };
 // clear only the used corner (cw x ch) of a full-size target; invalidating first tells a tiled GPU (Quest) not to load the old contents
 const clearCorner=(t,cw,ch)=>{t.scissor.set(0,0,Math.min(t.width,cw),Math.min(t.height,ch));t.scissorTest=true;renderer.setRenderTarget(t);try{gl.invalidateFramebuffer(gl.FRAMEBUFFER,INV_ATT)}catch{}renderer.clear(true,true,false)};
 const measureSamples=()=>{
  if(!mesh||!material||!rayMesh)return;
  const sub=renderer.xr.getCamera().cameras[0]||camera,prev=renderer.getRenderTarget(),wasXr=renderer.xr.enabled,d0=material.uniforms.diag.value,clearC=renderer.getClearColor(new THREE.Color()),clearA=renderer.getClearAlpha();
  material.uniforms.diag.value=5;renderer.xr.enabled=false;renderer.setRenderTarget(probeTarget);renderer.setClearColor(0x000000,0);renderer.clear();
  scene.updateMatrixWorld();rayMesh.matrixWorld.copy(mesh.matrixWorld);rayMesh.material=(diagAn.noRegion?plainSets().ray:rayVariants)[variantKey()];renderer.render(volScene,sub);renderer.readRenderTargetPixels(probeTarget,0,0,48,48,probePx); // the variant in use (not the last low-resolution frame's)
  renderer.setRenderTarget(prev);renderer.xr.enabled=wasXr;material.uniforms.diag.value=d0;renderer.setClearColor(clearC,clearA);
  // R = samples (8-bit: steps of 4), G = ray ended by a hit, B = share of the path skipped by jumps; means over the covered pixels
  let sum=0,hit=0,skip=0,n=0;for(let i=0;i<probePx.length;i+=4)if(probePx[i+3]>0){sum+=probePx[i]/255*1024;hit+=probePx[i+1]/255;skip+=probePx[i+2]/255;n++}
  // also the p95 / max of the samples per ray (the slow tail of the rays) and the covered probe pixels
  let p95=0,mx=0;if(n){const r=[];for(let i=0;i<probePx.length;i+=4)if(probePx[i+3]>0)r.push(probePx[i]);r.sort((a,b)=>a-b);p95=Math.round(r[Math.min(n-1,Math.ceil(0.95*n)-1)]/255*1024);mx=Math.round(r[n-1]/255*1024)}
  probe=n?{samples:sum/n,hit:hit/n,skip:skip/n,p95,max:mx,px:n}:null;
  ui.sampleLine=probe?L.samples+probe.samples.toFixed(0)+L.samplesNote:'';
 };
 renderer.setAnimationLoop(xrTs=>{
  selfCheck.tick(xrTs); // XR frame time -> self-check frame intervals
  frameGaps.tick(performance.now()); // the gap between two XR frames (the longest one during a data switch is read on the device)
  if(probeReq&&!selfCheck.measuring){const q=probeReq;if(q.stage===0){q.stage=1;try{measureSamples();q.out=probe?{mean:+probe.samples.toFixed(1),p95:probe.p95,max:probe.max,hit:+probe.hit.toFixed(3),skip:+probe.skip.toFixed(3),px:probe.px}:null}catch(e){console.warn(e)}}else{probeReq=null;q.res(q.out)}} // never inside a measured window
  if(ui.probeOnOpen){ui.probeOnOpen=false;if(ui.open&&ui.tab===4&&!selfCheck.measuring){try{measureSamples()}catch(e){console.warn(e)}menu.refresh()}} // (setMenuOpen)
  const js0=performance.now();if(timerExt)pollTimers();
  const dt=lastT?Math.min(0.05,(js0-lastT)/1000):0;lastT=js0;
  readHead();frameNo++;
  if(!poseAt&&poseOk())poseAt=frameNo;
  {const tq=performance.now();uploadQueue.tick();if(swapOwn&&uploadQueue.pending)ownNote('uploadTick',tq)} // the next slices of the GPU uploads of a data switch (a few ms at most; nothing queued = nothing done)
  if(!menuPlaced&&poseAt)placeMenuNow();
  if(placePending&&poseAt){placePending=false;if(swapPlace){swapPlace=false;placeAllFront()}else{markFront();bringVolumeFront()}; // a switched data is placed from the FRONT of the session (not where the head looks now)
   if(oversizeNote(realLongMm(),language))flashMsg(ja?'30cm超のため30cmに縮小・固定（拡大縮小不可）':'Over 30 cm: fitted to 30 cm, locked',12000);ui.placeLine=(ja?'初期配置: 姿勢取得 フレーム ':'placed: pose at frame ')+poseAt+(ja?' / 配置 フレーム ':' / placed at frame ')+frameNo+(ja?' / 頭の高さ ':' / head height ')+head.y.toFixed(2)+' m';if(ui.tab===4)menu.refresh()}
  // lazy follow: move back in front once the head has turned well away
  if(ui.open&&settings.menuMode===0&&!menuHeld){computeMenuTarget();menuMoving=lazyFollow(menu.mesh,menuTarget,menuMoving,!!dragging)}
  help.mesh.visible=(settings.help|0)>0||!!tutVr; // with the tutorial on the board is shown
  if(ev){ev.mesh.visible=(settings.help|0)>0&&!!evSlide;if(ev.mesh.visible&&!evPlaced&&poseAt)placeEvNow()} // the mission board follows the help setting (it was a part of the help board); placed once;: follows the head with help=Follow (below) the head
  if(tutVr&&!tutBad){try{tutVr.update(performance.now())}catch(e){tutFail(e);help.refresh()}}
  { // the 3D guides: the controller's button (blinking ring + moving arrow), the direction arrow at the edge of the view towards the menu while it is out of view, the arrow over the menu's button
   const tn=performance.now(),okT=tutVr&&!tutBad,sb=okT?tutVr.stepBoard():null;ctlHints.update(tn,okT?tutVr.controllerHint():null);
   let es=null;if(sb==='menu'&&menuPlaced&&ui.open&&poseAt){menu.mesh.getWorldPosition(lookV);const bs=boardSide(headGaze.x,headGaze.z,headLeft.x,headLeft.z,lookV.x-head.x,lookV.z-head.z);if(bs&&edgeArrowShown(bs.deg))es={show:true,side:bs.side,head,gaze:headGaze,left:headLeft}}
   edgeArrow.update(tn,es);boardArrow.update(tn,sb==='menu'&&ui.open&&ui.tab===10&&menu.mesh.visible&&tutMenuRect?{rect:tutMenuRect.rect,from:tutMenuRect.from,W:MENU_W,H:MENU_H,widthM:MENU_WIDTH}:null);
  }
  {const eb=tutVr&&!tutBad?tutVr.entryBoard():null,pl=0.45+0.55*(0.5+0.5*Math.cos(performance.now()/1000*4*Math.PI)); // 2 Hz blink
   glowHelp.visible=eb==='help';glowMenu.visible=eb==='menu';if(eb){const m=(eb==='help'?glowHelp:glowMenu).material;m.opacity=pl}} // the board the entry guidance points at blinks
  if(help.mesh.visible&&!helpPlaced&&poseAt)placeHelpNow();
  if(help.mesh.visible&&settings.help===1&&!helpHeld){computeHelpTarget();helpMoving=lazyFollow(help.mesh,helpTarget,helpMoving,false)}
  if(ev&&ev.mesh.visible&&evPlaced&&settings.help===1&&!evHeld){computeEvTarget();evMoving=lazyFollow(ev.mesh,evTarget,evMoving,false)} // the mission board follows the head like the help board (the same setting, the same rule)
  if(!huPlaced&&poseAt&&huLine.panel.visible)placeHuNow(); // shown before the first pose (rare): placed once the pose is there; never follows the head after that
  if(hist.isOpen){if(!histPlaced&&poseAt)placeHistNow();histRun();histAxisFollow();hist.update(js0);releaseHistWaiters()} // no allocation; the board only on data / range change (567: histRun starts a pass when the data or the shown segments changed).: fixed where placed (no follow); the waiting histogram pass goes on after this frame
  handIn.frame(js0); // hands only: the filtered / delayed ray, tracking loss, wrist menu, fingertips.: before the two-hand scale (it reads the palm anchors: this frame's, not last frame's)
  if(twoHand)holder.scale.setScalar(pinchScale(twoHand.s0,twoHand.d0,handDist(),realLongMm()));
  for(let k=flying.length-1;k>=0;k--){const f=flying[k],o=f.pl.obj,r=flyStep({pos:o.position,v:f.v,age:f.age},dt);o.position.set(r.pos.x,r.pos.y,r.pos.z);f.age=r.age;f.pl.mat.opacity=r.opacity;f.pl.handle.material.opacity=r.opacity;if(r.done){disposePlane(f.pl);flying.splice(k,1)}} // the thrown frame flies on and fades
  for(const pl of planes)applyFrameScale(pl); // the section square is capped at 1.5x its design size (36 cm), the number tag at 1x (3.4 cm), above the default 16.5 cm display
  {const lm=realLongMm(),lim=scaleLimits(lm);
   if(lm>0&&!bench.active&&!anBench.active){const cs=clampScale(holder.scale.x,lm);if(cs!==holder.scale.x)holder.scale.setScalar(cs)} // initial placement, restored or any other out-of-range scale
   scaleTag.mesh.visible=!!(mesh&&vrHalfExt&&lm>0);
   if(scaleTag.mesh.visible){scaleTag.setText(magnificationText(realMagnification(holder.scale.x,lm),language)+(lim.locked?'\n'+(ja?'30cmに縮小・固定':'fitted to 30 cm, locked'):''));readHead();scaleTag.place(holder,vrHalfExt,head)}}
  let tutHov=-1,hover=-1,scroll=0,undoLit=false,histHov=null;const hoverIds=new Set();
  if(sliceToast.until&&performance.now()>sliceToast.until){sliceToast.until=0;sliceToast.mesh.visible=false}
  badge.visible=!(wheelOwner&&wheelOwner===leftHand()); // the cue hides while the left hand's ring is open
  const fHide=framesHidden();
  for(const c of controllers){
   // this hand's candidates (the press uses the values of the previous frame: c.userData.res); a section's plane is not a candidate
   // (only its thin frame band and number tag), so it can no longer take the laser from what is behind it
   const rOff=!handIn.rayOn(c),bd=rOff?noHits:histAxis===c?histAxisBd:boardHits(c),h=bd.menu,hh=bd.help,rh=bd.wheel||bd.pwheel,board=h||hh||bd.hist||bd.undoBtn||bd.hu||bd.ev||bd.wrist||(rh&&rh.slot!==null?rh:null),ray=c.userData.ray,nowF=performance.now();
   if(bd.undoBtn)undoLit=true;
   if(bd.wrist)handIn.hover(bd.wrist.slot);
   let tab=null,pt=null,mlb=null,band=null,vh=null,sh=null,gl=null;
   const selOk=!!(section.on&&section.selected&&!draggedBy(section.selected,c)),anyOk=section.on&&planes.some(p=>!draggedBy(p,c));
   if(!board&&!rh&&!rOff){
    const vis=section.on&&!fHide?planes.filter(p=>!draggedBy(p,c)):[]; // frames hidden (thumbstick click held): no tag, band or glass for the laser
    tab=tabHit(c,vis);
    setRay(c);pt=vpMarkers.pick(raycaster.ray.origin,raycaster.ray.direction,isHand(c.userData.source)?HAND_PICK_TOL:0);mlb=vpMeasure.pickLabel(raycaster.ray.origin,raycaster.ray.direction);
    if(analysisOn()&&pins.size)mlb=nearerLabel(mlb,pickPin(raycaster.ray.origin,raycaster.ray.direction,c.userData.pinRes||=makePinRes()));
    for(const p of vis){const bn=frameBandHit(c,p);if(bn&&(!band||bn.t<band.t))band=bn}
    if(vis.length)gl=glassHit(c,vis); // the empty inside of a frame: counts only when nothing else is hit (resolveTriggerTarget)
    if(surfaceActive()||labelMode()||anyOk){vh=volumeHit(c);c.userData.vhFrame=frameNo} // in 断面 mode too, to tell "laser on the 3D object" (no section grab) from empty space
    if(!surfaceActive()&&selOk){sh=sectionPointOf(c);c.userData.secFrame=frameNo}
   }
   c.userData.volHit=vh;c.userData.secHit=sh;c.userData.helpHit=!!hh;c.userData.evHit=!!bd.ev;c.userData.histHit=!!bd.hist;c.userData.wristOn=!!bd.wrist; // a hand's fist on the wrist menu does not grab
   if(bd.hist&&!histHov&&histAxis!==c)histHov=histTargetOf(bd.hist); // the grab target under a laser is lit
   // how much nearer than the plane the object surface must be to hide it (0.75 voxel in world metres: the surface march and the plane meet at a cut face)
   let occEps=1e-4;if(vh&&(sh||tab)&&vrHalfExt&&vrDims&&mesh?.parent){const vs=voxelSize(vrHalfExt,vrDims);mesh.getWorldScale(tmpSs);occEps=0.75*Math.min(vs[0]*tmpSs.x,vs[1]*tmpSs.y,vs[2]*tmpSs.z)}
   // under 「実際に隠す」 a number tag the tissue covers (the frame is not drawn there) is not there for the laser or the trigger: the tag is picked before everything else (resolveTriggerTarget), so
   // it needs this tissue test (the frame band already loses to a nearer tissue hit by distance). Unless the frame is held (then it is lit and drawn on top).
   if(tab&&vh&&!draggedBy(tab.pl,null)&&tagBehindTissue(occlusionGpu(),tab.t,vh.distance,occEps))tab=null;
   // a pinned card the tissue covers (drawn only as a ghost under 「実際に隠す」) is not there for the laser, unless it is held
   if(mlb&&mlb.pin&&vh&&!(c.userData.lblDrag&&c.userData.press)&&tagBehindTissue(occlusionGpu(),mlb.distance,vh.distance,occEps))mlb=null;
   // where a moved point would land (the current mode's rule): the surface voxel or the selected section's voxel
   const placement=surfaceActive()?(vh&&vh.voxel?vh:null):(sh&&sh.voxel&&!(vh&&vh.distance<sh.distance-occEps)?sh:null);c.userData.placement=placement; // a plane behind the object surface is not a place to put a point
   const res=rOff||rh&&!board&&wheelOwner!==c&&pw?.c!==c?{kind:'none',ref:null}:resolveTriggerTarget({board:board?bd:null,ringOwnOpen:wheelOwner===c||pw?.c===c,ringHighlight:c.userData.ringHl??null,moving:!!c.userData.moving,placement,tab,point:pt,mlabel:mlb,band,glass:gl,tissue:vh,plane:sh,occludeEps:occEps,mode:vrPointMode,analysis:analysisOn(),canDrag:anyOk&&!fHide&&(surfaceActive()||labelMode()||!vh)});
   c.userData.res=res;if(res.kind==='point')hoverIds.add(res.ref.id);
   if(!c.userData.press&&!c.userData.drag&&!huLine.isDragging()){const hpz=c.userData.hoverPulse||=createHoverPulse({debounceMs:HAPTIC.hover.debounceMs});if(hpz.update(res.kind==='point'?res.ref.id:null,nowF))pulse(c,HAPTIC.hover.amp,HAPTIC.hover.ms)}
   updatePress(c,nowF);updateFistDrag(c); // a fist holding a section (hands only: drag.fist)
   // velocity record for the throw (from the press on, so a quick flick right after the drag starts still has samples); a grip / two-hand gesture restarts it and rules the throw out.
   // the dragged FRAME's centre in world metres (after updatePress moved it this frame), stamped with the frame time; before the drag starts, the frame the press may drag
   // (it stands still then, so the record has no jump when the drag starts). The controller is recorded beside it only for the debug readout.
   {const dg=c.userData.drag,pr=c.userData.press,fv=c.userData.fv||=createVelocityTracker(),fh=c.userData.fvHand||=createVelocityTracker(),fp=dg?dg.pl:pr?pr.dragPl:null;
    if(twoHand||grabbing.size){fv.reset();fh.reset();if(dg)dg.volTouched=true}else if(fp){fp.obj.getWorldPosition(tmpFv);fv.push(js0,tmpFv);c.getWorldPosition(tmpFv);fh.push(js0,tmpFv)}
    if(dg&&planes.includes(dg.pl))(dg.oov||=createOutOfViewTracker()).update(js0,!dg.volTouched&&sectionOutOfView(dg.pl))}
   {const ld=c.userData.lblDrag;if(ld&&c.userData.press){setRay(c);const o=raycaster.ray.origin,q=raycaster.ray.direction;tmpRc.set(o.x+q.x*ld.dist+ld.grab.x,o.y+q.y*ld.dist+ld.grab.y,o.z+q.z*ld.dist+ld.grab.z);if(ld.pin){if(!ld.moved&&!ld.done&&tmpRc.distanceTo(ld.pos0)>(isHand(c.userData.source)?HAND_LABEL_MOVE_M:0.008))ld.moved=true;if(ld.moved&&!ld.done)dragPin(ld.id,tmpRc)}else vpMeasure.dragLabel(ld.id,tmpRc)}} // the grabbed label follows the laser
   const ref=res.ref,dist=board?board.distance:rh?rh.distance:(ref&&(res.kind==='point'||res.kind==='mlabel'||res.kind==='section'||res.kind==='record'||res.kind==='label'||res.kind==='move'||res.kind==='tissue')?(ref.t??ref.distance):null);
   const busy=!!c.userData.drag,rec=res.kind==='record'||res.kind==='move',cur=!busy&&rec&&!!ref?.voxel,curSurf=cur&&surfaceActive(),curSec=cur&&!surfaceActive();
   const hc=handColor(c),dot=c.userData.dot;ray.material.color.setHex(hc);dot.material.color.setHex(hc);dot.visible=dist!=null&&!cur&&!busy;
   // a ring is drawn without depth (depthTest:false, renderOrder 7) after the laser, so it covered the laser's last part and its end dot:
   // the laser looked as if it went on behind the ring. While this laser ends on a ring, the laser and the dot are drawn after it, on top.
   // the volume writes depth now, so a laser that ends on something drawn without a depth test INSIDE the volume (a point, a distance label, a section frame) would be cut at the tissue surface: those are on top too
   {const top=!!rh||res.kind==='point'||res.kind==='mlabel'||res.kind==='section'||!!bd.hu;ray.renderOrder=dot.renderOrder=bd.hu?11:top?8:0;ray.material.depthTest=dot.material.depthTest=!top} // on the HU live panel (renderOrder 10, no depth test) the laser and its dot are drawn after it
   if(isHand(c.userData.source)){if(bd.wrist){ray.renderOrder=dot.renderOrder=8;ray.material.depthTest=dot.material.depthTest=false}if(!c.visible)dot.visible=false} // a hand: on the wrist menu (renderOrder 7, no depth test) the laser is on top; no end dot while its tracking is lost
   if(dist!=null){ray.scale.z=dist;ray.material.opacity=1;setRay(c);raycaster.ray.at(dist,dot.position);if(h){const i=menu.hit(h.uv);if(i>=0)hover=i}if(hh){const i=help.hit(hh.uv);if(i>=0)tutHov=i}}
   else{ray.scale.z=0.6;ray.material.opacity=0.35}
   ray.userData.setLook(settings.laserStyle);ray.visible=!rOff;if(rOff)dot.visible=false; // a hand's laser: 指差し not pointing = none; 標準 / 指差し / a controller: this line and dot
   if(curSurf)placeSurfCursor(c,ref);else if(curSec)placeSecCursor(c,ref);else surfCursors[controllers.indexOf(c)].set(null);
   // thumbstick Y (xr-standard axes[3], up is negative), dead zone 0.15, squared response; both hands add up
   const ay=c.userData.source?.gamepad?.axes?.[3]||0,am=Math.abs(ay);if(am>0.15&&!c.userData.stickLock&&wheelOwner!==c&&pw?.c!==c)scroll+=Math.sign(ay)*((am-0.15)/0.85)**2;
   {const ws=c.userData.wristScroll;if(ws){if(!isHand(c.userData.source)||!handIn.wristShown||!section.on||!section.selected||!wristScrollKeep(ws.id,bd.wrist?handIn.wristId(bd.wrist.slot):null,handIn.grabbing(c)))c.userData.wristScroll=null;else scroll+=ws.sign*wristScrollGain(nowF-ws.t0)}} // a hand holding 断面 ＋／－ on the wrist menu = the stick up / down
   if(dragging?.c===c){setRay(c);const hh=raycaster.intersectObject(menu.mesh,false)[0];if(hh)menu.drag(dragging.i,hh.uv)}
   // xr-standard buttons: 4 = A/X, 5 = B/Y the section
   if(isHand(c.userData.source)){empFrame(c,nowF);const dp=c.userData.dpPend;if(dp&&nowF>=dp.at){c.userData.dpPend=null;recordPoint(c,dp.hit)}} // the empty-space pinch; the record of a short pinch on a section once the double-pinch window has passed
   const bt=c.userData.source?.gamepad?.buttons;
   const axEv=(c.userData.axPress||=createButtonPress()).update(!!bt?.[4]?.pressed,nowF);
   if(axEv==='short')onAxShort(c);else if(axEv==='long')onAxLong(c);
   // thumbstick click (button 3, either hand; free in VR:), short / hold like A/X: a SHORT press (released before FRAME_HIDE_MS) makes the slice transparent / back to the slider's value (ui.sliceClear;
   // settings.sliceOpacity is not touched); HOLDING it hides the section frames (outline, tag, hover fill, arrow) for as long as it is held (c.userData.hideFrames; the clipping stays), a hold fires no toggle.
   // In an AR session the same click is also the double press of the view switch: the two short presses toggle twice (net: unchanged) and the second one switches the view
   {const tc=!!bt?.[3]?.pressed,ev=(c.userData.tcPress||=createButtonPress({longMs:FRAME_HIDE_MS})).update(tc,nowF);if(ev==='long')emit('frame-hide');
    if(ev==='short')toggleSliceClear(c);
    else if(ev==='long'){c.userData.hideFrames=true;pulse(c,0.3,25)}
    if(!tc&&c.userData.hideFrames){c.userData.hideFrames=false;pulse(c,0.2,25)}}
   if(vt.canToggle&&(c.userData.vtDbl||=createDoublePress()).update(!!bt?.[VIEW_TOGGLE_BUTTON]?.pressed,nowF))toggleView(c); // AR: double press of the thumbstick click (button 3)
   updateRings(c,nowF,bd);
   // the thumbstick (axes 2 / 3) only feeds the recording gate; its click (button 3) is unused again
   c.userData.gate.update(c.userData.source?.gamepad?.axes?.[2]||0,ay,performance.now());
   // B/Y: short press shows / hides the sections, long press adds one
   const b=!!bt?.[5]?.pressed||!!c.userData.vB,nowB=performance.now(); // a hand's empty-space pinch (right) is this button
   if(b&&!c.userData.bDown){c.userData.bAt=nowB;c.userData.bLong=false;c.add(ring);ring.visible=true}
   if(b&&!c.userData.bLong){const f=Math.min(1,(nowB-c.userData.bAt)/LONG_PRESS);ringGeo.setDrawRange(0,Math.max(2,Math.round(f*33)));
    if(f>=1){c.userData.bLong=true;ring.visible=false;if(planes.length>=MAX_PLANES){pulse(c,0.15,30);ui.flash=L.maxPlanes;ui.flashUntil=nowB+2000;menu.refresh()}else{addPlane(c);pulse(c,0.6,50)}}}
   if(!b&&c.userData.bDown){if(ring.parent===c)ring.visible=false;if(!c.userData.bLong&&!c.userData.vCancel)setSection(!section.on)}
   if(!b)c.userData.vCancel=false;c.userData.bDown=b;
  }
  huLine.update(js0); // after the controller loop (it reuses that loop's hits): the HU line's pick / sampling (while the trigger is held) and its mesh
  menu.setHover(hover);help.setHover(tutHov);
  if(hist.isOpen)hist.setAxisHover(histAxis?null:histHov); // the lit grab target (none while an end is dragged: that one is lit by the panel)
  if(undoBtn.mesh.visible){const nowU=performance.now();if(!secUndo.peek(nowU))undoBtn.hide();else undoBtn.update(secUndo.remainingMs(nowU)/FLING_UNDO_MS,undoLit)}
  flingDbg?.update(performance.now()); // debug readout hides after FLING_DEBUG_MS
  // faint label of what each laser points at (not when that result is already pinned); pinned labels follow the volume
  {snFrame=undefined;const on=labelMode()&&!diagAn.noLabels;if(on||pins.size||analysisRegions.some(r=>r.label))readHead();anBenchTick();
   for(const c of controllers){const hit=on?c.userData.volHit:null,hrid=hit&&hit.id?regionList[hit.id-1]?.rid:null;if(hit&&!(hrid&&pins.has(hrid))){const lb=hoverLabelOf(c);drawLabel(lb,hit,true);lb.anchor.copy(hit.local);placeLabel(lb)}else hideLabel(c.userData.hoverLabel)}
   pinLit.clear();for(const x of controllers){const r=x.userData.res;if(r&&r.kind==='mlabel'&&r.ref?.pin)pinLit.add(r.ref.id);const ld=x.userData.lblDrag;if(ld?.pin&&x.userData.press)pinLit.add(ld.id)}
   syncPins();for(const lb of pins.values()){lb.lit=pinLit.has(lb.rid);placeLabel(lb);pinOcclusion(lb,lb.lit)}}
  // thumbstick scroll: the selected plane along its own normal, same world speed fixed in the scaled holder or held
  const sp=section.selected;
  if(section.on&&sp&&scroll&&dt&&!controllers.some(c=>c.userData.drag?.pl===sp)){
   const ps=sp.obj.parent?sp.obj.parent.getWorldScale(tmpS).x||1:1;sp.obj.translateX(-scroll*SCROLL_SPEED*dt/ps);if(!sweepOn)emit('section-scroll'); // tutorial signal (at most one per 400 ms: tutorial-signal.js)
   if(vrHalfExt){const cc=clampPlaneCenter(sp.obj.position,qRot(sp.obj.quaternion,{x:1,y:0,z:0}),vrHalfExt);sp.obj.position.set(cc.x,cc.y,cc.z)} // the plane keeps meeting the box
  }
  // frame: own colour; a glow band in the hand's colour while that hand points at its band / tag or drags it
  if(section.on){const glowBy=new Map();for(const c of controllers){const rr=c.userData.press?.res||c.userData.res,nr=handIn.reach(c),pl=c.userData.drag?.pl||(rr?.kind==='section'?rr.ref.pl:null)||(nr?.kind==='section'?nr.ref:null);if(pl&&!glowBy.has(pl))glowBy.set(pl,handColor(c))}const glassBy=new Set();for(const c of controllers){const rr=c.userData.res;if(rr?.kind==='section'&&rr.ref?.glass&&!c.userData.drag)glassBy.add(rr.ref.pl)}const occF=occlusionGpu();for(const pl of planes){const gc=glowBy.get(pl);pl.glow.visible=gc!==undefined&&!fHide;pl.glass.visible=glassBy.has(pl)&&!fHide;pl.frameLine.visible=!fHide;pl.handle.visible=!fHide;if(gc!==undefined)pl.glow.material.color.setHex(gc);
   // under 「実際に隠す」 the part of the frame (outline, arrow, tag) behind tissue is not drawn (no ghost); lit = the laser is on its band / tag, or it is held (the glow shows): then all of it is on top
   const dTest=frameDepthTest(occF,gc!==undefined);pl.mat.depthTest=dTest;pl.handle.material.depthTest=dTest;pl.glass.material.depthTest=frameDepthTest(occF,false);
   pl.aOp=arrowFade(pl.aOp,gc!==undefined||performance.now()<pl.aFlash,dt);pl.amat.opacity=pl.aOp}} // the arrow fades in while the plane is lit / grabbed (gc), out otherwise
  const st=section.on?(controllers.some(c=>c.userData.drag)?L.stHeld:L.stFixed):L.stNone;
  if(mesh&&st!==ui.status){ui.status=st;menu.refresh()}
  if(material){
   const u=material.uniforms;
   // planes in the volume's object space. 'near': the normal is flipped so
   // the eye is on the removed side; 'one side': the plane's chosen side
   // stays removed wherever the viewer goes
   let n=0,cutBits=0;
   if(section.on){scene.updateMatrixWorld();tmpE.copy(head);mesh.worldToLocal(tmpE);
    for(const pl of planes){
     pl.obj.getWorldPosition(tmpP);tmpN.set(1,0,0).transformDirection(pl.obj.matrixWorld);
     tmpQ.copy(tmpP).add(tmpN);mesh.worldToLocal(tmpP);mesh.worldToLocal(tmpQ);tmpN.subVectors(tmpQ,tmpP).normalize();
     if(settings.cut===2){if(pl.side<0)tmpN.negate()}else if(tmpN.dot(tmpE)-tmpN.dot(tmpP)>0)tmpN.negate();
     pl.arrow.visible=arrowShown(settings.cut,pl.cut,pl.aOp)&&!fHide;pl.arrow.scale.x=-pl.side;
     u.cutPlanes.value[n].set(tmpN.x,tmpN.y,tmpN.z,tmpN.dot(tmpP));if(pl.cut&&settings.cut)cutBits|=1<<n;n++;
    }}
   if(bench.noSection){n=0;cutBits=0}
   u.planeCount.value=n;u.planeCut.value=cutBits;u.capOn.value=settings.cap?1:0;u.ctShade.value=settings.ctShade?1:0;u.ctShadeBright.value=ctBrightOf(settings.ctShadeBright);u.ctShadeContrast.value=ctContrastOf(settings.ctShadeContrast);u.sliceOpacity.value=section.on&&!bench.noSection&&!ui.sliceClear?settings.sliceOpacity:0;
   // slice at 0 % (slider 0 OR cleared by the thumbstick click / double pinch): the segments' region only (sliceSegOnly), drawn through the slice path at opacity 1 (the shader sets the fill's own opacity); see sliceDrawState
   {const d=sliceDrawState({on:section.on&&!bench.noSection,clear:ui.sliceClear,opacity:settings.sliceOpacity,tint:settings.sliceTint,ctShade:settings.ctShade});u.sliceSegOnly.value=d.segOnly;u.sliceOpacity.value=d.opacity}
   u.sliceTint.value=+settings.sliceTint||0;
   u.sliceWindow.value.set(vrWindow.c,Math.max(1,vrWindow.w));u.sliceAir.value=Number.isFinite(+settings.sliceAir)?+settings.sliceAir:DEFAULTS.sliceAir;
   // the rebuild steps first, then the shown set as the shader sees it = the shown segments within the texture's safe mask (a
   // segment just shown appears once its alpha is uploaded; the jumps stay on, no interim without them); refreshContentBox reads it after
   comboTick();refreshCombo();
   // (held: shown segments none of which is in that mask yet, a swap: the old ones stay until the first step of the rebuild is uploaded)
   const slotKeys=gpuSegmentOrder(),vis=comboShaderMask(),sh=shownMask(),held=sh&&!(sh&vis)?vis:0;
   for(let i=0;i<4;i++){
    const key=slotKeys[i],seg=segmentState[key];
    u.segA.value[i].set(seg?.min||0,seg?.max||0,1,(held>>i&1)||(vis>>i&1)&&segAvail(seg)&&segMode[key]!==2?1:0);
    color.set(seg?.color||'#ffffff');u.segC.value[i].set(color.r,color.g,color.b,segMode[key]===1?1:0);const mat=MATERIALS[materialKey(seg?.material)];u.segM.value[i].set(mat.ambient,mat.spec,mat.shininess,0);
   }
   refreshContentBox();
   skipTick(); // after the shader's shown set of the frame is set
  }
  benchTick();
  {const nowH=performance.now();if(nowH-vpHiddenAt>=100)updateHidden(nowH);
   let previewArg=null;for(const x of controllers)if(x.userData.moving){previewArg={id:x.userData.moving.id,voxel:x.userData.placement?.voxel||null};break}
   lblLit.clear();for(const x of controllers){const r=x.userData.res;if(r&&r.kind==='mlabel'&&r.ref&&!r.ref.pin)lblLit.add(r.ref.id);if(x.userData.lblDrag&&!x.userData.lblDrag.pin&&x.userData.press)lblLit.add(x.userData.lblDrag.id)} // the label the laser is on stays lit while it is grabbed
   // the active section = the selected one while sections are on, as the shader's plane (object space, unit normal, same index as planes)
   let secPl=null;if(section.on&&section.selected&&material&&!bench.noSection){const i=planes.indexOf(section.selected);if(i>=0&&i<material.uniforms.planeCount.value){const q=material.uniforms.cutPlanes.value[i];secPl={x:q.x,y:q.y,z:q.z,w:q.w}}}
   vpMarkers.update({fingerprint:vrFp,dims:vrDims,halfExt:vrHalfExt,mesh:mesh?.parent?mesh:null,head,hidden:vpHidden,section:secPl,selectedId:vpSel,hover:hoverIds,preview:previewArg,occlusion:occlusionGpu()});
   const msId=getMeasureStart(),mh=msId&&measureHintHand?.id===msId&&measureHintHand.c.visible!==false?measureHintHand.c:null; // the hint floats above the controller that placed the start point
   if(mh){mh.updateWorldMatrix(true,false);mh.getWorldPosition(tmpHintHand)}
   vpMeasure.update({fingerprint:vrFp,dims:vrDims,halfExt:vrHalfExt,mesh:mesh?.parent?mesh:null,head,spacing:vrSpacing,warn:!!spacingNote(),startId:getMeasureStart(),hint:L.ptDistHint,gaze:headGaze,handPos:mh?tmpHintHand:null,now:nowH,preview:previewArg,lit:lblLit,hidden:vpMeasHidden,occlusion:occlusionGpu()})}
  // data-resolution cap (vr-render-scale.js): the volume box projected with each eye's camera gives the covered pixels and the screen
  // pixels per voxel; the render scale is capped where every voxel still gets PPV_CENTER (centre) / PPV_FAR (far corner) pixels. Decided every
  // frame, so a zoom or a step towards the volume changes it at once (no ramp). In every mode, 100 % included (100 % = full data detail).
  let xrCam=null;
  if(mesh&&material){
   renderer.xr.updateCamera(camera);xrCam=renderer.xr.getCamera();
   const cams=xrCam.cameras,u=material.uniforms;
   if(cams.length){
    mesh.updateWorldMatrix(true,false);rsHalf[0]=u.halfExt.value.x;rsHalf[1]=u.halfExt.value.y;rsHalf[2]=u.halfExt.value.z;rsDims[0]=u.texDims.value.x;rsDims[1]=u.texDims.value.y;rsDims[2]=u.texDims.value.z;
    const bH=u.boxH.value,bC=u.boxC.value;let rsBox=null;if(bH.x>0){rsBoxV.c[0]=bC.x;rsBoxV.c[1]=bC.y;rsBoxV.c[2]=bC.z;rsBoxV.h[0]=bH.x;rsBoxV.h[1]=bH.y;rsBoxV.h[2]=bH.z;rsBox=rsBoxV}
    let cov=0,outF=0,raw=CAP_MIN,ppv=Infinity,ppvFar=Infinity;
    for(let i=0;i<cams.length&&i<2;i++){const sub=cams[i],v=sub.viewport,rsEye=rsEyes[i];
     eyeMetrics(mesh.matrixWorld.elements,rsHalf,rsDims,sub.matrixWorldInverse.elements,sub.projectionMatrix.elements,v.z,v.w,rsEye,rsBox); // on the content box
     cov+=rsEye.cover;if(rsEye.cover>0){raw=Math.max(raw,capFromPpv(rsEye.ppvCenter,rsEye.ppvFar));ppv=Math.min(ppv,rsEye.ppvCenter);ppvFar=Math.min(ppvFar,rsEye.ppvFar)}
     foveaRect(rsEye.cx,rsEye.cy,v.z,v.w,rsFov[i]);outF+=outsideFovea(rsEye,rsFov[i]);rsFov[i][0]+=v.x;rsFov[i][2]+=v.x;rsFov[i][1]+=v.y;rsFov[i][3]+=v.y}
    rs.cover=cov;rs.outside=outF;if(cov>0){rs.cap=nextCap(rs.cap,raw);rs.ppv=ppv;rs.ppvFar=ppvFar} // nothing covered: keep the last cap
    rs.split=cams.length>1?cams[1].viewport.x:1e9;
   }
   if(bench.active||anBench.active)rs.cap=1; // benchmarks measure the resolutions they set
  }
  // auto: frame interval from the XR loop, checked twice a second
  const auto=!VRES[settings.vres];
  aq.setCeiling(rs.cap);
  if(auto){
   autoFrames++;const nowA=performance.now();
   if(!bench.active&&!anBench.active)aq.anticipate(holder.scale.x,nowA); // a fast zoom-in lowers the resolution at once (vr-auto-quality.js anticipate), before the 0.5 s window measures the slow frames
   if(nowA-autoAt>=500){
    const interval=(nowA-autoAt)/autoFrames,budget=1000/(targetRate()||72);
    const volMs=ctrlN.vol?ctrl.vol/ctrlN.vol:0,mainMs=ctrlN.main?ctrl.main/ctrlN.main:0;
    // degradation ladder (vr-auto-quality.js): resolution down to 70 %, then the step 1 → 1.5 → 2, then the floor; recovery in reverse.
    // GPU time from the timer query when the extension is offered (mainMs > 0); otherwise the wall-clock frame interval, which the refresh rate caps.
    const uA=material?.uniforms,ctxKey=uA?[holder.scale.x.toFixed(2),uA.segA.value.map(v=>v.w).join(''),uA.planeCount.value,uA.planeCut.value,uA.sliceOpacity.value>0?1:0,settings.data|0,uA.distInCls.value].join('|'):''; // view size, shown segments, section, data grid: a change lets the scaler try higher levels again
    // while a shown segment's texture is being rebuilt the march runs without jumps (applyCombo, about 0.5-1 s): those samples are dropped (the
    // ladder would step down and keep that level locked for FAIL_LAPSE); distInCls in ctxKey also clears a lock taken then once the jumps are back
    const comboInterim=!!comboT?.rb?.busy&&!!uA&&!uA.useDist.value;
    if(!comboInterim){const r=aq.update({volMs,mainMs,interval,budget,ctx:ctxKey,cover:rs.cover}); // a jump in the covered screen pixels makes the ladder react on the first sample.: the screen coverage only, not x eff² (the ladder's own scale fed back as a coverage change made it oscillate 0.70 <-> 0.60 every 0.5 s)
    if(r.stepChanged&&material)material.uniforms.stepSize.value=baseStep*(STEP[aq.stepIdx]??1);}
    const stepTxt=(ja?' · 刻み ':' · step ')+STEP[aq.stepIdx];
    ui.autoLine=mainMs>0?(ja?'自動: GPU ボリューム ':'auto: GPU volume ')+volMs.toFixed(1)+' ms · '+(ja?'本描画 ':'main ')+mainMs.toFixed(1)+' ms / '+(ja?'予算 ':'budget ')+budget.toFixed(1)+' ms → '+Math.round(aq.f*100)+'%'+stepTxt
     :(ja?'自動（間隔）: ':'auto (interval): ')+interval.toFixed(1)+' ms / '+budget.toFixed(1)+' ms → '+Math.round(aq.f*100)+'%'+stepTxt;
    ctrl.vol=ctrl.main=0;ctrlN.vol=ctrlN.main=0;autoFrames=0;autoAt=nowA;
   }
  }
  const benchOn=bench.active||anBench.active,nowG=performance.now(),fRaw=auto?aq.f:Math.min(VRES[settings.vres]??1,rs.cap);
  const f=benchOn?fRaw:scaleGuard.step(fRaw,nowG); // flicker guard: path hysteresis (direct holds down to 90 %) + frozen while it would flap (benchmarks set their own scales)
  // offscreen foveation. The direct path (f = 1) has the headset's fixed foveation (setFoveation); the offscreen pass had none, so
  // the centre rect (about +-30 deg) is drawn at f and the whole eye at f x FOVEA_K (周辺の簡略化: なし 1 / 中 0.75 / 強 0.5) into a second target
  const kF=FOVEA_K[settings.foveation|0]??1,fovRaw=f<1&&foveaWorth(rs.outside,rs.cover,kF,rs.per<1)&&!bench.active&&!anBench.active&&!!xrCam&&xrCam.cameras.length>0,fov=f<1&&fovGuard.step(fovRaw,nowG),fp=fov?f*kF:f; // only when enough of the volume lies outside the rect; not in the benchmarks (comparable with earlier builds)
  rs.eff=f;rs.per=fov?kF:1;
  {const nF=scaleGuard.freezes+fovGuard.freezes+variantGuard.freezes;if(nF>guardFreezes){guardFreezes=nF;console.warn('VR flicker guard: a drawing choice alternated too fast and is held',{f:fRaw,fov:fovRaw})}}
  if(mesh){
   const vk=benchOn?variantKey():variantGuard.step(variantKey(),nowG); // flicker guard: a variant flapping is drawn with 'full' (every state correct) for a while
   const xrTarget=renderer.getRenderTarget(),w=xrTarget?.width||1,h=xrTarget?.height||1;
   // both offscreen targets are allocated once per session at their largest size (the XR framebuffer, the periphery at the largest
   // FOVEA_K below 1) as soon as the XR framebuffer exists, and only the used corner is cleared / drawn / sampled: changing f never reallocates
   if(xrTarget)ensureLowTargets(w,h);
   if(f<1&&lowTarget){
    // own pass per eye into the offscreen target, then the composite material on the same box upscales it inside the main XR render
    const tw=lowTarget.width,th=lowTarget.height,cams=xrCam.cameras;
    scene.updateMatrixWorld();rayMesh.matrixWorld.copy(mesh.matrixWorld);rayMesh.material=(diagAn.noRegion?plainSets().ray:rayVariants)[vk];
    renderer.xr.enabled=false;renderer.setClearColor(0x000000,0);
    timed('vol',()=>{
     clearCorner(lowTarget,Math.ceil(w*f)+2,Math.ceil(h*f)+2);
     for(let i=0;i<cams.length;i++){const sub=cams[i],v=sub.viewport,x=Math.floor(v.x*f),y=Math.floor(v.y*f),vw=Math.ceil(v.z*f),vh=Math.ceil(v.w*f);
      lowTarget.viewport.set(x,y,vw,vh);
      if(fov&&i<2){const R=rsFov[i],sx=Math.max(x,Math.floor(R[0]*f)-1),sy=Math.max(y,Math.floor(R[1]*f)-1);lowTarget.scissor.set(sx,sy,Math.min(x+vw,Math.ceil(R[2]*f)+1)-sx,Math.min(y+vh,Math.ceil(R[3]*f)+1)-sy)} // the centre rect only (1 px margin for the bilinear upscale)
      else lowTarget.scissor.set(x,y,vw,vh);
      lowTarget.scissorTest=true;renderer.setRenderTarget(lowTarget);renderer.render(volScene,sub);
     }
     if(fov){
      clearCorner(periTarget,Math.ceil(w*fp)+2,Math.ceil(h*fp)+2);
      for(const sub of cams){const v=sub.viewport,x=Math.floor(v.x*fp),y=Math.floor(v.y*fp),vw=Math.ceil(v.z*fp),vh=Math.ceil(v.w*fp);
       periTarget.viewport.set(x,y,vw,vh);periTarget.scissor.set(x,y,vw,vh);periTarget.scissorTest=true;renderer.setRenderTarget(periTarget);renderer.render(volScene,sub)}
     }
    });
    rs.low=true;rs.w=w;rs.h=h;rs.eyes=cams.length; // the size line is built once a second (no strings per frame)
    lowTarget.scissorTest=false;if(periTarget)periTarget.scissorTest=false;renderer.setRenderTarget(xrTarget);renderer.xr.enabled=true;renderer.setClearColor(vt.passthrough?0x000000:BG,vt.passthrough?0:1);
    const cu=compMaterial.uniforms;cu.img.value=lowTarget.texture;cu.depthImg.value=lowTarget.depthTexture;cu.invSize.value.set(f/tw,f/th);cu.uvMax.value.set((Math.ceil(w*f)-0.5)/tw,(Math.ceil(h*f)-0.5)/th);
    cu.fovOn.value=fov?1:0;
    if(fov){cu.img2.value=periTarget.texture;cu.depthImg2.value=periTarget.depthTexture;cu.invSize2.value.set(fp/periTarget.width,fp/periTarget.height);cu.uvMax2.value.set((Math.ceil(w*fp)-0.5)/periTarget.width,(Math.ceil(h*fp)-0.5)/periTarget.height);
     const L0=rsFov[0],R0=rsFov[1];cu.rectL.value.set(L0[0],L0[1],L0[2],L0[3]);cu.rectR.value.set(R0[0],R0[1],R0[2],R0[3]);cu.splitX.value=rs.split;cu.band.value=L0[4]}
    mesh.material=compMaterial;
   }else{mesh.material=(diagAn.noRegion?plainSets().vars:variants)[vk];rs.low=false;rs.w=w;rs.h=h}
   if(firstDrawMs<0)firstDrawMs=performance.now()-sessionAt;
  }
  if(tutVr&&ui.open&&ui.tab===10){const mk=tutVr.menuKey();if(mk!==tutMenuKey){tutMenuKey=mk;menu.refresh()}} // the menu's tutorial pointer animates (at most 2 redraws a second, only while a step lights a widget, and still 20 s after the board last changed)
  if(loadInfo){loadBoard.mesh.visible=true;const nl=performance.now();if(nl-loadDrawn>=500){loadDrawn=nl;if(loadInfo.stage==='upload'||loadInfo.stage==='refine'){const left=uploadQueue.bytesLeft;loadInfo.peak=Math.max(loadInfo.peak||0,left);loadInfo.sub=loadInfo.peak?1-left/loadInfo.peak:0}loadBoard.refresh()}loadBoard.flush()}else if(loadBoard.mesh.visible)loadBoard.mesh.visible=false; // the 「読み込み中」 board
  if(ui.open)menu.flush(); // a closed menu is not redrawn / re-sent (its texture is not drawn); setMenuOpen(true) refreshes it
  const hk=[section.on,ui.open,ui.open&&ui.tab===10,helpShow].join()+(tutVr?tutVr.drawKey():'')+(tutPreview&&helpShow==='detail'?tutPreview.drawKey():'');if(hk!==helpKey){helpKey=hk;help.refresh()}help.flush();
  sums.js+=performance.now()-js0;counts.js++;
  timed('main',()=>renderer.render(scene,camera));
  if(shotRequested){shotRequested=false;try{takeScreenshot()}catch(e){console.error(e)}}
  frames++;const now=performance.now();
  if(hist.isOpen){histCbMs=now-js0;histPerMs=1000/targetRate()} // the histogram pass's budget in this frame (histBudget)
  if(now-fpsAt>=1000){
   fps=frames*1000/(now-fpsAt);frames=0;fpsAt=now;
   ui.fpsLine=(firstDrawMs>=0?(ja?'初回描画 ':'first draw ')+Math.round(firstDrawMs)+' ms · ':'')+fps.toFixed(0)+' fps · '+(ja?'ボリューム ':'volume ')+avg('vol')+' ms · '+(ja?'本描画 ':'main ')+avg('main')+' ms · JS '+avg('js')+' ms'+(timerExt?'':(ja?'（GPU計測なし）':' (no GPU timer)'));
   const f1s=rs.eff,fps1=f1s*rs.per;sizes=rs.low?(ja?'縮小描画 ':'low ')+Math.round(f1s*100)+'% '+Math.ceil(rs.w*f1s)+'×'+Math.ceil(rs.h*f1s)+(rs.per<1?(ja?' 周辺 ':' periphery ')+Math.round(fps1*100)+'%':'')+' / XR '+rs.w+'×'+rs.h+' ('+rs.eyes+(ja?'眼':' eyes')+')':(ja?'直接描画 ':'direct ')+'XR '+rs.w+'×'+rs.h;
   // the honest quality readout: the mode and, when the data-resolution cap draws fewer pixels, the effective scale (+ px per voxel, covered px)
   {const q=qualityReadout();if(q!==ui.qualityLine){ui.qualityLine=q;if(ui.open&&ui.tab===3)menu.refresh()}}
   ui.sizeLine=sizes+' · '+scaleLineText(holder.scale.x,realLongMm(),language)+' · '+info+' · '+(ja?'データ ':'data ')+((settings.data|0)?'256':'512')+(ja?' · 表示セグメント ':' · shown segments ')+SEGMENT_PRESET_ORDER.filter(k=>{const g=segmentState[k];return g?.active&&g?.enabled&&segMode[k]!==2}).length;
   // one line for the Quest numbers: fps / auto % / step / samples per ray / ended by hit / skipped by jumps / GPU ms
   ui.diagLine=fps.toFixed(0)+' fps · '+qualityText({auto:!VRES[settings.vres],modeF:VRES[settings.vres]||aq.level,eff:rs.eff,periphery:rs.per},ja)+' · '+(ja?'刻み ':'step ')+STEP[VRES[settings.vres]?settings.quality|0:aq.stepIdx]+(probe?' · '+(ja?'反復 ':'samples ')+probe.samples.toFixed(0)+(ja?' · hit終了 ':' · hit end ')+Math.round(probe.hit*100)+'% · '+(ja?'跳躍 ':'jump ')+Math.round(probe.skip*100)+'%':'')+' · vol '+avg('vol')+' ms · '+(ja?'本 ':'main ')+avg('main')+' ms';
   // only while the menu is open. Closed, these ran every second anyway: the 48×48 probe (a synchronous
   // readRenderTargetPixels, a GPU stall) and a full redraw of the 1024×1180 menu canvas (+ texture upload): a once-a-second hitch on the
   // Quest that also fed the auto-quality downgrade. The self-check's probe (env.probe, probeReq above) is separate and unchanged.
   if(ui.open&&ui.tab===4)try{measureSamples()}catch(e){console.warn(e)}
   if(ui.open&&(ui.tab===4||ui.flash))menu.refresh();
   if(ui.flash&&now>ui.flashUntil)ui.flash='';
   for(const k in sums){sums[k]=0;counts[k]=0}
  }
 });
 const cleanup=()=>{try{tutVr?.dispose()}catch(e){console.warn('[tutorial] dispose',e)}for(const g of [glowHelp,glowMenu]){try{g.geometry.dispose();g.material.dispose()}catch{}}try{ctlHints.dispose();edgeArrow.dispose();boardArrow.dispose()}catch(e){console.warn('[tutorial] 3D guides dispose',e)}
  renderer.setAnimationLoop(null);if(probeReq){const q=probeReq;probeReq=null;q.res(null)}selfCheck.dispose(); // a pending self-check probe resolves (no frame will serve it) //: unwinds a running scenario, shows the result panel on the page
  vrCacheNotify=null;swapGuard.cancel();abortVrPrepare();uploadQueue.clear();frameGaps.stop();for(const t of swapMade)t.dispose();swapMade.length=0;loadBoard.dispose();sliceToast.dispose();probeTarget.dispose();volTex?.dispose();brickTex?.dispose();comboT?.combo?.dispose();comboTs.forEach(t=>{t.rb.dispose();t.rb=null});comboTs.length=0;disposeExtra();disposeEdits();for(const st of msets.values()){Object.values(st.variants).forEach(m=>m.dispose());Object.values(st.rays).forEach(m=>m.dispose())}gpuWarm.forEach(m=>m.dispose());compMaterial?.dispose();lowTarget?.dispose();periTarget?.dispose();mesh?.geometry.dispose();scaleTag.dispose();menu.dispose();help.dispose();ev?.dispose();unsubHist();unsubLabelHist();labelHist.dispose();hist.dispose();badge.userData.dispose();
  background.traverse(o=>{o.geometry?.dispose();o.material?.dispose()});planes.forEach(disposePlane);flying.forEach(f=>disposePlane(f.pl));flying.length=0;secUndo.clear();undoBtn.dispose();flingDbg?.dispose();unsubComments();huLine.dispose();setHuLineDeferred(false);vpMarkers.dispose();vpMeasure.dispose();cancelMeasure();surfCursors.forEach(x=>x.dispose());wheel.dispose();pointWheel.dispose();ringGeo.dispose();ring.material.dispose();
  // the session's WebGL context is ended now, not left to the garbage collector: headless, it was still alive (not lost) after the session ended and
  // a forced GC; every session start makes a new one (prepareVrGpu). On Quest VR -> AR -> VR crashed the browser
  renderer.dispose();try{renderer.forceContextLoss?.()}catch{}renderer.domElement.remove();running=null;
  showShotsPanel(ja);showBenchPanel(ja);
 };
 session.addEventListener('end',()=>{if(activeSwapPf)activeSwapPf.cancelled=true;emit('session-end');cleanup();step('ended')},{once:true});
 try{
  // prepared before the session (or now, if the data changed meanwhile)
  P=await prepareVrData(({phase,done,total})=>{ui.status=L.preparing+(phase==='read'?done+' / '+total:phase);menu.refresh()});
  vd=P.vd;
  if(!running)return;
  const makeTextures=makeVolumeTextures,allCompiled=!!gpu&&gpu.key===P.key&&!!gpu.compiledAll; // allCompiled: prepareVrGpu compiled every program set (no parallel compile: see shouldPrecompileSets)
  // a 512³ upload without the page-side preparation runs here, inside the session: say so before the view stalls
  if(!(gpu&&gpu.key===P.key&&gpu.full)){ui.status=L.uploading;menu.refresh();await nextFrames(session);if(!running)return}
  if(gpu&&gpu.key!==P.key){disposeGpuPrepared();}
  // classification texture from the prepared bytes (only on the ≤256 grid)
  // classification bytes for the laser's volume hit (the ≤256 grid they were built on)
  const clsTexture=t=>{
   const c=P.cls;if(!c||(P.half||vd).dims.join()!==t.dims.join())return null;
   const x=new THREE.Data3DTexture(c.data,...t.dims);x.format=c.C===1?THREE.RedFormat:c.C===2?THREE.RGFormat:THREE.RGBAFormat;x.userData.chan=c.chan;x.type=THREE.UnsignedByteType;x.minFilter=x.magFilter=THREE.LinearFilter;x.unpackAlignment=1;x.needsUpdate=true;
   return x;
  };
  // distance field texture, same grid and channels as the classification, nearest sampling
  const distTexture=t=>{
   const c=P.dist;if(!c||(P.half||vd).dims.join()!==t.dims.join())return null;
   const x=new THREE.Data3DTexture(c.data,...t.dims);x.format=c.C===1?THREE.RedFormat:c.C===2?THREE.RGFormat:THREE.RGBAFormat;x.type=THREE.UnsignedByteType;x.minFilter=x.magFilter=THREE.NearestFilter;x.unpackAlignment=1;x.needsUpdate=true;
   return x;
  };
  // content box state (refreshContentBox): the segment part from a resumable scan (cbScan; the shown part cbSeg* with the
  // segments it was built for), the slice part from the slab maxima of vd (cbSliceIdx, built here once: one pass over the bricks)
  let cbGrid=null,cbOff=null,cbSegOk=false,cbSl=null,cbAir=NaN,cbDirty=true;const cbKey=new Float64Array(KEY_LEN).fill(NaN),cbSegs=[{},{},{},{}],cbShownSegs=[{},{},{},{}],
   cbSegLo=new Float64Array(3),cbSegHi=new Float64Array(3),cbSliLo=new Float64Array(3),cbSliHi=new Float64Array(3),cbLo=new Float64Array(3),cbHi=new Float64Array(3),cbOut={c:[0,0,0],h:[0,0,0]};
  // 512 / 256 data (256 made on first use, kept for the session)
  useData=i=>{
   const wantHalf=!!P.half&&(i===1||!fullReady),t=wantHalf?(half||=makeTextures(P.half)):full; // until the 512 grid is in the GPU (a switch shows the 256 grid first) the 256 grid is used whatever the setting says
   material.uniforms.sliceVol.value=fullReady&&full.v?full.v:t.v;material.uniforms.vol.value=t.v;material.uniforms.bricks.value=t.b;material.uniforms.texDims.value.set(...t.dims);material.uniforms.brickDims.value.set(...t.brickDims);
   info=t.dims.join('×')+(vd.filtered?L.filtered:'');cbGrid=wantHalf?P.half:vd;cbKey.fill(NaN);cbSegOk=false; // the content box follows the grid in use (564: the old grid's box is dropped)
   // classification only on grids of at most 256 (512³ × 4 bytes is too big);
   // built on first use from this grid's data and the processing mask
   if(Math.max(...t.dims)<=256&&!t.cls&&!(settings.clsDiag|0))t.cls=clsTexture(t);
   const on=!!t.cls&&!(settings.clsDiag|0);
   material.uniforms.useCls.value=on?1:0;material.uniforms.clsTex.value=t.cls||dummyEdit;if(t.cls)material.uniforms.clsChan.value.set(...t.cls.userData.chan);
   // sphere tracing needs the classification grid (the distances describe its boundaries)
   // the separate field texture (67 MB at 256³) is uploaded only when the combined texture cannot serve
   // it serves four stored segments too (the fourth from its own R8 texture, VRL_CLS4), so the general loop is no longer used for them
   const comboOk=on&&P.cls&&P.dist;
   if(on&&!t.dist&&P.dist&&!comboOk)t.dist=distTexture(t);
   const onD=on&&(comboOk||!!t.dist)&&!(settings.distDiag|0);
   material.uniforms.useDist.value=onD?1:0;material.uniforms.distTex.value=t.dist||dummyEdit;material.uniforms.voxelMin.value=Math.min(2*vd.halfExt[0]/t.dims[0],2*vd.halfExt[1]/t.dims[1],2*vd.halfExt[2]/t.dims[2]);
   // the march step follows the texture in use (vr-auto-quality.js marchStep): 256³ data steps 0.85 of its own voxel, as 512³ does
   baseStep=marchStep(vd.halfExt,t.dims);material.uniforms.stepSize.value=baseStep*(STEP[VRES[settings.vres]?settings.quality|0:aq.stepIdx]??1);
   material.uniforms.voxelSize.value.set(...depthVoxelSize(vd.halfExt,t.dims,vrDims?[vrDims.columns,vrDims.rows,vrDims.slices]:null)); // the depth bias follows the voxel's extent along the ray (anisotropic spacing)
   // classification + combined distance in one RGBA texture (needs a free channel: at most three segments stored)
   comboT=onD&&comboOk?t:null;comboMask=-1;refreshCombo();
   refreshEdits();
  };
  // the alpha depends on which segments are shown: rebuilt (about 0.2 s at 256³) when that set changes
  // four stored segments: the fourth one's bytes in t.cls4 (built once), the VRL_CLS4 variants (cls4On) while the combined texture is in use (four: set with the data, install)
  const useCombo=t=>{material.uniforms.clsTex.value=t.combo;material.uniforms.clsChan.value.set(...P.cls.chan);material.uniforms.distInCls.value=1;
   if(four){if(!t.cls4)t.cls4=makeCls4Texture(fourthChannelBytes(P.cls),t.dims);material.uniforms.cls4Tex.value=t.cls4}cls4On=four};
  // exact creep skip (docs/vr-skip-occupancy.js). The bits are built from the combined texture's own bytes for the mask it holds, off the frame (1.5 ms per frame, resumable), once no rebuild
  // is running; useSkip is 0 meanwhile, during every combo rebuild (the alpha on the GPU is in flux) and whenever the shader shows a segment the bits do not cover, so a stale bit can never hide content.
  // The 詳細 menu / the debug switch vrNoSkip turn it off (settings.skipDiag): the picture is identical either way, only the number of fetches differs.
  skipTick=()=>{
   const u=material?.uniforms;if(!u)return;
   const t=comboT;let r=null;
   if(t?.combo&&u.clsTex.value===t.combo){
    let shown=0;for(let i=0;i<4;i++)if(u.segA.value[i].w>0.5)shown|=1<<i;
    const sk=t.skip||(t.skip=createSkipState({dims:t.dims,chan:P.cls.chan,makeTexture:bits=>makeSkipTexture(bits,skipGrid(t.dims)),touchTexture:x=>{x.needsUpdate=true}}));
    r=sk.step({data:t.combo.image.data,cls4:four?t.cls4?.image?.data||null:null,busy:!!t.rb?.busy,content:t.comboMask,shown,off:(settings.skipDiag|0)===0});
   }
   u.useSkip.value=r?r.use:0;u.skipTex.value=r&&r.use?r.tex:skipDummy();
  };
  // a change of the shown set no longer rebuilds and re-sends the whole texture inside one frame (0.2-0.4 s + 64 MB at
  // 256³): vr-combo-rebuild.js computes the new alpha off the frame (worker) and comboTick uploads it a few z slices per frame (uploadCombo).
  // Until it is complete the picture stays correct (applyCombo): the classification channels never change; the jumps stay on only while every
  // alpha in the texture is a min over a superset of the shown segments (hiding one: rb.jumpsSafe), otherwise the general loop draws without
  // jumps (distInCls = 0, useDist = 0: classification + brick skipping, the 距離場 diagnostic's path) from the same texture. The first build of a
  // grid (session start, data switch) stays synchronous as before.
  const comboBox=new THREE.Box3(),comboAt=new THREE.Vector3();
  // texSubImage3D of z slices [z0, z1) through three.js: the source is a texture the renderer never saw (it wraps the same bytes), so
  // copyTextureToTexture takes its CPU branch (UNPACK_SKIP_IMAGES = z0); the target is never flagged needsUpdate (no full re-send)
  const uploadCombo=(t,z0,z1)=>{
   if(!t.comboSrc){const x=new THREE.Data3DTexture(t.combo.image.data,...t.dims);x.format=THREE.RGBAFormat;x.type=THREE.UnsignedByteType;x.unpackAlignment=1;t.comboSrc=x}
   comboBox.min.set(0,0,z0);comboBox.max.set(t.dims[0],t.dims[1],z1);comboAt.set(0,0,z0);renderer.copyTextureToTexture(t.comboSrc,t.combo,comboBox,comboAt);
  };
  // the jumps stay on through a rebuild. drew a newly shown segment at once through the general loop without jumps until the
  // upload was complete (0.5-1 s): that variant costs about 20x a frame (headless SwiftShader: 420-460 ms vs 18-26 ms) and its offscreen program
  // was compiled on the first such frame (1.6 s there): the hitch on Quest. Now the shader's shown set is held within rb.safeMask (comboShaderMask, frame loop), where the
  // alpha is a lower bound of the distance to every drawn surface: the old state for those frames, the exact final picture after.
  const applyCombo=t=>{useCombo(t);material.uniforms.useDist.value=1};
  comboShaderMask=()=>{const t=comboT;return t?(t.rb?t.rb.safeMask:t.comboMask):15};
  refreshCombo=()=>{
   const t=comboT;
   if(!t){material.uniforms.distInCls.value=0;cls4On=false;return}
   const mask=shownMask();
   if(mask===comboMask)return;
   comboMask=mask;
   if(!t.combo){
    const data=combineClassificationDistance(P.cls,P.dist,mask,null,{four});
    if(!data){material.uniforms.distInCls.value=0;cls4On=false;return}
    t.combo=makeComboTexture(data,t.dims);t.comboMask=mask;
    useCombo(t);return;
   }
   // prepared on the page for this mask or already rebuilt: no rebuild, no upload
   if(!t.rb&&t.comboMask===mask){useCombo(t);material.uniforms.useDist.value=1;return}
   if(!t.rb){t.rb=createComboRebuild({dist:P.dist,chan:P.cls.chan,dims:t.dims,data:t.combo.image.data,mask:t.comboMask,upload:(z0,z1)=>uploadCombo(t,z0,z1)});comboTs.push(t)}
   t.rb.request(mask);t.comboMask=t.rb.contentMask;
   applyCombo(t);
  };
  // once per frame (before the render): the rebuild's next step; the jumps come back when it is complete
  comboTick=()=>{const t=comboT;if(!t?.rb?.busy)return;const done=t.rb.tick();t.comboMask=t.rb.contentMask;if(done)applyCombo(t)};
  // processed segments: built once when VR starts (edits cannot change in
  // VR), on a grid of at most 256 per side (texture coordinates are
  // normalised, so it serves both data sizes); the filter follows the
  // diagnostic setting (0 smooth, 1 nearest, 2 off)
  const dummyEdit=new THREE.Data3DTexture(new Uint8Array(4),1,1,1);dummyEdit.format=THREE.RGBAFormat;dummyEdit.needsUpdate=true;
  ui.status=L.compiling;menu.refresh();await nextFrames(session);if(!running)return; // the first volume frame compiles the shaders; the menu says so first
  refreshEdits=()=>{
   if(!material)return;const mode=settings.editDiag|0;
   if(editTex){const f=mode===1?THREE.NearestFilter:THREE.LinearFilter;if(editTex.minFilter!==f||!editTex.userData.up){editTex.minFilter=editTex.magFilter=f;editTex.needsUpdate=true;editTex.userData.up=true}}
   material.uniforms.editMask.value=mode===2?0:editActive;material.uniforms.editMaskOnly.value=mode===2?0:(P.edit.maskOnly|0);material.uniforms.editTex.value=editTex||dummyEdit;
   // analysis result colours
   material.uniforms.regionTex.value=regionTex||dummyEdit;regionColors.forEach((c,i)=>{color.setHex(c);material.uniforms.regionC.value[i].set(color.r,color.g,color.b);material.uniforms.regionSeg.value[i]=regionSegs[i]|0});
  };
  // content box (vr-content-box.js): the proxy box of the volume pass is the box of what can be drawn (shown segments by the shader's
  // brick test, the CT slices where they are above sliceAir). 詳細 「内容ボックス オフ」 (boxDiag) draws the full box as before.
  // never blocks a frame: what it depends on is compared every frame without allocating; a segment change restarts the scan, which
  // runs under 1 ms per frame (segScanStep) - meanwhile the last box stays when it still covers the new segments (segsSubset: a segment
  // hidden or a range narrowed), else the full box is drawn; a slice / sliceAir change costs O(slabs) (sliceRange). The mask-only bits of the
  // data count even when the shader's are off (editDiag 2 with the classification: its bytes keep the mask) - maskAny, conservative
  refreshContentBox=()=>{
   if(!material)return;const u=material.uniforms,off=(settings.boxDiag|0)===1||!cbGrid;
   if(off!==cbOff){cbOff=off;cbDirty=true;cbKey.fill(NaN);cbSegOk=false;cbSl=null}
   if(!off){
    const segs=segsFromUniforms(u.segA.value,u.editMaskOnly.value,cbSegs,editActive?(P.edit.maskOnly|0):0),slices=u.planeCount.value>0&&u.sliceOpacity.value>0,air=slices?+u.sliceAir.value:0;
    if(contentKeyChanged(cbKey,segs,cbGrid.dims)){if(cbSegOk&&!segsSubset(segs,cbShownSegs))cbSegOk=false;segScanStart(cbScan,cbGrid,segs);cbDirty=true}
    if(!cbScan.done&&segScanStep(cbScan)){
     if(cbScan.count>=0){cbSegLo.set(cbScan.lo);cbSegHi.set(cbScan.hi);cbStat.segBricks=cbScan.count;for(let s=0;s<4;s++)Object.assign(cbShownSegs[s],cbScan.segs[s]);cbSegOk=true}else cbSegOk=false;
     cbStat.ms=+cbScan.ms.toFixed(2);cbStat.frames=cbScan.frames;cbStat.bricks=cbScan.n;cbDirty=true}
    if(slices!==cbSl||air!==cbAir){const t0=performance.now();cbSl=slices;cbAir=air;cbSliLo.fill(Infinity);cbSliHi.fill(-Infinity);cbStat.sliceBricks=slices&&cbSliceIdx?sliceRange(cbSliceIdx,air,cbSliLo,cbSliHi):0;cbStat.sliceMs=+(performance.now()-t0).toFixed(3);cbDirty=true}
   }
   if(!cbDirty)return;cbDirty=false;
   const sl=cbSl&&!off;
   if(off||!cbSegOk||(sl&&!cbSliceIdx)){u.boxC.value.set(0,0,0);u.boxH.value.set(0,0,0);return}
   for(let a=0;a<3;a++){cbLo[a]=Math.min(cbSegLo[a],sl?cbSliLo[a]:Infinity);cbHi[a]=Math.max(cbSegHi[a],sl?cbSliHi[a]:-Infinity)}
   const b=boxFromRange(vd.halfExt,cbLo,cbHi,cbOut);
   if(b.full||b.empty){u.boxC.value.set(0,0,0);u.boxH.value.set(0,0,0)}else{u.boxC.value.set(b.c[0],b.c[1],b.c[2]);u.boxH.value.set(b.h[0],b.h[1],b.h[2])}
  };
  disposeEdits=()=>{editTex?.dispose();regionTex?.dispose();dummyEdit.dispose()};
  disposeExtra=()=>{half?.v?.dispose();half?.b?.dispose();half?.cls?.dispose();half?.dist?.dispose();half?.combo?.dispose();half?.cls4?.dispose();half?.skip?.tex?.dispose();full?.cls?.dispose();full?.dist?.dispose();full?.combo?.dispose();full?.cls4?.dispose();full?.skip?.tex?.dispose()};
  // ---- from here the data of the session is BOUND by install() and can be REPLACED by swapData() ----
  let unifs=null;
  // one program set per "analysis results present" (VRL_REGIONS is a compile-time define; the shader without it is cheaper, so it is not made unconditional): the base material, its variants and
  // their offscreen copies. The sets share one uniforms object. A set the new data needs and the session has not compiled yet is compiled BEFORE the swap shows it (compileSet, async, volume hidden).
  const getSet=Pn=>{const k=Pn.region?.data?'R':'-';let st=msets.get(k);if(!st){const base=makeVolumeBase(volumeDefines(k==='R'),unifs),v=materialVariants(base);st={k,base,variants:v,rays:rayVariantsOf(v),compiled:new Set(allCompiled?[...VARIANT_KEYS,...VARIANT_KEYS4]:[])};msets.set(k,st)}return st};
  const adoptSet=st=>{setKey=st.k;material=st.base;variants=st.variants;rayVariants=st.rays;plain=null;if(rayMesh)rayMesh.material=st.rays.full;if(meshObj)meshObj.material=st.base};
  const compileSet=async(Pn,st)=>{
   const keys=(P4(Pn)?[...VARIANT_KEYS,...VARIANT_KEYS4]:VARIANT_KEYS).filter(k=>!st.compiled.has(k));if(!keys.length)return;
   try{await compileVariantPrograms(renderer,keys.map(k=>st.variants[k]),keys.map(k=>st.rays[k]),[],()=>!!running);keys.forEach(k=>st.compiled.add(k))}
   catch(e){if(running)throw e} // the session ended during the compile: the renderer / materials are gone, that is not an error
  };
  const P4=Pn=>!!Pn.cls?.chan.includes(3);
  // binds the prepared data Pn (and its GPU assets {full, half, edit, region, fullReady}) to the session: the state that follows the data, the uniforms, the mesh back in the holder. first: the session's own start
  const install=(Pn,assets,first)=>{
   P=Pn;vd=P.vd;
   histP=P;histFor=null;histRun(); // the histogram board's data (a board opened before the data was ready starts its pass now)
   vrHalfExt=vd.halfExt;vrDims=activeSeries?{columns:activeSeries.columns,rows:activeSeries.rows,slices:activeSeries.slices.length}:null;vrFp=activeSeries?datasetFingerprint(activeSeries):null;vrSpacing=activeSeries?seriesSpacing(activeSeries):null;cancelMeasure();
   // classification texture from the prepared bytes (only on the ≤256 grid)
   // classification bytes for the laser's volume hit (the ≤256 grid they were built on)
   volPick=P.cls?{cls:P.cls,dims:(P.half||vd).dims,halfExt:vd.halfExt,ids:P.region?.ids&&P.region.dims.join()===(P.half||vd).dims.join()?P.region.ids:null}:null;regionList=P.region?.list||[];evLabels=TRIGGER_AT_START==='label';initialVrModes(); // the data of this session is known: the trigger starts in point mode again (also when a level / dataset was changed since the page loaded)
   cbGrid=null;cbOff=null;cbSegOk=false;cbSl=null;cbAir=NaN;cbDirty=true;cbKey.fill(NaN);cbScan=createSegScan();cbSliceIdx=sliceIndex(vd);
   full=assets.full;half=assets.half;fullReady=assets.fullReady!==false;volTex=full.v;brickTex=full.b;
   four=P4(P);editTex=assets.edit;editActive=P.edit.active;regionTex=assets.region;regionColors=P.region?.colors||[];regionSegs=P.region?.segs||[];
   comboT=null;comboMask=-1;
   if(first){
    unifs=volumeUniforms(vd,full,settings);unifs.clsTex.value=dummyEdit;unifs.cls4Tex.value=dummyEdit;unifs.editTex.value=dummyEdit;unifs.distTex.value=dummyEdit;
    const st=getSet(P);
    // BackSide: rays start at the eye when the head is inside the box
    meshObj=new THREE.Mesh(new THREE.BoxGeometry(2,2,2),st.base);meshObj.frustumCulled=false;meshObj.renderOrder=1;
    compMaterial=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:compositeVertex,fragmentShader:compositeFragment,side:THREE.BackSide,toneMapped:false,depthWrite:true,transparent:false,
     blending:THREE.CustomBlending,blendSrc:THREE.OneFactor,blendDst:THREE.OneMinusSrcAlphaFactor,uniforms:compositeUniforms(vd.halfExt)});
    // the offscreen target is cleared to 0 and written with plain premultiplied
    // colour (no blending needed inside the volume pass)
    rayMesh=new THREE.Mesh(meshObj.geometry,st.rays.full);
    rayMesh.matrixAutoUpdate=false;rayMesh.matrixWorldAutoUpdate=false;rayMesh.frustumCulled=false;volScene.add(rayMesh);
    adoptSet(st);
    if(gpu&&gpu.key===P.key)for(const k of (four||allCompiled?[...VARIANT_KEYS,...VARIANT_KEYS4]:VARIANT_KEYS))st.compiled.add(k); // prepareVrGpu compiled these before the session
   }else{
    const u=unifs;u.halfExt.value.set(...vd.halfExt);u.calib.value.set(...vd.calibration);u.boxC.value.set(0,0,0);u.boxH.value.set(0,0,0);u.useSkip.value=0;u.skipTex.value=skipDummy();u.distInCls.value=0;u.useDist.value=0;u.useCls.value=0;
    u.clsTex.value=dummyEdit;u.cls4Tex.value=dummyEdit;u.editTex.value=dummyEdit;u.distTex.value=dummyEdit;u.regionTex.value=dummyEdit;
    compMaterial.uniforms.halfExt.value.set(...vd.halfExt);
    adoptSet(getSet(P));
   }
   mesh=meshObj;
   // app units (longest side 3.3) -> 0.3 m in VR, placed in front of the head
   holder.add(mesh);baseStep=vd.step;applyQuality();placePending=true;
  };
  // the volume goes out of the scene and everything that was tied to the old data is let go of: the state of the session is that of "no data yet" (every use of mesh / material / vrHalfExt / volPick is guarded)
  const unbindData=()=>{
   if(meshObj?.parent)meshObj.parent.remove(meshObj);
   mesh=null;material=null;
   endAllDrags();closeWheel();closePointWheel();for(const c of controllers){huLine.cancelDragOf(c);c.userData.press=null;c.userData.lblDrag=null;c.userData.moving=null}
   for(const pl of [...planes])removePlane(pl);section.on=false;section.selected=null;ui.secPage=0;ui.secSeen=null;for(const f of flying)disposePlane(f.pl);flying.length=0;secUndo.clear();undoBtn.hide();
   undo.clear();vpSel=null;cancelMeasure();for(const [rid,lb] of pins)dropPin(rid,lb);
   huLine.setArmed(false,true);huLine.clear();setHistOpen(false);labelHist.reset();hist.invalidate();
   vrHalfExt=null;vrDims=null;vrFp=null;vrSpacing=null;volPick=null;regionList=[];histP=null;histFor=null;cls4On=false;cbGrid=null;
   ui.sliceClear=false;sliceToast.until=0;sliceToast.mesh.visible=false;ui.anPage=0;ui.resetUntil=0;
  };
  // the old data's GPU textures and CPU arrays: the uniforms stop pointing at them first (three.js would upload a disposed texture again the next time it is bound), then they are disposed and every reference is dropped
  // the page-prepared warm-up materials (they keep the compiled programs alive) share the first data's uniforms, which point at its textures, and a texture holds the CPU array
  // it was made from (vd.data: ~256 MiB, the bricks): the shared uniforms are pointed at a 1-voxel dummy so the first data can be freed by the first switch
  const dropWarmRefs=()=>{for(const m of gpuWarm){for(const un of Object.values(m.uniforms||{})){const v=un&&un.value;if(v&&v.isTexture&&v!==dummyEdit)un.value=dummyEdit}}};
  const releaseSessionData=()=>{
   uploadQueue.clear();
   if(unifs){for(const k of ['vol','bricks','sliceVol','clsTex','cls4Tex','distTex','editTex','regionTex'])unifs[k].value=dummyEdit;unifs.skipTex.value=skipDummy()}
   comboTs.forEach(t=>{t.rb?.dispose();t.rb=null});comboTs.length=0;
   volTex?.dispose();brickTex?.dispose();disposeExtra();editTex?.dispose();regionTex?.dispose();
   for(const t of swapMade)t.dispose();swapMade.length=0;
   volTex=null;brickTex=null;full=null;half=null;editTex=null;regionTex=null;comboT=null;comboMask=-1;P=null;vd=null;cbSliceIdx=null;cbScan=createSegScan();
   gpu=null; // the page-prepared assets (they hold the arrays of the first data) are not needed any more
   dropWarmRefs();
  };
  // a texture of the swap: storage allocated now (dataReady false: no data goes up), the data follows in slices through uploadQueue. src wraps the same bytes (never seen by the renderer: copyTextureToTexture reads it from memory)
  const slicedTexture=(key,data,dims,bytesPerVoxel,format,type,filter)=>{
   const tex=new THREE.Data3DTexture(data,...dims);tex.format=format;tex.type=type;tex.minFilter=tex.magFilter=filter;tex.unpackAlignment=1;tex.generateMipmaps=false;
   tex.source.dataReady=false;tex.needsUpdate=true;renderer.initTexture(tex);swapMade.push(tex);
   const src=new THREE.Data3DTexture(data,...dims);src.format=format;src.type=type;src.unpackAlignment=1;
   uploadQueue.add({key,dims,depth:dims[2],bytesPerSlice:dims[0]*dims[1]*bytesPerVoxel,tex,src});
   return tex;
  };
  // a small texture (the bricks: 0.5 MB at 256³, 4 MB at 512³) goes up at once
  const smallTexture=(data,dims)=>{const b=new THREE.Data3DTexture(data,...dims);b.format=THREE.RGBAFormat;b.type=THREE.FloatType;b.minFilter=b.magFilter=THREE.NearestFilter;b.unpackAlignment=1;b.needsUpdate=true;renderer.initTexture(b);swapMade.push(b);return b};
  const gridAsset=(g,v,b)=>({v,b,dims:g.dims,brickDims:g.brickDims,src:g.data,cls:null,dist:null,combo:null,cls4:null,comboMask:-1});
  // the coarse step of a switch: the 256 grid with everything the picture needs (the combined classification + distance texture, the fourth segment's bytes, the processing mask, the analysis index)
  // goes into the GPU in slices (the frame loop runs uploadQueue.tick); resolves when all of it is there. When the data has no 256 copy (it is 256 or less already) its grid is the coarse one.
  const uploadCoarse=async (Pn,syncDone=()=>{})=>{
   const vdN=Pn.vd,plan=swapPlan({hasHalf:!!Pn.half,dataSetting:settings.data}),grid=Pn.half||vdN,keys=[];
   const key=n=>{keys.push(n);return n};
   const gv=slicedTexture(key('vol'),grid.data,grid.dims,2,THREE.RGFormat,THREE.UnsignedByteType,THREE.LinearFilter),gb=smallTexture(grid.bricks,grid.brickDims);
   const gt=gridAsset(grid,gv,gb);
   const pc=Pn.combo&&Pn.combo.dims.join()===grid.dims.join()?Pn.combo:null;
   if(Pn.cls&&Pn.dist&&pc){
    gt.combo=slicedTexture(key('combo'),pc.data,grid.dims,4,THREE.RGBAFormat,THREE.UnsignedByteType,THREE.LinearFilter);gt.comboMask=pc.mask; // a shown set that changed meanwhile is rebuilt by refreshCombo (off the frame)
    if(P4(Pn)&&Pn.cls4)gt.cls4=slicedTexture(key('cls4'),Pn.cls4,grid.dims,1,THREE.RedFormat,THREE.UnsignedByteType,THREE.LinearFilter);
   }
   const assets={full:plan.coarse==='half'?gridAsset(vdN,null,null):gt,half:plan.coarse==='half'?gt:null,edit:null,region:null,fullReady:plan.coarse!=='half'};
   if(Pn.edit.data){const f=(settings.editDiag|0)===1?THREE.NearestFilter:THREE.LinearFilter;assets.edit=slicedTexture(key('edit'),Pn.edit.data,Pn.edit.dims,4,THREE.RGBAFormat,THREE.UnsignedByteType,f);assets.edit.userData.up=true}
   if(Pn.region?.data)assets.region=slicedTexture(key('region'),Pn.region.data,Pn.region.dims,1,THREE.RedFormat,THREE.UnsignedByteType,THREE.NearestFilter);
   syncDone(); // the textures are allocated (initTexture): the synchronous part of the step
   await Promise.all(keys.map(k=>uploadQueue.whenDone(k)));
   return assets;
  };
  // the fine step: the 512 grid, in slices, after the coarse picture is up; then it replaces the coarse one where the data setting asks for it (and serves the slices)
  const uploadFine=async(Pn,assets,gen)=>{
   if(!Pn.half||assets.fullReady)return;
   const tFine=performance.now(),vdN=Pn.vd,b=smallTexture(vdN.bricks,vdN.brickDims),v=slicedTexture('fine',vdN.data,vdN.dims,2,THREE.RGFormat,THREE.UnsignedByteType,THREE.LinearFilter);ownNote('allocateFine',tFine);
   const ok=await uploadQueue.whenDone('fine');
   if(!ok||!swapGuard.isCurrent(gen)||P!==Pn||!running)return;
   {const t=performance.now();full.v=v;full.b=b;volTex=v;brickTex=b;fullReady=true;useData(settings.data|0);ownNote('useFine',t)}
  };
  // ---- swapData(setId): switch the practice data without ending the session. The ORDER (vr-data-switch.js runDataSwap): hide + free the old data -> the page opens the new data ->
  // wait until the page is quiet -> prepare off the main thread -> compile what is new -> upload the 256 grid in slices -> show it -> upload the 512 grid in slices. Nothing here
  // blocks a frame: the heavy steps are in the worker, the page work is the page's own (chunked) and every GPU upload is a few ms per frame. frameGaps measures the longest gap.
  swapData=async setId=>{
   if(!running||ui.swapBusy)return false;
   const gen=swapGuard.next();ui.swapBusy=true;ui.swapFailed=false;ui.swapArm=null;ui.swapLine='';
   const t0=performance.now(),stageLog=[];let prepTimes=null,prepInfo=null,pfSwap=null;swapOwn={};frameGaps.begin('switch '+setId);frameGaps.observe();
   loadInfo={name:levelNameOf(setId),stage:'release',text:'',t0,error:'',frac:0};loadBoard.refresh();placeLoadNow();
   const live=g=>running&&swapGuard.isCurrent(g);
   const gate=createSettleGate({timeoutMs:SETTLE_TIMEOUT_MS,volumeReady:()=>globalThis.__vrlVolumeReady===true,busy:()=>{try{const b=globalThis.__vrlBusyModal?.();return !!(b&&(b.active||b.visible))}catch{return false}},key:()=>{try{return vrDataKey()}catch{return ''}}});
   const stageNow=(name)=>{if(!loadInfo||loadInfo.error)return;loadInfo.stage=name;loadInfo.text='';loadInfo.sub=0;loadInfo.peak=0;loadBoard.refresh()};
   const env={
    isCurrent:g=>live(g),
    stage:(name)=>{stageLog.push([name,Math.round(performance.now()-t0)]);stageNow(name);ui.status=L.sw.stages[name]||ui.status;
     if(name==='refine'){ui.flash=L.sw.stages.refine;ui.flashUntil=performance.now()+180000} // the fine grid comes in the background: the volume is shown, a line says so (the status line is rewritten every frame, the flash is not)
     else if(name==='done')ui.flash='';
     menu.refresh()},
    hide:()=>{const t=performance.now();unbindData();loadBoard.mesh.visible=true;ownNote('unbind',t)},
    releaseGpu:()=>{const t=performance.now();releaseSessionData();ownNote('release',t)},
    releaseCpu:async()=>{await flushVrStores(()=>{if(loadInfo&&!loadInfo.error){loadInfo.text=L.sw.saving;loadBoard.refresh()}});releaseVrForSwap();pfSwap=activeSwapPf=startVrPrefetch(setId)}, // the old data is gone: the finished VR data of the new level (if the device has it) is read beside the page's load
    load2d:async id=>{
     const lv=levelForSample(id);if(lv)chooseEventLevel(lv.id);
     if(tutLive&&!tutEnded&&id!==TUT_SAMPLE){tutEnded=true;try{tutVr?.dispose()}catch(e){console.warn('[tutorial] dispose',e)}tutVr=null;helpShow='list';help.refresh()} // the live tutorial belongs to its practice data
     const detail={sampleSet:id,done:null};document.dispatchEvent(new CustomEvent('vrl-event-sample',{detail}));
     if(!detail.done)throw new Error('the page did not open the data');
     await withTimeout(detail.done,LOAD_TIMEOUT_MS,'opening the data'); // a page that never finishes (the 2D side stuck) ends the switch instead of holding the headset
    },
    settle:async()=>{const ok=await gate.wait(()=>live(gen));if(!ok&&live(gen))console.warn('VR data switch: the page did not settle, the data is used as it is')},
    prepare:async()=>{for(let again=0;;again++){const Pn=await env.prepareOnce();let now='';try{now=vrDataKey()}catch{}
     if(Pn.key===now||again>=3||!live(gen))return Pn; // the page changed the data while it was converted (a bundled project's filters / segments / analysis finishing late): convert again from the settled data
     console.warn('VR data switch: the data changed while it was converted, converting again');stageLog.push(['prepare:again',Math.round(performance.now()-t0)]);swapOwn.reprepare=(swapOwn.reprepare||0)+1;gate.reset();await env.settle()}},
    prepareOnce:()=>{let lastPhase='';return prepareVrData(({phase,done,total})=>{if(phase!==lastPhase){lastPhase=phase;stageLog.push(['prepare:'+phase,Math.round(performance.now()-t0)])}
     if(!loadInfo)return;loadInfo.text=L.sw.phases[phase]?L.sw.phases[phase]+(phase==='read'||phase==='copy'?' '+done+' / '+total:phase==='cache'&&total?' '+Math.round(done*100/total)+' %':''):'';loadInfo.sub=(phase==='read'||phase==='copy'||phase==='cache')&&total?done/total:0;loadBoard.refresh()},{sliceMs:4,prefetch:pfSwap,fresh:true}).then(Pn=>{prepTimes=Object.fromEntries(Object.entries(Pn.times||{}).map(([k,v])=>[k,Math.round(v)]));prepInfo=Pn.prepInfo||null;if(swapOwn&&Pn.times?.collect!=null)swapOwn.prepareCollect=Math.round(Pn.times.collect*10)/10;return Pn})},
    compile:async Pn=>{const st=getSet(Pn);await compileSet(Pn,st)},
    uploadCoarse:Pn=>{const t=performance.now();return uploadCoarse(Pn,()=>ownNote('allocate',t))},
    bind:(Pn,assets)=>{
     resetForNewData();swapPlace=true;
     {const t=performance.now();install(Pn,assets,false);ownNote('install',t)}
     loadBoard.mesh.visible=false;loadInfo=null;
     refreshEvBoard();
     ui.status=L.stNone;menu.refresh();
    },
    uploadFine:(Pn,assets)=>uploadFine(Pn,assets,gen),
    discard:()=>{}, // the textures of an overtaken switch are in swapMade: the next release (or the session end) disposes them
    fail:e=>{console.error('VR data switch failed',e);ui.swapFailed=true;ui.flash='';ui.flashUntil=0;if(loadInfo){loadInfo.error=String(e&&e.message||e).slice(0,80);loadBoard.refresh()}ui.status=L.failed+String(e&&e.message||e).slice(0,40);menu.refresh()},
   };
   let r;
   try{r=await runDataSwap(env,setId,gen)}finally{if(activeSwapPf===pfSwap)activeSwapPf=null;if(pfSwap){pfSwap.cancelled=true;pfSwap.V=null;pfSwap.D=null}if(swapGuard.isCurrent(gen)||!running)ui.swapBusy=false}
   const rep=frameGaps.end();
   if(r.status==='done'&&rep){
    const secs=Math.round((performance.now()-t0)/100)/10;
    const pcomp=parallelCompile(renderer),ls={...globalThis.__vrlLoadStats},res={...rep,seconds:secs,setId,build:APP_BUILD,stages:stageLog,prepare:prepTimes,own:swapOwn,worker:prepInfo?prepInfo.worker:null,parallelCompile:pcomp,load2d:ls,vrCache:prepInfo?.cache||null};ui.swapLine=(ja?'切替 ':'switch ')+secs+(ja?' 秒 · 最長フレーム間隔 ':' s · longest frame gap ')+Math.round(rep.maxGapMs)+' ms · '+(ja?'最長タスク ':'longest task ')+Math.round(rep.maxTaskMs)+' ms · '+(ja?'止まったフレーム ':'stalled frames ')+rep.stalls+(ja?' · 並列コンパイル ':' · parallel compile ')+(pcomp?(ja?'あり':'yes'):(ja?'なし':'no'))+' · '+(prepInfo?.worker?'Worker':(ja?'Worker なし':'no worker'))+(ja?' · 自前の同期処理の最長 ':' · own longest sync step ')+Math.max(0,...Object.values(swapOwn||{}))+' ms'+stagesLine(stageLog,ls,prepInfo,ja);
    console.log('[VR data switch]',JSON.stringify(res));(globalThis.__vrSwapReports||=[]).push(res);
    flashMsg((ja?'データを切り替えました: ':'Data switched: ')+levelNameOf(setId),4000);
   }else if(r.status==='cancelled'&&loadInfo&&!running)loadInfo=null;
   return r.status==='done';
  };
  // the session's state for the new data: what 最初の状態に戻す puts back (resetToStart) for the parts that live here
  const resetForNewData=()=>{
   if(eventModeOn()){resetEventViewSettings(settings);saveSettings(settings)} // 体験会モード: a new practice dataset starts from the default view (the settings the page's own reset also puts back)
   for(const k of Object.keys(segMode))delete segMode[k];
   vrWindow.c=+wc.value||0;vrWindow.w=Math.max(1,+ww.value||1);
   if(menuHeld){scene.attach(menu.mesh);menuHeld=null}if(helpHeld){scene.attach(help.mesh);helpHeld=null}if(evHeld&&ev){scene.attach(ev.mesh);evHeld=null}
   if(evMenu){ui.open=true;menu.mesh.visible=true;ui.tab=10}
  };
  const refreshEvBoard=()=>{evSlide=evSlideFor();if(ev){ev.refresh();ev.flush()}else buildEv();if(ev&&poseAt)withFront(placeEvNow)};
  // first start: the page-prepared assets (or fresh ones) are bound as before
  const gpuOk=!!gpu&&gpu.key===P.key;
  ui.status=L.compiling;menu.refresh();await nextFrames(session);if(!running)return; // the first volume frame compiles the shaders; the menu says so first
  install(P,{full:(gpuOk&&gpu.full)||makeTextures(vd),half:(gpuOk&&gpu.half)||null,edit:(gpuOk&&gpu.edit)||makeEditTexture(P),region:(gpuOk&&gpu.region)||makeRegionTexture(P)},true);
  gpu=null;
  ui.status=L.stNone;menu.refresh();
 }catch(e){
  console.error(e);ui.status=L.failed+String(e.message||e).slice(0,40);menu.refresh();
 }
}
