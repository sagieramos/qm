/* ── Constants & State ─────────────────────────────────── */
const CURRENCY_LOCALES = {
  NGN: 'en-NG', USD: 'en-US', GHS: 'en-GH',
  KES: 'en-KE', ZAR: 'en-ZA', EUR: 'en-IE', GBP: 'en-GB'
};

let companyLogoData = '';
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
const SPECIFIC_FIELDS = {
  'QUOTATION': [{ id:'validUntil', label:'Valid Until', type:'date' }, { id:'acceptanceTerms', label:'Acceptance Terms', type:'textarea', placeholder:'e.g. Sign and return to accept this quotation' }],
  'ESTIMATE': [{ id:'completionPeriod', label:'Estimated Completion Period', placeholder:'e.g. 3–4 weeks' }],
  'INVOICE': [{ id:'dueDate', label:'Payment Due Date', type:'date' }, { id:'amountReceived', label:'Amount Received', type:'number', min:'0', step:'any' }, { id:'paymentMethod', label:'Payment Method', placeholder:'e.g. Bank transfer' }, { id:'transactionReference', label:'Transaction Reference' }],
  'RECEIPT': [{ id:'paymentDate', label:'Payment Date', type:'date' }, { id:'amountPaid', label:'Amount Paid', type:'number' }, { id:'paymentMethod', label:'Payment Method', placeholder:'e.g. Bank transfer' }, { id:'transactionReference', label:'Transaction Reference' }],
  'PURCHASE ORDER': [{ id:'supplierName', label:'Supplier Name' }, { id:'supplierAddress', label:'Supplier Address', type:'textarea' }, { id:'deliveryAddress', label:'Delivery Address', type:'textarea' }, { id:'expectedDeliveryDate', label:'Expected Delivery Date', type:'date' }],
  'CREDIT NOTE': [{ id:'originalInvoice', label:'Original Invoice Reference' }, { id:'creditAmount', label:'Credit Amount', type:'number' }, { id:'creditReason', label:'Reason for Credit', type:'textarea' }],
  'DELIVERY NOTE': [{ id:'deliveryDate', label:'Delivery Date', type:'date' }, { id:'recipientConfirmation', label:'Recipient Confirmation', placeholder:'Name / signature' }]
};
const DOCUMENT_STATUS_OPTIONS = {
  'QUOTATION':['Draft','Issued','Accepted','Rejected','Cancelled'],
  'ESTIMATE':['Draft','Issued','Accepted','Rejected','Cancelled'],
  'INVOICE':['Draft','Issued','Partially Paid','Paid','Overdue','Cancelled'],
  'PROFORMA INVOICE':['Draft','Issued','Cancelled'],
  'RECEIPT':['Draft','Issued','Cancelled'],
  'PURCHASE ORDER':['Draft','Issued','Accepted','Rejected','Cancelled'],
  'CREDIT NOTE':['Draft','Issued','Cancelled'],
  'DELIVERY NOTE':['Draft','Issued','Cancelled']
};
const DELIVERY_STATUS_OPTIONS = ['Not Sent','Sent','Delivered','Viewed'];
let currentDocumentType = 'QUOTATION';
let specificData = {};
let documentNumbers = {};
let activeDocumentId = null;
let activeStatus = 'Draft';
let loadingDocument = false;
let activeSourceId = null;
let activeSourceNumber = null;
let actionRenderId = 0;
let companyProfileData = {};
let signatureCanvasDirty = false;
let activeDocumentSignature = null;

