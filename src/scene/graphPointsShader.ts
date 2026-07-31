/** Shader for the graph's nodes.
 *
 *  Same single-draw-call `THREE.Points` approach as before. Two attributes now
 *  describe a node, and they are deliberately ORTHOGONAL:
 *
 *   - `aTier` is its role — seed, expandable, expanded, exhausted.
 *   - `aKind` is what it refers to — a book, a subject, an author.
 *
 *  They have to be separate because a subject node is itself expandable or
 *  expanded; folding kind into tier would have made "grown subject" and
 *  "ungrown subject" impossible to tell apart.
 *
 *  **Kind is carried by FORM, not by colour.** Three kinds plus four tiers on
 *  one field would need three greys and two hues, and this project's position is
 *  that identity must never rest on colour alone. A disc, a ring and a diamond
 *  survive a greyscale screenshot, which is the check that proves it. */

export const graphPointsVertexShader = /* glsl */ `
  attribute float aSize;
  attribute float aTier;    // 0 seed, 1 expandable, 2 expanded, 3 exhausted
  attribute float aKind;    // 0 book, 1 subject, 2 author
  attribute float aIndex;   // == node slot; gl_VertexID does not exist in GLSL ES 1.00

  uniform float uPixelRatio;
  uniform float uAttenuation;
  uniform float uFocusIndex;

  varying float vTier;
  varying float vKind;
  varying float vFocus;

  void main() {
    vTier = aTier;
    vKind = aKind;
    vFocus = (uFocusIndex >= 0.0 && abs(aIndex - uFocusIndex) < 0.5) ? 1.0 : 0.0;

    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);

    float focusScale = vFocus > 0.5 ? 1.45 : 1.0;
    // Rings and diamonds read smaller than a filled disc of the same radius —
    // a ring is mostly hole, a diamond is half the area of its bounding circle.
    // Nudged up so the three marks carry equal visual weight.
    float kindScale = aKind > 0.5 ? 1.22 : 1.0;
    float size = aSize * uPixelRatio * focusScale * kindScale;

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
  uniform vec3 uSubject;

  varying float vTier;
  varying float vKind;
  varying float vFocus;

  void main() {
    vec2 d = gl_PointCoord - vec2(0.5);
    float r = length(d);

    // One shape per kind. The book case is bit-for-bit what it always was, so a
    // map of nothing but books looks exactly as it did.
    float alpha;
    float dist;
    if (vKind < 0.5) {
      dist = r;
      alpha = 1.0 - smoothstep(0.44, 0.5, r);
    } else if (vKind < 1.5) {
      // Subject: a ring. Hollow reads as "a container of things" rather than a
      // thing, which is what a subject is.
      dist = r;
      alpha = (1.0 - smoothstep(0.44, 0.5, r)) * smoothstep(0.20, 0.27, r);
    } else {
      // Author: a diamond. Chebyshev-ish metric, so it stays a crisp rotated
      // square at any point size.
      dist = abs(d.x) + abs(d.y);
      alpha = 1.0 - smoothstep(0.44, 0.5, dist);
    }
    if (alpha <= 0.001) discard;

    vec3 color;
    if (vKind > 0.5) {
      // Subjects and authors take one neutral, measured against both the
      // surface and the other grey on screen. Their tier shows as value, since
      // a ring has no centre to put a bright core in.
      color = uSubject;
      if (vTier > 0.5 && vTier < 1.5) color = mix(color, vec3(1.0), 0.34);
    } else if (vTier < 0.5) {
      color = uSeed;
    } else if (vTier < 1.5) {
      color = uExpandable;
    } else if (vTier < 2.5) {
      color = uExpanded;
    } else {
      color = uExhausted;
    }

    // An unopened BOOK carries a bright core, so "there is more behind this one"
    // is visible at a glance rather than something you have to discover by
    // clicking. Opened and exhausted nodes read as flat.
    if (vKind < 0.5 && vTier > 0.5 && vTier < 1.5) {
      float core = 1.0 - smoothstep(0.0, 0.26, dist);
      color = mix(color, color * 1.45, core * 0.55);
    }

    // Darker rim so marks have definition against a light background.
    float rim = smoothstep(0.30, 0.5, dist);
    color = mix(color, color * 0.72, rim * 0.55);

    float a = alpha * (vKind < 0.5 && vTier > 2.5 ? 0.62 : 1.0);
    if (vFocus > 0.5) a = alpha;

    gl_FragColor = vec4(color, a);
  }
`;
