/* ── Constants & State ─────────────────────────────────── */
const CURRENCY_LOCALES = {
  NGN: 'en-NG', USD: 'en-US', GHS: 'en-GH',
  KES: 'en-KE', ZAR: 'en-ZA', EUR: 'en-IE', GBP: 'en-GB'
};

let companyLogoData = '';
let autosaveTimer = null;
const DOCUMENT_TYPES = {
  'QUOTATION': { title: 'Quotation', prefix: 'QUO', numberLabel: 'Quotation No.', terms: 'This quotation is valid for the stated validity period.\nPrices are subject to change after the validity period.\nWork commencement is subject to the agreed payment terms.' },
  'ESTIMATE': { title: 'Estimate', prefix: 'EST', numberLabel: 'Estimate No.', terms: 'This estimate is an approximation based on the information currently available.\nFinal costs may change if the project scope or site conditions change.' },
  'INVOICE': { title: 'Invoice', prefix: 'INV', numberLabel: 'Invoice No.', terms: 'Please remit payment by the due date shown.\nContact us if you have questions about this invoice.' },
  'PROFORMA INVOICE': { title: 'Proforma Invoice', prefix: 'PRO', numberLabel: 'Proforma Invoice No.', terms: 'This proforma invoice is preliminary and is not a demand for final payment.\nFinal amounts may change before delivery.' },
  'RECEIPT': { title: 'Receipt', prefix: 'REC', numberLabel: 'Receipt No.', terms: 'Payment received with thanks.' },
  'PURCHASE ORDER': { title: 'Purchase Order', prefix: 'PO', numberLabel: 'Purchase Order No.', terms: 'Please confirm acceptance and expected delivery.\nContact the buyer before making substitutions.' },
  'CREDIT NOTE': { title: 'Credit Note', prefix: 'CRN', numberLabel: 'Credit Note No.', terms: 'This credit note should be applied to the referenced invoice.' },
  'DELIVERY NOTE': { title: 'Delivery Note', prefix: 'DN', numberLabel: 'Delivery Note No.', terms: 'Please inspect the items and confirm receipt below.' }
};
const SPECIFIC_FIELDS = {
  'QUOTATION': [{ id:'validUntil', label:'Valid Until', type:'date' }, { id:'acceptanceTerms', label:'Acceptance Terms', type:'textarea', placeholder:'e.g. Sign and return to accept this quotation' }],
  'ESTIMATE': [{ id:'completionPeriod', label:'Estimated Completion Period', placeholder:'e.g. 3–4 weeks' }],
  'INVOICE': [{ id:'dueDate', label:'Payment Due Date', type:'date' }, { id:'amountReceived', label:'Amount Received', type:'number' }, { id:'paymentMethod', label:'Payment Method', placeholder:'e.g. Bank transfer' }, { id:'transactionReference', label:'Transaction Reference' }],
  'RECEIPT': [{ id:'paymentDate', label:'Payment Date', type:'date' }, { id:'amountPaid', label:'Amount Paid', type:'number' }, { id:'paymentMethod', label:'Payment Method', placeholder:'e.g. Bank transfer' }, { id:'transactionReference', label:'Transaction Reference' }],
  'PURCHASE ORDER': [{ id:'supplierName', label:'Supplier Name' }, { id:'supplierAddress', label:'Supplier Address', type:'textarea' }, { id:'deliveryAddress', label:'Delivery Address', type:'textarea' }, { id:'expectedDeliveryDate', label:'Expected Delivery Date', type:'date' }],
  'CREDIT NOTE': [{ id:'originalInvoice', label:'Original Invoice Reference' }, { id:'creditAmount', label:'Credit Amount', type:'number' }, { id:'creditReason', label:'Reason for Credit', type:'textarea' }],
  'DELIVERY NOTE': [{ id:'deliveryDate', label:'Delivery Date', type:'date' }, { id:'recipientConfirmation', label:'Recipient Confirmation', placeholder:'Name / signature' }]
};
let currentDocumentType = 'QUOTATION';
let specificData = {};
let documentNumbers = {};
let activeDocumentId = null;
let activeStatus = 'Draft';
let loadingDocument = false;
let activeSourceId = null;
let activeSourceNumber = null;
let actionRenderId = 0;

