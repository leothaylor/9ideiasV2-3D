/* Atlas — grafo 2D de conhecimento. Sem backend e sem dependências. */
const SVG_NS = 'http://www.w3.org/2000/svg';
const KEY = 'mapa-knowledge-atlas-v1';
const CATS = {
  bjj: { name: 'Jiu-jitsu', color: '#e28d76' },
  financeiro: { name: 'Financeiro', color: '#75a4ed' },
  negocio: { name: 'Negócios', color: '#d4b26e' },
  organizacao: { name: 'Organização', color: '#72c7ab' },
  ferramenta: { name: 'Ferramentas', color: '#ae9cf0' },
  outra: { name: 'Outros', color: '#b1bacb' }
};
const STATUSES = { pending: 'Pendente', progress: 'Em andamento', done: 'Concluído' };
const $ = id => document.getElementById(id);
let data = { nodes: [], links: [], layoutVersion: 2 };
let selected = null, hovered = null, search = '', categoryFilter = null, mode = 'all', depth = 1;
let camera = { x: 0, y: 0, z: 1 }, width = 900, height = 600;
let drag = null, moved = false, saveTimer = null;
const scene = $('scene'), world = $('world'), empty = $('empty');
const nodeMap = () => new Map(data.nodes.map(n => [n.id, n]));
const links = () => data.links.filter(l => data.nodes.some(n => n.id === l.source) && data.nodes.some(n => n.id === l.target));

