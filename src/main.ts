import Stats from 'stats.js';
import {OrbitControls} from 'three/examples/jsm/Addons.js';
import * as t from 'three/tsl';
import * as THREE from 'three/webgpu';

class Level {
  camera: THREE.PerspectiveCamera;
  scene: THREE.Scene;
  bricks: THREE.Mesh[] = [];
  controls: OrbitControls;

  constructor() {
    this.camera = new THREE.PerspectiveCamera(
      75, // fov
      window.innerWidth / window.innerHeight, // aspect
      0.001, // near
      1.5, // far
    );
    this.camera.position.set(0, 0, 1);

    this.controls = new OrbitControls(
      this.camera,
      document.getElementById('canvas')!,
    );

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#000');

    // Debug view
    let backWall: {
      mesh: THREE.Mesh<THREE.PlaneGeometry>;
      width: number;
      height: number;
    };
    {
      const material = new THREE.MeshBasicMaterial({wireframe: true});
      const width = 1;
      const height = 1;
      backWall = {
        mesh: new THREE.Mesh(
          new THREE.PlaneGeometry(width, height, 1),
          material,
        ),
        width,
        height,
      };
      backWall.mesh.position.x = 0;
      backWall.mesh.position.y = 0;
      backWall.mesh.position.z = -0.5;
      this.scene.add(backWall.mesh);
      this.scene.add(new THREE.AxesHelper());
    }

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

      const brickCountX = 5;
      const brickCountY = 10;
      const brickCountZ = 4;
      const gap = 0.03;
      const availableWidth = backWall.width - (brickCountX + 1) * gap;
      const availableHeight = backWall.height - (brickCountY + 1) * gap;
      const availableDepth = 0.5 - (brickCountZ + 1) * gap;
      const brickWidth = availableWidth / brickCountX;
      const brickHeight = availableHeight / brickCountY;
      const brickDepth = availableDepth / brickCountZ;

      const left = -backWall.width / 2;
      const bottom = -backWall.height / 2;
      const back = backWall.mesh.position.z;

      const geometry = new THREE.BoxGeometry(
        brickWidth,
        brickHeight,
        brickDepth,
      );

      for (let x = 0; x < brickCountX; ++x) {
        for (let y = 0; y < brickCountY; ++y) {
          for (let z = 0; z < brickCountZ; ++z) {
            if (Math.random() < 0.5) continue;
            const box = new THREE.Mesh(geometry, material);
            box.position.set(
              left + brickWidth / 2 + gap + brickWidth * x + gap * x,
              bottom + brickHeight / 2 + gap + brickHeight * y + gap * y,
              back + brickDepth / 2 + gap + brickDepth * z + gap * z,
            );
            this.scene.add(box);
            this.bricks.push(box);
          }
        }
      }
    }
  }

  onWindowResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
  }

  update() {
    this.controls.update();
  }
}

class Autostereogram {
  camera: THREE.OrthographicCamera;
  scene: THREE.Scene;
  computeNode: THREE.ComputeNode;

  constructor(inputTexture: THREE.Texture) {
    const width = window.innerWidth;
    const height = window.innerHeight;

    this.camera = new THREE.OrthographicCamera(0, 1, 1, 0, 0.1, 1000);
    this.camera.position.set(0, 0, 1);
    this.scene = new THREE.Scene();

    const storageTexture = new THREE.StorageTexture(width, height);

    const computeTexture = t.Fn(
      ({
        inputTexture,
        storageTexture,
      }: {
        inputTexture: THREE.Texture;
        storageTexture: THREE.Texture;
      }) => {
        const posX = t.instanceIndex.mod(width);
        const posY = t.instanceIndex.div(width);
        const indexUV = t.uvec2(posX, posY);
        // For some reason y coord needs to be flipped
        const outputUV = t.uvec2(posX, t.int(height).sub(posY));

        // https://www.shadertoy.com/view/Xst3zN

        const color = t.textureLoad(inputTexture, indexUV).rgba;
        t.textureStore(storageTexture, outputUV, color).toWriteOnly();

        // const x = t.float(posX).div(50.0); const y = t.float(posY).div(50.0);

        // const v1 = x.sin(); const v2 = y.sin(); const v3 = x.add(y).sin();
        // const v4 = x.mul(x).add(y.mul(y)).sqrt().add(5.0).sin(); const v =
        // v1.add(v2, v3, v4);

        // const r = v.sin(); const g = v.add(Math.PI).sin(); const b =
        // v.add(Math.PI).sub(0.5).sin();

        // t.textureStore( storageTexture, indexUV, t.vec4(r, g, b, 1),
        //   ).toWriteOnly();
      },
    );

    this.computeNode = computeTexture({inputTexture, storageTexture}).compute(
      width * height,
    );

    const material = new THREE.MeshBasicNodeMaterial({color: 0x00ff00});
    material.colorNode = t.texture(storageTexture);

    const geometry = new THREE.PlaneGeometry(1, 1);
    const plane = new THREE.Mesh(geometry, material);
    plane.position.set(0.5, 0.5, 0);
    this.scene.add(plane);
  }

  onWindowResize() {
    // const aspect = window.innerWidth / window.innerHeight; const
    // frustumHeight = this.camera.top - this.camera.bottom; this.camera.left =
    // (-frustumHeight * aspect) / 2; this.camera.right = (frustumHeight *
    // aspect) / 2; this.camera.updateProjectionMatrix();
  }
}

class App {
  renderer: THREE.WebGPURenderer;
  level: Level;
  autostereogram: Autostereogram;
  stats: Stats;
  renderTarget: THREE.RenderTarget;

  constructor() {
    this.stats = new Stats();
    this.renderer = new THREE.WebGPURenderer({
      canvas: document.getElementById('canvas')! as HTMLCanvasElement,
    });
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
    this.renderTarget = new THREE.RenderTarget(innerWidth, innerHeight);
    this.autostereogram = new Autostereogram(this.renderTarget.texture);
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
      this.level.update();
      this.renderer.setRenderTarget(this.renderTarget);
      await this.renderer.renderAsync(this.level.scene, this.level.camera);
      await this.renderer.computeAsync(this.autostereogram.computeNode);
      this.renderer.setRenderTarget(null);
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