/* ── Init ──────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', async () => {
  const today = new Date();
  document.getElementById('documentDate').value = toLocalDateInput(today);
  try {
    await BusinessDB.open();
    await BusinessDB.migrateLegacy();
    await loadDocument();
  } catch (error) {
    showToast(`Local database error: ${error.message}`);
  }
});

function toLocalDateInput(date) {
  const pad = value => String(value).padStart(2,'0');
  return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`;
}

function onDocumentTypeChange() {
  const previousType = currentDocumentType;
  Object.assign(specificData, getSpecificValues(previousType));
  documentNumbers[previousType] = document.getElementById('documentNumber').value;
  const type = document.getElementById('documentType').value;
  currentDocumentType = type;
  document.title = `IMC Technology | ${DOCUMENT_TYPES[type]?.title || 'Document'} Builder`;
  if (activeDocumentId) { activeSourceId = activeDocumentId; activeSourceNumber = document.getElementById('documentNumber').value; }
  activeDocumentId = null;
  activeStatus = type === 'INVOICE' ? 'Unpaid' : 'Draft';
  document.getElementById('documentNumber').value = 'Assigning number…';
  renderStatusOptions(type, activeStatus);
  renderDocumentSpecificFields(type, specificData);
  refreshDocumentActions();
  const terms = document.getElementById('terms');
  if (!terms.value.trim() || terms.value === DOCUMENT_TYPES[previousType]?.terms) terms.value = DOCUMENT_TYPES[type]?.terms || '';
  updatePreview();
  saveDocument(true);
}

function renderStatusOptions(type, selected = 'Draft') {
  const select = document.getElementById('documentStatus');
  const values = type === 'QUOTATION' ? ['Draft','Sent','Accepted','Rejected','Expired'] : type === 'INVOICE' ? ['Unpaid','Partially Paid','Paid','Overdue'] : ['Draft','Final'];
  select.replaceChildren(...values.map(value => { const option = document.createElement('option'); option.value=value; option.textContent=value; return option; }));
  if (!values.includes(selected)) selected = values[0];
  select.value = selected;
  activeStatus = selected;
}

function onDocumentStatusChange() {
  activeStatus = document.getElementById('documentStatus').value;
  refreshDocumentActions();
  updatePreview();
}

function renderDocumentSpecificFields(type, values = {}) {
  const host = document.getElementById('documentSpecificFields');
  host.replaceChildren();
  (SPECIFIC_FIELDS[type] || []).forEach(field => {
    const wrapper = document.createElement('div');
    wrapper.className = 'field';
    const label = document.createElement('label');
    label.htmlFor = field.id;
    label.textContent = field.label;
    let input;
    if (field.type === 'select') {
      input = document.createElement('select');
      field.options.forEach(option => { const item = document.createElement('option'); item.value = option; item.textContent = option; input.appendChild(item); });
    } else {
      input = document.createElement(field.type === 'textarea' ? 'textarea' : 'input');
      if (field.type && field.type !== 'textarea') input.type = field.type;
      if (field.placeholder) input.placeholder = field.placeholder;
    }
    input.id = field.id;
    input.value = values[field.id] ?? (field.id === 'paymentStatus' ? 'Unpaid' : (field.id === 'validUntil' ? document.getElementById('validUntil')?.value || '' : ''));
    input.addEventListener('input', updatePreview);
    input.addEventListener('change', updatePreview);
    wrapper.append(label, input);
    host.appendChild(wrapper);
  });
}

function getSpecificValues(type = document.getElementById('documentType').value) {
  const values = {};
  (SPECIFIC_FIELDS[type] || []).forEach(field => {
    values[field.id] = document.getElementById(field.id)?.value || '';
  });
  return values;
}

/* ── Formatting ────────────────────────────────────────── */
function formatCurrency(value) {
  const cur = document.getElementById('currency')?.value || 'NGN';
  const locale = CURRENCY_LOCALES[cur] || 'en-US';
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency', currency: cur,
      minimumFractionDigits: 2, maximumFractionDigits: 2
    }).format(value || 0);
  } catch (e) {
    return (value || 0).toFixed(2) + ' ' + cur;
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatDate(dateString) {
  if (!dateString) return '—';
  return new Date(dateString + 'T00:00:00').toLocaleDateString('en-NG', {
    day: '2-digit', month: 'short', year: 'numeric'
  });
}

/* ── Toast ─────────────────────────────────────────────── */
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 2200);
}

/* ── Items CRUD ────────────────────────────────────────── */
function addItem(description = '', quantity = 1, unit = 'pcs', price = 0) {
  const tbody = document.getElementById('itemsBody');
  const row = document.createElement('tr');
  row.innerHTML = `
    <td><input class="description" value="${escapeHtml(description)}" placeholder="e.g. 650W Solar Panel" oninput="updateItem(this)"></td>
    <td><input class="quantity" type="number" value="${quantity}" min="0" step="any" oninput="updateItem(this)"></td>
    <td><input class="unit" value="${escapeHtml(unit)}" placeholder="pcs" oninput="updatePreview()"></td>
    <td><input class="price" type="number" value="${price}" min="0" step="0.01" oninput="updateItem(this)"></td>
    <td class="item-total">₦0.00</td>
    <td class="row-actions">
      <button class="icon-btn" onclick="moveItem(this,'up')" title="Move up" aria-label="Move up">↑</button>
      <button class="icon-btn" onclick="moveItem(this,'down')" title="Move down" aria-label="Move down">↓</button>
      <button class="icon-btn" onclick="duplicateItem(this)" title="Duplicate" aria-label="Duplicate">⧉</button>
      <button class="remove-item" onclick="removeItem(this)" title="Remove item" aria-label="Remove item">×</button>
    </td>`;
  tbody.appendChild(row);
  updateItem(row.querySelector('.price'));
}

