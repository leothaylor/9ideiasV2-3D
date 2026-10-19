import { createKnowledgeGraph, disposeNode, applyHighlight, frameNodes } from './graph.js';
import { createNode, resetIdCounter, CATEGORY_LABELS } from './data.js';
import { exportGraphData, snapshotGraphData, parseJsonImport, parseMarkdownImport, mergeGraphData } from './io.js';
import {
  renderLegend, renderTagList, setupAddDialog, setupImportFlow,
  setupExportButton, setupResetButton, setupMobilePanelToggle,
} from './ui.js';

const STORAGE_KEY = 'mapa-knowledge-3d-v1';
const container = document.getElementById('canvas-box');
const emptyHint = document.getElementById('empty-hint');
const inspector = document.getElementById('node-inspector');
const searchInput = document.getElementById('node-search');
const searchFeedback = document.getElementById('search-feedback');
const depthSelect = document.getElementById('depth-select');
const connectTarget = document.getElementById('connect-target');
const connectButton = document.getElementById('btn-connect');
const activeTags = new Set();

let graph = createKnowledgeGraph(container);
let currentData = { nodes: [], links: [] };
let selectedId = null;
let frameOnNextStop = false;
let saveTimer = null;

renderLegend();
setupMobilePanelToggle();

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshotGraphData(currentData)));
  } catch (error) {
    console.warn('Não foi possível salvar os dados localmente.', error);
    searchFeedback.textContent = 'Armazenamento indisponível. Exporte um JSON para guardar seus dados.';
  }
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persist, 450);
}

graph.onEngineStop(() => {
  if (frameOnNextStop) {
    frameOnNextStop = false;
    frameNodes(graph, currentData.nodes, 500);
  }
  scheduleSave();
});
graph.onNodeDragEnd(() => scheduleSave());
graph.onNodeClick(node => selectNode(node.id));

async function loadInitialData() {
  let restored = null;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) restored = parseJsonImport(saved);
  } catch (error) {
    console.warn('Backup local inválido; carregando conjunto de exemplo.', error);
  }
  if (restored) {
    setGraphData(restored);
    return;
  }
  try {
    const response = await fetch('data/exemplo.json');
    if (!response.ok) throw new Error('Arquivo de exemplo indisponível.');
    const text = await response.text();
    setGraphData(parseJsonImport(text));
  } catch (error) {
    console.warn('Não foi possível carregar o exemplo.', error);
    setGraphData({ nodes: [], links: [] });
  }
}

function setGraphData(data) {
  // Copia somente os dados: não reutiliza meshes Three.js descartados no merge.
  const cleanData = snapshotGraphData(data);
  (currentData.nodes || []).forEach(node => {
    if (node.__threeObj) disposeNode(node.__threeObj);
  });
  data = cleanData;
  currentData = data;
  resetIdCounter(data.nodes);
  selectedId = data.nodes.some(node => node.id === selectedId) ? selectedId : null;
  frameOnNextStop = data.nodes.length > 1;
  graph.graphData(data);
  if (data.nodes.length) frameNodes(graph, data.nodes);
  emptyHint.hidden = data.nodes.length > 0;
  refreshTagList();
  updateInspector();
  scheduleSave();
}

function getNeighborIds(id, maxDepth = 1) {
  const adjacent = new Map(currentData.nodes.map(node => [node.id, new Set()]));
  currentData.links.forEach(link => {
    const from = typeof link.source === 'object' ? link.source.id : link.source;
    const to = typeof link.target === 'object' ? link.target.id : link.target;
    if (adjacent.has(from) && adjacent.has(to)) {
      adjacent.get(from).add(to);
      adjacent.get(to).add(from);
    }
  });
  const visited = new Set([id]);
  let frontier = [id];
  for (let i = 0; i < maxDepth; i++) {
    const next = [];
    frontier.forEach(current => {
      (adjacent.get(current) || []).forEach(other => {
        if (!visited.has(other)) { visited.add(other); next.push(other); }
      });
    });
    frontier = next;
    if (!frontier.length) break;
  }
  return visited;
}

