/**
 * The entity's WebGL2 body: one full-screen triangle and a fragment shader
 * that raymarches a volumetric energy core.
 *
 * Inside the core: domain-warped 3D noise read from a small tileable noise
 * texture (one fetch gives four independent channels, far cheaper than
 * analytic simplex noise), sharpened into ridged filaments around a white-hot
 * centre. Around it: a fresnel membrane with a crisp, slightly chromatic
 * edge, a soft glow, and a 3D orbital ring that passes in front of and
 * behind the core. On top of that, the state layers: typing ripples, voice
 * waves, tool pulses, the system's amber scanning band, and shockwaves.
 *
 * Output is premultiplied alpha. On a dark ground the core is emissive light;
 * on a light ground it becomes ink (hue kept, value darkened) so it never
 * blows out to white.
 */

const VERT = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
precision highp sampler3D;

uniform sampler3D uNoise;
uniform vec2 uRes;
uniform vec4 uA; // time, flowPhase, cometPhase, scanPhase
uniform vec4 uB; // energy, filaments, typing, speak
uniform vec4 uC; // scan, ring, pulse (0..1, >=1 idle), dim
uniform vec4 uD; // shockProgress, shockAmp, wait, light
uniform vec4 uE; // speakPhase, coreRadius, steps, ripplePhase
uniform vec4 uF; // breathe (-1..1), warm, turbulence, detail
uniform vec4 uG; // orbital radius (core units, 0 = none), tool, listening, spare
uniform mat3 uRot;
uniform vec3 uBody;
uniform vec3 uSys;
uniform vec3 uWarn;
uniform vec3 uShock;
out vec4 outColor;

const float TAU = 6.28318530718;

vec4 nz(vec3 p) { return texture(uNoise, p * 0.125) * 2.0 - 1.0; }

float gauss(float x) { return exp(-x * x); }

// The system's scanning slice: a plane tilted toward the viewer.
const vec3 SCAN_N = vec3(0.26, 0.87, 0.42);

