import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { GFX } from '../config';

const FinalShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uChromatic: { value: 0 },
    uSpeedBlur: { value: 0 },
    uVignette: { value: 0.32 },
    uFlash: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uChromatic;
    uniform float uSpeedBlur;
    uniform float uVignette;
    uniform float uFlash;
    varying vec2 vUv;

    void main() {
      vec2 uv = vUv;
      vec2 dir = uv - vec2(0.5);
      float dist = length(dir);

      // chromatic aberration, radial, stronger at edges
      float ca = uChromatic * (0.0035 + dist * 0.010);
      vec4 col;
      col.r = texture2D(tDiffuse, uv - dir * ca).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv + dir * ca).b;
      col.a = 1.0;

      // cheap radial speed blur
      if (uSpeedBlur > 0.001) {
        float amt = uSpeedBlur * 0.020 * dist;
        vec3 acc = col.rgb;
        acc += texture2D(tDiffuse, uv - dir * amt * 0.33).rgb * 0.75;
        acc += texture2D(tDiffuse, uv - dir * amt * 0.66).rgb * 0.5;
        acc += texture2D(tDiffuse, uv - dir * amt).rgb * 0.25;
        col.rgb = acc / 2.5;
      }

      // vignette + impact flash
      float vig = smoothstep(0.85, 0.35, dist) ;
      col.rgb *= mix(1.0, vig, uVignette);
      col.rgb += vec3(1.0, 0.92, 0.8) * uFlash * 0.35;

      gl_FragColor = col;
    }
  `,
};

export interface SceneKit {
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  composer: EffectComposer | null;
  finalPass: ShaderPass | null;
  sun: THREE.DirectionalLight;
  setPostFx(enabled: boolean): void;
  renderFrame(): void;
  resize(w: number, h: number): void;
  /** per-frame feedback values 0..1 */
  fx: { chromatic: number; speedBlur: number; flash: number };
}

export function createScene(canvas: HTMLCanvasElement): SceneKit {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, GFX.pixelRatioCap));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(GFX.skyHorizon, GFX.fogDensity);

  const camera = new THREE.PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    0.3,
    2600
  );

  const hemi = new THREE.HemisphereLight(GFX.hemiSky, GFX.hemiGround, 0.85);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(GFX.sunColor, 2.1);
  sun.position.set(-120, 160, 80);
  sun.castShadow = true;
  sun.shadow.mapSize.set(GFX.shadowMapSize, GFX.shadowMapSize);
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 500;
  const s = GFX.shadowRadius;
  sun.shadow.camera.left = -s;
  sun.shadow.camera.right = s;
  sun.shadow.camera.top = s;
  sun.shadow.camera.bottom = -s;
  sun.shadow.bias = -0.0004;
  scene.add(sun);
  scene.add(sun.target);

  // sky dome
  const skyGeo = new THREE.SphereGeometry(2000, 24, 12);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color(GFX.skyTop) },
      horizon: { value: new THREE.Color(GFX.skyHorizon) },
    },
    vertexShader: /* glsl */ `
      varying float vH;
      void main() {
        vH = normalize(position).y;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 top;
      uniform vec3 horizon;
      varying float vH;
      void main() {
        float t = clamp(vH * 1.6 + 0.12, 0.0, 1.0);
        gl_FragColor = vec4(mix(horizon, top, t), 1.0);
      }
    `,
  });
  scene.add(new THREE.Mesh(skyGeo, skyMat));

  let composer: EffectComposer | null = null;
  let finalPass: ShaderPass | null = null;
  const fx = { chromatic: 0, speedBlur: 0, flash: 0 };

  function buildComposer() {
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    finalPass = new ShaderPass(FinalShader);
    composer.addPass(finalPass);
  }

  function setPostFx(enabled: boolean) {
    if (enabled && !composer) buildComposer();
    composer?.setSize(window.innerWidth, window.innerHeight);
    if (!enabled) {
      composer = null;
      finalPass = null;
    }
  }

  function renderFrame() {
    if (composer && finalPass) {
      finalPass.uniforms.uChromatic.value = fx.chromatic;
      finalPass.uniforms.uSpeedBlur.value = fx.speedBlur;
      finalPass.uniforms.uFlash.value = fx.flash;
      composer.render();
    } else {
      renderer.render(scene, camera);
    }
  }

  function resize(w: number, h: number) {
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    composer?.setSize(w, h);
  }

  return { scene, renderer, camera, composer, finalPass, sun, setPostFx, renderFrame, resize, fx };
}

/** Keeps the shadow frustum centered on the player to maximize texel density. */
export function followSunWith(kit: SceneKit, x: number, y: number, z: number): void {
  kit.sun.position.set(x - 120, y + 160, z + 80);
  kit.sun.target.position.set(x, y, z);
  kit.sun.target.updateMatrixWorld();
}
