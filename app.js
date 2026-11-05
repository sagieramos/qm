/* ── Constants & State ─────────────────────────────────── */
const CURRENCY_LOCALES = {
  NGN: 'en-NG', USD: 'en-US', GHS: 'en-GH',
  KES: 'en-KE', ZAR: 'en-ZA', EUR: 'en-IE', GBP: 'en-GB'
};

let companyLogoData = '';
let companySignatureSettings = { autoInclude:true, showSignatory:true, documentTypes:Object.keys(DOCUMENT_TYPES) };
let defaultBusinessSignature = null;
let editingSignatureId = null;
let autosaveTimer = null;
let saveQueue = Promise.resolve();
let changeRevision = 0;
let currentView = 'dashboard';
let cachedDocuments = [];
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
const DOCUMENT_STATUS_OPTIONS = {
  'QUOTATION': ['Draft','Issued','Accepted','Rejected','Cancelled','Expired'],
  'ESTIMATE': ['Draft','Issued','Final','Cancelled'],
  'INVOICE': ['Draft','Issued','Partially Paid','Paid','Overdue','Cancelled'],
  'PROFORMA INVOICE': ['Draft','Issued','Cancelled'],
  'RECEIPT': ['Draft','Issued','Paid','Cancelled'],
  'PURCHASE ORDER': ['Draft','Issued','Final','Cancelled'],
  'CREDIT NOTE': ['Draft','Issued','Final','Cancelled'],
  'DELIVERY NOTE': ['Draft','Issued','Final','Cancelled']
};
const DELIVERY_STATUS_OPTIONS = ['Not Sent','Sent','Delivered','Viewed'];
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
let activeDeliveryStatus = 'Not Sent';
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
    await loadCompanyProfile();
    initSignatureCanvas();
    await loadDocument();
    await navigateTo('dashboard', false);
    document.querySelectorAll('.editor .section-title').forEach(title => {
      title.tabIndex = 0;
      title.setAttribute('role', 'button');
      title.setAttribute('aria-expanded', 'true');
      const toggleSection = () => {
        const collapsed = title.parentElement.classList.toggle('is-collapsed');
        title.setAttribute('aria-expanded', String(!collapsed));
      };
      title.addEventListener('click', toggleSection);
      title.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          toggleSection();
        }
      });
    });
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
  activeStatus = 'Draft';
  activeDeliveryStatus = 'Not Sent';
  document.getElementById('documentNumber').value = 'Assigning number…';
  renderStatusOptions(type, activeStatus);
  renderDeliveryStatusOptions(activeDeliveryStatus);
  renderDocumentSpecificFields(type, specificData);
  refreshDocumentActions();
  const terms = document.getElementById('terms');
  if (!terms.value.trim() || terms.value === DOCUMENT_TYPES[previousType]?.terms) terms.value = DOCUMENT_TYPES[type]?.terms || '';
  updatePreview();
  saveDocument(true);
}

function renderStatusOptions(type, selected = 'Draft') {
  const select = document.getElementById('documentStatus');
  const values = DOCUMENT_STATUS_OPTIONS[type] || ['Draft','Issued','Cancelled'];
  select.replaceChildren(...values.map(value => { const option = document.createElement('option'); option.value=value; option.textContent=value; return option; }));
  if (!values.includes(selected)) selected = values[0];
  select.value = selected;
  activeStatus = selected;
}

function normalizeStoredDocumentStatus(data) {
  const type = data.document?.type || data.type || 'QUOTATION';
  const previousStatus = data.status || 'Draft';
  let status = previousStatus;
  let deliveryStatus = DELIVERY_STATUS_OPTIONS.includes(data.deliveryStatus) ? data.deliveryStatus : 'Not Sent';
  if (previousStatus === 'Sent') {
    status = 'Issued';
    if (!data.deliveryStatus) deliveryStatus = 'Sent';
  } else if (previousStatus === 'Unpaid') {
    status = 'Issued';
  }
  if (status === 'Final' && !(DOCUMENT_STATUS_OPTIONS[type] || []).includes(status)) status = 'Issued';
  if (!(DOCUMENT_STATUS_OPTIONS[type] || ['Draft','Issued','Cancelled']).includes(status)) status = 'Draft';
  return { status, deliveryStatus };
}

function onDocumentStatusChange() {
  const selected = document.getElementById('documentStatus').value;
  if (currentDocumentType === 'INVOICE' && !['Paid','Partially Paid','Overdue','Cancelled'].includes(selected)) {
    const paid = Number(document.getElementById('amountReceived')?.value) || 0;
    if (paid > 0) {
      activeStatus = paid + 0.000001 >= documentTotalFromForm() ? 'Paid' : 'Partially Paid';
      document.getElementById('documentStatus').value = activeStatus;
      refreshDocumentActions();
      updatePreview();
      return;
    }
  }
  if (currentDocumentType === 'INVOICE' && selected === 'Paid') {
    const total = documentTotalFromForm();
    const paid = Number(document.getElementById('amountReceived')?.value) || 0;
    if (total <= 0 || paid + 0.000001 < total) {
      document.getElementById('documentStatus').value = activeStatus;
      showToast('An invoice can be marked Paid only when its full balance is received.');
      return;
    }
  }
  if (currentDocumentType === 'INVOICE' && selected === 'Partially Paid') {
    const total = documentTotalFromForm();
    const paid = Number(document.getElementById('amountReceived')?.value) || 0;
    if (paid <= 0 || paid + 0.000001 >= total) {
      document.getElementById('documentStatus').value = activeStatus;
      showToast('Enter a payment above zero and below the invoice total for a partial payment.');
      return;
    }
  }
  activeStatus = selected;
  refreshDocumentActions();
  updatePreview();
}

function renderDeliveryStatusOptions(selected = 'Not Sent') {
  const select = document.getElementById('deliveryStatus');
  select.replaceChildren(...DELIVERY_STATUS_OPTIONS.map(value => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    return option;
  }));
  if (!DELIVERY_STATUS_OPTIONS.includes(selected)) selected = 'Not Sent';
  select.value = selected;
  activeDeliveryStatus = selected;
}

function onDeliveryStatusChange() {
  activeDeliveryStatus = document.getElementById('deliveryStatus').value || 'Not Sent';
  updatePreview();
}

function documentTotalFromForm() {
  const subtotal = [...document.querySelectorAll('#itemsBody tr')].reduce((sum,row) => {
    const quantity = Number(row.querySelector('.quantity').value) || 0;
    const price = Number(row.querySelector('.price').value) || 0;
    return sum + quantity * price;
  },0);
  return Math.max(0,subtotal-(Number(document.getElementById('discount').value)||0)+(Number(document.getElementById('tax').value)||0));
}

function syncInvoiceStatusFromPayment() {
  if (loadingDocument || currentDocumentType !== 'INVOICE' || activeStatus === 'Cancelled') return;
  const paid = Math.max(0,Number(document.getElementById('amountReceived')?.value)||0);
  const total = documentTotalFromForm();
  if (paid > 0) activeStatus = paid + 0.000001 >= total ? 'Paid' : 'Partially Paid';
  else if (activeStatus === 'Paid' || activeStatus === 'Partially Paid') activeStatus = 'Issued';
  document.getElementById('documentStatus').value = activeStatus;
}

