/*
 * window.fintrack.db: the data API every artifact gets (see page_render.py).
 *
 * The frame has an opaque origin and no session, so it never talks to the
 * network for data: each call is posted to the parent with a request id (to
 * '*', since an opaque origin cannot be named), and the parent, which checks
 * that the message came from this frame's window and validates it, calls the
 * API and answers. Changes made anywhere arrive as events and are merged by
 * each record's change number, so a late or repeated event never rolls a
 * record back. Writes show at once and are undone if the parent reports that
 * they failed.
 *
 * Opened on its own, with no parent to answer, it keeps working on this page
 * only (status "local"), so an artifact still runs from its render URL.
 */
(function(){
  if (window.fintrack && window.fintrack.db) return;
  var framed = false;
  try { framed = window.parent && window.parent !== window; } catch (e) { framed = false; }
  var pending = Object.create(null), nextId = 0, status = framed ? 'connecting' : 'local';
  var statusSubs = [], mirrors = Object.create(null), session = null, local = !framed;
  var readyResolve;
  var ready = new Promise(function(res){ readyResolve = res; });

  function clone(v){ return v == null ? v : JSON.parse(JSON.stringify(v)); }
  function localError(){ var e = new Error('offline'); e.local = true; return e; }
  function setStatus(s){
    if (s === status) return;
    status = s;
    statusSubs.slice().forEach(function(cb){ try { cb(s); } catch (e) {} });
  }
  function call(op, args){
    if (local) return Promise.reject(localError());
    return new Promise(function(resolve, reject){
      var id = 'q' + (++nextId) + '_' + Math.random().toString(36).slice(2, 8);
      pending[id] = { resolve: resolve, reject: reject };
      try { parent.postMessage({ type: '__ft_db', id: id, op: op, args: args || {} }, '*'); }
      catch (e) { delete pending[id]; reject(e); }
    });
  }

  // -- Records ---------------------------------------------------------
  function view(r){
    return { id: r.id, data: clone(r.data) || {}, key: r.key, scope: r.scope || 'shared', mine: !!r.mine,
      version: r.version || 0, createdAt: r.created_at || null, updatedAt: r.updated_at || null,
      pending: !!r._pending };
  }
  function mirror(name, scope){
    var k = (scope || 'shared') + ':' + name;
    return mirrors[k] || (mirrors[k] = { name: name, scope: scope || 'shared', recs: Object.create(null),
      gone: Object.create(null), subs: [], loaded: false, loading: null, queued: false });
  }
  // A server record (or tombstone) into a mirror, unless the mirror already
  // holds something newer for that id.
  function merge(m, r){
    if (!r || !r.id) return false;
    var cur = m.recs[r.id], g = m.gone[r.id] || 0, s = r.seq || 0;
    if (r.deleted) {
      if (s && s <= g) return false;
      m.gone[r.id] = Math.max(g, s || 1);
      if (cur) { delete m.recs[r.id]; return true; }
      return false;
    }
    if (s && (s <= g || (cur && !cur._pending && (cur.seq || 0) >= s))) return false;
    m.recs[r.id] = r;
    return true;
  }
  function notify(m){
    if (m.queued) return;
    m.queued = true;
    Promise.resolve().then(function(){
      m.queued = false;
      m.subs.slice().forEach(function(s){
        try { s.cb(s.map(select(m, s.q))); } catch (e) { setTimeout(function(){ throw e; }); }
      });
    });
  }
  function eq(a, b){
    if (a === b) return true;
    if (a && b && typeof a === 'object' && typeof b === 'object') return JSON.stringify(a) === JSON.stringify(b);
    return false;
  }
  function rank(v){ return v == null ? 5 : typeof v === 'string' ? 1 : typeof v === 'number' ? 2 : typeof v === 'boolean' ? 3 : 4; }
  function cmp(a, b){
    var ra = rank(a), rb = rank(b);
    if (ra !== rb) return ra - rb;
    if (ra === 4) { a = JSON.stringify(a); b = JSON.stringify(b); }
    return a < b ? -1 : a > b ? 1 : 0;
  }
  function select(m, q){
    q = q || {};
    var list = Object.keys(m.recs).map(function(k){ return m.recs[k]; });
    if (q.where) list = list.filter(function(r){
      return Object.keys(q.where).every(function(f){ return eq((r.data || {})[f], q.where[f]); });
    });
    var by = q.orderBy, dir = q.desc ? -1 : 1;
    list.sort(function(a, b){
      var c;
      if (!by || by === 'createdAt' || by === 'created_at') c = cmp(a.created_at || '', b.created_at || '');
      else if (by === 'updatedAt' || by === 'updated_at') c = cmp(a.updated_at || '', b.updated_at || '');
      else {
        var x = (a.data || {})[by], y = (b.data || {})[by];
        if (x == null && y != null) return 1;
        if (y == null && x != null) return -1;
        c = cmp(x, y);
      }
      return (c || ((a.seq || 0) - (b.seq || 0))) * dir;
    });
    if (q.limit > 0) list = list.slice(0, q.limit);
    return list.map(view);
  }
  function applyChanges(list){
    var touched = [];
    (list || []).forEach(function(r){
      var m = r && mirrors[(r.scope || 'shared') + ':' + r.collection];
      if (m && merge(m, r) && touched.indexOf(m) < 0) touched.push(m);
    });
    touched.forEach(notify);
  }
  function load(m){
    if (m.loaded) return Promise.resolve();
    if (m.loading) return m.loading;
    m.loading = call('load', { collection: m.name, scope: m.scope }).then(function(res){
      (res.records || []).forEach(function(r){ merge(m, r); });
      m.loaded = true; m.loading = null; notify(m);
    }, function(e){
      m.loading = null;
      if (e && e.local) { m.loaded = true; return; }
      throw e;
    });
    return m.loading;
  }
  function resync(){
    Object.keys(mirrors).forEach(function(k){
      var m = mirrors[k];
      m.loaded = false;
      Object.keys(m.recs).forEach(function(id){ if (!m.recs[id]._pending) delete m.recs[id]; });
      m.gone = Object.create(null);
      if (m.subs.length) load(m).catch(function(){});
    });
  }

  // An optimistic change: applied now, then replaced by what the server
  // says, or undone if the server refuses it.
  function optimistic(m, apply, request, done){
    var undo = apply();
    notify(m);
    return request().then(function(res){
      if (done) done(res);
      notify(m);
      return res;
    }, function(err){
      if (err && err.local) { if (done) done(null); notify(m); return null; }
      if (undo) undo();
      notify(m);
      throw err;
    });
  }
  function tmpId(){ return 'tmp_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function now(){ return new Date().toISOString(); }
  function plain(obj, what){
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new TypeError(what + ' needs a plain object');
    return clone(obj);
  }
  function settle(m, id){
    return function(r){
      if (!r) { if (m.recs[id]) m.recs[id]._pending = false; return; }
      if (m.recs[id] && m.recs[id]._pending) delete m.recs[id];
      merge(m, r);
    };
  }
  function scopeOf(opts){ return opts && opts.scope === 'private' ? 'private' : 'shared'; }
  function byKey(m, key){
    var hit = null;
    Object.keys(m.recs).forEach(function(k){ if (m.recs[k].key === key) hit = m.recs[k]; });
    return hit;
  }

  function collection(name, opts){
    var scope = scopeOf(opts);
    var m = mirror(String(name), scope);
    name = m.name;
    return {
      name: name,
      scope: scope,
      list: function(q){
        q = q || {};
        return call('list', { collection: name, scope: scope, where: q.where, orderBy: q.orderBy, desc: !!q.desc, limit: q.limit })
          .then(function(res){
            (res.records || []).forEach(function(r){ merge(m, r); });
            return (res.records || []).map(view);
          }, function(e){ if (e && e.local) return select(m, q); throw e; });
      },
      get: function(id){
        return call('get', { collection: name, id: String(id) }).then(function(r){ merge(m, r); return view(r); },
          function(e){
            if (e && e.local) return m.recs[id] ? view(m.recs[id]) : null;
            if (e && e.status === 404) return null;
            throw e;
          });
      },
      count: function(where){
        return call('count', { collection: name, scope: scope, where: where }).then(function(r){ return r.count; },
          function(e){ if (e && e.local) return select(m, { where: where }).length; throw e; });
      },
      add: function(obj){
        var data = plain(obj, 'add(obj)'), id = tmpId();
        var temp = { id: id, collection: name, scope: scope, data: data, created_at: now(), updated_at: now(),
          version: 1, mine: true, _pending: true };
        return optimistic(m, function(){ m.recs[id] = temp; return function(){ delete m.recs[id]; }; },
          function(){ return call('add', { collection: name, scope: scope, data: data }); },
          settle(m, id))
          .then(function(r){ return view(r || temp); });
      },
      update: function(id, patch, o){
        var data = plain(patch, 'update(id, patch)'), before = m.recs[id], next = null;
        return optimistic(m, function(){
            if (!before) return null;
            next = Object.assign({}, before, { data: o && o.replace ? clone(data) : Object.assign({}, before.data, data),
              _pending: true, updated_at: now() });
            m.recs[id] = next;
            return function(){ if (m.recs[id] === next) m.recs[id] = before; };
          },
          function(){ return call('update', { collection: name, id: String(id), data: data, version: o && o.version, replace: !!(o && o.replace) }); },
          settle(m, id))
          .then(function(r){ return r ? view(r) : (m.recs[id] ? view(m.recs[id]) : null); });
      },
      remove: function(id){
        var before = m.recs[id];
        return optimistic(m, function(){ delete m.recs[id]; return function(){ if (before && !m.recs[id]) m.recs[id] = before; }; },
          function(){ return call('remove', { collection: name, id: String(id) }); },
          function(r){ if (r) merge(m, r); })
          .then(function(){ return true; });
      },
      increment: function(id, field, by){
        by = by == null ? 1 : by;
        var before = m.recs[id], next = null;
        return optimistic(m, function(){
            if (!before) return null;
            var d = Object.assign({}, before.data);
            d[field] = (typeof d[field] === 'number' ? d[field] : 0) + by;
            next = Object.assign({}, before, { data: d, _pending: true });
            m.recs[id] = next;
            return function(){ if (m.recs[id] === next) m.recs[id] = before; };
          },
          function(){ return call('increment', { collection: name, id: String(id), field: field, by: by }); },
          settle(m, id))
          .then(function(r){ return r ? view(r) : (m.recs[id] ? view(m.recs[id]) : null); });
      },
      upsert: function(key, obj, o){
        key = String(key);
        var data = plain(obj, 'upsert(key, obj)'), before = byKey(m, key);
        var id = before ? before.id : tmpId();
        var next = Object.assign({}, before || { id: id, collection: name, scope: scope, key: key, created_at: now(), version: 0, mine: true },
          { data: (o && o.replace) || !before ? clone(data) : Object.assign({}, before.data, data), _pending: true, updated_at: now() });
        return optimistic(m, function(){
            m.recs[id] = next;
            return function(){ if (before) m.recs[id] = before; else delete m.recs[id]; };
          },
          function(){ return call('upsert', { collection: name, scope: scope, key: key, data: data, replace: !!(o && o.replace), version: o && o.version }); },
          settle(m, id))
          .then(function(r){ return view(r || next); });
      },
      subscribe: function(cb, q){
        if (typeof cb !== 'function') throw new TypeError('subscribe(cb) needs a function');
        var sub = { cb: cb, q: q || null, map: function(x){ return x; } };
        m.subs.push(sub);
        load(m).then(function(){ notify(m); }, function(){ notify(m); });
        return function(){ var i = m.subs.indexOf(sub); if (i >= 0) m.subs.splice(i, 1); };
      }
    };
  }

  function doc(name, opts){
    var scope = scopeOf(opts);
    var m = mirror('_doc', scope);
    name = String(name);
    function write(op, data, extra){
      var before = byKey(m, name), id = before ? before.id : tmpId();
      var next = Object.assign({}, before || { id: id, collection: '_doc', scope: scope, key: name, created_at: now(), version: 0, mine: true },
        { data: data, _pending: true, updated_at: now() });
      return optimistic(m, function(){
          m.recs[id] = next;
          return function(){ if (before) m.recs[id] = before; else delete m.recs[id]; };
        },
        function(){ return call(op, Object.assign({ name: name, scope: scope }, extra)); },
        settle(m, id))
        .then(function(r){ return clone((r || next).data); });
    }
    return {
      get: function(){
        return call('docGet', { name: name, scope: scope }).then(function(res){
          if (res && res.record) { merge(m, res.record); return clone(res.record.data); }
          return null;
        }, function(e){ if (e && e.local) { var c = byKey(m, name); return c ? clone(c.data) : null; } throw e; });
      },
      set: function(obj){ var d = plain(obj, 'set(obj)'); return write('docSet', d, { data: d }); },
      update: function(patch){
        var d = plain(patch, 'update(patch)'), cur = byKey(m, name);
        return write('docSet', Object.assign({}, cur ? cur.data : {}, d), { data: d, merge: true });
      },
      increment: function(field, by){
        by = by == null ? 1 : by;
        var cur = byKey(m, name), d = Object.assign({}, cur ? cur.data : {});
        d[field] = (typeof d[field] === 'number' ? d[field] : 0) + by;
        return write('docIncrement', d, { field: field, by: by });
      },
      subscribe: function(cb){
        if (typeof cb !== 'function') throw new TypeError('subscribe(cb) needs a function');
        var sub = { cb: cb, q: null, map: function(){ var c = byKey(m, name); return c ? clone(c.data) : null; } };
        m.subs.push(sub);
        load(m).then(function(){ notify(m); }, function(){ notify(m); });
        return function(){ var i = m.subs.indexOf(sub); if (i >= 0) m.subs.splice(i, 1); };
      }
    };
  }

  function fileView(r){ return Object.assign({ id: r.id, mine: !!r.mine }, r.data || {}); }
  var files = {
    upload: function(file, opts){
      if (!file || typeof file !== 'object' || typeof file.size !== 'number') {
        return Promise.reject(new TypeError('upload(file) needs a File or Blob'));
      }
      var scope = scopeOf(opts), m = mirror('_files', scope);
      return call('filesUpload', { file: file, name: String(file.name || 'file'), scope: scope }).then(function(r){
        merge(m, r); notify(m);
        return fileView(r);
      });
    },
    list: function(opts){
      return call('filesList', { scope: scopeOf(opts) }).then(function(res){ return (res.records || []).map(fileView); });
    },
    remove: function(id){
      return call('filesRemove', { id: String(id) }).then(function(r){ applyChanges([r]); return true; });
    },
    subscribe: function(cb, opts){
      if (typeof cb !== 'function') throw new TypeError('subscribe(cb) needs a function');
      var m = mirror('_files', scopeOf(opts));
      var sub = { cb: cb, q: null, map: function(list){ return list.map(function(v){ return Object.assign({ id: v.id, mine: v.mine }, v.data); }); } };
      m.subs.push(sub);
      load(m).then(function(){ notify(m); }, function(){ notify(m); });
      return function(){ var i = m.subs.indexOf(sub); if (i >= 0) m.subs.splice(i, 1); };
    }
  };

  var db = {
    collection: collection,
    doc: doc,
    files: files,
    ready: ready,
    me: function(){
      return ready.then(function(){
        return clone(session && session.me) || { id: 'local', isOwner: false, canAdd: true, canEditOthers: true, signedIn: false };
      });
    },
    get status(){ return status; },
    onStatus: function(cb){
      if (typeof cb !== 'function') return function(){};
      statusSubs.push(cb);
      try { cb(status); } catch (e) {}
      return function(){ var i = statusSubs.indexOf(cb); if (i >= 0) statusSubs.splice(i, 1); };
    }
  };
  window.fintrack = Object.assign(window.fintrack || {}, { db: db });

  function goLocal(){
    if (local) return;
    local = true;
    Object.keys(pending).forEach(function(id){ var p = pending[id]; delete pending[id]; p.reject(localError()); });
    Object.keys(mirrors).forEach(function(k){ mirrors[k].loaded = true; mirrors[k].loading = null; notify(mirrors[k]); });
    setStatus('local');
    readyResolve(db);
  }

  window.addEventListener('message', function(e){
    if (!framed || e.source !== window.parent) return;
    var d = e.data;
    if (!d || typeof d !== 'object') return;
    if (d.type === '__ft_db_result') {
      var p = pending[d.id];
      if (!p) return;
      delete pending[d.id];
      if (d.ok) p.resolve(d.value);
      else {
        var err = new Error((d.error && d.error.message) || 'The request failed');
        err.status = d.error && d.error.status;
        p.reject(err);
      }
    } else if (d.type === '__ft_db_event') {
      if (d.kind === 'changes' && Array.isArray(d.changes)) applyChanges(d.changes);
      else if (d.kind === 'status' && typeof d.status === 'string') setStatus(d.status);
      else if (d.kind === 'reset') resync();
    }
  });

  if (!framed) { readyResolve(db); return; }

  // Whether someone is part-way through typing, so the app can hold back an
  // automatic reload (after a republish) until they are done. Only a yes/no
  // leaves the frame, never what was typed.
  var editing = false;
  function reportEditing(){
    var a = document.activeElement, now = false;
    if (a && a.isContentEditable) now = true;
    else if (a && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && !/^(checkbox|radio|button|submit|reset|range|color|file)$/i.test(a.type || '')))) now = !!a.value;
    if (now === editing) return;
    editing = now;
    try { parent.postMessage({ type: '__ft_editing', editing: now }, '*'); } catch (e) {}
  }
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('input', reportEditing, true);
    document.addEventListener('focusin', reportEditing, true);
    document.addEventListener('focusout', function(){ setTimeout(reportEditing, 0); }, true);
  }
  // No answer at all means no app around this frame: run on this page only.
  var helloTimer = setTimeout(goLocal, 6000);
  call('hello', {}).then(function(s){
    clearTimeout(helloTimer);
    session = s || {};
    setStatus(session.status || 'synced');
    readyResolve(db);
  }, function(e){
    clearTimeout(helloTimer);
    if (e && e.local) return;
    setStatus('offline');
    readyResolve(db);
  });
})();
