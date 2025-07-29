import {
  DepthEstimationPipelineOutput,
  pipeline,
} from '@huggingface/transformers';
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
  noiseFactor = t.uniform(t.float(0.1));
  rand: t.ShaderNodeObject<THREE.UniformNode<THREE.Vector3>>;
  freeze: boolean = false;
  render_depth: boolean = false;

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
    this.rand = t.uniform(t.vec3(0));

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#fff');

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
  }

  mesh: THREE.Mesh<THREE.PlaneGeometry> | null = null;

  async initialize() {
    // Setup objects: TODO: Could we put this into a separate module or
    // something?
    const width = 256;
    const height = 256;

    const depthCanvas = new OffscreenCanvas(width, height);
    const depthCtx = depthCanvas.getContext('2d')!;
    depthCtx.fillStyle = 'black';
    depthCtx.fillRect(0, 0, width, height);

    const videoCanvas = new OffscreenCanvas(width, height);
    const videoCtx = videoCanvas.getContext('2d')!;

    const constraints = {
      video: {width: 720, height: 720, facingMode: 'user'},
    };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    const video = document.createElement('video');

    video.srcObject = stream;
    video.play();

    const texture = new THREE.CanvasTexture(depthCanvas);
    const geometry = new THREE.PlaneGeometry(width, height);
    geometry.scale(-1.5 / width, 1.5 / width, 1.5 / width);
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    this.mesh = mesh;
    this.scene.add(mesh);
    async function hasFp16() {
      try {
        const adapter = await navigator.gpu.requestAdapter();
        return adapter!.features.has('shader-f16');
      } catch {
        return false;
      }
    }
    const depthEstimator = await pipeline(
      'depth-estimation',
      'onnx-community/depth-anything-v2-small',
      {
        dtype: (await hasFp16()) ? 'fp16' : 'fp32',
        device: 'webgpu',
      },
    );

    const updateCanvas = async () => {
      if (!this.freeze) {
        videoCtx.drawImage(video, 0, 0, width, height);
        const {depth} = (await depthEstimator(
          videoCanvas,
        )) as DepthEstimationPipelineOutput;
        depthCtx.drawImage(depth.toCanvas(), 0, 0, width, height);
        texture.needsUpdate = true;
      }
      requestAnimationFrame(updateCanvas);
    };
    updateCanvas();
  }

  onWindowResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
  }

  async update() {
    this.mesh!.position.set(this.render_depth ? 0 : 0.125, 0, 0);
    this.controls.update();
    this.rand.value.setX(Math.random());
    this.rand.value.setY(Math.random());
    this.rand.value.setZ(Math.random());
  }
}

class Autostereogram {
  camera: THREE.OrthographicCamera;
  scene: THREE.Scene;
  computeNode: THREE.ComputeNode;
  rand: t.ShaderNodeObject<THREE.UniformNode<THREE.Vector3>>;
  minDisparity = t.uniform(0.15);
  maxDisparity = t.uniform(0.2);
  separation = t.uniform(0.75);
  pattern_scale = t.uniform(6);