function onInvoiceAmountReceivedChange() {
  syncInvoiceStatusFromPayment();
  refreshDocumentActions();
  updatePreview();
}

function onFinancialInput() {
  calculateTotals();
  syncInvoiceStatusFromPayment();
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
    if (field.id === 'amountReceived') {
      input.min = '0';
      input.step = '0.01';
      input.addEventListener('input', onInvoiceAmountReceivedChange);
      input.addEventListener('change', onInvoiceAmountReceivedChange);
    } else {
      input.addEventListener('input', updatePreview);
      input.addEventListener('change', updatePreview);
    }
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

function setSaveStatus(status) {
  const host=document.getElementById('saveStatus');
  if (!host) return;
  host.textContent=status;
  host.dataset.state=status.toLowerCase().replaceAll(' ','-');
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
  syncInvoiceStatusFromPayment();
  refreshDocumentActions();
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
  syncInvoiceStatusFromPayment();
  refreshDocumentActions();
  updatePreview();
}

/* ── Calculations ──────────────────────────────────────── */
function updateItem(input) {
  const row = input.closest('tr');
  const quantity = parseFloat(row.querySelector('.quantity').value) || 0;
  const price = parseFloat(row.querySelector('.price').value) || 0;
  row.querySelector('.item-total').textContent = formatCurrency(quantity * price);
  calculateTotals();
  syncInvoiceStatusFromPayment();
  refreshDocumentActions();
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
  document.getElementById('previewSubtotalRow').hidden = discount === 0 && tax === 0;
  document.getElementById('previewDiscountRow').hidden = discount === 0;
  document.getElementById('previewTaxRow').hidden = tax === 0;
}

function onCurrencyChange() {
  refreshAllItemTotals();
  calculateTotals();
  syncInvoiceStatusFromPayment();
  refreshDocumentActions();
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
function updatePdfStatusDisplay() {
  const status = String(activeStatus || document.getElementById('documentStatus').value || '').trim();
  const stamp = document.getElementById('previewStatusStamp');
  const label = document.getElementById('previewDocumentStatus');
  const summary = document.getElementById('previewPaymentSummary');
  const visibleStatuses = {
    Draft:'draft', Paid:'paid', 'Partially Paid':'partial', Cancelled:'cancelled',
    Accepted:'accepted', Rejected:'rejected'
  };
  const variant = visibleStatuses[status];
  stamp.hidden = !variant;
  stamp.className = variant ? `pdf-status-stamp pdf-status--${variant}` : 'pdf-status-stamp';
  label.textContent = variant ? status.toUpperCase() : '';
  const partial = status === 'Partially Paid';
  summary.hidden = !partial;
  if (partial) {
    const paid = Math.max(0,Number(document.getElementById('amountReceived')?.value)||0);
    const balance = Math.max(0,documentTotalFromForm()-paid);
    summary.textContent = `Paid ${formatCurrency(paid)} · Outstanding ${formatCurrency(balance)}`;
  } else {
    summary.textContent = '';
  }
}

function updatePreview() {
  const get = id => document.getElementById(id).value;

  document.getElementById('previewCompanyName').textContent = get('companyName');
  updateSignaturePreview(get('documentType'));
  document.getElementById('previewCompanyEmail').textContent = get('companyEmail');
  document.getElementById('previewCompanyPhone').textContent = get('companyPhone');
  document.getElementById('previewCompanyWebsite').textContent = get('companyWebsite');
  document.getElementById('previewCompanyAddress').textContent = get('companyAddress');
  document.getElementById('previewCompanyEmailRow').hidden = !get('companyEmail').trim();
  document.getElementById('previewCompanyPhoneRow').hidden = !get('companyPhone').trim();
  document.getElementById('previewCompanyAddress').hidden = !get('companyAddress').trim();
  document.getElementById('previewCompanyWebsite').hidden = !get('companyWebsite').trim();
  document.getElementById('previewCompanyContact').hidden = ![
    get('companyEmail'), get('companyPhone'), get('companyAddress'), get('companyWebsite')
  ].some(value => value.trim());

  const type = get('documentType');
  const config = DOCUMENT_TYPES[type] || DOCUMENT_TYPES.QUOTATION;
  document.getElementById('previewDocumentType').textContent = config.title.toUpperCase();
  document.getElementById('previewNumberLabel').textContent = config.numberLabel;
  document.getElementById('previewDocumentNumber').textContent = get('documentNumber');
  updatePdfStatusDisplay();
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
    if (field.id === 'amountReceived' && activeStatus === 'Partially Paid') return;
    const value = values[field.id];
    if (!value) return;
    const row = document.createElement('div');
    const label = labels[field.id] || field.label;
    const display = field.type === 'date' ? formatDate(value) : (field.id === 'amountPaid' ? formatCurrency(Number(value)) : value);
    row.innerHTML = `<strong>${escapeHtml(label)}:</strong> ${escapeHtml(display)}`;
    metaRows.appendChild(row);
  });

  document.getElementById('previewProjectName').textContent = get('projectName');
  document.getElementById('previewScopeOfWork').textContent = get('scopeOfWork');

  document.getElementById('previewClientName').textContent = get('clientName');
  document.getElementById('previewClientAddress').textContent = get('clientAddress');
  document.getElementById('previewClientPhone').textContent = get('clientPhone');
  document.getElementById('previewClientEmail').textContent = get('clientEmail');

  document.getElementById('previewPaymentDetails').textContent = get('paymentDetails');
  document.getElementById('previewTerms').textContent = get('terms');
  const infoTitles = document.querySelectorAll('.document-info .info-title');
  infoTitles[0].textContent = type === 'PURCHASE ORDER' ? 'Supplier' : 'Bill To';
  infoTitles[1].textContent = type === 'PURCHASE ORDER' ? 'Delivery Address' : 'Service / Project';
  if (type === 'PURCHASE ORDER' && values.supplierName) document.getElementById('previewClientName').textContent = values.supplierName;
  if (type === 'PURCHASE ORDER' && values.supplierAddress) document.getElementById('previewClientAddress').textContent = values.supplierAddress;
  if (type === 'PURCHASE ORDER' && values.deliveryAddress) document.getElementById('previewProjectName').textContent = values.deliveryAddress;
  document.getElementById('previewClientAddress').hidden = !document.getElementById('previewClientAddress').textContent.trim();
  document.getElementById('previewClientPhone').hidden = !document.getElementById('previewClientPhone').textContent.trim();
  document.getElementById('previewClientEmail').hidden = !document.getElementById('previewClientEmail').textContent.trim();
  document.getElementById('previewClientBlock').hidden = ![
    document.getElementById('previewClientName').textContent,
    document.getElementById('previewClientAddress').textContent,
    document.getElementById('previewClientPhone').textContent,
    document.getElementById('previewClientEmail').textContent
  ].some(value => value.trim());
  document.getElementById('previewProjectBlock').hidden = !document.getElementById('previewProjectName').textContent.trim();
  document.getElementById('previewClientProjectInfo').hidden =
    document.getElementById('previewClientBlock').hidden && document.getElementById('previewProjectBlock').hidden;
  document.getElementById('previewScopeBox').hidden = !get('scopeOfWork').trim();
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
  document.getElementById('previewPaymentBlock').hidden = !get('paymentDetails').trim();
  document.getElementById('previewTermsBlock').hidden = !get('terms').trim();
  document.getElementById('previewNotes').hidden =
    document.getElementById('previewPaymentBlock').hidden && document.getElementById('previewTermsBlock').hidden;

  const previewBody = document.getElementById('previewItemsBody');
  previewBody.innerHTML = '';
  let itemCount = 0;
  document.querySelectorAll('#itemsBody tr').forEach(row => {
    const description = row.querySelector('.description').value;
    const quantity = parseFloat(row.querySelector('.quantity').value) || 0;
    const unit = row.querySelector('.unit').value;
    const price = parseFloat(row.querySelector('.price').value) || 0;
    const amount = quantity * price;
    if (!description.trim() && amount === 0) return;
    const previewRow = document.createElement('tr');
    previewRow.innerHTML = `<td>${++itemCount}</td><td>${escapeHtml(description)}</td><td>${quantity}</td><td>${escapeHtml(unit)}</td><td>${formatCurrency(amount)}</td>`;
    previewBody.appendChild(previewRow);
  });
  document.getElementById('previewItemsTable').hidden = itemCount === 0;

  calculateTotals();
  if (!loadingDocument) scheduleAutosave();
}

