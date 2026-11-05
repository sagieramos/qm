/* IndexedDB persistence layer. All records stay on this device. */
const BusinessDB = (() => {
  const DB_NAME = 'business_document_manager';
  const DB_VERSION = 3;
  const STORES = ['companies', 'parties', 'documents', 'lineItems', 'sequences'];
  let databasePromise;

  function open() {
    if (databasePromise) return databasePromise;
    databasePromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) return reject(new Error('This browser does not support IndexedDB.'));
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('companies')) db.createObjectStore('companies', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('parties')) db.createObjectStore('parties', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('documents')) {
          const store = db.createObjectStore('documents', { keyPath: 'id' });
          store.createIndex('number', 'number', { unique: true });
          store.createIndex('type', 'type', { unique: false });
          store.createIndex('sourceId', 'sourceId', { unique: false });
          store.createIndex('createdAt', 'createdAt', { unique: false });
        }
        if (!db.objectStoreNames.contains('lineItems')) db.createObjectStore('lineItems', { keyPath: 'id' });
        const lineItems = request.transaction.objectStore('lineItems');
        if (!lineItems.indexNames.contains('documentId')) lineItems.createIndex('documentId', 'documentId', { unique:false });
        if (!db.objectStoreNames.contains('sequences')) db.createObjectStore('sequences', { keyPath: 'id' });
      };
      request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
      request.onerror = () => reject(request.error || new Error('Could not open local database.'));
      request.onblocked = () => reject(new Error('Database upgrade is blocked by another open tab.'));
    });
    return databasePromise;
  }

  const prefix = { QUOTATION:'QUO', ESTIMATE:'EST', INVOICE:'INV', 'PROFORMA INVOICE':'PRO', RECEIPT:'REC', 'PURCHASE ORDER':'PO', 'CREDIT NOTE':'CN', 'DELIVERY NOTE':'DN' };
  function localStamp(date = new Date()) {
    const pad = n => String(n).padStart(2, '0');
    return `${date.getFullYear()}${pad(date.getMonth()+1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  }
  function makeId() { return crypto.randomUUID ? crypto.randomUUID() : `doc-${Date.now()}-${Math.random().toString(16).slice(2)}`; }
  function requestResult(request) { return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); }

  async function createDocument(data, options = {}) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['documents','lineItems','sequences','companies','parties'], 'readwrite');
      const docs = tx.objectStore('documents'), items = tx.objectStore('lineItems'), sequences = tx.objectStore('sequences');
      const type = data.document.type;
      const stamp = localStamp();
      const seqId = `${type}:${stamp.slice(0, 8)}`;
      const getSeq = sequences.get(seqId);
      let saved;
      let allDocs = null, seqReady = false, validationError = null, created = false;
      const validateAndCreate = () => {
        if (!seqReady || ((options.creditValidation || options.uniqueSourceType || options.uniquePayment) && !allDocs) || created) return;
        created = true;
        if (options.uniqueSourceType && allDocs.some(doc => doc.sourceId === options.uniqueSourceType.sourceId && doc.type === options.uniqueSourceType.type)) {
          validationError = new Error('This conversion already exists.'); tx.abort(); return;
        }
        if (options.uniquePayment && allDocs.some(doc => doc.sourceId === options.uniquePayment.sourceId && doc.type === 'RECEIPT' && doc.document?.specific?.transactionReference === options.uniquePayment.reference)) {
          validationError = new Error('A receipt with this transaction reference already exists for the invoice.'); tx.abort(); return;
        }
        if (options.creditValidation) {
          const source = allDocs.find(doc => doc.id === options.creditValidation.sourceId);
          const sourceSubtotal = (source?.items || []).reduce((sum,item) => sum + (Number(item.quantity)||0) * (Number(item.price)||0), 0);
          const sourceTotal = Math.max(0, sourceSubtotal - (Number(source?.discount)||0) + (Number(source?.tax)||0));
          const already = allDocs.filter(doc => doc.type === 'CREDIT NOTE' && doc.sourceId === options.creditValidation.sourceId).reduce((sum,doc) => sum + (Number(doc.document?.specific?.creditAmount) || 0), 0);
          if (!source || options.creditValidation.amount > sourceTotal - already + 0.000001) {
            validationError = new Error('Credit amount exceeds the remaining eligible invoice balance.'); tx.abort(); return;
          }
        }
        const sequence = (Number(getSeq.result?.value) || 0) + 1;
        const number = options.preserveNumber && data.document?.number ? data.document.number : `${prefix[type] || 'DOC'}-${stamp}-${String(sequence).padStart(4,'0')}`;
        if (!options.preserveNumber || !data.document?.number) sequences.put({ id: seqId, value: sequence });
        const id = makeId();
        saved = { ...data, id, number, type, document: { ...data.document, type, number }, status: data.status || 'Draft', deliveryStatus: data.deliveryStatus || 'Not Sent', sourceId: data.sourceId || null, sourceNumber: data.sourceNumber || null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
        saved.items = [];
        (data.items || []).forEach((item, index) => {
          const line = { ...item, id: `${id}:line:${index+1}`, documentId: id, position: index };
          items.put(line); saved.items.push(line);
        });
        docs.add(saved);
        saveRelated(tx, saved);
        if (options.sourceUpdate) {
          docs.put({ ...options.sourceUpdate, updatedAt:new Date().toISOString() });
          saveRelated(tx, options.sourceUpdate);
        }
      };
      getSeq.onsuccess = () => { seqReady = true; validateAndCreate(); };
      if (options.creditValidation || options.uniqueSourceType || options.uniquePayment) {
        const all = docs.getAll(); all.onsuccess = () => { allDocs = all.result; validateAndCreate(); };
      }
      tx.oncomplete = () => resolve(saved);
      tx.onerror = () => reject(tx.error || new Error('Could not save document.'));
      tx.onabort = () => reject(validationError || tx.error || new Error('Document transaction was cancelled.'));
    });
  }

  function saveRelated(tx, doc) {
    if (doc.company) {
      const id = doc.company.id || `company:${doc.company.name || 'default'}`;
      tx.objectStore('companies').put({ ...doc.company, id, updatedAt: new Date().toISOString() });
    }
    if (doc.client?.name) {
      const id = `customer:${doc.client.name.toLowerCase()}`;
      tx.objectStore('parties').put({ ...doc.client, id, kind: 'customer', updatedAt: new Date().toISOString() });
    }
    if (doc.document?.specific?.supplierName) {
      const name = doc.document.specific.supplierName;
      const id = `supplier:${name.toLowerCase()}`;
      tx.objectStore('parties').put({ id, kind:'supplier', name, address:doc.document.specific.supplierAddress || '' });
    }
  }

  async function updateDocument(data) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['documents','lineItems','companies','parties'], 'readwrite');
      const docs = tx.objectStore('documents'), items = tx.objectStore('lineItems');
      const get = docs.get(data.id);
      let saved;
      get.onsuccess = () => {
        const old = get.result;
        if (!old) { tx.abort(); return; }
        const stableType = old.type;
        saved = { ...old, ...data, type: stableType, number: old.number, document: { ...data.document, type: stableType, number: old.number }, createdAt: old.createdAt, updatedAt: new Date().toISOString() };
        saved.items = [];
        const cursor = items.openCursor();
        cursor.onsuccess = () => {
          const c = cursor.result;
          if (c) { if (c.value.documentId === data.id) c.delete(); c.continue(); return; }
          (data.items || []).forEach((item, index) => { const line = { ...item, id: `${data.id}:line:${index+1}`, documentId: data.id, position:index }; items.put(line); saved.items.push(line); });
          docs.put(saved); saveRelated(tx, saved);
        };
      };
      tx.oncomplete = () => resolve(saved);
      tx.onerror = () => reject(tx.error || new Error('Could not update document.'));
      tx.onabort = () => reject(tx.error || new Error('Document was not found or update was cancelled.'));
    });
  }

  async function getDocument(id) { const db = await open(); return requestResult(db.transaction('documents').objectStore('documents').get(id)); }
  async function listDocuments() { const db = await open(); const rows = await requestResult(db.transaction('documents').objectStore('documents').getAll()); return rows.sort((a,b) => (b.updatedAt || '').localeCompare(a.updatedAt || '')); }
  async function getRecords(storeName) {
    if (!STORES.includes(storeName)) throw new Error('Unknown database store.');
    const db=await open(); return requestResult(db.transaction(storeName).objectStore(storeName).getAll());
  }
  async function getRecord(storeName,id) {
    if (!STORES.includes(storeName)) throw new Error('Unknown database store.');
    const db=await open(); return requestResult(db.transaction(storeName).objectStore(storeName).get(id));
  }
  async function putRecord(storeName,record) {
    if (!STORES.includes(storeName) || !record?.id) throw new Error('A valid store and record ID are required.');
    const db=await open(); return requestResult(db.transaction(storeName,'readwrite').objectStore(storeName).put(record));
  }
  async function deleteRecord(storeName,id) {
    if (!STORES.includes(storeName)) throw new Error('Unknown database store.');
    const db=await open(); return requestResult(db.transaction(storeName,'readwrite').objectStore(storeName).delete(id));
  }
  async function removeDocument(id) {
    const db = await open();
    return new Promise((resolve,reject) => {
      const tx = db.transaction(['documents','lineItems'], 'readwrite');
      tx.objectStore('documents').delete(id);
      const store = tx.objectStore('lineItems');
      const cursor = store.openCursor(); cursor.onsuccess = () => { const c=cursor.result; if (c) { if(c.value.documentId===id)c.delete(); c.continue(); } };
      tx.oncomplete=resolve; tx.onerror=()=>reject(tx.error);
    });
  }
  async function allData() {
    const db = await open(); const result = {};
    for (const name of STORES) result[name] = await requestResult(db.transaction(name).objectStore(name).getAll());
    return { format:'business_document_manager', formatVersion:1, version:DB_VERSION, exportedAt:new Date().toISOString(), stores:result };
  }
  async function importData(backup) {
    if (!backup || backup.format !== 'business_document_manager' || !Number.isInteger(backup.version) || backup.version < 1 || backup.version > DB_VERSION || ('formatVersion' in backup && backup.formatVersion !== 1) || !backup.stores || typeof backup.stores !== 'object') throw new Error('This file is not a supported business document backup.');
    for (const name of STORES) {
      if (!Array.isArray(backup.stores[name])) throw new Error(`Backup data for ${name} is missing or invalid.`);
      const ids=new Set();
      for (const row of backup.stores[name]) {
        if (!row || typeof row !== 'object' || !row.id || ids.has(row.id)) throw new Error(`Backup contains an invalid or duplicate record in ${name}.`);
        ids.add(row.id);
      }
    }
    const db = await open();
    return new Promise((resolve,reject) => {
      const tx = db.transaction(STORES, 'readwrite');
      const existing = {};
      let pending = STORES.length, inserted = 0, skipped = 0, settled = false;
      const abort = error => { if (settled) return; settled=true; try { tx.abort(); } catch {} reject(error); };
      tx.onerror=()=>{ if (!settled) { settled=true; reject(tx.error || new Error('Backup merge failed; no records were imported.')); } };
      tx.onabort=()=>{ if (!settled) { settled=true; reject(tx.error || new Error('Backup merge failed; no records were imported.')); } };
      tx.oncomplete=()=>{ if (!settled) { settled=true; migrateStatuses().then(()=>resolve({ inserted, skipped }),reject); } };
      for (const name of STORES) {
        const request=tx.objectStore(name).getAllKeys();
        request.onsuccess=()=>{
          existing[name]=new Set(request.result);
          if (--pending !== 0 || settled) return;
          try {
            for (const storeName of STORES) {
              const store=tx.objectStore(storeName);
              for (const row of backup.stores[storeName]) {
                if (existing[storeName].has(row.id)) { skipped++; continue; }
                store.add(row); inserted++;
              }
            }
          } catch (error) { abort(new Error(`Backup merge failed; no records were imported. ${error.message}`)); }
        };
        request.onerror=()=>abort(request.error || new Error('Could not check for duplicate backup records.'));
      }
    });
  }
  async function migrateStatuses() {
    const db=await open();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction('documents','readwrite');
      const store=tx.objectStore('documents');
      const request=store.getAll();
      request.onsuccess=()=>{
        const valid=new Set(['Draft','Issued','Accepted','Rejected','Paid','Partially Paid','Overdue','Cancelled']);
        const validDelivery=new Set(['Not Sent','Sent','Delivered','Viewed']);
        request.result.forEach(doc=>{
          const previous=doc.status || 'Draft';
          let mapped={ Sent:'Issued', Unpaid:'Issued', Final:'Issued', Expired:'Issued' }[previous] || previous;
          if (doc.type==='INVOICE' && !['Cancelled','Overdue'].includes(mapped)) {
            const subtotal=(doc.items||[]).reduce((sum,item)=>sum+(Number(item.quantity)||0)*(Number(item.price)||0),0);
            const total=Math.max(0,subtotal-Math.max(0,Number(doc.discount)||0)+Math.max(0,Number(doc.tax)||0));
            const received=Math.max(0,Number(doc.document?.specific?.amountReceived)||0);
            if (total>0 && received>=total-0.01) mapped='Paid';
            else if (received>0) mapped='Partially Paid';
            else if (['Paid','Partially Paid'].includes(mapped)) mapped='Issued';
          }
          const deliveryStatus=validDelivery.has(doc.deliveryStatus)?doc.deliveryStatus:(previous==='Sent'?'Sent':'Not Sent');
          if (!valid.has(mapped) || !validDelivery.has(doc.deliveryStatus) || mapped!==previous) {
            const updated={...doc,status:valid.has(mapped)?mapped:'Draft',deliveryStatus};
            if (!valid.has(mapped) || previous==='Expired') updated.legacyStatus=previous;
            store.put(updated);
          }
        });
      };
      tx.oncomplete=resolve;
      tx.onerror=()=>reject(tx.error || new Error('Could not migrate document statuses.'));
      tx.onabort=()=>reject(tx.error || new Error('Document status migration was cancelled.'));
    });
  }
  async function migrateLegacy() {
    const marker = 'business_document_manager_migration_v1';
    let raw;
    try {
      if (localStorage.getItem(marker) === 'verified') return false;
      raw = localStorage.getItem('dlaw_current_document');
    } catch { return false; }
    if (!raw) { try { localStorage.setItem(marker, 'verified'); } catch {} return false; }
    let legacy;
    try { legacy = JSON.parse(raw); } catch { return false; }
    const docs = await listDocuments();
    let migrated = docs.find(doc => doc.number === legacy.document?.number);
    if (!migrated) migrated = await createDocument({ ...legacy, status:'Draft' }, { preserveNumber:true });
    const verify = await listDocuments();
    const verified = verify.find(doc => doc.id === migrated.id);
    if (!verified || (legacy.document?.number && verified.number !== legacy.document.number) || verified.company?.name !== legacy.company?.name || verified.document?.type !== legacy.document?.type || verified.items?.length !== (legacy.items || []).length) throw new Error('Legacy document migration verification failed; original local data was kept.');
    try { localStorage.setItem(marker, 'verified'); } catch {}
    return true;
  }
  return { open, createDocument, updateDocument, getDocument, listDocuments, removeDocument, getRecords, getRecord, putRecord, deleteRecord, allData, importData, migrateLegacy, migrateStatuses };
})();
window.BusinessDB = BusinessDB;
