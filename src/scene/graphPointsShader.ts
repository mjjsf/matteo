/** Shader for the graph's book nodes.
 *
 *  Same single-draw-call `THREE.Points` approach as before, but the state
 *  attribute now encodes a node's ROLE rather than a dim/emphasise level. There
 *  is nothing to dim in a graph you grew yourself — everything on screen is there
 *  because you asked for it. What matters instead is whether a node can still be
 *  opened, which the reader has no way to know otherwise. */

export const graphPointsVertexShader = /* glsl */ `
  attribute float aSize;
  attribute float aTier;    // 0 seed, 1 expandable, 2 expanded, 3 exhausted
  attribute float aIndex;   // == node slot; gl_VertexID does not exist in GLSL ES 1.00

  uniform float uPixelRatio;
  uniform float uAttenuation;
  uniform float uFocusIndex;

  varying float vTier;
  varying float vFocus;

  void main() {
    vTier = aTier;
    vFocus = (uFocusIndex >= 0.0 && abs(aIndex - uFocusIndex) < 0.5) ? 1.0 : 0.0;

    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);

    float focusScale = vFocus > 0.5 ? 1.45 : 1.0;
    float size = aSize * uPixelRatio * focusScale;

    // Floored so distant nodes stay visible and hittable.
    gl_PointSize = max(size * (uAttenuation / max(-mvPosition.z, 0.001)), 3.0 * uPixelRatio);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

export const graphPointsFragmentShader = /* glsl */ `
  uniform vec3 uSeed;
  uniform vec3 uExpandable;
  uniform vec3 uExpanded;
  uniform vec3 uExhausted;

  varying float vTier;
  varying float vFocus;

  void main() {
    vec2 d = gl_PointCoord - vec2(0.5);
    float dist = length(d);
    float alpha = 1.0 - smoothstep(0.44, 0.5, dist);
    if (alpha <= 0.001) discard;

    vec3 color = uExpandable;
    if (vTier < 0.5)       color = uSeed;
    else if (vTier < 1.5)  color = uExpandable;
    else if (vTier < 2.5)  color = uExpanded;
    else                   color = uExhausted;

    // An unopened node carries a bright core, so "there is more behind this one"
    // is visible at a glance rather than something you have to discover by
    // clicking. Opened and exhausted nodes read as flat.
    if (vTier > 0.5 && vTier < 1.5) {
      float core = 1.0 - smoothstep(0.0, 0.26, dist);
      color = mix(color, color * 1.45, core * 0.55);
    }

    // Darker rim so marks have definition against a light background.
    float rim = smoothstep(0.30, 0.5, dist);
    color = mix(color, color * 0.72, rim * 0.55);

    float a = alpha * (vTier > 2.5 ? 0.62 : 1.0);
    if (vFocus > 0.5) a = alpha;

    gl_FragColor = vec4(color, a);
  }
`;
