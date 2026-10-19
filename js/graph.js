import * as THREE from 'three';
import ForceGraph3D from '3d-force-graph';
import { Text } from 'troika-three-text';
import { CATEGORY_COLORS, STATUS_COLORS } from './data.js';
import { addTouchHitbox } from './touch.js';

const AUTO_ROTATE_IDLE_MS = 4000;

export function disposeNode(obj) {
  if (!obj) return;
  obj.traverse(child => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      mats.forEach(m => {
        if (m.map) m.map.dispose();
        m.dispose();
      });
    }
    if (child.dispose) child.dispose();
  });
}

export function createKnowledgeGraph(container) {
  const graph = ForceGraph3D({ controlType: 'orbit' })(container)
    .backgroundColor('rgba(0,0,0,0)')
    .showNavInfo(false)
    .nodeRelSize(4.2)
    .nodeVal(n => 6 + Math.min(18, (n.label || '').length * 0.3))
    .nodeColor(n => CATEGORY_COLORS[n.category] || CATEGORY_COLORS.outra)
    .nodeLabel(n => `<div><strong>${escapeHtml(n.label)}</strong><br>${escapeHtml(n.text || '')}</div>`)
    .nodeOpacity(0.95)
    .linkColor(() => 'rgba(170,170,180,0.45)')
    .linkWidth(0.6)
    .linkCurvature(0.18)
    .nodeThreeObjectExtend(false)
    .nodeThreeObject(makeNodeObject);

  // Fog para profundidade (densidade recalculada em frameNodes conforme a escala real do grafo).
  const scene = graph.scene();
  scene.fog = new THREE.FogExp2(0x0c0d10, 0.01);

  // Física: forças contidas — nós sem conexão direta só se repelem até
  // distanceMax, então uma repulsão/distância muito altas fazem o cluster crescer
  // bem além do raio inicial usado para enquadrar a câmera, "esvaziando" a cena.
  graph.d3Force('charge').strength(-10).distanceMax(50);
  graph.d3Force('link').distance(10).strength(0.9);
  graph.cooldownTime(2500);

  // Auto-rotação suave quando ocioso.
  const controls = graph.controls();
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.6;
  let idleTimer = null;
  function pauseAutoRotate() {
    controls.autoRotate = false;
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { controls.autoRotate = true; }, AUTO_ROTATE_IDLE_MS);
  }
  container.addEventListener('pointerdown', pauseAutoRotate);
  container.addEventListener('wheel', pauseAutoRotate, { passive: true });

  graph._pauseAutoRotate = pauseAutoRotate;

  // Loop de render próprio: a lib pausa seu rAF interno quando a simulação de
  // física estabiliza (sem isso, reposicionamentos de câmera feitos via código —
  // como o reenquadramento em frameNodes — nunca chegam a ser desenhados, e o
  // autoRotate também para de avançar). Sempre cancelar antes de iniciar para
  // nunca duplicar o loop caso createKnowledgeGraph seja chamado de novo.
  if (graph._renderLoopId) cancelAnimationFrame(graph._renderLoopId);
  const renderer = graph.renderer();
  const camera = graph.camera();
  function renderLoop() {
    controls.update();
    renderer.render(scene, camera);
    graph._renderLoopId = requestAnimationFrame(renderLoop);
  }
  graph._renderLoopId = requestAnimationFrame(renderLoop);

  return graph;
}

function makeNodeObject(node) {
  const group = new THREE.Group();
  const radius = 2.3 + Math.min(2.5, (node.label || '').length * 0.05);

  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 24, 24),
    new THREE.MeshStandardMaterial({
      color: CATEGORY_COLORS[node.category] || CATEGORY_COLORS.outra,
      roughness: 0.5,
      metalness: 0.1,
      transparent: true,
      opacity: 1,
    })
  );
  group.add(sphere);

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(radius * 1.18, radius * 0.09, 8, 32),
    new THREE.MeshBasicMaterial({
      color: STATUS_COLORS[node.status] || STATUS_COLORS.pending,
      transparent: true,
      opacity: 0.9,
    })
  );
  ring.userData.isStatusRing = true;
  group.add(ring);

  const text = new Text();
  text.text = node.label || '';
  text.fontSize = radius * 0.62;
  text.color = 0xffffff;
  text.anchorX = 'center';
  text.anchorY = 'middle';
  text.position.set(0, radius + 1.6, 0);
  text.sync();
  group.add(text);

  addTouchHitbox(group, radius);

  group.userData.sphere = sphere;
  group.userData.ring = ring;
  group.userData.text = text;
  group.userData.baseOpacity = 1;
  return group;
}