function duplicateItem(btn) {
  const row = btn.closest('tr');
  addItem(
    row.querySelector('.description').value,
    row.querySelector('.quantity').value,
    row.querySelector('.unit').value,
    row.querySelector('.price').value
  );
  calculateTotals();
  updatePreview();
}

function moveItem(btn, direction) {
  const row = btn.closest('tr');
  if (direction === 'up' && row.previousElementSibling) {
    row.parentNode.insertBefore(row, row.previousElementSibling);
  } else if (direction === 'down' && row.nextElementSibling) {
    row.parentNode.insertBefore(row.nextElementSibling, row);
  }
  updatePreview();
}

function removeItem(button) {
  button.closest('tr').remove();
  calculateTotals();
  updatePreview();
}

/* ── Calculations ──────────────────────────────────────── */
function updateItem(input) {
  const row = input.closest('tr');
  const quantity = parseFloat(row.querySelector('.quantity').value) || 0;
  const price = parseFloat(row.querySelector('.price').value) || 0;
  row.querySelector('.item-total').textContent = formatCurrency(quantity * price);
  calculateTotals();
  updatePreview();
}

function refreshAllItemTotals() {
  document.querySelectorAll('#itemsBody tr').forEach(row => {
    const quantity = parseFloat(row.querySelector('.quantity').value) || 0;
    const price = parseFloat(row.querySelector('.price').value) || 0;
    row.querySelector('.item-total').textContent = formatCurrency(quantity * price);
  });
}

function calculateTotals() {
  let subtotal = 0;
  document.querySelectorAll('#itemsBody tr').forEach(row => {
    const quantity = parseFloat(row.querySelector('.quantity').value) || 0;
    const price = parseFloat(row.querySelector('.price').value) || 0;
    subtotal += quantity * price;
  });
  const discount = Math.max(0, parseFloat(document.getElementById('discount').value) || 0);
  const tax = Math.max(0, parseFloat(document.getElementById('tax').value) || 0);
  const total = Math.max(0, subtotal - discount + tax);

  document.getElementById('subtotalDisplay').textContent = formatCurrency(subtotal);
  document.getElementById('grandTotalDisplay').textContent = formatCurrency(total);
  document.getElementById('previewSubtotal').textContent = formatCurrency(subtotal);
  document.getElementById('previewDiscount').textContent = formatCurrency(discount);
  document.getElementById('previewTax').textContent = formatCurrency(tax);
  document.getElementById('previewGrandTotal').textContent = formatCurrency(total);
}

function onCurrencyChange() {
  refreshAllItemTotals();
  calculateTotals();
  scheduleAutosave();
}

/* ── Logo ──────────────────────────────────────────────── */
function handleLogoUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) {
    showToast('Logo too large (max 2 MB).');
    event.target.value = '';
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    companyLogoData = reader.result;
    applyLogoPreview();
    scheduleAutosave();
  };
  reader.readAsDataURL(file);
}

function removeLogo() {
  companyLogoData = '';
  document.getElementById('companyLogo').value = '';
  applyLogoPreview();
  scheduleAutosave();
}

function applyLogoPreview() {
  const editorImg = document.getElementById('logoPreview');
  const previewImg = document.getElementById('previewCompanyLogo');
  if (companyLogoData) {
    editorImg.src = companyLogoData;
    editorImg.style.display = 'inline-block';
    previewImg.src = companyLogoData;
    previewImg.style.display = 'block';
  } else {
    editorImg.style.display = 'none';
    previewImg.style.display = 'none';
  }
}

