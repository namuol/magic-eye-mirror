import Stats from 'stats.js';
import * as t from 'three/tsl';
import * as THREE from 'three/webgpu';

class Level {
  camera: THREE.PerspectiveCamera;
  scene: THREE.Scene;
  bricks: THREE.Mesh[] = [];

  constructor() {
    this.camera = new THREE.PerspectiveCamera(
      75, // fov
      window.innerWidth / window.innerHeight, // aspect
      0.001, // near
      4, // far
    );
    this.camera.position.set(0, 0, 1);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#000');

    // Setup objects:
    {
      const material = new THREE.MeshBasicNodeMaterial();
      // material.fragmentNode = t.vec4( t .float(1) .sub( t
      //   .abs(t.positionWorld.zzz.sub(t.cameraPosition.zzz))
      //   .div(t.float(t.cameraFar)),
      //     ),
      //   1,
      // );
      material.fragmentNode = t.wgslFn(`
        fn main_fragment(
          cameraPosition: vec4f,
          positionWorld: vec4f,
          cameraFar: f32
        ) -> vec4f {
          return vec4f(
            1.0 - (abs(positionWorld.zzz - cameraPosition.zzz) / vec3f(cameraFar)),
            1.0
          );
        }
      `)({
        cameraPosition: t.cameraPosition,
        positionWorld: t.positionWorld,
        cameraFar: t.cameraFar,
      });

      const brickCountX = 6;
      const brickCountY = 8;

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
            left + brickWidth / 2 + x * (brickWidth + gap),
            top - brickHeight / 2 - y * (brickHeight + gap),
            -2,
          );
          this.scene.add(box);
          this.bricks.push(box);
        }
      }
    }
  }

  onWindowResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
  }
}

class Autostereogram {
  camera: THREE.OrthographicCamera;
  scene: THREE.Scene;
  computeNode: THREE.ComputeNode;

  constructor() {
    const width = window.innerWidth;
    const height = window.innerHeight;

    const aspect = width / height;

    this.camera = new THREE.OrthographicCamera(-aspect, aspect, 1, -1, 0, 2);
    this.camera.position.z = 1;
    this.scene = new THREE.Scene();

    const storageTexture = new THREE.StorageTexture(width, height);

    const computeTexture = t.Fn(
      ({storageTexture}: {storageTexture: THREE.Texture}) => {
        const posX = t.instanceIndex.mod(width);
        const posY = t.instanceIndex.div(width);
        const indexUV = t.uvec2(posX, posY);

        // https://www.shadertoy.com/view/Xst3zN

        const x = t.float(posX).div(50.0);
        const y = t.float(posY).div(50.0);

        const v1 = x.sin();
        const v2 = y.sin();
        const v3 = x.add(y).sin();
        const v4 = x.mul(x).add(y.mul(y)).sqrt().add(5.0).sin();
        const v = v1.add(v2, v3, v4);

        const r = v.sin();
        const g = v.add(Math.PI).sin();
        const b = v.add(Math.PI).sub(0.5).sin();

        t.textureStore(
          storageTexture,
          indexUV,
          t.vec4(r, g, b, 1),
        ).toWriteOnly();
      },
    );

    this.computeNode = computeTexture({storageTexture}).compute(width * height);

    const material = new THREE.MeshBasicNodeMaterial({color: 0x00ff00});
    material.colorNode = t.texture(storageTexture);

    const plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    this.scene.add(plane);
  }

  onWindowResize() {
    const aspect = window.innerWidth / window.innerHeight;

    const frustumHeight = this.camera.top - this.camera.bottom;

    this.camera.left = (-frustumHeight * aspect) / 2;
    this.camera.right = (frustumHeight * aspect) / 2;

    this.camera.updateProjectionMatrix();
  }
}

class App {
  renderer: THREE.WebGPURenderer;
  level: Level;
  autostereogram: Autostereogram;
  stats: Stats;

  constructor() {
    this.stats = new Stats();
    this.renderer = new THREE.WebGPURenderer();
    document.body.appendChild(this.renderer.domElement);
    document.body.appendChild(this.stats.dom);

    window.addEventListener(
      'resize',
      () => {
        this.onWindowResize_();
      },
      false,
    );

    this.level = new Level();
    this.autostereogram = new Autostereogram();
  }

  async run() {
    this.onWindowResize_();
    this.raf_();
  }

  onWindowResize_() {
    this.renderer?.setSize(window.innerWidth, window.innerHeight);
    this.level.onWindowResize();
    this.autostereogram.onWindowResize();
  }

  raf_() {
    requestAnimationFrame(async () => {
      this.stats.begin();
      await this.renderer.renderAsync(this.level.scene, this.level.camera);
      await this.renderer.computeAsync(this.autostereogram.computeNode);
      await this.renderer.renderAsync(
        this.autostereogram.scene,
        this.autostereogram.camera,
      );
      this.stats.end();

      this.raf_();
    });
  }
}

window.addEventListener('DOMContentLoaded', async () => {
  const app = new App();
  await app.run();
});
