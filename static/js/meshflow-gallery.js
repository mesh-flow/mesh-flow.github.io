import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { PLYLoader } from "three/addons/loaders/PLYLoader.js";

function frameObject(object, camera, controls) {
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z, 1e-6);
  const fov = (camera.fov * Math.PI) / 180;
  const distance = (maxDim / (2 * Math.tan(fov / 2))) * 1.45;
  const elevation = THREE.MathUtils.degToRad(30);
  const azimuth = THREE.MathUtils.degToRad(20);
  const horizontal = distance * Math.cos(elevation);
  const height = distance * Math.sin(elevation);

  camera.position.set(
    center.x + horizontal * Math.sin(azimuth),
    center.y + height,
    center.z + horizontal * Math.cos(azimuth)
  );
  camera.near = Math.max(distance / 200, 0.01);
  camera.far = distance * 20;
  camera.updateProjectionMatrix();
  controls.target.copy(center);
  controls.update();
}

function createScene(container) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf6fbfe);

  const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 2000);
  camera.position.set(0.55, 1.15, 2.05);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.sortObjects = true;
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.rotateSpeed = 0.75;

  const ambient = new THREE.AmbientLight(0xffffff, 0.72);
  const key = new THREE.DirectionalLight(0xffffff, 1.05);
  key.position.set(2.5, 3.5, 4.5);
  const fill = new THREE.DirectionalLight(0xb8e8ff, 0.45);
  fill.position.set(-3, 1.5, -2);
  scene.add(ambient, key, fill);

  const root = new THREE.Group();
  scene.add(root);

  return { scene, camera, renderer, controls, root };
}

function formatCount(value) {
  return Number(value).toLocaleString("en-US");
}

function countGeometryStats(object) {
  let vertices = 0;
  let faces = 0;

  object.traverse((node) => {
    if (!node.geometry) return;

    const position = node.geometry.attributes.position;
    if (!position) return;

    if (node.isPoints) {
      vertices += position.count;
      return;
    }

    if (!node.isMesh) return;

    vertices += position.count;
    if (node.geometry.index) {
      faces += node.geometry.index.count / 3;
    } else {
      faces += position.count / 3;
    }
  });

  return {
    vertices: Math.round(vertices),
    faces: Math.round(faces),
  };
}

const MESH_FACE_GRAY = 0x949aa3;
const MESH_FACE_BLUE = 0x7dd3fc;
const POINT_GRAY = 0x5c6570;

function styleGlbMesh(mesh, faceColor = MESH_FACE_GRAY) {
  const isBlue = faceColor === MESH_FACE_BLUE;
  mesh.material = new THREE.MeshStandardMaterial({
    color: faceColor,
    transparent: true,
    opacity: isBlue ? 0.38 : 0.42,
    metalness: isBlue ? 0.03 : 0.02,
    roughness: isBlue ? 0.82 : 0.95,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  const wireframe = new THREE.LineSegments(
    new THREE.WireframeGeometry(mesh.geometry),
    new THREE.LineBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.95,
      depthTest: true,
    })
  );
  wireframe.renderOrder = 1;
  mesh.add(wireframe);
}

function viewportOptions(container, kind) {
  const isLeft = container.dataset.viewport === "left";
  return {
    kind,
    meshFaceColor: isLeft ? MESH_FACE_GRAY : MESH_FACE_BLUE,
  };
}

class MeshViewport {
  constructor(container, options) {
    this.container = container;
    this.options = options;
    this.state = createScene(container);
    this.loader = options.kind === "ply" ? new PLYLoader() : new GLTFLoader();
    this.showStats = options.kind !== "ply";
    if (this.showStats) {
      this.statsEl = document.createElement("div");
      this.statsEl.className = "meshflow-gallery-stats";
      this.statsEl.setAttribute("aria-live", "polite");
      container.appendChild(this.statsEl);
    }

    this.loaderEl = document.createElement("div");
    this.loaderEl.className = "meshflow-gallery-loader";
    this.loaderEl.innerHTML = '<span class="meshflow-gallery-spinner" aria-hidden="true"></span>';
    this.loaderEl.setAttribute("aria-hidden", "true");
    container.appendChild(this.loaderEl);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
  }

  setLoading(isLoading) {
    this.container.classList.toggle("is-loading", isLoading);
  }

  setStats(stats) {
    if (!this.statsEl) return;
    if (!stats) {
      this.statsEl.textContent = "";
      return;
    }
    this.statsEl.innerHTML =
      `<span>Vertices <strong>${formatCount(stats.vertices)}</strong></span>` +
      `<span>Faces <strong>${formatCount(stats.faces)}</strong></span>`;
  }

  resize() {
    const width = Math.max(this.container.clientWidth, 1);
    const height = Math.max(this.container.clientHeight, 1);
    const { camera, renderer } = this.state;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  }