  constructor(inputTexture: THREE.Texture) {
    const scale = 1;
    const width = inputTexture.image.width / scale;
    const height = inputTexture.image.height / scale;

    this.camera = new THREE.OrthographicCamera(0, 1, 1, 0, 0.1, 1000);
    this.camera.position.set(0, 0, 1);
    this.scene = new THREE.Scene();

    const outputTexture = new THREE.StorageTexture(width, height);
    // In theory this might set our texture to `u32uint`, which should be able
    // to do `read_write`:
    //
    // ```
    // outputTexture.type = THREE.UnsignedIntType;
    // outputTexture.format = THREE.RedIntegerFormat;
    // ```
    //
    // Source:
    // https://discourse.threejs.org/t/how-to-pass-32-bit-unsigned-integer-to-a-custom-shader-using-datatexture/64056

    outputTexture.minFilter = THREE.NearestFilter;
    outputTexture.magFilter = THREE.NearestFilter;

    const offsetBuffer = t.workgroupArray('float', width);

    const noise3 = t.Fn(({uv}: {uv: t.ShaderNodeObject<THREE.Node>}) => {
      const r = t.rand(uv.add(this.rand.mul(10000).xy));
      const g = t.rand(uv.add(this.rand.mul(20000).xy));
      const b = t.rand(uv.add(this.rand.mul(30000).xy));
      return t.vec3(r, g, b);
    });

    const minDisparity = t
      .float(width)
      .mul(this.minDisparity)
      .mul(this.separation);
    const maxDisparity = t
      .float(width)
      .mul(this.maxDisparity)
      .mul(this.separation);
    const Y_COUNT = 1;

    const computeTexture = t.Fn(() => {
      const yOffset = t.float(0).toVar('yOffset');
      t.Loop(yOffset.lessThan(Y_COUNT), () => {
        const y = t.float(t.globalId.x.mul(Y_COUNT).add(yOffset));
        const start = t.float(0).mul(width);
        const x = t.float(0).toVar('x');
        t.Loop(x.lessThan(width), () => {
          const inputUV = t.vec2(x.mul(scale), y.mul(scale));
          // const outputUV = t.vec2(x, t.float(height).sub(y));

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

          // We should use the full 32 bits of texture data here to store the
          // depth with much more precision!
          const disparity = t.float(
            t
              .textureLoad(inputTexture, inputUV)
              // .add(noise3({uv: outputUV}).xxx.mul(0.02))
              .x.div(1),
          );

          const offset = disparity.mul(maxDisparity.sub(minDisparity));

          const offsetBufferCoord = start.add(x);
          offsetBuffer.element(offsetBufferCoord).assign(0);
          t.If(x.lessThan(minDisparity), () => {
            const xoffset = x.add(offset).mod(minDisparity);
            offsetBuffer.element(offsetBufferCoord).assign(xoffset);
          }).Else(() => {
            const xoffset = offsetBuffer.element(
              x.add(offset).sub(minDisparity),
            );
            offsetBuffer.element(offsetBufferCoord).assign(xoffset);
          });
          x.addAssign(1);
        });

        x.assign(0);
        t.Loop(x.lessThan(width), () => {
          const outputUV = t.uvec2(x, t.float(height).sub(y));

          const offsetBufferCoord = start.add(x);
          const offsetUV = t.vec2(offsetBuffer.element(offsetBufferCoord), y);
          // const offsetUV = outputUV;
          t.textureStore(
            outputTexture,
            outputUV,
            noise3({
              uv: t.uvec2(offsetUV.div(this.pattern_scale)),
            }),
            // t.vec4( t.div(t.float(offsetUV.x), t.float(width)),
            //   t.div(t.float(offsetUV.y), t.float(height)),
            //   t.div(t.float(offsetUV.y), t.float(height)), 1,
            // ),
          ).toWriteOnly();

          x.addAssign(1);
        });

        yOffset.addAssign(1);
      });
    });

    this.rand = t.uniform(t.vec3(0));
    this.computeNode = computeTexture().compute(Math.ceil(height / Y_COUNT), [
      1,
    ]);

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
    this.rand.value.setX(Math.random());
    this.rand.value.setY(Math.random());
    this.rand.value.setZ(Math.random());
  }
}

class App {
  renderer: THREE.WebGPURenderer;
  level: Level;
  autostereogram: Autostereogram;
  stats: Stats;
  renderTarget: THREE.RenderTarget;
  render_depth: boolean = false;
  show_fps: boolean = false;
  freeze: boolean = false;
  gui: GUI;
  noiseFactor = 0.0;
  minDisparity = 0.15;
  maxDisparity = 0.2;
  separation = 0.75;
  pattern_scale = 6;
  fadeTimeout: NodeJS.Timeout | null = null;
  fadeAnimations: Animation[] | null = null;

