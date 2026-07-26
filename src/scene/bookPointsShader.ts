/** Shader for the book point cloud.
 *
 *  One `THREE.Points` with a custom material rather than instanced spheres:
 *  a single draw call, a round sprite from `gl_PointCoord` that is
 *  resolution-independent, and no geometry at all. The 3D volume that instanced
 *  spheres would add is actively unwanted here — depth-sorted opaque spheres on
 *  a white field read as clutter.
 *
 *  All hover/dim/relation state arrives through two mutable buffer attributes,
 *  so the entire interaction system is one Float32Array write plus a
 *  `needsUpdate` flag. No React reconciliation, no material swaps. */

export const bookPointsVertexShader = /* glsl */ `
  attribute float aSize;
  attribute float aState;      // 0 dim, 1 normal, 2 emphasized
  attribute float aRelation;   // 0 none, 1 same author, 2 same subject, 3 shared tag
  // Explicit index rather than gl_VertexID: three.js compiles ShaderMaterial as
  // GLSL ES 1.00 by default, where gl_VertexID does not exist.
  attribute float aIndex;

  uniform float uPixelRatio;
  uniform float uSizeScale;
  uniform float uAttenuation;
  uniform float uFocusIndex;   // index of the hovered/selected point, or -1

  varying float vState;
  varying float vRelation;
  varying float vFocus;

  void main() {
    vState = aState;
    vRelation = aRelation;
    vFocus = (uFocusIndex >= 0.0 && abs(aIndex - uFocusIndex) < 0.5) ? 1.0 : 0.0;

    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);

    // Relation and focus both enlarge the mark. Size is the secondary encoding
    // that makes the two-hue palette legal and gives the third relation
    // (shared tag) a channel of its own.
    float relationScale = 1.0;
    if (vRelation > 2.5)      relationScale = 1.25;  // shared tag
    else if (vRelation > 0.5) relationScale = 1.55;  // same author / same subject
    float emphasis = aState > 1.5 ? 1.3 : 1.0;
    float focusScale = vFocus > 0.5 ? 1.9 : 1.0;

    float size = aSize * uSizeScale * relationScale * emphasis * focusScale * uPixelRatio;

    // Perspective attenuation, floored so distant points never vanish and stay
    // large enough to be hit.
    gl_PointSize = max(size * (uAttenuation / max(-mvPosition.z, 0.001)), 2.5 * uPixelRatio);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

export const bookPointsFragmentShader = /* glsl */ `
  uniform vec3 uResting;
  uniform vec3 uDim;
  uniform vec3 uSameAuthor;
  uniform vec3 uSameSubject;
  uniform vec3 uFocusColor;
  uniform float uDimAlpha;

  varying float vState;
  varying float vRelation;
  varying float vFocus;

  void main() {
    // Round sprite with an antialiased edge.
    vec2 d = gl_PointCoord - vec2(0.5);
    float dist = length(d);
    float alpha = 1.0 - smoothstep(0.44, 0.5, dist);
    if (alpha <= 0.001) discard;

    bool related = vRelation > 0.5 && vRelation < 2.5;  // has a hue of its own

    vec3 color = uResting;
    if (vRelation > 2.5)      color = uResting;      // shared tag: size only, no hue
    else if (vRelation > 1.5) color = uSameSubject;
    else if (vRelation > 0.5) color = uSameAuthor;
    if (vFocus > 0.5) color = uFocusColor;

    float a = alpha;
    if (vState < 0.5) {
      // Dim toward gray, never toward the background: fading to white would
      // delete the surrounding cloud and destroy the single-cluster reading.
      //
      // Relation colour deliberately SURVIVES dimming. Hovering a search result
      // should reveal that book's relatives across the whole corpus, including
      // ones the query filtered out — that is the discovery the tool exists for.
      // Letting the dim state win would blank the colouring exactly when it is
      // most useful. Filtered-out relatives are still held back by alpha, so the
      // active result set stays dominant.
      if (related || vFocus > 0.5) {
        a *= max(uDimAlpha, 0.62);
      } else {
        color = uDim;
        a *= uDimAlpha;
      }
    }

    // Slightly darker rim so marks have definition against a white field.
    float rim = smoothstep(0.30, 0.5, dist);
    color = mix(color, color * 0.72, rim * 0.55);

    gl_FragColor = vec4(color, a);
  }
`;
