// Extracted verbatim from app.js by tools/extract-module.mjs.
// Leaf module: the 3D render request used everywhere (keep it free of UI
// imports so it cannot take part in import cycles).
import { sceneState } from './state.js?v=20261023-build664';
export function request3DRender(){
 if(sceneState)sceneState.needsRender=true;
}