  clear() {
    this.setStats(null);
    const { root } = this.state;
    while (root.children.length) {
      const child = root.children[0];
      root.remove(child);
      child.traverse((node) => {
        if (node.geometry) node.geometry.dispose();
        if (node.material) {
          if (Array.isArray(node.material)) node.material.forEach((m) => m.dispose());
          else node.material.dispose();
        }
      });
    }
  }

  load(url) {
    this.clear();
    this.setLoading(true);
    return new Promise((resolve, reject) => {
      const finish = (result) => {
        this.setLoading(false);
        resolve(result);
      };
      const fail = (error) => {
        this.setLoading(false);
        reject(error);
      };

      if (this.options.kind === "ply") {
        this.loader.load(
          url,
          (geometry) => {
            geometry.computeVertexNormals();
            const points = new THREE.Points(
              geometry,
              new THREE.PointsMaterial({
                color: POINT_GRAY,
                size: 0.015,
                sizeAttenuation: true,
              })
            );
            this.state.root.add(points);
            frameObject(points, this.state.camera, this.state.controls);
            const maxDim = new THREE.Box3().setFromObject(points).getSize(new THREE.Vector3()).length();
            points.material.size = Math.max(maxDim * 0.009, 0.0035);
            finish(points);
          },
          undefined,
          fail
        );
        return;
      }

      this.loader.load(
        url,
        (gltf) => {
          const model = gltf.scene;
          model.traverse((node) => {
            if (node.isMesh) styleGlbMesh(node, this.options.meshFaceColor);
          });
          this.state.root.add(model);
          frameObject(model, this.state.camera, this.state.controls);
          this.setStats(countGeometryStats(model));
          finish(model);
        },
        undefined,
        fail
      );
    });
  }

  render() {
    this.state.controls.update();
    this.state.renderer.render(this.state.scene, this.state.camera);
  }

  dispose() {
    this.resizeObserver.disconnect();
    this.clear();
    this.state.renderer.dispose();
  }
}

const _cameraOffset = new THREE.Vector3();

function syncCamera(fromViewport, toViewport) {
  const { camera: fromCam, controls: fromCtrl } = fromViewport.state;
  const { camera: toCam, controls: toCtrl } = toViewport.state;

  _cameraOffset.subVectors(fromCam.position, fromCtrl.target);
  toCam.position.copy(toCtrl.target).add(_cameraOffset);
  toCam.quaternion.copy(fromCam.quaternion);
  toCam.updateProjectionMatrix();
  toCtrl.update();
}

class MeshflowGallery {
  constructor(root) {
    this.root = root;
    this.syncControls = root.dataset.syncControls === "true";
    this.leftViewport = new MeshViewport(
      root.querySelector("[data-viewport='left']"),
      viewportOptions(root.querySelector("[data-viewport='left']"), root.dataset.leftKind)
    );
    this.rightViewport = new MeshViewport(
      root.querySelector("[data-viewport='right']"),
      viewportOptions(root.querySelector("[data-viewport='right']"), root.dataset.rightKind)
    );
    this.items = [];
    this.index = 0;
    this.loading = false;
    this.raf = 0;
    this._syncingControls = false;
    this._isFocused = false;
    this._isVisible = false;
    this._booted = false;

    if (this.syncControls) {
      this.bindSyncedControls();
    }

    this.prevBtn = root.querySelector("[data-gallery-prev]");
    this.nextBtn = root.querySelector("[data-gallery-next]");
    this.status = root.querySelector("[data-gallery-status]");
    this.picker = root.querySelector("[data-gallery-picker]");

    this.prevBtn.addEventListener("click", () => this.step(-1));
    this.nextBtn.addEventListener("click", () => this.step(1));
    this.picker.addEventListener("click", (event) => {
      const button = event.target.closest("[data-gallery-index]");
      if (!button) return;
      this.show(Number(button.dataset.galleryIndex, 10));
    });
    this._isHovered = false;
    this.onKeydown = (event) => this.handleKeydown(event);
    root.addEventListener("mouseenter", () => {
      this._isHovered = true;
    });
    root.addEventListener("mouseleave", () => {
      this._isHovered = false;
    });
    root.addEventListener("focusin", () => {
      this._isFocused = true;
    });
    root.addEventListener("focusout", () => {
      this._isFocused = false;
    });
    document.addEventListener("keydown", this.onKeydown);

    this.visibilityObserver = new IntersectionObserver(
      (entries) => {
        this._isVisible = entries.some((entry) => entry.isIntersecting);
      },
      { threshold: 0.05 }
    );
    this.visibilityObserver.observe(root);
    this.animate();
  }