/* ── Init ──────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', async () => {
  const today = new Date();
  document.getElementById('documentDate').value = toLocalDateInput(today);
  try {
    await BusinessDB.open();
    await BusinessDB.migrateLegacy();
    await BusinessDB.migrateStatuses();
    await loadCompanyProfile();
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
    setupSignatureCanvas();
    renderSignatureTypeOptions();
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
  activeDocumentSignature = getAutoIncludedSignature(type);
  document.title = 'IMC Technology';
  if (activeDocumentId) { activeSourceId = activeDocumentId; activeSourceNumber = document.getElementById('documentNumber').value; }
  activeDocumentId = null;
  activeStatus = 'Draft';
  document.getElementById('documentNumber').value = 'Assigning number…';
  renderStatusOptions(type, activeStatus);
  renderDeliveryStatusOptions('Not Sent');
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

function renderDeliveryStatusOptions(selected = 'Not Sent') {
  const select=document.getElementById('deliveryStatus');
  select.replaceChildren(...DELIVERY_STATUS_OPTIONS.map(value=>{const option=document.createElement('option');option.value=value;option.textContent=value;return option;}));
  select.value=DELIVERY_STATUS_OPTIONS.includes(selected)?selected:'Not Sent';
}

function onDocumentStatusChange() {
  const selected=document.getElementById('documentStatus').value;
  const received=Math.max(0,Number(document.getElementById('amountReceived')?.value)||0);
  if (currentDocumentType==='INVOICE' && selected==='Paid' && getInvoiceOutstandingBalance()>0.01) {
    document.getElementById('documentStatus').value=activeStatus;
    showToast('Record the full invoice amount received before marking it Paid.');
    return;
  }
  if (currentDocumentType==='INVOICE' && selected==='Partially Paid' && !(received>0 && getInvoiceOutstandingBalance()>0.01)) {
    document.getElementById('documentStatus').value=activeStatus;
    showToast('Enter an amount received that is greater than zero and less than the invoice total.');
    return;
  }
  activeStatus = selected;
  refreshDocumentActions();
  updatePreview();
}

function onDeliveryStatusChange() {
  updatePreview();
}

async function printDocument() {
  const saved=await saveDocument(true);
  if(saved)window.print();
}

function currentEditorTotal() {
  const subtotal=[...document.querySelectorAll('#itemsBody tr')].reduce((sum,row)=>sum+(Number(row.querySelector('.quantity').value)||0)*(Number(row.querySelector('.price').value)||0),0);
  const discount=Math.max(0,Number(document.getElementById('discount').value)||0);
  const tax=Math.max(0,Number(document.getElementById('tax').value)||0);
  return Math.max(0,subtotal-discount+tax);
}

function getInvoiceOutstandingBalance(total=currentEditorTotal(), received=Number(document.getElementById('amountReceived')?.value)||0) {
  return Math.max(0,total-Math.max(0,received));
}

function onInvoicePaymentChange() {
  if (currentDocumentType==='INVOICE' && activeStatus!=='Cancelled') {
    const input=document.getElementById('amountReceived');
    const received=Math.max(0,Number(input?.value)||0);
    const total=currentEditorTotal();
    if (total>0 && received>=total-0.01) activeStatus='Paid';
    else if (received>0) activeStatus='Partially Paid';
    else if (['Paid','Partially Paid'].includes(activeStatus)) activeStatus='Issued';
    renderStatusOptions('INVOICE',activeStatus);
    refreshDocumentActions();
  }
  updatePreview();
}

function onInvoicePaymentCommit() {
  const input=document.getElementById('amountReceived');
  if (input && currentDocumentType==='INVOICE') input.value=String(Math.min(Math.max(0,Number(input.value)||0),currentEditorTotal()));
  onInvoicePaymentChange();
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
      if (field.min !== undefined) input.min = field.min;
      if (field.step !== undefined) input.step = field.step;
      if (field.placeholder) input.placeholder = field.placeholder;
    }
    input.id = field.id;
    input.value = values[field.id] ?? (field.id === 'validUntil' ? document.getElementById('validUntil')?.value || '' : '');
    input.addEventListener('input', field.id==='amountReceived' ? onInvoicePaymentChange : updatePreview);
    input.addEventListener('change', field.id==='amountReceived' ? onInvoicePaymentCommit : updatePreview);
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

function makePreviewCurrency(value) {
  const currency=document.getElementById('currency')?.value || 'NGN';
  const locale=CURRENCY_LOCALES[currency] || 'en-US';
  const amount=document.createElement('span');
  try {
    const parts=new Intl.NumberFormat(locale,{style:'currency',currency,minimumFractionDigits:2,maximumFractionDigits:2}).formatToParts(value || 0);
    parts.forEach((part,index)=>{
      if(part.type==='currency') {
        const symbol=document.createElement('span');symbol.className='document-currency-symbol';symbol.textContent=part.value;amount.appendChild(symbol);
      } else if(part.type==='literal' && /^\s+$/.test(part.value) && (parts[index-1]?.type==='currency'||parts[index+1]?.type==='currency')) {
        const spacing=document.createElement('span');spacing.className='document-currency-spacing';spacing.textContent=part.value;amount.appendChild(spacing);
      } else amount.appendChild(document.createTextNode(part.value));
    });
  } catch { amount.textContent=Number(value || 0).toFixed(2); }
  return amount;
}

function setPreviewCurrency(id,value) {
  document.getElementById(id).replaceChildren(makePreviewCurrency(value));
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

function renderDocumentStatusMarker(status, type) {
  const marker=document.getElementById('previewDocumentStatus');
  const visible={Draft:'DRAFT',Accepted:'ACCEPTED',Rejected:'REJECTED',Paid:'PAID','Partially Paid':'PARTIALLY PAID',Cancelled:'CANCELLED'};
  const label=visible[status];
  marker.replaceChildren();
  marker.className='preview-status';
  marker.hidden=!label;
  if(!label)return;
  marker.textContent=label;
  marker.classList.add(`status-${status.toLowerCase().replaceAll(' ','-')}`);
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
  setPreviewCurrency('previewSubtotal',subtotal);
  setPreviewCurrency('previewDiscount',discount);
  setPreviewCurrency('previewTax',tax);
  setPreviewCurrency('previewGrandTotal',total);
  document.getElementById('previewDiscountRow').hidden=discount===0;
  document.getElementById('previewTaxRow').hidden=tax===0;
  reconcileInvoicePaymentStatus(total);
}

function reconcileInvoicePaymentStatus(total=currentEditorTotal()) {
  if (loadingDocument || currentDocumentType!=='INVOICE' || activeStatus==='Cancelled') return;
  if (!['Paid','Partially Paid'].includes(activeStatus)) return;
  const received=Math.max(0,Number(document.getElementById('amountReceived')?.value)||0);
  let next=activeStatus;
  if (received>0) next=total>0 && received>=total-0.01 ? 'Paid' : 'Partially Paid';
  else next='Issued';
  if (next===activeStatus) return;
  activeStatus=next;
  renderStatusOptions('INVOICE',next);
  refreshDocumentActions();
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
  const companyEmail=get('companyEmail').trim(), companyPhone=get('companyPhone').trim(), companyAddress=get('companyAddress').trim(), companyWebsite=get('companyWebsite').trim();
  document.getElementById('previewCompanyEmail').textContent = companyEmail;
  document.getElementById('previewCompanyPhone').textContent = companyPhone;
  document.getElementById('previewCompanyWebsite').textContent = get('companyWebsite');
  document.getElementById('previewCompanyEmailRow').hidden=!companyEmail;
  document.getElementById('previewCompanyPhoneRow').hidden=!companyPhone;
  document.getElementById('previewCompanyWebsite').hidden=!companyWebsite;
  document.getElementById('previewCompanyAddress').textContent = companyAddress;
  document.getElementById('previewCompanyAddress').hidden=!companyAddress;
  const type = get('documentType');
  const config = DOCUMENT_TYPES[type] || DOCUMENT_TYPES.QUOTATION;
  document.getElementById('previewPdfCurrencyCode').textContent=`(${get('currency')})`;
  reconcileInvoicePaymentStatus();
  document.getElementById('previewDocumentType').textContent = config.title.toUpperCase();
  document.getElementById('previewNumberLabel').textContent = config.numberLabel;
  document.getElementById('previewDocumentNumber').textContent = get('documentNumber');
  renderDocumentStatusMarker(activeStatus || get('documentStatus'), type);
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
    if (!value || ['acceptanceTerms','creditReason','recipientConfirmation'].includes(field.id)) return;
    const row = document.createElement('div');
    const label = labels[field.id] || field.label;
    row.innerHTML = `<strong>${escapeHtml(label)}:</strong> `;
    if(field.type==='date') row.appendChild(document.createTextNode(formatDate(value)));
    else if(['amountPaid','amountReceived','creditAmount'].includes(field.id)) row.appendChild(makePreviewCurrency(Number(value)));
    else row.appendChild(document.createTextNode(value));
    metaRows.appendChild(row);
  });
  if(type==='INVOICE' && Number(values.amountReceived)>0 && Number(values.amountReceived)<currentEditorTotal()-0.01) {
    const balanceRow=document.createElement('div');
    const label=document.createElement('strong');label.textContent='Outstanding Balance:';balanceRow.append(label,document.createTextNode(' '),makePreviewCurrency(getInvoiceOutstandingBalance()));
    metaRows.appendChild(balanceRow);
  }

  document.getElementById('previewProjectName').textContent = get('projectName') || '—';
  const scope=get('scopeOfWork').trim();
  const scopeHost=document.getElementById('previewScopeOfWork');
  scopeHost.replaceChildren();
  if(scope){
    const list=document.createElement('ul');
    list.className='scope-list';
    scope.split(/\r?\n/).map(line=>line.trim()).filter(Boolean).forEach(line=>{
      const item=document.createElement('li');
      const text=line.replace(/^(?:[•*-]|\d+[.)])\s*/, '');
      const subsection=text.match(/^([^:]{2,60}):\s*(.*)$/);
      if(subsection){
        const label=document.createElement('strong');label.textContent=subsection[1];item.appendChild(label);
        if(subsection[2]) item.appendChild(document.createTextNode(`: ${subsection[2]}`));
        else item.classList.add('scope-subsection');
      } else item.textContent=text;
      list.appendChild(item);
    });
    scopeHost.appendChild(list);
  } else scopeHost.textContent='—';
  document.getElementById('previewScopeBlock').hidden=!scope;

  document.getElementById('previewClientName').textContent = get('clientName') || '—';
  document.getElementById('previewClientAddress').textContent = get('clientAddress');
  document.getElementById('previewClientPhone').textContent = get('clientPhone');
  document.getElementById('previewClientEmail').textContent = get('clientEmail');

  const paymentDetails=get('paymentDetails').trim(), terms=get('terms').trim();
  document.getElementById('previewPaymentDetails').textContent = paymentDetails;
  document.getElementById('previewTerms').textContent = terms;
  document.getElementById('previewPaymentBlock').hidden=!paymentDetails;
  document.getElementById('previewTermsBlock').hidden=!terms;
  document.getElementById('previewNotes').hidden=!paymentDetails&&!terms;
  document.getElementById('previewNotes').classList.toggle('notes-single',!paymentDetails||!terms);
  const infoTitles = document.querySelectorAll('.document-info .info-title');
  infoTitles[0].textContent = type === 'PURCHASE ORDER' ? 'Supplier' : 'Bill To';
  infoTitles[1].textContent = type === 'PURCHASE ORDER' ? 'Delivery Address' : 'Service / Project';
  if (type === 'PURCHASE ORDER' && values.supplierName) document.getElementById('previewClientName').textContent = values.supplierName;
  if (type === 'PURCHASE ORDER' && values.supplierAddress) document.getElementById('previewClientAddress').textContent = values.supplierAddress;
  if (type === 'PURCHASE ORDER' && values.deliveryAddress) document.getElementById('previewProjectName').textContent = values.deliveryAddress;
  const clientHasData=(type==='PURCHASE ORDER'
    ? [values.supplierName,values.supplierAddress]
    : [get('clientName'),get('clientAddress'),get('clientPhone'),get('clientEmail')]).some(value=>String(value||'').trim());
  const projectHasData=(type==='PURCHASE ORDER'?values.deliveryAddress:get('projectName')).toString().trim().length>0;
  document.getElementById('previewBillToBlock').hidden=!clientHasData;
  document.getElementById('previewProjectBlock').hidden=!projectHasData;
  document.getElementById('previewPrimaryInfo').hidden=!clientHasData&&!projectHasData;
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

  renderDocumentSignature(type);

  const previewBody = document.getElementById('previewItemsBody');
  previewBody.innerHTML = '';
  let previewItemNumber=0;
  document.querySelectorAll('#itemsBody tr').forEach(row => {
    const description = row.querySelector('.description').value;
    const quantity = parseFloat(row.querySelector('.quantity').value) || 0;
    const unit = row.querySelector('.unit').value;
    const price = parseFloat(row.querySelector('.price').value) || 0;
    const amount = quantity * price;
    if (!description.trim() && !amount) return;
    previewItemNumber++;
    const previewRow = document.createElement('tr');
    previewRow.innerHTML = `<td>${previewItemNumber}</td><td>${escapeHtml(description.trim() || 'Item')}</td><td>${quantity}</td><td>${escapeHtml(unit)}</td>`;
    const amountCell=document.createElement('td');amountCell.appendChild(makePreviewCurrency(amount));previewRow.appendChild(amountCell);
    previewBody.appendChild(previewRow);
  });
  document.getElementById('previewItemsTable').hidden=previewItemNumber===0;
  document.getElementById('previewTotals').hidden=previewItemNumber===0;

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
    status: activeStatus || document.getElementById('documentStatus').value || 'Draft',
    deliveryStatus: document.getElementById('deliveryStatus').value || 'Not Sent',
    sourceId: activeSourceId,
    sourceNumber: activeSourceNumber,
    company: {
      id: 'company:default',
      name: document.getElementById('companyName').value,
      email: document.getElementById('companyEmail').value,
      phone: document.getElementById('companyPhone').value,
      website: document.getElementById('companyWebsite').value,
      address: document.getElementById('companyAddress').value,
      logo: companyLogoData,
      signatures: companyProfileData.signatures || [],
      defaultSignatureId: companyProfileData.defaultSignatureId || '',
      autoSignatureTypes: companyProfileData.autoSignatureTypes || []
    },
    document: {
      type: document.getElementById('documentType').value,
      number: document.getElementById('documentNumber').value,
      date: document.getElementById('documentDate').value,
      validUntil: getSpecificValues().validUntil || '',
      currency: document.getElementById('currency').value,
      specific: { ...specificData, ...getSpecificValues() },
      signature: activeDocumentSignature ? { ...activeDocumentSignature } : null
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
      renderDeliveryStatusOptions(saved.deliveryStatus);
      document.getElementById('documentNumber').value = saved.number;
      document.getElementById('previewDocumentNumber').textContent = saved.number;
      document.getElementById('previewDocumentType').textContent = (DOCUMENT_TYPES[saved.type]?.title || saved.type).toUpperCase();
      documentNumbers[saved.type] = saved.number;
      renderStatusOptions(saved.type, saved.status);
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
  activeDocumentSignature = data.document?.signature ? { ...data.document.signature } : getAutoIncludedSignature(currentDocumentType);
  activeStatus = data.status || 'Draft';
  renderDeliveryStatusOptions(data.deliveryStatus || 'Not Sent');
  renderStatusOptions(currentDocumentType, activeStatus);
  specificData = { ...(data.document?.specific || {}) };
  if (!specificData.validUntil && data.document?.validUntil) specificData.validUntil = data.document.validUntil;
  documentNumbers = { [currentDocumentType]: data.document?.number || data.number || '' };
  document.title = 'IMC Technology';
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
  activeDocumentSignature = getAutoIncludedSignature('QUOTATION');
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
  companyProfileData = {
    ...company,
    signatures: Array.isArray(company.signatures) ? company.signatures : [],
    autoSignatureTypes: Array.isArray(company.autoSignatureTypes) ? company.autoSignatureTypes : []
  };
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
  renderSignatureList();
  renderSignatureTypeOptions();
}

