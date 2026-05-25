/* =====================================================
   OCR Pipeline Dashboard — Application Logic (Live API Integrated)
   ===================================================== */

"use strict";

/* =========================================================
   STATE
   ========================================================= */
const state = {
  documents: [],           // { id, name, type, date, text, chunks, metadata }
  queries: [],             // { query, time, results }
  stats: {
    totalDocs: 0,
    totalChunks: 0,
    totalQueries: 0,
    totalChars: 0,
    avgSimilarity: null,
  },
  config: {
    languages: ['en'],
    chunkSize: 500,
    chunkOverlap: 100,
    gpu: true,
    embeddingModel: 'all-MiniLM-L6-v2',
  },
  currentFile: null,
  topK: 3,
};

/* =========================================================
   HELPERS
   ========================================================= */
function $(id) { return document.getElementById(id); }

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function timeAgo(date) {
  const diff = Date.now() - date;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
  if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
  return Math.floor(diff / 86400000) + 'd ago';
}

/* =========================================================
   TOAST NOTIFICATIONS
   ========================================================= */
function showToast(message, type = 'info', duration = 3500) {
  const icons = {
    success: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`,
    error:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
    info:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
  };
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `${icons[type]} <span>${message}</span>`;
  $('toastContainer').prepend(toast);
  setTimeout(() => {
    toast.classList.add('removing');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

/* =========================================================
   ACTIVITY FEED
   ========================================================= */
function addActivity(text, color = 'blue') {
  const feed = $('activityFeed');
  const empty = feed.querySelector('.activity-empty');
  if (empty) empty.remove();
  const item = document.createElement('div');
  item.className = 'activity-item';
  item.innerHTML = `
    <div class="act-dot ${color}"></div>
    <div class="act-body">
      <p>${text}</p>
      <span>${new Date().toLocaleTimeString()}</span>
    </div>`;
  feed.prepend(item);
}

/* =========================================================
   PROCESSING LOG
   ========================================================= */
function appendLog(msg, color = '#10b981') {
  const log = $('processingLog');
  const line = document.createElement('div');
  line.className = 'log-line';
  line.style.color = color;
  line.textContent = msg;
  log.appendChild(line);
  log.scrollTop = log.scrollHeight;
}

/* =========================================================
   STEP STATUS UPDATES
   ========================================================= */
function setStepComplete(stepEl, statusEl, descEl, descText) {
  statusEl.innerHTML = `<svg class="check-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg>`;
  statusEl.querySelector('svg').style.color = 'var(--accent-3)';
  stepEl.querySelector('.proc-step-icon').style.borderColor = 'rgba(16,185,129,.3)';
  stepEl.querySelector('.proc-step-icon').style.background  = 'rgba(16,185,129,.1)';
  const svg = stepEl.querySelector('.spin-ring');
  if (svg) svg.remove();
  if (descEl) descEl.textContent = descText;
}

function setStepActive(stepEl, statusEl, descEl, descText) {
  statusEl.innerHTML = `<div class="spinner"></div>`;
  stepEl.querySelector('.proc-step-icon').classList.remove('pending');
  stepEl.querySelector('.proc-step-icon').style.borderColor = 'rgba(79,142,247,.3)';
  if (descEl) descEl.textContent = descText;
}

function resetProcessingSteps() {
  // Reset OCR step
  $('step-ocr').querySelector('.proc-step-icon').innerHTML = `
    <div class="spin-ring"></div>
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 7h.01M12 7h.01M7 12h.01M12 12h.01M7 17h.01M12 17h5"/></svg>`;
  $('status-ocr').innerHTML = '<div class="spinner"></div>';
  $('ocr-desc').textContent = 'Running EasyOCR…';

  // Reset chunk step
  $('step-chunk').querySelector('.proc-step-icon').classList.add('pending');
  $('status-chunk').innerHTML = '<div class="wait-ring"></div>';
  $('chunk-desc').textContent = 'Awaiting OCR…';

  // Reset embed step
  $('step-embed').querySelector('.proc-step-icon').classList.add('pending');
  $('status-embed').innerHTML = '<div class="wait-ring"></div>';
  $('embed-desc').textContent = 'Awaiting chunking…';
}

/* =========================================================
   LIVE LOG ENGINE (SSE Client)
   ========================================================= */
function setupEventSourceLogs() {
  const eventSource = new EventSource('/api/logs-stream');
  
  eventSource.onmessage = function(event) {
    const data = JSON.parse(event.data);
    const msg = data.message;
    const status = data.status;

    if (status === 'ocr_start') {
      appendLog(msg, '#f59e0b');
    } else if (status === 'ocr_log') {
      appendLog(msg);
    } else if (status === 'ocr_running') {
      appendLog(msg, '#8b5cf6');
    } else if (status === 'ocr_complete') {
      appendLog(msg, '#10b981');
      setStepComplete($('step-ocr'), $('status-ocr'), $('ocr-desc'), msg.replace('[+] OCR complete — ', ''));
      addActivity(`EasyOCR extraction complete`, 'blue');
    } else if (status === 'chunk_start') {
      setStepActive($('step-chunk'), $('status-chunk'), $('chunk-desc'), 'Chunking text segments...');
      appendLog(msg, '#f59e0b');
    } else if (status === 'chunk_log') {
      appendLog(msg);
    } else if (status === 'chunk_complete') {
      appendLog(msg, '#10b981');
      setStepComplete($('step-chunk'), $('status-chunk'), $('chunk-desc'), msg.replace('[+] Created ', ''));
      addActivity(`Text chunking complete`, 'purple');
    } else if (status === 'embed_start') {
      setStepActive($('step-embed'), $('status-embed'), $('embed-desc'), 'Generating embeddings...');
      appendLog(msg, '#f59e0b');
    } else if (status === 'embed_running') {
      appendLog(msg, '#8b5cf6');
    } else if (status === 'embed_complete') {
      appendLog(msg, '#10b981');
      setStepComplete($('step-embed'), $('status-embed'), $('embed-desc'), 'Vectors stored');
      addActivity(`Indexed document chunks into ChromaDB`, 'green');
    } else if (status === 'done') {
      appendLog(msg, '#10b981');
      eventSource.close();
    } else if (status === 'error') {
      appendLog(msg, '#ef4444');
      showToast(msg, 'error');
      eventSource.close();
    }
  };

  eventSource.onerror = function() {
    eventSource.close();
  };

  return eventSource;
}

/* =========================================================
   API CALLS
   ========================================================= */

// Fetch all documents from Flask Server
async function apiGetDocuments() {
  try {
    const res = await fetch('/api/documents');
    if (!res.ok) throw new Error('Failed to fetch documents');
    state.documents = await res.ok ? await res.json() : [];
    renderDocuments();
    updatePipelineStats();
    updateAnalytics();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// Fetch general pipeline/db statistics from Flask Server
async function apiGetStats() {
  try {
    const res = await fetch('/api/stats');
    if (!res.ok) throw new Error('Failed to fetch analytics');
    const data = await res.json();
    state.stats.totalDocs = data.totalDocs;
    state.stats.totalChunks = data.totalChunks;
    state.stats.totalChars = data.totalChars;
    state.stats.totalQueries = data.queriesRun;
    state.stats.avgSimilarity = data.avgSimilarity;
    updateGlobalStats();
    updatePipelineStats();
    updateAnalytics();
  } catch (err) {
    console.error(err);
  }
}

// Delete document from ChromaDB
async function apiDeleteDocument(id) {
  try {
    const res = await fetch(`/api/documents/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Deletion failed');
    addActivity(`Deleted document: ${id}`, 'orange');
    showToast(`"${id}" deleted.`, 'success');
    await apiGetDocuments();
    await apiGetStats();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// Perform semantic search query
async function apiSearch(query, k = 3) {
  try {
    const res = await fetch('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, k })
    });
    if (!res.ok) throw new Error('Search failed');
    const results = await res.json();
    
    // Log search query run
    addActivity(`Semantic search executed: "${query}"`, 'blue');
    
    // Render result cards
    renderSearchResults(query, results);
    await apiGetStats();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// Upload file to local Flask Server (Triggers real EasyOCR + Vector pipeline)
async function apiUpload(file, customName = null) {
  $('processingModal').style.display = 'flex';
  $('processingLog').innerHTML = '';
  resetProcessingSteps();

  // Establish SSE logging listener first
  const eventSource = setupEventSourceLogs();

  const formData = new FormData();
  formData.append('file', file, customName || file.name);
  state.config.languages.forEach(lang => formData.append('languages', lang));
  formData.append('chunkSize', state.config.chunkSize);
  formData.append('chunkOverlap', state.config.chunkOverlap);
  formData.append('embeddingModel', state.config.embeddingModel);
  formData.append('type', customName ? 'demo' : (file.type.startsWith('image/') ? 'image' : 'scan'));

  try {
    // Wait briefly for SSE stream connection to set up
    await new Promise(resolve => setTimeout(resolve, 300));
    
    const res = await fetch('/api/upload', {
      method: 'POST',
      body: formData
    });

    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.error || 'Pipeline upload failed');
    }

    const data = await res.json();
    showToast(`"${data.document_name}" processed — ${data.chunks_count} chunks indexed!`, 'success');
    
    // Close logging SSE & hide modal
    setTimeout(() => {
      eventSource.close();
      $('processingModal').style.display = 'none';
      navigateTo('documents');
      apiGetDocuments();
      apiGetStats();
    }, 1200);

  } catch (err) {
    eventSource.close();
    $('processingModal').style.display = 'none';
    showToast(err.message, 'error');
  }
}

/* =========================================================
   UI CONTROLS & UPDATES
   ========================================================= */
function updateGlobalStats() {
  $('total-docs').textContent    = state.stats.totalDocs;
  $('total-chunks').textContent  = state.stats.totalChunks;
  $('total-queries').textContent = state.stats.totalQueries;
  $('doc-count-badge').textContent = state.stats.totalDocs;
}

function updatePipelineStats() {
  $('pstat-input').textContent  = `${state.stats.totalDocs} file${state.stats.totalDocs !== 1 ? 's' : ''} uploaded`;
  $('pstat-ocr').textContent    = `${state.stats.totalChars.toLocaleString()} characters extracted`;
  $('pstat-chunk').textContent  = `${state.stats.totalChunks} chunks created`;
  $('pstat-embed').textContent  = `${state.stats.totalChunks} vectors stored`;
  $('pstat-search').textContent = `${state.stats.totalQueries} queries run`;
}

function renderDocuments(filter = '', sort = 'newest') {
  const grid = $('docGrid');
  let docs = [...state.documents];

  if (filter) {
    const f = filter.toLowerCase();
    docs = docs.filter(d => d.name.toLowerCase().includes(f) || d.type.toLowerCase().includes(f));
  }

  if (sort === 'newest')  docs.sort((a, b) => b.date - a.date);
  if (sort === 'oldest')  docs.sort((a, b) => a.date - b.date);
  if (sort === 'name')    docs.sort((a, b) => a.name.localeCompare(b.name));
  if (sort === 'chunks')  docs.sort((a, b) => b.chunks.length - a.chunks.length);

  const existing = grid.querySelectorAll('.doc-card');
  existing.forEach(e => e.remove());

  const empty = $('docEmpty');
  if (docs.length === 0) {
    empty.style.display = 'flex';
    return;
  }
  empty.style.display = 'none';

  docs.forEach((doc, idx) => {
    const card = document.createElement('div');
    card.className = 'doc-card';
    card.style.animationDelay = `${idx * 0.05}s`;
    card.innerHTML = `
      <div class="doc-card-header">
        <span class="doc-type-badge ${doc.type}">${doc.type}</span>
        <button class="doc-delete-btn" data-id="${doc.id}" title="Remove document">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
        </button>
      </div>
      <p class="doc-name">${doc.name}</p>
      <p class="doc-meta">${new Date(doc.date).toLocaleDateString()} · ${doc.metadata.charCount.toLocaleString()} chars</p>
      <div class="doc-card-footer">
        <div class="doc-chunks-count">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="9" height="9"/><rect x="13" y="2" width="9" height="9"/><rect x="2" y="13" width="9" height="9"/><rect x="13" y="13" width="9" height="9"/></svg>
          ${doc.chunks.length} chunks
        </div>
        <button class="doc-view-btn" data-id="${doc.id}">View Chunks</button>
      </div>`;

    card.querySelector('.doc-delete-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      apiDeleteDocument(doc.id);
    });
    card.querySelector('.doc-view-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      openChunkModal(doc.id);
    });

    grid.appendChild(card);
  });
}

/* =========================================================
   CHUNK EXPLORER MODAL
   ========================================================= */
function openChunkModal(id) {
  const doc = state.documents.find(d => d.id === id);
  if (!doc) return;
  $('chunkModalTitle').textContent = `${doc.name} — ${doc.chunks.length} Chunks`;
  const body = $('chunkModalBody');
  body.innerHTML = '';
  doc.chunks.forEach((chunk, i) => {
    const item = document.createElement('div');
    item.className = 'chunk-item';
    item.innerHTML = `
      <div class="chunk-header">
        <span class="chunk-label">Chunk ${i + 1} / ${doc.chunks.length}</span>
        <span class="chunk-label">${chunk.split(/\s+/).length} words</span>
      </div>
      <p class="chunk-body">${chunk}</p>`;
    body.appendChild(item);
  });
  $('chunkModal').style.display = 'flex';
}

/* =========================================================
   SEARCH RESULT RENDERING
   ========================================================= */
function renderSearchResults(query, results) {
  const container = $('searchResults');
  container.innerHTML = '';

  if (results.length === 0) {
    container.innerHTML = `<div class="results-empty">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><path d="M11 8v4"/><path d="M11 16h.01"/></svg>
      <p>No semantic matches found. Try indexing more documents.</p>
    </div>`;
    return;
  }

  results.forEach((r, i) => {
    const similarityPct = (r.score * 100).toFixed(1);
    const card = document.createElement('div');
    card.className = 'result-card';
    card.style.animationDelay = `${i * 0.08}s`;
    card.innerHTML = `
      <div class="result-card-header">
        <span class="result-rank">Result #${i + 1}</span>
        <div class="result-score">
          <span>Similarity: ${similarityPct}%</span>
          <div class="score-bar"><div class="score-fill" style="width:${similarityPct}%"></div></div>
        </div>
      </div>
      <p class="result-source">📄 ${r.docName} · Chunk ${r.chunkIdx + 1}</p>
      <p class="result-text">${r.text}</p>`;
    container.appendChild(card);
  });

  // Track local query history
  state.queries.push({ query, time: Date.now(), results });
  renderQueryHistory();
}

function renderQueryHistory() {
  const hist = $('queryHistory');
  hist.innerHTML = '';
  if (state.queries.length === 0) {
    hist.innerHTML = '<div class="query-history-empty">No queries run this session.</div>';
    return;
  }
  [...state.queries].reverse().slice(0, 10).forEach(q => {
    const item = document.createElement('div');
    item.className = 'qh-item';
    item.innerHTML = `
      <span class="qh-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></span>
      <span class="qh-text">${q.query}</span>
      <span class="qh-time">${timeAgo(q.time)}</span>`;
    item.addEventListener('click', () => {
      navigateTo('search');
      $('semanticQuery').value = q.query;
      apiSearch(q.query, state.topK);
    });
    hist.appendChild(item);
  });
}

/* =========================================================
   ANALYTICS & CHARTS
   ========================================================= */
let chunkChartInst = null;
let typeChartInst  = null;

function updateAnalytics() {
  $('kpi-docs').textContent    = state.stats.totalDocs;
  $('kpi-chunks').textContent  = state.stats.totalChunks;
  $('kpi-queries').textContent = state.stats.totalQueries;

  const simVal = state.stats.avgSimilarity;
  $('kpi-similarity').textContent = simVal ? (simVal * 100).toFixed(1) + '%' : '—';
  $('donutVal').textContent = state.stats.totalDocs;

  renderChunkChart();
  renderTypeChart();
  renderQueryHistory();
}

function renderChunkChart() {
  const canvas = $('chunkChart');
  const emptyEl = $('chunkChartEmpty');
  if (state.documents.length === 0) {
    emptyEl.classList.remove('hidden');
    return;
  }
  emptyEl.classList.add('hidden');

  const labels = state.documents.map(d => d.name.length > 14 ? d.name.slice(0, 12) + '…' : d.name);
  const data   = state.documents.map(d => d.chunks.length);

  // Read CSS variable colors to support light/dark themes
  const style     = getComputedStyle(document.documentElement);
  const textColor = style.getPropertyValue('--text-3').trim() || '#4a5578';
  const gridColor = style.getPropertyValue('--border').trim() || 'rgba(99,120,180,0.14)';
  const accent    = style.getPropertyValue('--accent').trim() || '#4f8ef7';

  if (chunkChartInst) chunkChartInst.destroy();
  chunkChartInst = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Chunks',
        data,
        backgroundColor: accent + '66',
        borderColor: accent,
        borderWidth: 2,
        borderRadius: 6,
      }],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: textColor }, grid: { color: gridColor } },
        y: { ticks: { color: textColor }, grid: { color: gridColor }, beginAtZero: true },
      },
    },
  });
}

function renderTypeChart() {
  const canvas = $('typeChart');
  const legend = $('typeLegend');
  if (state.documents.length === 0) {
    legend.innerHTML = '';
    return;
  }

  const typeMap = {};
  state.documents.forEach(d => { typeMap[d.type] = (typeMap[d.type] || 0) + 1; });

  const colorMap = { scan: '#4f8ef7', invoice: '#10b981', demo: '#f59e0b', image: '#8b5cf6', pdf: '#ef4444' };
  const labels = Object.keys(typeMap);
  const data   = Object.values(typeMap);
  const colors = labels.map(l => colorMap[l] || '#4f8ef7');

  if (typeChartInst) typeChartInst.destroy();
  typeChartInst = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: colors.map(c => c + 'cc'),
        borderColor: colors,
        borderWidth: 2,
        hoverOffset: 6,
      }],
    },
    options: {
      cutout: '68%',
      plugins: { legend: { display: false }, tooltip: { enabled: true } },
      responsive: true,
    },
  });

  legend.innerHTML = labels.map((l, i) => `
    <div class="legend-item">
      <div class="legend-dot" style="background:${colors[i]}"></div>
      <span>${l} (${data[i]})</span>
    </div>`).join('');
}

/* =========================================================
   NAVIGATION
   ========================================================= */
const pageNames = {
  upload:    'Upload & Extract',
  pipeline:  'Pipeline View',
  documents: 'Documents',
  search:    'Semantic Search',
  analytics: 'Analytics',
};

function navigateTo(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  const pageEl = $(`page-${page}`);
  const navEl  = $(`nav-${page}`);
  if (pageEl) pageEl.classList.add('active');
  if (navEl)  navEl.classList.add('active');

  $('breadcrumb-page').textContent = pageNames[page] || page;

  if (page === 'analytics') updateAnalytics();
}

/* =========================================================
   FILE DRAG & DROP / SELECTION
   ========================================================= */
function handleFile(file) {
  if (!file) return;
  state.currentFile = file;
  $('previewFileName').textContent = file.name;
  $('previewFileSize').textContent = formatBytes(file.size);

  const panel = $('previewPanel');
  panel.style.display = 'block';

  if (file.type.startsWith('image/')) {
    const reader = new FileReader();
    reader.onload = e => { $('previewImg').src = e.target.result; $('previewImg').style.display = 'block'; };
    reader.readAsDataURL(file);
  } else {
    $('previewImg').style.display = 'none';
    $('previewImg').src = '';
  }
}

const dropZone = $('dropZone');

['dragenter', 'dragover'].forEach(ev => {
  dropZone.addEventListener(ev, e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
});
['dragleave', 'drop'].forEach(ev => {
  dropZone.addEventListener(ev, e => { e.preventDefault(); dropZone.classList.remove('drag-over'); });
});
dropZone.addEventListener('drop', e => {
  const file = e.dataTransfer.files[0];
  if (file) handleFile(file);
});

$('fileInput').addEventListener('change', e => {
  const file = e.target.files[0];
  if (file) handleFile(file);
});

$('clearFileBtn').addEventListener('click', () => {
  state.currentFile = null;
  $('previewPanel').style.display = 'none';
  $('fileInput').value = '';
});

/* =========================================================
   PROCESS BUTTON (Real API Upload trigger)
   ========================================================= */
$('processBtn').addEventListener('click', async () => {
  if (!state.currentFile) return;
  const file = state.currentFile;
  await apiUpload(file);
  $('previewPanel').style.display = 'none';
  $('fileInput').value = '';
  state.currentFile = null;
});

/* =========================================================
   DEMO MODE
   ========================================================= */
$('demoBtn').addEventListener('click', async () => {
  // We'll create a blob and run it through the real server so it actually chunks and indexes!
  const dummyBlob = new Blob([
    `TECHNOVA SOLUTIONS PRIVATE LIMITED
Registered Office: Plot No. 47, Sector 62, Noida, Uttar Pradesh - 201309
GSTIN: 09AADCT1234F1Z5 | CIN: U72900UP2019PTC123456
Phone: +91-120-4567890 | Email: billing@technovasolutions.in
Website: www.technovasolutions.in

TAX INVOICE

Invoice Number : TNS/2026-27/00892
Invoice Date   : 24 May 2026
Due Date       : 23 June 2026
Place of Supply: Maharashtra (27)

Bill To:
Hitesh Sharma
Senior Engineer, DataOps Division
Infinex Technologies India Pvt. Ltd.
Level 8, Platina Tower, Bandra Kurla Complex
Mumbai, Maharashtra - 400051
GSTIN: 27AABCI9876B1ZK

Items & Services:

S.No  Description                                   HSN/SAC  Qty   Unit Price (INR)   Amount (INR)
----  --------------------------------------------  -------  ---   ----------------   ------------
1.    GPU Cloud Compute Instance — A100 80GB         998314   80h   ₹1,875.00/hr       ₹1,50,000.00
      (NVIDIA A100 · CUDA 12 · Ubuntu 22.04 LTS)
2.    Enterprise Vector Storage — NVMe SSD            998313   1    ₹42,500.00         ₹42,500.00
      (500 GB · ChromaDB Compatible · 99.9% SLA)
3.    Agentic AI Workspace Deployment & Config        998311   1    ₹22,000.00         ₹22,000.00
      (LightRAG + EasyOCR + Flask API setup)
4.    24x7 Priority Technical Support — 3 Months      998315   1    ₹18,000.00         ₹18,000.00
5.    Data Security & Compliance Audit Report         998316   1    ₹9,500.00          ₹9,500.00

                                               -------------------------
                         Sub Total (Taxable Value): ₹2,42,000.00
                         CGST @ 9%                : ₹21,780.00
                         SGST @ 9%                : ₹21,780.00
                         (IGST applicable for inter-state supply)
                         -------------------------
                         GRAND TOTAL              : ₹2,85,560.00
                         -------------------------

Amount in Words: Rupees Two Lakhs Eighty-Five Thousand Five Hundred and Sixty Only.

Payment Details:
  Bank Name    : HDFC Bank Ltd.
  Account No.  : 50200012345678
  IFSC Code    : HDFC0001234
  Account Type : Current
  UPI ID       : billing@technovasolutions.hdfc

Terms & Conditions:
1. Payment due within 30 days from invoice date.
2. Late payments will attract 1.5% interest per month after due date.
3. This is a computer-generated invoice and does not require a physical signature.
4. Goods once sold will not be taken back. Services are non-refundable after delivery.
5. All disputes are subject to Noida, Uttar Pradesh jurisdiction only.
6. TDS deduction certificate (Form 16A) to be shared within 7 days of deduction.

Declaration: We declare that this invoice shows the actual price of the goods/services described
and that all particulars are true and correct.

For TechNova Solutions Private Limited

Authorised Signatory
Contact: Priya Nair | accounts@technovasolutions.in | +91-98201-45678`
  ], { type: 'text/plain' });

  await apiUpload(dummyBlob, 'technova_invoice_TNS-2026-00892.txt');
});

/* =========================================================
   CONFIG PANEL INPUTS
   ========================================================= */
document.querySelectorAll('#langChips .chip').forEach(chip => {
  chip.addEventListener('click', () => {
    const lang = chip.dataset.lang;
    chip.classList.toggle('active');
    if (chip.classList.contains('active')) {
      if (!state.config.languages.includes(lang)) state.config.languages.push(lang);
    } else {
      state.config.languages = state.config.languages.filter(l => l !== lang);
      if (state.config.languages.length === 0) {
        state.config.languages = ['en'];
        document.querySelector('[data-lang="en"]').classList.add('active');
      }
    }
  });
});

$('chunkSize').addEventListener('input', e => {
  state.config.chunkSize = +e.target.value;
  $('chunkSizeVal').textContent = e.target.value;
});
$('chunkOverlap').addEventListener('input', e => {
  state.config.chunkOverlap = +e.target.value;
  $('chunkOverlapVal').textContent = e.target.value;
});
$('gpuToggle').addEventListener('change', e => { state.config.gpu = e.target.checked; });
$('embeddingModel').addEventListener('change', e => { state.config.embeddingModel = e.target.value; });

/* =========================================================
   NAVIGATION LINKS
   ========================================================= */
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', e => {
    e.preventDefault();
    navigateTo(item.dataset.page);
  });
});

// Mobile menu toggle
$('menuToggle').addEventListener('click', () => {
  document.querySelector('.sidebar').classList.toggle('open');
});

/* =========================================================
   SEARCH PAGE HANDLERS
   ========================================================= */
function runSearch() {
  const query = $('semanticQuery').value.trim();
  if (!query) { showToast('Please enter a query string.', 'error'); return; }
  if (state.documents.length === 0) { showToast('No documents indexed. Please upload a document first.', 'error'); return; }
  apiSearch(query, state.topK);
}

$('searchBtn').addEventListener('click', runSearch);
$('semanticQuery').addEventListener('keydown', e => { if (e.key === 'Enter') runSearch(); });

// K Selector
document.querySelectorAll('.k-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.k-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.topK = +btn.dataset.k;
  });
});

// Suggested queries
document.querySelectorAll('.suggest-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    $('semanticQuery').value = chip.dataset.q;
    runSearch();
  });
});

/* =========================================================
   DOCUMENTS TOOLBAR (FILTER & SORT)
   ========================================================= */
$('docFilter').addEventListener('input', () => renderDocuments($('docFilter').value, $('docSort').value));
$('docSort').addEventListener('change', () => renderDocuments($('docFilter').value, $('docSort').value));

/* =========================================================
   MODAL CONTROLS
   ========================================================= */
$('chunkModalClose').addEventListener('click', () => { $('chunkModal').style.display = 'none'; });
$('chunkModal').addEventListener('click', e => {
  if (e.target === $('chunkModal')) $('chunkModal').style.display = 'none';
});

/* =========================================================
   ACTIVITY FEED CONTROL
   ========================================================= */
$('clearActivityBtn').addEventListener('click', () => {
  $('activityFeed').innerHTML = `<div class="activity-empty">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg>
    <p>No activity yet — process a document to begin.</p>
  </div>`;
});

/* =========================================================
   LOAD CHART.JS ON STARTUP
   ========================================================= */
(function loadChartJs() {
  const script = document.createElement('script');
  script.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.2/dist/chart.umd.min.js';
  script.onload = () => {
    // Once chart script loads, pull live documents/stats
    apiGetDocuments();
    apiGetStats();
  };
  document.head.appendChild(script);
})();

/* =========================================================
   THEME TOGGLE
   ========================================================= */
(function initTheme() {
  const html    = document.documentElement;
  const toggle  = $('themeToggle');
  const STORAGE = 'ocrDashTheme';

  // Apply saved or OS-preferred theme before paint
  const saved = localStorage.getItem(STORAGE);
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = saved || (prefersDark ? 'dark' : 'light');
  if (theme === 'light') html.setAttribute('data-theme', 'light');

  toggle.addEventListener('click', () => {
    const isLight = html.getAttribute('data-theme') === 'light';
    if (isLight) {
      html.removeAttribute('data-theme');          // back to dark (default :root)
      localStorage.setItem(STORAGE, 'dark');
    } else {
      html.setAttribute('data-theme', 'light');
      localStorage.setItem(STORAGE, 'light');
    }
    // Re-render charts with updated theme colors
    setTimeout(() => {
      if (typeof Chart !== 'undefined') {
        renderChunkChart();
        renderTypeChart();
      }
    }, 350); // Wait for CSS transitions to complete
  });
})();

/* =========================================================
   SERVER HEALTH POLLING
   ========================================================= */
(function initHealthCheck() {
  const statusEl  = $('systemStatus');
  const dotEl     = $('statusDot');
  const textEl    = $('statusText');
  let wasOffline  = false;

  async function checkHealth() {
    try {
      const res = await fetch('/api/stats', { method: 'GET', signal: AbortSignal.timeout(3000) });
      if (!res.ok) throw new Error('Non-OK response');

      // Server is UP
      if (wasOffline) {
        showToast('Server back online ✓', 'success');
        addActivity('Server reconnected — pipeline ready.', 'green');
        wasOffline = false;
      }
      statusEl.classList.remove('offline');
      dotEl.classList.add('pulse');
      textEl.textContent = 'System Online';

    } catch (_) {
      // Server is DOWN
      if (!wasOffline) {
        showToast('Server offline — run python server.py', 'error', 5000);
        addActivity('Server connection lost. Start the server to continue.', 'orange');
        wasOffline = true;
      }
      statusEl.classList.add('offline');
      dotEl.classList.remove('pulse');
      textEl.textContent = 'System Offline';
    }
  }

  // First check immediately, then every 5 seconds
  checkHealth();
  setInterval(checkHealth, 5000);
})();

/* =========================================================
   INITIALIZATION
   ========================================================= */
(function init() {
  navigateTo('upload');
  setTimeout(() => {
    addActivity('Dashboard connected to live OCR RAG pipeline API.', 'green');
  }, 800);
})();