/* ── Autosave & Persistence ────────────────────────────── */
function scheduleAutosave() {
  changeRevision++;
  setSaveStatus('Unsaved changes');
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => saveDocument(true), 900);
}

function collectDocumentData() {
  const data = {
    id: activeDocumentId,
    status: document.getElementById('documentStatus').value || activeStatus,
    deliveryStatus: document.getElementById('deliveryStatus').value || activeDeliveryStatus || 'Not Sent',
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
  setSaveStatus('Saving...');
  const revision = changeRevision;
  const operation = saveQueue.then(async () => {
    try {
      const payload = collectDocumentData();
      const saved = activeDocumentId ? await BusinessDB.updateDocument(payload) : await BusinessDB.createDocument(payload);
      activeDocumentId = saved.id;
      currentDocumentType = saved.type;
      activeStatus = saved.status;
      activeDeliveryStatus = saved.deliveryStatus || 'Not Sent';
      document.getElementById('documentNumber').value = saved.number;
      document.getElementById('previewDocumentNumber').textContent = saved.number;
      document.getElementById('previewDocumentType').textContent = (DOCUMENT_TYPES[saved.type]?.title || saved.type).toUpperCase();
      documentNumbers[saved.type] = saved.number;
      renderStatusOptions(saved.type, saved.status);
      renderDeliveryStatusOptions(activeDeliveryStatus);
      await renderDocumentHistory(saved.id);
      refreshDocumentActions();
      if (revision === changeRevision) setSaveStatus('Saved');
      if (!silent) showToast('Document saved.');
      return saved;
    } catch (e) {
      console.error(e);
      setSaveStatus('Save failed');
      showToast(`Could not save document: ${e.message}`);
      return null;
    }
  });
  saveQueue = operation.then(() => undefined, () => undefined);
  return operation;
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
  ({ status:activeStatus, deliveryStatus:activeDeliveryStatus } = normalizeStoredDocumentStatus(data));
  renderStatusOptions(currentDocumentType, activeStatus);
  renderDeliveryStatusOptions(activeDeliveryStatus);
  specificData = { ...(data.document?.specific || {}) };
  if (!specificData.validUntil && data.document?.validUntil) specificData.validUntil = data.document.validUntil;
  documentNumbers = { [currentDocumentType]: data.document?.number || data.number || '' };
  document.title = `IMC Technology | ${DOCUMENT_TYPES[currentDocumentType]?.title || 'Document'} Builder`;
  document.querySelector('.page-heading h1').textContent=`New ${DOCUMENT_TYPES[currentDocumentType]?.title || 'business document'}`;
  renderDocumentSpecificFields(currentDocumentType, specificData);
  if (!data.terms) document.getElementById('terms').value = DOCUMENT_TYPES[currentDocumentType]?.terms || '';
  (data.items || []).forEach(item => addItem(item.description, item.quantity, item.unit, item.price));
  if (!data.items || data.items.length === 0) { addItem(); addItem(); }

  updatePreview();
  loadingDocument = false;
  document.getElementById('documentNumber').value = data.number || data.document?.number || '';
  await renderDocumentHistory(data.id);
  refreshDocumentActions();
  setSaveStatus(data.id ? 'Saved' : 'Unsaved changes');
}

async function loadDocument() {
  const docs = await BusinessDB.listDocuments();
  if (docs.length) return loadDocumentData(docs[0]);
  loadingDocument=true;
  const profile=await loadCompanyProfile().catch(()=>({}));
  document.getElementById('companyName').value=profile.name||'IMC Technology';
  document.getElementById('companyEmail').value=profile.email||'';
  document.getElementById('companyPhone').value=profile.phone||'';
  document.getElementById('companyWebsite').value=profile.website||'';
  document.getElementById('companyAddress').value=profile.address||'';
  companyLogoData=profile.logo||'';
  applyLogoPreview();
  currentDocumentType = 'QUOTATION';
  renderStatusOptions(currentDocumentType, 'Draft');
  renderDeliveryStatusOptions('Not Sent');
  const firstExpiry = new Date(); firstExpiry.setDate(firstExpiry.getDate()+30);
  specificData = { validUntil:firstExpiry.toISOString().slice(0,10) };
  renderDocumentSpecificFields(currentDocumentType, specificData);
  document.getElementById('terms').value = DOCUMENT_TYPES.QUOTATION.terms;
  addItem(); addItem();
  updatePreview();
  loadingDocument=false;
  setSaveStatus('Saved');
}

function populateCompanyProfile(company = {}) {
  const values = {
    profileCompanyName:company.name || 'IMC Technology', profileCompanyEmail:company.email || '',
    profileCompanyPhone:company.phone || '', profileCompanyWebsite:company.website || '',
    profileCompanyAddress:company.address || ''
  };
  Object.entries(values).forEach(([id,value]) => { const input=document.getElementById(id); if(input) input.value=value; });
  const preview=document.getElementById('profileLogoPreview');
  if (preview) { preview.src=company.logo || ''; preview.hidden=!company.logo; }
  const file=document.getElementById('profileCompanyLogo');
  if (file) file.dataset.logo=company.logo || '';
}

async function loadCompanyProfile() {
  const companies=await BusinessDB.getRecords('companies');
  const profile=companies.find(row=>row.id===BUSINESS_ID) || companies.sort((a,b)=>(b.updatedAt||'').localeCompare(a.updatedAt||''))[0] || {};
  populateCompanyProfile(profile);
  companySignatureSettings={autoInclude:profile.signatureSettings?.autoInclude ?? true,showSignatory:profile.signatureSettings?.showSignatory ?? true,documentTypes:profile.signatureSettings?.documentTypes || Object.keys(DOCUMENT_TYPES)};
  renderSignatureSettings();
  await loadBusinessSignatures();
  return profile;
}

const BUSINESS_ID='company:default';
function signatureId() { return `signature:${crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`}`; }
async function loadBusinessSignatures() {
  const signatures=await BusinessDB.getRecords('signatures');
  const rows=signatures.filter(row=>row.businessId===BUSINESS_ID).sort((a,b)=>(b.updatedAt||'').localeCompare(a.updatedAt||''));
  defaultBusinessSignature=rows.find(row=>row.isDefault)||null;
  renderSignatureList(rows);
}
function renderSignatureList(rows) {
  const list=document.getElementById('signatureList');
  if(!list) return;
  if(!rows.length) { list.innerHTML='<p class="signature-empty">No authorized signatures yet.</p>'; return; }
  list.replaceChildren(...rows.map(row=>{
    const card=document.createElement('article'); card.className='signature-card';
    const image=document.createElement('img'); image.src=row.image; image.alt=`Signature of ${row.name}`;
    const details=document.createElement('div'); details.className='signature-card-details';
    const name=document.createElement('strong'); name.textContent=row.name;
    const designation=document.createElement('span'); designation.textContent=row.designation||'No designation';
    details.append(name,designation);
    if(row.isDefault) { const badge=document.createElement('span'); badge.className='signature-default-badge'; badge.textContent='Default'; details.append(badge); }
    const actions=document.createElement('div'); actions.className='signature-card-actions';
    const edit=document.createElement('button'); edit.type='button'; edit.className='btn btn-secondary'; edit.textContent='Edit'; edit.onclick=()=>editSignature(row);
    if(!row.isDefault) { const makeDefault=document.createElement('button'); makeDefault.type='button'; makeDefault.className='btn btn-secondary'; makeDefault.textContent='Make default'; makeDefault.onclick=()=>setDefaultSignature(row); actions.append(makeDefault); }
    const remove=document.createElement('button'); remove.type='button'; remove.className='btn btn-secondary'; remove.textContent='Delete'; remove.onclick=()=>removeSignature(row); actions.append(edit,remove);
    card.append(image,details,actions); return card;
  }));
}
function renderSignatureSettings() {
  const list=document.getElementById('signatureDocumentTypes');
  if(!list) return;
  document.getElementById('autoIncludeSignature').checked=companySignatureSettings.autoInclude;
  document.getElementById('showSignatoryDetails').checked=companySignatureSettings.showSignatory;
  list.replaceChildren(...Object.entries(DOCUMENT_TYPES).map(([type,config])=>{
    const label=document.createElement('label'); label.className='check-row';
    const checkbox=document.createElement('input'); checkbox.type='checkbox'; checkbox.value=type; checkbox.checked=companySignatureSettings.documentTypes.includes(type); checkbox.onchange=updatePreview;
    label.append(checkbox,document.createTextNode(config.title)); return label;
  }));
  document.getElementById('autoIncludeSignature').onchange=updatePreview;
  document.getElementById('showSignatoryDetails').onchange=updatePreview;
}
function updateSignaturePreview(type) {
  const block=document.getElementById('previewSignature');
  if(!block) return;
  const enabled=document.getElementById('autoIncludeSignature')?.checked ?? companySignatureSettings.autoInclude;
  const typeCheckboxes=document.querySelectorAll('#signatureDocumentTypes input');
  const selected=typeCheckboxes.length ? [...typeCheckboxes].some(input=>input.value===type&&input.checked) : companySignatureSettings.documentTypes.includes(type);
  const signature=defaultBusinessSignature;
  block.hidden=!(enabled&&selected&&signature?.image);
  if(block.hidden) return;
  document.getElementById('previewSignatureImage').src=signature.image;
  const showDetails=document.getElementById('showSignatoryDetails')?.checked ?? companySignatureSettings.showSignatory;
  const caption=document.getElementById('previewSignatureCaption');
  caption.replaceChildren();
  if(showDetails) {
    const name=document.createElement('strong'); name.textContent=signature.name; caption.append(name);
    if(signature.designation) { const designation=document.createElement('span'); designation.textContent=signature.designation; caption.append(designation); }
  }
}
function initSignatureCanvas() {
  const canvas=document.getElementById('signatureCanvas'); if(!canvas) return;
  const ctx=canvas.getContext('2d'); ctx.strokeStyle='#173d2a'; ctx.lineWidth=3; ctx.lineCap='round'; ctx.lineJoin='round';
  let drawing=false;
  const point=event=>{const rect=canvas.getBoundingClientRect(); return {x:(event.clientX-rect.left)*canvas.width/rect.width,y:(event.clientY-rect.top)*canvas.height/rect.height};};
  canvas.addEventListener('pointerdown',event=>{drawing=true; canvas.setPointerCapture(event.pointerId); const p=point(event); ctx.beginPath(); ctx.moveTo(p.x,p.y);});
  canvas.addEventListener('pointermove',event=>{if(!drawing)return;const p=point(event);ctx.lineTo(p.x,p.y);ctx.stroke();});
  canvas.addEventListener('pointerup',()=>drawing=false); canvas.addEventListener('pointercancel',()=>drawing=false);
}
function clearSignatureCanvas() { const canvas=document.getElementById('signatureCanvas'); canvas?.getContext('2d').clearRect(0,0,canvas.width,canvas.height); }
function canvasHasSignature() { const canvas=document.getElementById('signatureCanvas'); const ctx=canvas.getContext('2d'); return ctx.getImageData(0,0,canvas.width,canvas.height).data.some((value,index)=>index%4===3&&value>0); }
function cancelSignatureEdit() { editingSignatureId=null; document.getElementById('signatureName').value=''; document.getElementById('signatureDesignation').value=''; document.getElementById('signatureUpload').value=''; document.getElementById('signatureDefault').checked=true; clearSignatureCanvas(); document.getElementById('signatureFormHeading').textContent='Add an authorized signature'; document.getElementById('cancelSignatureEdit').hidden=true; }
function editSignature(row) { editingSignatureId=row.id; document.getElementById('signatureName').value=row.name; document.getElementById('signatureDesignation').value=row.designation||''; document.getElementById('signatureDefault').checked=!!row.isDefault; document.getElementById('signatureUpload').value=''; clearSignatureCanvas(); document.getElementById('signatureFormHeading').textContent='Edit authorized signature'; document.getElementById('cancelSignatureEdit').hidden=false; document.getElementById('signatureName').dataset.currentImage=row.image; }
async function signatureUploadData(file) { if(file.size>2*1024*1024) throw new Error('Signature image too large (max 2 MB).'); return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('Could not read signature image.'));reader.readAsDataURL(file);}); }
async function saveSignatureProfile() {
  const name=document.getElementById('signatureName').value.trim();
  if(!name) { showToast('Enter the signatory name.'); return; }
  const file=document.getElementById('signatureUpload').files?.[0]; let image='';
  try { image=file?await signatureUploadData(file):(canvasHasSignature()?document.getElementById('signatureCanvas').toDataURL('image/png'):document.getElementById('signatureName').dataset.currentImage||''); }
  catch(error) { showToast(error.message); return; }
  if(!image) { showToast('Draw or upload a signature image.'); return; }
  const record={id:editingSignatureId||signatureId(),businessId:BUSINESS_ID,name,designation:document.getElementById('signatureDesignation').value.trim(),image,isDefault:document.getElementById('signatureDefault').checked || !defaultBusinessSignature};
  try { await BusinessDB.saveSignature(record); cancelSignatureEdit(); await loadBusinessSignatures(); showToast('Authorized signature saved.'); }
  catch(error) { showToast(`Could not save signature: ${error.message}`); }
}
async function setDefaultSignature(row) { try { await BusinessDB.saveSignature({...row,isDefault:true}); await loadBusinessSignatures(); showToast(`${row.name} is now the default signature.`); } catch(error) { showToast(`Could not set default signature: ${error.message}`); } }
async function removeSignature(row) { if(!confirm(`Delete the signature for ${row.name}?`)) return; try { await BusinessDB.deleteSignature(row.id); if(editingSignatureId===row.id) cancelSignatureEdit(); await loadBusinessSignatures(); showToast('Signature deleted.'); } catch(error) { showToast(`Could not delete signature: ${error.message}`); } }
async function saveSignatureSettings() {
  try {
    const companies=await BusinessDB.getRecords('companies'); const profile=companies.find(row=>row.id===BUSINESS_ID)||companies.sort((a,b)=>(b.updatedAt||'').localeCompare(a.updatedAt||''))[0]||{id:BUSINESS_ID};
    companySignatureSettings={autoInclude:document.getElementById('autoIncludeSignature').checked,showSignatory:document.getElementById('showSignatoryDetails').checked,documentTypes:[...document.querySelectorAll('#signatureDocumentTypes input:checked')].map(input=>input.value)};
    await BusinessDB.putRecord('companies',{...profile,id:BUSINESS_ID,signatureSettings:companySignatureSettings,updatedAt:new Date().toISOString()}); updatePreview(); showToast('Signature settings saved.');
  }
  catch(error) { showToast(`Could not save signature settings: ${error.message}`); }
}

async function saveCompanyProfile() {
  const file=document.getElementById('profileCompanyLogo');
  let logo=file.dataset.logo || '';
  if (file.files?.[0]) {
    const image=file.files[0];
    if (image.size > 2*1024*1024) { showToast('Logo too large (max 2 MB).'); return; }
    logo=await new Promise((resolve,reject)=>{ const reader=new FileReader(); reader.onload=()=>resolve(reader.result); reader.onerror=()=>reject(new Error('Could not read the logo file.')); reader.readAsDataURL(image); }).catch(error=>{ showToast(error.message); return null; });
    if (logo === null) return;
  }
  try {
    const prior=await BusinessDB.getRecord('companies',BUSINESS_ID) || {};
    const company={...prior,id:BUSINESS_ID, name:document.getElementById('profileCompanyName').value.trim(), email:document.getElementById('profileCompanyEmail').value.trim(), phone:document.getElementById('profileCompanyPhone').value.trim(), website:document.getElementById('profileCompanyWebsite').value.trim(), address:document.getElementById('profileCompanyAddress').value.trim(), logo, updatedAt:new Date().toISOString()};
    await BusinessDB.putRecord('companies',company);
    populateCompanyProfile(company);
    showToast('Company profile saved.');
  } catch(error) { showToast(`Could not save company profile: ${error.message}`); }
}

function navigateTo(view, saveCurrent = true) {
  if (saveCurrent && currentView === 'editor' && view !== 'editor') {
    return saveDocument(true).then(saved => { if (saved) navigateTo(view, false); });
  }
  currentView=view;
  document.body.classList.toggle('in-editor', view === 'editor');
  document.querySelectorAll('.route-view').forEach(section => { section.hidden=section.id !== `${view}View`; });
  const workspace=document.getElementById('workspacePage');
  workspace.hidden=view !== 'editor';
  if (view === 'editor') { setWorkspaceTab('edit'); updatePreview(); }
  document.querySelectorAll('.nav-link[data-view]').forEach(link => link.classList.toggle('is-active',link.dataset.view===view));
  if (view === 'dashboard') renderDashboard();
  if (view === 'documents') renderDocumentTable();
  if (view === 'customers') renderCustomers();
  if (view === 'company') loadCompanyProfile();
  window.scrollTo({top:0,behavior:'smooth'});
}

function setWorkspaceTab(tab) {
  const workspace = document.getElementById('workspacePage');
  if (!workspace || (tab !== 'edit' && tab !== 'preview')) return;
  workspace.dataset.tab = tab;
  document.getElementById('editTab').setAttribute('aria-selected', String(tab === 'edit'));
  document.getElementById('previewTab').setAttribute('aria-selected', String(tab === 'preview'));
  document.getElementById('editTab').tabIndex = tab === 'edit' ? 0 : -1;
  document.getElementById('previewTab').tabIndex = tab === 'preview' ? 0 : -1;
  window.scrollTo({top: 0, behavior: 'smooth'});
}

async function showDocumentPreview() {
  const saved=await saveDocument(true);
  if (!saved) return;
  currentView='editor';
  document.getElementById('workspacePage').hidden=false;
  document.body.classList.add('in-editor');
  document.querySelectorAll('.route-view').forEach(section=>section.hidden=true);
  document.querySelectorAll('.nav-link[data-view]').forEach(link=>link.classList.remove('is-active'));
  setWorkspaceTab('preview');
  if (!window.matchMedia('(max-width: 1100px)').matches) document.getElementById('documentPreview').scrollIntoView({behavior:'smooth',block:'start'});
}

function openNewDocumentDialog() {
  document.getElementById('newDocumentDialog').showModal();
}

async function confirmNewDocument() {
  const type=document.getElementById('newDocumentType').value;
  document.getElementById('newDocumentDialog').close();
  await newDocument(false,type);
}

function moneyForDocument(doc) {
  const amount=calculateDocumentTotal(doc);
  const currency=doc.document?.currency || 'NGN';
  try { return new Intl.NumberFormat('en-NG',{style:'currency',currency,maximumFractionDigits:2}).format(amount); }
  catch { return `${amount.toFixed(2)} ${currency}`; }
}

function dateForList(value) {
  if (!value) return '—';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00Z`) : new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en-GB',{day:'2-digit',month:'short',year:'numeric',timeZone:'UTC'}).format(date);
}