async function loadCompanyProfile() {
  const companies=await BusinessDB.getRecords('companies');
  const profile=companies.sort((a,b)=>(b.updatedAt||'').localeCompare(a.updatedAt||''))[0] || {};
  populateCompanyProfile(profile);
  return profile;
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
  const company={...companyProfileData, id:'company:default', name:document.getElementById('profileCompanyName').value.trim(), email:document.getElementById('profileCompanyEmail').value.trim(), phone:document.getElementById('profileCompanyPhone').value.trim(), website:document.getElementById('profileCompanyWebsite').value.trim(), address:document.getElementById('profileCompanyAddress').value.trim(), logo, updatedAt:new Date().toISOString()};
  try {
    await BusinessDB.putRecord('companies',company);
    populateCompanyProfile(company);
    if (currentView === 'editor') updatePreview();
    showToast('Company profile saved.');
  } catch(error) { showToast(`Could not save company profile: ${error.message}`); }
}

function setupSignatureCanvas() {
  const canvas=document.getElementById('signatureCanvas');
  if (!canvas) return;
  const ctx=canvas.getContext('2d');
  ctx.lineWidth=3; ctx.lineCap='round'; ctx.lineJoin='round'; ctx.strokeStyle='#173d2e';
  let drawing=false;
  const point=event=>{ const rect=canvas.getBoundingClientRect(); return { x:(event.clientX-rect.left)*canvas.width/rect.width, y:(event.clientY-rect.top)*canvas.height/rect.height }; };
  canvas.addEventListener('pointerdown',event=>{ drawing=true; canvas.setPointerCapture(event.pointerId); const p=point(event); ctx.beginPath(); ctx.arc(p.x,p.y,1.5,0,Math.PI*2); ctx.fill(); ctx.beginPath(); ctx.moveTo(p.x,p.y); signatureCanvasDirty=true; });
  canvas.addEventListener('pointermove',event=>{ if(!drawing)return; const p=point(event); ctx.lineTo(p.x,p.y); ctx.stroke(); });
  const finish=()=>{ if(drawing){drawing=false;ctx.closePath();} };
  canvas.addEventListener('pointerup',finish); canvas.addEventListener('pointercancel',finish);
}

