import { jitterPosition, resetIdCounter } from './data.js';

/** Exportação limpa: remove objetos Three.js e referências circulares da simulação. */
export function snapshotGraphData(graphData) {
  return {
    nodes: graphData.nodes.map(n => ({
      id: String(n.id),
      label: n.label,
      text: n.text,
      category: n.category,
      status: n.status,
      tags: Array.isArray(n.tags) ? [...n.tags] : [],
      x: Number.isFinite(n.x) ? n.x : undefined,
      y: Number.isFinite(n.y) ? n.y : undefined,
      z: Number.isFinite(n.z) ? n.z : undefined,
    })),
    links: graphData.links.map(l => ({
      source: String(typeof l.source === 'object' ? l.source.id : l.source),
      target: String(typeof l.target === 'object' ? l.target.id : l.target),
    })),
  };
}

export function exportGraphData(graphData) {
  const payload = snapshotGraphData(graphData);
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `mapa-knowledge-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Garante posição válida (jitter) para nós sem x/y/z ou em (0,0,0) coincidente. */
function ensurePositions(nodes, links) {
  const byId = new Map(nodes.map(n => [n.id, n]));
  nodes.forEach(n => {
    const hasPos = Number.isFinite(n.x) && Number.isFinite(n.y) && Number.isFinite(n.z);
    const isOrigin = hasPos && n.x === 0 && n.y === 0 && n.z === 0;
    if (!hasPos || isOrigin) {
      const neighborIds = links
        .filter(l => l.source === n.id || l.target === n.id)
        .map(l => (l.source === n.id ? l.target : l.source));
      const neighbors = neighborIds.map(id => byId.get(id)).filter(Boolean);
      const pos = jitterPosition(neighbors);
      n.x = pos.x; n.y = pos.y; n.z = pos.z;
    }
  });
  return nodes;
}

export function parseJsonImport(jsonText) {
  const data = JSON.parse(jsonText);
  const nodes = (data.nodes || []).map(n => ({
    id: String(n.id),
    label: n.label || 'Sem título',
    text: n.text || '',
    category: n.category || 'outra',
    status: n.status || 'pending',
    tags: Array.isArray(n.tags) ? n.tags : [],
    x: n.x, y: n.y, z: n.z,
  }));
  const links = (data.links || []).map(l => ({
    source: String(l.source),
    target: String(l.target),
  }));
  ensurePositions(nodes, links);
  return { nodes, links };
}

/**
 * Formato esperado:
 * [DATA] texto da ideia
 * tags: tag1, tag2, tag3
 */
export function parseMarkdownImport(text) {
  const lines = text.split(/\r?\n/);
  const entries = [];
  let current = null;
  const entryRe = /^\[(.+?)\]\s*(.*)$/;
  const tagsRe = /^tags:\s*(.*)$/i;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const entryMatch = line.match(entryRe);
    const tagsMatch = line.match(tagsRe);
    if (entryMatch) {
      if (current) entries.push(current);
      current = { date: entryMatch[1], text: entryMatch[2], tags: [] };
    } else if (tagsMatch && current) {
      current.tags = tagsMatch[1].split(',').map(t => t.trim()).filter(Boolean);
    } else if (current) {
      current.text += ' ' + line;
    }
  }
  if (current) entries.push(current);

  const nodes = entries.map((e, i) => ({
    id: `md-${Date.now()}-${i}`,
    label: e.text.slice(0, 40) + (e.text.length > 40 ? '…' : ''),
    text: e.text,
    category: 'outra',
    status: 'pending',
    tags: e.tags,
  }));

  const links = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const shared = nodes[i].tags.filter(t => nodes[j].tags.includes(t));
      if (shared.length >= 2) links.push({ source: nodes[i].id, target: nodes[j].id });
    }
  }

  ensurePositions(nodes, links);
  return { nodes, links };
}

/** Combina dados importados com os atuais (merge) ou substitui completamente. */
export function mergeGraphData(current, incoming, mode) {
  if (mode === 'replace') {
    resetIdCounter(incoming.nodes);
    return { nodes: incoming.nodes, links: incoming.links };
  }
  const existingIds = new Set(current.nodes.map(n => n.id));
  let nodes = [...current.nodes];
  incoming.nodes.forEach(n => {
    if (existingIds.has(n.id)) {
      nodes = nodes.map(existing => (existing.id === n.id ? { ...existing, ...n } : existing));
    } else {
      nodes.push(n);
    }
  });
  const linkKey = l => `${l.source}->${l.target}`;
  const existingLinkKeys = new Set(current.links.map(l => linkKey({
    source: typeof l.source === 'object' ? l.source.id : l.source,
    target: typeof l.target === 'object' ? l.target.id : l.target,
  })));
  const links = [...current.links];
  incoming.links.forEach(l => {
    if (!existingLinkKeys.has(linkKey(l))) links.push(l);
  });
  resetIdCounter(nodes);
  return { nodes, links };
}
