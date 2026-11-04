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
  'INVOICE': [{ id:'dueDate', label:'Payment Due Date', type:'date' }, { id:'paymentStatus', label:'Payment Status', type:'select', options:['Unpaid','Partially Paid','Paid','Overdue'] }],
  'RECEIPT': [{ id:'paymentDate', label:'Payment Date', type:'date' }, { id:'amountPaid', label:'Amount Paid', type:'number' }, { id:'paymentMethod', label:'Payment Method', placeholder:'e.g. Bank transfer' }],
  'PURCHASE ORDER': [{ id:'supplierName', label:'Supplier Name' }, { id:'supplierAddress', label:'Supplier Address', type:'textarea' }, { id:'deliveryAddress', label:'Delivery Address', type:'textarea' }, { id:'expectedDeliveryDate', label:'Expected Delivery Date', type:'date' }],
  'CREDIT NOTE': [{ id:'originalInvoice', label:'Original Invoice Reference' }, { id:'creditReason', label:'Reason for Credit', type:'textarea' }],
  'DELIVERY NOTE': [{ id:'deliveryDate', label:'Delivery Date', type:'date' }, { id:'recipientConfirmation', label:'Recipient Confirmation', placeholder:'Name / signature' }]
};
let currentDocumentType = 'QUOTATION';
let documentSequences = {};
let specificData = {};
let documentNumbers = {};

/* ── Init ──────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  const today = new Date();
  document.getElementById('documentDate').value = today.toISOString().split('T')[0];

  const validDate = new Date();
  validDate.setDate(validDate.getDate() + 30);
  document.getElementById('validUntil').value = validDate.toISOString().split('T')[0];
  documentSequences = readDocumentSequences();

  loadDocument();
});

function readDocumentSequences() {
  try { return JSON.parse(localStorage.getItem('dlaw_document_sequences') || '{}'); } catch (e) { return {}; }
}

function nextDocumentNumber(type) {
  const config = DOCUMENT_TYPES[type] || DOCUMENT_TYPES.QUOTATION;
  const seq = (Number(documentSequences[type]) || 0) + 1;
  documentSequences[type] = seq;
  try { localStorage.setItem('dlaw_document_sequences', JSON.stringify(documentSequences)); } catch (e) {}
  return `${config.prefix}-${String(seq).padStart(4, '0')}`;
}

function onDocumentNumberInput() {
  const type = document.getElementById('documentType').value;
  const value = document.getElementById('documentNumber').value.trim();
  documentNumbers[type] = value;
  const config = DOCUMENT_TYPES[type];
  const match = value.match(new RegExp(`^${config.prefix}-(\\d+)$`, 'i'));
  if (match) {
    documentSequences[type] = Math.max(Number(documentSequences[type]) || 0, Number(match[1]));
    try { localStorage.setItem('dlaw_document_sequences', JSON.stringify(documentSequences)); } catch (e) {}
  }
  updatePreview();
}

function onDocumentTypeChange() {
  Object.assign(specificData, getSpecificValues());
  const previousType = currentDocumentType;
  documentNumbers[previousType] = document.getElementById('documentNumber').value;
  const type = document.getElementById('documentType').value;
  currentDocumentType = type;
  document.title = `IMC Technology | ${DOCUMENT_TYPES[type]?.title || 'Document'} Builder`;
  document.getElementById('documentNumber').value = documentNumbers[type] || nextDocumentNumber(type);
  renderDocumentSpecificFields(type, specificData);
  const terms = document.getElementById('terms');
  if (!terms.value.trim() || terms.value === DOCUMENT_TYPES[previousType]?.terms) terms.value = DOCUMENT_TYPES[type]?.terms || '';
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

function getSpecificValues() {
  const values = {};
  (SPECIFIC_FIELDS[document.getElementById('documentType').value] || []).forEach(field => {
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
  document.getElementById('previewDocumentDate').textContent = formatDate(get('documentDate'));
  const metaRows = document.getElementById('previewMetaRows');
  metaRows.replaceChildren();
  const labels = { validUntil:'Valid Until', dueDate:'Payment Due', paymentStatus:'Payment Status', completionPeriod:'Estimated Completion', paymentDate:'Payment Date', amountPaid:'Amount Paid', paymentMethod:'Payment Method', expectedDeliveryDate:'Expected Delivery', originalInvoice:'Original Invoice', deliveryDate:'Delivery Date' };
  const values = { ...specificData, ...getSpecificValues() };
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
  scheduleAutosave();
}

/* ── Autosave & Persistence ────────────────────────────── */
function scheduleAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => saveDocument(true), 900);
}