function setSignatureMethod() {
  const method=document.getElementById('signatureMethod').value;
  document.getElementById('typedSignatureInput').hidden=method!=='typed';
  document.getElementById('drawnSignatureInput').hidden=method!=='drawn';
  document.getElementById('uploadedSignatureInput').hidden=method!=='uploaded';
}

function clearSignatureCanvas() {
  const canvas=document.getElementById('signatureCanvas');
  canvas.getContext('2d').clearRect(0,0,canvas.width,canvas.height);
  signatureCanvasDirty=false;
}

function signatureDataUrlFromCanvas() {
  const canvas=document.getElementById('signatureCanvas');
  if (!signatureCanvasDirty) return '';
  const trimmed=document.createElement('canvas');
  const ctx=trimmed.getContext('2d');
  trimmed.width=canvas.width; trimmed.height=canvas.height;
  ctx.drawImage(canvas,0,0);
  return trimmed.toDataURL('image/png');
}

async function createAuthorizedSignature() {
  const name=document.getElementById('signatureName').value.trim();
  const role=document.getElementById('signatureRole').value.trim();
  const method=document.getElementById('signatureMethod').value;
  if (!name) { showToast('Enter the authorized signer’s name.'); return; }
  let image=''; let text='';
  if (method==='typed') {
    text=document.getElementById('typedSignature').value.trim() || name;
  } else if (method==='drawn') {
    image=signatureDataUrlFromCanvas();
    if (!image) { showToast('Draw the signature before adding it.'); return; }
  } else {
    const file=document.getElementById('signatureImageFile').files?.[0];
    if (!file) { showToast('Choose a signature image to upload.'); return; }
    if (file.size>1024*1024) { showToast('Signature image is too large (max 1 MB).'); return; }
    image=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('Could not read the signature image.'));reader.readAsDataURL(file);}).catch(error=>{showToast(error.message);return '';});
    if (!image) return;
  }
  const sig={id:`signature:${crypto.randomUUID?.() || Date.now()}`,name,role,method,text,image,createdAt:new Date().toISOString()};
  companyProfileData.signatures=[...(companyProfileData.signatures||[]),sig];
  if (!companyProfileData.defaultSignatureId) companyProfileData.defaultSignatureId=sig.id;
  await persistCompanySignatureSettings('Authorized signature added.');
  document.getElementById('signatureName').value=''; document.getElementById('signatureRole').value=''; document.getElementById('typedSignature').value='';
  document.getElementById('signatureImageFile').value=''; clearSignatureCanvas();
}

