import { APP_RELEASE } from './app-release.mjs?v=support-requests2';

const $ = selector => document.querySelector(selector);
const fragment = new URLSearchParams(location.hash.slice(1));
let token = fragment.get('token') || '';
// The credential stays in memory, never in the URL sent to the server or browser storage.
if (location.hash) history.replaceState(null, '', location.pathname);
let accountId = '', reports = [], nextCursor = null, release = APP_RELEASE, loading = false;
const statuses = { new: 'Received', investigating: 'Investigating', needs_details: 'Needs details', fixed: 'Fixed', closed: 'Closed' };

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

async function request(path, data) {
  const response = await fetch(path, {
    method: data === undefined ? 'GET' : 'POST',
    cache: 'no-store',
    credentials: token ? 'omit' : 'same-origin',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(accountId ? { 'X-BearDen-Account': accountId } : {}),
      ...(data === undefined ? {} : { 'Content-Type': 'application/json' })
    },
    ...(data === undefined ? {} : { body: JSON.stringify(data) })
  });
  let result;
  try { result = await response.json(); } catch { throw Error('The server response could not be read. Try again.'); }
  if (!response.ok) throw Error(result.error || 'This reporting connection is unavailable.');
  return result;
}

function section(parent, title, value) {
  if (!value) return;
  const wrapper = el('div', undefined, 'report-section');
  wrapper.append(el('h3', title), el('p', value));
  parent.append(wrapper);
}

function renderReport(report) {
  const article = el('article', undefined, 'report');
  article.dataset.reportId = report.id;
  const feature=report.type==='feature';
  const statusLabelFor=value=>value==='fixed'&&feature?'Implemented':statuses[value]||'Received';
  const heading = el('div', undefined, 'report-header');
  heading.append(el('h2', report.title), el('span', statusLabelFor(report.status), 'badge'));
  article.append(heading, el('p', `${feature?'Feature request':'Bug report'} · ${report.id} · ${new Date(report.createdAt).toLocaleString()} · ${report.area || 'general'} · Revision ${report.revision}`, 'report-meta'));
  section(article, feature?'Requested feature':'What happened', report.details);
  section(article, feature?'Benefit':'Expected', report.expected);
  section(article, feature?'Examples':'Steps to repeat', report.steps);
  section(article, 'Latest response', report.response);
  if (report.fixedInRelease) section(article, 'Released in', report.fixedInRelease);
  const diagnostics = el('details', undefined, 'diagnostics');
  diagnostics.append(el('summary', 'Technical details'), el('p', `App version: ${report.appVersion || 'Not supplied'}\nBrowser: ${report.diagnostics?.browser || 'Not supplied'}\nViewport: ${report.diagnostics?.viewport || 'Not supplied'}`));
  article.append(diagnostics);
  const form = el('form');
  const statusLabel = el('label', 'Progress');
  const select = el('select');
  select.setAttribute('aria-label', `Progress for ${report.id}`);
  for (const [value, label] of Object.entries(statuses)) {
    const option = el('option', statusLabelFor(value)); option.value = value;
    if (value === 'fixed' && !(release.fixedReportIds || []).includes(report.id)) option.disabled = true;
    select.append(option);
  }
  select.value = report.status;
  statusLabel.append(select);
  const responseLabel = el('label', 'Response to the reporter');
  const response = el('textarea'); response.maxLength = 2000; response.value = report.response || '';
  response.setAttribute('aria-label', `Response for ${report.id}`);
  responseLabel.append(response);
  const actions = el('div', undefined, 'report-actions');
  const save = el('button', 'Save progress'); save.type = 'submit';
  const result = el('span', '', 'save-message'); result.setAttribute('role', 'status');
  actions.append(save, result);
  form.append(statusLabel, responseLabel, actions);
  if (!(release.fixedReportIds || []).includes(report.id)) form.append(el('small', (feature?'Implemented':'Fixed')+' becomes available after a live release includes this request. Closed is for requests not being implemented.', 'muted'));
  form.addEventListener('submit', async event => {
    event.preventDefault(); save.disabled = true; result.classList.remove('error'); result.textContent = 'Saving…';
    try {
      const data = await request('/api/support/reports/status', { id: report.id, revision: report.revision, status: select.value, response: response.value });
      report = data.report;
      reports = reports.map(item => item.id === report.id ? report : item);
      render();
      const updated = [...document.querySelectorAll('[data-report-id]')].find(node=>node.dataset.reportId===report.id);
      if(updated)updated.querySelector('.save-message').textContent = 'Saved.';
      $('#supportMessage').textContent = 'Progress saved.';
    } catch (error) { result.classList.add('error'); result.textContent = error.message; }
    finally { save.disabled = false; }
  });
  article.append(form);
  return article;
}

