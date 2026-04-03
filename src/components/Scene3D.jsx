import { useEffect, useRef } from "react";
import * as THREE from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { makeCloudTex } from "../utils/cloudTexture";

const PLANET_ROTATION_X = -0.3;
const PLANET_ROTATION_Y = 1.2;
const PLANET_ROTATION_Z = 0.0;

const FBX_WARNING_PATTERNS = [
  /three\.fbxloader:\s.*map is not supported in three\.js,\s*skipping texture\./i,
  /three\.fbxloader:\s*vertex has more than 4 skinning weights assigned to vertex/i,
];
const FALLBACK_TEXTURE_DATA_URI =
  "data:image/gif;base64,R0lGODlhAQABAAAAACwAAAAAAQABAAA=";

// should ignore fbx warning: filter harmless FBX loader warnings (texture support, skinning weights)
function shouldIgnoreFbxWarning(args) {
  const message = args
    .map((arg) => {
      if (typeof arg === "string") return arg;
      if (arg instanceof Error) return arg.message;
      return String(arg);
    })
    .join(" ");

  return FBX_WARNING_PATTERNS.some((pattern) => pattern.test(message));
}

// should replace broken fbx texture url: detect if URL is image file that likely failed to load
function shouldReplaceBrokenFbxTextureUrl(url) {
  const normalized = String(url || "")
    .trim()
    .replace(/\\/g, "/");
  return /\.(?:png|jpe?g|webp|gif|bmp|tga|tif?f|dds)(?:\?.*)?$/i.test(
    normalized,
  );
}

// is null byte length fbx error: detect FBX loader crashes from null byteLength
function isNullByteLengthFbxError(err) {
  const message = String(err?.message || err || "").toLowerCase();
  return message.includes("bytelength") && message.includes("null");
}

// get fbx resource path: extract folder path from FBX URL for relative texture loading
function getFbxResourcePath(url) {
  const normalized = String(url || "").trim();
  if (!normalized) return "/";

  const withoutQuery = normalized.split("?")[0];
  const lastSlash = withoutQuery.lastIndexOf("/");
  if (lastSlash < 0) return "/";
  return `${withoutQuery.slice(0, lastSlash + 1)}`;
}

// dispose material: cleanup THREE.js material + all textures to prevent memory leaks
function disposeMaterial(material) {
  if (!material) return;

  const mats = Array.isArray(material) ? material : [material];
  for (const mat of mats) {
    for (const key of Object.keys(mat)) {
      const value = mat[key];
      if (value?.isTexture) {
        value.dispose();
      }
    }
    mat.dispose?.();
  }
}

// dispose scene object: recursively cleanup geometry + materials to prevent GPU memory leak
function disposeSceneObject(root) {
  root.traverse((child) => {
    if (child.geometry?.dispose) {
      child.geometry.dispose();
    }
    if (child.material) {
      disposeMaterial(child.material);
    }
  });
}

// make spring: physics spring (Hooke's law) for smooth animation easing of rotations, positions
function makeSpring(stiffness = 100, damping = 16) {
  return {
    pos: 0,
    vel: 0,
    target: 0,
    stiffness,
    damping,
    step(dt) {
      const f =
        -this.stiffness * (this.pos - this.target) - this.damping * this.vel;
      this.vel += f * dt;
      this.pos += this.vel * dt;
      return this.pos;
    },
    reset(v) {
      this.pos = v;
      this.vel = 0;
      this.target = v;
    },
  };
}

