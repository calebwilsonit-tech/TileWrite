/**
 * What runs inside the sandbox of a plugin's editor part: a Web Worker with no page, no network and no access to the editor.
 * It gets a tiny stand-in for the page (a few kinds of elements, text, attributes, a style and click/input events) whose every
 * change is sent to the editor, which draws it for real; and a handful of calls back to the editor (notify, read a file...) that
 * the editor only answers when the plugin has been given the permission.
 *
 * It is written as text because it is the program of the worker: the editor puts the plugin's own code after it.
 * (`npm test` runs this same text, so what the tests check is what the sandbox runs.)
 */
export const WORKER_BOOTSTRAP = String.raw`
'use strict';
(function () {
  var post = function (m) { self.postMessage(m); };
  // nothing in here can reach the network or the page
  var blocked = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts', 'indexedDB', 'caches', 'Worker', 'SharedWorker'];
  blocked.forEach(function (n) { try { Object.defineProperty(self, n, { value: undefined, configurable: false, writable: false }); } catch (e) { /* not there */ } });

  var nextNode = 1, nextCall = 1;
  var panels = {}, tools = {}, importers = {}, exporters = {};
  var mounts = {};   // mountId -> { cleanup }
  var calls = {};    // call id -> { resolve, reject }
  var listeners = {}; // node id -> type -> [fn]

  function send(op) { post({ t: 'dom', op: op }); }

  function Style(node) {
    var self_ = this;
    Object.defineProperty(this, '__node', { value: node });
    return new Proxy(this, {
      set: function (_t, key, value) { send(['style', node.__id, String(key), String(value)]); return true; },
      get: function (_t, key) { return key === 'setProperty' ? function (k, v) { send(['style', node.__id, String(k), String(v)]); } : ''; }
    });
  }

  function RNode(tag, id) {
    Object.defineProperty(this, '__id', { value: id === undefined ? nextNode++ : id });
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.style = new Style(this);
    this.ownerDocument = documentStandIn;
    if (id === undefined) send(['create', this.__id, String(tag)]);
  }
  RNode.prototype.appendChild = function (c) {
    if (c.parentNode) c.parentNode.removeChild(c);
    c.parentNode = this; this.children.push(c);
    send(['append', this.__id, c.__id]);
    return c;
  };
  RNode.prototype.append = function () { for (var i = 0; i < arguments.length; i++) { var c = arguments[i]; this.appendChild(typeof c === 'string' ? documentStandIn.createTextNode(c) : c); } };
  RNode.prototype.removeChild = function (c) {
    var i = this.children.indexOf(c);
    if (i >= 0) this.children.splice(i, 1);
    c.parentNode = null;
    send(['remove', c.__id]);
    return c;
  };
  RNode.prototype.remove = function () { if (this.parentNode) this.parentNode.removeChild(this); };
  RNode.prototype.replaceChildren = function () {
    while (this.children.length) this.removeChild(this.children[0]);
    this.append.apply(this, arguments);
  };
  RNode.prototype.setAttribute = function (k, v) { send(['attr', this.__id, String(k), String(v)]); };
  RNode.prototype.removeAttribute = function (k) { send(['attr', this.__id, String(k), null]); };
  RNode.prototype.addEventListener = function (type, fn) {
    var byType = listeners[this.__id] || (listeners[this.__id] = {});
    if (!byType[type]) { byType[type] = []; send(['listen', this.__id, String(type)]); }
    byType[type].push(fn);
  };
  RNode.prototype.removeEventListener = function (type, fn) {
    var l = (listeners[this.__id] || {})[type];
    if (l) { var i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); }
  };
  ['textContent', 'innerText', 'className', 'id', 'title', 'type', 'value', 'checked', 'disabled', 'placeholder', 'href', 'src', 'min', 'max', 'step', 'selected', 'rows', 'cols'].forEach(function (p) {
    var store = '__' + p;
    Object.defineProperty(RNode.prototype, p, {
      get: function () { return this[store] === undefined ? (p === 'checked' || p === 'disabled' ? false : '') : this[store]; },
      set: function (v) { this[store] = v; send(['prop', this.__id, p === 'innerText' ? 'textContent' : p, v]); }
    });
  });
  Object.defineProperty(RNode.prototype, 'onclick', { set: function (fn) { this.addEventListener('click', fn); } });
  Object.defineProperty(RNode.prototype, 'oninput', { set: function (fn) { this.addEventListener('input', fn); } });
  Object.defineProperty(RNode.prototype, 'onchange', { set: function (fn) { this.addEventListener('change', fn); } });

  var documentStandIn = {
    createElement: function (tag) { return new RNode(tag); },
    createTextNode: function (text) { var n = new RNode('#text'); send(['prop', n.__id, 'textContent', String(text)]); return n; }
  };
  self.document = documentStandIn;

  function call(method, args) {
    return new Promise(function (resolve, reject) {
      var id = nextCall++;
      calls[id] = { resolve: resolve, reject: reject };
      post({ t: 'call', id: id, method: method, args: args });
    });
  }
  var hostProxy = {
    notify: function (kind, text) { post({ t: 'call', id: 0, method: 'notify', args: [kind, text] }); },
    project: function () { return call('project', []); },
    entities: function () { return call('entities', []); },
    readFile: function (p) { return call('readFile', [p]); },
    writeFile: function (p, t) { return call('writeFile', [p, t]); },
    clipboard: { read: function () { return call('clipboard.read', []); }, write: function (t) { return call('clipboard.write', [t]); } },
    runProgram: function (c, a) { return call('runProgram', [c, a || []]); }
  };

  self.Tilewright = {
    editor: {
      panel: function (def) { panels[def.id] = def; },
      tool: function (def) { tools[def.id] = def; },
      importer: function (def) { importers[def.id] = def; },
      exporter: function (def) { exporters[def.id] = def; }
    }
  };

  function reply(id, run) {
    Promise.resolve().then(run).then(
      function (value) { post({ t: 'result', id: id, ok: true, value: value }); },
      function (e) { post({ t: 'result', id: id, ok: false, error: String(e && e.message ? e.message : e) }); }
    );
  }

  self.onmessage = function (ev) {
    var m = ev.data;
    if (m.t === 'rpc-result') {
      var c = calls[m.id]; delete calls[m.id];
      if (c) { if (m.ok) c.resolve(m.value); else c.reject(new Error(m.error)); }
    } else if (m.t === 'mount') {
      var def = panels[m.panel];
      if (!def) return;
      var root = new RNode('div', m.root);
      var cleanup = null;
      reply(0, function () { cleanup = def.mount(root, hostProxy); });
      mounts[m.mount] = { root: root, cleanup: function () { if (typeof cleanup === 'function') cleanup(); } };
    } else if (m.t === 'unmount') {
      var mt = mounts[m.mount]; delete mounts[m.mount];
      if (mt) { try { mt.cleanup(); } catch (e) { /* the plugin's own cleanup failing is its problem */ } }
    } else if (m.t === 'event') {
      var ls = (listeners[m.node] || {})[m.type] || [];
      var node = { value: m.value, checked: m.checked };
      ls.slice().forEach(function (fn) { try { fn({ type: m.type, target: node, currentTarget: node, preventDefault: function () {}, stopPropagation: function () {} }); } catch (e) { post({ t: 'error', message: String(e && e.message ? e.message : e) }); } });
    } else if (m.t === 'tool') {
      var td = tools[m.tool];
      if (td) reply(m.id, function () { return td.onCell(m.cell, hostProxy, m.event); });
    } else if (m.t === 'import') {
      var im = importers[m.importer];
      if (im) reply(m.id, function () { return im.import(m.name, new Uint8Array(m.bytes), hostProxy); });
    } else if (m.t === 'export') {
      var ex = exporters[m.exporter];
      if (ex) reply(m.id, function () { return ex.export(m.name, m.text); });
    } else if (m.t === 'declare') {
      post({
        t: 'declared',
        panels: Object.keys(panels).map(function (k) { return { id: k, title: panels[k].title }; }),
        tools: Object.keys(tools).map(function (k) { return { id: k, label: tools[k].label, group: tools[k].group, help: tools[k].help }; }),
        importers: Object.keys(importers).map(function (k) { return { id: k, label: importers[k].label, extensions: importers[k].extensions }; }),
        exporters: Object.keys(exporters).map(function (k) { return { id: k, label: exporters[k].label, extension: exporters[k].extension, from: exporters[k].from }; })
      });
    }
  };
})();
`;