const RECENT_ICONS = {
  eye:[['path',{d:'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7'}],['circle',{cx:'12',cy:'12',r:'3'}]],
  pencil:[['path',{d:'M12 20h9'}],['path',{d:'M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4Z'}]],
  copy:[['rect',{x:'8',y:'8',width:'14',height:'14',rx:'2'}],['path',{d:'M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2'}]],
  'trash-2':[['path',{d:'M3 6h18'}],['path',{d:'M8 6V4h8v2'}],['path',{d:'M19 6l-1 14H6L5 6'}],['path',{d:'M10 11v5M14 11v5'}]]
};

function createRecentIcon(name) {
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  for (const [key,value] of Object.entries({viewBox:'0 0 24 24',width:'18',height:'18',fill:'none',stroke:'currentColor','stroke-width':'2','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true'})) svg.setAttribute(key,value);
  (RECENT_ICONS[name]||[]).forEach(([tag,attrs])=>{
    const shape=document.createElementNS('http://www.w3.org/2000/svg',tag);
    Object.entries(attrs).forEach(([key,value])=>shape.setAttribute(key,value));
    svg.appendChild(shape);
  });
  return svg;
}

function createRecentAction(doc,label,icon,action) {
  const button=document.createElement('button');
  button.type='button'; button.className=`recent-action recent-action--${icon}`;
  button.title=label; button.setAttribute('aria-label',`${label} ${doc.number||'document'}`);
  button.appendChild(createRecentIcon(icon));
  button.addEventListener('click',event=>{event.stopPropagation();action(doc);});
  return button;
}