void main() {
  float m = min(uRes.x, uRes.y);
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / m;
  float t = uA.x;
  float flow = uA.y;
  float energy = uB.x;
  float fil = uB.y;
  float typing = uB.z;
  float speak = uB.w;
  float scan = uC.x;
  float ring = uC.y;
  float pulse = uC.z;
  float dim = uC.w;
  float shockP = uD.x;
  float shockA = uD.y;
  float wait = uD.z;
  float light = uD.w;
  float speakPh = uE.x;
  int steps = int(uE.z);
  float ripplePh = uE.w;
  float breathe = uF.x;
  float warm = uF.y;
  float turb = uF.z;
  float detail = uF.w;
  float orbital = uG.x;

  float R = uE.y * (1.0 + 0.016 * breathe + 0.05 * speak);
  vec2 p2 = uv / R;
  float d = length(p2);
  float px = 1.0 / (R * m);
  // Interleaved gradient noise: ray-start jitter and dither without visible grain.
  float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));

  vec3 body = mix(uBody, uWarn, wait);
  vec3 hot = mix(body, vec3(1.0), 0.8 * (1.0 - light));
  // The shock tints the membrane and the glow, not the filaments (no muddy hue mixes inside).
  float shockK = shockA * (1.0 - shockP);
  vec3 skin = mix(body, uShock, clamp(shockK * 0.9, 0.0, 1.0));

  float ang = atan(p2.y, p2.x);
  float wob = typing * 0.02 * sin(ang * 7.0 + t * 5.0)
            + speak * 0.016 * sin(ang * 5.0 - speakPh * 0.6)
            + 0.005 * sin(ang * 3.0 + t * 0.6);
  float dd = d / (1.0 + wob);

  vec3 col = vec3(0.0);
  float rimInk = 0.0;
  // Interior: the ray crosses concentric glass shells (front and back). On each
  // shell, filaments are the zero-contours of warped noise, antialiased with
  // fwidth — crisp threads at true parallax depth, softer the deeper they sit.
  vec2 q2 = p2 / (1.0 + wob);
  float inside = 1.0 - smoothstep(1.0 - 1.5 * px, 1.0, dd);
  float h = sqrt(max(0.0, 1.0 - dd * dd));
  float sp = sin(uA.w) * 0.95;
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    float on = step(fi + 0.5, float(steps));
    float s = 0.3 + 0.62 * fi / max(float(steps) - 1.0, 1.0);
    float zf = sqrt(max(s * s - dd * dd, 0.0));
    float edgeFade = smoothstep(0.08, 0.45, zf / s);
    float voice = 1.0 + speak * 2.2 * pow(0.5 + 0.5 * sin(s * 11.0 - speakPh), 4.0);
    float pul = pulse < 1.0 ? gauss((s - pulse * 1.05) * 5.0) * (1.0 - pulse) * 2.5 : 0.0;
    for (int side = 0; side < 2; side++) {
      float front = 1.0 - float(side);
      vec3 P = vec3(q2, mix(-zf, zf, front));
      vec3 w = (uRot * P) * detail + vec3(fi * 3.7, fi * 1.3, -fi * 2.1);
      vec4 n0 = nz(w * 0.5 + vec3(0.0, flow * 0.22, flow * 0.13));
      w += n0.xyz * turb * 0.7;
      // Stretched along the spin axis: contours become flowing currents, not loops.
      vec4 n1 = nz(w * vec3(1.25, 0.6, 1.25) + vec3(flow * 0.17, -flow * 0.09, flow * 0.05));
      float fwr = fwidth(n1.x);
      float fw = min(fwr, 0.12) + 1e-4;
      // Where the noise changes faster than a pixel can hold (shell silhouettes) the line is noise: fade it.
      float crisp = 1.0 - smoothstep(0.04, 0.14, fwr);
      float blur = mix(2.6, 1.0, front) * (1.0 + 0.4 * (1.0 - s));
      float line = gauss(n1.x / (fw * blur)) + 0.18 * gauss(n1.x / (fw * blur * 5.0));
      float seg = smoothstep(-0.1, 0.5, n1.y);
      float depth = mix(0.35, 1.0, front) * (0.55 + 0.45 * s);
      float I = line * seg * depth * edgeFade * on * fil * voice * crisp * 1.25;
      // Some currents belong to the system: amber replaces cyan there (never mixed into grey).
      float aw = warm * smoothstep(0.1, 0.6, n0.w);
      vec3 c = mix(mix(body, hot, 0.12 + 0.55 * (1.0 - s) * (1.0 - s)), mix(uSys, vec3(1.0), 0.25 * (1.0 - light)), aw) * I;
      c += mix(body, hot, 0.5) * pul * line * seg * on * edgeFade * crisp * 0.55;
      if (scan > 0.001) {
        float pd = dot(P, SCAN_N) - sp;
        float sweep = gauss(pd / (fwidth(pd) * 1.4 + 1e-4));
        c += uSys * scan * on * edgeFade * (sweep * 0.6 * depth * s * s * s + I * gauss(pd * 7.0) * 1.6);
      }
      // Soft nebula tint on the shell: colour variation, never milk.
      c += body * (0.5 + 0.5 * n0.w) * 0.02 * on * edgeFade * depth;
      acc += c;
    }
  }
  col += acc * energy * 0.75 * inside;
  // The nucleus: a white-hot point with a slow shimmer, and its bloom.
  vec4 nc = nz(vec3(t * 0.13, flow * 0.2, 0.5));
  float nucleus = exp(-dd * dd * 200.0) * 0.9 + exp(-dd * dd * 40.0) * (0.9 + 0.25 * nc.x) + exp(-dd * dd * 7.0) * 0.16;
  col += hot * nucleus * energy * (1.0 + speak * 0.6) * inside;
  if (dd < 1.0) {
    // Membrane: fresnel rim lit from the upper left (reads as volume), listening glow toward the viewer, a glassy highlight.
    float lit = 0.55 + 0.45 * dot(normalize(q2 + 1e-4), normalize(vec2(-0.6, 0.8)));
    float fres = pow(1.0 - h, 4.0);
    col += skin * fres * (0.3 + 0.25 * energy) * (0.35 + 1.0 * lit);
    rimInk = fres;
    float listen = typing + uG.z * 0.25;
    col += body * listen * (pow(h, 3.0) * 0.18 + pow(0.5 + 0.5 * sin(dd * 24.0 - ripplePh), 8.0) * 0.5 * h * typing);
    vec3 n = vec3(q2, h);
    float spec = pow(max(dot(n, normalize(vec3(-0.5, 0.62, 0.6))), 0.0), 40.0);
    col += mix(body, vec3(1.0), 0.7) * spec * 0.16 * (1.0 - light);
  }
  // Crisp, slightly chromatic edge.
  float ew = 1.5 * px;
  float eG = gauss((1.0 - dd) / ew);
  float eR = gauss((1.0 - dd * 0.994) / ew);
  float eB = gauss((1.0 - dd * 1.006) / ew);
  vec3 edgeCol = mix(skin, vec3(1.0), 0.25 * (1.0 - light));
  float edgeLit = 0.55 + 0.45 * dot(normalize(p2 + 1e-4), normalize(vec2(-0.6, 0.8)));
  col += vec3(eR * edgeCol.r * 0.7, eG * edgeCol.g, eB * (edgeCol.b + 0.08)) * (0.3 + 0.2 * energy) * (0.5 + 0.8 * edgeLit);
  rimInk += eG;

  // Glow: a tight halo hugging the edge and a broad soft falloff.
  float gd = max(dd - 1.0, 0.0);
  float glow = exp(-abs(dd - 1.0) * 16.0) * 0.26 + exp(-gd * 4.2) * 0.2 * smoothstep(0.55, 1.0, dd);
  col += skin * glow * energy;

  // Voice: rings radiating out of the membrane.
  if (speak > 0.001) {
    float sw = pow(0.5 + 0.5 * sin(dd * 9.0 - speakPh), 10.0) * exp(-gd * 2.4) * step(1.0, dd);
    col += body * sw * speak * 0.55;
  }
  // Tool pulse: a ring leaves the membrane.
  if (pulse < 1.0) {
    float pr = 1.0 + pulse * 0.8;
    float pw = 0.008 + 0.03 * pulse;
    col += uSys * gauss((d - pr) / pw) * (1.0 - pulse) * (1.0 - pulse) * 0.7;
  }
  // Shockwave (alert: danger, done: ok).
  if (shockA > 0.001) {
    float e3 = 1.0 - pow(1.0 - shockP, 3.0);
    float sr = 1.0 + e3 * 1.45;
    float sw2 = 0.01 + 0.035 * shockP;
    float fade = shockA * pow(1.0 - shockP, 1.5);
    col += uShock * (gauss((d - sr) / sw2) * 1.1 + gauss((d - sr) / (sw2 * 4.0)) * 0.18) * fade;
    col += uShock * shockK * exp(-d * d * 1.4) * 0.35;
  }

  // 3D orbital ring, tilted toward the viewer; the far side hides behind the core.
  if (orbital > 0.0 && ring > 0.001) {
    const vec3 N = vec3(0.18979, 0.93626, 0.2955);
    const vec3 E1 = vec3(0.98007, -0.19867, 0.0);
    const vec3 E2 = vec3(-0.058707, -0.28961, 0.9553);
    float z = -(N.x * p2.x + N.y * p2.y) / N.z;
    vec3 P = vec3(p2, z);
    float rr = length(P);
    float fw = max(fwidth(rr), 1e-4);
    float line = gauss((rr - orbital) / (fw * 1.1));
    float halo = gauss((rr - orbital) / (fw * 5.0));
    float occl = (d < 1.0 && z < 0.0) ? 0.1 : 1.0;
    float depth = 0.4 + 0.6 * clamp(0.5 + 0.5 * z / orbital, 0.0, 1.0);
    float th = atan(dot(P, E2), dot(P, E1));
    float dl = mod(uA.z - th, TAU);
    float dl2 = mod(uA.z + 3.14159265 - th, TAU);
    float trail = exp(-dl * 2.0) + 0.5 * exp(-dl2 * 2.6) * warm;
    float head = exp(-dl * 22.0) + 0.5 * exp(-dl2 * 22.0) * warm;
    vec3 cc = mix(body, uSys, warm);
    col += (body * line * 0.28 + cc * (line * trail * 0.95 + halo * head * 0.9)) * ring * depth * occl;
  }

  col *= dim;
  // Everything fades out before the canvas edge: no visible box on any ground.
  vec2 edge = min(gl_FragCoord.xy, uRes - gl_FragCoord.xy) / m;
  col *= (1.0 - smoothstep(0.36, 0.5, length(uv))) * smoothstep(0.0, 0.06, min(edge.x, edge.y));
  float a;
  if (light < 0.5) {
    col = 1.0 - exp(-col * 1.25);
    col += (jitter - 0.5) / 255.0;
    col = max(col, vec3(0.0));
    a = clamp(max(max(col.r, col.g), col.b), 0.0, 1.0);
    outColor = vec4(min(col, vec3(a)), a);
  } else {
    float mx = max(max(col.r, col.g), col.b);
    vec3 hue = col / max(mx, 1e-4);
    a = clamp(1.0 - exp(-mx * 1.35), 0.0, 0.94);
    vec3 ink = mix(hue * 0.62, skin * 0.55, clamp(rimInk * 0.8, 0.0, 1.0));
    a = clamp(a + (jitter - 0.5) / 255.0, 0.0, 1.0);
    outColor = vec4(ink * a, a);
  }
}`;

/** Per-frame values the shader reads. Mutated in place by the engine. */
export interface EntityFrame {
  time: number;
  flowPhase: number;
  cometPhase: number;
  scanPhase: number;
  energy: number;
  filaments: number;
  typing: number;
  speak: number;
  scan: number;
  ring: number;
  pulse: number;
  dim: number;
  shockProgress: number;
  shockAmp: number;
  wait: number;
  light: number;
  speakPhase: number;
  coreRadius: number;
  steps: number;
  ripplePhase: number;
  breathe: number;
  warm: number;
  turbulence: number;
  detail: number;
  orbital: number;
  tool: number;
  listening: number;
  /** Column-major 3×3 rotation of the inner field. */
  rot: Float32Array;
  body: Float32Array;
  sys: Float32Array;
  warn: Float32Array;
  shock: Float32Array;
}

export function newFrame(): EntityFrame {
  const rot = new Float32Array(9);
  rot[0] = rot[4] = rot[8] = 1;
  return {
    time: 0,
    flowPhase: 0,
    cometPhase: 0,
    scanPhase: 0,
    energy: 1,
    filaments: 0.6,
    typing: 0,
    speak: 0,
    scan: 0,
    ring: 0.3,
    pulse: 1,
    dim: 1,
    shockProgress: 1,
    shockAmp: 0,
    wait: 0,
    light: 0,
    speakPhase: 0,
    coreRadius: 0.2,
    steps: 24,
    ripplePhase: 0,
    breathe: 0,
    warm: 0,
    turbulence: 0.6,
    detail: 1.6,
    orbital: 1.42,
    tool: 0,
    listening: 0,
    rot,
    body: new Float32Array([0.13, 0.83, 0.93]),
    sys: new Float32Array([0.98, 0.45, 0.09]),
    warn: new Float32Array([0.98, 0.75, 0.14]),
    shock: new Float32Array([0.29, 0.87, 0.5]),
  };
}

/* ---- Noise texture (generated once per page, shared by every context) ---- */

const NOISE_SIZE = 64;
const NOISE_PERIOD = 8;
let noiseCache: Uint8Array | null = null;

/** Tileable 3D gradient noise, four independent channels, RGBA8. */
export function noiseTexels(size: number = NOISE_SIZE, period: number = NOISE_PERIOD): Uint8Array {
  if (size === NOISE_SIZE && period === NOISE_PERIOD && noiseCache) return noiseCache;
  const out = new Uint8Array(size * size * size * 4);
  const cells = period * period * period;
  let seed = 0x9e3779b9;
  const rand = () => {
    seed = (Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0;
    return seed / 4294967296;
  };
  const scale = period / size;
  const fade = (x: number) => x * x * x * (x * (x * 6 - 15) + 10);
  for (let ch = 0; ch < 4; ch++) {
    const g = new Float32Array(cells * 3);
    for (let i = 0; i < cells; i++) {
      // Uniform direction on the sphere.
      const zz = rand() * 2 - 1;
      const a = rand() * Math.PI * 2;
      const rr = Math.sqrt(1 - zz * zz);
      g[i * 3] = Math.cos(a) * rr;
      g[i * 3 + 1] = Math.sin(a) * rr;
      g[i * 3 + 2] = zz;
    }
    for (let z = 0; z < size; z++) {
      const fz = z * scale;
      const cz = Math.floor(fz);
      const tz = fz - cz;
      const wz = fade(tz);
      for (let y = 0; y < size; y++) {
        const fy = y * scale;
        const cy = Math.floor(fy);
        const ty = fy - cy;
        const wy = fade(ty);
        for (let x = 0; x < size; x++) {
          const fx = x * scale;
          const cx = Math.floor(fx);
          const tx = fx - cx;
          const wx = fade(tx);
          let acc = 0;
          for (let k = 0; k < 8; k++) {
            const ox = k & 1;
            const oy = (k >> 1) & 1;
            const oz = (k >> 2) & 1;
            const gi =
              ((((cx + ox) % period) + period * (((cy + oy) % period) + period * ((cz + oz) % period))) * 3) |
              0;
            const dot = g[gi]! * (tx - ox) + g[gi + 1]! * (ty - oy) + g[gi + 2]! * (tz - oz);
            const w = (ox ? wx : 1 - wx) * (oy ? wy : 1 - wy) * (oz ? wz : 1 - wz);
            acc += dot * w;
          }
          const v = Math.max(-1, Math.min(1, acc * 1.35));
          out[((z * size + y) * size + x) * 4 + ch] = Math.round((v * 0.5 + 0.5) * 255);
        }
      }
    }
  }
  if (size === NOISE_SIZE && period === NOISE_PERIOD) noiseCache = out;
  return out;
}

/* ---- Renderer ------------------------------------------------------------ */

type UniformName =
  "uRes" | "uA" | "uB" | "uC" | "uD" | "uE" | "uF" | "uG" | "uRot" | "uBody" | "uSys" | "uWarn" | "uShock";
const UNIFORMS: readonly UniformName[] = [
  "uRes",
  "uA",
  "uB",
  "uC",
  "uD",
  "uE",
  "uF",
  "uG",
  "uRot",
  "uBody",
  "uSys",
  "uWarn",
  "uShock",
];

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader | null {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS) && !gl.isContextLost()) {
    console.warn("[entity] shader:", gl.getShaderInfoLog(sh));
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

export class EntityGl {
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly texture: WebGLTexture;
  private readonly vao: WebGLVertexArrayObject;
  private readonly loc: Record<UniformName, WebGLUniformLocation | null>;
  private width = 0;
  private height = 0;

  private constructor(
    gl: WebGL2RenderingContext,
    program: WebGLProgram,
    texture: WebGLTexture,
    vao: WebGLVertexArrayObject,
  ) {
    this.gl = gl;
    this.program = program;
    this.texture = texture;
    this.vao = vao;
    const loc = {} as Record<UniformName, WebGLUniformLocation | null>;
    for (const name of UNIFORMS) loc[name] = gl.getUniformLocation(program, name);
    this.loc = loc;
    gl.useProgram(program);
    gl.uniform1i(gl.getUniformLocation(program, "uNoise"), 0);
  }

  /** Creates the renderer, or null if WebGL2 (or the shader) is unavailable. */
  static create(canvas: HTMLCanvasElement): EntityGl | null {
    let gl: WebGL2RenderingContext | null = null;
    try {
      gl = canvas.getContext("webgl2", {
        alpha: true,
        premultipliedAlpha: true,
        antialias: false,
        depth: false,
        stencil: false,
        preserveDrawingBuffer: false,
        powerPreference: "low-power",
      });
    } catch {
      gl = null;
    }
    if (!gl) return null;
    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) {
      loseContext(gl);
      return null;
    }
    const program = gl.createProgram();
    if (!program) {
      loseContext(gl);
      return null;
    }
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.warn("[entity] link:", gl.getProgramInfoLog(program));
      loseContext(gl);
      return null;
    }
    const texture = gl.createTexture();
    const vao = gl.createVertexArray();
    if (!texture || !vao) {
      loseContext(gl);
      return null;
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_3D, texture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage3D(
      gl.TEXTURE_3D,
      0,
      gl.RGBA8,
      NOISE_SIZE,
      NOISE_SIZE,
      NOISE_SIZE,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      noiseTexels(),
    );
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.REPEAT);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    return new EntityGl(gl, program, texture, vao);
  }

  get context(): WebGL2RenderingContext {
    return this.gl;
  }

  get lost(): boolean {
    return this.gl.isContextLost();
  }

  /** Sets the drawing buffer size in device pixels. */
  setSize(width: number, height: number): void {
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    const canvas = this.gl.canvas as HTMLCanvasElement;
    canvas.width = w;
    canvas.height = h;
  }

  draw(f: EntityFrame): void {
    const gl = this.gl;
    if (gl.isContextLost()) return;
    const l = this.loc;
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_3D, this.texture);
    gl.uniform2f(l.uRes, this.width, this.height);
    gl.uniform4f(l.uA, f.time, f.flowPhase, f.cometPhase, f.scanPhase);
    gl.uniform4f(l.uB, f.energy, f.filaments, f.typing, f.speak);
    gl.uniform4f(l.uC, f.scan, f.ring, f.pulse, f.dim);
    gl.uniform4f(l.uD, f.shockProgress, f.shockAmp, f.wait, f.light);
    gl.uniform4f(l.uE, f.speakPhase, f.coreRadius, f.steps, f.ripplePhase);
    gl.uniform4f(l.uF, f.breathe, f.warm, f.turbulence, f.detail);
    gl.uniform4f(l.uG, f.orbital, f.tool, f.listening, 0);
    gl.uniformMatrix3fv(l.uRot, false, f.rot);
    gl.uniform3fv(l.uBody, f.body);
    gl.uniform3fv(l.uSys, f.sys);
    gl.uniform3fv(l.uWarn, f.warn);
    gl.uniform3fv(l.uShock, f.shock);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** Blocks until the GPU is done (benchmarks only). */
  finish(): void {
    const px = new Uint8Array(4);
    this.gl.readPixels(0, 0, 1, 1, this.gl.RGBA, this.gl.UNSIGNED_BYTE, px);
  }

  dispose(): void {
    const gl = this.gl;
    if (!gl.isContextLost()) {
      gl.deleteTexture(this.texture);
      gl.deleteVertexArray(this.vao);
      gl.deleteProgram(this.program);
    }
    loseContext(gl);
  }
}

function loseContext(gl: WebGL2RenderingContext): void {
  try {
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    // already lost
  }
}
