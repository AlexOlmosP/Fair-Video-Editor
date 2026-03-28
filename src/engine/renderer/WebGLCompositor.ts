/**
 * WebGL2-based compositor for GPU-accelerated video preview rendering.
 * Replaces the Canvas 2D compositor with GPU shaders for color correction,
 * blend modes, filters, and texture compositing.
 *
 * Architecture:
 *   - Two ping-pong FBOs for blend mode compositing
 *   - One temp FBO for per-layer rendering before blending
 *   - Main shader: handles transforms, color correction, filters, crop
 *   - Blend shader: composites layer onto accumulation buffer
 *   - Blit shader: outputs accumulation buffer to screen
 */

import type { ColorCorrectionParams } from '@/store/types';

// ─── Shader Sources ────────────────────────────────────────────────────────

const VERT_MAIN = `#version 300 es
precision mediump float;
in vec2 a_position;
uniform mat3 u_transform;
uniform vec2 u_cropUVMin;
uniform vec2 u_cropUVMax;
out vec2 v_texCoord;
void main() {
  vec3 pos = u_transform * vec3(a_position, 1.0);
  gl_Position = vec4(pos.xy, 0.0, 1.0);
  // Map [-1,1] vertex position to UV [0,1], flip Y for WebGL texture convention
  vec2 baseUV = vec2(a_position.x * 0.5 + 0.5, 0.5 - a_position.y * 0.5);
  v_texCoord = u_cropUVMin + baseUV * (u_cropUVMax - u_cropUVMin);
}`;

