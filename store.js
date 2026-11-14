(function () {
  'use strict';

  let database;

  function openDatabase() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        reject(Error('此瀏覽器不支援草稿儲存。'));
        return;
      }

      const request = indexedDB.open('inktrace-web', 2);
      request.onupgradeneeded = event => {
        const upgradedDatabase = request.result;
        if (event.oldVersion === 0) {
          upgradedDatabase.createObjectStore('papers', { keyPath: 'id' });
          upgradedDatabase.createObjectStore('meta');
        }

        const drafts = upgradedDatabase.createObjectStore('drafts', {
          keyPath: ['paperId', 'characterIndex'],
        });
        if (event.oldVersion === 1) {
          const papers = request.transaction.objectStore('papers');
          const cursorRequest = papers.openCursor();
          cursorRequest.onsuccess = () => {
            const cursor = cursorRequest.result;
            if (!cursor) {
              return;
            }
            const { drafts: previousDrafts = {}, ...paper } = cursor.value;
            for (const [index, draft] of Object.entries(previousDrafts)) {
              drafts.put({ paperId: paper.id, characterIndex: Number(index), draft });
            }
            cursor.update(paper);
            cursor.continue();
          };
        }
      };

      request.onerror = () => reject(Error('無法開啟草稿儲存，請檢查瀏覽器權限。'));
      request.onblocked = () => reject(Error('請關閉其他 InkTrace 分頁後重試。'));
      request.onsuccess = () => {
        database = request.result;
        database.onversionchange = () => database.close();
        resolve();
      };
    });
  }

  function runTransaction(storeNames, mode, action) {
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(storeNames, mode);
      const readResult = action(transaction);
      transaction.oncomplete = () => resolve(readResult?.());
      transaction.onerror = transaction.onabort = () => {
        reject(Error('草稿儲存失敗，請先下載 SVG。'));
      };
    });
  }

  async function init() {
    await openDatabase();
    await runTransaction(['papers', 'meta'], 'readwrite', transaction => {
      const meta = transaction.objectStore('meta');
      const request = meta.get('initialized');
      request.onsuccess = () => {
        if (!request.result) {
          putPaperRecord(transaction, InkTrace.paper('基礎練習', '天地玄黃宇宙洪荒'));
          meta.put(true, 'initialized');
        }
      };
    });
  }

  function putPaperRecord(transaction, paper) {
    const { drafts, ...metadata } = paper;
    transaction.objectStore('papers').put(metadata);
  }

  function all() {
    return runTransaction(['papers', 'drafts'], 'readonly', transaction => {
      const papers = transaction.objectStore('papers').getAll();
      const drafts = transaction.objectStore('drafts').getAll();
      return () => {
        const savedPapers = papers.result;
        const byId = new Map(savedPapers.map(paper => {
          paper.drafts = {};
          return [paper.id, paper];
        }));
        for (const { paperId, characterIndex, draft } of drafts.result) {
          const paper = byId.get(paperId);
          if (paper) {
            paper.drafts[characterIndex] = draft;
          }
        }
        return savedPapers;
      };
    });
  }

  window.PaperStore = {
    init,
    all,
    put: paper => runTransaction('papers', 'readwrite', transaction => {
      putPaperRecord(transaction, paper);
    }),
    putDraft: (paperId, characterIndex, draft) => {
      return runTransaction('drafts', 'readwrite', transaction => {
        transaction.objectStore('drafts').put({ paperId, characterIndex, draft });
      });
    },
    remove: paperId => runTransaction(['papers', 'drafts'], 'readwrite', transaction => {
      transaction.objectStore('papers').delete(paperId);
      const range = IDBKeyRange.bound([paperId, 0], [paperId, Number.MAX_SAFE_INTEGER]);
      transaction.objectStore('drafts').delete(range);
    }),
  };
})();
