(function dumbactFactory(global) {
  "use strict";

  var VERSION = "0.5.0-library-compat";
  var TEXT = "#text";
  var Fragment = typeof Symbol === "function" ? Symbol.for("dumbact.fragment") : "dumbact.fragment";
  var SVG_NS = "http://www.w3.org/2000/svg";
  var XLINK_NS = "http://www.w3.org/1999/xlink";

  /** @typedef {() => void} Unsub */
  /** @typedef {(value:any, previous:any, id:string) => void} Listener */
  /** @typedef {any | ((previous:any, id:string) => any)} Patch */
  /** @typedef {string | number | boolean | null | undefined | VNode | VNode[]} Child */
  /** @typedef {{type:any, props:Object, children:any[], key:string|null, ref:any, _dom?:Node|null, _end?:Node|null, _child?:VNode|null, _refClean?:Function|null, _refValue?:any}} VNode */
  /** @typedef {{id:string, has:boolean, value:any, views:Set<View>, subs:Set<Listener>, version:number}} Cell */
  /** @typedef {{host:Element|DocumentFragment, view:any, vnode:VNode|null, deps:Set<Cell>, next:Set<Cell>, queued:boolean, dead:boolean}} View */

  /** @type {Map<string, Cell>} */
  var cells = new Map();
  /** @type {WeakMap<Element|DocumentFragment, View>|Map<any, View>} */
  var roots = typeof WeakMap === "function" ? new WeakMap() : new Map();
  /** @type {View|null} */
  var currentView = null;
  /** @type {Set<View>} */
  var queue = new Set();
  var queueArmed = false;

  /**
   * Create a virtual node. Compatible with classic JSX transforms.
   * @param {string|Function|symbol} type
   * @param {Object|null=} props
   * @param {...Child} children
   * @returns {VNode}
   */
  function h(type, props) {
    var p = {};
    var c = [];
    var key = null;
    var ref = null;
    var hasRestChildren = arguments.length > 2;
    var k;

    if (props) {
      for (k in props) {
        if (!hasOwn(props, k)) continue;
        if (k === "key") key = props[k];
        else if (k === "ref") ref = props[k];
        else if (k !== "children") p[k] = props[k];
      }
      if (!hasRestChildren && hasOwn(props, "children")) pushChild(c, props.children);
    }

    if (hasRestChildren) {
      for (var i = 2; i < arguments.length; i++) pushChild(c, arguments[i]);
    }

    return vnode(type == null ? Fragment : type, p, c, key, ref);
  }

  /**
   * JSX automatic-runtime entry point.
   * @param {string|Function|symbol} type
   * @param {Object|null=} props
   * @param {string|number|null=} key
   * @returns {VNode}
   */
  function jsx(type, props, key) {
    if (key !== undefined && key !== null) {
      props = copy(props || {});
      props.key = key;
    }
    return h(type, props || null);
  }

  /** @type {typeof jsx} */
  var jsxs = jsx;
  /** @type {typeof jsx} */
  var jsxDEV = jsx;

  /**
   * Return true for Dumbact virtual nodes.
   * @param {any} x
   * @returns {boolean}
   */
  function isVNode(x) {
    return !!x && typeof x === "object" && hasOwn(x, "type") && hasOwn(x, "props") && hasOwn(x, "children");
  }

  /**
   * Read state by id. Reads are tracked during render; that is the no-hooks, no-context contract.
   * @param {string} id
   * @param {any=} fallback
   * @returns {any}
   */
  function get(id, fallback) {
    var c = cell(id);
    track(c);
    return c.has ? c.value : fallback;
  }

  /**
   * Read state without subscribing the current render.
   * @param {string} id
   * @param {any=} fallback
   * @returns {any}
   */
  function peek(id, fallback) {
    var c = cells.get(String(id));
    return c && c.has ? c.value : fallback;
  }

  /**
   * Read state by id or throw.
   * @param {string} id
   * @returns {any}
   */
  function need(id) {
    var c = cell(id);
    track(c);
    if (!c.has) throw new Error("missing dumbact id: " + JSON.stringify(c.id));
    return c.value;
  }

  /**
   * Check if an id exists.
   * @param {string} id
   * @returns {boolean}
   */
  function has(id) {
    var c = cells.get(String(id));
    return !!(c && c.has);
  }

  /**
   * Set state by id. The patch may be a value or a function of the previous value.
   * @param {string} id
   * @param {Patch} patch
   * @returns {any}
   */
  function set(id, patch) {
    var c = cell(id);
    var existed = c.has;
    var previous = c.value;
    var value = typeof patch === "function" ? patch(previous, c.id) : patch;
    var same = existed && Object.is(previous, value);
    if (same && (value === null || (typeof value !== "object" && typeof value !== "function"))) return value;
    c.value = value;
    c.has = true;
    c.version++;
    emit(c, value, existed ? previous : undefined);
    return value;
  }


  /**
   * Delete an id.
   * @param {string} id
   * @returns {boolean}
   */
  function del(id) {
    var c = cells.get(String(id));
    if (!c || !c.has) return false;
    var previous = c.value;
    c.value = undefined;
    c.has = false;
    c.version++;
    emit(c, undefined, previous);
    prune(c);
    return true;
  }

  /**
   * Clear every id or every id with a prefix.
   * @param {string=} prefix
   * @returns {void}
   */
  function clear(prefix) {
    var list = Array.from(cells.keys());
    if (prefix === undefined) {
      for (var i = 0; i < list.length; i++) del(list[i]);
      return;
    }
    prefix = String(prefix);
    for (var j = 0; j < list.length; j++) {
      if (list[j].indexOf(prefix) === 0) del(list[j]);
    }
  }

  /**
   * Subscribe to an id. This is the only non-render notification primitive.
   * @param {string} id
   * @param {Listener} listener
   * @param {boolean=} immediate
   * @returns {Unsub}
   */
  function sub(id, listener, immediate) {
    var c = cell(id);
    c.subs.add(listener);
    if (immediate && c.has) listener(c.value, undefined, c.id);
    return function unsub() {
      c.subs.delete(listener);
      prune(c);
    };
  }

  /**
   * List ids, optionally by prefix.
   * @param {string=} prefix
   * @returns {string[]}
   */
  function ids(prefix) {
    prefix = prefix === undefined ? "" : String(prefix);
    var out = [];
    cells.forEach(function each(c, id) {
      if (c.has && id.indexOf(prefix) === 0) out.push(id);
    });
    return out;
  }

  /**
   * Snapshot existing state into a plain object.
   * @returns {Record<string, any>}
   */
  function snapshot() {
    var out = {};
    cells.forEach(function each(c, id) {
      if (c.has) out[id] = c.value;
    });
    return out;
  }

  /**
   * Build namespaced state helpers.
   * @param {string} prefix
   * @returns {{id:(key:string)=>string,get:(key:string,fallback?:any)=>any,peek:(key:string,fallback?:any)=>any,set:(key:string,patch:Patch)=>any,del:(key:string)=>boolean,sub:(key:string,listener:Listener,immediate?:boolean)=>Unsub,clear:()=>void}}
   */
  function scope(prefix) {
    prefix = String(prefix || "");
    var sep = prefix && !/[.:/#-]$/.test(prefix) ? ":" : "";
    function id(key) { return prefix + sep + String(key); }
    return {
      id: id,
      get: function scopedGet(key, fallback) { return get(id(key), fallback); },
      peek: function scopedPeek(key, fallback) { return peek(id(key), fallback); },
      set: function scopedSet(key, patch) { return set(id(key), patch); },
      del: function scopedDel(key) { return del(id(key)); },
      sub: function scopedSub(key, listener, immediate) { return sub(id(key), listener, immediate); },
      clear: function scopedClear() { clear(prefix + sep); }
    };
  }

  /**
   * Render a view into a host. A function view is re-run when any id it reads changes.
   * @param {VNode|VNode[]|Function|null} view
   * @param {Element|DocumentFragment|string} host
   * @returns {Unsub}
   */
  function render(view, host) {
    host = resolveHost(host);
    var root = roots.get(host);
    if (!root) {
      clearChildren(host);
      root = {
        host: host,
        view: view,
        vnode: null,
        deps: new Set(),
        next: new Set(),
        queued: false,
        dead: false
      };
      roots.set(host, root);
    }
    root.view = view;
    root.dead = false;
    paint(root);
    return function disposeRender() {
      unmount(host);
    };
  }

  /** @type {typeof render} */
  var mount = render;

  /**
   * Unmount a host rendered by Dumbact.
   * @param {Element|DocumentFragment|string} host
   * @returns {void}
   */
  function unmount(host) {
    host = resolveHost(host);
    var root = roots.get(host);
    if (!root) {
      clearChildren(host);
      return;
    }
    root.dead = true;
    root.queued = false;
    queue.delete(root);
    root.deps.forEach(function each(c) { c.views.delete(root); prune(c); });
    root.deps.clear();
    root.next.clear();
    if (root.vnode) removeVNode(host, root.vnode);
    root.vnode = null;
    clearChildren(host);
    roots.delete(host);
  }

  /**
   * Flush scheduled render work synchronously.
   * @returns {void}
   */
  function flush() {
    queueArmed = false;
    var list = Array.from(queue);
    queue.clear();
    for (var i = 0; i < list.length; i++) {
      var root = list[i];
      if (!root.dead && root.queued) paint(root);
    }
    if (queue.size) flush();
  }

  function paint(root) {
    if (root.dead) return;
    root.queued = false;
    root.next = new Set();
    var previous = currentView;
    currentView = root;
    try {
      var out = typeof root.view === "function" ? root.view() : root.view;
      var next = h(Fragment, null, out);
      root.vnode = patch(root.host, root.vnode, next, null, false);
    } catch (error) {
      currentView = previous;
      root.next = new Set();
      var err = toError(error);
      set("sys:errors", function append(previousErrors) {
        return (previousErrors || []).concat(err);
      });
      throw err;
    }
    currentView = previous;
    syncDeps(root);
  }

  function syncDeps(root) {
    var oldDeps = root.deps;
    var nextDeps = root.next;
    oldDeps.forEach(function removeOld(c) {
      if (nextDeps.has(c)) return;
      c.views.delete(root);
      prune(c);
    });
    nextDeps.forEach(function addNew(c) {
      if (oldDeps.has(c)) return;
      c.views.add(root);
    });
    root.deps = nextDeps;
    root.next = new Set();
  }

  function schedule(root) {
    if (root.dead || root.queued) return;
    root.queued = true;
    queue.add(root);
    if (queueArmed) return;
    queueArmed = true;
    var qm = global.queueMicrotask || function microtask(fn) { Promise.resolve().then(fn); };
    qm(flush);
  }

  function track(c) {
    if (currentView) currentView.next.add(c);
  }

  function emit(c, value, previous) {
    var viewList = Array.from(c.views);
    for (var i = 0; i < viewList.length; i++) schedule(viewList[i]);
    var subList = Array.from(c.subs);
    for (var j = 0; j < subList.length; j++) subList[j](value, previous, c.id);
  }

  function cell(id) {
    id = String(id);
    var c = cells.get(id);
    if (!c) {
      c = { id: id, has: false, value: undefined, views: new Set(), subs: new Set(), version: 0 };
      cells.set(id, c);
    }
    return c;
  }

  function prune(c) {
    if (!c.has && c.views.size === 0 && c.subs.size === 0) cells.delete(c.id);
  }

  function vnode(type, props, children, key, ref) {
    return {
      type: type,
      props: props || {},
      children: children || [],
      key: key === undefined || key === null ? null : String(key),
      ref: ref || null,
      _dom: null,
      _end: null,
      _child: null,
      _refClean: null,
      _refValue: undefined
    };
  }

  function normalize(x) {
    if (Array.isArray(x)) return h(Fragment, null, x);
    if (x === null || x === undefined || x === true || x === false) return h(Fragment, null);
    if (isVNode(x)) return x;
    return vnode(TEXT, { nodeValue: String(x) }, [], null, null);
  }

  function pushChild(out, child) {
    if (Array.isArray(child)) {
      for (var i = 0; i < child.length; i++) pushChild(out, child[i]);
      return;
    }
    if (child === null || child === undefined || child === true || child === false) return;
    out.push(child);
  }

  function patch(parent, oldVNode, newRaw, before, isSvg) {
    var newVNode = normalize(newRaw);
    if (oldVNode) oldVNode = normalize(oldVNode);

    if (!oldVNode) return mountVNode(parent, newVNode, before, isSvg);

    if (!sameKind(oldVNode, newVNode)) {
      var ref = firstDom(oldVNode) || before || null;
      mountVNode(parent, newVNode, ref, isSvg);
      removeVNode(parent, oldVNode);
      return newVNode;
    }

    if (newVNode.type === TEXT) {
      var textNode = oldVNode._dom;
      if (textNode.nodeValue !== newVNode.props.nodeValue) textNode.nodeValue = newVNode.props.nodeValue;
      newVNode._dom = textNode;
      newVNode._end = textNode;
      return newVNode;
    }

    if (newVNode.type === Fragment) {
      newVNode._dom = oldVNode._dom;
      newVNode._end = oldVNode._end;
      newVNode.children = patchChildren(parent, oldVNode.children, newVNode.children, newVNode._end, isSvg);
      commitRef(newVNode, oldVNode, firstDom(newVNode));
      return newVNode;
    }

    if (typeof newVNode.type === "function") {
      return patchComponent(parent, oldVNode, newVNode, before, isSvg);
    }

    return patchElement(parent, oldVNode, newVNode, before, isSvg);
  }

  function mountVNode(parent, v, before, isSvg) {
    if (v.type === TEXT) {
      var textNode = docOf(parent).createTextNode(v.props.nodeValue);
      parent.insertBefore(textNode, before || null);
      v._dom = textNode;
      v._end = textNode;
      commitRef(v, null, textNode);
      return v;
    }

    if (v.type === Fragment) {
      var doc = docOf(parent);
      var start = doc.createComment("dumbact");
      var end = doc.createComment("/dumbact");
      parent.insertBefore(start, before || null);
      parent.insertBefore(end, before || null);
      v._dom = start;
      v._end = end;
      v.children = patchChildren(parent, [], v.children, end, isSvg);
      commitRef(v, null, start);
      return v;
    }

    if (typeof v.type === "function") {
      var child = renderComponent(v);
      v._child = patch(parent, null, child, before, isSvg);
      v._dom = firstDom(v._child);
      v._end = endDom(v._child);
      commitRef(v, null, v._dom);
      return v;
    }

    isSvg = isSvg || v.type === "svg";
    var node = isSvg ? docOf(parent).createElementNS(SVG_NS, v.type) : docOf(parent).createElement(v.type);
    v._dom = node;
    v._end = node;
    updateProps(node, {}, v.props, isSvg);
    v.children = patchChildren(node, [], v.children, null, isSvg);
    parent.insertBefore(node, before || null);
    commitRef(v, null, node);
    return v;
  }

  function patchComponent(parent, oldVNode, newVNode, before, isSvg) {
    var child = renderComponent(newVNode);
    newVNode._child = patch(parent, oldVNode._child, child, before, isSvg);
    newVNode._dom = firstDom(newVNode._child);
    newVNode._end = endDom(newVNode._child);
    commitRef(newVNode, oldVNode, newVNode._dom);
    return newVNode;
  }

  function patchElement(parent, oldVNode, newVNode, before, isSvg) {
    var node = oldVNode._dom;
    isSvg = isSvg || newVNode.type === "svg";
    newVNode._dom = node;
    newVNode._end = node;
    updateProps(node, oldVNode.props, newVNode.props, isSvg);
    newVNode.children = patchChildren(node, oldVNode.children, newVNode.children, null, isSvg);
    commitRef(newVNode, oldVNode, node);
    if (before) insertVNodeBefore(parent, newVNode, before);
    return newVNode;
  }

  function renderComponent(v) {
    var props = copy(v.props || {});
    if (v.children && v.children.length === 1) props.children = v.children[0];
    else if (v.children && v.children.length > 1) props.children = v.children;
    else if (!hasOwn(props, "children")) props.children = [];
    return v.type(props);
  }

  function patchChildren(parent, oldChildren, newChildren, before, isSvg) {
    var oldList = (oldChildren || []).map(normalize);
    var newList = [];
    for (var i = 0; i < (newChildren || []).length; i++) newList.push(normalize(newChildren[i]));

    var keyed = new Map();
    var free = [];
    for (var o = 0; o < oldList.length; o++) {
      var old = oldList[o];
      if (old.key != null) keyed.set(old.key, old);
      else free.push(old);
    }

    var used = new Set();
    var matches = new Array(newList.length);
    for (var n = 0; n < newList.length; n++) {
      var next = newList[n];
      var match = null;
      if (next.key != null && keyed.has(next.key)) {
        match = keyed.get(next.key);
      } else {
        match = takeFree(oldList, free, used, next, n);
      }
      if (match) used.add(match);
      matches[n] = match;
    }

    var cursor = before || null;
    for (var r = newList.length - 1; r >= 0; r--) {
      var patched = patch(parent, matches[r], newList[r], cursor, isSvg);
      newList[r] = patched;
      insertVNodeBefore(parent, patched, cursor);
      cursor = firstDom(patched);
    }

    for (var x = 0; x < oldList.length; x++) {
      if (!used.has(oldList[x])) removeVNode(parent, oldList[x]);
    }

    return newList;
  }

  function takeFree(oldList, free, used, next, index) {
    var direct = oldList[index];
    if (direct && direct.key == null && !used.has(direct) && sameKind(direct, next)) return direct;
    for (var i = 0; i < free.length; i++) {
      if (!used.has(free[i]) && sameKind(free[i], next)) return free[i];
    }
    return null;
  }

  function sameKind(a, b) {
    if (!a || !b) return false;
    return a.type === b.type && a.key === b.key;
  }

  function firstDom(v) {
    if (!v) return null;
    if (v._dom) return v._dom;
    if (v._child) return firstDom(v._child);
    return null;
  }

  function endDom(v) {
    if (!v) return null;
    if (v._end) return v._end;
    if (v._child) return endDom(v._child);
    return firstDom(v);
  }

  function insertVNodeBefore(parent, v, before) {
    var start = firstDom(v);
    var end = endDom(v) || start;
    if (!start) return;
    if (!before) {
      if (end.nextSibling === null && start.parentNode === parent) return;
    } else {
      if (start === before || end.nextSibling === before) return;
      var probe = start;
      while (probe) {
        if (probe === before) return;
        if (probe === end) break;
        probe = probe.nextSibling;
      }
    }
    var stop = end.nextSibling;
    var node = start;
    while (node && node !== stop) {
      var next = node.nextSibling;
      parent.insertBefore(node, before || null);
      node = next;
    }
  }

  function removeVNode(parent, v) {
    if (!v) return;
    disposeVNode(v);
    var start = firstDom(v);
    var end = endDom(v) || start;
    if (!start) return;
    var stop = end.nextSibling;
    var node = start;
    while (node && node !== stop) {
      var next = node.nextSibling;
      if (node.parentNode) node.parentNode.removeChild(node);
      node = next;
    }
  }

  function disposeVNode(v) {
    if (!v) return;
    clearRef(v);
    if (typeof v.type === "function") {
      disposeVNode(v._child);
      return;
    }
    if (v.children) {
      for (var i = 0; i < v.children.length; i++) disposeVNode(v.children[i]);
    }
    var dom = v._dom;
    if (dom && dom.__dumbactListeners) {
      var events = dom.__dumbactListeners;
      for (var type in events) {
        if (hasOwn(events, type)) dom.removeEventListener(type, events[type]);
      }
      dom.__dumbactListeners = null;
      dom.__dumbactEvents = null;
    }
  }

  function updateProps(node, oldProps, newProps, isSvg) {
    oldProps = oldProps || {};
    newProps = newProps || {};
    for (var k in oldProps) {
      if (!hasOwn(oldProps, k)) continue;
      if (k === "key" || k === "ref" || k === "children") continue;
      if (!hasOwn(newProps, k)) setProp(node, k, undefined, oldProps[k], isSvg);
    }
    for (var n in newProps) {
      if (!hasOwn(newProps, n)) continue;
      if (n === "key" || n === "ref" || n === "children") continue;
      if (newProps[n] !== oldProps[n]) setProp(node, n, newProps[n], oldProps[n], isSvg);
    }
  }

  function setProp(node, name, value, oldValue, isSvg) {
    if (name === "className") name = "class";
    if (name === "unsafeHTML" || name === "html" || name === "dangerouslySetInnerHTML") return;

    if (name === "style") {
      setStyle(node, value, oldValue);
      return;
    }

    if (isEventName(name)) {
      setEvent(node, name, value);
      return;
    }

    if (name === "xlinkHref") {
      if (value == null || value === false) node.removeAttributeNS(XLINK_NS, "href");
      else node.setAttributeNS(XLINK_NS, "href", String(value));
      return;
    }

    if (value == null || value === false) {
      removeDomProp(node, name, isSvg);
      return;
    }

    if (!isSvg && name !== "class" && name !== "list" && name !== "type" && name in node && !isDataOrAria(name)) {
      try {
        node[name] = value;
      } catch (_) {
        node.setAttribute(name, String(value));
      }
      return;
    }

    if (value === true) node.setAttribute(name, "");
    else node.setAttribute(name, String(value));
  }

  function removeDomProp(node, name, isSvg) {
    if (!isSvg && name !== "class" && name in node && !isDataOrAria(name)) {
      try {
        if (typeof node[name] === "boolean") node[name] = false;
        else node[name] = "";
      } catch (_) {}
    }
    node.removeAttribute(name);
  }

  function setStyle(node, value, oldValue) {
    var style = node.style;
    if (!style) return;
    if (value == null || value === false) {
      node.removeAttribute("style");
      return;
    }
    if (typeof value === "string") {
      node.setAttribute("style", value);
      return;
    }
    if (typeof oldValue === "object" && oldValue) {
      for (var oldName in oldValue) {
        if (hasOwn(oldValue, oldName) && !(value && hasOwn(value, oldName))) style[oldName] = "";
      }
    }
    for (var name in value) {
      if (!hasOwn(value, name)) continue;
      var v = value[name];
      if (v == null || v === false) style[name] = "";
      else style[name] = typeof v === "number" && !isUnitlessCss(name) ? v + "px" : String(v);
    }
  }

  function setEvent(node, name, value) {
    var type = eventType(name);
    var events = node.__dumbactEvents || (node.__dumbactEvents = {});
    var listeners = node.__dumbactListeners || (node.__dumbactListeners = {});
    if (!value) {
      events[type] = null;
      if (listeners[type]) {
        node.removeEventListener(type, listeners[type]);
        delete listeners[type];
      }
      return;
    }
    events[type] = value;
    if (listeners[type]) return;
    listeners[type] = function dumbactEvent(event) {
      var handler = events[type];
      if (typeof handler === "function") return handler.call(node, event);
      if (Array.isArray(handler)) {
        var fn = handler[0];
        var data = handler.slice(1);
        return typeof fn === "function" ? fn.apply(node, [event].concat(data)) : undefined;
      }
    };
    node.addEventListener(type, listeners[type]);
  }

  function isEventName(name) {
    return /^on[A-Z_a-z]/.test(name);
  }

  function eventType(name) {
    var raw = name.slice(2);
    if (raw.charAt(0) === "-") return raw.slice(1);
    return raw.toLowerCase();
  }

  function isDataOrAria(name) {
    return name.indexOf("data-") === 0 || name.indexOf("aria-") === 0;
  }

  function commitRef(v, oldV, value) {
    if (oldV && oldV.ref === v.ref && oldV._refValue === value) {
      v._refClean = oldV._refClean || null;
      v._refValue = oldV._refValue;
      return;
    }
    if (oldV) clearRef(oldV);
    if (!v.ref) return;
    var previous = currentView;
    currentView = null;
    try {
      if (typeof v.ref === "function") {
        var clean = v.ref(value);
        v._refClean = typeof clean === "function" ? clean : null;
      } else if (typeof v.ref === "object") {
        v.ref.current = value;
      }
      v._refValue = value;
    } finally {
      currentView = previous;
    }
  }

  function clearRef(v) {
    if (!v || !v.ref) return;
    var previous = currentView;
    currentView = null;
    try {
      if (v._refClean) v._refClean();
      else if (typeof v.ref === "function") v.ref(null);
      else if (typeof v.ref === "object") v.ref.current = null;
    } finally {
      v._refClean = null;
      v._refValue = undefined;
      currentView = previous;
    }
  }

  function resolveHost(host) {
    if (typeof host === "string") {
      if (!global.document) throw new Error("Dumbact.render(selector) requires document");
      var found = global.document.querySelector(host);
      if (!found) throw new Error("Dumbact host not found: " + host);
      return found;
    }
    if (!host) throw new Error("Dumbact.render requires a host");
    return host;
  }

  function clearChildren(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function docOf(node) {
    return node.ownerDocument || global.document;
  }

  function copy(obj) {
    var out = {};
    if (!obj) return out;
    for (var k in obj) if (hasOwn(obj, k)) out[k] = obj[k];
    return out;
  }

  function hasOwn(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
  }

  function toError(error) {
    return error instanceof Error ? error : new Error(String(error));
  }

  function isUnitlessCss(name) {
    return /^(animationIterationCount|borderImageOutset|borderImageSlice|borderImageWidth|boxFlex|boxFlexGroup|boxOrdinalGroup|columnCount|columns|flex|flexGrow|flexPositive|flexShrink|flexNegative|flexOrder|gridArea|gridRow|gridRowEnd|gridRowSpan|gridRowStart|gridColumn|gridColumnEnd|gridColumnSpan|gridColumnStart|fontWeight|lineClamp|lineHeight|opacity|order|orphans|tabSize|widows|zIndex|zoom)$/i.test(name);
  }

  var api = {
    VERSION: VERSION,
    Fragment: Fragment,
    h: h,
    createElement: h,
    jsx: jsx,
    jsxs: jsxs,
    jsxDEV: jsxDEV,
    render: render,
    mount: mount,
    unmount: unmount,
    flush: flush,
    get: get,
    peek: peek,
    need: need,
    has: has,
    set: set,
    del: del,
    clear: clear,
    sub: sub,
    ids: ids,
    snapshot: snapshot,
    scope: scope
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.Dumbact = api;
})(typeof globalThis !== "undefined" ? globalThis : this);

;(function dumbactTinyCompiler(global) {
  "use strict";
  var D = global.Dumbact;
  if (!D) return;

  var scriptTypes = {
    "text/dumbact": "tsx",
    "text/dumbact-js": "js",
    "text/dumbact-ts": "ts",
    "text/dumbact-jsx": "jsx",
    "text/dumbact-tsx": "tsx",
    "text/dumbact-module": "tsx-module",
    "text/dumbact-js-module": "js-module",
    "text/dumbact-ts-module": "ts-module",
    "text/dumbact-jsx-module": "jsx-module",
    "text/dumbact-tsx-module": "tsx-module",
    "text/javascript+jsx": "jsx",
    "text/javascript+tsx": "tsx",
    "text/jsx": "jsx",
    "application/jsx": "jsx",
    "text/tsx": "tsx",
    "application/tsx": "tsx",
    "text/typescript": "ts",
    "application/typescript": "ts",
    "text/ts": "ts",
    "application/ts": "ts",
    "text/notbabel": "tsx"
  };

  /** @type {Map<string, Promise<string>>} */
  var moduleCache = new Map();
  var dumbactModuleUrl = "";

  function compile(source, mode) {
    mode = cleanMode(mode);
    var out = String(source == null ? "" : source);
    var ts = mode.indexOf("ts") >= 0 || mode.indexOf("typescript") >= 0 || mode === "text/dumbact" || mode === "text/notbabel";
    var jsx = mode.indexOf("x") >= 0 || mode === "text/dumbact" || mode === "text/notbabel";
    if (ts) out = stripTypes(out);
    if (jsx) out = transformJSX(out);
    return out;
  }

  function cleanMode(mode) {
    return String(mode || "tsx").toLowerCase().replace(/-module$/, "");
  }

  function isModuleMode(mode) {
    return /-module$/.test(String(mode || ""));
  }

  function inferModeFromUrl(url, fallback) {
    var path = String(url || "").split("?")[0].split("#")[0].toLowerCase();
    if (/\.tsx$/.test(path)) return "tsx-module";
    if (/\.jsx$/.test(path)) return "jsx-module";
    if (/\.ts$/.test(path)) return "ts-module";
    if (/\.mjs$/.test(path) || /\.js$/.test(path)) return "js-module";
    return fallback || "tsx-module";
  }

  function stripTypes(source) {
    var src = String(source == null ? "" : source);
    src = src.replace(/^\s*import\s+type\s+[^;]+;?\s*$/gm, "");
    src = src.replace(/^\s*export\s+type\s+[^;]+;?\s*$/gm, "");
    src = src.replace(/^\s*type\s+[^\n]+$/gm, "");
    src = removeInterfaceBlocks(src);
    src = src.replace(/\s+as\s+[A-Za-z_$][\w$]*(?:\s*\[\])?(?:\s*\|\s*[A-Za-z_$][\w$]*)*/g, "");
    src = src.replace(/\s+satisfies\s+[^,;)\n]+/g, "");
    src = stripColonTypes(src);
    return src;
  }

  function removeInterfaceBlocks(src) {
    return src.replace(/^\s*interface\s+[A-Za-z_$][\w$]*(?:\s+extends\s+[^{]+)?\s*\{[\s\S]*?^\s*\}\s*$/gm, "");
  }

  function stripColonTypes(src) {
    var out = "";
    for (var i = 0; i < src.length; i++) {
      var ch = src[i];
      if (ch === "\"" || ch === "'" || ch === "`") {
        var q = readQuoted(src, i); out += q.text; i = q.end; continue;
      }
      if (ch === "/" && src[i + 1] === "/") {
        var nl = src.indexOf("\n", i + 2); if (nl < 0) nl = src.length;
        out += src.slice(i, nl); i = nl - 1; continue;
      }
      if (ch === "/" && src[i + 1] === "*") {
        var ce = src.indexOf("*/", i + 2); if (ce < 0) ce = src.length - 2;
        out += src.slice(i, ce + 2); i = ce + 1; continue;
      }
      if (ch === ":" && shouldStripType(src, i)) { i = skipType(src, i + 1) - 1; continue; }
      out += ch;
    }
    return out;
  }

  function shouldStripType(src, colon) {
    var p = prevSig(src, colon);
    var n = nextSig(src, colon + 1);
    if (!p || !n || !/[\w$)\]]/.test(p) || !/[A-Za-z_$({\[<'"|]/.test(n)) return false;
    if (hasOpenTernary(src, colon)) return false;
    var j = colon - 1;
    while (j >= 0 && /\s/.test(src[j])) j--;
    while (j >= 0 && /[\w$]/.test(src[j])) j--;
    var beforeName = prevSig(src, j + 1);
    if ((beforeName === "{" || beforeName === ",") && !looksLikeParamOrDeclaration(src, j)) return false;
    return true;
  }

  function hasOpenTernary(src, colon) {
    var depth = 0;
    for (var i = colon - 1; i >= 0; i--) {
      var ch = src[i];
      if (ch === "\"" || ch === "'" || ch === "`") { i = readQuotedBackward(src, i); continue; }
      if (ch === ")" || ch === "]" || ch === "}") { depth++; continue; }
      if (ch === "(" || ch === "[" || ch === "{") { if (depth === 0) return false; depth--; continue; }
      if (depth === 0) {
        if (ch === "?") return true;
        if (ch === ";" || ch === "\n") return false;
      }
    }
    return false;
  }

  function readQuotedBackward(src, i) {
    var quote = src[i];
    for (var j = i - 1; j >= 0; j--) {
      if (src[j] === quote) {
        var slash = 0;
        for (var k = j - 1; k >= 0 && src[k] === "\\"; k--) slash++;
        if (slash % 2 === 0) return j;
      }
    }
    return -1;
  }

  function looksLikeParamOrDeclaration(src, j) {
    for (var i = j; i >= 0; i--) {
      var ch = src[i];
      if (/\s/.test(ch)) continue;
      return ch === "(" || ch === "=";
    }
    return false;
  }

  function skipType(src, i) {
    var depth = 0, quote = "";
    for (; i < src.length; i++) {
      var ch = src[i];
      if (quote) { if (ch === "\\") i++; else if (ch === quote) quote = ""; continue; }
      if (ch === "\"" || ch === "'" || ch === "`") { quote = ch; continue; }
      if (ch === "<" || ch === "(" || ch === "[") depth++;
      else if (ch === ">" || ch === ")" || ch === "]") { if (depth === 0) return i; depth--; }
      else if (depth === 0 && (ch === "," || ch === ";" || ch === "=" || ch === ")" || ch === "{" || ch === "\n")) return i;
    }
    return i;
  }

  function transformJSX(source) {
    var src = String(source == null ? "" : source), out = "";
    for (var i = 0; i < src.length;) {
      var ch = src[i];
      if (ch === "\"" || ch === "'" || ch === "`") { var q = readQuoted(src, i); out += q.text; i = q.end + 1; continue; }
      if (ch === "/" && src[i + 1] === "/") { var nl = src.indexOf("\n", i + 2); if (nl < 0) nl = src.length; out += src.slice(i, nl); i = nl; continue; }
      if (ch === "/" && src[i + 1] === "*") { var ce = src.indexOf("*/", i + 2); if (ce < 0) ce = src.length - 2; out += src.slice(i, ce + 2); i = ce + 2; continue; }
      if (ch === "<" && canStartJSX(src, i)) { var node = parseJSX(src, i); out += node.code; i = node.end; continue; }
      out += ch; i++;
    }
    return out;
  }

  function canStartJSX(src, i) {
    var n = src[i + 1];
    if (!(n === ">" || /[A-Za-z_$]/.test(n))) return false;
    var before = src.slice(0, i).replace(/\s+$/g, "");
    if (/(^|[^A-Za-z0-9_$])(return|yield|case)$/.test(before) || /=>\s*$/.test(before)) return true;
    var p = prevSig(src, i);
    return !p || /[=(:,[!&|?{};>]/.test(p);
  }

  function parseJSX(src, i) {
    if (src.slice(i, i + 2) === "<>") return parseFragment(src, i);
    return parseElement(src, i);
  }

  function parseFragment(src, i) {
    var children = parseChildren(src, i + 2, null, true);
    return { code: "Dumbact.h(Dumbact.Fragment,null" + (children.codes.length ? "," + children.codes.join(",") : "") + ")", end: children.end };
  }

  function parseElement(src, i) {
    i++;
    var start = i;
    while (i < src.length && /[A-Za-z0-9_$.:\-]/.test(src[i])) i++;
    var name = src.slice(start, i);
    var props = [], spreads = [], selfClosing = false;
    while (i < src.length) {
      i = skipSpace(src, i);
      if (src.slice(i, i + 2) === "/>") { selfClosing = true; i += 2; break; }
      if (src[i] === ">") { i++; break; }
      if (src[i] === "{" && src.slice(i + 1, i + 4) === "...") {
        var sp = readJSXExpr(src, i); spreads.push(sp.code.replace(/^\.\.\./, "")); i = sp.end; continue;
      }
      var a0 = i;
      while (i < src.length && /[^\s=/>]/.test(src[i])) i++;
      var attr = src.slice(a0, i);
      i = skipSpace(src, i);
      var value = "true";
      if (src[i] === "=") {
        i++; i = skipSpace(src, i);
        if (src[i] === "\"" || src[i] === "'") { var q = readQuoted(src, i); value = JSON.stringify(decodeEntities(q.text.slice(1, -1))); i = q.end + 1; }
        else if (src[i] === "{") { var ex = readJSXExpr(src, i); value = ex.code || "undefined"; i = ex.end; }
        else { var v0 = i; while (i < src.length && /[^\s/>]/.test(src[i])) i++; value = JSON.stringify(src.slice(v0, i)); }
      }
      if (attr) props.push([attr, value]);
    }
    var children = selfClosing ? { codes: [], end: i } : parseChildren(src, i, name, false);
    return { code: "Dumbact.h(" + tagCode(name) + "," + propsCode(props, spreads) + (children.codes.length ? "," + children.codes.join(",") : "") + ")", end: children.end };
  }

  function parseChildren(src, i, name, frag) {
    var codes = [], text = "";
    function pushText() { var t = normalizeText(text); if (t) codes.push(JSON.stringify(decodeEntities(t))); text = ""; }
    while (i < src.length) {
      if (frag && src.slice(i, i + 3) === "</>") { pushText(); return { codes: codes, end: i + 3 }; }
      if (!frag && src.slice(i, i + 2) === "</") {
        pushText(); i += 2; var s = i; while (i < src.length && /[A-Za-z0-9_$.:\-]/.test(src[i])) i++; var close = src.slice(s, i);
        if (close !== name) throw new Error("JSX close tag mismatch: " + name + " / " + close);
        i = skipSpace(src, i); if (src[i] !== ">") throw new Error("JSX close tag missing > for " + name);
        return { codes: codes, end: i + 1 };
      }
      if (src[i] === "<") { pushText(); var child = parseJSX(src, i); codes.push(child.code); i = child.end; continue; }
      if (src[i] === "{") { pushText(); var ex = readJSXExpr(src, i); if (ex.code && ex.code[0] !== "/") codes.push(ex.code); i = ex.end; continue; }
      text += src[i++];
    }
    if (name || frag) throw new Error("JSX tag was not closed");
    pushText(); return { codes: codes, end: i };
  }

  function tagCode(name) { return !name || name.indexOf("-") >= 0 || /^[a-z]/.test(name) ? JSON.stringify(name) : name; }
  function propsCode(props, spreads) {
    if (!props.length && !spreads.length) return "null";
    var chunks = [], own = [];
    for (var i = 0; i < props.length; i++) own.push(propKey(props[i][0]) + ":" + props[i][1]);
    if (own.length) chunks.push("{" + own.join(",") + "}");
    for (var j = 0; j < spreads.length; j++) chunks.push(spreads[j]);
    return chunks.length === 1 ? chunks[0] : "Object.assign({}," + chunks.join(",") + ")";
  }
  function propKey(k) { return /^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k); }
  function readJSXExpr(src, i) { var end = findMatching(src, i, "{", "}"); if (end < 0) throw new Error("JSX expression missing }"); return { code: transformJSX(src.slice(i + 1, end).trim()), end: end + 1 }; }
  function normalizeText(t) { if (!t) return ""; var lines = t.replace(/\t/g, " ").split(/\r?\n/); if (lines.length === 1) return lines[0].replace(/\s+/g, " "); var out = []; for (var i = 0; i < lines.length; i++) { var x = lines[i].replace(/\s+/g, " ").trim(); if (x) out.push(x); } return out.join(" "); }
  function decodeEntities(t) { return t.replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/&#39;/g, "'"); }
  function readQuoted(src, i) { var quote = src[i], j = i + 1; for (; j < src.length; j++) { if (src[j] === "\\") j++; else if (src[j] === quote) break; else if (quote === "`" && src[j] === "$" && src[j + 1] === "{") { j = findMatching(src, j + 1, "{", "}"); if (j < 0) j = src.length; } } return { text: src.slice(i, Math.min(src.length, j + 1)), end: Math.min(src.length - 1, j) }; }
  function findMatching(src, i, open, close) { var depth = 0; for (var j = i; j < src.length; j++) { var ch = src[j]; if (ch === "\"" || ch === "'" || ch === "`") { j = readQuoted(src, j).end; continue; } if (ch === "/" && src[j + 1] === "/") { var nl = src.indexOf("\n", j + 2); if (nl < 0) return -1; j = nl; continue; } if (ch === "/" && src[j + 1] === "*") { var ce = src.indexOf("*/", j + 2); if (ce < 0) return -1; j = ce + 1; continue; } if (ch === open) depth++; else if (ch === close) { depth--; if (depth === 0) return j; } } return -1; }
  function skipSpace(src, i) { while (i < src.length && /\s/.test(src[i])) i++; return i; }
  function prevSig(src, i) { for (var j = i - 1; j >= 0; j--) if (!/\s/.test(src[j])) return src[j]; return ""; }
  function nextSig(src, i) { for (var j = i; j < src.length; j++) if (!/\s/.test(src[j])) return src[j]; return ""; }

  function runScripts(doc) {
    doc = doc || global.document;
    if (!doc || !doc.querySelectorAll) return Promise.resolve([]);
    var list = Array.prototype.slice.call(doc.querySelectorAll("script[type]"));
    list = list.filter(function (script) { return scriptMode(script); });
    return list.reduce(function (p, script) { return p.then(function (out) { return runScript(script).then(function (r) { out.push(r); return out; }); }); }, Promise.resolve([]));
  }

  function runScript(script) {
    var mode = scriptMode(script);
    if (!mode || script.getAttribute("data-dumbact-ran") === "true") return Promise.resolve(null);
    script.setAttribute("data-dumbact-ran", "true");
    var doc = script.ownerDocument || global.document;
    var nonce = script.getAttribute("nonce");
    var src = script.getAttribute("src");
    var base = src ? new URL(src, doc && doc.baseURI || global.location && global.location.href || "http://dumbact.local/").href : doc && doc.baseURI || global.location && global.location.href || "http://dumbact.local/inline.html";

    if (isModuleMode(mode)) {
      var urlPromise = src ? moduleURL(base, mode) : moduleSourceURL(script.textContent || "", base, mode, "dumbact-inline." + cleanMode(mode));
      return urlPromise.then(function (url) {
        return new Promise(function (resolve, reject) {
          var real = doc.createElement("script");
          real.type = "module";
          real.src = url;
          real.onload = function () { resolve(real); };
          real.onerror = function () { reject(new Error("Dumbact module failed to load: " + url)); };
          if (nonce) real.setAttribute("nonce", nonce);
          script.parentNode.insertBefore(real, script.nextSibling);
        });
      });
    }

    var sourcePromise = src ? global.fetch(base).then(function (r) { if (!r.ok) throw new Error("Dumbact could not fetch " + base + ": " + r.status); return r.text(); }) : Promise.resolve(script.textContent || "");
    return sourcePromise.then(function (source) {
      var real = doc.createElement("script");
      real.text = compile(source, mode) + "\n//# sourceURL=" + (src ? base : "dumbact-inline." + mode);
      if (nonce) real.setAttribute("nonce", nonce);
      script.parentNode.insertBefore(real, script.nextSibling);
      return real;
    });
  }

  function moduleURL(url, mode) {
    var key = String(url) + "\n" + cleanMode(mode || inferModeFromUrl(url));
    if (moduleCache.has(key)) return moduleCache.get(key);
    var p = global.fetch(url).then(function (r) {
      if (!r.ok) throw new Error("Dumbact could not fetch module " + url + ": " + r.status);
      return r.text();
    }).then(function (source) {
      return moduleSourceURL(source, url, inferModeFromUrl(url, mode), url);
    });
    moduleCache.set(key, p);
    return p;
  }

  function moduleSourceURL(source, base, mode, label) {
    var code = compile(source, cleanMode(mode));
    return rewriteModuleImports(code, base, cleanMode(mode)).then(function (rewritten) {
      rewritten += "\n//# sourceURL=" + String(label || base || "dumbact-module");
      return objectURL(rewritten);
    });
  }

  function rewriteModuleImports(code, base, mode) {
    var specs = moduleSpecifiers(code);
    var jobs = specs.map(function (item) {
      return resolveModuleSpecifier(item.spec, base, mode).then(function (url) {
        item.url = url;
      });
    });
    return Promise.all(jobs).then(function () {
      var out = "", last = 0;
      specs.sort(function (a, b) { return a.start - b.start; });
      for (var i = 0; i < specs.length; i++) {
        out += code.slice(last, specs[i].start) + JSON.stringify(specs[i].url);
        last = specs[i].end;
      }
      return out + code.slice(last);
    });
  }

  function resolveModuleSpecifier(spec, base, mode) {
    if (spec === "dumbact") return Promise.resolve(dumbactModuleURL());
    if (/^(?:[a-z][a-z0-9+.-]*:|\/|\.\.?\/)/i.test(spec)) {
      var explicitURL = /^[a-z][a-z0-9+.-]*:/i.test(spec);
      var url = new URL(spec, base || global.location && global.location.href || "http://dumbact.local/").href;

      // Full browser-safe CDN URLs are a user decision. Leave normal JS modules alone
      // so providers such as jsDelivr, unpkg, esm.sh, and Skypack keep native browser
      // module semantics, caching, CORS behavior, and their own internal dependency graph.
      if (explicitURL && /^https?:/i.test(url) && !/\.(tsx|jsx|ts)(?:[?#]|$)/i.test(url)) return Promise.resolve(url);

      if (/^https?:|^file:|^blob:|^data:/.test(url) && /\.(tsx|jsx|ts|mjs|js)(?:[?#]|$)/i.test(url)) return moduleURL(url, inferModeFromUrl(url, mode));
      return Promise.resolve(url);
    }
    return Promise.reject(new Error("Dumbact module import must be relative, absolute, URL, or 'dumbact': " + spec));
  }

  function dumbactModuleURL() {
    if (dumbactModuleUrl) return dumbactModuleUrl;
    var names = ["VERSION","Fragment","h","createElement","jsx","jsxs","jsxDEV","render","mount","unmount","flush","get","peek","need","has","set","del","clear","sub","ids","snapshot","scope","compile","stripTypes","transformJSX","runScripts","runScript","scriptTypes","loadModule","moduleSourceURL"];
    var code = "const D = globalThis.Dumbact;\nif (!D) throw new Error('Dumbact global is missing');\nexport default D;\n";
    for (var i = 0; i < names.length; i++) code += "export const " + names[i] + " = D." + names[i] + ";\n";
    dumbactModuleUrl = objectURL(code + "\n//# sourceURL=dumbact:module");
    return dumbactModuleUrl;
  }

  function objectURL(code) {
    if (!global.Blob || !global.URL || !global.URL.createObjectURL) throw new Error("Dumbact module loader requires Blob and URL.createObjectURL");
    return global.URL.createObjectURL(new global.Blob([code], { type: "text/javascript" }));
  }

  function moduleSpecifiers(code) {
    var out = [], i = 0;
    while (i < code.length) {
      var ch = code[i];
      if (ch === "\"" || ch === "'" || ch === "`") { i = readQuoted(code, i).end + 1; continue; }
      if (ch === "/" && code[i + 1] === "/") { var nl = code.indexOf("\n", i + 2); i = nl < 0 ? code.length : nl; continue; }
      if (ch === "/" && code[i + 1] === "*") { var ce = code.indexOf("*/", i + 2); i = ce < 0 ? code.length : ce + 2; continue; }
      if (wordAt(code, i, "from")) { i = collectAfterFrom(code, i + 4, out); continue; }
      if (wordAt(code, i, "import")) { i = collectAfterImport(code, i + 6, out); continue; }
      i++;
    }
    return out;
  }

  function collectAfterFrom(code, i, out) {
    i = skipSpace(code, i);
    if (code[i] === "\"" || code[i] === "'") return pushSpecifier(code, i, out);
    return i;
  }

  function collectAfterImport(code, i, out) {
    i = skipSpace(code, i);
    if (code[i] === "(" ) { i = skipSpace(code, i + 1); if (code[i] === "\"" || code[i] === "'") return pushSpecifier(code, i, out); return i; }
    if (code[i] === "\"" || code[i] === "'") return pushSpecifier(code, i, out);
    return i;
  }

  function pushSpecifier(code, i, out) {
    var q = readQuoted(code, i);
    out.push({ spec: code.slice(i + 1, q.end), start: i, end: q.end + 1, url: "" });
    return q.end + 1;
  }

  function wordAt(src, i, word) {
    return src.slice(i, i + word.length) === word && !/[A-Za-z0-9_$]/.test(src[i - 1] || "") && !/[A-Za-z0-9_$]/.test(src[i + word.length] || "");
  }

  function scriptMode(script) { return scriptTypes[String(script.getAttribute("type") || "").toLowerCase().trim()] || ""; }
  function boot() { runScripts(global.document).catch(function (error) { if (D.set) D.set("sys:errors", function (old) { return (old || []).concat(error); }); setTimeout(function () { throw error; }, 0); }); }

  D.compile = compile;
  D.stripTypes = stripTypes;
  D.transformJSX = transformJSX;
  D.loadModule = moduleURL;
  D.moduleSourceURL = moduleSourceURL;
  D.runScripts = runScripts;
  D.runScript = runScript;
  D.scriptTypes = scriptTypes;

  if (typeof module !== "undefined" && module.exports) module.exports = D;
  if (global.document) {
    if (global.document.readyState === "loading") global.document.addEventListener("DOMContentLoaded", boot, { once: true });
    else setTimeout(boot, 0);
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