const FRAG_MAIN = `#version 300 es
precision mediump float;
in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_texture;
uniform vec2 u_textureSize;
uniform float u_opacity;

// Color correction uniforms (all -100 to +100, 0 = no change)
uniform float u_brightness;
uniform float u_contrast;
uniform float u_saturation;
uniform float u_temperature;
uniform float u_tint;

// Per-channel HSL (8 channels: red, orange, yellow, green, cyan, blue, purple, magenta)
// Packed as (hue_shift_deg * 0.3, sat_shift / 100, lum_shift / 200)
uniform vec3 u_hslAdj[8];

// Channel centers (deg) and half-widths
const vec2 HSL_CFG[8] = vec2[8](
  vec2(0.0,   30.0),
  vec2(30.0,  25.0),
  vec2(60.0,  25.0),
  vec2(120.0, 45.0),
  vec2(180.0, 25.0),
  vec2(240.0, 40.0),
  vec2(280.0, 30.0),
  vec2(330.0, 30.0)
);

// Filter bit flags: 1=grayscale, 2=sepia, 4=invert, 8=blur, 16=sharpen, 32=hue-rotate-90
uniform int u_filterFlags;
// Filter-derived adjustments added on top of CC uniforms
uniform float u_filterBrightness;
uniform float u_filterContrast;
uniform float u_filterSaturate;

// ── HSL helpers ────────────────────────────────────────────────────────────
vec3 rgbToHsl(vec3 c) {
  float maxC = max(c.r, max(c.g, c.b));
  float minC = min(c.r, min(c.g, c.b));
  float l = (maxC + minC) * 0.5;
  if (maxC == minC) return vec3(0.0, 0.0, l);
  float d = maxC - minC;
  float s = l > 0.5 ? d / (2.0 - maxC - minC) : d / (maxC + minC);
  float h;
  if (maxC == c.r)      h = mod((c.g - c.b) / d + 6.0, 6.0) / 6.0;
  else if (maxC == c.g) h = ((c.b - c.r) / d + 2.0) / 6.0;
  else                  h = ((c.r - c.g) / d + 4.0) / 6.0;
  return vec3(h * 360.0, s, l);
}

float hue2rgb(float p, float q, float t) {
  if (t < 0.0) t += 1.0;
  if (t > 1.0) t -= 1.0;
  if (t < 1.0/6.0) return p + (q - p) * 6.0 * t;
  if (t < 0.5)     return q;
  if (t < 2.0/3.0) return p + (q - p) * (2.0/3.0 - t) * 6.0;
  return p;
}

vec3 hslToRgb(vec3 hsl) {
  float h = hsl.x / 360.0;
  float s = hsl.y;
  float l = hsl.z;
  if (s == 0.0) return vec3(l);
  float q = l < 0.5 ? l * (1.0 + s) : l + s - l * s;
  float p = 2.0 * l - q;
  return vec3(hue2rgb(p, q, h + 1.0/3.0),
              hue2rgb(p, q, h),
              hue2rgb(p, q, h - 1.0/3.0));
}

// ── Blur: 5x5 box approximation in source texture space ───────────────────
vec4 sampleBlur(vec2 uv, vec2 cropMin, vec2 cropMax) {
  vec2 step_ = 3.0 / u_textureSize;
  vec4 acc = vec4(0.0);
  for (int x = -2; x <= 2; x++) {
    for (int y = -2; y <= 2; y++) {
      vec2 s = clamp(uv + vec2(float(x), float(y)) * step_, cropMin, cropMax);
      acc += texture(u_texture, s);
    }
  }
  return acc / 25.0;
}

void main() {
  // Discard if UV is outside [0,1] (can happen at crop boundaries)
  if (v_texCoord.x < -0.001 || v_texCoord.x > 1.001 ||
      v_texCoord.y < -0.001 || v_texCoord.y > 1.001) {
    discard;
  }

  vec4 color;
  if ((u_filterFlags & 8) != 0) {
    // Blur: sample with box filter
    color = sampleBlur(v_texCoord, vec2(0.0), vec2(1.0));
  } else {
    color = texture(u_texture, clamp(v_texCoord, 0.0, 1.0));
  }

  vec3 rgb = color.rgb;

  // ── Sharpen ───────────────────────────────────────────────────────────────
  if ((u_filterFlags & 16) != 0) {
    vec2 step_ = 1.0 / u_textureSize;
    vec3 blurSample = (
      texture(u_texture, clamp(v_texCoord + vec2(-step_.x, 0.0), 0.0, 1.0)).rgb +
      texture(u_texture, clamp(v_texCoord + vec2( step_.x, 0.0), 0.0, 1.0)).rgb +
      texture(u_texture, clamp(v_texCoord + vec2(0.0, -step_.y), 0.0, 1.0)).rgb +
      texture(u_texture, clamp(v_texCoord + vec2(0.0,  step_.y), 0.0, 1.0)).rgb
    ) * 0.25;
    rgb = clamp(rgb + (rgb - blurSample) * 0.8, 0.0, 1.0);
  }

  // ── Brightness ────────────────────────────────────────────────────────────
  float totalBrightness = max(0.0, 1.0 + u_brightness / 100.0 + u_filterBrightness);
  if (totalBrightness != 1.0) rgb = clamp(rgb * totalBrightness, 0.0, 1.0);

  // ── Contrast ──────────────────────────────────────────────────────────────
  float totalContrast = max(0.0, 1.0 + u_contrast / 100.0 + u_filterContrast);
  if (totalContrast != 1.0) rgb = clamp((rgb - 0.5) * totalContrast + 0.5, 0.0, 1.0);

  // ── Saturation ────────────────────────────────────────────────────────────
  float totalSat = max(0.0, 1.0 + u_saturation / 100.0 + u_filterSaturate);
  if (totalSat != 1.0) {
    float lum = dot(rgb, vec3(0.299, 0.587, 0.114));
    rgb = clamp(mix(vec3(lum), rgb, totalSat), 0.0, 1.0);
  }

  // ── Temperature ───────────────────────────────────────────────────────────
  if (u_temperature != 0.0) {
    float t = u_temperature * (2.55 / 255.0);
    rgb.r = clamp(rgb.r + t, 0.0, 1.0);
    rgb.b = clamp(rgb.b - t, 0.0, 1.0);
  }

  // ── Tint ──────────────────────────────────────────────────────────────────
  if (u_tint != 0.0) {
    float ti = u_tint * (2.55 / 255.0);
    rgb.g = clamp(rgb.g - ti, 0.0, 1.0);
  }

  // ── Per-channel HSL ───────────────────────────────────────────────────────
  bool hasHsl = false;
  for (int i = 0; i < 8; i++) {
    if (u_hslAdj[i] != vec3(0.0)) { hasHsl = true; break; }
  }
  if (hasHsl) {
    vec3 hsl = rgbToHsl(rgb);
    float dH = 0.0, dS = 0.0, dL = 0.0;
    for (int i = 0; i < 8; i++) {
      vec3 adj = u_hslAdj[i];
      if (adj == vec3(0.0)) continue;
      float diff = abs(hsl.x - HSL_CFG[i].x);
      if (diff > 180.0) diff = 360.0 - diff;
      float wt = max(0.0, 1.0 - diff / HSL_CFG[i].y);
      dH += adj.x * wt;
      dS += adj.y * wt;
      dL += adj.z * wt;
    }
    hsl.x = mod(hsl.x + dH + 360.0, 360.0);
    hsl.y = clamp(hsl.y + dS, 0.0, 1.0);
    hsl.z = clamp(hsl.z + dL, 0.0, 1.0);
    rgb = hslToRgb(hsl);
  }

  // ── Post-process filters ──────────────────────────────────────────────────
  if ((u_filterFlags & 1) != 0) { // grayscale
    float g = dot(rgb, vec3(0.299, 0.587, 0.114));
    rgb = vec3(g);
  }
  if ((u_filterFlags & 2) != 0) { // sepia
    float r = dot(rgb, vec3(0.393, 0.769, 0.189));
    float g = dot(rgb, vec3(0.349, 0.686, 0.168));
    float b = dot(rgb, vec3(0.272, 0.534, 0.131));
    rgb = clamp(vec3(r, g, b), 0.0, 1.0);
  }
  if ((u_filterFlags & 4) != 0) { // invert
    rgb = 1.0 - rgb;
  }
  if ((u_filterFlags & 32) != 0) { // hue-rotate 90°
    vec3 hsl2 = rgbToHsl(rgb);
    hsl2.x = mod(hsl2.x + 90.0, 360.0);
    rgb = hslToRgb(hsl2);
  }

  // Output: premultiply alpha so FBO blending works correctly
  float alpha = color.a * u_opacity;
  fragColor = vec4(rgb * alpha, alpha);
}`;