/**
 * Posiciona a câmera para enquadrar o conjunto atual de nós.
 * A câmera padrão da lib fica a z=1000, muito distante da escala (~10-60 unidades)
 * usada pelo nosso layout/jitter — sem isso o grafo renderiza fora da vista útil.
 */
export function frameNodes(graph, nodes, durationMs = 0) {
  if (!nodes || nodes.length === 0) return;
  const cx = nodes.reduce((s, n) => s + (n.x || 0), 0) / nodes.length;
  const cy = nodes.reduce((s, n) => s + (n.y || 0), 0) / nodes.length;
  const cz = nodes.reduce((s, n) => s + (n.z || 0), 0) / nodes.length;
  const maxDist = Math.max(
    5,
    ...nodes.map(n => Math.hypot((n.x || 0) - cx, (n.y || 0) - cy, (n.z || 0) - cz))
  );
  const camDist = maxDist * 2.4 + 25;

  const fog = graph.scene().fog;
  if (fog) fog.density = 0.4 / camDist;

  graph.cameraPosition(
    { x: cx, y: cy, z: cz + camDist },
    { x: cx, y: cy, z: cz },
    durationMs
  );

  // OrbitControls guarda internamente a distância (spherical.radius) da última vez
  // que foi sincronizado (na criação, com a câmera a z=1000 padrão da lib). Sem
  // forçar update() aqui, o autoRotate usa esse radius antigo e "puxa" a câmera de
  // volta para ~1000 unidades de distância no primeiro tick, apagando a cena.
  const controls = graph.controls();
  if (controls) {
    controls.target.set(cx, cy, cz);
    if (durationMs <= 0) controls.update();
  }
}

/** Aplica modo "showcase": opacidade reduzida para nós fora do conjunto destacado. */
export function applyHighlight(graph, highlightIds, selectedId = null) {
  const spotlight = highlightIds && highlightIds.size > 0;
  graph.graphData().nodes.forEach(node => {
    const obj = node.__threeObj;
    if (!obj) return;
    const dim = spotlight && !highlightIds.has(node.id);
    const selected = selectedId === node.id;
    if (obj.userData.sphere) {
      obj.userData.sphere.material.opacity = dim ? 0.14 : 1;
      obj.userData.sphere.scale.setScalar(selected ? 1.33 : 1);
      obj.userData.sphere.material.emissive.setHex(selected ? 0x23324b : 0x000000);
    }
    if (obj.userData.ring) {
      obj.userData.ring.material.opacity = dim ? 0.08 : 0.9;
      obj.userData.ring.scale.setScalar(selected ? 1.28 : 1);
    }
    if (obj.userData.text) obj.userData.text.fillOpacity = dim ? 0.14 : 1;
  });

  const idOf = value => typeof value === 'object' ? value.id : value;
  graph.linkColor(link => {
    if (!spotlight) return 'rgba(170,170,180,0.45)';
    const source = idOf(link.source);
    const target = idOf(link.target);
    const focusEdge = selectedId && (source === selectedId || target === selectedId);
    if (focusEdge) return 'rgba(191,212,255,0.95)';
    return highlightIds.has(source) && highlightIds.has(target)
      ? 'rgba(175,190,216,0.72)'
      : 'rgba(118,127,148,0.055)';
  });
  graph.linkWidth(link => {
    if (!spotlight || !selectedId) return 0.65;
    return idOf(link.source) === selectedId || idOf(link.target) === selectedId ? 1.6 : 0.6;
  });
  graph.linkOpacity(1);
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
