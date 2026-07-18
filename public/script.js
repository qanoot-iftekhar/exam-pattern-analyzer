(() => {
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('fileInput');
  const browseBtn = document.getElementById('browseBtn');
  const fileListEl = document.getElementById('fileList');
  const analyzeBtn = document.getElementById('analyzeBtn');
  const errorBanner = document.getElementById('errorBanner');
  const loadingEl = document.getElementById('loading');
  const emptyStateEl = document.getElementById('emptyState');
  const resultsContentEl = document.getElementById('resultsContent');
  const notesBlockEl = document.getElementById('notesBlock');
  const listNotesEl = document.getElementById('list-notes');
  const exportCsvBtn = document.getElementById('exportCsvBtn');
  const printBtn = document.getElementById('printBtn');
  const printContentEl = document.getElementById('printContent');
  const tabsEl = document.getElementById('tabs');

  let files = []; // { id, file, year }
  let lastResult = null;
  let idCounter = 0;

  // ---------- Upload handling ----------
  browseBtn.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', (e) => {
    addFiles(e.target.files);
    fileInput.value = '';
  });

  ['dragenter', 'dragover'].forEach((evt) => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.add('drag-over');
    });
  });
  ['dragleave', 'drop'].forEach((evt) => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.remove('drag-over');
    });
  });
  dropzone.addEventListener('drop', (e) => {
    if (e.dataTransfer && e.dataTransfer.files) addFiles(e.dataTransfer.files);
  });

  function guessYear(filename) {
    const match = filename.match(/(19|20)\d{2}/);
    return match ? match[0] : '';
  }

  function addFiles(fileListLike) {
    Array.from(fileListLike).forEach((file) => {
      files.push({ id: `f${idCounter++}`, file, year: guessYear(file.name) });
    });
    renderFileList();
  }

  function removeFile(id) {
    files = files.filter((f) => f.id !== id);
    renderFileList();
  }

  function renderFileList() {
    fileListEl.innerHTML = '';
    files.forEach((entry) => {
      const li = document.createElement('li');
      li.className = 'file-row';

      const name = document.createElement('span');
      name.className = 'file-name';
      name.textContent = entry.file.name;
      name.title = entry.file.name;

      const yearInput = document.createElement('input');
      yearInput.type = 'text';
      yearInput.placeholder = 'Year';
      yearInput.value = entry.year;
      yearInput.addEventListener('input', () => { entry.year = yearInput.value; });

      const removeBtn = document.createElement('button');
      removeBtn.className = 'remove-btn';
      removeBtn.type = 'button';
      removeBtn.setAttribute('aria-label', `Remove ${entry.file.name}`);
      removeBtn.textContent = '✕';
      removeBtn.addEventListener('click', () => removeFile(entry.id));

      li.append(name, yearInput, removeBtn);
      fileListEl.appendChild(li);
    });

    analyzeBtn.disabled = files.length === 0;
  }

  // ---------- Tabs ----------
  tabsEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.tab-btn');
    if (!btn) return;
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    const target = btn.dataset.tab;
    document.querySelectorAll('.tab-panel').forEach((p) => {
      p.hidden = p.dataset.panel !== target;
    });
  });

  // ---------- Analyze ----------
  analyzeBtn.addEventListener('click', async () => {
    hideError();
    if (files.length === 0) return;

    setLoading(true);

    const formData = new FormData();
    files.forEach((entry) => formData.append('files', entry.file, entry.file.name));
    formData.append('years', JSON.stringify(files.map((f) => f.year || 'Unknown')));

    try {
      const res = await fetch('/api/analyze', { method: 'POST', body: formData });
      const json = await res.json();

      if (!res.ok || !json.success) {
        showError(json.error || 'Something went wrong while analyzing your papers.');
        setLoading(false);
        return;
      }

      lastResult = json.data;
      renderResults(lastResult);
      setLoading(false);
    } catch (err) {
      showError('Could not reach the server. Is it still running?');
      setLoading(false);
    }
  });

  function setLoading(isLoading) {
    analyzeBtn.disabled = isLoading || files.length === 0;
    loadingEl.hidden = !isLoading;
    if (isLoading) {
      emptyStateEl.hidden = true;
      resultsContentEl.hidden = true;
      notesBlockEl.hidden = true;
    }
  }

  function showError(msg) {
    errorBanner.textContent = msg;
    errorBanner.hidden = false;
  }
  function hideError() {
    errorBanner.hidden = true;
  }

  // ---------- Rendering ----------
  function questionCard(item, tier) {
    const li = document.createElement('li');
    li.className = `q-card tier-${tier}`;
    const years = Array.isArray(item.years) ? item.years.join(', ') : '';
    li.innerHTML = `
      <p class="q-text"></p>
      <div class="q-meta">
        <span class="badge tier-${tier}">${item.probability ?? '?'}% likely</span>
        <span>Appeared ${item.appeared ?? '?'}×</span>
        <span>Years: ${escapeHtml(years)}</span>
      </div>
    `;
    li.querySelector('.q-text').textContent = item.question || '(no question text)';
    return li;
  }

  function predictionCard(item) {
    const li = document.createElement('li');
    li.className = 'q-card tier-medium';
    li.innerHTML = `<p class="q-text"></p><p class="q-reason"></p>`;
    li.querySelector('.q-text').textContent = item.question || '(no question text)';
    li.querySelector('.q-reason').textContent = item.reason || '';
    return li;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function fillList(elId, items, tier) {
    const el = document.getElementById(elId);
    el.innerHTML = '';
    (items || []).forEach((item) => el.appendChild(questionCard(item, tier)));
    if ((items || []).length === 0) {
      const li = document.createElement('li');
      li.className = 'q-card';
      li.innerHTML = '<p class="q-text">No questions in this tier yet.</p>';
      el.appendChild(li);
    }
  }

  function renderResults(data) {
    emptyStateEl.hidden = true;
    resultsContentEl.hidden = false;

    fillList('list-high', data.highProbability, 'high');
    fillList('list-medium', data.mediumProbability, 'medium');
    fillList('list-low', data.lowProbability, 'low');

    const topicsEl = document.getElementById('list-topics');
    topicsEl.innerHTML = '';
    (data.importantTopics || []).forEach((topic) => {
      const li = document.createElement('li');
      li.textContent = topic;
      topicsEl.appendChild(li);
    });
    if ((data.importantTopics || []).length === 0) {
      const li = document.createElement('li');
      li.textContent = 'No dominant topics detected yet.';
      topicsEl.appendChild(li);
    }

    const predEl = document.getElementById('list-prediction');
    predEl.innerHTML = '';
    (data.examPrediction || []).forEach((item) => predEl.appendChild(predictionCard(item)));

    if ((data.notes || []).length) {
      listNotesEl.innerHTML = '';
      data.notes.forEach((note) => {
        const li = document.createElement('li');
        li.textContent = note;
        listNotesEl.appendChild(li);
      });
      notesBlockEl.hidden = false;
    } else {
      notesBlockEl.hidden = true;
    }

    exportCsvBtn.disabled = false;
    printBtn.disabled = false;
    buildPrintContent(data);
  }

  // ---------- Export CSV ----------
  exportCsvBtn.addEventListener('click', () => {
    if (!lastResult) return;
    const rows = [['Tier', 'Question', 'Appeared', 'Years', 'Probability']];
    const addRows = (items, label) => {
      (items || []).forEach((item) => {
        rows.push([
          label,
          (item.question || '').replace(/"/g, "'"),
          item.appeared ?? '',
          (item.years || []).join(' | '),
          item.probability ?? ''
        ]);
      });
    };
    addRows(lastResult.highProbability, 'High');
    addRows(lastResult.mediumProbability, 'Medium');
    addRows(lastResult.lowProbability, 'Low');

    const csv = rows.map((r) => r.map((cell) => `"${cell}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'exam-pattern-analysis.csv';
    a.click();
    URL.revokeObjectURL(url);
  });

  // ---------- Print / Save as PDF ----------
  printBtn.addEventListener('click', () => window.print());

  function buildPrintContent(data) {
    const section = (title, items, renderFn) => {
      if (!items || items.length === 0) return '';
      return `<h2>${title}</h2><ul>${items.map(renderFn).join('')}</ul>`;
    };

    const qLine = (item) =>
      `<li><strong>${escapeHtml(item.question || '')}</strong><br/>
       ${item.probability ?? '?'}% · appeared ${item.appeared ?? '?'}× · years: ${escapeHtml((item.years || []).join(', '))}</li>`;

    const topicLine = (t) => `<li>${escapeHtml(t)}</li>`;
    const predLine = (p) => `<li><strong>${escapeHtml(p.question || '')}</strong><br/>${escapeHtml(p.reason || '')}</li>`;

    printContentEl.innerHTML = [
      '<h1>Exam Pattern Analyzer — Results</h1>',
      section('High Probability', data.highProbability, qLine),
      section('Medium Probability', data.mediumProbability, qLine),
      section('Low Probability', data.lowProbability, qLine),
      section('Important Topics', data.importantTopics, topicLine),
      section('Exam Prediction', data.examPrediction, predLine),
      section('Notes', data.notes, (n) => `<li>${escapeHtml(n)}</li>`)
    ].join('');
  }
})();