function svg(tag, attrs, text) {
  const el = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs || {}).forEach(([key, value]) => el.setAttribute(key, String(value)));
  if (text !== undefined) el.textContent = text;
  return el;
}
function normalize(raw) {
  if (!raw || !Array.isArray(raw.nodes)) throw new Error('Arquivo incompatível: lista de nós ausente.');
  const nodes = raw.nodes.map((n, i) => ({
    id: String(n.id ?? ('n-' + i)), label: String(n.label || n.title || 'Sem título').slice(0, 100),
    text: String(n.text || n.description || ''), category: CATS[n.category] ? n.category : 'outra',
    status: STATUSES[n.status] ? n.status : 'pending',
    tags: Array.isArray(n.tags) ? n.tags.map(String) : [],
    x: Number.isFinite(Number(n.x)) && n.x != null ? Number(n.x) : undefined,
    y: Number.isFinite(Number(n.y)) && n.y != null ? Number(n.y) : undefined,
    z: Number.isFinite(Number(n.z)) ? Number(n.z) : 0
  }));
  const validIds = new Set(nodes.map(n => n.id));
  if (validIds.size !== nodes.length) throw new Error('O JSON contém IDs duplicados.');
  const cleanLinks = (raw.links || raw.edges || []).map(l => ({
    source: String(typeof l.source === 'object' ? l.source.id : l.source),
    target: String(typeof l.target === 'object' ? l.target.id : l.target)
  })).filter(l => validIds.has(l.source) && validIds.has(l.target) && l.source !== l.target);
  const seen = new Set();
  const finalLinks = cleanLinks.filter(l => {
    const key = [l.source, l.target].sort().join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { nodes, links: finalLinks, layoutVersion: raw.layoutVersion === 2 ? 2 : 0 };
}
function layoutGraph(force = false) {
  const nodes = data.nodes, n = nodes.length;
  if (!n) return;
  const maxAbs = Math.max(...nodes.flatMap(node => [Math.abs(node.x || 0), Math.abs(node.y || 0)]));
  const existing = !force && data.layoutVersion === 2 && nodes.every(node => Number.isFinite(node.x) && Number.isFinite(node.y));
  if (existing) return;
  const oldScale = maxAbs > 0 && maxAbs < 65 ? 61 : 1;
  nodes.forEach((node, i) => {
    if (Number.isFinite(node.x) && Number.isFinite(node.y) && !force) {
      node.x *= oldScale;
      node.y *= oldScale;
    } else {
      const a = i * 2.399963229728653;
      const r = 90 * Math.sqrt(i + 1);
      node.x = Math.cos(a) * r;
      node.y = Math.sin(a) * r;
    }
  });
  if (n < 2) { nodes[0].x = 0; nodes[0].y = 0; data.layoutVersion = 2; return; }
  const idx = new Map(nodes.map((node, i) => [node.id, i]));
  const edges = links().map(l => [idx.get(l.source), idx.get(l.target)]);
  const velocity = nodes.map(() => ({ x: 0, y: 0 }));
  const steps = n > 300 ? 65 : n > 90 ? 100 : 190;
  for (let t = 0; t < steps; t++) {
    const fx = new Float64Array(n), fy = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let dx = nodes[j].x - nodes[i].x, dy = nodes[j].y - nodes[i].y;
        const dsq = dx * dx + dy * dy + 144;
        const d = Math.sqrt(dsq), repulsion = 27500 / dsq;
        const vx = dx / d * repulsion, vy = dy / d * repulsion;
        fx[i] -= vx; fy[i] -= vy; fx[j] += vx; fy[j] += vy;
        // avoid collisions between visible labels in dense areas
        if (d < 108) {
          const extra = (108 - d) * .028;
          fx[i] -= dx / d * extra; fy[i] -= dy / d * extra;
          fx[j] += dx / d * extra; fy[j] += dy / d * extra;
        }
      }
    }
    edges.forEach(([i, j]) => {
      const dx = nodes[j].x - nodes[i].x, dy = nodes[j].y - nodes[i].y;
      const d = Math.max(1, Math.hypot(dx, dy));
      const spring = Math.max(-3.2, Math.min(3.2, (d - 169) * .027));
      const sx = dx / d * spring, sy = dy / d * spring;
      fx[i] += sx; fy[i] += sy; fx[j] -= sx; fy[j] -= sy;
    });
    const cooling = .35 + .65 * (1 - t / steps);
    nodes.forEach((node, i) => {
      velocity[i].x = (velocity[i].x + fx[i] - node.x * .0008) * .77;
      velocity[i].y = (velocity[i].y + fy[i] - node.y * .0008) * .77;
      node.x += Math.max(-8, Math.min(8, velocity[i].x)) * cooling;
      node.y += Math.max(-8, Math.min(8, velocity[i].y)) * cooling;
    });
  }
  // Align the center to zero to simplify camera behavior.
  const cx = nodes.reduce((sum, node) => sum + node.x, 0) / n;
  const cy = nodes.reduce((sum, node) => sum + node.y, 0) / n;
  nodes.forEach(node => { node.x -= cx; node.y -= cy; });
  // O espaço disponível é predominantemente horizontal no desktop.
  // Alongar a rede sem alterar suas ligações evita um aglomerado no centro.
  const minX = Math.min(...nodes.map(node => node.x));
  const maxX = Math.max(...nodes.map(node => node.x));
  const minY = Math.min(...nodes.map(node => node.y));
  const maxY = Math.max(...nodes.map(node => node.y));
  const ratio = Math.max(.2, (maxX - minX) / Math.max(1, maxY - minY));
  const spread = Math.max(.75, Math.min(1.75, Math.sqrt(2.08 / ratio)));
  nodes.forEach(node => { node.x *= spread; node.y /= spread; });
  data.layoutVersion = 2;
}
function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
    $('save-label').textContent = 'Salvo neste navegador';
  } catch {
    $('save-label').textContent = 'Exporte JSON para guardar';
  }
}
function persistSoon() {
  $('save-label').textContent = 'Salvando…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 320);
}
function fit(animated = true) {
  const nodes = visibleNodes();
  if (!nodes.length) { camera = { x: width / 2, y: height / 2, z: 1 }; updateCamera(); return; }
  const minX = Math.min(...nodes.map(n => n.x)), maxX = Math.max(...nodes.map(n => n.x));
  const minY = Math.min(...nodes.map(n => n.y)), maxY = Math.max(...nodes.map(n => n.y));
  const padX = Math.max(115, width * .13), padY = Math.max(90, height * .17);
  const z = Math.max(.28, Math.min(1.65, (width - padX * 2) / Math.max(120, maxX - minX), (height - padY * 2) / Math.max(110, maxY - minY)));
  camera = { x: width / 2 - (minX + maxX) / 2 * z, y: height / 2 - (minY + maxY) / 2 * z, z };
  if (animated) scene.style.transition = 'opacity .18s ease';
  updateCamera();
}
function updateCamera() {
  world.setAttribute('transform', 'translate(' + camera.x + ' ' + camera.y + ') scale(' + camera.z + ')');
  // Os nomes permanecem legíveis independentemente do nível de zoom.
  world.querySelectorAll('text[data-baseline]').forEach(label => {
    label.style.fontSize = (11.7 / camera.z) + 'px';
    label.style.strokeWidth = (3.7 / camera.z) + 'px';
    label.setAttribute('y', Number(label.dataset.baseline) + 19 / camera.z);
  });
  $('zoom-level').textContent = Math.round(camera.z * 100) + '%';
}
function zoom(factor, x = width / 2, y = height / 2) {
  const z = Math.max(.24, Math.min(3, camera.z * factor));
  camera.x = x - (x - camera.x) * z / camera.z;
  camera.y = y - (y - camera.y) * z / camera.z;
  camera.z = z;
  updateCamera();
}
function resize() {
  const rect = scene.getBoundingClientRect();
  width = Math.max(320, rect.width); height = Math.max(250, rect.height);
  scene.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
  if (!drag) fit(false);
}
function adjacent(id, maxDepth = 1) {
  const result = new Set([id]); let frontier = [id];
  for (let i = 0; i < maxDepth; i++) {
    const next = [];
    links().forEach(l => {
      const a = frontier.includes(l.source) ? l.target : frontier.includes(l.target) ? l.source : null;
      if (a && !result.has(a)) { result.add(a); next.push(a); }
    });
    frontier = next;
    if (!frontier.length) break;
  }
  return result;
}
function visibleNodes() { return categoryFilter ? data.nodes.filter(n => n.category === categoryFilter) : data.nodes; }
function focusSet() {
  if (selected) return adjacent(selected, depth);
  if (search) return new Set(data.nodes.filter(n => matches(n)).map(n => n.id));
  return null;
}
function matches(n) { return [n.label, n.text, ...(n.tags || [])].join(' ').toLocaleLowerCase('pt-BR').includes(search); }
function renderGraph() {
  world.replaceChildren();
  const visible = visibleNodes();
  const shown = new Set(visible.map(n => n.id));
  const points = nodeMap();
  const focus = focusSet();
  const limited = mode === 'local' && selected ? adjacent(selected, depth) : null;
  const connections = links().filter(l => shown.has(l.source) && shown.has(l.target) && (!limited || (limited.has(l.source) && limited.has(l.target))));
  const edgesGroup = svg('g'), nodesGroup = svg('g');
  connections.forEach(l => {
    const a = points.get(l.source), b = points.get(l.target);
    const highlighted = !!selected && (l.source === selected || l.target === selected);
    const faded = !!focus && !(focus.has(l.source) && focus.has(l.target));
    edgesGroup.appendChild(svg('line', {
      x1: a.x, y1: a.y, x2: b.x, y2: b.y,
      class: 'edge' + (highlighted ? ' highlight' : '') + (faded ? ' faded' : '')
    }));
  });
  visible.filter(n => !limited || limited.has(n.id)).forEach(n => {
    const neighbors = links().filter(l => l.source === n.id || l.target === n.id).length;
    const radius = 5.4 + Math.min(4.2, neighbors * 1.3);
    const active = selected === n.id || hovered === n.id;
    const faded = !!focus && !focus.has(n.id);
    const group = svg('g', { class: 'point' + (active ? ' focus' : '') + (faded ? ' faded' : ''), 'data-node': n.id, role: 'button', tabindex: '0', 'aria-label': 'Selecionar ' + n.label });
    const color = CATS[n.category].color;
    if (active) {
      group.appendChild(svg('circle', { cx: n.x, cy: n.y, r: radius + 14, class: 'orbital' }));
      group.appendChild(svg('circle', { cx: n.x, cy: n.y, r: radius + 9, class: 'glow', fill: color }));
    } else {
      group.appendChild(svg('circle', { cx: n.x, cy: n.y, r: radius + 6, class: 'glow', fill: color }));
    }
    group.appendChild(svg('circle', { cx: n.x, cy: n.y, r: radius, class: 'core', fill: color }));
    const label = n.label.length > 35 ? n.label.slice(0, 34) + '…' : n.label;
    const text = svg('text', { x: n.x, y: n.y + radius + 20, 'text-anchor': 'middle', 'data-baseline': n.y + radius }, label);
    group.appendChild(text);
    group.appendChild(svg('circle', { cx: n.x, cy: n.y, r: Math.max(24, radius + 10), class: 'hit' }));
    nodesGroup.appendChild(group);
  });
  world.append(edgesGroup, nodesGroup);
  updateCamera();
  $('stat-nodes').textContent = visible.length;
  $('stat-links').textContent = connections.length;
  empty.hidden = !!visible.length;
}
function categorySidebar() {
  const list = $('category-list');
  list.replaceChildren();
  Object.entries(CATS).forEach(([key, cat]) => {
    const count = data.nodes.filter(n => n.category === key).length;
    const b = document.createElement('button');
    b.className = 'category-item' + (categoryFilter && categoryFilter !== key ? ' off' : '');
    b.type = 'button';
    const dot = document.createElement('i'); dot.className = 'dot'; dot.style.background = cat.color;
    const label = document.createElement('span'); label.textContent = cat.name;
    const number = document.createElement('span'); number.className = 'count'; number.textContent = count;
    b.append(dot, label, number);
    b.addEventListener('click', () => { categoryFilter = categoryFilter === key ? null : key; renderGraph(); categorySidebar(); fit(); });
    list.appendChild(b);
  });
}
function setMode(next) {
  mode = next;
  $('nav-all').classList.toggle('active', mode === 'all');
  $('nav-local').classList.toggle('active', mode === 'local');
  if (mode === 'local' && !selected) { mode = 'all'; $('nav-all').classList.add('active'); $('nav-local').classList.remove('active'); }
  renderGraph();
}
function changeSelection(id, center = false) {
  selected = data.nodes.some(n => n.id === id) ? id : null;
  if (selected && center) {
    const n = nodeMap().get(selected);
    camera.x = width / 2 - n.x * camera.z;
    camera.y = height / 2 - n.y * camera.z;
  }
  renderGraph();
  renderInspector();
}
function clearSelection() { selected = null; mode = 'all'; $('nav-local').classList.remove('active'); $('nav-all').classList.add('active'); renderGraph(); renderInspector(); }
function renderInspector() {
  const n = nodeMap().get(selected);
  $('inspector').hidden = !n;
  if (!n) return;
  $('inspect-dot').style.background = CATS[n.category].color;
  $('inspect-category').textContent = CATS[n.category].name + '  /  ' + STATUSES[n.status];
  $('inspect-title').textContent = n.label;
  $('inspect-description').textContent = n.text || 'Nenhuma descrição adicionada.';
  const tagRow = $('inspect-tags'); tagRow.replaceChildren();
  n.tags.forEach(tag => { const span = document.createElement('span'); span.textContent = '#' + tag; tagRow.appendChild(span); });
  const neighbors = adjacent(n.id, 1); neighbors.delete(n.id);
  const area = $('neighbors'); area.replaceChildren();
  if (!neighbors.size) { const p = document.createElement('p'); p.textContent = 'Nenhuma ligação registrada.'; p.style.cssText = 'font-size:11px;color:#8c9ab0'; area.appendChild(p); }
  [...neighbors].forEach(id => {
    const other = nodeMap().get(id); if (!other) return;
    const line = document.createElement('div'); line.style.display = 'flex'; line.style.alignItems = 'center';
    const button = document.createElement('button'); button.style.flex = '1'; button.type = 'button';
    const dot = document.createElement('i'); dot.className = 'dot'; dot.style.background = CATS[other.category].color;
    const span = document.createElement('span'); span.textContent = other.label;
    button.append(dot, span); button.addEventListener('click', () => changeSelection(id, true));
    const remove = document.createElement('button'); remove.className = 'remove'; remove.type = 'button'; remove.textContent = '×'; remove.title = 'Desconectar';
    remove.addEventListener('click', () => {
      if (!confirm('Remover conexão entre "' + n.label + '" e "' + other.label + '"?')) return;
      data.links = data.links.filter(l => !((l.source === n.id && l.target === id) || (l.source === id && l.target === n.id)));
      persistSoon(); renderGraph(); renderInspector();
    });
    line.append(button, remove); area.appendChild(line);
  });
  const select = $('connect-target'); select.replaceChildren();
  const option = document.createElement('option'); option.value = ''; option.textContent = 'Selecionar conceito…'; select.appendChild(option);
  data.nodes.filter(v => v.id !== n.id && !neighbors.has(v.id)).sort((a, b) => a.label.localeCompare(b.label, 'pt-BR')).forEach(v => {
    const op = document.createElement('option'); op.value = v.id; op.textContent = v.label; select.appendChild(op);
  });
  $('btn-connect').disabled = select.options.length < 2;
  document.querySelectorAll('.depth-row button').forEach(button => button.classList.toggle('active', Number(button.dataset.depth) === depth));
}
function searchResultUI() {
  const list = $('search-results'); list.replaceChildren();
  if (!search) { list.hidden = true; return; }
  const found = data.nodes.filter(matches).slice(0, 12);
  if (!found.length) { const p = document.createElement('p'); p.textContent = 'Nenhum conceito encontrado'; list.appendChild(p); }
  found.forEach(n => {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = n.label;
    const small = document.createElement('small'); small.textContent = CATS[n.category].name; b.appendChild(small);
    b.addEventListener('click', () => { search = ''; $('search').value = ''; list.hidden = true; categoryFilter = null; categorySidebar(); changeSelection(n.id, true); });
    list.appendChild(b);
  });
  list.hidden = false;
}
function nextId() {
  const ids = new Set(data.nodes.map(n => n.id));
  let id = 'idea-' + Math.random().toString(36).slice(2, 10);
  while (ids.has(id)) id = 'idea-' + Math.random().toString(36).slice(2, 10);
  return id;
}
let editId = null;
function openModal(node = null) {
  editId = node?.id || null;
  $('modal-title').textContent = node ? 'Editar conceito' : 'Adicionar conceito';
  $('modal-subtitle').textContent = node ? 'Atualize os detalhes deste ponto da rede.' : 'Uma nova ideia para conectar ao seu mapa.';
  $('field-name').value = node?.label || '';
  $('field-description').value = node?.text || '';
  $('field-category').value = node?.category || 'outra';
  $('field-status').value = node?.status || 'pending';
  $('field-tags').value = (node?.tags || []).join(', ');
  $('modal').hidden = false; $('field-name').focus();
}
function closeModal() { $('modal').hidden = true; }
function upsert(event) {
  event.preventDefault();
  const label = $('field-name').value.trim(); if (!label) return;
  const values = { label, text: $('field-description').value.trim(), category: $('field-category').value, status: $('field-status').value, tags: $('field-tags').value.split(',').map(t => t.trim()).filter(Boolean) };
  if (editId) Object.assign(nodeMap().get(editId), values);
  else {
    const cx = (width / 2 - camera.x) / camera.z;
    const cy = (height / 2 - camera.y) / camera.z;
    const n = { id: nextId(), ...values, x: cx + Math.random() * 30 - 15, y: cy + Math.random() * 30 - 15, z: 0 };
    data.nodes.push(n); selected = n.id;
  }
  closeModal(); categorySidebar(); renderGraph(); renderInspector(); persistSoon(); toast(editId ? 'Conceito atualizado' : 'Conceito criado');
}
function toast(message) {
  const note = $('toast'); note.textContent = message; note.hidden = false;
  clearTimeout(toast.timer); toast.timer = setTimeout(() => note.hidden = true, 3000);
}
function exportJson() {
  const payload = { layoutVersion: 2, nodes: data.nodes, links: data.links };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = 'mapa-de-conhecimento-' + new Date().toISOString().slice(0, 10) + '.json'; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function importMarkdown(text) {
  const blocks = text.split(/\r?\n(?=\[.+?\])/).filter(Boolean);
  const nodes = blocks.map((block, i) => {
    const rows = block.trim().split(/\r?\n/);
    const first = rows[0].match(/^\[(.+?)\]\s*(.+)$/);
    if (!first) return null;
    const tagLine = rows.find(row => /^tags:/i.test(row));
    const tags = tagLine ? tagLine.replace(/^tags:/i, '').split(',').map(t => t.trim()).filter(Boolean) : [];
    return { id: 'import-' + Date.now() + '-' + i, label: first[2].slice(0, 70), text: rows.filter(row => !/^tags:/i.test(row)).join(' '), category: 'outra', status: 'pending', tags };
  }).filter(Boolean);
  if (!nodes.length) throw new Error('Nenhuma nota no formato [DATA] texto foi encontrada.');
  const resultLinks = [];
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
    if (nodes[i].tags.filter(t => nodes[j].tags.includes(t)).length >= 2) resultLinks.push({ source: nodes[i].id, target: nodes[j].id });
  }
  return normalize({ nodes, links: resultLinks });
}
async function importFile(event) {
  const file = event.target.files?.[0]; event.target.value = '';
  if (!file) return;
  try {
    const text = await file.text();
    const incoming = file.name.toLowerCase().endsWith('.json') ? normalize(JSON.parse(text)) : importMarkdown(text);
    if (!incoming.nodes.length) throw new Error('O arquivo não contém ideias.');
    if (!confirm('Importar ' + incoming.nodes.length + ' conceitos? Isso substituirá o mapa atual deste navegador. Exporte um backup antes, se necessário.')) return;
    data = incoming; layoutGraph(); selected = null; categoryFilter = null; search = ''; $('search').value = ''; mode = 'all';
    renderAll(); fit(); persistSoon(); toast('Mapa importado');
  } catch (error) { toast('Falha na importação: ' + error.message); }
}
function renderAll() { categorySidebar(); renderGraph(); renderInspector(); setMode('all'); }