// ── Full-screen quad vertex shader (for blend and blit passes) ─────────────
const VERT_FULLSCREEN = `#version 300 es
precision mediump float;
in vec2 a_position;
out vec2 v_texCoord;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  v_texCoord = a_position * 0.5 + 0.5;
}`;

// ── Blend modes: composites a layer texture onto the backdrop FBO ──────────
const FRAG_BLEND = `#version 300 es
precision mediump float;
in vec2 v_texCoord;
out vec4 fragColor;
uniform sampler2D u_backdrop;
uniform sampler2D u_layer;
// 0=normal(src-over), 1=multiply, 2=screen, 3=overlay, 4=darken, 5=lighten
uniform int u_blendMode;

vec3 blendMultiply(vec3 b, vec3 s) { return b * s; }
vec3 blendScreen(vec3 b, vec3 s)   { return b + s - b * s; }
vec3 blendOverlay(vec3 b, vec3 s) {
  return mix(2.0*b*s, 1.0 - 2.0*(1.0-b)*(1.0-s), step(0.5, b));
}
vec3 blendDarken(vec3 b, vec3 s)   { return min(b, s); }
vec3 blendLighten(vec3 b, vec3 s)  { return max(b, s); }

void main() {
  vec4 bd = texture(u_backdrop, v_texCoord);
  vec4 layer = texture(u_layer, v_texCoord);

  // Layer is premultiplied; un-premultiply for blend math
  float la = layer.a;
  vec3 lRGB = la > 0.001 ? layer.rgb / la : vec3(0.0);
  float ba = bd.a;
  vec3 bRGB = ba > 0.001 ? bd.rgb / ba : vec3(0.0);

  vec3 blended;
  if      (u_blendMode == 1) blended = blendMultiply(bRGB, lRGB);
  else if (u_blendMode == 2) blended = blendScreen(bRGB, lRGB);
  else if (u_blendMode == 3) blended = blendOverlay(bRGB, lRGB);
  else if (u_blendMode == 4) blended = blendDarken(bRGB, lRGB);
  else if (u_blendMode == 5) blended = blendLighten(bRGB, lRGB);
  else                       blended = lRGB; // normal: use layer as-is

  // Porter-Duff src-over with blended RGB
  float outA = la + ba * (1.0 - la);
  vec3 outRGB;
  if (outA > 0.001) {
    vec3 normalComp = (layer.rgb + bd.rgb * (1.0 - la)) / outA; // normal composite
    // For non-normal modes, mix between normal composite and blend formula
    if (u_blendMode == 0) {
      outRGB = normalComp;
    } else {
      // Apply blend formula only where layer has alpha; elsewhere use normal composite
      outRGB = mix(normalComp, (blended * la + bd.rgb * (1.0 - la)) / outA, la);
    }
  } else {
    outRGB = vec3(0.0);
  }

  fragColor = vec4(outRGB * outA, outA); // re-premultiply
}`;

