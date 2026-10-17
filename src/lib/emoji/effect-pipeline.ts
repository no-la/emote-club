import type { Filter } from "pixi.js";
import { createEffectFilter } from "./effect-filters";
import { createWaveFilter } from "./wave-filter";
import type { EffectId, EffectStack } from "./model";

// Each owner needs its own uniforms. Programs may be cached by Pixi, filters must not be shared.
export function createEffectPipeline() {
  const filters = new Map<EffectId, Filter>();
  return {
    update(stack: EffectStack) {
      return stack.effects.filter(id => stack.effectSettings[id].strength > 0).map(id => {
        let filter = filters.get(id);
        if (!filter) {
          filter = id === "wave" ? createWaveFilter() : createEffectFilter(id);
          filters.set(id, filter);
        }
        const uniforms = filter.resources[id === "wave" ? "waveUniforms" : "effectUniforms"].uniforms;
        uniforms.uStrength = stack.effectSettings[id].strength;
        if (id === "wave") {
          uniforms.uPhase = stack.effectSettings.wave.phase;
          uniforms.uAngle = stack.effectSettings.wave.angle * Math.PI / 180;
        } else if (id === "rgb") {
          uniforms.uAngle = stack.effectSettings.rgb.angle * Math.PI / 180;
        } else if (id === "glow") {
          const color = Number.parseInt(stack.effectSettings.glow.color.slice(1), 16);
          uniforms.uGlowColor = new Float32Array([((color >> 16) & 255) / 255, ((color >> 8) & 255) / 255, (color & 255) / 255]);
        }
        return filter;
      });
    },
    destroy() {
      for (const filter of filters.values()) filter.destroy();
      filters.clear();
    },
  };
}