function render() {
  const filter = $('#statusFilter').value,type=$('#typeFilter').value;
  const visible = reports.filter(report => (type==='all'||(report.type||'bug')===type)&&(filter==='all'||(filter==='open'?!['fixed','closed'].includes(report.status):report.status===filter)));
  $('#reportList').replaceChildren(...visible.map(renderReport));
  if (!visible.length) $('#reportList').append(el('p', nextCursor ? 'No matching reports on this page. Load earlier reports to continue.' : 'No matching reports yet.', 'muted'));
  $('#reportCount').textContent = `${visible.length} shown`;
  $('#moreReports').hidden = !nextCursor;
}

async function load(more = false) {
  if (loading) return;
  loading = true; $('#refreshReports').disabled = true; $('#moreReports').disabled = true;
  $('#supportMessage').textContent = 'Loading reports…'; $('#supportMessage').classList.remove('error');
  try {
    const data = await request('/api/support/reports' + (more && nextCursor ? `?cursor=${encodeURIComponent(nextCursor)}` : ''));
    const incoming = Array.isArray(data.reports) ? data.reports : [];
    reports = more ? [...reports, ...incoming.filter(item => !reports.some(old => old.id === item.id))] : incoming;
    nextCursor = data.nextCursor || null; release = data.release || release;
    render(); $('#supportMessage').textContent = ''; $('#reportTools').hidden = false;
    $('#connectionStatus').textContent = token ? 'Connected with reporting-only access.' : 'Connected as the BearDen owner.';
  } catch (error) { $('#supportMessage').textContent = error.message; $('#supportMessage').classList.add('error'); }
  finally { loading = false; $('#refreshReports').disabled = false; $('#moreReports').disabled = false; }
}

$('#statusFilter').addEventListener('change', render);
$('#typeFilter').addEventListener('change', render);
$('#refreshReports').addEventListener('click', () => load());
$('#moreReports').addEventListener('click', () => load(true));
$('#taskSetupForm').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button');
  button.disabled = true;
  try {
    await request('/api/bug-reports/automation', { action: 'connect', taskId: $('#automationTaskId').value.trim() });
    $('#taskSetupStatus').textContent = 'Task connection recorded. Scheduling is managed in ChatGPT.';
  } catch (error) { $('#taskSetupStatus').textContent = error.message; }
  finally { button.disabled = false; }
});

async function start() {
  if (!token) {
    try {
      const config = await request('/api/config');
      if (!config.authenticated || config.accountId !== 'owner') {
        $('#connectionStatus').textContent = 'Open the private dot connection link, or sign in to BearDen with the owner account.';
        return;
      }
      accountId = config.accountId;
      $('#taskSetup').hidden = false;
      const setup = await request('/api/bug-reports/automation');
      if (setup.taskId) $('#automationTaskId').value = setup.taskId;
      if (setup.connected) $('#taskSetupStatus').textContent = 'A ChatGPT task is connected. Scheduling is managed in ChatGPT.';
    } catch (error) { $('#connectionStatus').textContent = error.message; return; }
  }
  await load();
}
start();