/* ── Preview ───────────────────────────────────────────── */
function updatePreview() {
  const get = id => document.getElementById(id).value;

  document.getElementById('previewCompanyName').textContent = get('companyName');
  document.getElementById('previewCompanyEmail').textContent = get('companyEmail');
  document.getElementById('previewCompanyPhone').textContent = get('companyPhone');
  document.getElementById('previewCompanyWebsite').textContent = get('companyWebsite');
  document.getElementById('previewCompanyAddress').textContent = get('companyAddress');

  const type = get('documentType');
  const config = DOCUMENT_TYPES[type] || DOCUMENT_TYPES.QUOTATION;
  document.getElementById('previewDocumentType').textContent = config.title.toUpperCase();
  document.getElementById('previewNumberLabel').textContent = config.numberLabel;
  document.getElementById('previewDocumentNumber').textContent = get('documentNumber');
  document.getElementById('previewDocumentStatus').textContent = activeStatus || get('documentStatus');
  document.getElementById('previewDocumentDate').textContent = formatDate(get('documentDate'));
  const metaRows = document.getElementById('previewMetaRows');
  metaRows.replaceChildren();
  const labels = { validUntil:'Valid Until', dueDate:'Payment Due', completionPeriod:'Estimated Completion', paymentDate:'Payment Date', amountPaid:'Amount Paid', amountReceived:'Amount Received', paymentMethod:'Payment Method', transactionReference:'Transaction Reference', expectedDeliveryDate:'Expected Delivery', originalInvoice:'Original Invoice', creditAmount:'Credit Amount', deliveryDate:'Delivery Date' };
  const values = { ...specificData, ...getSpecificValues() };
  if (activeSourceNumber) {
    const sourceRow = document.createElement('div');
    sourceRow.innerHTML = `<strong>Reference:</strong> ${escapeHtml(activeSourceNumber)}`;
    metaRows.appendChild(sourceRow);
  }
  (SPECIFIC_FIELDS[type] || []).forEach(field => {
    const value = values[field.id];
    if (!value) return;
    const row = document.createElement('div');
    const label = labels[field.id] || field.label;
    const display = field.type === 'date' ? formatDate(value) : (field.id === 'amountPaid' ? formatCurrency(Number(value)) : value);
    row.innerHTML = `<strong>${escapeHtml(label)}:</strong> ${escapeHtml(display)}`;
    metaRows.appendChild(row);
  });

  document.getElementById('previewProjectName').textContent = get('projectName') || '—';
  document.getElementById('previewScopeOfWork').textContent = get('scopeOfWork') || '—';

  document.getElementById('previewClientName').textContent = get('clientName') || '—';
  document.getElementById('previewClientAddress').textContent = get('clientAddress');
  document.getElementById('previewClientPhone').textContent = get('clientPhone');
  document.getElementById('previewClientEmail').textContent = get('clientEmail');

  document.getElementById('previewPaymentDetails').textContent = get('paymentDetails') || '—';
  document.getElementById('previewTerms').textContent = get('terms') || '—';
  const infoTitles = document.querySelectorAll('.document-info .info-title');
  infoTitles[0].textContent = type === 'PURCHASE ORDER' ? 'Supplier' : 'Bill To';
  infoTitles[1].textContent = type === 'PURCHASE ORDER' ? 'Delivery Address' : 'Service / Project';
  if (type === 'PURCHASE ORDER' && values.supplierName) document.getElementById('previewClientName').textContent = values.supplierName;
  if (type === 'PURCHASE ORDER' && values.supplierAddress) document.getElementById('previewClientAddress').textContent = values.supplierAddress;
  if (type === 'PURCHASE ORDER' && values.deliveryAddress) document.getElementById('previewProjectName').textContent = values.deliveryAddress;
  const supplemental = document.getElementById('previewSpecificInfo');
  supplemental.replaceChildren();
  const supplementalFields = { acceptanceTerms:'Acceptance Terms', creditReason:'Reason for Credit', recipientConfirmation:'Recipient Confirmation' };
  Object.entries(supplementalFields).forEach(([id, label]) => {
    if (!values[id]) return;
    const block = document.createElement('div');
    block.innerHTML = `<div class="info-title">${escapeHtml(label)}</div><div class="info-value">${escapeHtml(values[id])}</div>`;
    supplemental.appendChild(block);
  });
  supplemental.hidden = supplemental.childElementCount === 0;

  const previewBody = document.getElementById('previewItemsBody');
  previewBody.innerHTML = '';
  document.querySelectorAll('#itemsBody tr').forEach((row, index) => {
    const description = row.querySelector('.description').value;
    const quantity = parseFloat(row.querySelector('.quantity').value) || 0;
    const unit = row.querySelector('.unit').value;
    const price = parseFloat(row.querySelector('.price').value) || 0;
    const amount = quantity * price;
    const previewRow = document.createElement('tr');
    previewRow.innerHTML = `<td>${index + 1}</td><td>${escapeHtml(description)}</td><td>${quantity}</td><td>${escapeHtml(unit)}</td><td>${formatCurrency(amount)}</td>`;
    previewBody.appendChild(previewRow);
  });

  calculateTotals();
  if (!loadingDocument) scheduleAutosave();
}

/* ── Autosave & Persistence ────────────────────────────── */
function scheduleAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => saveDocument(true), 900);
}

