// Native WebGL2 renderer (owner request: "lit TV arena" look). No engine, no dependencies.
//
// Frame: shadow map (directional key light, PCF) → per view: optional planar court reflection
// (mirrored scene, half resolution) → lit HDR scene (per-pixel normals, key + spot lights +
// hemisphere ambient, Blinn-Phong specular, emissive, fog) → additive glow effects → bloom
// (downsample/upsample chain) → ACES tone mapping, vignette, RGB split, speed lines, flash → FXAA.
// Quality High / Medium / Low; Auto starts at High and steps down when frames run slow.
// Without WebGL2 (or if a pass fails) it falls back to a single forward pass straight to the
// canvas with the same lighting minus shadows and post effects.

/** Floats per vertex: position 3, normal 3, colour 3, material 4 (spec, emit, refl, pattern). */
export const STRIDE = 13;

export type Quality = "high" | "medium" | "low";
export type QualityPref = Quality | "auto";
export const QUALITY_LABELS: Record<QualityPref, string> = {
  auto: "Auto",
  high: "High",
  medium: "Medium",
  low: "Low",
};

type V3 = [number, number, number];
export interface Spot {
  pos: V3;
  dir: V3;
  color: V3;
  /** Cone half-angles in degrees: full brightness inside `inner`, none past `outer`. */
  inner: number;
  outer: number;
  range: number;
}
export interface Lighting {
  sky: V3;
  fogNear: number;
  fogFar: number;
  sunDir: V3;
  sunColor: V3;
  skyAmb: V3;
  groundAmb: V3;
  spots: Spot[];
  exposure: number;
  bloom: number;
}
/** Per-frame screen effects (all 0 = off). */
export interface Post {
  rgbSplit: number;
  speedLines: number;
  flash: number;
  vignette: number;
  /** Screen point the speed lines radiate from (0..1, origin bottom-left). */
  focus: [number, number];
}
/** A textured quad (the optional face photo), as 4 corners in world space. */
export interface Decal {
  key: string;
  corners: number[][];
}
export interface ViewDraw {
  /** Pixel rectangle in the canvas (origin bottom-left). */
  rect: [number, number, number, number];
  vp: number[];
  eye: number[];
  dynamic: Float32Array;
  fx: Float32Array;
  decals?: Decal[];
}