function renderSignatureList() {
  const host=document.getElementById('authorizedSignatureList');
  if (!host) return;
  host.replaceChildren();
  const signatures=companyProfileData.signatures||[];
  signatures.forEach(signature=>{
    const row=document.createElement('article'); row.className='authorized-signature';
    const details=document.createElement('div'); details.className='authorized-signature-details';
    const title=document.createElement('strong'); title.textContent=signature.name;
    const role=document.createElement('span'); role.textContent=signature.role || 'Authorized signer'; details.append(title,role);
    const visual=document.createElement('div'); visual.className='signature-sample';
    if(signature.image){const img=document.createElement('img');img.src=signature.image;img.alt=`Signature of ${signature.name}`;visual.appendChild(img);}
    else {const typed=document.createElement('span');typed.textContent=signature.text||signature.name;typed.className='typed-signature';visual.appendChild(typed);}
    const actions=document.createElement('div'); actions.className='signature-row-actions';
    const isDefault=companyProfileData.defaultSignatureId===signature.id;
    const label=document.createElement('label'); label.className='signature-default-label';
    const radio=document.createElement('input');radio.type='radio';radio.name='defaultAuthorizedSignature';radio.checked=isDefault;radio.setAttribute('aria-label',`Set ${signature.name} as default authorized signature`);radio.onchange=()=>{companyProfileData.defaultSignatureId=signature.id;persistCompanySignatureSettings('Default authorized signature updated.');};
    label.append(radio,document.createTextNode('Default'));
    const remove=document.createElement('button');remove.type='button';remove.className='table-action';remove.textContent='Remove';remove.onclick=()=>removeAuthorizedSignature(signature.id);
    actions.append(label,remove); row.append(details,visual,actions); host.appendChild(row);
  });
  if (!signatures.length) {const empty=document.createElement('p');empty.className='help-text';empty.textContent='No authorized signatures have been added.';host.appendChild(empty);}
}

