import {
  require_scheduler
} from "./chunk-HIAG6WYG.js";
import {
  ACESFilmicToneMapping,
  AlwaysDepth,
  BackSide,
  BasicDepthPacking,
  BasicShadowMap,
  BufferAttribute,
  BufferGeometry,
  Clock,
  Color,
  ColorManagement,
  DepthStencilFormat,
  DepthTexture,
  DoubleSide,
  EventDispatcher,
  FloatType,
  FrontSide,
  HalfFloatType,
  Layers,
  LinearFilter,
  LinearSRGBColorSpace,
  Material,
  Matrix4,
  Mesh,
  MeshNormalMaterial,
  NearestFilter,
  NoBlending,
  NoColorSpace,
  NoToneMapping,
  OrthographicCamera,
  PCFShadowMap,
  PCFSoftShadowMap,
  PerspectiveCamera,
  REVISION,
  RGBAFormat,
  Raycaster,
  SRGBColorSpace,
  Scene,
  ShaderMaterial,
  Texture,
  Uniform,
  UnsignedByteType,
  UnsignedInt248Type,
  VSMShadowMap,
  Vector2,
  Vector3,
  WebGLRenderTarget,
  WebGLRenderer,
  three_module_exports
} from "./chunk-JRAYEPSQ.js";
import {
  __commonJS,
  __toESM,
  require_jsx_runtime,
  require_react
} from "./chunk-7HJLIOEM.js";

// node_modules/.pnpm/use-sync-external-store@1.7.0_react@19.3.0/node_modules/use-sync-external-store/cjs/use-sync-external-store-shim.development.js
var require_use_sync_external_store_shim_development = __commonJS({
  "node_modules/.pnpm/use-sync-external-store@1.7.0_react@19.3.0/node_modules/use-sync-external-store/cjs/use-sync-external-store-shim.development.js"(exports) {
    "use strict";
    (function() {
      function is2(x2, y) {
        return x2 === y && (0 !== x2 || 1 / x2 === 1 / y) || x2 !== x2 && y !== y;
      }
      function useSyncExternalStore$2(subscribe, getSnapshot) {
        didWarnOld18Alpha || void 0 === React4.startTransition || (didWarnOld18Alpha = true, console.error(
          "You are using an outdated, pre-release alpha of React 18 that does not support useSyncExternalStore. The use-sync-external-store shim will not work correctly. Upgrade to a newer pre-release."
        ));
        var value = getSnapshot();
        if (!didWarnUncachedGetSnapshot) {
          var cachedValue = getSnapshot();
          objectIs(value, cachedValue) || (console.error(
            "The result of getSnapshot should be cached to avoid an infinite loop"
          ), didWarnUncachedGetSnapshot = true);
        }
        cachedValue = useState5({
          inst: { value, getSnapshot }
        });
        var inst = cachedValue[0].inst, forceUpdate = cachedValue[1];
        useLayoutEffect3(
          function() {
            inst.value = value;
            inst.getSnapshot = getSnapshot;
            checkIfSnapshotChanged(inst) && forceUpdate({ inst });
          },
          [subscribe, value, getSnapshot]
        );
        useEffect4(
          function() {
            checkIfSnapshotChanged(inst) && forceUpdate({ inst });
            return subscribe(function() {
              checkIfSnapshotChanged(inst) && forceUpdate({ inst });
            });
          },
          [subscribe]
        );
        useDebugValue(value);
        return value;
      }
      function checkIfSnapshotChanged(inst) {
        var latestGetSnapshot = inst.getSnapshot;
        inst = inst.value;
        try {
          var nextValue = latestGetSnapshot();
          return !objectIs(inst, nextValue);
        } catch (error) {
          return true;
        }
      }
      function useSyncExternalStore$1(subscribe, getSnapshot) {
        return getSnapshot();
      }
      "undefined" !== typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ && "function" === typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.registerInternalModuleStart && __REACT_DEVTOOLS_GLOBAL_HOOK__.registerInternalModuleStart(Error());
      var React4 = require_react(), objectIs = "function" === typeof Object.is ? Object.is : is2, useState5 = React4.useState, useEffect4 = React4.useEffect, useLayoutEffect3 = React4.useLayoutEffect, useDebugValue = React4.useDebugValue, didWarnOld18Alpha = false, didWarnUncachedGetSnapshot = false, shim = "undefined" === typeof window || "undefined" === typeof window.document || "undefined" === typeof window.document.createElement ? useSyncExternalStore$1 : useSyncExternalStore$2;
      exports.useSyncExternalStore = void 0 !== React4.useSyncExternalStore ? React4.useSyncExternalStore : shim;
      "undefined" !== typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ && "function" === typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.registerInternalModuleStop && __REACT_DEVTOOLS_GLOBAL_HOOK__.registerInternalModuleStop(Error());
    })();
  }
});

// node_modules/.pnpm/use-sync-external-store@1.7.0_react@19.3.0/node_modules/use-sync-external-store/shim/index.js
var require_shim = __commonJS({
  "node_modules/.pnpm/use-sync-external-store@1.7.0_react@19.3.0/node_modules/use-sync-external-store/shim/index.js"(exports, module) {
    "use strict";
    if (false) {
      module.exports = null;
    } else {
      module.exports = require_use_sync_external_store_shim_development();
    }
  }
});

// node_modules/.pnpm/use-sync-external-store@1.7.0_react@19.3.0/node_modules/use-sync-external-store/cjs/use-sync-external-store-shim/with-selector.development.js
var require_with_selector_development = __commonJS({
  "node_modules/.pnpm/use-sync-external-store@1.7.0_react@19.3.0/node_modules/use-sync-external-store/cjs/use-sync-external-store-shim/with-selector.development.js"(exports) {
    "use strict";
    (function() {
      function is2(x2, y) {
        return x2 === y && (0 !== x2 || 1 / x2 === 1 / y) || x2 !== x2 && y !== y;
      }
      "undefined" !== typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ && "function" === typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.registerInternalModuleStart && __REACT_DEVTOOLS_GLOBAL_HOOK__.registerInternalModuleStart(Error());
      var React4 = require_react(), shim = require_shim(), objectIs = "function" === typeof Object.is ? Object.is : is2, useSyncExternalStore = shim.useSyncExternalStore, useRef5 = React4.useRef, useEffect4 = React4.useEffect, useMemo4 = React4.useMemo, useDebugValue = React4.useDebugValue;
      exports.useSyncExternalStoreWithSelector = function(subscribe, getSnapshot, getServerSnapshot, selector, isEqual) {
        var instRef = useRef5(null);
        if (null === instRef.current) {
          var inst = { hasValue: false, value: null };
          instRef.current = inst;
        } else inst = instRef.current;
        instRef = useMemo4(
          function() {
            function memoizedSelector(nextSnapshot) {
              if (!hasMemo) {
                hasMemo = true;
                memoizedSnapshot = nextSnapshot;
                nextSnapshot = selector(nextSnapshot);
                if (void 0 !== isEqual && inst.hasValue) {
                  var currentSelection = inst.value;
                  if (isEqual(currentSelection, nextSnapshot))
                    return memoizedSelection = currentSelection;
                }
                return memoizedSelection = nextSnapshot;
              }
              currentSelection = memoizedSelection;
              if (objectIs(memoizedSnapshot, nextSnapshot))
                return currentSelection;
              var nextSelection = selector(nextSnapshot);
              if (void 0 !== isEqual && isEqual(currentSelection, nextSelection))
                return memoizedSnapshot = nextSnapshot, currentSelection;
              memoizedSnapshot = nextSnapshot;
              return memoizedSelection = nextSelection;
            }
            var hasMemo = false, memoizedSnapshot, memoizedSelection, maybeGetServerSnapshot = void 0 === getServerSnapshot ? null : getServerSnapshot;
            return [
              function() {
                return memoizedSelector(getSnapshot());
              },
              null === maybeGetServerSnapshot ? void 0 : function() {
                return memoizedSelector(maybeGetServerSnapshot());
              }
            ];
          },
          [getSnapshot, getServerSnapshot, selector, isEqual]
        );
        var value = useSyncExternalStore(subscribe, instRef[0], instRef[1]);
        useEffect4(
          function() {
            inst.hasValue = true;
            inst.value = value;
          },
          [value]
        );
        useDebugValue(value);
        return value;
      };
      "undefined" !== typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ && "function" === typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.registerInternalModuleStop && __REACT_DEVTOOLS_GLOBAL_HOOK__.registerInternalModuleStop(Error());
    })();
  }
});

// node_modules/.pnpm/use-sync-external-store@1.7.0_react@19.3.0/node_modules/use-sync-external-store/shim/with-selector.js
var require_with_selector = __commonJS({
  "node_modules/.pnpm/use-sync-external-store@1.7.0_react@19.3.0/node_modules/use-sync-external-store/shim/with-selector.js"(exports, module) {
    "use strict";
    if (false) {
      module.exports = null;
    } else {
      module.exports = require_with_selector_development();
    }
  }
});

// mockups/voice/before/source/Dither.tsx
var import_react6 = __toESM(require_react(), 1);

// node_modules/.pnpm/@react-three+fiber@9.8.1_@types+react@19.3.0_react-dom@19.3.0_react@19.3.0__react@19.3.0_three@0.186.1/node_modules/@react-three/fiber/dist/events-9ce18a08.esm.js
var React2 = __toESM(require_react());
var import_react3 = __toESM(require_react());
var import_jsx_runtime = __toESM(require_jsx_runtime());

// node_modules/.pnpm/zustand@5.0.15_@types+react@19.3.0_react@19.3.0_use-sync-external-store@1.7.0_react@19.3.0_/node_modules/zustand/esm/traditional.mjs
var import_react = __toESM(require_react(), 1);
var import_with_selector = __toESM(require_with_selector(), 1);

// node_modules/.pnpm/zustand@5.0.15_@types+react@19.3.0_react@19.3.0_use-sync-external-store@1.7.0_react@19.3.0_/node_modules/zustand/esm/vanilla.mjs
var createStoreImpl = (createState) => {
  let state2;
  const listeners = /* @__PURE__ */ new Set();
  const setState = (partial, replace) => {
    const nextState = typeof partial === "function" ? partial(state2) : partial;
    if (!Object.is(nextState, state2)) {
      const previousState = state2;
      state2 = (replace != null ? replace : typeof nextState !== "object" || nextState === null) ? nextState : Object.assign({}, state2, nextState);
      listeners.forEach((listener) => listener(state2, previousState));
    }
  };
  const getState = () => state2;
  const getInitialState = () => initialState;
  const subscribe = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  const api = { setState, getState, getInitialState, subscribe };
  const initialState = state2 = createState(setState, getState, api);
  return api;
};
var createStore = ((createState) => createState ? createStoreImpl(createState) : createStoreImpl);

// node_modules/.pnpm/zustand@5.0.15_@types+react@19.3.0_react@19.3.0_use-sync-external-store@1.7.0_react@19.3.0_/node_modules/zustand/esm/traditional.mjs
var { useSyncExternalStoreWithSelector } = import_with_selector.default;
var identity = (arg) => arg;
function useStoreWithEqualityFn(api, selector = identity, equalityFn) {
  const slice = useSyncExternalStoreWithSelector(
    api.subscribe,
    api.getState,
    api.getInitialState,
    selector,
    equalityFn
  );
  import_react.default.useDebugValue(slice);
  return slice;
}
var createWithEqualityFnImpl = (createState, defaultEqualityFn) => {
  const api = createStore(createState);
  const useBoundStoreWithEqualityFn = (selector, equalityFn = defaultEqualityFn) => useStoreWithEqualityFn(api, selector, equalityFn);
  Object.assign(useBoundStoreWithEqualityFn, api);
  return useBoundStoreWithEqualityFn;
};
var createWithEqualityFn = ((createState, defaultEqualityFn) => createState ? createWithEqualityFnImpl(createState, defaultEqualityFn) : createWithEqualityFnImpl);

// node_modules/.pnpm/suspend-react@0.1.3_react@19.3.0/node_modules/suspend-react/index.js
var isPromise = (promise) => typeof promise === "object" && typeof promise.then === "function";
var globalCache = [];
function shallowEqualArrays(arrA, arrB, equal = (a, b2) => a === b2) {
  if (arrA === arrB) return true;
  if (!arrA || !arrB) return false;
  const len = arrA.length;
  if (arrB.length !== len) return false;
  for (let i3 = 0; i3 < len; i3++) if (!equal(arrA[i3], arrB[i3])) return false;
  return true;
}
function query(fn, keys = null, preload2 = false, config = {}) {
  if (keys === null) keys = [fn];
  for (const entry2 of globalCache) {
    if (shallowEqualArrays(keys, entry2.keys, entry2.equal)) {
      if (preload2) return void 0;
      if (Object.prototype.hasOwnProperty.call(entry2, "error")) throw entry2.error;
      if (Object.prototype.hasOwnProperty.call(entry2, "response")) {
        if (config.lifespan && config.lifespan > 0) {
          if (entry2.timeout) clearTimeout(entry2.timeout);
          entry2.timeout = setTimeout(entry2.remove, config.lifespan);
        }
        return entry2.response;
      }
      if (!preload2) throw entry2.promise;
    }
  }
  const entry = {
    keys,
    equal: config.equal,
    remove: () => {
      const index2 = globalCache.indexOf(entry);
      if (index2 !== -1) globalCache.splice(index2, 1);
    },
    promise: (
      // Execute the promise
      (isPromise(fn) ? fn : fn(...keys)).then((response) => {
        entry.response = response;
        if (config.lifespan && config.lifespan > 0) {
          entry.timeout = setTimeout(entry.remove, config.lifespan);
        }
      }).catch((error) => entry.error = error)
    )
  };
  globalCache.push(entry);
  if (!preload2) throw entry.promise;
  return void 0;
}
var suspend = (fn, keys, config) => query(fn, keys, false, config);
var preload = (fn, keys, config) => void query(fn, keys, true, config);
var clear = (keys) => {
  if (keys === void 0 || keys.length === 0) globalCache.splice(0, globalCache.length);
  else {
    const entry = globalCache.find((entry2) => shallowEqualArrays(keys, entry2.keys, entry2.equal));
    if (entry) entry.remove();
  }
};

// node_modules/.pnpm/@react-three+fiber@9.8.1_@types+react@19.3.0_react-dom@19.3.0_react@19.3.0__react@19.3.0_three@0.186.1/node_modules/@react-three/fiber/dist/events-9ce18a08.esm.js
var import_scheduler = __toESM(require_scheduler());

// node_modules/.pnpm/its-fine@2.1.1_@types+react@19.3.0_react@19.3.0/node_modules/its-fine/dist/index.js
var import_react2 = __toESM(require_react(), 1);
var v = /* @__PURE__ */ (() => {
  var e2, t2;
  return typeof window != "undefined" && (((e2 = window.document) == null ? void 0 : e2.createElement) || ((t2 = window.navigator) == null ? void 0 : t2.product) === "ReactNative");
})() ? import_react2.default.useLayoutEffect : import_react2.default.useEffect;
function l(e2, t2, i3) {
  if (!e2) return;
  if (i3(e2) === true) return e2;
  let n = t2 ? e2.return : e2.child;
  for (; n; ) {
    const o2 = l(n, t2, i3);
    if (o2) return o2;
    n = t2 ? null : n.sibling;
  }
}
function b(e2) {
  try {
    return Object.defineProperties(e2, {
      _currentRenderer: {
        get() {
          return null;
        },
        set() {
        }
      },
      _currentRenderer2: {
        get() {
          return null;
        },
        set() {
        }
      }
    });
  } catch (t2) {
    return e2;
  }
}
var p = /* @__PURE__ */ b(/* @__PURE__ */ import_react2.default.createContext(null));
var h = class extends import_react2.default.Component {
  render() {
    return /* @__PURE__ */ import_react2.default.createElement(p.Provider, { value: this._reactInternals }, this.props.children);
  }
};
function m() {
  const e2 = import_react2.default.useContext(p);
  if (e2 === null) throw new Error("its-fine: useFiber must be called within a <FiberProvider />!");
  const t2 = import_react2.default.useId();
  return import_react2.default.useMemo(() => {
    for (const n of [e2, e2 == null ? void 0 : e2.alternate]) {
      if (!n) continue;
      const o2 = l(n, false, (d) => {
        let s = d.memoizedState;
        for (; s; ) {
          if (s.memoizedState === t2) return true;
          s = s.next;
        }
      });
      if (o2) return o2;
    }
  }, [e2, t2]);
}
var w = /* @__PURE__ */ Symbol.for("react.context");
var E = (e2) => e2 !== null && typeof e2 == "object" && "$$typeof" in e2 && e2.$$typeof === w;
function g() {
  const e2 = m(), [t2] = import_react2.default.useState(() => /* @__PURE__ */ new Map());
  t2.clear();
  let i3 = e2;
  for (; i3; ) {
    const n = i3.type;
    E(n) && n !== p && !t2.has(n) && t2.set(n, import_react2.default.use(b(n))), i3 = i3.return;
  }
  return t2;
}
function M() {
  const e2 = g();
  return import_react2.default.useMemo(
    () => Array.from(e2.keys()).reduce(
      (t2, i3) => (n) => /* @__PURE__ */ import_react2.default.createElement(t2, null, /* @__PURE__ */ import_react2.default.createElement(i3.Provider, { ...n, value: e2.get(i3) })),
      (t2) => /* @__PURE__ */ import_react2.default.createElement(h, { ...t2 })
    ),
    [e2]
  );
}
function x(e2) {
  if (typeof requestAnimationFrame == "function") {
    const i3 = requestAnimationFrame(e2);
    return () => cancelAnimationFrame(i3);
  }
  const t2 = setTimeout(e2, 16);
  return () => clearTimeout(t2);
}
function N() {
  if (!import_react2.default.Activity) throw new Error("its-fine: useActivityBridge requires React 19.2 or later!");
  const e2 = m(), [t2] = import_react2.default.useState(() => {
    const i3 = [];
    let n = false;
    l(e2, true, (u2) => {
      var c, a;
      if (u2.elementType === import_react2.default.Activity) {
        const y = ((c = u2.child) == null ? void 0 : c.tag) === 22 ? u2.child.stateNode : null;
        if (typeof (y == null ? void 0 : y._visibility) != "number")
          throw new Error("its-fine: unsupported React Activity internals!");
        i3.push(y);
      } else u2.tag === 22 && ((a = u2.return) == null ? void 0 : a.elementType) !== import_react2.default.Activity && (n = true);
    });
    let o2 = "hidden";
    const d = /* @__PURE__ */ new Set();
    let s;
    const f = {
      mounted: false,
      connected: false,
      subscribe(u2) {
        return d.add(u2), () => {
          d.delete(u2);
        };
      },
      sync(u2) {
        f.mounted && !f.connected && n && i3.length > 0 ? s || (s = x(() => {
          s = void 0, f.sync(true);
        })) : (s == null || s(), s = void 0);
        let c = o2;
        if (f.mounted ? f.connected ? c = "visible" : u2 && (c = i3.every((a) => (a._visibility & 1) !== 0) ? "visible" : "hidden") : c = "hidden", o2 !== c) {
          o2 = c;
          for (const a of d) a();
        }
      },
      Bridge({ children: u2 }) {
        return /* @__PURE__ */ import_react2.default.createElement(
          import_react2.default.Activity,
          {
            mode: import_react2.default.useSyncExternalStore(
              f.subscribe,
              () => o2,
              () => "hidden"
            )
          },
          u2
        );
      }
    };
    return f;
  });
  return import_react2.default.useInsertionEffect(() => (t2.mounted = true, queueMicrotask(() => t2.sync(false)), () => {
    t2.mounted = false, queueMicrotask(() => t2.sync(false));
  }), [t2]), import_react2.default.useLayoutEffect(() => (t2.connected = true, t2.sync(false), () => {
    t2.connected = false, t2.sync(true);
  }), [t2]), t2.Bridge;
}

// node_modules/.pnpm/@react-three+fiber@9.8.1_@types+react@19.3.0_react-dom@19.3.0_react@19.3.0__react@19.3.0_three@0.186.1/node_modules/@react-three/fiber/dist/events-9ce18a08.esm.js
function findInitialRoot(instance) {
  let root = instance.root;
  while (root.getState().previousRoot) root = root.getState().previousRoot;
  return root;
}
var isOrthographicCamera = (def) => def && def.isOrthographicCamera;
var isRef = (obj) => obj && obj.hasOwnProperty("current");
var isColorRepresentation = (value) => value != null && (typeof value === "string" || typeof value === "number" || value.isColor);
var useIsomorphicLayoutEffect = /* @__PURE__ */ ((_window$document, _window$navigator) => typeof window !== "undefined" && (((_window$document = window.document) == null ? void 0 : _window$document.createElement) || ((_window$navigator = window.navigator) == null ? void 0 : _window$navigator.product) === "ReactNative"))() ? React2.useLayoutEffect : React2.useEffect;
function useMutableCallback(fn) {
  const ref = React2.useRef(fn);
  useIsomorphicLayoutEffect(() => void (ref.current = fn), [fn]);
  return ref;
}
var noop = () => {
};
function Gate({
  promise,
  onSettled
}) {
  React2.use(promise);
  useIsomorphicLayoutEffect(onSettled, [onSettled]);
  return null;
}
function useGate() {
  const [promise, setPromise] = React2.useState(null);
  const onSettled = React2.useCallback(() => setPromise(null), []);
  const waitFor = React2.useCallback((next) => setPromise((current) => current != null ? current : Promise.resolve(next).then(noop, noop)), []);
  const gate = promise ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(React2.Suspense, {
    fallback: null,
    children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Gate, {
      promise,
      onSettled
    })
  }) : null;
  return [gate, waitFor];
}
var useActivityBridge = React2["Activity"] ? N : () => React2.Fragment;
function useBridge() {
  const fiber = m();
  const ContextBridge = M();
  const ActivityBridge = useActivityBridge();
  return React2.useMemo(() => ({
    children
  }) => {
    const strict = !!l(fiber, true, (node) => node.type === React2.StrictMode);
    const Root = strict ? React2.StrictMode : React2.Fragment;
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Root, {
      children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ActivityBridge, {
        children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ContextBridge, {
          children
        })
      })
    });
  }, [fiber, ContextBridge, ActivityBridge]);
}
function Block({
  set
}) {
  useIsomorphicLayoutEffect(() => {
    set(new Promise(() => null));
    return () => set(false);
  }, [set]);
  return null;
}
var ErrorBoundary = /* @__PURE__ */ ((_ErrorBoundary) => (_ErrorBoundary = class ErrorBoundary extends React2.Component {
  constructor(...args) {
    super(...args);
    this.state = {
      error: false
    };
  }
  componentDidCatch(err) {
    this.props.set(err);
  }
  render() {
    return this.state.error ? null : this.props.children;
  }
}, _ErrorBoundary.getDerivedStateFromError = () => ({
  error: true
}), _ErrorBoundary))();
function calculateDpr(dpr) {
  var _window$devicePixelRa;
  const target = typeof window !== "undefined" ? (_window$devicePixelRa = window.devicePixelRatio) != null ? _window$devicePixelRa : 2 : 1;
  return Array.isArray(dpr) ? Math.min(Math.max(dpr[0], target), dpr[1]) : dpr;
}
function getRootState(obj) {
  var _r3f;
  return (_r3f = obj.__r3f) == null ? void 0 : _r3f.root.getState();
}
var is = {
  obj: (a) => a === Object(a) && !is.arr(a) && typeof a !== "function",
  fun: (a) => typeof a === "function",
  str: (a) => typeof a === "string",
  num: (a) => typeof a === "number",
  boo: (a) => typeof a === "boolean",
  und: (a) => a === void 0,
  nul: (a) => a === null,
  arr: (a) => Array.isArray(a),
  equ(a, b2, {
    arrays = "shallow",
    objects = "reference",
    strict = true
  } = {}) {
    if (typeof a !== typeof b2 || !!a !== !!b2) return false;
    if (is.str(a) || is.num(a) || is.boo(a)) return a === b2;
    const isObj = is.obj(a);
    if (isObj && objects === "reference") return a === b2;
    const isArr = is.arr(a);
    if (isArr && arrays === "reference") return a === b2;
    if ((isArr || isObj) && a === b2) return true;
    let i3;
    for (i3 in a) if (!(i3 in b2)) return false;
    if (isObj && arrays === "shallow" && objects === "shallow") {
      for (i3 in strict ? b2 : a) if (!is.equ(a[i3], b2[i3], {
        strict,
        objects: "reference"
      })) return false;
    } else {
      for (i3 in strict ? b2 : a) if (a[i3] !== b2[i3]) return false;
    }
    if (is.und(i3)) {
      if (isArr && a.length === 0 && b2.length === 0) return true;
      if (isObj && Object.keys(a).length === 0 && Object.keys(b2).length === 0) return true;
      if (a !== b2) return false;
    }
    return true;
  }
};
function buildGraph(object) {
  const data = {
    nodes: {},
    materials: {},
    meshes: {}
  };
  if (object) {
    object.traverse((obj) => {
      if (obj.name) data.nodes[obj.name] = obj;
      if (obj.material && !data.materials[obj.material.name]) data.materials[obj.material.name] = obj.material;
      if (obj.isMesh && !data.meshes[obj.name]) data.meshes[obj.name] = obj;
    });
  }
  return data;
}
function dispose(obj) {
  if (obj.type !== "Scene") obj.dispose == null ? void 0 : obj.dispose();
  for (const p4 in obj) {
    const prop = obj[p4];
    if ((prop == null ? void 0 : prop.type) !== "Scene") prop == null ? void 0 : prop.dispose == null ? void 0 : prop.dispose();
  }
}
var REACT_INTERNAL_PROPS = ["children", "key", "ref"];
function getInstanceProps(pendingProps) {
  const props = {};
  for (const key in pendingProps) {
    if (!REACT_INTERNAL_PROPS.includes(key)) props[key] = pendingProps[key];
  }
  return props;
}
function prepare(target, root, type, props) {
  const object = target;
  let instance = object == null ? void 0 : object.__r3f;
  if (!instance) {
    instance = {
      root,
      type,
      parent: null,
      children: [],
      props: getInstanceProps(props),
      object,
      eventCount: 0,
      handlers: {},
      previousVisible: void 0,
      isHidden: false
    };
    if (object) object.__r3f = instance;
  }
  return instance;
}
function resolve(root, key) {
  if (!key.includes("-")) return {
    root,
    key,
    target: root[key]
  };
  if (key in root) {
    return {
      root,
      key,
      target: root[key]
    };
  }
  let target = root;
  const parts = key.split("-");
  for (const part of parts) {
    if (typeof target !== "object" || target === null) {
      if (target !== void 0) {
        const remaining = parts.slice(parts.indexOf(part)).join("-");
        return {
          root: target,
          key: remaining,
          target: void 0
        };
      }
      return {
        root,
        key,
        target: void 0
      };
    }
    key = part;
    root = target;
    target = target[key];
  }
  return {
    root,
    key,
    target
  };
}
var INDEX_REGEX = /-\d+$/;
function attach(parent, child) {
  if (is.str(child.props.attach)) {
    if (INDEX_REGEX.test(child.props.attach)) {
      const index2 = child.props.attach.replace(INDEX_REGEX, "");
      const {
        root: root2,
        key: key2
      } = resolve(parent.object, index2);
      if (!Array.isArray(root2[key2])) root2[key2] = [];
    }
    const {
      root,
      key
    } = resolve(parent.object, child.props.attach);
    child.previousAttach = root[key];
    root[key] = child.object;
  } else if (is.fun(child.props.attach)) {
    child.previousAttach = child.props.attach(parent.object, child.object);
  }
}
function detach(parent, child) {
  if (is.str(child.props.attach)) {
    const {
      root,
      key
    } = resolve(parent.object, child.props.attach);
    const previous = child.previousAttach;
    if (previous === void 0) delete root[key];
    else root[key] = previous;
  } else {
    child.previousAttach == null ? void 0 : child.previousAttach(parent.object, child.object);
  }
  delete child.previousAttach;
}
var RESERVED_PROPS = [
  ...REACT_INTERNAL_PROPS,
  // Instance props
  "args",
  "dispose",
  "attach",
  "object",
  "onUpdate",
  // Behavior flags
  "dispose"
];
var MEMOIZED_PROTOTYPES = /* @__PURE__ */ new Map();
function getMemoizedPrototype(root) {
  let ctor = MEMOIZED_PROTOTYPES.get(root.constructor);
  try {
    if (!ctor) {
      ctor = new root.constructor();
      MEMOIZED_PROTOTYPES.set(root.constructor, ctor);
    }
  } catch (e2) {
  }
  return ctor;
}
function diffProps(instance, newProps) {
  const changedProps = {};
  for (const prop in newProps) {
    if (RESERVED_PROPS.includes(prop)) continue;
    if (is.equ(newProps[prop], instance.props[prop])) continue;
    changedProps[prop] = newProps[prop];
    for (const other in newProps) {
      if (other.startsWith(`${prop}-`)) changedProps[other] = newProps[other];
    }
  }
  for (const prop in instance.props) {
    if (RESERVED_PROPS.includes(prop) || newProps.hasOwnProperty(prop)) continue;
    const {
      root,
      key
    } = resolve(instance.object, prop);
    if (root.constructor && root.constructor.length === 0) {
      const ctor = getMemoizedPrototype(root);
      if (!is.und(ctor)) changedProps[prop] = ctor[key];
    } else {
      changedProps[prop] = 0;
    }
  }
  return changedProps;
}
var colorMaps = ["map", "emissiveMap", "sheenColorMap", "specularColorMap", "envMap"];
var EVENT_REGEX = /^on(Pointer|Click|DoubleClick|ContextMenu|Wheel)/;
function applyProps(object, props) {
  var _instance$object;
  const instance = object.__r3f;
  const rootState = instance && findInitialRoot(instance).getState();
  const prevHandlers = instance == null ? void 0 : instance.eventCount;
  for (const prop in props) {
    let value = props[prop];
    if (RESERVED_PROPS.includes(prop)) continue;
    if (instance && EVENT_REGEX.test(prop)) {
      if (typeof value === "function") instance.handlers[prop] = value;
      else delete instance.handlers[prop];
      instance.eventCount = Object.keys(instance.handlers).length;
      continue;
    }
    if (value === void 0) continue;
    if (prop === "visible" && instance != null && instance.isHidden && instance.previousVisible !== void 0) {
      instance.previousVisible = value;
      continue;
    }
    let {
      root,
      key,
      target
    } = resolve(object, prop);
    if (target === void 0 && (typeof root !== "object" || root === null)) {
      throw Error(`R3F: Cannot set "${prop}". Ensure it is an object before setting "${key}".`);
    }
    if (target instanceof Layers && value instanceof Layers) {
      target.mask = value.mask;
    } else if (target instanceof Color && isColorRepresentation(value)) {
      target.set(value);
    } else if (target !== null && typeof target === "object" && typeof target.set === "function" && typeof target.copy === "function" && value != null && value.constructor && target.constructor === value.constructor) {
      target.copy(value);
    } else if (target !== null && typeof target === "object" && typeof target.set === "function" && Array.isArray(value)) {
      if (typeof target.fromArray === "function") target.fromArray(value);
      else target.set(...value);
    } else if (target !== null && typeof target === "object" && typeof target.set === "function" && typeof value === "number") {
      if (typeof target.setScalar === "function") target.setScalar(value);
      else target.set(value);
    } else if (root instanceof ShaderMaterial && key === "uniforms" && is.obj(value)) {
      if (!is.obj(root.uniforms)) root.uniforms = {};
      const uniforms = root.uniforms;
      const nextUniforms = value;
      for (const name in nextUniforms) {
        const uniform = nextUniforms[name];
        const targetUniform = uniforms[name];
        if (targetUniform) Object.assign(targetUniform, uniform);
        else uniforms[name] = {
          ...uniform
        };
      }
    } else {
      var _root$key;
      root[key] = value;
      if (rootState && !rootState.linear && colorMaps.includes(key) && (_root$key = root[key]) != null && _root$key.isTexture && // sRGB textures must be RGBA8 since r137 https://github.com/mrdoob/three.js/pull/23129
      root[key].format === RGBAFormat && root[key].type === UnsignedByteType) {
        root[key].colorSpace = SRGBColorSpace;
      }
    }
  }
  if (instance != null && instance.parent && rootState != null && rootState.internal && (_instance$object = instance.object) != null && _instance$object.isObject3D && prevHandlers !== instance.eventCount) {
    const object2 = instance.object;
    const index2 = rootState.internal.interaction.indexOf(object2);
    if (index2 > -1) rootState.internal.interaction.splice(index2, 1);
    if (instance.eventCount && object2.raycast !== null) {
      rootState.internal.interaction.push(object2);
    }
  }
  if (instance && instance.props.attach === void 0) {
    if (instance.object.isBufferGeometry) instance.props.attach = "geometry";
    else if (instance.object.isMaterial) instance.props.attach = "material";
  }
  if (instance) invalidateInstance(instance);
  return object;
}
function invalidateInstance(instance) {
  var _instance$root;
  if (!instance.parent) return;
  instance.props.onUpdate == null ? void 0 : instance.props.onUpdate(instance.object);
  const state2 = (_instance$root = instance.root) == null ? void 0 : _instance$root.getState == null ? void 0 : _instance$root.getState();
  if (state2 && state2.internal.frames === 0) state2.invalidate();
}
function updateCamera(camera, size) {
  if (camera.manual) return;
  if (isOrthographicCamera(camera)) {
    camera.left = size.width / -2;
    camera.right = size.width / 2;
    camera.top = size.height / 2;
    camera.bottom = size.height / -2;
  } else {
    camera.aspect = size.width / size.height;
  }
  camera.updateProjectionMatrix();
}
var isObject3D = (object) => object == null ? void 0 : object.isObject3D;
function makeId(event) {
  return (event.eventObject || event.object).uuid + "/" + event.index + event.instanceId;
}
function releaseInternalPointerCapture(capturedMap, obj, captures, pointerId) {
  const captureData = captures.get(obj);
  if (captureData) {
    captures.delete(obj);
    if (captures.size === 0) {
      capturedMap.delete(pointerId);
      captureData.target.releasePointerCapture(pointerId);
    }
  }
}
function swapInteractivity(store, object, newObject) {
  const {
    internal
  } = store.getState();
  for (let i3 = 0; i3 < internal.interaction.length; i3++) {
    if (internal.interaction[i3] === object) internal.interaction[i3] = newObject;
  }
  for (let i3 = 0; i3 < internal.initialHits.length; i3++) {
    if (internal.initialHits[i3] === object) internal.initialHits[i3] = newObject;
  }
  internal.hovered.forEach((value, key) => {
    if (value.eventObject === object || value.object === object) {
      internal.hovered.delete(key);
      const next = {
        ...value,
        eventObject: value.eventObject === object ? newObject : value.eventObject,
        object: value.object === object ? newObject : value.object
      };
      internal.hovered.set(makeId(next), next);
    }
  });
  internal.capturedMap.forEach((captures) => {
    const captureData = captures.get(object);
    if (captureData) {
      captures.delete(object);
      captures.set(newObject, captureData);
    }
  });
}
function removeInteractivity(store, object) {
  const {
    internal
  } = store.getState();
  internal.interaction = internal.interaction.filter((o2) => o2 !== object);
  internal.initialHits = internal.initialHits.filter((o2) => o2 !== object);
  internal.hovered.forEach((value, key) => {
    if (value.eventObject === object || value.object === object) {
      internal.hovered.delete(key);
    }
  });
  internal.capturedMap.forEach((captures, pointerId) => {
    releaseInternalPointerCapture(internal.capturedMap, object, captures, pointerId);
  });
}
function createEvents(store) {
  function calculateDistance(event) {
    const {
      internal
    } = store.getState();
    const dx = event.offsetX - internal.initialClick[0];
    const dy = event.offsetY - internal.initialClick[1];
    return Math.round(Math.sqrt(dx * dx + dy * dy));
  }
  function filterPointerEvents(objects) {
    return objects.filter((obj) => ["Move", "Over", "Enter", "Out", "Leave"].some((name) => {
      var _r3f;
      return (_r3f = obj.__r3f) == null ? void 0 : _r3f.handlers["onPointer" + name];
    }));
  }
  function intersect(event, filter) {
    const state2 = store.getState();
    const duplicates = /* @__PURE__ */ new Set();
    const intersections = [];
    const eventsObjects = filter ? filter(state2.internal.interaction) : state2.internal.interaction;
    for (let i3 = 0; i3 < eventsObjects.length; i3++) {
      const state3 = getRootState(eventsObjects[i3]);
      if (state3) {
        state3.raycaster.camera = void 0;
      }
    }
    if (!state2.previousRoot) {
      state2.events.compute == null ? void 0 : state2.events.compute(event, state2);
    }
    function handleRaycast(obj) {
      const state3 = getRootState(obj);
      if (!state3 || !state3.events.enabled || state3.raycaster.camera === null) return [];
      if (state3.raycaster.camera === void 0) {
        var _state$previousRoot;
        state3.events.compute == null ? void 0 : state3.events.compute(event, state3, (_state$previousRoot = state3.previousRoot) == null ? void 0 : _state$previousRoot.getState());
        if (state3.raycaster.camera === void 0) state3.raycaster.camera = null;
      }
      return state3.raycaster.camera ? state3.raycaster.intersectObject(obj, true) : [];
    }
    let hits = eventsObjects.flatMap(handleRaycast).sort((a, b2) => {
      const aState = getRootState(a.object);
      const bState = getRootState(b2.object);
      if (!aState || !bState) return a.distance - b2.distance;
      return bState.events.priority - aState.events.priority || a.distance - b2.distance;
    }).filter((item) => {
      const id = makeId(item);
      if (duplicates.has(id)) return false;
      duplicates.add(id);
      return true;
    });
    if (state2.events.filter) hits = state2.events.filter(hits, state2);
    for (const hit of hits) {
      let eventObject = hit.object;
      while (eventObject) {
        var _r3f2;
        if ((_r3f2 = eventObject.__r3f) != null && _r3f2.eventCount) intersections.push({
          ...hit,
          eventObject
        });
        eventObject = eventObject.parent;
      }
    }
    if ("pointerId" in event && state2.internal.capturedMap.has(event.pointerId)) {
      for (let captureData of state2.internal.capturedMap.get(event.pointerId).values()) {
        if (!duplicates.has(makeId(captureData.intersection))) intersections.push(captureData.intersection);
      }
    }
    return intersections;
  }
  function handleIntersects(intersections, event, delta, callback) {
    if (intersections.length) {
      const localState = {
        stopped: false
      };
      for (const hit of intersections) {
        let state2 = getRootState(hit.object);
        if (!state2) {
          hit.object.traverseAncestors((obj) => {
            const parentState = getRootState(obj);
            if (parentState) {
              state2 = parentState;
              return false;
            }
          });
        }
        if (state2) {
          const {
            raycaster,
            pointer,
            camera,
            internal
          } = state2;
          const unprojectedPoint = new Vector3(pointer.x, pointer.y, 0).unproject(camera);
          const hasPointerCapture = (id) => {
            var _internal$capturedMap, _internal$capturedMap2;
            return (_internal$capturedMap = (_internal$capturedMap2 = internal.capturedMap.get(id)) == null ? void 0 : _internal$capturedMap2.has(hit.eventObject)) != null ? _internal$capturedMap : false;
          };
          const setPointerCapture = (id) => {
            const captureData = {
              intersection: hit,
              target: event.target
            };
            if (internal.capturedMap.has(id)) {
              internal.capturedMap.get(id).set(hit.eventObject, captureData);
            } else {
              internal.capturedMap.set(id, /* @__PURE__ */ new Map([[hit.eventObject, captureData]]));
            }
            event.target.setPointerCapture(id);
          };
          const releasePointerCapture = (id) => {
            const captures = internal.capturedMap.get(id);
            if (captures) {
              releaseInternalPointerCapture(internal.capturedMap, hit.eventObject, captures, id);
            }
          };
          let extractEventProps = {};
          for (let prop in event) {
            let property = event[prop];
            if (typeof property !== "function") extractEventProps[prop] = property;
          }
          let raycastEvent = {
            ...hit,
            ...extractEventProps,
            pointer,
            intersections,
            stopped: localState.stopped,
            delta,
            unprojectedPoint,
            ray: raycaster.ray,
            camera,
            // Hijack stopPropagation, which just sets a flag
            stopPropagation() {
              const capturesForPointer = "pointerId" in event && internal.capturedMap.get(event.pointerId);
              if (
                // ...if this pointer hasn't been captured
                !capturesForPointer || // ... or if the hit object is capturing the pointer
                capturesForPointer.has(hit.eventObject)
              ) {
                raycastEvent.stopped = localState.stopped = true;
                if (internal.hovered.size && Array.from(internal.hovered.values()).find((i3) => i3.eventObject === hit.eventObject)) {
                  const higher = intersections.slice(0, intersections.indexOf(hit));
                  cancelPointer([...higher, hit]);
                }
              }
            },
            // there should be a distinction between target and currentTarget
            target: {
              hasPointerCapture,
              setPointerCapture,
              releasePointerCapture
            },
            currentTarget: {
              hasPointerCapture,
              setPointerCapture,
              releasePointerCapture
            },
            nativeEvent: event
          };
          callback(raycastEvent);
          if (localState.stopped === true) break;
        }
      }
    }
    return intersections;
  }
  function cancelPointer(intersections) {
    const {
      internal
    } = store.getState();
    for (const hoveredObj of internal.hovered.values()) {
      if (!intersections.length || !intersections.find((hit) => hit.object === hoveredObj.object && hit.index === hoveredObj.index && hit.instanceId === hoveredObj.instanceId)) {
        const eventObject = hoveredObj.eventObject;
        const instance = eventObject.__r3f;
        internal.hovered.delete(makeId(hoveredObj));
        if (instance != null && instance.eventCount) {
          const handlers = instance.handlers;
          const data = {
            ...hoveredObj,
            intersections
          };
          handlers.onPointerOut == null ? void 0 : handlers.onPointerOut(data);
          handlers.onPointerLeave == null ? void 0 : handlers.onPointerLeave(data);
        }
      }
    }
  }
  function pointerMissed(event, objects) {
    for (let i3 = 0; i3 < objects.length; i3++) {
      const instance = objects[i3].__r3f;
      instance == null ? void 0 : instance.handlers.onPointerMissed == null ? void 0 : instance.handlers.onPointerMissed(event);
    }
  }
  function handlePointer(name) {
    switch (name) {
      case "onPointerLeave":
      case "onPointerCancel":
        return () => cancelPointer([]);
      case "onLostPointerCapture":
        return (event) => {
          const {
            internal
          } = store.getState();
          if ("pointerId" in event && internal.capturedMap.has(event.pointerId)) {
            requestAnimationFrame(() => {
              if (internal.capturedMap.has(event.pointerId)) {
                internal.capturedMap.delete(event.pointerId);
                cancelPointer([]);
              }
            });
          }
        };
    }
    return function handleEvent(event) {
      const {
        onPointerMissed,
        internal
      } = store.getState();
      internal.lastEvent.current = event;
      const isPointerMove = name === "onPointerMove";
      const isClickEvent = name === "onClick" || name === "onContextMenu" || name === "onDoubleClick";
      const filter = isPointerMove ? filterPointerEvents : void 0;
      const hits = intersect(event, filter);
      const delta = isClickEvent ? calculateDistance(event) : 0;
      if (name === "onPointerDown") {
        internal.initialClick = [event.offsetX, event.offsetY];
        internal.initialHits = hits.map((hit) => hit.eventObject);
      }
      if (isClickEvent && !hits.length) {
        if (delta <= 2) {
          pointerMissed(event, internal.interaction);
          if (onPointerMissed) onPointerMissed(event);
        }
      }
      if (isPointerMove) cancelPointer(hits);
      function onIntersect(data) {
        const eventObject = data.eventObject;
        const instance = eventObject.__r3f;
        if (!(instance != null && instance.eventCount)) return;
        const handlers = instance.handlers;
        if (isPointerMove) {
          if (handlers.onPointerOver || handlers.onPointerEnter || handlers.onPointerOut || handlers.onPointerLeave) {
            const id = makeId(data);
            const hoveredItem = internal.hovered.get(id);
            if (!hoveredItem) {
              internal.hovered.set(id, data);
              handlers.onPointerOver == null ? void 0 : handlers.onPointerOver(data);
              handlers.onPointerEnter == null ? void 0 : handlers.onPointerEnter(data);
            } else if (hoveredItem.stopped) {
              data.stopPropagation();
            }
          }
          handlers.onPointerMove == null ? void 0 : handlers.onPointerMove(data);
        } else {
          const handler = handlers[name];
          if (handler) {
            if (!isClickEvent || internal.initialHits.includes(eventObject)) {
              pointerMissed(event, internal.interaction.filter((object) => !internal.initialHits.includes(object)));
              handler(data);
            }
          } else {
            if (isClickEvent && internal.initialHits.includes(eventObject)) {
              pointerMissed(event, internal.interaction.filter((object) => !internal.initialHits.includes(object)));
            }
          }
        }
      }
      handleIntersects(hits, event, delta, onIntersect);
    };
  }
  return {
    handlePointer
  };
}
var isRenderer = (def) => !!(def != null && def.render);
var context = /* @__PURE__ */ React2.createContext(null);
var createStore2 = (invalidate2, advance2) => {
  const rootStore = createWithEqualityFn((set, get) => {
    const position = new Vector3();
    const defaultTarget = new Vector3();
    const tempTarget = new Vector3();
    function getCurrentViewport(camera = get().camera, target = defaultTarget, size = get().size) {
      const {
        width,
        height,
        top,
        left
      } = size;
      const aspect = width / height;
      if (target.isVector3) tempTarget.copy(target);
      else tempTarget.set(...target);
      const distance = camera.getWorldPosition(position).distanceTo(tempTarget);
      if (isOrthographicCamera(camera)) {
        return {
          width: width / camera.zoom,
          height: height / camera.zoom,
          top,
          left,
          factor: 1,
          distance,
          aspect
        };
      } else {
        const fov = camera.fov * Math.PI / 180;
        const h2 = 2 * Math.tan(fov / 2) * distance;
        const w2 = h2 * (width / height);
        return {
          width: w2,
          height: h2,
          top,
          left,
          factor: width / w2,
          distance,
          aspect
        };
      }
    }
    let performanceTimeout = void 0;
    const setPerformanceCurrent = (current) => set((state3) => ({
      performance: {
        ...state3.performance,
        current
      }
    }));
    const pointer = new Vector2();
    const rootState = {
      set,
      get,
      // Mock objects that have to be configured
      gl: null,
      camera: null,
      raycaster: null,
      events: {
        priority: 1,
        enabled: true,
        connected: false
      },
      scene: null,
      xr: null,
      invalidate: (frames = 1) => invalidate2(get(), frames),
      advance: (timestamp, runGlobalEffects) => advance2(timestamp, runGlobalEffects, get()),
      legacy: false,
      linear: false,
      flat: false,
      controls: null,
      clock: new Clock(),
      pointer,
      mouse: pointer,
      frameloop: "always",
      onPointerMissed: void 0,
      performance: {
        current: 1,
        min: 0.5,
        max: 1,
        debounce: 200,
        regress: () => {
          const state3 = get();
          if (performanceTimeout) clearTimeout(performanceTimeout);
          if (state3.performance.current !== state3.performance.min) setPerformanceCurrent(state3.performance.min);
          performanceTimeout = setTimeout(() => setPerformanceCurrent(get().performance.max), state3.performance.debounce);
        }
      },
      size: {
        width: 0,
        height: 0,
        top: 0,
        left: 0
      },
      viewport: {
        initialDpr: 0,
        dpr: 0,
        width: 0,
        height: 0,
        top: 0,
        left: 0,
        aspect: 0,
        distance: 0,
        factor: 0,
        getCurrentViewport
      },
      setEvents: (events) => set((state3) => ({
        ...state3,
        events: {
          ...state3.events,
          ...events
        }
      })),
      setSize: (width, height, top = 0, left = 0) => {
        const camera = get().camera;
        const size = {
          width,
          height,
          top,
          left
        };
        set((state3) => ({
          size,
          viewport: {
            ...state3.viewport,
            ...getCurrentViewport(camera, defaultTarget, size)
          }
        }));
      },
      setDpr: (dpr) => set((state3) => {
        const resolved = calculateDpr(dpr);
        return {
          viewport: {
            ...state3.viewport,
            dpr: resolved,
            initialDpr: state3.viewport.initialDpr || resolved
          }
        };
      }),
      setFrameloop: (frameloop = "always") => {
        const clock = get().clock;
        clock.stop();
        clock.elapsedTime = 0;
        if (frameloop !== "never") {
          clock.start();
          clock.elapsedTime = 0;
        }
        set(() => ({
          frameloop
        }));
      },
      previousRoot: void 0,
      internal: {
        // Events
        interaction: [],
        hovered: /* @__PURE__ */ new Map(),
        subscribers: [],
        initialClick: [0, 0],
        initialHits: [],
        capturedMap: /* @__PURE__ */ new Map(),
        lastEvent: /* @__PURE__ */ React2.createRef(),
        // Updates
        active: false,
        frames: 0,
        priority: 0,
        subscribe: (ref, priority, store) => {
          const internal = get().internal;
          internal.priority = internal.priority + (priority > 0 ? 1 : 0);
          internal.subscribers.push({
            ref,
            priority,
            store
          });
          internal.subscribers = internal.subscribers.sort((a, b2) => a.priority - b2.priority);
          return () => {
            const internal2 = get().internal;
            if (internal2 != null && internal2.subscribers) {
              internal2.priority = internal2.priority - (priority > 0 ? 1 : 0);
              internal2.subscribers = internal2.subscribers.filter((s) => s.ref !== ref);
            }
          };
        }
      }
    };
    return rootState;
  });
  const state2 = rootStore.getState();
  let oldSize = state2.size;
  let oldDpr = state2.viewport.dpr;
  let oldCamera = state2.camera;
  rootStore.subscribe(() => {
    const {
      camera,
      size,
      viewport,
      gl,
      set
    } = rootStore.getState();
    if (size.width !== oldSize.width || size.height !== oldSize.height || viewport.dpr !== oldDpr) {
      oldSize = size;
      oldDpr = viewport.dpr;
      updateCamera(camera, size);
      if (viewport.dpr > 0) gl.setPixelRatio(viewport.dpr);
      const updateStyle = typeof HTMLCanvasElement !== "undefined" && gl.domElement instanceof HTMLCanvasElement;
      gl.setSize(size.width, size.height, updateStyle);
    }
    if (camera !== oldCamera) {
      oldCamera = camera;
      set((state3) => ({
        viewport: {
          ...state3.viewport,
          ...state3.viewport.getCurrentViewport(camera)
        }
      }));
    }
  });
  rootStore.subscribe((state3) => invalidate2(state3));
  return rootStore;
};
function useStore() {
  const store = React2.useContext(context);
  if (!store) throw new Error("R3F: Hooks can only be used within the Canvas component!");
  return store;
}
function useThree(selector = (state2) => state2, equalityFn) {
  return useStore()(selector, equalityFn);
}
function useFrame(callback, renderPriority = 0) {
  const store = useStore();
  const subscribe = store.getState().internal.subscribe;
  const ref = useMutableCallback(callback);
  useIsomorphicLayoutEffect(() => subscribe(ref, renderPriority, store), [renderPriority, subscribe, store]);
  return null;
}
var memoizedLoaders = /* @__PURE__ */ new WeakMap();
var isConstructor$1 = (value) => {
  var _value$prototype;
  return typeof value === "function" && (value == null ? void 0 : (_value$prototype = value.prototype) == null ? void 0 : _value$prototype.constructor) === value;
};
function loadingFn(extensions, onProgress) {
  return function(Proto, ...input) {
    let loader;
    if (isConstructor$1(Proto)) {
      loader = memoizedLoaders.get(Proto);
      if (!loader) {
        loader = new Proto();
        memoizedLoaders.set(Proto, loader);
      }
    } else {
      loader = Proto;
    }
    if (extensions) extensions(loader);
    return Promise.all(input.map((input2) => new Promise((res, reject) => loader.load(input2, (data) => {
      if (isObject3D(data == null ? void 0 : data.scene)) Object.assign(data, buildGraph(data.scene));
      res(data);
    }, onProgress, (error) => reject(new Error(`Could not load ${input2}: ${error == null ? void 0 : error.message}`))))));
  };
}
function useLoader(loader, input, extensions, onProgress) {
  const keys = Array.isArray(input) ? input : [input];
  const results = suspend(loadingFn(extensions, onProgress), [loader, ...keys], {
    equal: is.equ
  });
  return Array.isArray(input) ? results : results[0];
}
useLoader.preload = function(loader, input, extensions) {
  const keys = Array.isArray(input) ? input : [input];
  return preload(loadingFn(extensions), [loader, ...keys]);
};
useLoader.clear = function(loader, input) {
  const keys = Array.isArray(input) ? input : [input];
  return clear([loader, ...keys]);
};
var t = 1;
var o = 8;
var r2 = 32;
var e = 2;
var i$1 = 268435456;
var shallow = {
  objects: "shallow"
};
function createRenderer(canvas, gl) {
  const defaults = {
    canvas,
    powerPreference: "high-performance",
    antialias: true,
    alpha: true
  };
  if (typeof gl === "function") return gl(defaults);
  if (isRenderer(gl)) return gl;
  return new WebGLRenderer({
    ...defaults,
    ...gl
  });
}
function computeInitialSize(canvas, size) {
  if (!size && typeof HTMLCanvasElement !== "undefined" && canvas instanceof HTMLCanvasElement && canvas.parentElement) {
    const {
      width,
      height,
      top,
      left
    } = canvas.parentElement.getBoundingClientRect();
    return {
      width,
      height,
      top,
      left
    };
  } else if (!size && typeof OffscreenCanvas !== "undefined" && canvas instanceof OffscreenCanvas) {
    return {
      width: canvas.width,
      height: canvas.height,
      top: 0,
      left: 0
    };
  }
  return {
    width: 0,
    height: 0,
    top: 0,
    left: 0,
    ...size
  };
}
function applyRootConfiguration({
  store,
  configuration
}, canvas, props) {
  const {
    gl: glConfig,
    scene: sceneOptions,
    camera: cameraOptions,
    shadows = false,
    linear = false,
    flat = false,
    legacy = false,
    frameloop = "always",
    dpr = [1, 2],
    performance: performance2,
    onPointerMissed
  } = props;
  const size = computeInitialSize(canvas, props.size);
  const next = {
    ...props,
    shadows,
    linear,
    flat,
    legacy,
    frameloop,
    size
  };
  const state2 = store.getState();
  const gl = state2.gl;
  const last = configuration.previous;
  const changed = (key) => !last || !is.equ(next[key], last[key], shallow);
  configuration.previous = void 0;
  let raycaster = state2.raycaster;
  if (!raycaster) state2.set({
    raycaster: raycaster = new Raycaster()
  });
  if (changed("raycaster")) {
    var _props$raycaster;
    const {
      params,
      ...options
    } = (_props$raycaster = props.raycaster) != null ? _props$raycaster : {};
    applyProps(raycaster, {
      ...options,
      params: {
        ...raycaster.params,
        ...params
      }
    });
  }
  if (!state2.camera || state2.camera === configuration.camera && changed("camera")) {
    configuration.camera = cameraOptions;
    const isCamera = cameraOptions == null ? void 0 : cameraOptions.isCamera;
    const camera = isCamera ? cameraOptions : props.orthographic ? new OrthographicCamera(0, 0, 0, 0, 0.1, 1e3) : new PerspectiveCamera(75, 0, 0.1, 1e3);
    if (!isCamera) {
      camera.position.z = 5;
      if (cameraOptions) {
        applyProps(camera, cameraOptions);
        if (!camera.manual) {
          if ("aspect" in cameraOptions || "left" in cameraOptions || "right" in cameraOptions || "bottom" in cameraOptions || "top" in cameraOptions) {
            camera.manual = true;
            camera.updateProjectionMatrix();
          }
        }
      }
      if (!state2.camera && !(cameraOptions != null && cameraOptions.rotation)) camera.lookAt(0, 0, 0);
    }
    state2.set({
      camera
    });
    raycaster.camera = camera;
  }
  if (!state2.scene) {
    let scene;
    if (sceneOptions != null && sceneOptions.isScene) {
      scene = sceneOptions;
      prepare(scene, store, "", {});
    } else {
      scene = new Scene();
      prepare(scene, store, "", {});
      if (sceneOptions) applyProps(scene, sceneOptions);
    }
    state2.set({
      scene
    });
  }
  if (props.events && !state2.events.handlers) state2.set({
    events: props.events(store)
  });
  if (changed("size")) state2.setSize(size.width, size.height, size.top, size.left);
  if (state2.viewport.dpr !== calculateDpr(dpr)) state2.setDpr(dpr);
  if (changed("frameloop")) state2.setFrameloop(frameloop);
  if (changed("onPointerMissed")) state2.set({
    onPointerMissed
  });
  if (performance2 && changed("performance")) {
    state2.set((state3) => ({
      performance: {
        ...state3.performance,
        ...performance2
      }
    }));
  }
  if (!state2.xr) {
    var _gl$xr;
    const handleXRFrame = (timestamp, frame2) => {
      const state3 = store.getState();
      if (state3.frameloop === "never") return;
      advance(timestamp, true, state3, frame2);
    };
    const handleSessionChange = () => {
      const state3 = store.getState();
      state3.gl.xr.enabled = state3.gl.xr.isPresenting;
      state3.gl.xr.setAnimationLoop(state3.gl.xr.isPresenting ? handleXRFrame : null);
      if (!state3.gl.xr.isPresenting) invalidate(state3);
    };
    const xr = {
      connect() {
        const gl2 = store.getState().gl;
        gl2.xr.addEventListener("sessionstart", handleSessionChange);
        gl2.xr.addEventListener("sessionend", handleSessionChange);
      },
      disconnect() {
        const gl2 = store.getState().gl;
        gl2.xr.removeEventListener("sessionstart", handleSessionChange);
        gl2.xr.removeEventListener("sessionend", handleSessionChange);
      }
    };
    if (typeof ((_gl$xr = gl.xr) == null ? void 0 : _gl$xr.addEventListener) === "function") xr.connect();
    state2.set({
      xr
    });
  }
  if (gl.shadowMap && changed("shadows")) {
    const oldEnabled = gl.shadowMap.enabled;
    const oldType = gl.shadowMap.type;
    gl.shadowMap.enabled = !!shadows;
    if (is.boo(shadows)) {
      gl.shadowMap.type = PCFSoftShadowMap;
    } else if (is.str(shadows)) {
      var _types$shadows;
      const types = {
        basic: BasicShadowMap,
        percentage: PCFShadowMap,
        soft: PCFSoftShadowMap,
        variance: VSMShadowMap
      };
      gl.shadowMap.type = (_types$shadows = types[shadows]) != null ? _types$shadows : PCFSoftShadowMap;
    } else if (is.obj(shadows)) {
      Object.assign(gl.shadowMap, shadows);
    }
    if (oldEnabled !== gl.shadowMap.enabled || oldType !== gl.shadowMap.type) gl.shadowMap.needsUpdate = true;
  }
  const glProps = glConfig && !is.fun(glConfig) && !isRenderer(glConfig) ? glConfig : void 0;
  if (changed("legacy")) {
    ColorManagement.enabled = !legacy;
    state2.set({
      legacy
    });
  }
  if (changed("linear")) {
    if ((glProps == null ? void 0 : glProps.outputColorSpace) === void 0) {
      gl.outputColorSpace = linear ? LinearSRGBColorSpace : SRGBColorSpace;
    }
    state2.set({
      linear
    });
  }
  if (changed("flat")) {
    if ((glProps == null ? void 0 : glProps.toneMapping) === void 0) gl.toneMapping = flat ? NoToneMapping : ACESFilmicToneMapping;
    state2.set({
      flat
    });
  }
  if (glProps && changed("gl")) applyProps(gl, glProps);
  configuration.previous = next;
}
var isPromiseLike = (value) => typeof (value == null ? void 0 : value.then) === "function";
var fulfilled = (value) => Object.assign(Promise.resolve(value), {
  status: "fulfilled",
  value
});
var rejected = (reason) => {
  const promise = Promise.reject(reason);
  promise.catch(() => {
  });
  return Object.assign(promise, {
    status: "rejected",
    reason
  });
};
var deferred = () => {
  let resolve2;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve2 = (value) => {
      Object.assign(promise, {
        status: "fulfilled",
        value
      });
      yes(value);
    };
    reject = (reason) => {
      Object.assign(promise, {
        status: "rejected",
        reason
      });
      no(reason);
    };
  });
  promise.status = "pending";
  promise.catch(() => {
  });
  return {
    promise,
    resolve: resolve2,
    reject
  };
};
var packageData = {
  name: "@react-three/fiber",
  version: "9.8.1",
  description: "A React renderer for Threejs",
  keywords: [
    "react",
    "renderer",
    "fiber",
    "three",
    "threejs"
  ],
  author: "Paul Henschel (https://github.com/drcmda)",
  license: "MIT",
  maintainers: [
    "Josh Ellis (https://github.com/joshuaellis)",
    "Cody Bennett (https://github.com/codyjasonbennett)",
    "Kris Baumgarter (https://github.com/krispya)"
  ],
  bugs: {
    url: "https://github.com/pmndrs/react-three-fiber/issues"
  },
  homepage: "https://github.com/pmndrs/react-three-fiber#readme",
  repository: {
    type: "git",
    url: "git+https://github.com/pmndrs/react-three-fiber.git"
  },
  collective: {
    type: "opencollective",
    url: "https://opencollective.com/react-three-fiber"
  },
  main: "dist/react-three-fiber.cjs.js",
  module: "dist/react-three-fiber.esm.js",
  types: "dist/react-three-fiber.cjs.d.ts",
  "react-native": "native/dist/react-three-fiber-native.cjs.js",
  sideEffects: false,
  preconstruct: {
    entrypoints: [
      "index.tsx",
      "native.tsx"
    ]
  },
  scripts: {
    prebuild: "cp ../../readme.md readme.md"
  },
  devDependencies: {
    "@types/react-reconciler": "^0.33.0",
    "react-reconciler": "^0.34.0"
  },
  dependencies: {
    "@babel/runtime": "^7.17.8",
    "@types/webxr": "*",
    "base64-js": "^1.5.1",
    buffer: "^6.0.3",
    "its-fine": "^2.1.1",
    "react-use-measure": "^2.1.7",
    scheduler: "^0.28.0",
    "suspend-react": "^0.1.3",
    "use-sync-external-store": "^1.4.0",
    zustand: "^5.0.3"
  },
  peerDependencies: {
    expo: ">=43.0",
    "expo-asset": ">=8.4",
    "expo-file-system": ">=11.0",
    "expo-gl": ">=11.0",
    react: ">=19 <19.4",
    "react-dom": ">=19 <19.4",
    "react-native": ">=0.78",
    three: ">=0.156"
  },
  peerDependenciesMeta: {
    "react-dom": {
      optional: true
    },
    "react-native": {
      optional: true
    },
    expo: {
      optional: true
    },
    "expo-asset": {
      optional: true
    },
    "expo-file-system": {
      optional: true
    },
    "expo-gl": {
      optional: true
    }
  }
};
function $1(Ut) {
  return Ut && Ut.__esModule && Object.prototype.hasOwnProperty.call(Ut, "default") ? Ut.default : Ut;
}
var S0 = {
  exports: {}
};
var Ob = {
  exports: {}
};
Ob.exports;
var Bb = {
  exports: {}
};
Bb.exports;
var x1;
function q1() {
  return x1 || (x1 = 1, (function(Ut) {
    Ut.exports = function(m2) {
      function et(e2, n) {
        for (e2 = e2.memoizedState; e2 !== null && 0 < n; ) e2 = e2.next, n--;
        return e2;
      }
      function zf(e2, n, o2, i3) {
        if (o2 >= n.length) return i3;
        var s = n[o2], u2 = Gn(e2) ? e2.slice() : Un({}, e2);
        return u2[s] = zf(e2[s], n, o2 + 1, i3), u2;
      }
      function F(e2, n, o2) {
        if (n.length !== o2.length) console.warn("copyWithRename() expects paths of the same length");
        else {
          for (var i3 = 0; i3 < o2.length - 1; i3++) if (n[i3] !== o2[i3]) {
            console.warn("copyWithRename() expects paths to be the same except for the deepest key");
            return;
          }
          return Ef(e2, n, o2, 0);
        }
      }
      function Ef(e2, n, o2, i3) {
        var s = n[i3], u2 = Gn(e2) ? e2.slice() : Un({}, e2);
        return i3 + 1 === n.length ? (u2[o2[i3]] = u2[s], Gn(u2) ? u2.splice(s, 1) : delete u2[s]) : u2[s] = Ef(e2[s], n, o2, i3 + 1), u2;
      }
      function pc(e2, n, o2) {
        var i3 = n[o2], s = Gn(e2) ? e2.slice() : Un({}, e2);
        return o2 + 1 === n.length ? (Gn(s) ? s.splice(i3, 1) : delete s[i3], s) : (s[i3] = pc(e2[i3], n, o2 + 1), s);
      }
      function hc() {
        return false;
      }
      function mc() {
        return null;
      }
      function ht(e2, n, o2, i3) {
        return new R0(e2, n, o2, i3);
      }
      function Ss(e2, n) {
        e2.context === c && (Rd(n, e2, null, null), Cd());
      }
      function gc(e2, n) {
        if (Zi !== null) {
          var o2 = n.staleFamilies;
          n = n.updatedFamilies, Ol(), gg(e2.current, n, o2), Cd();
        }
      }
      function oo(e2) {
        Zi = e2;
      }
      function W2() {
        console.error("Do not call Hooks inside useEffect(...), useMemo(...), or other built-in Hooks. You can only call Hooks at the top level of your React function. For more information, see https://react.dev/link/rules-of-hooks");
      }
      function Te() {
        console.error("Context can only be read while React is rendering. In classes, you can read it in the render method or getDerivedStateFromProps. In function components, you can read it directly in the function body, but not inside Hooks like useReducer() or useMemo().");
      }
      function k0() {
      }
      function ma() {
      }
      function ao(e2) {
        var n = [];
        return e2.forEach(function(o2) {
          n.push(o2);
        }), n.sort().join(", ");
      }
      function Yi(e2) {
        for (var n = e2, o2 = n; o2 && !o2.alternate; ) n = o2, (n.flags & 4098) !== 0 && (e2 = n.return), o2 = n.return;
        for (; n.return; ) n = n.return;
        return n.tag === 3 ? e2 : null;
      }
      function _f(e2) {
        if (Yi(e2) !== e2) throw Error("Unable to find node on an unmounted component.");
      }
      function am(e2) {
        var n = e2.alternate;
        if (!n) {
          if (n = Yi(e2), n === null) throw Error("Unable to find node on an unmounted component.");
          return n !== e2 ? null : e2;
        }
        for (var o2 = e2, i3 = n; ; ) {
          var s = o2.return;
          if (s === null) break;
          var u2 = s.alternate;
          if (u2 === null) {
            if (i3 = s.return, i3 !== null) {
              o2 = i3;
              continue;
            }
            break;
          }
          if (s.child === u2.child) {
            for (u2 = s.child; u2; ) {
              if (u2 === o2) return _f(s), e2;
              if (u2 === i3) return _f(s), n;
              u2 = u2.sibling;
            }
            throw Error("Unable to find node on an unmounted component.");
          }
          if (o2.return !== i3.return) o2 = s, i3 = u2;
          else {
            for (var f = false, p4 = s.child; p4; ) {
              if (p4 === o2) {
                f = true, o2 = s, i3 = u2;
                break;
              }
              if (p4 === i3) {
                f = true, i3 = s, o2 = u2;
                break;
              }
              p4 = p4.sibling;
            }
            if (!f) {
              for (p4 = u2.child; p4; ) {
                if (p4 === o2) {
                  f = true, o2 = u2, i3 = s;
                  break;
                }
                if (p4 === i3) {
                  f = true, i3 = u2, o2 = s;
                  break;
                }
                p4 = p4.sibling;
              }
              if (!f) throw Error("Child was not found in either parent set. This indicates a bug in React related to the return pointer. Please file an issue.");
            }
          }
          if (o2.alternate !== i3) throw Error("Return fibers should always be each others' alternates. This error is likely caused by a bug in React. Please file an issue.");
        }
        if (o2.tag !== 3) throw Error("Unable to find node on an unmounted component.");
        return o2.stateNode.current === o2 ? e2 : n;
      }
      function Nf(e2) {
        return e2 = am(e2), e2 !== null ? bc(e2) : null;
      }
      function bc(e2) {
        var n = e2.tag;
        if (n === 5 || n === 26 || n === 27 || n === 6) return e2;
        for (e2 = e2.child; e2 !== null; ) {
          if (n = bc(e2), n !== null) return n;
          e2 = e2.sibling;
        }
        return null;
      }
      function Ki(e2) {
        var n = e2.tag;
        if (n === 5 || n === 26 || n === 27 || n === 6) return e2;
        for (e2 = e2.child; e2 !== null; ) {
          if (e2.tag !== 4 && (n = Ki(e2), n !== null)) return n;
          e2 = e2.sibling;
        }
        return null;
      }
      function ti(e2) {
        return e2 === null || typeof e2 != "object" ? null : (e2 = ch && e2[ch] || e2["@@iterator"], typeof e2 == "function" ? e2 : null);
      }
      function en(e2) {
        if (e2 == null) return null;
        if (typeof e2 == "function") return e2.$$typeof === dh ? null : e2.displayName || e2.name || null;
        if (typeof e2 == "string") return e2;
        switch (e2) {
          case Qr:
            return "Fragment";
          case Wa:
            return "Profiler";
          case Ml:
            return "StrictMode";
          case lh:
            return "Suspense";
          case Vl:
            return "SuspenseList";
          case $l:
            return "Activity";
          case uh:
            return "ViewTransition";
        }
        if (typeof e2 == "object") switch (typeof e2.tag == "number" && console.error("Received an unexpected object in getComponentNameFromType(). This is likely a bug in React. Please file an issue."), e2.$$typeof) {
          case Ua:
            return "Portal";
          case sn:
            return e2.displayName || "Context";
          case Aa:
            return (e2._context.displayName || "Context") + ".Consumer";
          case Fd:
            var n = e2.render;
            return e2 = e2.displayName, e2 || (e2 = n.displayName || n.name || "", e2 = e2 !== "" ? "ForwardRef(" + e2 + ")" : "ForwardRef"), e2;
          case Ei:
            return n = e2.displayName || null, n !== null ? n : en(e2.type) || "Memo";
          case qn:
            n = e2._payload, e2 = e2._init;
            try {
              return en(e2(n));
            } catch {
            }
        }
        return null;
      }
      function G(e2) {
        var n = e2.type;
        switch (e2.tag) {
          case 31:
            return "Activity";
          case 24:
            return "Cache";
          case 9:
            return (n._context.displayName || "Context") + ".Consumer";
          case 10:
            return n.displayName || "Context";
          case 18:
            return "DehydratedFragment";
          case 11:
            return e2 = n.render, e2 = e2.displayName || e2.name || "", n.displayName || (e2 !== "" ? "ForwardRef(" + e2 + ")" : "ForwardRef");
          case 7:
            return "Fragment";
          case 26:
          case 27:
          case 5:
            return n;
          case 4:
            return "Portal";
          case 3:
            return "Root";
          case 6:
            return "Text";
          case 16:
            return en(n);
          case 8:
            return n === Ml ? "StrictMode" : "Mode";
          case 22:
            if (e2.return !== null) return G(e2.return);
            break;
          case 12:
            return "Profiler";
          case 21:
            return "Scope";
          case 13:
            return "Suspense";
          case 19:
            return "SuspenseList";
          case 25:
            return "TracingMarker";
          case 30:
            return "ViewTransition";
          case 1:
          case 0:
          case 14:
          case 15:
            if (typeof n == "function") return n.displayName || n.name || null;
            if (typeof n == "string") return n;
            break;
          case 29:
            if (n = e2._debugInfo, n != null) {
              for (var o2 = n.length - 1; 0 <= o2; o2--) if (typeof n[o2].name == "string") return n[o2].name;
            }
            if (e2.return !== null) return G(e2.return);
        }
        return null;
      }
      function Wt(e2) {
        return {
          current: e2
        };
      }
      function mn(e2, n) {
        0 > l2 ? console.error("Unexpected pop.") : (n !== a[l2] && console.error("Unexpected Fiber popped."), e2.current = r3[l2], r3[l2] = null, a[l2] = null, l2--);
      }
      function ze(e2, n, o2) {
        l2++, r3[l2] = e2.current, a[l2] = o2, e2.current = n;
      }
      function ga(e2) {
        return e2 >>>= 0, e2 === 0 ? 32 : 31 - (h2(e2) / y | 0) | 0;
      }
      function mt(e2) {
        var n = e2 & 42;
        if (n !== 0) return n;
        switch (e2 & -e2) {
          case 1:
            return 1;
          case 2:
            return 2;
          case 4:
            return 4;
          case 8:
            return 8;
          case 16:
            return 16;
          case 32:
            return 32;
          case 64:
            return 64;
          case 128:
            return 128;
          case 256:
          case 512:
          case 1024:
          case 2048:
          case 4096:
          case 8192:
          case 16384:
          case 32768:
          case 65536:
          case 131072:
            return e2 & -e2;
          case 262144:
          case 524288:
          case 1048576:
          case 2097152:
            return e2 & 3932160;
          case 4194304:
          case 8388608:
          case 16777216:
          case 33554432:
            return e2 & 62914560;
          case 67108864:
            return 67108864;
          case 134217728:
            return 134217728;
          case 268435456:
            return 268435456;
          case 536870912:
            return 536870912;
          case 1073741824:
            return 0;
          default:
            return console.error("Should have found matching lanes. This is a bug in React."), e2;
        }
      }
      function ks(e2, n, o2) {
        var i3 = e2.pendingLanes;
        if (i3 === 0) return 0;
        var s = 0, u2 = e2.suspendedLanes, f = e2.pingedLanes;
        e2 = e2.warmLanes;
        var p4 = i3 & 134217727;
        return p4 !== 0 ? (i3 = p4 & ~u2, i3 !== 0 ? s = mt(i3) : (f &= p4, f !== 0 ? s = mt(f) : o2 || (o2 = p4 & ~e2, o2 !== 0 && (s = mt(o2))))) : (p4 = i3 & ~u2, p4 !== 0 ? s = mt(p4) : f !== 0 ? s = mt(f) : o2 || (o2 = i3 & ~e2, o2 !== 0 && (s = mt(o2)))), s === 0 ? 0 : n !== 0 && n !== s && (n & u2) === 0 && (u2 = s & -s, o2 = n & -n, u2 >= o2 || u2 === 32 && (o2 & 4194048) !== 0) ? n : s;
      }
      function At(e2, n) {
        return (e2.pendingLanes & ~(e2.suspendedLanes & ~e2.pingedLanes) & n) === 0;
      }
      function im(e2, n) {
        (n & 8) !== 0 && (n |= n & 32);
        var o2 = e2.entangledLanes;
        if (o2 !== 0) for (e2 = e2.entanglements, o2 &= n; 0 < o2; ) {
          var i3 = 31 - d(o2), s = 1 << i3;
          n |= e2[i3], o2 &= ~s;
        }
        return n;
      }
      function ba(e2, n) {
        switch (e2) {
          case 1:
          case 2:
          case 4:
          case 8:
          case 64:
            return n + 250;
          case 16:
          case 32:
          case 128:
          case 256:
          case 512:
          case 1024:
          case 2048:
          case 4096:
          case 8192:
          case 16384:
          case 32768:
          case 65536:
          case 131072:
          case 262144:
          case 524288:
          case 1048576:
          case 2097152:
            return n + 5e3;
          case 4194304:
          case 8388608:
          case 16777216:
          case 33554432:
            return -1;
          case 67108864:
          case 134217728:
          case 268435456:
          case 536870912:
          case 1073741824:
            return -1;
          default:
            return console.error("Should have found matching lanes. This is a bug in React."), -1;
        }
      }
      function ws() {
        var e2 = D2;
        return D2 <<= 1, (D2 & 62914560) === 0 && (D2 = 4194304), e2;
      }
      function Tf(e2) {
        for (var n = [], o2 = 0; 31 > o2; o2++) n.push(e2);
        return n;
      }
      function el(e2, n) {
        e2.pendingLanes |= n, n !== 268435456 && (e2.suspendedLanes = 0, e2.pingedLanes = 0, e2.warmLanes = 0);
      }
      function Kt(e2, n, o2, i3, s, u2) {
        var f = e2.pendingLanes;
        e2.pendingLanes = o2, e2.suspendedLanes = 0, e2.pingedLanes = 0, e2.warmLanes = 0, e2.expiredLanes &= o2, e2.entangledLanes &= o2, e2.errorRecoveryDisabledLanes &= o2, e2.shellSuspendCounter = 0;
        var p4 = e2.entanglements, g3 = e2.expirationTimes, b2 = e2.hiddenUpdates;
        for (o2 = f & ~o2; 0 < o2; ) {
          var k2 = 31 - d(o2), z = 1 << k2;
          p4[k2] = 0, g3[k2] = -1;
          var T3 = b2[k2];
          if (T3 !== null) for (b2[k2] = null, k2 = 0; k2 < T3.length; k2++) {
            var H = T3[k2];
            H !== null && (H.lane &= -536870913);
          }
          o2 &= ~z;
        }
        i3 !== 0 && io(e2, i3, 0), u2 !== 0 && s === 0 && e2.tag !== 0 && (e2.suspendedLanes |= u2 & ~(f & ~n));
      }
      function io(e2, n, o2) {
        e2.pendingLanes |= n, e2.suspendedLanes &= ~n;
        var i3 = 31 - d(n);
        e2.entangledLanes |= n, e2.entanglements[i3] = e2.entanglements[i3] | 1073741824 | o2 & 261930;
      }
      function If(e2, n) {
        var o2 = e2.entangledLanes |= n;
        for (e2 = e2.entanglements; o2; ) {
          var i3 = 31 - d(o2), s = 1 << i3;
          s & n | e2[i3] & n && (e2[i3] |= n), o2 &= ~s;
        }
      }
      function Ps(e2, n) {
        var o2 = n & -n;
        return o2 = (o2 & 42) !== 0 ? 1 : xs(o2), (o2 & (e2.suspendedLanes | n)) !== 0 ? 0 : o2;
      }
      function xs(e2) {
        switch (e2) {
          case 2:
            e2 = 1;
            break;
          case 8:
            e2 = 4;
            break;
          case 32:
            e2 = 16;
            break;
          case 256:
          case 512:
          case 1024:
          case 2048:
          case 4096:
          case 8192:
          case 16384:
          case 32768:
          case 65536:
          case 131072:
          case 262144:
          case 524288:
          case 1048576:
          case 2097152:
          case 4194304:
          case 8388608:
          case 16777216:
          case 33554432:
            e2 = 128;
            break;
          case 268435456:
            e2 = 134217728;
            break;
          default:
            e2 = 0;
        }
        return e2;
      }
      function Rf(e2, n, o2) {
        if (Le) for (e2 = e2.pendingUpdatersLaneMap; 0 < o2; ) {
          var i3 = 31 - d(o2), s = 1 << i3;
          e2[i3].add(n), o2 &= ~s;
        }
      }
      function Cs(e2, n) {
        if (Le) for (var o2 = e2.pendingUpdatersLaneMap, i3 = e2.memoizedUpdaters; 0 < n; ) {
          var s = 31 - d(n);
          e2 = 1 << s, s = o2[s], 0 < s.size && (s.forEach(function(u2) {
            var f = u2.alternate;
            f !== null && i3.has(f) || i3.add(u2);
          }), s.clear()), n &= ~e2;
        }
      }
      function ya(e2) {
        return e2 &= -e2, 2 < e2 ? 8 < e2 ? (e2 & 134217727) !== 0 ? 32 : 268435456 : 8 : 2;
      }
      function Lf(e2) {
        if (typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ > "u") return false;
        var n = __REACT_DEVTOOLS_GLOBAL_HOOK__;
        if (n.isDisabled) return true;
        if (!n.supportsFiber) return console.error("The installed version of React DevTools is too old and will not work with the current version of React. Please update React DevTools. https://react.dev/link/react-devtools"), true;
        try {
          Ue = n.inject(e2), M3 = n;
        } catch (o2) {
          console.error("React instrumentation encountered an error: %o.", o2);
        }
        return !!n.checkDCE;
      }
      function Oe(e2) {
        if (typeof j2 == "function" && q(e2), M3 && typeof M3.setStrictMode == "function") try {
          M3.setStrictMode(Ue, e2);
        } catch (n) {
          ie || (ie = true, console.error("React instrumentation encountered an error: %o", n));
        }
      }
      function Mn(e2, n) {
        if (e2.name != null && e2.name !== "auto") return e2.name;
        if (n.autoName !== null) return n.autoName;
        e2 = pa.identifierPrefix;
        var o2 = Se++;
        return e2 = "_" + e2 + "t_" + o2.toString(32) + "_", n.autoName = e2;
      }
      function Ff(e2) {
        var _n2;
        if (e2 == null || typeof e2 == "string") return e2;
        var n = null, o2 = Pf;
        if (o2 !== null) for (var i3 = 0; i3 < o2.length; i3++) {
          var s = e2[o2[i3]];
          if (s != null) {
            if (s === "none") return "none";
            n = n == null ? s : n + (" " + s);
          }
        }
        return (_n2 = n) != null ? _n2 : e2.default;
      }
      function er(e2, n) {
        return e2 = Ff(e2), n = Ff(n), n == null ? e2 === "auto" ? null : e2 : n === "auto" ? null : n;
      }
      function nl(e2, n) {
        return e2 === n && (e2 !== 0 || 1 / e2 === 1 / n) || e2 !== e2 && n !== n;
      }
      function ri(e2) {
        for (var n = 0, o2 = 0; o2 < e2.length && 100 > o2; o2++) {
          var i3 = e2[o2];
          if (typeof i3 == "object" && i3 !== null) {
            if (Gn(i3) && i3.length === 2 && typeof i3[0] == "string") {
              if (n !== 0 && n !== 3) return 1;
              n = 3;
            } else return 1;
          } else {
            if (typeof i3 == "function" || typeof i3 == "string" && 50 < i3.length || n !== 0 && n !== 2 || typeof i3 == "bigint") return 1;
            n = 2;
          }
        }
        return n;
      }
      function zs(e2, n, o2, i3) {
        if (!ArrayBuffer.isView(e2)) {
          var s = 0, u2;
          for (u2 in e2) if (Ig.call(e2, u2) && u2[0] !== "_" && (s++, Rn(u2, e2[u2], n, o2, i3), 100 <= s)) {
            n.push([i3 + "\xA0\xA0".repeat(o2) + "Only 100 properties are shown. React will not log more properties of this object.", ""]);
            break;
          }
        }
      }
      function va(e2) {
        return "$$typeof" in e2 && Ig.call(e2, "$$typeof") ? e2.$$typeof : void 0;
      }
      function Rn(e2, n, o2, i3, s) {
        switch (typeof n) {
          case "object":
            if (n === null) {
              n = "null";
              break;
            } else {
              if (va(n) === xo) {
                var u2 = en(n.type) || "\u2026", f = n.key;
                n = n.props;
                var p4 = Object.keys(n), g3 = p4.length;
                if (f == null && g3 === 0) {
                  n = "<" + u2 + " />";
                  break;
                }
                if (3 > i3 || g3 === 1 && p4[0] === "children" && f == null) {
                  n = "<" + u2 + " \u2026 />";
                  break;
                }
                o2.push([s + "\xA0\xA0".repeat(i3) + e2, "<" + u2]), f !== null && Rn("key", f, o2, i3 + 1, s), e2 = false, f = 0;
                for (var b2 in n) if (f++, b2 === "children" ? n.children != null && (!Gn(n.children) || 0 < n.children.length) && (e2 = true) : Ig.call(n, b2) && b2[0] !== "_" && Rn(b2, n[b2], o2, i3 + 1, s), 100 <= f) break;
                o2.push(["", e2 ? ">\u2026</" + u2 + ">" : "/>"]);
                return;
              }
              if (u2 = Object.prototype.toString.call(n), u2 = u2.slice(8, u2.length - 1), ArrayBuffer.isView(n)) {
                n = n.length, n = typeof n == "number" ? u2 + "(" + n + ")" : u2;
                break;
              }
              if (u2 === "Array") {
                if (b2 = 100 < n.length, f = ri(n), f === 2 || f === 0) {
                  n = JSON.stringify(b2 ? n.slice(0, 100).concat("\u2026") : n);
                  break;
                } else if (f === 3) {
                  for (o2.push([s + "\xA0\xA0".repeat(i3) + e2, ""]), e2 = 0; e2 < n.length && 100 > e2; e2++) u2 = n[e2], Rn(u2[0], u2[1], o2, i3 + 1, s);
                  b2 && Rn("100", "\u2026", o2, i3 + 1, s);
                  return;
                }
              }
              if (u2 === "Promise") {
                if (n.status === "fulfilled") {
                  if (u2 = o2.length, Rn(e2, n.value, o2, i3, s), o2.length > u2) {
                    o2 = o2[u2], o2[1] = "Promise<" + (o2[1] || "Object") + ">";
                    return;
                  }
                } else if (n.status === "rejected" && (u2 = o2.length, Rn(e2, n.reason, o2, i3, s), o2.length > u2)) {
                  o2 = o2[u2], o2[1] = "Rejected Promise<" + o2[1] + ">";
                  return;
                }
                o2.push(["\xA0\xA0".repeat(i3) + e2, "Promise"]);
                return;
              }
              u2 === "Object" && (b2 = Object.getPrototypeOf(n)) && typeof b2.constructor == "function" && (u2 = b2.constructor.name), o2.push([s + "\xA0\xA0".repeat(i3) + e2, u2 === "Object" ? 3 > i3 ? "" : "\u2026" : u2]), 3 > i3 && zs(n, o2, i3 + 1, s);
              return;
            }
          case "function":
            n = n.name, n = n === "" || typeof n != "string" ? "() => {}" : n + "() {}";
            break;
          case "string":
            n = n === "This object has been omitted by React in the console log to avoid sending too much data from the server. Try logging smaller or more specific objects." ? "\u2026" : JSON.stringify(1024 <= n.length ? n.slice(0, 1023) + "\u2026" : n);
            break;
          case "undefined":
            n = "undefined";
            break;
          case "boolean":
            n = n ? "true" : "false";
            break;
          default:
            n = String(n);
        }
        o2.push([s + "\xA0\xA0".repeat(i3) + e2, n]);
      }
      function lo(e2, n, o2, i3) {
        var s = true, u2 = 0;
        for (p4 in e2) {
          if (100 < u2) {
            o2.push(["Previous object has more than 100 properties. React will not attempt to diff objects with too many properties.", ""]), s = false;
            break;
          }
          p4 in n || (o2.push(["-\xA0" + "\xA0\xA0".repeat(i3) + p4, "\u2026"]), s = false), u2++;
        }
        u2 = 0;
        for (var f in n) {
          if (100 < u2) {
            o2.push(["Next object has more than 100 properties. React will not attempt to diff objects with too many properties.", ""]), s = false;
            break;
          }
          if (f in e2) {
            var p4 = e2[f], g3 = n[f];
            if (p4 !== g3) {
              if (i3 === 0 && f === "children") {
                s = "\xA0\xA0".repeat(i3) + f, o2.push(["-\xA0" + s, "\u2026"], ["+\xA0" + s, "\u2026"]), s = false;
                continue;
              }
              if (!(3 <= i3)) {
                if (typeof p4 == "object" && typeof g3 == "object" && p4 !== null && g3 !== null && va(p4) === va(g3)) {
                  if (va(g3) === xo) {
                    if (p4.type === g3.type && p4.key === g3.key) {
                      p4 = en(g3.type) || "\u2026", s = "\xA0\xA0".repeat(i3) + f, p4 = "<" + p4 + " \u2026 />", o2.push(["-\xA0" + s, p4], ["+\xA0" + s, p4]), s = false;
                      continue;
                    }
                  } else {
                    var b2 = Object.prototype.toString.call(p4), k2 = Object.prototype.toString.call(g3);
                    if (b2 === k2 && (k2 === "[object Object]" || k2 === "[object Array]")) {
                      b2 = ["\u2007\xA0" + "\xA0\xA0".repeat(i3) + f, k2 === "[object Array]" ? "Array" : ""], o2.push(b2), k2 = o2.length, lo(p4, g3, o2, i3 + 1) ? k2 === o2.length && (b2[1] = "Referentially unequal but deeply equal objects. Consider memoization.") : s = false;
                      continue;
                    }
                  }
                } else if (typeof p4 == "function" && typeof g3 == "function" && p4.name === g3.name && p4.length === g3.length && (b2 = Function.prototype.toString.call(p4), k2 = Function.prototype.toString.call(g3), b2 === k2)) {
                  p4 = g3.name === "" ? "() => {}" : g3.name + "() {}", o2.push(["\u2007\xA0" + "\xA0\xA0".repeat(i3) + f, p4 + " Referentially unequal function closure. Consider memoization."]);
                  continue;
                }
              }
              Rn(f, p4, o2, i3, "-\xA0"), Rn(f, g3, o2, i3, "+\xA0"), s = false;
            }
          } else o2.push(["+\xA0" + "\xA0\xA0".repeat(i3) + f, "\u2026"]), s = false;
          u2++;
        }
        return s;
      }
      function zn(e2) {
        me = e2 & 63 ? "Blocking" : e2 & 64 ? "Gesture" : e2 & 4194176 ? "Transition" : e2 & 62914560 ? "Suspense" : e2 & 2080374784 ? "Idle" : "Other";
      }
      function nr(e2, n, o2, i3) {
        Ke && (as.start = n, as.end = o2, Wi.color = "warning", Wi.tooltipText = i3, Wi.properties = null, (e2 = e2._debugTask) ? e2.run(performance.measure.bind(performance, i3, as)) : performance.measure(i3, as), performance.clearMeasures(i3));
      }
      function so(e2, n, o2) {
        nr(e2, n, o2, "Reconnect");
      }
      function oi(e2, n, o2, i3, s) {
        var u2 = G(e2);
        if (u2 !== null && Ke) {
          var f = e2.alternate, p4 = e2.actualDuration;
          if (f === null || f.child !== e2.child) for (var g3 = e2.child; g3 !== null; g3 = g3.sibling) p4 -= g3.actualDuration;
          p4 = 0.5 > p4 ? i3 ? "tertiary-light" : "primary-light" : 10 > p4 ? i3 ? "tertiary" : "primary" : 100 > p4 ? i3 ? "tertiary-dark" : "primary-dark" : "error";
          var b2 = e2.memoizedProps;
          i3 = e2._debugTask, b2 !== null && f !== null && f.memoizedProps !== b2 ? (g3 = [E1], b2 = lo(f.memoizedProps, b2, g3, 0), 1 < g3.length ? (b2 && !os && (f.lanes & s) === 0 && 100 < e2.actualDuration ? (os = true, g3[0] = _1, Wi.color = "warning", Wi.tooltipText = "This component received deeply equal props. It might benefit from useMemo or the React Compiler in its owner.") : (Wi.color = p4, Wi.tooltipText = u2), Wi.properties = g3, as.start = n, as.end = o2, e2 = "\u200B" + u2, i3 != null ? i3.run(performance.measure.bind(performance, e2, as)) : performance.measure(e2, as), performance.clearMeasures(e2)) : i3 != null ? i3.run(console.timeStamp.bind(console, u2, n, o2, "Components \u269B", void 0, p4)) : console.timeStamp(u2, n, o2, "Components \u269B", void 0, p4)) : i3 != null ? i3.run(console.timeStamp.bind(console, u2, n, o2, "Components \u269B", void 0, p4)) : console.timeStamp(u2, n, o2, "Components \u269B", void 0, p4);
        }
      }
      function Do(e2, n, o2, i3) {
        if (Ke) {
          var s = G(e2);
          if (s !== null) {
            for (var u2 = null, f = [], p4 = 0; p4 < i3.length; p4++) {
              var g3 = i3[p4];
              u2 == null && g3.source !== null && (u2 = g3.source._debugTask), g3 = g3.value, f.push(["Error", typeof g3 == "object" && g3 !== null && typeof g3.message == "string" ? String(g3.message) : String(g3)]);
            }
            e2.key !== null && Rn("key", e2.key, f, 0, ""), e2.memoizedProps !== null && zs(e2.memoizedProps, f, 0, ""), u2 == null && (u2 = e2._debugTask), e2 = {
              start: n,
              end: o2,
              detail: {
                devtools: {
                  color: "error",
                  track: "Components \u269B",
                  tooltipText: e2.tag === 13 ? "Hydration failed" : "Error boundary caught an error",
                  properties: f
                }
              }
            }, s = "\u200B" + s, u2 ? u2.run(performance.measure.bind(performance, s, e2)) : performance.measure(s, e2), performance.clearMeasures(s);
          }
        }
      }
      function Me(e2, n, o2, i3, s) {
        if (s !== null) {
          if (Ke) {
            var u2 = G(e2);
            if (u2 !== null) {
              i3 = [];
              for (var f = 0; f < s.length; f++) {
                var p4 = s[f].value;
                i3.push(["Error", typeof p4 == "object" && p4 !== null && typeof p4.message == "string" ? String(p4.message) : String(p4)]);
              }
              e2.key !== null && Rn("key", e2.key, i3, 0, ""), e2.memoizedProps !== null && zs(e2.memoizedProps, i3, 0, ""), n = {
                start: n,
                end: o2,
                detail: {
                  devtools: {
                    color: "error",
                    track: "Components \u269B",
                    tooltipText: "A lifecycle or effect errored",
                    properties: i3
                  }
                }
              }, e2 = e2._debugTask, o2 = "\u200B" + u2, e2 ? e2.run(performance.measure.bind(performance, o2, n)) : performance.measure(o2, n), performance.clearMeasures(o2);
            }
          }
        } else u2 = G(e2), u2 !== null && Ke && (s = 1 > i3 ? "secondary-light" : 100 > i3 ? "secondary" : 500 > i3 ? "secondary-dark" : "error", (e2 = e2._debugTask) ? e2.run(console.timeStamp.bind(console, u2, n, o2, "Components \u269B", void 0, s)) : console.timeStamp(u2, n, o2, "Components \u269B", void 0, s));
      }
      function Es(e2, n, o2, i3) {
        !Ke || n <= e2 || (o2 = (o2 & 738197653) === o2 ? "tertiary-dark" : "primary-dark", i3 ? i3.run(console.timeStamp.bind(console, "Prewarm", e2, n, me, "Scheduler \u269B", o2)) : console.timeStamp("Prewarm", e2, n, me, "Scheduler \u269B", o2));
      }
      function Df(e2, n, o2, i3) {
        !Ke || n <= e2 || (o2 = (o2 & 738197653) === o2 ? "tertiary-dark" : "primary-dark", i3 ? i3.run(console.timeStamp.bind(console, "Suspended", e2, n, me, "Scheduler \u269B", o2)) : console.timeStamp("Suspended", e2, n, me, "Scheduler \u269B", o2));
      }
      function _s(e2, n, o2, i3) {
        !Ke || n <= e2 || (i3 ? i3.run(console.timeStamp.bind(console, "Errored", e2, n, me, "Scheduler \u269B", "error")) : console.timeStamp("Errored", e2, n, me, "Scheduler \u269B", "error"));
      }
      function Ns(e2, n, o2, i3) {
        !Ke || n <= e2 || (i3 ? i3.run(console.timeStamp.bind(console, o2, e2, n, me, "Scheduler \u269B", "secondary-light")) : console.timeStamp(o2, e2, n, me, "Scheduler \u269B", "secondary-light"));
      }
      function jf(e2, n, o2, i3, s) {
        if (Ke && !(n <= e2)) {
          for (var u2 = [], f = 0; f < o2.length; f++) {
            var p4 = o2[f].value;
            u2.push(["Error", typeof p4 == "object" && p4 !== null && typeof p4.message == "string" ? String(p4.message) : String(p4)]);
          }
          e2 = {
            start: e2,
            end: n,
            detail: {
              devtools: {
                color: "error",
                track: me,
                trackGroup: "Scheduler \u269B",
                tooltipText: i3 ? "Remaining Effects Errored" : "Commit Errored",
                properties: u2
              }
            }
          }, s ? s.run(performance.measure.bind(performance, "Errored", e2)) : performance.measure("Errored", e2), performance.clearMeasures("Errored");
        }
      }
      function lm(e2, n, o2, i3, s) {
        o2 !== null ? jf(e2, n, o2, false, s) : !Ke || n <= e2 || (s ? s.run(console.timeStamp.bind(console, i3 ? "Commit Interrupted View Transition" : "Commit", e2, n, me, "Scheduler \u269B", i3 ? "error" : "secondary-dark")) : console.timeStamp(i3 ? "Commit Interrupted View Transition" : "Commit", e2, n, me, "Scheduler \u269B", i3 ? "error" : "secondary-dark"));
      }
      function Pr(e2, n, o2) {
        !Ke || n <= e2 || (o2 ? o2.run(console.timeStamp.bind(console, "Animating", e2, n, me, "Scheduler \u269B", "secondary-dark")) : console.timeStamp("Animating", e2, n, me, "Scheduler \u269B", "secondary-dark"));
      }
      function xr() {
      }
      function tl() {
        if (Ch === 0) {
          Vb = console.log, $b = console.info, Qb = console.warn, qb = console.error, Gb = console.group, Jb = console.groupCollapsed, Zb = console.groupEnd;
          var e2 = {
            configurable: true,
            enumerable: true,
            value: xr,
            writable: true
          };
          Object.defineProperties(console, {
            info: e2,
            log: e2,
            warn: e2,
            error: e2,
            group: e2,
            groupCollapsed: e2,
            groupEnd: e2
          });
        }
        Ch++;
      }
      function sm() {
        if (Ch--, Ch === 0) {
          var e2 = {
            configurable: true,
            enumerable: true,
            writable: true
          };
          Object.defineProperties(console, {
            log: Un({}, e2, {
              value: Vb
            }),
            info: Un({}, e2, {
              value: $b
            }),
            warn: Un({}, e2, {
              value: Qb
            }),
            error: Un({}, e2, {
              value: qb
            }),
            group: Un({}, e2, {
              value: Gb
            }),
            groupCollapsed: Un({}, e2, {
              value: Jb
            }),
            groupEnd: Un({}, e2, {
              value: Zb
            })
          });
        }
        0 > Ch && console.error("disabledDepth fell below zero. This is a bug in React. Please file an issue.");
      }
      function yc(e2) {
        var n = Error.prepareStackTrace;
        if (Error.prepareStackTrace = void 0, e2 = e2.stack, Error.prepareStackTrace = n, e2.startsWith(`Error: react-stack-top-frame
`) && (e2 = e2.slice(29)), n = e2.indexOf(`
`), n !== -1 && (e2 = e2.slice(n + 1)), n = e2.indexOf("react_stack_bottom_frame"), n !== -1 && (n = e2.lastIndexOf(`
`, n)), n !== -1) e2 = e2.slice(0, n);
        else return "";
        return e2;
      }
      function nt(e2) {
        if ($0 === void 0) try {
          throw Error();
        } catch (o2) {
          var n = o2.stack.trim().match(/\n( *(at )?)/);
          $0 = n && n[1] || "", Xb = -1 < o2.stack.indexOf(`
    at`) ? " (<anonymous>)" : -1 < o2.stack.indexOf("@") ? "@unknown:0:0" : "";
        }
        return `
` + $0 + e2 + Xb;
      }
      function vc(e2, n) {
        if (!e2 || Q0) return "";
        var o2 = q0.get(e2);
        if (o2 !== void 0) return o2;
        Q0 = true, o2 = Error.prepareStackTrace, Error.prepareStackTrace = void 0;
        var i3 = null;
        i3 = N2.H, N2.H = null, tl();
        try {
          var s = {
            DetermineComponentFrameRoot: function() {
              try {
                if (n) {
                  var T3 = function() {
                    throw Error();
                  };
                  if (Object.defineProperty(T3.prototype, "props", {
                    set: function() {
                      throw Error();
                    }
                  }), typeof Reflect == "object" && Reflect.construct) {
                    try {
                      Reflect.construct(T3, []);
                    } catch (an) {
                      var H = an;
                    }
                    Reflect.construct(e2, [], T3);
                  } else {
                    try {
                      T3.call();
                    } catch (an) {
                      H = an;
                    }
                    T3 = false;
                    try {
                      var $ = Object.getOwnPropertyDescriptor(e2.prototype, "props");
                      Object.defineProperty(e2.prototype, "props", {
                        configurable: true,
                        set: function() {
                          throw Error();
                        }
                      }), T3 = true, new e2();
                    } finally {
                      T3 && ($ !== void 0 ? Object.defineProperty(e2.prototype, "props", $) : delete e2.prototype.props);
                    }
                  }
                } else {
                  try {
                    throw Error();
                  } catch (an) {
                    H = an;
                  }
                  (T3 = e2()) && typeof T3.catch == "function" && T3.catch(function() {
                  });
                }
              } catch (an) {
                if (an && H && typeof an.stack == "string") return [an.stack, H.stack];
              }
              return [null, null];
            }
          };
          s.DetermineComponentFrameRoot.displayName = "DetermineComponentFrameRoot";
          var u2 = Object.getOwnPropertyDescriptor(s.DetermineComponentFrameRoot, "name");
          u2 && u2.configurable && Object.defineProperty(s.DetermineComponentFrameRoot, "name", {
            value: "DetermineComponentFrameRoot"
          });
          var f = s.DetermineComponentFrameRoot(), p4 = f[0], g3 = f[1];
          if (p4 && g3) {
            var b2 = p4.split(`
`), k2 = g3.split(`
`);
            for (f = u2 = 0; u2 < b2.length && !b2[u2].includes("DetermineComponentFrameRoot"); ) u2++;
            for (; f < k2.length && !k2[f].includes("DetermineComponentFrameRoot"); ) f++;
            if (u2 === b2.length || f === k2.length) for (u2 = b2.length - 1, f = k2.length - 1; 1 <= u2 && 0 <= f && b2[u2] !== k2[f]; ) f--;
            for (; 1 <= u2 && 0 <= f; u2--, f--) if (b2[u2] !== k2[f]) {
              if (u2 !== 1 || f !== 1) do
                if (u2--, f--, 0 > f || b2[u2] !== k2[f]) {
                  var z = `
` + b2[u2].replace(" at new ", " at ");
                  return e2.displayName && z.includes("<anonymous>") && (z = z.replace("<anonymous>", e2.displayName)), typeof e2 == "function" && q0.set(e2, z), z;
                }
              while (1 <= u2 && 0 <= f);
              break;
            }
          }
        } finally {
          Q0 = false, N2.H = i3, sm(), Error.prepareStackTrace = o2;
        }
        return b2 = (b2 = e2 ? e2.displayName || e2.name : "") ? nt(b2) : "", typeof e2 == "function" && q0.set(e2, b2), b2;
      }
      function um(e2, n) {
        switch (e2.tag) {
          case 26:
          case 27:
          case 5:
            return nt(e2.type);
          case 16:
            return nt("Lazy");
          case 13:
            return e2.child !== n && n !== null ? nt("Suspense Fallback") : nt("Suspense");
          case 19:
            return nt("SuspenseList");
          case 0:
          case 15:
            return vc(e2.type, false);
          case 11:
            return vc(e2.type.render, false);
          case 1:
            return vc(e2.type, true);
          case 31:
            return nt("Activity");
          case 30:
            return nt("ViewTransition");
          default:
            return "";
        }
      }
      function cm(e2) {
        try {
          var n = "", o2 = null;
          do {
            n += um(e2, o2);
            var i3 = e2._debugInfo;
            if (i3) for (var s = i3.length - 1; 0 <= s; s--) {
              var u2 = i3[s];
              if (typeof u2.name == "string") {
                var f = n;
                e: {
                  var p4 = u2.name, g3 = u2.env, b2 = u2.debugLocation;
                  if (b2 != null) {
                    var k2 = yc(b2), z = k2.lastIndexOf(`
`), T3 = z === -1 ? k2 : k2.slice(z + 1);
                    if (T3.indexOf(p4) !== -1) {
                      var H = `
` + T3;
                      break e;
                    }
                  }
                  H = nt(p4 + (g3 ? " [" + g3 + "]" : ""));
                }
                n = f + H;
              }
            }
            o2 = e2, e2 = e2.return;
          } while (e2);
          return n;
        } catch ($) {
          return `
Error generating stack: ` + $.message + `
` + $.stack;
        }
      }
      function Sc(e2) {
        return (e2 = e2 ? e2.displayName || e2.name : "") ? nt(e2) : "";
      }
      function Ot(e2, n) {
        if (typeof e2 == "object" && e2 !== null) {
          var o2 = G0.get(e2);
          return o2 !== void 0 ? o2 : (n = {
            value: e2,
            source: n,
            stack: cm(n)
          }, G0.set(e2, n), n);
        }
        return {
          value: e2,
          source: n,
          stack: cm(n)
        };
      }
      function uo(e2, n) {
        jo(), nf[tf++] = zh, nf[tf++] = Rg, Rg = e2, zh = n;
      }
      function dm(e2, n, o2) {
        jo(), Eo[_o++] = Ai, Eo[_o++] = Oi, Eo[_o++] = qu, qu = e2;
        var i3 = Ai;
        e2 = Oi;
        var s = 32 - d(i3) - 1;
        i3 &= ~(1 << s), o2 += 1;
        var u2 = 32 - d(n) + s;
        if (30 < u2) {
          var f = s - s % 5;
          u2 = (i3 & (1 << f) - 1).toString(32), i3 >>= f, s -= f, Ai = 1 << 32 - d(n) + s | o2 << s | i3, Oi = u2 + e2;
        } else Ai = 1 << u2 | o2 << s | i3, Oi = e2;
      }
      function rl(e2) {
        jo(), e2.return !== null && (uo(e2, 1), dm(e2, 1, 0));
      }
      function ol(e2) {
        for (; e2 === Rg; ) Rg = nf[--tf], nf[tf] = null, zh = nf[--tf], nf[tf] = null;
        for (; e2 === qu; ) qu = Eo[--_o], Eo[_o] = null, Oi = Eo[--_o], Eo[_o] = null, Ai = Eo[--_o], Eo[_o] = null;
      }
      function Uf() {
        return jo(), qu !== null ? {
          id: Ai,
          overflow: Oi
        } : null;
      }
      function Ts(e2, n) {
        jo(), Eo[_o++] = Ai, Eo[_o++] = Oi, Eo[_o++] = qu, Ai = n.id, Oi = n.overflow, qu = e2;
      }
      function jo() {
        le || console.error("Expected to be hydrating. This is a bug in React. Please file an issue.");
      }
      function Uo(e2) {
        return e2 === null && console.error("Expected host context to exist. This error is likely caused by a bug in React. Please file an issue."), e2;
      }
      function co(e2, n) {
        ze(ls, n, e2), ze(Eh, e2, e2), ze(is2, null, e2), n = $t(n), mn(is2, e2), ze(is2, n, e2);
      }
      function ai(e2) {
        mn(is2, e2), mn(Eh, e2), mn(ls, e2);
      }
      function Cr() {
        return Uo(is2.current);
      }
      function al(e2) {
        var n = e2.memoizedState;
        n !== null && (n = n.memoizedState, yn ? Jr._currentValue = n : Jr._currentValue2 = n, ze(Lg, e2, e2)), n = Uo(is2.current);
        var o2 = kg(n, e2.type);
        n !== o2 && (ze(Eh, e2, e2), ze(is2, o2, e2));
      }
      function zr(e2) {
        Eh.current === e2 && (mn(is2, e2), mn(Eh, e2)), Lg.current === e2 && (mn(Lg, e2), yn ? Jr._currentValue = Gr : Jr._currentValue2 = Gr);
      }
      function Is(e2, n) {
        return e2.serverProps === void 0 && e2.serverTail.length === 0 && e2.children.length === 1 && 3 < e2.distanceFromLeaf && e2.distanceFromLeaf > 15 - n ? Is(e2.children[0], n) : e2;
      }
      function wt(e2) {
        return "  " + "  ".repeat(e2);
      }
      function Wo(e2) {
        return "+ " + "  ".repeat(e2);
      }
      function fo(e2) {
        return "- " + "  ".repeat(e2);
      }
      function kc(e2) {
        switch (e2.tag) {
          case 26:
          case 27:
          case 5:
            return e2.type;
          case 16:
            return "Lazy";
          case 31:
            return "Activity";
          case 13:
            return "Suspense";
          case 19:
            return "SuspenseList";
          case 0:
          case 15:
            return e2 = e2.type, e2.displayName || e2.name || null;
          case 11:
            return e2 = e2.type.render, e2.displayName || e2.name || null;
          case 1:
            return e2 = e2.type, e2.displayName || e2.name || null;
          default:
            return null;
        }
      }
      function Er(e2, n) {
        return Yb.test(e2) ? (e2 = JSON.stringify(e2), e2.length > n - 2 ? 8 > n ? '{"..."}' : "{" + e2.slice(0, n - 7) + '..."}' : "{" + e2 + "}") : e2.length > n ? 5 > n ? '{"..."}' : e2.slice(0, n - 3) + "..." : e2;
      }
      function Rs(e2, n, o2) {
        var i3 = 120 - 2 * o2;
        if (n === null) return Wo(o2) + Er(e2, i3) + `
`;
        if (typeof n == "string") {
          for (var s = 0; s < n.length && s < e2.length && n.charCodeAt(s) === e2.charCodeAt(s); s++) ;
          return s > i3 - 8 && 10 < s && (e2 = "..." + e2.slice(s - 8), n = "..." + n.slice(s - 8)), Wo(o2) + Er(e2, i3) + `
` + fo(o2) + Er(n, i3) + `
`;
        }
        return wt(o2) + Er(e2, i3) + `
`;
      }
      function il(e2) {
        return Object.prototype.toString.call(e2).replace(/^\[object (.*)\]$/, function(n, o2) {
          return o2;
        });
      }
      function ii(e2, n) {
        switch (typeof e2) {
          case "string":
            return e2 = JSON.stringify(e2), e2.length > n ? 5 > n ? '"..."' : e2.slice(0, n - 4) + '..."' : e2;
          case "object":
            if (e2 === null) return "null";
            if (Gn(e2)) return "[...]";
            if (e2.$$typeof === xo) return (n = en(e2.type)) ? "<" + n + ">" : "<...>";
            var o2 = il(e2);
            if (o2 === "Object") {
              o2 = "", n -= 2;
              for (var i3 in e2) if (e2.hasOwnProperty(i3)) {
                var s = JSON.stringify(i3);
                if (s !== '"' + i3 + '"' && (i3 = s), n -= i3.length - 2, s = ii(e2[i3], 15 > n ? n : 15), n -= s.length, 0 > n) {
                  o2 += o2 === "" ? "..." : ", ...";
                  break;
                }
                o2 += (o2 === "" ? "" : ",") + i3 + ":" + s;
              }
              return "{" + o2 + "}";
            }
            return o2;
          case "function":
            return (n = e2.displayName || e2.name) ? "function " + n : "function";
          default:
            return String(e2);
        }
      }
      function Sa(e2, n) {
        return typeof e2 != "string" || Yb.test(e2) ? "{" + ii(e2, n - 2) + "}" : e2.length > n - 2 ? 5 > n ? '"..."' : '"' + e2.slice(0, n - 5) + '..."' : '"' + e2 + '"';
      }
      function po(e2, n, o2) {
        var i3 = 120 - o2.length - e2.length, s = [], u2;
        for (u2 in n) if (n.hasOwnProperty(u2) && u2 !== "children") {
          var f = Sa(n[u2], 120 - o2.length - u2.length - 1);
          i3 -= u2.length + f.length + 2, s.push(u2 + "=" + f);
        }
        return s.length === 0 ? o2 + "<" + e2 + `>
` : 0 < i3 ? o2 + "<" + e2 + " " + s.join(" ") + `>
` : o2 + "<" + e2 + `
` + o2 + "  " + s.join(`
` + o2 + "  ") + `
` + o2 + `>
`;
      }
      function ka(e2, n, o2) {
        var i3 = "", s = Un({}, n), u2;
        for (u2 in e2) if (e2.hasOwnProperty(u2)) {
          delete s[u2];
          var f = 120 - 2 * o2 - u2.length - 2, p4 = ii(e2[u2], f);
          n.hasOwnProperty(u2) ? (f = ii(n[u2], f), i3 += Wo(o2) + u2 + ": " + p4 + `
`, i3 += fo(o2) + u2 + ": " + f + `
`) : i3 += Wo(o2) + u2 + ": " + p4 + `
`;
        }
        for (var g3 in s) s.hasOwnProperty(g3) && (e2 = ii(s[g3], 120 - 2 * o2 - g3.length - 2), i3 += fo(o2) + g3 + ": " + e2 + `
`);
        return i3;
      }
      function Ls(e2, n, o2, i3) {
        var s = "", u2 = /* @__PURE__ */ new Map();
        for (b2 in o2) o2.hasOwnProperty(b2) && u2.set(b2.toLowerCase(), b2);
        if (u2.size === 1 && u2.has("children")) s += po(e2, n, wt(i3));
        else {
          for (var f in n) if (n.hasOwnProperty(f) && f !== "children") {
            var p4 = 120 - 2 * (i3 + 1) - f.length - 1, g3 = u2.get(f.toLowerCase());
            if (g3 !== void 0) {
              u2.delete(f.toLowerCase());
              var b2 = n[f];
              g3 = o2[g3];
              var k2 = Sa(b2, p4);
              p4 = Sa(g3, p4), typeof b2 == "object" && b2 !== null && typeof g3 == "object" && g3 !== null && il(b2) === "Object" && il(g3) === "Object" && (2 < Object.keys(b2).length || 2 < Object.keys(g3).length || -1 < k2.indexOf("...") || -1 < p4.indexOf("...")) ? s += wt(i3 + 1) + f + `={{
` + ka(b2, g3, i3 + 2) + wt(i3 + 1) + `}}
` : (s += Wo(i3 + 1) + f + "=" + k2 + `
`, s += fo(i3 + 1) + f + "=" + p4 + `
`);
            } else s += wt(i3 + 1) + f + "=" + Sa(n[f], p4) + `
`;
          }
          u2.forEach(function(z) {
            if (z !== "children") {
              var T3 = 120 - 2 * (i3 + 1) - z.length - 1;
              s += fo(i3 + 1) + z + "=" + Sa(o2[z], T3) + `
`;
            }
          }), s = s === "" ? wt(i3) + "<" + e2 + `>
` : wt(i3) + "<" + e2 + `
` + s + wt(i3) + `>
`;
        }
        return e2 = o2.children, n = n.children, typeof e2 == "string" || typeof e2 == "number" || typeof e2 == "bigint" ? (u2 = "", (typeof n == "string" || typeof n == "number" || typeof n == "bigint") && (u2 = "" + n), s += Rs(u2, "" + e2, i3 + 1)) : (typeof n == "string" || typeof n == "number" || typeof n == "bigint") && (s = e2 == null ? s + Rs("" + n, null, i3 + 1) : s + Rs("" + n, void 0, i3 + 1)), s;
      }
      function wc(e2, n) {
        var o2 = kc(e2);
        if (o2 === null) {
          for (o2 = "", e2 = e2.child; e2; ) o2 += wc(e2, n), e2 = e2.sibling;
          return o2;
        }
        return wt(n) + "<" + o2 + `>
`;
      }
      function li(e2, n) {
        var o2 = Is(e2, n);
        if (o2 !== e2 && (e2.children.length !== 1 || e2.children[0] !== o2)) return wt(n) + `...
` + li(o2, n + 1);
        o2 = "";
        var i3 = e2.fiber._debugInfo;
        if (i3) for (var s = 0; s < i3.length; s++) {
          var u2 = i3[s].name;
          typeof u2 == "string" && (o2 += wt(n) + "<" + u2 + `>
`, n++);
        }
        if (i3 = "", s = e2.fiber.pendingProps, e2.fiber.tag === 6) i3 = Rs(s, e2.serverProps, n), n++;
        else if (u2 = kc(e2.fiber), u2 !== null) if (e2.serverProps === void 0) {
          i3 = n;
          var f = 120 - 2 * i3 - u2.length - 2, p4 = "";
          for (b2 in s) if (s.hasOwnProperty(b2) && b2 !== "children") {
            var g3 = Sa(s[b2], 15);
            if (f -= b2.length + g3.length + 2, 0 > f) {
              p4 += " ...";
              break;
            }
            p4 += " " + b2 + "=" + g3;
          }
          i3 = wt(i3) + "<" + u2 + p4 + `>
`, n++;
        } else e2.serverProps === null ? (i3 = po(u2, s, Wo(n)), n++) : typeof e2.serverProps == "string" ? console.error("Should not have matched a non HostText fiber to a Text node. This is a bug in React.") : (i3 = Ls(u2, s, e2.serverProps, n), n++);
        var b2 = "";
        for (s = e2.fiber.child, u2 = 0; s && u2 < e2.children.length; ) f = e2.children[u2], f.fiber === s ? (b2 += li(f, n), u2++) : b2 += wc(s, n), s = s.sibling;
        for (s && 0 < e2.children.length && (b2 += wt(n) + `...
`), s = e2.serverTail, e2.serverProps === null && n--, e2 = 0; e2 < s.length; e2++) u2 = s[e2], b2 = typeof u2 == "string" ? b2 + (fo(n) + Er(u2, 120 - 2 * n) + `
`) : b2 + po(u2.type, u2.props, fo(n));
        return o2 + i3 + b2;
      }
      function ll(e2) {
        try {
          return `

` + li(e2, 0);
        } catch {
          return "";
        }
      }
      function fm() {
        if (Bi === null) return "";
        var e2 = Bi;
        try {
          var n = "";
          switch (e2.tag === 6 && (e2 = e2.return), e2.tag) {
            case 26:
            case 27:
            case 5:
              n += nt(e2.type);
              break;
            case 13:
              n += nt("Suspense");
              break;
            case 19:
              n += nt("SuspenseList");
              break;
            case 31:
              n += nt("Activity");
              break;
            case 30:
              n += nt("ViewTransition");
              break;
            case 0:
            case 15:
            case 1:
              e2._debugOwner || n !== "" || (n += Sc(e2.type));
              break;
            case 11:
              e2._debugOwner || n !== "" || (n += Sc(e2.type.render));
          }
          for (; e2; ) if (typeof e2.tag == "number") {
            var o2 = e2;
            e2 = o2._debugOwner;
            var i3 = o2._debugStack;
            if (e2 && i3) {
              var s = yc(i3);
              s !== "" && (n += `
` + s);
            }
          } else if (e2.debugStack != null) {
            var u2 = e2.debugStack;
            (e2 = e2.owner) && u2 && (n += `
` + yc(u2));
          } else break;
          var f = n;
        } catch (p4) {
          f = `
Error generating stack: ` + p4.message + `
` + p4.stack;
        }
        return f;
      }
      function B(e2, n, o2, i3, s, u2, f) {
        var p4 = Bi;
        Pc(e2);
        try {
          return e2 !== null && e2._debugTask ? e2._debugTask.run(n.bind(null, o2, i3, s, u2, f)) : n(o2, i3, s, u2, f);
        } finally {
          Pc(p4);
        }
        throw Error("runWithFiberInDEV should never be called in production. This is a bug in React.");
      }
      function Pc(e2) {
        N2.getCurrentStack = e2 === null ? null : fm, Qa = false, Bi = e2;
      }
      function Ao(e2, n) {
        if (e2.return === null) {
          if (Kr === null) Kr = {
            fiber: e2,
            children: [],
            serverProps: void 0,
            serverTail: [],
            distanceFromLeaf: n
          };
          else {
            if (Kr.fiber !== e2) throw Error("Saw multiple hydration diff roots in a pass. This is a bug in React.");
            Kr.distanceFromLeaf > n && (Kr.distanceFromLeaf = n);
          }
          return Kr;
        }
        var o2 = Ao(e2.return, n + 1).children;
        return 0 < o2.length && o2[o2.length - 1].fiber === e2 ? (o2 = o2[o2.length - 1], o2.distanceFromLeaf > n && (o2.distanceFromLeaf = n), o2) : (n = {
          fiber: e2,
          children: [],
          serverProps: void 0,
          serverTail: [],
          distanceFromLeaf: n
        }, o2.push(n), n);
      }
      function xc() {
        le && console.error("We should not be hydrating here. This is a bug in React. Please file a bug.");
      }
      function _r(e2, n) {
        qa || (e2 = Ao(e2, 0), e2.serverProps = null, n !== null && (n = Ft(n), e2.serverTail.push(n)));
      }
      function Nr(e2) {
        var n = 1 < arguments.length && arguments[1] !== void 0 ? arguments[1] : false, o2 = "", i3 = Kr;
        throw i3 !== null && (Kr = null, o2 = ll(i3)), Ve(Ot(Error("Hydration failed because the server rendered " + (n ? "text" : "HTML") + ` didn't match the client. As a result this tree will be regenerated on the client. This can happen if a SSR-ed Client Component used:

- A server/client branch \`if (typeof window !== 'undefined')\`.
- Variable input such as \`Date.now()\` or \`Math.random()\` which changes each time it's called.
- Date formatting in a user's locale which doesn't match the server.
- External changing data without sending a snapshot of it along with the HTML.
- Invalid HTML tag nesting.

It can also happen if the client has a browser extension installed which messes with the HTML before React loaded.

https://react.dev/link/hydration-mismatch` + o2), e2)), J0;
      }
      function Wf(e2, n) {
        if (!$e) throw Error("Expected prepareToHydrateHostInstance() to never be called. This error is likely caused by a bug in React. Please file an issue.");
        Jd(e2.stateNode, e2.type, e2.memoizedProps, n, e2) || Nr(e2, true);
      }
      function Tr(e2) {
        for (st = e2.return; st; ) switch (st.tag) {
          case 5:
          case 31:
          case 13:
            No = false;
            return;
          case 27:
          case 3:
            No = true;
            return;
          default:
            st = st.return;
        }
      }
      function Ln(e2) {
        if (!$e || e2 !== st) return false;
        if (!le) return Tr(e2), le = true, false;
        var n = e2.tag;
        if (je ? n !== 3 && n !== 27 && (n !== 5 || aa(e2.type) && !ea(e2.type, e2.memoizedProps)) && rn && (sl(e2), Nr(e2)) : n !== 3 && (n !== 5 || aa(e2.type) && !ea(e2.type, e2.memoizedProps)) && rn && (sl(e2), Nr(e2)), Tr(e2), n === 13) {
          if (!$e) throw Error("Expected skipPastDehydratedSuspenseInstance() to never be called. This error is likely caused by a bug in React. Please file an issue.");
          if (e2 = e2.memoizedState, e2 = e2 !== null ? e2.dehydrated : null, !e2) throw Error("Expected to have a hydrated suspense instance. This error is likely caused by a bug in React. Please file an issue.");
          rn = de(e2);
        } else if (n === 31) {
          if (e2 = e2.memoizedState, e2 = e2 !== null ? e2.dehydrated : null, !e2) throw Error("Expected to have a hydrated suspense instance. This error is likely caused by a bug in React. Please file an issue.");
          rn = M0(e2);
        } else rn = je && n === 27 ? Hu(e2.type, rn) : st ? gr(e2.stateNode) : null;
        return true;
      }
      function sl(e2) {
        for (var n = rn; n; ) {
          var o2 = Ao(e2, 0), i3 = Ft(n);
          o2.serverTail.push(i3), n = i3.type === "Suspense" ? de(n) : gr(n);
        }
      }
      function Oo() {
        $e && (rn = st = null, qa = le = false);
      }
      function ul() {
        var e2 = ss;
        return e2 !== null && (Yt === null ? Yt = e2 : Yt.push.apply(Yt, e2), ss = null), e2;
      }
      function Ve(e2) {
        ss === null ? ss = [e2] : ss.push(e2);
      }
      function Fs() {
        var e2 = Kr;
        if (e2 !== null) {
          Kr = null;
          for (var n = ll(e2); 0 < e2.children.length; ) e2 = e2.children[0];
          B(e2.fiber, function() {
            console.error(`A tree hydrated but some attributes of the server rendered HTML didn't match the client properties. This won't be patched up. This can happen if a SSR-ed Client Component used:

- A server/client branch \`if (typeof window !== 'undefined')\`.
- Variable input such as \`Date.now()\` or \`Math.random()\` which changes each time it's called.
- Date formatting in a user's locale which doesn't match the server.
- External changing data without sending a snapshot of it along with the HTML.
- Invalid HTML tag nesting.

It can also happen if the client has a browser extension installed which messes with the HTML before React loaded.

%s%s`, "https://react.dev/link/hydration-mismatch", n);
          });
        }
      }
      function cl() {
        rf = jg = null, of = false;
      }
      function Bo(e2, n, o2) {
        yn ? (ze(Fg, n._currentValue, e2), n._currentValue = o2, ze(Z0, n._currentRenderer, e2), n._currentRenderer !== void 0 && n._currentRenderer !== null && n._currentRenderer !== Dg && console.error("Detected multiple renderers concurrently rendering the same context provider. This is currently unsupported."), n._currentRenderer = Dg) : (ze(Fg, n._currentValue2, e2), n._currentValue2 = o2, ze(X0, n._currentRenderer2, e2), n._currentRenderer2 !== void 0 && n._currentRenderer2 !== null && n._currentRenderer2 !== Dg && console.error("Detected multiple renderers concurrently rendering the same context provider. This is currently unsupported."), n._currentRenderer2 = Dg);
      }
      function ho(e2, n) {
        var o2 = Fg.current;
        yn ? (e2._currentValue = o2, o2 = Z0.current, mn(Z0, n), e2._currentRenderer = o2) : (e2._currentValue2 = o2, o2 = X0.current, mn(X0, n), e2._currentRenderer2 = o2), mn(Fg, n);
      }
      function Cc(e2, n, o2) {
        for (; e2 !== null; ) {
          var i3 = e2.alternate;
          if ((e2.childLanes & n) !== n ? (e2.childLanes |= n, i3 !== null && (i3.childLanes |= n)) : i3 !== null && (i3.childLanes & n) !== n && (i3.childLanes |= n), e2 === o2) break;
          e2 = e2.return;
        }
        e2 !== o2 && console.error("Expected to find the propagation root when scheduling context work. This error is likely caused by a bug in React. Please file an issue.");
      }
      function Ds(e2, n, o2, i3) {
        var s = e2.child;
        for (s !== null && (s.return = e2); s !== null; ) {
          var u2 = s.dependencies;
          if (u2 !== null) {
            var f = s.child;
            u2 = u2.firstContext;
            e: for (; u2 !== null; ) {
              var p4 = u2;
              u2 = s;
              for (var g3 = 0; g3 < n.length; g3++) if (p4.context === n[g3]) {
                u2.lanes |= o2, p4 = u2.alternate, p4 !== null && (p4.lanes |= o2), Cc(u2.return, o2, e2), i3 || (f = null);
                break e;
              }
              u2 = p4.next;
            }
          } else if (s.tag === 18) {
            if (f = s.return, f === null) throw Error("We just came from a parent so we must have had a parent. This is a bug in React.");
            f.lanes |= o2, u2 = f.alternate, u2 !== null && (u2.lanes |= o2), Cc(f, o2, e2), f = null;
          } else s.tag === 13 && s.memoizedState !== null && s.memoizedState.dehydrated === null ? (s.lanes |= o2, f = s.alternate, f !== null && (f.lanes |= o2), Cc(s.return, o2, e2), f = s.child, f = f !== null ? f.sibling : null) : f = s.child;
          if (f !== null) f.return = s;
          else for (f = s; f !== null; ) {
            if (f === e2) {
              f = null;
              break;
            }
            if (s = f.sibling, s !== null) {
              s.return = f.return, f = s;
              break;
            }
            f = f.return;
          }
          s = f;
        }
      }
      function Ho(e2, n, o2, i3) {
        e2 = null;
        for (var s = n, u2 = false; s !== null; ) {
          if (!u2) {
            if ((s.flags & 524288) !== 0) u2 = true;
            else if ((s.flags & 262144) !== 0) break;
          }
          if (s.tag === 10) {
            var f = s.alternate;
            if (f === null) throw Error("Should have a current fiber. This is a bug in React.");
            if (f = f.memoizedProps, f !== null) {
              var p4 = s.type;
              Gt(s.pendingProps.value, f.value) || (e2 !== null ? e2.push(p4) : e2 = [p4]);
            }
          } else if (s === Lg.current) {
            if (f = s.alternate, f === null) throw Error("Should have a current fiber. This is a bug in React.");
            f.memoizedState.memoizedState !== s.memoizedState.memoizedState && (e2 !== null ? e2.push(Jr) : e2 = [Jr]);
          }
          s = s.return;
        }
        return e2 !== null && Ds(n, e2, o2, i3), n.flags |= 262144, e2 !== null;
      }
      function dl(e2) {
        for (e2 = e2.firstContext; e2 !== null; ) {
          var n = e2.context;
          if (!Gt(yn ? n._currentValue : n._currentValue2, e2.memoizedValue)) return true;
          e2 = e2.next;
        }
        return false;
      }
      function gn(e2) {
        jg = e2, rf = null, e2 = e2.dependencies, e2 !== null && (e2.firstContext = null);
      }
      function K(e2) {
        return of && console.error("Context can only be read while React is rendering. In classes, you can read it in the render method or getDerivedStateFromProps. In function components, you can read it directly in the function body, but not inside Hooks like useReducer() or useMemo()."), fl(jg, e2);
      }
      function si(e2, n) {
        return jg === null && gn(e2), fl(e2, n);
      }
      function fl(e2, n) {
        var o2 = yn ? n._currentValue : n._currentValue2;
        if (n = {
          context: n,
          memoizedValue: o2,
          next: null
        }, rf === null) {
          if (e2 === null) throw Error("Context can only be read while React is rendering. In classes, you can read it in the render method or getDerivedStateFromProps. In function components, you can read it directly in the function body, but not inside Hooks like useReducer() or useMemo().");
          rf = n, e2.dependencies = {
            lanes: 0,
            firstContext: n,
            _debugThenableState: null
          }, e2.flags |= 524288;
        } else rf = rf.next = n;
        return o2;
      }
      function pl() {
        return {
          controller: new N1(),
          data: /* @__PURE__ */ new Map(),
          refCount: 0
        };
      }
      function Mo(e2) {
        e2.controller.signal.aborted && console.warn("A cache instance was retained after it was already freed. This likely indicates a bug in React."), e2.refCount++;
      }
      function Bt(e2) {
        e2.refCount--, 0 > e2.refCount && console.warn("A cache instance was released after it was already freed. This likely indicates a bug in React."), e2.refCount === 0 && T1(I1, function() {
          e2.controller.abort();
        });
      }
      function js(e2, n) {
        if ((e2.pendingLanes & 4194048) !== 0) {
          var o2 = e2.transitionTypes;
          for (o2 === null && (o2 = e2.transitionTypes = []), e2 = 0; e2 < n.length; e2++) {
            var i3 = n[e2];
            o2.indexOf(i3) === -1 && o2.push(i3);
          }
        }
      }
      function Af(e2) {
        var n = e2.transitionTypes;
        return e2.transitionTypes = null, n;
      }
      function tr(e2, n, o2) {
        (e2 & 127) !== 0 ? 0 > Ga && (Ga = Tn(), Nh = Ug(n), Y0 = n, o2 != null && (K0 = G(o2)), $p() && (Sn = true, cs = 1), e2 = pr(), n = ne(), e2 !== af || n !== Th ? af = -1.1 : n !== null && (cs = 1), Ju = e2, Th = n) : (e2 & 4194048) !== 0 && 0 > To && (To = Tn(), Ih = Ug(n), Kb = n, o2 != null && (ey = G(o2)), 0 > Vi) && (e2 = pr(), n = ne(), (e2 !== fs || n !== Zu) && (fs = -1.1), ds = e2, Zu = n);
      }
      function pm(e2) {
        if (0 > Ga) {
          Ga = Tn(), Nh = e2._debugTask != null ? e2._debugTask : null, $p() && (cs = 1);
          var n = pr(), o2 = ne();
          n !== af || o2 !== Th ? af = -1.1 : o2 !== null && (cs = 1), Ju = n, Th = o2;
        }
        0 > To && (To = Tn(), Ih = e2._debugTask != null ? e2._debugTask : null, 0 > Vi) && (e2 = pr(), n = ne(), (e2 !== fs || n !== Zu) && (fs = -1.1), ds = e2, Zu = n);
      }
      function mo() {
        var e2 = Gu;
        return Gu = 0, e2;
      }
      function Us(e2) {
        var n = Gu;
        return Gu = e2, n;
      }
      function hl(e2) {
        var n = Gu;
        return Gu += e2, n;
      }
      function Ws() {
        J = V = -1.1;
      }
      function Pt() {
        var e2 = V;
        return V = -1.1, e2;
      }
      function gt(e2) {
        0 <= e2 && (V = e2);
      }
      function Ir() {
        var e2 = dn;
        return dn = -0, e2;
      }
      function go(e2) {
        0 <= e2 && (dn = e2);
      }
      function Rr() {
        var e2 = on;
        return on = null, e2;
      }
      function Lr() {
        var e2 = Sn;
        return Sn = false, e2;
      }
      function zc(e2) {
        Jt = Tn(), 0 > e2.actualStartTime && (e2.actualStartTime = Jt);
      }
      function As(e2) {
        if (0 <= Jt) {
          var n = Tn() - Jt;
          e2.actualDuration += n, e2.selfBaseDuration = n, Jt = -1;
        }
      }
      function Of(e2) {
        if (0 <= Jt) {
          var n = Tn() - Jt;
          e2.actualDuration += n, Jt = -1;
        }
      }
      function Fr() {
        if (0 <= Jt) {
          var e2 = Tn(), n = e2 - Jt;
          Jt = -1, Gu += n, dn += n, J = e2;
        }
      }
      function Bf(e2) {
        on === null && (on = []), on.push(e2), Mi === null && (Mi = []), Mi.push(e2);
      }
      function Dr() {
        Jt = Tn(), 0 > V && (V = Jt);
      }
      function ml(e2) {
        for (var n = e2.child; n; ) e2.actualDuration += n.actualDuration, n = n.sibling;
      }
      function Ec() {
      }
      function jr(e2) {
        e2 !== sf && e2.next === null && (sf === null ? lf = sf = e2 : sf = sf.next = e2), Hg = true, N2.actQueue !== null ? ob || (ob = true, $f()) : rb || (rb = true, $f());
      }
      function Ur(e2, n) {
        if (!ab && Hg) {
          ab = true;
          do
            for (var o2 = false, i3 = lf; i3 !== null; ) {
              if (!n) if (e2 !== 0) {
                var s = i3.pendingLanes;
                if (s === 0) var u2 = 0;
                else {
                  var f = i3.suspendedLanes, p4 = i3.pingedLanes;
                  u2 = (1 << 31 - d(42 | e2) + 1) - 1, u2 &= s & ~(f & ~p4), u2 = u2 & 201326741 ? u2 & 201326741 | 1 : u2 ? u2 | 2 : 0;
                }
                u2 !== 0 && (o2 = true, _c(i3, u2));
              } else u2 = te, u2 = ks(i3, i3 === Ge ? u2 : 0, i3.cancelPendingCommit !== null || i3.timeoutHandle !== Wn), (u2 & 3) === 0 || At(i3, u2) || (o2 = true, _c(i3, u2));
              i3 = i3.next;
            }
          while (o2);
          ab = false;
        }
      }
      function Hf() {
        Qe(), gl();
      }
      function gl() {
        Hg = ob = rb = false;
        var e2 = 0;
        Yu !== 0 && hr() && (e2 = Yu);
        for (var n = Re(), o2 = null, i3 = lf; i3 !== null; ) {
          var s = i3.next, u2 = Os(i3, n);
          u2 === 0 ? (i3.next = null, o2 === null ? lf = s : o2.next = s, s === null && (sf = o2)) : (o2 = i3, (e2 !== 0 || (u2 & 3) !== 0) && (Hg = true)), i3 = s;
        }
        pn !== ni && pn !== h0 || Ur(e2, false), Yu !== 0 && (Yu = 0);
      }
      function Os(e2, n) {
        for (var o2 = e2.suspendedLanes, i3 = e2.pingedLanes, s = e2.expirationTimes, u2 = e2.pendingLanes & -62914561; 0 < u2; ) {
          var f = 31 - d(u2), p4 = 1 << f, g3 = s[f];
          g3 === -1 ? ((p4 & o2) === 0 || (p4 & i3) !== 0) && (s[f] = ba(p4, n)) : g3 <= n && (e2.expiredLanes |= p4), u2 &= ~p4;
        }
        if (n = Ge, o2 = te, o2 = ks(e2, e2 === n ? o2 : 0, e2.cancelPendingCommit !== null || e2.timeoutHandle !== Wn), i3 = e2.callbackNode, o2 === 0 || e2 === n && (Ae === sc || Ae === uc) || e2.cancelPendingCommit !== null) return i3 !== null && Vf(i3), e2.callbackNode = null, e2.callbackPriority = 0;
        if ((o2 & 3) === 0 || At(e2, o2)) {
          if (n = o2 & -o2, n !== e2.callbackPriority || N2.actQueue !== null && i3 !== ib) Vf(i3);
          else return n;
          switch (ya(o2)) {
            case 2:
            case 8:
              o2 = x2;
              break;
            case 32:
              o2 = P2;
              break;
            case 268435456:
              o2 = E3;
              break;
            default:
              o2 = P2;
          }
          return i3 = Mf.bind(null, e2), N2.actQueue !== null ? (N2.actQueue.push(i3), o2 = ib) : o2 = U(o2, i3), e2.callbackPriority = n, e2.callbackNode = o2, n;
        }
        return i3 !== null && Vf(i3), e2.callbackPriority = 2, e2.callbackNode = null, 2;
      }
      function Mf(e2, n) {
        if (Bg = Og = false, Qe(), pn !== ni && pn !== h0) return e2.callbackNode = null, e2.callbackPriority = 0, null;
        var o2 = e2.callbackNode;
        if (ro === p0 && (ro = Lb), Ol() && e2.callbackNode !== o2) return null;
        var i3 = te;
        return i3 = ks(e2, e2 === Ge ? i3 : 0, e2.cancelPendingCommit !== null || e2.timeoutHandle !== Wn), i3 === 0 ? null : (Zm(e2, i3, n), Os(e2, Re()), e2.callbackNode != null && e2.callbackNode === o2 ? Mf.bind(null, e2) : null);
      }
      function _c(e2, n) {
        if (Ol()) return null;
        Og = Bg, Bg = false, Zm(e2, n, true);
      }
      function Vf(e2) {
        e2 !== ib && e2 !== null && A(e2);
      }
      function $f() {
        N2.actQueue !== null && N2.actQueue.push(function() {
          return gl(), null;
        }), Ti ? Wu(function() {
          (ve & (pt | Fo)) !== ft ? U(ia, Hf) : gl();
        }) : U(ia, Hf);
      }
      function Nc() {
        if (Yu === 0) {
          var e2 = ps;
          e2 === 0 && (e2 = C2, C2 <<= 1, (C2 & 261888) === 0 && (C2 = 256)), Yu = e2;
        }
        return Yu;
      }
      function hm(e2, n) {
        if (Lh === null) {
          var o2 = Lh = [];
          lb = 0, ps = Nc(), uf = {
            status: "pending",
            value: void 0,
            then: function(i3) {
              o2.push(i3);
            }
          };
        }
        return lb++, n.then(Qf, Qf), n;
      }
      function Qf() {
        if (--lb === 0 && (-1 < To || (Vi = -1.1), _h = null, Lh !== null)) {
          uf !== null && (uf.status = "fulfilled");
          var e2 = Lh;
          Lh = null, ps = 0, uf = null;
          for (var n = 0; n < e2.length; n++) (0, e2[n])();
        }
      }
      function mm(e2, n) {
        var o2 = [], i3 = {
          status: "pending",
          value: null,
          reason: null,
          then: function(s) {
            o2.push(s);
          }
        };
        return e2.then(function() {
          i3.status = "fulfilled", i3.value = n;
          for (var s = 0; s < o2.length; s++) (0, o2[s])(n);
        }, function(s) {
          for (i3.status = "rejected", i3.reason = s, s = 0; s < o2.length; s++) (0, o2[s])(void 0);
        }), i3;
      }
      function Bs() {
        var e2 = Ku.current;
        return e2 !== null ? e2 : Ge.pooledCache;
      }
      function Hs(e2, n) {
        n === null ? ze(Ku, Ku.current, e2) : ze(Ku, n.pool, e2);
      }
      function qf() {
        var e2 = Bs();
        return e2 === null ? null : {
          parent: yn ? vn._currentValue : vn._currentValue2,
          pool: e2
        };
      }
      function bl(e2, n) {
        if (Gt(e2, n)) return true;
        if (typeof e2 != "object" || e2 === null || typeof n != "object" || n === null) return false;
        var o2 = Object.keys(e2), i3 = Object.keys(n);
        if (o2.length !== i3.length) return false;
        for (i3 = 0; i3 < o2.length; i3++) {
          var s = o2[i3];
          if (!Ig.call(n, s) || !Gt(e2[s], n[s])) return false;
        }
        return true;
      }
      function Gf() {
        return {
          didWarnAboutUncachedPromise: false,
          thenables: []
        };
      }
      function Jf(e2) {
        return e2 = e2.status, e2 === "fulfilled" || e2 === "rejected";
      }
      function Zf(e2, n, o2, i3) {
        N2.actQueue !== null && (N2.didUsePromise = true);
        var s = e2.thenables;
        if (o2 = s[o2], o2 === void 0 ? s.push(n) : o2 !== n && (e2.didWarnAboutUncachedPromise || (e2.didWarnAboutUncachedPromise = true, console.error("A component was suspended by an uncached promise. Creating promises inside a Client Component or hook is not yet supported, except via a Suspense-compatible library or framework.")), n.then(Ec, Ec), n = o2), n._debugInfo === void 0) {
          e2 = performance.now(), s = n.displayName;
          var u2 = {
            name: typeof s == "string" ? s : "Promise",
            start: e2,
            end: e2,
            value: n
          };
          n._debugInfo = [{
            awaited: u2
          }], n.status !== "fulfilled" && n.status !== "rejected" && (e2 = function() {
            u2.end = performance.now();
          }, n.then(e2, e2));
        }
        switch (n.status) {
          case "fulfilled":
            return n.value;
          case "rejected":
            throw i3 = n.reason, Yf(i3), i3 === void 0 && !("reason" in n) ? Error("A rejected Promise was passed to React without a `reason` property. React threw a generic error from where the Promise was used to assist in identifying the problematic Promise. Make sure that instrumented Promises correctly set the `reason` property when setting `status` to `'rejected'`.") : i3;
          default:
            if (typeof n.status == "string") n.then(Ec, Ec);
            else {
              if (e2 = Ge, e2 !== null && 100 < e2.shellSuspendCounter) throw Error("An unknown Component is an async Client Component. Only Server Components can be async at the moment. This error is often caused by accidentally adding `'use client'` to a module that was originally written for the server.");
              e2 = n, e2.status = "pending", e2.then(function(f) {
                if (n.status === "pending") {
                  var p4 = n;
                  p4.status = "fulfilled", p4.value = f;
                }
              }, function(f) {
                if (n.status === "pending") {
                  var p4 = n;
                  p4.status = "rejected", p4.reason = f;
                }
              });
            }
            switch (n.status) {
              case "fulfilled":
                return n.value;
              case "rejected":
                throw i3 = n.reason, Yf(i3), i3;
            }
            throw tc = n, Oh = true, db || i3 === null || i3.alternate !== null || (nc = i3, Qg = Error("This library called use() to suspend in a previous render but did not call use() when it finished. This indicates an incorrect use of use(). Learn more: https://react.dev/warnings/conditional-use-of-use")), cf;
        }
      }
      function bo(e2) {
        try {
          return j1(e2);
        } catch (n) {
          throw n !== null && typeof n == "object" && typeof n.then == "function" ? (tc = n, Oh = true, cf) : n;
        }
      }
      function Xf() {
        if (tc === null) throw Error("Expected a suspended thenable. This is a bug in React. Please file an issue.");
        var e2 = tc;
        return tc = null, Oh = false, e2;
      }
      function Yf(e2) {
        if (e2 === cf || e2 === Vg) throw Error("Hooks are not supported inside an async component. This error is often caused by accidentally adding `'use client'` to a module that was originally written for the server.");
      }
      function gm(e2, n) {
        return e2 === n ? true : e2.tag !== n.tag || e2.type !== n.type || e2.key !== n.key || e2.index !== n.index || e2.tag === 3 && e2.stateNode !== n.stateNode || e2.return === null || n.return === null ? false : gm(e2.return, n.return);
      }
      function bt(e2) {
        var n = pe;
        return e2 != null && (pe = n === null ? e2 : n.concat(e2)), n;
      }
      function Tc() {
        var e2 = pe;
        if (e2 != null) {
          for (var n = e2.length - 1; 0 <= n; n--) if (e2[n].name != null) {
            var o2 = e2[n].debugTask;
            if (o2 != null) return o2;
          }
        }
        return null;
      }
      function wa(e2, n, o2) {
        for (var i3 = Object.keys(e2.props), s = 0; s < i3.length; s++) {
          var u2 = i3[s];
          if (u2 !== "children" && u2 !== "key" && u2 !== "ref") {
            n === null && (n = Id(e2, o2.mode, 0), n._debugInfo = pe, n.return = o2), B(n, function(f) {
              console.error("Invalid prop `%s` supplied to `React.Fragment`. React.Fragment can only have `key`, `ref`, and `children` props.", f);
            }, u2);
            break;
          }
        }
      }
      function yl(e2) {
        var n = Bh;
        return Bh += 1, df === null && (df = Gf()), Zf(df, e2, n, null);
      }
      function Wr(e2, n) {
        n = n.props.ref, e2.ref = n !== void 0 ? n : null;
      }
      function Kf(e2, n) {
        throw n.$$typeof === D0 ? Error(`A React Element from an older version of React was rendered. This is not supported. It can happen if:
- Multiple copies of the "react" package is used.
- A library pre-bundled an old copy of "react" or "react/jsx-runtime".
- A compiler tries to "inline" JSX instead of using the runtime.`) : (e2 = Object.prototype.toString.call(n), Error("Objects are not valid as a React child (found: " + (e2 === "[object Object]" ? "object with keys {" + Object.keys(n).join(", ") + "}" : e2) + "). If you meant to render a collection of children, use an array instead."));
      }
      function Ms(e2, n) {
        var o2 = Tc();
        o2 !== null ? o2.run(Kf.bind(null, e2, n)) : Kf(e2, n);
      }
      function Ic(e2, n) {
        var o2 = G(e2) || "Component";
        yy[o2] || (yy[o2] = true, n = n.displayName || n.name || "Component", e2.tag === 3 ? console.error(`Functions are not valid as a React child. This may happen if you return %s instead of <%s /> from render. Or maybe you meant to call this function rather than return it.
  root.render(%s)`, n, n, n) : console.error(`Functions are not valid as a React child. This may happen if you return %s instead of <%s /> from render. Or maybe you meant to call this function rather than return it.
  <%s>{%s}</%s>`, n, n, o2, n, o2));
      }
      function Vs(e2, n) {
        var o2 = Tc();
        o2 !== null ? o2.run(Ic.bind(null, e2, n)) : Ic(e2, n);
      }
      function ep(e2, n) {
        var o2 = G(e2) || "Component";
        vy[o2] || (vy[o2] = true, n = String(n), e2.tag === 3 ? console.error(`Symbols are not valid as a React child.
  root.render(%s)`, n) : console.error(`Symbols are not valid as a React child.
  <%s>%s</%s>`, o2, n, o2));
      }
      function yo(e2, n) {
        var o2 = Tc();
        o2 !== null ? o2.run(ep.bind(null, e2, n)) : ep(e2, n);
      }
      function $s(e2) {
        function n(S, v2) {
          if (e2) {
            var w2 = S.deletions;
            w2 === null ? (S.deletions = [v2], S.flags |= 16) : w2.push(v2);
          }
        }
        function o2(S, v2) {
          if (!e2) return null;
          for (; v2 !== null; ) n(S, v2), v2 = v2.sibling;
          return null;
        }
        function i3(S) {
          for (var v2 = /* @__PURE__ */ new Map(); S !== null; ) S.key === null ? v2.set(S.index, S) : v2.set(S.key, S), S = S.sibling;
          return v2;
        }
        function s(S, v2) {
          return S = Ko(S, v2), S.index = 0, S.sibling = null, S;
        }
        function u2(S, v2, w2) {
          return S.index = w2, e2 ? (w2 = S.alternate, w2 !== null ? (w2 = w2.index, w2 < v2 ? (S.flags |= 2, v2) : w2) : (S.flags |= 134217730, v2)) : (S.flags |= 1048576, v2);
        }
        function f(S) {
          return e2 && S.alternate === null && (S.flags |= 134217730), S;
        }
        function p4(S, v2, w2, I) {
          return v2 === null || v2.tag !== 6 ? (v2 = Nt(w2, S.mode, I), v2.return = S, v2._debugOwner = S, v2._debugTask = S._debugTask, v2._debugInfo = pe, v2) : (v2 = s(v2, w2), v2.return = S, v2._debugInfo = pe, v2);
        }
        function g3(S, v2, w2, I) {
          var O = w2.type;
          return O === Qr ? (v2 = k2(S, v2, w2.props.children, I, w2.key), Wr(v2, w2), wa(w2, v2, S), v2) : v2 !== null && (v2.elementType === O || hg(v2, w2) || typeof O == "object" && O !== null && O.$$typeof === qn && bo(O) === v2.type) ? (v2 = s(v2, w2.props), Wr(v2, w2), v2.return = S, v2._debugOwner = w2._owner, v2._debugInfo = pe, v2) : (v2 = Id(w2, S.mode, I), Wr(v2, w2), v2.return = S, v2._debugInfo = pe, v2);
        }
        function b2(S, v2, w2, I) {
          return v2 === null || v2.tag !== 4 || v2.stateNode.containerInfo !== w2.containerInfo || v2.stateNode.implementation !== w2.implementation ? (v2 = Hl(w2, S.mode, I), v2.return = S, v2._debugInfo = pe, v2) : (v2 = s(v2, w2.children || []), v2.return = S, v2._debugInfo = pe, v2);
        }
        function k2(S, v2, w2, I, O) {
          return v2 === null || v2.tag !== 7 ? (v2 = zi(w2, S.mode, I, O), v2.return = S, v2._debugOwner = S, v2._debugTask = S._debugTask, v2._debugInfo = pe, v2) : (v2 = s(v2, w2), v2.return = S, v2._debugInfo = pe, v2);
        }
        function z(S, v2, w2) {
          if (typeof v2 == "string" && v2 !== "" || typeof v2 == "number" || typeof v2 == "bigint") return v2 = Nt("" + v2, S.mode, w2), v2.return = S, v2._debugOwner = S, v2._debugTask = S._debugTask, v2._debugInfo = pe, v2;
          if (typeof v2 == "object" && v2 !== null) {
            switch (v2.$$typeof) {
              case xo:
                return w2 = Id(v2, S.mode, w2), Wr(w2, v2), w2.return = S, S = bt(v2._debugInfo), w2._debugInfo = pe, pe = S, w2;
              case Ua:
                return v2 = Hl(v2, S.mode, w2), v2.return = S, v2._debugInfo = pe, v2;
              case qn:
                var I = bt(v2._debugInfo);
                return v2 = bo(v2), S = z(S, v2, w2), pe = I, S;
            }
            if (Gn(v2) || ti(v2)) return w2 = zi(v2, S.mode, w2, null), w2.return = S, w2._debugOwner = S, w2._debugTask = S._debugTask, S = bt(v2._debugInfo), w2._debugInfo = pe, pe = S, w2;
            if (typeof v2.then == "function") return I = bt(v2._debugInfo), S = z(S, yl(v2), w2), pe = I, S;
            if (v2.$$typeof === sn) return z(S, si(S, v2), w2);
            Ms(S, v2);
          }
          return typeof v2 == "function" && Vs(S, v2), typeof v2 == "symbol" && yo(S, v2), null;
        }
        function T3(S, v2, w2, I) {
          var O = v2 !== null ? v2.key : null;
          if (typeof w2 == "string" && w2 !== "" || typeof w2 == "number" || typeof w2 == "bigint") return O !== null ? null : p4(S, v2, "" + w2, I);
          if (typeof w2 == "object" && w2 !== null) {
            switch (w2.$$typeof) {
              case xo:
                return w2.key === O ? (O = bt(w2._debugInfo), S = g3(S, v2, w2, I), pe = O, S) : null;
              case Ua:
                return w2.key === O ? b2(S, v2, w2, I) : null;
              case qn:
                return O = bt(w2._debugInfo), w2 = bo(w2), S = T3(S, v2, w2, I), pe = O, S;
            }
            if (Gn(w2) || ti(w2)) return O !== null ? null : (O = bt(w2._debugInfo), S = k2(S, v2, w2, I, null), pe = O, S);
            if (typeof w2.then == "function") return O = bt(w2._debugInfo), S = T3(S, v2, yl(w2), I), pe = O, S;
            if (w2.$$typeof === sn) return T3(S, v2, si(S, w2), I);
            Ms(S, w2);
          }
          return typeof w2 == "function" && Vs(S, w2), typeof w2 == "symbol" && yo(S, w2), null;
        }
        function H(S, v2, w2, I, O) {
          if (typeof I == "string" && I !== "" || typeof I == "number" || typeof I == "bigint") return S = S.get(w2) || null, p4(v2, S, "" + I, O);
          if (typeof I == "object" && I !== null) {
            switch (I.$$typeof) {
              case xo:
                return w2 = S.get(I.key === null ? w2 : I.key) || null, S = bt(I._debugInfo), v2 = g3(v2, w2, I, O), pe = S, v2;
              case Ua:
                return S = S.get(I.key === null ? w2 : I.key) || null, b2(v2, S, I, O);
              case qn:
                var Pe = bt(I._debugInfo);
                return I = bo(I), v2 = H(S, v2, w2, I, O), pe = Pe, v2;
            }
            if (Gn(I) || ti(I)) return w2 = S.get(w2) || null, S = bt(I._debugInfo), v2 = k2(v2, w2, I, O, null), pe = S, v2;
            if (typeof I.then == "function") return Pe = bt(I._debugInfo), v2 = H(S, v2, w2, yl(I), O), pe = Pe, v2;
            if (I.$$typeof === sn) return H(S, v2, w2, si(v2, I), O);
            Ms(v2, I);
          }
          return typeof I == "function" && Vs(v2, I), typeof I == "symbol" && yo(v2, I), null;
        }
        function $(S, v2, w2, I) {
          if (typeof w2 != "object" || w2 === null) return I;
          switch (w2.$$typeof) {
            case xo:
            case Ua:
              ma(S, v2, w2);
              var O = w2.key;
              if (typeof O != "string") break;
              if (I === null) {
                I = /* @__PURE__ */ new Set(), I.add(O);
                break;
              }
              if (!I.has(O)) {
                I.add(O);
                break;
              }
              B(v2, function() {
                console.error("Encountered two children with the same key, `%s`. Keys should be unique so that components maintain their identity across updates. Non-unique keys may cause children to be duplicated and/or omitted \u2014 the behavior is unsupported and could change in a future version.", O);
              });
              break;
            case qn:
              w2 = bo(w2), $(S, v2, w2, I);
          }
          return I;
        }
        function an(S, v2, w2, I) {
          for (var O = null, Pe = null, oe = null, ae = v2, ue = v2 = 0, hn = null; ae !== null && ue < w2.length; ue++) {
            ae.index > ue ? (hn = ae, ae = null) : hn = ae.sibling;
            var He = T3(S, ae, w2[ue], I);
            if (He === null) {
              ae === null && (ae = hn);
              break;
            }
            O = $(S, He, w2[ue], O), e2 && ae && He.alternate === null && n(S, ae), v2 = u2(He, v2, ue), oe === null ? Pe = He : oe.sibling = He, oe = He, ae = hn;
          }
          if (ue === w2.length) return o2(S, ae), le && uo(S, ue), Pe;
          if (ae === null) {
            for (; ue < w2.length; ue++) ae = z(S, w2[ue], I), ae !== null && (O = $(S, ae, w2[ue], O), v2 = u2(ae, v2, ue), oe === null ? Pe = ae : oe.sibling = ae, oe = ae);
            return le && uo(S, ue), Pe;
          }
          for (ae = i3(ae); ue < w2.length; ue++) hn = H(ae, S, ue, w2[ue], I), hn !== null && (O = $(S, hn, w2[ue], O), e2 && (He = hn.alternate, He !== null && ae.delete(He.key === null ? ue : He.key)), v2 = u2(hn, v2, ue), oe === null ? Pe = hn : oe.sibling = hn, oe = hn);
          return e2 && ae.forEach(function(Xi) {
            return n(S, Xi);
          }), le && uo(S, ue), Pe;
        }
        function Hn(S, v2, w2, I) {
          if (w2 == null) throw Error("An iterable object provided no iterator.");
          for (var O = null, Pe = null, oe = v2, ae = v2 = 0, ue = null, hn = null, He = w2.next(); oe !== null && !He.done; ae++, He = w2.next()) {
            oe.index > ae ? (ue = oe, oe = null) : ue = oe.sibling;
            var Xi = T3(S, oe, He.value, I);
            if (Xi === null) {
              oe === null && (oe = ue);
              break;
            }
            hn = $(S, Xi, He.value, hn), e2 && oe && Xi.alternate === null && n(S, oe), v2 = u2(Xi, v2, ae), Pe === null ? O = Xi : Pe.sibling = Xi, Pe = Xi, oe = ue;
          }
          if (He.done) return o2(S, oe), le && uo(S, ae), O;
          if (oe === null) {
            for (; !He.done; ae++, He = w2.next()) oe = z(S, He.value, I), oe !== null && (hn = $(S, oe, He.value, hn), v2 = u2(oe, v2, ae), Pe === null ? O = oe : Pe.sibling = oe, Pe = oe);
            return le && uo(S, ae), O;
          }
          for (oe = i3(oe); !He.done; ae++, He = w2.next()) ue = H(oe, S, ae, He.value, I), ue !== null && (hn = $(S, ue, He.value, hn), e2 && (He = ue.alternate, He !== null && oe.delete(He.key === null ? ae : He.key)), v2 = u2(ue, v2, ae), Pe === null ? O = ue : Pe.sibling = ue, Pe = ue);
          return e2 && oe.forEach(function(V1) {
            return n(S, V1);
          }), le && uo(S, ae), O;
        }
        function ha(S, v2, w2, I) {
          if (typeof w2 == "object" && w2 !== null && w2.type === Qr && w2.key === null && w2.props.ref === void 0 && (wa(w2, null, S), w2 = w2.props.children), typeof w2 == "object" && w2 !== null) {
            switch (w2.$$typeof) {
              case xo:
                var O = bt(w2._debugInfo);
                e: {
                  for (var Pe = w2.key; v2 !== null; ) {
                    if (v2.key === Pe) {
                      if (Pe = w2.type, Pe === Qr) {
                        if (v2.tag === 7) {
                          o2(S, v2.sibling), I = s(v2, w2.props.children), Wr(I, w2), I.return = S, I._debugOwner = w2._owner, I._debugInfo = pe, wa(w2, I, S), S = I;
                          break e;
                        }
                      } else if (v2.elementType === Pe || hg(v2, w2) || typeof Pe == "object" && Pe !== null && Pe.$$typeof === qn && bo(Pe) === v2.type) {
                        o2(S, v2.sibling), I = s(v2, w2.props), Wr(I, w2), I.return = S, I._debugOwner = w2._owner, I._debugInfo = pe, S = I;
                        break e;
                      }
                      o2(S, v2);
                      break;
                    } else n(S, v2);
                    v2 = v2.sibling;
                  }
                  w2.type === Qr ? (I = zi(w2.props.children, S.mode, I, w2.key), Wr(I, w2), I.return = S, I._debugOwner = S, I._debugTask = S._debugTask, I._debugInfo = pe, wa(w2, I, S), S = I) : (I = Id(w2, S.mode, I), Wr(I, w2), I.return = S, I._debugInfo = pe, S = I);
                }
                return S = f(S), pe = O, S;
              case Ua:
                e: {
                  for (O = w2, w2 = O.key; v2 !== null; ) {
                    if (v2.key === w2) {
                      if (v2.tag === 4 && v2.stateNode.containerInfo === O.containerInfo && v2.stateNode.implementation === O.implementation) {
                        o2(S, v2.sibling), I = s(v2, O.children || []), I.return = S, S = I;
                        break e;
                      } else {
                        o2(S, v2);
                        break;
                      }
                    } else n(S, v2);
                    v2 = v2.sibling;
                  }
                  I = Hl(O, S.mode, I), I.return = S, S = I;
                }
                return f(S);
              case qn:
                return O = bt(w2._debugInfo), w2 = bo(w2), S = ha(S, v2, w2, I), pe = O, S;
            }
            if (Gn(w2)) return an(S, v2, w2, I);
            if (ti(w2)) {
              if (O = w2, w2 = ti(O), typeof w2 != "function") throw Error("An object is not an iterable. This error is likely caused by a bug in React. Please file an issue.");
              return Pe = w2.call(O), Pe === O ? (S.tag !== 0 || Object.prototype.toString.call(S.type) !== "[object GeneratorFunction]" || Object.prototype.toString.call(Pe) !== "[object Generator]") && (gy || console.error("Using Iterators as children is unsupported and will likely yield unexpected results because enumerating a generator mutates it. You may convert it to an array with `Array.from()` or the `[...spread]` operator before rendering. You can also use an Iterable that can iterate multiple times over the same items."), gy = true) : O.entries !== w2 || fb || (console.error("Using Maps as children is not supported. Use an array of keyed ReactElements instead."), fb = true), Hn(S, v2, Pe, I);
            }
            if (typeof w2.then == "function") return O = bt(w2._debugInfo), S = ha(S, v2, yl(w2), I), pe = O, S;
            if (w2.$$typeof === sn) return ha(S, v2, si(S, w2), I);
            Ms(S, w2);
          }
          return typeof w2 == "string" && w2 !== "" || typeof w2 == "number" || typeof w2 == "bigint" ? (O = "" + w2, v2 !== null && v2.tag === 6 ? (o2(S, v2.sibling), I = s(v2, O), I.return = S, S = I) : (o2(S, v2), I = Nt(O, S.mode, I), I.return = S, I._debugOwner = S, I._debugTask = S._debugTask, I._debugInfo = pe, S = I), f(S)) : (typeof w2 == "function" && Vs(S, w2), typeof w2 == "symbol" && yo(S, w2), o2(S, v2));
        }
        return function(S, v2, w2, I) {
          var O = pe;
          pe = null;
          try {
            Bh = 0;
            var Pe = ha(S, v2, w2, I);
            return df = null, Pe;
          } catch (hn) {
            if (hn === cf || hn === Vg) throw hn;
            var oe = ht(29, hn, null, S.mode);
            oe.lanes = I, oe.return = S;
            var ae = oe._debugInfo = pe;
            if (oe._debugOwner = S._debugOwner, oe._debugTask = S._debugTask, ae != null) {
              for (var ue = ae.length - 1; 0 <= ue; ue--) if (typeof ae[ue].stack == "string") {
                oe._debugOwner = ae[ue], oe._debugTask = ae[ue].debugTask;
                break;
              }
            }
            return oe;
          } finally {
            pe = O;
          }
        };
      }
      function np(e2, n) {
        var o2 = Gn(e2);
        return e2 = !o2 && typeof ti(e2) == "function", o2 || e2 ? (o2 = o2 ? "array" : "iterable", console.error("A nested %s was passed to row #%s in <SuspenseList />. Wrap it in an additional SuspenseList to configure its revealOrder: <SuspenseList revealOrder=...> ... <SuspenseList revealOrder=...>{%s}</SuspenseList> ... </SuspenseList>", o2, n, o2), false) : true;
      }
      function vl() {
        for (var e2 = ff, n = pb = ff = 0; n < e2; ) {
          var o2 = Io[n];
          Io[n++] = null;
          var i3 = Io[n];
          Io[n++] = null;
          var s = Io[n];
          Io[n++] = null;
          var u2 = Io[n];
          if (Io[n++] = null, i3 !== null && s !== null) {
            var f = i3.pending;
            f === null ? s.next = s : (s.next = f.next, f.next = s), i3.pending = s;
          }
          u2 !== 0 && wn(o2, s, u2);
        }
      }
      function Qs(e2, n, o2, i3) {
        Io[ff++] = e2, Io[ff++] = n, Io[ff++] = o2, Io[ff++] = i3, pb |= i3, e2.lanes |= i3, e2 = e2.alternate, e2 !== null && (e2.lanes |= i3);
      }
      function Rc(e2, n, o2, i3) {
        return Qs(e2, n, o2, i3), qs(e2);
      }
      function tt(e2, n) {
        return Qs(e2, null, null, n), qs(e2);
      }
      function wn(e2, n, o2) {
        e2.lanes |= o2;
        var i3 = e2.alternate;
        i3 !== null && (i3.lanes |= o2);
        for (var s = false, u2 = e2.return; u2 !== null; ) u2.childLanes |= o2, i3 = u2.alternate, i3 !== null && (i3.childLanes |= o2), u2.tag === 22 && (e2 = u2.stateNode, e2 === null || e2._visibility & Hh || (s = true)), e2 = u2, u2 = u2.return;
        return e2.tag === 3 ? (u2 = e2.stateNode, s && n !== null && (s = 31 - d(o2), e2 = u2.hiddenUpdates, i3 = e2[s], i3 === null ? e2[s] = [n] : i3.push(n), n.lane = o2 | 536870912), u2) : null;
      }
      function qs(e2) {
        if (rm > B1) throw fc = rm = 0, om = b0 = null, Error("Maximum update depth exceeded. This can happen when a component repeatedly calls setState inside componentWillUpdate or componentDidUpdate. React limits the number of nested updates to prevent infinite loops.");
        fc > H1 && (fc = 0, om = null, console.error("Maximum update depth exceeded. This can happen when a component calls setState inside useEffect, but useEffect either doesn't have a dependency array, or one of the dependencies changes on every render.")), e2.alternate === null && (e2.flags & 4098) !== 0 && pg(e2);
        for (var n = e2, o2 = n.return; o2 !== null; ) n.alternate === null && (n.flags & 4098) !== 0 && pg(e2), n = o2, o2 = n.return;
        return n.tag === 3 ? n.stateNode : null;
      }
      function Lc(e2) {
        e2.updateQueue = {
          baseState: e2.memoizedState,
          firstBaseUpdate: null,
          lastBaseUpdate: null,
          shared: {
            pending: null,
            lanes: 0,
            hiddenCallbacks: null
          },
          callbacks: null
        };
      }
      function Fc(e2, n) {
        e2 = e2.updateQueue, n.updateQueue === e2 && (n.updateQueue = {
          baseState: e2.baseState,
          firstBaseUpdate: e2.firstBaseUpdate,
          lastBaseUpdate: e2.lastBaseUpdate,
          shared: e2.shared,
          callbacks: null
        });
      }
      function Vo(e2) {
        return {
          lane: e2,
          tag: ky,
          payload: null,
          callback: null,
          next: null
        };
      }
      function rr(e2, n, o2) {
        var i3 = e2.updateQueue;
        if (i3 === null) return null;
        if (i3 = i3.shared, mb === i3 && !xy) {
          var s = G(e2);
          console.error(`An update (setState, replaceState, or forceUpdate) was scheduled from inside an update function. Update functions should be pure, with zero side-effects. Consider using componentDidUpdate or a callback.

Please update the following component: %s`, s), xy = true;
        }
        return (ve & pt) !== ft ? (s = i3.pending, s === null ? n.next = n : (n.next = s.next, s.next = n), i3.pending = n, n = qs(e2), wn(e2, null, o2), n) : (Qs(e2, i3, n, o2), qs(e2));
      }
      function Sl(e2, n, o2) {
        if (n = n.updateQueue, n !== null && (n = n.shared, (o2 & 4194048) !== 0)) {
          var i3 = n.lanes;
          i3 &= e2.pendingLanes, o2 |= i3, n.lanes = o2, If(e2, o2);
        }
      }
      function ui(e2, n) {
        var o2 = e2.updateQueue, i3 = e2.alternate;
        if (i3 !== null && (i3 = i3.updateQueue, o2 === i3)) {
          var s = null, u2 = null;
          if (o2 = o2.firstBaseUpdate, o2 !== null) {
            do {
              var f = {
                lane: o2.lane,
                tag: o2.tag,
                payload: o2.payload,
                callback: null,
                next: null
              };
              u2 === null ? s = u2 = f : u2 = u2.next = f, o2 = o2.next;
            } while (o2 !== null);
            u2 === null ? s = u2 = n : u2 = u2.next = n;
          } else s = u2 = n;
          o2 = {
            baseState: i3.baseState,
            firstBaseUpdate: s,
            lastBaseUpdate: u2,
            shared: i3.shared,
            callbacks: i3.callbacks
          }, e2.updateQueue = o2;
          return;
        }
        e2 = o2.lastBaseUpdate, e2 === null ? o2.firstBaseUpdate = n : e2.next = n, o2.lastBaseUpdate = n;
      }
      function kl() {
        if (gb) {
          var e2 = uf;
          if (e2 !== null) throw e2;
        }
      }
      function Gs(e2, n, o2, i3) {
        gb = false;
        var s = e2.updateQueue;
        hs = false, mb = s.shared;
        var u2 = s.firstBaseUpdate, f = s.lastBaseUpdate, p4 = s.shared.pending;
        if (p4 !== null) {
          s.shared.pending = null;
          var g3 = p4, b2 = g3.next;
          g3.next = null, f === null ? u2 = b2 : f.next = b2, f = g3;
          var k2 = e2.alternate;
          k2 !== null && (k2 = k2.updateQueue, p4 = k2.lastBaseUpdate, p4 !== f && (p4 === null ? k2.firstBaseUpdate = b2 : p4.next = b2, k2.lastBaseUpdate = g3));
        }
        if (u2 !== null) {
          var z = s.baseState;
          f = 0, k2 = b2 = g3 = null, p4 = u2;
          do {
            var T3 = p4.lane & -536870913, H = T3 !== p4.lane;
            if (H ? (te & T3) === T3 : (i3 & T3) === T3) {
              T3 !== 0 && T3 === ps && (gb = true), k2 !== null && (k2 = k2.next = {
                lane: 0,
                tag: p4.tag,
                payload: p4.payload,
                callback: null,
                next: null
              });
              e: {
                T3 = e2;
                var $ = p4, an = n, Hn = o2;
                switch ($.tag) {
                  case wy:
                    if ($ = $.payload, typeof $ == "function") {
                      of = true;
                      var ha = $.call(Hn, z, an);
                      if (T3.mode & 8) {
                        Oe(true);
                        try {
                          $.call(Hn, z, an);
                        } finally {
                          Oe(false);
                        }
                      }
                      of = false, z = ha;
                      break e;
                    }
                    z = $;
                    break e;
                  case hb:
                    T3.flags = T3.flags & -65537 | 128;
                  case ky:
                    if (ha = $.payload, typeof ha == "function") {
                      if (of = true, $ = ha.call(Hn, z, an), T3.mode & 8) {
                        Oe(true);
                        try {
                          ha.call(Hn, z, an);
                        } finally {
                          Oe(false);
                        }
                      }
                      of = false;
                    } else $ = ha;
                    if ($ == null) break e;
                    z = Un({}, z, $);
                    break e;
                  case Py:
                    hs = true;
                }
              }
              T3 = p4.callback, T3 !== null && (e2.flags |= 64, H && (e2.flags |= 8192), H = s.callbacks, H === null ? s.callbacks = [T3] : H.push(T3));
            } else H = {
              lane: T3,
              tag: p4.tag,
              payload: p4.payload,
              callback: p4.callback,
              next: null
            }, k2 === null ? (b2 = k2 = H, g3 = z) : k2 = k2.next = H, f |= T3;
            if (p4 = p4.next, p4 === null) {
              if (p4 = s.shared.pending, p4 === null) break;
              H = p4, p4 = H.next, H.next = null, s.lastBaseUpdate = H, s.shared.pending = null;
            }
          } while (true);
          k2 === null && (g3 = z), s.baseState = g3, s.firstBaseUpdate = b2, s.lastBaseUpdate = k2, u2 === null && (s.shared.lanes = 0), bs |= f, e2.lanes = f, e2.memoizedState = z;
        }
        mb = null;
      }
      function ci(e2, n) {
        if (typeof e2 != "function") throw Error("Invalid argument passed as callback. Expected a function. Instead received: " + e2);
        e2.call(n);
      }
      function tp(e2, n) {
        var o2 = e2.shared.hiddenCallbacks;
        if (o2 !== null) for (e2.shared.hiddenCallbacks = null, e2 = 0; e2 < o2.length; e2++) ci(o2[e2], n);
      }
      function rp(e2, n) {
        var o2 = e2.callbacks;
        if (o2 !== null) for (e2.callbacks = null, e2 = 0; e2 < o2.length; e2++) ci(o2[e2], n);
      }
      function op(e2, n) {
        var o2 = ei;
        ze(qg, o2, e2), ze(ms, n, e2), ei = o2 | n.baseLanes;
      }
      function Dc(e2) {
        ze(qg, ei, e2), ze(ms, ms.current, e2);
      }
      function Js(e2) {
        ei = qg.current, mn(ms, e2), mn(qg, e2);
      }
      function vo(e2) {
        var n = e2.alternate;
        ze(kt, kt.current & pf, e2), ze(St, e2, e2), Zt === null && (n === null || ms.current !== null || n.memoizedState !== null) && (Zt = e2);
      }
      function jc(e2) {
        ze(kt, kt.current, e2), ze(St, e2, e2), Zt === null && (Zt = e2);
      }
      function Uc(e2) {
        e2.tag === 22 ? (ze(kt, kt.current, e2), ze(St, e2, e2), Zt === null && (Zt = e2)) : Ar(e2);
      }
      function Ar(e2) {
        ze(kt, kt.current, e2), ze(St, St.current, e2);
      }
      function rt(e2) {
        mn(St, e2), Zt === e2 && (Zt = null), mn(kt, e2);
      }
      function Zs(e2, n) {
        ze(St, St.current, e2), ze(kt, n, e2);
      }
      function Wc(e2) {
        mn(kt, e2), mn(St, e2), Zt === e2 && (Zt = null);
      }
      function Xs(e2) {
        for (var n = e2; n !== null; ) {
          if (n.tag === 13) {
            var o2 = n.memoizedState;
            if (o2 !== null && (o2 = o2.dehydrated, o2 === null || xn(o2) || Ce(o2))) return n;
          } else if (n.tag === 19 && n.memoizedProps.revealOrder !== "independent") {
            if ((n.flags & 128) !== 0) return n;
          } else if (n.child !== null) {
            n.child.return = n, n = n.child;
            continue;
          }
          if (n === e2) break;
          for (; n.sibling === null; ) {
            if (n.return === null || n.return === e2) return null;
            n = n.return;
          }
          n.sibling.return = n.return, n = n.sibling;
        }
        return null;
      }
      function ee() {
        var e2 = _;
        Lo === null ? Lo = [e2] : Lo.push(e2);
      }
      function L() {
        var e2 = _;
        if (Lo !== null && (qi++, Lo[qi] !== e2)) {
          var n = G(X2);
          if (!Cy.has(n) && (Cy.add(n), Lo !== null)) {
            for (var o2 = "", i3 = 0; i3 <= qi; i3++) {
              var s = Lo[i3], u2 = i3 === qi ? e2 : s;
              for (s = i3 + 1 + ". " + s; 30 > s.length; ) s += " ";
              s += u2 + `
`, o2 += s;
            }
            console.error(`React has detected a change in the order of Hooks called by %s. This will lead to bugs and errors if not fixed. For more information, read the Rules of Hooks: https://react.dev/link/rules-of-hooks

   Previous render            Next render
   ------------------------------------------------------
%s   ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
`, n, o2);
          }
        }
      }
      function Pa(e2) {
        e2 == null || Gn(e2) || console.error("%s received a final argument that is not an array (instead, received `%s`). When specified, the final argument must be an array.", _, typeof e2);
      }
      function Ys() {
        var e2 = G(X2);
        Ey.has(e2) || (Ey.add(e2), console.error("ReactDOM.useFormState has been renamed to React.useActionState. Please update %s to use React.useActionState.", e2));
      }
      function Ee() {
        throw Error(`Invalid hook call. Hooks can only be called inside of the body of a function component. This could happen for one of the following reasons:
1. You might have mismatching versions of React and the renderer (such as React DOM)
2. You might be breaking the Rules of Hooks
3. You might have more than one copy of React in the same app
See https://react.dev/link/invalid-hook-call for tips about how to debug and fix this problem.`);
      }
      function Ks(e2, n) {
        if (Qh) return false;
        if (n === null) return console.error("%s received a final argument during this render, but not during the previous render. Even though the final argument is optional, its type cannot change between renders.", _), false;
        e2.length !== n.length && console.error(`The final argument passed to %s changed size between renders. The order and size of this array must remain constant.

Previous: %s
Incoming: %s`, _, "[" + n.join(", ") + "]", "[" + e2.join(", ") + "]");
        for (var o2 = 0; o2 < n.length && o2 < e2.length; o2++) if (!Gt(e2[o2], n[o2])) return false;
        return true;
      }
      function ap(e2, n, o2, i3, s, u2) {
        Qi = u2, X2 = n, Lo = e2 !== null ? e2._debugHookTypes : null, qi = -1, Qh = e2 !== null && e2.type !== n.type, (Object.prototype.toString.call(o2) === "[object AsyncFunction]" || Object.prototype.toString.call(o2) === "[object AsyncGeneratorFunction]") && (u2 = G(X2), bb.has(u2) || (bb.add(u2), console.error("%s is an async Client Component. Only Server Components can be async at the moment. This error is often caused by accidentally adding `'use client'` to a module that was originally written for the server.", u2 === null ? "An unknown Component" : "<" + u2 + ">"))), n.memoizedState = null, n.updateQueue = null, n.lanes = 0, N2.H = e2 !== null && e2.memoizedState !== null ? vb : Lo !== null ? _y : yb, oc = u2 = (n.mode & 8) !== Z;
        var f = sb(o2, i3, s);
        if (oc = false, mf && (f = Ht(n, o2, i3, s)), u2) {
          Oe(true);
          try {
            f = Ht(n, o2, i3, s);
          } finally {
            Oe(false);
          }
        }
        return ip(e2, n), f;
      }
      function ip(e2, n) {
        n._debugHookTypes = Lo, n.dependencies === null ? Ja !== null && (n.dependencies = {
          lanes: 0,
          firstContext: null,
          _debugThenableState: Ja
        }) : n.dependencies._debugThenableState = Ja;
        var o2 = Ja;
        if (nc !== null && gm(nc, n) && (o2 !== null || Qg === null || db || (db = true, console.error(Qg)), Qg = nc = null), N2.H = Zg, o2 = qe !== null && qe.next !== null, Qi = 0, Lo = _ = On = qe = X2 = null, qi = -1, e2 !== null && (e2.flags & 1206910976) !== (n.flags & 1206910976) && console.error("Internal React error: Expected static flag was missing. Please notify the React team."), Gg = false, $h = 0, Ja = null, o2) throw Error("Rendered fewer hooks than expected. This may be caused by an accidental early return statement.");
        e2 === null || In || (e2 = e2.dependencies, e2 !== null && dl(e2) && (In = true)), Oh ? (Oh = false, e2 = true) : e2 = false, e2 && (n = G(n) || "Unknown", zy.has(n) || bb.has(n) || (zy.add(n), console.error("`use` was called from inside a try/catch block. This is not allowed and can lead to unexpected behavior. To handle errors triggered by `use`, wrap your component in a error boundary.")));
      }
      function Ht(e2, n, o2, i3) {
        X2 = e2;
        var s = 0;
        do {
          if (mf && (Ja = null), $h = 0, mf = false, s >= W1) throw Error("Too many re-renders. React limits the number of renders to prevent an infinite loop.");
          if (s += 1, Qh = false, On = qe = null, e2.updateQueue != null) {
            var u2 = e2.updateQueue;
            u2.lastEffect = null, u2.events = null, u2.stores = null, u2.memoCache != null && (u2.memoCache.index = 0);
          }
          qi = -1, N2.H = Ny, u2 = sb(n, o2, i3);
        } while (mf);
        return u2;
      }
      function Ac() {
        var e2 = N2.H, n = e2.useState()[0];
        return n = typeof n.then == "function" ? Pl(n) : n, e2 = e2.useState()[0], (qe !== null ? qe.memoizedState : null) !== e2 && (X2.flags |= 1024), n;
      }
      function Oc() {
        var e2 = Jg !== 0;
        return Jg = 0, e2;
      }
      function eu(e2, n, o2) {
        n.updateQueue = e2.updateQueue, n.flags = (n.mode & 16) !== Z ? n.flags & -805308421 : n.flags & -2053, e2.lanes &= ~o2;
      }
      function Bc(e2) {
        if (Gg) {
          for (e2 = e2.memoizedState; e2 !== null; ) {
            var n = e2.queue;
            n !== null && (n.pending = null), e2 = e2.next;
          }
          Gg = false;
        }
        Qi = 0, Lo = On = qe = X2 = null, qi = -1, _ = null, mf = false, $h = Jg = 0, Ja = null;
      }
      function ot() {
        var e2 = {
          memoizedState: null,
          baseState: null,
          baseQueue: null,
          queue: null,
          next: null
        };
        return On === null ? X2.memoizedState = On = e2 : On = On.next = e2, On;
      }
      function xe() {
        if (qe === null) {
          var e2 = X2.alternate;
          e2 = e2 !== null ? e2.memoizedState : null;
        } else e2 = qe.next;
        var n = On === null ? X2.memoizedState : On.next;
        if (n !== null) On = n, qe = e2;
        else {
          if (e2 === null) throw X2.alternate === null ? Error("Update hook called on initial render. This is likely a bug in React. Please file an issue.") : Error("Rendered more hooks than during the previous render.");
          qe = e2, e2 = {
            memoizedState: qe.memoizedState,
            baseState: qe.baseState,
            baseQueue: qe.baseQueue,
            queue: qe.queue,
            next: null
          }, On === null ? X2.memoizedState = On = e2 : On = On.next = e2;
        }
        return On;
      }
      function wl() {
        return {
          lastEffect: null,
          events: null,
          stores: null,
          memoCache: null
        };
      }
      function Pl(e2) {
        var n = $h;
        return $h += 1, Ja === null && (Ja = Gf()), e2 = Zf(Ja, e2, n, X2), n = X2, (On === null ? n.memoizedState : On.next) === null && (n = n.alternate, N2.H = n !== null && n.memoizedState !== null ? vb : yb), e2;
      }
      function Or(e2) {
        if (e2 !== null && typeof e2 == "object") {
          if (typeof e2.then == "function") return Pl(e2);
          if (e2.$$typeof === Tt) return;
          if (e2.$$typeof === sn) return K(e2);
        }
        throw Error("An unsupported type was passed to use(): " + String(e2));
      }
      function Br(e2) {
        var n = null, o2 = X2.updateQueue;
        if (o2 !== null && (n = o2.memoCache), n == null) {
          var i3 = X2.alternate;
          i3 !== null && (i3 = i3.updateQueue, i3 !== null && (i3 = i3.memoCache, i3 != null && (n = {
            data: i3.data.map(function(s) {
              return s.slice();
            }),
            index: 0
          })));
        }
        if (n == null && (n = {
          data: [],
          index: 0
        }), o2 === null && (o2 = wl(), X2.updateQueue = o2), o2.memoCache = n, o2 = n.data[n.index], o2 === void 0 || Qh) for (o2 = n.data[n.index] = Array(e2), i3 = 0; i3 < e2; i3++) o2[i3] = j0;
        else o2.length !== e2 && console.error("Expected a constant size argument for each invocation of useMemoCache. The previous cache was allocated with size %s but size %s was requested.", o2.length, e2);
        return n.index++, o2;
      }
      function ge(e2, n) {
        return typeof n == "function" ? n(e2) : n;
      }
      function lp(e2, n, o2) {
        var i3 = ot();
        if (o2 !== void 0) {
          var s = o2(n);
          if (oc) {
            Oe(true);
            try {
              o2(n);
            } finally {
              Oe(false);
            }
          }
        } else s = n;
        return i3.memoizedState = i3.baseState = s, e2 = {
          pending: null,
          lanes: 0,
          dispatch: null,
          lastRenderedReducer: e2,
          lastRenderedState: s
        }, i3.queue = e2, e2 = e2.dispatch = Mr.bind(null, X2, e2), [i3.memoizedState, e2];
      }
      function xl(e2) {
        var n = xe();
        return Hc(n, qe, e2);
      }
      function Hc(e2, n, o2) {
        var i3 = e2.queue;
        if (i3 === null) throw Error("Should have a queue. You are likely calling Hooks conditionally, which is not allowed. (https://react.dev/link/invalid-hook-call)");
        i3.lastRenderedReducer = o2;
        var s = e2.baseQueue, u2 = i3.pending;
        if (u2 !== null) {
          if (s !== null) {
            var f = s.next;
            s.next = u2.next, u2.next = f;
          }
          n.baseQueue !== s && console.error("Internal error: Expected work-in-progress queue to be a clone. This is a bug in React."), n.baseQueue = s = u2, i3.pending = null;
        }
        if (u2 = e2.baseState, s === null) e2.memoizedState = u2;
        else {
          n = s.next;
          var p4 = f = null, g3 = null, b2 = n, k2 = false;
          do {
            var z = b2.lane & -536870913;
            if (z !== b2.lane ? (te & z) === z : (Qi & z) === z) {
              var T3 = b2.revertLane;
              if (T3 === 0) g3 !== null && (g3 = g3.next = {
                lane: 0,
                revertLane: 0,
                gesture: null,
                action: b2.action,
                hasEagerState: b2.hasEagerState,
                eagerState: b2.eagerState,
                next: null
              }), z === ps && (k2 = true);
              else if ((Qi & T3) === T3) {
                b2 = b2.next, T3 === ps && (k2 = true);
                continue;
              } else z = {
                lane: 0,
                revertLane: b2.revertLane,
                gesture: null,
                action: b2.action,
                hasEagerState: b2.hasEagerState,
                eagerState: b2.eagerState,
                next: null
              }, g3 === null ? (p4 = g3 = z, f = u2) : g3 = g3.next = z, X2.lanes |= T3, bs |= T3;
              z = b2.action, oc && o2(u2, z), u2 = b2.hasEagerState ? b2.eagerState : o2(u2, z);
            } else T3 = {
              lane: z,
              revertLane: b2.revertLane,
              gesture: b2.gesture,
              action: b2.action,
              hasEagerState: b2.hasEagerState,
              eagerState: b2.eagerState,
              next: null
            }, g3 === null ? (p4 = g3 = T3, f = u2) : g3 = g3.next = T3, X2.lanes |= z, bs |= z;
            b2 = b2.next;
          } while (b2 !== null && b2 !== n);
          if (g3 === null ? f = u2 : g3.next = p4, !Gt(u2, e2.memoizedState) && (In = true, k2 && (o2 = uf, o2 !== null))) throw o2;
          e2.memoizedState = u2, e2.baseState = f, e2.baseQueue = g3, i3.lastRenderedState = u2;
        }
        return s === null && (i3.lanes = 0), [e2.memoizedState, i3.dispatch];
      }
      function $o(e2) {
        var n = xe(), o2 = n.queue;
        if (o2 === null) throw Error("Should have a queue. You are likely calling Hooks conditionally, which is not allowed. (https://react.dev/link/invalid-hook-call)");
        o2.lastRenderedReducer = e2;
        var i3 = o2.dispatch, s = o2.pending, u2 = n.memoizedState;
        if (s !== null) {
          o2.pending = null;
          var f = s = s.next;
          do
            u2 = e2(u2, f.action), f = f.next;
          while (f !== s);
          Gt(u2, n.memoizedState) || (In = true), n.memoizedState = u2, n.baseQueue === null && (n.baseState = u2), o2.lastRenderedState = u2;
        }
        return [u2, i3];
      }
      function So(e2, n, o2) {
        var i3 = X2, s = ot();
        if (le) {
          if (o2 === void 0) throw Error("Missing getServerSnapshot, which is required for server-rendered content. Will revert to client rendering.");
          var u2 = o2();
          hf || u2 === o2() || (console.error("The result of getServerSnapshot should be cached to avoid an infinite loop"), hf = true);
        } else {
          if (u2 = n(), hf || (o2 = n(), Gt(u2, o2) || (console.error("The result of getSnapshot should be cached to avoid an infinite loop"), hf = true)), Ge === null) throw Error("Expected a work-in-progress root. This is a bug in React. Please file an issue.");
          (te & 127) !== 0 || sp(i3, n, u2);
        }
        return s.memoizedState = u2, o2 = {
          value: u2,
          getSnapshot: n
        }, s.queue = o2, lu(Fn.bind(null, i3, o2, e2), [e2]), i3.flags |= 2048, Qo(Ro | Dt, {
          destroy: void 0
        }, Hr.bind(null, i3, o2, u2, n), null), u2;
      }
      function nu(e2, n, o2) {
        var i3 = X2, s = xe(), u2 = le;
        if (u2) {
          if (o2 === void 0) throw Error("Missing getServerSnapshot, which is required for server-rendered content. Will revert to client rendering.");
          o2 = o2();
        } else if (o2 = n(), !hf) {
          var f = n();
          Gt(o2, f) || (console.error("The result of getSnapshot should be cached to avoid an infinite loop"), hf = true);
        }
        (f = !Gt((qe || s).memoizedState, o2)) && (s.memoizedState = o2, In = true), s = s.queue;
        var p4 = Fn.bind(null, i3, s, e2);
        if (at(2048, Dt, p4, [e2]), e2 = s.getSnapshot !== n || f || On !== null && (On.memoizedState.tag & Ro) !== Vh, Qo(e2 ? Ro | Dt : Dt, {
          destroy: void 0
        }, Hr.bind(null, i3, s, o2, n), null), e2) {
          if (i3.flags |= 2048, Ge === null) throw Error("Expected a work-in-progress root. This is a bug in React. Please file an issue.");
          u2 || (Qi & 127) !== 0 || sp(i3, n, o2);
        }
        return o2;
      }
      function sp(e2, n, o2) {
        e2.flags |= 16384, e2 = {
          getSnapshot: n,
          value: o2
        }, n = X2.updateQueue, n === null ? (n = wl(), X2.updateQueue = n, n.stores = [e2]) : (o2 = n.stores, o2 === null ? n.stores = [e2] : o2.push(e2));
      }
      function Hr(e2, n, o2, i3) {
        n.value = o2, n.getSnapshot = i3, up(n) && Cl(e2);
      }
      function Fn(e2, n, o2) {
        return o2(function() {
          up(n) && (tr(2, "updateSyncExternalStore()", e2), Cl(e2));
        });
      }
      function up(e2) {
        var n = e2.getSnapshot;
        e2 = e2.value;
        try {
          var o2 = n();
          return !Gt(e2, o2);
        } catch {
          return true;
        }
      }
      function Cl(e2) {
        var n = tt(e2, 2);
        n !== null && nn(n, e2, 2);
      }
      function Mc(e2) {
        var n = ot();
        if (typeof e2 == "function") {
          var o2 = e2;
          if (e2 = o2(), oc) {
            Oe(true);
            try {
              o2();
            } finally {
              Oe(false);
            }
          }
        }
        return n.memoizedState = n.baseState = e2, n.queue = {
          pending: null,
          lanes: 0,
          dispatch: null,
          lastRenderedReducer: ge,
          lastRenderedState: e2
        }, n;
      }
      function di(e2) {
        e2 = Mc(e2);
        var n = e2.queue, o2 = rd.bind(null, X2, n);
        return n.dispatch = o2, [e2.memoizedState, o2];
      }
      function tu(e2) {
        var n = ot();
        n.memoizedState = n.baseState = e2;
        var o2 = {
          pending: null,
          lanes: 0,
          dispatch: null,
          lastRenderedReducer: null,
          lastRenderedState: null
        };
        return n.queue = o2, n = Ct.bind(null, X2, true, o2), o2.dispatch = n, [e2, n];
      }
      function Vc(e2, n) {
        var o2 = xe();
        return $c(o2, qe, e2, n);
      }
      function $c(e2, n, o2, i3) {
        return e2.baseState = o2, Hc(e2, qe, typeof i3 == "function" ? i3 : ge);
      }
      function Qc(e2, n) {
        var o2 = xe();
        return qe !== null ? $c(o2, qe, e2, n) : (o2.baseState = e2, [e2, o2.queue.dispatch]);
      }
      function bm(e2, n, o2, i3, s) {
        if (du(e2)) throw Error("Cannot update action state while rendering.");
        if (e2 = n.action, e2 !== null) {
          var u2 = {
            payload: s,
            action: e2,
            next: null,
            isTransition: true,
            status: "pending",
            value: null,
            reason: null,
            listeners: [],
            then: function(f) {
              u2.listeners.push(f);
            }
          };
          N2.T !== null ? o2(true) : u2.isTransition = false, i3(u2), o2 = n.pending, o2 === null ? (u2.next = n.pending = u2, qc(n, u2)) : (u2.next = o2.next, n.pending = o2.next = u2);
        }
      }
      function qc(e2, n) {
        var o2 = n.action, i3 = n.payload, s = e2.state;
        if (n.isTransition) {
          var u2 = N2.T, f = {};
          f.types = u2 !== null ? u2.types : null, f._updatedFibers = /* @__PURE__ */ new Set(), N2.T = f;
          try {
            var p4 = o2(s, i3), g3 = N2.S;
            g3 !== null && g3(f, p4), Gc(e2, n, p4);
          } catch (b2) {
            ou(e2, n, b2);
          } finally {
            u2 !== null && f.types !== null && (u2.types !== null && u2.types !== f.types && console.error("We expected inner Transitions to have transferred the outer types set and that you cannot add to the outer Transition while inside the inner.This is a bug in React."), u2.types = f.types), N2.T = u2, u2 === null && f._updatedFibers && (e2 = f._updatedFibers.size, f._updatedFibers.clear(), 10 < e2 && console.warn("Detected a large number of updates inside startTransition. If this is due to a subscription please re-write it to use React provided hooks. Otherwise concurrent mode guarantees are off the table."));
          }
        } else try {
          f = o2(s, i3), Gc(e2, n, f);
        } catch (b2) {
          ou(e2, n, b2);
        }
      }
      function Gc(e2, n, o2) {
        o2 !== null && typeof o2 == "object" && typeof o2.then == "function" ? (N2.asyncTransitions++, o2.then(ed, ed), o2.then(function(i3) {
          ru(e2, n, i3);
        }, function(i3) {
          return ou(e2, n, i3);
        }), n.isTransition || console.error("An async function with useActionState was called outside of a transition. This is likely not what you intended (for example, isPending will not update correctly). Either call the returned function inside startTransition, or pass it to an `action` or `formAction` prop.")) : ru(e2, n, o2);
      }
      function ru(e2, n, o2) {
        n.status = "fulfilled", n.value = o2, cp(n), e2.state = o2, n = e2.pending, n !== null && (o2 = n.next, o2 === n ? e2.pending = null : (o2 = o2.next, n.next = o2, qc(e2, o2)));
      }
      function ou(e2, n, o2) {
        var i3 = e2.pending;
        if (e2.pending = null, i3 !== null) {
          i3 = i3.next;
          do
            n.status = "rejected", n.reason = o2, cp(n), n = n.next;
          while (n !== i3);
        }
        e2.action = null;
      }
      function cp(e2) {
        e2 = e2.listeners;
        for (var n = 0; n < e2.length; n++) (0, e2[n])();
      }
      function dp(e2, n) {
        return n;
      }
      function fi(e2, n) {
        if (le) {
          var o2 = Ge.formState;
          if (o2 !== null) {
            e: {
              var i3 = X2;
              if (le) {
                if (rn) {
                  var s = Ng(rn, No);
                  if (s) {
                    rn = gr(s), i3 = An(s);
                    break e;
                  }
                }
                Nr(i3);
              }
              i3 = false;
            }
            i3 && (n = o2[0]);
          }
        }
        o2 = ot(), o2.memoizedState = o2.baseState = n, i3 = {
          pending: null,
          lanes: 0,
          dispatch: null,
          lastRenderedReducer: dp,
          lastRenderedState: n
        }, o2.queue = i3, o2 = rd.bind(null, X2, i3), i3.dispatch = o2, i3 = Mc(false);
        var u2 = Ct.bind(null, X2, false, i3.queue);
        return i3 = ot(), s = {
          state: n,
          dispatch: null,
          action: e2,
          pending: null
        }, i3.queue = s, o2 = bm.bind(null, X2, s, u2, o2), s.dispatch = o2, i3.memoizedState = e2, [n, o2, false];
      }
      function au(e2) {
        var n = xe();
        return pi(n, qe, e2);
      }
      function pi(e2, n, o2) {
        if (n = Hc(e2, n, dp)[0], e2 = xl(ge)[0], typeof n == "object" && n !== null && typeof n.then == "function") try {
          var i3 = Pl(n);
        } catch (f) {
          throw f === cf ? Vg : f;
        }
        else i3 = n;
        n = xe();
        var s = n.queue, u2 = s.dispatch;
        return o2 !== n.memoizedState && (X2.flags |= 2048, Qo(Ro | Dt, {
          destroy: void 0
        }, ym.bind(null, s, o2), null)), [i3, u2, e2];
      }
      function ym(e2, n) {
        e2.action = n;
      }
      function Mt(e2) {
        var n = xe(), o2 = qe;
        if (o2 !== null) return pi(n, o2, e2);
        xe(), n = n.memoizedState, o2 = xe();
        var i3 = o2.queue.dispatch;
        return o2.memoizedState = e2, [n, i3, false];
      }
      function Qo(e2, n, o2, i3) {
        return e2 = {
          tag: e2,
          create: o2,
          deps: i3,
          inst: n,
          next: null
        }, n = X2.updateQueue, n === null && (n = wl(), X2.updateQueue = n), o2 = n.lastEffect, o2 === null ? n.lastEffect = e2.next = e2 : (i3 = o2.next, o2.next = e2, e2.next = i3, n.lastEffect = e2), e2;
      }
      function iu(e2) {
        var n = ot();
        return e2 = {
          current: e2
        }, n.memoizedState = e2;
      }
      function qo(e2, n, o2, i3) {
        var s = ot();
        X2.flags |= e2, s.memoizedState = Qo(Ro | n, {
          destroy: void 0
        }, o2, i3 === void 0 ? null : i3);
      }
      function at(e2, n, o2, i3) {
        var s = xe();
        i3 = i3 === void 0 ? null : i3;
        var u2 = s.memoizedState.inst;
        qe !== null && i3 !== null && Ks(i3, qe.memoizedState.deps) ? s.memoizedState = Qo(n, u2, o2, i3) : (X2.flags |= e2, s.memoizedState = Qo(Ro | n, u2, o2, i3));
      }
      function lu(e2, n) {
        (X2.mode & 16) !== Z ? qo(545261568, Dt, e2, n) : qo(8390656, Dt, e2, n);
      }
      function fp(e2) {
        X2.flags |= 4;
        var n = X2.updateQueue;
        if (n === null) n = wl(), X2.updateQueue = n, n.events = [e2];
        else {
          var o2 = n.events;
          o2 === null ? n.events = [e2] : o2.push(e2);
        }
      }
      function zl(e2) {
        var n = ot(), o2 = {
          impl: e2
        };
        return n.memoizedState = o2, function() {
          if ((ve & pt) !== ft) throw Error("A function wrapped in useEffectEvent can't be called during rendering.");
          return o2.impl.apply(void 0, arguments);
        };
      }
      function su(e2) {
        var n = xe().memoizedState;
        return fp({
          ref: n,
          nextImpl: e2
        }), function() {
          if ((ve & pt) !== ft) throw Error("A function wrapped in useEffectEvent can't be called during rendering.");
          return n.impl.apply(void 0, arguments);
        };
      }
      function uu(e2, n) {
        var o2 = 4194308;
        return (X2.mode & 16) !== Z && (o2 |= 268435456), qo(o2, eo, e2, n);
      }
      function pp(e2, n) {
        if (typeof n == "function") {
          e2 = e2();
          var o2 = n(e2);
          return function() {
            typeof o2 == "function" ? o2() : n(null);
          };
        }
        if (n != null) return n.hasOwnProperty("current") || console.error("Expected useImperativeHandle() first argument to either be a ref callback or React.createRef() object. Instead received: %s.", "an object with keys {" + Object.keys(n).join(", ") + "}"), e2 = e2(), n.current = e2, function() {
          n.current = null;
        };
      }
      function hp(e2, n, o2) {
        typeof n != "function" && console.error("Expected useImperativeHandle() second argument to be a function that creates a handle. Instead received: %s.", n !== null ? typeof n : "null"), o2 = o2 != null ? o2.concat([e2]) : null;
        var i3 = 4194308;
        (X2.mode & 16) !== Z && (i3 |= 268435456), qo(i3, eo, pp.bind(null, n, e2), o2);
      }
      function hi(e2, n, o2) {
        typeof n != "function" && console.error("Expected useImperativeHandle() second argument to be a function that creates a handle. Instead received: %s.", n !== null ? typeof n : "null"), o2 = o2 != null ? o2.concat([e2]) : null, at(4, eo, pp.bind(null, n, e2), o2);
      }
      function Jc(e2, n) {
        return ot().memoizedState = [e2, n === void 0 ? null : n], e2;
      }
      function El(e2, n) {
        var o2 = xe();
        n = n === void 0 ? null : n;
        var i3 = o2.memoizedState;
        return n !== null && Ks(n, i3[1]) ? i3[0] : (o2.memoizedState = [e2, n], e2);
      }
      function Zc(e2, n) {
        var o2 = ot();
        n = n === void 0 ? null : n;
        var i3 = e2();
        if (oc) {
          Oe(true);
          try {
            e2();
          } finally {
            Oe(false);
          }
        }
        return o2.memoizedState = [i3, n], i3;
      }
      function _l(e2, n) {
        var o2 = xe();
        n = n === void 0 ? null : n;
        var i3 = o2.memoizedState;
        if (n !== null && Ks(n, i3[1])) return i3[0];
        if (i3 = e2(), oc) {
          Oe(true);
          try {
            e2();
          } finally {
            Oe(false);
          }
        }
        return o2.memoizedState = [i3, n], i3;
      }
      function Xc(e2, n) {
        var o2 = ot();
        return Kc(o2, e2, n);
      }
      function xt(e2, n) {
        var o2 = xe();
        return mp(o2, qe.memoizedState, e2, n);
      }
      function Yc(e2, n) {
        var o2 = xe();
        return qe === null ? Kc(o2, e2, n) : mp(o2, qe.memoizedState, e2, n);
      }
      function Kc(e2, n, o2) {
        return o2 === void 0 || (Qi & 1073741824) !== 0 && (te & 261930) === 0 ? e2.memoizedState = n : (e2.memoizedState = o2, e2 = Jm(), X2.lanes |= e2, bs |= e2, o2);
      }
      function mp(e2, n, o2, i3) {
        return Gt(o2, n) ? o2 : ms.current !== null ? (e2 = Kc(e2, o2, i3), Gt(e2, n) || (In = true), e2) : (Qi & 106) === 0 || (Qi & 1073741824) !== 0 && (te & 261930) === 0 ? (In = true, e2.memoizedState = o2) : (e2 = Jm(), X2.lanes |= e2, bs |= e2, n);
      }
      function ed() {
        N2.asyncTransitions--;
      }
      function cu(e2, n, o2, i3, s) {
        var u2 = fr();
        Je(u2 !== 0 && 8 > u2 ? u2 : 8);
        var f = N2.T, p4 = {};
        p4.types = f !== null ? f.types : null, p4._updatedFibers = /* @__PURE__ */ new Set(), N2.T = p4, Ct(e2, false, n, o2);
        try {
          var g3 = s(), b2 = N2.S;
          if (b2 !== null && b2(p4, g3), g3 !== null && typeof g3 == "object" && typeof g3.then == "function") {
            N2.asyncTransitions++, g3.then(ed, ed);
            var k2 = mm(g3, i3);
            mi(e2, n, k2, _t(e2));
          } else mi(e2, n, i3, _t(e2));
        } catch (z) {
          mi(e2, n, {
            then: function() {
            },
            status: "rejected",
            reason: z
          }, _t(e2));
        } finally {
          Je(u2), f !== null && p4.types !== null && (f.types !== null && f.types !== p4.types && console.error("We expected inner Transitions to have transferred the outer types set and that you cannot add to the outer Transition while inside the inner.This is a bug in React."), f.types = p4.types), N2.T = f, f === null && p4._updatedFibers && (e2 = p4._updatedFibers.size, p4._updatedFibers.clear(), 10 < e2 && console.warn("Detected a large number of updates inside startTransition. If this is due to a subscription please re-write it to use React provided hooks. Otherwise concurrent mode guarantees are off the table."));
        }
      }
      function Dn(e2) {
        var n = e2.memoizedState;
        if (n !== null) return n;
        n = {
          memoizedState: Gr,
          baseState: Gr,
          baseQueue: null,
          queue: {
            pending: null,
            lanes: 0,
            dispatch: null,
            lastRenderedReducer: ge,
            lastRenderedState: Gr
          },
          next: null
        };
        var o2 = {};
        return n.next = {
          memoizedState: o2,
          baseState: o2,
          baseQueue: null,
          queue: {
            pending: null,
            lanes: 0,
            dispatch: null,
            lastRenderedReducer: ge,
            lastRenderedState: o2
          },
          next: null
        }, e2.memoizedState = n, e2 = e2.alternate, e2 !== null && (e2.memoizedState = n), n;
      }
      function nd() {
        var e2 = Mc(false);
        return e2 = cu.bind(null, X2, e2.queue, true, false), ot().memoizedState = e2, [false, e2];
      }
      function Vn() {
        var e2 = xl(ge)[0], n = xe().memoizedState;
        return [typeof e2 == "boolean" ? e2 : Pl(e2), n];
      }
      function gp() {
        var e2 = $o(ge)[0], n = xe().memoizedState;
        return [typeof e2 == "boolean" ? e2 : Pl(e2), n];
      }
      function or() {
        return K(Jr);
      }
      function td() {
        var e2 = ot(), n = Ge.identifierPrefix;
        if (le) {
          var o2 = Oi, i3 = Ai;
          o2 = (i3 & ~(1 << 32 - d(i3) - 1)).toString(32) + o2, n = "_" + n + "R_" + o2, o2 = Jg++, 0 < o2 && (n += "H" + o2.toString(32)), n += "_";
        } else o2 = U1++, n = "_" + n + "r_" + o2.toString(32) + "_";
        return e2.memoizedState = n;
      }
      function ar() {
        return ot().memoizedState = xa.bind(null, X2);
      }
      function xa(e2, n) {
        for (var o2 = e2.return; o2 !== null; ) {
          switch (o2.tag) {
            case 24:
            case 3:
              var i3 = _t(o2), s = Vo(i3), u2 = rr(o2, s, i3);
              u2 !== null && (tr(i3, "refresh()", e2), nn(u2, o2, i3), Sl(u2, o2, i3)), e2 = pl(), n != null && u2 !== null && console.error("The seed argument is not enabled outside experimental channels."), s.payload = {
                cache: e2
              };
              return;
          }
          o2 = o2.return;
        }
      }
      function Mr(e2, n, o2) {
        var i3 = arguments;
        typeof i3[3] == "function" && console.error("State updates from the useState() and useReducer() Hooks don't support the second callback argument. To execute a side effect after rendering, declare it in the component body with useEffect()."), i3 = _t(e2);
        var s = {
          lane: i3,
          revertLane: 0,
          gesture: null,
          action: o2,
          hasEagerState: false,
          eagerState: null,
          next: null
        };
        du(e2) ? gi(n, s) : (s = Rc(e2, n, s, i3), s !== null && (tr(i3, "dispatch()", e2), nn(s, e2, i3), Nl(s, n, i3)));
      }
      function rd(e2, n, o2) {
        var i3 = arguments;
        typeof i3[3] == "function" && console.error("State updates from the useState() and useReducer() Hooks don't support the second callback argument. To execute a side effect after rendering, declare it in the component body with useEffect()."), i3 = _t(e2), mi(e2, n, o2, i3) && tr(i3, "setState()", e2);
      }
      function mi(e2, n, o2, i3) {
        var s = {
          lane: i3,
          revertLane: 0,
          gesture: null,
          action: o2,
          hasEagerState: false,
          eagerState: null,
          next: null
        };
        if (du(e2)) gi(n, s);
        else {
          var u2 = e2.alternate;
          if (e2.lanes === 0 && (u2 === null || u2.lanes === 0) && (u2 = n.lastRenderedReducer, u2 !== null)) {
            var f = N2.H;
            N2.H = da;
            try {
              var p4 = n.lastRenderedState, g3 = u2(p4, o2);
              if (s.hasEagerState = true, s.eagerState = g3, Gt(g3, p4)) return Qs(e2, n, s, 0), Ge === null && vl(), false;
            } catch {
            } finally {
              N2.H = f;
            }
          }
          if (o2 = Rc(e2, n, s, i3), o2 !== null) return nn(o2, e2, i3), Nl(o2, n, i3), true;
        }
        return false;
      }
      function Ct(e2, n, o2, i3) {
        if (N2.T === null && ps === 0 && console.error("An optimistic state update occurred outside a transition or action. To fix, move the update to an action, or wrap with startTransition."), i3 = {
          lane: 2,
          revertLane: Nc(),
          gesture: null,
          action: i3,
          hasEagerState: false,
          eagerState: null,
          next: null
        }, du(e2)) {
          if (n) throw Error("Cannot update optimistic state while rendering.");
          console.error("Cannot call startTransition while rendering.");
        } else n = Rc(e2, o2, i3, 2), n !== null && (tr(2, "setOptimistic()", e2), nn(n, e2, 2));
      }
      function du(e2) {
        var n = e2.alternate;
        return e2 === X2 || n !== null && n === X2;
      }
      function gi(e2, n) {
        mf = Gg = true;
        var o2 = e2.pending;
        o2 === null ? n.next = n : (n.next = o2.next, o2.next = n), e2.pending = n;
      }
      function Nl(e2, n, o2) {
        if ((o2 & 4194048) !== 0) {
          var i3 = n.lanes;
          i3 &= e2.pendingLanes, o2 |= i3, n.lanes = o2, If(e2, o2);
        }
      }
      function ko(e2) {
        if (e2 !== null && typeof e2 != "function") {
          var n = String(e2);
          Oy.has(n) || (Oy.add(n), console.error("Expected the last optional `callback` argument to be a function. Instead received: %s.", e2));
        }
      }
      function od(e2, n, o2, i3) {
        var s = e2.memoizedState, u2 = o2(i3, s);
        if (e2.mode & 8) {
          Oe(true);
          try {
            u2 = o2(i3, s);
          } finally {
            Oe(false);
          }
        }
        u2 === void 0 && (n = en(n) || "Component", jy.has(n) || (jy.add(n), console.error("%s.getDerivedStateFromProps(): A valid state object (or null) must be returned. You have returned undefined.", n))), s = u2 == null ? s : Un({}, s, u2), e2.memoizedState = s, e2.lanes === 0 && (e2.updateQueue.baseState = s);
      }
      function bp(e2, n, o2, i3, s, u2, f) {
        var p4 = e2.stateNode;
        if (typeof p4.shouldComponentUpdate == "function") {
          if (o2 = p4.shouldComponentUpdate(i3, u2, f), e2.mode & 8) {
            Oe(true);
            try {
              o2 = p4.shouldComponentUpdate(i3, u2, f);
            } finally {
              Oe(false);
            }
          }
          return o2 === void 0 && console.error("%s.shouldComponentUpdate(): Returned undefined instead of a boolean value. Make sure to return true or false.", en(n) || "Component"), o2;
        }
        return n.prototype && n.prototype.isPureReactComponent ? !bl(o2, i3) || !bl(s, u2) : true;
      }
      function Tl(e2, n, o2, i3) {
        var s = n.state;
        typeof n.componentWillReceiveProps == "function" && n.componentWillReceiveProps(o2, i3), typeof n.UNSAFE_componentWillReceiveProps == "function" && n.UNSAFE_componentWillReceiveProps(o2, i3), n.state !== s && (e2 = G(e2) || "Component", Iy.has(e2) || (Iy.add(e2), console.error("%s.componentWillReceiveProps(): Assigning directly to this.state is deprecated (except inside a component's constructor). Use setState instead.", e2)), Sb.enqueueReplaceState(n, n.state, null));
      }
      function Ca(e2, n) {
        var o2 = n;
        if ("ref" in n) {
          o2 = {};
          for (var i3 in n) i3 !== "ref" && (o2[i3] = n[i3]);
        }
        if (e2 = e2.defaultProps) {
          o2 === n && (o2 = Un({}, o2));
          for (var s in e2) o2[s] === void 0 && (o2[s] = e2[s]);
        }
        return o2;
      }
      function bi(e2, n) {
        try {
          gf = n.source ? G(n.source) : null, kb = null;
          var o2 = n.value;
          if (N2.actQueue !== null) N2.thrownErrors.push(o2);
          else {
            var i3 = e2.onUncaughtError;
            i3(o2, {
              componentStack: n.stack
            });
          }
        } catch (s) {
          setTimeout(function() {
            throw s;
          });
        }
      }
      function yp(e2, n, o2) {
        try {
          gf = o2.source ? G(o2.source) : null, kb = G(n);
          var i3 = e2.onCaughtError;
          i3(o2.value, {
            componentStack: o2.stack,
            errorBoundary: n.tag === 1 ? n.stateNode : null
          });
        } catch (s) {
          setTimeout(function() {
            throw s;
          });
        }
      }
      function fu(e2, n, o2) {
        return o2 = Vo(o2), o2.tag = hb, o2.payload = {
          element: null
        }, o2.callback = function() {
          B(n.source, bi, e2, n);
        }, o2;
      }
      function pu(e2) {
        return e2 = Vo(e2), e2.tag = hb, e2;
      }
      function hu(e2, n, o2, i3) {
        var s = o2.type.getDerivedStateFromError;
        if (typeof s == "function") {
          var u2 = i3.value;
          e2.payload = function() {
            return s(u2);
          }, e2.callback = function() {
            mg(o2), B(i3.source, yp, n, o2, i3);
          };
        }
        var f = o2.stateNode;
        f !== null && typeof f.componentDidCatch == "function" && (e2.callback = function() {
          mg(o2), B(i3.source, yp, n, o2, i3), typeof s != "function" && (vs === null ? vs = /* @__PURE__ */ new Set([this]) : vs.add(this)), L1(this, i3), typeof s == "function" || (o2.lanes & 2) === 0 && console.error("%s: Error boundaries should implement getDerivedStateFromError(). In that method, return a state update to display an error message or fallback UI.", G(o2) || "Unknown");
        });
      }
      function vm(e2, n, o2, i3, s) {
        if (o2.flags |= 32768, Le && Ru(e2, s), i3 !== null && typeof i3 == "object" && typeof i3.then == "function") {
          if (n = o2.alternate, n !== null && Ho(n, o2, s, true), le && (qa = true), o2 = St.current, o2 !== null) {
            switch (o2.tag) {
              case 31:
              case 13:
              case 19:
                return Zt === null ? Iu() : o2.alternate === null && fn === Gi && (fn = s0), o2.flags &= -257, o2.flags |= 65536, o2.lanes = s, i3 === $g ? o2.flags |= 16384 : (n = o2.updateQueue, n === null ? o2.updateQueue = /* @__PURE__ */ new Set([i3]) : n.add(i3), Kp(e2, i3, s)), false;
              case 22:
                return o2.flags |= 65536, i3 === $g ? o2.flags |= 16384 : (n = o2.updateQueue, n === null ? (n = {
                  transitions: null,
                  markerInstances: null,
                  retryQueue: /* @__PURE__ */ new Set([i3])
                }, o2.updateQueue = n) : (o2 = n.retryQueue, o2 === null ? n.retryQueue = /* @__PURE__ */ new Set([i3]) : o2.add(i3)), Kp(e2, i3, s)), false;
            }
            throw Error("Unexpected Suspense handler tag (" + o2.tag + "). This is a bug in React.");
          }
          return Kp(e2, i3, s), Iu(), false;
        }
        if (le) return qa = true, n = St.current, n !== null ? (n.tag === 19 && console.error("SuspenseList should never catch while hydrating. This is a bug in React."), (n.flags & 65536) === 0 && (n.flags |= 256), n.flags |= 65536, n.lanes = s, i3 !== J0 && Ve(Ot(Error("There was an error while hydrating but React was able to recover by instead client rendering from the nearest Suspense boundary.", {
          cause: i3
        }), o2))) : (i3 !== J0 && Ve(Ot(Error("There was an error while hydrating but React was able to recover by instead client rendering the entire root.", {
          cause: i3
        }), o2)), e2 = e2.current.alternate, e2.flags |= 65536, s &= -s, e2.lanes |= s, i3 = Ot(i3, o2), s = fu(e2.stateNode, i3, s), ui(e2, s), fn !== gs && (fn = lc)), false;
        var u2 = Ot(Error("There was an error during concurrent rendering but React was able to recover by instead synchronously rendering the entire root.", {
          cause: i3
        }), o2);
        if (Kh === null ? Kh = [u2] : Kh.push(u2), fn !== gs && (fn = lc), n === null) return true;
        i3 = Ot(i3, o2), o2 = n;
        do {
          switch (o2.tag) {
            case 3:
              return o2.flags |= 65536, e2 = s & -s, o2.lanes |= e2, e2 = fu(o2.stateNode, i3, e2), ui(o2, e2), false;
            case 1:
              if (n = o2.type, u2 = o2.stateNode, (o2.flags & 128) === 0 && (typeof n.getDerivedStateFromError == "function" || u2 !== null && typeof u2.componentDidCatch == "function" && (vs === null || !vs.has(u2)))) return o2.flags |= 65536, s &= -s, o2.lanes |= s, s = pu(s), hu(s, e2, o2, i3), ui(o2, s), false;
              break;
            case 22:
              if (o2.memoizedState !== null) return o2.flags |= 65536, false;
          }
          o2 = o2.return;
        } while (o2 !== null);
        return false;
      }
      function bn(e2, n, o2, i3) {
        n.child = e2 === null ? Sy(n, null, o2, i3) : rc(n, e2.child, o2, i3);
      }
      function zt(e2, n, o2, i3, s) {
        o2 = o2.render;
        var u2 = Bl(o2);
        if (u2 !== o2 && (o2 = u2, e2 !== null && (In = true)), u2 = n.ref, "ref" in i3) {
          var f = {};
          for (var p4 in i3) p4 !== "ref" && (f[p4] = i3[p4]);
        } else f = i3;
        return gn(n), i3 = ap(e2, n, o2, f, u2, s), p4 = Oc(), e2 !== null && !In ? (eu(e2, n, s), Jo(e2, n, s)) : (le && p4 && rl(n), n.flags |= 1, bn(e2, n, i3, s), n.child);
      }
      function vp(e2, n, o2, i3, s) {
        if (e2 === null) {
          var u2 = o2.type;
          return typeof u2 == "function" && !nh(u2) && u2.defaultProps === void 0 && o2.compare === null ? (o2 = Bl(u2), n.tag = 15, n.type = o2, id(n, u2), yi(e2, n, o2, i3, s)) : (e2 = Td(o2.type, null, i3, n, n.mode, s), e2.ref = n.ref, e2.return = n, n.child = e2);
        }
        if (u2 = e2.child, !vu(e2, s)) {
          var f = u2.memoizedProps;
          if (o2 = o2.compare, o2 = o2 !== null ? o2 : bl, o2(f, i3) && e2.ref === n.ref) return Jo(e2, n, s);
        }
        return n.flags |= 1, e2 = Ko(u2, i3), e2.ref = n.ref, e2.return = n, n.child = e2;
      }
      function yi(e2, n, o2, i3, s) {
        if (e2 !== null) {
          var u2 = e2.memoizedProps;
          if (bl(u2, i3) && e2.ref === n.ref && n.type === e2.type) if (In = false, n.pendingProps = i3 = u2, vu(e2, s)) (e2.flags & 131072) !== 0 && (In = true);
          else return n.lanes = e2.lanes, Jo(e2, n, s);
        }
        return Ea(e2, n, o2, i3, s);
      }
      function yt(e2, n, o2, i3) {
        var s = i3.children, u2 = e2 !== null ? e2.memoizedState : null;
        if (e2 === null && n.stateNode === null && (n.stateNode = {
          _visibility: Hh,
          _pendingMarkers: null,
          _retryCache: null,
          _transitions: null
        }), i3.mode === "hidden") {
          if ((n.flags & 128) !== 0) {
            if (u2 = u2 !== null ? u2.baseLanes | o2 : o2, e2 !== null) {
              for (i3 = n.child = e2.child, s = 0; i3 !== null; ) s = s | i3.lanes | i3.childLanes, i3 = i3.sibling;
              i3 = s & ~u2;
            } else i3 = 0, n.child = null;
            return Sp(e2, n, u2, o2, i3);
          }
          if ((o2 & 536870912) !== 0) n.memoizedState = {
            baseLanes: 0,
            cachePool: null
          }, e2 !== null && Hs(n, u2 !== null ? u2.cachePool : null), u2 !== null ? op(n, u2) : Dc(n), Uc(n);
          else return i3 = n.lanes = 536870912, Sp(e2, n, u2 !== null ? u2.baseLanes | o2 : o2, o2, i3);
        } else u2 !== null ? (Hs(n, u2.cachePool), op(n, u2), Ar(n), n.memoizedState = null) : (e2 !== null && Hs(n, null), Dc(n), Ar(n));
        return bn(e2, n, s, o2), n.child;
      }
      function Il(e2, n) {
        return e2 !== null && e2.tag === 22 || n.stateNode !== null || (n.stateNode = {
          _visibility: Hh,
          _pendingMarkers: null,
          _retryCache: null,
          _transitions: null
        }), n.sibling;
      }
      function Sp(e2, n, o2, i3, s) {
        var u2 = Bs();
        return u2 = u2 === null ? null : {
          parent: yn ? vn._currentValue : vn._currentValue2,
          pool: u2
        }, n.memoizedState = {
          baseLanes: o2,
          cachePool: u2
        }, e2 !== null && Hs(n, null), Dc(n), Uc(n), e2 !== null && Ho(e2, n, i3, true), n.childLanes = s, null;
      }
      function ad(e2, n) {
        var o2 = n.hidden;
        return o2 !== void 0 && console.error(`<Activity> doesn't accept a hidden prop. Use mode="hidden" instead.
- <Activity %s>
+ <Activity %s>`, o2 === true ? "hidden" : o2 === false ? "hidden={false}" : "hidden={...}", o2 ? 'mode="hidden"' : 'mode="visible"'), n = ld({
          mode: n.mode,
          children: n.children
        }, e2.mode), n.ref = e2.ref, e2.child = n, n.return = e2, n;
      }
      function Go(e2, n, o2) {
        return rc(n, e2.child, null, o2), e2 = ad(n, n.pendingProps), e2.flags |= 2, rt(n), n.memoizedState = null, e2;
      }
      function Sm(e2, n, o2) {
        var i3 = n.pendingProps, s = (n.flags & 128) !== 0;
        if (n.flags &= -129, e2 === null) {
          if (le) {
            if (i3.mode === "hidden") return e2 = ad(n, i3), n.lanes = 536870912, e2.memoizedState = {
              baseLanes: 0,
              cachePool: null
            }, Il(null, e2);
            if (jc(n), (e2 = rn) ? (o2 = qd(e2, No), o2 !== null && (i3 = {
              dehydrated: o2,
              treeContext: Uf(),
              retryLane: 536870912,
              hydrationErrors: null
            }, n.memoizedState = i3, i3 = th(o2), i3.return = n, n.child = i3, st = n, rn = null)) : o2 = null, o2 === null) throw _r(n, e2), Nr(n);
            return n.lanes = 536870912, null;
          }
          return ad(n, i3);
        }
        var u2 = e2.memoizedState;
        if (u2 !== null) {
          var f = u2.dehydrated;
          if (jc(n), s) {
            if (n.flags & 256) n.flags &= -257, n = Go(e2, n, o2);
            else if (n.memoizedState !== null) n.child = e2.child, n.flags |= 128, n = null;
            else throw Error("Client rendering an Activity suspended it again. This is a bug in React.");
          } else if (xc(), (o2 & 536870912) !== 0 && zd(n), In || Ho(e2, n, o2, false), s = (o2 & e2.childLanes) !== 0, In || s) {
            if (ms.current === null) {
              if (i3 = Ge, i3 !== null && (f = Ps(i3, o2), f !== 0 && f !== u2.retryLane)) throw u2.retryLane = f, tt(e2, f), nn(i3, e2, f), wb;
              Iu();
            }
            n = Go(e2, n, o2);
          } else e2 = u2.treeContext, $e && (rn = Cn(f), st = n, le = true, ss = null, qa = false, Kr = null, No = false, e2 !== null && Ts(n, e2)), n = ad(n, i3), n.flags |= 134221824;
          return n;
        }
        return u2 = e2.child, i3 = {
          mode: i3.mode,
          children: i3.children
        }, (o2 & 536870912) !== 0 && (o2 & e2.lanes) !== 0 && zd(n), e2 = Ko(u2, i3), e2.ref = n.ref, n.child = e2, e2.return = n, e2;
      }
      function za(e2, n) {
        var o2 = n.ref;
        if (o2 === null) e2 !== null && e2.ref !== null && (n.flags |= 4194816);
        else {
          if (typeof o2 != "function" && typeof o2 != "object") throw Error("Expected ref to be a function, an object returned by React.createRef(), or undefined/null.");
          (e2 === null || e2.ref !== o2) && (n.flags |= 4194816);
        }
      }
      function Ea(e2, n, o2, i3, s) {
        if (o2.prototype && typeof o2.prototype.render == "function") {
          var u2 = en(o2) || "Unknown";
          By[u2] || (console.error("The <%s /> component appears to have a render method, but doesn't extend React.Component. This is likely to cause errors. Change %s to extend React.Component instead.", u2, u2), By[u2] = true);
        }
        return n.mode & 8 && ca.recordLegacyContextWarning(n, null), e2 === null && (id(n, n.type), o2.contextTypes && (u2 = en(o2) || "Unknown", My[u2] || (My[u2] = true, console.error("%s uses the legacy contextTypes API which was removed in React 19. Use React.createContext() with React.useContext() instead. (https://react.dev/link/legacy-context)", u2)))), gn(n), o2 = ap(e2, n, o2, i3, void 0, s), i3 = Oc(), e2 !== null && !In ? (eu(e2, n, s), Jo(e2, n, s)) : (le && i3 && rl(n), n.flags |= 1, bn(e2, n, o2, s), n.child);
      }
      function kp(e2, n, o2, i3, s, u2) {
        return gn(n), qi = -1, Qh = e2 !== null && e2.type !== n.type, n.updateQueue = null, o2 = Ht(n, i3, o2, s), ip(e2, n), i3 = Oc(), e2 !== null && !In ? (eu(e2, n, u2), Jo(e2, n, u2)) : (le && i3 && rl(n), n.flags |= 1, bn(e2, n, o2, u2), n.child);
      }
      function wp(e2, n, o2, i3, s) {
        switch (mc(n)) {
          case false:
            var u2 = n.stateNode, f = new n.type(n.memoizedProps, u2.context).state;
            u2.updater.enqueueSetState(u2, f, null);
            break;
          case true:
            n.flags |= 128, n.flags |= 65536, u2 = Error("Simulated error coming from DevTools");
            var p4 = s & -s;
            if (n.lanes |= p4, f = Ge, f === null) throw Error("Expected a work-in-progress root. This is a bug in React. Please file an issue.");
            p4 = pu(p4), hu(p4, f, n, Ot(u2, n)), ui(n, p4);
        }
        if (gn(n), n.stateNode === null) {
          if (f = c, u2 = o2.contextType, "contextType" in o2 && u2 !== null && (u2 === void 0 || u2.$$typeof !== sn) && !Ay.has(o2) && (Ay.add(o2), p4 = u2 === void 0 ? " However, it is set to undefined. This can be caused by a typo or by mixing up named and default imports. This can also happen due to a circular dependency, so try moving the createContext() call to a separate file." : typeof u2 != "object" ? " However, it is set to a " + typeof u2 + "." : u2.$$typeof === Aa ? " Did you accidentally pass the Context.Consumer instead?" : " However, it is set to an object with keys {" + Object.keys(u2).join(", ") + "}.", console.error("%s defines an invalid contextType. contextType should point to the Context object returned by React.createContext().%s", en(o2) || "Component", p4)), typeof u2 == "object" && u2 !== null && (f = K(u2)), u2 = new o2(i3, f), n.mode & 8) {
            Oe(true);
            try {
              u2 = new o2(i3, f);
            } finally {
              Oe(false);
            }
          }
          if (f = n.memoizedState = u2.state !== null && u2.state !== void 0 ? u2.state : null, u2.updater = Sb, n.stateNode = u2, u2._reactInternals = n, u2._reactInternalInstance = Ty, typeof o2.getDerivedStateFromProps == "function" && f === null && (f = en(o2) || "Component", Ry.has(f) || (Ry.add(f), console.error("`%s` uses `getDerivedStateFromProps` but its initial state is %s. This is not recommended. Instead, define the initial state by assigning an object to `this.state` in the constructor of `%s`. This ensures that `getDerivedStateFromProps` arguments have a consistent shape.", f, u2.state === null ? "null" : "undefined", f))), typeof o2.getDerivedStateFromProps == "function" || typeof u2.getSnapshotBeforeUpdate == "function") {
            var g3 = p4 = f = null;
            if (typeof u2.componentWillMount == "function" && u2.componentWillMount.__suppressDeprecationWarning !== true ? f = "componentWillMount" : typeof u2.UNSAFE_componentWillMount == "function" && (f = "UNSAFE_componentWillMount"), typeof u2.componentWillReceiveProps == "function" && u2.componentWillReceiveProps.__suppressDeprecationWarning !== true ? p4 = "componentWillReceiveProps" : typeof u2.UNSAFE_componentWillReceiveProps == "function" && (p4 = "UNSAFE_componentWillReceiveProps"), typeof u2.componentWillUpdate == "function" && u2.componentWillUpdate.__suppressDeprecationWarning !== true ? g3 = "componentWillUpdate" : typeof u2.UNSAFE_componentWillUpdate == "function" && (g3 = "UNSAFE_componentWillUpdate"), f !== null || p4 !== null || g3 !== null) {
              u2 = en(o2) || "Component";
              var b2 = typeof o2.getDerivedStateFromProps == "function" ? "getDerivedStateFromProps()" : "getSnapshotBeforeUpdate()";
              Fy.has(u2) || (Fy.add(u2), console.error(`Unsafe legacy lifecycles will not be called for components using new component APIs.

%s uses %s but also contains the following legacy lifecycles:%s%s%s

The above lifecycles should be removed. Learn more about this warning here:
https://react.dev/link/unsafe-component-lifecycles`, u2, b2, f !== null ? `
  ` + f : "", p4 !== null ? `
  ` + p4 : "", g3 !== null ? `
  ` + g3 : ""));
            }
          }
          u2 = n.stateNode, f = en(o2) || "Component", u2.render || (o2.prototype && typeof o2.prototype.render == "function" ? console.error("No `render` method found on the %s instance: did you accidentally return an object from the constructor?", f) : console.error("No `render` method found on the %s instance: you may have forgotten to define `render`.", f)), !u2.getInitialState || u2.getInitialState.isReactClassApproved || u2.state || console.error("getInitialState was defined on %s, a plain JavaScript class. This is only supported for classes created using React.createClass. Did you mean to define a state property instead?", f), u2.getDefaultProps && !u2.getDefaultProps.isReactClassApproved && console.error("getDefaultProps was defined on %s, a plain JavaScript class. This is only supported for classes created using React.createClass. Use a static property to define defaultProps instead.", f), u2.contextType && console.error("contextType was defined as an instance property on %s. Use a static property to define contextType instead.", f), o2.childContextTypes && !Wy.has(o2) && (Wy.add(o2), console.error("%s uses the legacy childContextTypes API which was removed in React 19. Use React.createContext() instead. (https://react.dev/link/legacy-context)", f)), o2.contextTypes && !Uy.has(o2) && (Uy.add(o2), console.error("%s uses the legacy contextTypes API which was removed in React 19. Use React.createContext() with static contextType instead. (https://react.dev/link/legacy-context)", f)), typeof u2.componentShouldUpdate == "function" && console.error("%s has a method called componentShouldUpdate(). Did you mean shouldComponentUpdate()? The name is phrased as a question because the function is expected to return a value.", f), o2.prototype && o2.prototype.isPureReactComponent && typeof u2.shouldComponentUpdate < "u" && console.error("%s has a method called shouldComponentUpdate(). shouldComponentUpdate should not be used when extending React.PureComponent. Please extend React.Component if shouldComponentUpdate is used.", en(o2) || "A pure component"), typeof u2.componentDidUnmount == "function" && console.error("%s has a method called componentDidUnmount(). But there is no such lifecycle method. Did you mean componentWillUnmount()?", f), typeof u2.componentDidReceiveProps == "function" && console.error("%s has a method called componentDidReceiveProps(). But there is no such lifecycle method. If you meant to update the state in response to changing props, use componentWillReceiveProps(). If you meant to fetch data or run side-effects or mutations after React has updated the UI, use componentDidUpdate().", f), typeof u2.componentWillRecieveProps == "function" && console.error("%s has a method called componentWillRecieveProps(). Did you mean componentWillReceiveProps()?", f), typeof u2.UNSAFE_componentWillRecieveProps == "function" && console.error("%s has a method called UNSAFE_componentWillRecieveProps(). Did you mean UNSAFE_componentWillReceiveProps()?", f), p4 = u2.props !== i3, u2.props !== void 0 && p4 && console.error("When calling super() in `%s`, make sure to pass up the same props that your component's constructor was passed.", f), u2.defaultProps && console.error("Setting defaultProps as an instance property on %s is not supported and will be ignored. Instead, define defaultProps as a static property on %s.", f, f), typeof u2.getSnapshotBeforeUpdate != "function" || typeof u2.componentDidUpdate == "function" || Ly.has(o2) || (Ly.add(o2), console.error("%s: getSnapshotBeforeUpdate() should be used with componentDidUpdate(). This component defines getSnapshotBeforeUpdate() only.", en(o2))), typeof u2.getDerivedStateFromProps == "function" && console.error("%s: getDerivedStateFromProps() is defined as an instance method and will be ignored. Instead, declare it as a static method.", f), typeof u2.getDerivedStateFromError == "function" && console.error("%s: getDerivedStateFromError() is defined as an instance method and will be ignored. Instead, declare it as a static method.", f), typeof o2.getSnapshotBeforeUpdate == "function" && console.error("%s: getSnapshotBeforeUpdate() is defined as a static method and will be ignored. Instead, declare it as an instance method.", f), (p4 = u2.state) && (typeof p4 != "object" || Gn(p4)) && console.error("%s.state: must be set to an object or null", f), typeof u2.getChildContext == "function" && typeof o2.childContextTypes != "object" && console.error("%s.getChildContext(): childContextTypes must be defined in order to use getChildContext().", f), u2 = n.stateNode, u2.props = i3, u2.state = n.memoizedState, u2.refs = {}, Lc(n), f = o2.contextType, u2.context = typeof f == "object" && f !== null ? K(f) : c, u2.state === i3 && (f = en(o2) || "Component", Dy.has(f) || (Dy.add(f), console.error("%s: It is not recommended to assign props directly to state because updates to props won't be reflected in state. In most cases, it is better to use props directly.", f))), n.mode & 8 && ca.recordLegacyContextWarning(n, u2), ca.recordUnsafeLifecycleWarnings(n, u2), u2.state = n.memoizedState, f = o2.getDerivedStateFromProps, typeof f == "function" && (od(n, o2, f, i3), u2.state = n.memoizedState), typeof o2.getDerivedStateFromProps == "function" || typeof u2.getSnapshotBeforeUpdate == "function" || typeof u2.UNSAFE_componentWillMount != "function" && typeof u2.componentWillMount != "function" || (f = u2.state, typeof u2.componentWillMount == "function" && u2.componentWillMount(), typeof u2.UNSAFE_componentWillMount == "function" && u2.UNSAFE_componentWillMount(), f !== u2.state && (console.error("%s.componentWillMount(): Assigning directly to this.state is deprecated (except inside a component's constructor). Use setState instead.", G(n) || "Component"), Sb.enqueueReplaceState(u2, u2.state, null)), Gs(n, i3, u2, s), kl(), u2.state = n.memoizedState), typeof u2.componentDidMount == "function" && (n.flags |= 4194308), (n.mode & 16) !== Z && (n.flags |= 268435456), u2 = true;
        } else if (e2 === null) {
          u2 = n.stateNode;
          var k2 = n.memoizedProps;
          p4 = Ca(o2, k2), u2.props = p4;
          var z = u2.context;
          g3 = o2.contextType, f = c, typeof g3 == "object" && g3 !== null && (f = K(g3)), b2 = o2.getDerivedStateFromProps, g3 = typeof b2 == "function" || typeof u2.getSnapshotBeforeUpdate == "function", k2 = n.pendingProps !== k2, g3 || typeof u2.UNSAFE_componentWillReceiveProps != "function" && typeof u2.componentWillReceiveProps != "function" || (k2 || z !== f) && Tl(n, u2, i3, f), hs = false;
          var T3 = n.memoizedState;
          u2.state = T3, Gs(n, i3, u2, s), kl(), z = n.memoizedState, k2 || T3 !== z || hs ? (typeof b2 == "function" && (od(n, o2, b2, i3), z = n.memoizedState), (p4 = hs || bp(n, o2, p4, i3, T3, z, f)) ? (g3 || typeof u2.UNSAFE_componentWillMount != "function" && typeof u2.componentWillMount != "function" || (typeof u2.componentWillMount == "function" && u2.componentWillMount(), typeof u2.UNSAFE_componentWillMount == "function" && u2.UNSAFE_componentWillMount()), typeof u2.componentDidMount == "function" && (n.flags |= 4194308), (n.mode & 16) !== Z && (n.flags |= 268435456)) : (typeof u2.componentDidMount == "function" && (n.flags |= 4194308), (n.mode & 16) !== Z && (n.flags |= 268435456), n.memoizedProps = i3, n.memoizedState = z), u2.props = i3, u2.state = z, u2.context = f, u2 = p4) : (typeof u2.componentDidMount == "function" && (n.flags |= 4194308), (n.mode & 16) !== Z && (n.flags |= 268435456), u2 = false);
        } else {
          u2 = n.stateNode, Fc(e2, n), f = n.memoizedProps, g3 = Ca(o2, f), u2.props = g3, b2 = n.pendingProps, T3 = u2.context, z = o2.contextType, p4 = c, typeof z == "object" && z !== null && (p4 = K(z)), k2 = o2.getDerivedStateFromProps, (z = typeof k2 == "function" || typeof u2.getSnapshotBeforeUpdate == "function") || typeof u2.UNSAFE_componentWillReceiveProps != "function" && typeof u2.componentWillReceiveProps != "function" || (f !== b2 || T3 !== p4) && Tl(n, u2, i3, p4), hs = false, T3 = n.memoizedState, u2.state = T3, Gs(n, i3, u2, s), kl();
          var H = n.memoizedState;
          f !== b2 || T3 !== H || hs || e2 !== null && e2.dependencies !== null && dl(e2.dependencies) ? (typeof k2 == "function" && (od(n, o2, k2, i3), H = n.memoizedState), (g3 = hs || bp(n, o2, g3, i3, T3, H, p4) || e2 !== null && e2.dependencies !== null && dl(e2.dependencies)) ? (z || typeof u2.UNSAFE_componentWillUpdate != "function" && typeof u2.componentWillUpdate != "function" || (typeof u2.componentWillUpdate == "function" && u2.componentWillUpdate(i3, H, p4), typeof u2.UNSAFE_componentWillUpdate == "function" && u2.UNSAFE_componentWillUpdate(i3, H, p4)), typeof u2.componentDidUpdate == "function" && (n.flags |= 4), typeof u2.getSnapshotBeforeUpdate == "function" && (n.flags |= 1024)) : (typeof u2.componentDidUpdate != "function" || f === e2.memoizedProps && T3 === e2.memoizedState || (n.flags |= 4), typeof u2.getSnapshotBeforeUpdate != "function" || f === e2.memoizedProps && T3 === e2.memoizedState || (n.flags |= 1024), n.memoizedProps = i3, n.memoizedState = H), u2.props = i3, u2.state = H, u2.context = p4, u2 = g3) : (typeof u2.componentDidUpdate != "function" || f === e2.memoizedProps && T3 === e2.memoizedState || (n.flags |= 4), typeof u2.getSnapshotBeforeUpdate != "function" || f === e2.memoizedProps && T3 === e2.memoizedState || (n.flags |= 1024), u2 = false);
        }
        if (p4 = u2, za(e2, n), f = (n.flags & 128) !== 0, p4 || f) {
          if (p4 = n.stateNode, Pc(n), f && typeof o2.getDerivedStateFromError != "function") o2 = null, Jt = -1;
          else if (o2 = iy(p4), n.mode & 8) {
            Oe(true);
            try {
              iy(p4);
            } finally {
              Oe(false);
            }
          }
          n.flags |= 1, e2 !== null && f ? (n.child = rc(n, e2.child, null, s), n.child = rc(n, null, o2, s)) : bn(e2, n, o2, s), n.memoizedState = p4.state, e2 = n.child;
        } else e2 = Jo(e2, n, s);
        return s = n.stateNode, u2 && s.props !== i3 && (bf || console.error("It looks like %s is reassigning its own `this.props` while rendering. This is not supported and can lead to confusing bugs.", G(n) || "a component"), bf = true), e2;
      }
      function Pp(e2, n, o2, i3) {
        return Oo(), n.flags |= 256, bn(e2, n, o2, i3), n.child;
      }
      function id(e2, n) {
        n && n.childContextTypes && console.error(`childContextTypes cannot be defined on a function component.
  %s.childContextTypes = ...`, n.displayName || n.name || "Component"), typeof n.getDerivedStateFromProps == "function" && (e2 = en(n) || "Unknown", Vy[e2] || (console.error("%s: Function components do not support getDerivedStateFromProps.", e2), Vy[e2] = true)), typeof n.contextType == "object" && n.contextType !== null && (n = en(n) || "Unknown", Hy[n] || (console.error("%s: Function components do not support contextType.", n), Hy[n] = true));
      }
      function Rl(e2) {
        return {
          baseLanes: e2,
          cachePool: qf()
        };
      }
      function mu(e2, n, o2) {
        return e2 = e2 !== null ? e2.childLanes & ~o2 : 0, n && (e2 |= kr), e2;
      }
      function km(e2, n, o2) {
        var i3 = n.pendingProps;
        hc(n) && (n.flags |= 128);
        var s = false, u2 = (n.flags & 128) !== 0, f;
        if ((f = u2) || (f = e2 !== null && e2.memoizedState === null ? false : (kt.current & Mh) !== 0), f && (s = true, n.flags &= -129), f = (n.flags & 32) !== 0, n.flags &= -33, e2 === null) {
          if (le) {
            if (s ? vo(n) : Ar(n), (e2 = rn) ? (o2 = Gd(e2, No), o2 !== null && (f = {
              dehydrated: o2,
              treeContext: Uf(),
              retryLane: 536870912,
              hydrationErrors: null
            }, n.memoizedState = f, f = th(o2), f.return = n, n.child = f, st = n, rn = null)) : o2 = null, o2 === null) throw _r(n, e2), Nr(n);
            return Ce(o2) ? n.lanes = 32 : n.lanes = 536870912, null;
          }
          return u2 = i3.children, i3 = i3.fallback, s ? (Ar(n), s = n.mode, u2 = ld({
            mode: "hidden",
            children: u2
          }, s), i3 = zi(i3, s, o2, null), u2.return = n, i3.return = n, u2.sibling = i3, n.child = u2, i3 = n.child, i3.memoizedState = Rl(o2), i3.childLanes = mu(e2, f, o2), n.memoizedState = xb, Il(null, i3)) : (vo(n), xp(n, u2));
        }
        var p4 = e2.memoizedState;
        if (p4 !== null) {
          var g3 = p4.dehydrated;
          if (g3 !== null) return wm(e2, n, u2, f, i3, g3, p4, o2);
        }
        return s ? (Ar(n), s = i3.fallback, u2 = n.mode, p4 = e2.child, g3 = p4.sibling, i3 = Ko(p4, {
          mode: "hidden",
          children: i3.children
        }), i3.subtreeFlags = p4.subtreeFlags & 1206910976, g3 !== null ? s = Ko(g3, s) : (s = zi(s, u2, o2, null), s.flags |= 2), s.return = n, i3.return = n, i3.sibling = s, n.child = i3, Il(null, i3), i3 = n.child, s = e2.child.memoizedState, s === null ? s = Rl(o2) : (u2 = s.cachePool, u2 !== null ? (p4 = yn ? vn._currentValue : vn._currentValue2, u2 = u2.parent !== p4 ? {
          parent: p4,
          pool: p4
        } : u2) : u2 = qf(), s = {
          baseLanes: s.baseLanes | o2,
          cachePool: u2
        }), i3.memoizedState = s, i3.childLanes = mu(e2, f, o2), n.memoizedState = xb, Il(e2.child, i3)) : (p4 !== null && (o2 & 62914560) === o2 && (o2 & e2.lanes) !== 0 && zd(n), vo(n), o2 = e2.child, e2 = o2.sibling, o2 = Ko(o2, {
          mode: "visible",
          children: i3.children
        }), o2.return = n, o2.sibling = null, e2 !== null && (f = n.deletions, f === null ? (n.deletions = [e2], n.flags |= 16) : f.push(e2)), n.child = o2, n.memoizedState = null, o2);
      }
      function xp(e2, n) {
        return n = ld({
          mode: "visible",
          children: n
        }, e2.mode), n.return = e2, e2.child = n;
      }
      function ld(e2, n) {
        return e2 = ht(22, e2, null, n), e2.lanes = 0, e2;
      }
      function gu(e2, n, o2) {
        return rc(n, e2.child, null, o2), e2 = xp(n, n.pendingProps.children), e2.flags |= 2, n.memoizedState = null, e2;
      }
      function wm(e2, n, o2, i3, s, u2, f, p4) {
        if (o2) return n.flags & 256 ? (vo(n), n.flags &= -257, gu(e2, n, p4)) : n.memoizedState !== null ? (Ar(n), n.child = e2.child, n.flags |= 128, null) : (Ar(n), u2 = s.fallback, f = n.mode, s = ld({
          mode: "visible",
          children: s.children
        }, f), u2 = zi(u2, f, p4, null), u2.flags |= 2, s.return = n, u2.return = n, s.sibling = u2, n.child = s, rc(n, e2.child, null, p4), s = n.child, s.memoizedState = Rl(p4), s.childLanes = mu(e2, i3, p4), n.memoizedState = xb, Il(null, s));
        if (vo(n), xc(), (p4 & 536870912) !== 0 && zd(n), Ce(u2)) return f = Co(u2), i3 = f.digest, u2 = f.message, s = f.stack, f = f.componentStack, i3 !== R1 && (u2 = Error(u2 || "The server could not finish this Suspense boundary, likely due to an error during server rendering. Switched to client rendering."), u2.stack = s || "", u2.digest = i3, i3 = f === void 0 ? null : f, s = {
          value: u2,
          source: null,
          stack: i3
        }, typeof i3 == "string" && G0.set(u2, s), Ve(s)), gu(e2, n, p4);
        if (In || Ho(e2, n, p4, false), i3 = (p4 & e2.childLanes) !== 0, In || i3) {
          if (ms.current !== null) return gu(e2, n, p4);
          if (i3 = Ge, i3 !== null && (s = Ps(i3, p4), s !== 0 && s !== f.retryLane)) throw f.retryLane = s, tt(e2, s), nn(i3, e2, s), wb;
          return xn(u2) || Iu(), gu(e2, n, p4);
        }
        return xn(u2) ? (n.flags |= 192, n.child = e2.child, null) : (e2 = f.treeContext, $e && (rn = Lt(u2), st = n, le = true, ss = null, qa = false, Kr = null, No = false, e2 !== null && Ts(n, e2)), n = xp(n, s.children), n.flags |= 134221824, n);
      }
      function vi(e2, n, o2) {
        e2.lanes |= n;
        var i3 = e2.alternate;
        i3 !== null && (i3.lanes |= n), Cc(e2.return, n, o2);
      }
      function bu(e2) {
        for (var n = null; e2 !== null; ) {
          var o2 = e2.alternate;
          o2 !== null && Xs(o2) === null && (n = e2), e2 = e2.sibling;
        }
        return n;
      }
      function yu(e2, n, o2, i3, s, u2) {
        var f = e2.memoizedState;
        f === null ? e2.memoizedState = {
          isBackwards: n,
          rendering: null,
          renderingStartTime: 0,
          last: i3,
          tail: o2,
          tailMode: s,
          treeForkCount: u2
        } : (f.isBackwards = n, f.rendering = null, f.renderingStartTime = 0, f.last = i3, f.tail = o2, f.tailMode = s, f.treeForkCount = u2);
      }
      function sd(e2) {
        var n = e2.child;
        for (e2.child = null; n !== null; ) {
          var o2 = n.sibling;
          n.sibling = e2.child, e2.child = n, n = o2;
        }
      }
      function Cp(e2, n, o2) {
        var _s2;
        var i3 = n.pendingProps, s = i3.revealOrder, u2 = i3.tail, f = i3.children, p4 = kt.current;
        if (n.flags & 128) return Zs(n, p4), null;
        if ((i3 = (p4 & Mh) !== 0) ? (p4 = p4 & pf | Mh, n.flags |= 128) : p4 &= pf, Zs(n, p4), p4 = (_s2 = s) != null ? _s2 : "null", s != null && s !== "forwards" && s !== "backwards" && s !== "unstable_legacy-backwards" && s !== "together" && s !== "independent" && !$y[p4]) if ($y[p4] = true, typeof s == "string") switch (s.toLowerCase()) {
          case "together":
          case "forwards":
          case "backwards":
          case "independent":
            console.error('"%s" is not a valid value for revealOrder on <SuspenseList />. Use lowercase "%s" instead.', s, s.toLowerCase());
            break;
          case "forward":
          case "backward":
            console.error('"%s" is not a valid value for revealOrder on <SuspenseList />. React uses the -s suffix in the spelling. Use "%ss" instead.', s, s.toLowerCase());
            break;
          default:
            console.error('"%s" is not a supported revealOrder on <SuspenseList />. Did you mean "independent", "together", "forwards" or "backwards"?', s);
        }
        else console.error('%s is not a supported value for revealOrder on <SuspenseList />. Did you mean "independent", "together", "forwards" or "backwards"?', s);
        p4 = u2 != null ? u2 : "null", Pb[p4] || u2 == null || (u2 !== "visible" && u2 !== "collapsed" && u2 !== "hidden" ? (Pb[p4] = true, console.error('"%s" is not a supported value for tail on <SuspenseList />. Did you mean "visible", "collapsed" or "hidden"?', u2)) : s != null && s !== "forwards" && s !== "backwards" && s !== "unstable_legacy-backwards" && (Pb[p4] = true, console.error('<SuspenseList tail="%s" /> is only valid if revealOrder is "forwards" (default) or "backwards". Did you mean to specify revealOrder="forwards"?', u2)));
        e: if ((s == null || s === "forwards" || s === "backwards" || s === "unstable_legacy-backwards") && f !== void 0 && f !== null && f !== false) if (Gn(f)) {
          for (p4 = 0; p4 < f.length; p4++) if (!np(f[p4], p4)) break e;
        } else if (p4 = ti(f), typeof p4 == "function") {
          if (p4 = p4.call(f)) for (var g3 = p4.next(), b2 = 0; !g3.done; g3 = p4.next()) {
            if (!np(g3.value, b2)) break e;
            b2++;
          }
        } else console.error('A single row was passed to a <SuspenseList revealOrder="%s" />. This is not useful since it needs multiple rows. Did you mean to pass multiple children or an array?', s);
        if (s === "backwards" && e2 !== null ? (sd(e2), bn(e2, n, f, o2), sd(e2)) : bn(e2, n, f, o2), le ? (jo(), f = zh) : f = 0, !i3 && e2 !== null && (e2.flags & 128) !== 0) e: for (e2 = n.child; e2 !== null; ) {
          if (e2.tag === 13) e2.memoizedState !== null && vi(e2, o2, n);
          else if (e2.tag === 19) vi(e2, o2, n);
          else if (e2.child !== null) {
            e2.child.return = e2, e2 = e2.child;
            continue;
          }
          if (e2 === n) break e;
          for (; e2.sibling === null; ) {
            if (e2.return === null || e2.return === n) break e;
            e2 = e2.return;
          }
          e2.sibling.return = e2.return, e2 = e2.sibling;
        }
        switch (s) {
          case "backwards":
            o2 = bu(n.child), o2 === null ? (s = n.child, n.child = null) : (s = o2.sibling, o2.sibling = null, sd(n)), yu(n, true, s, null, u2, f);
            break;
          case "unstable_legacy-backwards":
            for (o2 = null, s = n.child, n.child = null; s !== null; ) {
              if (e2 = s.alternate, e2 !== null && Xs(e2) === null) {
                n.child = s;
                break;
              }
              e2 = s.sibling, s.sibling = o2, o2 = s, s = e2;
            }
            yu(n, true, o2, null, u2, f);
            break;
          case "together":
            yu(n, false, null, null, void 0, f);
            break;
          case "independent":
            n.memoizedState = null;
            break;
          default:
            o2 = bu(n.child), o2 === null ? (s = n.child, n.child = null) : (s = o2.sibling, o2.sibling = null), yu(n, false, s, o2, u2, f);
        }
        return n.child;
      }
      function Pm(e2, n, o2) {
        var i3 = n.type, s = n.pendingProps, u2 = s.value;
        return "value" in s || qy || (qy = true, console.error("The `value` prop is required for the `<Context.Provider>`. Did you misspell it or forget to pass it?")), Bo(n, i3, u2), bn(e2, n, s.children, o2), n.child;
      }
      function Jo(e2, n, o2) {
        if (e2 !== null && (n.dependencies = e2.dependencies), Jt = -1, bs |= n.lanes, (o2 & n.childLanes) === 0) if (e2 !== null) {
          if (Ho(e2, n, o2, false), (o2 & n.childLanes) === 0) return null;
        } else return null;
        if (e2 !== null && n.child !== e2.child) throw Error("Resuming work not yet implemented.");
        if (n.child !== null) {
          for (e2 = n.child, o2 = Ko(e2, e2.pendingProps), n.child = o2, o2.return = n; e2.sibling !== null; ) e2 = e2.sibling, o2 = o2.sibling = Ko(e2, e2.pendingProps), o2.return = n;
          o2.sibling = null;
        }
        return n.child;
      }
      function vu(e2, n) {
        return (e2.lanes & n) !== 0 ? true : (e2 = e2.dependencies, !!(e2 !== null && dl(e2)));
      }
      function zp(e2, n, o2) {
        switch (n.tag) {
          case 3:
            co(n, n.stateNode.containerInfo), Bo(n, vn, e2.memoizedState.cache), Oo();
            break;
          case 27:
          case 5:
            al(n);
            break;
          case 4:
            co(n, n.stateNode.containerInfo);
            break;
          case 10:
            Bo(n, n.type, n.memoizedProps.value);
            break;
          case 12:
            (o2 & n.childLanes) !== 0 && (n.flags |= 4), n.flags |= 2048;
            var i3 = n.stateNode;
            i3.effectDuration = -0, i3.passiveEffectDuration = -0;
            break;
          case 31:
            if (n.memoizedState !== null) return n.flags |= 128, jc(n), null;
            break;
          case 13:
            if (i3 = n.memoizedState, i3 !== null) {
              if (i3.dehydrated !== null) return vo(n), n.flags |= 128, null;
              i3 = Ho(e2, n, o2, false);
              var s = n.child.childLanes;
              return i3 || (o2 & s) !== 0 ? km(e2, n, o2) : (vo(n), e2 = Jo(e2, n, o2), e2 !== null ? e2.sibling : null);
            }
            vo(n);
            break;
          case 19:
            if (n.flags & 128) return Cp(e2, n, o2);
            if (s = (e2.flags & 128) !== 0, i3 = (o2 & n.childLanes) !== 0, i3 || (Ho(e2, n, o2, false), i3 = (o2 & n.childLanes) !== 0), s) {
              if (i3) return Cp(e2, n, o2);
              n.flags |= 128;
            }
            if (s = n.memoizedState, s !== null && (s.rendering = null, s.tail = null, s.lastEffect = null), Zs(n, kt.current), i3) break;
            return null;
          case 22:
            return n.lanes = 0, yt(e2, n, o2, n.pendingProps);
          case 24:
            Bo(n, vn, e2.memoizedState.cache);
        }
        return Jo(e2, n, o2);
      }
      function Su(e2, n, o2) {
        if (n._debugNeedsRemount && e2 !== null) {
          o2 = Td(Bl(n.elementType), n.key, n.pendingProps, n._debugOwner || null, n.mode, n.lanes), o2._debugStack = n._debugStack, o2._debugTask = n._debugTask;
          var i3 = n.return;
          if (i3 === null) throw Error("Cannot swap the root fiber.");
          if (e2.alternate = null, n.alternate = null, o2.index = n.index, o2.sibling = n.sibling, o2.return = n.return, o2.ref = n.ref, o2._debugInfo = n._debugInfo, n === i3.child) i3.child = o2;
          else {
            var s = i3.child;
            if (s === null) throw Error("Expected parent to have a child.");
            for (; s.sibling !== n; ) if (s = s.sibling, s === null) throw Error("Expected to find the previous sibling.");
            s.sibling = o2;
          }
          return n = i3.deletions, n === null ? (i3.deletions = [e2], i3.flags |= 16) : n.push(e2), o2.flags |= 134217730, o2;
        }
        if (e2 !== null) {
          if (e2.memoizedProps !== n.pendingProps || n.type !== e2.type) In = true;
          else {
            if (!vu(e2, o2) && (n.flags & 128) === 0) return In = false, zp(e2, n, o2);
            In = (e2.flags & 131072) !== 0;
          }
        } else In = false, (i3 = le) && (jo(), i3 = (n.flags & 1048576) !== 0), i3 && (i3 = n.index, jo(), dm(n, zh, i3));
        switch (n.lanes = 0, n.tag) {
          case 16:
            e: if (i3 = n.pendingProps, e2 = bo(n.elementType), e2 = Bl(e2), n.type = e2, typeof e2 == "function") nh(e2) ? (i3 = Ca(e2, i3), n.tag = 1, n = wp(null, n, e2, i3, o2)) : (n.tag = 0, id(n, e2), n = Ea(null, n, e2, i3, o2));
            else {
              if (e2 != null) {
                if (s = e2.$$typeof, s === Fd) {
                  n.tag = 11, n = zt(null, n, e2, i3, o2);
                  break e;
                } else if (s === Ei) {
                  n.tag = 14, n = vp(null, n, e2, i3, o2);
                  break e;
                } else if (s === sn) {
                  n.tag = 10, n.type = e2, n = Pm(null, n, o2);
                  break e;
                }
              }
              throw n = "", e2 !== null && typeof e2 == "object" && e2.$$typeof === qn && (n = " Did you wrap a component in React.lazy() more than once?"), e2 = en(e2) || e2, Error("Element type is invalid. Received a promise that resolves to: " + e2 + ". Lazy element type must resolve to a class or function." + n);
            }
            return n;
          case 0:
            return Ea(e2, n, n.type, n.pendingProps, o2);
          case 1:
            return i3 = n.type, s = Ca(i3, n.pendingProps), wp(e2, n, i3, s, o2);
          case 3:
            e: {
              if (co(n, n.stateNode.containerInfo), e2 === null) throw Error("Should have a current fiber. This is a bug in React.");
              var u2 = n.pendingProps;
              s = n.memoizedState, i3 = s.element, Fc(e2, n), Gs(n, u2, null, o2);
              var f = n.memoizedState;
              if (u2 = f.cache, Bo(n, vn, u2), u2 !== s.cache && Ds(n, [vn], o2, true), kl(), u2 = f.element, $e && s.isDehydrated) {
                if (s = {
                  element: u2,
                  isDehydrated: false,
                  cache: f.cache
                }, n.updateQueue.baseState = s, n.memoizedState = s, n.flags & 256) {
                  n = Pp(e2, n, u2, o2);
                  break e;
                } else if (u2 !== i3) {
                  i3 = Ot(Error("This root received an early update, before anything was able hydrate. Switched the entire root to client rendering."), n), Ve(i3), n = Pp(e2, n, u2, o2);
                  break e;
                } else for ($e && (rn = kh(n.stateNode.containerInfo), st = n, le = true, ss = null, qa = false, Kr = null, No = true), e2 = Sy(n, null, u2, o2), n.child = e2; e2; ) e2.flags = e2.flags & -3 | 134221824, e2 = e2.sibling;
              } else {
                if (Oo(), u2 === i3) {
                  n = Jo(e2, n, o2);
                  break e;
                }
                bn(e2, n, u2, o2);
              }
              n = n.child;
            }
            return n;
          case 26:
            if (Ze) return za(e2, n), e2 === null ? (e2 = Ph(n.type, null, n.pendingProps, null)) ? n.memoizedState = e2 : le || (n.stateNode = $a(n.type, n.pendingProps, Uo(ls.current), n)) : n.memoizedState = Ph(n.type, e2.memoizedProps, n.pendingProps, e2.memoizedState), null;
          case 27:
            if (je) return al(n), e2 === null && je && le && (s = Uo(ls.current), i3 = Cr(), s = n.stateNode = Ui(n.type, n.pendingProps, s, i3, false), qa || (i3 = Ma(s, n.type, n.pendingProps, i3), i3 !== null && (Ao(n, 0).serverProps = i3)), st = n, No = true, rn = Yr(n.type, s, rn)), bn(e2, n, n.pendingProps.children, o2), za(e2, n), e2 === null && (n.flags |= 4194304), n.child;
          case 5:
            return e2 === null && le && (u2 = Cr(), i3 = es(n.type, n.pendingProps, u2), s = rn, (f = !s) || (f = Di(s, n.type, n.pendingProps, No), f !== null ? (n.stateNode = f, qa || (u2 = Ma(f, n.type, n.pendingProps, u2), u2 !== null && (Ao(n, 0).serverProps = u2)), st = n, rn = Qd(f), No = false, u2 = true) : u2 = false, f = !u2), f && (i3 && _r(n, s), Nr(n))), al(n), s = n.type, u2 = n.pendingProps, f = e2 !== null ? e2.memoizedProps : null, i3 = u2.children, ea(s, u2) ? i3 = null : f !== null && ea(s, f) && (n.flags |= 32), n.memoizedState !== null && (s = ap(e2, n, Ac, null, null, o2), yn ? Jr._currentValue = s : Jr._currentValue2 = s), za(e2, n), bn(e2, n, i3, o2), n.child;
          case 6:
            return e2 === null && le && (e2 = n.pendingProps, o2 = Cr(), e2 = Vu(e2, o2), o2 = rn, (i3 = !o2) || (i3 = H0(o2, n.pendingProps, No), i3 !== null ? (n.stateNode = i3, st = n, rn = null, i3 = true) : i3 = false, i3 = !i3), i3 && (e2 && _r(n, o2), Nr(n))), null;
          case 13:
            return km(e2, n, o2);
          case 4:
            return co(n, n.stateNode.containerInfo), i3 = n.pendingProps, e2 === null ? n.child = rc(n, null, i3, o2) : bn(e2, n, i3, o2), n.child;
          case 11:
            return zt(e2, n, n.type, n.pendingProps, o2);
          case 7:
            return i3 = n.pendingProps, za(e2, n), bn(e2, n, i3, o2), n.child;
          case 8:
            return bn(e2, n, n.pendingProps.children, o2), n.child;
          case 12:
            return n.flags |= 4, n.flags |= 2048, i3 = n.stateNode, i3.effectDuration = -0, i3.passiveEffectDuration = -0, bn(e2, n, n.pendingProps.children, o2), n.child;
          case 10:
            return Pm(e2, n, o2);
          case 9:
            return s = n.type._context, i3 = n.pendingProps.children, typeof i3 != "function" && console.error("A context consumer was rendered with multiple children, or a child that isn't a function. A context consumer expects a single child that is a function. If you did pass a function, make sure there is no trailing or leading whitespace around it."), gn(n), s = K(s), i3 = sb(i3, s, void 0), n.flags |= 1, bn(e2, n, i3, o2), n.child;
          case 14:
            return vp(e2, n, n.type, n.pendingProps, o2);
          case 15:
            return yi(e2, n, n.type, n.pendingProps, o2);
          case 19:
            return Cp(e2, n, o2);
          case 31:
            return Sm(e2, n, o2);
          case 22:
            return yt(e2, n, o2, n.pendingProps);
          case 24:
            return gn(n), i3 = K(vn), e2 === null ? (s = Bs(), s === null && (s = Ge, u2 = pl(), s.pooledCache = u2, Mo(u2), u2 !== null && (s.pooledCacheLanes |= o2), s = u2), n.memoizedState = {
              parent: i3,
              cache: s
            }, Lc(n), Bo(n, vn, s)) : ((e2.lanes & o2) !== 0 && (Fc(e2, n), Gs(n, null, null, o2), kl()), s = e2.memoizedState, u2 = n.memoizedState, s.parent !== i3 ? (s = {
              parent: i3,
              cache: i3
            }, n.memoizedState = s, n.lanes === 0 && (n.memoizedState = n.updateQueue.baseState = s), Bo(n, vn, i3)) : (i3 = u2.cache, Bo(n, vn, i3), i3 !== s.cache && Ds(n, [vn], o2, true))), bn(e2, n, n.pendingProps.children, o2), n.child;
          case 30:
            return n.stateNode === null && (n.stateNode = {
              autoName: null,
              paired: null,
              clones: null,
              ref: null
            }), i3 = n.pendingProps, i3.name != null && i3.name !== "auto" ? n.flags |= e2 === null ? 18882560 : 18874368 : le && rl(n), i3.className !== void 0 && (s = typeof i3.className == "string" ? JSON.stringify(i3.className) : "{...}", Qy[s] || (Qy[s] = true, console.error(`<ViewTransition> doesn't accept a "className" prop. It has been renamed to "default".
-   <ViewTransition className=%s>
+   <ViewTransition default=%s>`, s, s))), e2 !== null && e2.memoizedProps.name !== i3.name ? n.flags |= 4194816 : za(e2, n), bn(e2, n, i3.children, o2), n.child;
          case 29:
            throw n.pendingProps;
        }
        throw Error("Unknown unit of work tag (" + n.tag + "). This error is likely caused by a bug in React. Please file an issue.");
      }
      function ir(e2) {
        e2.flags |= 4;
      }
      function _a(e2) {
        _n && (e2.flags |= 8);
      }
      function ud(e2, n) {
        if (e2 !== null && e2.child === n.child) return false;
        if ((n.flags & 16) !== 0) return true;
        for (e2 = n.child; e2 !== null; ) {
          if ((e2.flags & 8218) !== 0 || (e2.subtreeFlags & 8218) !== 0) return true;
          e2 = e2.sibling;
        }
        return false;
      }
      function cd(e2, n, o2, i3) {
        if (_e) for (o2 = n.child; o2 !== null; ) {
          if (o2.tag === 5 || o2.tag === 6) Fu(e2, o2.stateNode);
          else if (!(o2.tag === 4 || je && o2.tag === 27) && o2.child !== null) {
            o2.child.return = o2, o2 = o2.child;
            continue;
          }
          if (o2 === n) break;
          for (; o2.sibling === null; ) {
            if (o2.return === null || o2.return === n) return;
            o2 = o2.return;
          }
          o2.sibling.return = o2.return, o2 = o2.sibling;
        }
        else if (_n) for (var s = n.child; s !== null; ) {
          if (s.tag === 5) {
            var u2 = s.stateNode;
            o2 && i3 && (u2 = Xr(u2, s.type, s.memoizedProps)), Fu(e2, u2);
          } else if (s.tag === 6) u2 = s.stateNode, o2 && i3 && (u2 = vt(u2, s.memoizedProps)), Fu(e2, u2);
          else if (s.tag !== 4) {
            if (s.tag === 22 && s.memoizedState !== null) u2 = s.child, u2 !== null && (u2.return = s), cd(e2, s, true, true);
            else if (s.child !== null) {
              s.child.return = s, s = s.child;
              continue;
            }
          }
          if (s === n) break;
          for (; s.sibling === null; ) {
            if (s.return === null || s.return === n) return;
            s = s.return;
          }
          s.sibling.return = s.return, s = s.sibling;
        }
      }
      function ke(e2, n, o2, i3) {
        var s = false;
        if (_n) for (var u2 = n.child; u2 !== null; ) {
          if (u2.tag === 5) {
            var f = u2.stateNode;
            o2 && i3 && (f = Xr(f, u2.type, u2.memoizedProps)), Yn(e2, f);
          } else if (u2.tag === 6) f = u2.stateNode, o2 && i3 && (f = vt(f, u2.memoizedProps)), Yn(e2, f);
          else if (u2.tag !== 4) {
            if (u2.tag === 22 && u2.memoizedState !== null) s = u2.child, s !== null && (s.return = u2), ke(e2, u2, true, true), s = true;
            else if (u2.child !== null) {
              u2.child.return = u2, u2 = u2.child;
              continue;
            }
          }
          if (u2 === n) break;
          for (; u2.sibling === null; ) {
            if (u2.return === null || u2.return === n) return s;
            u2 = u2.return;
          }
          u2.sibling.return = u2.return, u2 = u2.sibling;
        }
        return s;
      }
      function dd(e2, n) {
        if (_n && ud(e2, n)) {
          e2 = n.stateNode;
          var o2 = e2.containerInfo, i3 = Vd();
          ke(i3, n, false, false), e2.pendingChildren = i3, ir(n), $d(o2, i3);
        }
      }
      function Ep(e2, n, o2, i3) {
        if (_e) e2.memoizedProps !== i3 && ir(n);
        else if (_n) {
          var s = e2.stateNode, u2 = e2.memoizedProps;
          if ((e2 = ud(e2, n)) || u2 !== i3) {
            var f = Cr();
            u2 = Pn(s, o2, u2, i3, !e2, null), u2 === s ? n.stateNode = s : (_a(n), ph(u2, o2, i3, f) && ir(n), n.stateNode = u2, e2 && cd(u2, n, false, false));
          } else n.stateNode = s;
        }
      }
      function fd(e2, n, o2, i3, s) {
        if ((e2.mode & 32) !== Z && (o2 === null ? jd(n, i3) : Ni(n, o2, i3))) {
          if (e2.flags |= 16777216, (s & 335544128) === s || qr(n, i3)) if (Pg(e2.stateNode, n, i3)) e2.flags |= 8192;
          else if (Ym()) e2.flags |= 8192;
          else throw tc = $g, cb;
        } else e2.flags &= -16777217;
      }
      function xm(e2, n) {
        if (xh(n)) {
          if (e2.flags |= 16777216, !ef(n)) if (Ym()) e2.flags |= 8192;
          else throw tc = $g, cb;
        } else e2.flags &= -16777217;
      }
      function pd(e2, n) {
        n !== null && (e2.flags |= 4), e2.flags & 16384 && (n = e2.tag !== 22 ? ws() : 536870912, e2.lanes |= n, cc |= n);
      }
      function ku(e2, n) {
        if (!le) switch (e2.tailMode) {
          case "visible":
            break;
          case "collapsed":
            for (var o2 = e2.tail, i3 = null; o2 !== null; ) o2.alternate !== null && (i3 = o2), o2 = o2.sibling;
            i3 === null ? n || e2.tail === null ? e2.tail = null : e2.tail.sibling = null : i3.sibling = null;
            break;
          default:
            for (n = e2.tail, o2 = null; n !== null; ) n.alternate !== null && (o2 = n), n = n.sibling;
            o2 === null ? e2.tail = null : o2.sibling = null;
        }
      }
      function Fe(e2) {
        var n = e2.alternate !== null && e2.alternate.child === e2.child, o2 = 0, i3 = 0;
        if (n) {
          if ((e2.mode & 2) !== Z) {
            for (var s = e2.selfBaseDuration, u2 = e2.child; u2 !== null; ) o2 |= u2.lanes | u2.childLanes, i3 |= u2.subtreeFlags & 1206910976, i3 |= u2.flags & 1206910976, s += u2.treeBaseDuration, u2 = u2.sibling;
            e2.treeBaseDuration = s;
          } else for (s = e2.child; s !== null; ) o2 |= s.lanes | s.childLanes, i3 |= s.subtreeFlags & 1206910976, i3 |= s.flags & 1206910976, s.return = e2, s = s.sibling;
        } else if ((e2.mode & 2) !== Z) {
          s = e2.actualDuration, u2 = e2.selfBaseDuration;
          for (var f = e2.child; f !== null; ) o2 |= f.lanes | f.childLanes, i3 |= f.subtreeFlags, i3 |= f.flags, s += f.actualDuration, u2 += f.treeBaseDuration, f = f.sibling;
          e2.actualDuration = s, e2.treeBaseDuration = u2;
        } else for (s = e2.child; s !== null; ) o2 |= s.lanes | s.childLanes, i3 |= s.subtreeFlags, i3 |= s.flags, s.return = e2, s = s.sibling;
        return e2.subtreeFlags |= i3, e2.childLanes = o2, n;
      }
      function _p(e2, n, o2) {
        var i3 = n.pendingProps;
        switch (ol(n), n.tag) {
          case 16:
          case 15:
          case 0:
          case 11:
          case 7:
          case 8:
          case 12:
          case 9:
          case 14:
            return Fe(n), null;
          case 1:
            return Fe(n), null;
          case 3:
            return o2 = n.stateNode, i3 = null, e2 !== null && (i3 = e2.memoizedState.cache), n.memoizedState.cache !== i3 && (n.flags |= 2048), ho(vn, n), ai(n), o2.pendingContext && (o2.context = o2.pendingContext, o2.pendingContext = null), (e2 === null || e2.child === null) && (Ln(n) ? (Fs(), ir(n)) : e2 === null || e2.memoizedState.isDehydrated && (n.flags & 256) === 0 || (n.flags |= 1024, ul())), dd(e2, n), Fe(n), null;
          case 26:
            if (Ze) {
              var s = n.type, u2 = n.memoizedState;
              return e2 === null ? (ir(n), u2 !== null ? (Fe(n), xm(n, u2)) : (Fe(n), fd(n, s, null, i3, o2))) : u2 ? u2 !== e2.memoizedState ? (ir(n), Fe(n), xm(n, u2)) : (Fe(n), n.flags &= -16777217) : (u2 = e2.memoizedProps, _e ? u2 !== i3 && ir(n) : Ep(e2, n, s, i3), Fe(n), fd(n, s, u2, i3, o2)), null;
            }
          case 27:
            if (je) {
              if (zr(n), o2 = Uo(ls.current), s = n.type, e2 !== null && n.stateNode != null) _e ? e2.memoizedProps !== i3 && ir(n) : Ep(e2, n, s, i3);
              else {
                if (!i3) {
                  if (n.stateNode === null) throw Error("We must have new props for new mounts. This error is likely caused by a bug in React. Please file an issue.");
                  return Fe(n), n.subtreeFlags &= -33554433, null;
                }
                e2 = Cr(), Ln(n) ? Wf(n, e2) : (e2 = Ui(s, i3, o2, e2, true), n.stateNode = e2, ir(n));
              }
              return Fe(n), n.subtreeFlags &= -33554433, null;
            }
          case 5:
            if (zr(n), s = n.type, e2 !== null && n.stateNode != null) Ep(e2, n, s, i3);
            else {
              if (!i3) {
                if (n.stateNode === null) throw Error("We must have new props for new mounts. This error is likely caused by a bug in React. Please file an issue.");
                return Fe(n), n.subtreeFlags &= -33554433, null;
              }
              if (u2 = Cr(), Ln(n)) Wf(n, u2), Qt(n.stateNode, s, i3, u2) && (n.flags |= 64);
              else {
                var f = Uo(ls.current);
                f = wg(s, i3, f, u2, n), _a(n), cd(f, n, false, false), n.stateNode = f, ph(f, s, i3, u2) && ir(n);
              }
            }
            return Fe(n), n.subtreeFlags &= -33554433, fd(n, n.type, e2 === null ? null : e2.memoizedProps, n.pendingProps, o2), null;
          case 6:
            if (e2 && n.stateNode != null) o2 = e2.memoizedProps, _e ? o2 !== i3 && ir(n) : _n && (o2 !== i3 ? (e2 = Uo(ls.current), o2 = Cr(), _a(n), n.stateNode = _i(i3, e2, o2, n)) : n.stateNode = e2.stateNode);
            else {
              if (typeof i3 != "string" && n.stateNode === null) throw Error("We must have new props for new mounts. This error is likely caused by a bug in React. Please file an issue.");
              if (e2 = Uo(ls.current), o2 = Cr(), Ln(n)) {
                if (!$e) throw Error("Expected prepareToHydrateHostTextInstance() to never be called. This error is likely caused by a bug in React. Please file an issue.");
                if (e2 = n.stateNode, o2 = n.memoizedProps, s = !qa, i3 = null, u2 = st, u2 !== null) switch (u2.tag) {
                  case 3:
                    s && (s = Yd(e2, o2, i3), s !== null && (Ao(n, 0).serverProps = s));
                    break;
                  case 27:
                  case 5:
                    i3 = u2.memoizedProps, s && (s = Yd(e2, o2, i3), s !== null && (Ao(n, 0).serverProps = s));
                }
                Zd(e2, o2, n, i3) || Nr(n, true);
              } else _a(n), n.stateNode = _i(i3, e2, o2, n);
            }
            return Fe(n), null;
          case 31:
            if (o2 = n.memoizedState, e2 === null || e2.memoizedState !== null) {
              if (i3 = Ln(n), o2 !== null) {
                if (e2 === null) {
                  if (!i3) throw Error("A dehydrated suspense component was completed without a hydrated node. This is probably a bug in React.");
                  if (!$e) throw Error("Expected prepareToHydrateHostActivityInstance() to never be called. This error is likely caused by a bug in React. Please file an issue.");
                  if (e2 = n.memoizedState, e2 = e2 !== null ? e2.dehydrated : null, !e2) throw Error("Expected to have a hydrated activity instance. This error is likely caused by a bug in React. Please file an issue.");
                  Xd(e2, n), Fe(n), (n.mode & 2) !== Z && o2 !== null && (e2 = n.child, e2 !== null && (n.treeBaseDuration -= e2.treeBaseDuration));
                } else Fs(), Oo(), (n.flags & 128) === 0 && (o2 = n.memoizedState = null), n.flags |= 4, Fe(n), (n.mode & 2) !== Z && o2 !== null && (e2 = n.child, e2 !== null && (n.treeBaseDuration -= e2.treeBaseDuration));
                e2 = false;
              } else o2 = ul(), e2 !== null && e2.memoizedState !== null && (e2.memoizedState.hydrationErrors = o2), e2 = true;
              if (!e2) return n.flags & 256 ? (rt(n), n) : (rt(n), null);
              if ((n.flags & 128) !== 0) throw Error("Client rendering an Activity suspended it again. This is a bug in React.");
            }
            return Fe(n), null;
          case 13:
            if (i3 = n.memoizedState, e2 === null || e2.memoizedState !== null && e2.memoizedState.dehydrated !== null) {
              if (s = i3, u2 = Ln(n), s !== null && s.dehydrated !== null) {
                if (e2 === null) {
                  if (!u2) throw Error("A dehydrated suspense component was completed without a hydrated node. This is probably a bug in React.");
                  if (!$e) throw Error("Expected prepareToHydrateHostSuspenseInstance() to never be called. This error is likely caused by a bug in React. Please file an issue.");
                  if (u2 = n.memoizedState, u2 = u2 !== null ? u2.dehydrated : null, !u2) throw Error("Expected to have a hydrated suspense instance. This error is likely caused by a bug in React. Please file an issue.");
                  Mu(u2, n), Fe(n), (n.mode & 2) !== Z && s !== null && (s = n.child, s !== null && (n.treeBaseDuration -= s.treeBaseDuration));
                } else Fs(), Oo(), (n.flags & 128) === 0 && (s = n.memoizedState = null), n.flags |= 4, Fe(n), (n.mode & 2) !== Z && s !== null && (s = n.child, s !== null && (n.treeBaseDuration -= s.treeBaseDuration));
                s = false;
              } else s = ul(), e2 !== null && e2.memoizedState !== null && (e2.memoizedState.hydrationErrors = s), s = true;
              if (!s) return n.flags & 256 ? (rt(n), n) : (rt(n), null);
            }
            return rt(n), (n.flags & 128) !== 0 ? (n.lanes = o2, (n.mode & 2) !== Z && ml(n), n) : (o2 = i3 !== null, e2 = e2 !== null && e2.memoizedState !== null, o2 && (i3 = n.child, s = null, i3.alternate !== null && i3.alternate.memoizedState !== null && i3.alternate.memoizedState.cachePool !== null && (s = i3.alternate.memoizedState.cachePool.pool), u2 = null, i3.memoizedState !== null && i3.memoizedState.cachePool !== null && (u2 = i3.memoizedState.cachePool.pool), u2 !== s && (i3.flags |= 2048)), o2 !== e2 && o2 && (n.child.flags |= 8192), pd(n, n.updateQueue), Fe(n), (n.mode & 2) !== Z && o2 && (e2 = n.child, e2 !== null && (n.treeBaseDuration -= e2.treeBaseDuration)), null);
          case 4:
            return ai(n), dd(e2, n), e2 === null && ju(n.stateNode.containerInfo), n.flags |= 67108864, Fe(n), null;
          case 10:
            return ho(n.type, n), Fe(n), null;
          case 19:
            if (Wc(n), i3 = n.memoizedState, i3 === null) return Fe(n), null;
            if (s = (n.flags & 128) !== 0, u2 = i3.rendering, u2 === null) {
              if (s) ku(i3, false);
              else {
                if (fn !== Gi || e2 !== null && (e2.flags & 128) !== 0) for (e2 = n.child; e2 !== null; ) {
                  if (u2 = Xs(e2), u2 !== null) {
                    for (n.flags |= 128, ku(i3, false), e2 = u2.updateQueue, n.updateQueue = e2, pd(n, e2), n.subtreeFlags = 0, e2 = o2, o2 = n.child; o2 !== null; ) bg(o2, e2), o2 = o2.sibling;
                    return Zs(n, kt.current & pf | Mh), le && uo(n, i3.treeForkCount), n.child;
                  }
                  e2 = e2.sibling;
                }
                i3.tail !== null && Re() > em && (n.flags |= 128, s = true, ku(i3, false), n.lanes = 4194304);
              }
            } else {
              if (!s) if (e2 = Xs(u2), e2 !== null) {
                if (n.flags |= 128, s = true, e2 = e2.updateQueue, n.updateQueue = e2, pd(n, e2), ku(i3, true), i3.tail === null && i3.tailMode !== "collapsed" && i3.tailMode !== "visible" && !u2.alternate && !le) return Fe(n), null;
              } else 2 * Re() - i3.renderingStartTime > em && o2 !== 536870912 && (n.flags |= 128, s = true, ku(i3, false), n.lanes = 4194304);
              i3.isBackwards ? (u2.sibling = n.child, n.child = u2) : (e2 = i3.last, e2 !== null ? e2.sibling = u2 : n.child = u2, i3.last = u2);
            }
            if (i3.tail !== null) {
              e2 = i3.tail;
              e: {
                for (o2 = e2; o2 !== null; ) {
                  if (o2.alternate !== null) {
                    o2 = false;
                    break e;
                  }
                  o2 = o2.sibling;
                }
                o2 = true;
              }
              return i3.rendering = e2, i3.tail = e2.sibling, i3.renderingStartTime = Re(), e2.sibling = null, u2 = kt.current, u2 = s ? u2 & pf | Mh : u2 & pf, i3.tailMode === "visible" || i3.tailMode === "collapsed" || !o2 || le ? Zs(n, u2) : (o2 = u2, ze(St, n, n), ze(kt, o2, n), Zt === null && (Zt = n)), le && uo(n, i3.treeForkCount), e2;
            }
            return Fe(n), null;
          case 22:
          case 23:
            return rt(n), Js(n), i3 = n.memoizedState !== null, e2 !== null ? e2.memoizedState !== null !== i3 && (n.flags |= 8192) : i3 && (n.flags |= 8192), i3 ? (o2 & 536870912) !== 0 && (n.flags & 128) === 0 && (Fe(n), n.subtreeFlags & 6 && (n.flags |= 8192)) : Fe(n), o2 = n.updateQueue, o2 !== null && pd(n, o2.retryQueue), o2 = null, e2 !== null && e2.memoizedState !== null && e2.memoizedState.cachePool !== null && (o2 = e2.memoizedState.cachePool.pool), i3 = null, n.memoizedState !== null && n.memoizedState.cachePool !== null && (i3 = n.memoizedState.cachePool.pool), i3 !== o2 && (n.flags |= 2048), e2 !== null && mn(Ku, n), null;
          case 24:
            return o2 = null, e2 !== null && (o2 = e2.memoizedState.cache), n.memoizedState.cache !== o2 && (n.flags |= 2048), ho(vn, n), Fe(n), null;
          case 25:
            return null;
          case 30:
            return n.flags |= 33554432, Fe(n), null;
        }
        throw Error("Unknown unit of work tag (" + n.tag + "). This error is likely caused by a bug in React. Please file an issue.");
      }
      function Zo(e2, n) {
        switch (ol(n), n.tag) {
          case 1:
            return e2 = n.flags, e2 & 65536 ? (n.flags = e2 & -65537 | 128, (n.mode & 2) !== Z && ml(n), n) : null;
          case 3:
            return ho(vn, n), ai(n), e2 = n.flags, (e2 & 65536) !== 0 && (e2 & 128) === 0 ? (n.flags = e2 & -65537 | 128, n) : null;
          case 26:
          case 27:
          case 5:
            return zr(n), null;
          case 31:
            if (n.memoizedState !== null) {
              if (rt(n), n.alternate === null) throw Error("Threw in newly mounted dehydrated component. This is likely a bug in React. Please file an issue.");
              Oo();
            }
            return e2 = n.flags, e2 & 65536 ? (n.flags = e2 & -65537 | 128, (n.mode & 2) !== Z && ml(n), n) : null;
          case 13:
            if (rt(n), e2 = n.memoizedState, e2 !== null && e2.dehydrated !== null) {
              if (n.alternate === null) throw Error("Threw in newly mounted dehydrated component. This is likely a bug in React. Please file an issue.");
              Oo();
            }
            return e2 = n.flags, e2 & 65536 ? (n.flags = e2 & -65537 | 128, (n.mode & 2) !== Z && ml(n), n) : null;
          case 19:
            return Wc(n), e2 = n.flags, e2 & 65536 ? (n.flags = e2 & -65537 | 128, e2 = n.memoizedState, e2 !== null && (e2.rendering = null, e2.tail = null), n.flags |= 4, n) : null;
          case 4:
            return ai(n), null;
          case 10:
            return ho(n.type, n), null;
          case 22:
          case 23:
            return rt(n), Js(n), e2 !== null && mn(Ku, n), e2 = n.flags, e2 & 65536 ? (n.flags = e2 & -65537 | 128, (n.mode & 2) !== Z && ml(n), n) : null;
          case 24:
            return ho(vn, n), null;
          case 25:
            return null;
          default:
            return null;
        }
      }
      function Np(e2, n) {
        switch (ol(n), n.tag) {
          case 3:
            ho(vn, n), ai(n);
            break;
          case 26:
          case 27:
          case 5:
            zr(n);
            break;
          case 4:
            ai(n);
            break;
          case 31:
            n.memoizedState !== null && rt(n);
            break;
          case 13:
            rt(n);
            break;
          case 19:
            Wc(n);
            break;
          case 10:
            ho(n.type, n);
            break;
          case 22:
          case 23:
            rt(n), Js(n), e2 !== null && mn(Ku, n);
            break;
          case 24:
            ho(vn, n);
        }
      }
      function Vt(e2) {
        return (e2.mode & 2) !== Z;
      }
      function Na(e2, n) {
        Vt(e2) ? (Dr(), Ll(n, e2), Fr()) : Ll(n, e2);
      }
      function wu(e2, n, o2) {
        Vt(e2) ? (Dr(), Ta(o2, e2, n), Fr()) : Ta(o2, e2, n);
      }
      function Ll(e2, n) {
        try {
          var o2 = n.updateQueue, i3 = o2 !== null ? o2.lastEffect : null;
          if (i3 !== null) {
            var s = i3.next;
            o2 = s;
            do {
              if ((o2.tag & e2) === e2 && (i3 = void 0, (e2 & Xt) !== Vh && (xf = true), i3 = B(n, F1, o2), (e2 & Xt) !== Vh && (xf = false), i3 !== void 0 && typeof i3 != "function")) {
                var u2 = void 0;
                u2 = (o2.tag & eo) !== 0 ? "useLayoutEffect" : (o2.tag & Xt) !== 0 ? "useInsertionEffect" : "useEffect";
                var f = void 0;
                f = i3 === null ? " You returned null. If your effect does not require clean up, return undefined (or nothing)." : typeof i3.then == "function" ? `

It looks like you wrote ` + u2 + `(async () => ...) or returned a Promise. Instead, write the async function inside your effect and call it immediately:

` + u2 + `(() => {
  async function fetchData() {
    // You can await here
    const response = await MyAPI.getData(someId);
    // ...
  }
  fetchData();
}, [someId]); // Or [] if effect doesn't need props or state

Learn more about data fetching with Hooks: https://react.dev/link/hooks-data-fetching` : " You returned: " + i3, B(n, function(p4, g3) {
                  console.error("%s must not return anything besides a function, which is used for clean-up.%s", p4, g3);
                }, u2, f);
              }
              o2 = o2.next;
            } while (o2 !== s);
          }
        } catch (p4) {
          we(n, n.return, p4);
        }
      }
      function Ta(e2, n, o2) {
        try {
          var i3 = n.updateQueue, s = i3 !== null ? i3.lastEffect : null;
          if (s !== null) {
            var u2 = s.next;
            i3 = u2;
            do {
              if ((i3.tag & e2) === e2) {
                var f = i3.inst, p4 = f.destroy;
                p4 !== void 0 && (f.destroy = void 0, (e2 & Xt) !== Vh && (xf = true), s = n, B(s, D1, s, o2, p4), (e2 & Xt) !== Vh && (xf = false));
              }
              i3 = i3.next;
            } while (i3 !== u2);
          }
        } catch (g3) {
          we(n, n.return, g3);
        }
      }
      function Cm(e2, n) {
        Vt(e2) ? (Dr(), Ll(n, e2), Fr()) : Ll(n, e2);
      }
      function hd(e2, n, o2) {
        Vt(e2) ? (Dr(), Ta(o2, e2, n), Fr()) : Ta(o2, e2, n);
      }
      function Tp(e2) {
        var n = e2.updateQueue;
        if (n !== null) {
          var o2 = e2.stateNode;
          e2.type.defaultProps || "ref" in e2.memoizedProps || bf || (o2.props !== e2.memoizedProps && console.error("Expected %s props to match memoized props before processing the update queue. This might either be because of a bug in React, or because a component reassigns its own `this.props`. Please file an issue.", G(e2) || "instance"), o2.state !== e2.memoizedState && console.error("Expected %s state to match memoized state before processing the update queue. This might either be because of a bug in React, or because a component reassigns its own `this.state`. Please file an issue.", G(e2) || "instance"));
          try {
            B(e2, rp, n, o2);
          } catch (i3) {
            we(e2, e2.return, i3);
          }
        }
      }
      function zm(e2, n, o2) {
        return e2.getSnapshotBeforeUpdate(n, o2);
      }
      function Em(e2, n) {
        var o2 = n.memoizedProps, i3 = n.memoizedState;
        n = e2.stateNode, e2.type.defaultProps || "ref" in e2.memoizedProps || bf || (n.props !== e2.memoizedProps && console.error("Expected %s props to match memoized props before getSnapshotBeforeUpdate. This might either be because of a bug in React, or because a component reassigns its own `this.props`. Please file an issue.", G(e2) || "instance"), n.state !== e2.memoizedState && console.error("Expected %s state to match memoized state before getSnapshotBeforeUpdate. This might either be because of a bug in React, or because a component reassigns its own `this.state`. Please file an issue.", G(e2) || "instance"));
        try {
          var s = Ca(e2.type, o2), u2 = B(e2, zm, n, s, i3);
          o2 = Gy, u2 !== void 0 || o2.has(e2.type) || (o2.add(e2.type), B(e2, function() {
            console.error("%s.getSnapshotBeforeUpdate(): A snapshot value (or null) must be returned. You have returned undefined.", G(e2));
          })), n.__reactInternalSnapshotBeforeUpdate = u2;
        } catch (f) {
          we(e2, e2.return, f);
        }
      }
      function Ip(e2, n, o2) {
        o2.props = Ca(e2.type, e2.memoizedProps), o2.state = e2.memoizedState, Vt(e2) ? (Dr(), B(e2, fy, e2, n, o2), Fr()) : B(e2, fy, e2, n, o2);
      }
      function Rp(e2) {
        var n = e2.ref;
        if (n !== null) {
          switch (e2.tag) {
            case 26:
            case 27:
            case 5:
              var o2 = Ql(e2.stateNode);
              break;
            case 30:
              o2 = e2.stateNode;
              var i3 = Mn(e2.memoizedProps, o2);
              (o2.ref === null || o2.ref.name !== i3) && (o2.ref = Bu(i3)), o2 = o2.ref;
              break;
            case 7:
              e2.stateNode === null && (e2.stateNode = _g(e2)), o2 = e2.stateNode;
              break;
            default:
              o2 = e2.stateNode;
          }
          if (typeof n == "function") {
            if (Vt(e2)) try {
              Dr(), e2.refCleanup = n(o2);
            } finally {
              Fr();
            }
            else e2.refCleanup = n(o2);
          } else typeof n == "string" ? console.error("String refs are no longer supported.") : n.hasOwnProperty("current") || console.error("Unexpected ref object provided for %s. Use either a ref-setter function or React.createRef().", G(e2)), n.current = o2;
        }
      }
      function Y(e2, n) {
        try {
          B(e2, Rp, e2);
        } catch (o2) {
          we(e2, n, o2);
        }
      }
      function $n(e2, n) {
        var o2 = e2.ref, i3 = e2.refCleanup;
        if (o2 !== null) if (typeof i3 == "function") try {
          if (Vt(e2)) try {
            Dr(), B(e2, i3);
          } finally {
            Fr(e2);
          }
          else B(e2, i3);
        } catch (s) {
          we(e2, n, s);
        } finally {
          e2.refCleanup = null, e2 = e2.alternate, e2 != null && (e2.refCleanup = null);
        }
        else if (typeof o2 == "function") try {
          if (Vt(e2)) try {
            Dr(), B(e2, o2, null);
          } finally {
            Fr(e2);
          }
          else B(e2, o2, null);
        } catch (s) {
          we(e2, n, s);
        }
        else o2.current = null;
      }
      function Et(e2, n, o2, i3) {
        var s = e2.memoizedProps, u2 = s.id, f = s.onCommit;
        s = s.onRender, n = n === null ? "mount" : "update", Og && (n = "nested-update"), typeof s == "function" && s(u2, n, e2.actualDuration, e2.treeBaseDuration, e2.actualStartTime, o2), typeof f == "function" && f(u2, n, i3, o2);
      }
      function Lp(e2, n, o2, i3) {
        var s = e2.memoizedProps;
        e2 = s.id, s = s.onPostCommit, n = n === null ? "mount" : "update", Og && (n = "nested-update"), typeof s == "function" && s(e2, n, i3, o2);
      }
      function _m() {
        var e2 = jt;
        return jt = false, e2;
      }
      function Ia(e2, n) {
        if ((e2.tag === 5 || e2.tag === 27 || e2.tag === 6) && e2.alternate === null && n !== null) for (var o2 = 0; o2 < n.length; o2++) Md(e2.stateNode, n[o2]);
      }
      function Si(e2) {
        for (var n = e2.return; n !== null && (Pu(n) && Md(e2.stateNode, n.stateNode), !md(n)); ) n = n.return;
      }
      function wo(e2) {
        for (var n = e2.return; n !== null && (Pu(n) && vh(e2.stateNode, n.stateNode), !md(n)); ) n = n.return;
      }
      function md(e2) {
        return e2.tag === 5 || e2.tag === 3 || (je ? e2.tag === 27 : false);
      }
      function Pu(e2) {
        return e2 && e2.tag === 7 && e2.stateNode !== null;
      }
      function gd(e2) {
        var n = e2.type, o2 = e2.memoizedProps, i3 = e2.stateNode;
        try {
          B(e2, Au, i3, n, o2, e2);
        } catch (s) {
          we(e2, e2.return, s);
        }
      }
      function Vr(e2, n, o2) {
        try {
          B(e2, Li, e2.stateNode, e2.type, o2, n, e2);
        } catch (i3) {
          we(e2, e2.return, i3);
        }
      }
      function bd(e2) {
        return e2.tag === 5 || e2.tag === 3 || (Ze ? e2.tag === 26 : false) || (je ? e2.tag === 27 && t2(e2.type) : false) || e2.tag === 4;
      }
      function xu(e2) {
        e: for (; ; ) {
          for (; e2.sibling === null; ) {
            if (e2.return === null || bd(e2.return)) return null;
            e2 = e2.return;
          }
          for (e2.sibling.return = e2.return, e2 = e2.sibling; e2.tag !== 5 && e2.tag !== 6 && e2.tag !== 18; ) {
            if (je && e2.tag === 27 && t2(e2.type) || e2.flags & 2 || e2.child === null || e2.tag === 4) continue e;
            e2.child.return = e2, e2 = e2.child;
          }
          if (!(e2.flags & 2)) return e2.stateNode;
        }
      }
      function Cu(e2, n, o2, i3) {
        var s = e2.tag;
        if (s === 5 || s === 6) s = e2.stateNode, n ? mr(o2, s, n) : Ri(o2, s), Ia(e2, i3), jt = true;
        else if (s !== 4 && (je && s === 27 && (Ia(e2, i3), i3 = null, t2(e2.type) && (o2 = e2.stateNode, n = null)), e2 = e2.child, e2 !== null)) for (Cu(e2, n, o2, i3), e2 = e2.sibling; e2 !== null; ) Cu(e2, n, o2, i3), e2 = e2.sibling;
      }
      function Fl(e2, n, o2, i3) {
        var s = e2.tag;
        if (s === 5 || s === 6) s = e2.stateNode, n ? zg(o2, s, n) : Ad(o2, s), Ia(e2, i3), jt = true;
        else if (s !== 4 && (je && s === 27 && (Ia(e2, i3), i3 = null, t2(e2.type) && (o2 = e2.stateNode)), e2 = e2.child, e2 !== null)) for (Fl(e2, n, o2, i3), e2 = e2.sibling; e2 !== null; ) Fl(e2, n, o2, i3), e2 = e2.sibling;
      }
      function Ra(e2) {
        for (var n, o2 = e2.return; o2 !== null; ) {
          if (bd(o2)) {
            n = o2;
            break;
          }
          o2 = o2.return;
        }
        o2 = null;
        for (var i3 = e2.return; i3 !== null; ) {
          if (Pu(i3)) {
            var s = i3.stateNode;
            o2 === null ? o2 = [s] : o2.push(s);
          }
          if (md(i3)) break;
          i3 = i3.return;
        }
        if (_e) {
          if (n == null) throw Error("Expected to find a host parent. This error is likely caused by a bug in React. Please file an issue.");
          switch (n.tag) {
            case 27:
              if (je) {
                n = n.stateNode, i3 = xu(e2), Fl(e2, i3, n, o2);
                break;
              }
            case 5:
              i3 = n.stateNode, n.flags & 32 && (na(i3), n.flags &= -33), n = xu(e2), Fl(e2, n, i3, o2);
              break;
            case 3:
            case 4:
              n = n.stateNode.containerInfo, i3 = xu(e2), Cu(e2, i3, n, o2);
              break;
            default:
              throw Error("Invalid host parent fiber. This error is likely caused by a bug in React. Please file an issue.");
          }
        } else zu(e2, o2);
      }
      function zu(e2, n) {
        if (e2.tag === 5 || je && e2.tag === 27) Ia(e2, n);
        else if (e2.tag !== 4 && (e2 = e2.child, e2 !== null)) for (zu(e2, n), e2 = e2.sibling; e2 !== null; ) zu(e2, n), e2 = e2.sibling;
      }
      function Nm(e2, n, o2) {
        e2 = e2.containerInfo;
        try {
          B(n, Rt, e2, o2);
        } catch (i3) {
          we(n, n.return, i3);
        }
      }
      function Tm(e2) {
        var n = e2.stateNode, o2 = e2.memoizedProps;
        try {
          B(e2, ts, e2.type, o2, n, e2);
        } catch (i3) {
          we(e2, e2.return, i3);
        }
      }
      function yd(e2) {
        (e2.tag === 30 || (e2.subtreeFlags & 33554432) !== 0) && (Yg = true);
      }
      function Im() {
        var e2 = Xa;
        return Xa = null, e2;
      }
      function ki(e2, n, o2, i3, s) {
        return yr = 0, (n = Fp(e2.child, n, o2, i3, s)) && e2._debugTask != null && br === null && (br = e2._debugTask), n;
      }
      function Fp(e2, n, o2, i3, s) {
        if (!_e) return false;
        for (var u2 = false; e2 !== null; ) {
          if (e2.tag === 5) {
            var f = e2.stateNode;
            if (i3 !== null) {
              var p4 = un(f);
              i3.push(p4), ra(p4) && (u2 = true);
            } else u2 || ra(un(f)) && (u2 = true);
            Yg = true, lt(f, yr === 0 ? n : n + "_" + yr, o2), yr++;
          } else (e2.tag !== 22 || e2.memoizedState === null) && (e2.tag === 30 && s || Fp(e2.child, n, o2, i3, s) && (u2 = true));
          e2 = e2.sibling;
        }
        return u2;
      }
      function Po(e2, n) {
        if (_e) for (; e2 !== null; ) e2.tag === 5 ? Xn(e2.stateNode, e2.memoizedProps) : (e2.tag !== 22 || e2.memoizedState === null) && (e2.tag === 30 && n || Po(e2.child, n)), e2 = e2.sibling;
      }
      function wi(e2) {
        if ((e2.subtreeFlags & 18874368) !== 0) for (e2 = e2.child; e2 !== null; ) {
          if ((e2.tag !== 22 || e2.memoizedState === null) && (wi(e2), e2.tag === 30 && (e2.flags & 18874368) !== 0 && e2.stateNode.paired)) {
            var n = e2.memoizedProps;
            if (n.name == null || n.name === "auto") throw Error("Found a pair with an auto name. This is a bug in React.");
            var o2 = n.name;
            n = er(n.default, n.share), n !== "none" && (ki(e2, o2, n, null, false) || Po(e2.child, false));
          }
          e2 = e2.sibling;
        }
      }
      function Q(e2, n) {
        if (e2.tag === 30) {
          var o2 = e2.stateNode, i3 = e2.memoizedProps, s = Mn(i3, o2), u2 = er(i3.default, o2.paired ? i3.share : i3.enter);
          u2 !== "none" ? ki(e2, s, u2, null, false) ? (wi(e2), o2.paired || n || Al(e2, i3.onEnter)) : Po(e2.child, false) : wi(e2);
        } else if ((e2.subtreeFlags & 33554432) !== 0) for (e2 = e2.child; e2 !== null; ) Q(e2, n), e2 = e2.sibling;
        else wi(e2);
      }
      function Dp(e2) {
        if (no !== null && no.size !== 0) {
          var n = no;
          if ((e2.subtreeFlags & 18874368) !== 0) for (e2 = e2.child; e2 !== null; ) {
            if (e2.tag !== 22 || e2.memoizedState === null) {
              if (e2.tag === 30 && (e2.flags & 18874368) !== 0) {
                var o2 = e2.memoizedProps, i3 = o2.name;
                if (i3 != null && i3 !== "auto") {
                  var s = n.get(i3);
                  if (s !== void 0) {
                    var u2 = er(o2.default, o2.share);
                    if (u2 !== "none" && (ki(e2, i3, u2, null, false) ? (u2 = e2.stateNode, s.paired = u2, u2.paired = s, Al(e2, o2.onShare)) : Po(e2.child, false)), n.delete(i3), n.size === 0) break;
                  }
                }
              }
              Dp(e2);
            }
            e2 = e2.sibling;
          }
        }
      }
      function jp(e2) {
        if (e2.tag === 30) {
          var n = e2.memoizedProps, o2 = Mn(n, e2.stateNode), i3 = no !== null ? no.get(o2) : void 0, s = er(n.default, i3 !== void 0 ? n.share : n.exit);
          s !== "none" && (ki(e2, o2, s, null, false) ? i3 !== void 0 ? (s = e2.stateNode, i3.paired = s, s.paired = i3, no.delete(o2), Al(e2, n.onShare)) : Al(e2, n.onExit) : Po(e2.child, false)), no !== null && Dp(e2);
        } else if ((e2.subtreeFlags & 33554432) !== 0) for (e2 = e2.child; e2 !== null; ) jp(e2), e2 = e2.sibling;
        else no !== null && Dp(e2);
      }
      function Up(e2) {
        for (e2 = e2.child; e2 !== null; ) {
          if (e2.tag === 30) {
            var n = e2.memoizedProps, o2 = Mn(n, e2.stateNode);
            n = er(n.default, n.update), e2.flags &= -5, n !== "none" && ki(e2, o2, n, e2.memoizedState = [], false);
          } else (e2.subtreeFlags & 33554432) !== 0 && Up(e2);
          e2 = e2.sibling;
        }
      }
      function Pi(e2) {
        if ((e2.subtreeFlags & 18874368) !== 0) for (e2 = e2.child; e2 !== null; ) {
          if (e2.tag !== 22 || e2.memoizedState === null) {
            if (e2.tag === 30 && (e2.flags & 18874368) !== 0) {
              var n = e2.stateNode;
              n.paired !== null && (n.paired = null, Po(e2.child, false));
            }
            Pi(e2);
          }
          e2 = e2.sibling;
        }
      }
      function vd(e2) {
        if (e2.tag === 30) e2.stateNode.paired = null, Po(e2.child, false), Pi(e2);
        else if ((e2.subtreeFlags & 33554432) !== 0) for (e2 = e2.child; e2 !== null; ) vd(e2), e2 = e2.sibling;
        else Pi(e2);
      }
      function Rm(e2) {
        for (e2 = e2.child; e2 !== null; ) e2.tag === 30 ? Po(e2.child, false) : (e2.subtreeFlags & 33554432) !== 0 && Rm(e2), e2 = e2.sibling;
      }
      function Wp(e2, n, o2, i3, s, u2, f) {
        if (!_e) return false;
        for (var p4 = false; n !== null; ) {
          if (n.tag === 5) {
            var g3 = n.stateNode;
            if (u2 !== null && yr < u2.length) {
              var b2 = u2[yr], k2 = un(g3);
              (ra(b2) || ra(k2)) && (p4 = true), (e2.flags & 4) === 0 && Fi(b2, k2) && (e2.flags |= 4), Hd(b2, k2) && (e2.flags |= 32);
            } else e2.flags |= 32;
            (e2.flags & 4) !== 0 && lt(g3, yr === 0 ? o2 : o2 + "_" + yr, s), p4 && (e2.flags & 4) !== 0 || (Xa === null && (Xa = []), Xa.push(g3, yr === 0 ? i3 : i3 + "_" + yr, n.memoizedProps)), yr++;
          } else (n.tag !== 22 || n.memoizedState === null) && (n.tag === 30 && f ? e2.flags |= n.flags & 32 : Wp(e2, n.child, o2, i3, s, u2, f) && (p4 = true));
          n = n.sibling;
        }
        return p4;
      }
      function Lm(e2, n) {
        for (e2 = e2.child; e2 !== null; ) {
          if (e2.tag === 30) {
            var o2 = e2.memoizedProps, i3 = e2.stateNode, s = Mn(o2, i3), u2 = er(o2.default, o2.update);
            if (n) {
              i3 = i3.clones;
              var f = i3 === null ? null : i3.map(Bd);
            } else f = e2.memoizedState, e2.memoizedState = null;
            i3 = e2;
            var p4 = e2.child, g3 = s;
            yr = 0, u2 = Wp(i3, p4, g3, s, u2, f, false), (e2.flags & 4) !== 0 && u2 && (n || Al(e2, o2.onUpdate));
          } else (e2.subtreeFlags & 33554432) !== 0 && Lm(e2, n);
          e2 = e2.sibling;
        }
      }
      function Fm(e2) {
        var n = e2.memoizedProps.name;
        if (n != null && n !== "auto") {
          var o2 = Kg.get(n);
          if (o2 !== void 0) {
            if (o2 !== e2 && o2 !== e2.alternate && !Jy[n]) {
              Jy[n] = true;
              var i3 = JSON.stringify(n);
              B(e2, function() {
                console.error("There are two <ViewTransition name=%s> components with the same name mounted at the same time. This is not supported and will cause View Transitions to error. Try to use a more unique name e.g. by using a namespace prefix and adding the id of an item to the name.", i3);
              }), B(o2, function() {
                console.error("The existing <ViewTransition name=%s> duplicate has this stack trace.", i3);
              });
            }
          } else Kg.set(n, e2);
        }
      }
      function Sd(e2) {
        var n = e2.memoizedProps.name;
        if (n != null && n !== "auto") {
          var o2 = Kg.get(n);
          o2 === void 0 || o2 !== e2 && o2 !== e2.alternate || Kg.delete(n);
        }
      }
      function Ap(e2, n) {
        return n.tag === 31 ? (n = n.memoizedState, e2.memoizedState !== null && n === null) : n.tag === 13 ? (e2 = e2.memoizedState, n = n.memoizedState, e2 !== null && e2.dehydrated !== null && (n === null || n.dehydrated === null)) : n.tag === 3 ? e2.memoizedState.isDehydrated && (n.flags & 256) === 0 : false;
      }
      function kd(e2, n, o2) {
        for (W0(e2.containerInfo), e2 = (o2 & 335544064) === o2, dt = n, n = e2 ? 9270 : 1024; dt !== null; ) {
          if (o2 = dt, e2) {
            var i3 = o2.deletions;
            if (i3 !== null) for (var s = 0; s < i3.length; s++) e2 && jp(i3[s]);
          }
          if (o2.alternate === null && (o2.flags & 2) !== 0) e2 && yd(o2), Eu(e2);
          else {
            if (o2.tag === 22) {
              if (i3 = o2.alternate, o2.memoizedState !== null) {
                i3 !== null && i3.memoizedState === null && e2 && jp(i3), Eu(e2);
                continue;
              } else if (i3 !== null && i3.memoizedState !== null) {
                e2 && yd(o2), Eu(e2);
                continue;
              }
            }
            i3 = o2.child, (o2.subtreeFlags & n) !== 0 && i3 !== null ? (i3.return = o2, dt = i3) : (e2 && Up(o2), Eu(e2));
          }
        }
        no = null;
      }
      function Eu(e2) {
        for (; dt !== null; ) {
          var n = dt, o2 = n, i3 = e2, s = o2.alternate, u2 = o2.flags;
          switch (o2.tag) {
            case 0:
            case 11:
            case 15:
              break;
            case 1:
              (u2 & 1024) !== 0 && s !== null && Em(o2, s);
              break;
            case 3:
              (u2 & 1024) !== 0 && _e && Eg(o2.stateNode.containerInfo);
              break;
            case 5:
            case 26:
            case 27:
            case 6:
            case 4:
            case 17:
              break;
            case 30:
              i3 && s !== null && (i3 = s, s = o2, o2 = Mn(i3.memoizedProps, i3.stateNode), s = s.memoizedProps, s = er(s.default, s.update), s !== "none" && ki(i3, o2, s, i3.memoizedState = [], true));
              break;
            default:
              if ((u2 & 1024) !== 0) throw Error("This unit of work tag should not have side-effects. This error is likely caused by a bug in React. Please file an issue.");
          }
          if (i3 = n.sibling, i3 !== null) {
            i3.return = n.return, dt = i3;
            break;
          }
          dt = n.return;
        }
      }
      function Dm(e2, n, o2) {
        var i3 = Pt(), s = Ir(), u2 = Rr(), f = Lr(), p4 = o2.flags;
        switch (o2.tag) {
          case 0:
          case 11:
          case 15:
            ur(e2, o2), p4 & 4 && Na(o2, eo | Ro);
            break;
          case 1:
            if (ur(e2, o2), p4 & 4) if (e2 = o2.stateNode, n === null) o2.type.defaultProps || "ref" in o2.memoizedProps || bf || (e2.props !== o2.memoizedProps && console.error("Expected %s props to match memoized props before componentDidMount. This might either be because of a bug in React, or because a component reassigns its own `this.props`. Please file an issue.", G(o2) || "instance"), e2.state !== o2.memoizedState && console.error("Expected %s state to match memoized state before componentDidMount. This might either be because of a bug in React, or because a component reassigns its own `this.state`. Please file an issue.", G(o2) || "instance")), Vt(o2) ? (Dr(), B(o2, ub, o2, e2), Fr()) : B(o2, ub, o2, e2);
            else {
              var g3 = Ca(o2.type, n.memoizedProps);
              n = n.memoizedState, o2.type.defaultProps || "ref" in o2.memoizedProps || bf || (e2.props !== o2.memoizedProps && console.error("Expected %s props to match memoized props before componentDidUpdate. This might either be because of a bug in React, or because a component reassigns its own `this.props`. Please file an issue.", G(o2) || "instance"), e2.state !== o2.memoizedState && console.error("Expected %s state to match memoized state before componentDidUpdate. This might either be because of a bug in React, or because a component reassigns its own `this.state`. Please file an issue.", G(o2) || "instance")), Vt(o2) ? (Dr(), B(o2, uy, o2, e2, g3, n, e2.__reactInternalSnapshotBeforeUpdate), Fr()) : B(o2, uy, o2, e2, g3, n, e2.__reactInternalSnapshotBeforeUpdate);
            }
            p4 & 64 && Tp(o2), p4 & 512 && Y(o2, o2.return);
            break;
          case 3:
            if (n = mo(), ur(e2, o2), p4 & 64 && (p4 = o2.updateQueue, p4 !== null)) {
              if (g3 = null, o2.child !== null) switch (o2.child.tag) {
                case 27:
                case 5:
                  g3 = Ql(o2.child.stateNode);
                  break;
                case 1:
                  g3 = o2.child.stateNode;
              }
              try {
                B(o2, rp, p4, g3);
              } catch (k2) {
                we(o2, o2.return, k2);
              }
            }
            e2.effectDuration += Us(n);
            break;
          case 27:
            je && n === null && p4 & 4 && Tm(o2);
          case 26:
          case 5:
            if (ur(e2, o2), n === null) {
              if (p4 & 4) gd(o2);
              else if (p4 & 64) {
                e2 = o2.type, n = o2.memoizedProps, g3 = o2.stateNode;
                try {
                  B(o2, Be, g3, e2, n, o2);
                } catch (k2) {
                  we(o2, o2.return, k2);
                }
              }
            }
            p4 & 512 && Y(o2, o2.return);
            break;
          case 12:
            if (p4 & 4) {
              p4 = mo(), ur(e2, o2), e2 = o2.stateNode, e2.effectDuration += hl(p4);
              try {
                B(o2, Et, o2, n, Hi, e2.effectDuration);
              } catch (k2) {
                we(o2, o2.return, k2);
              }
            } else ur(e2, o2);
            break;
          case 31:
            ur(e2, o2), p4 & 4 && jm(e2, o2);
            break;
          case 13:
            ur(e2, o2), p4 & 4 && Um(e2, o2), p4 & 64 && (e2 = o2.memoizedState, e2 !== null && (e2 = e2.dehydrated, e2 !== null && (p4 = _0.bind(null, o2), Sh(e2, p4))));
            break;
          case 22:
            if (p4 = o2.memoizedState !== null || ct, !p4) {
              var b2 = n !== null && n.memoizedState !== null || We;
              n = ct, g3 = We, ct = p4, (We = b2) && !g3 ? (p4 = je ? e0 : ac, (o2.subtreeFlags & 8772) !== 0 && (p4 |= Cb), cr(e2, o2, p4), (o2.mode & 2) !== Z && 0 <= V && 0 <= J && 0.05 < J - V && so(o2, V, J)) : ur(e2, o2), ct = n, We = g3;
            }
            break;
          case 30:
            p4 & 18874368 && Fm(o2), ur(e2, o2), p4 & 512 && Y(o2, o2.return);
            break;
          case 7:
            p4 & 512 && Y(o2, o2.return);
          default:
            ur(e2, o2);
        }
        (o2.mode & 2) !== Z && 0 <= V && 0 <= J && ((Sn || 0.05 < dn) && Me(o2, V, J, dn, on), o2.alternate === null && o2.return !== null && o2.return.alternate !== null && 0.05 < J - V && (Ap(o2.return.alternate, o2.return) || nr(o2, V, J, "Mount"))), gt(i3), go(s), on = u2, Sn = f;
      }
      function Op(e2, n) {
        if (_e) for (e2 = e2.child; e2 !== null; ) La(e2, n), e2 = e2.sibling;
      }
      function La(e2, n) {
        if (_e) switch (e2.tag) {
          case 5:
          case 26:
            try {
              var o2 = e2.stateNode;
              n ? B(e2, yh, o2) : B(e2, Od, e2.stateNode, e2.memoizedProps);
            } catch (u2) {
              we(e2, e2.return, u2);
            }
            lr(e2, n);
            break;
          case 6:
            try {
              var i3 = e2.stateNode;
              n ? B(e2, Ba, i3) : B(e2, Zn, i3, e2.memoizedProps), jt = true;
            } catch (u2) {
              we(e2, e2.return, u2);
            }
            break;
          case 18:
            try {
              var s = e2.stateNode;
              n ? B(e2, oa, s) : B(e2, cn, e2.stateNode);
            } catch (u2) {
              we(e2, e2.return, u2);
            }
            break;
          case 22:
          case 23:
            e2.memoizedState === null && Op(e2, n);
            break;
          default:
            Op(e2, n);
        }
      }
      function lr(e2, n) {
        if (_e && e2.subtreeFlags & 67108864) for (e2 = e2.child; e2 !== null; ) {
          var o2 = e2, i3 = n;
          if (_e) switch (o2.tag) {
            case 4:
              La(o2, i3);
              break;
            case 22:
              o2.memoizedState === null && lr(o2, i3);
              break;
            default:
              lr(o2, i3);
          }
          e2 = e2.sibling;
        }
      }
      function Ye(e2) {
        var n = e2.alternate;
        n !== null && (e2.alternate = null, Ye(n)), e2.child = null, e2.deletions = null, e2.sibling = null, e2.tag === 5 && (n = e2.stateNode, n !== null && hh(n)), e2.stateNode = null, e2._debugOwner = null, e2.return = null, e2.dependencies = null, e2.memoizedProps = null, e2.memoizedState = null, e2.pendingProps = null, e2.stateNode = null, e2.updateQueue = null;
      }
      function ln(e2, n, o2) {
        for (o2 = o2.child; o2 !== null; ) En(e2, n, o2), o2 = o2.sibling;
      }
      function En(e2, n, o2) {
        if (M3 && typeof M3.onCommitFiberUnmount == "function") try {
          M3.onCommitFiberUnmount(Ue, o2);
        } catch (b2) {
          ie || (ie = true, console.error("React instrumentation encountered an error: %o", b2));
        }
        var i3 = Pt(), s = Ir(), u2 = Rr(), f = Lr();
        switch (o2.tag) {
          case 26:
            if (Ze) {
              We || $n(o2, n), ln(e2, n, o2), o2.memoizedState ? $u(o2.memoizedState) : o2.stateNode && (We || qt(o2.stateNode));
              break;
            }
          case 27:
            if (je) {
              We || $n(o2, n), wo(o2);
              var p4 = Bn, g3 = vr;
              t2(o2.type) && (Bn = o2.stateNode, vr = false), ln(e2, n, o2), B(o2, rs, o2.stateNode, o2.type, o2.memoizedProps), Bn = p4, vr = g3;
              break;
            }
          case 5:
            We || $n(o2, n), wo(o2);
          case 6:
            if (o2.tag === 6 && wo(o2), _e) {
              if (p4 = Bn, g3 = vr, Bn = null, ln(e2, n, o2), Bn = p4, vr = g3, Bn !== null) if (vr) try {
                B(o2, bh, Bn, o2.stateNode), jt = true;
              } catch (b2) {
                we(o2, n, b2);
              }
              else try {
                B(o2, Xl, Bn, o2.stateNode), jt = true;
              } catch (b2) {
                we(o2, n, b2);
              }
            } else ln(e2, n, o2);
            break;
          case 18:
            _e && Bn !== null && (vr ? wh(Bn, o2.stateNode) : Kl(Bn, o2.stateNode));
            break;
          case 4:
            _e ? (p4 = Bn, g3 = vr, Bn = o2.stateNode.containerInfo, vr = true, ln(e2, n, o2), Bn = p4, vr = g3) : (_n && Nm(o2.stateNode, o2, Vd()), ln(e2, n, o2));
            break;
          case 0:
          case 11:
          case 14:
          case 15:
            Ta(Xt, o2, n), We || wu(o2, n, eo), ln(e2, n, o2);
            break;
          case 1:
            We || ($n(o2, n), p4 = o2.stateNode, typeof p4.componentWillUnmount == "function" && Ip(o2, n, p4)), ln(e2, n, o2);
            break;
          case 21:
            ln(e2, n, o2);
            break;
          case 22:
            We = (p4 = We) || o2.memoizedState !== null, ln(e2, n, o2), We = p4;
            break;
          case 30:
            o2.flags & 18874368 && Sd(o2), $n(o2, n), ln(e2, n, o2);
            break;
          case 7:
            We || $n(o2, n), ln(e2, n, o2);
            break;
          default:
            ln(e2, n, o2);
        }
        (o2.mode & 2) !== Z && 0 <= V && 0 <= J && (Sn || 0.05 < dn) && Me(o2, V, J, dn, on), gt(i3), go(s), on = u2, Sn = f;
      }
      function jm(e2, n) {
        if ($e && n.memoizedState === null && (e2 = n.alternate, e2 !== null && (e2 = e2.memoizedState, e2 !== null))) {
          e2 = e2.dehydrated;
          try {
            B(n, ye, e2);
          } catch (o2) {
            we(n, n.return, o2);
          }
        }
      }
      function Um(e2, n) {
        if ($e && n.memoizedState === null && (e2 = n.alternate, e2 !== null && (e2 = e2.memoizedState, e2 !== null && (e2 = e2.dehydrated, e2 !== null)))) try {
          B(n, Ie, e2);
        } catch (o2) {
          we(n, n.return, o2);
        }
      }
      function jn(e2) {
        switch (e2.tag) {
          case 31:
          case 13:
          case 19:
            var n = e2.stateNode;
            return n === null && (n = e2.stateNode = new Zy()), n;
          case 22:
            return e2 = e2.stateNode, n = e2._retryCache, n === null && (n = e2._retryCache = new Zy()), n;
          default:
            throw Error("Unexpected Suspense handler tag (" + e2.tag + "). This is a bug in React.");
        }
      }
      function sr(e2, n) {
        var o2 = jn(e2);
        n.forEach(function(i3) {
          if (!o2.has(i3)) {
            if (o2.add(i3), Le) if (yf !== null && vf !== null) Ru(vf, yf);
            else throw Error("Expected finished root and lanes to be set. This is a bug in React.");
            var s = N0.bind(null, e2, i3);
            i3.then(s, s);
          }
        });
      }
      function Qn(e2, n, o2) {
        var i3 = n.deletions;
        if (i3 !== null) for (var s = 0; s < i3.length; s++) {
          var u2 = e2, f = n, p4 = i3[s], g3 = Pt();
          if (_e) {
            var b2 = f;
            e: for (; b2 !== null; ) {
              switch (b2.tag) {
                case 27:
                  if (je) {
                    if (t2(b2.type)) {
                      Bn = b2.stateNode, vr = false;
                      break e;
                    }
                    break;
                  }
                case 5:
                  Bn = b2.stateNode, vr = false;
                  break e;
                case 3:
                case 4:
                  Bn = b2.stateNode.containerInfo, vr = true;
                  break e;
              }
              b2 = b2.return;
            }
            if (Bn === null) throw Error("Expected to find a host parent. This error is likely caused by a bug in React. Please file an issue.");
            En(u2, f, p4), Bn = null, vr = false;
          } else En(u2, f, p4);
          (p4.mode & 2) !== Z && 0 <= V && 0 <= J && 0.05 < J - V && nr(p4, V, J, "Unmount"), gt(g3), u2 = p4, f = u2.alternate, f !== null && (f.return = null), u2.return = null;
        }
        if (n.subtreeFlags & 13886) for (n = n.child; n !== null; ) Wm(n, e2, o2), n = n.sibling;
      }
      function Wm(e2, n, o2) {
        var i3 = Pt(), s = Ir(), u2 = Rr(), f = Lr(), p4 = e2.alternate, g3 = e2.flags;
        switch (e2.tag) {
          case 0:
          case 11:
          case 14:
          case 15:
            if (g3 & 4 && (p4 = e2.updateQueue, p4 = p4 !== null ? p4.events : null, p4 !== null)) for (var b2 = 0; b2 < p4.length; b2++) {
              var k2 = p4[b2];
              k2.ref.impl = k2.nextImpl;
            }
            Qn(n, e2, o2), it(e2), g3 & 4 && (Ta(Xt | Ro, e2, e2.return), Ll(Xt | Ro, e2), wu(e2, e2.return, eo | Ro));
            break;
          case 1:
            Qn(n, e2, o2), it(e2), g3 & 512 && (We || p4 === null || $n(p4, p4.return)), g3 & 64 && ct && (n = e2.updateQueue, n !== null && (g3 = n.callbacks, g3 !== null && (o2 = n.shared.hiddenCallbacks, n.shared.hiddenCallbacks = o2 === null ? g3 : o2.concat(g3))));
            break;
          case 26:
            if (Ze) {
              b2 = fa, Qn(n, e2, o2), it(e2), g3 & 512 && (We || p4 === null || $n(p4, p4.return)), g3 & 4 && (o2 = p4 !== null ? p4.memoizedState : null, g3 = e2.memoizedState, p4 === null ? g3 === null ? e2.stateNode === null ? e2.stateNode = ct ? $a(e2.type, e2.memoizedProps, n.containerInfo, e2) : Va(b2, e2.type, e2.memoizedProps, e2) : ct || Xe(b2, e2.type, e2.stateNode) : e2.stateNode = ns(b2, g3, e2.memoizedProps) : o2 !== g3 ? (o2 === null ? (n = p4.stateNode, n === null || We || qt(n)) : $u(o2), g3 === null ? ct || Xe(b2, e2.type, e2.stateNode) : ns(b2, g3, e2.memoizedProps)) : g3 === null && e2.stateNode !== null && Vr(e2, e2.memoizedProps, p4.memoizedProps));
              break;
            }
          case 27:
            if (je) {
              Qn(n, e2, o2), it(e2), g3 & 512 && (We || p4 === null || $n(p4, p4.return)), p4 !== null && g3 & 4 && Vr(e2, e2.memoizedProps, p4.memoizedProps);
              break;
            }
          case 5:
            if (b2 = Ya, Ya = false, Qn(n, e2, o2), Ya = b2, it(e2), g3 & 512 && (We || p4 === null || $n(p4, p4.return)), _e) {
              if (e2.flags & 32) {
                n = e2.stateNode;
                try {
                  B(e2, na, n), jt = true;
                } catch ($) {
                  we(e2, e2.return, $);
                }
              }
              g3 & 4 && e2.stateNode != null && (n = e2.memoizedProps, Vr(e2, n, p4 !== null ? p4.memoizedProps : n)), g3 & 1024 && (zb = true, e2.type !== "form" && console.error("Unexpected host component type. Expected a form. This is a bug in React."));
            } else _n && e2.alternate !== null && (e2.alternate.stateNode = e2.stateNode);
            break;
          case 6:
            if (Qn(n, e2, o2), it(e2), g3 & 4 && _e) {
              if (e2.stateNode === null) throw Error("This should have a text node initialized. This error is likely caused by a bug in React. Please file an issue.");
              n = e2.memoizedProps, g3 = p4 !== null ? p4.memoizedProps : n, o2 = e2.stateNode;
              try {
                B(e2, Zl, o2, g3, n), jt = true;
              } catch ($) {
                we(e2, e2.return, $);
              }
            }
            break;
          case 3:
            if (b2 = mo(), jt = false, Ze ? (zo(), k2 = fa, fa = ji(n.containerInfo), Qn(n, e2, o2), fa = k2) : Qn(n, e2, o2), it(e2), g3 & 4) {
              if (_e && $e && p4 !== null && p4.memoizedState.isDehydrated) try {
                B(e2, he, n.containerInfo);
              } catch ($) {
                we(e2, e2.return, $);
              }
              if (_n) {
                g3 = n.containerInfo, o2 = n.pendingChildren;
                try {
                  B(e2, Rt, g3, o2), jt = true;
                } catch ($) {
                  we(e2, e2.return, $);
                }
              }
            }
            zb && (zb = false, Am(e2)), n.effectDuration += Us(b2), jt = false;
            break;
          case 4:
            p4 = Ya, Ya = ct, b2 = _m(), Ze ? (k2 = fa, fa = ji(e2.stateNode.containerInfo), Qn(n, e2, o2), it(e2), fa = k2) : (Qn(n, e2, o2), it(e2)), jt && qh && (n0 = true), jt = b2, Ya = p4, g3 & 4 && _n && Nm(e2.stateNode, e2, e2.stateNode.pendingChildren);
            break;
          case 12:
            g3 = mo(), Qn(n, e2, o2), it(e2), e2.stateNode.effectDuration += hl(g3);
            break;
          case 31:
            Qn(n, e2, o2), it(e2), g3 & 4 && (n = e2.updateQueue, n !== null && (e2.updateQueue = null, sr(e2, n)));
            break;
          case 13:
            Qn(n, e2, o2), it(e2), e2.child.flags & 8192 && e2.memoizedState !== null != (p4 !== null && p4.memoizedState !== null) && (f0 = Re()), g3 & 4 && (n = e2.updateQueue, n !== null && (e2.updateQueue = null, sr(e2, n)));
            break;
          case 22:
            b2 = e2.memoizedState !== null, k2 = p4 !== null && p4.memoizedState !== null;
            var z = ct, T3 = We, H = Ya;
            ct = z || b2, Ya = H || b2, We = T3 || k2, Qn(n, e2, o2), We = T3, Ya = H, ct = z, k2 && !b2 && !z && !T3 && (e2.mode & 2) !== Z && 0 <= V && 0 <= J && 0.05 < J - V && so(e2, V, J), it(e2), g3 & 8192 && (n = e2.stateNode, n._visibility = b2 ? n._visibility & ~Hh : n._visibility | Hh, !b2 || p4 === null || k2 || ct || We || (n = je ? e0 : ac, o2 = k2 || We, p4 = ct, k2 = We, ct = b2 || ct, We = o2, Xo(e2, n), (e2.mode & 2) !== Z && 0 <= V && 0 <= J && 0.05 < J - V && nr(e2, V, J, "Disconnect"), ct = p4, We = k2), _e && (b2 || !Ya) && Op(e2, b2)), g3 & 4 && (n = e2.updateQueue, n !== null && (g3 = n.retryQueue, g3 !== null && (n.retryQueue = null, sr(e2, g3))));
            break;
          case 19:
            Qn(n, e2, o2), it(e2), g3 & 4 && (n = e2.updateQueue, n !== null && (e2.updateQueue = null, sr(e2, n)));
            break;
          case 30:
            g3 & 512 && (We || p4 === null || $n(p4, p4.return)), g3 = _m(), b2 = qh, k2 = (o2 & 335544064) === o2, z = e2.memoizedProps, qh = k2 && er(z.default, z.update) !== "none", Qn(n, e2, o2), it(e2), k2 && p4 !== null && jt && (e2.flags |= 4), qh = b2, jt = g3;
            break;
          case 21:
            break;
          case 7:
            g3 & 512 && (We || p4 === null || $n(p4, p4.return)), p4 && p4.stateNode !== null && B0(e2, p4.stateNode);
          default:
            Qn(n, e2, o2), it(e2);
        }
        (e2.mode & 2) !== Z && 0 <= V && 0 <= J && ((Sn || 0.05 < dn) && Me(e2, V, J, dn, on), e2.alternate === null && e2.return !== null && e2.return.alternate !== null && 0.05 < J - V && (Ap(e2.return.alternate, e2.return) || nr(e2, V, J, "Mount"))), gt(i3), go(s), on = u2, Sn = f;
      }
      function it(e2) {
        var n = e2.flags;
        if (n & 2) {
          try {
            B(e2, Ra, e2);
          } catch (o2) {
            we(e2, e2.return, o2);
          }
          e2.flags &= -3;
        }
        n & 4096 && (e2.flags &= -4097);
      }
      function Am(e2) {
        if (e2.subtreeFlags & 1024) for (e2 = e2.child; e2 !== null; ) {
          var n = e2;
          Am(n), n.tag === 5 && n.flags & 1024 && Ud(n.stateNode), e2 = e2.sibling;
        }
      }
      function Dl(e2, n) {
        if (n.subtreeFlags & 9270) for (n = n.child; n !== null; ) wd(n, e2), n = n.sibling;
        else Lm(n, false);
      }
      function wd(e2, n) {
        var o2 = e2.alternate;
        if (o2 === null) Q(e2, false);
        else switch (e2.tag) {
          case 3:
            if (Eb = Ka = false, Im(), Dl(n, e2), !Ka && !n0) {
              if (e2 = Xa, e2 !== null) for (var i3 = 0; i3 < e2.length; i3 += 3) ta(e2[i3], e2[i3 + 1], e2[i3 + 2]);
              re(n.containerInfo), Eb = true;
            }
            Xa = null;
            break;
          case 5:
            Dl(n, e2);
            break;
          case 4:
            i3 = Ka, Ka = false, Dl(n, e2), Ka && (n0 = true), Ka = i3;
            break;
          case 22:
            e2.memoizedState === null && (o2.memoizedState !== null ? Q(e2, false) : Dl(n, e2));
            break;
          case 30:
            i3 = Ka;
            var s = Im();
            Ka = false, Dl(n, e2), Ka && (e2.flags |= 4);
            var u2 = e2.memoizedProps, f = e2.stateNode;
            n = Mn(u2, f), f = Mn(o2.memoizedProps, f);
            var p4 = er(u2.default, u2.update);
            p4 === "none" ? o2 = false : (u2 = o2.memoizedState, o2.memoizedState = null, o2 = e2.child, yr = 0, o2 = Wp(e2, o2, n, f, p4, u2, true), yr !== (u2 === null ? 0 : u2.length) && (e2.flags |= 32)), (e2.flags & 4) !== 0 && o2 ? (Al(e2, e2.memoizedProps.onUpdate), Xa = s) : s !== null && (s.push.apply(s, Xa), Xa = s), Ka = (e2.flags & 32) !== 0 ? true : i3;
            break;
          default:
            Dl(n, e2);
        }
      }
      function ur(e2, n) {
        if (n.subtreeFlags & 8772) for (n = n.child; n !== null; ) Dm(e2, n.alternate, n), n = n.sibling;
      }
      function Om(e2, n) {
        var o2 = Pt(), i3 = Ir(), s = Rr(), u2 = Lr();
        switch (e2.tag) {
          case 0:
          case 11:
          case 14:
          case 15:
            wu(e2, e2.return, eo), Xo(e2, n);
            break;
          case 1:
            $n(e2, e2.return);
            var f = e2.stateNode;
            typeof f.componentWillUnmount == "function" && Ip(e2, e2.return, f), Xo(e2, n);
            break;
          case 27:
            je && (n & e0) !== ac && B(e2, rs, e2.stateNode, e2.type, e2.memoizedProps);
          case 5:
            $n(e2, e2.return), e2.tag !== 5 && e2.tag !== 27 || wo(e2), Xo(e2, n);
            break;
          case 6:
            wo(e2);
            break;
          case 26:
            $n(e2, e2.return), Ze && (f = e2.stateNode, e2.memoizedState !== null || f === null || We || qt(f)), Xo(e2, n);
            break;
          case 22:
            e2.memoizedState === null && Xo(e2, n);
            break;
          case 30:
            e2.flags & 18874368 && Sd(e2), $n(e2, e2.return), Xo(e2, n);
            break;
          case 7:
            $n(e2, e2.return);
          default:
            Xo(e2, n);
        }
        (e2.mode & 2) !== Z && 0 <= V && 0 <= J && (Sn || 0.05 < dn) && Me(e2, V, J, dn, on), gt(o2), go(i3), on = s, Sn = u2;
      }
      function Xo(e2, n) {
        for (e2 = e2.child; e2 !== null; ) Om(e2, n), e2 = e2.sibling;
      }
      function Bm(e2, n, o2, i3) {
        var s = Pt(), u2 = Ir(), f = Rr(), p4 = Lr(), g3 = o2.flags, b2 = (i3 & Cb) !== ac;
        switch (o2.tag) {
          case 0:
          case 11:
          case 15:
            cr(e2, o2, i3), Na(o2, eo);
            break;
          case 1:
            if (cr(e2, o2, i3), n = o2.stateNode, typeof n.componentDidMount == "function" && B(o2, ub, o2, n), n = o2.updateQueue, n !== null) {
              e2 = o2.stateNode;
              try {
                B(o2, tp, n, e2);
              } catch (z) {
                we(o2, o2.return, z);
              }
            }
            b2 && g3 & 64 && Tp(o2), Y(o2, o2.return);
            break;
          case 27:
            je && (i3 & e0) !== ac && Tm(o2);
          case 5:
            o2.tag !== 5 && o2.tag !== 27 || Si(o2), cr(e2, o2, i3), b2 && n === null && g3 & 4 && gd(o2), Y(o2, o2.return);
            break;
          case 6:
            Si(o2);
            break;
          case 26:
            if (Ze) {
              var k2 = o2.stateNode;
              o2.memoizedState !== null || k2 === null || ct || Xe(ji(k2.ownerDocument), o2.type, k2);
            }
            cr(e2, o2, i3), b2 && n === null && g3 & 4 && gd(o2), Y(o2, o2.return);
            break;
          case 12:
            if (b2 && g3 & 4) {
              g3 = mo(), cr(e2, o2, i3), b2 = o2.stateNode, b2.effectDuration += hl(g3);
              try {
                B(o2, Et, o2, n, Hi, b2.effectDuration);
              } catch (z) {
                we(o2, o2.return, z);
              }
            } else cr(e2, o2, i3);
            break;
          case 31:
            cr(e2, o2, i3), b2 && g3 & 4 && jm(e2, o2);
            break;
          case 13:
            cr(e2, o2, i3), b2 && g3 & 4 && Um(e2, o2);
            break;
          case 22:
            o2.memoizedState === null && cr(e2, o2, i3), Y(o2, o2.return);
            break;
          case 30:
            cr(e2, o2, i3), g3 & 18874368 && Fm(o2), Y(o2, o2.return);
            break;
          case 7:
            Y(o2, o2.return);
          default:
            cr(e2, o2, i3);
        }
        (o2.mode & 2) !== Z && 0 <= V && 0 <= J && (Sn || 0.05 < dn) && Me(o2, V, J, dn, on), gt(s), go(u2), on = f, Sn = p4;
      }
      function cr(e2, n, o2) {
        for (o2 = (n.subtreeFlags & 8772) !== 0 ? o2 : o2 & ~Cb, n = n.child; n !== null; ) Bm(e2, n.alternate, n, o2), n = n.sibling;
      }
      function Fa(e2, n) {
        var o2 = null;
        e2 !== null && e2.memoizedState !== null && e2.memoizedState.cachePool !== null && (o2 = e2.memoizedState.cachePool.pool), e2 = null, n.memoizedState !== null && n.memoizedState.cachePool !== null && (e2 = n.memoizedState.cachePool.pool), e2 !== o2 && (e2 != null && Mo(e2), o2 != null && Bt(o2));
      }
      function $r(e2, n) {
        e2 = null, n.alternate !== null && (e2 = n.alternate.memoizedState.cache), n = n.memoizedState.cache, n !== e2 && (Mo(n), e2 != null && Bt(e2));
      }
      function dr(e2, n, o2, i3, s) {
        var u2 = (o2 & 335544064) === o2;
        if (n.subtreeFlags & (u2 ? 10262 : 10256) || n.actualDuration !== 0 && (n.alternate === null || n.alternate.child !== n.child)) for (n = n.child; n !== null; ) u2 = n.sibling, Hm(e2, n, o2, i3, u2 !== null ? u2.actualStartTime : s), n = u2;
        else u2 && Rm(n);
      }
      function Hm(e2, n, o2, i3, s) {
        var u2 = Pt(), f = Ir(), p4 = Rr(), g3 = Lr(), b2 = os, k2 = (o2 & 335544064) === o2;
        k2 && n.alternate === null && n.return !== null && n.return.alternate !== null && vd(n);
        var z = n.flags;
        switch (n.tag) {
          case 0:
          case 11:
          case 15:
            (n.mode & 2) !== Z && 0 < n.actualStartTime && (n.flags & 1) !== 0 && oi(n, n.actualStartTime, s, Kn, o2), dr(e2, n, o2, i3, s), z & 2048 && Cm(n, Dt | Ro);
            break;
          case 1:
            (n.mode & 2) !== Z && 0 < n.actualStartTime && ((n.flags & 128) !== 0 ? Do(n, n.actualStartTime, s, []) : (n.flags & 1) !== 0 && oi(n, n.actualStartTime, s, Kn, o2)), dr(e2, n, o2, i3, s);
            break;
          case 3:
            var T3 = mo(), H = Kn;
            Kn = n.alternate !== null && n.alternate.memoizedState.isDehydrated && (n.flags & 256) === 0, dr(e2, n, o2, i3, s), Kn = H, k2 && _e && Eb && De(e2.containerInfo), z & 2048 && (o2 = null, n.alternate !== null && (o2 = n.alternate.memoizedState.cache), i3 = n.memoizedState.cache, i3 !== o2 && (Mo(i3), o2 != null && Bt(o2))), e2.passiveEffectDuration += Us(T3);
            break;
          case 12:
            if (z & 2048) {
              z = mo(), dr(e2, n, o2, i3, s), e2 = n.stateNode, e2.passiveEffectDuration += hl(z);
              try {
                B(n, Lp, n, n.alternate, Hi, e2.passiveEffectDuration);
              } catch ($) {
                we(n, n.return, $);
              }
            } else dr(e2, n, o2, i3, s);
            break;
          case 31:
            z = Kn, k2 = n.alternate !== null ? n.alternate.memoizedState : null, T3 = n.memoizedState, k2 !== null && T3 === null ? (T3 = n.deletions, T3 !== null && 0 < T3.length && T3[0].tag === 18 ? (Kn = false, k2 = k2.hydrationErrors, k2 !== null && Do(n, n.actualStartTime, s, k2)) : Kn = true) : Kn = false, dr(e2, n, o2, i3, s), Kn = z;
            break;
          case 13:
            z = Kn, k2 = n.alternate !== null ? n.alternate.memoizedState : null, T3 = n.memoizedState, k2 === null || k2.dehydrated === null || T3 !== null && T3.dehydrated !== null ? Kn = false : (T3 = n.deletions, T3 !== null && 0 < T3.length && T3[0].tag === 18 ? (Kn = false, k2 = k2.hydrationErrors, k2 !== null && Do(n, n.actualStartTime, s, k2)) : Kn = true), dr(e2, n, o2, i3, s), Kn = z;
            break;
          case 23:
            break;
          case 22:
            H = n.stateNode, T3 = n.alternate, n.memoizedState !== null ? (k2 && T3 !== null && T3.memoizedState === null && vd(T3), H._visibility & $i ? dr(e2, n, o2, i3, s) : _u(e2, n, o2, i3, s)) : (k2 && T3 !== null && T3.memoizedState !== null && vd(n), H._visibility & $i ? dr(e2, n, o2, i3, s) : (H._visibility |= $i, jl(e2, n, o2, i3, (n.subtreeFlags & 10256) !== 0 || n.actualDuration !== 0 && (n.alternate === null || n.alternate.child !== n.child), s), (n.mode & 2) === Z || Kn || (e2 = n.actualStartTime, 0 <= e2 && 0.05 < s - e2 && so(n, e2, s), 0 <= V && 0 <= J && 0.05 < J - V && so(n, V, J)))), z & 2048 && Fa(T3, n);
            break;
          case 24:
            dr(e2, n, o2, i3, s), z & 2048 && $r(n.alternate, n);
            break;
          case 30:
            k2 && (z = n.alternate, z !== null && (Po(z.child, true), Po(n.child, true))), dr(e2, n, o2, i3, s);
            break;
          default:
            dr(e2, n, o2, i3, s);
        }
        (n.mode & 2) !== Z && ((e2 = !Kn && n.alternate === null && n.return !== null && n.return.alternate !== null) && (o2 = n.actualStartTime, 0 <= o2 && 0.05 < s - o2 && nr(n, o2, s, "Mount")), 0 <= V && 0 <= J && ((Sn || 0.05 < dn) && Me(n, V, J, dn, on), e2 && 0.05 < J - V && nr(n, V, J, "Mount"))), gt(u2), go(f), on = p4, Sn = g3, os = b2;
      }
      function jl(e2, n, o2, i3, s, u2) {
        for (s = s && ((n.subtreeFlags & 10256) !== 0 || n.actualDuration !== 0 && (n.alternate === null || n.alternate.child !== n.child)), n = n.child; n !== null; ) {
          var f = n.sibling;
          Ul(e2, n, o2, i3, s, f !== null ? f.actualStartTime : u2), n = f;
        }
      }
      function Ul(e2, n, o2, i3, s, u2) {
        var f = Pt(), p4 = Ir(), g3 = Rr(), b2 = Lr(), k2 = os;
        s && (n.mode & 2) !== Z && 0 < n.actualStartTime && (n.flags & 1) !== 0 && oi(n, n.actualStartTime, u2, Kn, o2);
        var z = n.flags;
        switch (n.tag) {
          case 0:
          case 11:
          case 15:
            jl(e2, n, o2, i3, s, u2), Cm(n, Dt);
            break;
          case 23:
            break;
          case 22:
            var T3 = n.stateNode;
            n.memoizedState !== null ? T3._visibility & $i ? jl(e2, n, o2, i3, s, u2) : _u(e2, n, o2, i3, u2) : (T3._visibility |= $i, jl(e2, n, o2, i3, s, u2)), s && z & 2048 && Fa(n.alternate, n);
            break;
          case 24:
            jl(e2, n, o2, i3, s, u2), s && z & 2048 && $r(n.alternate, n);
            break;
          default:
            jl(e2, n, o2, i3, s, u2);
        }
        (n.mode & 2) !== Z && 0 <= V && 0 <= J && (Sn || 0.05 < dn) && Me(n, V, J, dn, on), gt(f), go(p4), on = g3, Sn = b2, os = k2;
      }
      function _u(e2, n, o2, i3, s) {
        if (n.subtreeFlags & 10256 || n.actualDuration !== 0 && (n.alternate === null || n.alternate.child !== n.child)) for (var u2 = n.child; u2 !== null; ) {
          n = u2.sibling;
          var f = e2, p4 = o2, g3 = i3, b2 = n !== null ? n.actualStartTime : s, k2 = os;
          (u2.mode & 2) !== Z && 0 < u2.actualStartTime && (u2.flags & 1) !== 0 && oi(u2, u2.actualStartTime, b2, Kn, p4);
          var z = u2.flags;
          switch (u2.tag) {
            case 22:
              _u(f, u2, p4, g3, b2), z & 2048 && Fa(u2.alternate, u2);
              break;
            case 24:
              _u(f, u2, p4, g3, b2), z & 2048 && $r(u2.alternate, u2);
              break;
            default:
              _u(f, u2, p4, g3, b2);
          }
          os = k2, u2 = n;
        }
      }
      function Da(e2, n, o2) {
        if (e2.subtreeFlags & ic) for (e2 = e2.child; e2 !== null; ) Mm(e2, n, o2), e2 = e2.sibling;
      }
      function Mm(e2, n, o2) {
        switch (e2.tag) {
          case 26:
            if (Da(e2, n, o2), e2.flags & ic) if (e2.memoizedState !== null) Tg(o2, fa, e2.memoizedState, e2.memoizedProps);
            else {
              var i3 = e2.stateNode, s = e2.type;
              e2 = e2.memoizedProps, ((n & 335544128) === n || qr(s, e2)) && xg(o2, i3, s, e2);
            }
            break;
          case 5:
            Da(e2, n, o2), e2.flags & ic && (i3 = e2.stateNode, s = e2.type, e2 = e2.memoizedProps, ((n & 335544128) === n || qr(s, e2)) && xg(o2, i3, s, e2));
            break;
          case 3:
          case 4:
            Ze ? (i3 = fa, fa = ji(e2.stateNode.containerInfo), Da(e2, n, o2), fa = i3) : Da(e2, n, o2);
            break;
          case 22:
            e2.memoizedState === null && (i3 = e2.alternate, i3 !== null && i3.memoizedState !== null ? (i3 = ic, ic = 16777216, Da(e2, n, o2), ic = i3) : Da(e2, n, o2));
            break;
          case 30:
            (e2.flags & ic) !== 0 && (i3 = e2.memoizedProps.name, i3 != null && i3 !== "auto" && (s = e2.stateNode, s.paired = null, no === null && (no = /* @__PURE__ */ new Map()), no.set(i3, s))), Da(e2, n, o2);
            break;
          default:
            Da(e2, n, o2);
        }
      }
      function Wl(e2) {
        var n = e2.alternate;
        if (n !== null && (e2 = n.child, e2 !== null)) {
          n.child = null;
          do
            n = e2.sibling, e2.sibling = null, e2 = n;
          while (e2 !== null);
        }
      }
      function Nu(e2) {
        var n = e2.deletions;
        if ((e2.flags & 16) !== 0) {
          if (n !== null) for (var o2 = 0; o2 < n.length; o2++) {
            var i3 = n[o2], s = Pt();
            dt = i3, Qm(i3, e2), (i3.mode & 2) !== Z && 0 <= V && 0 <= J && 0.05 < J - V && nr(i3, V, J, "Unmount"), gt(s);
          }
          Wl(e2);
        }
        if (e2.subtreeFlags & 10256) for (e2 = e2.child; e2 !== null; ) Vm(e2), e2 = e2.sibling;
      }
      function Vm(e2) {
        var n = Pt(), o2 = Ir(), i3 = Rr(), s = Lr();
        switch (e2.tag) {
          case 0:
          case 11:
          case 15:
            Nu(e2), e2.flags & 2048 && hd(e2, e2.return, Dt | Ro);
            break;
          case 3:
            var u2 = mo();
            Nu(e2), e2.stateNode.passiveEffectDuration += Us(u2);
            break;
          case 12:
            u2 = mo(), Nu(e2), e2.stateNode.passiveEffectDuration += hl(u2);
            break;
          case 22:
            u2 = e2.stateNode, e2.memoizedState !== null && u2._visibility & $i && (e2.return === null || e2.return.tag !== 13) ? (u2._visibility &= ~$i, Pd(e2), (e2.mode & 2) !== Z && 0 <= V && 0 <= J && 0.05 < J - V && nr(e2, V, J, "Disconnect")) : Nu(e2);
            break;
          default:
            Nu(e2);
        }
        (e2.mode & 2) !== Z && 0 <= V && 0 <= J && (Sn || 0.05 < dn) && Me(e2, V, J, dn, on), gt(n), go(o2), Sn = s, on = i3;
      }
      function Pd(e2) {
        var n = e2.deletions;
        if ((e2.flags & 16) !== 0) {
          if (n !== null) for (var o2 = 0; o2 < n.length; o2++) {
            var i3 = n[o2], s = Pt();
            dt = i3, Qm(i3, e2), (i3.mode & 2) !== Z && 0 <= V && 0 <= J && 0.05 < J - V && nr(i3, V, J, "Unmount"), gt(s);
          }
          Wl(e2);
        }
        for (e2 = e2.child; e2 !== null; ) $m(e2), e2 = e2.sibling;
      }
      function $m(e2) {
        var n = Pt(), o2 = Ir(), i3 = Rr(), s = Lr();
        switch (e2.tag) {
          case 0:
          case 11:
          case 15:
            hd(e2, e2.return, Dt), Pd(e2);
            break;
          case 22:
            var u2 = e2.stateNode;
            u2._visibility & $i && (u2._visibility &= ~$i, Pd(e2));
            break;
          default:
            Pd(e2);
        }
        (e2.mode & 2) !== Z && 0 <= V && 0 <= J && (Sn || 0.05 < dn) && Me(e2, V, J, dn, on), gt(n), go(o2), Sn = s, on = i3;
      }
      function Qm(e2, n) {
        for (; dt !== null; ) {
          var o2 = dt, i3 = o2, s = n, u2 = Pt(), f = Ir(), p4 = Rr(), g3 = Lr();
          switch (i3.tag) {
            case 0:
            case 11:
            case 15:
              hd(i3, s, Dt);
              break;
            case 23:
            case 22:
              i3.memoizedState !== null && i3.memoizedState.cachePool !== null && (s = i3.memoizedState.cachePool.pool, s != null && Mo(s));
              break;
            case 24:
              Bt(i3.memoizedState.cache);
          }
          if ((i3.mode & 2) !== Z && 0 <= V && 0 <= J && (Sn || 0.05 < dn) && Me(i3, V, J, dn, on), gt(u2), go(f), Sn = g3, on = p4, i3 = o2.child, i3 !== null) i3.return = o2, dt = i3;
          else e: for (o2 = e2; dt !== null; ) {
            if (i3 = dt, u2 = i3.sibling, f = i3.return, Ye(i3), i3 === o2) {
              dt = null;
              break e;
            }
            if (u2 !== null) {
              u2.return = f, dt = u2;
              break e;
            }
            dt = f;
          }
        }
      }
      function Bp(e2) {
        var n = Jn(e2);
        if (n != null) {
          if (typeof n.memoizedProps["data-testname"] != "string") throw Error("Invalid host root specified. Should be either a React container or a node with a testname attribute.");
          return n;
        }
        if (e2 = Ii(e2), e2 === null) throw Error("Could not find React container within specified host subtree.");
        return e2.stateNode.current;
      }
      function Hp(e2, n) {
        var o2 = e2.tag;
        switch (n.$$typeof) {
          case t0:
            if (e2.type === n.value) return true;
            break;
          case r0:
            e: {
              for (n = n.value, e2 = [e2, 0], o2 = 0; o2 < e2.length; ) {
                var i3 = e2[o2++], s = i3.tag, u2 = e2[o2++], f = n[u2];
                if (s !== 5 && s !== 26 && s !== 27 || !Zr(i3)) {
                  for (; f != null && Hp(i3, f); ) u2++, f = n[u2];
                  if (u2 === n.length) {
                    n = true;
                    break e;
                  } else for (i3 = i3.child; i3 !== null; ) e2.push(i3, u2), i3 = i3.sibling;
                }
              }
              n = false;
            }
            return n;
          case o0:
            if ((o2 === 5 || o2 === 26 || o2 === 27) && Jl(e2.stateNode, n.value)) return true;
            break;
          case i0:
            if ((o2 === 5 || o2 === 6 || o2 === 26 || o2 === 27) && (e2 = Cg(e2), e2 !== null && 0 <= e2.indexOf(n.value))) return true;
            break;
          case a0:
            if ((o2 === 5 || o2 === 26 || o2 === 27) && (e2 = e2.memoizedProps["data-testname"], typeof e2 == "string" && e2.toLowerCase() === n.value.toLowerCase())) return true;
            break;
          default:
            throw Error("Invalid selector type specified.");
        }
        return false;
      }
      function Mp(e2) {
        switch (e2.$$typeof) {
          case t0:
            return "<" + (en(e2.value) || "Unknown") + ">";
          case r0:
            return ":has(" + (Mp(e2) || "") + ")";
          case o0:
            return '[role="' + e2.value + '"]';
          case i0:
            return '"' + e2.value + '"';
          case a0:
            return '[data-testname="' + e2.value + '"]';
          default:
            throw Error("Invalid selector type specified.");
        }
      }
      function qm(e2, n) {
        var o2 = [];
        e2 = [e2, 0];
        for (var i3 = 0; i3 < e2.length; ) {
          var s = e2[i3++], u2 = s.tag, f = e2[i3++], p4 = n[f];
          if (u2 !== 5 && u2 !== 26 && u2 !== 27 || !Zr(s)) {
            for (; p4 != null && Hp(s, p4); ) f++, p4 = n[f];
            if (f === n.length) o2.push(s);
            else for (s = s.child; s !== null; ) e2.push(s, f), s = s.sibling;
          }
        }
        return o2;
      }
      function xd(e2, n) {
        if (!Oa) throw Error("Test selector API is not supported by this renderer.");
        e2 = Bp(e2), e2 = qm(e2, n), n = [], e2 = Array.from(e2);
        for (var o2 = 0; o2 < e2.length; ) {
          var i3 = e2[o2++], s = i3.tag;
          if (s === 5 || s === 26 || s === 27) Zr(i3) || n.push(i3.stateNode);
          else for (i3 = i3.child; i3 !== null; ) e2.push(i3), i3 = i3.sibling;
        }
        return n;
      }
      function w0() {
        Oa && l0.forEach(function(e2) {
          return e2();
        });
      }
      function Gm() {
        var e2 = typeof IS_REACT_ACT_ENVIRONMENT < "u" ? IS_REACT_ACT_ENVIRONMENT : void 0;
        return e2 || N2.actQueue === null || console.error("The current testing environment is not configured to support act(...)"), e2;
      }
      function _t(e2) {
        if ((ve & pt) !== ft && te !== 0) return te & -te;
        var n = N2.T;
        return n !== null ? (n._updatedFibers || (n._updatedFibers = /* @__PURE__ */ new Set()), n._updatedFibers.add(e2), nc !== null && Nn() === 2 && (nc = null), Nc()) : (e2 = Nn(), e2 === 2 && (nc = null), e2);
      }
      function Jm() {
        if (kr === 0) if ((te & 536870912) === 0 || le) {
          var e2 = R;
          R <<= 1, (R & 3932160) === 0 && (R = 262144), kr = e2;
        } else kr = 536870912;
        return e2 = St.current, e2 !== null && (e2.flags |= 32), kr;
      }
      function Al(e2, n) {
        if (n != null) {
          var o2 = e2.stateNode, i3 = o2.ref;
          i3 === null && (i3 = o2.ref = Bu(Mn(e2.memoizedProps, o2))), wf === null && (wf = []), wf.push(n.bind(null, i3));
        }
      }
      function nn(e2, n, o2) {
        if (xf && console.error("useInsertionEffect must not schedule updates."), Ab && (y0 = true), (e2 === Ge && (Ae === sc || Ae === uc) || e2.cancelPendingCommit !== null) && (Yo(e2, 0), ja(e2, te, kr, false)), el(e2, o2), (ve & pt) !== ft && e2 === Ge) {
          if (Qa) switch (n.tag) {
            case 0:
            case 11:
            case 15:
              e2 = se && G(se) || "Unknown", l1.has(e2) || (l1.add(e2), n = G(n) || "Unknown", console.error("Cannot update a component (`%s`) while rendering a different component (`%s`). To locate the bad setState() call inside `%s`, follow the stack trace as described in https://react.dev/link/setstate-in-render", n, e2, e2));
              break;
            case 1:
              i1 || (console.error("Cannot update during an existing state transition (such as within `render`). Render methods should be a pure function of props and state."), i1 = true);
          }
        } else Le && Rf(e2, n, o2), I0(n), e2 === Ge && ((ve & pt) === ft && (ys |= o2), fn === gs && ja(e2, te, kr, false)), jr(e2);
      }
      function Zm(e2, n, o2) {
        if ((ve & (pt | Fo)) !== ft) throw Error("Should not already be working.");
        if (te !== 0 && se !== null) {
          var i3 = se, s = Re();
          switch (ny) {
            case Xh:
            case sc:
              var u2 = Rh;
              Ke && ((i3 = i3._debugTask) ? i3.run(console.timeStamp.bind(console, "Suspended", u2, s, "Components \u269B", void 0, "primary-light")) : console.timeStamp("Suspended", u2, s, "Components \u269B", void 0, "primary-light"));
              break;
            case uc:
              u2 = Rh, Ke && ((i3 = i3._debugTask) ? i3.run(console.timeStamp.bind(console, "Action", u2, s, "Components \u269B", void 0, "primary-light")) : console.timeStamp("Action", u2, s, "Components \u269B", void 0, "primary-light"));
              break;
            default:
              Ke && (i3 = s - Rh, 3 > i3 || console.timeStamp("Blocked", Rh, s, "Components \u269B", void 0, 5 > i3 ? "primary-light" : 10 > i3 ? "primary" : 100 > i3 ? "primary-dark" : "error"));
          }
        }
        u2 = (o2 = !o2 && (n & 127) === 0 && (n & e2.expiredLanes) === 0 || At(e2, n)) ? x0(e2, n) : Qp(e2, n, true);
        var f = o2;
        do {
          if (u2 === Gi) {
            Sf && !o2 && ja(e2, n, 0, false), n = Ae, Rh = Tn(), ny = n;
            break;
          } else {
            if (i3 = Re(), s = e2.current.alternate, f && !P0(s)) {
              zn(n), s = ut, u2 = i3, !Ke || u2 <= s || (kn ? kn.run(console.timeStamp.bind(console, "Teared Render", s, u2, me, "Scheduler \u269B", "error")) : console.timeStamp("Teared Render", s, u2, me, "Scheduler \u269B", "error")), xi(n, i3), u2 = Qp(e2, n, false), f = false;
              continue;
            }
            if (u2 === lc) {
              if (f = n, e2.errorRecoveryDisabledLanes & f) var p4 = 0;
              else p4 = e2.pendingLanes & -536870913, p4 = p4 !== 0 ? p4 : p4 & 536870912 ? 536870912 : 0;
              if (p4 !== 0) {
                zn(n), _s(ut, i3, n, kn), xi(n, i3), n = p4;
                e: {
                  i3 = e2, u2 = f, f = Kh;
                  var g3 = $e && i3.current.memoizedState.isDehydrated;
                  if (g3 && (Yo(i3, p4).flags |= 256), p4 = Qp(i3, p4, false), p4 !== lc && p4 !== Zh) {
                    if (Tb && !g3) {
                      i3.errorRecoveryDisabledLanes |= u2, ys |= u2, u2 = gs;
                      break e;
                    }
                    i3 = Yt, Yt = f, i3 !== null && (Yt === null ? Yt = i3 : Yt.push.apply(Yt, i3));
                  }
                  u2 = p4;
                }
                if (f = false, u2 !== lc) continue;
                i3 = Re();
              }
            }
            if (u2 === Jh) {
              zn(n), _s(ut, i3, n, kn), xi(n, i3), Yo(e2, 0), ja(e2, n, 0, true);
              break;
            }
            e: {
              switch (o2 = e2, u2) {
                case Gi:
                case Jh:
                  throw Error("Root did not complete. This is a bug in React.");
                case gs:
                  if ((n & 4194048) !== n && (n & 62914560) !== n) break;
                case Zh:
                  zn(n), Es(ut, i3, n, kn), xi(n, i3), s = n, (s & 127) !== 0 ? Wg = i3 : (s & 4194048) !== 0 && (Ag = i3), ja(o2, n, kr, !Ji);
                  break e;
                case lc:
                  Yt = null;
                  break;
                case s0:
                case Xy:
                  break;
                default:
                  throw Error("Unknown root exit status.");
              }
              if (N2.actQueue !== null) _d(o2, s, n, Yt, nm, d0, kr, ys, cc, Ji, u2, null, null, ut, i3);
              else {
                if ((n & 62914560) === n && (f = f0 + e1 - Re(), 10 < f)) {
                  if (ja(o2, n, kr, !Ji), ks(o2, 0, true) !== 0) break e;
                  wr = n, o2.timeoutHandle = Dd(Vp.bind(null, o2, s, Yt, nm, d0, n, kr, ys, cc, Ji, u2, "Throttled", ut, i3), f);
                  break e;
                }
                Vp(o2, s, Yt, nm, d0, n, kr, ys, cc, Ji, u2, null, ut, i3);
              }
            }
          }
          break;
        } while (true);
        jr(e2);
      }
      function Vp(e2, n, o2, i3, s, u2, f, p4, g3, b2, k2, z, T3, H) {
        e2.timeoutHandle = Wn;
        var $ = n.subtreeFlags, an = (u2 & 335544064) === u2, Hn = null;
        if ((an || $ & 8192 || ($ & 16785408) === 16785408) && (Hn = A0(), no = null, Mm(n, u2, Hn), an && tn(Hn, e2.containerInfo), $ = (u2 & 62914560) === u2 ? f0 - Re() : (u2 & 4194048) === u2 ? Ky - Re() : 0, $ = Uu(Hn, $), $ !== null)) {
          wr = u2, e2.cancelPendingCommit = $(_d.bind(null, e2, n, u2, o2, i3, s, f, p4, g3, b2, k2, Hn, ql(Hn, e2.containerInfo), T3, H)), ja(e2, u2, f, !b2);
          return;
        }
        _d(e2, n, u2, o2, i3, s, f, p4, g3, b2, k2, Hn, z, T3, H);
      }
      function P0(e2) {
        for (var n = e2; ; ) {
          var o2 = n.tag;
          if ((o2 === 0 || o2 === 11 || o2 === 15) && n.flags & 16384 && (o2 = n.updateQueue, o2 !== null && (o2 = o2.stores, o2 !== null))) for (var i3 = 0; i3 < o2.length; i3++) {
            var s = o2[i3], u2 = s.getSnapshot;
            s = s.value;
            try {
              if (!Gt(u2(), s)) return false;
            } catch {
              return false;
            }
          }
          if (o2 = n.child, n.subtreeFlags & 16384 && o2 !== null) o2.return = n, n = o2;
          else {
            if (n === e2) break;
            for (; n.sibling === null; ) {
              if (n.return === null || n.return === e2) return true;
              n = n.return;
            }
            n.sibling.return = n.return, n = n.sibling;
          }
        }
        return true;
      }
      function ja(e2, n, o2, i3) {
        n = im(e2, n), n &= ~Ib, n &= ~ys, e2.suspendedLanes |= n, e2.pingedLanes &= ~n, i3 && (e2.warmLanes |= n), i3 = e2.expirationTimes;
        for (var s = n; 0 < s; ) {
          var u2 = 31 - d(s), f = 1 << u2;
          i3[u2] = -1, s &= ~f;
        }
        o2 !== 0 && io(e2, o2, n);
      }
      function Cd() {
        return (ve & (pt | Fo)) === ft ? (Ur(0, false), false) : true;
      }
      function $p() {
        return (ve & (pt | Fo)) !== ft;
      }
      function Tu() {
        if (se !== null) {
          if (Ae === Sr) var e2 = se.return;
          else e2 = se, cl(), Bc(e2), df = null, Bh = 0, e2 = se;
          for (; e2 !== null; ) Np(e2.alternate, e2), e2 = e2.return;
          se = null;
        }
      }
      function xi(e2, n) {
        (e2 & 127) !== 0 && (us = n), (e2 & 4194048) !== 0 && (ua = n), (e2 & 62914560) !== 0 && (nb = n), (e2 & 2080374784) !== 0 && (tb = n);
      }
      function Yo(e2, n) {
        Ke && (console.timeStamp("Blocking Track", 3e-3, 3e-3, "Blocking", "Scheduler \u269B", "primary-light"), console.timeStamp("Transition Track", 3e-3, 3e-3, "Transition", "Scheduler \u269B", "primary-light"), console.timeStamp("Suspense Track", 3e-3, 3e-3, "Suspense", "Scheduler \u269B", "primary-light"), console.timeStamp("Idle Track", 3e-3, 3e-3, "Idle", "Scheduler \u269B", "primary-light"));
        var o2 = ut;
        if (ut = Tn(), te !== 0 && 0 < o2) {
          if (zn(te), fn === s0 || fn === gs) Es(o2, ut, n, kn);
          else {
            var i3 = ut, s = kn;
            if (Ke && !(i3 <= o2)) {
              var u2 = (n & 738197653) === n ? "tertiary-dark" : "primary-dark", f = (n & 536870912) === n ? "Prewarm" : (n & 201326741) === n ? "Interrupted Hydration" : "Interrupted Render";
              s ? s.run(console.timeStamp.bind(console, f, o2, i3, me, "Scheduler \u269B", u2)) : console.timeStamp(f, o2, i3, me, "Scheduler \u269B", u2);
            }
          }
          xi(te, ut);
        }
        if (o2 = kn, kn = null, (n & 127) !== 0) {
          kn = Nh, s = 0 <= Ga && Ga < us ? us : Ga, i3 = 0 <= Ju && Ju < us ? us : Ju, u2 = 0 <= i3 ? i3 : 0 <= s ? s : ut, 0 <= Wg ? (zn(2), Df(Wg, u2, n, o2)) : (Xu & 127) !== 0 && (zn(2), Pr(us, u2, br)), o2 = s;
          var p4 = i3, g3 = Th, b2 = 0 < af, k2 = cs === 1, z = cs === 2;
          if (s = ut, i3 = Nh, u2 = Y0, f = K0, Ke) {
            if (me = "Blocking", 0 < o2 ? o2 > s && (o2 = s) : o2 = s, 0 < p4 ? p4 > o2 && (p4 = o2) : p4 = o2, g3 !== null && o2 > p4) {
              var T3 = b2 ? "secondary-light" : "warning";
              i3 ? i3.run(console.timeStamp.bind(console, b2 ? "Consecutive" : "Event: " + g3, p4, o2, me, "Scheduler \u269B", T3)) : console.timeStamp(b2 ? "Consecutive" : "Event: " + g3, p4, o2, me, "Scheduler \u269B", T3);
            }
            s > o2 && (p4 = k2 ? "error" : (n & 738197653) === n ? "tertiary-light" : "primary-light", k2 = z ? "Promise Resolved" : k2 ? "Cascading Update" : 5 < s - o2 ? "Update Blocked" : "Update", z = [], f != null && z.push(["Component name", f]), u2 != null && z.push(["Method name", u2]), o2 = {
              start: o2,
              end: s,
              detail: {
                devtools: {
                  properties: z,
                  track: me,
                  trackGroup: "Scheduler \u269B",
                  color: p4
                }
              }
            }, i3 ? i3.run(performance.measure.bind(performance, k2, o2)) : performance.measure(k2, o2), performance.clearMeasures(k2));
          }
          Ga = -1.1, cs = 0, K0 = Y0 = null, Wg = -1.1, af = Ju, Ju = -1.1, us = Tn();
        }
        return (n & 4194048) !== 0 && (kn = Ih, s = 0 <= Vi && Vi < ua ? ua : Vi, o2 = 0 <= To && To < ua ? ua : To, i3 = 0 <= ds && ds < ua ? ua : ds, u2 = 0 <= i3 ? i3 : 0 <= o2 ? o2 : ut, 0 <= Ag ? (zn(256), Df(Ag, u2, n, kn)) : (Xu & 4194048) !== 0 && (zn(256), Pr(ua, u2, br)), z = i3, p4 = Zu, g3 = 0 < fs, b2 = eb === 2, u2 = ut, i3 = Ih, f = Kb, k2 = ey, Ke && (me = "Transition", 0 < o2 ? o2 > u2 && (o2 = u2) : o2 = u2, 0 < s ? s > o2 && (s = o2) : s = o2, 0 < z ? z > s && (z = s) : z = s, s > z && p4 !== null && (T3 = g3 ? "secondary-light" : "warning", i3 ? i3.run(console.timeStamp.bind(console, g3 ? "Consecutive" : "Event: " + p4, z, s, me, "Scheduler \u269B", T3)) : console.timeStamp(g3 ? "Consecutive" : "Event: " + p4, z, s, me, "Scheduler \u269B", T3)), o2 > s && (i3 ? i3.run(console.timeStamp.bind(console, "Action", s, o2, me, "Scheduler \u269B", "primary-dark")) : console.timeStamp("Action", s, o2, me, "Scheduler \u269B", "primary-dark")), u2 > o2 && (s = b2 ? "Promise Resolved" : 5 < u2 - o2 ? "Update Blocked" : "Update", z = [], k2 != null && z.push(["Component name", k2]), f != null && z.push(["Method name", f]), o2 = {
          start: o2,
          end: u2,
          detail: {
            devtools: {
              properties: z,
              track: me,
              trackGroup: "Scheduler \u269B",
              color: "primary-light"
            }
          }
        }, i3 ? i3.run(performance.measure.bind(performance, s, o2)) : performance.measure(s, o2), performance.clearMeasures(s))), To = Vi = -1.1, eb = 0, Ag = -1.1, fs = ds, ds = -1.1, ua = Tn()), (n & 62914560) !== 0 && (Xu & 62914560) !== 0 && (zn(4194304), Pr(nb, ut, br)), (n & 2080374784) !== 0 && (Xu & 2080374784) !== 0 && (zn(268435456), Pr(tb, ut, br)), o2 = e2.timeoutHandle, o2 !== Wn && (e2.timeoutHandle = Wn, Du(o2)), o2 = e2.cancelPendingCommit, o2 !== null && (e2.cancelPendingCommit = null, o2()), wr = 0, Tu(), Ge = e2, se = o2 = Ko(e2.current, null), te = n, Ae = Sr, to = null, Ji = false, Sf = At(e2, n), Tb = false, fn = Gi, cc = kr = Ib = ys = bs = 0, Yt = Kh = null, d0 = false, ei = im(e2, n), vl(), e2 = Hb(), 1e3 < e2 - la && (N2.recentlyCreatedOwnerStacks = 0, la = e2), ca.discardPendingWarnings(), o2;
      }
      function Xm(e2, n) {
        X2 = null, N2.H = Zg, N2.getCurrentStack = null, Qa = false, Bi = null, n === cf || n === Vg ? (n = Xf(), Ae = Xh) : n === cb ? (n = Xf(), Ae = Yy) : Ae = n === wb ? Nb : n !== null && typeof n == "object" && typeof n.then == "function" ? Yh : u0, to = n;
        var o2 = se;
        o2 === null ? (fn = Jh, bi(e2, Ot(n, e2.current))) : o2.mode & 2 && As(o2);
      }
      function Ym() {
        var e2 = St.current;
        return e2 === null ? true : (te & 4194048) === te ? Zt === null : (te & 62914560) === te || (te & 536870912) !== 0 ? e2 === Zt : false;
      }
      function Km() {
        var e2 = N2.H;
        return N2.H = Zg, e2 === null ? Zg : e2;
      }
      function eg() {
        var e2 = N2.A;
        return N2.A = A1, e2;
      }
      function zd(e2) {
        kn === null && (kn = e2._debugTask == null ? null : e2._debugTask);
      }
      function Iu() {
        fn = gs, Ji || (te & 4194048) !== te && St.current !== null || (Sf = true), (bs & 134217727) === 0 && (ys & 134217727) === 0 || Ge === null || ja(Ge, te, kr, false);
      }
      function Qp(e2, n, o2) {
        var i3 = ve;
        ve |= pt;
        var s = Km(), u2 = eg();
        if (Ge !== e2 || te !== n) {
          if (Le) {
            var f = e2.memoizedUpdaters;
            0 < f.size && (Ru(e2, te), f.clear()), Cs(e2, n);
          }
          nm = null, Yo(e2, n);
        }
        n = false, f = fn;
        e: do
          try {
            if (Ae !== Sr && se !== null) {
              var p4 = se, g3 = to;
              switch (Ae) {
                case Nb:
                  Tu(), f = Zh;
                  break e;
                case Xh:
                case sc:
                case uc:
                case Yh:
                  St.current === null && (n = true);
                  var b2 = Ae;
                  if (Ae = Sr, to = null, Ci(e2, p4, g3, b2), o2 && Sf) {
                    f = Gi;
                    break e;
                  }
                  break;
                default:
                  b2 = Ae, Ae = Sr, to = null, Ci(e2, p4, g3, b2);
              }
            }
            ng(), f = fn;
            break;
          } catch (k2) {
            Xm(e2, k2);
          }
        while (true);
        return n && e2.shellSuspendCounter++, cl(), ve = i3, N2.H = s, N2.A = u2, se === null && (Ge = null, te = 0, vl()), f;
      }
      function ng() {
        for (; se !== null; ) rg(se);
      }
      function x0(e2, n) {
        var o2 = ve;
        ve |= pt;
        var i3 = Km(), s = eg();
        if (Ge !== e2 || te !== n) {
          if (Le) {
            var u2 = e2.memoizedUpdaters;
            0 < u2.size && (Ru(e2, te), u2.clear()), Cs(e2, n);
          }
          nm = null, em = Re() + Rb, Yo(e2, n);
        } else Sf = At(e2, n);
        e: do
          try {
            if (Ae !== Sr && se !== null) n: switch (n = se, u2 = to, Ae) {
              case u0:
                Ae = Sr, to = null, Ci(e2, n, u2, u0);
                break;
              case sc:
              case uc:
                if (Jf(u2)) {
                  Ae = Sr, to = null, og(n);
                  break;
                }
                n = function() {
                  Ae !== sc && Ae !== uc || Ge !== e2 || (Ae = c0), jr(e2);
                }, u2.then(n, n);
                break e;
              case Xh:
                Ae = c0;
                break e;
              case Yy:
                Ae = _b;
                break e;
              case c0:
                Jf(u2) ? (Ae = Sr, to = null, og(n)) : (Ae = Sr, to = null, Ci(e2, n, u2, c0));
                break;
              case _b:
                var f = null;
                switch (se.tag) {
                  case 26:
                    f = se.memoizedState;
                  case 5:
                  case 27:
                    var p4 = se, g3 = p4.type, b2 = p4.pendingProps;
                    if (f ? ef(f) : Pg(p4.stateNode, g3, b2)) {
                      Ae = Sr, to = null;
                      var k2 = p4.sibling;
                      if (k2 !== null) se = k2;
                      else {
                        var z = p4.return;
                        z !== null ? (se = z, Ed(z)) : se = null;
                      }
                      break n;
                    }
                    break;
                  default:
                    console.error("Unexpected type of fiber triggered a suspensey commit. This is a bug in React.");
                }
                Ae = Sr, to = null, Ci(e2, n, u2, _b);
                break;
              case Yh:
                Ae = Sr, to = null, Ci(e2, n, u2, Yh);
                break;
              case Nb:
                Tu(), fn = Zh;
                break e;
              default:
                throw Error("Unexpected SuspendedReason. This is a bug in React.");
            }
            N2.actQueue !== null ? ng() : tg();
            break;
          } catch (T3) {
            Xm(e2, T3);
          }
        while (true);
        return cl(), N2.H = i3, N2.A = s, ve = o2, se !== null ? Gi : (Ge = null, te = 0, vl(), fn);
      }
      function tg() {
        for (; se !== null && !fe(); ) rg(se);
      }
      function rg(e2) {
        var n = e2.alternate;
        (e2.mode & 2) !== Z ? (zc(e2), n = B(e2, Su, n, e2, ei), As(e2)) : n = B(e2, Su, n, e2, ei), e2.memoizedProps = e2.pendingProps, n === null ? Ed(e2) : se = n;
      }
      function og(e2) {
        var n = B(e2, ag, e2);
        e2.memoizedProps = e2.pendingProps, n === null ? Ed(e2) : se = n;
      }
      function ag(e2) {
        var n = e2.alternate, o2 = (e2.mode & 2) !== Z;
        switch (o2 && zc(e2), e2.tag) {
          case 15:
          case 0:
            n = kp(n, e2, e2.pendingProps, e2.type, void 0, te);
            break;
          case 11:
            n = kp(n, e2, e2.pendingProps, e2.type.render, e2.ref, te);
            break;
          case 5:
            Bc(e2);
            var i3 = e2;
            $e && i3 === st && (le ? (Tr(i3), i3.tag === 5 && i3.stateNode != null && (rn = i3.stateNode)) : (Tr(i3), le = true));
          default:
            Np(n, e2), e2 = se = bg(e2, ei), n = Su(n, e2, ei);
        }
        return o2 && As(e2), n;
      }
      function Ci(e2, n, o2, i3) {
        cl(), Bc(n), df = null, Bh = 0;
        var s = n.return;
        try {
          if (vm(e2, s, n, o2, te)) {
            fn = Jh, bi(e2, Ot(o2, e2.current)), se = null;
            return;
          }
        } catch (u2) {
          if (s !== null) throw se = s, u2;
          fn = Jh, bi(e2, Ot(o2, e2.current)), se = null;
          return;
        }
        n.flags & 32768 ? (le || i3 === u0 ? e2 = true : Sf || (te & 536870912) !== 0 ? e2 = false : (Ji = e2 = true, (i3 === sc || i3 === uc || i3 === Xh || i3 === Yh) && (i3 = St.current, i3 !== null && i3.tag === 13 && (i3.flags |= 16384))), qp(n, e2)) : Ed(n);
      }
      function Ed(e2) {
        var n = e2;
        do {
          if ((n.flags & 32768) !== 0) {
            qp(n, Ji);
            return;
          }
          var o2 = n.alternate;
          if (e2 = n.return, zc(n), o2 = B(n, _p, o2, n, ei), (n.mode & 2) !== Z && Of(n), o2 !== null) {
            se = o2;
            return;
          }
          if (n = n.sibling, n !== null) {
            se = n;
            return;
          }
          se = n = e2;
        } while (n !== null);
        fn === Gi && (fn = Xy);
      }
      function qp(e2, n) {
        do {
          var o2 = Zo(e2.alternate, e2);
          if (o2 !== null) {
            o2.flags &= 32767, se = o2;
            return;
          }
          if ((e2.mode & 2) !== Z) {
            Of(e2), o2 = e2.actualDuration;
            for (var i3 = e2.child; i3 !== null; ) o2 += i3.actualDuration, i3 = i3.sibling;
            e2.actualDuration = o2;
          }
          if (o2 = e2.return, o2 !== null && (o2.flags |= 32768, o2.subtreeFlags = 0, o2.deletions = null), !n && (e2 = e2.sibling, e2 !== null)) {
            se = e2;
            return;
          }
          se = e2 = o2;
        } while (e2 !== null);
        fn = Zh, se = null;
      }
      function _d(e2, n, o2, i3, s, u2, f, p4, g3, b2, k2, z, T3, H, $) {
        e2.cancelPendingCommit = null;
        do
          Ol();
        while (pn !== ni);
        if (ca.flushLegacyContextWarning(), ca.flushPendingUnsafeLifecycleWarnings(), (ve & (pt | Fo)) !== ft) throw Error("Should not already be working.");
        if (zn(o2), k2 === lc) _s(H, $, o2, kn);
        else if (i3 !== null) {
          if (b2 = n !== null && n.alternate !== null && n.alternate.memoizedState.isDehydrated && (n.flags & 256) !== 0, u2 = kn, Ke && !($ <= H)) {
            k2 = [];
            for (var an = 0; an < i3.length; an++) {
              var Hn = i3[an].value;
              k2.push(["Recoverable Error", typeof Hn == "object" && Hn !== null && typeof Hn.message == "string" ? String(Hn.message) : String(Hn)]);
            }
            H = {
              start: H,
              end: $,
              detail: {
                devtools: {
                  color: "primary-dark",
                  track: me,
                  trackGroup: "Scheduler \u269B",
                  tooltipText: b2 ? "Hydration Failed" : "Recovered after Error",
                  properties: k2
                }
              }
            }, u2 ? u2.run(performance.measure.bind(performance, "Recovered", H)) : performance.measure("Recovered", H), performance.clearMeasures("Recovered");
          }
        } else u2 = kn, !Ke || $ <= H || (b2 = (o2 & 738197653) === o2 ? "tertiary-dark" : "primary-dark", k2 = (o2 & 536870912) === o2 ? "Prepared" : (o2 & 201326741) === o2 ? "Hydrated" : "Render", u2 ? u2.run(console.timeStamp.bind(console, k2, H, $, me, "Scheduler \u269B", b2)) : console.timeStamp(k2, H, $, me, "Scheduler \u269B", b2));
        if (n !== null) {
          if (o2 === 0 && console.error("finishedLanes should not be empty during a commit. This is a bug in React."), n === e2.current) throw Error("Cannot commit the same tree as before. This error is likely caused by a bug in React. Please file an issue.");
          e2 === Ge && (se = Ge = null, te = 0), dc = n, pa = e2, wr = o2, Ub = s, o1 = i3, m0 = $, g0 = T3, ro = p0, Wb = null, ig(e2, n, o2, f, p4, g3, z, T3, $);
        }
      }
      function ig(e2, n, o2, i3, s, u2, f, p4, g3) {
        var b2 = n.lanes | n.childLanes;
        if (jb = b2, b2 |= pb, Kt(e2, o2, b2, i3, s, u2), wf = null, (o2 & 335544064) === o2 ? (Pf = Af(e2), i3 = 10262) : (Pf = null, i3 = 10256), n.actualDuration !== 0 || (n.subtreeFlags & i3) !== 0 || (n.flags & i3) !== 0 ? (e2.callbackNode = null, e2.callbackPriority = 0, T0(P2, function() {
          return Qe(), ro === p0 && (ro = Lb), Yp(), null;
        })) : (e2.callbackNode = null, e2.callbackPriority = 0), Mi = null, Hi = Tn(), p4 !== null && Ns(g3, Hi, p4, kn), Yg = false, p4 = (n.flags & 13878) !== 0, (n.subtreeFlags & 13878) !== 0 || p4) {
          p4 = N2.T, N2.T = null, g3 = fr(), Je(2), i3 = ve, ve |= Fo;
          try {
            kd(e2, n, o2);
          } finally {
            ve = i3, Je(g3), N2.T = p4;
          }
        }
        pn = t1, Yg ? (Xu |= o2, br = null, kf = Ou(f, e2.containerInfo, Pf, Zp, Xp, z0, Nd, Yp, Gp, Jp, C0.bind(null, o2))) : (Zp(), Xp(), Nd());
      }
      function Gp(e2) {
        if (pn !== ni) {
          var n = pa.onRecoverableError;
          n(e2, lg(null));
        }
      }
      function Jp(e2) {
        sa = Tn(), lm(g0 === null ? m0 : Hi, sa, Mi, ro === tm, kn), g0 = Wb = e2;
      }
      function C0(e2) {
        if ((Xu & e2) !== 0) {
          var n = br;
          Xu &= ~e2, br = null, (e2 & 4194048) !== 0 && (te & 4194048) === 0 && (wr & 4194048) === 0 && (zn(256), Pr(ua, Re(), n)), (e2 & 62914560) !== 0 && (te & 62914560) === 0 && (wr & 62914560) === 0 && (zn(4194304), Pr(nb, Re(), n)), (e2 & 2080374784) !== 0 && (te & 2080374784) === 0 && (wr & 2080374784) === 0 && (zn(268435456), Pr(tb, Re(), n));
        }
      }
      function z0() {
        pn === Fb && (pn = ni, wd(dc, pa), pn = Db);
      }
      function Zp() {
        if (pn === t1) {
          pn = ni;
          var e2 = pa, n = dc, o2 = wr, i3 = (n.flags & 13878) !== 0;
          if ((n.subtreeFlags & 13878) !== 0 || i3) {
            i3 = N2.T, N2.T = null;
            var s = fr();
            Je(2);
            var u2 = ve;
            ve |= Fo;
            try {
              yf = o2, vf = e2, qh = n0 = false, Ws(), Wm(n, e2, o2), vf = yf = null, fh(e2.containerInfo);
            } finally {
              ve = u2, Je(s), N2.T = i3;
            }
          }
          e2.current = n, pn = r1;
        }
      }
      function Xp() {
        if (pn === r1) {
          pn = ni;
          var e2 = Wb;
          if (e2 !== null) {
            Hi = Tn();
            var n = sa, o2 = Hi;
            !Ke || o2 <= n || (br ? br.run(console.timeStamp.bind(console, e2, n, o2, me, "Scheduler \u269B", "secondary-light")) : console.timeStamp(e2, n, o2, me, "Scheduler \u269B", "secondary-light"));
          }
          e2 = pa, n = dc, o2 = wr;
          var i3 = (n.flags & 8772) !== 0;
          if ((n.subtreeFlags & 8772) !== 0 || i3) {
            i3 = N2.T, N2.T = null;
            var s = fr();
            Je(2);
            var u2 = ve;
            ve |= Fo;
            try {
              yf = o2, vf = e2, Ws(), Dm(e2, n.alternate, n), vf = yf = null;
            } finally {
              ve = u2, Je(s), N2.T = i3;
            }
          }
          e2 = m0, n = g0, sa = Tn(), lm(n === null ? e2 : Hi, sa, Mi, ro === tm, kn), pn = Fb;
        }
      }
      function Nd() {
        if (pn === Db || pn === Fb) {
          if (pn === Db) {
            var e2 = sa;
            sa = Tn();
            var n = sa, o2 = ro === tm;
            !Ke || n <= e2 || (br ? br.run(console.timeStamp.bind(console, o2 ? "Interrupted View Transition" : "Starting Animation", e2, n, me, "Scheduler \u269B", o2 ? "error" : "secondary-light")) : console.timeStamp(o2 ? "Interrupted View Transition" : "Starting Animation", e2, n, me, "Scheduler \u269B", o2 ? " error" : "secondary-light")), ro !== tm && (ro = n1);
          }
          pn = ni, e2 = kf, kf = null, Ne(), n = pa;
          var i3 = dc;
          o2 = wr;
          var s = o1, u2 = (o2 & 335544064) === o2 ? 10262 : 10256;
          (u2 = i3.actualDuration !== 0 || (i3.subtreeFlags & u2) !== 0 || (i3.flags & u2) !== 0) ? pn = h0 : (pn = ni, dc = pa = null, sg(n, n.pendingLanes), fc = 0, om = null);
          var f = n.pendingLanes;
          if (f === 0 && (vs = null), u2 || fg(n), f = ya(o2), i3 = i3.stateNode, M3 && typeof M3.onCommitFiberRoot == "function") try {
            var p4 = (i3.current.flags & 128) === 128;
            switch (f) {
              case 2:
                var g3 = ia;
                break;
              case 8:
                g3 = x2;
                break;
              case 32:
                g3 = P2;
                break;
              case 268435456:
                g3 = E3;
                break;
              default:
                g3 = P2;
            }
            M3.onCommitFiberRoot(Ue, i3, g3, p4);
          } catch (T3) {
            ie || (ie = true, console.error("React instrumentation encountered an error: %o", T3));
          }
          if (Le && n.memoizedUpdaters.clear(), w0(), s !== null) {
            p4 = N2.T, g3 = fr(), Je(2), N2.T = null;
            try {
              var b2 = n.onRecoverableError;
              for (i3 = 0; i3 < s.length; i3++) {
                var k2 = s[i3], z = lg(k2.stack);
                B(k2.source, b2, k2.value, z);
              }
            } finally {
              N2.T = p4, Je(g3);
            }
          }
          if (b2 = wf, k2 = Pf, Pf = null, b2 !== null && (wf = null, k2 === null && (k2 = []), e2 !== null)) for (z = 0; z < b2.length; z++) s = (0, b2[z])(k2), s !== void 0 && O0(e2, s);
          (wr & 3) !== 0 && Ol(), jr(n), f = n.pendingLanes, (o2 & 261930) !== 0 && (f & 42) !== 0 ? (Bg = true, n === b0 ? rm++ : (rm = 0, b0 = n)) : (rm = 0, b0 = null), u2 || xi(o2, sa), $e && Ha(), Ur(0, false);
        }
      }
      function lg(e2) {
        return e2 = {
          componentStack: e2
        }, Object.defineProperty(e2, "digest", {
          get: function() {
            console.error('You are accessing "digest" from the errorInfo object passed to onRecoverableError. This property is no longer provided as part of errorInfo but can be accessed as a property of the Error instance itself.');
          }
        }), e2;
      }
      function sg(e2, n) {
        (e2.pooledCacheLanes &= n) === 0 && (n = e2.pooledCache, n != null && (e2.pooledCache = null, Bt(n)));
      }
      function Ol() {
        return kf !== null && (Yl(kf), a1 || (a1 = true, console.warn("A flushSync update cancelled a View Transition because it was called while the View Transition was still preparing. To preserve the synchronous semantics, React had to skip the View Transition. If you can, try to avoid flushSync() in a scenario that's likely to interfere.")), kf = null, ro = tm), Zp(), Xp(), Nd(), Yp();
      }
      function Yp() {
        if (pn !== h0) return false;
        var e2 = pa, n = jb;
        jb = 0;
        var o2 = ya(wr), i3 = 32 > o2 ? 32 : o2;
        o2 = N2.T;
        var s = fr();
        try {
          Je(i3), N2.T = null;
          var u2 = Ub;
          Ub = null, i3 = pa;
          var f = wr;
          if (pn = ni, dc = pa = null, wr = 0, (ve & (pt | Fo)) !== ft) throw Error("Cannot flush passive effects while already rendering.");
          zn(f), Ab = true, y0 = false;
          var p4 = 0;
          if (Mi = null, p4 = Re(), ro === n1) Pr(sa, p4, br);
          else {
            var g3 = sa, b2 = p4, k2 = ro === Lb;
            !Ke || b2 <= g3 || (kn ? kn.run(console.timeStamp.bind(console, k2 ? "Waiting for Paint" : "Waiting", g3, b2, me, "Scheduler \u269B", "secondary-light")) : console.timeStamp(k2 ? "Waiting for Paint" : "Waiting", g3, b2, me, "Scheduler \u269B", "secondary-light"));
          }
          g3 = ve, ve |= Fo;
          var z = i3.current;
          Ws(), Vm(z);
          var T3 = i3.current;
          z = m0, Ws(), Hm(i3, T3, f, u2, z), fg(i3), ve = g3;
          var H = Re();
          if (T3 = p4, z = kn, Mi !== null ? jf(T3, H, Mi, true, z) : !Ke || H <= T3 || (z ? z.run(console.timeStamp.bind(console, "Remaining Effects", T3, H, me, "Scheduler \u269B", "secondary-dark")) : console.timeStamp("Remaining Effects", T3, H, me, "Scheduler \u269B", "secondary-dark")), xi(f, H), Ur(0, false), y0 ? i3 === om ? fc++ : (fc = 0, om = i3) : fc = 0, y0 = Ab = false, M3 && typeof M3.onPostCommitFiberRoot == "function") try {
            M3.onPostCommitFiberRoot(Ue, i3);
          } catch (an) {
            ie || (ie = true, console.error("React instrumentation encountered an error: %o", an));
          }
          var $ = i3.current.stateNode;
          return $.effectDuration = 0, $.passiveEffectDuration = 0, true;
        } finally {
          Je(s), N2.T = o2, sg(e2, n);
        }
      }
      function ug(e2, n, o2) {
        n = Ot(o2, n), Bf(n), n = fu(e2.stateNode, n, 2), e2 = rr(e2, n, 2), e2 !== null && (el(e2, 2), jr(e2));
      }
      function we(e2, n, o2) {
        if (xf = false, e2.tag === 3) ug(e2, e2, o2);
        else {
          for (; n !== null; ) {
            if (n.tag === 3) {
              ug(n, e2, o2);
              return;
            }
            if (n.tag === 1) {
              var i3 = n.stateNode;
              if (typeof n.type.getDerivedStateFromError == "function" || typeof i3.componentDidCatch == "function" && (vs === null || !vs.has(i3))) {
                e2 = Ot(o2, e2), Bf(e2), o2 = pu(2), i3 = rr(n, o2, 2), i3 !== null && (hu(o2, i3, n, e2), el(i3, 2), jr(i3));
                return;
              }
            }
            n = n.return;
          }
          console.error(`Internal React error: Attempted to capture a commit phase error inside a detached tree. This indicates a bug in React. Potential causes include deleting the same fiber more than once, committing an already-finished tree, or an inconsistent return pointer.

Error message:

%s`, o2);
        }
      }
      function Kp(e2, n, o2) {
        var i3 = e2.pingCache;
        if (i3 === null) {
          i3 = e2.pingCache = new O1();
          var s = /* @__PURE__ */ new Set();
          i3.set(n, s);
        } else s = i3.get(n), s === void 0 && (s = /* @__PURE__ */ new Set(), i3.set(n, s));
        s.has(o2) || (Tb = true, s.add(o2), i3 = E0.bind(null, e2, n, o2), Le && Ru(e2, o2), n.then(i3, i3));
      }
      function E0(e2, n, o2) {
        var i3 = e2.pingCache;
        i3 !== null && i3.delete(n), e2.pingedLanes |= e2.suspendedLanes & o2, e2.warmLanes &= ~o2, (o2 & 127) !== 0 ? 0 > Ga && (us = Ga = Tn(), Nh = Ug("Promise Resolved"), cs = 2) : (o2 & 4194048) !== 0 && 0 > To && (ua = To = Tn(), Ih = Ug("Promise Resolved"), eb = 2), Gm() && N2.actQueue === null && console.error(`A suspended resource finished loading inside a test, but the event was not wrapped in act(...).

When testing, code that resolves suspended data should be wrapped into act(...):

act(() => {
  /* finish loading suspended data */
});
/* assert on the output */

This ensures that you're testing the behavior the user would see in the browser. Learn more at https://react.dev/link/wrap-tests-with-act`), Ge === e2 && (te & o2) === o2 && ((fn === gs || fn === s0 && (te & 62914560) === te && Re() - f0 < e1) && (ve & pt) === ft ? Yo(e2, 0) : Ib |= o2, cc === te && (cc = 0)), jr(e2);
      }
      function cg(e2, n) {
        n === 0 && (n = ws()), e2 = tt(e2, n), e2 !== null && (el(e2, n), jr(e2));
      }
      function _0(e2) {
        var n = e2.memoizedState, o2 = 0;
        n !== null && (o2 = n.retryLane), cg(e2, o2);
      }
      function N0(e2, n) {
        var o2 = 0;
        switch (e2.tag) {
          case 31:
          case 13:
            var i3 = e2.stateNode, s = e2.memoizedState;
            s !== null && (o2 = s.retryLane);
            break;
          case 19:
            i3 = e2.stateNode;
            break;
          case 22:
            i3 = e2.stateNode._retryCache;
            break;
          default:
            throw Error("Pinged unknown suspense boundary type. This is probably a bug in React.");
        }
        i3 !== null && i3.delete(n), cg(e2, o2);
      }
      function eh(e2, n, o2) {
        if ((n.subtreeFlags & 134225920) !== 0) for (n = n.child; n !== null; ) {
          var i3 = e2, s = n, u2 = s.type === Ml;
          u2 = o2 || u2, s.tag !== 22 ? s.flags & 134217728 ? u2 && B(s, dg, i3, s) : eh(i3, s, u2) : s.memoizedState === null && (u2 && s.flags & 134225920 ? B(s, dg, i3, s) : s.subtreeFlags & 134217728 && B(s, eh, i3, s, u2)), n = n.sibling;
        }
      }
      function dg(e2, n) {
        Oe(true);
        try {
          Om(n, ac), $m(n), Bm(e2, n.alternate, n, ac), Ul(e2, n, 0, null, false, 0);
        } finally {
          Oe(false);
        }
      }
      function fg(e2) {
        var n = true;
        e2.current.mode & 24 || (n = false), eh(e2, e2.current, n);
      }
      function pg(e2) {
        if ((ve & pt) === ft) {
          var n = e2.tag;
          if (n === 3 || n === 1 || n === 0 || n === 11 || n === 14 || n === 15) {
            if (n = G(e2) || "ReactComponent", v0 !== null) {
              if (v0.has(n)) return;
              v0.add(n);
            } else v0 = /* @__PURE__ */ new Set([n]);
            B(e2, function() {
              console.error("Can't perform a React state update on a component that hasn't mounted yet. This indicates that you have a side-effect in your render function that asynchronously tries to update the component. Move this work to useEffect instead.");
            });
          }
        }
      }
      function Ru(e2, n) {
        Le && e2.memoizedUpdaters.forEach(function(o2) {
          Rf(e2, o2, n);
        });
      }
      function T0(e2, n) {
        var o2 = N2.actQueue;
        return o2 !== null ? (o2.push(n), M1) : U(e2, n);
      }
      function I0(e2) {
        Gm() && N2.actQueue === null && B(e2, function() {
          console.error(`An update to %s inside a test was not wrapped in act(...).

When testing, code that causes React state updates should be wrapped into act(...):

act(() => {
  /* fire events that update state */
});
/* assert on the output */

This ensures that you're testing the behavior the user would see in the browser. Learn more at https://react.dev/link/wrap-tests-with-act`, G(e2));
        });
      }
      function Bl(e2) {
        if (Zi === null) return e2;
        var n = Zi(e2);
        return n === void 0 ? e2 : n.current;
      }
      function hg(e2, n) {
        if (Zi === null) return false;
        var o2 = Zi, i3 = e2.elementType;
        n = n.type;
        var s = false, u2 = typeof n == "object" && n !== null ? n.$$typeof : null;
        switch (e2.tag) {
          case 1:
            typeof n == "function" && (s = true);
            break;
          case 0:
            (typeof n == "function" || u2 === qn) && (s = true);
            break;
          case 11:
            (u2 === Fd || u2 === qn) && (s = true);
            break;
          case 14:
          case 15:
            (u2 === Ei || u2 === qn) && (s = true);
            break;
          default:
            return false;
        }
        return !!(s && (e2 = o2(i3), e2 !== void 0 && e2 === o2(n)));
      }
      function mg(e2) {
        Zi !== null && typeof WeakSet == "function" && (Cf === null && (Cf = /* @__PURE__ */ new WeakSet()), Cf.add(e2));
      }
      function gg(e2, n, o2) {
        do {
          var i3 = e2, s = i3.alternate, u2 = i3.child, f = i3.sibling, p4 = i3.tag, g3 = i3.type, b2 = i3.elementType, k2 = null;
          switch (i3 = null, p4) {
            case 0:
            case 1:
              k2 = g3;
              break;
            case 15:
              k2 = g3, i3 = b2;
              break;
            case 14:
              i3 = b2;
              break;
            case 11:
              k2 = g3.render, i3 = b2;
          }
          if (Zi === null) throw Error("Expected resolveFamily to be set during hot reload.");
          var z = Zi;
          if (g3 = b2 = false, k2 !== null && (k2 = z(k2), k2 !== void 0 && (o2.has(k2) ? g3 = true : n.has(k2) && (p4 === 1 ? g3 = true : b2 = true))), g3 || i3 === null || (p4 = z(i3), p4 !== void 0 && o2.has(p4) ? g3 = true : typeof i3 == "object" && i3.$$typeof === qn && (p4 = i3._payload, p4._status === 1 && (p4 = z(p4._result.default), p4 !== void 0 && o2.has(p4) && (g3 = true)))), Cf !== null && (Cf.has(e2) || s !== null && Cf.has(s)) && (g3 = true), g3 && (e2._debugNeedsRemount = true), (g3 || b2) && (s = tt(e2, 2), s !== null && nn(s, e2, 2)), u2 === null || g3 || gg(u2, n, o2), f === null) break;
          e2 = f;
        } while (true);
      }
      function R0(e2, n, o2, i3) {
        this.tag = e2, this.key = o2, this.sibling = this.child = this.return = this.stateNode = this.type = this.elementType = null, this.index = 0, this.refCleanup = this.ref = null, this.pendingProps = n, this.dependencies = this.memoizedState = this.updateQueue = this.memoizedProps = null, this.mode = i3, this.subtreeFlags = this.flags = 0, this.deletions = null, this.childLanes = this.lanes = 0, this.alternate = null, this.actualDuration = -0, this.actualStartTime = -1.1, this.treeBaseDuration = this.selfBaseDuration = -0, this._debugTask = this._debugStack = this._debugOwner = this._debugInfo = null, this._debugNeedsRemount = false, this._debugHookTypes = null, s1 || typeof Object.preventExtensions != "function" || Object.preventExtensions(this);
      }
      function nh(e2) {
        return e2 = e2.prototype, !(!e2 || !e2.isReactComponent);
      }
      function Ko(e2, n) {
        var o2 = e2.alternate;
        switch (o2 === null ? (o2 = ht(e2.tag, n, e2.key, e2.mode), o2.elementType = e2.elementType, o2.type = e2.type, o2.stateNode = e2.stateNode, o2._debugOwner = e2._debugOwner, o2._debugStack = e2._debugStack, o2._debugTask = e2._debugTask, o2._debugHookTypes = e2._debugHookTypes, o2.alternate = e2, e2.alternate = o2) : (o2.pendingProps = n, o2.type = e2.type, o2.flags = 0, o2.subtreeFlags = 0, o2.deletions = null, o2.actualDuration = -0, o2.actualStartTime = -1.1), o2.flags = e2.flags & 1206910976, o2.childLanes = e2.childLanes, o2.lanes = e2.lanes, o2.child = e2.child, o2.memoizedProps = e2.memoizedProps, o2.memoizedState = e2.memoizedState, o2.updateQueue = e2.updateQueue, n = e2.dependencies, o2.dependencies = n === null ? null : {
          lanes: n.lanes,
          firstContext: n.firstContext,
          _debugThenableState: n._debugThenableState
        }, o2.sibling = e2.sibling, o2.index = e2.index, o2.ref = e2.ref, o2.refCleanup = e2.refCleanup, o2.selfBaseDuration = e2.selfBaseDuration, o2.treeBaseDuration = e2.treeBaseDuration, o2._debugInfo = e2._debugInfo, o2._debugNeedsRemount = e2._debugNeedsRemount, o2.tag) {
          case 0:
          case 15:
          case 14:
          case 1:
          case 11:
            o2.type = Bl(e2.type);
        }
        return o2;
      }
      function bg(e2, n) {
        e2.flags &= 1206910978;
        var o2 = e2.alternate;
        return o2 === null ? (e2.childLanes = 0, e2.lanes = n, e2.child = null, e2.subtreeFlags = 0, e2.memoizedProps = null, e2.memoizedState = null, e2.updateQueue = null, e2.dependencies = null, e2.stateNode = null, e2.selfBaseDuration = 0, e2.treeBaseDuration = 0) : (e2.childLanes = o2.childLanes, e2.lanes = o2.lanes, e2.child = o2.child, e2.subtreeFlags = 0, e2.deletions = null, e2.memoizedProps = o2.memoizedProps, e2.memoizedState = o2.memoizedState, e2.updateQueue = o2.updateQueue, e2.type = o2.type, n = o2.dependencies, e2.dependencies = n === null ? null : {
          lanes: n.lanes,
          firstContext: n.firstContext,
          _debugThenableState: n._debugThenableState
        }, e2.selfBaseDuration = o2.selfBaseDuration, e2.treeBaseDuration = o2.treeBaseDuration), e2;
      }
      function Td(e2, n, o2, i3, s, u2) {
        var f = 0, p4 = Bl(e2);
        if (typeof p4 == "function") nh(p4) && (f = 1);
        else if (typeof p4 == "string") Ze && je ? (f = Cr(), f = Kd(e2, o2, f) ? 26 : Qu(e2) ? 27 : 5) : Ze ? (f = Cr(), f = Kd(e2, o2, f) ? 26 : 5) : f = je && Qu(e2) ? 27 : 5;
        else e: switch (p4) {
          case $l:
            return n = ht(31, o2, n, s), n.elementType = $l, n.lanes = u2, n;
          case Qr:
            return zi(o2.children, s, u2, n);
          case Ml:
            f = 8, s |= 24;
            break;
          case Wa:
            return e2 = o2, i3 = s, typeof e2.id != "string" && console.error('Profiler must specify an "id" of type `string` as a prop. Received the type `%s` instead.', typeof e2.id), n = ht(12, e2, n, i3 | 2), n.elementType = Wa, n.lanes = u2, n.stateNode = {
              effectDuration: 0,
              passiveEffectDuration: 0
            }, n;
          case lh:
            return n = ht(13, o2, n, s), n.elementType = lh, n.lanes = u2, n;
          case Vl:
            return n = ht(19, o2, n, s), n.elementType = Vl, n.lanes = u2, n;
          case sh:
          case uh:
            return e2 = s | 32, n = ht(30, o2, n, e2), n.elementType = uh, n.lanes = u2, n.stateNode = {
              autoName: null,
              paired: null,
              clones: null,
              ref: null
            }, n;
          default:
            if (typeof p4 == "object" && p4 !== null) switch (p4.$$typeof) {
              case sn:
                f = 10;
                break e;
              case Aa:
                f = 9;
                break e;
              case Fd:
                f = 11;
                break e;
              case Ei:
                f = 14;
                break e;
              case qn:
                f = 16, p4 = null;
                break e;
            }
            o2 = "", (e2 === void 0 || typeof e2 == "object" && e2 !== null && Object.keys(e2).length === 0) && (o2 += " You likely forgot to export your component from the file it's defined in, or you might have mixed up default and named imports."), e2 === null ? p4 = "null" : Gn(e2) ? p4 = "array" : e2 !== void 0 && e2.$$typeof === xo ? (p4 = "<" + (en(e2.type) || "Unknown") + " />", o2 = " Did you accidentally export a JSX literal instead of a component?") : p4 = typeof e2, f = i3 ? typeof i3.tag == "number" ? G(i3) : typeof i3.name == "string" ? i3.name : null : null, f && (o2 += `

Check the render method of \`` + f + "`."), f = 29, o2 = Error("Element type is invalid: expected a string (for built-in components) or a class/function (for composite components) but got: " + (p4 + "." + o2)), p4 = null;
        }
        return n = ht(f, o2, n, s), n.elementType = e2, n.type = p4, n.lanes = u2, n._debugOwner = i3, n;
      }
      function Id(e2, n, o2) {
        return n = Td(e2.type, e2.key, e2.props, e2._owner, n, o2), n._debugOwner = e2._owner, n._debugStack = e2._debugStack, n._debugTask = e2._debugTask, n;
      }
      function zi(e2, n, o2, i3) {
        return e2 = ht(7, e2, i3, n), e2.lanes = o2, e2;
      }
      function Nt(e2, n, o2) {
        return e2 = ht(6, e2, null, n), e2.lanes = o2, e2;
      }
      function th(e2) {
        var n = ht(18, null, null, Z);
        return n.stateNode = e2, n;
      }
      function Hl(e2, n, o2) {
        return n = ht(4, e2.children !== null ? e2.children : [], e2.key, n), n.lanes = o2, n.stateNode = {
          containerInfo: e2.containerInfo,
          pendingChildren: null,
          implementation: e2.implementation
        }, n;
      }
      function yg(e2, n, o2, i3, s, u2, f, p4, g3) {
        for (this.tag = 1, this.containerInfo = e2, this.pingCache = this.current = this.pendingChildren = null, this.timeoutHandle = Wn, this.callbackNode = this.next = this.pendingContext = this.context = this.cancelPendingCommit = null, this.callbackPriority = 0, this.expirationTimes = Tf(-1), this.entangledLanes = this.shellSuspendCounter = this.errorRecoveryDisabledLanes = this.expiredLanes = this.warmLanes = this.pingedLanes = this.suspendedLanes = this.pendingLanes = 0, this.entanglements = Tf(0), this.hiddenUpdates = Tf(null), this.identifierPrefix = i3, this.onUncaughtError = s, this.onCaughtError = u2, this.onRecoverableError = f, this.pooledCache = null, this.pooledCacheLanes = 0, this.formState = g3, this.transitionTypes = null, this.incompleteTransitions = /* @__PURE__ */ new Map(), this.passiveEffectDuration = this.effectDuration = -0, this.memoizedUpdaters = /* @__PURE__ */ new Set(), e2 = this.pendingUpdatersLaneMap = [], n = 0; 31 > n; n++) e2.push(/* @__PURE__ */ new Set());
        this._debugRootType = o2 ? "hydrateRoot()" : "createRoot()";
      }
      function rh(e2, n, o2, i3, s, u2, f, p4, g3, b2, k2, z) {
        return e2 = new yg(e2, n, o2, f, g3, b2, k2, z, p4), n = 1, u2 === true && (n |= 24), u2 = ht(3, null, null, n | 2), e2.current = u2, u2.stateNode = e2, n = pl(), Mo(n), e2.pooledCache = n, Mo(n), u2.memoizedState = {
          element: i3,
          isDehydrated: o2,
          cache: n
        }, Lc(u2), e2;
      }
      function oh(e2) {
        return "" + e2;
      }
      function vg(e2) {
        return e2 ? (e2 = c, e2) : c;
      }
      function Rd(e2, n, o2, i3) {
        return Ld(n.current, 2, e2, n, o2, i3), 2;
      }
      function Ld(e2, n, o2, i3, s, u2) {
        if (M3 && typeof M3.onScheduleFiberRoot == "function") try {
          M3.onScheduleFiberRoot(Ue, i3, o2);
        } catch (f) {
          ie || (ie = true, console.error("React instrumentation encountered an error: %o", f));
        }
        s = vg(s), i3.context === null ? i3.context = s : i3.pendingContext = s, Qa && Bi !== null && !u1 && (u1 = true, console.error(`Render methods should be a pure function of props and state; triggering nested component updates from render is not allowed. If necessary, trigger nested updates in componentDidUpdate.

Check the render method of %s.`, G(Bi) || "Unknown")), i3 = Vo(n), i3.payload = {
          element: o2
        }, u2 = u2 === void 0 ? null : u2, u2 !== null && (typeof u2 != "function" && console.error("Expected the last optional `callback` argument to be a function. Instead received: %s.", u2), i3.callback = u2), o2 = rr(e2, i3, n), o2 !== null && (tr(n, "root.render()", null), nn(o2, e2, n), Sl(o2, e2, n));
      }
      function ah(e2, n) {
        if (e2 = e2.memoizedState, e2 !== null && e2.dehydrated !== null) {
          var o2 = e2.retryLane;
          e2.retryLane = o2 !== 0 && o2 < n ? o2 : n;
        }
      }
      function ih(e2, n) {
        ah(e2, n), (e2 = e2.alternate) && ah(e2, n);
      }
      function L0() {
        return Bi;
      }
      var ce = {}, F0 = import_react3.default, be = import_scheduler.default, Un = Object.assign, D0 = /* @__PURE__ */ Symbol.for("react.element"), xo = /* @__PURE__ */ Symbol.for("react.transitional.element"), Ua = /* @__PURE__ */ Symbol.for("react.portal"), Qr = /* @__PURE__ */ Symbol.for("react.fragment"), Ml = /* @__PURE__ */ Symbol.for("react.strict_mode"), Wa = /* @__PURE__ */ Symbol.for("react.profiler"), Aa = /* @__PURE__ */ Symbol.for("react.consumer"), sn = /* @__PURE__ */ Symbol.for("react.context"), Fd = /* @__PURE__ */ Symbol.for("react.forward_ref"), lh = /* @__PURE__ */ Symbol.for("react.suspense"), Vl = /* @__PURE__ */ Symbol.for("react.suspense_list"), Ei = /* @__PURE__ */ Symbol.for("react.memo"), qn = /* @__PURE__ */ Symbol.for("react.lazy");
      var $l = /* @__PURE__ */ Symbol.for("react.activity"), sh = /* @__PURE__ */ Symbol.for("react.legacy_hidden");
      var j0 = /* @__PURE__ */ Symbol.for("react.memo_cache_sentinel"), uh = /* @__PURE__ */ Symbol.for("react.view_transition"), Tt = /* @__PURE__ */ Symbol.for("react.recoverable"), ch = Symbol.iterator, Sg = /* @__PURE__ */ Symbol.for("react.optimistic_key"), dh = /* @__PURE__ */ Symbol.for("react.client.reference"), Gn = Array.isArray, N2 = F0.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE, U0 = m2.rendererVersion, Lu = m2.rendererPackageName, It = m2.extraDevToolsConfig, Ql = m2.getPublicInstance, $t = m2.getRootHostContext, kg = m2.getChildHostContext, W0 = m2.prepareForCommit, fh = m2.resetAfterCommit, wg = m2.createInstance;
      m2.cloneMutableInstance;
      var Fu = m2.appendInitialChild, ph = m2.finalizeInitialChildren, ea = m2.shouldSetTextContent, _i = m2.createTextInstance;
      m2.cloneMutableTextInstance;
      var Dd = m2.scheduleTimeout, Du = m2.cancelTimeout, Wn = m2.noTimeout, yn = m2.isPrimaryRenderer;
      m2.warnsIfNotActing;
      var _e = m2.supportsMutation, _n = m2.supportsPersistence, $e = m2.supportsHydration, Jn = m2.getInstanceFromNode;
      m2.beforeActiveInstanceBlur;
      var ju = m2.preparePortalMount;
      m2.prepareScopeUpdate, m2.getInstanceFromScope;
      var Je = m2.setCurrentUpdatePriority, fr = m2.getCurrentUpdatePriority, Nn = m2.resolveUpdatePriority, Qe = m2.trackSchedulerEvent, ne = m2.resolveEventType, pr = m2.resolveEventTimeStamp, hr = m2.shouldAttemptEagerTransition, hh = m2.detachDeletedInstance;
      m2.requestPostPaintCallback;
      var jd = m2.maySuspendCommit, Ni = m2.maySuspendCommitOnUpdate, qr = m2.maySuspendCommitInSyncRender, Pg = m2.preloadInstance, A0 = m2.startSuspendingCommit, xg = m2.suspendInstance, tn = m2.suspendOnActiveViewTransition, Uu = m2.waitForCommitToBeReady, ql = m2.getSuspendedCommitReason, Gr = m2.NotPendingTransition, Jr = m2.HostTransitionContext, Ud = m2.resetFormInstance, mh = m2.bindToConsole, Ti = m2.supportsMicrotasks, Wu = m2.scheduleMicrotask, Oa = m2.supportsTestSelectors, Ii = m2.findFiberRoot, Gl = m2.getBoundingRect, Cg = m2.getTextContent, Zr = m2.isHiddenSubtree, Jl = m2.matchAccessibilityRole, gh = m2.setFocusIfFocusable, Wd = m2.setupIntersectionObserver, Ad = m2.appendChild, Ri = m2.appendChildToContainer, Zl = m2.commitTextUpdate, Au = m2.commitMount, Li = m2.commitUpdate, zg = m2.insertBefore, mr = m2.insertInContainerBefore, Xl = m2.removeChild, bh = m2.removeChildFromContainer, na = m2.resetTextContent, yh = m2.hideInstance, Ba = m2.hideTextInstance, Od = m2.unhideInstance, Zn = m2.unhideTextInstance, lt = m2.applyViewTransitionName, Xn = m2.restoreViewTransitionName, ta = m2.cancelViewTransitionName, re = m2.cancelRootViewTransitionName, De = m2.restoreRootViewTransitionName;
      m2.cloneRootViewTransitionContainer, m2.removeRootViewTransitionClone;
      var un = m2.measureInstance, Bd = m2.measureClonedInstance, ra = m2.wasInstanceInViewport, Fi = m2.hasInstanceChanged, Hd = m2.hasInstanceAffectedParent, Ou = m2.startViewTransition;
      m2.startGestureTransition;
      var Yl = m2.stopViewTransition, O0 = m2.addViewTransitionFinishedListener;
      m2.getCurrentGestureOffset;
      var Bu = m2.createViewTransitionInstance, Eg = m2.clearContainer, _g = m2.createFragmentInstance, B0 = m2.updateFragmentInstanceFiber, Md = m2.commitNewChildToFragmentInstance, vh = m2.deleteChildFromFragmentInstance, Pn = m2.cloneInstance, Vd = m2.createContainerChildSet, Yn = m2.appendChildToContainerChildSet, $d = m2.finalizeContainerChildren, Rt = m2.replaceContainerChildren, Xr = m2.cloneHiddenInstance, vt = m2.cloneHiddenTextInstance, xn = m2.isSuspenseInstancePending, Ce = m2.isSuspenseInstanceFallback, Co = m2.getSuspenseInstanceFallbackErrorDetails, Sh = m2.registerSuspenseInstanceRetry, Ng = m2.canHydrateFormStateMarker, An = m2.isFormStateMarkerMatching, gr = m2.getNextHydratableSibling, Hu = m2.getNextHydratableSiblingAfterSingleton, Qd = m2.getFirstHydratableChild, kh = m2.getFirstHydratableChildWithinContainer, Cn = m2.getFirstHydratableChildWithinActivityInstance, Lt = m2.getFirstHydratableChildWithinSuspenseInstance, Yr = m2.getFirstHydratableChildWithinSingleton, Di = m2.canHydrateInstance, H0 = m2.canHydrateTextInstance, qd = m2.canHydrateActivityInstance, Gd = m2.canHydrateSuspenseInstance, Jd = m2.hydrateInstance, Zd = m2.hydrateTextInstance, Xd = m2.hydrateActivityInstance, Mu = m2.hydrateSuspenseInstance, M0 = m2.getNextHydratableInstanceAfterActivityInstance, de = m2.getNextHydratableInstanceAfterSuspenseInstance, Be = m2.commitHydratedInstance, he = m2.commitHydratedContainer, ye = m2.commitHydratedActivityInstance, Ie = m2.commitHydratedSuspenseInstance, Qt = m2.finalizeHydratedChildren, Ha = m2.flushHydrationEvents;
      m2.clearActivityBoundary;
      var Kl = m2.clearSuspenseBoundary;
      m2.clearActivityBoundaryFromContainer;
      var wh = m2.clearSuspenseBoundaryFromContainer, oa = m2.hideDehydratedBoundary, cn = m2.unhideDehydratedBoundary, aa = m2.shouldDeleteUnhydratedTailInstances, Ma = m2.diffHydratedPropsForDevWarnings, Yd = m2.diffHydratedTextForDevWarnings, Ft = m2.describeHydratableInstanceForDevWarnings, es = m2.validateHydratableInstance, Vu = m2.validateHydratableTextInstance, Ze = m2.supportsResources, Kd = m2.isHostHoistableType, ji = m2.getHoistableRoot, Ph = m2.getResource, ns = m2.acquireResource, $u = m2.releaseResource, Va = m2.hydrateHoistable, Xe = m2.mountHoistable, qt = m2.unmountHoistable, $a = m2.createHoistableInstance, zo = m2.prepareToCommitHoistables, xh = m2.mayResourceSuspendCommit, ef = m2.preloadResource, Tg = m2.suspendResource, je = m2.supportsSingletons, Ui = m2.resolveSingletonInstance, ts = m2.acquireSingletonInstance, rs = m2.releaseSingletonInstance, Qu = m2.isHostSingletonType, t2 = m2.isSingletonScope, r3 = [], a = [], l2 = -1, c = {};
      Object.freeze(c);
      var d = Math.clz32 ? Math.clz32 : ga, h2 = Math.log, y = Math.LN2, C2 = 256, R = 262144, D2 = 4194304, U = be.unstable_scheduleCallback, A = be.unstable_cancelCallback, fe = be.unstable_shouldYield, Ne = be.unstable_requestPaint, Re = be.unstable_now, ia = be.unstable_ImmediatePriority, x2 = be.unstable_UserBlockingPriority, P2 = be.unstable_NormalPriority, E3 = be.unstable_IdlePriority, j2 = be.log, q = be.unstable_setDisableYieldValue, Ue = null, M3 = null, ie = false, Le = typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ < "u", Se = 0, la = 0;
      if (typeof performance == "object" && typeof performance.now == "function") var V0 = performance, Hb = function() {
        return V0.now();
      };
      else {
        var z1 = Date;
        Hb = function() {
          return z1.now();
        };
      }
      var Gt = typeof Object.is == "function" ? Object.is : nl, Mb = typeof reportError == "function" ? reportError : function(e2) {
        if (typeof window == "object" && typeof window.ErrorEvent == "function") {
          var n = new window.ErrorEvent("error", {
            bubbles: true,
            cancelable: true,
            message: typeof e2 == "object" && e2 !== null && typeof e2.message == "string" ? String(e2.message) : String(e2),
            error: e2
          });
          if (!window.dispatchEvent(n)) return;
        } else if (typeof process == "object" && typeof process.emit == "function") {
          process.emit("uncaughtException", e2);
          return;
        }
        console.error(e2);
      }, Ig = Object.prototype.hasOwnProperty, Ke = typeof console < "u" && typeof console.timeStamp == "function" && typeof performance < "u" && typeof performance.measure == "function", me = "Blocking", os = false, Wi = {
        color: "primary",
        properties: null,
        tooltipText: "",
        track: "Components \u269B"
      }, as = {
        start: -0,
        end: -0,
        detail: {
          devtools: Wi
        }
      }, E1 = ["Changed Props", ""], _1 = ["Changed Props", "This component received deeply equal props. It might benefit from useMemo or the React Compiler in its owner."], Ch = 0, Vb, $b, Qb, qb, Gb, Jb, Zb;
      xr.__reactDisabledLog = true;
      var $0, Xb, Q0 = false, q0 = new (typeof WeakMap == "function" ? WeakMap : Map)(), G0 = /* @__PURE__ */ new WeakMap(), nf = [], tf = 0, Rg = null, zh = 0, Eo = [], _o = 0, qu = null, Ai = 1, Oi = "", is2 = Wt(null), Eh = Wt(null), ls = Wt(null), Lg = Wt(null), Yb = /["'&<>\n\t]|^\s|\s$/, Bi = null, Qa = false, st = null, rn = null, le = false, qa = false, Kr = null, ss = null, No = false, J0 = Error("Hydration Mismatch Exception: This is not a real error, and should not leak into userspace. If you're seeing this, it's likely a bug in React."), Z = 0, Fg = Wt(null), Z0 = Wt(null), X0 = Wt(null), Dg = {}, jg = null, rf = null, of = false, N1 = typeof AbortController < "u" ? AbortController : function() {
        var e2 = [], n = this.signal = {
          aborted: false,
          addEventListener: function(o2, i3) {
            e2.push(i3);
          }
        };
        this.abort = function() {
          n.aborted = true, e2.forEach(function(o2) {
            return o2();
          });
        };
      }, T1 = be.unstable_scheduleCallback, I1 = be.unstable_NormalPriority, vn = {
        $$typeof: sn,
        Consumer: null,
        Provider: null,
        _currentValue: null,
        _currentValue2: null,
        _threadCount: 0,
        _currentRenderer: null,
        _currentRenderer2: null
      }, _h = null, Tn = be.unstable_now, Ug = console.createTask ? console.createTask : function() {
        return null;
      }, ut = -0, Hi = -0, sa = -0, Mi = null, Jt = -1.1, Gu = -0, dn = -0, V = -1.1, J = -1.1, on = null, Sn = false, us = -0, Ga = -1.1, Nh = null, cs = 0, Y0 = null, K0 = null, Ju = -1.1, Th = null, af = -1.1, Wg = -1.1, ua = -0, Vi = -1.1, To = -1.1, eb = 0, Ih = null, Kb = null, ey = null, ds = -1.1, Zu = null, fs = -1.1, Ag = -1.1, nb = -0, tb = -0, Xu = 0, br = null, ny = 0, Rh = -1.1, Og = false, Bg = false, lf = null, sf = null, rb = false, ob = false, Hg = false, ab = false, Yu = 0, ib = {}, Lh = null, lb = 0, ps = 0, uf = null, ty = N2.S;
      N2.S = function(e2, n) {
        if (Ky = Re(), typeof n == "object" && n !== null && typeof n.then == "function") {
          if (0 > Vi && 0 > To) {
            Vi = Tn();
            var o2 = pr(), i3 = ne();
            (o2 !== fs || i3 !== Zu) && (fs = -1.1), ds = o2, Zu = i3;
          }
          hm(e2, n);
        }
        if (_h !== null) for (o2 = lf; o2 !== null; ) js(o2, _h), o2 = o2.next;
        if (o2 = e2.types, o2 != null) {
          for (i3 = lf; i3 !== null; ) js(i3, o2), i3 = i3.next;
          if (ps !== 0) {
            i3 = _h, i3 === null && (i3 = _h = []);
            for (var s = 0; s < o2.length; s++) {
              var u2 = o2[s];
              i3.indexOf(u2) === -1 && i3.push(u2);
            }
          }
        }
        ty !== null && ty(e2, n);
      };
      var Ku = Wt(null), ca = {
        recordUnsafeLifecycleWarnings: function() {
        },
        flushPendingUnsafeLifecycleWarnings: function() {
        },
        recordLegacyContextWarning: function() {
        },
        flushLegacyContextWarning: function() {
        },
        discardPendingWarnings: function() {
        }
      }, Fh = [], Dh = [], jh = [], Uh = [], Wh = [], Ah = [], ec = /* @__PURE__ */ new Set();
      ca.recordUnsafeLifecycleWarnings = function(e2, n) {
        ec.has(e2.type) || (typeof n.componentWillMount == "function" && n.componentWillMount.__suppressDeprecationWarning !== true && Fh.push(e2), e2.mode & 8 && typeof n.UNSAFE_componentWillMount == "function" && Dh.push(e2), typeof n.componentWillReceiveProps == "function" && n.componentWillReceiveProps.__suppressDeprecationWarning !== true && jh.push(e2), e2.mode & 8 && typeof n.UNSAFE_componentWillReceiveProps == "function" && Uh.push(e2), typeof n.componentWillUpdate == "function" && n.componentWillUpdate.__suppressDeprecationWarning !== true && Wh.push(e2), e2.mode & 8 && typeof n.UNSAFE_componentWillUpdate == "function" && Ah.push(e2));
      }, ca.flushPendingUnsafeLifecycleWarnings = function() {
        var e2 = /* @__PURE__ */ new Set();
        0 < Fh.length && (Fh.forEach(function(p4) {
          e2.add(G(p4) || "Component"), ec.add(p4.type);
        }), Fh = []);
        var n = /* @__PURE__ */ new Set();
        0 < Dh.length && (Dh.forEach(function(p4) {
          n.add(G(p4) || "Component"), ec.add(p4.type);
        }), Dh = []);
        var o2 = /* @__PURE__ */ new Set();
        0 < jh.length && (jh.forEach(function(p4) {
          o2.add(G(p4) || "Component"), ec.add(p4.type);
        }), jh = []);
        var i3 = /* @__PURE__ */ new Set();
        0 < Uh.length && (Uh.forEach(function(p4) {
          i3.add(G(p4) || "Component"), ec.add(p4.type);
        }), Uh = []);
        var s = /* @__PURE__ */ new Set();
        0 < Wh.length && (Wh.forEach(function(p4) {
          s.add(G(p4) || "Component"), ec.add(p4.type);
        }), Wh = []);
        var u2 = /* @__PURE__ */ new Set();
        if (0 < Ah.length && (Ah.forEach(function(p4) {
          u2.add(G(p4) || "Component"), ec.add(p4.type);
        }), Ah = []), 0 < n.size) {
          var f = ao(n);
          console.error(`Using UNSAFE_componentWillMount in strict mode is not recommended and may indicate bugs in your code. See https://react.dev/link/unsafe-component-lifecycles for details.

* Move code with side effects to componentDidMount, and set initial state in the constructor.

Please update the following components: %s`, f);
        }
        0 < i3.size && (f = ao(i3), console.error(`Using UNSAFE_componentWillReceiveProps in strict mode is not recommended and may indicate bugs in your code. See https://react.dev/link/unsafe-component-lifecycles for details.

* Move data fetching code or side effects to componentDidUpdate.
* If you're updating state whenever props change, refactor your code to use memoization techniques or move it to static getDerivedStateFromProps. Learn more at: https://react.dev/link/derived-state

Please update the following components: %s`, f)), 0 < u2.size && (f = ao(u2), console.error(`Using UNSAFE_componentWillUpdate in strict mode is not recommended and may indicate bugs in your code. See https://react.dev/link/unsafe-component-lifecycles for details.

* Move data fetching code or side effects to componentDidUpdate.

Please update the following components: %s`, f)), 0 < e2.size && (f = ao(e2), console.warn(`componentWillMount has been renamed, and is not recommended for use. See https://react.dev/link/unsafe-component-lifecycles for details.

* Move code with side effects to componentDidMount, and set initial state in the constructor.
* Rename componentWillMount to UNSAFE_componentWillMount to suppress this warning in non-strict mode. In React 18.x, only the UNSAFE_ name will work. To rename all deprecated lifecycles to their new names, you can run \`npx react-codemod rename-unsafe-lifecycles\` in your project source folder.

Please update the following components: %s`, f)), 0 < o2.size && (f = ao(o2), console.warn(`componentWillReceiveProps has been renamed, and is not recommended for use. See https://react.dev/link/unsafe-component-lifecycles for details.

* Move data fetching code or side effects to componentDidUpdate.
* If you're updating state whenever props change, refactor your code to use memoization techniques or move it to static getDerivedStateFromProps. Learn more at: https://react.dev/link/derived-state
* Rename componentWillReceiveProps to UNSAFE_componentWillReceiveProps to suppress this warning in non-strict mode. In React 18.x, only the UNSAFE_ name will work. To rename all deprecated lifecycles to their new names, you can run \`npx react-codemod rename-unsafe-lifecycles\` in your project source folder.

Please update the following components: %s`, f)), 0 < s.size && (f = ao(s), console.warn(`componentWillUpdate has been renamed, and is not recommended for use. See https://react.dev/link/unsafe-component-lifecycles for details.

* Move data fetching code or side effects to componentDidUpdate.
* Rename componentWillUpdate to UNSAFE_componentWillUpdate to suppress this warning in non-strict mode. In React 18.x, only the UNSAFE_ name will work. To rename all deprecated lifecycles to their new names, you can run \`npx react-codemod rename-unsafe-lifecycles\` in your project source folder.

Please update the following components: %s`, f));
      };
      var Mg = /* @__PURE__ */ new Map(), ry = /* @__PURE__ */ new Set();
      ca.recordLegacyContextWarning = function(e2, n) {
        for (var o2 = null, i3 = e2; i3 !== null; ) i3.mode & 8 && (o2 = i3), i3 = i3.return;
        o2 === null ? console.error("Expected to find a StrictMode component in a strict mode tree. This error is likely caused by a bug in React. Please file an issue.") : !ry.has(e2.type) && (i3 = Mg.get(o2), e2.type.contextTypes != null || e2.type.childContextTypes != null || n !== null && typeof n.getChildContext == "function") && (i3 === void 0 && (i3 = [], Mg.set(o2, i3)), i3.push(e2));
      }, ca.flushLegacyContextWarning = function() {
        Mg.forEach(function(e2) {
          if (e2.length !== 0) {
            var n = e2[0], o2 = /* @__PURE__ */ new Set();
            e2.forEach(function(s) {
              o2.add(G(s) || "Component"), ry.add(s.type);
            });
            var i3 = ao(o2);
            B(n, function() {
              console.error(`Legacy context API has been detected within a strict-mode tree.

The old API will be supported in all 16.x releases, but applications using it should migrate to the new version.

Please update the following components: %s

Learn more about this warning here: https://react.dev/link/legacy-context`, i3);
            });
          }
        });
      }, ca.discardPendingWarnings = function() {
        Fh = [], Dh = [], jh = [], Uh = [], Wh = [], Ah = [], Mg = /* @__PURE__ */ new Map();
      };
      var R1 = "", oy = {
        react_stack_bottom_frame: function(e2, n, o2) {
          var i3 = Qa;
          Qa = true;
          try {
            return e2(n, o2);
          } finally {
            Qa = i3;
          }
        }
      }, sb = oy.react_stack_bottom_frame.bind(oy), ay = {
        react_stack_bottom_frame: function(e2) {
          var n = Qa;
          Qa = true;
          try {
            return e2.render();
          } finally {
            Qa = n;
          }
        }
      }, iy = ay.react_stack_bottom_frame.bind(ay), ly = {
        react_stack_bottom_frame: function(e2, n) {
          try {
            n.componentDidMount();
          } catch (o2) {
            we(e2, e2.return, o2);
          }
        }
      }, ub = ly.react_stack_bottom_frame.bind(ly), sy = {
        react_stack_bottom_frame: function(e2, n, o2, i3, s) {
          try {
            n.componentDidUpdate(o2, i3, s);
          } catch (u2) {
            we(e2, e2.return, u2);
          }
        }
      }, uy = sy.react_stack_bottom_frame.bind(sy), cy = {
        react_stack_bottom_frame: function(e2, n) {
          var o2 = n.stack;
          e2.componentDidCatch(n.value, {
            componentStack: o2 !== null ? o2 : ""
          });
        }
      }, L1 = cy.react_stack_bottom_frame.bind(cy), dy = {
        react_stack_bottom_frame: function(e2, n, o2) {
          try {
            o2.componentWillUnmount();
          } catch (i3) {
            we(e2, n, i3);
          }
        }
      }, fy = dy.react_stack_bottom_frame.bind(dy), py = {
        react_stack_bottom_frame: function(e2) {
          var n = e2.create;
          return e2 = e2.inst, n = n(), e2.destroy = n;
        }
      }, F1 = py.react_stack_bottom_frame.bind(py), hy = {
        react_stack_bottom_frame: function(e2, n, o2) {
          try {
            o2();
          } catch (i3) {
            we(e2, n, i3);
          }
        }
      }, D1 = hy.react_stack_bottom_frame.bind(hy), my = {
        react_stack_bottom_frame: function(e2) {
          var n = e2._init;
          return n(e2._payload);
        }
      }, j1 = my.react_stack_bottom_frame.bind(my), cf = Error("Suspense Exception: This is not a real error! It's an implementation detail of `use` to interrupt the current render. You must either rethrow it immediately, or move the `use` call outside of the `try/catch` block. Capturing without rethrowing will lead to unexpected behavior.\n\nTo handle async errors, wrap your component in an error boundary, or call the promise's `.catch` method and pass the result to `use`."), cb = Error("Suspense Exception: This is not a real error, and should not leak into userspace. If you're seeing this, it's likely a bug in React."), Vg = Error("Suspense Exception: This is not a real error! It's an implementation detail of `useActionState` to interrupt the current render. You must either rethrow it immediately, or move the `useActionState` call outside of the `try/catch` block. Capturing without rethrowing will lead to unexpected behavior.\n\nTo handle async errors, wrap your component in an error boundary."), $g = {
        then: function() {
          console.error('Internal React error: A listener was unexpectedly attached to a "noop" thenable. This is a bug in React. Please file an issue.');
        }
      }, nc = null, Qg = null, db = false, tc = null, Oh = false, df = null, Bh = 0, pe = null, fb, gy = fb = false, by = {}, yy = {}, vy = {};
      ma = function(e2, n, o2) {
        if (o2 !== null && typeof o2 == "object" && o2._store && (!o2._store.validated && o2.key == null || o2._store.validated === 2)) {
          if (typeof o2._store != "object") throw Error("React Component in warnForMissingKey should have a _store. This error is likely caused by a bug in React. Please file an issue.");
          o2._store.validated = 1;
          var i3 = G(e2), s = i3 || "null";
          if (!by[s]) {
            by[s] = true, o2 = o2._owner, e2 = e2._debugOwner;
            var u2 = "";
            e2 && typeof e2.tag == "number" && (s = G(e2)) && (u2 = `

Check the render method of \`` + s + "`."), u2 || i3 && (u2 = `

Check the top-level render call using <` + i3 + ">.");
            var f = "";
            o2 != null && e2 !== o2 && (i3 = null, typeof o2.tag == "number" ? i3 = G(o2) : typeof o2.name == "string" && (i3 = o2.name), i3 && (f = " It was passed a child from " + i3 + ".")), B(n, function() {
              console.error('Each child in a list should have a unique "key" prop.%s%s See https://react.dev/link/warning-keys for more information.', u2, f);
            });
          }
        }
      };
      var rc = $s(true), Sy = $s(false), Hh = 1, $i = 2, Io = [], ff = 0, pb = 0, ky = 0, wy = 1, Py = 2, hb = 3, hs = false, xy = false, mb = null, gb = false, ms = Wt(null), qg = Wt(0), St = Wt(null), Zt = null, pf = 1, Mh = 2, kt = Wt(0), Vh = 0, Ro = 1, Xt = 2, eo = 4, Dt = 8, hf, Cy = /* @__PURE__ */ new Set(), zy = /* @__PURE__ */ new Set(), bb = /* @__PURE__ */ new Set(), Ey = /* @__PURE__ */ new Set(), Qi = 0, X2 = null, qe = null, On = null, Gg = false, mf = false, oc = false, Jg = 0, $h = 0, Ja = null, U1 = 0, W1 = 25, _ = null, Lo = null, qi = -1, Qh = false, Zg = {
        readContext: K,
        use: Or,
        useCallback: Ee,
        useContext: Ee,
        useEffect: Ee,
        useImperativeHandle: Ee,
        useLayoutEffect: Ee,
        useInsertionEffect: Ee,
        useMemo: Ee,
        useReducer: Ee,
        useRef: Ee,
        useState: Ee,
        useDebugValue: Ee,
        useDeferredValue: Ee,
        useTransition: Ee,
        useSyncExternalStore: Ee,
        useId: Ee,
        useHostTransitionStatus: Ee,
        useFormState: Ee,
        useActionState: Ee,
        useOptimistic: Ee,
        useMemoCache: Ee,
        useCacheRefresh: Ee,
        useEffectEvent: Ee
      }, yb = null, _y = null, vb = null, Ny = null, Za = null, da = null, Xg = null;
      yb = {
        readContext: function(e2) {
          return K(e2);
        },
        use: Or,
        useCallback: function(e2, n) {
          return _ = "useCallback", ee(), Pa(n), Jc(e2, n);
        },
        useContext: function(e2) {
          return _ = "useContext", ee(), K(e2);
        },
        useEffect: function(e2, n) {
          return _ = "useEffect", ee(), Pa(n), lu(e2, n);
        },
        useImperativeHandle: function(e2, n, o2) {
          return _ = "useImperativeHandle", ee(), Pa(o2), hp(e2, n, o2);
        },
        useInsertionEffect: function(e2, n) {
          _ = "useInsertionEffect", ee(), Pa(n), qo(4, Xt, e2, n);
        },
        useLayoutEffect: function(e2, n) {
          return _ = "useLayoutEffect", ee(), Pa(n), uu(e2, n);
        },
        useMemo: function(e2, n) {
          _ = "useMemo", ee(), Pa(n);
          var o2 = N2.H;
          N2.H = Za;
          try {
            return Zc(e2, n);
          } finally {
            N2.H = o2;
          }
        },
        useReducer: function(e2, n, o2) {
          _ = "useReducer", ee();
          var i3 = N2.H;
          N2.H = Za;
          try {
            return lp(e2, n, o2);
          } finally {
            N2.H = i3;
          }
        },
        useRef: function(e2) {
          return _ = "useRef", ee(), iu(e2);
        },
        useState: function(e2) {
          _ = "useState", ee();
          var n = N2.H;
          N2.H = Za;
          try {
            return di(e2);
          } finally {
            N2.H = n;
          }
        },
        useDebugValue: function() {
          _ = "useDebugValue", ee();
        },
        useDeferredValue: function(e2, n) {
          return _ = "useDeferredValue", ee(), Xc(e2, n);
        },
        useTransition: function() {
          return _ = "useTransition", ee(), nd();
        },
        useSyncExternalStore: function(e2, n, o2) {
          return _ = "useSyncExternalStore", ee(), So(e2, n, o2);
        },
        useId: function() {
          return _ = "useId", ee(), td();
        },
        useFormState: function(e2, n) {
          return _ = "useFormState", ee(), Ys(), fi(e2, n);
        },
        useActionState: function(e2, n) {
          return _ = "useActionState", ee(), fi(e2, n);
        },
        useOptimistic: function(e2) {
          return _ = "useOptimistic", ee(), tu(e2);
        },
        useHostTransitionStatus: or,
        useMemoCache: Br,
        useCacheRefresh: function() {
          return _ = "useCacheRefresh", ee(), ar();
        },
        useEffectEvent: function(e2) {
          return _ = "useEffectEvent", ee(), zl(e2);
        }
      }, _y = {
        readContext: function(e2) {
          return K(e2);
        },
        use: Or,
        useCallback: function(e2, n) {
          return _ = "useCallback", L(), Jc(e2, n);
        },
        useContext: function(e2) {
          return _ = "useContext", L(), K(e2);
        },
        useEffect: function(e2, n) {
          return _ = "useEffect", L(), lu(e2, n);
        },
        useImperativeHandle: function(e2, n, o2) {
          return _ = "useImperativeHandle", L(), hp(e2, n, o2);
        },
        useInsertionEffect: function(e2, n) {
          _ = "useInsertionEffect", L(), qo(4, Xt, e2, n);
        },
        useLayoutEffect: function(e2, n) {
          return _ = "useLayoutEffect", L(), uu(e2, n);
        },
        useMemo: function(e2, n) {
          _ = "useMemo", L();
          var o2 = N2.H;
          N2.H = Za;
          try {
            return Zc(e2, n);
          } finally {
            N2.H = o2;
          }
        },
        useReducer: function(e2, n, o2) {
          _ = "useReducer", L();
          var i3 = N2.H;
          N2.H = Za;
          try {
            return lp(e2, n, o2);
          } finally {
            N2.H = i3;
          }
        },
        useRef: function(e2) {
          return _ = "useRef", L(), iu(e2);
        },
        useState: function(e2) {
          _ = "useState", L();
          var n = N2.H;
          N2.H = Za;
          try {
            return di(e2);
          } finally {
            N2.H = n;
          }
        },
        useDebugValue: function() {
          _ = "useDebugValue", L();
        },
        useDeferredValue: function(e2, n) {
          return _ = "useDeferredValue", L(), Xc(e2, n);
        },
        useTransition: function() {
          return _ = "useTransition", L(), nd();
        },
        useSyncExternalStore: function(e2, n, o2) {
          return _ = "useSyncExternalStore", L(), So(e2, n, o2);
        },
        useId: function() {
          return _ = "useId", L(), td();
        },
        useActionState: function(e2, n) {
          return _ = "useActionState", L(), fi(e2, n);
        },
        useFormState: function(e2, n) {
          return _ = "useFormState", L(), Ys(), fi(e2, n);
        },
        useOptimistic: function(e2) {
          return _ = "useOptimistic", L(), tu(e2);
        },
        useHostTransitionStatus: or,
        useMemoCache: Br,
        useCacheRefresh: function() {
          return _ = "useCacheRefresh", L(), ar();
        },
        useEffectEvent: function(e2) {
          return _ = "useEffectEvent", L(), zl(e2);
        }
      }, vb = {
        readContext: function(e2) {
          return K(e2);
        },
        use: Or,
        useCallback: function(e2, n) {
          return _ = "useCallback", L(), El(e2, n);
        },
        useContext: function(e2) {
          return _ = "useContext", L(), K(e2);
        },
        useEffect: function(e2, n) {
          _ = "useEffect", L(), at(2048, Dt, e2, n);
        },
        useImperativeHandle: function(e2, n, o2) {
          return _ = "useImperativeHandle", L(), hi(e2, n, o2);
        },
        useInsertionEffect: function(e2, n) {
          return _ = "useInsertionEffect", L(), at(4, Xt, e2, n);
        },
        useLayoutEffect: function(e2, n) {
          return _ = "useLayoutEffect", L(), at(4, eo, e2, n);
        },
        useMemo: function(e2, n) {
          _ = "useMemo", L();
          var o2 = N2.H;
          N2.H = da;
          try {
            return _l(e2, n);
          } finally {
            N2.H = o2;
          }
        },
        useReducer: function(e2, n, o2) {
          _ = "useReducer", L();
          var i3 = N2.H;
          N2.H = da;
          try {
            return xl(e2, n, o2);
          } finally {
            N2.H = i3;
          }
        },
        useRef: function() {
          return _ = "useRef", L(), xe().memoizedState;
        },
        useState: function() {
          _ = "useState", L();
          var e2 = N2.H;
          N2.H = da;
          try {
            return xl(ge);
          } finally {
            N2.H = e2;
          }
        },
        useDebugValue: function() {
          _ = "useDebugValue", L();
        },
        useDeferredValue: function(e2, n) {
          return _ = "useDeferredValue", L(), xt(e2, n);
        },
        useTransition: function() {
          return _ = "useTransition", L(), Vn();
        },
        useSyncExternalStore: function(e2, n, o2) {
          return _ = "useSyncExternalStore", L(), nu(e2, n, o2);
        },
        useId: function() {
          return _ = "useId", L(), xe().memoizedState;
        },
        useFormState: function(e2) {
          return _ = "useFormState", L(), Ys(), au(e2);
        },
        useActionState: function(e2) {
          return _ = "useActionState", L(), au(e2);
        },
        useOptimistic: function(e2, n) {
          return _ = "useOptimistic", L(), Vc(e2, n);
        },
        useHostTransitionStatus: or,
        useMemoCache: Br,
        useCacheRefresh: function() {
          return _ = "useCacheRefresh", L(), xe().memoizedState;
        },
        useEffectEvent: function(e2) {
          return _ = "useEffectEvent", L(), su(e2);
        }
      }, Ny = {
        readContext: function(e2) {
          return K(e2);
        },
        use: Or,
        useCallback: function(e2, n) {
          return _ = "useCallback", L(), El(e2, n);
        },
        useContext: function(e2) {
          return _ = "useContext", L(), K(e2);
        },
        useEffect: function(e2, n) {
          _ = "useEffect", L(), at(2048, Dt, e2, n);
        },
        useImperativeHandle: function(e2, n, o2) {
          return _ = "useImperativeHandle", L(), hi(e2, n, o2);
        },
        useInsertionEffect: function(e2, n) {
          return _ = "useInsertionEffect", L(), at(4, Xt, e2, n);
        },
        useLayoutEffect: function(e2, n) {
          return _ = "useLayoutEffect", L(), at(4, eo, e2, n);
        },
        useMemo: function(e2, n) {
          _ = "useMemo", L();
          var o2 = N2.H;
          N2.H = Xg;
          try {
            return _l(e2, n);
          } finally {
            N2.H = o2;
          }
        },
        useReducer: function(e2, n, o2) {
          _ = "useReducer", L();
          var i3 = N2.H;
          N2.H = Xg;
          try {
            return $o(e2, n, o2);
          } finally {
            N2.H = i3;
          }
        },
        useRef: function() {
          return _ = "useRef", L(), xe().memoizedState;
        },
        useState: function() {
          _ = "useState", L();
          var e2 = N2.H;
          N2.H = Xg;
          try {
            return $o(ge);
          } finally {
            N2.H = e2;
          }
        },
        useDebugValue: function() {
          _ = "useDebugValue", L();
        },
        useDeferredValue: function(e2, n) {
          return _ = "useDeferredValue", L(), Yc(e2, n);
        },
        useTransition: function() {
          return _ = "useTransition", L(), gp();
        },
        useSyncExternalStore: function(e2, n, o2) {
          return _ = "useSyncExternalStore", L(), nu(e2, n, o2);
        },
        useId: function() {
          return _ = "useId", L(), xe().memoizedState;
        },
        useFormState: function(e2) {
          return _ = "useFormState", L(), Ys(), Mt(e2);
        },
        useActionState: function(e2) {
          return _ = "useActionState", L(), Mt(e2);
        },
        useOptimistic: function(e2, n) {
          return _ = "useOptimistic", L(), Qc(e2, n);
        },
        useHostTransitionStatus: or,
        useMemoCache: Br,
        useCacheRefresh: function() {
          return _ = "useCacheRefresh", L(), xe().memoizedState;
        },
        useEffectEvent: function(e2) {
          return _ = "useEffectEvent", L(), su(e2);
        }
      }, Za = {
        readContext: function(e2) {
          return Te(), K(e2);
        },
        use: function(e2) {
          return W2(), Or(e2);
        },
        useCallback: function(e2, n) {
          return _ = "useCallback", W2(), ee(), Jc(e2, n);
        },
        useContext: function(e2) {
          return _ = "useContext", W2(), ee(), K(e2);
        },
        useEffect: function(e2, n) {
          return _ = "useEffect", W2(), ee(), lu(e2, n);
        },
        useImperativeHandle: function(e2, n, o2) {
          return _ = "useImperativeHandle", W2(), ee(), hp(e2, n, o2);
        },
        useInsertionEffect: function(e2, n) {
          _ = "useInsertionEffect", W2(), ee(), qo(4, Xt, e2, n);
        },
        useLayoutEffect: function(e2, n) {
          return _ = "useLayoutEffect", W2(), ee(), uu(e2, n);
        },
        useMemo: function(e2, n) {
          _ = "useMemo", W2(), ee();
          var o2 = N2.H;
          N2.H = Za;
          try {
            return Zc(e2, n);
          } finally {
            N2.H = o2;
          }
        },
        useReducer: function(e2, n, o2) {
          _ = "useReducer", W2(), ee();
          var i3 = N2.H;
          N2.H = Za;
          try {
            return lp(e2, n, o2);
          } finally {
            N2.H = i3;
          }
        },
        useRef: function(e2) {
          return _ = "useRef", W2(), ee(), iu(e2);
        },
        useState: function(e2) {
          _ = "useState", W2(), ee();
          var n = N2.H;
          N2.H = Za;
          try {
            return di(e2);
          } finally {
            N2.H = n;
          }
        },
        useDebugValue: function() {
          _ = "useDebugValue", W2(), ee();
        },
        useDeferredValue: function(e2, n) {
          return _ = "useDeferredValue", W2(), ee(), Xc(e2, n);
        },
        useTransition: function() {
          return _ = "useTransition", W2(), ee(), nd();
        },
        useSyncExternalStore: function(e2, n, o2) {
          return _ = "useSyncExternalStore", W2(), ee(), So(e2, n, o2);
        },
        useId: function() {
          return _ = "useId", W2(), ee(), td();
        },
        useFormState: function(e2, n) {
          return _ = "useFormState", W2(), ee(), fi(e2, n);
        },
        useActionState: function(e2, n) {
          return _ = "useActionState", W2(), ee(), fi(e2, n);
        },
        useOptimistic: function(e2) {
          return _ = "useOptimistic", W2(), ee(), tu(e2);
        },
        useMemoCache: function(e2) {
          return W2(), Br(e2);
        },
        useHostTransitionStatus: or,
        useCacheRefresh: function() {
          return _ = "useCacheRefresh", ee(), ar();
        },
        useEffectEvent: function(e2) {
          return _ = "useEffectEvent", W2(), ee(), zl(e2);
        }
      }, da = {
        readContext: function(e2) {
          return Te(), K(e2);
        },
        use: function(e2) {
          return W2(), Or(e2);
        },
        useCallback: function(e2, n) {
          return _ = "useCallback", W2(), L(), El(e2, n);
        },
        useContext: function(e2) {
          return _ = "useContext", W2(), L(), K(e2);
        },
        useEffect: function(e2, n) {
          _ = "useEffect", W2(), L(), at(2048, Dt, e2, n);
        },
        useImperativeHandle: function(e2, n, o2) {
          return _ = "useImperativeHandle", W2(), L(), hi(e2, n, o2);
        },
        useInsertionEffect: function(e2, n) {
          return _ = "useInsertionEffect", W2(), L(), at(4, Xt, e2, n);
        },
        useLayoutEffect: function(e2, n) {
          return _ = "useLayoutEffect", W2(), L(), at(4, eo, e2, n);
        },
        useMemo: function(e2, n) {
          _ = "useMemo", W2(), L();
          var o2 = N2.H;
          N2.H = da;
          try {
            return _l(e2, n);
          } finally {
            N2.H = o2;
          }
        },
        useReducer: function(e2, n, o2) {
          _ = "useReducer", W2(), L();
          var i3 = N2.H;
          N2.H = da;
          try {
            return xl(e2, n, o2);
          } finally {
            N2.H = i3;
          }
        },
        useRef: function() {
          return _ = "useRef", W2(), L(), xe().memoizedState;
        },
        useState: function() {
          _ = "useState", W2(), L();
          var e2 = N2.H;
          N2.H = da;
          try {
            return xl(ge);
          } finally {
            N2.H = e2;
          }
        },
        useDebugValue: function() {
          _ = "useDebugValue", W2(), L();
        },
        useDeferredValue: function(e2, n) {
          return _ = "useDeferredValue", W2(), L(), xt(e2, n);
        },
        useTransition: function() {
          return _ = "useTransition", W2(), L(), Vn();
        },
        useSyncExternalStore: function(e2, n, o2) {
          return _ = "useSyncExternalStore", W2(), L(), nu(e2, n, o2);
        },
        useId: function() {
          return _ = "useId", W2(), L(), xe().memoizedState;
        },
        useFormState: function(e2) {
          return _ = "useFormState", W2(), L(), au(e2);
        },
        useActionState: function(e2) {
          return _ = "useActionState", W2(), L(), au(e2);
        },
        useOptimistic: function(e2, n) {
          return _ = "useOptimistic", W2(), L(), Vc(e2, n);
        },
        useMemoCache: function(e2) {
          return W2(), Br(e2);
        },
        useHostTransitionStatus: or,
        useCacheRefresh: function() {
          return _ = "useCacheRefresh", L(), xe().memoizedState;
        },
        useEffectEvent: function(e2) {
          return _ = "useEffectEvent", W2(), L(), su(e2);
        }
      }, Xg = {
        readContext: function(e2) {
          return Te(), K(e2);
        },
        use: function(e2) {
          return W2(), Or(e2);
        },
        useCallback: function(e2, n) {
          return _ = "useCallback", W2(), L(), El(e2, n);
        },
        useContext: function(e2) {
          return _ = "useContext", W2(), L(), K(e2);
        },
        useEffect: function(e2, n) {
          _ = "useEffect", W2(), L(), at(2048, Dt, e2, n);
        },
        useImperativeHandle: function(e2, n, o2) {
          return _ = "useImperativeHandle", W2(), L(), hi(e2, n, o2);
        },
        useInsertionEffect: function(e2, n) {
          return _ = "useInsertionEffect", W2(), L(), at(4, Xt, e2, n);
        },
        useLayoutEffect: function(e2, n) {
          return _ = "useLayoutEffect", W2(), L(), at(4, eo, e2, n);
        },
        useMemo: function(e2, n) {
          _ = "useMemo", W2(), L();
          var o2 = N2.H;
          N2.H = da;
          try {
            return _l(e2, n);
          } finally {
            N2.H = o2;
          }
        },
        useReducer: function(e2, n, o2) {
          _ = "useReducer", W2(), L();
          var i3 = N2.H;
          N2.H = da;
          try {
            return $o(e2, n, o2);
          } finally {
            N2.H = i3;
          }
        },
        useRef: function() {
          return _ = "useRef", W2(), L(), xe().memoizedState;
        },
        useState: function() {
          _ = "useState", W2(), L();
          var e2 = N2.H;
          N2.H = da;
          try {
            return $o(ge);
          } finally {
            N2.H = e2;
          }
        },
        useDebugValue: function() {
          _ = "useDebugValue", W2(), L();
        },
        useDeferredValue: function(e2, n) {
          return _ = "useDeferredValue", W2(), L(), Yc(e2, n);
        },
        useTransition: function() {
          return _ = "useTransition", W2(), L(), gp();
        },
        useSyncExternalStore: function(e2, n, o2) {
          return _ = "useSyncExternalStore", W2(), L(), nu(e2, n, o2);
        },
        useId: function() {
          return _ = "useId", W2(), L(), xe().memoizedState;
        },
        useFormState: function(e2) {
          return _ = "useFormState", W2(), L(), Mt(e2);
        },
        useActionState: function(e2) {
          return _ = "useActionState", W2(), L(), Mt(e2);
        },
        useOptimistic: function(e2, n) {
          return _ = "useOptimistic", W2(), L(), Qc(e2, n);
        },
        useMemoCache: function(e2) {
          return W2(), Br(e2);
        },
        useHostTransitionStatus: or,
        useCacheRefresh: function() {
          return _ = "useCacheRefresh", L(), xe().memoizedState;
        },
        useEffectEvent: function(e2) {
          return _ = "useEffectEvent", W2(), L(), su(e2);
        }
      };
      var Ty = {}, Iy = /* @__PURE__ */ new Set(), Ry = /* @__PURE__ */ new Set(), Ly = /* @__PURE__ */ new Set(), Fy = /* @__PURE__ */ new Set(), Dy = /* @__PURE__ */ new Set(), jy = /* @__PURE__ */ new Set(), Uy = /* @__PURE__ */ new Set(), Wy = /* @__PURE__ */ new Set(), Ay = /* @__PURE__ */ new Set(), Oy = /* @__PURE__ */ new Set();
      Object.freeze(Ty);
      var Sb = {
        enqueueSetState: function(e2, n, o2) {
          e2 = e2._reactInternals;
          var i3 = _t(e2), s = Vo(i3);
          s.payload = n, o2 != null && (ko(o2), s.callback = o2), n = rr(e2, s, i3), n !== null && (tr(i3, "this.setState()", e2), nn(n, e2, i3), Sl(n, e2, i3));
        },
        enqueueReplaceState: function(e2, n, o2) {
          e2 = e2._reactInternals;
          var i3 = _t(e2), s = Vo(i3);
          s.tag = wy, s.payload = n, o2 != null && (ko(o2), s.callback = o2), n = rr(e2, s, i3), n !== null && (tr(i3, "this.replaceState()", e2), nn(n, e2, i3), Sl(n, e2, i3));
        },
        enqueueForceUpdate: function(e2, n) {
          e2 = e2._reactInternals;
          var o2 = _t(e2), i3 = Vo(o2);
          i3.tag = Py, n != null && (ko(n), i3.callback = n), n = rr(e2, i3, o2), n !== null && (tr(o2, "this.forceUpdate()", e2), nn(n, e2, o2), Sl(n, e2, o2));
        }
      }, gf = null, kb = null, wb = Error("This is not a real error. It's an implementation detail of React's selective hydration feature. If this leaks into userspace, it's a bug in React. Please file an issue."), In = false, By = {}, Hy = {}, My = {}, Vy = {}, bf = false, $y = {}, Pb = {}, Qy = {}, xb = {
        dehydrated: null,
        treeContext: null,
        retryLane: 0,
        hydrationErrors: null
      }, qy = false, Gy = null;
      Gy = /* @__PURE__ */ new Set();
      var jt = false, Yg = false, no = null, Xa = null, yr = 0, Kg = /* @__PURE__ */ new Map(), Jy = {}, ac = 0, Cb = 1, e0 = 2, ct = false, We = false, Ya = false, zb = false, Zy = typeof WeakSet == "function" ? WeakSet : Set, dt = null, yf = null, vf = null, Ka = false, qh = false, n0 = false, Eb = false, Bn = null, vr = false, fa = null, Kn = false, ic = 8192, A1 = {
        getCacheForType: function(e2) {
          var n = K(vn), o2 = n.data.get(e2);
          return o2 === void 0 && (o2 = e2(), n.data.set(e2, o2)), o2;
        },
        cacheSignal: function() {
          return K(vn).controller.signal;
        },
        getOwner: function() {
          return Bi;
        }
      }, t0 = 0, r0 = 1, o0 = 2, a0 = 3, i0 = 4;
      if (typeof Symbol == "function" && Symbol.for) {
        var Gh = Symbol.for;
        t0 = Gh("selector.component"), r0 = Gh("selector.has_pseudo_class"), o0 = Gh("selector.role"), a0 = Gh("selector.test_id"), i0 = Gh("selector.text");
      }
      var l0 = [], O1 = typeof WeakMap == "function" ? WeakMap : Map, ft = 0, pt = 2, Fo = 4, Gi = 0, Jh = 1, lc = 2, s0 = 3, gs = 4, Zh = 6, Xy = 5, ve = ft, Ge = null, se = null, te = 0, Sr = 0, u0 = 1, sc = 2, Xh = 3, Yy = 4, _b = 5, Yh = 6, c0 = 7, Nb = 8, uc = 9, Ae = Sr, to = null, Ji = false, Sf = false, Tb = false, ei = 0, fn = Gi, bs = 0, ys = 0, Ib = 0, kr = 0, cc = 0, Kh = null, Yt = null, d0 = false, f0 = 0, Ky = 0, e1 = 300, em = 1 / 0, Rb = 500, nm = null, kn = null, vs = null, p0 = 0, tm = 1, Lb = 2, n1 = 3, ni = 0, t1 = 1, r1 = 2, Fb = 3, Db = 4, h0 = 5, pn = 0, pa = null, dc = null, wr = 0, jb = 0, m0 = -0, Ub = null, o1 = null, kf = null, wf = null, Pf = null, g0 = null, ro = p0, Wb = null, B1 = 50, rm = 0, b0 = null, Ab = false, y0 = false, H1 = 50, fc = 0, om = null, xf = false, a1 = false, v0 = null, i1 = false, l1 = /* @__PURE__ */ new Set(), M1 = {}, Zi = null, Cf = null, s1 = false;
      try {
        var X1 = Object.preventExtensions({});
      } catch {
        s1 = true;
      }
      var u1 = false, c1 = {}, d1 = null, f1 = null, p1 = null, h1 = null, m1 = null, g1 = null, b1 = null, y1 = null, v1 = null, S1 = null;
      return d1 = function(e2, n, o2, i3) {
        n = et(e2, n), n !== null && (o2 = zf(n.memoizedState, o2, 0, i3), n.memoizedState = o2, n.baseState = o2, e2.memoizedProps = Un({}, e2.memoizedProps), o2 = tt(e2, 2), o2 !== null && nn(o2, e2, 2));
      }, f1 = function(e2, n, o2) {
        n = et(e2, n), n !== null && (o2 = pc(n.memoizedState, o2, 0), n.memoizedState = o2, n.baseState = o2, e2.memoizedProps = Un({}, e2.memoizedProps), o2 = tt(e2, 2), o2 !== null && nn(o2, e2, 2));
      }, p1 = function(e2, n, o2, i3) {
        n = et(e2, n), n !== null && (o2 = F(n.memoizedState, o2, i3), n.memoizedState = o2, n.baseState = o2, e2.memoizedProps = Un({}, e2.memoizedProps), o2 = tt(e2, 2), o2 !== null && nn(o2, e2, 2));
      }, h1 = function(e2, n, o2) {
        e2.pendingProps = zf(e2.memoizedProps, n, 0, o2), e2.alternate && (e2.alternate.pendingProps = e2.pendingProps), n = tt(e2, 2), n !== null && nn(n, e2, 2);
      }, m1 = function(e2, n) {
        e2.pendingProps = pc(e2.memoizedProps, n, 0), e2.alternate && (e2.alternate.pendingProps = e2.pendingProps), n = tt(e2, 2), n !== null && nn(n, e2, 2);
      }, g1 = function(e2, n, o2) {
        e2.pendingProps = F(e2.memoizedProps, n, o2), e2.alternate && (e2.alternate.pendingProps = e2.pendingProps), n = tt(e2, 2), n !== null && nn(n, e2, 2);
      }, b1 = function(e2) {
        var n = tt(e2, 2);
        n !== null && nn(n, e2, 2);
      }, y1 = function(e2) {
        var n = ws(), o2 = tt(e2, n);
        o2 !== null && nn(o2, e2, n);
      }, v1 = function(e2) {
        mc = e2;
      }, S1 = function(e2) {
        hc = e2;
      }, ce.attemptContinuousHydration = function(e2) {
        if (e2.tag === 13 || e2.tag === 31) {
          var n = tt(e2, 67108864);
          n !== null && nn(n, e2, 67108864), ih(e2, 67108864);
        }
      }, ce.attemptHydrationAtCurrentPriority = function(e2) {
        if (e2.tag === 13 || e2.tag === 31) {
          var n = _t(e2);
          n = xs(n);
          var o2 = tt(e2, n);
          o2 !== null && nn(o2, e2, n), ih(e2, n);
        }
      }, ce.attemptSynchronousHydration = function(e2) {
        switch (e2.tag) {
          case 3:
            if (e2 = e2.stateNode, e2.current.memoizedState.isDehydrated) {
              var n = mt(e2.pendingLanes);
              if (n !== 0) {
                for (e2.pendingLanes |= 2, e2.entangledLanes |= 2; n; ) {
                  var o2 = 1 << 31 - d(n);
                  e2.entanglements[1] |= o2, n &= ~o2;
                }
                jr(e2), (ve & (pt | Fo)) === ft && (em = Re() + Rb, Ur(0, false));
              }
            }
            break;
          case 31:
          case 13:
            n = tt(e2, 2), n !== null && nn(n, e2, 2), Cd(), ih(e2, 2);
        }
      }, ce.batchedUpdates = function(e2, n) {
        return e2(n);
      }, ce.createComponentSelector = function(e2) {
        return {
          $$typeof: t0,
          value: e2
        };
      }, ce.createContainer = function(e2, n, o2, i3, s, u2, f, p4, g3, b2) {
        return rh(e2, n, false, null, o2, i3, u2, null, f, p4, g3, b2);
      }, ce.createHasPseudoClassSelector = function(e2) {
        return {
          $$typeof: r0,
          value: e2
        };
      }, ce.createHydrationContainer = function(e2, n, o2, i3, s, u2, f, p4, g3, b2, k2, z, T3, H) {
        var _n3;
        return e2 = rh(o2, i3, true, e2, s, u2, p4, H, g3, b2, k2, z), e2.context = vg(null), o2 = e2.current, i3 = _t(o2), i3 = xs(i3), s = Vo(i3), s.callback = (_n3 = n) != null ? _n3 : null, rr(o2, s, i3), tr(i3, "hydrateRoot()", null), n = i3, e2.current.lanes = n, el(e2, n), jr(e2), e2;
      }, ce.createPortal = function(e2, n, o2) {
        var i3 = 3 < arguments.length && arguments[3] !== void 0 ? arguments[3] : null;
        if (i3 == null) i3 = null;
        else if (i3 === Sg) i3 = Sg;
        else {
          try {
            oh(i3);
            var s = false;
          } catch {
            s = true;
          }
          s && (console.error("The provided key is an unsupported type %s. This value must be coerced to a string before using it here.", typeof Symbol == "function" && Symbol.toStringTag && i3[Symbol.toStringTag] || i3.constructor.name || "Object"), oh(i3)), i3 = "" + i3;
        }
        return {
          $$typeof: Ua,
          key: i3,
          children: e2,
          containerInfo: n,
          implementation: o2
        };
      }, ce.createRoleSelector = function(e2) {
        return {
          $$typeof: o0,
          value: e2
        };
      }, ce.createTestNameSelector = function(e2) {
        return {
          $$typeof: a0,
          value: e2
        };
      }, ce.createTextSelector = function(e2) {
        return {
          $$typeof: i0,
          value: e2
        };
      }, ce.defaultOnCaughtError = function(e2) {
        var n = gf ? "The above error occurred in the <" + gf + "> component." : "The above error occurred in one of your React components.", o2 = "React will try to recreate this component tree from scratch using the error boundary you provided, " + ((kb || "Anonymous") + ".");
        typeof e2 == "object" && e2 !== null && typeof e2.environmentName == "string" ? mh("error", [`%o

%s

%s
`, e2, n, o2], e2.environmentName)() : console.error(`%o

%s

%s
`, e2, n, o2);
      }, ce.defaultOnRecoverableError = function(e2) {
        Mb(e2);
      }, ce.defaultOnUncaughtError = function(e2) {
        Mb(e2), console.warn(`%s

%s
`, gf ? "An error occurred in the <" + gf + "> component." : "An error occurred in one of your React components.", `Consider adding an error boundary to your tree to customize error handling behavior.
Visit https://react.dev/link/error-boundaries to learn more about error boundaries.`);
      }, ce.deferredUpdates = function(e2) {
        var n = N2.T, o2 = fr();
        try {
          return Je(32), N2.T = null, e2();
        } finally {
          Je(o2), N2.T = n;
        }
      }, ce.discreteUpdates = function(e2, n, o2, i3, s) {
        var u2 = N2.T, f = fr();
        try {
          return Je(2), N2.T = null, e2(n, o2, i3, s);
        } finally {
          Je(f), N2.T = u2, ve === ft && (em = Re() + Rb);
        }
      }, ce.findAllNodes = xd, ce.findBoundingRects = function(e2, n) {
        if (!Oa) throw Error("Test selector API is not supported by this renderer.");
        n = xd(e2, n), e2 = [];
        for (var o2 = 0; o2 < n.length; o2++) e2.push(Gl(n[o2]));
        for (n = e2.length - 1; 0 < n; n--) {
          o2 = e2[n];
          for (var i3 = o2.x, s = i3 + o2.width, u2 = o2.y, f = u2 + o2.height, p4 = n - 1; 0 <= p4; p4--) if (n !== p4) {
            var g3 = e2[p4], b2 = g3.x, k2 = b2 + g3.width, z = g3.y, T3 = z + g3.height;
            if (i3 >= b2 && u2 >= z && s <= k2 && f <= T3) {
              e2.splice(n, 1);
              break;
            } else if (i3 !== b2 || o2.width !== g3.width || T3 < u2 || z > f) {
              if (!(u2 !== z || o2.height !== g3.height || k2 < i3 || b2 > s)) {
                b2 > i3 && (g3.width += b2 - i3, g3.x = i3), k2 < s && (g3.width = s - b2), e2.splice(n, 1);
                break;
              }
            } else {
              z > u2 && (g3.height += z - u2, g3.y = u2), T3 < f && (g3.height = f - z), e2.splice(n, 1);
              break;
            }
          }
        }
        return e2;
      }, ce.findHostInstance = function(e2) {
        var n = e2._reactInternals;
        if (n === void 0) throw typeof e2.render == "function" ? Error("Unable to find node on an unmounted component.") : (e2 = Object.keys(e2).join(","), Error("Argument appears to not be a ReactComponent. Keys: " + e2));
        return e2 = Nf(n), e2 === null ? null : Ql(e2.stateNode);
      }, ce.findHostInstanceWithNoPortals = function(e2) {
        return e2 = am(e2), e2 = e2 !== null ? Ki(e2) : null, e2 === null ? null : Ql(e2.stateNode);
      }, ce.findHostInstanceWithWarning = function(e2, n) {
        var o2 = e2._reactInternals;
        if (o2 === void 0) throw typeof e2.render == "function" ? Error("Unable to find node on an unmounted component.") : (e2 = Object.keys(e2).join(","), Error("Argument appears to not be a ReactComponent. Keys: " + e2));
        if (e2 = Nf(o2), e2 === null) return null;
        if (e2.mode & 8) {
          var i3 = G(o2) || "Component";
          c1[i3] || (c1[i3] = true, B(e2, function() {
            o2.mode & 8 ? console.error("%s is deprecated in StrictMode. %s was passed an instance of %s which is inside StrictMode. Instead, add a ref directly to the element you want to reference. Learn more about using refs safely here: https://react.dev/link/strict-mode-find-node", n, n, i3) : console.error("%s is deprecated in StrictMode. %s was passed an instance of %s which renders StrictMode children. Instead, add a ref directly to the element you want to reference. Learn more about using refs safely here: https://react.dev/link/strict-mode-find-node", n, n, i3);
          }));
        }
        return Ql(e2.stateNode);
      }, ce.flushPassiveEffects = Ol, ce.flushSyncFromReconciler = function(e2) {
        var n = ve;
        ve |= 1;
        var o2 = N2.T, i3 = fr();
        try {
          if (Je(2), N2.T = null, e2) return e2();
        } finally {
          Je(i3), N2.T = o2, ve = n, (ve & (pt | Fo)) === ft && Ur(0, false);
        }
      }, ce.flushSyncWork = Cd, ce.focusWithin = function(e2, n) {
        if (!Oa) throw Error("Test selector API is not supported by this renderer.");
        for (e2 = Bp(e2), n = qm(e2, n), n = Array.from(n), e2 = 0; e2 < n.length; ) {
          var o2 = n[e2++], i3 = o2.tag;
          if (!Zr(o2)) {
            if ((i3 === 5 || i3 === 26 || i3 === 27) && gh(o2.stateNode)) return true;
            for (o2 = o2.child; o2 !== null; ) n.push(o2), o2 = o2.sibling;
          }
        }
        return false;
      }, ce.getFindAllNodesFailureDescription = function(e2, n) {
        if (!Oa) throw Error("Test selector API is not supported by this renderer.");
        var o2 = 0, i3 = [];
        e2 = [Bp(e2), 0];
        for (var s = 0; s < e2.length; ) {
          var u2 = e2[s++], f = u2.tag, p4 = e2[s++], g3 = n[p4];
          if ((f !== 5 && f !== 26 && f !== 27 || !Zr(u2)) && (Hp(u2, g3) && (i3.push(Mp(g3)), p4++, p4 > o2 && (o2 = p4)), p4 < n.length)) for (u2 = u2.child; u2 !== null; ) e2.push(u2, p4), u2 = u2.sibling;
        }
        if (o2 < n.length) {
          for (e2 = []; o2 < n.length; o2++) e2.push(Mp(n[o2]));
          return `findAllNodes was able to match part of the selector:
  ` + (i3.join(" > ") + `

No matching component was found for:
  `) + e2.join(" > ");
        }
        return null;
      }, ce.getPublicRootInstance = function(e2) {
        if (e2 = e2.current, !e2.child) return null;
        switch (e2.child.tag) {
          case 27:
          case 5:
            return Ql(e2.child.stateNode);
          default:
            return e2.child.stateNode;
        }
      }, ce.injectIntoDevTools = function() {
        var e2 = {
          bundleType: 1,
          version: U0,
          rendererPackageName: Lu,
          currentDispatcherRef: N2,
          reconcilerVersion: "19.3.0"
        };
        return It !== null && (e2.rendererConfig = It), e2.overrideHookState = d1, e2.overrideHookStateDeletePath = f1, e2.overrideHookStateRenamePath = p1, e2.overrideProps = h1, e2.overridePropsDeletePath = m1, e2.overridePropsRenamePath = g1, e2.scheduleUpdate = b1, e2.scheduleRetry = y1, e2.setErrorHandler = v1, e2.setSuspenseHandler = S1, e2.scheduleRefresh = gc, e2.scheduleRoot = Ss, e2.setRefreshHandler = oo, e2.getCurrentFiber = L0, Lf(e2);
      }, ce.isAlreadyRendering = $p, ce.observeVisibleRects = function(e2, n, o2, i3) {
        function s() {
          var b2 = xd(e2, n);
          u2.forEach(function(k2) {
            0 > b2.indexOf(k2) && g3(k2);
          }), b2.forEach(function(k2) {
            0 > u2.indexOf(k2) && p4(k2);
          });
        }
        if (!Oa) throw Error("Test selector API is not supported by this renderer.");
        var u2 = xd(e2, n);
        o2 = Wd(u2, o2, i3);
        var f = o2.disconnect, p4 = o2.observe, g3 = o2.unobserve;
        return l0.push(s), {
          disconnect: function() {
            var b2 = l0.indexOf(s);
            0 <= b2 && l0.splice(b2, 1), f();
          }
        };
      }, ce.shouldError = function(e2) {
        return mc(e2);
      }, ce.shouldSuspend = function(e2) {
        return hc(e2);
      }, ce.startHostTransition = function(e2, n, o2, i3) {
        if (e2.tag !== 5) throw Error("Expected the form instance to be a HostComponent. This is a bug in React.");
        var s = Dn(e2).queue;
        pm(e2), cu(e2, s, n, Gr, o2 === null ? k0 : function() {
          N2.T === null && console.error("requestFormReset was called outside a transition or action. To fix, move to an action, or wrap with startTransition.");
          var u2 = Dn(e2);
          return u2.next === null && (u2 = e2.alternate.memoizedState), mi(e2, u2.next.queue, {}, _t(e2)), o2(i3);
        });
      }, ce.updateContainer = function(e2, n, o2, i3) {
        var s = n.current, u2 = _t(s);
        return Ld(s, u2, e2, n, o2, i3), u2;
      }, ce.updateContainerSync = Rd, ce;
    }, Ut.exports.default = Ut.exports, Object.defineProperty(Ut.exports, "__esModule", {
      value: true
    });
  })(Bb)), Bb.exports;
}
var C1;
function G1() {
  return C1 || (C1 = 1, false ? S0.exports = Q1() : S0.exports = q1()), S0.exports;
}
var J1 = G1();
var Z1 = $1(J1);
function createReconciler(config) {
  const reconciler2 = Z1(config);
  reconciler2.injectIntoDevTools();
  return reconciler2;
}
var NoEventPriority = 0;
var catalogue = {};
var PREFIX_REGEX = /^three(?=[A-Z])/;
var toPascalCase = (type) => `${type[0].toUpperCase()}${type.slice(1)}`;
var i = 0;
var isConstructor = (object) => typeof object === "function";
function extend(objects) {
  if (isConstructor(objects)) {
    const Component2 = `${i++}`;
    catalogue[Component2] = objects;
    return Component2;
  } else {
    Object.assign(catalogue, objects);
  }
}
function validateInstance(type, props) {
  const name = toPascalCase(type);
  const target = catalogue[name];
  if (type !== "primitive" && !target) throw new Error(`R3F: ${name} is not part of the THREE namespace! Did you forget to extend? See: https://docs.pmnd.rs/react-three-fiber/api/objects#using-3rd-party-objects-declaratively`);
  if (type === "primitive" && !props.object) throw new Error(`R3F: Primitives without 'object' are invalid!`);
  if (props.args !== void 0 && !Array.isArray(props.args)) throw new Error("R3F: The args prop must be an array!");
}
function createInstance(type, props, root) {
  var _props$object;
  type = toPascalCase(type) in catalogue ? type : type.replace(PREFIX_REGEX, "");
  validateInstance(type, props);
  if (type === "primitive" && (_props$object = props.object) != null && _props$object.__r3f) delete props.object.__r3f;
  return prepare(props.object, root, type, props);
}
function hideInstance(instance) {
  if (!instance.isHidden) {
    var _instance$parent;
    if (instance.props.attach && (_instance$parent = instance.parent) != null && _instance$parent.object) {
      detach(instance.parent, instance);
    } else if (isObject3D(instance.object)) {
      instance.previousVisible = instance.object.visible;
      instance.object.visible = false;
    }
    instance.isHidden = true;
    invalidateInstance(instance);
  }
}
function unhideInstance(instance) {
  if (instance.isHidden) {
    var _instance$parent2;
    if (instance.props.attach && (_instance$parent2 = instance.parent) != null && _instance$parent2.object) {
      attach(instance.parent, instance);
    } else if (isObject3D(instance.object)) {
      var _instance$previousVis;
      instance.object.visible = (_instance$previousVis = instance.previousVisible) != null ? _instance$previousVis : true;
    }
    instance.previousVisible = void 0;
    instance.isHidden = false;
    invalidateInstance(instance);
  }
}
function handleContainerEffects(parent, child, beforeChild) {
  const state2 = child.root.getState();
  if (!parent.parent && parent.object !== state2.scene) return;
  if (!child.object) {
    var _child$props$object, _child$props$args;
    const target = catalogue[toPascalCase(child.type)];
    child.object = (_child$props$object = child.props.object) != null ? _child$props$object : new target(...(_child$props$args = child.props.args) != null ? _child$props$args : []);
    child.object.__r3f = child;
  }
  applyProps(child.object, child.props);
  if (child.props.attach) {
    attach(parent, child);
  } else if (isObject3D(child.object) && isObject3D(parent.object)) {
    const childIndex = parent.object.children.indexOf(beforeChild == null ? void 0 : beforeChild.object);
    if (beforeChild && childIndex !== -1) {
      const existingIndex = parent.object.children.indexOf(child.object);
      if (existingIndex !== -1) {
        parent.object.children.splice(existingIndex, 1);
        const adjustedIndex = existingIndex < childIndex ? childIndex - 1 : childIndex;
        parent.object.children.splice(adjustedIndex, 0, child.object);
      } else {
        child.object.parent = parent.object;
        parent.object.children.splice(childIndex, 0, child.object);
        child.object.dispatchEvent({
          type: "added"
        });
        parent.object.dispatchEvent({
          type: "childadded",
          child: child.object
        });
      }
    } else {
      parent.object.add(child.object);
    }
  }
  for (const childInstance of child.children) handleContainerEffects(child, childInstance);
  invalidateInstance(child);
}
function appendChild(parent, child) {
  if (!child) return;
  if (child.parent === parent) {
    const childIndex = parent.children.indexOf(child);
    if (childIndex !== -1) parent.children.splice(childIndex, 1);
  }
  child.parent = parent;
  parent.children.push(child);
  handleContainerEffects(parent, child);
}
function insertBefore(parent, child, beforeChild) {
  if (!child || !beforeChild) return;
  if (child.parent === parent) {
    const childIndex2 = parent.children.indexOf(child);
    if (childIndex2 !== -1) parent.children.splice(childIndex2, 1);
  }
  child.parent = parent;
  const childIndex = parent.children.indexOf(beforeChild);
  if (childIndex !== -1) parent.children.splice(childIndex, 0, child);
  else parent.children.push(child);
  handleContainerEffects(parent, child, beforeChild);
}
function disposeOnIdle(object) {
  if (typeof object.dispose === "function") {
    const handleDispose = () => {
      try {
        object.dispose();
      } catch {
      }
    };
    if (typeof IS_REACT_ACT_ENVIRONMENT !== "undefined") handleDispose();
    else (0, import_scheduler.unstable_scheduleCallback)(import_scheduler.unstable_IdlePriority, handleDispose);
  }
}
function removeChild(parent, child, dispose2) {
  if (!child) return;
  child.parent = null;
  const childIndex = parent.children.indexOf(child);
  if (childIndex !== -1) parent.children.splice(childIndex, 1);
  if (child.props.attach) {
    detach(parent, child);
  } else if (isObject3D(child.object) && isObject3D(parent.object)) {
    parent.object.remove(child.object);
    removeInteractivity(findInitialRoot(child), child.object);
  }
  const shouldDispose = child.props.dispose !== null && dispose2 !== false;
  for (let i3 = child.children.length - 1; i3 >= 0; i3--) {
    const node = child.children[i3];
    removeChild(child, node, shouldDispose);
  }
  child.children.length = 0;
  delete child.object.__r3f;
  if (shouldDispose && child.type !== "primitive" && child.object.type !== "Scene") {
    disposeOnIdle(child.object);
  }
  if (dispose2 === void 0) invalidateInstance(child);
}
function setFiberRef(fiber, publicInstance) {
  for (const _fiber of [fiber, fiber.alternate]) {
    if (_fiber !== null) {
      if (typeof _fiber.ref === "function") {
        _fiber.refCleanup == null ? void 0 : _fiber.refCleanup();
        const cleanup = _fiber.ref(publicInstance);
        if (typeof cleanup === "function") _fiber.refCleanup = cleanup;
      } else if (_fiber.ref) {
        _fiber.ref.current = publicInstance;
      }
    }
  }
}
var reconstructed = [];
function flushReconstructedInstances() {
  if (reconstructed.length === 0) return;
  try {
    swapReconstructedInstances();
  } finally {
    reconstructed.length = 0;
  }
}
function swapReconstructedInstances() {
  for (const [instance] of reconstructed) {
    const parent = instance.parent;
    if (parent) {
      if (instance.props.attach) {
        detach(parent, instance);
      } else if (isObject3D(instance.object) && isObject3D(parent.object)) {
        parent.object.remove(instance.object);
      }
      for (const child of instance.children) {
        if (child.props.attach) {
          detach(instance, child);
        } else if (isObject3D(child.object) && isObject3D(instance.object)) {
          instance.object.remove(child.object);
        }
      }
    }
    if (instance.isHidden) unhideInstance(instance);
    if (instance.object.__r3f) delete instance.object.__r3f;
    if (instance.type !== "primitive") disposeOnIdle(instance.object);
  }
  for (const [instance, props, fiber] of reconstructed) {
    instance.props = props;
    const parent = instance.parent;
    if (parent) {
      var _instance$props$objec, _instance$props$args;
      const target = catalogue[toPascalCase(instance.type)];
      const prevObject = instance.object;
      instance.object = (_instance$props$objec = instance.props.object) != null ? _instance$props$objec : new target(...(_instance$props$args = instance.props.args) != null ? _instance$props$args : []);
      instance.object.__r3f = instance;
      setFiberRef(fiber, instance.object);
      swapInteractivity(findInitialRoot(instance), prevObject, instance.object);
      applyProps(instance.object, instance.props);
      if (instance.props.attach) {
        attach(parent, instance);
      } else if (isObject3D(instance.object) && isObject3D(parent.object)) {
        parent.object.add(instance.object);
      }
      for (const child of instance.children) {
        if (child.props.attach) {
          attach(instance, child);
        } else if (isObject3D(child.object) && isObject3D(instance.object)) {
          instance.object.add(child.object);
        }
      }
      invalidateInstance(instance);
    }
  }
}
var handleTextInstance = () => {
};
var NO_CONTEXT = {};
var currentUpdatePriority = NoEventPriority;
function getEventPriority(type) {
  switch (type) {
    case "beforetoggle":
    case "cancel":
    case "click":
    case "close":
    case "contextmenu":
    case "copy":
    case "cut":
    case "auxclick":
    case "dblclick":
    case "dragend":
    case "dragstart":
    case "drop":
    case "focusin":
    case "focusout":
    case "input":
    case "invalid":
    case "keydown":
    case "keypress":
    case "keyup":
    case "mousedown":
    case "mouseup":
    case "paste":
    case "pause":
    case "play":
    case "pointercancel":
    case "pointerdown":
    case "pointerup":
    case "ratechange":
    case "reset":
    case "resize":
    case "seeked":
    case "submit":
    case "touchcancel":
    case "touchend":
    case "touchstart":
    case "volumechange":
    case "change":
    case "selectionchange":
    case "compositionstart":
    case "compositionend":
    case "compositionupdate":
    case "beforeinput":
    case "blur":
    case "fullscreenchange":
    case "focus":
    case "hashchange":
    case "popstate":
    case "select":
    case "selectstart":
      return e;
    case "drag":
    case "dragenter":
    case "dragexit":
    case "dragleave":
    case "dragover":
    case "mousemove":
    case "mouseout":
    case "mouseover":
    case "pointermove":
    case "pointerout":
    case "pointerover":
    case "scroll":
    case "touchmove":
    case "wheel":
    case "mouseenter":
    case "mouseleave":
    case "pointerenter":
    case "pointerleave":
      return o;
    case "message": {
      switch ((0, import_scheduler.unstable_getCurrentPriorityLevel)()) {
        case import_scheduler.unstable_ImmediatePriority:
          return e;
        case import_scheduler.unstable_UserBlockingPriority:
          return o;
        case import_scheduler.unstable_NormalPriority:
        case import_scheduler.unstable_LowPriority:
          return r2;
        case import_scheduler.unstable_IdlePriority:
          return i$1;
        default:
          return r2;
      }
    }
    default:
      return r2;
  }
}
function scheduleMicrotask(callback) {
  if (typeof queueMicrotask === "function") {
    queueMicrotask(callback);
  } else if (typeof Promise !== "undefined") {
    Promise.resolve().then(callback).catch((error) => {
      setTimeout(() => {
        throw error;
      });
    });
  } else {
    setTimeout(callback);
  }
}
var reconciler = /* @__PURE__ */ createReconciler({
  isPrimaryRenderer: false,
  warnsIfNotActing: false,
  supportsMutation: true,
  supportsPersistence: false,
  supportsHydration: false,
  createInstance,
  removeChild,
  appendChild,
  appendInitialChild: appendChild,
  insertBefore,
  appendChildToContainer(container, child) {
    const scene = container.getState().scene.__r3f;
    if (!child || !scene) return;
    appendChild(scene, child);
  },
  removeChildFromContainer(container, child) {
    const scene = container.getState().scene.__r3f;
    if (!child || !scene) return;
    removeChild(scene, child);
  },
  insertInContainerBefore(container, child, beforeChild) {
    const scene = container.getState().scene.__r3f;
    if (!child || !beforeChild || !scene) return;
    insertBefore(scene, child, beforeChild);
  },
  getRootHostContext: () => NO_CONTEXT,
  getChildHostContext: () => NO_CONTEXT,
  commitUpdate(instance, type, oldProps, newProps, fiber) {
    var _newProps$args, _oldProps$args, _newProps$args2;
    validateInstance(type, newProps);
    let reconstruct = false;
    if (instance.type === "primitive" && oldProps.object !== newProps.object) reconstruct = true;
    else if (((_newProps$args = newProps.args) == null ? void 0 : _newProps$args.length) !== ((_oldProps$args = oldProps.args) == null ? void 0 : _oldProps$args.length)) reconstruct = true;
    else if ((_newProps$args2 = newProps.args) != null && _newProps$args2.some((value, index2) => {
      var _oldProps$args2;
      return value !== ((_oldProps$args2 = oldProps.args) == null ? void 0 : _oldProps$args2[index2]);
    })) reconstruct = true;
    if (reconstruct) {
      reconstructed.push([instance, getInstanceProps(newProps), fiber]);
    } else {
      const changedProps = diffProps(instance, newProps);
      const attach2 = instance.props.attach;
      instance.props = getInstanceProps(newProps);
      if (attach2 !== void 0) instance.props.attach = attach2;
      else delete instance.props.attach;
      if (Object.keys(changedProps).length) applyProps(instance.object, changedProps);
    }
  },
  finalizeInitialChildren: () => false,
  commitMount() {
  },
  getPublicInstance: (instance) => instance == null ? void 0 : instance.object,
  prepareForCommit: () => null,
  preparePortalMount: (container) => prepare(container.getState().scene, container, "", {}),
  // Reconstructed instances are swapped once all mutations are committed,
  // before layout effects run so refs point to the new objects
  resetAfterCommit: flushReconstructedInstances,
  shouldSetTextContent: () => false,
  clearContainer: () => false,
  hideInstance,
  unhideInstance,
  createTextInstance: handleTextInstance,
  hideTextInstance: handleTextInstance,
  unhideTextInstance: handleTextInstance,
  // Mirrors react-dom, which flushes discrete work in microtasks
  supportsMicrotasks: true,
  scheduleMicrotask,
  scheduleTimeout: typeof setTimeout === "function" ? setTimeout : void 0,
  cancelTimeout: typeof clearTimeout === "function" ? clearTimeout : void 0,
  noTimeout: -1,
  getInstanceFromNode: () => null,
  beforeActiveInstanceBlur() {
  },
  afterActiveInstanceBlur() {
  },
  detachDeletedInstance() {
  },
  prepareScopeUpdate() {
  },
  getInstanceFromScope: () => null,
  shouldAttemptEagerTransition: () => false,
  trackSchedulerEvent: () => {
  },
  resolveEventType: () => null,
  resolveEventTimeStamp: () => -1.1,
  requestPostPaintCallback() {
  },
  maySuspendCommit: () => false,
  preloadInstance: () => true,
  // true indicates already loaded
  suspendInstance() {
  },
  waitForCommitToBeReady: () => null,
  NotPendingTransition: null,
  // The reconciler types use the internal ReactContext with all the hidden properties
  // so we have to cast from the public React.Context type
  HostTransitionContext: /* @__PURE__ */ React2.createContext(null),
  setCurrentUpdatePriority(newPriority) {
    currentUpdatePriority = newPriority;
  },
  getCurrentUpdatePriority() {
    return currentUpdatePriority;
  },
  resolveUpdatePriority() {
    var _window$event;
    if (currentUpdatePriority !== NoEventPriority) return currentUpdatePriority;
    const eventType = typeof window !== "undefined" ? (_window$event = window.event) == null ? void 0 : _window$event.type : void 0;
    if (eventType === void 0) return r2;
    return getEventPriority(eventType);
  },
  resetFormInstance() {
  },
  // @ts-ignore DefinitelyTyped is not up to date
  rendererPackageName: "@react-three/fiber",
  rendererVersion: packageData.version,
  // https://github.com/facebook/react/pull/31975
  // https://github.com/facebook/react/pull/31999
  applyViewTransitionName(_instance, _name, _className) {
  },
  restoreViewTransitionName(_instance, _props) {
  },
  cancelViewTransitionName(_instance, _name, _props) {
  },
  cancelRootViewTransitionName(_rootContainer) {
  },
  restoreRootViewTransitionName(_rootContainer) {
  },
  InstanceMeasurement: null,
  measureInstance: (_instance) => null,
  wasInstanceInViewport: (_measurement) => true,
  hasInstanceChanged: (_oldMeasurement, _newMeasurement) => false,
  hasInstanceAffectedParent: (_oldMeasurement, _newMeasurement) => false,
  // https://github.com/facebook/react/pull/32002
  // https://github.com/facebook/react/pull/34486
  suspendOnActiveViewTransition(_state, _container) {
  },
  // https://github.com/facebook/react/pull/32451
  // https://github.com/facebook/react/pull/32760
  // React hands the whole commit to the host when a transition touches a <ViewTransition> subtree.
  // three.js has nothing to animate between commits, so this mirrors the react-dom fallback for
  // browsers without document.startViewTransition and flushes the commit synchronously.
  startViewTransition(_suspendedState, _rootContainer, _transitionTypes, mutationCallback, layoutCallback, _afterMutationCallback, spawnedWorkCallback, _passiveCallback, _errorCallback, _blockedCallback, finishedAnimation) {
    mutationCallback();
    layoutCallback();
    finishedAnimation == null ? void 0 : finishedAnimation();
    spawnedWorkCallback();
    return null;
  },
  startGestureTransition(_suspendedState, _rootContainer, _timeline, _rangeStart, _rangeEnd, _transitionTypes, mutationCallback, animateCallback, _errorCallback, finishedAnimation) {
    mutationCallback();
    animateCallback();
    finishedAnimation == null ? void 0 : finishedAnimation();
    return null;
  },
  stopViewTransition(_transition) {
  },
  // https://github.com/facebook/react/pull/35564
  addViewTransitionFinishedListener(_transition, callback) {
    callback();
  },
  // https://github.com/facebook/react/pull/32038
  createViewTransitionInstance: (_name) => null,
  // https://github.com/facebook/react/pull/32379
  // https://github.com/facebook/react/pull/32786
  getCurrentGestureOffset(_provider) {
    throw new Error("startGestureTransition is not yet supported in react-three-fiber.");
  },
  // https://github.com/facebook/react/pull/32500
  cloneMutableInstance(instance, _keepChildren) {
    return instance;
  },
  cloneMutableTextInstance(textInstance) {
    return textInstance;
  },
  cloneRootViewTransitionContainer(_rootContainer) {
    throw new Error("Not implemented.");
  },
  removeRootViewTransitionClone(_rootContainer, _clone) {
    throw new Error("Not implemented.");
  },
  // https://github.com/facebook/react/pull/32465
  createFragmentInstance: (_fiber) => null,
  updateFragmentInstanceFiber(_fiber, _instance) {
  },
  commitNewChildToFragmentInstance(_child, _fragmentInstance) {
  },
  deleteChildFromFragmentInstance(_child, _fragmentInstance) {
  },
  // https://github.com/facebook/react/pull/32653
  measureClonedInstance: (_instance) => null,
  // https://github.com/facebook/react/pull/32819
  maySuspendCommitOnUpdate: (_type, _oldProps, _newProps) => false,
  maySuspendCommitInSyncRender: (_type, _props) => false,
  // https://github.com/facebook/react/pull/34486
  startSuspendingCommit: () => null,
  // https://github.com/facebook/react/pull/34522
  getSuspendedCommitReason: (_state, _rootContainer) => null
});
var _roots = /* @__PURE__ */ new Map();
function transitionRoot(root, event) {
  const state2 = root.state;
  switch (event.type) {
    case "use":
      if (state2.status === "disposed") return false;
      root.state = {
        status: "open"
      };
      return true;
    case "unmount":
      if (state2.status === "disposed") return false;
      root.state = {
        status: "closing",
        token: event.token
      };
      return true;
    case "dispose":
      if (state2.status !== "closing" || state2.token !== event.token) return false;
      root.state = {
        status: "disposed"
      };
      return true;
  }
}
function createRoot(canvas) {
  const prevRoot = _roots.get(canvas);
  const prevFiber = prevRoot == null ? void 0 : prevRoot.fiber;
  const prevStore = prevRoot == null ? void 0 : prevRoot.store;
  if (prevRoot) console.warn("R3F.createRoot should only be called once!");
  const logRecoverableError = typeof reportError === "function" ? (
    // In modern browsers, reportError will dispatch an error event,
    // emulating an uncaught JavaScript error.
    reportError
  ) : (
    // In older browsers and test environments, fallback to console.error.
    console.error
  );
  const store = prevStore || createStore2(invalidate, advance);
  const fiber = prevFiber || reconciler.createContainer(
    store,
    // container
    t,
    // tag
    null,
    // hydration callbacks
    false,
    // isStrictMode
    null,
    // concurrentUpdatesByDefaultOverride
    "",
    // identifierPrefix
    logRecoverableError,
    // onUncaughtError
    logRecoverableError,
    // onCaughtError
    logRecoverableError,
    // onRecoverableError
    null
    // transitionCallbacks
  );
  const root = prevRoot || {
    fiber,
    store,
    state: {
      status: "open"
    },
    ready: fulfilled(void 0),
    configuration: {},
    ownsRenderer: false
  };
  if (!prevRoot) _roots.set(canvas, root);
  let mounted = false;
  return {
    get ready() {
      return root.ready;
    },
    configure(props = {}) {
      if (!transitionRoot(root, {
        type: "use"
      })) {
        return rejected(new Error("R3F: Cannot configure a root after disposal has started."));
      }
      const previous = root.ready;
      const {
        promise,
        resolve: resolve2,
        reject
      } = deferred();
      root.ready = promise;
      const apply = (gl) => {
        const state2 = store.getState();
        if (!state2.gl) {
          root.ownsRenderer = !isRenderer(props.gl);
          state2.set({
            gl
          });
        }
        applyRootConfiguration(root, canvas, props);
        resolve2(this);
      };
      const run2 = () => {
        try {
          var _store$getState$gl;
          const gl = (_store$getState$gl = store.getState().gl) != null ? _store$getState$gl : createRenderer(canvas, props.gl);
          if (isPromiseLike(gl)) Promise.resolve(gl).then(apply).catch(reject);
          else apply(gl);
        } catch (error) {
          reject(error);
        }
      };
      if (previous.status === "pending") previous.then(run2, reject);
      else run2();
      return promise;
    },
    render(children) {
      if (!transitionRoot(root, {
        type: "use"
      })) return store;
      if (!store.getState().gl && root.ready.status === "fulfilled") this.configure();
      if (root.ready.status === "rejected") throw root.ready.reason;
      const commit = () => {
        var _root$configuration$p;
        if (root.state.status !== "open" || root.ready.status === "rejected") return;
        if (root.ready.status === "pending") {
          root.ready.then(commit, logRecoverableError);
          return;
        }
        const onCreated = (_root$configuration$p = root.configuration.previous) == null ? void 0 : _root$configuration$p.onCreated;
        const element = /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Provider, {
          store,
          children,
          onCreated,
          rootElement: canvas
        });
        if (mounted) {
          reconciler.updateContainer(element, fiber, null, noop);
          return;
        }
        mounted = true;
        reconciler.updateContainerSync(element, fiber, null, noop);
        reconciler.flushSyncWork();
      };
      commit();
      return store;
    },
    unmount() {
      if (_roots.get(canvas) === root) unmountComponentAtNode(canvas);
    }
  };
}
function Provider({
  store,
  children,
  onCreated,
  rootElement
}) {
  useIsomorphicLayoutEffect(() => {
    const state2 = store.getState();
    state2.set((state3) => ({
      internal: {
        ...state3.internal,
        active: true
      }
    }));
    if (onCreated) onCreated(state2);
    if (!store.getState().events.connected) state2.events.connect == null ? void 0 : state2.events.connect(rootElement);
  }, []);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(context.Provider, {
    value: store,
    children
  });
}
function disposeRenderer(gl) {
  if ((gl.hasInitialized == null ? void 0 : gl.hasInitialized()) === false) return;
  const disposed = attempt(() => {
    var _gl$renderLists;
    return gl.dispose ? gl.dispose() : (_gl$renderLists = gl.renderLists) == null ? void 0 : _gl$renderLists.dispose == null ? void 0 : _gl$renderLists.dispose();
  });
  if (isPromiseLike(disposed)) {
    return Promise.resolve(disposed).catch((error) => console.warn("[R3F] Error disposing renderer", error)).then(() => attempt(() => gl.forceContextLoss == null ? void 0 : gl.forceContextLoss()));
  }
  attempt(() => gl.forceContextLoss == null ? void 0 : gl.forceContextLoss());
}
function attempt(step) {
  try {
    return step();
  } catch (error) {
    console.warn("[R3F] Error while unmounting root; teardown may be incomplete:", error);
  }
}
function unmountComponentAtNode(canvas, callback) {
  const root = _roots.get(canvas);
  const token = /* @__PURE__ */ Symbol("unmount");
  if (!root || !transitionRoot(root, {
    type: "unmount",
    token
  })) return;
  const teardown = () => {
    var _state$gl;
    if (root.ready.status === "pending") {
      root.ready.then(teardown, teardown);
      return;
    }
    if (!transitionRoot(root, {
      type: "dispose",
      token
    })) return;
    _roots.delete(canvas);
    const state2 = root.store.getState();
    state2.internal.active = false;
    attempt(() => state2.events.disconnect == null ? void 0 : state2.events.disconnect());
    if ((_state$gl = state2.gl) != null && _state$gl.xr) attempt(() => state2.xr.disconnect());
    if (state2.scene) attempt(() => dispose(state2.scene));
    const gl = state2.gl;
    let disposal = void 0;
    if (gl && root.ownsRenderer) {
      disposal = attempt(() => disposeRenderer(gl));
    } else if (gl) {
      attempt(() => {
        var _gl$renderLists2;
        return (_gl$renderLists2 = gl.renderLists) == null ? void 0 : _gl$renderLists2.dispose == null ? void 0 : _gl$renderLists2.dispose();
      });
      attempt(() => gl.forceContextLoss == null ? void 0 : gl.forceContextLoss());
    }
    if (isPromiseLike(disposal)) disposal.then(() => callback == null ? void 0 : callback(canvas));
    else callback == null ? void 0 : callback(canvas);
  };
  reconciler.updateContainer(null, root.fiber, null, () => {
    if (root.state.status !== "closing" || root.state.token !== token) return;
    reconciler.updateContainer(null, root.fiber, null, teardown);
  });
}
var globalEffects = /* @__PURE__ */ new Set();
var globalAfterEffects = /* @__PURE__ */ new Set();
var globalTailEffects = /* @__PURE__ */ new Set();
function run(effects, timestamp) {
  if (!effects.size) return;
  for (const {
    callback
  } of effects.values()) {
    callback(timestamp);
  }
}
function flushGlobalEffects(type, timestamp) {
  switch (type) {
    case "before":
      return run(globalEffects, timestamp);
    case "after":
      return run(globalAfterEffects, timestamp);
    case "tail":
      return run(globalTailEffects, timestamp);
  }
}
var subscribers;
var subscription;
function update(timestamp, state2, frame2) {
  let delta = state2.clock.getDelta();
  if (state2.frameloop === "never" && typeof timestamp === "number") {
    delta = timestamp - state2.clock.elapsedTime;
    state2.clock.oldTime = state2.clock.elapsedTime;
    state2.clock.elapsedTime = timestamp;
  }
  subscribers = state2.internal.subscribers;
  for (let i3 = 0; i3 < subscribers.length; i3++) {
    subscription = subscribers[i3];
    subscription.ref.current(subscription.store.getState(), delta, frame2);
  }
  if (!state2.internal.priority && state2.gl.render) state2.gl.render(state2.scene, state2.camera);
  state2.internal.frames = Math.max(0, state2.internal.frames - 1);
  return state2.frameloop === "always" ? 1 : state2.internal.frames;
}
var running = false;
var useFrameInProgress = false;
var repeat;
var frame;
var state;
function loop(timestamp) {
  frame = requestAnimationFrame(loop);
  running = true;
  repeat = 0;
  flushGlobalEffects("before", timestamp);
  useFrameInProgress = true;
  for (const root of _roots.values()) {
    var _state$gl$xr;
    state = root.store.getState();
    if (state.internal.active && (state.frameloop === "always" || state.internal.frames > 0) && !((_state$gl$xr = state.gl.xr) != null && _state$gl$xr.isPresenting)) {
      repeat += update(timestamp, state);
    }
  }
  useFrameInProgress = false;
  flushGlobalEffects("after", timestamp);
  if (repeat === 0) {
    flushGlobalEffects("tail", timestamp);
    running = false;
    return cancelAnimationFrame(frame);
  }
}
function invalidate(state2, frames = 1) {
  var _state$gl$xr2;
  if (!state2) return _roots.forEach((root) => invalidate(root.store.getState(), frames));
  if ((_state$gl$xr2 = state2.gl.xr) != null && _state$gl$xr2.isPresenting || !state2.internal.active || state2.frameloop === "never") return;
  if (frames > 1) {
    state2.internal.frames = Math.min(60, state2.internal.frames + frames);
  } else {
    if (useFrameInProgress) {
      state2.internal.frames = 2;
    } else {
      state2.internal.frames = 1;
    }
  }
  if (!running) {
    running = true;
    requestAnimationFrame(loop);
  }
}
function advance(timestamp, runGlobalEffects = true, state2, frame2) {
  if (runGlobalEffects) flushGlobalEffects("before", timestamp);
  if (!state2) for (const root of _roots.values()) update(timestamp, root.store.getState());
  else update(timestamp, state2, frame2);
  if (runGlobalEffects) flushGlobalEffects("after", timestamp);
}
var DOM_EVENTS = {
  onClick: ["click", false],
  onContextMenu: ["contextmenu", false],
  onDoubleClick: ["dblclick", false],
  onWheel: ["wheel", true],
  onPointerDown: ["pointerdown", true],
  onPointerUp: ["pointerup", true],
  onPointerLeave: ["pointerleave", true],
  onPointerMove: ["pointermove", true],
  onPointerCancel: ["pointercancel", true],
  onLostPointerCapture: ["lostpointercapture", true]
};
function createPointerEvents(store) {
  const {
    handlePointer
  } = createEvents(store);
  return {
    priority: 1,
    enabled: true,
    compute(event, state2, previous) {
      state2.pointer.set(event.offsetX / state2.size.width * 2 - 1, -(event.offsetY / state2.size.height) * 2 + 1);
      state2.raycaster.setFromCamera(state2.pointer, state2.camera);
    },
    connected: void 0,
    handlers: Object.keys(DOM_EVENTS).reduce((acc, key) => ({
      ...acc,
      [key]: handlePointer(key)
    }), {}),
    update: () => {
      var _internal$lastEvent;
      const {
        events,
        internal
      } = store.getState();
      if ((_internal$lastEvent = internal.lastEvent) != null && _internal$lastEvent.current && events.handlers) events.handlers.onPointerMove(internal.lastEvent.current);
    },
    connect: (target) => {
      const {
        set,
        events
      } = store.getState();
      events.disconnect == null ? void 0 : events.disconnect();
      set((state2) => ({
        events: {
          ...state2.events,
          connected: target
        }
      }));
      if (events.handlers) {
        for (const name in events.handlers) {
          const event = events.handlers[name];
          const [eventName, passive] = DOM_EVENTS[name];
          target.addEventListener(eventName, event, {
            passive
          });
        }
      }
    },
    disconnect: () => {
      const {
        set,
        events
      } = store.getState();
      if (events.connected) {
        if (events.handlers) {
          for (const name in events.handlers) {
            const event = events.handlers[name];
            const [eventName] = DOM_EVENTS[name];
            events.connected.removeEventListener(eventName, event);
          }
        }
        set((state2) => ({
          events: {
            ...state2.events,
            connected: void 0
          }
        }));
      }
    }
  };
}

// node_modules/.pnpm/@react-three+fiber@9.8.1_@types+react@19.3.0_react-dom@19.3.0_react@19.3.0__react@19.3.0_three@0.186.1/node_modules/@react-three/fiber/dist/react-three-fiber.esm.js
var React3 = __toESM(require_react());

// node_modules/.pnpm/react-use-measure@2.1.7_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/react-use-measure/dist/index.js
var import_react4 = __toESM(require_react(), 1);
function g2(n, t2) {
  let o2;
  return (...i3) => {
    window.clearTimeout(o2), o2 = window.setTimeout(() => n(...i3), t2);
  };
}
function j({ debounce: n, scroll: t2, polyfill: o2, offsetSize: i3 } = { debounce: 0, scroll: false, offsetSize: false }) {
  const a = o2 || (typeof window == "undefined" ? class {
  } : window.ResizeObserver);
  if (!a) throw new Error("This browser does not support ResizeObserver out of the box. See: https://github.com/react-spring/react-use-measure/#resize-observer-polyfills");
  const [c, h2] = (0, import_react4.useState)({ left: 0, top: 0, width: 0, height: 0, bottom: 0, right: 0, x: 0, y: 0 }), e2 = (0, import_react4.useRef)({ element: null, scrollContainers: null, resizeObserver: null, lastBounds: c, orientationHandler: null }), d = n ? typeof n == "number" ? n : n.scroll : null, f = n ? typeof n == "number" ? n : n.resize : null, w2 = (0, import_react4.useRef)(false);
  (0, import_react4.useEffect)(() => (w2.current = true, () => void (w2.current = false)));
  const [z, m2, s] = (0, import_react4.useMemo)(() => {
    const r3 = () => {
      if (!e2.current.element) return;
      const { left: y, top: C2, width: H, height: O, bottom: S, right: x2, x: B, y: R } = e2.current.element.getBoundingClientRect(), l2 = { left: y, top: C2, width: H, height: O, bottom: S, right: x2, x: B, y: R };
      e2.current.element instanceof HTMLElement && i3 && (l2.height = e2.current.element.offsetHeight, l2.width = e2.current.element.offsetWidth), Object.freeze(l2), w2.current && !D(e2.current.lastBounds, l2) && h2(e2.current.lastBounds = l2);
    };
    return [r3, f ? g2(r3, f) : r3, d ? g2(r3, d) : r3];
  }, [h2, i3, d, f]);
  function v2() {
    e2.current.scrollContainers && (e2.current.scrollContainers.forEach((r3) => r3.removeEventListener("scroll", s, true)), e2.current.scrollContainers = null), e2.current.resizeObserver && (e2.current.resizeObserver.disconnect(), e2.current.resizeObserver = null), e2.current.orientationHandler && ("orientation" in screen && "removeEventListener" in screen.orientation ? screen.orientation.removeEventListener("change", e2.current.orientationHandler) : "onorientationchange" in window && window.removeEventListener("orientationchange", e2.current.orientationHandler));
  }
  function b2() {
    e2.current.element && (e2.current.resizeObserver = new a(s), e2.current.resizeObserver.observe(e2.current.element), t2 && e2.current.scrollContainers && e2.current.scrollContainers.forEach((r3) => r3.addEventListener("scroll", s, { capture: true, passive: true })), e2.current.orientationHandler = () => {
      s();
    }, "orientation" in screen && "addEventListener" in screen.orientation ? screen.orientation.addEventListener("change", e2.current.orientationHandler) : "onorientationchange" in window && window.addEventListener("orientationchange", e2.current.orientationHandler));
  }
  const L = (r3) => {
    !r3 || r3 === e2.current.element || (v2(), e2.current.element = r3, e2.current.scrollContainers = E2(r3), b2());
  };
  return X(s, !!t2), W(m2), (0, import_react4.useEffect)(() => {
    v2(), b2();
  }, [t2, s, m2]), (0, import_react4.useEffect)(() => v2, []), [L, c, z];
}
function W(n) {
  (0, import_react4.useEffect)(() => {
    const t2 = n;
    return window.addEventListener("resize", t2), () => void window.removeEventListener("resize", t2);
  }, [n]);
}
function X(n, t2) {
  (0, import_react4.useEffect)(() => {
    if (t2) {
      const o2 = n;
      return window.addEventListener("scroll", o2, { capture: true, passive: true }), () => void window.removeEventListener("scroll", o2, true);
    }
  }, [n, t2]);
}
function E2(n) {
  const t2 = [];
  if (!n || n === document.body) return t2;
  const { overflow: o2, overflowX: i3, overflowY: a } = window.getComputedStyle(n);
  return [o2, i3, a].some((c) => c === "auto" || c === "scroll") && t2.push(n), [...t2, ...E2(n.parentElement)];
}
var k = ["x", "y", "top", "bottom", "left", "right", "width", "height"];
var D = (n, t2) => k.every((o2) => n[o2] === t2[o2]);

// node_modules/.pnpm/@react-three+fiber@9.8.1_@types+react@19.3.0_react-dom@19.3.0_react@19.3.0__react@19.3.0_three@0.186.1/node_modules/@react-three/fiber/dist/react-three-fiber.esm.js
var import_jsx_runtime2 = __toESM(require_jsx_runtime());
var import_scheduler2 = __toESM(require_scheduler());
function CanvasImpl({
  ref,
  children,
  fallback,
  resize,
  style,
  gl,
  events = createPointerEvents,
  eventSource,
  eventPrefix,
  shadows,
  linear,
  flat,
  legacy,
  orthographic,
  frameloop,
  dpr,
  performance: performance2,
  raycaster,
  camera,
  scene,
  onPointerMissed,
  onCreated,
  ...props
}) {
  React3.useMemo(() => extend(three_module_exports), []);
  const Bridge = useBridge();
  const [containerRef, containerRect] = j({
    scroll: true,
    debounce: {
      scroll: 50,
      resize: 0
    },
    ...resize
  });
  const canvasRef = React3.useRef(null);
  const divRef = React3.useRef(null);
  React3.useImperativeHandle(ref, () => canvasRef.current);
  const handlePointerMissed = useMutableCallback(onPointerMissed);
  const pointerMissed = React3.useCallback((event) => handlePointerMissed.current == null ? void 0 : handlePointerMissed.current(event), [handlePointerMissed]);
  const [block, setBlock] = React3.useState(false);
  const [error, setError] = React3.useState(false);
  if (block) throw block;
  if (error) throw error;
  const root = React3.useRef(null);
  const [gate, waitFor] = useGate();
  const rootState = React3.useRef(null);
  const eventTarget = () => eventSource ? isRef(eventSource) ? eventSource.current : eventSource : divRef.current;
  React3.useInsertionEffect(() => {
    return () => {
      const current = root.current;
      root.current = null;
      current == null ? void 0 : current.unmount();
    };
  }, []);
  useIsomorphicLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (containerRect.width > 0 && containerRect.height > 0 && canvas) {
      if (!root.current) root.current = createRoot(canvas);
      root.current.configure({
        gl,
        scene,
        events,
        shadows,
        linear,
        flat,
        legacy,
        orthographic,
        frameloop,
        dpr,
        performance: performance2,
        raycaster,
        camera,
        size: containerRect,
        // Forwards to the latest onPointerMissed, so a new callback does not update the store
        onPointerMissed: pointerMissed,
        onCreated: (state2) => {
          var _eventTarget;
          rootState.current = state2;
          state2.events.connect == null ? void 0 : state2.events.connect((_eventTarget = eventTarget()) != null ? _eventTarget : divRef.current);
          if (eventPrefix) {
            state2.setEvents({
              compute: (event, state3) => {
                const x2 = event[eventPrefix + "X"];
                const y = event[eventPrefix + "Y"];
                state3.pointer.set(x2 / state3.size.width * 2 - 1, -(y / state3.size.height) * 2 + 1);
                state3.raycaster.setFromCamera(state3.pointer, state3.camera);
              }
            });
          }
          onCreated == null ? void 0 : onCreated(state2);
        }
      }).catch(setError);
      if (root.current.ready.status === "fulfilled") {
        root.current.render(/* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Bridge, {
          children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(ErrorBoundary, {
            set: setError,
            children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(React3.Suspense, {
              fallback: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Block, {
                set: setBlock
              }),
              children: children != null ? children : null
            })
          })
        }));
      } else if (root.current.ready.status === "pending") {
        waitFor(root.current.ready);
      }
    }
  });
  React3.useEffect(() => {
    var _rootState$current;
    const state2 = (_rootState$current = rootState.current) == null ? void 0 : _rootState$current.get();
    const target = eventTarget();
    if (state2 && target && state2.events.connected !== target) state2.events.connect == null ? void 0 : state2.events.connect(target);
  });
  React3.useEffect(() => {
    const canvas = canvasRef.current;
    return () => {
      var _root$current;
      if (!canvas.isConnected) (_root$current = root.current) == null ? void 0 : _root$current.unmount();
    };
  }, []);
  const pointerEvents = eventSource ? "none" : "auto";
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", {
    ref: divRef,
    style: {
      position: "relative",
      width: "100%",
      height: "100%",
      overflow: "hidden",
      pointerEvents,
      ...style
    },
    ...props,
    children: [/* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", {
      ref: containerRef,
      style: {
        width: "100%",
        height: "100%"
      },
      children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("canvas", {
        ref: canvasRef,
        style: {
          display: "block"
        },
        children: fallback
      })
    }), gate]
  });
}
function Canvas(props) {
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(h, {
    children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(CanvasImpl, {
      ...props
    })
  });
}

// node_modules/.pnpm/@react-three+postprocessing@3.1.2_@react-three+fiber@9.8.1_@types+react@19.3.0_react-do_952babc1e50b049ce2c9670caec410a1/node_modules/@react-three/postprocessing/dist/index.js
var import_react5 = __toESM(require_react(), 1);
var import_jsx_runtime3 = __toESM(require_jsx_runtime(), 1);

// node_modules/.pnpm/postprocessing@6.39.5_three@0.186.1/node_modules/postprocessing/build/index.js
var fullscreenGeometry = /* @__PURE__ */ (() => {
  const vertices = new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]);
  const uvs = new Float32Array([0, 0, 2, 0, 0, 2]);
  const geometry2 = new BufferGeometry();
  geometry2.setAttribute("position", new BufferAttribute(vertices, 3));
  geometry2.setAttribute("uv", new BufferAttribute(uvs, 2));
  return geometry2;
})();
var Pass = class _Pass {
  /**
   * A shared fullscreen triangle.
   *
   * The screen size is 2x2 units (NDC). A triangle needs to be 4x4 units to fill the screen.
   * @see https://michaldrobot.com/2014/04/01/gcn-execution-patterns-in-full-screen-passes/
   * @type {BufferGeometry}
   * @internal
   */
  static get fullscreenGeometry() {
    return fullscreenGeometry;
  }
  /**
   * Constructs a new pass.
   *
   * @param {String} [name] - The name of this pass. Does not have to be unique.
   * @param {Scene} [scene] - The scene to render. The default scene contains a single mesh that fills the screen.
   * @param {Camera} [camera] - A camera. Fullscreen effect passes don't require a camera.
   */
  constructor(name = "Pass", scene = new Scene(), camera = new OrthographicCamera()) {
    this.name = name;
    this.renderer = null;
    this.scene = scene;
    this.camera = camera;
    this.screen = null;
    this.rtt = true;
    this.needsSwap = true;
    this.needsDepthBlit = false;
    this.needsDepthTexture = false;
    this.enabled = true;
  }
  /**
   * Sets the render to screen flag.
   *
   * If this flag is changed, the fullscreen material will be updated as well.
   *
   * @type {Boolean}
   */
  get renderToScreen() {
    return !this.rtt;
  }
  set renderToScreen(value) {
    if (this.rtt === value) {
      const material = this.fullscreenMaterial;
      if (material !== null) {
        material.needsUpdate = true;
      }
      this.rtt = !value;
    }
  }
  /**
   * Sets the main scene.
   *
   * @type {Scene}
   */
  set mainScene(value) {
  }
  /**
   * Sets the main camera.
   *
   * @type {Camera}
   */
  set mainCamera(value) {
  }
  /**
   * Sets the renderer
   *
   * @deprecated
   * @param {WebGLRenderer} renderer - The renderer.
   */
  setRenderer(renderer) {
    this.renderer = renderer;
  }
  /**
   * Indicates whether this pass is enabled.
   *
   * @deprecated Use enabled instead.
   * @return {Boolean} Whether this pass is enabled.
   */
  isEnabled() {
    return this.enabled;
  }
  /**
   * Enables or disables this pass.
   *
   * @deprecated Use enabled instead.
   * @param {Boolean} value - Whether the pass should be enabled.
   */
  setEnabled(value) {
    this.enabled = value;
  }
  /**
   * The fullscreen material.
   *
   * @type {Material}
   */
  get fullscreenMaterial() {
    return this.screen !== null ? this.screen.material : null;
  }
  set fullscreenMaterial(value) {
    let screen2 = this.screen;
    if (screen2 !== null) {
      screen2.material = value;
    } else {
      screen2 = new Mesh(_Pass.fullscreenGeometry, value);
      screen2.frustumCulled = false;
      if (this.scene === null) {
        this.scene = new Scene();
      }
      this.scene.add(screen2);
      this.screen = screen2;
    }
  }
  /**
   * Returns the current fullscreen material.
   *
   * @deprecated Use fullscreenMaterial instead.
   * @return {Material} The current fullscreen material, or null if there is none.
   */
  getFullscreenMaterial() {
    return this.fullscreenMaterial;
  }
  /**
   * Sets the fullscreen material.
   *
   * @deprecated Use fullscreenMaterial instead.
   * @protected
   * @param {Material} value - A fullscreen material.
   */
  setFullscreenMaterial(value) {
    this.fullscreenMaterial = value;
  }
  /**
   * Returns the current depth texture.
   *
   * @return {Texture} The current depth texture, or null if there is none.
   */
  getDepthTexture() {
    return null;
  }
  /**
   * Sets the depth texture.
   *
   * This method will be called automatically by the {@link EffectComposer}.
   * You may override this method if your pass relies on the depth information of a preceding {@link RenderPass}.
   *
   * @param {Texture} depthTexture - A depth texture.
   * @param {DepthPackingStrategy} [depthPacking=BasicDepthPacking] - The depth packing.
   */
  setDepthTexture(depthTexture, depthPacking = BasicDepthPacking) {
  }
  /**
   * Renders this pass.
   *
   * This is an abstract method that must be overridden.
   *
   * @abstract
   * @throws {Error} An error is thrown if the method is not overridden.
   * @param {WebGLRenderer} renderer - The renderer.
   * @param {WebGLRenderTarget} inputBuffer - A frame buffer that contains the result of the previous pass.
   * @param {WebGLRenderTarget} outputBuffer - A frame buffer that serves as the output render target unless this pass renders to screen.
   * @param {Number} [deltaTime] - The time between the last frame and the current one in seconds.
   * @param {Boolean} [stencilTest] - Indicates whether a stencil mask is active.
   */
  render(renderer, inputBuffer, outputBuffer, deltaTime, stencilTest) {
    throw new Error("Render method not implemented!");
  }
  /**
   * Sets the size.
   *
   * You may override this method if you want to be informed about the size of the backbuffer/canvas.
   * This method is called before {@link initialize} and every time the size of the {@link EffectComposer} changes.
   *
   * @param {Number} width - The width.
   * @param {Number} height - The height.
   */
  setSize(width, height) {
  }
  /**
   * Performs initialization tasks.
   *
   * This method is called when this pass is added to an {@link EffectComposer}.
   *
   * @param {WebGLRenderer} renderer - The renderer.
   * @param {Boolean} alpha - Whether the renderer uses the alpha channel or not.
   * @param {Number} frameBufferType - The type of the main frame buffers.
   */
  initialize(renderer, alpha, frameBufferType) {
  }
  /**
   * Performs a shallow search for disposable properties and deletes them.
   *
   * The {@link EffectComposer} calls this method when it is being destroyed. You can use it independently to free
   * memory when you're certain that you don't need this pass anymore.
   */
  dispose() {
    for (const key of Object.keys(this)) {
      const property = this[key];
      const isDisposable = property instanceof WebGLRenderTarget || property instanceof Material || property instanceof Texture || property instanceof _Pass;
      if (isDisposable) {
        this[key].dispose();
      }
    }
    if (this.fullscreenMaterial !== null) {
      this.fullscreenMaterial.dispose();
    }
  }
};
var ClearMaskPass = class extends Pass {
  /**
   * Constructs a new clear mask pass.
   */
  constructor() {
    super("ClearMaskPass", null, null);
    this.needsSwap = false;
  }
  /**
   * Disables the global stencil test.
   *
   * @param {WebGLRenderer} renderer - The renderer.
   * @param {WebGLRenderTarget} inputBuffer - A frame buffer that contains the result of the previous pass.
   * @param {WebGLRenderTarget} outputBuffer - A frame buffer that serves as the output render target unless this pass renders to screen.
   * @param {Number} [deltaTime] - The time between the last frame and the current one in seconds.
   * @param {Boolean} [stencilTest] - Indicates whether a stencil mask is active.
   */
  render(renderer, inputBuffer, outputBuffer, deltaTime, stencilTest) {
    const stencil = renderer.state.buffers.stencil;
    stencil.setLocked(false);
    stencil.setTest(false);
  }
};
var copy_default = `#ifdef COLOR_WRITE
#include <common>
#include <dithering_pars_fragment>
#ifdef FRAMEBUFFER_PRECISION_HIGH
uniform mediump sampler2D inputBuffer;
#else
uniform lowp sampler2D inputBuffer;
#endif
#endif
#ifdef DEPTH_WRITE
#include <packing>
#ifdef GL_FRAGMENT_PRECISION_HIGH
uniform highp sampler2D depthBuffer;
#else
uniform mediump sampler2D depthBuffer;
#endif
float readDepth(const in vec2 uv){
#if DEPTH_PACKING == 3201
return unpackRGBAToDepth(texture2D(depthBuffer,uv));
#else
return texture2D(depthBuffer,uv).r;
#endif
}
#endif
#ifdef USE_WEIGHTS
uniform vec4 channelWeights;
#endif
uniform float opacity;varying vec2 vUv;void main(){
#ifdef COLOR_WRITE
vec4 texel=texture2D(inputBuffer,vUv);
#ifdef USE_WEIGHTS
texel*=channelWeights;
#endif
gl_FragColor=opacity*texel;
#ifdef COLOR_SPACE_CONVERSION
#include <colorspace_fragment>
#endif
#include <dithering_fragment>
#else
gl_FragColor=vec4(0.0);
#endif
#ifdef DEPTH_WRITE
gl_FragDepth=readDepth(vUv);
#endif
}`;
var common_default = `varying vec2 vUv;void main(){vUv=position.xy*0.5+0.5;gl_Position=vec4(position.xy,1.0,1.0);}`;
var CopyMaterial = class extends ShaderMaterial {
  /**
   * Constructs a new copy material.
   */
  constructor() {
    super({
      name: "CopyMaterial",
      defines: {
        COLOR_SPACE_CONVERSION: "1",
        DEPTH_PACKING: "0",
        COLOR_WRITE: "1"
      },
      uniforms: {
        inputBuffer: new Uniform(null),
        depthBuffer: new Uniform(null),
        channelWeights: new Uniform(null),
        opacity: new Uniform(1)
      },
      blending: NoBlending,
      toneMapped: false,
      depthWrite: false,
      depthTest: false,
      fragmentShader: copy_default,
      vertexShader: common_default
    });
    this.depthFunc = AlwaysDepth;
  }
  /**
   * The input buffer.
   *
   * @type {Texture}
   */
  get inputBuffer() {
    return this.uniforms.inputBuffer.value;
  }
  set inputBuffer(value) {
    const colorWrite = value !== null;
    if (this.colorWrite !== colorWrite) {
      if (colorWrite) {
        this.defines.COLOR_WRITE = true;
      } else {
        delete this.defines.COLOR_WRITE;
      }
      this.colorWrite = colorWrite;
      this.needsUpdate = true;
    }
    this.uniforms.inputBuffer.value = value;
  }
  /**
   * A depth buffer.
   *
   * @type {Texture}
   */
  get depthBuffer() {
    return this.uniforms.depthBuffer.value;
  }
  set depthBuffer(value) {
    const depthWrite = value !== null;
    if (this.depthWrite !== depthWrite) {
      if (depthWrite) {
        this.defines.DEPTH_WRITE = true;
      } else {
        delete this.defines.DEPTH_WRITE;
      }
      this.depthTest = depthWrite;
      this.depthWrite = depthWrite;
      this.needsUpdate = true;
    }
    this.uniforms.depthBuffer.value = value;
  }
  /**
   * The depth packing strategy of the depth buffer.
   *
   * @type {DepthPackingStrategies}
   */
  set depthPacking(value) {
    this.defines.DEPTH_PACKING = value.toFixed(0);
    this.needsUpdate = true;
  }
  /**
   * Indicates whether output color space conversion is enabled.
   *
   * @type {Boolean}
   */
  get colorSpaceConversion() {
    return this.defines.COLOR_SPACE_CONVERSION !== void 0;
  }
  set colorSpaceConversion(value) {
    if (this.colorSpaceConversion !== value) {
      if (value) {
        this.defines.COLOR_SPACE_CONVERSION = true;
      } else {
        delete this.defines.COLOR_SPACE_CONVERSION;
      }
      this.needsUpdate = true;
    }
  }
  /**
   * Color channel weights that modulate texels from the input buffer.
   *
   * Set to `null` to disable.
   *
   * @type {Vector4 | null}
   */
  get channelWeights() {
    return this.uniforms.channelWeights.value;
  }
  set channelWeights(value) {
    if (value !== null) {
      this.defines.USE_WEIGHTS = "1";
      this.uniforms.channelWeights.value = value;
    } else {
      delete this.defines.USE_WEIGHTS;
    }
    this.needsUpdate = true;
  }
  /**
   * Sets the input buffer.
   *
   * @deprecated Use inputBuffer instead.
   * @param {Number} value - The buffer.
   */
  setInputBuffer(value) {
    this.uniforms.inputBuffer.value = value;
  }
  /**
   * Returns the opacity.
   *
   * @deprecated Use opacity instead.
   * @return {Number} The opacity.
   */
  getOpacity(value) {
    return this.uniforms.opacity.value;
  }
  /**
   * Sets the opacity.
   *
   * @deprecated Use opacity instead.
   * @param {Number} value - The opacity.
   */
  setOpacity(value) {
    this.uniforms.opacity.value = value;
  }
};
var CopyPass = class extends Pass {
  /**
   * Constructs a new save pass.
   *
   * @param {WebGLRenderTarget} [renderTarget] - A render target.
   * @param {Boolean} [autoResize=true] - Whether the render target size should be updated automatically.
   */
  constructor(renderTarget, autoResize = true) {
    super("CopyPass");
    this.fullscreenMaterial = new CopyMaterial();
    this.needsSwap = false;
    this.renderTarget = renderTarget;
    if (renderTarget === void 0) {
      this.renderTarget = new WebGLRenderTarget(1, 1, {
        minFilter: LinearFilter,
        magFilter: LinearFilter,
        stencilBuffer: false,
        depthBuffer: false
      });
      this.renderTarget.texture.name = "CopyPass.Target";
    }
    this.autoResize = autoResize;
  }
  /**
   * Enables or disables auto resizing of the render target.
   *
   * @deprecated Use autoResize instead.
   * @type {Boolean}
   */
  get resize() {
    return this.autoResize;
  }
  set resize(value) {
    this.autoResize = value;
  }
  /**
   * The output texture.
   *
   * @type {Texture}
   */
  get texture() {
    return this.renderTarget.texture;
  }
  /**
   * Returns the output texture.
   *
   * @deprecated Use texture instead.
   * @return {Texture} The texture.
   */
  getTexture() {
    return this.renderTarget.texture;
  }
  /**
   * Enables or disables auto resizing of the render target.
   *
   * @deprecated Use autoResize instead.
   * @param {Boolean} value - Whether the render target size should be updated automatically.
   */
  setAutoResizeEnabled(value) {
    this.autoResize = value;
  }
  /**
   * Saves the input buffer.
   *
   * @param {WebGLRenderer} renderer - The renderer.
   * @param {WebGLRenderTarget} inputBuffer - A frame buffer that contains the result of the previous pass.
   * @param {WebGLRenderTarget} outputBuffer - A frame buffer that serves as the output render target unless this pass renders to screen.
   * @param {Number} [deltaTime] - The time between the last frame and the current one in seconds.
   * @param {Boolean} [stencilTest] - Indicates whether a stencil mask is active.
   */
  render(renderer, inputBuffer, outputBuffer, deltaTime, stencilTest) {
    this.fullscreenMaterial.inputBuffer = inputBuffer.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : this.renderTarget);
    renderer.render(this.scene, this.camera);
  }
  /**
   * Updates the size of this pass.
   *
   * @param {Number} width - The width.
   * @param {Number} height - The height.
   */
  setSize(width, height) {
    if (this.autoResize) {
      this.renderTarget.setSize(width, height);
    }
  }
  /**
   * Performs initialization tasks.
   *
   * @param {WebGLRenderer} renderer - A renderer.
   * @param {Boolean} alpha - Whether the renderer uses the alpha channel.
   * @param {Number} frameBufferType - The type of the main frame buffers.
   */
  initialize(renderer, alpha, frameBufferType) {
    if (frameBufferType !== void 0) {
      this.renderTarget.texture.type = frameBufferType;
      if (frameBufferType !== UnsignedByteType) {
        this.fullscreenMaterial.defines.FRAMEBUFFER_PRECISION_HIGH = "1";
      } else if (renderer !== null && renderer.outputColorSpace === SRGBColorSpace) {
        this.renderTarget.texture.colorSpace = SRGBColorSpace;
      }
    }
  }
};
var color = /* @__PURE__ */ new Color();
var ClearPass = class extends Pass {
  /**
   * Constructs a new clear pass.
   *
   * @param {Boolean} [color=true] - Determines whether the color buffer should be cleared.
   * @param {Boolean} [depth=true] - Determines whether the depth buffer should be cleared.
   * @param {Boolean} [stencil=false] - Determines whether the stencil buffer should be cleared.
   */
  constructor(color2 = true, depth = true, stencil = false) {
    super("ClearPass", null, null);
    this.needsSwap = false;
    this.color = color2;
    this.depth = depth;
    this.stencil = stencil;
    this.overrideClearColor = null;
    this.overrideClearAlpha = -1;
  }
  /**
   * Sets the clear flags.
   *
   * @param {Boolean} color - Whether the color buffer should be cleared.
   * @param {Boolean} depth - Whether the depth buffer should be cleared.
   * @param {Boolean} stencil - Whether the stencil buffer should be cleared.
   */
  setClearFlags(color2, depth, stencil) {
    this.color = color2;
    this.depth = depth;
    this.stencil = stencil;
  }
  /**
   * Returns the override clear color. Default is null.
   *
   * @deprecated Use overrideClearColor instead.
   * @return {Color} The clear color.
   */
  getOverrideClearColor() {
    return this.overrideClearColor;
  }
  /**
   * Sets the override clear color.
   *
   * @deprecated Use overrideClearColor instead.
   * @param {Color} value - The clear color.
   */
  setOverrideClearColor(value) {
    this.overrideClearColor = value;
  }
  /**
   * Returns the override clear alpha. Default is -1.
   *
   * @deprecated Use overrideClearAlpha instead.
   * @return {Number} The clear alpha.
   */
  getOverrideClearAlpha() {
    return this.overrideClearAlpha;
  }
  /**
   * Sets the override clear alpha.
   *
   * @deprecated Use overrideClearAlpha instead.
   * @param {Number} value - The clear alpha.
   */
  setOverrideClearAlpha(value) {
    this.overrideClearAlpha = value;
  }
  /**
   * Clears the input buffer or the screen.
   *
   * @param {WebGLRenderer} renderer - The renderer.
   * @param {WebGLRenderTarget} inputBuffer - A frame buffer that contains the result of the previous pass.
   * @param {WebGLRenderTarget} outputBuffer - A frame buffer that serves as the output render target unless this pass renders to screen.
   * @param {Number} [deltaTime] - The time between the last frame and the current one in seconds.
   * @param {Boolean} [stencilTest] - Indicates whether a stencil mask is active.
   */
  render(renderer, inputBuffer, outputBuffer, deltaTime, stencilTest) {
    const overrideClearColor = this.overrideClearColor;
    const overrideClearAlpha = this.overrideClearAlpha;
    const clearAlpha = renderer.getClearAlpha();
    const hasOverrideClearColor = overrideClearColor !== null;
    const hasOverrideClearAlpha = overrideClearAlpha >= 0;
    if (hasOverrideClearColor) {
      renderer.getClearColor(color);
      renderer.setClearColor(overrideClearColor, hasOverrideClearAlpha ? overrideClearAlpha : clearAlpha);
    } else if (hasOverrideClearAlpha) {
      renderer.setClearAlpha(overrideClearAlpha);
    }
    renderer.setRenderTarget(this.renderToScreen ? null : inputBuffer);
    renderer.clear(this.color, this.depth, this.stencil);
    if (hasOverrideClearColor) {
      renderer.setClearColor(color, clearAlpha);
    } else if (hasOverrideClearAlpha) {
      renderer.setClearAlpha(clearAlpha);
    }
  }
};
var MaskPass = class extends Pass {
  /**
   * Constructs a new mask pass.
   *
   * @param {Scene} scene - The scene to render.
   * @param {Camera} camera - The camera to use.
   */
  constructor(scene, camera) {
    super("MaskPass", scene, camera);
    this.needsSwap = false;
    this.clearPass = new ClearPass(false, false, true);
    this.inverse = false;
  }
  set mainScene(value) {
    this.scene = value;
  }
  set mainCamera(value) {
    this.camera = value;
  }
  /**
   * Indicates whether the mask should be inverted.
   *
   * @type {Boolean}
   */
  get inverted() {
    return this.inverse;
  }
  set inverted(value) {
    this.inverse = value;
  }
  /**
   * Indicates whether this pass should clear the stencil buffer.
   *
   * @type {Boolean}
   * @deprecated Use clearPass.enabled instead.
   */
  get clear() {
    return this.clearPass.enabled;
  }
  set clear(value) {
    this.clearPass.enabled = value;
  }
  /**
   * Returns the internal clear pass.
   *
   * @deprecated Use clearPass.enabled instead.
   * @return {ClearPass} The clear pass.
   */
  getClearPass() {
    return this.clearPass;
  }
  /**
   * Indicates whether the mask is inverted.
   *
   * @deprecated Use inverted instead.
   * @return {Boolean} Whether the mask is inverted.
   */
  isInverted() {
    return this.inverted;
  }
  /**
   * Enables or disable mask inversion.
   *
   * @deprecated Use inverted instead.
   * @param {Boolean} value - Whether the mask should be inverted.
   */
  setInverted(value) {
    this.inverted = value;
  }
  /**
   * Renders the effect.
   *
   * @param {WebGLRenderer} renderer - The renderer.
   * @param {WebGLRenderTarget} inputBuffer - A frame buffer that contains the result of the previous pass.
   * @param {WebGLRenderTarget} outputBuffer - A frame buffer that serves as the output render target unless this pass renders to screen.
   * @param {Number} [deltaTime] - The time between the last frame and the current one in seconds.
   * @param {Boolean} [stencilTest] - Indicates whether a stencil mask is active.
   */
  render(renderer, inputBuffer, outputBuffer, deltaTime, stencilTest) {
    const context2 = renderer.getContext();
    const buffers = renderer.state.buffers;
    const scene = this.scene;
    const camera = this.camera;
    const clearPass = this.clearPass;
    const writeValue = this.inverted ? 0 : 1;
    const clearValue = 1 - writeValue;
    buffers.color.setMask(false);
    buffers.depth.setMask(false);
    buffers.color.setLocked(true);
    buffers.depth.setLocked(true);
    buffers.stencil.setTest(true);
    buffers.stencil.setOp(context2.REPLACE, context2.REPLACE, context2.REPLACE);
    buffers.stencil.setFunc(context2.ALWAYS, writeValue, 4294967295);
    buffers.stencil.setClear(clearValue);
    buffers.stencil.setLocked(true);
    if (this.clearPass.enabled) {
      if (this.renderToScreen) {
        clearPass.render(renderer, null);
      } else {
        clearPass.render(renderer, inputBuffer);
        clearPass.render(renderer, outputBuffer);
      }
    }
    if (this.renderToScreen) {
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
    } else {
      renderer.setRenderTarget(inputBuffer);
      renderer.render(scene, camera);
      renderer.setRenderTarget(outputBuffer);
      renderer.render(scene, camera);
    }
    buffers.color.setLocked(false);
    buffers.depth.setLocked(false);
    buffers.stencil.setLocked(false);
    buffers.stencil.setFunc(context2.EQUAL, 1, 4294967295);
    buffers.stencil.setOp(context2.KEEP, context2.KEEP, context2.KEEP);
    buffers.stencil.setLocked(true);
  }
};
function getSafeSamples(renderer, samples) {
  const gl = renderer.getContext();
  if (samples <= 0 || typeof gl.renderbufferStorageMultisample !== "function") {
    return 0;
  }
  const maxSamples = gl.getParameter(gl.MAX_SAMPLES);
  const safeSamples = Math.min(samples, maxSamples);
  if (safeSamples <= 0) {
    return 0;
  }
  const previousRenderbuffer = gl.getParameter(gl.RENDERBUFFER_BINDING);
  const renderbuffer = gl.createRenderbuffer();
  try {
    gl.bindRenderbuffer(gl.RENDERBUFFER, renderbuffer);
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, safeSamples, gl.RGBA8, 1, 1);
    return safeSamples;
  } catch (e2) {
    return 0;
  } finally {
    gl.bindRenderbuffer(gl.RENDERBUFFER, previousRenderbuffer);
    gl.deleteRenderbuffer(renderbuffer);
  }
}
var MILLISECONDS_TO_SECONDS = 1 / 1e3;
var SECONDS_TO_MILLISECONDS = 1e3;
var Timer = class {
  /**
   * Constructs a new timer.
   */
  constructor() {
    this.startTime = performance.now();
    this.previousTime = 0;
    this.currentTime = 0;
    this._delta = 0;
    this._elapsed = 0;
    this._fixedDelta = 1e3 / 60;
    this.timescale = 1;
    this.useFixedDelta = false;
    this._autoReset = false;
  }
  /**
   * Enables or disables auto reset based on page visibility.
   *
   * If enabled, the timer will be reset when the page becomes visible. This effectively pauses the timer when the page
   * is hidden. Has no effect if the API is not supported.
   *
   * @type {Boolean}
   * @see https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API
   */
  get autoReset() {
    return this._autoReset;
  }
  set autoReset(value) {
    if (typeof document !== "undefined" && document.hidden !== void 0) {
      if (value) {
        document.addEventListener("visibilitychange", this);
      } else {
        document.removeEventListener("visibilitychange", this);
      }
      this._autoReset = value;
    }
  }
  get delta() {
    return this._delta * MILLISECONDS_TO_SECONDS;
  }
  get fixedDelta() {
    return this._fixedDelta * MILLISECONDS_TO_SECONDS;
  }
  set fixedDelta(value) {
    this._fixedDelta = value * SECONDS_TO_MILLISECONDS;
  }
  get elapsed() {
    return this._elapsed * MILLISECONDS_TO_SECONDS;
  }
  /**
   * Updates this timer.
   *
   * @param {Boolean} [timestamp] - The current time in milliseconds.
   */
  update(timestamp) {
    if (this.useFixedDelta) {
      this._delta = this.fixedDelta;
    } else {
      this.previousTime = this.currentTime;
      this.currentTime = (timestamp !== void 0 ? timestamp : performance.now()) - this.startTime;
      this._delta = this.currentTime - this.previousTime;
    }
    this._delta *= this.timescale;
    this._elapsed += this._delta;
  }
  /**
   * Resets this timer.
   */
  reset() {
    this._delta = 0;
    this._elapsed = 0;
    this.currentTime = performance.now() - this.startTime;
  }
  getDelta() {
    return this.delta;
  }
  getElapsed() {
    return this.elapsed;
  }
  handleEvent(e2) {
    if (!document.hidden) {
      this.currentTime = performance.now() - this.startTime;
    }
  }
  dispose() {
    this.autoReset = false;
  }
};
var EffectComposer = class {
  /**
   * Constructs a new effect composer.
   *
   * @param {WebGLRenderer} renderer - The renderer that should be used.
   * @param {Object} [options] - The options.
   * @param {Boolean} [options.depthBuffer=true] - Whether the main render targets should have a depth buffer.
   * @param {Boolean} [options.stencilBuffer=false] - Whether the main render targets should have a stencil buffer.
   * @param {Number} [options.multisampling=0] - The number of samples used for multisample antialiasing. Requires WebGL 2.
   * @param {TextureDataType} [options.frameBufferType=UnsignedByteType] - The type of the internal frame buffers. It's recommended to use HalfFloatType if possible.
   */
  constructor(renderer = null, {
    depthBuffer = true,
    stencilBuffer = false,
    multisampling = 0,
    frameBufferType = UnsignedByteType
  } = {}) {
    this.renderer = null;
    this.inputBuffer = this.createBuffer(depthBuffer, stencilBuffer, frameBufferType, multisampling);
    this.outputBuffer = this.inputBuffer.clone();
    this.copyPass = new CopyPass();
    this.depthRenderTarget = null;
    this.passes = [];
    this.timer = new Timer();
    this.autoRenderToScreen = true;
    this.setRenderer(renderer);
  }
  /**
   * A stable depth texture to be used by depth-aware passes.
   *
   * @type {DepthTexture}
   * @private
   */
  get stableDepthTexture() {
    return this.depthRenderTarget === null ? null : this.depthRenderTarget.depthTexture;
  }
  /**
   * The current amount of samples used for multisample anti-aliasing.
   *
   * @type {Number}
   */
  get multisampling() {
    return this.inputBuffer.samples;
  }
  /**
   * Sets the amount of MSAA samples.
   *
   * Requires WebGL 2. Set to zero to disable multisampling.
   *
   * @type {Number}
   */
  set multisampling(value) {
    const samples = this.renderer === null ? value : getSafeSamples(this.renderer, value);
    if (this.multisampling === samples) {
      return;
    }
    this.inputBuffer.samples = samples;
    this.outputBuffer.samples = samples;
    this.inputBuffer.dispose();
    this.outputBuffer.dispose();
  }
  /**
   * Returns the internal timer.
   *
   * @return {Timer} The timer.
   */
  getTimer() {
    return this.timer;
  }
  /**
   * Returns the renderer.
   *
   * @return {WebGLRenderer} The renderer.
   */
  getRenderer() {
    return this.renderer;
  }
  /**
   * Sets the renderer.
   *
   * @param {WebGLRenderer} renderer - The renderer.
   */
  setRenderer(renderer) {
    this.renderer = renderer;
    if (renderer !== null) {
      const size = renderer.getSize(new Vector2());
      const alpha = renderer.getContext().getContextAttributes().alpha;
      const frameBufferType = this.inputBuffer.texture.type;
      if (frameBufferType === UnsignedByteType && renderer.outputColorSpace === SRGBColorSpace) {
        this.inputBuffer.texture.colorSpace = SRGBColorSpace;
        this.outputBuffer.texture.colorSpace = SRGBColorSpace;
        this.inputBuffer.dispose();
        this.outputBuffer.dispose();
      }
      const samples = this.multisampling;
      this.multisampling = samples;
      renderer.autoClear = false;
      this.setSize(size.width, size.height);
      for (const pass of this.passes) {
        pass.initialize(renderer, alpha, frameBufferType);
      }
    }
  }
  /**
   * Replaces the current renderer with the given one.
   *
   * The auto clear mechanism of the provided renderer will be disabled. If the new render size differs from the
   * previous one, all passes will be updated.
   *
   * By default, the DOM element of the current renderer will automatically be removed from its parent node and the DOM
   * element of the new renderer will take its place.
   *
   * @deprecated Use setRenderer instead.
   * @param {WebGLRenderer} renderer - The new renderer.
   * @param {Boolean} updateDOM - Indicates whether the old canvas should be replaced by the new one in the DOM.
   * @return {WebGLRenderer} The old renderer.
   */
  replaceRenderer(renderer, updateDOM = true) {
    const oldRenderer = this.renderer;
    const parent = oldRenderer.domElement.parentNode;
    this.setRenderer(renderer);
    if (updateDOM && parent !== null) {
      parent.removeChild(oldRenderer.domElement);
      parent.appendChild(renderer.domElement);
    }
    return oldRenderer;
  }
  /**
   * Creates a depth texture attachment that will be provided to all passes.
   *
   * To prevent errors or incorrect behavior when the same depth buffer is attached to the input and output buffers,
   * a separate stable depth target is created alongside the ping-pong buffers. All passes receive the stable target's
   * depth texture, which is never used as a render output and therefore cannot create a feedback loop.  The stable
   * texture is populated each frame via blitFramebuffer immediately before the first buffer swap.
   *
   * @private
   */
  createDepthTexture() {
    const inputDepthTexture = new DepthTexture();
    inputDepthTexture.name = "EffectComposer.InputDepth";
    if (this.inputBuffer.stencilBuffer) {
      inputDepthTexture.format = DepthStencilFormat;
      inputDepthTexture.type = UnsignedInt248Type;
    } else {
      inputDepthTexture.type = FloatType;
    }
    const outputDepthTexture = new DepthTexture();
    outputDepthTexture.format = inputDepthTexture.format;
    outputDepthTexture.type = inputDepthTexture.type;
    outputDepthTexture.name = "EffectComposer.OutputDepth";
    const stableDepthTexture = new DepthTexture();
    stableDepthTexture.format = inputDepthTexture.format;
    stableDepthTexture.type = inputDepthTexture.type;
    stableDepthTexture.name = "EffectComposer.StableDepth";
    this.inputBuffer.depthTexture = inputDepthTexture;
    this.outputBuffer.depthTexture = outputDepthTexture;
    this.inputBuffer.dispose();
    this.outputBuffer.dispose();
    const { width, height } = this.inputBuffer;
    this.depthRenderTarget = new WebGLRenderTarget(width, height, {
      depthBuffer: true,
      stencilBuffer: this.inputBuffer.stencilBuffer,
      depthTexture: stableDepthTexture
    });
  }
  /**
   * Copies the depth buffer from the src render target into the stable depth target.
   *
   * @private
   * @param {WebGLRenderTarget} renderTarget - The render target whose depth buffer should be copied.
   */
  blitDepthBuffer(renderTarget) {
    const renderer = this.renderer;
    const depthRenderTarget = this.depthRenderTarget;
    const props = renderer.properties;
    const gl = renderer.getContext();
    renderer.setRenderTarget(depthRenderTarget);
    const srcFBO = props.get(renderTarget).__webglFramebuffer;
    const dstFBO = props.get(depthRenderTarget).__webglFramebuffer;
    const blitMask = renderTarget.stencilBuffer ? gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT : gl.DEPTH_BUFFER_BIT;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, srcFBO);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, dstFBO);
    gl.blitFramebuffer(
      0,
      0,
      renderTarget.width,
      renderTarget.height,
      0,
      0,
      depthRenderTarget.width,
      depthRenderTarget.height,
      blitMask,
      gl.NEAREST
    );
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    renderer.setRenderTarget(null);
  }
  /**
   * Deletes the current depth texture.
   *
   * @private
   */
  deleteDepthTexture() {
    const stableDepthTexture = this.stableDepthTexture;
    for (const pass of this.passes) {
      if (pass.getDepthTexture() === stableDepthTexture) {
        pass.setDepthTexture(null);
      }
    }
    if (this.depthRenderTarget !== null) {
      this.depthRenderTarget.dispose();
      this.depthRenderTarget = null;
    }
    if (this.inputBuffer.depthTexture !== null) {
      this.inputBuffer.depthTexture.dispose();
      this.inputBuffer.depthTexture = null;
    }
    if (this.outputBuffer.depthTexture !== null) {
      this.outputBuffer.depthTexture.dispose();
      this.outputBuffer.depthTexture = null;
    }
  }
  /**
   * Creates a new render target.
   *
   * @private
   * @param {Boolean} depthBuffer - Whether the render target should have a depth buffer.
   * @param {Boolean} stencilBuffer - Whether the render target should have a stencil buffer.
   * @param {Number} type - The frame buffer type.
   * @param {Number} multisampling - The number of samples to use for antialiasing.
   * @return {WebGLRenderTarget} A new render target that equals the renderer's canvas.
   */
  createBuffer(depthBuffer, stencilBuffer, type, multisampling) {
    const renderer = this.renderer;
    const size = renderer === null ? new Vector2() : renderer.getDrawingBufferSize(new Vector2());
    const renderTarget = new WebGLRenderTarget(size.width, size.height, {
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      samples: multisampling,
      stencilBuffer,
      depthBuffer,
      type
    });
    if (type === UnsignedByteType && renderer !== null && renderer.outputColorSpace === SRGBColorSpace) {
      renderTarget.texture.colorSpace = SRGBColorSpace;
    }
    renderTarget.texture.name = "EffectComposer.Buffer";
    renderTarget.texture.generateMipmaps = false;
    return renderTarget;
  }
  /**
   * Can be used to change the main scene for all registered passes and effects.
   *
   * @param {Scene} scene - The scene.
   */
  setMainScene(scene) {
    for (const pass of this.passes) {
      pass.mainScene = scene;
    }
  }
  /**
   * Can be used to change the main camera for all registered passes and effects.
   *
   * @param {Camera} camera - The camera.
   */
  setMainCamera(camera) {
    for (const pass of this.passes) {
      pass.mainCamera = camera;
    }
  }
  /**
   * Adds a pass, optionally at a specific index.
   *
   * @param {Pass} pass - A new pass.
   * @param {Number} [index] - An index at which the pass should be inserted.
   */
  addPass(pass, index2) {
    const passes = this.passes;
    const renderer = this.renderer;
    const drawingBufferSize = renderer.getDrawingBufferSize(new Vector2());
    const alpha = renderer.getContext().getContextAttributes().alpha;
    const frameBufferType = this.inputBuffer.texture.type;
    pass.renderer = renderer;
    pass.setSize(drawingBufferSize.width, drawingBufferSize.height);
    pass.initialize(renderer, alpha, frameBufferType);
    if (this.autoRenderToScreen) {
      if (passes.length > 0) {
        passes[passes.length - 1].renderToScreen = false;
      }
      if (pass.renderToScreen) {
        this.autoRenderToScreen = false;
      }
    }
    if (index2 !== void 0) {
      passes.splice(index2, 0, pass);
    } else {
      passes.push(pass);
    }
    if (this.autoRenderToScreen) {
      passes[passes.length - 1].renderToScreen = true;
    }
    if (pass.needsDepthTexture || this.depthRenderTarget !== null) {
      if (this.depthRenderTarget === null) {
        this.createDepthTexture();
        for (const existingPass of passes) {
          existingPass.setDepthTexture(this.stableDepthTexture);
        }
      } else {
        pass.setDepthTexture(this.stableDepthTexture);
      }
    }
  }
  /**
   * Removes a pass.
   *
   * @param {Pass} pass - The pass.
   */
  removePass(pass) {
    const passes = this.passes;
    const index2 = passes.indexOf(pass);
    const exists = index2 !== -1;
    const removed = exists && passes.splice(index2, 1).length > 0;
    if (removed) {
      const stableDepthTexture = this.stableDepthTexture;
      if (stableDepthTexture !== null) {
        const reducer = (a, b2) => a || b2.needsDepthTexture;
        const depthTextureRequired = passes.reduce(reducer, false);
        if (!depthTextureRequired) {
          if (pass.getDepthTexture() === stableDepthTexture) {
            pass.setDepthTexture(null);
          }
          this.deleteDepthTexture();
        }
      }
      if (this.autoRenderToScreen) {
        if (index2 === passes.length) {
          pass.renderToScreen = false;
          if (passes.length > 0) {
            passes[passes.length - 1].renderToScreen = true;
          }
        }
      }
    }
  }
  /**
   * Removes all passes.
   */
  removeAllPasses() {
    const passes = this.passes;
    this.deleteDepthTexture();
    if (passes.length > 0) {
      if (this.autoRenderToScreen) {
        passes[passes.length - 1].renderToScreen = false;
      }
      this.passes = [];
    }
  }
  /**
   * Renders all enabled passes in the order in which they were added.
   *
   * @param {Number} [deltaTime] - The time since the last frame in seconds.
   */
  render(deltaTime) {
    const renderer = this.renderer;
    const copyPass = this.copyPass;
    let inputBuffer = this.inputBuffer;
    let outputBuffer = this.outputBuffer;
    let buffer2;
    let stencilTest = false;
    if (deltaTime === void 0) {
      this.timer.update();
      deltaTime = this.timer.getDelta();
    }
    for (const pass of this.passes) {
      if (!pass.enabled) {
        continue;
      }
      pass.render(renderer, inputBuffer, outputBuffer, deltaTime, stencilTest);
      if (pass.needsDepthBlit) {
        if (this.depthRenderTarget !== null) {
          this.blitDepthBuffer(inputBuffer);
        }
      }
      if (pass.needsSwap) {
        if (stencilTest) {
          copyPass.renderToScreen = pass.renderToScreen;
          const context2 = renderer.getContext();
          const stencil = renderer.state.buffers.stencil;
          stencil.setFunc(context2.NOTEQUAL, 1, 4294967295);
          copyPass.render(renderer, inputBuffer, outputBuffer, deltaTime, stencilTest);
          stencil.setFunc(context2.EQUAL, 1, 4294967295);
        }
        buffer2 = inputBuffer;
        inputBuffer = outputBuffer;
        outputBuffer = buffer2;
      }
      if (pass instanceof MaskPass) {
        stencilTest = true;
      } else if (pass instanceof ClearMaskPass) {
        stencilTest = false;
      }
    }
  }
  /**
   * Sets the size of the buffers, passes and the renderer.
   *
   * @param {Number} width - The width.
   * @param {Number} height - The height.
   * @param {Boolean} [updateStyle] - Determines whether the style of the canvas should be updated.
   */
  setSize(width, height, updateStyle) {
    const renderer = this.renderer;
    const currentSize = renderer.getSize(new Vector2());
    if (width === void 0 || height === void 0) {
      width = currentSize.width;
      height = currentSize.height;
    }
    if (currentSize.width !== width || currentSize.height !== height) {
      renderer.setSize(width, height, updateStyle);
    }
    const drawingBufferSize = renderer.getDrawingBufferSize(new Vector2());
    this.inputBuffer.setSize(drawingBufferSize.width, drawingBufferSize.height);
    this.outputBuffer.setSize(drawingBufferSize.width, drawingBufferSize.height);
    if (this.depthRenderTarget !== null) {
      this.depthRenderTarget.setSize(drawingBufferSize.width, drawingBufferSize.height);
    }
    for (const pass of this.passes) {
      pass.setSize(drawingBufferSize.width, drawingBufferSize.height);
    }
  }
  /**
   * Resets this composer by deleting all passes and creating new buffers.
   */
  reset() {
    this.dispose();
    this.autoRenderToScreen = true;
  }
  /**
   * Disposes this composer and all passes.
   */
  dispose() {
    for (const pass of this.passes) {
      pass.dispose();
    }
    this.deleteDepthTexture();
    this.inputBuffer.dispose();
    this.outputBuffer.dispose();
    this.copyPass.dispose();
    this.timer.dispose();
    this.passes = [];
    Pass.fullscreenGeometry.dispose();
  }
};
var EffectAttribute = {
  NONE: 0,
  DEPTH: 1,
  CONVOLUTION: 2
};
var EffectShaderSection = {
  FRAGMENT_HEAD: "FRAGMENT_HEAD",
  FRAGMENT_MAIN_UV: "FRAGMENT_MAIN_UV",
  FRAGMENT_MAIN_IMAGE: "FRAGMENT_MAIN_IMAGE",
  VERTEX_HEAD: "VERTEX_HEAD",
  VERTEX_MAIN_SUPPORT: "VERTEX_MAIN_SUPPORT"
};
var EffectShaderData = class {
  /**
   * Constructs new shader data.
   */
  constructor() {
    this.shaderParts = /* @__PURE__ */ new Map([
      [EffectShaderSection.FRAGMENT_HEAD, null],
      [EffectShaderSection.FRAGMENT_MAIN_UV, null],
      [EffectShaderSection.FRAGMENT_MAIN_IMAGE, null],
      [EffectShaderSection.VERTEX_HEAD, null],
      [EffectShaderSection.VERTEX_MAIN_SUPPORT, null]
    ]);
    this.defines = /* @__PURE__ */ new Map();
    this.uniforms = /* @__PURE__ */ new Map();
    this.blendModes = /* @__PURE__ */ new Map();
    this.extensions = /* @__PURE__ */ new Set();
    this.attributes = EffectAttribute.NONE;
    this.varyings = /* @__PURE__ */ new Set();
    this.uvTransformation = false;
    this.readDepth = false;
    this.colorSpace = LinearSRGBColorSpace;
  }
};
var workaroundEnabled = false;
var OverrideMaterialManager = class {
  /**
   * Constructs a new override material manager.
   *
   * @param {Material} [material=null] - An override material.
   */
  constructor(material = null) {
    this.originalMaterials = /* @__PURE__ */ new Map();
    this.material = null;
    this.materials = null;
    this.materialsBackSide = null;
    this.materialsDoubleSide = null;
    this.materialsFlatShaded = null;
    this.materialsFlatShadedBackSide = null;
    this.materialsFlatShadedDoubleSide = null;
    this.setMaterial(material);
    this.meshCount = 0;
    this.replaceMaterial = (node) => {
      if (node.isMesh) {
        let materials;
        if (node.material.flatShading) {
          switch (node.material.side) {
            case DoubleSide:
              materials = this.materialsFlatShadedDoubleSide;
              break;
            case BackSide:
              materials = this.materialsFlatShadedBackSide;
              break;
            default:
              materials = this.materialsFlatShaded;
              break;
          }
        } else {
          switch (node.material.side) {
            case DoubleSide:
              materials = this.materialsDoubleSide;
              break;
            case BackSide:
              materials = this.materialsBackSide;
              break;
            default:
              materials = this.materials;
              break;
          }
        }
        this.originalMaterials.set(node, node.material);
        if (node.isSkinnedMesh) {
          node.material = materials[2];
        } else if (node.isInstancedMesh) {
          node.material = materials[1];
        } else {
          node.material = materials[0];
        }
        ++this.meshCount;
      }
    };
  }
  /**
   * Clones the given material.
   *
   * @private
   * @param {Material} material - The material.
   * @return {Material} The cloned material.
   */
  cloneMaterial(material) {
    if (!(material instanceof ShaderMaterial)) {
      return material.clone();
    }
    const uniforms = material.uniforms;
    const textureUniforms = /* @__PURE__ */ new Map();
    for (const key in uniforms) {
      const value = uniforms[key].value;
      if (value.isRenderTargetTexture) {
        uniforms[key].value = null;
        textureUniforms.set(key, value);
      }
    }
    const clone = material.clone();
    for (const entry of textureUniforms) {
      uniforms[entry[0]].value = entry[1];
      clone.uniforms[entry[0]].value = entry[1];
    }
    return clone;
  }
  /**
   * Sets the override material.
   *
   * @param {Material} material - The material.
   */
  setMaterial(material) {
    this.disposeMaterials();
    this.material = material;
    if (material !== null) {
      const materials = this.materials = [
        this.cloneMaterial(material),
        this.cloneMaterial(material),
        this.cloneMaterial(material)
      ];
      for (const m2 of materials) {
        m2.uniforms = Object.assign({}, material.uniforms);
        m2.side = FrontSide;
      }
      materials[2].skinning = true;
      this.materialsBackSide = materials.map((m2) => {
        const c2 = this.cloneMaterial(m2);
        c2.uniforms = Object.assign({}, material.uniforms);
        c2.side = BackSide;
        return c2;
      });
      this.materialsDoubleSide = materials.map((m2) => {
        const c2 = this.cloneMaterial(m2);
        c2.uniforms = Object.assign({}, material.uniforms);
        c2.side = DoubleSide;
        return c2;
      });
      this.materialsFlatShaded = materials.map((m2) => {
        const c2 = this.cloneMaterial(m2);
        c2.uniforms = Object.assign({}, material.uniforms);
        c2.flatShading = true;
        return c2;
      });
      this.materialsFlatShadedBackSide = materials.map((m2) => {
        const c2 = this.cloneMaterial(m2);
        c2.uniforms = Object.assign({}, material.uniforms);
        c2.flatShading = true;
        c2.side = BackSide;
        return c2;
      });
      this.materialsFlatShadedDoubleSide = materials.map((m2) => {
        const c2 = this.cloneMaterial(m2);
        c2.uniforms = Object.assign({}, material.uniforms);
        c2.flatShading = true;
        c2.side = DoubleSide;
        return c2;
      });
    }
  }
  /**
   * Renders the scene with the override material.
   *
   * @private
   * @param {WebGLRenderer} renderer - The renderer.
   * @param {Scene} scene - A scene.
   * @param {Camera} camera - A camera.
   */
  render(renderer, scene, camera) {
    const shadowMapEnabled = renderer.shadowMap.enabled;
    renderer.shadowMap.enabled = false;
    if (workaroundEnabled) {
      const originalMaterials = this.originalMaterials;
      this.meshCount = 0;
      scene.traverse(this.replaceMaterial);
      renderer.render(scene, camera);
      for (const entry of originalMaterials) {
        entry[0].material = entry[1];
      }
      if (this.meshCount !== originalMaterials.size) {
        originalMaterials.clear();
      }
    } else {
      const overrideMaterial = scene.overrideMaterial;
      scene.overrideMaterial = this.material;
      renderer.render(scene, camera);
      scene.overrideMaterial = overrideMaterial;
    }
    renderer.shadowMap.enabled = shadowMapEnabled;
  }
  /**
   * Deletes cloned override materials.
   *
   * @private
   */
  disposeMaterials() {
    if (this.material !== null) {
      const materials = this.materials.concat(this.materialsBackSide).concat(this.materialsDoubleSide).concat(this.materialsFlatShaded).concat(this.materialsFlatShadedBackSide).concat(this.materialsFlatShadedDoubleSide);
      for (const m2 of materials) {
        m2.dispose();
      }
    }
  }
  /**
   * Performs cleanup tasks.
   */
  dispose() {
    this.originalMaterials.clear();
    this.disposeMaterials();
  }
  /**
   * Indicates whether the override material workaround is enabled.
   *
   * @type {Boolean}
   */
  static get workaroundEnabled() {
    return workaroundEnabled;
  }
  /**
   * Enables or disables the override material workaround globally.
   *
   * This only affects post processing passes and effects.
   *
   * @type {Boolean}
   */
  static set workaroundEnabled(value) {
    workaroundEnabled = value;
  }
};
var AUTO_SIZE = -1;
var Resolution = class extends EventDispatcher {
  /**
   * Constructs a new resolution.
   *
   * @param {Resizable} [resizable=null] - Deprecated. Use `addEventListener("change", listener)` instead.
   * @param {Number} [width=Resolution.AUTO_SIZE] - The preferred width.
   * @param {Number} [height=Resolution.AUTO_SIZE] - The preferred height.
   * @param {Number} [scale=1.0] - A resolution scale.
   */
  constructor(resizable = null, width = AUTO_SIZE, height = AUTO_SIZE, scale = 1) {
    super();
    if (resizable !== null) {
      this.addEventListener("change", () => resizable.setSize(this.baseSize.width, this.baseSize.height));
    }
    this.baseSize = new Vector2(1, 1);
    this.preferredSize = new Vector2(width, height);
    this.target = this.preferredSize;
    this.s = scale;
    this.effectiveSize = new Vector2();
    this.addEventListener("change", () => this.updateEffectiveSize());
    this.updateEffectiveSize();
  }
  /**
   * Calculates the effective size.
   *
   * @private
   */
  updateEffectiveSize() {
    const base = this.baseSize;
    const preferred = this.preferredSize;
    const effective = this.effectiveSize;
    const scale = this.scale;
    if (preferred.width !== AUTO_SIZE) {
      effective.width = preferred.width;
    } else if (preferred.height !== AUTO_SIZE) {
      effective.width = Math.round(preferred.height * (base.width / Math.max(base.height, 1)));
    } else {
      effective.width = Math.round(base.width * scale);
    }
    if (preferred.height !== AUTO_SIZE) {
      effective.height = preferred.height;
    } else if (preferred.width !== AUTO_SIZE) {
      effective.height = Math.round(preferred.width / Math.max(base.width / Math.max(base.height, 1), 1));
    } else {
      effective.height = Math.round(base.height * scale);
    }
  }
  /**
   * The effective width.
   *
   * If the preferred width and height are set to {@link Resizer.AUTO_SIZE}, the base width will be returned.
   *
   * @type {Number}
   */
  get width() {
    return this.effectiveSize.width;
  }
  set width(value) {
    this.preferredWidth = value;
  }
  /**
   * The effective height.
   *
   * If the preferred width and height are set to {@link Resizer.AUTO_SIZE}, the base height will be returned.
   *
   * @type {Number}
   */
  get height() {
    return this.effectiveSize.height;
  }
  set height(value) {
    this.preferredHeight = value;
  }
  /**
   * Returns the effective width.
   *
   * If the preferred width and height are set to {@link Resizer.AUTO_SIZE}, the base width will be returned.
   *
   * @deprecated Use width instead.
   * @return {Number} The effective width.
   */
  getWidth() {
    return this.width;
  }
  /**
   * Returns the effective height.
   *
   * If the preferred width and height are set to {@link Resizer.AUTO_SIZE}, the base height will be returned.
   *
   * @deprecated Use height instead.
   * @return {Number} The effective height.
   */
  getHeight() {
    return this.height;
  }
  /**
   * The resolution scale.
   *
   * @type {Number}
   */
  get scale() {
    return this.s;
  }
  set scale(value) {
    if (this.s !== value) {
      this.s = value;
      this.preferredSize.setScalar(AUTO_SIZE);
      this.dispatchEvent({ type: "change" });
    }
  }
  /**
   * Returns the current resolution scale.
   *
   * @deprecated Use scale instead.
   * @return {Number} The scale.
   */
  getScale() {
    return this.scale;
  }
  /**
   * Sets the resolution scale.
   *
   * Also sets the preferred resolution to {@link Resizer.AUTO_SIZE}.
   *
   * @deprecated Use scale instead.
   * @param {Number} value - The scale.
   */
  setScale(value) {
    this.scale = value;
  }
  /**
   * The base width.
   *
   * @type {Number}
   */
  get baseWidth() {
    return this.baseSize.width;
  }
  set baseWidth(value) {
    if (this.baseSize.width !== value) {
      this.baseSize.width = value;
      this.dispatchEvent({ type: "change" });
    }
  }
  /**
   * Returns the base width.
   *
   * @deprecated Use baseWidth instead.
   * @return {Number} The base width.
   */
  getBaseWidth() {
    return this.baseWidth;
  }
  /**
   * Sets the base width.
   *
   * @deprecated Use baseWidth instead.
   * @param {Number} value - The width.
   */
  setBaseWidth(value) {
    this.baseWidth = value;
  }
  /**
   * The base height.
   *
   * @type {Number}
   */
  get baseHeight() {
    return this.baseSize.height;
  }
  set baseHeight(value) {
    if (this.baseSize.height !== value) {
      this.baseSize.height = value;
      this.dispatchEvent({ type: "change" });
    }
  }
  /**
   * Returns the base height.
   *
   * @deprecated Use baseHeight instead.
   * @return {Number} The base height.
   */
  getBaseHeight() {
    return this.baseHeight;
  }
  /**
   * Sets the base height.
   *
   * @deprecated Use baseHeight instead.
   * @param {Number} value - The height.
   */
  setBaseHeight(value) {
    this.baseHeight = value;
  }
  /**
   * Sets the base size.
   *
   * @param {Number} width - The width.
   * @param {Number} height - The height.
   */
  setBaseSize(width, height) {
    if (this.baseSize.width !== width || this.baseSize.height !== height) {
      this.baseSize.set(width, height);
      this.dispatchEvent({ type: "change" });
    }
  }
  /**
   * The preferred width.
   *
   * @type {Number}
   */
  get preferredWidth() {
    return this.preferredSize.width;
  }
  set preferredWidth(value) {
    if (this.preferredSize.width !== value) {
      this.preferredSize.width = value;
      this.dispatchEvent({ type: "change" });
    }
  }
  /**
   * Returns the preferred width.
   *
   * @deprecated Use preferredWidth instead.
   * @return {Number} The preferred width.
   */
  getPreferredWidth() {
    return this.preferredWidth;
  }
  /**
   * Sets the preferred width.
   *
   * Use {@link Resizer.AUTO_SIZE} to automatically calculate the width based on the height and aspect ratio.
   *
   * @deprecated Use preferredWidth instead.
   * @param {Number} value - The width.
   */
  setPreferredWidth(value) {
    this.preferredWidth = value;
  }
  /**
   * The preferred height.
   *
   * @type {Number}
   */
  get preferredHeight() {
    return this.preferredSize.height;
  }
  set preferredHeight(value) {
    if (this.preferredSize.height !== value) {
      this.preferredSize.height = value;
      this.dispatchEvent({ type: "change" });
    }
  }
  /**
   * Returns the preferred height.
   *
   * @deprecated Use preferredHeight instead.
   * @return {Number} The preferred height.
   */
  getPreferredHeight() {
    return this.preferredHeight;
  }
  /**
   * Sets the preferred height.
   *
   * Use {@link Resizer.AUTO_SIZE} to automatically calculate the height based on the width and aspect ratio.
   *
   * @deprecated Use preferredHeight instead.
   * @param {Number} value - The height.
   */
  setPreferredHeight(value) {
    this.preferredHeight = value;
  }
  /**
   * Sets the preferred size.
   *
   * @param {Number} width - The width.
   * @param {Number} height - The height.
   */
  setPreferredSize(width, height) {
    if (this.preferredSize.width !== width || this.preferredSize.height !== height) {
      this.preferredSize.set(width, height);
      this.dispatchEvent({ type: "change" });
    }
  }
  /**
   * Copies the given resolution.
   *
   * @param {Resolution} resolution - The resolution.
   */
  copy(resolution) {
    this.s = resolution.scale;
    this.baseSize.set(resolution.baseWidth, resolution.baseHeight);
    this.preferredSize.set(resolution.preferredWidth, resolution.preferredHeight);
    this.dispatchEvent({ type: "change" });
  }
  /**
   * An auto sizing constant.
   *
   * Can be used to automatically calculate the width or height based on the original aspect ratio.
   *
   * @type {Number}
   */
  static get AUTO_SIZE() {
    return AUTO_SIZE;
  }
};
var BlendFunction = {
  SKIP: 9,
  SET: 30,
  ADD: 0,
  ALPHA: 1,
  AVERAGE: 2,
  COLOR: 3,
  COLOR_BURN: 4,
  COLOR_DODGE: 5,
  DARKEN: 6,
  DIFFERENCE: 7,
  DIVIDE: 8,
  DST: 9,
  EXCLUSION: 10,
  HARD_LIGHT: 11,
  HARD_MIX: 12,
  HUE: 13,
  INVERT: 14,
  INVERT_RGB: 15,
  LIGHTEN: 16,
  LINEAR_BURN: 17,
  LINEAR_DODGE: 18,
  LINEAR_LIGHT: 19,
  LUMINOSITY: 20,
  MULTIPLY: 21,
  NEGATION: 22,
  NORMAL: 23,
  OVERLAY: 24,
  PIN_LIGHT: 25,
  REFLECT: 26,
  SATURATION: 27,
  SCREEN: 28,
  SOFT_LIGHT: 29,
  SRC: 30,
  SUBTRACT: 31,
  VIVID_LIGHT: 32
};
var add_default = `vec4 blend(const in vec4 dst,const in vec4 src,const in float opacity){vec3 c=dst.rgb+src.rgb;return mix(dst,vec4(c,max(dst.a,src.a)),opacity);}`;
var alpha_default = `vec4 blend(const in vec4 dst,const in vec4 src,const in float opacity){return mix(dst,src,src.a*opacity);}`;
var average_default = `vec4 blend(const in vec4 dst,const in vec4 src,const in float opacity){vec3 c=(dst.rgb+src.rgb)*0.5;return mix(dst,vec4(c,max(dst.a,src.a)),opacity);}`;
var color_default = `vec4 blend(const in vec4 dst,const in vec4 src,const in float opacity){vec3 a=RGBToHSL(dst.rgb);vec3 b=RGBToHSL(src.rgb);vec3 c=HSLToRGB(vec3(b.xy,a.z));return mix(dst,vec4(c,max(dst.a,src.a)),opacity);}`;
var color_burn_default = `vec4 blend(const in vec4 dst,const in vec4 src,const in float opacity){vec3 a=dst.rgb,b=src.rgb;vec3 c=mix(step(0.0,b)*(1.0-min(vec3(1.0),(1.0-a)/max(b,1e-9))),vec3(1.0),step(1.0,a));return mix(dst,vec4(c,max(dst.a,src.a)),opacity);}`;
var color_dodge_default = `vec4 blend(const in vec4 dst,const in vec4 src,const in float opacity){vec3 a=dst.rgb,b=src.rgb;vec3 c=step(0.0,a)*mix(min(vec3(1.0),a/max(1.0-b,1e-9)),vec3(1.0),step(1.0,b));return mix(dst,vec4(c,max(dst.a,src.a)),opacity);}`;
var darken_default = `vec4 blend(const in vec4 dst,const in vec4 src,const in float opacity){vec3 c=min(dst.rgb,src.rgb);return mix(dst,vec4(c,max(dst.a,src.a)),opacity);}`;
var difference_default = `vec4 blend(const in vec4 dst,const in vec4 src,const in float opacity){vec3 c=abs(dst.rgb-src.rgb);return mix(dst,vec4(c,max(dst.a,src.a)),opacity);}`;
var divide_default = `vec4 blend(const in vec4 dst,const in vec4 src,const in float opacity){vec3 c=dst.rgb/max(src.rgb,1e-9);return mix(dst,vec4(c,max(dst.a,src.a)),opacity);}`;
var exclusion_default = `vec4 blend(const in vec4 dst,const in vec4 src,const in float opacity){vec3 c=dst.rgb+src.rgb-2.0*dst.rgb*src.rgb;return mix(dst,vec4(c,max(dst.a,src.a)),opacity);}`;
var hard_light_default = `vec4 blend(const in vec4 dst,const in vec4 src,const in float opacity){vec3 a=min(dst.rgb,1.0);vec3 b=min(src.rgb,1.0);vec3 c=mix(2.0*a*b,1.0-2.0*(1.0-a)*(1.0-b),step(0.5,b));return mix(dst,vec4(c,max(dst.a,src.a)),opacity);}`;
var hard_mix_default = `vec4 blend(const in vec4 dst,const in vec4 src,const in float opacity){vec3 c=step(1.0,dst.rgb+src.rgb);return mix(dst,vec4(c,max(dst.a,src.a)),opacity);}`;
var hue_default = `vec4 blend(const in vec4 dst,const in vec4 src,const in float opacity){vec3 a=RGBToHSL(dst.rgb);vec3 b=RGBToHSL(src.rgb);vec3 c=HSLToRGB(vec3(b.x,a.yz));return mix(dst,vec4(c,max(dst.a,src.a)),opacity);}`;
var invert_default = `vec4 blend(const in vec4 dst,const in vec4 src,const in float opacity){vec3 c=max(1.0-src.rgb,0.0);return mix(dst,vec4(c,max(dst.a,src.a)),opacity);}`;
var invert_rgb_default = `vec4 blend(const in vec4 dst,const in vec4 src,const in float opacity){vec3 c=src.rgb*max(1.0-dst.rgb,0.0);return mix(dst,vec4(c,max(dst.a,src.a)),opacity);}`;
var lighten_default = `vec4 blend(const in vec4 dst,const in vec4 src,const in float opacity){vec3 c=max(dst.rgb,src.rgb);return mix(dst,vec4(c,max(dst.a,src.a)),opacity);}`;
var linear_burn_default = `vec4 blend(const in vec4 dst,const in vec4 src,const in float opacity){vec3 c=clamp(src.rgb+dst.rgb-1.0,0.0,1.0);return mix(dst,vec4(c,max(dst.a,src.a)),opacity);}`;
var linear_dodge_default = `vec4 blend(const in vec4 dst,const in vec4 src,const in float opacity){vec3 c=min(dst.rgb+src.rgb,1.0);return mix(dst,vec4(c,max(dst.a,src.a)),opacity);}`;
var linear_light_default = `vec4 blend(const in vec4 dst,const in vec4 src,const in float opacity){vec3 c=clamp(2.0*src.rgb+dst.rgb-1.0,0.0,1.0);return mix(dst,vec4(c,max(dst.a,src.a)),opacity);}`;
var luminosity_default = `vec4 blend(const in vec4 dst,const in vec4 src,const in float opacity){vec3 a=RGBToHSL(dst.rgb);vec3 b=RGBToHSL(src.rgb);vec3 c=HSLToRGB(vec3(a.xy,b.z));return mix(dst,vec4(c,max(dst.a,src.a)),opacity);}`;
var multiply_default = `vec4 blend(const in vec4 dst,const in vec4 src,const in float opacity){vec3 c=dst.rgb*src.rgb;return mix(dst,vec4(c,max(dst.a,src.a)),opacity);}`;
var negation_default = `vec4 blend(const in vec4 dst,const in vec4 src,const in float opacity){vec3 c=max(1.0-abs(1.0-dst.rgb-src.rgb),0.0);return mix(dst,vec4(c,max(dst.a,src.a)),opacity);}`;
var normal_default = `vec4 blend(const in vec4 dst,const in vec4 src,const in float opacity){return mix(dst,src,opacity);}`;
var overlay_default = `vec4 blend(const in vec4 dst,const in vec4 src,const in float opacity){vec3 a=2.0*src.rgb*dst.rgb;vec3 b=1.0-2.0*(1.0-src.rgb)*(1.0-dst.rgb);vec3 c=mix(a,b,step(0.5,dst.rgb));return mix(dst,vec4(c,max(dst.a,src.a)),opacity);}`;
var pin_light_default = `vec4 blend(const in vec4 dst,const in vec4 src,const in float opacity){vec3 src2=2.0*src.rgb;vec3 c=mix(mix(src2,dst.rgb,step(0.5*dst.rgb,src.rgb)),max(src2-1.0,vec3(0.0)),step(dst.rgb,src2-1.0));return mix(dst,vec4(c,max(dst.a,src.a)),opacity);}`;
var reflect_default = `vec4 blend(const in vec4 dst,const in vec4 src,const in float opacity){vec3 a=min(dst.rgb*dst.rgb/max(1.0-src.rgb,1e-9),1.0);vec3 c=mix(a,src.rgb,step(1.0,src.rgb));return mix(dst,vec4(c,max(dst.a,src.a)),opacity);}`;
var saturation_default = `vec4 blend(const in vec4 dst,const in vec4 src,const in float opacity){vec3 a=RGBToHSL(dst.rgb);vec3 b=RGBToHSL(src.rgb);vec3 c=HSLToRGB(vec3(a.x,b.y,a.z));return mix(dst,vec4(c,max(dst.a,src.a)),opacity);}`;
var screen_default = `vec4 blend(const in vec4 dst,const in vec4 src,const in float opacity){vec3 c=dst.rgb+src.rgb-min(dst.rgb*src.rgb,1.0);return mix(dst,vec4(c,max(dst.a,src.a)),opacity);}`;
var soft_light_default = `vec4 blend(const in vec4 dst,const in vec4 src,const in float opacity){vec3 src2=2.0*src.rgb;vec3 d=dst.rgb+(src2-1.0);vec3 w=step(0.5,src.rgb);vec3 a=dst.rgb-(1.0-src2)*dst.rgb*(1.0-dst.rgb);vec3 b=mix(d*(sqrt(dst.rgb)-dst.rgb),d*dst.rgb*((16.0*dst.rgb-12.0)*dst.rgb+3.0),w*(1.0-step(0.25,dst.rgb)));vec3 c=mix(a,b,w);return mix(dst,vec4(c,max(dst.a,src.a)),opacity);}`;
var src_default = `vec4 blend(const in vec4 dst,const in vec4 src,const in float opacity){return src;}`;
var subtract_default = `vec4 blend(const in vec4 dst,const in vec4 src,const in float opacity){vec3 c=max(dst.rgb-src.rgb,0.0);return mix(dst,vec4(c,max(dst.a,src.a)),opacity);}`;
var vivid_light_default = `vec4 blend(const in vec4 dst,const in vec4 src,const in float opacity){vec3 c=mix(max(1.0-min((1.0-dst.rgb)/(2.0*src.rgb),1.0),0.0),min(dst.rgb/(2.0*(1.0-src.rgb)),1.0),step(0.5,src.rgb));return mix(dst,vec4(c,max(dst.a,src.a)),opacity);}`;
var blendFunctions = /* @__PURE__ */ new Map([
  [BlendFunction.ADD, add_default],
  [BlendFunction.ALPHA, alpha_default],
  [BlendFunction.AVERAGE, average_default],
  [BlendFunction.COLOR, color_default],
  [BlendFunction.COLOR_BURN, color_burn_default],
  [BlendFunction.COLOR_DODGE, color_dodge_default],
  [BlendFunction.DARKEN, darken_default],
  [BlendFunction.DIFFERENCE, difference_default],
  [BlendFunction.DIVIDE, divide_default],
  [BlendFunction.DST, null],
  [BlendFunction.EXCLUSION, exclusion_default],
  [BlendFunction.HARD_LIGHT, hard_light_default],
  [BlendFunction.HARD_MIX, hard_mix_default],
  [BlendFunction.HUE, hue_default],
  [BlendFunction.INVERT, invert_default],
  [BlendFunction.INVERT_RGB, invert_rgb_default],
  [BlendFunction.LIGHTEN, lighten_default],
  [BlendFunction.LINEAR_BURN, linear_burn_default],
  [BlendFunction.LINEAR_DODGE, linear_dodge_default],
  [BlendFunction.LINEAR_LIGHT, linear_light_default],
  [BlendFunction.LUMINOSITY, luminosity_default],
  [BlendFunction.MULTIPLY, multiply_default],
  [BlendFunction.NEGATION, negation_default],
  [BlendFunction.NORMAL, normal_default],
  [BlendFunction.OVERLAY, overlay_default],
  [BlendFunction.PIN_LIGHT, pin_light_default],
  [BlendFunction.REFLECT, reflect_default],
  [BlendFunction.SATURATION, saturation_default],
  [BlendFunction.SCREEN, screen_default],
  [BlendFunction.SOFT_LIGHT, soft_light_default],
  [BlendFunction.SRC, src_default],
  [BlendFunction.SUBTRACT, subtract_default],
  [BlendFunction.VIVID_LIGHT, vivid_light_default]
]);
var BlendMode = class extends EventDispatcher {
  /**
   * Constructs a new blend mode.
   *
   * @param {BlendFunction} blendFunction - The blend function.
   * @param {Number} opacity - The opacity of the color that will be blended with the base color.
   */
  constructor(blendFunction, opacity = 1) {
    super();
    this._blendFunction = blendFunction;
    this.opacity = new Uniform(opacity);
  }
  /**
   * Returns the opacity.
   *
   * @return {Number} The opacity.
   */
  getOpacity() {
    return this.opacity.value;
  }
  /**
   * Sets the opacity.
   *
   * @param {Number} value - The opacity.
   */
  setOpacity(value) {
    this.opacity.value = value;
  }
  /**
   * The blend function.
   *
   * @type {BlendFunction}
   */
  get blendFunction() {
    return this._blendFunction;
  }
  set blendFunction(value) {
    this._blendFunction = value;
    this.dispatchEvent({ type: "change" });
  }
  /**
   * Returns the blend function.
   *
   * @deprecated Use blendFunction instead.
   * @return {BlendFunction} The blend function.
   */
  getBlendFunction() {
    return this.blendFunction;
  }
  /**
   * Sets the blend function.
   *
   * @deprecated Use blendFunction instead.
   * @param {BlendFunction} value - The blend function.
   */
  setBlendFunction(value) {
    this.blendFunction = value;
  }
  /**
   * Returns the blend function shader code.
   *
   * @return {String} The blend function shader code.
   */
  getShaderCode() {
    return blendFunctions.get(this.blendFunction);
  }
};
var Effect = class extends EventDispatcher {
  /**
   * Constructs a new effect.
   *
   * @param {String} name - The name of this effect. Doesn't have to be unique.
   * @param {String} fragmentShader - The fragment shader. This shader is required.
   * @param {Object} [options] - Additional options.
   * @param {EffectAttribute} [options.attributes=EffectAttribute.NONE] - The effect attributes that determine the execution priority and resource requirements.
   * @param {BlendFunction} [options.blendFunction=BlendFunction.NORMAL] - The blend function of this effect.
   * @param {Map<String, String>} [options.defines] - Custom preprocessor macro definitions. Keys are names and values are code.
   * @param {Map<String, Uniform>} [options.uniforms] - Custom shader uniforms. Keys are names and values are uniforms.
   * @param {Set<WebGLExtension>} [options.extensions] - WebGL extensions.
   * @param {String} [options.vertexShader=null] - The vertex shader. Most effects don't need one.
   */
  constructor(name, fragmentShader, {
    attributes = EffectAttribute.NONE,
    blendFunction = BlendFunction.NORMAL,
    defines = /* @__PURE__ */ new Map(),
    uniforms = /* @__PURE__ */ new Map(),
    extensions = null,
    vertexShader = null
  } = {}) {
    super();
    this.name = name;
    this.renderer = null;
    this.attributes = attributes;
    this.fragmentShader = fragmentShader;
    this.vertexShader = vertexShader;
    this.defines = defines;
    this.uniforms = uniforms;
    this.extensions = extensions;
    this.blendMode = new BlendMode(blendFunction);
    this.blendMode.addEventListener("change", (event) => this.setChanged());
    this._inputColorSpace = LinearSRGBColorSpace;
    this._outputColorSpace = NoColorSpace;
  }
  /**
   * The input color space.
   *
   * @type {ColorSpace}
   * @experimental
   */
  get inputColorSpace() {
    return this._inputColorSpace;
  }
  /**
   * @type {ColorSpace}
   * @protected
   * @experimental
   */
  set inputColorSpace(value) {
    this._inputColorSpace = value;
    this.setChanged();
  }
  /**
   * The output color space.
   *
   * Should only be changed if this effect converts the input colors to a different color space.
   *
   * @type {ColorSpace}
   * @experimental
   */
  get outputColorSpace() {
    return this._outputColorSpace;
  }
  /**
   * @type {ColorSpace}
   * @protected
   * @experimental
   */
  set outputColorSpace(value) {
    this._outputColorSpace = value;
    this.setChanged();
  }
  /**
   * Sets the main scene.
   *
   * @type {Scene}
   */
  set mainScene(value) {
  }
  /**
   * Sets the main camera.
   *
   * @type {Camera}
   */
  set mainCamera(value) {
  }
  /**
   * Returns the name of this effect.
   *
   * @deprecated Use name instead.
   * @return {String} The name.
   */
  getName() {
    return this.name;
  }
  /**
   * Sets the renderer.
   *
   * @deprecated
   * @param {WebGLRenderer} renderer - The renderer.
   */
  setRenderer(renderer) {
    this.renderer = renderer;
  }
  /**
   * Returns the preprocessor macro definitions.
   *
   * @deprecated Use defines instead.
   * @return {Map<String, String>} The extensions.
   */
  getDefines() {
    return this.defines;
  }
  /**
   * Returns the uniforms of this effect.
   *
   * @deprecated Use uniforms instead.
   * @return {Map<String, Uniform>} The extensions.
   */
  getUniforms() {
    return this.uniforms;
  }
  /**
   * Returns the WebGL extensions that are required by this effect.
   *
   * @deprecated Use extensions instead.
   * @return {Set<WebGLExtension>} The extensions.
   */
  getExtensions() {
    return this.extensions;
  }
  /**
   * Returns the blend mode.
   *
   * The result of this effect will be blended with the result of the previous effect using this blend mode.
   *
   * @deprecated Use blendMode instead.
   * @return {BlendMode} The blend mode.
   */
  getBlendMode() {
    return this.blendMode;
  }
  /**
   * Returns the effect attributes.
   *
   * @return {EffectAttribute} The attributes.
   */
  getAttributes() {
    return this.attributes;
  }
  /**
   * Sets the effect attributes.
   *
   * Effects that have the same attributes will be executed in the order in which they were registered. Some attributes
   * imply a higher priority.
   *
   * @protected
   * @param {EffectAttribute} attributes - The attributes.
   */
  setAttributes(attributes) {
    this.attributes = attributes;
    this.setChanged();
  }
  /**
   * Returns the fragment shader.
   *
   * @return {String} The fragment shader.
   */
  getFragmentShader() {
    return this.fragmentShader;
  }
  /**
   * Sets the fragment shader.
   *
   * @protected
   * @param {String} fragmentShader - The fragment shader.
   */
  setFragmentShader(fragmentShader) {
    this.fragmentShader = fragmentShader;
    this.setChanged();
  }
  /**
   * Returns the vertex shader.
   *
   * @return {String} The vertex shader.
   */
  getVertexShader() {
    return this.vertexShader;
  }
  /**
   * Sets the vertex shader.
   *
   * @protected
   * @param {String} vertexShader - The vertex shader.
   */
  setVertexShader(vertexShader) {
    this.vertexShader = vertexShader;
    this.setChanged();
  }
  /**
   * Informs the associated {@link EffectPass} that this effect requires a shader recompilation.
   *
   * Should be called after changing macros or extensions and after adding/removing uniforms.
   *
   * @protected
   */
  setChanged() {
    this.dispatchEvent({ type: "change" });
  }
  /**
   * Sets the depth texture.
   *
   * You may override this method if your effect requires direct access to the depth texture that is bound to the
   * associated {@link EffectPass}.
   *
   * @param {Texture} depthTexture - A depth texture.
   * @param {DepthPackingStrategies} [depthPacking=BasicDepthPacking] - The depth packing.
   */
  setDepthTexture(depthTexture, depthPacking = BasicDepthPacking) {
  }
  /**
   * Updates this effect by performing supporting operations.
   *
   * This method is called by the {@link EffectPass} right before the main fullscreen render operation, even if the
   * blend function is set to `SKIP`.
   *
   * You may override this method if you need to update custom uniforms or render additional off-screen textures.
   *
   * @param {WebGLRenderer} renderer - The renderer.
   * @param {WebGLRenderTarget} inputBuffer - A frame buffer that contains the result of the previous pass.
   * @param {Number} [deltaTime] - The time between the last frame and the current one in seconds.
   */
  update(renderer, inputBuffer, deltaTime) {
  }
  /**
   * Updates the size of this effect.
   *
   * You may override this method if you want to be informed about the size of the backbuffer/canvas.
   * This method is called before {@link initialize} and every time the size of the {@link EffectComposer} changes.
   *
   * @param {Number} width - The width.
   * @param {Number} height - The height.
   */
  setSize(width, height) {
  }
  /**
   * Performs initialization tasks.
   *
   * This method is called when the associated {@link EffectPass} is added to an {@link EffectComposer}.
   *
   * @param {WebGLRenderer} renderer - The renderer.
   * @param {Boolean} alpha - Whether the renderer uses the alpha channel or not.
   * @param {Number} frameBufferType - The type of the main frame buffers.
   * @example if(!alpha && frameBufferType === UnsignedByteType) { this.myRenderTarget.texture.format = RGBFormat; }
   */
  initialize(renderer, alpha, frameBufferType) {
  }
  /**
   * Performs a shallow search for properties that define a dispose method and deletes them.
   *
   * The {@link EffectComposer} calls this method when it is being destroyed.
   */
  dispose() {
    for (const key of Object.keys(this)) {
      const property = this[key];
      const isDisposable = property instanceof WebGLRenderTarget || property instanceof Material || property instanceof Texture || property instanceof Pass;
      if (isDisposable) {
        this[key].dispose();
      }
    }
  }
};
var kernelPresets = [
  new Float32Array([0, 0]),
  new Float32Array([0, 1, 1]),
  new Float32Array([0, 1, 1, 2]),
  new Float32Array([0, 1, 2, 2, 3]),
  new Float32Array([0, 1, 2, 3, 4, 4, 5]),
  new Float32Array([0, 1, 2, 3, 4, 5, 7, 8, 9, 10])
];
var RenderPass = class extends Pass {
  /**
   * Constructs a new render pass.
   *
   * @param {Scene} scene - The scene to render.
   * @param {Camera} camera - The camera to use to render the scene.
   * @param {Material} [overrideMaterial=null] - An override material.
   */
  constructor(scene, camera, overrideMaterial = null) {
    super("RenderPass", scene, camera);
    this.needsSwap = false;
    this.needsDepthBlit = true;
    this.clearPass = new ClearPass();
    this.overrideMaterialManager = overrideMaterial === null ? null : new OverrideMaterialManager(overrideMaterial);
    this.ignoreBackground = false;
    this.skipShadowMapUpdate = false;
    this.selection = null;
  }
  set mainScene(value) {
    this.scene = value;
  }
  set mainCamera(value) {
    this.camera = value;
  }
  get renderToScreen() {
    return super.renderToScreen;
  }
  set renderToScreen(value) {
    super.renderToScreen = value;
    this.clearPass.renderToScreen = value;
  }
  /**
   * The current override material.
   *
   * @type {Material}
   */
  get overrideMaterial() {
    const manager = this.overrideMaterialManager;
    return manager !== null ? manager.material : null;
  }
  set overrideMaterial(value) {
    const manager = this.overrideMaterialManager;
    if (value !== null) {
      if (manager !== null) {
        manager.setMaterial(value);
      } else {
        this.overrideMaterialManager = new OverrideMaterialManager(value);
      }
    } else if (manager !== null) {
      manager.dispose();
      this.overrideMaterialManager = null;
    }
  }
  /**
   * Returns the current override material.
   *
   * @deprecated Use overrideMaterial instead.
   * @return {Material} The material.
   */
  getOverrideMaterial() {
    return this.overrideMaterial;
  }
  /**
   * Sets the override material.
   *
   * @deprecated Use overrideMaterial instead.
   * @return {Material} value - The material.
   */
  setOverrideMaterial(value) {
    this.overrideMaterial = value;
  }
  /**
   * Indicates whether the target buffer should be cleared before rendering.
   *
   * @type {Boolean}
   * @deprecated Use clearPass.enabled instead.
   */
  get clear() {
    return this.clearPass.enabled;
  }
  set clear(value) {
    this.clearPass.enabled = value;
  }
  /**
   * Returns the selection. Default is `null` (no restriction).
   *
   * @deprecated Use selection instead.
   * @return {Selection} The selection.
   */
  getSelection() {
    return this.selection;
  }
  /**
   * Sets the selection. Set to `null` to disable.
   *
   * @deprecated Use selection instead.
   * @param {Selection} value - The selection.
   */
  setSelection(value) {
    this.selection = value;
  }
  /**
   * Indicates whether the scene background is disabled.
   *
   * @deprecated Use ignoreBackground instead.
   * @return {Boolean} Whether the scene background is disabled.
   */
  isBackgroundDisabled() {
    return this.ignoreBackground;
  }
  /**
   * Enables or disables the scene background.
   *
   * @deprecated Use ignoreBackground instead.
   * @param {Boolean} value - Whether the scene background should be disabled.
   */
  setBackgroundDisabled(value) {
    this.ignoreBackground = value;
  }
  /**
   * Indicates whether the shadow map auto update is disabled.
   *
   * @deprecated Use skipShadowMapUpdate instead.
   * @return {Boolean} Whether the shadow map update is disabled.
   */
  isShadowMapDisabled() {
    return this.skipShadowMapUpdate;
  }
  /**
   * Enables or disables the shadow map auto update.
   *
   * @deprecated Use skipShadowMapUpdate instead.
   * @param {Boolean} value - Whether the shadow map auto update should be disabled.
   */
  setShadowMapDisabled(value) {
    this.skipShadowMapUpdate = value;
  }
  /**
   * Returns the clear pass.
   *
   * @deprecated Use clearPass.enabled instead.
   * @return {ClearPass} The clear pass.
   */
  getClearPass() {
    return this.clearPass;
  }
  /**
   * Renders the scene.
   *
   * @param {WebGLRenderer} renderer - The renderer.
   * @param {WebGLRenderTarget} inputBuffer - A frame buffer that contains the result of the previous pass.
   * @param {WebGLRenderTarget} outputBuffer - A frame buffer that serves as the output render target unless this pass renders to screen.
   * @param {Number} [deltaTime] - The time between the last frame and the current one in seconds.
   * @param {Boolean} [stencilTest] - Indicates whether a stencil mask is active.
   */
  render(renderer, inputBuffer, outputBuffer, deltaTime, stencilTest) {
    const scene = this.scene;
    const camera = this.camera;
    const selection = this.selection;
    const mask = camera.layers.mask;
    const background = scene.background;
    const shadowMapAutoUpdate = renderer.shadowMap.autoUpdate;
    const renderTarget = this.renderToScreen ? null : inputBuffer;
    if (selection !== null) {
      camera.layers.set(selection.getLayer());
    }
    if (this.skipShadowMapUpdate) {
      renderer.shadowMap.autoUpdate = false;
    }
    if (this.ignoreBackground || this.clearPass.overrideClearColor !== null) {
      scene.background = null;
    }
    if (this.clearPass.enabled) {
      this.clearPass.render(renderer, inputBuffer);
    }
    renderer.setRenderTarget(renderTarget);
    if (this.overrideMaterialManager !== null) {
      this.overrideMaterialManager.render(renderer, scene, camera);
    } else {
      renderer.render(scene, camera);
    }
    camera.layers.mask = mask;
    scene.background = background;
    renderer.shadowMap.autoUpdate = shadowMapAutoUpdate;
  }
};
var HALF_PI = Math.PI * 0.5;
var depth_downsampling_default = `#include <packing>
#ifdef GL_FRAGMENT_PRECISION_HIGH
uniform highp sampler2D depthBuffer;
#else
uniform mediump sampler2D depthBuffer;
#endif
#ifdef DOWNSAMPLE_NORMALS
uniform lowp sampler2D normalBuffer;
#endif
varying vec2 vUv0;varying vec2 vUv1;varying vec2 vUv2;varying vec2 vUv3;float readDepth(const in vec2 uv){
#if DEPTH_PACKING == 3201
return unpackRGBAToDepth(texture2D(depthBuffer,uv));
#else
return texture2D(depthBuffer,uv).r;
#endif
}int findBestDepth(const in float samples[4]){float c=(samples[0]+samples[1]+samples[2]+samples[3])*0.25;float distances[4];distances[0]=abs(c-samples[0]);distances[1]=abs(c-samples[1]);distances[2]=abs(c-samples[2]);distances[3]=abs(c-samples[3]);float maxDistance=max(max(distances[0],distances[1]),max(distances[2],distances[3]));int remaining[3];int rejected[3];int i,j,k;for(i=0,j=0,k=0;i<4;++i){if(distances[i]<maxDistance){remaining[j++]=i;}else{rejected[k++]=i;}}for(;j<3;++j){remaining[j]=rejected[--k];}vec3 s=vec3(samples[remaining[0]],samples[remaining[1]],samples[remaining[2]]);c=(s.x+s.y+s.z)/3.0;distances[0]=abs(c-s.x);distances[1]=abs(c-s.y);distances[2]=abs(c-s.z);float minDistance=min(distances[0],min(distances[1],distances[2]));for(i=0;i<3;++i){if(distances[i]==minDistance){break;}}return remaining[i];}void main(){float d[4];d[0]=readDepth(vUv0);d[1]=readDepth(vUv1);d[2]=readDepth(vUv2);d[3]=readDepth(vUv3);int index=findBestDepth(d);
#ifdef DOWNSAMPLE_NORMALS
vec3 n[4];n[0]=texture2D(normalBuffer,vUv0).rgb;n[1]=texture2D(normalBuffer,vUv1).rgb;n[2]=texture2D(normalBuffer,vUv2).rgb;n[3]=texture2D(normalBuffer,vUv3).rgb;
#else
vec3 n[4];n[0]=vec3(0.0);n[1]=vec3(0.0);n[2]=vec3(0.0);n[3]=vec3(0.0);
#endif
gl_FragColor=vec4(n[index],d[index]);}`;
var depth_downsampling_default2 = `uniform vec2 texelSize;varying vec2 vUv0;varying vec2 vUv1;varying vec2 vUv2;varying vec2 vUv3;void main(){vec2 uv=position.xy*0.5+0.5;vUv0=uv;vUv1=vec2(uv.x,uv.y+texelSize.y);vUv2=vec2(uv.x+texelSize.x,uv.y);vUv3=uv+texelSize;gl_Position=vec4(position.xy,1.0,1.0);}`;
var DepthDownsamplingMaterial = class extends ShaderMaterial {
  /**
   * Constructs a new depth downsampling material.
   */
  constructor() {
    super({
      name: "DepthDownsamplingMaterial",
      defines: {
        DEPTH_PACKING: "0"
      },
      uniforms: {
        depthBuffer: new Uniform(null),
        normalBuffer: new Uniform(null),
        texelSize: new Uniform(new Vector2())
      },
      blending: NoBlending,
      toneMapped: false,
      depthWrite: false,
      depthTest: false,
      fragmentShader: depth_downsampling_default,
      vertexShader: depth_downsampling_default2
    });
  }
  /**
   * The depth buffer.
   *
   * @type {Texture}
   */
  set depthBuffer(value) {
    this.uniforms.depthBuffer.value = value;
  }
  /**
   * The depth packing strategy.
   *
   * @type {DepthPackingStrategies}
   */
  set depthPacking(value) {
    this.defines.DEPTH_PACKING = value.toFixed(0);
    this.needsUpdate = true;
  }
  /**
   * Sets the depth buffer.
   *
   * @deprecated Use depthBuffer and depthPacking instead.
   * @param {Texture} buffer - The depth texture.
   * @param {DepthPackingStrategies} [depthPacking=BasicDepthPacking] - The depth packing strategy.
   */
  setDepthBuffer(buffer2, depthPacking = BasicDepthPacking) {
    this.depthBuffer = buffer2;
    this.depthPacking = depthPacking;
  }
  /**
   * The normal buffer.
   *
   * @type {Texture}
   */
  set normalBuffer(value) {
    this.uniforms.normalBuffer.value = value;
    if (value !== null) {
      this.defines.DOWNSAMPLE_NORMALS = "1";
    } else {
      delete this.defines.DOWNSAMPLE_NORMALS;
    }
    this.needsUpdate = true;
  }
  /**
   * Sets the normal buffer.
   *
   * @deprecated Use normalBuffer instead.
   * @param {Texture} value - The normal buffer.
   */
  setNormalBuffer(value) {
    this.normalBuffer = value;
  }
  /**
   * Sets the texel size.
   *
   * @deprecated Use setSize() instead.
   * @param {Number} x - The texel width.
   * @param {Number} y - The texel height.
   */
  setTexelSize(x2, y) {
    this.uniforms.texelSize.value.set(x2, y);
  }
  /**
   * Sets the size of this object.
   *
   * @param {Number} width - The width.
   * @param {Number} height - The height.
   */
  setSize(width, height) {
    this.uniforms.texelSize.value.set(1 / width, 1 / height);
  }
};
var DepthDownsamplingPass = class extends Pass {
  /**
   * Constructs a new depth downsampling pass.
   *
   * @param {Object} [options] - The options.
   * @param {Texture} [options.normalBuffer=null] - A texture that contains view space normals. See {@link NormalPass}.
   * @param {Number} [options.resolutionScale=0.5] - The resolution scale.
   * @param {Number} [options.resolutionX=Resolution.AUTO_SIZE] - The horizontal resolution.
   * @param {Number} [options.resolutionY=Resolution.AUTO_SIZE] - The vertical resolution.
   * @param {Number} [options.width=Resolution.AUTO_SIZE] - Deprecated. Use resolutionX instead.
   * @param {Number} [options.height=Resolution.AUTO_SIZE] - Deprecated. Use resolutionY instead.
   */
  constructor({
    normalBuffer = null,
    resolutionScale = 0.5,
    width = Resolution.AUTO_SIZE,
    height = Resolution.AUTO_SIZE,
    resolutionX = width,
    resolutionY = height
  } = {}) {
    super("DepthDownsamplingPass");
    const material = new DepthDownsamplingMaterial();
    material.normalBuffer = normalBuffer;
    this.fullscreenMaterial = material;
    this.needsDepthTexture = true;
    this.needsSwap = false;
    this.renderTarget = new WebGLRenderTarget(1, 1, {
      minFilter: NearestFilter,
      magFilter: NearestFilter,
      depthBuffer: false,
      type: FloatType
    });
    this.renderTarget.texture.name = "DepthDownsamplingPass.Target";
    this.renderTarget.texture.generateMipmaps = false;
    const resolution = this.resolution = new Resolution(this, resolutionX, resolutionY, resolutionScale);
    resolution.addEventListener("change", (e2) => this.setSize(resolution.baseWidth, resolution.baseHeight));
  }
  /**
   * The normal(RGB) + depth(A) texture.
   *
   * @type {Texture}
   */
  get texture() {
    return this.renderTarget.texture;
  }
  /**
   * Returns the normal(RGB) + depth(A) texture.
   *
   * @deprecated Use texture instead.
   * @return {Texture} The texture.
   */
  getTexture() {
    return this.renderTarget.texture;
  }
  /**
   * Returns the resolution settings.
   *
   * @deprecated Use resolution instead.
   * @return {Resolution} The resolution.
   */
  getResolution() {
    return this.resolution;
  }
  /**
   * Sets the depth texture.
   *
   * @param {Texture} depthTexture - A depth texture.
   * @param {DepthPackingStrategies} [depthPacking=BasicDepthPacking] - The depth packing strategy.
   */
  setDepthTexture(depthTexture, depthPacking = BasicDepthPacking) {
    this.fullscreenMaterial.depthBuffer = depthTexture;
    this.fullscreenMaterial.depthPacking = depthPacking;
  }
  /**
   * Downsamples depth and scene normals.
   *
   * @param {WebGLRenderer} renderer - The renderer.
   * @param {WebGLRenderTarget} inputBuffer - A frame buffer that contains the result of the previous pass.
   * @param {WebGLRenderTarget} outputBuffer - A frame buffer that serves as the output render target unless this pass renders to screen.
   * @param {Number} [deltaTime] - The time between the last frame and the current one in seconds.
   * @param {Boolean} [stencilTest] - Indicates whether a stencil mask is active.
   */
  render(renderer, inputBuffer, outputBuffer, deltaTime, stencilTest) {
    renderer.setRenderTarget(this.renderToScreen ? null : this.renderTarget);
    renderer.render(this.scene, this.camera);
  }
  /**
   * Updates the size of this pass.
   *
   * @param {Number} width - The width.
   * @param {Number} height - The height.
   */
  setSize(width, height) {
    const resolution = this.resolution;
    resolution.setBaseSize(width, height);
    this.renderTarget.setSize(resolution.width, resolution.height);
    this.fullscreenMaterial.setSize(width, height);
  }
  /**
   * Performs initialization tasks.
   *
   * @param {WebGLRenderer} renderer - The renderer.
   * @param {Boolean} alpha - Whether the renderer uses the alpha channel or not.
   * @param {Number} frameBufferType - The type of the main frame buffers.
   */
  initialize(renderer, alpha, frameBufferType) {
    const gl = renderer.getContext();
    const renderable = gl.getExtension("EXT_color_buffer_float") || gl.getExtension("EXT_color_buffer_half_float");
    if (!renderable) {
      throw new Error("Rendering to float texture is not supported.");
    }
  }
};
var effect_default = `#include <common>
#include <packing>
#include <dithering_pars_fragment>
#define packFloatToRGBA(v) packDepthToRGBA(v)
#define unpackRGBAToFloat(v) unpackRGBAToDepth(v)
#ifdef FRAMEBUFFER_PRECISION_HIGH
uniform mediump sampler2D inputBuffer;
#else
uniform lowp sampler2D inputBuffer;
#endif
#if DEPTH_PACKING == 3201
uniform lowp sampler2D depthBuffer;
#elif defined(GL_FRAGMENT_PRECISION_HIGH)
uniform highp sampler2D depthBuffer;
#else
uniform mediump sampler2D depthBuffer;
#endif
uniform vec2 resolution;uniform vec2 texelSize;uniform float cameraNear;uniform float cameraFar;uniform float aspect;uniform float time;varying vec2 vUv;vec4 sRGBToLinear(const in vec4 value){return vec4(mix(pow(value.rgb*0.9478672986+vec3(0.0521327014),vec3(2.4)),value.rgb*0.0773993808,vec3(lessThanEqual(value.rgb,vec3(0.04045)))),value.a);}float readDepth(const in vec2 uv){
#if DEPTH_PACKING == 3201
float depth=unpackRGBAToDepth(texture2D(depthBuffer,uv));
#else
float depth=texture2D(depthBuffer,uv).r;
#endif
#if defined(USE_LOGARITHMIC_DEPTH_BUFFER) || defined(LOG_DEPTH)
float d=pow(2.0,depth*log2(cameraFar+1.0))-1.0;float a=cameraFar/(cameraFar-cameraNear);float b=cameraFar*cameraNear/(cameraNear-cameraFar);depth=a+b/d;
#elif defined(USE_REVERSED_DEPTH_BUFFER)
depth=1.0-depth;
#endif
return depth;}float getViewZ(const in float depth){
#ifdef PERSPECTIVE_CAMERA
return perspectiveDepthToViewZ(depth,cameraNear,cameraFar);
#else
return orthographicDepthToViewZ(depth,cameraNear,cameraFar);
#endif
}vec3 RGBToHCV(const in vec3 RGB){vec4 P=mix(vec4(RGB.bg,-1.0,2.0/3.0),vec4(RGB.gb,0.0,-1.0/3.0),step(RGB.b,RGB.g));vec4 Q=mix(vec4(P.xyw,RGB.r),vec4(RGB.r,P.yzx),step(P.x,RGB.r));float C=Q.x-min(Q.w,Q.y);float H=abs((Q.w-Q.y)/(6.0*C+EPSILON)+Q.z);return vec3(H,C,Q.x);}vec3 RGBToHSL(const in vec3 RGB){vec3 HCV=RGBToHCV(RGB);float L=HCV.z-HCV.y*0.5;float S=HCV.y/(1.0-abs(L*2.0-1.0)+EPSILON);return vec3(HCV.x,S,L);}vec3 HueToRGB(const in float H){float R=abs(H*6.0-3.0)-1.0;float G=2.0-abs(H*6.0-2.0);float B=2.0-abs(H*6.0-4.0);return clamp(vec3(R,G,B),0.0,1.0);}vec3 HSLToRGB(const in vec3 HSL){vec3 RGB=HueToRGB(HSL.x);float C=(1.0-abs(2.0*HSL.z-1.0))*HSL.y;return(RGB-0.5)*C+HSL.z;}FRAGMENT_HEAD void main(){FRAGMENT_MAIN_UV vec4 color0=texture2D(inputBuffer,UV);vec4 color1=vec4(0.0);FRAGMENT_MAIN_IMAGE color0.a=clamp(color0.a,0.0,1.0);gl_FragColor=color0;
#ifdef ENCODE_OUTPUT
#include <colorspace_fragment>
#endif
#include <dithering_fragment>
}`;
var effect_default2 = `uniform vec2 resolution;uniform vec2 texelSize;uniform float cameraNear;uniform float cameraFar;uniform float aspect;uniform float time;varying vec2 vUv;VERTEX_HEAD void main(){vUv=position.xy*0.5+0.5;VERTEX_MAIN_SUPPORT gl_Position=vec4(position.xy,1.0,1.0);}`;
var EffectMaterial = class extends ShaderMaterial {
  /**
   * Constructs a new effect material.
   *
   * @param {Map<String, String>} [shaderParts] - Deprecated. Use setShaderData instead.
   * @param {Map<String, String>} [defines] - Deprecated. Use setShaderData instead.
   * @param {Map<String, Uniform>} [uniforms] - Deprecated. Use setShaderData instead.
   * @param {Camera} [camera] - A camera.
   * @param {Boolean} [dithering=false] - Deprecated.
   */
  constructor(shaderParts, defines, uniforms, camera, dithering = false) {
    super({
      name: "EffectMaterial",
      defines: {
        THREE_REVISION: REVISION.replace(/\D+/g, ""),
        DEPTH_PACKING: "0",
        ENCODE_OUTPUT: "1"
      },
      uniforms: {
        inputBuffer: new Uniform(null),
        depthBuffer: new Uniform(null),
        resolution: new Uniform(new Vector2()),
        texelSize: new Uniform(new Vector2()),
        cameraNear: new Uniform(0.3),
        cameraFar: new Uniform(1e3),
        aspect: new Uniform(1),
        time: new Uniform(0)
      },
      blending: NoBlending,
      toneMapped: false,
      depthWrite: false,
      depthTest: false,
      dithering
    });
    if (shaderParts) {
      this.setShaderParts(shaderParts);
    }
    if (defines) {
      this.setDefines(defines);
    }
    if (uniforms) {
      this.setUniforms(uniforms);
    }
    this.copyCameraSettings(camera);
  }
  /**
   * The input buffer.
   *
   * @type {Texture}
   */
  set inputBuffer(value) {
    this.uniforms.inputBuffer.value = value;
  }
  /**
   * Sets the input buffer.
   *
   * @deprecated Use inputBuffer instead.
   * @param {Texture} value - The input buffer.
   */
  setInputBuffer(value) {
    this.uniforms.inputBuffer.value = value;
  }
  /**
   * The depth buffer.
   *
   * @type {Texture}
   */
  get depthBuffer() {
    return this.uniforms.depthBuffer.value;
  }
  set depthBuffer(value) {
    this.uniforms.depthBuffer.value = value;
  }
  /**
   * The depth packing strategy.
   *
   * @type {DepthPackingStrategies}
   */
  get depthPacking() {
    return Number(this.defines.DEPTH_PACKING);
  }
  set depthPacking(value) {
    this.defines.DEPTH_PACKING = value.toFixed(0);
    this.needsUpdate = true;
  }
  /**
   * Sets the depth buffer.
   *
   * @deprecated Use depthBuffer and depthPacking instead.
   * @param {Texture} buffer - The depth texture.
   * @param {DepthPackingStrategies} [depthPacking=BasicDepthPacking] - The depth packing strategy.
   */
  setDepthBuffer(buffer2, depthPacking = BasicDepthPacking) {
    this.depthBuffer = buffer2;
    this.depthPacking = depthPacking;
  }
  /**
   * Sets the shader data.
   *
   * @param {EffectShaderData} data - The shader data.
   * @return {EffectMaterial} This material.
   */
  setShaderData(data) {
    this.setShaderParts(data.shaderParts);
    this.setDefines(data.defines);
    this.setUniforms(data.uniforms);
    this.setExtensions(data.extensions);
  }
  /**
   * Sets the shader parts.
   *
   * @deprecated Use setShaderData instead.
   * @param {Map<String, String>} shaderParts - A collection of shader snippets. See {@link EffectShaderSection}.
   * @return {EffectMaterial} This material.
   */
  setShaderParts(shaderParts) {
    this.fragmentShader = effect_default.replace(EffectShaderSection.FRAGMENT_HEAD, shaderParts.get(EffectShaderSection.FRAGMENT_HEAD) || "").replace(EffectShaderSection.FRAGMENT_MAIN_UV, shaderParts.get(EffectShaderSection.FRAGMENT_MAIN_UV) || "").replace(EffectShaderSection.FRAGMENT_MAIN_IMAGE, shaderParts.get(EffectShaderSection.FRAGMENT_MAIN_IMAGE) || "");
    this.vertexShader = effect_default2.replace(EffectShaderSection.VERTEX_HEAD, shaderParts.get(EffectShaderSection.VERTEX_HEAD) || "").replace(EffectShaderSection.VERTEX_MAIN_SUPPORT, shaderParts.get(EffectShaderSection.VERTEX_MAIN_SUPPORT) || "");
    this.needsUpdate = true;
    return this;
  }
  /**
   * Sets the shader macros.
   *
   * @deprecated Use setShaderData instead.
   * @param {Map<String, String>} defines - A collection of preprocessor macro definitions.
   * @return {EffectMaterial} This material.
   */
  setDefines(defines) {
    for (const entry of defines.entries()) {
      this.defines[entry[0]] = entry[1];
    }
    this.needsUpdate = true;
    return this;
  }
  /**
   * Sets the shader uniforms.
   *
   * @deprecated Use setShaderData instead.
   * @param {Map<String, Uniform>} uniforms - A collection of uniforms.
   * @return {EffectMaterial} This material.
   */
  setUniforms(uniforms) {
    for (const entry of uniforms.entries()) {
      this.uniforms[entry[0]] = entry[1];
    }
    return this;
  }
  /**
   * Sets the required shader extensions.
   *
   * @deprecated Use setShaderData instead.
   * @param {Set<WebGLExtension>} extensions - A collection of extensions.
   * @return {EffectMaterial} This material.
   */
  setExtensions(extensions) {
    this.extensions = {};
    for (const extension of extensions) {
      this.extensions[extension] = true;
    }
    return this;
  }
  /**
   * Indicates whether output encoding is enabled.
   *
   * @type {Boolean}
   */
  get encodeOutput() {
    return this.defines.ENCODE_OUTPUT !== void 0;
  }
  set encodeOutput(value) {
    if (this.encodeOutput !== value) {
      if (value) {
        this.defines.ENCODE_OUTPUT = "1";
      } else {
        delete this.defines.ENCODE_OUTPUT;
      }
      this.needsUpdate = true;
    }
  }
  /**
   * Indicates whether output encoding is enabled.
   *
   * @deprecated Use encodeOutput instead.
   * @return {Boolean} Whether output encoding is enabled.
   */
  isOutputEncodingEnabled(value) {
    return this.encodeOutput;
  }
  /**
   * Enables or disables output encoding.
   *
   * @deprecated Use encodeOutput instead.
   * @param {Boolean} value - Whether output encoding should be enabled.
   */
  setOutputEncodingEnabled(value) {
    this.encodeOutput = value;
  }
  /**
   * The time in seconds.
   *
   * @type {Number}
   */
  get time() {
    return this.uniforms.time.value;
  }
  set time(value) {
    this.uniforms.time.value = value;
  }
  /**
   * Sets the delta time.
   *
   * @deprecated Use time instead.
   * @param {Number} value - The delta time in seconds.
   */
  setDeltaTime(value) {
    this.uniforms.time.value += value;
  }
  /**
   * Copies the settings of the given camera.
   *
   * @deprecated Use copyCameraSettings instead.
   * @param {Camera} camera - A camera.
   */
  adoptCameraSettings(camera) {
    this.copyCameraSettings(camera);
  }
  /**
   * Copies the settings of the given camera.
   *
   * @param {Camera} camera - A camera.
   */
  copyCameraSettings(camera) {
    if (camera) {
      this.uniforms.cameraNear.value = camera.near;
      this.uniforms.cameraFar.value = camera.far;
      if (camera instanceof PerspectiveCamera) {
        this.defines.PERSPECTIVE_CAMERA = "1";
      } else {
        delete this.defines.PERSPECTIVE_CAMERA;
      }
      this.needsUpdate = true;
    }
  }
  /**
   * Sets the resolution.
   *
   * @param {Number} width - The width.
   * @param {Number} height - The height.
   */
  setSize(width, height) {
    const uniforms = this.uniforms;
    uniforms.resolution.value.set(width, height);
    uniforms.texelSize.value.set(1 / width, 1 / height);
    uniforms.aspect.value = width / height;
  }
  /**
   * An enumeration of shader code placeholders.
   *
   * @deprecated Use EffectShaderSection instead.
   * @type {Object}
   */
  static get Section() {
    return EffectShaderSection;
  }
};
var threeRevision = Number(REVISION.replace(/\D+/g, ""));
var unpackDownscale = 255 / 256;
var unpackFactorsLegacy = new Float32Array([
  unpackDownscale / 256 ** 3,
  unpackDownscale / 256 ** 2,
  unpackDownscale / 256,
  unpackDownscale
]);
var unpackFactors = new Float32Array([
  unpackDownscale,
  unpackDownscale / 256,
  unpackDownscale / 256 ** 2,
  1 / 256 ** 3
]);
function prefixSubstrings(prefix, substrings, strings) {
  for (const substring of substrings) {
    const prefixed = "$1" + prefix + substring.charAt(0).toUpperCase() + substring.slice(1);
    const regExp = new RegExp("([^\\.])(\\b" + substring + "\\b)", "g");
    for (const entry of strings.entries()) {
      if (entry[1] !== null) {
        strings.set(entry[0], entry[1].replace(regExp, prefixed));
      }
    }
  }
}
function integrateEffect(prefix, effect, data) {
  let fragmentShader = effect.getFragmentShader();
  let vertexShader = effect.getVertexShader();
  const mainImageExists = fragmentShader !== void 0 && /mainImage/.test(fragmentShader);
  const mainUvExists = fragmentShader !== void 0 && /mainUv/.test(fragmentShader);
  data.attributes |= effect.getAttributes();
  if (fragmentShader === void 0) {
    throw new Error(`Missing fragment shader (${effect.name})`);
  } else if (mainUvExists && (data.attributes & EffectAttribute.CONVOLUTION) !== 0) {
    throw new Error(`Effects that transform UVs are incompatible with convolution effects (${effect.name})`);
  } else if (!mainImageExists && !mainUvExists) {
    throw new Error(`Could not find mainImage or mainUv function (${effect.name})`);
  } else {
    const functionRegExp = /\w+\s+(\w+)\([\w\s,]*\)\s*{/g;
    const shaderParts = data.shaderParts;
    let fragmentHead = shaderParts.get(EffectShaderSection.FRAGMENT_HEAD) || "";
    let fragmentMainUv = shaderParts.get(EffectShaderSection.FRAGMENT_MAIN_UV) || "";
    let fragmentMainImage = shaderParts.get(EffectShaderSection.FRAGMENT_MAIN_IMAGE) || "";
    let vertexHead = shaderParts.get(EffectShaderSection.VERTEX_HEAD) || "";
    let vertexMainSupport = shaderParts.get(EffectShaderSection.VERTEX_MAIN_SUPPORT) || "";
    const varyings = /* @__PURE__ */ new Set();
    const names = /* @__PURE__ */ new Set();
    if (mainUvExists) {
      fragmentMainUv += `	${prefix}MainUv(UV);
`;
      data.uvTransformation = true;
    }
    if (vertexShader !== null && /mainSupport/.test(vertexShader)) {
      const needsUv = /mainSupport *\([\w\s]*?uv\s*?\)/.test(vertexShader);
      vertexMainSupport += `	${prefix}MainSupport(`;
      vertexMainSupport += needsUv ? "vUv);\n" : ");\n";
      for (const m2 of vertexShader.matchAll(/(?:varying\s+\w+\s+([\S\s]*?);)/g)) {
        for (const n of m2[1].split(/\s*,\s*/)) {
          data.varyings.add(n);
          varyings.add(n);
          names.add(n);
        }
      }
      for (const m2 of vertexShader.matchAll(functionRegExp)) {
        names.add(m2[1]);
      }
    }
    for (const m2 of fragmentShader.matchAll(functionRegExp)) {
      names.add(m2[1]);
    }
    for (const d of effect.defines.keys()) {
      names.add(d.replace(/\([\w\s,]*\)/g, ""));
    }
    for (const u2 of effect.uniforms.keys()) {
      names.add(u2);
    }
    names.delete("while");
    names.delete("for");
    names.delete("if");
    effect.uniforms.forEach((val, key) => data.uniforms.set(prefix + key.charAt(0).toUpperCase() + key.slice(1), val));
    effect.defines.forEach((val, key) => data.defines.set(prefix + key.charAt(0).toUpperCase() + key.slice(1), val));
    const shaders = /* @__PURE__ */ new Map([["fragment", fragmentShader], ["vertex", vertexShader]]);
    prefixSubstrings(prefix, names, data.defines);
    prefixSubstrings(prefix, names, shaders);
    fragmentShader = shaders.get("fragment");
    vertexShader = shaders.get("vertex");
    const blendMode = effect.blendMode;
    data.blendModes.set(blendMode.blendFunction, blendMode);
    if (mainImageExists) {
      if (effect.inputColorSpace !== null && effect.inputColorSpace !== data.colorSpace) {
        fragmentMainImage += effect.inputColorSpace === SRGBColorSpace ? "color0 = sRGBTransferOETF(color0);\n	" : "color0 = sRGBToLinear(color0);\n	";
      }
      if (effect.outputColorSpace !== NoColorSpace) {
        data.colorSpace = effect.outputColorSpace;
      } else if (effect.inputColorSpace !== null) {
        data.colorSpace = effect.inputColorSpace;
      }
      const depthParamRegExp = /MainImage *\([\w\s,]*?depth[\w\s,]*?\)/;
      fragmentMainImage += `${prefix}MainImage(color0, UV, `;
      if ((data.attributes & EffectAttribute.DEPTH) !== 0 && depthParamRegExp.test(fragmentShader)) {
        fragmentMainImage += "depth, ";
        data.readDepth = true;
      }
      fragmentMainImage += "color1);\n	";
      const blendOpacity = prefix + "BlendOpacity";
      data.uniforms.set(blendOpacity, blendMode.opacity);
      fragmentMainImage += `color0 = blend${blendMode.blendFunction}(color0, color1, ${blendOpacity});

	`;
      fragmentHead += `uniform float ${blendOpacity};

`;
    }
    fragmentHead += fragmentShader + "\n";
    if (vertexShader !== null) {
      vertexHead += vertexShader + "\n";
    }
    shaderParts.set(EffectShaderSection.FRAGMENT_HEAD, fragmentHead);
    shaderParts.set(EffectShaderSection.FRAGMENT_MAIN_UV, fragmentMainUv);
    shaderParts.set(EffectShaderSection.FRAGMENT_MAIN_IMAGE, fragmentMainImage);
    shaderParts.set(EffectShaderSection.VERTEX_HEAD, vertexHead);
    shaderParts.set(EffectShaderSection.VERTEX_MAIN_SUPPORT, vertexMainSupport);
    if (effect.extensions !== null) {
      for (const extension of effect.extensions) {
        data.extensions.add(extension);
      }
    }
  }
}
var EffectPass = class extends Pass {
  /**
   * Constructs a new effect pass.
   *
   * @param {Camera} camera - The main camera.
   * @param {...Effect} effects - The effects that will be rendered by this pass.
   */
  constructor(camera, ...effects) {
    super("EffectPass");
    this.fullscreenMaterial = new EffectMaterial(null, null, null, camera);
    this.listener = (event) => this.handleEvent(event);
    this.effects = [];
    this.setEffects(effects);
    this.skipRendering = false;
    this.minTime = 1;
    this.maxTime = Number.POSITIVE_INFINITY;
    this.timeScale = 1;
  }
  set mainScene(value) {
    for (const effect of this.effects) {
      effect.mainScene = value;
    }
  }
  set mainCamera(value) {
    this.fullscreenMaterial.copyCameraSettings(value);
    for (const effect of this.effects) {
      effect.mainCamera = value;
    }
  }
  /**
   * Indicates whether this pass encodes its output when rendering to screen.
   *
   * @type {Boolean}
   * @deprecated Use fullscreenMaterial.encodeOutput instead.
   */
  get encodeOutput() {
    return this.fullscreenMaterial.encodeOutput;
  }
  set encodeOutput(value) {
    this.fullscreenMaterial.encodeOutput = value;
  }
  /**
   * Indicates whether dithering is enabled.
   *
   * @type {Boolean}
   */
  get dithering() {
    return this.fullscreenMaterial.dithering;
  }
  set dithering(value) {
    const material = this.fullscreenMaterial;
    material.dithering = value;
    material.needsUpdate = true;
  }
  /**
   * Sets the effects.
   *
   * @param {Effect[]} effects - The effects.
   * @protected
   */
  setEffects(effects) {
    for (const effect of this.effects) {
      effect.removeEventListener("change", this.listener);
    }
    this.effects = effects.sort((a, b2) => b2.attributes - a.attributes);
    for (const effect of this.effects) {
      effect.addEventListener("change", this.listener);
    }
  }
  /**
   * Updates the compound shader material.
   *
   * @protected
   */
  updateMaterial() {
    const data = new EffectShaderData();
    let id = 0;
    for (const effect of this.effects) {
      if (effect.blendMode.blendFunction === BlendFunction.DST) {
        data.attributes |= effect.getAttributes() & EffectAttribute.DEPTH;
      } else if ((data.attributes & effect.getAttributes() & EffectAttribute.CONVOLUTION) !== 0) {
        throw new Error(`Convolution effects cannot be merged (${effect.name})`);
      } else {
        integrateEffect("e" + id++, effect, data);
      }
    }
    let fragmentHead = data.shaderParts.get(EffectShaderSection.FRAGMENT_HEAD);
    let fragmentMainImage = data.shaderParts.get(EffectShaderSection.FRAGMENT_MAIN_IMAGE);
    let fragmentMainUv = data.shaderParts.get(EffectShaderSection.FRAGMENT_MAIN_UV);
    const blendRegExp = /\bblend\b/g;
    for (const blendMode of data.blendModes.values()) {
      fragmentHead += blendMode.getShaderCode().replace(blendRegExp, `blend${blendMode.blendFunction}`) + "\n";
    }
    if ((data.attributes & EffectAttribute.DEPTH) !== 0) {
      if (data.readDepth) {
        fragmentMainImage = "float depth = readDepth(UV);\n\n	" + fragmentMainImage;
      }
      this.needsDepthTexture = this.getDepthTexture() === null;
    } else {
      this.needsDepthTexture = false;
    }
    if (data.colorSpace === SRGBColorSpace) {
      fragmentMainImage += "color0 = sRGBToLinear(color0);\n	";
    }
    if (data.uvTransformation) {
      fragmentMainUv = "vec2 transformedUv = vUv;\n" + fragmentMainUv;
      data.defines.set("UV", "transformedUv");
    } else {
      data.defines.set("UV", "vUv");
    }
    data.shaderParts.set(EffectShaderSection.FRAGMENT_HEAD, fragmentHead);
    data.shaderParts.set(EffectShaderSection.FRAGMENT_MAIN_IMAGE, fragmentMainImage);
    data.shaderParts.set(EffectShaderSection.FRAGMENT_MAIN_UV, fragmentMainUv);
    for (const [key, value] of data.shaderParts) {
      if (value !== null) {
        data.shaderParts.set(key, value.trim().replace(/^#/, "\n#"));
      }
    }
    this.skipRendering = id === 0;
    this.needsSwap = !this.skipRendering;
    this.fullscreenMaterial.setShaderData(data);
  }
  /**
   * Rebuilds the shader material.
   */
  recompile() {
    this.updateMaterial();
  }
  /**
   * Returns the current depth texture.
   *
   * @return {Texture} The current depth texture, or null if there is none.
   */
  getDepthTexture() {
    return this.fullscreenMaterial.depthBuffer;
  }
  /**
   * Sets the depth texture.
   *
   * @param {Texture} depthTexture - A depth texture.
   * @param {DepthPackingStrategies} [depthPacking=BasicDepthPacking] - The depth packing.
   */
  setDepthTexture(depthTexture, depthPacking = BasicDepthPacking) {
    this.fullscreenMaterial.depthBuffer = depthTexture;
    this.fullscreenMaterial.depthPacking = depthPacking;
    for (const effect of this.effects) {
      effect.setDepthTexture(depthTexture, depthPacking);
    }
  }
  /**
   * Renders the effect.
   *
   * @param {WebGLRenderer} renderer - The renderer.
   * @param {WebGLRenderTarget} inputBuffer - A frame buffer that contains the result of the previous pass.
   * @param {WebGLRenderTarget} outputBuffer - A frame buffer that serves as the output render target unless this pass renders to screen.
   * @param {Number} [deltaTime] - The time between the last frame and the current one in seconds.
   * @param {Boolean} [stencilTest] - Indicates whether a stencil mask is active.
   */
  render(renderer, inputBuffer, outputBuffer, deltaTime, stencilTest) {
    for (const effect of this.effects) {
      effect.update(renderer, inputBuffer, deltaTime);
    }
    if (!this.skipRendering || this.renderToScreen) {
      const material = this.fullscreenMaterial;
      material.inputBuffer = inputBuffer.texture;
      material.time += deltaTime * this.timeScale;
      renderer.setRenderTarget(this.renderToScreen ? null : outputBuffer);
      renderer.render(this.scene, this.camera);
    }
  }
  /**
   * Updates the size of this pass.
   *
   * @param {Number} width - The width.
   * @param {Number} height - The height.
   */
  setSize(width, height) {
    this.fullscreenMaterial.setSize(width, height);
    for (const effect of this.effects) {
      effect.setSize(width, height);
    }
  }
  /**
   * Performs initialization tasks.
   *
   * @param {WebGLRenderer} renderer - The renderer.
   * @param {Boolean} alpha - Whether the renderer uses the alpha channel or not.
   * @param {Number} frameBufferType - The type of the main frame buffers.
   */
  initialize(renderer, alpha, frameBufferType) {
    this.renderer = renderer;
    for (const effect of this.effects) {
      effect.initialize(renderer, alpha, frameBufferType);
    }
    this.updateMaterial();
    if (frameBufferType !== void 0 && frameBufferType !== UnsignedByteType) {
      this.fullscreenMaterial.defines.FRAMEBUFFER_PRECISION_HIGH = "1";
    }
  }
  /**
   * Deletes disposable objects.
   */
  dispose() {
    super.dispose();
    for (const effect of this.effects) {
      effect.removeEventListener("change", this.listener);
      effect.dispose();
    }
  }
  /**
   * Handles events.
   *
   * @param {Event} event - An event.
   */
  handleEvent(event) {
    switch (event.type) {
      case "change":
        this.recompile();
        break;
    }
  }
};
var NormalPass = class extends Pass {
  /**
   * Constructs a new normal pass.
   *
   * @param {Scene} scene - The scene to render.
   * @param {Camera} camera - The camera to use to render the scene.
   * @param {Object} [options] - The options.
   * @param {WebGLRenderTarget} [options.renderTarget] - A custom render target.
   * @param {Number} [options.resolutionScale=1.0] - The resolution scale.
   * @param {Number} [options.resolutionX=Resolution.AUTO_SIZE] - The horizontal resolution.
   * @param {Number} [options.resolutionY=Resolution.AUTO_SIZE] - The vertical resolution.
   * @param {Number} [options.width=Resolution.AUTO_SIZE] - Deprecated. Use resolutionX instead.
   * @param {Number} [options.height=Resolution.AUTO_SIZE] - Deprecated. Use resolutionY instead.
   */
  constructor(scene, camera, {
    renderTarget,
    resolutionScale = 1,
    width = Resolution.AUTO_SIZE,
    height = Resolution.AUTO_SIZE,
    resolutionX = width,
    resolutionY = height
  } = {}) {
    super("NormalPass");
    this.needsSwap = false;
    this.renderPass = new RenderPass(scene, camera, new MeshNormalMaterial());
    const renderPass = this.renderPass;
    renderPass.ignoreBackground = true;
    renderPass.skipShadowMapUpdate = true;
    const clearPass = renderPass.getClearPass();
    clearPass.overrideClearColor = new Color(7829503);
    clearPass.overrideClearAlpha = 1;
    this.renderTarget = renderTarget;
    if (this.renderTarget === void 0) {
      this.renderTarget = new WebGLRenderTarget(1, 1, {
        minFilter: NearestFilter,
        magFilter: NearestFilter
      });
      this.renderTarget.texture.name = "NormalPass.Target";
    }
    const resolution = this.resolution = new Resolution(this, resolutionX, resolutionY, resolutionScale);
    resolution.addEventListener("change", (e2) => this.setSize(resolution.baseWidth, resolution.baseHeight));
  }
  set mainScene(value) {
    this.renderPass.mainScene = value;
  }
  set mainCamera(value) {
    this.renderPass.mainCamera = value;
  }
  /**
   * The normal texture.
   *
   * @type {Texture}
   */
  get texture() {
    return this.renderTarget.texture;
  }
  /**
   * The normal texture.
   *
   * @deprecated Use texture instead.
   * @return {Texture} The texture.
   */
  getTexture() {
    return this.renderTarget.texture;
  }
  /**
   * Returns the resolution settings.
   *
   * @deprecated Use resolution instead.
   * @return {Resolution} The resolution.
   */
  getResolution() {
    return this.resolution;
  }
  /**
   * Returns the current resolution scale.
   *
   * @return {Number} The resolution scale.
   * @deprecated Use resolution.preferredWidth or resolution.preferredHeight instead.
   */
  getResolutionScale() {
    return this.resolution.scale;
  }
  /**
   * Sets the resolution scale.
   *
   * @param {Number} scale - The new resolution scale.
   * @deprecated Use resolution.preferredWidth or resolution.preferredHeight instead.
   */
  setResolutionScale(scale) {
    this.resolution.scale = scale;
  }
  /**
   * Renders the scene normals.
   *
   * @param {WebGLRenderer} renderer - The renderer.
   * @param {WebGLRenderTarget} inputBuffer - A frame buffer that contains the result of the previous pass.
   * @param {WebGLRenderTarget} outputBuffer - A frame buffer that serves as the output render target unless this pass renders to screen.
   * @param {Number} [deltaTime] - The time between the last frame and the current one in seconds.
   * @param {Boolean} [stencilTest] - Indicates whether a stencil mask is active.
   */
  render(renderer, inputBuffer, outputBuffer, deltaTime, stencilTest) {
    const renderTarget = this.renderToScreen ? null : this.renderTarget;
    this.renderPass.render(renderer, renderTarget, renderTarget);
  }
  /**
   * Updates the size of this pass.
   *
   * @param {Number} width - The width.
   * @param {Number} height - The height.
   */
  setSize(width, height) {
    const resolution = this.resolution;
    resolution.setBaseSize(width, height);
    this.renderTarget.setSize(resolution.width, resolution.height);
  }
};
var P = [
  new Float32Array(3),
  new Float32Array(3)
];
var C = [
  new Float32Array(3),
  new Float32Array(3),
  new Float32Array(3),
  new Float32Array(3)
];
var T2 = [
  [
    new Float32Array([0, 0, 0]),
    new Float32Array([1, 0, 0]),
    new Float32Array([1, 1, 0]),
    new Float32Array([1, 1, 1])
  ],
  [
    new Float32Array([0, 0, 0]),
    new Float32Array([1, 0, 0]),
    new Float32Array([1, 0, 1]),
    new Float32Array([1, 1, 1])
  ],
  [
    new Float32Array([0, 0, 0]),
    new Float32Array([0, 0, 1]),
    new Float32Array([1, 0, 1]),
    new Float32Array([1, 1, 1])
  ],
  [
    new Float32Array([0, 0, 0]),
    new Float32Array([0, 1, 0]),
    new Float32Array([1, 1, 0]),
    new Float32Array([1, 1, 1])
  ],
  [
    new Float32Array([0, 0, 0]),
    new Float32Array([0, 1, 0]),
    new Float32Array([0, 1, 1]),
    new Float32Array([1, 1, 1])
  ],
  [
    new Float32Array([0, 0, 0]),
    new Float32Array([0, 0, 1]),
    new Float32Array([0, 1, 1]),
    new Float32Array([1, 1, 1])
  ]
];
var area = [
  new Float32Array(2),
  new Float32Array(2)
];
var orthogonalSubsamplingOffsets = new Float32Array([
  0,
  -0.25,
  0.25,
  -0.125,
  0.125,
  -0.375,
  0.375
]);
var diagonalSubsamplingOffsets = [
  new Float32Array([0, 0]),
  new Float32Array([0.25, -0.25]),
  new Float32Array([-0.25, 0.25]),
  new Float32Array([0.125, -0.125]),
  new Float32Array([-0.125, 0.125])
];
var orthogonalEdges = [
  new Uint8Array([0, 0]),
  new Uint8Array([3, 0]),
  new Uint8Array([0, 3]),
  new Uint8Array([3, 3]),
  new Uint8Array([1, 0]),
  new Uint8Array([4, 0]),
  new Uint8Array([1, 3]),
  new Uint8Array([4, 3]),
  new Uint8Array([0, 1]),
  new Uint8Array([3, 1]),
  new Uint8Array([0, 4]),
  new Uint8Array([3, 4]),
  new Uint8Array([1, 1]),
  new Uint8Array([4, 1]),
  new Uint8Array([1, 4]),
  new Uint8Array([4, 4])
];
var diagonalEdges = [
  new Uint8Array([0, 0]),
  new Uint8Array([1, 0]),
  new Uint8Array([0, 2]),
  new Uint8Array([1, 2]),
  new Uint8Array([2, 0]),
  new Uint8Array([3, 0]),
  new Uint8Array([2, 2]),
  new Uint8Array([3, 2]),
  new Uint8Array([0, 1]),
  new Uint8Array([1, 1]),
  new Uint8Array([0, 3]),
  new Uint8Array([1, 3]),
  new Uint8Array([2, 1]),
  new Uint8Array([3, 1]),
  new Uint8Array([2, 3]),
  new Uint8Array([3, 3])
];
var edges = /* @__PURE__ */ new Map([
  [bilinear(0, 0, 0, 0), new Float32Array([0, 0, 0, 0])],
  [bilinear(0, 0, 0, 1), new Float32Array([0, 0, 0, 1])],
  [bilinear(0, 0, 1, 0), new Float32Array([0, 0, 1, 0])],
  [bilinear(0, 0, 1, 1), new Float32Array([0, 0, 1, 1])],
  [bilinear(0, 1, 0, 0), new Float32Array([0, 1, 0, 0])],
  [bilinear(0, 1, 0, 1), new Float32Array([0, 1, 0, 1])],
  [bilinear(0, 1, 1, 0), new Float32Array([0, 1, 1, 0])],
  [bilinear(0, 1, 1, 1), new Float32Array([0, 1, 1, 1])],
  [bilinear(1, 0, 0, 0), new Float32Array([1, 0, 0, 0])],
  [bilinear(1, 0, 0, 1), new Float32Array([1, 0, 0, 1])],
  [bilinear(1, 0, 1, 0), new Float32Array([1, 0, 1, 0])],
  [bilinear(1, 0, 1, 1), new Float32Array([1, 0, 1, 1])],
  [bilinear(1, 1, 0, 0), new Float32Array([1, 1, 0, 0])],
  [bilinear(1, 1, 0, 1), new Float32Array([1, 1, 0, 1])],
  [bilinear(1, 1, 1, 0), new Float32Array([1, 1, 1, 0])],
  [bilinear(1, 1, 1, 1), new Float32Array([1, 1, 1, 1])]
]);
function lerp2(a, b2, p4) {
  return a + (b2 - a) * p4;
}
function bilinear(e0, e1, e2, e3) {
  const a = lerp2(e0, e1, 1 - 0.25);
  const b2 = lerp2(e2, e3, 1 - 0.25);
  return lerp2(a, b2, 1 - 0.125);
}

// node_modules/.pnpm/maath@0.10.8_@types+three@0.186.0_three@0.186.1/node_modules/maath/dist/objectSpread2-284232a6.esm.js
function _defineProperty(obj, key, value) {
  if (key in obj) {
    Object.defineProperty(obj, key, {
      value,
      enumerable: true,
      configurable: true,
      writable: true
    });
  } else {
    obj[key] = value;
  }
  return obj;
}

// node_modules/.pnpm/maath@0.10.8_@types+three@0.186.0_three@0.186.1/node_modules/maath/dist/triangle-b62b9067.esm.js
var mv1 = new Vector2();
var mv2 = new Vector2();

// node_modules/.pnpm/maath@0.10.8_@types+three@0.186.0_three@0.186.1/node_modules/maath/dist/classCallCheck-9098b006.esm.js
function _classCallCheck(instance, Constructor) {
  if (!(instance instanceof Constructor)) {
    throw new TypeError("Cannot call a class as a function");
  }
}

// node_modules/.pnpm/maath@0.10.8_@types+three@0.186.0_three@0.186.1/node_modules/maath/dist/index-0332b2ed.esm.js
var Grad = function Grad2(x2, y, z) {
  var _this = this;
  _classCallCheck(this, Grad2);
  _defineProperty(this, "dot2", function(x3, y2) {
    return _this.x * x3 + _this.y * y2;
  });
  _defineProperty(this, "dot3", function(x3, y2, z2) {
    return _this.x * x3 + _this.y * y2 + _this.z * z2;
  });
  this.x = x2;
  this.y = y;
  this.z = z;
};
var grad3 = [new Grad(1, 1, 0), new Grad(-1, 1, 0), new Grad(1, -1, 0), new Grad(-1, -1, 0), new Grad(1, 0, 1), new Grad(-1, 0, 1), new Grad(1, 0, -1), new Grad(-1, 0, -1), new Grad(0, 1, 1), new Grad(0, -1, 1), new Grad(0, 1, -1), new Grad(0, -1, -1)];
var p3 = [151, 160, 137, 91, 90, 15, 131, 13, 201, 95, 96, 53, 194, 233, 7, 225, 140, 36, 103, 30, 69, 142, 8, 99, 37, 240, 21, 10, 23, 190, 6, 148, 247, 120, 234, 75, 0, 26, 197, 62, 94, 252, 219, 203, 117, 35, 11, 32, 57, 177, 33, 88, 237, 149, 56, 87, 174, 20, 125, 136, 171, 168, 68, 175, 74, 165, 71, 134, 139, 48, 27, 166, 77, 146, 158, 231, 83, 111, 229, 122, 60, 211, 133, 230, 220, 105, 92, 41, 55, 46, 245, 40, 244, 102, 143, 54, 65, 25, 63, 161, 1, 216, 80, 73, 209, 76, 132, 187, 208, 89, 18, 169, 200, 196, 135, 130, 116, 188, 159, 86, 164, 100, 109, 198, 173, 186, 3, 64, 52, 217, 226, 250, 124, 123, 5, 202, 38, 147, 118, 126, 255, 82, 85, 212, 207, 206, 59, 227, 47, 16, 58, 17, 182, 189, 28, 42, 223, 183, 170, 213, 119, 248, 152, 2, 44, 154, 163, 70, 221, 153, 101, 155, 167, 43, 172, 9, 129, 22, 39, 253, 19, 98, 108, 110, 79, 113, 224, 232, 178, 185, 112, 104, 218, 246, 97, 228, 251, 34, 242, 193, 238, 210, 144, 12, 191, 179, 162, 241, 81, 51, 145, 235, 249, 14, 239, 107, 49, 192, 214, 31, 181, 199, 106, 157, 184, 84, 204, 176, 115, 121, 50, 45, 127, 4, 150, 254, 138, 236, 205, 93, 222, 114, 67, 29, 24, 72, 243, 141, 128, 195, 78, 66, 215, 61, 156, 180];
var perm = new Array(512);
var gradP = new Array(512);
var seed = function seed2(_seed) {
  if (_seed > 0 && _seed < 1) {
    _seed *= 65536;
  }
  _seed = Math.floor(_seed);
  if (_seed < 256) {
    _seed |= _seed << 8;
  }
  for (var i3 = 0; i3 < 256; i3++) {
    var v2;
    if (i3 & 1) {
      v2 = p3[i3] ^ _seed & 255;
    } else {
      v2 = p3[i3] ^ _seed >> 8 & 255;
    }
    perm[i3] = perm[i3 + 256] = v2;
    gradP[i3] = gradP[i3 + 256] = grad3[v2 % 12];
  }
};
seed(0);
var F2 = 0.5 * (Math.sqrt(3) - 1);
var G2 = (3 - Math.sqrt(3)) / 6;
var F3 = 1 / 3;
var G3 = 1 / 6;
var TAU = Math.PI * 2;
function normalizeSeed(seed3) {
  if (typeof seed3 === "number") {
    seed3 = Math.abs(seed3);
  } else if (typeof seed3 === "string") {
    var string = seed3;
    seed3 = 0;
    for (var i3 = 0; i3 < string.length; i3++) {
      seed3 = (seed3 + (i3 + 1) * (string.charCodeAt(i3) % 96)) % 2147483647;
    }
  }
  if (seed3 === 0) {
    seed3 = 311;
  }
  return seed3;
}
function lcgRandom(seed3) {
  var state2 = normalizeSeed(seed3);
  return function() {
    var result = state2 * 48271 % 2147483647;
    state2 = result;
    return result / 2147483647;
  };
}
var Generator = function Generator2(_seed) {
  var _this = this;
  _classCallCheck(this, Generator2);
  _defineProperty(this, "seed", 0);
  _defineProperty(this, "init", function(seed3) {
    _this.seed = seed3;
    _this.value = lcgRandom(seed3);
  });
  _defineProperty(this, "value", lcgRandom(this.seed));
  this.init(_seed);
};
var defaultGen = new Generator(Math.random());

// node_modules/.pnpm/n8ao@2.0.1_postprocessing@6.39.5_three@0.186.1__three@0.186.1/node_modules/n8ao/dist/N8AO.js
function $parcel$interopDefault(a) {
  return a && a.__esModule ? a.default : a;
}
var $62561e92e160ec9a$exports = {};
$62561e92e160ec9a$exports = JSON.parse('{"architecture":"attention-v3-int8","formatVersion":3,"globalBias":[-0.32877659797668457,0.4370867609977722,-0.05251404270529747,1.3072023391723633,0.0477047860622406,0.24477416276931763,0.009111796505749226,-0.17459993064403534],"globalFeatureInverseStandardDeviation":[10.771836280822754,1.9548665285110474,1.612365484237671],"globalFeatureMean":[0.9198138117790222,-0.49808526039123535,0.03374629095196724],"globalWeights":[101,-4,7,-127,6,-11,3,1,0,-16,-7,8,-8,-1,7,-4,0,0,-12,-3,-13,1,0,2],"headBias":[-0.15895532071590424,0.007501596584916115,-0.47742825746536255,0.01632097363471985,-0.48355796933174133,-0.1052703931927681,-0.8414919376373291,-0.21046382188796997],"headWeights":[-45,-7,-45,-20,7,-13,120,-24,-15,-26,-19,1,27,-48,-4,-10,1,-5,-24,64,91,-1,-68,39,54,39,101,-40,-127,64,-41,-17,-23,-19,3,35,-2,33,3,9,-64,-32,30,42,-112,12,28,-11,15,2,-4,-7,7,-3,-5,1,76,48,-34,-67,103,-40,-26,1,58,-11,46,-41,5,-6,-17,-8,13,17,-35,45,27,-17,-28,7,-53,12,-51,6,-32,-5,58,-9,-28,-21,37,-12,1,20,2,2,11,7,-4,-9,2,-15,-1,-8,16,12,-27,-1,61,-5,-1,4,-7,-2,7,4,1,4,-2,4,-18,-16,28,6,-65,16,3,-3,-5,-2,0,-40,-21,-22,14,30,-21,49,15,-64,43,19,23,18,5,-15,21,21,30,17,-11,-6,22,-38,-20,97,-46,-5,-13,-59,26,-13,11,-2,-10,-8,2,-15,-17,-27,-9,26,7,-7,6,9,-32,5,-9,12,49,17,-1,24,20,35,14,-33,-50,-1,-4,-26,11,11,9,-80,30,9,36,6,-12,-4,-7,39,-10,-30,-49,1,-43,-20,-34,76,-36,-10,15,-8,43,31,38,-42,39,37,-7,7,8,16,28,-83,32,9,23,-13,39,119,23,-127,-24,8,-48,-29,-7,-33,-12,58,-24,-29,-19,12,-55,-90,0,126,26,42,54,22],"keyProjectionWeights":[0,-1,-1,1,1,1,1,1,-64,32,49,23,-25,4,27,-22,0,1,-1,-1,-1,1,1,0,-34,38,64,88,13,-53,-41,58,-7,-4,79,-41,27,26,14,2,-2,1,1,1,-1,-1,1,1,1,-1,-1,-1,-1,-1,1,1,4,-3,126,42,-40,-116,35,20],"name":"residual-attention-v3-50m-qat-int8-epoch-25-zo-278w","outputBias":-0.0005526235327124596,"outputWeights":[11,11,14,-27,9,-22,127,6],"quantization":{"scales":{"globalWeight":0.021090541950849095,"headWeight":0.04935851140909355,"keyWeight":0.1733924937791441,"outputWeight":0.0030087142047955295,"tapInputWeight":0.1096231754049479,"tapOutputWeight":0.017949438644286102,"valueWeight":0.013986751242596301},"scheme":"symmetric-int8-per-tensor","zeroPoint":0},"summaryQueries":[0.0038647791370749474,0.09565000981092453,0.002756686182692647,-0.08183622360229492,-0.15209506452083588,-0.0006105066277086735,0.0010439646430313587,-0.03020688332617283,0.005065929610282183,0.14488759636878967,0.003160916268825531,-0.0855727270245552,-0.3123375475406647,0.00039022407145239413,0.0037786494940519333,0.1451321840286255,-0.002009483054280281,0.0597594790160656,0.0045239729806780815,-0.08765853196382523,-0.13884992897510529,-0.0021647117100656033,0.003985927440226078,0.09727758169174194,0.007170629221946001,0.0786278173327446,0.004103775601834059,-0.1198369711637497,-0.2925199568271637,-0.002055276418104768,0.0030450925696641207,0.14401987195014954],"supportedDenoiseSamples":[4,8,16],"tapFeatureInverseStandardDeviation":[2.283243417739868,0.8810898065567017,0.8210930228233337,3.752316474914551,3.6375720500946045,2.670454978942871,10.249449729919434,0.12639354169368744,100],"tapFeatureMean":[0.010318092070519924,0.01364430133253336,0.13411010801792145,-0.004725644364953041,0.10053129494190216,0.8384788632392883,0.9203217625617981,1.7139031887054443,1],"tapInputBias":[0.4780646860599518,-0.45214661955833435,0.289407879114151,0.34804567694664,-0.1320028454065323,0.17722633481025696,0.011480014771223068,-0.26692497730255127],"tapInputWeights":[0,1,7,0,-1,-7,0,31,-2,-1,14,-126,0,0,-1,2,26,-2,0,66,-73,0,0,0,-12,22,-3,0,-76,-90,0,-1,-7,-3,58,-1,0,2,6,0,0,3,4,-40,0,0,3,-13,0,0,1,-7,-13,0,0,-7,10,0,-2,-7,0,-39,-2,0,-13,-19,0,-2,20,-1,3,-1],"tapOutputBias":[-0.3867710530757904,0.1349504142999649,0.35706064105033875,-0.5938405394554138,-0.031154220923781395,1.4079623222351074,-1.9221038818359375,0.6029739379882812],"tapOutputWeights":[18,-4,47,19,74,-94,-21,-9,73,-59,88,-10,-3,71,-7,24,20,74,24,-31,-12,-10,-15,-45,-126,2,-4,27,-5,24,35,-11,-4,9,-8,26,-10,27,26,-20,17,-50,5,-35,0,-5,12,-71,89,-58,22,-83,-115,7,-16,-89,89,22,1,-20,-22,-25,-26,44],"valueProjectionWeights":[-16,-6,40,-17,84,-76,59,51,-10,-2,-10,-1,-23,74,-70,23,-5,4,4,-7,-77,127,20,-48,-36,4,-17,-12,-4,10,29,-27,-2,11,-47,-50,-54,-3,14,11,-23,-1,109,31,4,-100,-33,-36,-19,0,-8,20,-35,-24,79,2,44,2,5,7,22,-70,-67,-35]}');
var $1193f60a44983e43$var$MATRIX_LAYOUTS = [
  [
    "tapInputWeight",
    "tapInputWeights",
    8,
    9
  ],
  [
    "tapOutputWeight",
    "tapOutputWeights",
    8,
    8
  ],
  [
    "globalWeight",
    "globalWeights",
    8,
    3
  ],
  [
    "keyWeight",
    "keyProjectionWeights",
    8,
    8
  ],
  [
    "valueWeight",
    "valueProjectionWeights",
    8,
    8
  ],
  [
    "headWeight",
    "headWeights",
    8,
    32
  ],
  [
    "outputWeight",
    "outputWeights",
    1,
    8
  ]
];
var $1193f60a44983e43$var$scale = (name) => {
  const value = (0, /* @__PURE__ */ $parcel$interopDefault($62561e92e160ec9a$exports)).quantization?.scales?.[name];
  if (!(value > 0) || !Number.isFinite(value)) throw new Error(`The bundled N8AO neural model has no valid ${name} scale.`);
  return value;
};
if ((0, /* @__PURE__ */ $parcel$interopDefault($62561e92e160ec9a$exports)).architecture !== "attention-v3-int8" || (0, /* @__PURE__ */ $parcel$interopDefault($62561e92e160ec9a$exports)).formatVersion !== 3 || (0, /* @__PURE__ */ $parcel$interopDefault($62561e92e160ec9a$exports)).quantization?.scheme !== "symmetric-int8-per-tensor" || (0, /* @__PURE__ */ $parcel$interopDefault($62561e92e160ec9a$exports)).quantization?.zeroPoint !== 0 || (0, /* @__PURE__ */ $parcel$interopDefault($62561e92e160ec9a$exports)).supportedDenoiseSamples?.join(",") !== "4,8,16" || $1193f60a44983e43$var$MATRIX_LAYOUTS.some(([, field, rows, columns]) => (0, /* @__PURE__ */ $parcel$interopDefault($62561e92e160ec9a$exports))[field]?.length !== rows * columns || (0, /* @__PURE__ */ $parcel$interopDefault($62561e92e160ec9a$exports))[field].some((value) => !Number.isInteger(value) || value < -127 || value > 127))) throw new Error("The bundled N8AO neural denoise model has an unsupported layout.");
var $1193f60a44983e43$var$glslFloat = (value) => {
  if (!Number.isFinite(value)) throw new Error("The bundled N8AO neural model contains a non-finite value.");
  if (Object.is(value, -0)) return "0.0";
  const text = Number(value).toString();
  return /[.eE]/.test(text) ? text : `${text}.0`;
};
var $1193f60a44983e43$var$COMPONENTS = [
  "x",
  "y",
  "z",
  "w"
];
var $1193f60a44983e43$var$tokenAccessors = (name) => [
  ...$1193f60a44983e43$var$COMPONENTS.map((component) => `${name}.lo.${component}`),
  ...$1193f60a44983e43$var$COMPONENTS.map((component) => `${name}.hi.${component}`)
];
var $1193f60a44983e43$var$weightedTerm = (coefficient, input) => {
  if (coefficient === 0) return null;
  if (coefficient === 1) return input;
  if (coefficient === -1) return `(-${input})`;
  if (coefficient < 0) return `(-${$1193f60a44983e43$var$glslFloat(-coefficient)} * ${input})`;
  return `${$1193f60a44983e43$var$glslFloat(coefficient)} * ${input}`;
};
var $1193f60a44983e43$var$floatWeightedTerm = (coefficient, input) => {
  if (coefficient === 0) return null;
  return `${$1193f60a44983e43$var$glslFloat(coefficient)} * ${input}`;
};
var $1193f60a44983e43$var$sumTerms = (terms) => terms.filter(Boolean).join(" + ") || "0.0";
var $1193f60a44983e43$var$quantizedRow = (weights, row, width, inputs, tensorScale, bias) => {
  const terms = inputs.map((input, column) => $1193f60a44983e43$var$weightedTerm(weights[row * width + column], input));
  return `${$1193f60a44983e43$var$glslFloat(tensorScale)} * (${$1193f60a44983e43$var$sumTerms(terms)}) + ${$1193f60a44983e43$var$glslFloat(bias[row])}`;
};
var $1193f60a44983e43$var$vec4 = (values, indent = "        ") => `vec4(
${values.map((value) => `${indent}    ${value}`).join(",\n")}
${indent})`;
var $1193f60a44983e43$var$tokenLayer = ({ functionName, scaleName, weights, bias, width = 8, relu = false }) => {
  const inputs = $1193f60a44983e43$var$tokenAccessors("inputToken");
  const tensorScale = $1193f60a44983e43$var$scale(scaleName);
  const rows = Array.from({
    length: 8
  }, (_, row) => $1193f60a44983e43$var$quantizedRow(weights, row, width, inputs, tensorScale, bias));
  const low = $1193f60a44983e43$var$vec4(rows.slice(0, 4));
  const high = $1193f60a44983e43$var$vec4(rows.slice(4));
  const wrap = (value) => relu ? `max(${value}, vec4(0.0))` : value;
  return `
    NeuralToken neural${functionName[0].toUpperCase()}${functionName.slice(1)}(NeuralToken inputToken) {
        return NeuralToken(
            ${wrap(low)},
            ${wrap(high)}
        );
    }
`;
};
var $1193f60a44983e43$var$foldedBias = (weights, bias, means, inverseStandardDeviations, rows, width, tensorScale, constantInputs = {}) => Array.from({
  length: rows
}, (_, row) => {
  let value = bias[row];
  for (let column = 0; column < width; column++) {
    const weight = weights[row * width + column] * tensorScale;
    value -= weight * inverseStandardDeviations[column] * means[column];
    if (Object.hasOwn(constantInputs, column)) value += weight * inverseStandardDeviations[column] * constantInputs[column];
  }
  return value;
});
var $1193f60a44983e43$var$tapInputScale = $1193f60a44983e43$var$scale("tapInputWeight");
var $1193f60a44983e43$var$tapInputBias = $1193f60a44983e43$var$foldedBias((0, /* @__PURE__ */ $parcel$interopDefault($62561e92e160ec9a$exports)).tapInputWeights, (0, /* @__PURE__ */ $parcel$interopDefault($62561e92e160ec9a$exports)).tapInputBias, (0, /* @__PURE__ */ $parcel$interopDefault($62561e92e160ec9a$exports)).tapFeatureMean, (0, /* @__PURE__ */ $parcel$interopDefault($62561e92e160ec9a$exports)).tapFeatureInverseStandardDeviation, 8, 9, $1193f60a44983e43$var$tapInputScale, {
  8: 1
});
var $1193f60a44983e43$var$tapScaledAccessors = $1193f60a44983e43$var$tokenAccessors("scaledInput");
var $1193f60a44983e43$var$tapInputRows = Array.from({
  length: 8
}, (_, row) => $1193f60a44983e43$var$quantizedRow((0, /* @__PURE__ */ $parcel$interopDefault($62561e92e160ec9a$exports)).tapInputWeights, row, 9, $1193f60a44983e43$var$tapScaledAccessors, $1193f60a44983e43$var$tapInputScale, $1193f60a44983e43$var$tapInputBias));
var $1193f60a44983e43$var$tapInputShader = `
    NeuralToken neuralTapInput(NeuralToken raw) {
        NeuralToken scaledInput = NeuralToken(
            raw.lo * ${$1193f60a44983e43$var$vec4((0, /* @__PURE__ */ $parcel$interopDefault($62561e92e160ec9a$exports)).tapFeatureInverseStandardDeviation.slice(0, 4), "            ")},
            raw.hi * ${$1193f60a44983e43$var$vec4((0, /* @__PURE__ */ $parcel$interopDefault($62561e92e160ec9a$exports)).tapFeatureInverseStandardDeviation.slice(4, 8), "            ")}
        );
        return NeuralToken(
            max(${$1193f60a44983e43$var$vec4($1193f60a44983e43$var$tapInputRows.slice(0, 4))}, vec4(0.0)),
            max(${$1193f60a44983e43$var$vec4($1193f60a44983e43$var$tapInputRows.slice(4))}, vec4(0.0))
        );
    }
`;
var $1193f60a44983e43$var$globalScale = $1193f60a44983e43$var$scale("globalWeight");
var $1193f60a44983e43$var$globalBias = $1193f60a44983e43$var$foldedBias((0, /* @__PURE__ */ $parcel$interopDefault($62561e92e160ec9a$exports)).globalWeights, (0, /* @__PURE__ */ $parcel$interopDefault($62561e92e160ec9a$exports)).globalBias, (0, /* @__PURE__ */ $parcel$interopDefault($62561e92e160ec9a$exports)).globalFeatureMean, (0, /* @__PURE__ */ $parcel$interopDefault($62561e92e160ec9a$exports)).globalFeatureInverseStandardDeviation, 8, 3, $1193f60a44983e43$var$globalScale);
var $1193f60a44983e43$var$globalInputs = $1193f60a44983e43$var$COMPONENTS.slice(0, 3).map((component) => `scaledInput.${component}`);
var $1193f60a44983e43$var$globalRows = Array.from({
  length: 8
}, (_, row) => $1193f60a44983e43$var$quantizedRow((0, /* @__PURE__ */ $parcel$interopDefault($62561e92e160ec9a$exports)).globalWeights, row, 3, $1193f60a44983e43$var$globalInputs, $1193f60a44983e43$var$globalScale, $1193f60a44983e43$var$globalBias));
var $1193f60a44983e43$var$globalInputShader = `
    NeuralToken neuralEncodeGlobal(vec4 raw) {
        vec3 scaledInput = raw.xyz * vec3(
            ${(0, /* @__PURE__ */ $parcel$interopDefault($62561e92e160ec9a$exports)).globalFeatureInverseStandardDeviation.map($1193f60a44983e43$var$glslFloat).join(", ")}
        );
        return NeuralToken(
            max(${$1193f60a44983e43$var$vec4($1193f60a44983e43$var$globalRows.slice(0, 4))}, vec4(0.0)),
            max(${$1193f60a44983e43$var$vec4($1193f60a44983e43$var$globalRows.slice(4))}, vec4(0.0))
        );
    }
`;
var $1193f60a44983e43$var$queryInputs = $1193f60a44983e43$var$tokenAccessors("key");
var $1193f60a44983e43$var$queryRows = Array.from({
  length: 4
}, (_, query2) => $1193f60a44983e43$var$sumTerms($1193f60a44983e43$var$queryInputs.map((input, column) => $1193f60a44983e43$var$floatWeightedTerm((0, /* @__PURE__ */ $parcel$interopDefault($62561e92e160ec9a$exports)).summaryQueries[query2 * 8 + column], input))));
var $1193f60a44983e43$var$queryShader = `
    vec4 neuralQueryScores(NeuralToken key) {
        return ${$1193f60a44983e43$var$vec4($1193f60a44983e43$var$queryRows)};
    }
`;
var $1193f60a44983e43$var$summaryInputs = [];
for (let query2 = 0; query2 < 4; query2++) $1193f60a44983e43$var$summaryInputs.push(...$1193f60a44983e43$var$COMPONENTS.map((component) => `runningSummaryLo[${query2}].${component}`), ...$1193f60a44983e43$var$COMPONENTS.map((component) => `runningSummaryHi[${query2}].${component}`));
var $1193f60a44983e43$var$headScale = $1193f60a44983e43$var$scale("headWeight");
var $1193f60a44983e43$var$headRows = Array.from({
  length: 8
}, (_, row) => $1193f60a44983e43$var$quantizedRow((0, /* @__PURE__ */ $parcel$interopDefault($62561e92e160ec9a$exports)).headWeights, row, 32, $1193f60a44983e43$var$summaryInputs, $1193f60a44983e43$var$headScale, (0, /* @__PURE__ */ $parcel$interopDefault($62561e92e160ec9a$exports)).headBias));
var $1193f60a44983e43$var$headShader = `
    NeuralToken neuralHead(
        vec4 runningSummaryLo[4],
        vec4 runningSummaryHi[4]
    ) {
        return NeuralToken(
            max(${$1193f60a44983e43$var$vec4($1193f60a44983e43$var$headRows.slice(0, 4))}, vec4(0.0)),
            max(${$1193f60a44983e43$var$vec4($1193f60a44983e43$var$headRows.slice(4))}, vec4(0.0))
        );
    }
`;
var $1193f60a44983e43$var$outputExpression = $1193f60a44983e43$var$quantizedRow((0, /* @__PURE__ */ $parcel$interopDefault($62561e92e160ec9a$exports)).outputWeights, 0, 8, $1193f60a44983e43$var$tokenAccessors("head"), $1193f60a44983e43$var$scale("outputWeight"), [
  (0, /* @__PURE__ */ $parcel$interopDefault($62561e92e160ec9a$exports)).outputBias
]);
var $1193f60a44983e43$var$outputShader = `
    float neuralOutput(NeuralToken head) {
        return ${$1193f60a44983e43$var$outputExpression};
    }
`;
var $1193f60a44983e43$export$d75ad64dd346ec0e = [
  $1193f60a44983e43$var$tapInputShader,
  $1193f60a44983e43$var$tokenLayer({
    functionName: "tapOutput",
    scaleName: "tapOutputWeight",
    weights: (0, /* @__PURE__ */ $parcel$interopDefault($62561e92e160ec9a$exports)).tapOutputWeights,
    bias: (0, /* @__PURE__ */ $parcel$interopDefault($62561e92e160ec9a$exports)).tapOutputBias,
    relu: true
  }),
  $1193f60a44983e43$var$globalInputShader,
  $1193f60a44983e43$var$tokenLayer({
    functionName: "keyProject",
    scaleName: "keyWeight",
    weights: (0, /* @__PURE__ */ $parcel$interopDefault($62561e92e160ec9a$exports)).keyProjectionWeights,
    bias: new Array(8).fill(0)
  }),
  $1193f60a44983e43$var$tokenLayer({
    functionName: "valueProject",
    scaleName: "valueWeight",
    weights: (0, /* @__PURE__ */ $parcel$interopDefault($62561e92e160ec9a$exports)).valueProjectionWeights,
    bias: new Array(8).fill(0)
  }),
  $1193f60a44983e43$var$queryShader,
  $1193f60a44983e43$var$headShader,
  $1193f60a44983e43$var$outputShader
].join("\n");
var $1193f60a44983e43$export$788ba311f03a5564 = $1193f60a44983e43$var$MATRIX_LAYOUTS.reduce((sum, [, field]) => sum + (0, /* @__PURE__ */ $parcel$interopDefault($62561e92e160ec9a$exports))[field].length, 0);
var $1193f60a44983e43$export$dd4eb4d1095a3d82 = $1193f60a44983e43$var$MATRIX_LAYOUTS.reduce((sum, [, field]) => sum + (0, /* @__PURE__ */ $parcel$interopDefault($62561e92e160ec9a$exports))[field].filter((value) => value !== 0).length, 0);
var $e52378cd0f5a973d$export$57856b59f317262e = {
  uniforms: {
    "sceneDiffuse": {
      value: null
    },
    "sceneDepth": {
      value: null
    },
    "tDiffuse": {
      value: null
    },
    "projMat": {
      value: /* @__PURE__ */ new Matrix4()
    },
    "viewMat": {
      value: /* @__PURE__ */ new Matrix4()
    },
    "projectionMatrixInv": {
      value: /* @__PURE__ */ new Matrix4()
    },
    "viewMatrixInv": {
      value: /* @__PURE__ */ new Matrix4()
    },
    "cameraPos": {
      value: /* @__PURE__ */ new Vector3()
    },
    "resolution": {
      value: /* @__PURE__ */ new Vector2()
    },
    "time": {
      value: 0
    },
    "r": {
      value: 5
    },
    "blueNoise": {
      value: null
    },
    "radius": {
      value: 12
    },
    "worldRadius": {
      value: 5
    },
    "index": {
      value: 0
    },
    "poissonDisk": {
      value: []
    },
    "distanceFalloff": {
      value: 1
    },
    "near": {
      value: 0.1
    },
    "far": {
      value: 1e3
    },
    "screenSpaceRadius": {
      value: false
    }
  },
  depthWrite: false,
  depthTest: false,
  vertexShader: (
    /* glsl */
    `
		varying vec2 vUv;
		void main() {
			vUv = uv;
			gl_Position = vec4(position, 1.0);
		}`
  ),
  fragmentShader: (
    /* glsl */
    `
		uniform sampler2D sceneDiffuse;
    uniform highp sampler2D sceneDepth;
    uniform sampler2D tDiffuse;
    uniform sampler2D blueNoise;
    uniform mat4 projectionMatrixInv;
    uniform mat4 viewMatrixInv;
    uniform vec2 resolution;
    uniform float r;
    uniform float radius;
     uniform float worldRadius;
    uniform float index;
     uniform float near;
     uniform float far;
     uniform float distanceFalloff;
    uniform bool screenSpaceRadius;
    varying vec2 vUv;

    highp float linearize_depth(highp float d, highp float zNear,highp float zFar)
    {
        highp float z_n = 2.0 * d - 1.0;
        return 2.0 * zNear * zFar / (zFar + zNear - z_n * (zFar - zNear));
    }
    highp float linearize_depth_log(highp float d, highp float nearZ,highp float farZ) {
     float depth = pow(2.0, d * log2(farZ + 1.0)) - 1.0;
     float a = farZ / (farZ - nearZ);
     float b = farZ * nearZ / (nearZ - farZ);
     float linDepth = a + b / depth;
     return linearize_depth(linDepth, nearZ, farZ);
   }
   highp float linearize_depth_ortho(highp float d, highp float nearZ, highp float farZ) {
     return nearZ + (farZ - nearZ) * d;
   }
   float depthToClipZ(float depth) {
     #ifdef REVERSEDEPTH
       return depth;
     #else
       return depth * 2.0 - 1.0;
     #endif
   }
   bool isBackgroundDepth(float depth) {
     #ifdef REVERSEDEPTH
       return depth == 0.0;
     #else
       return depth == 1.0;
     #endif
   }
   vec3 getWorldPosLog(vec3 posS) {
     vec2 uv = posS.xy;
     float z = posS.z;
     float nearZ =near;
     float farZ = far;
     float depth = pow(2.0, z * log2(farZ + 1.0)) - 1.0;
     float a = farZ / (farZ - nearZ);
     float b = farZ * nearZ / (nearZ - farZ);
     float linDepth = a + b / depth;
     vec4 clipVec = vec4(uv, linDepth, 1.0) * 2.0 - 1.0;
     vec4 wpos = projectionMatrixInv * clipVec;
     return wpos.xyz / wpos.w;
   }
    vec3 getWorldPos(float depth, vec2 coord) {
     #ifdef LOGDEPTH
      #ifndef ORTHO
          return getWorldPosLog(vec3(coord, depth));
      #endif
     #endif
        
        #ifdef ORTHO
          float z = depthToClipZ(depth);
          vec4 clipSpacePosition = vec4(coord * 2. - 1., z, 1.);
          vec4 viewSpacePosition = projectionMatrixInv * clipSpacePosition;
          viewSpacePosition.xyz /= viewSpacePosition.w;
          return viewSpacePosition.xyz;
        #else
          vec2 ndc = coord * 2. - 1.;
          float ndcZ = depthToClipZ(depth);
          mat4 Q = projectionMatrixInv;
          vec3 view = vec3(Q[0][0] * ndc.x + Q[3][0], Q[1][1] * ndc.y + Q[3][1], Q[3][2]);
          float invW = 1.0 / (Q[2][3] * ndcZ + Q[3][3]);
          return view * invW;
        #endif
    }

#ifdef NEURAL_DENOISE
    struct NeuralToken {
        highp vec4 lo;
        highp vec4 hi;
    };

    ${0, $1193f60a44983e43$export$d75ad64dd346ec0e}

    vec3 neuralSafeNormalize(vec3 value, vec3 fallback) {
        float lengthSquared = dot(value, value);
        return lengthSquared > 1e-12 ? value * inversesqrt(lengthSquared) : fallback;
    }

    mat3 neuralLocalFrame(vec3 inputNormal) {
        vec3 frameNormal = neuralSafeNormalize(inputNormal, vec3(0.0, 0.0, 1.0));
        vec3 helper = abs(frameNormal.z) < 0.999
            ? vec3(0.0, 0.0, 1.0)
            : vec3(0.0, 1.0, 0.0);
        vec3 tangent = neuralSafeNormalize(
            cross(helper, frameNormal),
            vec3(1.0, 0.0, 0.0)
        );
        vec3 bitangent = cross(frameNormal, tangent);
        return transpose(mat3(tangent, bitangent, frameNormal));
    }

    void neuralConsumeToken(
        NeuralToken token,
        inout vec4 runningMaximum,
        inout vec4 runningDenominator,
        inout vec4 runningSummaryLo[4],
        inout vec4 runningSummaryHi[4]
    ) {
        NeuralToken key = neuralKeyProject(token);
        NeuralToken value = neuralValueProject(token);
        vec4 score = neuralQueryScores(key) * 0.3535533905932738;
        vec4 newMaximum = max(runningMaximum, score);
        vec4 oldScale = exp(runningMaximum - newMaximum);
        vec4 newScale = exp(score - newMaximum);

        runningSummaryLo[0] = runningSummaryLo[0] * oldScale.x + value.lo * newScale.x;
        runningSummaryHi[0] = runningSummaryHi[0] * oldScale.x + value.hi * newScale.x;
        runningSummaryLo[1] = runningSummaryLo[1] * oldScale.y + value.lo * newScale.y;
        runningSummaryHi[1] = runningSummaryHi[1] * oldScale.y + value.hi * newScale.y;
        runningSummaryLo[2] = runningSummaryLo[2] * oldScale.z + value.lo * newScale.z;
        runningSummaryHi[2] = runningSummaryHi[2] * oldScale.z + value.hi * newScale.z;
        runningSummaryLo[3] = runningSummaryLo[3] * oldScale.w + value.lo * newScale.w;
        runningSummaryHi[3] = runningSummaryHi[3] * oldScale.w + value.hi * newScale.w;
        runningDenominator = runningDenominator * oldScale + newScale;
        runningMaximum = newMaximum;
    }

    void neuralEncodeTap(
        NeuralToken raw,
        inout vec4 runningMaximum,
        inout vec4 runningDenominator,
        inout vec4 runningSummaryLo[4],
        inout vec4 runningSummaryHi[4]
    ) {
        NeuralToken first = neuralTapInput(raw);
        NeuralToken token = neuralTapOutput(first);
        neuralConsumeToken(
            token,
            runningMaximum,
            runningDenominator,
            runningSummaryLo,
            runningSummaryHi
        );
    }

    float neuralFinish(
        float baselineAO,
        inout vec4 runningMaximum,
        inout vec4 runningDenominator,
        inout vec4 runningSummaryLo[4],
        inout vec4 runningSummaryHi[4]
    ) {
        vec4 raw = vec4(
            baselineAO,
            log(max(worldRadius, 1e-6)),
            log(max(distanceFalloff, 1e-6)),
            0.0
        );
        NeuralToken token = neuralEncodeGlobal(raw);
        neuralConsumeToken(
            token,
            runningMaximum,
            runningDenominator,
            runningSummaryLo,
            runningSummaryHi
        );

        vec4 inverseDenominator = 1.0 / max(runningDenominator, vec4(1e-12));
        runningSummaryLo[0] *= inverseDenominator.x;
        runningSummaryHi[0] *= inverseDenominator.x;
        runningSummaryLo[1] *= inverseDenominator.y;
        runningSummaryHi[1] *= inverseDenominator.y;
        runningSummaryLo[2] *= inverseDenominator.z;
        runningSummaryHi[2] *= inverseDenominator.z;
        runningSummaryLo[3] *= inverseDenominator.w;
        runningSummaryHi[3] *= inverseDenominator.w;

        NeuralToken head = neuralHead(runningSummaryLo, runningSummaryHi);
        return neuralOutput(head);
    }
#endif

    #include <common>
    #define NUM_SAMPLES __N8AO_DENOISE_SAMPLES__
    uniform vec2 poissonDisk[NUM_SAMPLES];
    void main() {
        const float pi = 3.14159;
        vec2 texelSize = vec2(1.0 / resolution.x, 1.0 / resolution.y);
        vec2 uv = vUv;
        vec4 data = texture2D(tDiffuse, vUv);
        float occlusion = data.r;
        float baseOcc = data.r;
        vec3 normal = data.gba * 2.0 - 1.0;
        float count = 1.0;
        float d = texture2D(sceneDepth, vUv).x;
        if (isBackgroundDepth(d)) {
          gl_FragColor = data;
          return;
        }
        vec3 worldPos = getWorldPos(d, vUv);
        float size = radius;
        float angle;
#ifdef NEURAL_DENOISE
        // The neural material is only bound for denoise iteration two.
        angle = texture2D(blueNoise, gl_FragCoord.xy / 128.0).z * PI2;
#else
        if (index == 0.0) {
             angle = texture2D(blueNoise, gl_FragCoord.xy / 128.0).w * PI2;
        } else if (index == 1.0) {
             angle = texture2D(blueNoise, gl_FragCoord.xy / 128.0).z * PI2;
        } else if (index == 2.0) {
             angle = texture2D(blueNoise, gl_FragCoord.xy / 128.0).y * PI2;
        } else {
             angle = texture2D(blueNoise, gl_FragCoord.xy / 128.0).x * PI2;
        }
#endif

        mat2 rotationMatrix = mat2(cos(angle), -sin(angle), sin(angle), cos(angle));
        float radiusToUse = screenSpaceRadius ? distance(
          worldPos,
          getWorldPos(d, vUv +
            vec2(worldRadius, 0.0) / resolution)
        ) : worldRadius;
        float distanceFalloffToUse =screenSpaceRadius ?
        radiusToUse * distanceFalloff
    : radiusToUse * distanceFalloff * 0.2;

        float invDistance = (1.0 / distanceFalloffToUse);
#ifdef NEURAL_DENOISE
        mat3 neuralWorldToLocal = neuralLocalFrame(normal);
        float neuralInverseRadius = 1.0 / max(radiusToUse, 1e-6);
        float neuralInverseDistance = 1.0 / max(distanceFalloffToUse, 1e-6);
        vec4 neuralMaximum = vec4(-1e30);
        vec4 neuralDenominator = vec4(0.0);
        vec4 neuralSummaryLo[4];
        vec4 neuralSummaryHi[4];
        for (int query = 0; query < 4; query++) {
            neuralSummaryLo[query] = vec4(0.0);
            neuralSummaryHi[query] = vec4(0.0);
        }
#endif
        for(int i = 0; i < NUM_SAMPLES; i++) {
            vec2 offset = (rotationMatrix * poissonDisk[i]) * texelSize * size;
            vec4 dataSample = texture2D(tDiffuse, uv + offset);
            float occSample = dataSample.r;
            vec3 normalSample = dataSample.gba * 2.0 - 1.0;
            float dSample = texture2D(sceneDepth, uv + offset).x;
            vec3 worldPosSample = getWorldPos(dSample, uv + offset);
            float tangentPlaneDist = abs(dot(worldPosSample - worldPos, normal));
            float rangeCheck = float(!isBackgroundDepth(dSample)) * exp(-1.0 * tangentPlaneDist * invDistance ) * max(dot(normal, normalSample), 0.0);
            occlusion += occSample * rangeCheck;
            count += rangeCheck;
#ifdef NEURAL_DENOISE
            if (!isBackgroundDepth(dSample)) {
                vec3 localDelta = (neuralWorldToLocal * (worldPosSample - worldPos))
                    * neuralInverseRadius;
                vec3 localNormal = neuralWorldToLocal
                    * neuralSafeNormalize(normalSample, vec3(0.0, 0.0, 1.0));
                NeuralToken rawTap = NeuralToken(
                    vec4(localDelta, localNormal.x),
                    vec4(
                        localNormal.y,
                        localNormal.z,
                        occSample,
                        tangentPlaneDist * neuralInverseDistance
                    )
                );
                neuralEncodeTap(
                    rawTap,
                    neuralMaximum,
                    neuralDenominator,
                    neuralSummaryLo,
                    neuralSummaryHi
                );
            }
#endif
        }
        if (count > 0.0) {
          occlusion /= count;
        }
        occlusion = clamp(occlusion, 0.0, 1.0);
        if (occlusion == 0.0) {
          occlusion = 1.0;
        }
#ifdef NEURAL_DENOISE
        occlusion = clamp(
            occlusion + neuralFinish(
                occlusion,
                neuralMaximum,
                neuralDenominator,
                neuralSummaryLo,
                neuralSummaryHi
            ),
            0.0,
            1.0
        );
#endif
        gl_FragColor = vec4(occlusion, 0.5 + 0.5 * normal);
    }
    `
  )
};
var $ff9437d9c7577f11$var$version = /* @__PURE__ */ (() => parseInt(REVISION.replace(/\D+/g, "")))();
var $ff9437d9c7577f11$export$156f6a58f569aa09 = $ff9437d9c7577f11$var$version >= 162 ? class extends WebGLRenderTarget {
  constructor(width = 1, height = 1, count = 1, options = {}) {
    super(width, height, {
      ...options,
      count
    });
    this.isWebGLMultipleRenderTargets = true;
  }
  get texture() {
    return this.textures;
  }
} : class extends WebGLRenderTarget {
  constructor(width = 1, height = 1, count = 1, options = {}) {
    super(width, height, options);
    this.isWebGLMultipleRenderTargets = true;
    const texture = this.texture;
    this.texture = [];
    for (let i3 = 0; i3 < count; i3++) {
      this.texture[i3] = texture.clone();
      this.texture[i3].isRenderTargetTexture = true;
    }
  }
  setSize(width, height, depth = 1) {
    if (this.width !== width || this.height !== height || this.depth !== depth) {
      this.width = width;
      this.height = height;
      this.depth = depth;
      for (let i3 = 0, il = this.texture.length; i3 < il; i3++) {
        this.texture[i3].image.width = width;
        this.texture[i3].image.height = height;
        this.texture[i3].image.depth = depth;
      }
      this.dispose();
    }
    this.viewport.set(0, 0, width, height);
    this.scissor.set(0, 0, width, height);
  }
  copy(source) {
    this.dispose();
    this.width = source.width;
    this.height = source.height;
    this.depth = source.depth;
    this.scissor.copy(source.scissor);
    this.scissorTest = source.scissorTest;
    this.viewport.copy(source.viewport);
    this.depthBuffer = source.depthBuffer;
    this.stencilBuffer = source.stencilBuffer;
    if (source.depthTexture !== null) this.depthTexture = source.depthTexture.clone();
    this.texture.length = 0;
    for (let i3 = 0, il = source.texture.length; i3 < il; i3++) {
      this.texture[i3] = source.texture[i3].clone();
      this.texture[i3].isRenderTargetTexture = true;
    }
    return this;
  }
};

// node_modules/.pnpm/@react-three+postprocessing@3.1.2_@react-three+fiber@9.8.1_@types+react@19.3.0_react-do_952babc1e50b049ce2c9670caec410a1/node_modules/@react-three/postprocessing/dist/index.js
function readGroupChildren(group, filter) {
  const groupInstance = group.__r3f;
  return groupInstance ? groupInstance.children.map((child) => child.object).filter(filter) : [];
}
function updateIfChanged(ref, next) {
  const previous = ref.current;
  if (next.length === previous.length && next.every((item, i3) => item === previous[i3])) return false;
  ref.current = next;
  return true;
}
var EffectComposerContext = /* @__PURE__ */ (0, import_react5.createContext)(null);
var isConvolution = (effect) => (effect.getAttributes() & 2) === 2;
var hasMainUv = (effect) => /mainUv/.test(effect.getFragmentShader() ?? "");
function createRendererPropertyGuard(property) {
  const refs = /* @__PURE__ */ new WeakMap();
  return {
    acquire(gl, forcedValue) {
      const existing = refs.get(gl);
      if (existing) {
        existing.count++;
        existing.forcedValue = forcedValue;
      } else refs.set(gl, {
        count: 1,
        original: gl[property],
        forcedValue
      });
    },
    release(gl) {
      const entry = refs.get(gl);
      if (!entry) return;
      if (--entry.count <= 0) {
        if (gl[property] === entry.forcedValue) gl[property] = entry.original;
        refs.delete(gl);
      }
    }
  };
}
var autoClearGuard = /* @__PURE__ */ createRendererPropertyGuard("autoClear");
var toneMappingGuard = /* @__PURE__ */ createRendererPropertyGuard("toneMapping");
var glSize = /* @__PURE__ */ new Vector2();
var defaultRenderPass = (scene, camera) => new RenderPass(scene, camera);
var generatedPasses = /* @__PURE__ */ new WeakSet();
var groupPasses = /* @__PURE__ */ new WeakSet();
function disposePassWithoutEffects(pass) {
  if (pass instanceof EffectPass) pass.setEffects([]);
  Pass.prototype.dispose.call(pass);
}
function disposeGeneratedPass(pass) {
  if (!generatedPasses.has(pass)) return;
  disposePassWithoutEffects(pass);
}
function buildPasses(nodes, camera, mergeMode) {
  const passes = [];
  for (let i3 = 0; i3 < nodes.length; i3++) {
    const node = nodes[i3];
    if (node instanceof Effect) {
      const effects = [node];
      let hasConvolution = isConvolution(node);
      let hasMainUvEffect = hasMainUv(node);
      if (mergeMode !== "none") {
        let next;
        while ((next = nodes[i3 + 1]) instanceof Effect) {
          const nextIsConvolution = isConvolution(next);
          const nextHasMainUv = hasMainUv(next);
          if (mergeMode === "auto" && (hasConvolution && nextIsConvolution || hasConvolution && nextHasMainUv || hasMainUvEffect && nextIsConvolution)) break;
          effects.push(next);
          hasConvolution ||= nextIsConvolution;
          hasMainUvEffect ||= nextHasMainUv;
          i3++;
        }
      }
      const pass = new EffectPass(camera, ...effects);
      generatedPasses.add(pass);
      passes.push(pass);
    } else if (node instanceof Pass) passes.push(node);
  }
  return passes;
}
var EffectComposer2 = /* @__PURE__ */ (0, import_react5.memo)(function EffectComposer3({ children, camera: _camera, scene: _scene, resolutionScale, enabled = true, renderPriority = 1, autoClear = true, autoRenderToScreen = true, depthBuffer, enableNormalPass, stencilBuffer, multisampling = 8, frameBufferType = HalfFloatType, renderPass = defaultRenderPass, mergeMode = "auto", ref }) {
  const { gl, scene: defaultScene, camera: defaultCamera } = useThree();
  const scene = _scene || defaultScene;
  const camera = _camera || defaultCamera;
  gl.getSize(glSize);
  const [composerState, setComposerState] = (0, import_react5.useState)(null);
  const [, requestRebuild] = (0, import_react5.useReducer)((c) => c + 1, 0);
  (0, import_react5.useEffect)(() => {
    autoClearGuard.acquire(gl, false);
    const effectComposer = new EffectComposer(gl, {
      depthBuffer,
      stencilBuffer,
      multisampling,
      frameBufferType
    });
    effectComposer.autoRenderToScreen = autoRenderToScreen;
    effectComposer.addPass(renderPass(scene, camera));
    let normalPass = null;
    let downSamplingPass = null;
    if (enableNormalPass) {
      normalPass = new NormalPass(scene, camera);
      normalPass.enabled = false;
      effectComposer.addPass(normalPass);
      if (resolutionScale !== void 0) {
        downSamplingPass = new DepthDownsamplingPass({
          normalBuffer: normalPass.texture,
          resolutionScale
        });
        downSamplingPass.enabled = false;
        effectComposer.addPass(downSamplingPass);
      }
    }
    effectComposer.setSize(glSize.width, glSize.height);
    setComposerState({
      composer: effectComposer,
      normalPass,
      downSamplingPass
    });
    return () => {
      for (const pass of effectComposer.passes) disposeGeneratedPass(pass);
      effectComposer.dispose();
      autoClearGuard.release(gl);
    };
  }, [
    camera,
    gl,
    depthBuffer,
    stencilBuffer,
    multisampling,
    frameBufferType,
    autoRenderToScreen,
    renderPass,
    scene,
    enableNormalPass,
    resolutionScale
  ]);
  const appliedSizeRef = (0, import_react5.useRef)({
    width: -1,
    height: -1
  });
  useFrame((_, delta) => {
    if (!enabled || !composerState) return;
    const { composer } = composerState;
    gl.getSize(glSize);
    if (glSize.width !== appliedSizeRef.current.width || glSize.height !== appliedSizeRef.current.height) {
      composer.setSize(glSize.width, glSize.height);
      appliedSizeRef.current.width = glSize.width;
      appliedSizeRef.current.height = glSize.height;
    }
    const currentAutoClear = gl.autoClear;
    gl.autoClear = autoClear;
    if (stencilBuffer && !autoClear) gl.clearStencil();
    composer.render(delta);
    gl.autoClear = currentAutoClear;
  }, enabled ? renderPriority : 0);
  const group = (0, import_react5.useRef)(null);
  const nodesRef = (0, import_react5.useRef)([]);
  const [nodesVersion, setNodesVersion] = (0, import_react5.useState)(0);
  (0, import_react5.useLayoutEffect)(() => {
    if (!composerState) return;
    const nodes = readGroupChildren(group.current, (object) => object instanceof Effect || object instanceof Pass);
    if (updateIfChanged(nodesRef, nodes)) setNodesVersion((v2) => v2 + 1);
  });
  (0, import_react5.useLayoutEffect)(() => {
    if (!composerState) return;
    const { composer, normalPass, downSamplingPass } = composerState;
    const passes = buildPasses(nodesRef.current, camera, mergeMode);
    if (passes.some((pass) => groupPasses.has(pass))) {
      const trailingCopyPass = new CopyPass();
      generatedPasses.add(trailingCopyPass);
      passes.push(trailingCopyPass);
    }
    for (const pass of passes) composer.addPass(pass);
    if (passes.length) {
      if (normalPass) normalPass.enabled = true;
      if (downSamplingPass) downSamplingPass.enabled = true;
    }
    return () => {
      for (const pass of passes) {
        composer.removePass(pass);
        disposeGeneratedPass(pass);
      }
      if (normalPass) normalPass.enabled = false;
      if (downSamplingPass) downSamplingPass.enabled = false;
    };
  }, [
    composerState,
    nodesVersion,
    camera,
    mergeMode
  ]);
  (0, import_react5.useEffect)(() => {
    toneMappingGuard.acquire(gl, NoToneMapping);
    gl.toneMapping = NoToneMapping;
    return () => {
      toneMappingGuard.release(gl);
    };
  }, [gl]);
  const state2 = (0, import_react5.useMemo)(() => composerState ? {
    composer: composerState.composer,
    normalPass: composerState.normalPass,
    downSamplingPass: composerState.downSamplingPass,
    resolutionScale,
    camera,
    scene,
    requestRebuild,
    autoClear
  } : null, [
    composerState,
    resolutionScale,
    camera,
    scene,
    requestRebuild,
    autoClear
  ]);
  (0, import_react5.useImperativeHandle)(ref, () => composerState?.composer, [composerState]);
  if (!state2) return null;
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(EffectComposerContext.Provider, {
    value: state2,
    children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("group", {
      ref: group,
      children
    })
  });
});
var i2 = 0;
var components = /* @__PURE__ */ new WeakMap();
var identityTokens = /* @__PURE__ */ new WeakMap();
var nextIdentityToken = 0;
function identityOf(value) {
  let token = identityTokens.get(value);
  if (token === void 0) {
    token = nextIdentityToken++;
    identityTokens.set(value, token);
  }
  return token;
}
function fingerprint(value, seen) {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return identityOf(value);
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => fingerprint(item, seen));
  const out = {};
  for (const key of Object.keys(value).sort()) out[key] = fingerprint(value[key], seen);
  return out;
}
function stableStringify(value) {
  return JSON.stringify(fingerprint(value, /* @__PURE__ */ new WeakSet()));
}
function wrapEffect(effect, defaults) {
  return function WrappedEffect({ ref, blendFunction = defaults?.blendFunction, opacity = defaults?.opacity, ...props }) {
    let Component2 = components.get(effect);
    if (!Component2) {
      const key = `@react-three/postprocessing/${effect.name}-${i2++}`;
      extend({ [key]: effect });
      components.set(effect, Component2 = key);
    }
    const camera = useThree((state2) => state2.camera);
    const args = (0, import_react5.useMemo)(() => [...defaults?.args ?? [], ...props.args ?? [{
      ...defaults,
      ...props
    }]], [stableStringify(props)]);
    return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Component2, {
      camera,
      "blendMode-blendFunction": blendFunction,
      "blendMode-opacity-value": opacity,
      ...props,
      args,
      ref
    });
  };
}

// mockups/voice/before/source/Dither.tsx
var import_jsx_runtime4 = __toESM(require_jsx_runtime(), 1);
var waveVertexShader = `
precision highp float;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 modelPosition = modelMatrix * vec4(position, 1.0);
  vec4 viewPosition = viewMatrix * modelPosition;
  gl_Position = projectionMatrix * viewPosition;
}
`;
var waveFragmentShader = `
precision highp float;
uniform vec2 resolution;
uniform float time;
uniform float waveSpeed;
uniform float waveFrequency;
uniform float waveAmplitude;
uniform vec3 waveColor;
uniform vec3 backgroundColor;
uniform vec2 mousePos;
uniform int enableMouseInteraction;
uniform float mouseRadius;

vec4 mod289(vec4 x) { return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
vec2 fade(vec2 t) { return t*t*t*(t*(t*6.0-15.0)+10.0); }

float cnoise(vec2 P) {
  vec4 Pi = floor(P.xyxy) + vec4(0.0,0.0,1.0,1.0);
  vec4 Pf = fract(P.xyxy) - vec4(0.0,0.0,1.0,1.0);
  Pi = mod289(Pi);
  vec4 ix = Pi.xzxz;
  vec4 iy = Pi.yyww;
  vec4 fx = Pf.xzxz;
  vec4 fy = Pf.yyww;
  vec4 i = permute(permute(ix) + iy);
  vec4 gx = fract(i * (1.0/41.0)) * 2.0 - 1.0;
  vec4 gy = abs(gx) - 0.5;
  vec4 tx = floor(gx + 0.5);
  gx = gx - tx;
  vec2 g00 = vec2(gx.x, gy.x);
  vec2 g10 = vec2(gx.y, gy.y);
  vec2 g01 = vec2(gx.z, gy.z);
  vec2 g11 = vec2(gx.w, gy.w);
  vec4 norm = taylorInvSqrt(vec4(dot(g00,g00), dot(g01,g01), dot(g10,g10), dot(g11,g11)));
  g00 *= norm.x; g01 *= norm.y; g10 *= norm.z; g11 *= norm.w;
  float n00 = dot(g00, vec2(fx.x, fy.x));
  float n10 = dot(g10, vec2(fx.y, fy.y));
  float n01 = dot(g01, vec2(fx.z, fy.z));
  float n11 = dot(g11, vec2(fx.w, fy.w));
  vec2 fade_xy = fade(Pf.xy);
  vec2 n_x = mix(vec2(n00, n01), vec2(n10, n11), fade_xy.x);
  return 2.3 * mix(n_x.x, n_x.y, fade_xy.y);
}

const int OCTAVES = 4;
float fbm(vec2 p) {
  float value = 0.0;
  float amp = 1.0;
  float freq = waveFrequency;
  for (int i = 0; i < OCTAVES; i++) {
    value += amp * abs(cnoise(p));
    p *= freq;
    amp *= waveAmplitude;
  }
  return value;
}

float pattern(vec2 p) {
  vec2 p2 = p - time * waveSpeed;
  return fbm(p + fbm(p2));
}

void main() {
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  uv -= 0.5;
  uv.x *= resolution.x / resolution.y;
  float f = pattern(uv);
  if (enableMouseInteraction == 1) {
    vec2 mouseNDC = (mousePos / resolution - 0.5) * vec2(1.0, -1.0);
    mouseNDC.x *= resolution.x / resolution.y;
    float dist = length(uv - mouseNDC);
    float effect = 1.0 - smoothstep(0.0, mouseRadius, dist);
    f -= 0.5 * effect;
  }
  vec3 col = mix(backgroundColor, waveColor, clamp(f, 0.0, 1.0));
  gl_FragColor = vec4(col, 1.0);
}
`;
var ditherFragmentShader = `
precision highp float;
uniform float colorNum;
uniform float pixelSize;
const float bayerMatrix8x8[64] = float[64](
  0.0/64.0, 48.0/64.0, 12.0/64.0, 60.0/64.0,  3.0/64.0, 51.0/64.0, 15.0/64.0, 63.0/64.0,
  32.0/64.0,16.0/64.0, 44.0/64.0, 28.0/64.0, 35.0/64.0,19.0/64.0, 47.0/64.0, 31.0/64.0,
  8.0/64.0, 56.0/64.0,  4.0/64.0, 52.0/64.0, 11.0/64.0,59.0/64.0,  7.0/64.0, 55.0/64.0,
  40.0/64.0,24.0/64.0, 36.0/64.0, 20.0/64.0, 43.0/64.0,27.0/64.0, 39.0/64.0, 23.0/64.0,
  2.0/64.0, 50.0/64.0, 14.0/64.0, 62.0/64.0,  1.0/64.0,49.0/64.0, 13.0/64.0, 61.0/64.0,
  34.0/64.0,18.0/64.0, 46.0/64.0, 30.0/64.0, 33.0/64.0,17.0/64.0, 45.0/64.0, 29.0/64.0,
  10.0/64.0,58.0/64.0,  6.0/64.0, 54.0/64.0,  9.0/64.0,57.0/64.0,  5.0/64.0, 53.0/64.0,
  42.0/64.0,26.0/64.0, 38.0/64.0, 22.0/64.0, 41.0/64.0,25.0/64.0, 37.0/64.0, 21.0/64.0
);

vec3 dither(vec2 uv, vec3 color) {
  vec2 scaledCoord = floor(uv * resolution / pixelSize);
  int x = int(mod(scaledCoord.x, 8.0));
  int y = int(mod(scaledCoord.y, 8.0));
  float threshold = bayerMatrix8x8[y * 8 + x] - 0.25;
  float step = 1.0 / (colorNum - 1.0);
  color += threshold * step;
  float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
  float bias = mix(0.2, 0.0, smoothstep(0.45, 0.8, luminance));
  color = clamp(color - bias, 0.0, 1.0);
  return floor(color * (colorNum - 1.0) + 0.5) / (colorNum - 1.0);
}

void mainImage(in vec4 inputColor, in vec2 uv, out vec4 outputColor) {
  vec2 normalizedPixelSize = pixelSize / resolution;
  vec2 uvPixel = normalizedPixelSize * floor(uv / normalizedPixelSize);
  vec4 color = texture2D(inputBuffer, uvPixel);
  color.rgb = dither(uv, color.rgb);
  outputColor = color;
}
`;
var RetroEffectImpl = class extends Effect {
  colorNumUniform;
  pixelSizeUniform;
  // `wrapEffect` types its props from this first constructor argument; the
  // setters below apply later changes.
  constructor({ colorNum: initialColors = 4, pixelSize: initialPixel = 2 } = {}) {
    const colorNum = new Uniform(initialColors);
    const pixelSize = new Uniform(initialPixel);
    super("RetroEffect", ditherFragmentShader, {
      uniforms: /* @__PURE__ */ new Map([
        ["colorNum", colorNum],
        ["pixelSize", pixelSize]
      ])
    });
    this.colorNumUniform = colorNum;
    this.pixelSizeUniform = pixelSize;
  }
  set colorNum(value) {
    this.colorNumUniform.value = value;
  }
  get colorNum() {
    return this.colorNumUniform.value;
  }
  set pixelSize(value) {
    this.pixelSizeUniform.value = value;
  }
  get pixelSize() {
    return this.pixelSizeUniform.value;
  }
};
var WrappedRetroEffect = wrapEffect(RetroEffectImpl);
var RetroEffect = (0, import_react6.forwardRef)(
  function RetroEffect2({ colorNum, pixelSize }, ref) {
    return /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(WrappedRetroEffect, { ref, colorNum, pixelSize });
  }
);
function sameRgb(a, b2) {
  return a.length === 3 && a.every((v2, i3) => v2 === b2[i3]);
}
function DitheredWaves({
  waveSpeed,
  waveFrequency,
  waveAmplitude,
  waveColor,
  backgroundColor,
  colorNum,
  pixelSize,
  disableAnimation,
  enableMouseInteraction,
  mouseRadius
}) {
  const mouse = (0, import_react6.useRef)(new Vector2());
  const { viewport, size, gl } = useThree();
  const [initialUniforms] = (0, import_react6.useState)(() => ({
    time: new Uniform(0),
    resolution: new Uniform(new Vector2(0, 0)),
    waveSpeed: new Uniform(waveSpeed),
    waveFrequency: new Uniform(waveFrequency),
    waveAmplitude: new Uniform(waveAmplitude),
    waveColor: new Uniform(new Color(...waveColor)),
    backgroundColor: new Uniform(new Color(...backgroundColor)),
    mousePos: new Uniform(new Vector2(0, 0)),
    enableMouseInteraction: new Uniform(enableMouseInteraction ? 1 : 0),
    mouseRadius: new Uniform(mouseRadius)
  }));
  const material = (0, import_react6.useRef)(null);
  const waves = () => material.current?.uniforms ?? null;
  const prevWave = (0, import_react6.useRef)([...waveColor]);
  const prevBackground = (0, import_react6.useRef)([...backgroundColor]);
  useFrame(({ clock }) => {
    const uniforms = waves();
    if (!uniforms) return;
    const dpr = gl.getPixelRatio();
    uniforms.resolution.value.set(Math.floor(size.width * dpr), Math.floor(size.height * dpr));
    if (!disableAnimation) uniforms.time.value = clock.getElapsedTime();
    uniforms.waveSpeed.value = waveSpeed;
    uniforms.waveFrequency.value = waveFrequency;
    uniforms.waveAmplitude.value = waveAmplitude;
    if (!sameRgb(prevWave.current, waveColor)) {
      uniforms.waveColor.value.setRGB(...waveColor);
      prevWave.current = [...waveColor];
    }
    if (!sameRgb(prevBackground.current, backgroundColor)) {
      uniforms.backgroundColor.value.setRGB(...backgroundColor);
      prevBackground.current = [...backgroundColor];
    }
    uniforms.enableMouseInteraction.value = enableMouseInteraction ? 1 : 0;
    uniforms.mouseRadius.value = mouseRadius;
    if (enableMouseInteraction) uniforms.mousePos.value.copy(mouse.current);
  });
  const handlePointerMove = (e2) => {
    if (!enableMouseInteraction) return;
    const canvas = gl.domElement;
    const rect = canvas.getBoundingClientRect();
    const scale = rect.width > 0 ? canvas.offsetWidth / rect.width : 1;
    const dpr = gl.getPixelRatio();
    mouse.current.set((e2.clientX - rect.left) * scale * dpr, (e2.clientY - rect.top) * scale * dpr);
  };
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(import_jsx_runtime4.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("mesh", { scale: [viewport.width, viewport.height, 1], children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("planeGeometry", { args: [1, 1] }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
        "shaderMaterial",
        {
          vertexShader: waveVertexShader,
          fragmentShader: waveFragmentShader,
          ref: material,
          uniforms: initialUniforms
        }
      )
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(EffectComposer2, { children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(RetroEffect, { colorNum, pixelSize }) }),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(
      "mesh",
      {
        onPointerMove: handlePointerMove,
        position: [0, 0, 0.01],
        scale: [viewport.width, viewport.height, 1],
        visible: false,
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("planeGeometry", { args: [1, 1] }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("meshBasicMaterial", { transparent: true, opacity: 0 })
        ]
      }
    )
  ] });
}
function Dither({
  waveSpeed = 0.05,
  waveFrequency = 3,
  waveAmplitude = 0.3,
  waveColor = [0.5, 0.5, 0.5],
  backgroundColor = [0, 0, 0],
  colorNum = 4,
  pixelSize = 2,
  disableAnimation = false,
  enableMouseInteraction = true,
  mouseRadius = 1,
  frameloop = "always",
  eventSource
}) {
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
    Canvas,
    {
      className: "dither-canvas",
      camera: { position: [0, 0, 6] },
      dpr: 1,
      frameloop,
      resize: { offsetSize: true },
      gl: { antialias: true, preserveDrawingBuffer: true },
      ...eventSource ? { eventSource, eventPrefix: "client" } : {},
      children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
        DitheredWaves,
        {
          waveSpeed,
          waveFrequency,
          waveAmplitude,
          waveColor,
          backgroundColor,
          colorNum,
          pixelSize,
          disableAnimation,
          enableMouseInteraction,
          mouseRadius
        }
      )
    }
  );
}
export {
  Dither
};
/*! Bundled license information:

use-sync-external-store/cjs/use-sync-external-store-shim.development.js:
  (**
   * @license React
   * use-sync-external-store-shim.development.js
   *
   * Copyright (c) Meta Platforms, Inc. and affiliates.
   *
   * This source code is licensed under the MIT license found in the
   * LICENSE file in the root directory of this source tree.
   *)

use-sync-external-store/cjs/use-sync-external-store-shim/with-selector.development.js:
  (**
   * @license React
   * use-sync-external-store-shim/with-selector.development.js
   *
   * Copyright (c) Meta Platforms, Inc. and affiliates.
   *
   * This source code is licensed under the MIT license found in the
   * LICENSE file in the root directory of this source tree.
   *)

@react-three/fiber/dist/events-9ce18a08.esm.js:
  (**
   * @license React
   * react-reconciler-constants.production.js
   *
   * Copyright (c) Meta Platforms, Inc. and affiliates.
   *
   * This source code is licensed under the MIT license found in the
   * LICENSE file in the root directory of this source tree.
   *)
  (**
  * @license React
  * react-reconciler.production.js
  *
  * Copyright (c) Meta Platforms, Inc. and affiliates.
  *
  * This source code is licensed under the MIT license found in the
  * LICENSE file in the root directory of this source tree.
  *)

@react-three/fiber/dist/events-9ce18a08.esm.js:
  (**
  * @license React
  * react-reconciler.development.js
  *
  * Copyright (c) Meta Platforms, Inc. and affiliates.
  *
  * This source code is licensed under the MIT license found in the
  * LICENSE file in the root directory of this source tree.
  *)

postprocessing/build/index.js:
  (**
   * postprocessing v6.39.5 build Wed Sep 09 2026
   * https://github.com/pmndrs/postprocessing
   * Copyright 2015-2026 Raoul van Rüschen
   * @license Zlib
   *)
*/