// 3D scene: THREE.js planet (FBX model) + cloud texture, rotation, orbit controls
// supports multiple scene modes (default, about, conclusion, not-found) with animations
export default function Scene3D({
  hasMessages,
  onReady,
  sceneMode = "default",
  sceneProgress = 0,
  sceneSpin = 0,
  hidePlanet = false,
}) {
  const isNotFoundMode = sceneMode === "not-found";
  const isConclusionMode = sceneMode === "conclusion";
  const isNotFoundLikeMode = isNotFoundMode || isConclusionMode;
  const isCinematicMode = sceneMode === "about" || isNotFoundLikeMode;

  const canvasRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const objectsToRotateRef = useRef([]);
  const currentRotationRef = useRef(0);
  const isReadyRef = useRef(false);

  const characterRef = useRef(null);
  const planetGroupRef = useRef(null);

  const camSpringX = useRef(makeSpring(70, 15));
  const charSpringX = useRef(makeSpring(80, 13));
  const charSpringY = useRef(makeSpring(55, 9));
  const planSpringX = useRef(makeSpring(75, 12));
  const planSpringY = useRef(makeSpring(50, 8));
  const rotSpring = useRef(makeSpring(60, 13));

  const charBaseY = useRef(-1.0);
  const planBaseY = useRef(0);
  const sceneProgressRef = useRef(0);
  const sceneSpinRef = useRef(0);
  const waveBoneRef = useRef(null);
  const waveRestQuatRef = useRef(null);

  // effect-block getrennt halten damit updates nicht gegeneinander laufen
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let isDisposed = false;
    let animationFrameId = null;

    const originalConsoleWarn = console.warn;
    const filteredConsoleWarn = (...args) => {
      if (shouldIgnoreFbxWarning(args)) return;
      originalConsoleWarn(...args);
    };
    let activeFbxWarnFilters = 0;
    const enableFbxWarnFilter = () => {
      if (activeFbxWarnFilters === 0) {
        console.warn = filteredConsoleWarn;
      }
      activeFbxWarnFilters += 1;
    };
    const disableFbxWarnFilter = () => {
      activeFbxWarnFilters = Math.max(0, activeFbxWarnFilters - 1);
      if (activeFbxWarnFilters === 0 && console.warn === filteredConsoleWarn) {
        console.warn = originalConsoleWarn;
      }
    };
    const restoreConsoleWarn = () => {
      activeFbxWarnFilters = 0;
      if (console.warn === filteredConsoleWarn) {
        console.warn = originalConsoleWarn;
      }
    };

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(
      45,
      window.innerWidth / window.innerHeight,
      0.1,
      800,
    );
    camera.position.set(0, 3.2, 7.8);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      canvas,
      alpha: true,
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.setClearColor(0x000000, 0.0);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enabled = false;

    const sunLight = new THREE.DirectionalLight(0xfff5d1, 3.2);
    sunLight.position.set(8, 10, 8);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.set(2048, 2048);
    sunLight.shadow.camera.near = 0.5;
    sunLight.shadow.camera.far = 30;
    sunLight.shadow.camera.left = -8;
    sunLight.shadow.camera.right = 8;
    sunLight.shadow.camera.top = 8;
    sunLight.shadow.camera.bottom = -8;
    scene.add(sunLight);

    const fillLight = new THREE.DirectionalLight(0xccddff, 1.5);
    fillLight.position.set(-5, 3, -5);
    scene.add(fillLight);

    scene.add(new THREE.AmbientLight(0x404060, 2.2));

    const planetGlow = new THREE.PointLight(
      0x88aaff,
      hidePlanet ? 1.0 : 2.8,
      15,
    );
    planetGlow.position.set(0, 0.8, 0);
    scene.add(planetGlow);

    const particleCount = 400;
    const particleGeo = new THREE.BufferGeometry();
    const particlePositions = new Float32Array(particleCount * 3);
    const particleColors = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount; i++) {
      const r = 3 + Math.random() * 4;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI * 2;
      particlePositions[i * 3] = Math.sin(theta) * Math.cos(phi) * r;
      particlePositions[i * 3 + 1] = Math.sin(theta) * Math.sin(phi) * r * 0.3;
      particlePositions[i * 3 + 2] = Math.cos(theta) * r;
      particleColors[i * 3] = 0.8 + Math.random() * 0.4;
      particleColors[i * 3 + 1] = 0.7 + Math.random() * 0.5;
      particleColors[i * 3 + 2] = 1.0;
    }
    particleGeo.setAttribute(
      "position",
      new THREE.BufferAttribute(particlePositions, 3),
    );
    particleGeo.setAttribute(
      "color",
      new THREE.BufferAttribute(particleColors, 3),
    );
    const particleMat = new THREE.PointsMaterial({
      size: 0.08,
      vertexColors: true,
      transparent: true,
      opacity: 0.4,
      blending: THREE.AdditiveBlending,
    });
    const particles = new THREE.Points(particleGeo, particleMat);
    scene.add(particles);

    const ER = 1.9;
    const conclusionPlanetScaleFactor = 0.74;
    const conclusionAtmosphereScaleFactor = 0.66;
    const atmosphereScale = isConclusionMode
      ? conclusionAtmosphereScaleFactor
      : 1;
    const PLAN_BASE_Y = -ER - 0.8;
    planBaseY.current = PLAN_BASE_Y;

    const planetGroup = new THREE.Group();
    planetGroup.position.set(0, PLAN_BASE_Y, 0);
    planetGroup.rotation.z = 0.38;
    scene.add(planetGroup);
    planetGroupRef.current = planetGroup;
    objectsToRotateRef.current.push(planetGroup);

    planSpringX.current.reset(0);
    planSpringY.current.reset(0);

    const texLoader = new THREE.TextureLoader();
    const fbxManager = new THREE.LoadingManager();
    fbxManager.setURLModifier((url) =>
      shouldReplaceBrokenFbxTextureUrl(url) ? FALLBACK_TEXTURE_DATA_URI : url,
    );
    const fbxLoader = new FBXLoader(fbxManager);
    // fallback bleibt drin, keine ahnung warum der loader hier manchmal einfach aussteigt :/
    const loadFbxViaFetchFallback = async (url) => {
      const candidates = [];
      const source = String(url || "").trim();
      if (source) {
        candidates.push(source);
        if (source.startsWith("/")) {
          candidates.push(source.slice(1));
        } else {
          candidates.push(`/${source}`);
        }
      }

      let lastErr = null;
      // Try each candidate URL path until one successfully loads the FBX binary data
      for (const candidate of candidates) {
        try {
          // Attempt to fetch FBX from this candidate path with cache bypass
          const response = await fetch(candidate, { cache: "no-store" });
          if (!response.ok) {
            throw new Error(
              `Failed to fetch FBX \"${candidate}\" (${response.status})`,
            );
          }

          // Convert response stream to ArrayBuffer (binary FBX data)
          const arrayBuffer = await response.arrayBuffer();
          // Guard against empty payloads which cause null bytelength errors
          if (!arrayBuffer || arrayBuffer.byteLength === 0) {
            throw new Error(`Empty FBX payload for \"${candidate}\"`);
          }

          // Parse FBX binary using THREE.js FBXLoader with correct resource path
          return fbxLoader.parse(arrayBuffer, getFbxResourcePath(candidate));
        } catch (err) {
          // Save error and try next candidate path
          lastErr = err;
        }
      }

      // All candidates failed
      throw lastErr || new Error(`Unable to load FBX: ${source}`);
    };

    // Wrapper for FBX loading with error recovery and warning suppression
    const loadFbx = (url, onLoad, onProgress, onError) => {
      enableFbxWarnFilter();
      let isResolved = false;

      // Ensure callback fires exactly once and cleanup happens
      const finish = (cb, value) => {
        if (isResolved) return;
        isResolved = true;
        disableFbxWarnFilter();
        if (isDisposed) return;
        cb?.(value);
      };

      // Handle FBX loading errors, with special case for null bytelength bug
      const handleError = (err) => {
        // If it's NOT the known null bytelength error, fail immediately
        if (!isNullByteLengthFbxError(err)) {
          finish(onError, err);
          return;
        }

        // Otherwise try fallback fetch-and-parse method
        loadFbxViaFetchFallback(url)
          .then((fbx) => finish(onLoad, fbx))
          .catch((fallbackErr) => finish(onError, fallbackErr));
      };

      try {
        fbxLoader.load(
          url,
          (fbx) => finish(onLoad, fbx),
          onProgress,
          handleError,
        );
      } catch (err) {
        handleError(err);
      }
    };
    let cloudMesh = null;
    let moonOrbit = null;
    let moonBody = null;

    if (!hidePlanet) {
      const planetTex = texLoader.load("/Texture_Planet.png");
      planetTex.encoding = THREE.sRGBEncoding;
      planetTex.wrapS = THREE.RepeatWrapping;
      planetTex.wrapT = THREE.RepeatWrapping;

      loadFbx(
        "/Planet.fbx",
        (fbx) => {
          const box = new THREE.Box3().setFromObject(fbx);
          const size = new THREE.Vector3();
          box.getSize(size);
          const maxDim = Math.max(size.x, size.y, size.z);
          const baseScale = (ER * 2) / maxDim;
          const scale = isNotFoundMode
            ? baseScale * 0.03
            : isConclusionMode
              ? baseScale * conclusionPlanetScaleFactor
              : baseScale;
          fbx.scale.setScalar(scale);
          const center = new THREE.Vector3();
          box.getCenter(center);
          fbx.position.sub(center.multiplyScalar(scale));
          if (isNotFoundMode) {
            fbx.position.add(new THREE.Vector3(0, -0.08, 0));
          }
          fbx.traverse((child) => {
            if (child.isMesh) {
              child.castShadow = child.receiveShadow = true;
              child.material = new THREE.MeshStandardMaterial({
                map: planetTex,
                roughness: 0.25,
                metalness: 0.6,
                emissive: new THREE.Color(0x112233),
                emissiveIntensity: 0.5,
                color: 0xffffff,
              });
            }
          });
          const pivot = new THREE.Group();
          pivot.rotation.x = PLANET_ROTATION_X;
          pivot.rotation.y = PLANET_ROTATION_Y;
          pivot.rotation.z = PLANET_ROTATION_Z;
          pivot.add(fbx);
          planetGroup.add(pivot);
        },
        undefined,
        (err) => console.error("Planet FBX error:", err),
      );

      if (!isNotFoundMode) {
        cloudMesh = new THREE.Mesh(
          new THREE.SphereGeometry((ER + 0.04) * atmosphereScale, 64, 64),
          new THREE.MeshStandardMaterial({
            map: makeCloudTex(),
            transparent: true,
            opacity: 0.5,
            roughness: 0.4,
            emissive: new THREE.Color(0x88aaff),
            emissiveIntensity: 0.3,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
          }),
        );
        planetGroup.add(cloudMesh);

        planetGroup.add(
          new THREE.Mesh(
            new THREE.SphereGeometry((ER + 0.15) * atmosphereScale, 48, 48),
            new THREE.MeshStandardMaterial({
              color: 0x1500ff,
              transparent: true,
              opacity: 0.1,
              side: THREE.BackSide,
              emissive: new THREE.Color(0x0013e3),
              emissiveIntensity: 0.3,
            }),
          ),
        );
      }

      if (isNotFoundLikeMode) {
        const moonTex = texLoader.load("/Texture_moon.jpg");
        moonTex.encoding = THREE.sRGBEncoding;

        loadFbx(
          "/moon.fbx",
          (moonFbx) => {
            moonOrbit = new THREE.Group();
            moonOrbit.position.set(0, 0, 0);
            moonOrbit.rotation.x = 0.34;
            planetGroup.add(moonOrbit);

            const box = new THREE.Box3().setFromObject(moonFbx);
            const size = new THREE.Vector3();
            box.getSize(size);
            const maxDim = Math.max(size.x, size.y, size.z, 0.001);
            const moonRadius = isConclusionMode ? 0.1 : 0.3;
            const scale = (moonRadius * 2) / maxDim;
            moonFbx.scale.setScalar(scale);

            const center = new THREE.Vector3();
            box.getCenter(center);
            moonFbx.position.sub(center.multiplyScalar(scale));
            const initialMoonDistance = isConclusionMode ? 5.2 : 1.95;
            moonFbx.position.set(initialMoonDistance, 0, 0);

            moonFbx.traverse((child) => {
              if (!child.isMesh) return;
              child.castShadow = child.receiveShadow = true;
              child.material = new THREE.MeshStandardMaterial({
                map: moonTex,
                color: 0xffffff,
                roughness: 0.9,
                metalness: 0.04,
                emissive: new THREE.Color(0x1b1f2b),
                emissiveIntensity: 0.1,
              });
            });

            moonOrbit.add(moonFbx);
            moonBody = moonFbx;
          },
          undefined,
          (err) => console.error("Moon FBX error:", err),
        );
      }
    }

    const NPART = 180;
    const pPh = new Float32Array(NPART);
    const pRad = new Float32Array(NPART);
    const pSpd = new Float32Array(NPART);
    const pH = new Float32Array(NPART);
    const pTilt = new Float32Array(NPART);
    const pColor = new Float32Array(NPART * 3);
    for (let i = 0; i < NPART; i++) {
      pRad[i] = ER + 0.25 + Math.random() * 1.2;
      pPh[i] = Math.random() * Math.PI * 2;
      pSpd[i] = 0.04 + Math.random() * 0.15;
      pH[i] = (Math.random() - 0.5) * 0.8;
      pTilt[i] = (Math.random() - 0.5) * 1.2;
      const cv = Math.random();
      if (cv < 0.33) {
        pColor[i * 3] = 0.9;
        pColor[i * 3 + 1] = 0.8;
        pColor[i * 3 + 2] = 1.0;
      } else if (cv < 0.66) {
        pColor[i * 3] = 0.7;
        pColor[i * 3 + 1] = 1.0;
        pColor[i * 3 + 2] = 0.9;
      } else {
        pColor[i * 3] = 1.0;
        pColor[i * 3 + 1] = 0.9;
        pColor[i * 3 + 2] = 0.7;
      }
    }
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(NPART * 3), 3),
    );
    pGeo.setAttribute("color", new THREE.BufferAttribute(pColor, 3));
    const pMat = new THREE.PointsMaterial({
      size: 0.022,
      vertexColors: true,
      transparent: true,
      opacity: 0.8,
      sizeAttenuation: true,
      blending: THREE.AdditiveBlending,
    });
    const partMesh = new THREE.Points(pGeo, pMat);
    partMesh.position.copy(planetGroup.position);
    scene.add(partMesh);
    objectsToRotateRef.current.push(partMesh);

    let headBone = null,
      origHeadQ = null;
    let curH = 0,
      curV = 0,
      curBH = 0,
      curBV = 0;
    const bodyLeanBones = [];
    const SMOOTH = 0.2,
      BS = 0.1;
    const B_BLEND = { Spine1: 0.28, Chest: 0.16 };
    const DEF_DOWN = (35 * Math.PI) / 180;
    const breathBones = [];
    const BC = 3.9,
      BAC = 0.4,
      BAS = 0.4,
      BAH = 0.03;
    const CK = [
      "chest",
      "spine1",
      "spine_1",
      "spine01",
      "upperchest",
      "upper_chest",
    ];
    const SK = ["spine", "pelvis", "hips", "root"];

    const ARM_POSE = {
      Shoulderr: { ax: new THREE.Vector3(0, 0, 1), ag: 0.2 },
      Shoulderl: { ax: new THREE.Vector3(0, 0, -1), ag: 0.2 },
      UpperArmr: { ax: new THREE.Vector3(0, 0, 1), ag: 1.22 },
      UpperArml: { ax: new THREE.Vector3(0, 0, -1), ag: 1.22 },
      LowerArmr: { ax: new THREE.Vector3(1, 0, 0), ag: 0.18 },
      LowerArml: { ax: new THREE.Vector3(1, 0, 0), ag: 0.18 },
      Thumbr: { ax: new THREE.Vector3(1, 0, 0), ag: -1.5 },
      Thumbl: { ax: new THREE.Vector3(1, 0, 0), ag: -1.5 },
    };

    const D_MIN = 40,
      D_MAX = 480;
    const MH = (25 * Math.PI) / 180;
    const MV = (15 * Math.PI) / 180;
    const DZ = (5 * Math.PI) / 180;
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    const mousePx = new THREE.Vector2(
      window.innerWidth / 2,
      window.innerHeight / 2,
    );

    const mouseMoveHandler = (e) => {
      mousePx.set(e.clientX, e.clientY);
      mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
      mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    };
    window.addEventListener("mousemove", mouseMoveHandler);

    const astroTex = texLoader.load("/AstronautColor.png");
    astroTex.encoding = THREE.sRGBEncoding;

    loadFbx(
      "/character.fbx",
      (fbx) => {
        fbx.scale.setScalar(0.026);
        fbx.position.set(0, charBaseY.current, 0);
        if (isCinematicMode) {
          fbx.visible = false;
        }

        // Setup character materials and discover animation bones
        fbx.traverse((child) => {
          // Apply standard material properties to all meshes (astro texture, metallic sheen)
          if (child.isMesh) {
            child.castShadow = child.receiveShadow = true;
            child.material = new THREE.MeshStandardMaterial({
              map: astroTex,
              color: 0xffffff,
              emissive: new THREE.Color(0x222222),
              emissiveIntensity: 0.05,
              roughness: 0.2,
              metalness: 0.6,
              skinning: !!child.isSkinnedMesh,
            });
          }
          // Find head bone and collect breathing animation bones (chest, spine, hip)
          if (child.isBone) {
            const n = child.name.toLowerCase();
            // Identify head bone by name matching (ignores "end" markers for bone tips)
            if (n.includes("head") && !n.includes("end")) headBone = child;
            // Categorize breathing bones: chest (CK), spine (SK)
            const isC = CK.some((k) => n.includes(k));
            const isS = !isC && SK.some((k) => n.includes(k));
            if (isC || isS) {
              // Hip gets larger amplitude than chest/spine for natural breathing look
              const isH =
                n.includes("hip") || n.includes("pelvis") || n.includes("root");
              breathBones.push({
                bone: child,
                restQ: null,
                amp: isH ? BAH : isC ? BAC : BAS,
                hip: isH,
              });
            }
          }
        });

        scene.add(fbx);
        characterRef.current = fbx;
        if (!isCinematicMode) {
          objectsToRotateRef.current.push(fbx);
        }

        // Apply arm idle pose and save wavearm bone for hand animation
        fbx.traverse((child) => {
          if (!child.isBone) return;
          // Apply predefined arm rotations to give character natural resting pose
          const p = ARM_POSE[child.name];
          if (p)
            child.quaternion.premultiply(
              new THREE.Quaternion().setFromAxisAngle(p.ax, p.ag),
            );
          // Save lower arms for waving animation application during talking
          if (child.name === "LowerArml" || child.name === "LowerArmr") {
            waveBoneRef.current = child;
          }
        });

        // Save rest quaternions for head tracking and animation blending
        if (headBone) {
          origHeadQ = headBone.quaternion.clone();
          // Apply default downward head tilt (DEF_DOWN) to initial pose
          origHeadQ = new THREE.Quaternion()
            .setFromAxisAngle(new THREE.Vector3(1, 0, 0), DEF_DOWN)
            .multiply(origHeadQ);
        }
        // Save waving arm bone rest rotation for blend-back on idle
        if (waveBoneRef.current) {
          waveRestQuatRef.current = waveBoneRef.current.quaternion.clone();
        }
        // Store rest quaternions of all breathing bones for animation amplitude scaling
        for (const e of breathBones) e.restQ = e.bone.quaternion.clone();
        // Discover body lean bones (torso tracking) and save blend factors(0-1)
        fbx.traverse((child) => {
          if (!child.isBone) return;
          const bl = B_BLEND[child.name];
          if (bl !== undefined)
            bodyLeanBones.push({
              bone: child,
              restQ: child.quaternion.clone(),
              bl,
            });
        });

        // Initialize character position physics springs to origin
        charSpringX.current.reset(0);
        charSpringY.current.reset(0);

        if (!isReadyRef.current) {
          isReadyRef.current = true;
          onReady?.();
        }
      },
      undefined,
      (err) => console.error("FBX:", err),
    );

    camSpringX.current.reset(0);
    rotSpring.current.reset(0);

    const _p = new THREE.Vector3();
    const moonWorldPos = new THREE.Vector3();
    const moonPrevWorldPos = new THREE.Vector3();
    const moonTravelDir = new THREE.Vector3();
    const cameraSideDir = new THREE.Vector3();
    const desiredMoonCamPos = new THREE.Vector3();
    const desiredMoonLook = new THREE.Vector3();
    const orbitDir = new THREE.Vector3();
    const cameraOffset = new THREE.Vector3();
    const cameraLookTarget = new THREE.Vector3();
    const worldUp = new THREE.Vector3(0, 1, 0);
    const fallbackMoonOffset = new THREE.Vector3(2.6, 0.12, 0);
    let moonFollowReady = false;
    let hasInitialNotFoundCameraPose = false;
    let notFoundCameraMode = "unset";

    function w2s(pos) {
      _p.copy(pos).project(camera);
      return new THREE.Vector2(
        (_p.x * 0.5 + 0.5) * window.innerWidth,
        (1 - (_p.y * 0.5 + 0.5)) * window.innerHeight,
      );
    }
    function breathCurve(t) {
      return Math.sin(t) + 0.18 * Math.sin(2 * t);
    }

    const clock = new THREE.Clock();
    let prevTime = 0;

    function animate() {
      // safety check: if cleanup happened, stop animation loop
      if (isDisposed) return;
      // recursively schedule next frame via browser's animation scheduler
      animationFrameId = requestAnimationFrame(animate);

      // get elapsed time since scene started (seconds)
      const el = clock.getElapsedTime();
      // calculate delta time (clamped to 50ms max to prevent big jumps when tab loses focus)
      const dt = Math.min(el - prevTime, 0.05);
      prevTime = el;

      // rotate cloud mesh continuously at different speeds for X and Y
      if (cloudMesh) {
        cloudMesh.rotation.y = el * 0.1; // slower rotation around Y (vertical)
        cloudMesh.rotation.x = el * 0.02; // very slow rotation around X (horizontal)
      }

      // handle moon orbital mechanics (varies by scene mode: not-found vs default)
      if (moonOrbit) {
        // conclusion mode: moon orbits in wide ellipse with up/down bobbing
        if (isNotFoundLikeMode && moonBody) {
          if (isConclusionMode) {
            // orbit parameters: slow orbit angle, elliptical radii, vertical bob
            const moonAngle = el * 0.06;
            const moonRadiusX = 5.8; // wider horizontal orbit
            const moonRadiusZ = 4.9; // wider depth orbit
            const moonLift = 0.55 + Math.sin(el * 0.22) * 0.18; // bobbing up/down

            // position moon on elliptical orbit with vertical animation
            moonBody.position.set(
              Math.cos(moonAngle) * moonRadiusX,
              moonLift,
              Math.sin(moonAngle) * moonRadiusZ,
            );
            // moon looks at specific point (above planet center)
            moonBody.lookAt(0, 0.2, 0);
            // slight tilt of moon orbit plane
            moonOrbit.rotation.z = Math.sin(el * 0.05) * 0.03;
          }
          // not-found mode: faster moon orbit, closer to planet
          else {
            const moonAngle = el * 0.2; // faster orbit
            const moonRadiusX = 1.95; // smaller horizontal orbit
            const moonRadiusZ = 1.65; // smaller depth orbit
            const moonLift = Math.sin(moonAngle * 0.5) * 0.12; // gentle bobbing

            moonBody.position.set(
              Math.cos(moonAngle) * moonRadiusX,
              moonLift,
              Math.sin(moonAngle) * moonRadiusZ,
            );
            moonBody.lookAt(0, 0, 0); // look at planet center
            moonOrbit.rotation.z = Math.sin(el * 0.08) * 0.05;
          }
        }
        // default mode: simple rotation around Y axis
        else {
          moonOrbit.rotation.y = el * 0.2;
        }
      }

      // moon self-rotation (spin on its axis)
      if (moonBody) {
        // conclusion mode: moon doesn't rotate on self, just orbits
        moonBody.rotation.y = isConclusionMode ? 0 : -el * 0.06;
      }

      // rotate particle background continuously
      particles.rotation.y += 0.001;

      // glow light intensity pulses slightly for cinematic effect
      // dim if planet hidden, otherwise use brighter baseline + sine oscillation
      planetGlow.intensity =
        (hidePlanet ? 0.8 : 2.4) + 0.25 * Math.sin(el * 0.8);

      // update particle system positions for orbiting effect around planet
      const pp = pGeo.attributes.position;
      // iterate each particle and update its position based on time
      for (let i = 0; i < NPART; i++) {
        // current angle = initial angle + speed * elapsed time (orbits continuously)
        const a = pPh[i] + el * pSpd[i];
        // convert spherical to cartesian: radius orbit around different axes
        pp.array[i * 3] = Math.cos(a) * pRad[i]; // X position
        pp.array[i * 3 + 1] =
          Math.sin(a) * Math.sin(pTilt[i]) * pRad[i] + pH[i]; // Y position (with tilt + height offset)
        pp.array[i * 3 + 2] = Math.sin(a) * Math.cos(pTilt[i]) * pRad[i]; // Z position
      }
      // signal graphics system that particle positions have been updated (requires re-render)
      pp.needsUpdate = true;
      // pulse particle opacity slightly (sync with breathing effect)
      pMat.opacity = 0.6 + 0.25 * Math.sin(el * 0.6);

      // animate character breathing: modulate chest and spine bones for realistic breathing
      if (breathBones.length > 0) {
        // compute breathing curve value: sine wave that cycles every BC seconds (3.9 seconds default)
        const bv = breathCurve((el / BC) * Math.PI * 2);
        // apply breathing rotation to each bone
        for (const e of breathBones) {
          if (!e.restQ) continue; // skip if no rest quaternion recorded
          // compute rotation angle: negate for hip bones (opposite direction), multiply by amplitude
          const ang = e.hip ? -bv * e.amp : bv * e.amp;
          // update bone quaternion: start from rest position, apply rotation around X axis (expansion/collapse)
          e.bone.quaternion
            .copy(e.restQ)
            .premultiply(
              new THREE.Quaternion().setFromAxisAngle(
                new THREE.Vector3(1, 0, 0),
                ang,
              ),
            );
        }
      }

      // update all matrices (positions, rotations propagated to children)
      scene.updateMatrixWorld();

      // head tracking: make character look toward mouse cursor (non-cinematic modes only)
      if (!isCinematicMode && headBone && origHeadQ) {
        // get world position of head bone in scene coordinates
        const hp = headBone.getWorldPosition(new THREE.Vector3());
        // project 3D head position to 2D screen coordinates
        const hs = w2s(hp);
        // measure distance from head to mouse on-screen (pixels)
        const dist = mousePx.distanceTo(hs);
        // compute gaze falloff: 1.0 near head, 0.0 far away (distance thresholds D_MIN to D_MAX)
        const gf = Math.pow(
          Math.max(0, Math.min(1, (dist - D_MIN) / (D_MAX - D_MIN))),
          0.65 /* power curve for non-linear falloff */,
        );

        // get camera forward direction for raycast
        const cd = camera.getWorldDirection(new THREE.Vector3());
        // setup raycaster from camera through mouse position
        raycaster.setFromCamera(mouse, camera);
        // check if raycaster direction is not parallel to camera direction
        const dn = raycaster.ray.direction.dot(cd);
        if (Math.abs(dn) > 1e-6) {
          // calculate intersection point of raycaster with camera plane
          const t2 = hp.clone().sub(raycaster.ray.origin).dot(cd) / dn;
          if (t2 >= 0) {
            // get 3D point where raycaster intersects camera plane
            const tp = raycaster.ray.at(t2, new THREE.Vector3());
            // calculate direction from head to target point
            const dir = new THREE.Vector3()
              .subVectors(tp, hp)
              .normalize()
              .negate();

            // decompose direction into horizontal (yaw) and vertical (pitch) angles
            const fl = Math.sqrt(
              dir.x ** 2 + dir.z ** 2,
            ); /* forward length for normalization */
            // horizontal angle (left-right): limited by range-of-motion and gaze falloff
            const ha = Math.atan2(dir.x, dir.z) * Math.min(1, (fl / 0.35) ** 2);
            // vertical angle (up-down): atan2 of up/forward components
            const va = Math.atan2(-dir.y, fl);

            // reduce head rotation range when body is rotated (rf = rotation falloff)
            const rf = 1 - (currentRotationRef.current / (Math.PI / 2)) * 0.6;

            // apply target head rotation with gaze falloff
            // tH: target horizontal rotation (yaw)
            const tH =
              Math.abs(ha) > DZ
                ? Math.sign(ha) * Math.min(Math.abs(ha), MH * rf) * gf
                : 0;
            // tV: target vertical rotation (pitch)
            const tV =
              Math.abs(va) > DZ
                ? Math.sign(va) * Math.min(Math.abs(va), MV * rf) * gf
                : 0;

            // smoothly interpolate current head rotation toward target (SMOOTH = 0.2)
            curH += (tH - curH) * SMOOTH;
            curV += (tV - curV) * SMOOTH;
            // smoothly interpolate body lean angles (BS = body smoothing = 0.1)
            curBH += (curH - curBH) * BS;
            curBV += (curV - curBV) * BS;

            // apply body lean to spine bones (reduces head tracking shoulder shrug)
            for (const e of bodyLeanBones) {
              // rotation around vertical axis (torso twist)
              const lH = new THREE.Quaternion().setFromAxisAngle(
                new THREE.Vector3(0, 1, 0),
                -curBH * e.bl, // e.bl = bone's lean blend factor
              );
              // rotation around horizontal axis (lean forward/back) - reduced by 50%
              const lV = new THREE.Quaternion().setFromAxisAngle(
                new THREE.Vector3(1, 0, 0),
                -curBV * e.bl * 0.5,
              );
              // apply both rotations to bone from its rest position
              e.bone.quaternion.copy(e.restQ).premultiply(lH.multiply(lV));
            }

            // apply head rotation: rotate head toward cursor
            const rH = new THREE.Quaternion().setFromAxisAngle(
              new THREE.Vector3(0, 1, 0),
              -curH, // rotate around vertical axis (yaw)
            );
            const rV = new THREE.Quaternion().setFromAxisAngle(
              new THREE.Vector3(1, 0, 0),
              -curV, // rotate around horizontal axis (pitch)
            );
            headBone.quaternion.copy(rH.multiply(rV).multiply(origHeadQ));
          }
        }
      }

      if (characterRef.current) {
        if (!isCinematicMode) {
          characterRef.current.position.x = charSpringX.current.step(dt);
          characterRef.current.position.y =
            charBaseY.current + charSpringY.current.step(dt);
        }
      }

      if (planetGroupRef.current) {
        if (isNotFoundMode) {
          const px = Math.sin(el * 0.06) * 0.14;
          const py = 1.92 + Math.sin(el * 0.09) * 0.06;
          const pz = -6.15 + Math.cos(el * 0.05) * 0.28;

          planetGroupRef.current.position.set(px, py, pz);
          partMesh.position.set(px, py, pz);
          planetGlow.position.set(px, py + 0.35, pz);
        } else if (isConclusionMode) {
          const px = Math.sin(el * 0.04) * 0.18;
          const py = 0.48 + Math.sin(el * 0.11) * 0.06;
          const pz = -2.85 + Math.cos(el * 0.05) * 0.14;

          planetGroupRef.current.position.set(px, py, pz);
          partMesh.position.set(px, py, pz);
          planetGlow.position.set(px, py + 0.25, pz - 0.1);
        } else {
          const px = planSpringX.current.step(dt);
          const py = planBaseY.current + planSpringY.current.step(dt);
          planetGroupRef.current.position.x = px;
          planetGroupRef.current.position.y = py;
          partMesh.position.x = px;
          partMesh.position.y = py;
        }
      }

      if (cameraRef.current) {
        // not-found und conclusion fahren eigene kamera choreo
        if (isNotFoundLikeMode && planetGroupRef.current) {
          const center = planetGroupRef.current.position;
          const nextNotFoundCameraMode = moonBody ? "moon" : "fallback";
          if (nextNotFoundCameraMode !== notFoundCameraMode) {
            hasInitialNotFoundCameraPose = false;
            if (nextNotFoundCameraMode === "moon") {
              moonFollowReady = false;
            }
            notFoundCameraMode = nextNotFoundCameraMode;
          }

          if (isConclusionMode) {
            /* conclusion mode: cinematic camera orbits planet on computed circular path */
            if (moonBody) {
              planetGroupRef.current.updateMatrixWorld(true);
              moonBody.getWorldPosition(moonWorldPos);
              /* orbit direction = vector from planet center to moon position */
              orbitDir.subVectors(moonWorldPos, center);
              if (orbitDir.lengthSq() < 1e-8) orbitDir.set(1, 0, 0);
              orbitDir.normalize();
            } else {
              /* fallback direction when moon missing */
              orbitDir.set(0.65, 0.12, 0.74).normalize();
            }

            const camOrbitAngle = el * 0.22;

            /* compute camera position on circular orbit: parametric sphere with time-based angle */
            /* oscillating orbit: cos for long-range, sine for vertical bob and depth sway */
            cameraOffset.set(
              Math.cos(camOrbitAngle) * 8.4,
              2.35 + Math.sin(el * 0.2) * 0.2,
              7.2 + Math.sin(camOrbitAngle * 0.7) * 1.1,
            );

            /* position = plan center + local offset, offset further along orbit direction (parallax effect) */
            desiredMoonCamPos
              .copy(center)
              .add(cameraOffset)
              .addScaledVector(orbitDir, -3.2);

            /* look target = planet center + slight elevation + offset along orbit direction */
            desiredMoonLook.copy(center);
            desiredMoonLook.y += 0.1;
            desiredMoonLook.addScaledVector(orbitDir, 0.12);

            if (!hasInitialNotFoundCameraPose) {
              /* first frame: snap to desired position instantly */
              cameraRef.current.position.copy(desiredMoonCamPos);
              cameraLookTarget.copy(desiredMoonLook);
              hasInitialNotFoundCameraPose = true;
            } else {
              /* smooth interpolation to new position (lerp with different rates for position vs look target) */
              cameraRef.current.position.lerp(desiredMoonCamPos, 0.08);
              cameraLookTarget.lerp(desiredMoonLook, 0.12);
            }
            cameraRef.current.lookAt(cameraLookTarget);
          } else if (moonBody) {
            /* moon-following camera: orbits perpendicular to moon's travel direction */
            planetGroupRef.current.updateMatrixWorld(true);
            moonBody.getWorldPosition(moonWorldPos);

            if (!moonFollowReady) {
              /* initialize look target as blend of moon position and planet center */
              moonPrevWorldPos.copy(moonWorldPos);
              cameraLookTarget.copy(moonWorldPos).lerp(center, 0.2);
              moonFollowReady = true;
            }

            /* compute orbit direction: where moon orbits around planet */
            orbitDir.subVectors(moonWorldPos, center);
            if (orbitDir.lengthSq() < 1e-8) orbitDir.set(1, 0, 0);
            orbitDir.normalize();

            /* compute moon travel direction: cross product creates perpendicular camera axis */
            moonTravelDir.subVectors(moonWorldPos, moonPrevWorldPos);
            if (moonTravelDir.lengthSq() < 1e-8) {
              /* fallback: if moon barely moved, use perpendicular to orbit */
              moonTravelDir.crossVectors(orbitDir, worldUp);
            }
            if (moonTravelDir.lengthSq() < 1e-8) {
              moonTravelDir.set(0, 0, 1);
            }
            moonTravelDir.normalize();

            /* side direction = cross product of orbit and travel vectors (right-hand rule for camera offset) */
            cameraSideDir.crossVectors(orbitDir, moonTravelDir);
            if (cameraSideDir.lengthSq() < 1e-8) {
              cameraSideDir.set(0, 1, 0);
            }
            cameraSideDir.normalize();

            /* position behind moon's travel direction (, ahead of orbit, slightly to side */
            desiredMoonCamPos
              .copy(moonWorldPos)
              .addScaledVector(moonTravelDir, -1.75)
              .addScaledVector(orbitDir, 0.42)
              .addScaledVector(cameraSideDir, 0.14);
            desiredMoonCamPos.y += 0.62 + Math.sin(el * 0.32) * 0.05;

            /* look at moon (with slight blend toward planet center) */
            desiredMoonLook
              .copy(moonWorldPos)
              .lerp(center, 0.22)
              .addScaledVector(moonTravelDir, 0.08);
            desiredMoonLook.y += 0.03;

            if (!hasInitialNotFoundCameraPose) {
              cameraRef.current.position.copy(desiredMoonCamPos);
              cameraLookTarget.copy(desiredMoonLook);
              hasInitialNotFoundCameraPose = true;
            } else {
              /* smooth follow with slightly faster position catch than look target */
              cameraRef.current.position.lerp(desiredMoonCamPos, 0.09);
              cameraLookTarget.lerp(desiredMoonLook, 0.14);
            }
            cameraRef.current.lookAt(cameraLookTarget);

            moonPrevWorldPos.copy(moonWorldPos);
          } else {
            moonWorldPos.copy(center).add(fallbackMoonOffset);

            desiredMoonCamPos.copy(moonWorldPos);
            cameraOffset.set(-1.5, 0.65, 1.25);
            desiredMoonCamPos.add(cameraOffset);
            cameraLookTarget.copy(moonWorldPos).lerp(center, 0.2);
            cameraLookTarget.y += 0.03;

            if (!hasInitialNotFoundCameraPose) {
              cameraRef.current.position.copy(desiredMoonCamPos);
              hasInitialNotFoundCameraPose = true;
            } else {
              cameraRef.current.position.lerp(desiredMoonCamPos, 0.08);
            }
            cameraRef.current.lookAt(cameraLookTarget);
          }
        } else {
          cameraRef.current.position.x = camSpringX.current.step(dt);
          if (isCinematicMode) {
            const p = sceneProgressRef.current;
            cameraRef.current.position.y =
              3.2 + Math.sin(p * Math.PI * 1.1) * 0.1;
            cameraRef.current.position.z = 8.1 - p * 0.18;
            cameraRef.current.lookAt(0, -0.55 + p * 0.12, 0);
          }
        }
      }

      if (!isNotFoundLikeMode) {
        const ry = rotSpring.current.step(dt);
        currentRotationRef.current = ry;
        for (const obj of objectsToRotateRef.current) {
          obj.rotation.y = ry;
        }
      }

      const gl = renderer.getContext();
      if (typeof gl?.isContextLost === "function" && gl.isContextLost()) {
        return;
      }

      renderer.render(scene, camera);
    }

    animate();

    // Update camera aspect and renderer size on window resize
    const handleResize = () => {
      if (isDisposed) return;
      // Recalc projection matrix with new viewport aspect ratio
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      // Apply new canvas resolution (prevents stretching on fullscreen changes)
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener("resize", handleResize);

    // Cleanup: stop animation loop, remove listeners, dispose THREE.js resources
    return () => {
      isDisposed = true;
      // Cancel pending animation frame to stop render loop
      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId);
      }
      // Detach all event listeners
      window.removeEventListener("mousemove", mouseMoveHandler);
      window.removeEventListener("resize", handleResize);
      // Dispose OrbitControls internal state and listeners
      controls.dispose();
      // Restore console.warn suppression (undo FBX loader warnings override)
      restoreConsoleWarn();

      // Recursively dispose all geometries, materials, textures in scene
      disposeSceneObject(scene);
      scene.clear();

      // Dispose WebGL framebuffers and rendering context
      renderer.renderLists.dispose();
      renderer.dispose();
    };
  }, []);

  // effect-block getrennt halten damit updates nicht gegeneinander laufen
  useEffect(() => {
    if (isNotFoundLikeMode) return;

    const CAM_X = -5;
    const ROT_Y = -Math.PI / 4;

    camSpringX.current.target = CAM_X;
    charSpringX.current.target = 0;
    planSpringX.current.target = 0;
    rotSpring.current.target = ROT_Y;

    charSpringY.current.target = 0;
    planSpringY.current.target = 0;
  }, [hasMessages, isNotFoundLikeMode]);

  // effect-block getrennt halten damit updates nicht gegeneinander laufen
  useEffect(() => {
    sceneProgressRef.current = sceneProgress;
    sceneSpinRef.current = sceneSpin;

    if (
      sceneMode !== "about" &&
      sceneMode !== "not-found" &&
      sceneMode !== "conclusion"
    )
      return;

    camSpringX.current.target = 0;
    rotSpring.current.target = isNotFoundLikeMode
      ? 0
      : sceneSpinRef.current * Math.PI;

    planSpringX.current.target = 0;
    planSpringY.current.target = isNotFoundMode
      ? 2.2
      : isConclusionMode
        ? 0.5
        : 2.6;
  }, [sceneMode, sceneProgress, sceneSpin]);

  return <canvas ref={canvasRef} id="three-canvas" />;
}