const COMMON = `
precision highp float;
precision highp sampler2DShadow;
`;
const SCENE_VS = `
in vec3 aPos; in vec3 aNormal; in vec3 aColor; in vec4 aMat;
uniform mat4 uVP; uniform mat4 uLightVP; uniform float uMirror;
out vec3 vWorld; out vec3 vNormal; out vec3 vColor; out vec4 vMat; out vec4 vLight; out float vDepth;
void main(){
  vWorld = aPos; vNormal = aNormal; vMat = aMat;
  vColor = pow(max(aColor, vec3(0.0)), vec3(2.2));
  vLight = uLightVP * vec4(aPos, 1.0);
  vec3 p = aPos;
  if (uMirror > 0.5) p.y = -p.y;
  gl_Position = uVP * vec4(p, 1.0);
  vDepth = gl_Position.w;
}`;
const SCENE_FS = (webgl2: boolean) => `
in vec3 vWorld; in vec3 vNormal; in vec3 vColor; in vec4 vMat; in vec4 vLight; in float vDepth;
uniform vec3 uEye; uniform vec3 uSunDir; uniform vec3 uSunColor; uniform vec3 uSkyAmb; uniform vec3 uGroundAmb;
uniform vec4 uSpotPos[4]; uniform vec4 uSpotDir[4]; uniform vec4 uSpotCol[4]; uniform int uSpotCount;
uniform vec3 uFogColor; uniform vec2 uFog; uniform float uTime;
uniform float uShadowOn; uniform float uShadowTexel; uniform float uShadowSoft;
uniform float uReflOn; uniform vec2 uTargetSize;
uniform float uMode; uniform float uMirror; uniform float uExposure;
${webgl2 ? "uniform sampler2DShadow uShadow; uniform sampler2D uRefl; out vec4 fragColor;" : ""}
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float shadowAt(){
${
  webgl2
    ? `  if (uShadowOn < 0.5) return 1.0;
  vec3 p = vLight.xyz / vLight.w * 0.5 + 0.5;
  if (p.x <= 0.0 || p.x >= 1.0 || p.y <= 0.0 || p.y >= 1.0 || p.z >= 1.0) return 1.0;
  float ndl = max(dot(normalize(vNormal), -uSunDir), 0.0);
  p.z -= 0.0012 + 0.0025 * (1.0 - ndl);
  float s = 0.0; float r = uShadowTexel * uShadowSoft;
  for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++)
    s += texture(uShadow, vec3(p.xy + vec2(float(x), float(y)) * r, p.z));
  return s / 9.0;`
    : "  return 1.0;"
}
}
void main(){
  if (uMirror > 0.5 && vWorld.y < -0.02) discard;
  float fog = smoothstep(uFog.x, uFog.y, vDepth) * 0.9;
  vec3 col;
  if (uMode > 0.5) {
    // Additive glow effects: colour × strength, faded by fog.
    col = vColor * vMat.y * (1.0 - fog);
    if (vMat.z > 0.5) {
      // Soft-edged volumes (light shafts): fade where the surface is seen edge-on.
      float f = abs(dot(normalize(vNormal), normalize(uEye - vWorld)));
      col *= f * f;
    }
  } else {
    vec3 N = normalize(vNormal);
    vec3 V = normalize(uEye - vWorld);
    float spec = vMat.x, emit = vMat.y, refl = vMat.z, pattern = vMat.w;
    vec3 base = vColor;
    if (pattern > 0.5 && pattern < 1.5) {
      // Carpet: fine speckle.
      float n = hash(floor(vWorld.xz * 38.0));
      base *= 0.82 + 0.36 * n;
    } else if (pattern > 1.5 && pattern < 2.5) {
      // Court: very faint grain.
      base *= 0.96 + 0.08 * hash(floor(vWorld.xz * 60.0));
    }
    float gloss = mix(12.0, 220.0, clamp(spec, 0.0, 1.0));
    float specNorm = (gloss + 8.0) / 40.0;
    vec3 amb = mix(uGroundAmb, uSkyAmb, N.y * 0.5 + 0.5);
    vec3 L = -uSunDir;
    float sh = shadowAt();
    float ndl = max(dot(N, L), 0.0);
    vec3 diffuse = amb + uSunColor * ndl * sh;
    vec3 H = normalize(L + V);
    vec3 specular = uSunColor * pow(max(dot(N, H), 0.0), gloss) * spec * specNorm * ndl * sh;
    for (int i = 0; i < 4; i++) {
      if (i >= uSpotCount) break;
      vec3 d = uSpotPos[i].xyz - vWorld;
      float dist = length(d); vec3 Ls = d / dist;
      float cone = smoothstep(uSpotDir[i].w, uSpotCol[i].w, dot(-Ls, uSpotDir[i].xyz));
      float att = cone / (1.0 + pow(dist / uSpotPos[i].w, 2.0));
      float nl = max(dot(N, Ls), 0.0);
      diffuse += uSpotCol[i].rgb * nl * att;
      vec3 Hs = normalize(Ls + V);
      specular += uSpotCol[i].rgb * pow(max(dot(N, Hs), 0.0), gloss) * spec * specNorm * nl * att;
    }
    col = base * diffuse + specular + base * emit * 2.6;
    // Fresnel rim on glossy things.
    float fres = pow(1.0 - max(dot(N, V), 0.0), 5.0);
    col += uSkyAmb * fres * spec * 0.35;
${
  webgl2
    ? `    if (uReflOn > 0.5 && refl > 0.0 && uMirror < 0.5) {
      vec2 uv = gl_FragCoord.xy / uTargetSize + N.xz * 0.004;
      // Slightly blurred (satin finish), which also hides the half-resolution stair-steps.
      vec2 t = 1.6 / uTargetSize;
      vec3 r = (texture(uRefl, uv).rgb * 2.0
        + texture(uRefl, uv + vec2(t.x, t.y)).rgb + texture(uRefl, uv + vec2(-t.x, t.y)).rgb
        + texture(uRefl, uv + vec2(t.x, -t.y)).rgb + texture(uRefl, uv + vec2(-t.x, -t.y)).rgb) / 6.0;
      col += r * refl * (0.35 + 0.65 * fres);
    }`
    : ""
}
    col = mix(col, uFogColor, fog);
  }
${
  webgl2
    ? `  fragColor = vec4(col, 1.0);`
    : `  vec3 x = col * uExposure;
  x = clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
  gl_FragColor = vec4(pow(x, vec3(1.0 / 2.2)), 1.0);`
}
}`;
// In the direct (Low) WebGL2 path the scene shader writes tone-mapped colour itself.
const DIRECT_TONEMAP = `
  fragColor.rgb *= uExposure;
  vec3 x = fragColor.rgb;
  x = clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
  fragColor.rgb = pow(x, vec3(1.0 / 2.2));
}`;
// Face photo decal: texture × a soft light level, alpha-masked (oval cut-out in the image).
const DECAL_VS = `
in vec3 aPos; in vec2 aUv; uniform mat4 uVP; out vec2 vUv; out float vDepth;
void main(){ vUv = aUv; gl_Position = uVP * vec4(aPos, 1.0); vDepth = gl_Position.w; }`;
const DECAL_FS = `
in vec2 vUv; in float vDepth; uniform sampler2D uTex; uniform float uLight; uniform float uDirect; uniform float uExposure;
${"__OUT__"}
void main(){
  vec4 t = texture(uTex, vUv);
  vec3 c = pow(t.rgb, vec3(2.2)) * uLight;
  if (uDirect > 0.5) {
    vec3 x = c * uExposure;
    x = clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
    c = pow(x, vec3(1.0 / 2.2));
  }
  fragColor = vec4(c, t.a);
}`;
const DEPTH_VS = `
in vec3 aPos; uniform mat4 uLightVP;
void main(){ gl_Position = uLightVP * vec4(aPos, 1.0); }`;
const DEPTH_FS = `out vec4 o; void main(){ o = vec4(1.0); }`;
const QUAD_VS = `
in vec2 aQuad; out vec2 vUv;
void main(){ vUv = aQuad * 0.5 + 0.5; gl_Position = vec4(aQuad, 0.0, 1.0); }`;
const DOWN_FS = `
in vec2 vUv; uniform sampler2D uSrc; uniform vec2 uTexel; uniform float uPrefilter; uniform float uThreshold;
out vec4 o;
vec3 pre(vec3 c){
  float b = max(c.r, max(c.g, c.b));
  float soft = clamp(b - uThreshold + 0.5, 0.0, 1.0); soft = soft * soft * 0.5;
  float k = max(soft, b - uThreshold) / max(b, 1e-4);
  return c * k;
}
void main(){
  vec3 a = texture(uSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb;
  vec3 b = texture(uSrc, vUv + uTexel * vec2( 1.0, -1.0)).rgb;
  vec3 c = texture(uSrc, vUv + uTexel * vec2(-1.0,  1.0)).rgb;
  vec3 d = texture(uSrc, vUv + uTexel * vec2( 1.0,  1.0)).rgb;
  vec3 e = texture(uSrc, vUv).rgb;
  vec3 s = (a + b + c + d) * 0.125 + e * 0.5;
  if (uPrefilter > 0.5) s = pre(min(s, vec3(40.0)));
  o = vec4(s, 1.0);
}`;
const UP_FS = `
in vec2 vUv; uniform sampler2D uSrc; uniform vec2 uTexel; out vec4 o;
void main(){
  vec3 s = texture(uSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb
         + texture(uSrc, vUv + uTexel * vec2( 1.0, -1.0)).rgb
         + texture(uSrc, vUv + uTexel * vec2(-1.0,  1.0)).rgb
         + texture(uSrc, vUv + uTexel * vec2( 1.0,  1.0)).rgb
         + 2.0 * (texture(uSrc, vUv + uTexel * vec2(0.0, -1.0)).rgb
                + texture(uSrc, vUv + uTexel * vec2(0.0,  1.0)).rgb
                + texture(uSrc, vUv + uTexel * vec2(-1.0, 0.0)).rgb
                + texture(uSrc, vUv + uTexel * vec2( 1.0, 0.0)).rgb)
         + 4.0 * texture(uSrc, vUv).rgb;
  o = vec4(s / 16.0, 1.0);
}`;
const COMPOSITE_FS = `
in vec2 vUv; uniform sampler2D uScene; uniform sampler2D uBloom;
uniform float uBloomOn; uniform float uBloomStrength; uniform float uExposure;
uniform float uVignette; uniform float uSplit; uniform float uLines; uniform float uFlash; uniform vec2 uFocus;
uniform float uTime; uniform vec2 uAspect;
out vec4 o;
vec3 aces(vec3 x){ return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
float hash(float n){ return fract(sin(n) * 43758.5453); }
vec3 sampleHdr(vec2 uv){
  vec3 c = texture(uScene, uv).rgb;
  if (uBloomOn > 0.5) c += texture(uBloom, uv).rgb * uBloomStrength;
  return c;
}
void main(){
  vec2 uv = vUv;
  vec3 c;
  if (uSplit > 0.0) {
    // RGB split, stronger toward the edges.
    vec2 dir = (uv - uFocus) * uSplit * 0.03;
    c = vec3(sampleHdr(uv + dir).r, sampleHdr(uv).g, sampleHdr(uv - dir).b);
  } else c = sampleHdr(uv);
  c *= uExposure;
  if (uLines > 0.0) {
    // Radial speed lines from the focus point.
    vec2 d = (uv - uFocus) * uAspect;
    float a = atan(d.y, d.x);
    float r = length(d);
    float seg = floor(a * 150.0 / 6.2832);
    float n = hash(seg + floor(uTime * 20.0) * 13.0);
    // Thin streaks, mostly toward the edges, each starting at a random distance.
    float start = 0.2 + hash(seg * 3.1) * 0.35;
    float line = step(0.78, n) * smoothstep(start, start + 0.25, r);
    float edge = abs(fract(a * 150.0 / 6.2832) - 0.5);
    line *= smoothstep(0.5, 0.3, edge);
    c += vec3(1.0, 0.96, 0.92) * line * uLines * 0.75;
  }
  c += vec3(1.0, 0.97, 0.92) * uFlash;
  c = aces(c);
  vec2 v = (uv - 0.5) * vec2(1.0, 0.85);
  c *= mix(1.0, smoothstep(0.85, 0.2, length(v)), uVignette);
  c = pow(c, vec3(1.0 / 2.2));
  o = vec4(c, dot(c, vec3(0.299, 0.587, 0.114)));
}`;
// FXAA 3.11 (quality preset ~12, simplified), on luma stored in alpha.
const FXAA_FS = `
in vec2 vUv; uniform sampler2D uSrc; uniform vec2 uTexel; out vec4 o;
float L(vec2 p){ return texture(uSrc, p).a; }
void main(){
  vec2 uv = vUv;
  float m = L(uv), n = L(uv + vec2(0.0, uTexel.y)), s = L(uv - vec2(0.0, uTexel.y));
  float e = L(uv + vec2(uTexel.x, 0.0)), w = L(uv - vec2(uTexel.x, 0.0));
  float hi = max(m, max(max(n, s), max(e, w))), lo = min(m, min(min(n, s), min(e, w)));
  float range = hi - lo;
  if (range < max(0.0312, hi * 0.125)) { o = vec4(texture(uSrc, uv).rgb, 1.0); return; }
  float ne = L(uv + uTexel), nw = L(uv + vec2(-uTexel.x, uTexel.y));
  float se = L(uv + vec2(uTexel.x, -uTexel.y)), sw = L(uv - uTexel);
  float horiz = abs(n + s - 2.0 * m) * 2.0 + abs(ne + se - 2.0 * e) + abs(nw + sw - 2.0 * w);
  float vert = abs(e + w - 2.0 * m) * 2.0 + abs(ne + nw - 2.0 * n) + abs(se + sw - 2.0 * s);
  bool isH = horiz >= vert;
  float p1 = isH ? n : e, p2 = isH ? s : w;
  float g1 = abs(p1 - m), g2 = abs(p2 - m);
  float step = isH ? uTexel.y : uTexel.x;
  float lumaLocal; float grad;
  if (g1 >= g2) { lumaLocal = 0.5 * (p1 + m); grad = g1; } else { step = -step; lumaLocal = 0.5 * (p2 + m); grad = g2; }
  vec2 cur = uv; if (isH) cur.y += step * 0.5; else cur.x += step * 0.5;
  vec2 off = isH ? vec2(uTexel.x, 0.0) : vec2(0.0, uTexel.y);
  vec2 u1 = cur - off, u2 = cur + off;
  float e1 = L(u1) - lumaLocal, e2 = L(u2) - lumaLocal;
  bool d1 = abs(e1) >= grad * 0.25, d2 = abs(e2) >= grad * 0.25;
  for (int i = 0; i < 10; i++) {
    if (d1 && d2) break;
    float q = i < 3 ? 1.0 : (i < 6 ? 1.5 : 3.0);
    if (!d1) { u1 -= off * q; e1 = L(u1) - lumaLocal; d1 = abs(e1) >= grad * 0.25; }
    if (!d2) { u2 += off * q; e2 = L(u2) - lumaLocal; d2 = abs(e2) >= grad * 0.25; }
  }
  float dist1 = isH ? uv.x - u1.x : uv.y - u1.y, dist2 = isH ? u2.x - uv.x : u2.y - uv.y;
  bool closer1 = dist1 < dist2; float dmin = min(dist1, dist2);
  float span = dist1 + dist2;
  float pixelOff = -dmin / span + 0.5;
  bool smaller = m < lumaLocal;
  bool correct = ((closer1 ? e1 : e2) < 0.0) != smaller;
  float fin = correct ? pixelOff : 0.0;
  float avg = (2.0 * (n + s + e + w) + ne + nw + se + sw) / 12.0;
  float sub = clamp(abs(avg - m) / range, 0.0, 1.0);
  sub = (-2.0 * sub + 3.0) * sub * sub; sub = sub * sub * 0.75;
  fin = max(fin, sub);
  vec2 f = uv; if (isH) f.y += fin * step; else f.x += fin * step;
  o = vec4(texture(uSrc, f).rgb, 1.0);
}`;

