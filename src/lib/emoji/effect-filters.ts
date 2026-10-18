import { Filter, GlProgram } from "pixi.js";
import { filterVertex } from "./wave-filter";

const common = `
precision highp float;
in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform highp vec4 uInputSize;
uniform vec4 uInputClamp;
uniform float uStrength;
vec4 sampleAt(vec2 uv) {
  if (uv.x < uInputClamp.x || uv.y < uInputClamp.y ||
      uv.x > uInputClamp.z || uv.y > uInputClamp.w) return vec4(0.0);
  return texture(uTexture, uv);
}
`;

const fragments = {
  shadow: `
uniform vec3 uShadowColor;
uniform float uAngle;
uniform float uBlur;
void main() {
  vec4 center = sampleAt(vTextureCoord);
  vec2 origin = vTextureCoord - vec2(cos(uAngle), sin(uAngle)) * uStrength * uInputSize.zw;
  float alpha = 0.0;
  if (uBlur == 0.0) {
    alpha = sampleAt(origin).a;
  } else {
    float weightSum = 0.0;
    for (int y = -4; y <= 4; y++) {
      for (int x = -4; x <= 4; x++) {
        vec2 offset = vec2(float(x), float(y)) / 4.0;
        float weight = exp(-dot(offset, offset) * 2.0);
        alpha += sampleAt(origin + offset * uBlur * uInputSize.zw).a * weight;
        weightSum += weight;
      }
    }
    alpha /= weightSum;
  }
  alpha *= 0.65 * (1.0 - center.a);
  // Composite a premultiplied shadow behind the actual alpha silhouette.
  finalColor = center + vec4(uShadowColor * alpha, alpha);
}`,
  glow: `
uniform vec3 uGlowColor;
void main() {
  vec4 center = sampleAt(vTextureCoord);
  float halo = 0.0;
  for (int ring = 1; ring <= 3; ring++) {
    float radius = uStrength * float(ring) / 3.0;
    for (int i = 0; i < 12; i++) {
      float angle = float(i) * 6.2831853 / 12.0;
      vec2 offset = vec2(cos(angle), sin(angle)) * radius * uInputSize.zw;
      halo += sampleAt(vTextureCoord + offset).a;
    }
  }
  halo = min(1.0, halo / 12.0) * (1.0 - center.a);
  if (uStrength == 0.0) halo = 0.0;
  // Pixi textures use premultiplied alpha, including the transparent halo.
  finalColor = center + vec4(uGlowColor * halo, halo);
}`,
  pixel: `
void main() {
  if (uStrength == 0.0) { finalColor = sampleAt(vTextureCoord); return; }
  float size = 4.0 + uStrength * 2.0;
  vec2 pixel = vTextureCoord * uInputSize.xy;
  vec2 snapped = (floor(pixel / size) + 0.5) * size;
  finalColor = sampleAt(snapped * uInputSize.zw);
}`,
  rgb: `
uniform float uAngle;
void main() {
  vec2 offset = vec2(cos(uAngle), sin(uAngle)) * uStrength * uInputSize.zw;
  vec4 red = sampleAt(vTextureCoord - offset);
  vec4 green = sampleAt(vTextureCoord);
  vec4 blue = sampleAt(vTextureCoord + offset);
  finalColor = vec4(red.r, green.g, blue.b, max(red.a, max(green.a, blue.a)));
}`,
} as const;

export function createEffectFilter(effect: keyof typeof fragments) {
  return new Filter({
    glProgram: GlProgram.from({
      vertex: filterVertex, fragment: (common + fragments[effect]).trim(),
      name: `emoji-${effect}`, preferredFragmentPrecision: "highp",
    }),
    padding: effect === "shadow" ? 64 : 32,
    resources: { effectUniforms: {
      uStrength: { value: 8, type: "f32" },
      ...(effect === "shadow" ? { uAngle: { value: Math.PI / 4, type: "f32" }, uBlur: { value: 6, type: "f32" }, uShadowColor: { value: new Float32Array([0.07, 0.07, 0.09]), type: "vec3<f32>" } } : {}),
      ...(effect === "rgb" ? { uAngle: { value: 0, type: "f32" } } : {}),
      ...(effect === "glow" ? { uGlowColor: { value: new Float32Array([1, 0.78, 0.25]), type: "vec3<f32>" } } : {}),
    } },
  });
}
