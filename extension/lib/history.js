/**
 * A record of what each import created or replaced, so it can be undone.
 * Undo removes only questions this extension created (by Canvas id) and puts replaced questions
 * back as they were. It never touches anything else, and it keeps uploaded figures.
 *
 * `store` has the shape of chrome.storage.local ({ get(key), set(obj) }) so this can be tested.
 */
(function (root) {
  const KEY = 'history';
  const KEEP = 30;

  function createHistory(store) {
    let queue = Promise.resolve(); // writes happen one at a time, in order
    let failed = false;            // record-keeping must never break an import: note the failure and carry on
    const read = async () => ((await store.get(KEY))[KEY] || { entries: [] });
    const change = (fn) => {
      queue = queue.then(async () => { const h = await read(); fn(h); h.entries = h.entries.slice(-KEEP); await store.set({ [KEY]: h }); }).catch(() => { failed = true; });
      return queue;
    };

    return {
      /** Begin recording an import into `target` ({ kind, courseId, quizId | bankId, bankTitle, bankCreated }). */
      start(target) {
        const id = 'imp-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        change((h) => h.entries.push({ id, at: new Date().toISOString(), target, created: [], updated: [], undone: false }));
        return id;
      },
      addCreated: (id, name, qid) => change((h) => { const e = h.entries.find((x) => x.id === id); if (e) e.created.push({ id: qid, name }); }),
      addUpdated: (id, name, qid, before) => change((h) => { const e = h.entries.find((x) => x.id === id); if (e) e.updated.push({ id: qid, name, before }); }),
      /** Drop an entry that ended up changing nothing. */
      discardIfEmpty: (id) => change((h) => { h.entries = h.entries.filter((x) => x.id !== id || x.created.length || x.updated.length || (x.target.bankCreated)); }),
      done: () => queue,
      /** True if some part of the record could not be saved (so undo may be incomplete). */
      get failed() { return failed; },
      /** Imports in this course that can still be undone, newest first. */
      async list(courseId) {
        await queue;
        return (await read()).entries.filter((e) => !e.undone && String(e.target.courseId) === String(courseId) && (e.created.length || e.updated.length || e.target.bankCreated)).reverse();
      },
      markUndone: (id) => change((h) => { const e = h.entries.find((x) => x.id === id); if (e) e.undone = true; }),

      /**
       * Undo one import. deps = { quizTarget, bankTarget, deleteBank } from gs2canvas.
       * Returns { deleted, restored, gone, failed: [name], bankDeleted }.
       */
      async undo(entry, deps, onProgress) {
        const t = entry.target;
        const target = t.kind === 'bank' ? deps.bankTarget(t.courseId, { id: t.bankId, title: t.bankTitle }) : deps.quizTarget({ courseId: t.courseId, quizId: t.quizId });
        const res = { deleted: 0, restored: 0, gone: 0, failed: [], bankDeleted: false };
        const present = new Set((await target.list()).map((q) => String(q.id)));
        const total = entry.created.length + entry.updated.length; let n = 0;
        for (const c of entry.created) {
          if (onProgress) onProgress('Removing ' + c.name, n++ / total);
          if (!present.has(String(c.id))) { res.gone++; continue; }
          try { await target.remove(c.id); res.deleted++; } catch (e) { res.failed.push(c.name); res.lastError = e; }
        }
        for (const u of entry.updated) {
          if (onProgress) onProgress('Restoring ' + u.name, n++ / total);
          if (!present.has(String(u.id))) { res.gone++; continue; }
          if (!u.before) { res.failed.push(u.name); continue; }
          try { await target.update(u.id, u.before); res.restored++; } catch (e) { res.failed.push(u.name); res.lastError = e; }
        }
        if (t.kind === 'bank' && t.bankCreated && !res.failed.length) {
          // The bank only existed because of this import: remove it too once it is empty.
          if (!(await target.list()).length) { await deps.deleteBank(t.courseId, t.bankId); res.bankDeleted = true; }
        }
        if (!res.failed.length) await this.markUndone(entry.id);
        return res;
      },
    };
  }

  root.gs2canvasHistory = { createHistory };
})(typeof window !== 'undefined' ? window : globalThis);
