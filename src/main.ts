import GUI from 'lil-gui';
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
      // this.scene.add(backWall.mesh); this.scene.add(new THREE.AxesHelper());
    }

    // Setup objects:
    {
      const material = new THREE.MeshBasicNodeMaterial();
      const r = t.rand(t.uv()).sub(0.5).mul(0.1);
      material.fragmentNode = t.vec4(
        t
          .float(1)
          .sub(
            t
              .length(t.positionWorld.sub(t.cameraPosition))
              .div(t.vec3(t.cameraFar)),
          )
          .add(r),
        1,
      );
      // material.fragmentNode = t.wgslFn(` fn main_fragment( cameraPosition:
      //   vec4f, positionWorld: vec4f, cameraFar: f32 ) -> vec4f { return
      //   rand(vec2(0,0)) + vec4f( 1.0 - (length(positionWorld -
      //   cameraPosition) / vec3f(cameraFar)), 1.0
      //     );
      //   }
      // `)({
      //   cameraPosition: t.cameraPosition, positionWorld: t.positionWorld,
      //   cameraFar: t.cameraFar,
      // });

      const brickCountX = 5;
      const brickCountY = 5;
      const brickCountZ = 4;
      const gap = 0.03;
      const availableWidth = backWall.width - (brickCountX + 1) * gap;
      const availableHeight = backWall.height - (brickCountY + 1) * gap;
      const availableDepth = 0.5 - (brickCountZ + 1) * gap;
      const brickWidth = availableWidth / brickCountX;
      const brickHeight = availableHeight / brickCountY;
      const brickDepth = availableDepth / brickCountZ;

      const debugCube = new THREE.Mesh(
        new THREE.BoxGeometry(0.2, 0.2, 0.2),
        material,
      );
      this.scene.add(debugCube);

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
  rand: t.ShaderNodeObject<THREE.UniformNode<t.ShaderNodeObject<THREE.Node>>>;

  constructor(inputTexture: THREE.Texture) {
    const scale = 1;
    const width = inputTexture.image.width / scale;
    const height = inputTexture.image.height / scale;

    this.camera = new THREE.OrthographicCamera(0, 1, 1, 0, 0.1, 1000);
    this.camera.position.set(0, 0, 1);
    this.scene = new THREE.Scene();

    const outputTexture = new THREE.StorageTexture(width, height);
    outputTexture.minFilter = THREE.NearestFilter;
    outputTexture.magFilter = THREE.NearestFilter;

    const offsetBuffer = t.instancedArray(width, 'uint');

    const noise3 = t.Fn(({uv}: {uv: t.ShaderNodeObject<THREE.Node>}) => {
      const r = t.rand(uv.add(this.rand.mul(10000).xy));
      const g = t.rand(uv.add(this.rand.mul(20000).xy));
      const b = t.rand(uv.add(this.rand.mul(30000).xy));
      return t.vec3(r, g, b);
    });

    const minDisparity = t.uint(Math.floor(width * 0.15));
    const maxDisparity = t.uint(Math.floor(width * 0.2));

    const computeTexture = t.Fn(() => {
      const y = t.instanceIndex;
      const start = t.uint(0).mul(width);
      t.Loop(width, ({i}) => {
        const x = t.uint(i);
        const inputUV = t.uvec2(x.mul(scale), y.mul(scale));
        const outputUV = t.uvec2(x, t.float(height).sub(y));

        // Adapted from this code:
        //
        // ```
        // for (let x = 0; x < output.width; ++x) {
        //   const disparity = hiddenImage.get(x, y)[0] / 255;
        //   const offset = Math.floor(disparity * (maxDisparity - minDisparity));
        //   if (x < minDisparity) {
        //     output.set(x, y, noise.get((x + offset) % minDisparity, y));
        //   } else {
        //     output.set(x, y, output.get(x + offset - minDisparity, y));
        //   }
        // }
        // ```

        const disparity = t
          .textureLoad(inputTexture, inputUV)
          .add(noise3({uv: outputUV}).xxx.mul(0.02))
          .x.div(1);

        const offset = t.uint(
          t.floor(disparity.mul(maxDisparity.sub(minDisparity))),
        );

        const offsetBufferCoord = start.add(x);
        offsetBuffer.element(offsetBufferCoord).assign(0);
        t.If(x.lessThan(minDisparity), () => {
          const xoffset = t.uint(x.add(offset).mod(minDisparity));
          offsetBuffer.element(offsetBufferCoord).assign(xoffset);
        }).Else(() => {
          const xoffset = t.uint(
            offsetBuffer.element(x.add(offset).sub(minDisparity)),
          );
          offsetBuffer.element(offsetBufferCoord).assign(xoffset);
        });
      });

      t.Loop(width, ({i}) => {
        const outputUV = t.uvec2(i, t.float(height).sub(y));

        const offsetBufferCoord = start.add(i);
        t.textureStore(
          outputTexture,
          outputUV,
          noise3({
            uv: t.vec2(offsetBuffer.element(offsetBufferCoord), y),
          }),
        ).toWriteOnly();
      });
    });
    this.rand = t.uniform(t.vec3(0));
    this.computeNode = computeTexture().compute(height);

    const material = new THREE.MeshBasicNodeMaterial({color: 0x00ff00});
    material.colorNode = t.texture(outputTexture);

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

  update() {
    // @ts-expect-error - type issues
    this.rand.value.setX(Math.random());
    // @ts-expect-error - type issues
    this.rand.value.setY(Math.random());
    // @ts-expect-error - type issues
    this.rand.value.setZ(Math.random());
  }
}

class App {
  renderer: THREE.WebGPURenderer;
  level: Level;
  autostereogram: Autostereogram;
  stats: Stats;
  renderTarget: THREE.RenderTarget;
  renderAutoStereogram: boolean = false;
  gui: GUI;
  constructor(device: GPUDevice) {
    this.stats = new Stats();
    {
      this.gui = new GUI({});
      this.gui.add(this, 'renderAutoStereogram');
    }
    this.renderer = new THREE.WebGPURenderer({
      canvas: document.getElementById('canvas')! as HTMLCanvasElement,
      device,
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
      if (this.renderAutoStereogram) {
        this.renderer.setRenderTarget(this.renderTarget);
      }
      await this.renderer.renderAsync(this.level.scene, this.level.camera);
      if (this.renderAutoStereogram) {
        this.autostereogram.update();
        await this.renderer.computeAsync(this.autostereogram.computeNode);
        this.renderer.setRenderTarget(null);
        await this.renderer.renderAsync(
          this.autostereogram.scene,
          this.autostereogram.camera,
        );
      }
      this.stats.end();

      this.raf_();
    });
  }
}

window.addEventListener('DOMContentLoaded', async () => {
  const adapter = (await navigator.gpu.requestAdapter())!;
  const device = (await adapter.requestDevice({
    requiredLimits: {
      maxComputeWorkgroupSizeX: 1024,
      maxComputeInvocationsPerWorkgroup: 1024,
    },
    requiredFeatures: ['bgra8unorm-storage'],
  }))!;
  const app = new App(device);
  await app.run();
});