function collectDocumentData() {
  const data = {
    id: activeDocumentId,
    status: document.getElementById('documentStatus').value || activeStatus,
    sourceId: activeSourceId,
    sourceNumber: activeSourceNumber,
    company: {
      name: document.getElementById('companyName').value,
      email: document.getElementById('companyEmail').value,
      phone: document.getElementById('companyPhone').value,
      website: document.getElementById('companyWebsite').value,
      address: document.getElementById('companyAddress').value,
      logo: companyLogoData
    },
    document: {
      type: document.getElementById('documentType').value,
      number: document.getElementById('documentNumber').value,
      date: document.getElementById('documentDate').value,
      validUntil: getSpecificValues().validUntil || '',
      currency: document.getElementById('currency').value,
      specific: { ...specificData, ...getSpecificValues() }
    },
    project: {
      name: document.getElementById('projectName').value,
      scope: document.getElementById('scopeOfWork').value
    },
    client: {
      name: document.getElementById('clientName').value,
      email: document.getElementById('clientEmail').value,
      phone: document.getElementById('clientPhone').value,
      address: document.getElementById('clientAddress').value
    },
    items: [],
    discount: document.getElementById('discount').value,
    tax: document.getElementById('tax').value,
    paymentDetails: document.getElementById('paymentDetails').value,
    terms: document.getElementById('terms').value
  };
  document.querySelectorAll('#itemsBody tr').forEach(row => {
    data.items.push({
      description: row.querySelector('.description').value,
      quantity: row.querySelector('.quantity').value,
      unit: row.querySelector('.unit').value,
      price: row.querySelector('.price').value
    });
  });
  return data;
}

function saveDocument(silent) {
  if (loadingDocument) return Promise.resolve();
  clearTimeout(autosaveTimer);
  autosaveTimer = null;
  return (async () => {
    try {
      const payload = collectDocumentData();
      const saved = activeDocumentId ? await BusinessDB.updateDocument(payload) : await BusinessDB.createDocument(payload);
      activeDocumentId = saved.id;
      currentDocumentType = saved.type;
      activeStatus = saved.status;
      document.getElementById('documentNumber').value = saved.number;
      document.getElementById('previewDocumentNumber').textContent = saved.number;
      document.getElementById('previewDocumentType').textContent = (DOCUMENT_TYPES[saved.type]?.title || saved.type).toUpperCase();
      documentNumbers[saved.type] = saved.number;
      renderStatusOptions(saved.type, saved.status);
      await refreshDocumentList();
      await renderDocumentHistory(saved.id);
      refreshDocumentActions();
      if (!silent) showToast('Document saved.');
      return saved;
    } catch (e) {
      console.error(e);
      showToast(`Could not save document: ${e.message}`);
      return null;
    }
  })();
}

async function loadDocumentData(data) {
  clearTimeout(autosaveTimer);
  autosaveTimer = null;
  loadingDocument = true;
  activeDocumentId = data.id || null;
  activeSourceId = data.sourceId || null;
  activeSourceNumber = data.sourceNumber || null;
  document.getElementById('itemsBody').replaceChildren();

  document.getElementById('companyName').value = data.company?.name || '';
  document.getElementById('companyEmail').value = data.company?.email || '';
  document.getElementById('companyPhone').value = data.company?.phone || '';
  document.getElementById('companyWebsite').value = data.company?.website || '';
  document.getElementById('companyAddress').value = data.company?.address || '';
  companyLogoData = data.company?.logo || '';
  applyLogoPreview();

  document.getElementById('documentType').value = data.document?.type || 'QUOTATION';
  document.getElementById('documentNumber').value = data.document?.number || '';
  document.getElementById('documentDate').value = data.document?.date || document.getElementById('documentDate').value;
  document.getElementById('currency').value = data.document?.currency || 'NGN';

  document.getElementById('projectName').value = data.project?.name || '';
  document.getElementById('scopeOfWork').value = data.project?.scope || '';

  document.getElementById('clientName').value = data.client?.name || '';
  document.getElementById('clientEmail').value = data.client?.email || '';
  document.getElementById('clientPhone').value = data.client?.phone || '';
  document.getElementById('clientAddress').value = data.client?.address || '';

  document.getElementById('discount').value = data.discount || 0;
  document.getElementById('tax').value = data.tax || 0;
  document.getElementById('paymentDetails').value = data.paymentDetails || '';
  document.getElementById('terms').value = data.terms || '';

  currentDocumentType = document.getElementById('documentType').value;
  activeStatus = data.status || (currentDocumentType === 'INVOICE' ? 'Unpaid' : 'Draft');
  renderStatusOptions(currentDocumentType, activeStatus);
  specificData = { ...(data.document?.specific || {}) };
  if (!specificData.validUntil && data.document?.validUntil) specificData.validUntil = data.document.validUntil;
  documentNumbers = { [currentDocumentType]: data.document?.number || data.number || '' };
  document.title = `IMC Technology | ${DOCUMENT_TYPES[currentDocumentType]?.title || 'Document'} Builder`;
  renderDocumentSpecificFields(currentDocumentType, specificData);
  if (!data.terms) document.getElementById('terms').value = DOCUMENT_TYPES[currentDocumentType]?.terms || '';
  (data.items || []).forEach(item => addItem(item.description, item.quantity, item.unit, item.price));
  if (!data.items || data.items.length === 0) { addItem(); addItem(); }

  updatePreview();
  loadingDocument = false;
  document.getElementById('documentNumber').value = data.number || data.document?.number || '';
  await refreshDocumentList();
  await renderDocumentHistory(data.id);
  refreshDocumentActions();
}

