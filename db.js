/* IndexedDB persistence layer. All records stay on this device. */
const BusinessDB = (() => {
  const DB_NAME = 'business_document_manager';
  const DB_VERSION = 2;
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
        saved = { ...data, id, number, type, document: { ...data.document, type, number }, status: data.status || 'Draft', sourceId: data.sourceId || null, sourceNumber: data.sourceNumber || null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
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
    return { format:'business_document_manager', version:DB_VERSION, exportedAt:new Date().toISOString(), stores:result };
  }
  async function importData(backup) {
    if (!backup?.stores || backup.format !== 'business_document_manager') throw new Error('This file is not a valid business document backup.');
    const db = await open();
    return new Promise((resolve,reject) => {
      const tx = db.transaction(STORES, 'readwrite');
      for (const name of STORES) for (const row of backup.stores[name] || []) tx.objectStore(name).put(row);
      tx.oncomplete=resolve; tx.onerror=()=>reject(tx.error || new Error('Backup restore failed.'));
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
  return { open, createDocument, updateDocument, getDocument, listDocuments, removeDocument, getRecords, getRecord, putRecord, deleteRecord, allData, importData, migrateLegacy };
})();
window.BusinessDB = BusinessDB;