async function removeAuthorizedSignature(id) {
  companyProfileData.signatures=(companyProfileData.signatures||[]).filter(signature=>signature.id!==id);
  if(companyProfileData.defaultSignatureId===id) companyProfileData.defaultSignatureId=companyProfileData.signatures[0]?.id || '';
  await persistCompanySignatureSettings('Authorized signature removed.');
}

function renderSignatureTypeOptions() {
  const host=document.getElementById('signatureDocumentTypes');
  if(!host)return;
  host.replaceChildren();
  Object.entries(DOCUMENT_TYPES).forEach(([type,config])=>{
    const label=document.createElement('label'); label.className='signature-type-option';
    const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.value=type;checkbox.checked=(companyProfileData.autoSignatureTypes||[]).includes(type);checkbox.onchange=()=>{
      const enabled=new Set(companyProfileData.autoSignatureTypes||[]); checkbox.checked?enabled.add(type):enabled.delete(type); companyProfileData.autoSignatureTypes=[...enabled];
      persistCompanySignatureSettings('Automatic signature settings saved.');
    };
    label.append(checkbox,document.createTextNode(config.title)); host.appendChild(label);
  });
}

async function persistCompanySignatureSettings(message) {
  companyProfileData={...companyProfileData,id:'company:default',updatedAt:new Date().toISOString()};
  try { await BusinessDB.putRecord('companies',companyProfileData); renderSignatureList();renderSignatureTypeOptions();if(currentView==='editor')updatePreview();if(message)showToast(message); }
  catch(error){showToast(`Could not save signature settings: ${error.message}`);}
}