function createRecentNumber(doc) {
  const button=document.createElement('button');
  button.type='button'; button.className='recent-document-number'; button.textContent=doc.number||'Draft';
  button.setAttribute('aria-label',`View ${doc.number||'document'} preview`);
  button.addEventListener('click',event=>{event.stopPropagation();viewDocumentById(doc.id);});
  return button;
}

function statusTone(status) {
  const value=String(status||'Draft').toLowerCase();
  if (['accepted','paid'].includes(value)) return 'success';
  if (value==='sent'||value==='issued') return 'blue';
  if (value==='partially paid') return 'amber';
  if (['overdue','rejected','cancelled','canceled'].includes(value)) return 'red';
  return 'neutral';
}

function createStatusBadge(status, delivery=false) {
  const label=status||(delivery?'Not Sent':'Draft');
  const badge=document.createElement('span');
  badge.className=`document-status-badge ${delivery?'delivery':'document'} status-tone-${statusTone(label)}`;
  badge.textContent=label;
  return badge;
}

function appendStatusPair(host,doc) {
  const state=normalizeStoredDocumentStatus(doc);
  const documentLine=document.createElement('div');
  documentLine.className='status-pair-line';
  const documentLabel=document.createElement('span');documentLabel.className='status-pair-label';documentLabel.textContent='Document';
  documentLine.append(documentLabel,createStatusBadge(state.status));
  const deliveryLine=document.createElement('div');
  deliveryLine.className='status-pair-line';
  const deliveryLabel=document.createElement('span');deliveryLabel.className='status-pair-label';deliveryLabel.textContent='Delivery';
  deliveryLine.append(deliveryLabel,createStatusBadge(state.deliveryStatus,true));
  host.append(documentLine,deliveryLine);
}

