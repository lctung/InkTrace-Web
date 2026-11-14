(function () {
  'use strict';

  const getElement = id => document.getElementById(id);
  const inkTrace = InkTrace;
  const MAX_BOARD_SIZE = 300;
  const MIN_SAMPLE_DISTANCE = 0.4;
  const SHOUJIN_GUIDE_FONT = '400 100px InkTraceShoujin';

  const boards = Array.from(document.querySelectorAll('[data-board]'), element => {
    const side = element.dataset.board;
    const canvas = element.querySelector('.writing-canvas');
    const guide = element.querySelector('.guide-canvas');
    return {
      side,
      fields: inkTrace.boardFields[side],
      canvas,
      guide,
      ctx: canvas.getContext('2d'),
      guideContext: guide.getContext('2d'),
      slot: element.querySelector('.canvas-slot'),
      paper: element.querySelector('.paper'),
      buttons: Array.from(element.querySelectorAll('[data-action]')),
      link: element.querySelector('.board-link'),
      pointer: null,
      pointerType: '',
      strokeRect: null,
      frame: 0,
      drawnPoints: 0,
      line: null,
      points: 0,
    };
  });
  let papers = [];
  let activePaper = null;
  let characterIndex = 0;
  let isUploading = false;
  let editingPaperId = null;
  let penDetected = false;
  let allowFinger = false;
  let characterListPaper = null;
  let characterListStart = -1;
  let characterListIndex = -1;
  let completedCount = 0;
  let countedIndex = -1;
  let countedAsComplete = false;
  let shoujinFontLoaded = false;
  let githubSettings = {
    configured: false,
    owner: '',
    repo: '',
    branch: 'main'
  };
  let isUpdatingSettings = false;
  let theme = 'system';

  const getUploadDestination = () => githubSettings.owner && githubSettings.repo
    ? `${githubSettings.owner}/${githubSettings.repo}@main`
    : '';
  const getCurrentDraft = () => activePaper.drafts[characterIndex] ||= { strokes: [] };
  const getBoardStrokes = board => getCurrentDraft()[board.fields.strokes] ||= [];
  const hasInk = entry => Boolean(entry?.strokes?.length || entry?.roughStrokes?.length);
  const isDrawing = () => boards.some(board => board.pointer !== null);
  const editor = getElement('editor');
  const penInput = getElement('pen-input');
  const inputStatus = getElement('input-status');

  function updateInputMode() {
    const penOnly = penDetected && !allowFinger;
    penInput.checked = penOnly;
    inputStatus.textContent = penOnly ? '防誤觸已開啟' : '';
  }

  function recognizePen(event) {
    if (event.pointerType !== 'pen' || penDetected) {
      return;
    }
    penDetected = true;
    updateInputMode();
    if (!allowFinger) {
      for (const board of boards) {
        if (board.pointerType === 'touch') {
          discardPalmStroke(board);
        }
      }
    }
  }

  penInput.onchange = () => {
    penDetected ||= penInput.checked;
    allowFinger = !penInput.checked;
    updateInputMode();
    if (penInput.checked) {
      for (const board of boards) {
        if (board.pointerType === 'touch') {
          discardPalmStroke(board);
        }
      }
    }
  };

  const showMessage = (text, error = false) => {
    getElement('message').textContent = text;
    getElement('message').classList.toggle('error', error);
  };
  const showSettingsMessage = (text, error = false) => {
    getElement('settings-status').textContent = text;
    getElement('settings-status').classList.toggle('error', error);
  };

  async function savePaper(p = activePaper) {
    if (!p) {
      return;
    }
    try {
      await PaperStore.put(p);
    } catch (e) {
      showMessage(e.message, true);
    }
  }

  async function saveCurrentDraft() {
    const draft = activePaper?.drafts[characterIndex];
    if (!draft) {
      return;
    }
    try {
      await PaperStore.putDraft(activePaper.id, characterIndex, draft);
    } catch (error) {
      showMessage(error.message, true);
    }
  }

  function displayDate(at) {
    return new Date(at).toLocaleString('zh-TW', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function renderHome() {
    const list = getElement('papers');
    list.replaceChildren();
    let found = 0;
    const query = getElement('search').value.trim();
    for (const p of papers.filter(p => p.title.includes(query)).sort((a, b) => b.createdAt - a.createdAt)) {
      found++;
      const completed = inkTrace.count(p, getUploadDestination());
      const card = document.createElement('article');
      card.className = 'chapter';
      card.classList.toggle('complete', completed === p.chars.length);
      const open = document.createElement('button');
      open.className = 'chapter-main';
      open.onclick = () => openPaper(p.id);
      const icon = document.createElement('span');
      icon.className = 'chapter-icon';
      icon.textContent = [...p.title][0];
      const info = document.createElement('div');
      const name = document.createElement('div');
      const sub = document.createElement('div');
      name.className = 'chapter-title';
      name.textContent = p.title;
      sub.className = 'chapter-info';
      sub.textContent = `${completed} / ${p.chars.length} 已上傳`;
      info.append(name, sub);
      open.append(icon, info);
      const bar = document.createElement('progress');
      bar.max = p.chars.length;
      bar.value = completed;
      bar.setAttribute('aria-label', p.title + '上傳進度');
      const foot = document.createElement('div');
      foot.className = 'chapter-footer';
      const date = document.createElement('span');
      const at = Math.max(0, ...Object.values(p.drafts).map(d => Math.max(d.uploaded?.at || 0, d.roughUploaded?.at || 0)));
      date.textContent = at ? '上傳於 ' + displayDate(at) : '尚無上傳時間';
      const rename = document.createElement('button');
      rename.className = 'text-button';
      rename.textContent = '改名';
      rename.onclick = () => showPaperDialog(p);
      const remove = document.createElement('button');
      remove.className = 'text-button';
      remove.textContent = '刪除';
      remove.onclick = async () => {
        if (confirm(`刪除「${p.title}」及本機草稿？GitHub 檔案會保留。`)) {
          try {
            await PaperStore.remove(p.id);
            papers = papers.filter(x => x.id !== p.id);
            renderHome();
          } catch (e) {
            showMessage(e.message, true);
          }
        }
      };
      foot.append(date, rename, remove);
      card.append(open, bar, foot);
      list.append(card);
    }
    getElement('empty').hidden = !!found;
    getElement('empty').textContent = query ? '找不到稿紙' : '尚無稿紙';
  }

  function updateCharacterButton(button, index) {
    const done = inkTrace.pairDone(activePaper, index, getUploadDestination());
    const hasDraft = hasInk(activePaper.drafts[index]);
    const selected = index === characterIndex;
    button.classList.toggle('selected', selected);
    button.classList.toggle('done', done);
    button.classList.toggle('draft', hasDraft && !done);
    button.disabled = isUploading;
    button.setAttribute('aria-pressed', String(selected));
    const status = done ? '已上傳' : hasDraft ? '有草稿' : '未寫';
    button.setAttribute('aria-label', `${activePaper.chars[index]}，第 ${index + 1} 字，${status}`);
  }

  function createCharacterButton(index) {
    const button = document.createElement('button');
    button.className = 'char';
    button.textContent = activePaper.chars[index];
    updateCharacterButton(button, index);
    button.onclick = () => {
      selectCharacter(index);
      getElement('progress-dialog').close();
    };
    return button;
  }

  function refreshCompletedCount() {
    completedCount = inkTrace.count(activePaper, getUploadDestination());
    countedIndex = characterIndex;
    countedAsComplete = inkTrace.pairDone(activePaper, characterIndex, getUploadDestination());
  }

  function updateEditorControls() {
    const complete = inkTrace.pairDone(activePaper, characterIndex, getUploadDestination());
    if (countedIndex === characterIndex) {
      completedCount += Number(complete) - Number(countedAsComplete);
    }
    countedIndex = characterIndex;
    countedAsComplete = complete;
    getElement('counter').textContent = `${completedCount} / ${activePaper.chars.length} 已完成`;
    getElement('completion').value = completedCount;

    const row = getElement('characters');
    const start = Math.floor(characterIndex / 8) * 8;
    if (characterListPaper !== activePaper || characterListStart !== start) {
      row.replaceChildren();
      for (let index = start; index < Math.min(start + 8, activePaper.chars.length); index++) {
        row.append(createCharacterButton(index));
      }
      characterListPaper = activePaper;
      characterListStart = start;
      characterListIndex = -1;
    } else {
      Array.from(row.children).forEach((button, index) => updateCharacterButton(button, start + index));
    }
    if (characterListIndex !== characterIndex) {
      characterListIndex = characterIndex;
      const selected = row.children[characterIndex - start];
      row.scrollLeft = Math.max(0, selected.offsetLeft - (row.clientWidth - selected.offsetWidth) / 2);
    }

    let uploaded = 0;
    let pendingUpload = false;
    for (const board of boards) {
      const boardComplete = inkTrace.done(activePaper, characterIndex, getUploadDestination(), board.side);
      if (boardComplete) {
        uploaded++;
      }
      const hasStrokes = getBoardStrokes(board).length > 0;
      pendingUpload ||= hasStrokes && !boardComplete;
      for (const button of board.buttons) {
        button.disabled = isUploading || !hasStrokes;
      }
      board.link.hidden = !boardComplete;
      if (boardComplete) {
        board.link.href = getCurrentDraft()[board.fields.upload].url;
      }
    }
    getElement('prev').disabled = isUploading || characterIndex === 0;
    getElement('next').disabled = isUploading || characterIndex === activePaper.chars.length - 1;
    for (const id of ['back', 'view-progress', 'settings', 'add-paper']) {
      getElement(id).disabled = isUploading;
    }
    getElement('upload').disabled = isUploading || !pendingUpload;
    getElement('draft-state').textContent = uploaded
      ? `${uploaded} / 2 份筆跡已上傳`
      : hasInk(getCurrentDraft()) ? '草稿 · 尚未上傳' : '';
  }

  function renderEditor() {
    if (!activePaper) {
      return;
    }
    getElement('completion').max = activePaper.chars.length;
    getElement('paper-name').textContent = activePaper.title;
    getElement('target').textContent = activePaper.chars[characterIndex];
    getElement('position').textContent = `第 ${characterIndex + 1} / ${activePaper.chars.length} 字`;
    updateEditorControls();
    for (const board of boards) {
      drawStrokes(board);
    }
    fitCanvas();
  }

  function drawSample(context, point, previous) {
    if (previous) {
      context.lineWidth = (previous.width + point.width) / 2;
      context.beginPath();
      context.moveTo(previous.x, previous.y);
      context.lineTo(point.x, point.y);
      context.stroke();
    }
    context.beginPath();
    context.arc(point.x, point.y, point.width / 2, 0, Math.PI * 2);
    context.fill();
  }

  function drawStrokes(board) {
    const { ctx } = board;
    ctx.setTransform(2.5, 0, 0, 2.5, 0, 0);
    ctx.clearRect(0, 0, 400, 400);
    ctx.fillStyle = ctx.strokeStyle = '#111';
    ctx.lineCap = ctx.lineJoin = 'round';
    for (const line of getBoardStrokes(board)) {
      for (let index = 0; index < line.length; index++) {
        drawSample(ctx, line[index], line[index - 1]);
      }
    }
    board.drawnPoints = board.line?.length || 0;
  }

  function drawPendingSamples(board) {
    if (board.frame) {
      cancelAnimationFrame(board.frame);
      board.frame = 0;
    }
    if (!board.line) {
      return;
    }
    for (let index = board.drawnPoints; index < board.line.length; index++) {
      drawSample(board.ctx, board.line[index], board.line[index - 1]);
    }
    board.drawnPoints = board.line.length;
  }

  function scheduleSamples(board) {
    if (!board.frame) {
      board.frame = requestAnimationFrame(() => {
        board.frame = 0;
        drawPendingSamples(board);
      });
    }
  }

  function drawGuides() {
    if (!activePaper) {
      return;
    }
    const character = activePaper.chars[characterIndex];
    for (const board of boards) {
      const ctx = board.guideContext;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, 1000, 1000);
      if (board.side === 'rough' && (!shoujinFontLoaded || !InkTraceShoujin.hasGlyph(character))) {
        continue;
      }

      ctx.font = board.side === 'regular'
        ? '100 100px InkTraceGuide, sans-serif'
        : SHOUJIN_GUIDE_FONT;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      const fit = inkTrace.fitBounds(ctx.measureText(character), 1000);
      if (!fit) {
        continue;
      }
      ctx.setTransform(fit.scale, 0, 0, fit.scale, 500, 500);
      ctx.fillStyle = '#e9e9e9';
      ctx.fillText(character, fit.x, fit.y);
    }
  }

  function selectCharacter(nextIndex) {
    if (isUploading || !activePaper || nextIndex < 0 || nextIndex >= activePaper.chars.length) {
      return;
    }
    finishAllStrokes();
    characterIndex = nextIndex;
    activePaper.selected = characterIndex;
    drawGuides();
    renderEditor();
    savePaper();
    showMessage('');
  }

  function openPaper(id) {
    activePaper = papers.find(p => p.id === id);
    characterIndex = Math.min(activePaper.selected || 0, activePaper.chars.length - 1);
    refreshCompletedCount();
    getElement('home').hidden = true;
    getElement('editor').hidden = false;
    document.body.classList.add('writing-mode');
    window.scrollTo(0, 0);
    showMessage('');
    drawGuides();
    renderEditor();
  }

  function readPointerPoint(board, event, release = false) {
    const rect = board.strokeRect;
    const previous = board.line?.at(-1);
    const width = release && previous ? previous.width : inkTrace.width(
      Number(getElement('width').value),
      event.pointerType === 'pen' ? event.pressure : 1,
      Number(getElement('pressure').value) / 100,
    );
    const margin = width / 2;
    return {
      x: Math.max(margin, Math.min(400 - margin, (event.clientX - rect.left) / rect.width * 400)),
      y: Math.max(margin, Math.min(400 - margin, (event.clientY - rect.top) / rect.height * 400)),
      width,
    };
  }

  function releaseStroke(board) {
    const pointer = board.pointer;
    board.line = null;
    board.pointer = null;
    board.pointerType = '';
    board.strokeRect = null;
    if (board.canvas.hasPointerCapture(pointer)) {
      board.canvas.releasePointerCapture(pointer);
    }
  }

  function discardPalmStroke(board) {
    if (board.frame) {
      cancelAnimationFrame(board.frame);
      board.frame = 0;
    }
    const lines = getBoardStrokes(board);
    const index = lines.indexOf(board.line);
    if (index !== -1) {
      lines.splice(index, 1);
    }
    releaseStroke(board);
    drawStrokes(board);
    saveCurrentDraft();
    updateEditorControls();
  }

  function finishStroke(board) {
    if (board.pointer === null) {
      return;
    }
    drawPendingSamples(board);
    releaseStroke(board);
    saveCurrentDraft();
    updateEditorControls();
    fitCanvas();
  }

  function finishAllStrokes() {
    for (const board of boards) {
      finishStroke(board);
    }
  }

  function download(board) {
    const filename = inkTrace.name(activePaper.chars[characterIndex]).replace(/\.svg$/, board.side === 'regular' ? '-工整.svg' : '-潦草.svg');
    const url = URL.createObjectURL(new Blob([inkTrace.svg(getBoardStrokes(board))], { type: 'image/svg+xml;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  for (const board of boards) {
    const { canvas } = board;
    canvas.addEventListener('pointerdown', event => {
      if (!activePaper || isUploading) {
        return;
      }
      if (event.cancelable) {
        event.preventDefault();
      }
      recognizePen(event);
      if (
        (event.button !== 0 && !(event.pointerType === 'pen' && event.button === -1)) ||
        (event.pointerType === 'touch' && penDetected && !allowFinger)
      ) {
        return;
      }
      if (event.pointerType === 'pen') {
        for (const otherBoard of boards) {
          if (otherBoard.pointerType === 'pen') {
            finishStroke(otherBoard);
          }
        }
      }
      if (board.pointer !== null) {
        return;
      }

      const lines = getBoardStrokes(board);
      board.points = lines.reduce((count, line) => count + line.length, 0);
      if (lines.length >= 1000 || board.points >= 20000) {
        showMessage('筆跡達上限，請復原或清除部分筆畫。', true);
        return;
      }

      board.strokeRect = canvas.getBoundingClientRect();
      board.pointer = event.pointerId;
      board.pointerType = event.pointerType;
      board.drawnPoints = 0;
      board.line = [readPointerPoint(board, event)];
      board.points++;
      lines.push(board.line);
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch {
        // Window listeners can finish the stroke if capture is unavailable.
      }
      drawPendingSamples(board);
      showMessage('');
    });

    window.addEventListener('pointermove', event => {
      if (event.pointerId !== board.pointer) {
        return;
      }
      if (event.cancelable) {
        event.preventDefault();
      }
      const samples = event.getCoalescedEvents?.();
      for (const sample of samples?.length ? samples : [event]) {
        const next = readPointerPoint(board, sample);
        const last = board.line.at(-1);
        if (Math.hypot(next.x - last.x, next.y - last.y) < MIN_SAMPLE_DISTANCE) {
          continue;
        }
        if (board.points >= 20000) {
          finishStroke(board);
          showMessage('筆跡達上限，請減少筆畫。', true);
          return;
        }
        board.line.push(next);
        board.points++;
      }
      scheduleSamples(board);
    }, { passive: false });

    window.addEventListener('pointerup', event => {
      if (event.pointerId !== board.pointer) {
        return;
      }
      const next = readPointerPoint(board, event, true);
      const last = board.line.at(-1);
      if (board.points < 20000 && Math.hypot(next.x - last.x, next.y - last.y) > 0.2) {
        board.line.push(next);
      }
      finishStroke(board);
    });

    for (const type of ['pointercancel', 'lostpointercapture']) {
      window.addEventListener(type, event => {
        if (event.pointerId === board.pointer) {
          finishStroke(board);
        }
      });
    }

    for (const button of board.buttons) {
      button.onclick = () => {
        finishAllStrokes();
        const action = button.dataset.action;
        if (action === 'download') {
          return download(board);
        }
        if (action === 'undo') {
          getBoardStrokes(board).pop();
        }
        else {
          getCurrentDraft()[board.fields.strokes] = [];
        }
        saveCurrentDraft();
        drawStrokes(board);
        updateEditorControls();
        showMessage('');
      };
    }
  }

  getElement('prev').onclick = () => selectCharacter(characterIndex - 1);
  getElement('next').onclick = () => selectCharacter(characterIndex + 1);
  getElement('width').oninput = () => {
    getElement('width-value').value = getElement('width').value;
  };
  getElement('pressure').oninput = () => {
    getElement('pressure-value').value = getElement('pressure').value;
  };
  getElement('show-guide').onchange = () => {
    for (const board of boards) {
      board.guide.hidden = !getElement('show-guide').checked;
    }
  };
  getElement('back').onclick = () => {
    if (isUploading) {
      return;
    }
    finishAllStrokes();
    savePaper();
    activePaper = null;
    document.body.classList.remove('writing-mode');
    getElement('editor').hidden = true;
    getElement('home').hidden = false;
    renderHome();
    showMessage('');
  };

  function enablePenTap(button) {
    const activate = button.onclick;
    let penDown = null;
    let handledPenUp = -Infinity;

    button.addEventListener('pointerdown', event => {
      handledPenUp = -Infinity;
      penDown = event.pointerType === 'pen' && !button.disabled
        ? { id: event.pointerId, x: event.clientX, y: event.clientY }
        : null;
    });
    button.addEventListener('pointercancel', () => { penDown = null; });
    button.addEventListener('pointerleave', () => { penDown = null; });
    button.addEventListener('pointerup', event => {
      const start = penDown;
      penDown = null;
      if (
        !start || event.pointerType !== 'pen' || event.pointerId !== start.id ||
        button.disabled || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 12
      ) {
        return;
      }
      handledPenUp = event.timeStamp;
      activate.call(button, event);
    });
    button.onclick = event => {
      const elapsed = event.timeStamp - handledPenUp;
      if ((event.pointerType === 'pen' || event.detail > 0) && elapsed >= 0 && elapsed < 450) {
        handledPenUp = -Infinity;
        return;
      }
      activate.call(button, event);
    };
  }

  for (const id of ['back', 'prev', 'next']) {
    enablePenTap(getElement(id));
  }
  for (const board of boards) {
    for (const button of board.buttons.filter(button => button.dataset.action !== 'download')) {
      enablePenTap(button);
    }
  }
  getElement('search').oninput = renderHome;
  getElement('view-progress').onclick = () => {
    getElement('progress-grid').replaceChildren();
    for (let i = 0; i < activePaper.chars.length; i++) {
      getElement('progress-grid').append(createCharacterButton(i));
    }
    getElement('progress-dialog').showModal();
  };
  getElement('upload').onclick = async () => {
    if (isUploading || !activePaper) {
      return;
    }
    finishAllStrokes();
    if (!githubSettings.configured) {
      showSettings();
      showSettingsMessage('請先儲存 GitHub 設定。');
      return;
    }
    const pending = boards.filter(board =>
      getBoardStrokes(board).length &&
      !inkTrace.done(activePaper, characterIndex, getUploadDestination(), board.side)
    );
    if (!pending.length) {
      return;
    }
    isUploading = true;
    renderEditor();
    try {
      await InkTraceGitHub.check(githubSettings);
      for (const board of pending) {
        const ink = getBoardStrokes(board);
        showMessage(board.side === 'regular' ? '上傳工整筆跡中…' : '上傳潦草筆跡中…');
        const result = await InkTraceGitHub.upload(
          githubSettings,
          activePaper.title,
          activePaper.chars[characterIndex],
          board.side,
          inkTrace.svg(ink),
        );
        getCurrentDraft()[board.fields.upload] = {
          ...result,
          svgFormat: inkTrace.svgFormat,
          signature: inkTrace.signature(ink),
          title: activePaper.title,
          destination: getUploadDestination(),
          at: Date.now(),
        };
        await saveCurrentDraft();
      }
      showMessage('已上傳。');
    } catch (error) {
      showMessage(error.message, true);
    } finally {
      isUploading = false;
      renderEditor();
    }
  };

  function showPaperDialog(p = null) {
    editingPaperId = p?.id || null;
    getElement('paper-dialog-title').textContent = p ? '稿紙改名' : '新增稿紙';
    getElement('new-title').value = p?.title || '';
    getElement('new-text').value = '';
    getElement('new-text').required = !p;
    getElement('text-label').hidden = getElement('import-row').hidden = !!p;
    getElement('paper-form-error').textContent = p ? '改名後會上傳至新目錄；原 GitHub 檔案不會搬移。' : '';
    getElement('text-file').value = '';
    getElement('paper-dialog').showModal();
  }
  getElement('add-paper').onclick = () => showPaperDialog();
  getElement('paper-form').onsubmit = async e => {
    e.preventDefault();
    try {
      const title = inkTrace.title(getElement('new-title').value);
      if (papers.some(p => p.id !== editingPaperId && p.title === title)) {
        throw Error('已有同名稿紙。');
      }
      if (editingPaperId) {
        const p = papers.find(p => p.id === editingPaperId);
        const next = { ...p, title };
        await PaperStore.put(next);
        papers = papers.map(x => x.id === p.id ? next : x);
      }
      else {
        const p = inkTrace.paper(title, getElement('new-text').value);
        await PaperStore.put(p);
        papers.push(p);
      }
      getElement('paper-dialog').close();
      renderHome();
      showMessage('');
    } catch (e) {
      getElement('paper-form-error').textContent = e.message;
    }
  };
  getElement('text-file').onchange = async () => {
    try {
      const f = getElement('text-file').files[0];
      if (!f) {
        return;
      }
      if (f.size > 65536) {
        throw Error('TXT 上限為 64 KB。');
      }
      const text = new TextDecoder('utf-8', { fatal: true }).decode(await f.arrayBuffer());
      inkTrace.characters(text);
      getElement('new-text').value = text;
      if (!getElement('new-title').value) {
        getElement('new-title').value = f.name.replace(/\.txt$/i, '');
      }
      getElement('paper-form-error').textContent = '';
    } catch (e) {
      getElement('paper-form-error').textContent = e.message;
    }
  };
  getElement('paste-json').onclick = () => {
    getElement('json-input').value = '';
    getElement('json-error').textContent = '';
    getElement('json-dialog').showModal();
  };
  getElement('json-form').onsubmit = e => {
    e.preventDefault();
    try {
      const data = inkTrace.parseJSON(getElement('json-input').value);
      getElement('new-title').value = data.title;
      getElement('new-text').value = data.text;
      getElement('json-dialog').close();
    } catch (e) {
      getElement('json-error').textContent = e.message;
    }
  };

  function setGithub(value) {
    githubSettings = value;
    getElement('connection-dot').classList.toggle('connected', githubSettings.configured);
    getElement('connection-dot').setAttribute('aria-label', githubSettings.configured ? '已設定' : '尚未設定');
    try {
      if (githubSettings.owner) {
        localStorage.setItem('inktrace-github', JSON.stringify({ owner: githubSettings.owner, repo: githubSettings.repo }));
      } else {
        localStorage.removeItem('inktrace-github');
      }
    } catch (_) { }
    renderHome();
    if (activePaper) {
      refreshCompletedCount();
      updateEditorControls();
    }
  }

  function showSettings() {
    getElement('owner').value = githubSettings.owner;
    getElement('repo').value = githubSettings.repo;
    getElement('token').value = '';
    getElement('token').placeholder = githubSettings.configured ? '重新設定時請填入 Token' : 'github_pat_…';
    showSettingsMessage('');
    getElement('settings-dialog').showModal();
  }
  getElement('settings').onclick = showSettings;

  function runSettingsAction(action) {
    return async e => {
      e.preventDefault();
      if (isUpdatingSettings) {
        return;
      }
      isUpdatingSettings = true;
      for (const b of getElement('settings-form').querySelectorAll('button')) {
        b.disabled = true;
      }
      try {
        await action();
      } catch (e) {
        showSettingsMessage(e.message, true);
      } finally {
        isUpdatingSettings = false;
        for (const b of getElement('settings-form').querySelectorAll('button')) {
          b.disabled = false;
        }
      }
    };
  }
  getElement('settings-form').onsubmit = runSettingsAction(async () => {
    const result = InkTraceGitHub.configure(getElement('owner').value.trim(), getElement('repo').value.trim(), getElement('token').value.trim());
    getElement('token').value = '';
    setGithub(result);
    showSettingsMessage('已儲存，請測試連線。');
  });
  getElement('check').onclick = runSettingsAction(async () => {
    if (
      getElement('owner').value.trim() !== githubSettings.owner ||
      getElement('repo').value.trim() !== githubSettings.repo ||
      getElement('token').value
    ) {
      throw Error('請先儲存設定，再測試連線。');
    }
    showSettingsMessage('連線中…');
    await InkTraceGitHub.check(githubSettings);
    showSettingsMessage('連線成功 · main');
  });
  getElement('clear-settings').onclick = runSettingsAction(async () => {
    setGithub({ configured: false, owner: '', repo: '' });
    getElement('owner').value = getElement('repo').value = getElement('token').value = '';
    showSettingsMessage('已清除。');
  });
  getElement('settings-dialog').addEventListener('close', () => {
    getElement('token').value = '';
  });
  let canvasFitFrame = 0;

  function fitCanvas() {
    cancelAnimationFrame(canvasFitFrame);
    canvasFitFrame = requestAnimationFrame(() => {
      if (!activePaper || isDrawing()) {
        return;
      }
      const side = Math.max(0, Math.floor(Math.min(MAX_BOARD_SIZE, ...boards.flatMap(board => {
        const rect = board.slot.getBoundingClientRect();
        return [rect.width, rect.height];
      }))));
      for (const board of boards) {
        board.paper.style.width = side + 'px';
        board.paper.style.height = side + 'px';
      }
    });
  }
  if ('ResizeObserver' in window) {
    const observer = new ResizeObserver(fitCanvas);
    for (const board of boards) {
      observer.observe(board.slot);
    }
  }
  window.addEventListener('resize', fitCanvas);
  window.addEventListener('blur', finishAllStrokes);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      finishAllStrokes();
    }
  });

  editor.addEventListener('pointerover', recognizePen, true);
  editor.addEventListener('pointerdown', recognizePen, true);
  for (const type of ['selectstart', 'contextmenu', 'dragstart']) {
    editor.addEventListener(type, event => event.preventDefault());
  }
  window.visualViewport?.addEventListener('resize', fitCanvas);
  for (const b of document.querySelectorAll('[data-close]')) {
    b.onclick = () => getElement(b.dataset.close).close();
  }
  const names = { system: '系統', light: '淺色', dark: '深色' }, modes = Object.keys(names);
  try {
    const saved = localStorage.getItem('inktrace-web-theme');
    if (modes.includes(saved)) {
      theme = saved;
    }
  } catch (_) { }

  function applyTheme() {
    document.documentElement.dataset.theme = theme;
    getElement('theme').textContent = '主題：' + names[theme];
  }
  getElement('theme').onclick = () => {
    theme = modes[(modes.indexOf(theme) + 1) % 3];
    applyTheme();
    try {
      localStorage.setItem('inktrace-web-theme', theme);
    } catch (_) { }
  };
  applyTheme();

  async function init() {
    try {
      await PaperStore.init();
      papers = await PaperStore.all();
      try {
        const cached = JSON.parse(localStorage.getItem('inktrace-github') || 'null');
        if (cached && typeof cached.owner === 'string' && typeof cached.repo === 'string') {
          githubSettings.owner = cached.owner;
          githubSettings.repo = cached.repo;
        }
      } catch { }
      setGithub(githubSettings);
      document.fonts.load('100 100px InkTraceGuide').then(drawGuides).catch(() => { });
      document.fonts.load(SHOUJIN_GUIDE_FONT).then(faces => {
        shoujinFontLoaded = faces.length > 0 && faces.every(face => face.status === 'loaded');
        drawGuides();
      }).catch(() => { });
    } catch (error) {
      showMessage(error.message || '初始化失敗，請重新整理。', true);
      getElement('add-paper').disabled = true;
    }
  }
  init();
})();
