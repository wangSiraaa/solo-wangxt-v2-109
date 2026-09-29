import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { engine, RANGE_LIMIT } from '../audio/engine';
import { listenerForward } from '../audio/engine';

/**
 * 三维只读视图：每帧从引擎拉取声源/听者状态渲染。
 * 坐标系：Three.js 右手系，+X 向右、+Y 向上、+Z 朝南（屏幕前方），
 * 听者 yaw=0 时朝向 -Z（北方）。与 PannerNode / AudioListener 完全一致。
 */
export default function Scene3D() {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#0e131c');

    const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 200);
    camera.position.set(7, 7, 9);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 1.2, 0);
    controls.enableDamping = true;

    // 灯光
    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const dir = new THREE.DirectionalLight(0xffffff, 1.1);
    dir.position.set(6, 10, 4);
    scene.add(dir);

    // 地面网格（XZ 平面，1m 一格）
    const grid = new THREE.GridHelper(24, 24, 0x3a475c, 0x232d3d);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.7;
    scene.add(grid);

    // 坐标轴：X 红（东/右），Y 绿（上），Z 蓝（南）
    scene.add(new THREE.AxesHelper(1.2));

    const makeLabel = (text: string, color = '#cfd8e8') => {
      const canvas = document.createElement('canvas');
      canvas.width = 128;
      canvas.height = 64;
      const c = canvas.getContext('2d')!;
      c.font = 'bold 30px system-ui, sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillStyle = color;
      c.fillText(text, 64, 34);
      const tex = new THREE.CanvasTexture(canvas);
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }),
      );
      sprite.scale.set(0.9, 0.45, 1);
      return sprite;
    };

    // 听者组：八面体（头）+ 前向圆锥（鼻）+ L/R 标注
    const listenerGroup = new THREE.Group();
    const head = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.28, 0),
      new THREE.MeshStandardMaterial({ color: '#ffd166', emissive: '#5c4708' }),
    );
    const nose = new THREE.Mesh(
      new THREE.ConeGeometry(0.1, 0.32, 16),
      new THREE.MeshStandardMaterial({ color: '#ff8c42' }),
    );
    nose.rotation.x = -Math.PI / 2; // 圆锥尖朝 -Z
    nose.position.z = -0.28;
    const earL = new THREE.Mesh(
      new THREE.SphereGeometry(0.07, 12, 12),
      new THREE.MeshStandardMaterial({ color: '#49b6ff' }),
    );
    earL.position.set(-0.3, 0, 0);
    const earR = earL.clone();
    earR.material = new THREE.MeshStandardMaterial({ color: '#ff6b6b' });
    earR.position.x = 0.3;
    const labelL = makeLabel('L', '#49b6ff');
    labelL.position.set(-0.75, 0.55, 0);
    const labelR = makeLabel('R', '#ff6b6b');
    labelR.position.set(0.75, 0.55, 0);
    listenerGroup.add(head, nose, earL, earR, labelL, labelR);
    scene.add(listenerGroup);

    // 声源对象池
    interface SourceView {
      group: THREE.Group;
      sphere: THREE.Mesh;
      ring: THREE.Mesh;
      stem: THREE.Line;
      label: THREE.Sprite;
      id: string;
    }
    const views: SourceView[] = [];
    const sphereGeo = new THREE.SphereGeometry(0.22, 24, 24);

    const sync = () => {
      const tracks = engine.project.tracks;
      // 移除已删除的
      for (let i = views.length - 1; i >= 0; i--) {
        if (!tracks.some((t) => t.id === views[i].id)) {
          scene.remove(views[i].group);
          views.splice(i, 1);
        }
      }
      // 新增/更新
      tracks.forEach((t, idx) => {
        let v = views.find((x) => x.id === t.id);
        if (!v) {
          const group = new THREE.Group();
          const sphere = new THREE.Mesh(
            sphereGeo,
            new THREE.MeshStandardMaterial({
              color: new THREE.Color(t.color),
              emissive: new THREE.Color(t.color).multiplyScalar(0.25),
            }),
          );
          const ringMat = new THREE.MeshBasicMaterial({
            color: new THREE.Color(t.color),
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.35,
          });
          const ring = new THREE.Mesh(
            new THREE.RingGeometry(RANGE_LIMIT - 0.12, RANGE_LIMIT, 96),
            ringMat,
          );
          ring.rotation.x = -Math.PI / 2;
          const stemGeo = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(),
            new THREE.Vector3(),
          ]);
          const stem = new THREE.Line(
            stemGeo,
            new THREE.LineBasicMaterial({
              color: new THREE.Color(t.color),
              transparent: true,
              opacity: 0.4,
            }),
          );
          const label = makeLabel(`${idx + 1}`, t.color);
          label.position.y = 0.5;
          group.add(sphere, ring, stem, label);
          scene.add(group);
          v = { group, sphere, ring, stem, label, id: t.id };
          views.push(v);
        }
        v.group.position.set(t.position.x, t.position.y, t.position.z);
        const mat = v.sphere.material as THREE.MeshStandardMaterial;
        const dimmed = t.muted || (engine.project.tracks.some((s) => s.solo) && !t.solo);
        mat.opacity = dimmed ? 0.25 : 1;
        mat.transparent = dimmed;
        (v.label.material as THREE.SpriteMaterial).opacity = dimmed ? 0.3 : 1;
        // 到地面的高度投影线
        const posAttr = v.stem.geometry.getAttribute('position') as THREE.BufferAttribute;
        posAttr.setXYZ(0, 0, 0, 0);
        posAttr.setXYZ(1, 0, -t.position.y, 0);
        posAttr.needsUpdate = true;
        v.stem.position.y = 0;
        // 名称标签放在球上方（编号），轨道名在二维视图展示
        v.label.material.needsUpdate = true;
      });

      const l = engine.project.listener;
      listenerGroup.position.set(l.position.x, l.position.y, l.position.z);
      const f = listenerForward(l);
      const yaw = Math.atan2(-f.x, -f.z);
      listenerGroup.rotation.set(0, yaw, 0);
    };

    const resize = () => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / Math.max(h, 1);
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(mount);
    resize();

    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      sync();
      controls.update();
      renderer.render(scene, camera);
    };
    loop();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, []);

  return <div ref={mountRef} className="scene3d" />;
}