function makeRecentDocuments(docs) {
  const root=document.createElement('div'); root.className='recent-documents';
  const wrap=document.createElement('div'); wrap.className='recent-table-wrap';
  const table=document.createElement('table'); table.className='recent-table';
  const caption=document.createElement('caption'); caption.className='sr-only'; caption.textContent='Most recently updated documents'; table.appendChild(caption);
  const head=document.createElement('thead'), headRow=document.createElement('tr');
  ['Document','Customer','Date','Amount','Status','Actions'].forEach(text=>{const th=document.createElement('th');th.scope='col';th.textContent=text;headRow.appendChild(th);});
  head.appendChild(headRow); table.appendChild(head);
  const body=document.createElement('tbody'), cards=document.createElement('div'); cards.className='recent-cards';
  docs.forEach(doc=>{
    const state=normalizeStoredDocumentStatus(doc);
    const name=doc.client?.name?.trim()||doc.document?.specific?.supplierName?.trim()||'—';
    const type=DOCUMENT_TYPES[doc.type]?.title||doc.type||'Document';
    const row=document.createElement('tr');
    const documentCell=document.createElement('td'); documentCell.append(createRecentNumber(doc));
    const typeLabel=document.createElement('span'); typeLabel.className='recent-document-type'; typeLabel.textContent=type; documentCell.appendChild(typeLabel); row.appendChild(documentCell);
    const cells=[name,dateForList(doc.document?.date),moneyForDocument(doc)];
    cells.forEach((value,index)=>{const cell=document.createElement('td');cell.textContent=value;cell.dataset.label=['Customer','Date','Amount'][index];if(index===2)cell.className='recent-amount';row.appendChild(cell);});
    const status=document.createElement('td'); status.dataset.label='Status'; status.className='recent-status-cell';
    appendStatusPair(status,doc);row.appendChild(status);
    const actions=document.createElement('td');actions.dataset.label='Actions';actions.className='recent-actions';
    actions.append(createRecentAction(doc,'View','eye',viewDocumentById),createRecentAction(doc,'Edit','pencil',openDocumentById),createRecentAction(doc,'Duplicate','copy',duplicateDocument),createRecentAction(doc,'Delete','trash-2',deleteDocumentById));
    row.appendChild(actions);body.appendChild(row);

    const card=document.createElement('article');card.className='recent-card';
    const cardHeader=document.createElement('div');cardHeader.className='recent-card-header';
    const cardDoc=document.createElement('div');cardDoc.className='recent-card-document';cardDoc.append(createRecentNumber(doc));
    const cardType=document.createElement('span');cardType.className='recent-document-type';cardType.textContent=type;cardDoc.appendChild(cardType);
    cardHeader.append(cardDoc,createStatusBadge(state.status));
    const details=document.createElement('dl');details.className='recent-card-details';
    [['Customer',name],['Date',dateForList(doc.document?.date)],['Amount',moneyForDocument(doc)],['Delivery',state.deliveryStatus]].forEach(([label,value])=>{
      const line=document.createElement('div'),term=document.createElement('dt'),detail=document.createElement('dd');
      term.textContent=label;detail.textContent=value;if(label==='Amount')detail.className='recent-amount';line.append(term,detail);details.appendChild(line);
    });
    const cardActions=document.createElement('div');cardActions.className='recent-actions recent-card-actions';
    cardActions.append(createRecentAction(doc,'View','eye',viewDocumentById),createRecentAction(doc,'Edit','pencil',openDocumentById),createRecentAction(doc,'Duplicate','copy',duplicateDocument),createRecentAction(doc,'Delete','trash-2',deleteDocumentById));
    card.append(cardHeader,details,cardActions);cards.appendChild(card);
  });
  table.appendChild(body);wrap.appendChild(table);root.append(wrap,cards);return root;
}

function setRecentState(host,state,message='') {
  host.replaceChildren();
  const panel=document.createElement('div');panel.className=`recent-state recent-${state}`;
  if(state==='loading') {panel.setAttribute('role','status');panel.textContent='Loading recent documents…';}
  else if(state==='empty') {const title=document.createElement('h3'),detail=document.createElement('p');title.textContent='No documents yet';detail.textContent='Create your first document to see it here.';panel.append(title,detail);}
  else {const detail=document.createElement('p'),retry=document.createElement('button');detail.textContent=message||'Recent documents could not be loaded.';retry.type='button';retry.className='recent-retry';retry.textContent='Try again';retry.addEventListener('click',renderDashboard);panel.append(detail,retry);}
  host.appendChild(panel);
}

function documentActionButton(label, action, doc) {
  const button=document.createElement('button'); button.type='button'; button.className='table-action'; button.textContent=label;
  button.onclick=()=>action(doc); return button;
}