// ── Simple blit: copy texture to screen, un-premultiply alpha ─────────────
const FRAG_BLIT = `#version 300 es
precision mediump float;
in vec2 v_texCoord;
out vec4 fragColor;
uniform sampler2D u_texture;
void main() {
  vec4 c = texture(u_texture, v_texCoord);
  // Un-premultiply for final display
  if (c.a > 0.001) fragColor = vec4(c.rgb / c.a, c.a);
  else             fragColor = vec4(0.0);
}`;

// ─── Types ─────────────────────────────────────────────────────────────────

export interface WebGLLayer {
  /** Unique key for texture caching. null = always re-upload (video). */
  cacheKey: string | null;
  source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement;
  opacity: number;
  position: { x: number; y: number };
  scale: { x: number; y: number };
  rotation: number;
  blendMode: string;
  filters: string[];
  colorCorrection: ColorCorrectionParams | null;
  crop: { top: number; right: number; bottom: number; left: number } | null;
  /**
   * When true, the source is drawn at its native pixel dimensions in project space
   * (e.g. pre-rendered text canvases) rather than scaled to contain the project frame.
   */
  nativeSize?: boolean;
}

// ─── WebGLCompositor ────────────────────────────────────────────────────────

export class WebGLCompositor {
  private gl: WebGL2RenderingContext;
  private canvas: HTMLCanvasElement;

  // Shader programs
  private mainProg!: WebGLProgram;
  private blendProg!: WebGLProgram;
  private blitProg!: WebGLProgram;

  // Geometry
  private quadVAO!: WebGLVertexArrayObject;
  private quadVBO!: WebGLBuffer;

  // Framebuffers for ping-pong compositing
  private fboA!: { fbo: WebGLFramebuffer; tex: WebGLTexture };
  private fboB!: { fbo: WebGLFramebuffer; tex: WebGLTexture };
  private fboLayer!: { fbo: WebGLFramebuffer; tex: WebGLTexture };

  // Texture cache for images (never for video)
  private texCache = new Map<string, WebGLTexture>();

  // Track FBO dimensions to resize when canvas changes
  private fboWidth = 0;
  private fboHeight = 0;