function collectDocumentData() {
  const data = {
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
  try {
    localStorage.setItem('dlaw_current_document', JSON.stringify(collectDocumentData()));
    if (!silent) showToast('Document saved.');
  } catch (e) {
    if (!silent) showToast('Could not save (storage unavailable).');
  }
}

function loadDocument() {
  let saved = null;
  try { saved = localStorage.getItem('dlaw_current_document'); } catch (e) {}

  if (!saved) {
    currentDocumentType = 'QUOTATION';
    document.getElementById('documentNumber').value = nextDocumentNumber(currentDocumentType);
    documentNumbers[currentDocumentType] = document.getElementById('documentNumber').value;
    renderDocumentSpecificFields(currentDocumentType);
    document.getElementById('terms').value = DOCUMENT_TYPES[currentDocumentType].terms;
    addItem(); addItem();
    updatePreview();
    return;
  }

  let data;
  try { data = JSON.parse(saved); } catch (e) { addItem(); addItem(); updatePreview(); return; }

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
  specificData = { ...(data.document?.specific || {}) };
  if (!specificData.validUntil && data.document?.validUntil) specificData.validUntil = data.document.validUntil;
  if (!document.getElementById('documentNumber').value.trim()) {
    document.getElementById('documentNumber').value = nextDocumentNumber(currentDocumentType);
  }
  documentNumbers = { [currentDocumentType]: data.document?.number || '' };
  document.title = `IMC Technology | ${DOCUMENT_TYPES[currentDocumentType]?.title || 'Document'} Builder`;
  renderDocumentSpecificFields(currentDocumentType, specificData);
  if (!data.terms) document.getElementById('terms').value = DOCUMENT_TYPES[currentDocumentType]?.terms || '';
  const oldNumber = data.document?.number || '';
  const oldSequence = Number(oldNumber.match(/(\d+)$/)?.[1] || 0);
  if (oldSequence) {
    documentSequences[currentDocumentType] = Math.max(Number(documentSequences[currentDocumentType]) || 0, oldSequence);
    try { localStorage.setItem('dlaw_document_sequences', JSON.stringify(documentSequences)); } catch (e) {}
  }

  (data.items || []).forEach(item => addItem(item.description, item.quantity, item.unit, item.price));
  if (!data.items || data.items.length === 0) { addItem(); addItem(); }

  updatePreview();
}

/* ── New Document ──────────────────────────────────────── */
function newDocument() {
  if (!confirm('Start a new document? Unsaved changes to the current one will be lost.')) return;

  document.getElementById('companyName').value = 'IMC Technology';
  document.getElementById('companyEmail').value = '';
  document.getElementById('companyPhone').value = '';
  document.getElementById('companyWebsite').value = '';
  document.getElementById('companyAddress').value = '';
  removeLogo();

  document.getElementById('documentType').value = 'QUOTATION';
  currentDocumentType = 'QUOTATION';
  document.title = 'IMC Technology | Quotation Builder';
  documentNumbers = {};
  specificData = {};
  document.getElementById('documentNumber').value = nextDocumentNumber('QUOTATION');
  const t = new Date();
  document.getElementById('documentDate').value = t.toISOString().split('T')[0];
  const v = new Date(); v.setDate(v.getDate() + 30);
  specificData.validUntil = v.toISOString().split('T')[0];
  documentNumbers.QUOTATION = document.getElementById('documentNumber').value;
  renderDocumentSpecificFields('QUOTATION', specificData);
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
  showToast('New document started.');
}

/* ── Unload Guard ──────────────────────────────────────── */
window.addEventListener('beforeunload', () => {
  if (autosaveTimer) {
    clearTimeout(autosaveTimer);
    saveDocument(true);
  }
});   