function getAutoIncludedSignature(type) {
  const enabled=(companyProfileData.autoSignatureTypes||[]).includes(type);
  const signature=(companyProfileData.signatures||[]).find(item=>item.id===companyProfileData.defaultSignatureId);
  return enabled&&signature?{...signature}:null;
}

function renderDocumentSignature(type) {
  const host=document.getElementById('previewAuthorizedSignature');
  if(!host)return;
  host.replaceChildren(); host.hidden=!activeDocumentSignature;
  const approvalTypes=['QUOTATION','ESTIMATE','PURCHASE ORDER','DELIVERY NOTE'];
  const approval=document.getElementById('previewApprovalSection');
  approval.hidden=!approvalTypes.includes(type);
  document.getElementById('previewPreparedBy').textContent=document.getElementById('companyName').value.trim() || 'Authorized representative';
  const recipientRole=type==='PURCHASE ORDER'?'Supplier':type==='DELIVERY NOTE'?'Received By':'Customer';
  document.getElementById('previewCustomerApprovalRole').textContent=recipientRole;
  document.getElementById('previewCustomerSignatureLabel').textContent=type==='DELIVERY NOTE'?'Recipient signature':`${recipientRole} signature`;
  document.getElementById('previewCustomerSigner').textContent=(type==='PURCHASE ORDER'?getSpecificValues(type).supplierName:document.getElementById('clientName').value).trim() || `${recipientRole} name`;
  if(!activeDocumentSignature)return;
  const signature=activeDocumentSignature;
  const visual=document.createElement('div');visual.className='document-signature-visual';
  if(signature.image){const image=document.createElement('img');image.src=signature.image;image.alt=`Signature of ${signature.name}`;visual.appendChild(image);}
  else {const typed=document.createElement('span');typed.className='typed-signature';typed.textContent=signature.text||signature.name;visual.appendChild(typed);}
  const line=document.createElement('div');line.className='document-signature-line';
  const name=document.createElement('strong');name.textContent=signature.name;
  line.appendChild(name);
  if(signature.role){const role=document.createElement('span');role.textContent=signature.role;line.appendChild(role);}
  host.append(visual,line);
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
  if (view === 'editor') setWorkspaceTab('edit');
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
  return value ? new Date(`${value}T00:00:00`).toLocaleDateString('en-NG',{day:'2-digit',month:'short',year:'numeric'}) : '—';
}

function documentActionButton(label, action, doc) {
  const button=document.createElement('button'); button.type='button'; button.className='table-action'; button.textContent=label;
  button.onclick=()=>action(doc); return button;
}

function statusBadge(status, delivery=false) {
  const value=status || (delivery?'Not Sent':'Draft');
  const badge=document.createElement('span');
  badge.className=`status-badge ${delivery?'delivery-badge':'status'}-${String(value).toLowerCase().replaceAll(' ','-')}`;
  badge.textContent=value;
  return badge;
}

