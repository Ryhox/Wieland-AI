import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { makeCloudTex } from '../utils/cloudTexture';

const PLANET_ROTATION_X = -0.3;
const PLANET_ROTATION_Y = 1.2;
const PLANET_ROTATION_Z = 0.0;


function makeSpring(stiffness = 100, damping = 16) {
  return {
    pos: 0, vel: 0, target: 0, stiffness, damping,
    step(dt) {
      const f = -this.stiffness * (this.pos - this.target) - this.damping * this.vel;
      this.vel += f * dt;
      this.pos += this.vel * dt;
      return this.pos;
    },
    reset(v) { this.pos = v; this.vel = 0; this.target = v; }
  };
}

export default function Scene3D({ hasMessages, onReady }) {
  const canvasRef          = useRef(null);
  const sceneRef           = useRef(null);
  const cameraRef          = useRef(null);
  const objectsToRotateRef = useRef([]);
  const currentRotationRef = useRef(0);
  const isReadyRef         = useRef(false);

  const characterRef   = useRef(null);
  const planetGroupRef = useRef(null);

  const camSpringX  = useRef(makeSpring(70,  15));
  const charSpringX = useRef(makeSpring(80,  13));
  const charSpringY = useRef(makeSpring(55,   9));
  const planSpringX = useRef(makeSpring(75,  12));
  const planSpringY = useRef(makeSpring(50,   8));
  const rotSpring   = useRef(makeSpring(60,  13));

  const charBaseY = useRef(-1.0);
  const planBaseY = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 800);
    camera.position.set(0, 3.2, 7.8);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, canvas, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.setClearColor(0x000000, 0.0);

    new OrbitControls(camera, renderer.domElement).enabled = false;

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

    const planetGlow = new THREE.PointLight(0x88aaff, 2.8, 15);
    planetGlow.position.set(0, 0.8, 0);
    scene.add(planetGlow);

    const particleCount = 400;
    const particleGeo   = new THREE.BufferGeometry();
    const particlePositions = new Float32Array(particleCount * 3);
    const particleColors    = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount; i++) {
      const r = 3 + Math.random() * 4;
      const theta = Math.random() * Math.PI * 2;
      const phi   = Math.random() * Math.PI * 2;
      particlePositions[i*3]   = Math.sin(theta) * Math.cos(phi) * r;
      particlePositions[i*3+1] = Math.sin(theta) * Math.sin(phi) * r * 0.3;
      particlePositions[i*3+2] = Math.cos(theta) * r;
      particleColors[i*3]   = 0.8 + Math.random() * 0.4;
      particleColors[i*3+1] = 0.7 + Math.random() * 0.5;
      particleColors[i*3+2] = 1.0;
    }
    particleGeo.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
    particleGeo.setAttribute('color',    new THREE.BufferAttribute(particleColors, 3));
    const particleMat = new THREE.PointsMaterial({
      size: 0.08, vertexColors: true, transparent: true,
      opacity: 0.4, blending: THREE.AdditiveBlending,
    });
    const particles = new THREE.Points(particleGeo, particleMat);
    scene.add(particles);

    const ER = 1.9;
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
    const fbxLoader = new FBXLoader();

    const planetTex = texLoader.load('/Texture_Planet.png');
    planetTex.encoding = THREE.sRGBEncoding;
    planetTex.wrapS = THREE.RepeatWrapping;
    planetTex.wrapT = THREE.RepeatWrapping;

    fbxLoader.load('/Planet.fbx', (fbx) => {
      const box = new THREE.Box3().setFromObject(fbx);
      const size = new THREE.Vector3();
      box.getSize(size);
      const maxDim = Math.max(size.x, size.y, size.z);
      const scale  = (ER * 2) / maxDim;
      fbx.scale.setScalar(scale);
      const center = new THREE.Vector3();
      box.getCenter(center);
      fbx.position.sub(center.multiplyScalar(scale));
      fbx.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = child.receiveShadow = true;
          child.material = new THREE.MeshStandardMaterial({
            map: planetTex, roughness: 0.25, metalness: 0.6,
            emissive: new THREE.Color(0x112233), emissiveIntensity: 0.5, color: 0xffffff,
          });
        }
      });
      const pivot = new THREE.Group();
      pivot.rotation.x = PLANET_ROTATION_X;
      pivot.rotation.y = PLANET_ROTATION_Y;
      pivot.rotation.z = PLANET_ROTATION_Z;
      pivot.add(fbx);
      planetGroup.add(pivot);
    }, undefined, (err) => console.error('Planet FBX error:', err));

    const cloudMesh = new THREE.Mesh(
      new THREE.SphereGeometry(ER + 0.04, 64, 64),
      new THREE.MeshStandardMaterial({
        map: makeCloudTex(), transparent: true, opacity: 0.5, roughness: 0.4,
        emissive: new THREE.Color(0x88aaff), emissiveIntensity: 0.3,
        depthWrite: false, blending: THREE.AdditiveBlending,
      })
    );
    planetGroup.add(cloudMesh);

    planetGroup.add(new THREE.Mesh(
      new THREE.SphereGeometry(ER + 0.15, 48, 48),
      new THREE.MeshStandardMaterial({
        color: 0x1500ff, transparent: true, opacity: 0.10, side: THREE.BackSide,
        emissive: new THREE.Color(0x0013e3), emissiveIntensity: 0.3,
      })
    ));

    const NPART = 180;
    const pPh    = new Float32Array(NPART);
    const pRad   = new Float32Array(NPART);
    const pSpd   = new Float32Array(NPART);
    const pH     = new Float32Array(NPART);
    const pTilt  = new Float32Array(NPART);
    const pColor = new Float32Array(NPART * 3);
    for (let i = 0; i < NPART; i++) {
      pRad[i]  = ER + 0.25 + Math.random() * 1.2;
      pPh[i]   = Math.random() * Math.PI * 2;
      pSpd[i]  = 0.04 + Math.random() * 0.15;
      pH[i]    = (Math.random() - 0.5) * 0.8;
      pTilt[i] = (Math.random() - 0.5) * 1.2;
      const cv = Math.random();
      if (cv < 0.33)      { pColor[i*3]=0.9; pColor[i*3+1]=0.8; pColor[i*3+2]=1.0; }
      else if (cv < 0.66) { pColor[i*3]=0.7; pColor[i*3+1]=1.0; pColor[i*3+2]=0.9; }
      else                { pColor[i*3]=1.0; pColor[i*3+1]=0.9; pColor[i*3+2]=0.7; }
    }
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(NPART * 3), 3));
    pGeo.setAttribute('color',    new THREE.BufferAttribute(pColor, 3));
    const pMat = new THREE.PointsMaterial({
      size: 0.022, vertexColors: true, transparent: true,
      opacity: 0.8, sizeAttenuation: true, blending: THREE.AdditiveBlending,
    });
    const partMesh = new THREE.Points(pGeo, pMat);
    partMesh.position.copy(planetGroup.position);
    scene.add(partMesh);
    objectsToRotateRef.current.push(partMesh);

    let headBone = null, origHeadQ = null;
    let curH = 0, curV = 0, curBH = 0, curBV = 0;
    const bodyLeanBones = [];
    const SMOOTH = 0.20, BS = 0.1;
    const B_BLEND = { Spine1: 0.28, Chest: 0.16 };
    const DEF_DOWN = (35 * Math.PI) / 180;
    const breathBones = [];
    const BC = 3.9, BAC = 0.4, BAS = 0.4, BAH = 0.03;
    const CK = ['chest','spine1','spine_1','spine01','upperchest','upper_chest'];
    const SK = ['spine','pelvis','hips','root'];

    const ARM_POSE = {
      Shoulderr: { ax: new THREE.Vector3(0, 0,  1), ag:  0.2  },
      Shoulderl: { ax: new THREE.Vector3(0, 0, -1), ag:  0.2  },
      UpperArmr: { ax: new THREE.Vector3(0, 0,  1), ag:  1.22 },
      UpperArml: { ax: new THREE.Vector3(0, 0, -1), ag:  1.22 },
      LowerArmr: { ax: new THREE.Vector3(1, 0,  0), ag:  0.18 },
      LowerArml: { ax: new THREE.Vector3(1, 0,  0), ag:  0.18 },
      Thumbr:    { ax: new THREE.Vector3(1, 0,  0), ag: -1.5  },
      Thumbl:    { ax: new THREE.Vector3(1, 0,  0), ag: -1.5  },
    };

    const D_MIN = 40, D_MAX = 480;
    const MH = (25 * Math.PI) / 180;
    const MV = (15 * Math.PI) / 180;
    const DZ = (5  * Math.PI) / 180;
    const raycaster = new THREE.Raycaster();
    const mouse   = new THREE.Vector2();
    const mousePx = new THREE.Vector2(window.innerWidth / 2, window.innerHeight / 2);

    const mouseMoveHandler = (e) => {
      mousePx.set(e.clientX, e.clientY);
      mouse.x =  (e.clientX / window.innerWidth)  * 2 - 1;
      mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    };
    window.addEventListener('mousemove', mouseMoveHandler);

    const astroTex = texLoader.load('/AstronautColor.png');
    astroTex.encoding = THREE.sRGBEncoding;

    fbxLoader.load('/character.fbx', (fbx) => {
      fbx.scale.setScalar(0.026);
      fbx.position.set(0, charBaseY.current, 0);

      fbx.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = child.receiveShadow = true;
          child.material = new THREE.MeshStandardMaterial({
            map: astroTex, color: 0xffffff,
            emissive: new THREE.Color(0x222222), emissiveIntensity: 0.05,
            roughness: 0.2, metalness: 0.6, skinning: !!child.isSkinnedMesh,
          });
        }
        if (child.isBone) {
          const n = child.name.toLowerCase();
          if (n.includes('head') && !n.includes('end')) headBone = child;
          const isC = CK.some(k => n.includes(k));
          const isS = !isC && SK.some(k => n.includes(k));
          if (isC || isS) {
            const isH = n.includes('hip') || n.includes('pelvis') || n.includes('root');
            breathBones.push({ bone: child, restQ: null, amp: isH ? BAH : isC ? BAC : BAS, hip: isH });
          }
        }
      });

      scene.add(fbx);
      characterRef.current = fbx;
      objectsToRotateRef.current.push(fbx);

      fbx.traverse((child) => {
        if (!child.isBone) return;
        const p = ARM_POSE[child.name];
        if (p) child.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(p.ax, p.ag));
      });

      if (headBone) {
        origHeadQ = headBone.quaternion.clone();
        origHeadQ = new THREE.Quaternion()
          .setFromAxisAngle(new THREE.Vector3(1, 0, 0), DEF_DOWN)
          .multiply(origHeadQ);
      }
      for (const e of breathBones) e.restQ = e.bone.quaternion.clone();
      fbx.traverse((child) => {
        if (!child.isBone) return;
        const bl = B_BLEND[child.name];
        if (bl !== undefined) bodyLeanBones.push({ bone: child, restQ: child.quaternion.clone(), bl });
      });

      charSpringX.current.reset(0);
      charSpringY.current.reset(0);

      if (!isReadyRef.current) { isReadyRef.current = true; onReady?.(); }
    }, undefined, (err) => console.error('FBX:', err));

    camSpringX.current.reset(0);
    rotSpring.current.reset(0);

    const _p = new THREE.Vector3();
    function w2s(pos) {
      _p.copy(pos).project(camera);
      return new THREE.Vector2(
        (_p.x * 0.5 + 0.5) * window.innerWidth,
        (1 - (_p.y * 0.5 + 0.5)) * window.innerHeight
      );
    }
    function breathCurve(t) { return Math.sin(t) + 0.18 * Math.sin(2 * t); }

    const clock = new THREE.Clock();
    let prevTime = 0;

    function animate() {
      requestAnimationFrame(animate);
      const el = clock.getElapsedTime();
      const dt = Math.min(el - prevTime, 0.05);
      prevTime = el;

      cloudMesh.rotation.y = el * 0.1;
      cloudMesh.rotation.x = el * 0.02;
      particles.rotation.y += 0.001;
      planetGlow.intensity = 2.4 + 0.6 * Math.sin(el * 0.8);

      const pp = pGeo.attributes.position;
      for (let i = 0; i < NPART; i++) {
        const a = pPh[i] + el * pSpd[i];
        pp.array[i*3]   = Math.cos(a) * pRad[i];
        pp.array[i*3+1] = Math.sin(a) * Math.sin(pTilt[i]) * pRad[i] + pH[i];
        pp.array[i*3+2] = Math.sin(a) * Math.cos(pTilt[i]) * pRad[i];
      }
      pp.needsUpdate = true;
      pMat.opacity = 0.6 + 0.25 * Math.sin(el * 0.6);

      if (breathBones.length > 0) {
        const bv = breathCurve((el / BC) * Math.PI * 2);
        for (const e of breathBones) {
          if (!e.restQ) continue;
          const ang = e.hip ? -bv * e.amp : bv * e.amp;
          e.bone.quaternion.copy(e.restQ).premultiply(
            new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), ang)
          );
        }
      }

      scene.updateMatrixWorld();

      if (headBone && origHeadQ) {
        const hp  = headBone.getWorldPosition(new THREE.Vector3());
        const hs  = w2s(hp);
        const dist = mousePx.distanceTo(hs);
        const gf  = Math.pow(Math.max(0, Math.min(1, (dist - D_MIN) / (D_MAX - D_MIN))), 0.65);
        const cd  = camera.getWorldDirection(new THREE.Vector3());
        raycaster.setFromCamera(mouse, camera);
        const dn  = raycaster.ray.direction.dot(cd);
        if (Math.abs(dn) > 1e-6) {
          const t2 = hp.clone().sub(raycaster.ray.origin).dot(cd) / dn;
          if (t2 >= 0) {
            const tp  = raycaster.ray.at(t2, new THREE.Vector3());
            const dir = new THREE.Vector3().subVectors(tp, hp).normalize().negate();
            const fl  = Math.sqrt(dir.x ** 2 + dir.z ** 2);
            const ha  = Math.atan2(dir.x, dir.z) * Math.min(1, (fl / 0.35) ** 2);
            const va  = Math.atan2(-dir.y, fl);
            const rf  = 1 - (currentRotationRef.current / (Math.PI / 2)) * 0.6;
            const tH  = Math.abs(ha) > DZ ? Math.sign(ha) * Math.min(Math.abs(ha), MH * rf) * gf : 0;
            const tV  = Math.abs(va) > DZ ? Math.sign(va) * Math.min(Math.abs(va), MV * rf) * gf : 0;
            curH  += (tH  - curH)  * SMOOTH;
            curV  += (tV  - curV)  * SMOOTH;
            curBH += (curH - curBH) * BS;
            curBV += (curV - curBV) * BS;
            for (const e of bodyLeanBones) {
              const lH = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0), -curBH * e.bl);
              const lV = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0), -curBV * e.bl * 0.5);
              e.bone.quaternion.copy(e.restQ).premultiply(lH.multiply(lV));
            }
            const rH = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0), -curH);
            const rV = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0), -curV);
            headBone.quaternion.copy(rH.multiply(rV).multiply(origHeadQ));
          }
        }
      }

      if (cameraRef.current) {
        cameraRef.current.position.x = camSpringX.current.step(dt);
      }

    
      if (characterRef.current) {
        characterRef.current.position.x = charSpringX.current.step(dt);
        characterRef.current.position.y = charBaseY.current + charSpringY.current.step(dt);
      }

      if (planetGroupRef.current) {
        const px = planSpringX.current.step(dt);
        const py = planBaseY.current + planSpringY.current.step(dt);
        planetGroupRef.current.position.x = px;
        planetGroupRef.current.position.y = py;
        partMesh.position.x = px;
        partMesh.position.y = py;
      }

      const ry = rotSpring.current.step(dt);
      currentRotationRef.current = ry;
      for (const obj of objectsToRotateRef.current) {
        obj.rotation.y = ry;
      }

      renderer.render(scene, camera);
    }

    animate();

    const handleResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('mousemove', mouseMoveHandler);
      window.removeEventListener('resize', handleResize);
      renderer.dispose();
    };
  }, []);

  useEffect(() => {
    const CAM_X = -5;
    const ROT_Y = -Math.PI / 4;

    camSpringX.current.target = CAM_X;
    charSpringX.current.target = 0;
    planSpringX.current.target = 0;
    rotSpring.current.target = ROT_Y;

    charSpringY.current.target = 0;
    planSpringY.current.target = 0;
  }, [hasMessages]);

  return <canvas ref={canvasRef} id="three-canvas" />;
}