async function renderDashboard() {
  const recent=document.getElementById('dashboardRecent');
  recent.setAttribute('aria-busy','true');
  setRecentState(recent,'loading');
  try {
    const [documents,parties]=await Promise.all([BusinessDB.listDocuments(),BusinessDB.getRecords('parties')]);
    cachedDocuments=documents.sort((a,b)=>(Date.parse(b.updatedAt||'')||0)-(Date.parse(a.updatedAt||'')||0));
    const customers=new Set(cachedDocuments.map(doc=>doc.client?.name?.trim()).filter(Boolean));
    const summary=[['Documents',cachedDocuments.length,'Across all document types'],['Customers',Math.max(customers.size,parties.filter(row=>row.kind==='customer').length),'From saved records'],['Open invoices',cachedDocuments.filter(doc=>doc.type==='INVOICE'&&['Issued','Partially Paid','Overdue'].includes(normalizeStoredDocumentStatus(doc).status)).length,'Awaiting payment'],['Purchase orders',cachedDocuments.filter(doc=>doc.type==='PURCHASE ORDER').length,'Supplier orders']];
    const host=document.getElementById('dashboardSummary'); host.replaceChildren();
    summary.forEach(([title,value,caption])=>{const card=document.createElement('article');card.className='summary-card';const name=document.createElement('div');name.className='summary-label';name.textContent=title;const amount=document.createElement('strong');amount.textContent=value;const note=document.createElement('span');note.textContent=caption;card.append(name,amount,note);host.appendChild(card);});
    if (!cachedDocuments.length) setRecentState(recent,'empty');
    else recent.appendChild(makeRecentDocuments(cachedDocuments.slice(0,5)));
  } catch(error) {
    setRecentState(recent,'error',`Recent documents could not be loaded: ${error.message}`);
    showToast(`Could not load dashboard: ${error.message}`);
  } finally {
    recent.setAttribute('aria-busy','false');
  }
}

function makeDocumentTable(docs, includeType = true) {
  const wrap=document.createElement('div');wrap.className='responsive-table-wrap';
  const table=document.createElement('table');table.className='data-table';
  const headers=['Document','Customer',...(includeType?['Type']:[]),'Date','Amount','Status','Actions'];
  const thead=document.createElement('thead'),headRow=document.createElement('tr');
  headers.forEach(label=>{const th=document.createElement('th');th.textContent=label;headRow.appendChild(th);});thead.appendChild(headRow);table.appendChild(thead);
  const tbody=document.createElement('tbody');
  docs.forEach(doc=>{
    const row=document.createElement('tr');
    const number=document.createElement('td');number.dataset.label='Document';const numberLink=document.createElement('button');numberLink.className='document-number-link';numberLink.textContent=doc.number || 'Draft';numberLink.onclick=()=>openDocumentById(doc.id);number.appendChild(numberLink);
    const customer=document.createElement('td');customer.dataset.label='Customer';customer.textContent=doc.client?.name || doc.document?.specific?.supplierName || '—';
    const cells=[number,customer];
    if(includeType){const type=document.createElement('td');type.dataset.label='Type';type.textContent=DOCUMENT_TYPES[doc.type]?.title || doc.type;cells.push(type);}
    const date=document.createElement('td');date.dataset.label='Date';date.textContent=dateForList(doc.document?.date);
    const amount=document.createElement('td');amount.dataset.label='Amount';amount.textContent=moneyForDocument(doc);
    const status=document.createElement('td');status.dataset.label='Status';status.className='status-pair';appendStatusPair(status,doc);
    const actions=document.createElement('td');actions.dataset.label='Actions';actions.className='row-table-actions';actions.append(documentActionButton('View',row=>viewDocumentById(row.id),doc),documentActionButton('Edit',row=>openDocumentById(row.id),doc),documentActionButton('Duplicate',duplicateDocument,doc),documentActionButton('Delete',deleteDocumentById,doc));
    row.append(...cells,date,amount,status,actions);tbody.appendChild(row);
  });
  table.appendChild(tbody);wrap.appendChild(table);return wrap;
}

async function renderDocumentTable() {
  try {
    cachedDocuments=await BusinessDB.listDocuments();
    const filter=document.getElementById('documentTypeFilter');
    if(filter.options.length===1) Object.keys(DOCUMENT_TYPES).forEach(type=>{const option=document.createElement('option');option.value=type;option.textContent=DOCUMENT_TYPES[type].title;filter.appendChild(option);});
    const query=(document.getElementById('documentSearch').value||'').trim().toLowerCase(), type=filter.value;
    const statusFilter=document.getElementById('documentStatusFilter').value;
    const docs=cachedDocuments.filter(doc=>{
      const status=normalizeStoredDocumentStatus(doc).status;
      return (!type||doc.type===type)&&(!statusFilter||status===statusFilter)&&(!query||[doc.number,doc.client?.name,doc.type,DOCUMENT_TYPES[doc.type]?.title,status,normalizeStoredDocumentStatus(doc).deliveryStatus].some(value=>String(value||'').toLowerCase().includes(query)));
    });
    const host=document.getElementById('allDocumentsList');host.replaceChildren();
    if(!docs.length){const empty=document.createElement('div');empty.className='empty-state';empty.innerHTML='<div class="empty-icon" aria-hidden="true">▤</div><h3>No matching documents</h3><p>Try another search or clear the filters.</p>';host.appendChild(empty);return;}
    host.appendChild(makeDocumentTable(docs,true));
  } catch(error){showToast(`Could not load documents: ${error.message}`);}
}

async function renderCustomers() {
  try {
    const [docs,parties]=await Promise.all([BusinessDB.listDocuments(),BusinessDB.getRecords('parties')]);
    const map=new Map();
    parties.filter(row=>row.kind==='customer').forEach(row=>map.set(row.id,{name:row.name||'',email:row.email||'',phone:row.phone||'',address:row.address||'',documents:0}));
    docs.forEach(doc=>{const name=doc.client?.name?.trim();if(!name)return;const key=`customer:${name.toLowerCase()}`;const customer=map.get(key)||{name,email:doc.client.email||'',phone:doc.client.phone||'',address:doc.client.address||'',documents:0};customer.documents++;customer.email ||= doc.client.email||'';customer.phone ||= doc.client.phone||'';customer.address ||= doc.client.address||'';map.set(key,customer);});
    const host=document.getElementById('customersList');host.replaceChildren();
    if(!map.size){const empty=document.createElement('div');empty.className='empty-state';empty.innerHTML='<div class="empty-icon" aria-hidden="true">♧</div><h3>No customers yet</h3><p>Customer details will appear here after you save a document.</p>';host.appendChild(empty);return;}
    const grid=document.createElement('div');grid.className='customer-grid';
    [...map.values()].sort((a,b)=>a.name.localeCompare(b.name)).forEach(customer=>{const card=document.createElement('article');card.className='customer-card';const avatar=document.createElement('div');avatar.className='customer-avatar';avatar.textContent=(customer.name||'?').slice(0,1).toUpperCase();const name=document.createElement('h3');name.textContent=customer.name||'Unnamed customer';const contact=document.createElement('p');contact.textContent=[customer.email,customer.phone].filter(Boolean).join(' · ')||customer.address||'No contact details';const count=document.createElement('span');count.className='help-text';count.textContent=`${customer.documents} saved document${customer.documents===1?'':'s'}`;card.append(avatar,name,contact,count);grid.appendChild(card);});host.appendChild(grid);
  } catch(error){showToast(`Could not load customers: ${error.message}`);}
}

async function openDocumentById(id) {
  try {
    if (currentView==='editor') {
      const saved=await saveDocument(true);
      if(!saved)throw new Error('Save the current document before opening another.');
    }
    const data=await BusinessDB.getDocument(id);
    if(!data)throw new Error('Document could not be found.');
    await loadDocumentData(data);
    navigateTo('editor',false);
  }
  catch(error){showToast(`Could not open document: ${error.message}`);}
}

