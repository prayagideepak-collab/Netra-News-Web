import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import * as xb from 'xrblocks';
import { ArticleRecord, LocationPreference, PowerTier } from '../domain/types';

export function detectSoftwareGl(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return true;
  }
}

function createProceduralGlobeTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#0d1b3a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Latitude / longitude grid lines
    ctx.strokeStyle = 'rgba(245, 158, 11, 0.28)';
    ctx.lineWidth = 1.5;
    for (let x = 0; x <= canvas.width; x += 32) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    }
    for (let y = 0; y <= canvas.height; y += 32) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }

    // Highlighted Indian subcontinent Stylized Silhouette & Amber Beacon
    ctx.fillStyle = 'rgba(251, 191, 36, 0.78)';
    ctx.beginPath();
    ctx.moveTo(355, 95);
    ctx.lineTo(372, 108);
    ctx.lineTo(364, 146);
    ctx.lineTo(348, 118);
    ctx.closePath();
    ctx.fill();

    // concentric rings around India centroid
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(360, 118, 16, 0, Math.PI * 2);
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.anisotropy = maxAnisotropy;
  return texture;
}

function createContactShadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const grad = ctx.createRadialGradient(64, 64, 8, 64, 64, 60);
    grad.addColorStop(0, 'rgba(0, 0, 0, 0.65)');
    grad.addColorStop(0.6, 'rgba(0, 0, 0, 0.25)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Builds the 10-part composite procedural 3D NETRA NEWS Kiosk & Broadcast Monument (`THREE.Group`),
 * pivoted at bottom-center (y = 0) with varied roughness and metalness across adjacent parts.
 */
export function buildNewsroomKioskGroup(maxAnisotropy: number = 1): {
  root: THREE.Group;
  globeGroup: THREE.Group;
  dishGroup: THREE.Group;
  disposables: Array<{ dispose: () => void }>;
} {
  const disposables: Array<{ dispose: () => void }> = [];
  const root = new THREE.Group();
  root.name = 'NetraNewsBroadcastMonument';

  // Materials with deliberate roughness/metalness contrast (>= 0.25 difference between adjacent parts)
  const navyStoneMat = new THREE.MeshStandardMaterial({
    color: 0x0f1d3a,
    roughness: 0.78,
    metalness: 0.15,
  });
  const slateHullMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    roughness: 0.48,
    metalness: 0.45,
  });
  const amberBrassMat = new THREE.MeshStandardMaterial({
    color: 0xf59e0b,
    roughness: 0.2,
    metalness: 0.88,
  });
  const darkChromeMat = new THREE.MeshStandardMaterial({
    color: 0x94a3b8,
    roughness: 0.22,
    metalness: 0.82,
  });

  const globeTex = createProceduralGlobeTexture(maxAnisotropy);
  const globeMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: globeTex,
    roughness: 0.35,
    metalness: 0.25,
  });

  const shadowTex = createContactShadowTexture();
  const shadowMat = new THREE.MeshBasicMaterial({
    map: shadowTex,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  });

  disposables.push(
    navyStoneMat,
    slateHullMat,
    amberBrassMat,
    darkChromeMat,
    globeTex,
    globeMat,
    shadowTex,
    shadowMat
  );

  // Part 1: Soft Radial Contact Shadow Disc (offset at y = 0.005 to avoid Z-fighting)
  const shadowGeo = new THREE.CircleGeometry(1.45, 32);
  shadowGeo.rotateX(-Math.PI / 2);
  const shadowMesh = new THREE.Mesh(shadowGeo, shadowMat);
  shadowMesh.position.y = 0.005;
  root.add(shadowMesh);
  disposables.push(shadowGeo);

  // Part 2: Primary Silhouette — Stepped Circular Pedestal Plinth
  const plinthGeo = new THREE.CylinderGeometry(0.92, 1.04, 0.16, 32);
  const plinthMesh = new THREE.Mesh(plinthGeo, navyStoneMat);
  plinthMesh.position.y = 0.08;
  plinthMesh.receiveShadow = true;
  root.add(plinthMesh);
  disposables.push(plinthGeo);

  // Part 3: Secondary Read — Brushed Amber Brass Base Collar Ring
  const collarGeo = new THREE.TorusGeometry(0.91, 0.025, 16, 48);
  collarGeo.rotateX(Math.PI / 2);
  const collarMesh = new THREE.Mesh(collarGeo, amberBrassMat);
  collarMesh.position.y = 0.16;
  root.add(collarMesh);
  disposables.push(collarGeo);

  // Part 4: Primary Silhouette — Broadcast Desk Curved Console Body (Lathe profile)
  const lathePoints = [
    new THREE.Vector2(0.55, 0.16),
    new THREE.Vector2(0.68, 0.45),
    new THREE.Vector2(0.76, 0.72),
    new THREE.Vector2(0.62, 0.78),
    new THREE.Vector2(0.32, 0.78),
  ];
  const deskGeo = new THREE.LatheGeometry(lathePoints, 32);
  const deskMesh = new THREE.Mesh(deskGeo, slateHullMat);
  deskMesh.castShadow = true;
  deskMesh.receiveShadow = true;
  root.add(deskMesh);
  disposables.push(deskGeo);

  // Part 5: Secondary Read — Amber Desk Rim Halo
  const rimGeo = new THREE.TorusGeometry(0.69, 0.02, 16, 48);
  rimGeo.rotateX(Math.PI / 2);
  const rimMesh = new THREE.Mesh(rimGeo, amberBrassMat);
  rimMesh.position.y = 0.76;
  root.add(rimMesh);
  disposables.push(rimGeo);

  // Part 6: Central Column Supporting the Editorial Globe
  const pillarGeo = new THREE.CylinderGeometry(0.11, 0.16, 0.48, 24);
  const pillarMesh = new THREE.Mesh(pillarGeo, darkChromeMat);
  pillarMesh.position.y = 1.02;
  root.add(pillarMesh);
  disposables.push(pillarGeo);

  // Part 7 & 8: Globe Group (Geodesic Globe Sphere + Tilted Meridian Calibration Ring)
  const globeGroup = new THREE.Group();
  globeGroup.position.set(0, 1.48, 0);

  const sphereGeo = new THREE.SphereGeometry(0.34, 32, 24);
  const sphereMesh = new THREE.Mesh(sphereGeo, globeMat);
  sphereMesh.castShadow = true;
  globeGroup.add(sphereMesh);

  const meridianGeo = new THREE.TorusGeometry(0.42, 0.016, 16, 48);
  const meridianMesh = new THREE.Mesh(meridianGeo, amberBrassMat);
  meridianMesh.rotation.z = 0.41; // 23.5 deg axial tilt
  globeGroup.add(meridianMesh);

  root.add(globeGroup);
  disposables.push(sphereGeo, meridianGeo);

  // Part 9: Accent Detail — Three Scope Beacon Columns (Local, State, National) on Desk Surface
  const beaconGeo = new THREE.CylinderGeometry(0.035, 0.035, 0.22, 16);
  const beaconAngles = [-0.65, 0, 0.65];
  for (const angle of beaconAngles) {
    const beacon = new THREE.Mesh(beaconGeo, amberBrassMat);
    beacon.position.set(Math.sin(angle) * 0.52, 0.88, Math.cos(angle) * 0.52);
    root.add(beacon);
  }
  disposables.push(beaconGeo);

  // Part 10: Secondary Read — Parabolic Telemetry Receiver Dish on Side Arm
  const dishGroup = new THREE.Group();
  dishGroup.position.set(-0.55, 0.92, -0.25);
  const dishProfile = [
    new THREE.Vector2(0.01, 0),
    new THREE.Vector2(0.12, 0.03),
    new THREE.Vector2(0.2, 0.1),
  ];
  const dishGeo = new THREE.LatheGeometry(dishProfile, 20);
  const dishMesh = new THREE.Mesh(dishGeo, darkChromeMat);
  dishMesh.rotation.x = Math.PI / 3;
  dishGroup.add(dishMesh);
  root.add(dishGroup);
  disposables.push(dishGeo);

  return { root, globeGroup, dishGroup, disposables };
}

