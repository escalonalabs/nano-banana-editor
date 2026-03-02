document.addEventListener('DOMContentLoaded', () => {
  const API_BASE = 'http://localhost:3001';

  const mainUploadZone = document.getElementById('main-upload-zone');
  const mainUploadInput = document.getElementById('upload-main');
  const editorWrapper = document.getElementById('editor-wrapper');
  const mainCanvas = document.getElementById('main-canvas');
  const maskCanvas = document.getElementById('mask-canvas');
  const secondaryUploadContainer = document.querySelector('.secondary-upload');
  const secondaryUploadInput = document.getElementById('upload-secondary');
  const imagesGrid = document.getElementById('secondary-images-container');
  const toolDraw = document.getElementById('tool-draw');
  const toolErase = document.getElementById('tool-erase');
  const clearMaskBtn = document.getElementById('clear-mask');
  const brushSizeInput = document.getElementById('brush-size');
  const modelSelector = document.getElementById('model-selector');
  const btnApplyAi = document.getElementById('btn-apply-ai');
  const btnUndo = document.getElementById('btn-undo');
  const btnRedo = document.getElementById('btn-redo');
  const btnExport = document.getElementById('btn-export');
  const loadingOverlay = document.getElementById('loading-overlay');

  const ctxMain = mainCanvas.getContext('2d');
  const ctxMask = maskCanvas.getContext('2d');

  const state = {
    projectId: null,
    targetAssetId: null,
    currentSnapshotId: null,
    sourceAssets: new Map(),
    activeSourceAssetId: null,
    isDrawing: false,
    isErasing: false,
    brushSize: Number.parseInt(brushSizeInput.value, 10),
    secondaryImagesCount: 0,
    isBusy: false,
    currentMainImage: null,
    selectedModel: '',
  };

  ctxMask.lineJoin = 'round';
  ctxMask.lineCap = 'round';
  updateBrushStyle();

  bootstrap().catch((error) => {
    showMessage(`Error inicializando editor: ${error.message}`, 'error');
  });

  async function bootstrap() {
    await ensureProject();
    await fetchAvailableModels();
  }

  function setLoading(active, text = 'Procesando...') {
    state.isBusy = active;
    const title = loadingOverlay.querySelector('h3');
    const subtitle = loadingOverlay.querySelector('p');
    if (title) {
      title.textContent = active ? 'Nano Banana 2 está procesando...' : 'Listo';
    }
    if (subtitle) {
      subtitle.textContent = text;
    }
    loadingOverlay.classList.toggle('hidden', !active);
    btnApplyAi.disabled = active;
    btnUndo.disabled = active;
    btnRedo.disabled = active;
    btnExport.disabled = active;
  }

  function showMessage(message, kind = 'info') {
    const notice = document.createElement('div');
    notice.style.cssText = `
      position: fixed;
      top: 90px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 9999;
      min-width: 340px;
      max-width: 85vw;
      color: white;
      border-radius: 12px;
      padding: 12px 18px;
      border: 1px solid rgba(255,255,255,0.15);
      background: ${kind === 'error' ? 'rgba(196, 38, 66, 0.95)' : kind === 'success' ? 'rgba(30, 120, 67, 0.95)' : 'rgba(20,20,30,0.94)'};
      box-shadow: 0 10px 25px rgba(0,0,0,0.35);
      font-size: 0.92rem;
      line-height: 1.4;
      white-space: pre-wrap;
    `;
    notice.textContent = message;
    document.body.appendChild(notice);

    setTimeout(() => {
      notice.remove();
    }, 4800);
  }

  async function ensureProject() {
    if (state.projectId) {
      return state.projectId;
    }

    const payload = await apiJson('/v1/projects', {
      method: 'POST',
      body: { name: `Local Project ${new Date().toISOString()}` },
    });

    state.projectId = payload.project.id;
    return state.projectId;
  }

  async function apiJson(path, options = {}) {
    const request = {
      method: options.method || 'GET',
      headers: {},
    };

    if (options.body !== undefined) {
      request.headers['content-type'] = 'application/json';
      request.body = JSON.stringify(options.body);
    }

    const response = await fetch(`${API_BASE}${path}`, request);
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      const detail = payload?.error || `HTTP ${response.status}`;
      throw new Error(detail);
    }

    return payload;
  }

  async function uploadImageAsset(fileOrBlob, filename, kind = 'generic') {
    await ensureProject();

    const formData = new FormData();
    formData.append('asset', fileOrBlob, filename);
    formData.append('kind', kind);

    const response = await fetch(`${API_BASE}/v1/projects/${state.projectId}/assets`, {
      method: 'POST',
      body: formData,
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.error || `Asset upload failed (${response.status})`);
    }

    return payload.asset;
  }

  function getAssetFileUrl(assetId) {
    return `${API_BASE}/v1/projects/${state.projectId}/assets/${assetId}/file?t=${Date.now()}`;
  }

  async function drawAssetToMainCanvas(assetId) {
    const image = await loadImage(getAssetFileUrl(assetId));
    state.currentMainImage = image;
    setupCanvases(image);
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('No se pudo cargar imagen'));
      img.src = src;
    });
  }

  async function fetchAvailableModels() {
    try {
      const data = await apiJson('/api/models');
      if (Array.isArray(data.models) && data.models.length > 0) {
        modelSelector.innerHTML = '';
        data.models.forEach((model) => {
          const option = document.createElement('option');
          option.value = model.name;
          option.textContent = model.displayName || model.name;
          modelSelector.appendChild(option);
        });
        state.selectedModel = modelSelector.value;
        modelSelector.style.display = 'block';
      }
    } catch {
      modelSelector.innerHTML = '<option value="">Modelos no disponibles</option>';
      modelSelector.style.display = 'block';
    }
  }

  modelSelector.addEventListener('change', () => {
    state.selectedModel = modelSelector.value;
  });

  mainUploadZone.addEventListener('click', (event) => {
    if (event.target !== mainUploadInput && event.target.tagName !== 'BUTTON') {
      mainUploadInput.click();
    }
  });

  mainUploadZone.addEventListener('dragover', (event) => {
    event.preventDefault();
    mainUploadZone.classList.add('dragover');
  });

  mainUploadZone.addEventListener('dragleave', () => {
    mainUploadZone.classList.remove('dragover');
  });

  mainUploadZone.addEventListener('drop', (event) => {
    event.preventDefault();
    mainUploadZone.classList.remove('dragover');
    const file = event.dataTransfer.files?.[0];
    if (file) {
      handleMainImageUpload(file).catch((error) => showMessage(error.message, 'error'));
    }
  });

  mainUploadInput.addEventListener('change', (event) => {
    const file = event.target.files?.[0];
    if (file) {
      handleMainImageUpload(file).catch((error) => showMessage(error.message, 'error'));
    }
  });

  async function handleMainImageUpload(file) {
    if (!file.type.startsWith('image/')) {
      throw new Error('Solo se permiten imágenes');
    }

    const localUrl = URL.createObjectURL(file);
    const image = await loadImage(localUrl);
    state.currentMainImage = image;
    setupCanvases(image);

    const targetAsset = await uploadImageAsset(file, file.name || 'target.png', 'target');
    state.targetAssetId = targetAsset.id;

    mainUploadZone.classList.add('hidden');
    editorWrapper.classList.remove('hidden');

    showMessage('Imagen principal cargada y sincronizada en proyecto local.', 'success');
  }

  function setupCanvases(img) {
    const maxHeight = window.innerHeight - 160;
    const maxWidth = editorWrapper.parentElement.clientWidth - 48;

    let drawWidth = img.width;
    let drawHeight = img.height;

    if (drawWidth > maxWidth || drawHeight > maxHeight) {
      const ratio = Math.min(maxWidth / drawWidth, maxHeight / drawHeight);
      drawWidth = Math.max(1, Math.round(drawWidth * ratio));
      drawHeight = Math.max(1, Math.round(drawHeight * ratio));
    }

    mainCanvas.width = drawWidth;
    mainCanvas.height = drawHeight;
    maskCanvas.width = drawWidth;
    maskCanvas.height = drawHeight;

    editorWrapper.style.width = `${drawWidth}px`;
    editorWrapper.style.height = `${drawHeight}px`;

    ctxMain.clearRect(0, 0, mainCanvas.width, mainCanvas.height);
    ctxMain.drawImage(img, 0, 0, drawWidth, drawHeight);

    updateBrushStyle();
    ctxMask.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
  }

  secondaryUploadContainer.addEventListener('click', () => {
    secondaryUploadInput.click();
  });

  document.querySelector('.sidebar').addEventListener('dragover', (event) => {
    event.preventDefault();
    secondaryUploadContainer.style.borderColor = 'var(--primary)';
  });

  document.querySelector('.sidebar').addEventListener('dragleave', () => {
    secondaryUploadContainer.style.borderColor = 'var(--border-color)';
  });

  document.querySelector('.sidebar').addEventListener('drop', (event) => {
    event.preventDefault();
    secondaryUploadContainer.style.borderColor = 'var(--border-color)';
    if (event.dataTransfer.files?.length) {
      handleSecondaryImages(Array.from(event.dataTransfer.files)).catch((error) => showMessage(error.message, 'error'));
    }
  });

  secondaryUploadInput.addEventListener('change', (event) => {
    if (event.target.files?.length) {
      handleSecondaryImages(Array.from(event.target.files)).catch((error) => showMessage(error.message, 'error'));
    }
  });

  async function handleSecondaryImages(files) {
    for (const file of files) {
      if (!file.type.startsWith('image/')) {
        continue;
      }
      const asset = await uploadImageAsset(file, file.name || `source-${Date.now()}.png`, 'source');
      state.secondaryImagesCount += 1;
      const localUrl = URL.createObjectURL(file);
      createThumbnail(localUrl, state.secondaryImagesCount, asset);

      if (!state.activeSourceAssetId) {
        state.activeSourceAssetId = asset.id;
      }
    }

    secondaryUploadInput.value = '';
  }

  function createThumbnail(src, countId, asset) {
    const card = document.createElement('div');
    card.className = 'thumbnail-item';
    card.dataset.assetId = asset.id;
    card.innerHTML = `
      <img src="${src}" alt="Fuente ${countId}">
      <button class="remove-btn" title="Eliminar"><i class="fa-solid fa-xmark"></i></button>
      <span class="source-badge">Col. ${countId}</span>
    `;

    state.sourceAssets.set(asset.id, asset);

    card.addEventListener('click', (event) => {
      if (event.target.closest('.remove-btn')) {
        return;
      }
      document.querySelectorAll('.thumbnail-item').forEach((el) => el.classList.remove('active-source'));
      card.classList.add('active-source');
      state.activeSourceAssetId = asset.id;

      const promptInput = document.getElementById('ai-prompt');
      if (!promptInput.value) {
        promptInput.value = `Inserta el objeto principal de la Col. ${countId} en la zona marcada, igualando iluminación y perspectiva.`;
      }
    });

    card.querySelector('.remove-btn').addEventListener('click', (event) => {
      event.stopPropagation();
      state.sourceAssets.delete(asset.id);
      if (state.activeSourceAssetId === asset.id) {
        state.activeSourceAssetId = null;
      }
      card.remove();
    });

    imagesGrid.insertBefore(card, secondaryUploadContainer);
  }

  function updateBrushStyle() {
    ctxMask.lineWidth = state.brushSize;
    ctxMask.lineJoin = 'round';
    ctxMask.lineCap = 'round';

    if (state.isErasing) {
      ctxMask.globalCompositeOperation = 'destination-out';
      ctxMask.shadowBlur = 0;
    } else {
      ctxMask.globalCompositeOperation = 'source-over';
      ctxMask.strokeStyle = 'rgba(138, 43, 226, 0.82)';
      ctxMask.shadowColor = 'rgba(138, 43, 226, 0.95)';
      ctxMask.shadowBlur = 8;
    }
  }

  function getCanvasPosition(event) {
    const rect = maskCanvas.getBoundingClientRect();
    const scaleX = maskCanvas.width / rect.width;
    const scaleY = maskCanvas.height / rect.height;

    return {
      x: (event.clientX - rect.left) * scaleX,
      y: (event.clientY - rect.top) * scaleY,
    };
  }

  maskCanvas.addEventListener('mousedown', (event) => {
    state.isDrawing = true;
    updateBrushStyle();
    const pos = getCanvasPosition(event);
    ctxMask.beginPath();
    ctxMask.moveTo(pos.x, pos.y);
    ctxMask.lineTo(pos.x, pos.y);
    ctxMask.stroke();
  });

  maskCanvas.addEventListener('mousemove', (event) => {
    if (!state.isDrawing) {
      return;
    }
    const pos = getCanvasPosition(event);
    ctxMask.lineTo(pos.x, pos.y);
    ctxMask.stroke();
  });

  window.addEventListener('mouseup', () => {
    if (state.isDrawing) {
      state.isDrawing = false;
      ctxMask.closePath();
    }
  });

  toolDraw.addEventListener('click', () => {
    state.isErasing = false;
    toolDraw.classList.add('active');
    toolErase.classList.remove('active');
    updateBrushStyle();
  });

  toolErase.addEventListener('click', () => {
    state.isErasing = true;
    toolErase.classList.add('active');
    toolDraw.classList.remove('active');
    updateBrushStyle();
  });

  brushSizeInput.addEventListener('input', (event) => {
    state.brushSize = Number.parseInt(event.target.value, 10);
    updateBrushStyle();
  });

  clearMaskBtn.addEventListener('click', () => {
    ctxMask.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
  });

  function getMaskBounds() {
    const { width, height } = maskCanvas;
    const data = ctxMask.getImageData(0, 0, width, height).data;

    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const alpha = data[(y * width + x) * 4 + 3];
        if (alpha > 15) {
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }

    if (maxX === -1 || maxY === -1) {
      return null;
    }

    return {
      minX,
      minY,
      maxX,
      maxY,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
      centerX: minX + (maxX - minX + 1) / 2,
      centerY: minY + (maxY - minY + 1) / 2,
    };
  }

  async function watchJobUntilDone(jobId) {
    for (;;) {
      const payload = await apiJson(`/v1/jobs/${jobId}`);
      const job = payload.job;

      const progressPct = Math.round((job.progress || 0) * 100);
      setLoading(true, `Job ${job.status} · ${progressPct}%`);

      if (job.status === 'completed') {
        return job.result;
      }

      if (job.status === 'failed') {
        throw new Error(job.error || 'Job failed');
      }

      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  btnApplyAi.addEventListener('click', async () => {
    if (state.isBusy) {
      return;
    }

    try {
      if (!state.targetAssetId) {
        throw new Error('Sube una imagen principal primero.');
      }

      if (!state.activeSourceAssetId && state.sourceAssets.size) {
        state.activeSourceAssetId = state.sourceAssets.keys().next().value;
      }

      const activeSource = state.activeSourceAssetId
        ? state.sourceAssets.get(state.activeSourceAssetId)
        : null;

      const maskBounds = getMaskBounds();
      if (!maskBounds) {
        throw new Error('Dibuja una máscara para definir el área de inserción.');
      }

      setLoading(true, 'Empaquetando máscara y enviando operación...');

      const maskBlob = await new Promise((resolve) => maskCanvas.toBlob(resolve, 'image/png'));
      if (!maskBlob) {
        throw new Error('No se pudo generar máscara.');
      }

      const maskAsset = await uploadImageAsset(maskBlob, 'mask.png', 'mask');

      const sourceWidth = activeSource?.width || maskBounds.width;
      const scale = Math.max(0.05, Math.min(4, maskBounds.width / Math.max(1, sourceWidth)));

      const promptValue = document.getElementById('ai-prompt').value.trim();

      const transferPayload = {
        projectId: state.projectId,
        targetAssetId: state.targetAssetId,
        sourceMask: { kind: 'raster', assetId: maskAsset.id },
        placement: {
          x: Math.round(maskBounds.centerX),
          y: Math.round(maskBounds.centerY),
          scale,
          rotationDeg: 0,
        },
        promptDirectives: promptValue || 'Transfer the source object into the selected target area with coherent lighting and edges.',
        qualityMode: 'preview',
        refine: {
          featherPx: Math.max(1, Math.round(state.brushSize / 2)),
          relight: 0.3,
          colorMatch: 0.5,
          shadow: 'auto',
        },
      };

      if (activeSource?.id) {
        transferPayload.sourceAssetId = activeSource.id;
      }

      const operation = await apiJson(`/v1/projects/${state.projectId}/operations/object-transfer`, {
        method: 'POST',
        body: transferPayload,
      });

      const result = await watchJobUntilDone(operation.job.id);

      state.currentSnapshotId = result.snapshotId;
      state.targetAssetId = result.finalCandidateAssetIds[0];

      await drawAssetToMainCanvas(state.targetAssetId);
      ctxMask.clearRect(0, 0, maskCanvas.width, maskCanvas.height);

      const quality = result.qualityReport || {};
      const artifactText = Array.isArray(quality.artifacts) && quality.artifacts.length
        ? `\nArtefactos detectados: ${quality.artifacts.join(', ')}`
        : '';

      showMessage(
        `Edición completada.\nEdge score: ${quality.edgeScore ?? '-'}\nDeltaE: ${quality.colorDeltaE ?? '-'}${artifactText}`,
        'success'
      );
    } catch (error) {
      showMessage(`Fallo en transferencia: ${error.message}`, 'error');
    } finally {
      setLoading(false);
    }
  });

  async function applySnapshotFromState(snapshot) {
    if (!snapshot) {
      return;
    }
    const candidate = snapshot.assetIds?.candidateAssetIds?.[0] || snapshot.previewAssetId;
    if (!candidate) {
      return;
    }
    state.currentSnapshotId = snapshot.id;
    state.targetAssetId = candidate;
    await drawAssetToMainCanvas(candidate);
    ctxMask.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
  }

  btnUndo.addEventListener('click', async () => {
    if (state.isBusy) return;
    try {
      setLoading(true, 'Deshaciendo última operación...');
      const payload = await apiJson(`/v1/projects/${state.projectId}/history/undo`, { method: 'POST', body: {} });
      await applySnapshotFromState(payload.currentSnapshot);
      showMessage('Undo aplicado.', 'success');
    } catch (error) {
      showMessage(`No se pudo deshacer: ${error.message}`, 'error');
    } finally {
      setLoading(false);
    }
  });

  btnRedo.addEventListener('click', async () => {
    if (state.isBusy) return;
    try {
      setLoading(true, 'Rehaciendo operación...');
      const payload = await apiJson(`/v1/projects/${state.projectId}/history/redo`, { method: 'POST', body: {} });
      await applySnapshotFromState(payload.currentSnapshot);
      showMessage('Redo aplicado.', 'success');
    } catch (error) {
      showMessage(`No se pudo rehacer: ${error.message}`, 'error');
    } finally {
      setLoading(false);
    }
  });

  btnExport.addEventListener('click', async () => {
    if (state.isBusy) return;
    try {
      if (!state.targetAssetId) {
        throw new Error('No hay resultado para exportar.');
      }
      setLoading(true, 'Exportando PNG...');
      const payload = await apiJson(`/v1/projects/${state.projectId}/export`, {
        method: 'POST',
        body: {
          snapshotId: state.currentSnapshotId,
          candidateAssetId: state.targetAssetId,
          format: 'png',
        },
      });

      showMessage(`Export generado:\n${payload.export.filePath}`, 'success');
    } catch (error) {
      showMessage(`Export falló: ${error.message}`, 'error');
    } finally {
      setLoading(false);
    }
  });
});