function getImmediateNeighbors(id) {
  const neighbors = getNeighborIds(id, 1);
  neighbors.delete(id);
  return [...neighbors];
}

function refreshTagList() {
  renderTagList(currentData.nodes, activeTags, toggleTag);
  applyShowcase();
}

function toggleTag(tag) {
  if (activeTags.has(tag)) activeTags.delete(tag);
  else activeTags.add(tag);
  refreshTagList();
}

function applyShowcase() {
  let ids = null;
  if (selectedId) {
    ids = getNeighborIds(selectedId, Number(depthSelect.value) || 1);
  } else if (activeTags.size > 0) {
    ids = new Set(currentData.nodes
      .filter(node => (node.tags || []).some(tag => activeTags.has(tag)))
      .map(node => node.id));
  } else if (searchInput.value.trim()) {
    const q = searchInput.value.trim().toLocaleLowerCase('pt-BR');
    ids = new Set(currentData.nodes.filter(node =>
      [node.label, node.text, ...(node.tags || [])].join(' ').toLocaleLowerCase('pt-BR').includes(q)
    ).map(node => node.id));
  }
  applyHighlight(graph, ids || new Set(), selectedId);
}

function selectNode(id, fly = false) {
  const node = currentData.nodes.find(item => item.id === id);
  if (!node) return;
  selectedId = node.id;
  if (fly) {
    // 3D Force Graph ajusta a camera para a posição do nó sem alterar seus dados.
    const distance = Math.max(45, Math.min(125, Math.hypot(node.x || 0, node.y || 0, node.z || 0) * .35 + 52));
    const ratio = 1 + distance / Math.max(1, Math.hypot(node.x || 0, node.y || 0, node.z || 0));
    graph.cameraPosition(
      { x: (node.x || 0) * ratio + distance * .28, y: (node.y || 0) * ratio + distance * .16, z: (node.z || 0) * ratio + distance },
      { x: node.x || 0, y: node.y || 0, z: node.z || 0 },
      650
    );
  }
  updateInspector();
  applyShowcase();
  graph._pauseAutoRotate?.();
}

function clearSelection() {
  selectedId = null;
  inspector.hidden = true;
  applyShowcase();
}

function makeButton(label, onClick, title) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  if (title) b.title = title;
  b.addEventListener('click', onClick);
  return b;
}

function updateInspector() {
  const node = currentData.nodes.find(item => item.id === selectedId);
  inspector.hidden = !node;
  if (!node) return;
  document.getElementById('inspector-category').textContent = CATEGORY_LABELS[node.category] || 'Outra';
  document.getElementById('inspector-title').textContent = node.label || 'Sem título';
  document.getElementById('inspector-text').textContent = node.text || 'Sem descrição.';
  document.getElementById('inspector-tags').textContent = (node.tags || []).map(tag => '#' + tag).join('  ');

  const neighbors = getImmediateNeighbors(node.id);
  const list = document.getElementById('inspector-neighbors');
  list.replaceChildren();
  if (!neighbors.length) {
    const li = document.createElement('li');
    li.textContent = 'Nenhuma conexão registrada.';
    list.appendChild(li);
  }
  neighbors.forEach(id => {
    const item = currentData.nodes.find(n => n.id === id);
    if (!item) return;
    const li = document.createElement('li');
    li.appendChild(makeButton(item.label || 'Sem título', () => selectNode(id, true), 'Explorar este conceito'));
    li.appendChild(makeButton('×', () => disconnect(node.id, id), 'Remover esta conexão'));
    list.appendChild(li);
  });

  connectTarget.replaceChildren();
  const option = document.createElement('option');
  option.value = '';
  option.textContent = 'Escolha um conceito…';
  connectTarget.appendChild(option);
  currentData.nodes
    .filter(item => item.id !== node.id && !neighbors.includes(item.id))
    .sort((a, b) => (a.label || '').localeCompare(b.label || '', 'pt-BR'))
    .forEach(item => {
      const next = document.createElement('option');
      next.value = item.id;
      next.textContent = item.label || 'Sem título';
      connectTarget.appendChild(next);
    });
  connectButton.disabled = connectTarget.options.length < 2;
}

