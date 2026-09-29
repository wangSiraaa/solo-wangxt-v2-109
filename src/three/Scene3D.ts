import * as THREE from 'three';
import type { ListenerState, Track, Vec3 } from '../types';
import { forwardVector } from '../lib/spatial';

interface SceneHandle {
  destroy: () => void;
  sync: (tracks: Track[], listener: ListenerState, selectedId: string | null) => void;
}

interface DragState {
  kind: 'source' | 'listener';
  trackId?: string;
  pointerId: number;
  /** 拖拽时约束的平面高度 */
  planeY: number;
}

/**
 * 3D 场景。世界坐标与 Web Audio 完全一致：
 * 右手系 +X 右（屏幕右）、+Y 上、+Z 朝向屏幕（听者身后）。
 * 相机默认从 +Z 看向 -Z，因此屏幕深处即听者“前方”。
 */
export function createScene(
  container: HTMLElement,
  callbacks: {
    onSelectSource: (id: string | null) => void;
    onMoveSource: (id: string, pos: Vec3) => void;
    onMoveListener: (pos: Vec3) => void;
  },
): SceneHandle {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#0e1116');

  const camera = new THREE.PerspectiveCamera(55, 1, 0.05, 200);
  const cameraOffset = new THREE.Vector3(0, 11.5, 13.5);
  camera.position.copy(cameraOffset);
  camera.lookAt(0, 0, 0);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  // ---------- 灯光 ----------
  const hemi = new THREE.HemisphereLight(0xbfd4ff, 0x202028, 1.1);
  scene.add(hemi);
  const dir = new THREE.DirectionalLight(0xffffff, 1.4);
  dir.position.set(6, 12, 8);
  dir.castShadow = true;
  dir.shadow.mapSize.set(1024, 1024);
  dir.shadow.camera.left = -15;
  dir.shadow.camera.right = 15;
  dir.shadow.camera.top = 15;
  dir.shadow.camera.bottom = -15;
  scene.add(dir);

  // ---------- 地面网格（-Z 半区标注“前”，+Z 半区标注“后”） ----------
  const GRID = 12;
  const grid = new THREE.GridHelper(GRID * 2, GRID * 2, 0x3a4252, 0x222833);
  (grid.material as THREE.Material).transparent = true;
  (grid.material as THREE.Material).opacity = 0.55;
  scene.add(grid);

  // 前/后/左/右地面标签（世界坐标固定含义）
  const labelMat = (text: string, color: string) => {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 128;
    const g = c.getContext('2d')!;
    g.fillStyle = color;
    g.font = 'bold 56px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 128, 64);
    const tex = new THREE.CanvasTexture(c);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    return new THREE.Sprite(mat);
  };
  const mkLabel = (text: string, pos: Vec3, color = '#8fa3bf') => {
    const s = labelMat(text, color);
    s.position.set(pos.x, pos.y, pos.z);
    s.scale.set(2.2, 1.1, 1);
    scene.add(s);
  };
  mkLabel('前 -Z', { x: 0, y: 0.2, z: -GRID + 1 }, '#7fd1ff');
  mkLabel('后 +Z', { x: 0, y: 0.2, z: GRID - 1 }, '#ffb37f');
  mkLabel('左 -X', { x: -GRID + 1, y: 0.2, z: 0 });
  mkLabel('右 +X', { x: GRID - 1, y: 0.2, z: 0 });

  // 坐标轴小指示（原点）：X 红，Y 绿，Z 蓝
  const axes = new THREE.AxesHelper(1.2);
  axes.position.set(-GRID + 0.6, 0.02, GRID - 0.6);
  scene.add(axes);

  // ---------- 听者 ----------
  const listenerGroup = new THREE.Group();
  // 圆锥“鼻子”指向本地 -Z；group 用 YXZ 欧拉，朝向与音频 listener 一致
  const bodyGeo = new THREE.ConeGeometry(0.32, 0.9, 24);
  bodyGeo.rotateX(-Math.PI / 2); // 圆锥默认 +Y，转为 -Z
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x223344 });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.z = -0.15;
  body.castShadow = true;
  listenerGroup.add(body);

  // 头部圆球
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.28, 24, 16),
    new THREE.MeshStandardMaterial({ color: 0xdfe8f5 }),
  );
  head.position.set(0, 0.42, 0.1);
  head.castShadow = true;
  listenerGroup.add(head);

  // 朝向辅助线
  const fwdLineGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0.32, -0.5),
    new THREE.Vector3(0, 0.32, -2.2),
  ]);
  const fwdLine = new THREE.Line(
    fwdLineGeo,
    new THREE.LineDashedMaterial({ color: 0x7fd1ff, dashSize: 0.2, gapSize: 0.15 }),
  );
  fwdLine.computeLineDistances();
  listenerGroup.add(fwdLine);
  scene.add(listenerGroup);

  // ---------- 声源 ----------
  interface SourceVisual {
    group: THREE.Group;
    sphere: THREE.Mesh;
    ring: THREE.Mesh;
    label: THREE.Sprite;
    trackId: string;
  }
  const sourceVisuals = new Map<string, SourceVisual>();

  function makeTextSprite(text: string, color: string): THREE.Sprite {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 128;
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, 512, 128);
    g.font = 'bold 44px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 8;
    g.strokeStyle = 'rgba(0,0,0,0.65)';
    g.strokeText(text, 256, 56);
    g.fillStyle = color;
    g.fillText(text, 256, 56);
    const tex = new THREE.CanvasTexture(c);
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }),
    );
    sprite.scale.set(2.6, 0.65, 1);
    return sprite;
  }

  function createSourceVisual(track: Track): SourceVisual {
    const group = new THREE.Group();
    const color = new THREE.Color(track.color);
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(0.3, 24, 16),
      new THREE.MeshStandardMaterial({
        color,
        emissive: color.clone().multiplyScalar(0.35),
        roughness: 0.4,
      }),
    );
    sphere.position.y = 0.3;
    sphere.castShadow = true;
    group.add(sphere);

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.46, 0.03, 10, 40),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.05;
    ring.visible = false;
    group.add(ring);

    const label = makeTextSprite(track.name, track.color);
    label.position.y = 0.95;
    group.add(label);

    group.position.set(track.position.x, track.position.y, track.position.z);
    group.userData.trackId = track.id;
    scene.add(group);
    return { group, sphere, ring, label, trackId: track.id };
  }

  function disposeVisual(v: SourceVisual) {
    scene.remove(v.group);
    v.group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        const m = o.material;
        if (Array.isArray(m)) m.forEach((x) => x.dispose());
        else m.dispose();
      }
    });
  }

  // ---------- 交互：射线拖拽 ----------
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hitPoint = new THREE.Vector3();
  let drag: DragState | null = null;
  let downPos: { x: number; y: number } | null = null;

  function setPointerFromEvent(e: PointerEvent) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  }

  function onPointerDown(e: PointerEvent) {
    setPointerFromEvent(e);
    raycaster.setFromCamera(pointer, camera);
    const spheres = [...sourceVisuals.values()].map((v) => v.sphere);
    const hitSphere = raycaster.intersectObjects(spheres, false)[0];
    if (hitSphere) {
      const v = [...sourceVisuals.values()].find((x) => x.sphere === hitSphere.object);
      if (!v) return;
      drag = { kind: 'source', trackId: v.trackId, pointerId: e.pointerId, planeY: v.group.position.y };
      dragPlane.constant = -drag.planeY;
      renderer.domElement.setPointerCapture(e.pointerId);
      callbacks.onSelectSource(v.trackId);
      downPos = { x: e.clientX, y: e.clientY };
      return;
    }
    const hitListener = raycaster.intersectObjects([body, head], false)[0];
    if (hitListener) {
      drag = {
        kind: 'listener',
        pointerId: e.pointerId,
        planeY: listenerGroup.position.y,
      };
      dragPlane.constant = -drag.planeY;
      renderer.domElement.setPointerCapture(e.pointerId);
      callbacks.onSelectSource(null);
      downPos = { x: e.clientX, y: e.clientY };
    }
  }

  function onPointerMove(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    setPointerFromEvent(e);
    raycaster.setFromCamera(pointer, camera);
    if (raycaster.ray.intersectPlane(dragPlane, hitPoint)) {
      const x = THREE.MathUtils.clamp(hitPoint.x, -GRID, GRID);
      const z = THREE.MathUtils.clamp(hitPoint.z, -GRID, GRID);
      if (drag.kind === 'source' && drag.trackId) {
        callbacks.onMoveSource(drag.trackId, { x, y: drag.planeY, z });
      } else if (drag.kind === 'listener') {
        callbacks.onMoveListener({ x, y: drag.planeY, z });
      }
    }
  }

  function onPointerUp(e: PointerEvent) {
    if (drag && e.pointerId === drag.pointerId) {
      try {
        renderer.domElement.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      drag = null;
    }
  }

  function onPointerClick(e: PointerEvent) {
    // 单击空白取消选择（拖拽结束的 click 忽略）
    if (downPos && Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y) > 4) return;
    setPointerFromEvent(e);
    raycaster.setFromCamera(pointer, camera);
    const anyHit = raycaster.intersectObjects(
      [
        ...[...sourceVisuals.values()].map((v) => v.sphere),
        body,
        head,
      ],
      false,
    )[0];
    if (!anyHit) callbacks.onSelectSource(null);
    downPos = null;
  }

  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  renderer.domElement.addEventListener('pointermove', onPointerMove);
  renderer.domElement.addEventListener('pointerup', onPointerUp);
  renderer.domElement.addEventListener('pointercancel', onPointerUp);
  renderer.domElement.addEventListener('click', onPointerClick);

  // ---------- 尺寸 ----------
  function resize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w === 0 || h === 0) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  // ---------- 渲染循环 ----------
  let raf = 0;
  const clock = new THREE.Clock();
  function animate() {
    raf = requestAnimationFrame(animate);
    const t = clock.getElapsedTime();
    for (const v of sourceVisuals.values()) {
      if (v.ring.visible) {
        v.ring.rotation.z = t * 0.8;
      }
    }
    renderer.render(scene, camera);
  }
  animate();

  // ---------- 状态同步 ----------
  let lastListener: ListenerState | null = null;

  function sync(tracks: Track[], listener: ListenerState, selectedId: string | null) {
    // 增删
    const seen = new Set(tracks.map((t) => t.id));
    for (const [id, v] of [...sourceVisuals.entries()]) {
      if (!seen.has(id)) {
        disposeVisual(v);
        sourceVisuals.delete(id);
      }
    }
    for (const track of tracks) {
      let v = sourceVisuals.get(track.id);
      if (!v) {
        v = createSourceVisual(track);
        sourceVisuals.set(track.id, v);
      }
      v.group.position.set(track.position.x, track.position.y, track.position.z);
      v.ring.visible = track.id === selectedId;
      const col = new THREE.Color(track.color);
      const muted = track.muted;
      (v.sphere.material as THREE.MeshStandardMaterial).color.set(muted ? 0x555a63 : track.color);
      (v.sphere.material as THREE.MeshStandardMaterial).emissive.set(
        muted ? 0x000000 : col.clone().multiplyScalar(0.35),
      );
    }

    if (!lastListener || listener !== lastListener) {
      listenerGroup.position.set(
        listener.position.x,
        listener.position.y,
        listener.position.z,
      );
      listenerGroup.rotation.order = 'YXZ';
      // Three.js 绕 +Y 正角是“向左转身”（-Z → -X），与本应用 yaw 正值右转的
      // 约定相反，因此取负。俯仰正负含义一致。
      listenerGroup.rotation.y = -listener.yaw;
      listenerGroup.rotation.x = listener.pitch;
      // 校验：圆锥前方应等于 forwardVector(yaw,pitch)
      void forwardVector(listener.yaw, listener.pitch);
      lastListener = listener;
    }
  }

  return {
    destroy() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('pointercancel', onPointerUp);
      renderer.domElement.removeEventListener('click', onPointerClick);
      for (const v of sourceVisuals.values()) disposeVisual(v);
      renderer.dispose();
      renderer.domElement.remove();
    },
    sync,
  };
}
