import { Filter, GlProgram } from "pixi.js";

// Pixi's filter frame can be larger than the artwork. Work in stage pixels so
// changing an element's bounds doesn't change the wavelength.
export const filterVertex = `
precision highp float;
in vec2 aPosition;
out vec2 vTextureCoord;
uniform highp vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;
void main() {
  vec2 p = aPosition * uOutputFrame.zw + uOutputFrame.xy;
  p.x = p.x * (2.0 / uOutputTexture.x) - 1.0;
  p.y = p.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
  gl_Position = vec4(p, 0.0, 1.0);
  vTextureCoord = aPosition * (uOutputFrame.zw * uInputSize.zw);
}`.trim();
const fragment = `
precision highp float;
in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform highp vec4 uInputSize;
uniform vec4 uInputClamp;
uniform float uStrength;
uniform float uPhase;
uniform float uAngle;
void main() {
  vec2 uv = vTextureCoord;
  vec2 direction = vec2(cos(uAngle), sin(uAngle));
  vec2 perpendicular = vec2(-direction.y, direction.x);
  float distance = dot(uv * uInputSize.xy, perpendicular);
  uv += direction * sin(distance * 0.045 + uPhase) * uStrength * uInputSize.zw;
  if (uv.x < uInputClamp.x || uv.y < uInputClamp.y ||
      uv.x > uInputClamp.z || uv.y > uInputClamp.w) {
    finalColor = vec4(0.0);
  } else {
    finalColor = texture(uTexture, uv);
  }
}`.trim();
export function createWaveFilter() {
  return new Filter({
    glProgram: GlProgram.from({ vertex: filterVertex, fragment, name: "emoji-wave", preferredFragmentPrecision: "highp" }),
    padding: 32,
    resources: {
      waveUniforms: {
        uStrength: { value: 8, type: "f32" },
        uPhase: { value: 0, type: "f32" },
        uAngle: { value: 0, type: "f32" },
      },
    },
  });
}
