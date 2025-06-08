import Stats from 'stats.js';
import * as t from 'three/tsl';
import * as THREE from 'three/webgpu';

// import fragmentShader from './shaders/fragment-shader.wgsl'; import
// vertexShader from './shaders/vertex-shader.wgsl';

class App {
  threejs_: THREE.WebGPURenderer | undefined;
  scene_: THREE.Scene | undefined;
  camera_: THREE.Camera | undefined;
  stats_: Stats;

  bricks: THREE.Mesh[] = [];

  constructor() {
    this.stats_ = new Stats();
  }

  async initialize() {
    this.threejs_ = new THREE.WebGPURenderer();
    document.body.appendChild(this.threejs_.domElement);
    document.body.appendChild(this.stats_.dom);

    window.addEventListener(
      'resize',
      () => {
        this.onWindowResize_();
      },
      false,
    );

    this.scene_ = new THREE.Scene();
    this.scene_.background = new THREE.Color('#000');

    this.camera_ = new THREE.PerspectiveCamera(
      75, // fov
      window.innerWidth / window.innerHeight, // aspect
      0.001, // near
      4, // far
    );
    this.camera_.position.set(0, 0, 1);

    // Setup objects:
    {
      const material = new THREE.MeshBasicNodeMaterial();
      material.fragmentNode = t.vec4(
        t
          .float(1)
          .sub(
            t
              .abs(t.positionWorld.zzz.sub(t.cameraPosition.zzz))
              .div(t.float(t.cameraFar)),
          ),
        1,
      );

      const brickCountX = 6;
      const brickCountY = 5;

      const gap = 0.1;

      const brickWidth = 1 / 4;
      const brickHeight = 1 / 8;
      const brickDepth = 0.3;
      const geometry = new THREE.BoxGeometry(
        brickWidth,
        brickHeight,
        brickDepth,
      );

      const left = -1 + gap;
      const top = 1 - gap;

      for (let x = 0; x < brickCountX; ++x) {
        for (let y = 0; y < brickCountY; ++y) {
          const box = new THREE.Mesh(geometry, material);
          box.position.set(
            left + x * (brickWidth + gap),
            top - y * (brickHeight + gap),
            -2,
          );
          this.scene_.add(box);
          this.bricks.push(box);
        }
      }
    }

    this.onWindowResize_();
    this.raf_();
  }

  onWindowResize_() {
    this.threejs_?.setSize(window.innerWidth, window.innerHeight);
    if (this.camera_ instanceof THREE.PerspectiveCamera) {
      this.camera_.aspect = window.innerWidth / window.innerHeight;
      this.camera_.updateProjectionMatrix();
    }
  }

  raf_() {
    requestAnimationFrame(async () => {
      if (!this.threejs_ || !this.scene_ || !this.camera_) return;

      this.stats_.begin();
      await this.threejs_.renderAsync(this.scene_, this.camera_);
      this.stats_.end();

      this.raf_();
    });
  }
}

window.addEventListener('DOMContentLoaded', async () => {
  const app = new App();
  await app.initialize();
});