async function loadDocument() {
  const docs = await BusinessDB.listDocuments();
  if (docs.length) return loadDocumentData(docs[0]);
  currentDocumentType = 'QUOTATION';
  renderStatusOptions(currentDocumentType, 'Draft');
  const firstExpiry = new Date(); firstExpiry.setDate(firstExpiry.getDate()+30);
  specificData = { validUntil:firstExpiry.toISOString().slice(0,10) };
  renderDocumentSpecificFields(currentDocumentType, specificData);
  document.getElementById('terms').value = DOCUMENT_TYPES.QUOTATION.terms;
  addItem(); addItem();
  await saveDocument(true);
  updatePreview();
}

async function refreshDocumentList() {
  const select = document.getElementById('savedDocuments');
  if (!select) return;
  const docs = await BusinessDB.listDocuments();
  select.replaceChildren();
  docs.forEach(doc => {
    const option = document.createElement('option');
    option.value = doc.id;
    option.textContent = `${doc.number} · ${DOCUMENT_TYPES[doc.type]?.title || doc.type} · ${doc.status || 'Draft'}${doc.client?.name ? ` · ${doc.client.name}` : ''}`;
    select.appendChild(option);
  });
  if (activeDocumentId) select.value = activeDocumentId;
}

async function openSelectedDocument() {
  const id = document.getElementById('savedDocuments').value;
  if (!id || id === activeDocumentId) return;
  try {
    clearTimeout(autosaveTimer);
    autosaveTimer = null;
    await saveDocument(true);
    const data = await BusinessDB.getDocument(id);
    if (!data) throw new Error('That document could not be found.');
    await loadDocumentData(data);
  } catch (error) { showToast(`Could not open document: ${error.message}`); }
}

async function deleteCurrentDocument() {
  if (!activeDocumentId) { showToast('Save this document before deleting it.'); return; }
  if (!confirm('Delete this document? Its number will not be reused.')) return;
  try {
    await BusinessDB.removeDocument(activeDocumentId);
    activeDocumentId = null;
    showToast('Document deleted.');
    newDocument(true);
    await refreshDocumentList();
  } catch (error) { showToast(`Could not delete document: ${error.message}`); }
}

async function renderDocumentHistory(id) {
  const host = document.getElementById('documentHistory');
  if (!host || !id) return;
  const docs = await BusinessDB.listDocuments();
  const active = docs.find(doc => doc.id === id);
  if (!active) { host.textContent = ''; return; }
  const related = docs.filter(doc => doc.id === active.sourceId || doc.sourceId === id);
  host.replaceChildren();
  if (active.sourceNumber) {
    const source = docs.find(doc => doc.id === active.sourceId);
    const line = document.createElement('div'); line.textContent = `Converted from ${active.sourceNumber}`;
    if (source) { line.append(' · '); const link=document.createElement('a'); link.textContent='Open source'; link.onclick=()=>openRelatedDocument(source.id); line.appendChild(link); }
    host.appendChild(line);
  }
  if (related.length) {
    const line = document.createElement('div'); line.append('Related documents: ');
    related.forEach((doc,index) => { if(index) line.append(', '); const link=document.createElement('a'); link.textContent=doc.number; link.onclick=()=>openRelatedDocument(doc.id); line.appendChild(link); });
    host.appendChild(line);
  }
}

async function openRelatedDocument(id) {
  try { const data=await BusinessDB.getDocument(id); if(data) await loadDocumentData(data); }
  catch(error) { showToast(`Could not open related document: ${error.message}`); }
}

async function refreshDocumentActions() {
  const host = document.getElementById('conversionActions');
  if (!host) return;
  const renderId = ++actionRenderId;
  host.replaceChildren();
  const actions = [];
  if (currentDocumentType === 'QUOTATION' && activeStatus === 'Accepted') actions.push(['Convert to Invoice', 'invoice']);
  if (currentDocumentType === 'ESTIMATE') actions.push(['Convert to Quotation', 'quotation']);
  if (currentDocumentType === 'INVOICE' && ['Paid','Partially Paid'].includes(activeStatus)) actions.push(['Create Receipt', 'receipt']);
  if (currentDocumentType === 'INVOICE' && activeDocumentId) {
    try {
      const [invoice, docs] = await Promise.all([BusinessDB.getDocument(activeDocumentId), BusinessDB.listDocuments()]);
      if (renderId !== actionRenderId) return;
      const credited = docs.filter(doc=>doc.type==='CREDIT NOTE'&&doc.sourceId===activeDocumentId).reduce((sum,doc)=>sum+(Number(doc.document?.specific?.creditAmount)||calculateDocumentTotal(doc)),0);
      if (invoice && calculateDocumentTotal(invoice) > credited) actions.push(['Create Credit Note', 'credit']);
    } catch (error) { console.error(error); }
  }
  actions.forEach(([label, action]) => { const button=document.createElement('button'); button.type='button'; button.className='btn btn-secondary'; button.textContent=label; button.onclick=()=>convertDocument(action); host.appendChild(button); });
}

