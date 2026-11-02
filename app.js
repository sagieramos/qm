/* ── Constants & State ─────────────────────────────────── */
const CURRENCY_LOCALES = {
  NGN: 'en-NG', USD: 'en-US', GHS: 'en-GH',
  KES: 'en-KE', ZAR: 'en-ZA', EUR: 'en-IE', GBP: 'en-GB'
};

let companyLogoData = '';
let autosaveTimer = null;

/* ── Init ──────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  const today = new Date();
  document.getElementById('documentDate').value = today.toISOString().split('T')[0];

  const validDate = new Date();
  validDate.setDate(validDate.getDate() + 30);
  document.getElementById('validUntil').value = validDate.toISOString().split('T')[0];

  loadDocument();
});

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

  document.getElementById('previewDocumentType').textContent = get('documentType');
  document.getElementById('previewDocumentNumber').textContent = get('documentNumber');
  document.getElementById('previewDocumentDate').textContent = formatDate(get('documentDate'));
  document.getElementById('previewValidUntil').textContent = formatDate(get('validUntil'));

  document.getElementById('previewProjectName').textContent = get('projectName') || '—';
  document.getElementById('previewScopeOfWork').textContent = get('scopeOfWork') || '—';

  document.getElementById('previewClientName').textContent = get('clientName') || '—';
  document.getElementById('previewClientAddress').textContent = get('clientAddress');
  document.getElementById('previewClientPhone').textContent = get('clientPhone');
  document.getElementById('previewClientEmail').textContent = get('clientEmail');

  document.getElementById('previewPaymentDetails').textContent = get('paymentDetails') || '—';
  document.getElementById('previewTerms').textContent = get('terms') || '—';

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
      validUntil: document.getElementById('validUntil').value,
      currency: document.getElementById('currency').value
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
  document.getElementById('validUntil').value = data.document?.validUntil || document.getElementById('validUntil').value;
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
  document.getElementById('documentNumber').value = '';
  const t = new Date();
  document.getElementById('documentDate').value = t.toISOString().split('T')[0];
  const v = new Date(); v.setDate(v.getDate() + 30);
  document.getElementById('validUntil').value = v.toISOString().split('T')[0];
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
  document.getElementById('terms').value =
    'This document is valid for the stated validity period.\n' +
    'Prices are subject to change after the validity period.\n' +
    'Work commencement is subject to the agreed payment terms.';

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