function updateLinks(nextLinks) {
  // Use objetos simples para não incluir os estados internos da simulação.
  const snapshot = snapshotGraphData(currentData);
  snapshot.links = nextLinks;
  setGraphData(snapshot);
  if (selectedId) selectNode(selectedId);
}

function connect(source, target) {
  if (!source || !target || source === target) return;
  const links = snapshotGraphData(currentData).links;
  const exists = links.some(link =>
    (link.source === source && link.target === target) || (link.source === target && link.target === source)
  );
  if (!exists) updateLinks([...links, { source, target }]);
}

function disconnect(source, target) {
  const links = snapshotGraphData(currentData).links.filter(link =>
    !((link.source === source && link.target === target) || (link.source === target && link.target === source))
  );
  updateLinks(links);
}

document.getElementById('btn-inspector-close').addEventListener('click', clearSelection);
document.getElementById('btn-show-all').addEventListener('click', () => {
  searchInput.value = '';
  activeTags.clear();
  clearSelection();
  refreshTagList();
  frameNodes(graph, currentData.nodes, 450);
});
document.getElementById('btn-frame').addEventListener('click', () => frameNodes(graph, currentData.nodes, 450));
depthSelect.addEventListener('change', applyShowcase);
connectButton.addEventListener('click', () => {
  if (!selectedId || !connectTarget.value) return;
  connect(selectedId, connectTarget.value);
});
searchInput.addEventListener('input', () => {
  const q = searchInput.value.trim().toLocaleLowerCase('pt-BR');
  const matches = q ? currentData.nodes.filter(node =>
    [node.label, node.text, ...(node.tags || [])].join(' ').toLocaleLowerCase('pt-BR').includes(q)
  ) : [];
  searchFeedback.textContent = q ? matches.length + (matches.length === 1 ? ' conceito encontrado' : ' conceitos encontrados') : '';
  if (selectedId && q) clearSelection();
  applyShowcase();
});
searchInput.addEventListener('keydown', event => {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  const q = searchInput.value.trim().toLocaleLowerCase('pt-BR');
  if (!q) return;
  const match = currentData.nodes.find(node =>
    [node.label, node.text, ...(node.tags || [])].join(' ').toLocaleLowerCase('pt-BR').includes(q)
  );
  if (match) selectNode(match.id, true);
});

setupAddDialog(formData => {
  const node = createNode(formData);
  const wasEmpty = currentData.nodes.length === 0;
  currentData.nodes.push(node);
  frameOnNextStop = true;
  graph.graphData(currentData);
  if (wasEmpty) frameNodes(graph, currentData.nodes);
  emptyHint.hidden = false;
  refreshTagList();
  selectNode(node.id);
  scheduleSave();
});

setupExportButton(() => exportGraphData(currentData));

setupImportFlow({
  onParseFile: (filename, fileText) => {
    if (filename.toLowerCase().endsWith('.json')) return parseJsonImport(fileText);
    return parseMarkdownImport(fileText);
  },
  onMerge: parsed => setGraphData(mergeGraphData(currentData, parsed, 'merge')),
  onReplace: parsed => setGraphData(mergeGraphData(currentData, parsed, 'replace')),
});

setupResetButton(() => {
  frameOnNextStop = true;
  if (typeof graph.d3ReheatSimulation === 'function') graph.d3ReheatSimulation();
});

window.addEventListener('resize', () => graph.width(container.clientWidth).height(container.clientHeight));
window.addEventListener('pagehide', () => {
  if (saveTimer) clearTimeout(saveTimer);
  persist();
});

loadInitialData();