  constructor(public device: GPUDevice) {
    this.stats = new Stats();
    this.stats.dom.hidden = true;
    this.gui = new GUI({});
    this.gui.close();
    this.gui.hide();

    this.renderer = new THREE.WebGPURenderer({
      canvas: document.getElementById('canvas')! as HTMLCanvasElement,
      device,
      antialias: true,
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

  async initialize() {
    this.level.render_depth = this.render_depth;
    await this.level.initialize();
  }

  run() {
    this.onWindowResize_();
    this.raf_();

    this.gui.add(this, 'render_depth');
    this.gui.add(this, 'show_fps');
    this.gui.add(this, 'freeze');
    // this.gui.add(this, 'noiseFactor');
    this.gui.add(this, 'separation', 0.1, 1.5, 0.01);
    this.gui.add(this, 'pattern_scale', 1, 10, 0.1);
    // this.gui.add(this, 'minDisparity', 0.1, 0.3, 0.01); this.gui.add(this,
    // 'maxDisparity', 0.1, 0.3, 0.01);
    this.gui.show();

    // Setup fade functionality
    this.setupFadeFunctionality();
  }

  onWindowResize_() {
    this.renderer?.setSize(window.innerWidth, window.innerHeight);
    this.level.onWindowResize();
    this.autostereogram.onWindowResize();
  }

  raf_() {
    requestAnimationFrame(async () => {
      this.stats.dom.hidden = !this.show_fps;
      this.stats.begin();
      this.level.freeze = this.freeze;
      this.level.render_depth = this.render_depth;
      this.level.noiseFactor.value = this.noiseFactor;
      this.autostereogram.minDisparity.value = this.minDisparity;
      this.autostereogram.maxDisparity.value = this.maxDisparity;
      this.autostereogram.separation.value = this.separation;
      this.autostereogram.pattern_scale.value = this.pattern_scale;
      if (!this.freeze) {
        await this.level.update();
      }

      if (!this.render_depth) {
        this.renderer.setRenderTarget(this.renderTarget);
      }
      await this.renderer.renderAsync(this.level.scene, this.level.camera);
      if (!this.render_depth) {
        if (!this.freeze) {
          this.autostereogram.update();
        }
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

  /**
   * Sets up the fade functionality for GUI and viewing tips
   */
  setupFadeFunctionality(): void {
    const guiElement = this.gui.domElement;

    // Reset fade timer on mouse enter
    guiElement.addEventListener('mouseenter', () => resetFadeTimer(this));

    // Reset fade timer on any interaction with GUI elements
    guiElement.addEventListener('click', () => resetFadeTimer(this));
    guiElement.addEventListener('input', () => resetFadeTimer(this));
    guiElement.addEventListener('change', () => resetFadeTimer(this));
    guiElement.addEventListener('touchstart', () => resetFadeTimer(this));
    guiElement.addEventListener('touchend', () => resetFadeTimer(this));

    // Reset fade timer on mouse move
    document.addEventListener('mousemove', () => resetFadeTimer(this));

    // Start fade timer when GUI is shown
    const originalShow = this.gui.show.bind(this.gui);
    this.gui.show = (show?: boolean) => {
      const result = originalShow(show);
      if (show !== false) {
        document.body.classList.remove('gui-faded');
        document.body.classList.add('gui-visible');
        startFadeTimer(this);
      }
      return result;
    };

    // Clear fade timer when GUI is hidden
    const originalHide = this.gui.hide.bind(this.gui);
    this.gui.hide = () => {
      const result = originalHide();
      if (this.fadeTimeout) {
        clearTimeout(this.fadeTimeout);
        this.fadeTimeout = null;
      }
      if (this.fadeAnimations) {
        this.fadeAnimations.forEach((animation) => animation.cancel());
        this.fadeAnimations = null;
      }
      // Remove cursor classes when GUI is hidden
      document.body.classList.remove('gui-faded', 'gui-visible');
      return result;
    };

    // Watch for expanded state changes
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (
          mutation.type === 'attributes' &&
          mutation.attributeName === 'class'
        ) {
          const target = mutation.target as Element;
          if (target.classList.contains('expanded')) {
            // GUI is expanded, cancel fade
            if (this.fadeTimeout) {
              clearTimeout(this.fadeTimeout);
              this.fadeTimeout = null;
            }
            if (this.fadeAnimations) {
              this.fadeAnimations.forEach((animation) => animation.cancel());
              this.fadeAnimations = null;
            }
            guiElement.style.opacity = '1';
            document.getElementById('viewing-tips-link')!.style.opacity = '1';
            document.body.classList.remove('gui-faded');
            document.body.classList.add('gui-visible');
          } else {
            // GUI is collapsed, start fade timer
            startFadeTimer(this);
          }
        }
      });
    });

    observer.observe(guiElement, {
      attributes: true,
      attributeFilter: ['class'],
    });

    // Add global mouse move listener to reset fade timer when mouse is near GUI
    document.addEventListener('mousemove', (e) => {
      const rect = guiElement.getBoundingClientRect();
      const margin = 50; // 50px margin around GUI

      if (
        e.clientX >= rect.left - margin &&
        e.clientX <= rect.right + margin &&
        e.clientY >= rect.top - margin &&
        e.clientY <= rect.bottom + margin
      ) {
        resetFadeTimer(this);
      }
    });

    document.addEventListener('touchstart', () => resetFadeTimer(this));
    document.addEventListener('click', () => resetFadeTimer(this));
  }
}

/**
 * Starts the fade-out timer for the GUI controls
 */
function startFadeTimer(app: App): void {
  if (!app.gui) return;
  if (!app.gui.domElement.classList.contains('closed')) return;

  // Clear any existing fade timeout
  if (app.fadeTimeout) {
    clearTimeout(app.fadeTimeout);
  }

  // Clear any existing fade animation
  if (app.fadeAnimations) {
    app.fadeAnimations.forEach((animation) => animation.cancel());
  }

  // Check if GUI is expanded (has the 'expanded' class)
  const guiElement = app.gui.domElement;
  if (guiElement.classList.contains('expanded')) {
    return; // Don't fade if expanded
  }

  // Set opacity to 1 (fully visible)
  guiElement.style.opacity = '1';
  document.getElementById('viewing-tips-link')!.style.opacity = '1';

  // Start fade timer
  app.fadeTimeout = setTimeout(() => {
    fadeOutGUI(app);
  }, 3000); // 3 second delay
}

/**
 * Fades out the GUI controls over 2 seconds
 */
function fadeOutGUI(app: App): void {
  if (!app.gui) return;

  const guiElement = app.gui.domElement;

  // Don't fade if expanded
  if (guiElement.classList.contains('expanded')) {
    return;
  }

  // Hide cursor and add faded class
  document.body.classList.remove('gui-visible');
  document.body.classList.add('gui-faded');

  // Create fade animation
  app.fadeAnimations = [];
  [guiElement, document.getElementById('viewing-tips-link')!].forEach(
    (element) => {
      app.fadeAnimations!.push(
        element.animate([{opacity: '1'}, {opacity: '0.1'}], {
          duration: 2000, // 2 seconds
          easing: 'ease-out',
          fill: 'forwards',
        }),
      );
    },
  );
}

/**
 * Resets the fade timer and makes GUI fully visible
 */
function resetFadeTimer(app: App): void {
  if (!app.gui) return;

  // Clear existing timeout and animation
  if (app.fadeTimeout) {
    clearTimeout(app.fadeTimeout);
    app.fadeTimeout = null;
  }

  if (app.fadeAnimations) {
    app.fadeAnimations.forEach((animation) => animation.cancel());
    app.fadeAnimations = null;
  }

  // Show cursor and make GUI fully visible
  document.body.classList.remove('gui-faded');
  document.body.classList.add('gui-visible');
  app.gui.domElement.style.opacity = '1';

  // Start new fade timer
  startFadeTimer(app);
}

export const getApp = async () => {
  if (!navigator.gpu) {
    return;
  }
  const adapter = (await navigator.gpu.requestAdapter())!;
  const device = (await adapter.requestDevice())!;
  const app = new App(device);
  return app;
};