async function renderDashboard() {
  try {
    cachedDocuments=await BusinessDB.listDocuments();
    const parties=await BusinessDB.getRecords('parties');
    const customers=new Set(cachedDocuments.map(doc=>doc.client?.name?.trim()).filter(Boolean));
    const summary=[['Documents',cachedDocuments.length,'Across all document types'],['Customers',Math.max(customers.size,parties.filter(row=>row.kind==='customer').length),'From saved records'],['Open invoices',cachedDocuments.filter(doc=>doc.type==='INVOICE'&&!['Paid','Cancelled'].includes(doc.status)).length,'Awaiting payment'],['Purchase orders',cachedDocuments.filter(doc=>doc.type==='PURCHASE ORDER').length,'Supplier orders']];
    const host=document.getElementById('dashboardSummary'); host.replaceChildren();
    summary.forEach(([title,value,caption])=>{const card=document.createElement('article');card.className='summary-card';const name=document.createElement('div');name.className='summary-label';name.textContent=title;const amount=document.createElement('strong');amount.textContent=value;const note=document.createElement('span');note.textContent=caption;card.append(name,amount,note);host.appendChild(card);});
    const recent=document.getElementById('dashboardRecent'); recent.replaceChildren();
    if (!cachedDocuments.length) { const empty=document.createElement('div');empty.className='empty-state';empty.innerHTML='<div class="empty-icon" aria-hidden="true">▤</div><h3>No documents yet</h3><p>Create your first document to see it here.</p>';recent.appendChild(empty);return; }
    const table=makeDocumentTable(cachedDocuments.slice(0,5),false); recent.appendChild(table);
  } catch(error) { showToast(`Could not load dashboard: ${error.message}`); }
}

function makeDocumentTable(docs, includeType = true) {
  const wrap=document.createElement('div');wrap.className='responsive-table-wrap';
  const table=document.createElement('table');table.className='data-table';
  const headers=['Document','Customer',...(includeType?['Type']:[]),'Date','Amount','Document Status','Delivery Status','Actions'];
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
    const status=document.createElement('td');status.dataset.label='Document Status';status.appendChild(statusBadge(doc.status));
    const delivery=document.createElement('td');delivery.dataset.label='Delivery Status';delivery.appendChild(statusBadge(doc.deliveryStatus,true));
    const actions=document.createElement('td');actions.dataset.label='Actions';actions.className='row-table-actions';actions.append(documentActionButton('View',row=>viewDocumentById(row.id),doc),documentActionButton('Edit',row=>openDocumentById(row.id),doc),documentActionButton('Duplicate',duplicateDocument,doc),documentActionButton('Delete',deleteDocumentById,doc));
    row.append(...cells,date,amount,status,delivery,actions);tbody.appendChild(row);
  });
  table.appendChild(tbody);wrap.appendChild(table);return wrap;
}

async function renderDocumentTable() {
  try {
    cachedDocuments=await BusinessDB.listDocuments();
    const filter=document.getElementById('documentTypeFilter');
    if(filter.options.length===1) Object.keys(DOCUMENT_TYPES).forEach(type=>{const option=document.createElement('option');option.value=type;option.textContent=DOCUMENT_TYPES[type].title;filter.appendChild(option);});
    const statusFilter=document.getElementById('documentStatusFilter');
    if(statusFilter.options.length===1) [...new Set(Object.values(DOCUMENT_STATUS_OPTIONS).flat())].forEach(status=>{const option=document.createElement('option');option.value=status;option.textContent=status;statusFilter.appendChild(option);});
    const query=(document.getElementById('documentSearch').value||'').trim().toLowerCase(), type=filter.value, documentStatus=statusFilter.value;
    const docs=cachedDocuments.filter(doc=>(!type||doc.type===type)&&(!documentStatus||doc.status===documentStatus)&&(!query||[doc.number,doc.client?.name,doc.type,DOCUMENT_TYPES[doc.type]?.title,doc.status,doc.deliveryStatus].some(value=>String(value||'').toLowerCase().includes(query))));
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
    const copy=structuredClone(doc);delete copy.id;delete copy.number;delete copy.createdAt;delete copy.updatedAt;copy.document={...copy.document,number:'',signature:null};copy.status='Draft';copy.deliveryStatus='Not Sent';copy.sourceId=null;copy.sourceNumber=null;
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
    converted.document.signature = getAutoIncludedSignature(destination);
    converted.type = destination; converted.sourceId = source.id; converted.sourceNumber = source.number;
    converted.status = destination === 'INVOICE' ? 'Issued' : 'Draft';
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
    if(data?.format!=='business_document_manager'||!Number.isInteger(data.version)||data.version<1||data.version>3||('formatVersion' in data && data.formatVersion!==1)||!data.stores||typeof data.stores!=='object') throw new Error('This file is not a supported business backup.');
    for(const name of ['companies','parties','documents','lineItems','sequences']) {
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
  activeDocumentSignature = getAutoIncludedSignature(type);
  renderDeliveryStatusOptions('Not Sent');
  activeDocumentId = null;
  activeSourceId = null;
  activeSourceNumber = null;
  activeStatus = 'Draft';
  document.getElementById('documentHistory').replaceChildren();
  document.title = 'IMC Technology';
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