function calculateDocumentTotal(data) {
  const subtotal = (data.items || []).reduce((sum,item)=>sum+(Number(item.quantity)||0)*(Number(item.price)||0),0);
  return Math.max(0, subtotal-(Number(data.discount)||0)+(Number(data.tax)||0));
}

async function convertDocument(kind) {
  try {
    let source = await saveDocument(true);
    if (!source) return;
    const destination = { invoice:'INVOICE', quotation:'QUOTATION', receipt:'RECEIPT', credit:'CREDIT NOTE' }[kind];
    if (kind === 'invoice' && !(source.type === 'QUOTATION' && source.status === 'Accepted')) throw new Error('Only accepted quotations can be invoiced.');
    if (kind === 'quotation' && source.type !== 'ESTIMATE') throw new Error('Only estimates can be converted to quotations.');
    if (kind === 'receipt' && !(source.type === 'INVOICE' && ['Paid','Partially Paid'].includes(source.status))) throw new Error('A receipt requires a paid or partially paid invoice.');
    if (kind === 'credit' && source.type !== 'INVOICE') throw new Error('Credit notes can only be created from invoices.');
    const docs = await BusinessDB.listDocuments();
    if (kind !== 'receipt' && kind !== 'credit' && docs.some(doc => doc.sourceId === source.id && doc.type === destination)) {
      throw new Error(`This ${DOCUMENT_TYPES[destination].title.toLowerCase()} has already been created from this document.`);
    }
    if (!confirm(`Create a new ${DOCUMENT_TYPES[destination].title} from ${source.number}? The original will remain unchanged.`)) return;

    const converted = structuredClone(source);
    delete converted.id; delete converted.number; delete converted.createdAt; delete converted.updatedAt; delete converted.items;
    converted.document = { ...converted.document, type:destination, number:'', specific:{ ...(converted.document?.specific || {}) } };
    converted.type = destination; converted.sourceId = source.id; converted.sourceNumber = source.number;
    converted.status = destination === 'INVOICE' ? 'Unpaid' : 'Draft';
    let sourceUpdate = null;
    if (kind === 'receipt') {
      const paidSoFar = Number(source.document?.specific?.amountReceived) || 0;
      const remaining = Math.max(0, calculateDocumentTotal(source) - paidSoFar);
      const amount = Number(prompt(`Amount received (remaining balance ${formatCurrency(remaining)}):`, remaining.toFixed(2)));
      if (!(amount > 0) || amount > remaining) throw new Error('Enter a payment amount greater than zero and no more than the remaining balance.');
      const transactionReference = (prompt('Transaction reference (optional):') || '').trim();
      const paymentDate = toLocalDateInput(new Date());
      converted.document.specific = { paymentDate, amountPaid:String(amount), paymentMethod:'', transactionReference, originalInvoice:source.number };
      converted.items = [{description:`Payment received for ${source.number}`,quantity:'1',unit:'payment',price:String(amount)}];
      converted.discount = '0'; converted.tax = '0'; converted.terms = `Receipt for payment received against invoice ${source.number}.`;
      const updatedSource = structuredClone(source);
      updatedSource.document.specific = { ...(updatedSource.document.specific || {}), amountReceived:String(paidSoFar+amount) };
      updatedSource.status = paidSoFar + amount >= calculateDocumentTotal(source) ? 'Paid' : 'Partially Paid';
      sourceUpdate = updatedSource;
    } else if (kind === 'credit') {
      const alreadyCredited = docs.filter(doc=>doc.type==='CREDIT NOTE'&&doc.sourceId===source.id).reduce((sum,doc)=>sum+(Number(doc.document?.specific?.creditAmount)||calculateDocumentTotal(doc)),0);
      const eligible = Math.max(0, calculateDocumentTotal(source)-alreadyCredited);
      if (eligible <= 0) throw new Error('The invoice balance has already been fully credited.');
      const amount = Number(prompt(`Credit amount (maximum ${formatCurrency(eligible)}):`, eligible.toFixed(2)));
      if (!(amount > 0) || amount > eligible) throw new Error('Credit amount must be greater than zero and within the eligible invoice balance.');
      const reason = prompt('Reason for credit:') || '';
      const taxCredit = calculateDocumentTotal(source) ? amount * (Number(source.tax)||0) / calculateDocumentTotal(source) : 0;
      converted.document.specific = { originalInvoice:source.number, creditAmount:String(amount), creditReason:reason };
      converted.items = [{description:`Credit against ${source.number}${reason ? `: ${reason}` : ''}`,quantity:'1',unit:'credit',price:String(Math.max(0,amount-taxCredit))}];
      converted.discount='0'; converted.tax=String(taxCredit); converted.terms=`Credit applied to original invoice ${source.number}; includes a proportional tax adjustment.`;
    } else {
      converted.items = source.items.map(({description,quantity,unit,price})=>({description,quantity,unit,price}));
      if (destination === 'INVOICE') converted.document.specific = { dueDate:'', amountReceived:'0', paymentMethod:'', transactionReference:'', originalQuotation:source.number };
      else converted.document.specific = { ...converted.document.specific, sourceEstimate:source.number };
    }
    const createOptions = { sourceUpdate };
    if (kind === 'invoice' || kind === 'quotation') createOptions.uniqueSourceType = { sourceId:source.id, type:destination };
    if (kind === 'receipt' && converted.document.specific.transactionReference) createOptions.uniquePayment = { sourceId:source.id, reference:converted.document.specific.transactionReference };
    if (kind === 'credit') createOptions.creditValidation = { sourceId:source.id, amount:Number(converted.document.specific.creditAmount) };
    const created = await BusinessDB.createDocument(converted, createOptions);
    showToast(`${DOCUMENT_TYPES[destination].title} ${created.number} created.`);
    await loadDocumentData(created);
    await refreshDocumentList();
  } catch (error) { showToast(error.message || 'Could not convert document.'); }
}