scene.addEventListener('pointerdown', event => {
  if (event.button !== 0) return;
  const group = event.target.closest('[data-node]');
  const id = group?.getAttribute('data-node') || null;
  drag = { id, px: event.clientX, py: event.clientY, camera: { ...camera }, x: id ? nodeMap().get(id).x : 0, y: id ? nodeMap().get(id).y : 0 };
  moved = false; scene.setPointerCapture(event.pointerId);
});
scene.addEventListener('pointermove', event => {
  const over = event.target.closest('[data-node]')?.getAttribute('data-node') || null;
  if (!drag && over !== hovered) { hovered = over; renderGraph(); }
  if (!drag) return;
  const dx = event.clientX - drag.px, dy = event.clientY - drag.py;
  if (Math.abs(dx) + Math.abs(dy) > 5) moved = true;
  if (!moved) return;
  scene.classList.add('dragging');
  if (!drag.id) { camera.x = drag.camera.x + dx; camera.y = drag.camera.y + dy; updateCamera(); }
  else { const n = nodeMap().get(drag.id); n.x = drag.x + dx / drag.camera.z; n.y = drag.y + dy / drag.camera.z; renderGraph(); }
});
function pointerEnd(event) {
  if (drag?.id && !moved && data.nodes.some(n => n.id === drag.id)) changeSelection(drag.id);
  else if (drag && !drag.id && !moved && selected) clearSelection();
  else if (drag?.id && moved) persistSoon();
  drag = null; scene.classList.remove('dragging');
  if (scene.hasPointerCapture(event.pointerId)) scene.releasePointerCapture(event.pointerId);
}
scene.addEventListener('pointerup', pointerEnd);
scene.addEventListener('pointercancel', pointerEnd);
scene.addEventListener('pointerleave', () => { if (!drag) { hovered = null; renderGraph(); } });
scene.addEventListener('keydown', event => {
  const id = event.target.closest('[data-node]')?.getAttribute('data-node');
  if (id && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); changeSelection(id, true); }
});
scene.addEventListener('dblclick', event => {
  const id = event.target.closest('[data-node]')?.getAttribute('data-node');
  if (id) openModal(nodeMap().get(id));
});
scene.addEventListener('wheel', event => {
  event.preventDefault();
  const r = scene.getBoundingClientRect();
  zoom(event.deltaY < 0 ? 1.11 : 1 / 1.11, event.clientX - r.left, event.clientY - r.top);
}, { passive: false });
$('btn-zoom-in').addEventListener('click', () => zoom(1.24));
$('btn-zoom-out').addEventListener('click', () => zoom(1 / 1.24));
$('btn-fit').addEventListener('click', () => fit());
$('btn-reset-layout').addEventListener('click', () => {
  if (!confirm('Reorganizar automaticamente os pontos do mapa? As posições manuais serão substituídas.')) return;
  layoutGraph(true); renderGraph(); fit(); persistSoon(); toast('Mapa reorganizado');
});
$('btn-new').addEventListener('click', () => openModal());
$('btn-empty-new').addEventListener('click', () => openModal());
$('btn-close-modal').addEventListener('click', closeModal);
$('btn-cancel').addEventListener('click', closeModal);
$('modal').addEventListener('click', event => { if (event.target === $('modal')) closeModal(); });
window.addEventListener('keydown', event => { if (event.key === 'Escape') { closeModal(); if (!selected) $('search-results').hidden = true; } });
$('form-idea').addEventListener('submit', upsert);
$('btn-export').addEventListener('click', exportJson);
$('btn-import').addEventListener('click', () => $('input-file').click());
$('input-file').addEventListener('change', importFile);
$('btn-close-inspector').addEventListener('click', clearSelection);
$('btn-edit').addEventListener('click', () => { const n = nodeMap().get(selected); if (n) openModal(n); });
$('btn-delete').addEventListener('click', () => {
  const n = nodeMap().get(selected); if (!n) return;
  if (!confirm('Excluir "' + n.label + '" e todas as suas conexões?')) return;
  data.nodes = data.nodes.filter(v => v.id !== n.id);
  data.links = data.links.filter(l => l.source !== n.id && l.target !== n.id);
  selected = null; renderAll(); fit(); persistSoon(); toast('Conceito excluído');
});
$('btn-connect').addEventListener('click', () => {
  const target = $('connect-target').value;
  if (!selected || !target || selected === target) return;
  if (!data.links.some(l => (l.source === selected && l.target === target) || (l.target === selected && l.source === target))) {
    data.links.push({ source: selected, target }); persistSoon();
  }
  renderGraph(); renderInspector(); toast('Ligação adicionada');
});
document.querySelectorAll('.depth-row button').forEach(button => button.addEventListener('click', () => {
  depth = Number(button.dataset.depth);
  renderGraph(); renderInspector();
}));
$('nav-all').addEventListener('click', () => { categoryFilter = null; categorySidebar(); setMode('all'); fit(); $('sidebar').classList.remove('open'); });
$('nav-local').addEventListener('click', () => {
  if (!selected) { toast('Selecione um conceito para explorar suas conexões'); return; }
  setMode('local'); fit(); $('sidebar').classList.remove('open');
});
$('search').addEventListener('input', event => {
  search = event.target.value.trim().toLocaleLowerCase('pt-BR'); searchResultUI(); renderGraph();
});
$('search').addEventListener('keydown', event => {
  if (event.key === 'Enter') { const n = data.nodes.find(matches); if (n) { search = ''; $('search').value = ''; $('search-results').hidden = true; categoryFilter = null; categorySidebar(); changeSelection(n.id, true); } }
});
$('sidebar-toggle').addEventListener('click', () => $('sidebar').classList.toggle('open'));
window.addEventListener('pagehide', () => { if (saveTimer) { clearTimeout(saveTimer); save(); } });
new ResizeObserver(resize).observe(scene);

async function init() {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved) data = normalize(JSON.parse(saved));
    else {
      const response = await fetch('data/exemplo.json');
      if (!response.ok) throw new Error('Dados de exemplo indisponíveis');
      data = normalize(await response.json());
    }
  } catch (error) {
    console.warn('Não foi possível carregar o mapa:', error);
    data = { nodes: [], links: [], layoutVersion: 2 };
  }
  layoutGraph();
  renderAll(); resize(); fit(false);
  $('save-label').textContent = 'Salvo neste navegador';
}
init();