/**
 * XR Blocks Spatial Newsroom Script (`xb.Script`) with world-space `xb.UICard`
 * for Android XR / WebXR simulator previewing.
 */
export class NetraSpatialXRScript extends xb.Script {
  private kiosk?: ReturnType<typeof buildNewsroomKioskGroup>;
  private statusText?: xb.UIText;
  private card?: xb.UICard;
  private locationPref: LocationPreference;
  private articles: ArticleRecord[];

  constructor(locationPref: LocationPreference, articles: ArticleRecord[]) {
    super();
    this.locationPref = locationPref;
    this.articles = articles;
  }

  init() {
    const hemi = new THREE.HemisphereLight(0xdbeafe, 0x0b132b, 2.2);
    this.add(hemi);

    const keyLight = new THREE.DirectionalLight(0xfffbeb, 2.6);
    keyLight.position.set(2.5, 4.5, 2.0);
    this.add(keyLight);

    this.kiosk = buildNewsroomKioskGroup(1);
    this.kiosk.root.position.set(0, 0, -1.65);
    this.kiosk.root.scale.setScalar(0.68);
    this.add(this.kiosk.root);

    this.statusText = new xb.UIText({
      text: `स्थान: ${this.locationPref.cityLabelHi} (${this.locationPref.selectionMode.toUpperCase()})`,
      style: { fontSize: 18, color: '#fbbf24', textAlign: 'center' },
    });

    const itemLines =
      this.articles.length > 0
        ? this.articles
            .slice(0, 3)
            .map((a, idx) => `${idx + 1}. [${a.publisher}] ${a.titleHi}`)
            .join('\n')
        : 'कोई सत्यापित लाइव समाचार उपलब्ध नहीं है (Empty Verified Feed).';

    this.card = new xb.UICard({
      size: { width: 0.72, height: 'auto' },
      manipulation: true,
      edge: true,
      style: {
        flexDirection: 'column',
        gap: 14,
        padding: 22,
        backgroundColor: '#0b132b',
        borderRadius: 20,
      },
      children: [
        new xb.UIText({
          text: 'NETRA NEWS — नेत्र न्यूज़ (XR Kiosk)',
          style: { fontSize: 28, fontWeight: 'bold', color: '#ffffff', textAlign: 'center' },
        }),
        this.statusText,
        new xb.UIText({
          text: itemLines,
          style: {
            fontSize: 16,
            lineHeight: 1.35,
            color: '#e2e8f0',
            whiteSpace: 'pre-line',
          },
        }),
        new xb.UIPanel({
          style: { width: '100%', flexDirection: 'row', gap: 12 },
          children: [
            new xb.UIButton({
              label: 'Local + State',
              icon: 'location_on',
              style: { flexGrow: 1 },
              onClick: () => {
                if (this.statusText) {
                  this.statusText.text = `सक्रिय फ़िल्टर: ${this.locationPref.cityLabelHi} (Local + State)`;
                }
              },
            }),
            new xb.UIButton({
              label: 'Rotate Globe',
              icon: 'public',
              style: { flexGrow: 1 },
              onClick: () => {
                if (this.kiosk) {
                  this.kiosk.globeGroup.rotation.y += Math.PI / 3;
                }
              },
            }),
          ],
        }),
      ],
    });

    this.card.position.set(0, 1.45, -1.15);
    this.add(this.card);
  }