async function exportBackup() {
  try {
    const data = await BusinessDB.allData();
    const blob = new Blob([JSON.stringify(data,null,2)], {type:'application/json'});
    const url = URL.createObjectURL(blob); const link=document.createElement('a');
    link.href=url; link.download=`business-documents-${new Date().toISOString().slice(0,10)}.json`; link.click(); URL.revokeObjectURL(url);
    showToast('Backup exported.');
  } catch(error) { showToast(`Backup export failed: ${error.message}`); }
}

async function importBackup(event) {
  const file=event.target.files?.[0]; if(!file)return;
  try {
    const data=JSON.parse(await file.text());
    if(!confirm('Restore this backup? Matching record IDs will be replaced.')) return;
    await BusinessDB.importData(data);
    await refreshDocumentList();
    showToast('Backup restored.');
  } catch(error) { showToast(`Backup restore failed: ${error.message}`); }
  finally { event.target.value=''; }
}

/* ── New Document ──────────────────────────────────────── */
function newDocument(skipConfirmation = false) {
  if (!skipConfirmation && !confirm('Start a new document? Unsaved changes to the current one will be lost.')) return;
  clearTimeout(autosaveTimer);
  autosaveTimer = null;

  document.getElementById('companyName').value = 'IMC Technology';
  document.getElementById('companyEmail').value = '';
  document.getElementById('companyPhone').value = '';
  document.getElementById('companyWebsite').value = '';
  document.getElementById('companyAddress').value = '';
  removeLogo();

  document.getElementById('documentType').value = 'QUOTATION';
  currentDocumentType = 'QUOTATION';
  activeDocumentId = null;
  activeSourceId = null;
  activeSourceNumber = null;
  activeStatus = 'Draft';
  document.getElementById('documentHistory').replaceChildren();
  document.getElementById('savedDocuments').selectedIndex = -1;
  document.title = 'IMC Technology | Quotation Builder';
  documentNumbers = {};
  specificData = {};
  document.getElementById('documentNumber').value = 'Assigning number…';
  const t = new Date();
  document.getElementById('documentDate').value = toLocalDateInput(t);
  const v = new Date(); v.setDate(v.getDate() + 30);
  specificData.validUntil = toLocalDateInput(v);
  renderDocumentSpecificFields('QUOTATION', specificData);
  renderStatusOptions('QUOTATION','Draft');
  document.getElementById('currency').value = 'NGN';

  document.getElementById('projectName').value = '';
  document.getElementById('scopeOfWork').value = '';

  document.getElementById('clientName').value = '';
  document.getElementById('clientEmail').value = '';
  document.getElementById('clientPhone').value = '';
  document.getElementById('clientAddress').value = '';

  document.getElementById('discount').value = 0;
  document.getElementById('tax').value = 0;
  document.getElementById('paymentDetails').value = '';
  document.getElementById('terms').value = DOCUMENT_TYPES.QUOTATION.terms;

  document.getElementById('itemsBody').innerHTML = '';
  addItem(); addItem();
  updatePreview();
  saveDocument(true);
  refreshDocumentActions();
  showToast('New document started.');
}

/* ── Unload Guard ──────────────────────────────────────── */
window.addEventListener('beforeunload', () => {
  if (autosaveTimer) {
    clearTimeout(autosaveTimer);
    saveDocument(true);
  }
});