  static isSupported(canvas: HTMLCanvasElement): boolean {
    try {
      const gl = canvas.getContext('webgl2');
      if (!gl) return false;
      const ext = gl.getExtension('EXT_color_buffer_float'); // optional, not required
      void ext;
      return true;
    } catch {
      return false;
    }
  }

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', {
      premultipliedAlpha: true,
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
    });
    if (!gl) throw new Error('WebGL2 not available');
    this.gl = gl;

    this.initPrograms();
    this.initQuad();
    this.initFBOs();
  }

  // ── Initialization ────────────────────────────────────────────────────────

  private compileShader(type: number, src: string): WebGLShader {
    const gl = this.gl;
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(`Shader compile error: ${log}`);
    }
    return shader;
  }

  private linkProgram(vs: string, fs: string): WebGLProgram {
    const gl = this.gl;
    const prog = gl.createProgram()!;
    gl.attachShader(prog, this.compileShader(gl.VERTEX_SHADER, vs));
    gl.attachShader(prog, this.compileShader(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error(`Program link error: ${gl.getProgramInfoLog(prog)}`);
    }
    return prog;
  }

  private initPrograms(): void {
    this.mainProg  = this.linkProgram(VERT_MAIN, FRAG_MAIN);
    this.blendProg = this.linkProgram(VERT_FULLSCREEN, FRAG_BLEND);
    this.blitProg  = this.linkProgram(VERT_FULLSCREEN, FRAG_BLIT);
  }

  private initQuad(): void {
    const gl = this.gl;
    // Unit quad: 2 triangles covering [-1,1]
    const verts = new Float32Array([-1,-1, 1,-1, -1,1, 1,1]);
    this.quadVBO = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadVBO);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);

    this.quadVAO = gl.createVertexArray()!;
    gl.bindVertexArray(this.quadVAO);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  }

  private makeFBO(width: number, height: number): { fbo: WebGLFramebuffer; tex: WebGLTexture } {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return { fbo, tex };
  }

  private initFBOs(): void {
    const w = this.canvas.width  || 1;
    const h = this.canvas.height || 1;
    this.fboA     = this.makeFBO(w, h);
    this.fboB     = this.makeFBO(w, h);
    this.fboLayer = this.makeFBO(w, h);
    this.fboWidth  = w;
    this.fboHeight = h;
  }

  private resizeFBO(fbo: { fbo: WebGLFramebuffer; tex: WebGLTexture }, w: number, h: number): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, fbo.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  private ensureFBOSize(): void {
    const w = this.canvas.width;
    const h = this.canvas.height;
    if (w === this.fboWidth && h === this.fboHeight) return;
    this.resizeFBO(this.fboA, w, h);
    this.resizeFBO(this.fboB, w, h);
    this.resizeFBO(this.fboLayer, w, h);
    this.fboWidth  = w;
    this.fboHeight = h;
  }

  // ── Texture management ────────────────────────────────────────────────────

  private uploadTexture(
    source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
    existing?: WebGLTexture | null
  ): WebGLTexture {
    const gl = this.gl;
    const tex = existing ?? gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return tex;
  }

  private getTexture(layer: WebGLLayer): WebGLTexture | null {
    const src = layer.source;
    // Videos: check readyState before uploading
    if (src instanceof HTMLVideoElement) {
      if (src.readyState < 2) return null; // HAVE_CURRENT_DATA
      return this.uploadTexture(src, null);
    }
    // Images: check loaded
    if (src instanceof HTMLImageElement) {
      if (!src.complete || src.naturalWidth === 0) return null;
    }
    // Images and canvases: cache by key if provided
    if (layer.cacheKey) {
      let cached = this.texCache.get(layer.cacheKey);
      if (!cached) {
        cached = this.uploadTexture(src, null);
        this.texCache.set(layer.cacheKey, cached);
      } else if (src instanceof HTMLCanvasElement) {
        // Canvas textures may change each frame — always re-upload
        this.uploadTexture(src, cached);
      }
      return cached;
    }
    return this.uploadTexture(src, null);
  }

  invalidateCache(key: string): void {
    const gl = this.gl;
    const tex = this.texCache.get(key);
    if (tex) {
      gl.deleteTexture(tex);
      this.texCache.delete(key);
    }
  }

  // ── Transform matrix ──────────────────────────────────────────────────────

  /**
   * Build a column-major mat3 that transforms the unit quad [-1,1]²
   * into clip space NDC given clip properties.
   */
  private buildTransform(
    posX: number, posY: number,
    scaleX: number, scaleY: number,
    rotationDeg: number,
    drawW: number, drawH: number,
    projectW: number, projectH: number
  ): Float32Array {
    const sx = drawW / projectW;  // NDC half-width of the quad
    const sy = drawH / projectH;  // NDC half-height of the quad
    const cx = (2.0 * posX) / projectW;  // NDC center X
    const cy = -(2.0 * posY) / projectH; // NDC center Y (flip Y)

    const angle = (rotationDeg * Math.PI) / 180;
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);

    // col-major mat3: T * R * S
    return new Float32Array([
      sx * cosA,   sx * sinA, 0,
      -sy * sinA,  sy * cosA, 0,
      cx,          cy,        1,
    ]);
  }

  // ── Uniform helpers ───────────────────────────────────────────────────────

  private setUniforms(
    prog: WebGLProgram,
    layer: WebGLLayer,
    projectW: number,
    projectH: number,
    srcW: number,
    srcH: number
  ): void {
    const gl = this.gl;

    const cc = layer.colorCorrection;
    const filters = layer.filters;
    const crop = layer.crop;

    // Crop UV range
    const cropL = crop ? crop.left   / 100 : 0;
    const cropR = crop ? crop.right  / 100 : 0;
    const cropT = crop ? crop.top    / 100 : 0;
    const cropB = crop ? crop.bottom / 100 : 0;

    // Draw size (project coords): source contained within project, then user scale.
    // nativeSize=true means the source already is in project pixels (e.g. pre-rendered text).
    const scaleF   = layer.nativeSize ? 1.0 : Math.min(projectW / srcW, projectH / srcH);
    const cropW    = 1 - cropL - cropR;
    const cropH    = 1 - cropT - cropB;
    const drawW    = srcW * scaleF * layer.scale.x * cropW;
    const drawH    = srcH * scaleF * layer.scale.y * cropH;

    const transform = this.buildTransform(
      layer.position.x, layer.position.y,
      layer.scale.x, layer.scale.y,
      layer.rotation,
      drawW, drawH,
      projectW, projectH
    );

    gl.uniformMatrix3fv(gl.getUniformLocation(prog, 'u_transform'), false, transform);
    gl.uniform2f(gl.getUniformLocation(prog, 'u_cropUVMin'), cropL, cropT);
    gl.uniform2f(gl.getUniformLocation(prog, 'u_cropUVMax'), 1 - cropR, 1 - cropB);
    gl.uniform2f(gl.getUniformLocation(prog, 'u_textureSize'), srcW * cropW, srcH * cropH);
    gl.uniform1f(gl.getUniformLocation(prog, 'u_opacity'), layer.opacity);

    // Color correction
    gl.uniform1f(gl.getUniformLocation(prog, 'u_brightness'),  cc?.brightness  ?? 0);
    gl.uniform1f(gl.getUniformLocation(prog, 'u_contrast'),    cc?.contrast    ?? 0);
    gl.uniform1f(gl.getUniformLocation(prog, 'u_saturation'),  cc?.saturation  ?? 0);
    gl.uniform1f(gl.getUniformLocation(prog, 'u_temperature'), cc?.temperature ?? 0);
    gl.uniform1f(gl.getUniformLocation(prog, 'u_tint'),        cc?.tint        ?? 0);

    // Per-channel HSL (packed: hue*0.3, sat/100, lum/200)
    const HSL_KEYS = ['red','orange','yellow','green','cyan','blue','purple','magenta'] as const;
    const hslData = new Float32Array(8 * 3);
    if (cc?.hsl) {
      HSL_KEYS.forEach((key, i) => {
        const ch = cc.hsl[key];
        hslData[i*3 + 0] = ch.hue        * 0.3;
        hslData[i*3 + 1] = ch.saturation / 100;
        hslData[i*3 + 2] = ch.luminance  / 200;
      });
    }
    gl.uniform3fv(gl.getUniformLocation(prog, 'u_hslAdj'), hslData);

    // Filter flags and derived adjustments
    let flags = 0;
    let fb = 0, fc = 0, fs = 0; // filter brightness/contrast/saturate deltas
    for (const f of filters) {
      switch (f) {
        case 'grayscale':   flags |= 1; break;
        case 'sepia':       flags |= 2; break;
        case 'invert':      flags |= 4; break;
        case 'blur':        flags |= 8; break;
        case 'sharpen':     flags |= 16; fc += 0.1; fb += 0.05; break;
        case 'hue-rotate':  flags |= 32; break;
        case 'brightness':  fb += 0.3;  break;
        case 'contrast':    fc += 0.4;  break;
        case 'saturate':    fs += 0.5;  break;
      }
    }
    gl.uniform1i(gl.getUniformLocation(prog, 'u_filterFlags'),       flags);
    gl.uniform1f(gl.getUniformLocation(prog, 'u_filterBrightness'),  fb);
    gl.uniform1f(gl.getUniformLocation(prog, 'u_filterContrast'),    fc);
    gl.uniform1f(gl.getUniformLocation(prog, 'u_filterSaturate'),    fs);
  }

  // ── Core render ───────────────────────────────────────────────────────────

  private mapBlendMode(mode: string): number {
    const map: Record<string, number> = {
      normal: 0, multiply: 1, screen: 2, overlay: 3, darken: 4, lighten: 5,
    };
    return map[mode] ?? 0;
  }

  /**
   * Render a single frame given an ordered list of layers.
   *
   * @param projectW  Project canvas width (logical pixels)
   * @param projectH  Project canvas height (logical pixels)
   * @param backgroundColor  CSS color string for the background
   * @param layers    Ordered (bottom-to-top) list of layers to composite
   */
  renderFrame(
    projectW: number,
    projectH: number,
    backgroundColor: string,
    layers: WebGLLayer[]
  ): void {
    const gl = this.gl;
    const cw = this.canvas.width;
    const ch = this.canvas.height;

    this.ensureFBOSize();

    // Parse background color to float RGBA
    const bgRGBA = parseCSSColor(backgroundColor);

    // ── Bind attribute location 0 for all programs ─────────────────────────
    // (done at link time via bindAttribLocation before linking — here we ensure
    //  the VAO is bound for draws)
    gl.bindVertexArray(this.quadVAO);

    // ── Clear accumulation FBO A to background color ───────────────────────
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboA.fbo);
    gl.viewport(0, 0, cw, ch);
    gl.clearColor(bgRGBA[0], bgRGBA[1], bgRGBA[2], bgRGBA[3]);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // Ping-pong: accum = fboA, scratch = fboB
    let accum = this.fboA;
    let scratch = this.fboB;

    // ── Composite each layer ───────────────────────────────────────────────
    for (const layer of layers) {
      const tex = this.getTexture(layer);
      if (!tex) continue;

      const src = layer.source;
      const srcW = (src instanceof HTMLVideoElement ? src.videoWidth  : (src as HTMLImageElement | HTMLCanvasElement).width)  || projectW;
      const srcH = (src instanceof HTMLVideoElement ? src.videoHeight : (src as HTMLImageElement | HTMLCanvasElement).height) || projectH;

      // ── Pass 1: Render layer with transforms to fboLayer ────────────────
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboLayer.fbo);
      gl.viewport(0, 0, cw, ch);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.disable(gl.BLEND);

      gl.useProgram(this.mainProg);
      // Bind source texture to unit 0
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(gl.getUniformLocation(this.mainProg, 'u_texture'), 0);

      this.setUniforms(this.mainProg, layer, projectW, projectH, srcW, srcH);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      // ── Pass 2: Blend fboLayer onto accum → scratch ─────────────────────
      gl.bindFramebuffer(gl.FRAMEBUFFER, scratch.fbo);
      gl.viewport(0, 0, cw, ch);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.disable(gl.BLEND);

      gl.useProgram(this.blendProg);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, accum.tex);
      gl.uniform1i(gl.getUniformLocation(this.blendProg, 'u_backdrop'), 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.fboLayer.tex);
      gl.uniform1i(gl.getUniformLocation(this.blendProg, 'u_layer'), 1);
      gl.uniform1i(gl.getUniformLocation(this.blendProg, 'u_blendMode'), this.mapBlendMode(layer.blendMode));
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      // Swap accum and scratch
      const tmp = accum;
      accum = scratch;
      scratch = tmp;
    }

    // ── Blit accumulated result to screen ──────────────────────────────────
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, cw, ch);
    gl.clearColor(bgRGBA[0], bgRGBA[1], bgRGBA[2], bgRGBA[3]);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(this.blitProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, accum.tex);
    gl.uniform1i(gl.getUniformLocation(this.blitProg, 'u_texture'), 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    gl.bindVertexArray(null);
  }

  /**
   * Clear the canvas to a solid color (used when no clips are active).
   */
  clear(backgroundColor: string): void {
    const gl = this.gl;
    const rgba = parseCSSColor(backgroundColor);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(rgba[0], rgba[1], rgba[2], rgba[3]);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  destroy(): void {
    const gl = this.gl;
    for (const tex of this.texCache.values()) gl.deleteTexture(tex);
    this.texCache.clear();
    gl.deleteFramebuffer(this.fboA.fbo);
    gl.deleteTexture(this.fboA.tex);
    gl.deleteFramebuffer(this.fboB.fbo);
    gl.deleteTexture(this.fboB.tex);
    gl.deleteFramebuffer(this.fboLayer.fbo);
    gl.deleteTexture(this.fboLayer.tex);
    gl.deleteBuffer(this.quadVBO);
    gl.deleteVertexArray(this.quadVAO);
    gl.deleteProgram(this.mainProg);
    gl.deleteProgram(this.blendProg);
    gl.deleteProgram(this.blitProg);
  }
}

// ─── CSS Color Parser ───────────────────────────────────────────────────────

function parseCSSColor(color: string): [number, number, number, number] {
  // Handle #RRGGBB and #RGB
  if (color.startsWith('#')) {
    const hex = color.slice(1);
    if (hex.length === 3) {
      const r = parseInt(hex[0] + hex[0], 16) / 255;
      const g = parseInt(hex[1] + hex[1], 16) / 255;
      const b = parseInt(hex[2] + hex[2], 16) / 255;
      return [r, g, b, 1];
    }
    const r = parseInt(hex.slice(0, 2), 16) / 255;
    const g = parseInt(hex.slice(2, 4), 16) / 255;
    const b = parseInt(hex.slice(4, 6), 16) / 255;
    return [r, g, b, 1];
  }
  // Fallback: use a temporary canvas (accurate but only on first call)
  try {
    const tmp = document.createElement('canvas');
    tmp.width = tmp.height = 1;
    const ctx = tmp.getContext('2d')!;
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return [d[0]/255, d[1]/255, d[2]/255, d[3]/255];
  } catch {
    return [0, 0, 0, 1];
  }
}