  update() {
    if (this.kiosk) {
      this.kiosk.globeGroup.rotation.y += 0.004;
    }
  }

  dispose() {
    if (this.kiosk) {
      for (const d of this.kiosk.disposables) {
        d.dispose();
      }
    }
  }
}

/**
 * Embedded Three.js Studio PBR Viewport controller for the on-page Spatial Newsroom Preview.
 * Respects `isSoftwareGl` on-demand rendering and automatically suspends when PowerTier !== 'Normal'.
 */
export class EmbeddedNewsroomViewport {
  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private controls: OrbitControls | null = null;
  private kiosk: ReturnType<typeof buildNewsroomKioskGroup> | null = null;
  private isSoftwareGl = true;
  private renderBusy = false;
  private renderDirty = false;
  private frameId = 0;
  private targetRotationY = 0.4;
  private currentRotationY = 0.4;

  mount(container: HTMLElement, tier: PowerTier): void {
    this.dispose();
    if (tier !== 'Normal') {
      return;
    }

    this.isSoftwareGl = detectSoftwareGl();
    const width = Math.max(280, container.clientWidth || 640);
    const height = Math.max(220, container.clientHeight || 320);

    const renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'low-power',
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.setPixelRatio(this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = !this.isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x080f22);
    scene.fog = new THREE.FogExp2(0x080f22, 0.14);

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    pmremGenerator.dispose();

    const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 30);
    camera.position.set(0, 1.85, 3.1);