  async boot(manifestUrl, resolvePaths) {
    if (this._booted) return;
    this._booted = true;
    this.root.classList.add("is-booting");
    this.setNavDisabled(true);
    this.setStatus("Loading gallery…");

    try {
      const response = await fetch(manifestUrl);
      if (!response.ok) throw new Error(`Manifest request failed (${response.status})`);
      const data = await response.json();
      this.items = shuffleArray(
        (data.items || []).map((item) => {
          const paths = resolvePaths(item.id);
          return { id: item.id, left: paths.left, right: paths.right };
        })
      );
      this.buildPicker();
      await this.show(0);
    } catch (error) {
      console.error(error);
      this.setStatus("Failed to load gallery.");
      this._booted = false;
    } finally {
      this.root.classList.remove("is-booting");
    }
  }

  handleKeydown(event) {
    if (!this._isHovered && !this._isFocused) return;
    if (this.loading || !this.items.length) return;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      this.step(-1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      this.step(1);
    }
  }

  bindSyncedControls() {
    const left = this.leftViewport;
    const right = this.rightViewport;

    const onChange = (source, target) => {
      if (this._syncingControls) return;
      this._syncingControls = true;
      syncCamera(source, target);
      this._syncingControls = false;
    };

    left.state.controls.addEventListener("change", () => onChange(left, right));
    right.state.controls.addEventListener("change", () => onChange(right, left));
  }

  buildPicker() {
    this.picker.innerHTML = "";
    this.items.forEach((item, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "meshflow-gallery-picker-btn";
      button.dataset.galleryIndex = String(index);
      button.setAttribute("aria-label", `Sample ${index + 1}`);
      button.title = item.id;
      this.picker.appendChild(button);
    });
  }

  step(delta) {
    if (!this.items.length || this.loading) return;
    const next = (this.index + delta + this.items.length) % this.items.length;
    this.show(next);
  }

  setStatus(message) {
    if (this.status) this.status.textContent = message;
  }

  updatePicker() {
    this.picker.querySelectorAll("[data-gallery-index]").forEach((button) => {
      const isActive = Number(button.dataset.galleryIndex, 10) === this.index;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-selected", isActive ? "true" : "false");
      if (isActive) {
        button.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
      }
    });
  }

  setNavDisabled(disabled) {
    [this.prevBtn, this.nextBtn].forEach((button) => {
      if (button) button.disabled = disabled;
    });
  }

  async show(index) {
    if (!this.items.length) return;
    const normalized = ((index % this.items.length) + this.items.length) % this.items.length;
    this.index = normalized;
    this.loading = true;
    this.updatePicker();
    this.picker.setAttribute("aria-label", `Gallery sample ${normalized + 1} of ${this.items.length}`);
    this.setNavDisabled(true);

    const item = this.items[normalized];

    try {
      await Promise.all([
        this.leftViewport.load(item.left),
        this.rightViewport.load(item.right),
      ]);
      if (this.syncControls) {
        syncCamera(this.leftViewport, this.rightViewport);
      }
      this.setStatus("");
    } catch (error) {
      console.error(error);
      this.setStatus("Failed to load sample.");
    } finally {
      this.loading = false;
      this.setNavDisabled(false);
    }
  }

  animate() {
    if (this._isVisible) {
      this.leftViewport.render();
      this.rightViewport.render();
    }
    this.raf = window.requestAnimationFrame(() => this.animate());
  }

  dispose() {
    window.cancelAnimationFrame(this.raf);
    document.removeEventListener("keydown", this.onKeydown);
    this.visibilityObserver.disconnect();
    this.leftViewport.dispose();
    this.rightViewport.dispose();
  }
}

function pathBuilder(baseLeft, extLeft, baseRight, extRight) {
  return function resolve(id) {
    return {
      left: `${baseLeft}/${id}.${extLeft}`,
      right: `${baseRight}/${id}.${extRight}`,
    };
  };
}

function shuffleArray(items) {
  const shuffled = items.slice();
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function bootGallery(root, manifestUrl, resolvePaths) {
  root.classList.add("meshflow-gallery-block--lazy");
  const observer = new IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      root.classList.remove("meshflow-gallery-block--lazy");
      const gallery = new MeshflowGallery(root);
      gallery.boot(manifestUrl, resolvePaths);
    },
    { rootMargin: "160px", threshold: 0.08 }
  );
  observer.observe(root);
}

const generationGallery = document.getElementById("meshflow-generation-gallery");
if (generationGallery) {
  bootGallery(
    generationGallery,
    "./static/data/gallery-manifest.json",
    pathBuilder("assets/gallery/surface_pc", "ply", "assets/gallery/generated_meshes", "glb")
  );
}

const vaeGallery = document.getElementById("meshflow-vae-gallery");
if (vaeGallery) {
  bootGallery(
    vaeGallery,
    "./static/data/gallery-vae-manifest.json",
    function (id) {
      return {
        left: `assets/gallery_vae/${id}_gt.glb`,
        right: `assets/gallery_vae/${id}_recon.glb`,
      };
    }
  );
}