async function viewDocumentById(id) {
  await openDocumentById(id);
  if (currentView==='editor') {
    setWorkspaceTab('preview');
    if (!window.matchMedia('(max-width: 1100px)').matches) document.getElementById('documentPreview').scrollIntoView({behavior:'smooth',block:'start'});
  }
}

async function duplicateDocument(doc) {
  try {
    if (currentView==='editor') {
      const saved=await saveDocument(true);
      if(!saved)throw new Error('Save the current document before opening another.');
    }
    const copy=structuredClone(doc);delete copy.id;delete copy.number;delete copy.createdAt;delete copy.updatedAt;copy.document={...copy.document,number:''};copy.status='Draft';copy.deliveryStatus='Not Sent';copy.sourceId=null;copy.sourceNumber=null;
    copy.document.specific={...(copy.document.specific||{}),amountReceived:'',amountPaid:'',transactionReference:'',paymentDate:''};
    const created=await BusinessDB.createDocument(copy);
    await loadDocumentData(created);navigateTo('editor',false);showToast(`Copy ${created.number} created.`);
  } catch(error){showToast(`Could not duplicate document: ${error.message}`);}
}

async function deleteDocumentById(doc) {
  if(!confirm(`Delete ${doc.number}? This action cannot be undone.`))return;
  try {
    await BusinessDB.removeDocument(doc.id);
    if(activeDocumentId===doc.id) {
      activeDocumentId=null;
      const remaining=await BusinessDB.listDocuments();
      if(remaining.length) await loadDocumentData(remaining[0]);
      else await newDocument(true,'QUOTATION',false);
    }
    renderDocumentTable();
    renderDashboard();
    showToast('Document deleted.');
  }
  catch(error){showToast(`Could not delete document: ${error.message}`);}
}

async function renderDocumentHistory(id) {
  const host = document.getElementById('documentHistory');
  if (!host) return;
  if (!id) { host.replaceChildren(); updateDocumentContextVisibility(); return; }
  const docs = await BusinessDB.listDocuments();
  const active = docs.find(doc => doc.id === id);
  if (!active) { host.replaceChildren(); updateDocumentContextVisibility(); return; }
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
  updateDocumentContextVisibility();
}

function updateDocumentContextVisibility() {
  const section=document.getElementById('documentContext');
  if (!section) return;
  section.hidden=!document.getElementById('conversionActions').childElementCount && !document.getElementById('documentHistory').childElementCount;
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
  updateDocumentContextVisibility();
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
    converted.status = 'Draft';
    converted.deliveryStatus = 'Not Sent';
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
  } catch (error) { showToast(error.message || 'Could not convert document.'); }
}

async function exportBackup() {
  try {
    const data = await BusinessDB.allData();
    const blob = new Blob([JSON.stringify(data,null,2)], {type:'application/json'});
    const url = URL.createObjectURL(blob); const link=document.createElement('a');
    link.href=url; link.download=`business-backup-${toLocalDateInput(new Date())}.json`; link.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
    showToast('Backup exported.');
  } catch(error) { showToast(`Backup export failed: ${error.message}`); }
}

async function importBackup(event) {
  const file=event.target.files?.[0]; if(!file)return;
  try {
    const data=JSON.parse(await file.text());
    if(data?.format!=='business_document_manager'||!Number.isInteger(data.version)||data.version<1||data.version>4||('formatVersion' in data && data.formatVersion!==1)||!data.stores||typeof data.stores!=='object') throw new Error('This file is not a supported business backup.');
    if(data.version<4&&!Array.isArray(data.stores.signatures)) data.stores.signatures=[];
    for(const name of ['companies','parties','documents','lineItems','sequences','signatures']) {
      const rows=data.stores[name];
      if(!Array.isArray(rows)||rows.some(row=>!row||typeof row!=='object'||!row.id)||new Set(rows.map(row=>row.id)).size!==rows.length) throw new Error(`Backup data for ${name} is missing, invalid or contains duplicate IDs.`);
    }
    if(!confirm('Merge records from this backup? Existing records with matching IDs will be kept.')) return;
    const result=await BusinessDB.importData(data);
    await Promise.all([renderDashboard(),renderDocumentTable(),renderCustomers()]);
    showToast(`Backup merged: ${result.inserted} added, ${result.skipped} duplicates skipped.`);
  } catch(error) { showToast(`Backup restore failed: ${error.message}`); }
  finally { event.target.value=''; }
}

/* ── New Document ──────────────────────────────────────── */
async function newDocument(skipConfirmation = false, type = 'QUOTATION', persist = true) {
  if (!skipConfirmation && currentView==='editor' && !confirm('Start a new document? Unsaved changes to the current one will be lost.')) return;
  if (!DOCUMENT_TYPES[type]) type='QUOTATION';
  clearTimeout(autosaveTimer);
  autosaveTimer = null;

  const profile = await loadCompanyProfile().catch(()=>({}));
  loadingDocument=true;
  document.getElementById('companyName').value = profile.name || 'IMC Technology';
  document.getElementById('companyEmail').value = profile.email || '';
  document.getElementById('companyPhone').value = profile.phone || '';
  document.getElementById('companyWebsite').value = profile.website || '';
  document.getElementById('companyAddress').value = profile.address || '';
  companyLogoData=profile.logo || '';
  applyLogoPreview();

  document.getElementById('documentType').value = type;
  currentDocumentType = type;
  activeDocumentId = null;
  activeSourceId = null;
  activeSourceNumber = null;
  activeStatus = 'Draft';
  activeDeliveryStatus = 'Not Sent';
  document.getElementById('documentHistory').replaceChildren();
  document.title = `IMC Technology | ${DOCUMENT_TYPES[type].title} Builder`;
  document.querySelector('.page-heading h1').textContent=`New ${DOCUMENT_TYPES[type].title}`;
  documentNumbers = {};
  specificData = {};
  document.getElementById('documentNumber').value = 'Assigning number…';
  const t = new Date();
  document.getElementById('documentDate').value = toLocalDateInput(t);
  const v = new Date(); v.setDate(v.getDate() + 30);
  if(type==='QUOTATION') specificData.validUntil = toLocalDateInput(v);
  renderDocumentSpecificFields(type, specificData);
  renderStatusOptions(type,activeStatus);
  renderDeliveryStatusOptions(activeDeliveryStatus);
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
  document.getElementById('terms').value = DOCUMENT_TYPES[type].terms;

  document.getElementById('itemsBody').innerHTML = '';
  addItem(); addItem();
  updatePreview();
  loadingDocument=false;
  document.getElementById('documentNumber').value=persist?'Assigning number…':'';
  setSaveStatus(persist?'Unsaved changes':'Saved');
  if (persist) await saveDocument(true);
  refreshDocumentActions();
  if (persist) {
    navigateTo('editor',false);
    showToast(`${DOCUMENT_TYPES[type].title} started.`);
  }
}

/* ── Unload Guard ──────────────────────────────────────── */
window.addEventListener('beforeunload', () => {
  if (autosaveTimer) {
    clearTimeout(autosaveTimer);
    saveDocument(true);
  }
});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&autosaveTimer)saveDocument(true);});