type Target = {
  fb: WebGLFramebuffer;
  tex: WebGLTexture;
  depth?: WebGLRenderbuffer;
  w: number;
  h: number;
};

const SETTINGS: Record<
  Quality,
  {
    shadow: number;
    reflect: boolean;
    bloomLevels: number;
    post: boolean;
    scale: number;
    soft: number;
  }
> = {
  high: {
    shadow: 2048,
    reflect: true,
    bloomLevels: 6,
    post: true,
    scale: 2,
    soft: 1.6,
  },
  medium: {
    shadow: 1024,
    reflect: false,
    bloomLevels: 5,
    post: true,
    scale: 1.25,
    soft: 1.2,
  },
  low: {
    shadow: 0,
    reflect: false,
    bloomLevels: 0,
    post: false,
    scale: 1,
    soft: 1,
  },
};

export class Renderer {
  canvas: HTMLCanvasElement;
  gl: WebGL2RenderingContext | WebGLRenderingContext;
  webgl2: boolean;
  /** HDR rendering available (WebGL2 + float colour buffers). */
  hdr = false;
  pref: QualityPref = "auto";
  quality: Quality = "high";
  /** Why the renderer is running below the chosen quality, if it is. */
  note = "";
  scene!: WebGLProgram;
  direct?: WebGLProgram;
  depthProg?: WebGLProgram;
  down?: WebGLProgram;
  up?: WebGLProgram;
  composite?: WebGLProgram;
  fxaa?: WebGLProgram;
  decal?: WebGLProgram;
  decalBuf?: WebGLBuffer;
  textures = new Map<string, WebGLTexture>();
  /** Upload (or replace) an image texture under `key`; null removes it. */
  setTexture(key: string, img: TexImageSource | null) {
    const gl = this.gl;
    const old = this.textures.get(key);
    if (old) gl.deleteTexture(old);
    this.textures.delete(key);
    if (!img) return;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.textures.set(key, t);
  }
  drawDecals(v: ViewDraw, direct: boolean, exposure: number) {
    if (!v.decals?.length || !this.decal) return;
    const gl = this.gl,
      p = this.decal;
    gl.useProgram(p);
    gl.uniformMatrix4fv(this.u(p, "uVP"), false, v.vp);
    gl.uniform1f(this.u(p, "uLight"), 0.85);
    gl.uniform1f(this.u(p, "uDirect"), direct ? 1 : 0);
    gl.uniform1f(this.u(p, "uExposure"), exposure);
    gl.uniform1i(this.u(p, "uTex"), 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    for (const d of v.decals) {
      const tex = this.textures.get(d.key);
      if (!tex) continue;
      const [a, b, c, e] = d.corners;
      const data = new Float32Array([
        // Corners are bottom-left, bottom-right, top-right, top-left; the texture is
        // uploaded flipped, so v = 0 is the bottom of the photo.
        ...a, 0, 0, ...b, 1, 0, ...c, 1, 1,
        ...a, 0, 0, ...c, 1, 1, ...e, 0, 1,
      ]);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.decalBuf!);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 12);
      for (const i of [2, 3]) gl.disableVertexAttribArray(i);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
    gl.disable(gl.BLEND);
  }
  quad?: WebGLBuffer;
  staticBuf: WebGLBuffer;
  staticCount = 0;
  dynBuf: WebGLBuffer;
  fxBuf: WebGLBuffer;
  staticFx: WebGLBuffer;
  staticFxCount = 0;
  vao?: WebGLVertexArrayObject;
  shadow?: { fb: WebGLFramebuffer; tex: WebGLTexture; size: number };
  hdrT?: Target;
  reflT?: Target;
  ldrT?: Target;
  bloomT: Target[] = [];
  lightVP: number[] = identity();
  locs = new Map<WebGLProgram, Map<string, WebGLUniformLocation | null>>();
  /** Frame-time history for Auto quality. */
  slow = 0;
  fast = 0;
  lastFrame = 0;
  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const basic = /[?&]renderer=basic/.test(location.search);
    const gl2 = basic ? null : canvas.getContext("webgl2", {
      antialias: false,
      alpha: false,
      powerPreference: "high-performance",
    });
    if (gl2) {
      this.gl = gl2;
      this.webgl2 = true;
      this.hdr = !!gl2.getExtension("EXT_color_buffer_float");
      gl2.getExtension("OES_texture_float_linear");
    } else {
      const gl1 = canvas.getContext("webgl", { antialias: true, alpha: false });
      if (!gl1)
        throw Error(
          "WebGL is unavailable. Enable hardware acceleration or try another browser.",
        );
      this.gl = gl1;
      this.webgl2 = false;
      this.note = "WebGL2 unavailable: basic lighting only";
    }
    const gl = this.gl;
    this.staticBuf = gl.createBuffer()!;
    this.dynBuf = gl.createBuffer()!;
    this.fxBuf = gl.createBuffer()!;
    this.staticFx = gl.createBuffer()!;
    this.compile();
    try {
      const saved = localStorage.getItem("pov-quality") as QualityPref | null;
      if (saved && saved in QUALITY_LABELS) this.pref = saved;
    } catch {}
    this.setQuality(this.pref);
  }
  program(vs: string, fs: string, webgl2 = this.webgl2) {
    const gl = this.gl;
    const head = webgl2 ? "#version 300 es\n" + COMMON : "precision highp float;\n";
    const conv = (src: string, frag: boolean) =>
      webgl2
        ? src
        : src
            .replace(/\bin vec/g, frag ? "varying vec" : "attribute vec")
            .replace(/\bin float/g, frag ? "varying float" : "attribute float")
            .replace(/\bout (vec|float)/g, "varying $1")
            .replace(/fragColor/g, "gl_FragColor")
            .replace(/\btexture\(/g, "texture2D(");
    const make = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, head + src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
        throw Error(gl.getShaderInfoLog(s) || "Shader error");
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, make(gl.VERTEX_SHADER, conv(vs, false)));
    gl.attachShader(p, make(gl.FRAGMENT_SHADER, conv(fs, true)));
    gl.bindAttribLocation(p, 0, "aPos");
    gl.bindAttribLocation(p, 1, "aNormal");
    gl.bindAttribLocation(p, 2, "aColor");
    gl.bindAttribLocation(p, 3, "aMat");
    gl.bindAttribLocation(p, 0, "aQuad");
    gl.bindAttribLocation(p, 1, "aUv");
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS))
      throw Error(gl.getProgramInfoLog(p) || "Unable to initialize renderer");
    this.locs.set(p, new Map());
    return p;
  }
  compile() {
    this.decalBuf = this.gl.createBuffer()!;
    if (!this.webgl2) {
      this.scene = this.program(SCENE_VS, SCENE_FS(false), false);
      this.decal = this.program(DECAL_VS, DECAL_FS.replace("__OUT__", ""), false);
      return;
    }
    this.decal = this.program(DECAL_VS, DECAL_FS.replace("__OUT__", "out vec4 fragColor;"));
    const fs = SCENE_FS(true);
    this.scene = this.program(SCENE_VS, fs);
    this.direct = this.program(
      SCENE_VS,
      fs.replace(/}\s*$/, "").replace(/\s*$/, "") + DIRECT_TONEMAP,
    );
    this.depthProg = this.program(DEPTH_VS, DEPTH_FS);
    this.down = this.program(QUAD_VS, DOWN_FS);
    this.up = this.program(QUAD_VS, UP_FS);
    this.composite = this.program(QUAD_VS, COMPOSITE_FS);
    this.fxaa = this.program(QUAD_VS, FXAA_FS);
    const gl = this.gl as WebGL2RenderingContext;
    this.quad = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );
    this.vao = gl.createVertexArray()!;
  }
  u(p: WebGLProgram, name: string) {
    const m = this.locs.get(p)!;
    if (!m.has(name)) m.set(name, this.gl.getUniformLocation(p, name));
    return m.get(name)!;
  }
  /** Choose a quality level ("auto" adapts to the frame rate). Saved per browser. */
  setQuality(pref: QualityPref) {
    this.pref = pref;
    try {
      localStorage.setItem("pov-quality", pref);
    } catch {}
    this.apply(pref === "auto" ? "high" : pref);
  }
  apply(q: Quality) {
    if (!this.webgl2) q = "low";
    this.quality = q;
    this.slow = this.fast = 0;
    this.dropTargets();
  }
  /** Glossy court reflection is on at this quality? (Scene uses it to skip fake shadows.) */
  get shadows() {
    return this.webgl2 && SETTINGS[this.quality].shadow > 0;
  }
  get scale() {
    return Math.min(devicePixelRatio || 1, SETTINGS[this.quality].scale);
  }
  dropTargets() {
    const gl = this.gl;
    const kill = (t?: Target) => {
      if (!t) return;
      gl.deleteFramebuffer(t.fb);
      gl.deleteTexture(t.tex);
      if (t.depth) gl.deleteRenderbuffer(t.depth);
    };
    kill(this.hdrT);
    kill(this.reflT);
    kill(this.ldrT);
    this.bloomT.forEach(kill);
    this.hdrT = this.reflT = this.ldrT = undefined;
    this.bloomT = [];
    if (this.shadow) {
      gl.deleteFramebuffer(this.shadow.fb);
      gl.deleteTexture(this.shadow.tex);
      this.shadow = undefined;
    }
  }
  target(w: number, h: number, hdr: boolean, depth: boolean): Target {
    const gl = this.gl as WebGL2RenderingContext;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    const float = hdr && this.hdr;
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      float ? gl.RGBA16F : gl.RGBA8,
      w,
      h,
      0,
      gl.RGBA,
      float ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE,
      null,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      tex,
      0,
    );
    let rb: WebGLRenderbuffer | undefined;
    if (depth) {
      rb = gl.createRenderbuffer()!;
      gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
      gl.framebufferRenderbuffer(
        gl.FRAMEBUFFER,
        gl.DEPTH_ATTACHMENT,
        gl.RENDERBUFFER,
        rb,
      );
    }
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
      throw Error("Framebuffer incomplete");
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { fb, tex, depth: rb, w, h };
  }
  ensure(w: number, h: number) {
    if (!this.webgl2) return;
    const s = SETTINGS[this.quality];
    if (this.hdrT && this.hdrT.w === w && this.hdrT.h === h) return;
    this.dropTargets();
    const gl = this.gl as WebGL2RenderingContext;
    if (s.shadow) {
      const tex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, s.shadow, s.shadow);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(
        gl.TEXTURE_2D,
        gl.TEXTURE_COMPARE_MODE,
        gl.COMPARE_REF_TO_TEXTURE,
      );
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
      const fb = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.DEPTH_ATTACHMENT,
        gl.TEXTURE_2D,
        tex,
        0,
      );
      gl.drawBuffers([gl.NONE]);
      gl.readBuffer(gl.NONE);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      this.shadow = { fb, tex, size: s.shadow };
    }
    if (!s.post) return;
    this.hdrT = this.target(w, h, true, true);
    this.ldrT = this.target(w, h, false, false);
    if (s.reflect)
      this.reflT = this.target(Math.ceil(w / 2), Math.ceil(h / 2), true, true);
    let bw = w,
      bh = h;
    for (let i = 0; i < s.bloomLevels; i++) {
      bw = Math.max(1, Math.ceil(bw / 2));
      bh = Math.max(1, Math.ceil(bh / 2));
      this.bloomT.push(this.target(bw, bh, true, false));
    }
  }
  setStatic(data: Float32Array) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.staticBuf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    this.staticCount = data.length / STRIDE;
  }
  setStaticFx(data: Float32Array) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.staticFx);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    this.staticFxCount = data.length / STRIDE;
  }
  bindMesh(buf: WebGLBuffer, positionsOnly = false) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    const b = STRIDE * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, b, 0);
    for (const [i, n, off] of [
      [1, 3, 12],
      [2, 3, 24],
      [3, 4, 36],
    ]) {
      if (positionsOnly) gl.disableVertexAttribArray(i);
      else {
        gl.enableVertexAttribArray(i);
        gl.vertexAttribPointer(i, n, gl.FLOAT, false, b, off);
      }
    }
  }
  drawMesh(buf: WebGLBuffer, count: number, positionsOnly = false) {
    if (!count) return;
    this.bindMesh(buf, positionsOnly);
    this.gl.drawArrays(this.gl.TRIANGLES, 0, count);
  }
  upload(buf: WebGLBuffer, data: Float32Array) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    return data.length / STRIDE;
  }
  /** Directional light camera covering the court and players. */
  computeLight(dir: V3) {
    const eye: V3 = [-dir[0] * 40, -dir[1] * 40, -dir[2] * 40];
    const z = normalize(eye),
      up: V3 = Math.abs(z[1]) > 0.95 ? [0, 0, 1] : [0, 1, 0],
      x = normalize(crossV(up, z)),
      y = crossV(z, x);
    const view = [
      x[0], y[0], z[0], 0,
      x[1], y[1], z[1], 0,
      x[2], y[2], z[2], 0,
      -dotV(x, eye), -dotV(y, eye), -dotV(z, eye), 1,
    ];
    const r = 13.5,
      n = 1,
      f = 90;
    const proj = [
      1 / r, 0, 0, 0,
      0, 1 / r, 0, 0,
      0, 0, -2 / (f - n), 0,
      0, 0, -(f + n) / (f - n), 1,
    ];
    this.lightVP = mul(proj, view);
  }
  setLighting(p: WebGLProgram, light: Lighting, time: number) {
    const gl = this.gl;
    gl.uniform3fv(this.u(p, "uSunDir"), light.sunDir);
    gl.uniform3fv(this.u(p, "uSunColor"), light.sunColor);
    gl.uniform3fv(this.u(p, "uSkyAmb"), light.skyAmb);
    gl.uniform3fv(this.u(p, "uGroundAmb"), light.groundAmb);
    const pos: number[] = [],
      dir: number[] = [],
      col: number[] = [];
    for (const s of light.spots.slice(0, 4)) {
      pos.push(...s.pos, s.range);
      const d = normalize(s.dir);
      dir.push(...d, Math.cos((s.outer * Math.PI) / 180));
      col.push(...s.color, Math.cos((s.inner * Math.PI) / 180));
    }
    while (pos.length < 16) pos.push(0), dir.push(0), col.push(0);
    gl.uniform4fv(this.u(p, "uSpotPos"), pos);
    gl.uniform4fv(this.u(p, "uSpotDir"), dir);
    gl.uniform4fv(this.u(p, "uSpotCol"), col);
    gl.uniform1i(this.u(p, "uSpotCount"), Math.min(4, light.spots.length));
    gl.uniform3fv(this.u(p, "uFogColor"), light.sky);
    gl.uniform2f(this.u(p, "uFog"), light.fogNear, light.fogFar);
    gl.uniform1f(this.u(p, "uTime"), time);
    gl.uniform1f(this.u(p, "uExposure"), light.exposure);
    gl.uniformMatrix4fv(this.u(p, "uLightVP"), false, this.lightVP);
    const s = SETTINGS[this.quality];
    gl.uniform1f(this.u(p, "uShadowOn"), this.shadow ? 1 : 0);
    gl.uniform1f(this.u(p, "uShadowTexel"), this.shadow ? 1 / this.shadow.size : 0);
    gl.uniform1f(this.u(p, "uShadowSoft"), s.soft);
  }
  /** Draw one frame. Returns false if the GPU path failed (caller may retry at lower quality). */
  frame(
    w: number,
    h: number,
    light: Lighting,
    views: ViewDraw[],
    post: Post,
    time: number,
  ) {
    const gl = this.gl;
    this.autoTune();
    try {
      this.ensure(w, h);
    } catch (e) {
      // Float buffers or framebuffer setup failed: fall back to the direct path.
      this.note = "Post effects unavailable: " + (e as Error).message;
      this.quality = "low";
      this.dropTargets();
    }
    const s = SETTINGS[this.quality];
    const post2 = this.webgl2 && s.post && !!this.hdrT;
    if (this.webgl2) (gl as WebGL2RenderingContext).bindVertexArray(this.vao!);
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    // ——— shadow map ———
    if (this.shadow && views[0]) {
      const g = gl as WebGL2RenderingContext;
      this.computeLight(light.sunDir);
      g.bindFramebuffer(g.FRAMEBUFFER, this.shadow.fb);
      g.viewport(0, 0, this.shadow.size, this.shadow.size);
      g.clear(g.DEPTH_BUFFER_BIT);
      g.useProgram(this.depthProg!);
      g.uniformMatrix4fv(this.u(this.depthProg!, "uLightVP"), false, this.lightVP);
      g.enable(g.POLYGON_OFFSET_FILL);
      g.polygonOffset(1.5, 2);
      this.drawMesh(this.staticBuf, this.staticCount, true);
      const n = this.upload(this.dynBuf, views[0].dynamic);
      this.drawMesh(this.dynBuf, n, true);
      g.disable(g.POLYGON_OFFSET_FILL);
    }
    const prog = post2 ? this.scene : (this.direct ?? this.scene);
    // ——— per view: reflection, then the lit scene, then additive effects ———
    const mainTarget = post2 ? this.hdrT! : null;
    gl.bindFramebuffer(gl.FRAMEBUFFER, mainTarget ? mainTarget.fb : null);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(light.sky[0] ** 2.2, light.sky[1] ** 2.2, light.sky[2] ** 2.2, 1);
    if (!post2) gl.clearColor(light.sky[0], light.sky[1], light.sky[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    for (const v of views) {
      const [vx, vy, vw, vh] = v.rect;
      const dynCount = this.upload(this.dynBuf, v.dynamic);
      if (post2 && this.reflT) {
        const r = this.reflT,
          k = r.w / w;
        gl.bindFramebuffer(gl.FRAMEBUFFER, r.fb);
        gl.viewport(Math.floor(vx * k), Math.floor(vy * k), Math.ceil(vw * k), Math.ceil(vh * k));
        gl.enable(gl.SCISSOR_TEST);
        gl.scissor(Math.floor(vx * k), Math.floor(vy * k), Math.ceil(vw * k), Math.ceil(vh * k));
        gl.clearColor(light.sky[0] ** 2.2, light.sky[1] ** 2.2, light.sky[2] ** 2.2, 1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.disable(gl.SCISSOR_TEST);
        this.useScene(prog, light, v, time, 1, 0, w, h);
        this.drawMesh(this.staticBuf, this.staticCount);
        this.drawMesh(this.dynBuf, dynCount);
        gl.bindFramebuffer(gl.FRAMEBUFFER, mainTarget!.fb);
      }
      gl.viewport(vx, vy, vw, vh);
      this.useScene(prog, light, v, time, 0, 0, w, h);
      if (this.reflT) {
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.reflT.tex);
        gl.uniform1i(this.u(prog, "uRefl"), 1);
      }
      this.drawMesh(this.staticBuf, this.staticCount);
      this.drawMesh(this.dynBuf, dynCount);
      this.drawDecals(v, !post2, light.exposure);
      gl.useProgram(prog);
      // Additive glow (light shafts, trails, rings): no depth writes.
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.depthMask(false);
      gl.uniform1f(this.u(prog, "uMode"), 1);
      this.drawMesh(this.staticFx, this.staticFxCount);
      const fxCount = this.upload(this.fxBuf, v.fx);
      this.drawMesh(this.fxBuf, fxCount);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }
    if (!post2) return;
    // ——— bloom ———
    const g = gl as WebGL2RenderingContext;
    g.disable(g.DEPTH_TEST);
    let src = this.hdrT!.tex,
      sw = w,
      sh = h;
    this.bloomT.forEach((t, i) => {
      g.bindFramebuffer(g.FRAMEBUFFER, t.fb);
      g.viewport(0, 0, t.w, t.h);
      g.useProgram(this.down!);
      g.activeTexture(g.TEXTURE0);
      g.bindTexture(g.TEXTURE_2D, src);
      g.uniform1i(this.u(this.down!, "uSrc"), 0);
      g.uniform2f(this.u(this.down!, "uTexel"), 1 / sw, 1 / sh);
      g.uniform1f(this.u(this.down!, "uPrefilter"), i === 0 ? 1 : 0);
      g.uniform1f(this.u(this.down!, "uThreshold"), 1.0);
      this.quadDraw();
      src = t.tex;
      sw = t.w;
      sh = t.h;
    });
    g.enable(g.BLEND);
    g.blendFunc(g.ONE, g.ONE);
    for (let i = this.bloomT.length - 1; i > 0; i--) {
      const from = this.bloomT[i],
        to = this.bloomT[i - 1];
      g.bindFramebuffer(g.FRAMEBUFFER, to.fb);
      g.viewport(0, 0, to.w, to.h);
      g.useProgram(this.up!);
      g.activeTexture(g.TEXTURE0);
      g.bindTexture(g.TEXTURE_2D, from.tex);
      g.uniform1i(this.u(this.up!, "uSrc"), 0);
      g.uniform2f(this.u(this.up!, "uTexel"), 1 / from.w, 1 / from.h);
      this.quadDraw();
    }
    g.disable(g.BLEND);
    // ——— composite: tone map, vignette, RGB split, speed lines ———
    g.bindFramebuffer(g.FRAMEBUFFER, this.ldrT!.fb);
    g.viewport(0, 0, w, h);
    const c = this.composite!;
    g.useProgram(c);
    g.activeTexture(g.TEXTURE0);
    g.bindTexture(g.TEXTURE_2D, this.hdrT!.tex);
    g.uniform1i(this.u(c, "uScene"), 0);
    g.activeTexture(g.TEXTURE1);
    g.bindTexture(g.TEXTURE_2D, this.bloomT[0]?.tex ?? this.hdrT!.tex);
    g.uniform1i(this.u(c, "uBloom"), 1);
    g.uniform1f(this.u(c, "uBloomOn"), this.bloomT.length ? 1 : 0);
    g.uniform1f(this.u(c, "uBloomStrength"), light.bloom);
    g.uniform1f(this.u(c, "uExposure"), light.exposure);
    g.uniform1f(this.u(c, "uVignette"), post.vignette);
    g.uniform1f(this.u(c, "uSplit"), post.rgbSplit);
    g.uniform1f(this.u(c, "uLines"), post.speedLines);
    g.uniform1f(this.u(c, "uFlash"), post.flash);
    g.uniform2f(this.u(c, "uFocus"), post.focus[0], post.focus[1]);
    g.uniform1f(this.u(c, "uTime"), time);
    g.uniform2f(this.u(c, "uAspect"), w / h, 1);
    this.quadDraw();
    // ——— FXAA to the canvas ———
    g.bindFramebuffer(g.FRAMEBUFFER, null);
    g.viewport(0, 0, w, h);
    g.useProgram(this.fxaa!);
    g.activeTexture(g.TEXTURE0);
    g.bindTexture(g.TEXTURE_2D, this.ldrT!.tex);
    g.uniform1i(this.u(this.fxaa!, "uSrc"), 0);
    g.uniform2f(this.u(this.fxaa!, "uTexel"), 1 / w, 1 / h);
    this.quadDraw();
    g.enable(g.DEPTH_TEST);
  }
  useScene(
    p: WebGLProgram,
    light: Lighting,
    v: ViewDraw,
    time: number,
    mirror: number,
    mode: number,
    w: number,
    h: number,
  ) {
    const gl = this.gl;
    gl.useProgram(p);
    this.setLighting(p, light, time);
    gl.uniformMatrix4fv(this.u(p, "uVP"), false, v.vp);
    gl.uniform3f(
      this.u(p, "uEye"),
      v.eye[0],
      mirror ? -v.eye[1] : v.eye[1],
      v.eye[2],
    );
    gl.uniform1f(this.u(p, "uMirror"), mirror);
    gl.uniform1f(this.u(p, "uMode"), mode);
    gl.uniform1f(this.u(p, "uReflOn"), this.reflT && !mirror ? 1 : 0);
    gl.uniform2f(this.u(p, "uTargetSize"), w, h);
    // Samplers of different types must never share a texture unit (WebGL2 refuses to draw),
    // so these are always assigned, even when the feature is off.
    gl.uniform1i(this.u(p, "uRefl"), 1);
    gl.uniform1i(this.u(p, "uShadow"), 2);
    if (this.shadow) {
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, this.shadow.tex);
    }
  }
  quadDraw() {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad!);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
    for (const i of [1, 2, 3]) gl.disableVertexAttribArray(i);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
  /** Auto quality: step down after ~3 s of slow frames, back up after ~10 s of fast ones. */
  /** When each level last proved too slow (ms), so Auto doesn't bounce straight back to it. */
  failed: Record<Quality, number> = { high: -1e9, medium: -1e9, low: -1e9 };
  avgDt = 16.7;
  autoTune() {
    const now = performance.now(),
      dt = now - this.lastFrame;
    this.lastFrame = now;
    // Very long frames mean the tab was throttled (hidden, covered, backgrounded), not that
    // the GPU is struggling, so they don't count either way.
    if (this.pref !== "auto" || dt > 70 || document.hidden) return;
    if (dt > 24) this.slow++;
    else this.slow = Math.max(0, this.slow - 0.5);
    // Smoothed frame time; "fast" = seconds spent comfortably above ~55 fps.
    this.avgDt = this.avgDt * 0.95 + dt * 0.05;
    if (this.avgDt < 18.5) this.fast += dt / 1000;
    else this.fast = 0;
    const order: Quality[] = ["low", "medium", "high"];
    const i = order.indexOf(this.quality);
    if (this.slow > 150 && i > 0) {
      this.failed[this.quality] = now;
      this.apply(order[i - 1]);
      this.note = "Auto quality lowered to keep the frame rate up";
    } else if (
      this.fast > 10 &&
      i < 2 &&
      this.webgl2 &&
      !this.note.startsWith("Post") &&
      now - this.failed[order[i + 1]] > 60000
    ) {
      // ~10 s of smooth frames: try the next level up again (a minute after it last failed).
      this.apply(order[i + 1]);
      this.note = "";
    }
  }
}

function identity() {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}
function mul(a: number[], b: number[]) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      for (let i = 0; i < 4; i++) o[c * 4 + r] += a[i * 4 + r] * b[c * 4 + i];
  return o;
}
function normalize(a: number[]): V3 {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}
function crossV(a: number[], b: number[]): V3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}
function dotV(a: number[], b: number[]) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
