(function () {
  'use strict';
  let database;
  const openDatabase = () => new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      return reject(Error('此瀏覽器不支援草稿儲存。'));
    }
    const req = indexedDB.open('inktrace-web', 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('papers', { keyPath: 'id' });
      req.result.createObjectStore('meta');
    };
    req.onerror = () => reject(Error('無法開啟草稿儲存，請檢查瀏覽器權限。'));
    req.onblocked = () => reject(Error('請關閉其他 InkTrace 分頁後重試。'));
    req.onsuccess = () => {
      database = req.result;
      database.onversionchange = () => database.close();
      resolve();
    };
  });
  const runPaperTransaction = (mode, action) => new Promise((resolve, reject) => {
    const tx = database.transaction('papers', mode);
    let result;
    const req = action(tx.objectStore('papers'));
    req.onsuccess = () => {
      result = req.result;
    };
    tx.oncomplete = () => resolve(result);
    tx.onerror = tx.onabort = () => reject(Error('草稿儲存失敗，請先下載 SVG。'));
  });

  async function init() {
    await openDatabase();
    await new Promise((resolve, reject) => {
      const tx = database.transaction(['papers', 'meta'], 'readwrite');
      const req = tx.objectStore('meta').get('initialized');
      req.onsuccess = () => {
        if (!req.result) {
          tx.objectStore('papers').put(InkTrace.paper('基礎練習', '天地玄黃宇宙洪荒'));
          tx.objectStore('meta').put(true, 'initialized');
        }
      };
      tx.oncomplete = resolve;
      tx.onerror = tx.onabort = () => reject(Error('無法初始化稿紙。'));
    });
  }
  window.PaperStore = {
    init,
    all: () => runPaperTransaction('readonly', s => s.getAll()),
    put: p => runPaperTransaction('readwrite', s => s.put(structuredClone(p))),
    remove: id => runPaperTransaction('readwrite', s => s.delete(id))
  };
})();