    const hemiLight = new THREE.HemisphereLight(0x93c5fd, 0x0b132b, 1.8);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfef3c7, 2.4);
    keyLight.position.set(2.5, 4.0, 2.5);
    keyLight.castShadow = !this.isSoftwareGl;
    keyLight.shadow.bias = -0.0005;
    scene.add(keyLight);

    const maxAniso = renderer.capabilities.getMaxAnisotropy();
    const kiosk = buildNewsroomKioskGroup(maxAniso);
    scene.add(kiosk.root);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0.95, 0);
    controls.enableDamping = !this.isSoftwareGl;
    controls.dampingFactor = 0.08;
    controls.minDistance = 1.6;
    controls.maxDistance = 5.5;
    controls.maxPolarAngle = Math.PI / 2 - 0.04;
    controls.addEventListener('change', () => this.requestRender());

    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.controls = controls;
    this.kiosk = kiosk;

    this.requestRender();
  }

  rotateGlobeStep(deltaRad: number = Math.PI / 4): void {
    this.targetRotationY += deltaRad;
    this.currentRotationY = this.targetRotationY;
    if (this.kiosk) {
      this.kiosk.globeGroup.rotation.y = this.currentRotationY;
    }
    this.requestRender();
  }

  setCameraPreset(preset: 'front' | 'top' | 'side'): void {
    if (!this.camera || !this.controls) return;
    if (preset === 'front') {
      this.camera.position.set(0, 1.85, 3.1);
    } else if (preset === 'top') {
      this.camera.position.set(0, 3.3, 1.8);
    } else {
      this.camera.position.set(2.6, 1.6, 1.9);
    }
    this.controls.target.set(0, 0.95, 0);
    this.controls.update();
    this.requestRender();
  }

  requestRender(): void {
    if (!this.renderer || !this.scene || !this.camera) return;
    if (this.renderBusy) {
      this.renderDirty = true;
      return;
    }
    this.renderBusy = true;
    this.frameId = requestAnimationFrame(() => {
      this.renderDirty = false;
      if (!this.renderer || !this.scene || !this.camera) {
        this.renderBusy = false;
        return;
      }
      this.controls?.update();
      this.renderer.render(this.scene, this.camera);

      const done = () => {
        this.renderBusy = false;
        if (this.renderDirty) this.requestRender();
      };

      if (this.isSoftwareGl) {
        const gl = this.renderer.getContext() as WebGL2RenderingContext;
        if (gl && typeof gl.fenceSync === 'function') {
          const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
          gl.flush();
          const poll = () => {
            if (!sync) {
              done();
              return;
            }
            const state = gl.getSyncParameter(sync, gl.SYNC_STATUS);
            if (state === gl.UNSIGNALED) {
              this.frameId = window.setTimeout(poll, 5);
            } else {
              gl.deleteSync(sync);
              this.frameId = window.setTimeout(done, 80);
            }
          };
          this.frameId = window.setTimeout(poll, 5);
        } else {
          this.frameId = window.setTimeout(done, 80);
        }
      } else {
        done();
      }
    });
  }

  dispose(): void {
    if (this.frameId) {
      cancelAnimationFrame(this.frameId);
      clearTimeout(this.frameId);
      this.frameId = 0;
    }
    this.controls?.dispose();
    if (this.kiosk) {
      for (const d of this.kiosk.disposables) {
        d.dispose();
      }
    }
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer.domElement.remove();
    }
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.controls = null;
    this.kiosk = null;
    this.renderBusy = false;
    this.renderDirty = false;
  }
}

let xrInitialized = false;

export async function launchFullWebXRSession(
  locationPref: LocationPreference,
  articles: ArticleRecord[]
): Promise<void> {
  if (xrInitialized) return;
  xrInitialized = true;
  const options = new xb.Options();
  options.setAppTitle('NETRA NEWS XR');
  options.setAppDescription('Spatial Newspaper & Verified Civic Reference');
  xb.add(new NetraSpatialXRScript(locationPref, articles));
  await xb.init(options);
}
