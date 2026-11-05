import {
  __commonJS,
  __toESM,
  require_react
} from "./chunk-7HJLIOEM.js";

// node_modules/.pnpm/react-dom@19.3.0_react@19.3.0/node_modules/react-dom/cjs/react-dom.development.js
var require_react_dom_development = __commonJS({
  "node_modules/.pnpm/react-dom@19.3.0_react@19.3.0/node_modules/react-dom/cjs/react-dom.development.js"(exports) {
    "use strict";
    (function() {
      function noop() {
      }
      function testStringCoercion(value) {
        return "" + value;
      }
      function createPortal$1(children, containerInfo, implementation) {
        var key = 3 < arguments.length && void 0 !== arguments[3] ? arguments[3] : null;
        if (null == key) key = null;
        else if (key === REACT_OPTIMISTIC_KEY) key = REACT_OPTIMISTIC_KEY;
        else {
          try {
            testStringCoercion(key);
            var JSCompiler_inline_result = false;
          } catch (e34) {
            JSCompiler_inline_result = true;
          }
          JSCompiler_inline_result && (console.error(
            "The provided key is an unsupported type %s. This value must be coerced to a string before using it here.",
            "function" === typeof Symbol && Symbol.toStringTag && key[Symbol.toStringTag] || key.constructor.name || "Object"
          ), testStringCoercion(key));
          key = "" + key;
        }
        return {
          $$typeof: REACT_PORTAL_TYPE,
          key,
          children,
          containerInfo,
          implementation
        };
      }
      function getCrossOriginStringAs(as, input) {
        if ("font" === as) return "";
        if ("string" === typeof input)
          return "use-credentials" === input ? input : "";
      }
      function getValueDescriptorExpectingObjectForWarning(thing) {
        return null === thing ? "`null`" : void 0 === thing ? "`undefined`" : "" === thing ? "an empty string" : 'something with type "' + typeof thing + '"';
      }
      function getValueDescriptorExpectingEnumForWarning(thing) {
        return null === thing ? "`null`" : void 0 === thing ? "`undefined`" : "" === thing ? "an empty string" : "string" === typeof thing ? JSON.stringify(thing) : "number" === typeof thing ? "`" + thing + "`" : 'something with type "' + typeof thing + '"';
      }
      function resolveDispatcher() {
        var dispatcher = ReactSharedInternals.H;
        null === dispatcher && console.error(
          "Invalid hook call. Hooks can only be called inside of the body of a function component. This could happen for one of the following reasons:\n1. You might have mismatching versions of React and the renderer (such as React DOM)\n2. You might be breaking the Rules of Hooks\n3. You might have more than one copy of React in the same app\nSee https://react.dev/link/invalid-hook-call for tips about how to debug and fix this problem."
        );
        return dispatcher;
      }
      "undefined" !== typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ && "function" === typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.registerInternalModuleStart && __REACT_DEVTOOLS_GLOBAL_HOOK__.registerInternalModuleStart(Error());
      var React = require_react(), Internals = {
        d: {
          f: noop,
          r: function() {
            throw Error(
              "Invalid form element. requestFormReset must be passed a form that was rendered by React."
            );
          },
          D: noop,
          C: noop,
          L: noop,
          m: noop,
          X: noop,
          S: noop,
          M: noop
        },
        p: 0,
        findDOMNode: null
      }, REACT_PORTAL_TYPE = /* @__PURE__ */ Symbol.for("react.portal"), REACT_RECOVERABLE_TYPE = /* @__PURE__ */ Symbol.for("react.recoverable"), REACT_OPTIMISTIC_KEY = /* @__PURE__ */ Symbol.for("react.optimistic_key"), ReactSharedInternals = React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
      "function" === typeof Map && null != Map.prototype && "function" === typeof Map.prototype.forEach && "function" === typeof Set && null != Set.prototype && "function" === typeof Set.prototype.clear && "function" === typeof Set.prototype.forEach || console.error(
        "React depends on Map and Set built-in types. Make sure that you load a polyfill in older browsers. https://reactjs.org/link/react-polyfills"
      );
      exports.__DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE = Internals;
      exports.browser = function(reason) {
        return { $$typeof: REACT_RECOVERABLE_TYPE, _reason: reason };
      };
      exports.createPortal = function(children, container) {
        var key = 2 < arguments.length && void 0 !== arguments[2] ? arguments[2] : null;
        if (!container || 1 !== container.nodeType && 9 !== container.nodeType && 11 !== container.nodeType)
          throw Error("Target container is not a DOM element.");
        return createPortal$1(children, container, null, key);
      };
      exports.flushSync = function(fn) {
        var previousTransition = ReactSharedInternals.T, previousUpdatePriority = Internals.p;
        try {
          if (ReactSharedInternals.T = null, Internals.p = 2, fn)
            return fn();
        } finally {
          ReactSharedInternals.T = previousTransition, Internals.p = previousUpdatePriority, Internals.d.f() && console.error(
            "flushSync was called from inside a lifecycle method. React cannot flush when React is already rendering. Consider moving this call to a scheduler task or micro task."
          );
        }
      };
      exports.preconnect = function(href, options) {
        "string" === typeof href && href ? null != options && "object" !== typeof options ? console.error(
          "ReactDOM.preconnect(): Expected the `options` argument (second) to be an object but encountered %s instead. The only supported option at this time is `crossOrigin` which accepts a string.",
          getValueDescriptorExpectingEnumForWarning(options)
        ) : null != options && "string" !== typeof options.crossOrigin && console.error(
          "ReactDOM.preconnect(): Expected the `crossOrigin` option (second argument) to be a string but encountered %s instead. Try removing this option or passing a string value instead.",
          getValueDescriptorExpectingObjectForWarning(options.crossOrigin)
        ) : console.error(
          "ReactDOM.preconnect(): Expected the `href` argument (first) to be a non-empty string but encountered %s instead.",
          getValueDescriptorExpectingObjectForWarning(href)
        );
        "string" === typeof href && (options ? (options = options.crossOrigin, options = "string" === typeof options ? "use-credentials" === options ? options : "" : void 0) : options = null, Internals.d.C(href, options));
      };
      exports.prefetchDNS = function(href) {
        if ("string" !== typeof href || !href)
          console.error(
            "ReactDOM.prefetchDNS(): Expected the `href` argument (first) to be a non-empty string but encountered %s instead.",
            getValueDescriptorExpectingObjectForWarning(href)
          );
        else if (1 < arguments.length) {
          var options = arguments[1];
          "object" === typeof options && options.hasOwnProperty("crossOrigin") ? console.error(
            "ReactDOM.prefetchDNS(): Expected only one argument, `href`, but encountered %s as a second argument instead. This argument is reserved for future options and is currently disallowed. It looks like the you are attempting to set a crossOrigin property for this DNS lookup hint. Browsers do not perform DNS queries using CORS and setting this attribute on the resource hint has no effect. Try calling ReactDOM.prefetchDNS() with just a single string argument, `href`.",
            getValueDescriptorExpectingEnumForWarning(options)
          ) : console.error(
            "ReactDOM.prefetchDNS(): Expected only one argument, `href`, but encountered %s as a second argument instead. This argument is reserved for future options and is currently disallowed. Try calling ReactDOM.prefetchDNS() with just a single string argument, `href`.",
            getValueDescriptorExpectingEnumForWarning(options)
          );
        }
        "string" === typeof href && Internals.d.D(href);
      };
      exports.preinit = function(href, options) {
        "string" === typeof href && href ? null == options || "object" !== typeof options ? console.error(
          "ReactDOM.preinit(): Expected the `options` argument (second) to be an object with an `as` property describing the type of resource to be preinitialized but encountered %s instead.",
          getValueDescriptorExpectingEnumForWarning(options)
        ) : "style" !== options.as && "script" !== options.as && console.error(
          'ReactDOM.preinit(): Expected the `as` property in the `options` argument (second) to contain a valid value describing the type of resource to be preinitialized but encountered %s instead. Valid values for `as` are "style" and "script".',
          getValueDescriptorExpectingEnumForWarning(options.as)
        ) : console.error(
          "ReactDOM.preinit(): Expected the `href` argument (first) to be a non-empty string but encountered %s instead.",
          getValueDescriptorExpectingObjectForWarning(href)
        );
        if ("string" === typeof href && options && "string" === typeof options.as) {
          var as = options.as, crossOrigin = getCrossOriginStringAs(as, options.crossOrigin), integrity = "string" === typeof options.integrity ? options.integrity : void 0, fetchPriority = "string" === typeof options.fetchPriority ? options.fetchPriority : void 0;
          "style" === as ? Internals.d.S(
            href,
            "string" === typeof options.precedence ? options.precedence : void 0,
            {
              crossOrigin,
              integrity,
              fetchPriority
            }
          ) : "script" === as && Internals.d.X(href, {
            crossOrigin,
            integrity,
            fetchPriority,
            nonce: "string" === typeof options.nonce ? options.nonce : void 0
          });
        }
      };
      exports.preinitModule = function(href, options) {
        var encountered = "";
        "string" === typeof href && href || (encountered += " The `href` argument encountered was " + getValueDescriptorExpectingObjectForWarning(href) + ".");
        void 0 !== options && "object" !== typeof options ? encountered += " The `options` argument encountered was " + getValueDescriptorExpectingObjectForWarning(options) + "." : options && "as" in options && "script" !== options.as && (encountered += " The `as` option encountered was " + getValueDescriptorExpectingEnumForWarning(options.as) + ".");
        if (encountered)
          console.error(
            "ReactDOM.preinitModule(): Expected up to two arguments, a non-empty `href` string and, optionally, an `options` object with a valid `as` property.%s",
            encountered
          );
        else
          switch (encountered = options && "string" === typeof options.as ? options.as : "script", encountered) {
            case "script":
              break;
            default:
              encountered = getValueDescriptorExpectingEnumForWarning(encountered), console.error(
                'ReactDOM.preinitModule(): Currently the only supported "as" type for this function is "script" but received "%s" instead. This warning was generated for `href` "%s". In the future other module types will be supported, aligning with the import-attributes proposal. Learn more here: (https://github.com/tc39/proposal-import-attributes)',
                encountered,
                href
              );
          }
        if ("string" === typeof href)
          if ("object" === typeof options && null !== options) {
            if (null == options.as || "script" === options.as)
              encountered = getCrossOriginStringAs(
                options.as,
                options.crossOrigin
              ), Internals.d.M(href, {
                crossOrigin: encountered,
                integrity: "string" === typeof options.integrity ? options.integrity : void 0,
                nonce: "string" === typeof options.nonce ? options.nonce : void 0,
                fetchPriority: "string" === typeof options.fetchPriority ? options.fetchPriority : void 0
              });
          } else null == options && Internals.d.M(href);
      };
      exports.preload = function(href, options) {
        var encountered = "";
        "string" === typeof href && href || (encountered += " The `href` argument encountered was " + getValueDescriptorExpectingObjectForWarning(href) + ".");
        null == options || "object" !== typeof options ? encountered += " The `options` argument encountered was " + getValueDescriptorExpectingObjectForWarning(options) + "." : "string" === typeof options.as && options.as || (encountered += " The `as` option encountered was " + getValueDescriptorExpectingObjectForWarning(options.as) + ".");
        encountered && console.error(
          'ReactDOM.preload(): Expected two arguments, a non-empty `href` string and an `options` object with an `as` property valid for a `<link rel="preload" as="..." />` tag.%s',
          encountered
        );
        if ("string" === typeof href && "object" === typeof options && null !== options && "string" === typeof options.as) {
          encountered = options.as;
          var crossOrigin = getCrossOriginStringAs(
            encountered,
            options.crossOrigin
          );
          Internals.d.L(href, encountered, {
            crossOrigin,
            integrity: "string" === typeof options.integrity ? options.integrity : void 0,
            nonce: "string" === typeof options.nonce ? options.nonce : void 0,
            type: "string" === typeof options.type ? options.type : void 0,
            fetchPriority: "string" === typeof options.fetchPriority ? options.fetchPriority : void 0,
            referrerPolicy: "string" === typeof options.referrerPolicy ? options.referrerPolicy : void 0,
            imageSrcSet: "string" === typeof options.imageSrcSet ? options.imageSrcSet : void 0,
            imageSizes: "string" === typeof options.imageSizes ? options.imageSizes : void 0,
            media: "string" === typeof options.media ? options.media : void 0
          });
        }
      };
      exports.preloadModule = function(href, options) {
        var encountered = "";
        "string" === typeof href && href || (encountered += " The `href` argument encountered was " + getValueDescriptorExpectingObjectForWarning(href) + ".");
        void 0 !== options && "object" !== typeof options ? encountered += " The `options` argument encountered was " + getValueDescriptorExpectingObjectForWarning(options) + "." : options && "as" in options && "string" !== typeof options.as && (encountered += " The `as` option encountered was " + getValueDescriptorExpectingObjectForWarning(options.as) + ".");
        encountered && console.error(
          'ReactDOM.preloadModule(): Expected two arguments, a non-empty `href` string and, optionally, an `options` object with an `as` property valid for a `<link rel="modulepreload" as="..." />` tag.%s',
          encountered
        );
        "string" === typeof href && (options ? (encountered = getCrossOriginStringAs(
          options.as,
          options.crossOrigin
        ), Internals.d.m(href, {
          as: "string" === typeof options.as && "script" !== options.as ? options.as : void 0,
          crossOrigin: encountered,
          integrity: "string" === typeof options.integrity ? options.integrity : void 0,
          nonce: "string" === typeof options.nonce ? options.nonce : void 0,
          fetchPriority: "string" === typeof options.fetchPriority ? options.fetchPriority : void 0
        })) : Internals.d.m(href));
      };
      exports.requestFormReset = function(form) {
        Internals.d.r(form);
      };
      exports.unstable_batchedUpdates = function(fn, a22) {
        return fn(a22);
      };
      exports.useFormState = function(action, initialState, permalink) {
        return resolveDispatcher().useFormState(action, initialState, permalink);
      };
      exports.useFormStatus = function() {
        return resolveDispatcher().useHostTransitionStatus();
      };
      exports.version = "19.3.0";
      "undefined" !== typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ && "function" === typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.registerInternalModuleStop && __REACT_DEVTOOLS_GLOBAL_HOOK__.registerInternalModuleStop(Error());
    })();
  }
});

// node_modules/.pnpm/react-dom@19.3.0_react@19.3.0/node_modules/react-dom/index.js
var require_react_dom = __commonJS({
  "node_modules/.pnpm/react-dom@19.3.0_react@19.3.0/node_modules/react-dom/index.js"(exports, module) {
    "use strict";
    if (false) {
      checkDCE();
      module.exports = null;
    } else {
      module.exports = require_react_dom_development();
    }
  }
});

// node_modules/.pnpm/@phosphor-icons+react@2.1.10_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/@phosphor-icons/react/dist/csr/Brain.es.js
var o2 = __toESM(require_react(), 1);

// node_modules/.pnpm/@phosphor-icons+react@2.1.10_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/@phosphor-icons/react/dist/lib/IconBase.es.js
var e = __toESM(require_react(), 1);

// node_modules/.pnpm/@phosphor-icons+react@2.1.10_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/@phosphor-icons/react/dist/lib/context.es.js
var import_react = __toESM(require_react(), 1);
var o = (0, import_react.createContext)({
  color: "currentColor",
  size: "1em",
  weight: "regular",
  mirrored: false
});

// node_modules/.pnpm/@phosphor-icons+react@2.1.10_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/@phosphor-icons/react/dist/lib/IconBase.es.js
var p = e.forwardRef(
  (s4, a22) => {
    const {
      alt: n9,
      color: r7,
      size: t2,
      weight: o20,
      mirrored: c3,
      children: i3,
      weights: m7,
      ...x
    } = s4, {
      color: d = "currentColor",
      size: l3,
      weight: f = "regular",
      mirrored: g = false,
      ...w
    } = e.useContext(o);
    return /* @__PURE__ */ e.createElement(
      "svg",
      {
        ref: a22,
        xmlns: "http://www.w3.org/2000/svg",
        width: t2 != null ? t2 : l3,
        height: t2 != null ? t2 : l3,
        fill: r7 != null ? r7 : d,
        viewBox: "0 0 256 256",
        transform: c3 || g ? "scale(-1, 1)" : void 0,
        ...w,
        ...x
      },
      !!n9 && /* @__PURE__ */ e.createElement("title", null, n9),
      i3,
      m7.get(o20 != null ? o20 : f)
    );
  }
);
p.displayName = "IconBase";

// node_modules/.pnpm/@phosphor-icons+react@2.1.10_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/@phosphor-icons/react/dist/defs/Brain.es.js
var a = __toESM(require_react(), 1);
var e2 = /* @__PURE__ */ new Map([
  [
    "bold",
    /* @__PURE__ */ a.createElement(a.Fragment, null, /* @__PURE__ */ a.createElement("path", { d: "M252,124a60.14,60.14,0,0,0-32-53.08,52,52,0,0,0-92-32.11A52,52,0,0,0,36,70.92a60,60,0,0,0,0,106.14,52,52,0,0,0,92,32.13,52,52,0,0,0,92-32.13A60.05,60.05,0,0,0,252,124ZM88,204a28,28,0,0,1-26.85-20.07c1,0,1.89.07,2.85.07h8a12,12,0,0,0,0-24H64A36,36,0,0,1,52,90.05a12,12,0,0,0,8-11.32V72a28,28,0,0,1,56,0v60.18a51.61,51.61,0,0,0-7.2-3.85,12,12,0,1,0-9.6,22A28,28,0,0,1,88,204Zm104-44h-8a12,12,0,0,0,0,24h8c1,0,1.9,0,2.85-.07a28,28,0,1,1-38-33.61,12,12,0,1,0-9.6-22,51.61,51.61,0,0,0-7.2,3.85V72a28,28,0,0,1,56,0v6.73a12,12,0,0,0,8,11.32,36,36,0,0,1-12,70Zm16-44a12,12,0,0,1-12,12,40,40,0,0,1-40-40V84a12,12,0,0,1,24,0v4a16,16,0,0,0,16,16A12,12,0,0,1,208,116ZM100,88a40,40,0,0,1-40,40,12,12,0,0,1,0-24A16,16,0,0,0,76,88V84a12,12,0,0,1,24,0Z" }))
  ],
  [
    "duotone",
    /* @__PURE__ */ a.createElement(a.Fragment, null, /* @__PURE__ */ a.createElement(
      "path",
      {
        d: "M240,124a48,48,0,0,1-32,45.27h0V176a40,40,0,0,1-80,0,40,40,0,0,1-80,0v-6.73h0a48,48,0,0,1,0-90.54V72a40,40,0,0,1,80,0,40,40,0,0,1,80,0v6.73A48,48,0,0,1,240,124Z",
        opacity: "0.2"
      }
    ), /* @__PURE__ */ a.createElement("path", { d: "M248,124a56.11,56.11,0,0,0-32-50.61V72a48,48,0,0,0-88-26.49A48,48,0,0,0,40,72v1.39a56,56,0,0,0,0,101.2V176a48,48,0,0,0,88,26.49A48,48,0,0,0,216,176v-1.41A56.09,56.09,0,0,0,248,124ZM88,208a32,32,0,0,1-31.81-28.56A55.87,55.87,0,0,0,64,180h8a8,8,0,0,0,0-16H64A40,40,0,0,1,50.67,86.27,8,8,0,0,0,56,78.73V72a32,32,0,0,1,64,0v68.26A47.8,47.8,0,0,0,88,128a8,8,0,0,0,0,16,32,32,0,0,1,0,64Zm104-44h-8a8,8,0,0,0,0,16h8a55.87,55.87,0,0,0,7.81-.56A32,32,0,1,1,168,144a8,8,0,0,0,0-16,47.8,47.8,0,0,0-32,12.26V72a32,32,0,0,1,64,0v6.73a8,8,0,0,0,5.33,7.54A40,40,0,0,1,192,164Zm16-52a8,8,0,0,1-8,8h-4a36,36,0,0,1-36-36V80a8,8,0,0,1,16,0v4a20,20,0,0,0,20,20h4A8,8,0,0,1,208,112ZM60,120H56a8,8,0,0,1,0-16h4A20,20,0,0,0,80,84V80a8,8,0,0,1,16,0v4A36,36,0,0,1,60,120Z" }))
  ],
  [
    "fill",
    /* @__PURE__ */ a.createElement(a.Fragment, null, /* @__PURE__ */ a.createElement("path", { d: "M212,76V72a44,44,0,0,0-74.86-31.31,3.93,3.93,0,0,0-1.14,2.8v88.72a4,4,0,0,0,6.2,3.33A47.67,47.67,0,0,1,167.68,128a8.18,8.18,0,0,1,8.31,7.58,8,8,0,0,1-8,8.42,32,32,0,0,0-32,32v33.88a4,4,0,0,0,1.49,3.12,47.92,47.92,0,0,0,74.21-17.16,4,4,0,0,0-4.49-5.56A68.06,68.06,0,0,1,192,192h-7.73a8.18,8.18,0,0,1-8.25-7.47,8,8,0,0,1,8-8.53h8a51.6,51.6,0,0,0,24-5.88v0A52,52,0,0,0,212,76Zm-12,36h-4a36,36,0,0,1-36-36V72a8,8,0,0,1,16,0v4a20,20,0,0,0,20,20h4a8,8,0,0,1,0,16ZM88,28A44.05,44.05,0,0,0,44,72v4a52,52,0,0,0-4,94.12h0A51.6,51.6,0,0,0,64,176h7.73A8.18,8.18,0,0,1,80,183.47,8,8,0,0,1,72,192H64a67.48,67.48,0,0,1-15.21-1.73,4,4,0,0,0-4.5,5.55A47.93,47.93,0,0,0,118.51,213a4,4,0,0,0,1.49-3.12V176a32,32,0,0,0-32-32,8,8,0,0,1-8-8.42A8.18,8.18,0,0,1,88.32,128a47.67,47.67,0,0,1,25.48,7.54,4,4,0,0,0,6.2-3.33V43.49a4,4,0,0,0-1.14-2.81A43.85,43.85,0,0,0,88,28Zm8,48a36,36,0,0,1-36,36H56a8,8,0,0,1,0-16h4A20,20,0,0,0,80,76V72a8,8,0,0,1,16,0Z" }))
  ],
  [
    "light",
    /* @__PURE__ */ a.createElement(a.Fragment, null, /* @__PURE__ */ a.createElement("path", { d: "M246,124a54.13,54.13,0,0,0-32-49.33V72a46,46,0,0,0-86-22.67A46,46,0,0,0,42,72v2.67a54,54,0,0,0,0,98.63V176a46,46,0,0,0,86,22.67A46,46,0,0,0,214,176v-2.7A54.07,54.07,0,0,0,246,124ZM88,210a34,34,0,0,1-34-32.94A53.67,53.67,0,0,0,64,178h8a6,6,0,0,0,0-12H64A42,42,0,0,1,50,84.39a6,6,0,0,0,4-5.66V72a34,34,0,0,1,68,0v73.05A45.89,45.89,0,0,0,88,130a6,6,0,0,0,0,12,34,34,0,0,1,0,68Zm104-44h-8a6,6,0,0,0,0,12h8a53.67,53.67,0,0,0,10-.94A34,34,0,1,1,168,142a6,6,0,0,0,0-12,45.89,45.89,0,0,0-34,15.05V72a34,34,0,0,1,68,0v6.73a6,6,0,0,0,4,5.66A42,42,0,0,1,192,166Zm14-54a6,6,0,0,1-6,6h-4a34,34,0,0,1-34-34V80a6,6,0,0,1,12,0v4a22,22,0,0,0,22,22h4A6,6,0,0,1,206,112ZM60,118H56a6,6,0,0,1,0-12h4A22,22,0,0,0,82,84V80a6,6,0,0,1,12,0v4A34,34,0,0,1,60,118Z" }))
  ],
  [
    "regular",
    /* @__PURE__ */ a.createElement(a.Fragment, null, /* @__PURE__ */ a.createElement("path", { d: "M248,124a56.11,56.11,0,0,0-32-50.61V72a48,48,0,0,0-88-26.49A48,48,0,0,0,40,72v1.39a56,56,0,0,0,0,101.2V176a48,48,0,0,0,88,26.49A48,48,0,0,0,216,176v-1.41A56.09,56.09,0,0,0,248,124ZM88,208a32,32,0,0,1-31.81-28.56A55.87,55.87,0,0,0,64,180h8a8,8,0,0,0,0-16H64A40,40,0,0,1,50.67,86.27,8,8,0,0,0,56,78.73V72a32,32,0,0,1,64,0v68.26A47.8,47.8,0,0,0,88,128a8,8,0,0,0,0,16,32,32,0,0,1,0,64Zm104-44h-8a8,8,0,0,0,0,16h8a55.87,55.87,0,0,0,7.81-.56A32,32,0,1,1,168,144a8,8,0,0,0,0-16,47.8,47.8,0,0,0-32,12.26V72a32,32,0,0,1,64,0v6.73a8,8,0,0,0,5.33,7.54A40,40,0,0,1,192,164Zm16-52a8,8,0,0,1-8,8h-4a36,36,0,0,1-36-36V80a8,8,0,0,1,16,0v4a20,20,0,0,0,20,20h4A8,8,0,0,1,208,112ZM60,120H56a8,8,0,0,1,0-16h4A20,20,0,0,0,80,84V80a8,8,0,0,1,16,0v4A36,36,0,0,1,60,120Z" }))
  ],
  [
    "thin",
    /* @__PURE__ */ a.createElement(a.Fragment, null, /* @__PURE__ */ a.createElement("path", { d: "M244,124a52.1,52.1,0,0,0-32-48V72a44,44,0,0,0-84-18.3A44,44,0,0,0,44,72v4a52,52,0,0,0,0,96v4a44,44,0,0,0,84,18.3A44,44,0,0,0,212,176v-4A52.07,52.07,0,0,0,244,124ZM88,212a36,36,0,0,1-36-36v-1.41A52.13,52.13,0,0,0,64,176h8a4,4,0,0,0,0-8H64A44,44,0,0,1,49.33,82.5,4,4,0,0,0,52,78.73V72a36,36,0,0,1,72,0v78.75A44,44,0,0,0,88,132a4,4,0,0,0,0,8,36,36,0,0,1,0,72Zm104-44h-8a4,4,0,0,0,0,8h8a52.13,52.13,0,0,0,12-1.41V176a36,36,0,1,1-36-36,4,4,0,0,0,0-8,44,44,0,0,0-36,18.75V72a36,36,0,0,1,72,0v6.73a4,4,0,0,0,2.67,3.77A44,44,0,0,1,192,168Zm12-56a4,4,0,0,1-4,4h-4a32,32,0,0,1-32-32V80a4,4,0,0,1,8,0v4a24,24,0,0,0,24,24h4A4,4,0,0,1,204,112ZM92,84a32,32,0,0,1-32,32H56a4,4,0,0,1,0-8h4A24,24,0,0,0,84,84V80a4,4,0,0,1,8,0Z" }))
  ]
]);

// node_modules/.pnpm/@phosphor-icons+react@2.1.10_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/@phosphor-icons/react/dist/csr/Brain.es.js
var r2 = o2.forwardRef((a22, e34) => /* @__PURE__ */ o2.createElement(p, { ref: e34, ...a22, weights: e2 }));
r2.displayName = "BrainIcon";

// node_modules/.pnpm/@phosphor-icons+react@2.1.10_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/@phosphor-icons/react/dist/csr/ChatsCircle.es.js
var e4 = __toESM(require_react(), 1);

// node_modules/.pnpm/@phosphor-icons+react@2.1.10_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/@phosphor-icons/react/dist/defs/ChatsCircle.es.js
var a2 = __toESM(require_react(), 1);
var e3 = /* @__PURE__ */ new Map([
  [
    "bold",
    /* @__PURE__ */ a2.createElement(a2.Fragment, null, /* @__PURE__ */ a2.createElement("path", { d: "M236.34,187.09A84,84,0,0,0,172.29,68.9,84,84,0,0,0,19.66,139.09l-6.84,23.26a20,20,0,0,0,24.83,24.83l23.26-6.84a83.94,83.94,0,0,0,22.76,6.74,84.06,84.06,0,0,0,111.42,41.26l23.26,6.84a20,20,0,0,0,24.83-24.83ZM62,155.5a11.88,11.88,0,0,0-3.39.49l-20.72,6.09L44,141.35a12,12,0,0,0-.93-9A60,60,0,1,1,67.7,156.92,12,12,0,0,0,62,155.5Zm150.89,24.8a12,12,0,0,0-.93,9l6.09,20.73L197.36,204a12,12,0,0,0-9.06.93A60,60,0,0,1,111,186.63a83.93,83.93,0,0,0,68.55-91.37,60,60,0,0,1,33.38,85Z" }))
  ],
  [
    "duotone",
    /* @__PURE__ */ a2.createElement(a2.Fragment, null, /* @__PURE__ */ a2.createElement(
      "path",
      {
        d: "M231.66,213.73a8,8,0,0,1-9.93,9.93L194,215.5A72.05,72.05,0,0,1,92.06,175.89h0c1.31.07,2.62.11,3.94.11a72,72,0,0,0,67.93-95.88h0A72,72,0,0,1,223.5,186Z",
        opacity: "0.2"
      }
    ), /* @__PURE__ */ a2.createElement("path", { d: "M232.07,186.76a80,80,0,0,0-62.5-114.17A80,80,0,1,0,23.93,138.76l-7.27,24.71a16,16,0,0,0,19.87,19.87l24.71-7.27a80.39,80.39,0,0,0,25.18,7.35,80,80,0,0,0,108.34,40.65l24.71,7.27a16,16,0,0,0,19.87-19.86ZM62,159.5a8.28,8.28,0,0,0-2.26.32L32,168l8.17-27.76a8,8,0,0,0-.63-6,64,64,0,1,1,26.26,26.26A8,8,0,0,0,62,159.5Zm153.79,28.73L224,216l-27.76-8.17a8,8,0,0,0-6,.63,64.05,64.05,0,0,1-85.87-24.88A79.93,79.93,0,0,0,174.7,89.71a64,64,0,0,1,41.75,92.48A8,8,0,0,0,215.82,188.23Z" }))
  ],
  [
    "fill",
    /* @__PURE__ */ a2.createElement(a2.Fragment, null, /* @__PURE__ */ a2.createElement("path", { d: "M232.07,186.76a80,80,0,0,0-62.5-114.17A80,80,0,1,0,23.93,138.76l-7.27,24.71a16,16,0,0,0,19.87,19.87l24.71-7.27a80.39,80.39,0,0,0,25.18,7.35,80,80,0,0,0,108.34,40.65l24.71,7.27a16,16,0,0,0,19.87-19.86Zm-16.25,1.47L224,216l-27.76-8.17a8,8,0,0,0-6,.63,64.05,64.05,0,0,1-85.87-24.88A79.93,79.93,0,0,0,174.7,89.71a64,64,0,0,1,41.75,92.48A8,8,0,0,0,215.82,188.23Z" }))
  ],
  [
    "light",
    /* @__PURE__ */ a2.createElement(a2.Fragment, null, /* @__PURE__ */ a2.createElement("path", { d: "M229.93,186.58A78,78,0,0,0,168.16,74.42,78,78,0,1,0,26.07,138.58L18.58,164A14,14,0,0,0,36,181.42l25.46-7.49a78,78,0,0,0,26.39,7.63,78,78,0,0,0,106.77,40.37L220,229.42A14,14,0,0,0,237.42,212ZM62,161.5a6.05,6.05,0,0,0-1.69.24l-27.77,8.17a2,2,0,0,1-2.48-2.48l8.17-27.77a6.05,6.05,0,0,0-.47-4.53,66,66,0,1,1,27.08,27.08A6,6,0,0,0,62,161.5Zm155.71,26.16,8.17,27.77a2,2,0,0,1-2.48,2.48l-27.77-8.17a6.06,6.06,0,0,0-4.53.47,66,66,0,0,1-90-28.4,77.92,77.92,0,0,0,71-94.68,66,66,0,0,1,46.07,96A6.05,6.05,0,0,0,217.74,187.66Z" }))
  ],
  [
    "regular",
    /* @__PURE__ */ a2.createElement(a2.Fragment, null, /* @__PURE__ */ a2.createElement("path", { d: "M232.07,186.76a80,80,0,0,0-62.5-114.17A80,80,0,1,0,23.93,138.76l-7.27,24.71a16,16,0,0,0,19.87,19.87l24.71-7.27a80.39,80.39,0,0,0,25.18,7.35,80,80,0,0,0,108.34,40.65l24.71,7.27a16,16,0,0,0,19.87-19.86ZM62,159.5a8.28,8.28,0,0,0-2.26.32L32,168l8.17-27.76a8,8,0,0,0-.63-6,64,64,0,1,1,26.26,26.26A8,8,0,0,0,62,159.5Zm153.79,28.73L224,216l-27.76-8.17a8,8,0,0,0-6,.63,64.05,64.05,0,0,1-85.87-24.88A79.93,79.93,0,0,0,174.7,89.71a64,64,0,0,1,41.75,92.48A8,8,0,0,0,215.82,188.23Z" }))
  ],
  [
    "thin",
    /* @__PURE__ */ a2.createElement(a2.Fragment, null, /* @__PURE__ */ a2.createElement("path", { d: "M227.79,186.39a76,76,0,0,0-61-110.07A76,76,0,1,0,28.21,138.39L20.5,164.6a12,12,0,0,0,14.9,14.9l26.21-7.71a75.93,75.93,0,0,0,27.6,7.9,76,76,0,0,0,105.18,40.1l26.21,7.71a12,12,0,0,0,14.9-14.9ZM60.9,163.66l-27.76,8.17a4,4,0,0,1-5-5l8.17-27.76a4.07,4.07,0,0,0-.31-3A68,68,0,1,1,63.92,164,4.06,4.06,0,0,0,60.9,163.66Zm165.92,55.16a4,4,0,0,1-4,1l-27.76-8.17a4.07,4.07,0,0,0-3,.31A68,68,0,0,1,98,180a76,76,0,0,0,71.5-95.28A68,68,0,0,1,220,184.08a4.07,4.07,0,0,0-.31,3l8.17,27.76A4,4,0,0,1,226.82,218.82Z" }))
  ]
]);

// node_modules/.pnpm/@phosphor-icons+react@2.1.10_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/@phosphor-icons/react/dist/csr/ChatsCircle.es.js
var o3 = e4.forwardRef((r7, t2) => /* @__PURE__ */ e4.createElement(p, { ref: t2, ...r7, weights: e3 }));
o3.displayName = "ChatsCircleIcon";

// node_modules/.pnpm/@phosphor-icons+react@2.1.10_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/@phosphor-icons/react/dist/csr/Code.es.js
var o4 = __toESM(require_react(), 1);

// node_modules/.pnpm/@phosphor-icons+react@2.1.10_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/@phosphor-icons/react/dist/defs/Code.es.js
var a3 = __toESM(require_react(), 1);
var l = /* @__PURE__ */ new Map([
  [
    "bold",
    /* @__PURE__ */ a3.createElement(a3.Fragment, null, /* @__PURE__ */ a3.createElement("path", { d: "M71.68,97.22,34.74,128l36.94,30.78a12,12,0,1,1-15.36,18.44l-48-40a12,12,0,0,1,0-18.44l48-40A12,12,0,0,1,71.68,97.22Zm176,21.56-48-40a12,12,0,1,0-15.36,18.44L221.26,128l-36.94,30.78a12,12,0,1,0,15.36,18.44l48-40a12,12,0,0,0,0-18.44ZM164.1,28.72a12,12,0,0,0-15.38,7.18l-64,176a12,12,0,0,0,7.18,15.37A11.79,11.79,0,0,0,96,228a12,12,0,0,0,11.28-7.9l64-176A12,12,0,0,0,164.1,28.72Z" }))
  ],
  [
    "duotone",
    /* @__PURE__ */ a3.createElement(a3.Fragment, null, /* @__PURE__ */ a3.createElement("path", { d: "M240,128l-48,40H64L16,128,64,88H192Z", opacity: "0.2" }), /* @__PURE__ */ a3.createElement("path", { d: "M69.12,94.15,28.5,128l40.62,33.85a8,8,0,1,1-10.24,12.29l-48-40a8,8,0,0,1,0-12.29l48-40a8,8,0,0,1,10.24,12.3Zm176,27.7-48-40a8,8,0,1,0-10.24,12.3L227.5,128l-40.62,33.85a8,8,0,1,0,10.24,12.29l48-40a8,8,0,0,0,0-12.29ZM162.73,32.48a8,8,0,0,0-10.25,4.79l-64,176a8,8,0,0,0,4.79,10.26A8.14,8.14,0,0,0,96,224a8,8,0,0,0,7.52-5.27l64-176A8,8,0,0,0,162.73,32.48Z" }))
  ],
  [
    "fill",
    /* @__PURE__ */ a3.createElement(a3.Fragment, null, /* @__PURE__ */ a3.createElement("path", { d: "M216,40H40A16,16,0,0,0,24,56V200a16,16,0,0,0,16,16H216a16,16,0,0,0,16-16V56A16,16,0,0,0,216,40ZM92.8,145.6a8,8,0,1,1-9.6,12.8l-32-24a8,8,0,0,1,0-12.8l32-24a8,8,0,0,1,9.6,12.8L69.33,128Zm58.89-71.4-32,112a8,8,0,1,1-15.38-4.4l32-112a8,8,0,0,1,15.38,4.4Zm53.11,60.2-32,24a8,8,0,0,1-9.6-12.8L186.67,128,163.2,110.4a8,8,0,1,1,9.6-12.8l32,24a8,8,0,0,1,0,12.8Z" }))
  ],
  [
    "light",
    /* @__PURE__ */ a3.createElement(a3.Fragment, null, /* @__PURE__ */ a3.createElement("path", { d: "M67.84,92.61,25.37,128l42.47,35.39a6,6,0,1,1-7.68,9.22l-48-40a6,6,0,0,1,0-9.22l48-40a6,6,0,0,1,7.68,9.22Zm176,30.78-48-40a6,6,0,1,0-7.68,9.22L230.63,128l-42.47,35.39a6,6,0,1,0,7.68,9.22l48-40a6,6,0,0,0,0-9.22Zm-81.79-89A6,6,0,0,0,154.36,38l-64,176A6,6,0,0,0,94,221.64a6.15,6.15,0,0,0,2,.36,6,6,0,0,0,5.64-3.95l64-176A6,6,0,0,0,162.05,34.36Z" }))
  ],
  [
    "regular",
    /* @__PURE__ */ a3.createElement(a3.Fragment, null, /* @__PURE__ */ a3.createElement("path", { d: "M69.12,94.15,28.5,128l40.62,33.85a8,8,0,1,1-10.24,12.29l-48-40a8,8,0,0,1,0-12.29l48-40a8,8,0,0,1,10.24,12.3Zm176,27.7-48-40a8,8,0,1,0-10.24,12.3L227.5,128l-40.62,33.85a8,8,0,1,0,10.24,12.29l48-40a8,8,0,0,0,0-12.29ZM162.73,32.48a8,8,0,0,0-10.25,4.79l-64,176a8,8,0,0,0,4.79,10.26A8.14,8.14,0,0,0,96,224a8,8,0,0,0,7.52-5.27l64-176A8,8,0,0,0,162.73,32.48Z" }))
  ],
  [
    "thin",
    /* @__PURE__ */ a3.createElement(a3.Fragment, null, /* @__PURE__ */ a3.createElement("path", { d: "M66.56,91.07,22.25,128l44.31,36.93A4,4,0,0,1,64,172a3.94,3.94,0,0,1-2.56-.93l-48-40a4,4,0,0,1,0-6.14l48-40a4,4,0,0,1,5.12,6.14Zm176,33.86-48-40a4,4,0,1,0-5.12,6.14L233.75,128l-44.31,36.93a4,4,0,1,0,5.12,6.14l48-40a4,4,0,0,0,0-6.14ZM161.37,36.24a4,4,0,0,0-5.13,2.39l-64,176a4,4,0,0,0,2.39,5.13A4.12,4.12,0,0,0,96,220a4,4,0,0,0,3.76-2.63l64-176A4,4,0,0,0,161.37,36.24Z" }))
  ]
]);

// node_modules/.pnpm/@phosphor-icons+react@2.1.10_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/@phosphor-icons/react/dist/csr/Code.es.js
var e5 = o4.forwardRef((r7, t2) => /* @__PURE__ */ o4.createElement(p, { ref: t2, ...r7, weights: l }));
e5.displayName = "CodeIcon";

// node_modules/.pnpm/@phosphor-icons+react@2.1.10_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/@phosphor-icons/react/dist/csr/Eye.es.js
var e7 = __toESM(require_react(), 1);

// node_modules/.pnpm/@phosphor-icons+react@2.1.10_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/@phosphor-icons/react/dist/defs/Eye.es.js
var e6 = __toESM(require_react(), 1);
var a4 = /* @__PURE__ */ new Map([
  [
    "bold",
    /* @__PURE__ */ e6.createElement(e6.Fragment, null, /* @__PURE__ */ e6.createElement("path", { d: "M251,123.13c-.37-.81-9.13-20.26-28.48-39.61C196.63,57.67,164,44,128,44S59.37,57.67,33.51,83.52C14.16,102.87,5.4,122.32,5,123.13a12.08,12.08,0,0,0,0,9.75c.37.82,9.13,20.26,28.49,39.61C59.37,198.34,92,212,128,212s68.63-13.66,94.48-39.51c19.36-19.35,28.12-38.79,28.49-39.61A12.08,12.08,0,0,0,251,123.13Zm-46.06,33C183.47,177.27,157.59,188,128,188s-55.47-10.73-76.91-31.88A130.36,130.36,0,0,1,29.52,128,130.45,130.45,0,0,1,51.09,99.89C72.54,78.73,98.41,68,128,68s55.46,10.73,76.91,31.89A130.36,130.36,0,0,1,226.48,128,130.45,130.45,0,0,1,204.91,156.12ZM128,84a44,44,0,1,0,44,44A44.05,44.05,0,0,0,128,84Zm0,64a20,20,0,1,1,20-20A20,20,0,0,1,128,148Z" }))
  ],
  [
    "duotone",
    /* @__PURE__ */ e6.createElement(e6.Fragment, null, /* @__PURE__ */ e6.createElement(
      "path",
      {
        d: "M128,56C48,56,16,128,16,128s32,72,112,72,112-72,112-72S208,56,128,56Zm0,112a40,40,0,1,1,40-40A40,40,0,0,1,128,168Z",
        opacity: "0.2"
      }
    ), /* @__PURE__ */ e6.createElement("path", { d: "M247.31,124.76c-.35-.79-8.82-19.58-27.65-38.41C194.57,61.26,162.88,48,128,48S61.43,61.26,36.34,86.35C17.51,105.18,9,124,8.69,124.76a8,8,0,0,0,0,6.5c.35.79,8.82,19.57,27.65,38.4C61.43,194.74,93.12,208,128,208s66.57-13.26,91.66-38.34c18.83-18.83,27.3-37.61,27.65-38.4A8,8,0,0,0,247.31,124.76ZM128,192c-30.78,0-57.67-11.19-79.93-33.25A133.47,133.47,0,0,1,25,128,133.33,133.33,0,0,1,48.07,97.25C70.33,75.19,97.22,64,128,64s57.67,11.19,79.93,33.25A133.46,133.46,0,0,1,231.05,128C223.84,141.46,192.43,192,128,192Zm0-112a48,48,0,1,0,48,48A48.05,48.05,0,0,0,128,80Zm0,80a32,32,0,1,1,32-32A32,32,0,0,1,128,160Z" }))
  ],
  [
    "fill",
    /* @__PURE__ */ e6.createElement(e6.Fragment, null, /* @__PURE__ */ e6.createElement("path", { d: "M247.31,124.76c-.35-.79-8.82-19.58-27.65-38.41C194.57,61.26,162.88,48,128,48S61.43,61.26,36.34,86.35C17.51,105.18,9,124,8.69,124.76a8,8,0,0,0,0,6.5c.35.79,8.82,19.57,27.65,38.4C61.43,194.74,93.12,208,128,208s66.57-13.26,91.66-38.34c18.83-18.83,27.3-37.61,27.65-38.4A8,8,0,0,0,247.31,124.76ZM128,168a40,40,0,1,1,40-40A40,40,0,0,1,128,168Z" }))
  ],
  [
    "light",
    /* @__PURE__ */ e6.createElement(e6.Fragment, null, /* @__PURE__ */ e6.createElement("path", { d: "M245.48,125.57c-.34-.78-8.66-19.23-27.24-37.81C201,70.54,171.38,50,128,50S55,70.54,37.76,87.76c-18.58,18.58-26.9,37-27.24,37.81a6,6,0,0,0,0,4.88c.34.77,8.66,19.22,27.24,37.8C55,185.47,84.62,206,128,206s73-20.53,90.24-37.75c18.58-18.58,26.9-37,27.24-37.8A6,6,0,0,0,245.48,125.57ZM128,194c-31.38,0-58.78-11.42-81.45-33.93A134.77,134.77,0,0,1,22.69,128,134.56,134.56,0,0,1,46.55,95.94C69.22,73.42,96.62,62,128,62s58.78,11.42,81.45,33.94A134.56,134.56,0,0,1,233.31,128C226.94,140.21,195,194,128,194Zm0-112a46,46,0,1,0,46,46A46.06,46.06,0,0,0,128,82Zm0,80a34,34,0,1,1,34-34A34,34,0,0,1,128,162Z" }))
  ],
  [
    "regular",
    /* @__PURE__ */ e6.createElement(e6.Fragment, null, /* @__PURE__ */ e6.createElement("path", { d: "M247.31,124.76c-.35-.79-8.82-19.58-27.65-38.41C194.57,61.26,162.88,48,128,48S61.43,61.26,36.34,86.35C17.51,105.18,9,124,8.69,124.76a8,8,0,0,0,0,6.5c.35.79,8.82,19.57,27.65,38.4C61.43,194.74,93.12,208,128,208s66.57-13.26,91.66-38.34c18.83-18.83,27.3-37.61,27.65-38.4A8,8,0,0,0,247.31,124.76ZM128,192c-30.78,0-57.67-11.19-79.93-33.25A133.47,133.47,0,0,1,25,128,133.33,133.33,0,0,1,48.07,97.25C70.33,75.19,97.22,64,128,64s57.67,11.19,79.93,33.25A133.46,133.46,0,0,1,231.05,128C223.84,141.46,192.43,192,128,192Zm0-112a48,48,0,1,0,48,48A48.05,48.05,0,0,0,128,80Zm0,80a32,32,0,1,1,32-32A32,32,0,0,1,128,160Z" }))
  ],
  [
    "thin",
    /* @__PURE__ */ e6.createElement(e6.Fragment, null, /* @__PURE__ */ e6.createElement("path", { d: "M243.66,126.38c-.34-.76-8.52-18.89-26.83-37.2C199.87,72.22,170.7,52,128,52S56.13,72.22,39.17,89.18c-18.31,18.31-26.49,36.44-26.83,37.2a4.08,4.08,0,0,0,0,3.25c.34.77,8.52,18.89,26.83,37.2,17,17,46.14,37.17,88.83,37.17s71.87-20.21,88.83-37.17c18.31-18.31,26.49-36.43,26.83-37.2A4.08,4.08,0,0,0,243.66,126.38Zm-32.7,35c-23.07,23-51,34.62-83,34.62s-59.89-11.65-83-34.62A135.71,135.71,0,0,1,20.44,128,135.69,135.69,0,0,1,45,94.62C68.11,71.65,96,60,128,60s59.89,11.65,83,34.62A135.79,135.79,0,0,1,235.56,128,135.71,135.71,0,0,1,211,161.38ZM128,84a44,44,0,1,0,44,44A44.05,44.05,0,0,0,128,84Zm0,80a36,36,0,1,1,36-36A36,36,0,0,1,128,164Z" }))
  ]
]);

// node_modules/.pnpm/@phosphor-icons+react@2.1.10_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/@phosphor-icons/react/dist/csr/Eye.es.js
var o5 = e7.forwardRef((r7, t2) => /* @__PURE__ */ e7.createElement(p, { ref: t2, ...r7, weights: a4 }));
o5.displayName = "EyeIcon";

// node_modules/.pnpm/@phosphor-icons+react@2.1.10_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/@phosphor-icons/react/dist/csr/Globe.es.js
var o6 = __toESM(require_react(), 1);

// node_modules/.pnpm/@phosphor-icons+react@2.1.10_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/@phosphor-icons/react/dist/defs/Globe.es.js
var a5 = __toESM(require_react(), 1);
var e8 = /* @__PURE__ */ new Map([
  [
    "bold",
    /* @__PURE__ */ a5.createElement(a5.Fragment, null, /* @__PURE__ */ a5.createElement("path", { d: "M128,20A108,108,0,1,0,236,128,108.12,108.12,0,0,0,128,20Zm0,187a113.4,113.4,0,0,1-20.39-35h40.82a116.94,116.94,0,0,1-10,20.77A108.61,108.61,0,0,1,128,207Zm-26.49-59a135.42,135.42,0,0,1,0-40h53a135.42,135.42,0,0,1,0,40ZM44,128a83.49,83.49,0,0,1,2.43-20H77.25a160.63,160.63,0,0,0,0,40H46.43A83.49,83.49,0,0,1,44,128Zm84-79a113.4,113.4,0,0,1,20.39,35H107.59a116.94,116.94,0,0,1,10-20.77A108.61,108.61,0,0,1,128,49Zm50.73,59h30.82a83.52,83.52,0,0,1,0,40H178.75a160.63,160.63,0,0,0,0-40Zm20.77-24H173.71a140.82,140.82,0,0,0-15.5-34.36A84.51,84.51,0,0,1,199.52,84ZM97.79,49.64A140.82,140.82,0,0,0,82.29,84H56.48A84.51,84.51,0,0,1,97.79,49.64ZM56.48,172H82.29a140.82,140.82,0,0,0,15.5,34.36A84.51,84.51,0,0,1,56.48,172Zm101.73,34.36A140.82,140.82,0,0,0,173.71,172h25.81A84.51,84.51,0,0,1,158.21,206.36Z" }))
  ],
  [
    "duotone",
    /* @__PURE__ */ a5.createElement(a5.Fragment, null, /* @__PURE__ */ a5.createElement("path", { d: "M224,128a96,96,0,1,1-96-96A96,96,0,0,1,224,128Z", opacity: "0.2" }), /* @__PURE__ */ a5.createElement("path", { d: "M128,24h0A104,104,0,1,0,232,128,104.12,104.12,0,0,0,128,24Zm88,104a87.61,87.61,0,0,1-3.33,24H174.16a157.44,157.44,0,0,0,0-48h38.51A87.61,87.61,0,0,1,216,128ZM102,168H154a115.11,115.11,0,0,1-26,45A115.27,115.27,0,0,1,102,168Zm-3.9-16a140.84,140.84,0,0,1,0-48h59.88a140.84,140.84,0,0,1,0,48ZM40,128a87.61,87.61,0,0,1,3.33-24H81.84a157.44,157.44,0,0,0,0,48H43.33A87.61,87.61,0,0,1,40,128ZM154,88H102a115.11,115.11,0,0,1,26-45A115.27,115.27,0,0,1,154,88Zm52.33,0H170.71a135.28,135.28,0,0,0-22.3-45.6A88.29,88.29,0,0,1,206.37,88ZM107.59,42.4A135.28,135.28,0,0,0,85.29,88H49.63A88.29,88.29,0,0,1,107.59,42.4ZM49.63,168H85.29a135.28,135.28,0,0,0,22.3,45.6A88.29,88.29,0,0,1,49.63,168Zm98.78,45.6a135.28,135.28,0,0,0,22.3-45.6h35.66A88.29,88.29,0,0,1,148.41,213.6Z" }))
  ],
  [
    "fill",
    /* @__PURE__ */ a5.createElement(a5.Fragment, null, /* @__PURE__ */ a5.createElement("path", { d: "M128,24h0A104,104,0,1,0,232,128,104.12,104.12,0,0,0,128,24Zm78.36,64H170.71a135.28,135.28,0,0,0-22.3-45.6A88.29,88.29,0,0,1,206.37,88ZM216,128a87.61,87.61,0,0,1-3.33,24H174.16a157.44,157.44,0,0,0,0-48h38.51A87.61,87.61,0,0,1,216,128ZM128,43a115.27,115.27,0,0,1,26,45H102A115.11,115.11,0,0,1,128,43ZM102,168H154a115.11,115.11,0,0,1-26,45A115.27,115.27,0,0,1,102,168Zm-3.9-16a140.84,140.84,0,0,1,0-48h59.88a140.84,140.84,0,0,1,0,48Zm50.35,61.6a135.28,135.28,0,0,0,22.3-45.6h35.66A88.29,88.29,0,0,1,148.41,213.6Z" }))
  ],
  [
    "light",
    /* @__PURE__ */ a5.createElement(a5.Fragment, null, /* @__PURE__ */ a5.createElement("path", { d: "M128,26A102,102,0,1,0,230,128,102.12,102.12,0,0,0,128,26Zm81.57,64H169.19a132.58,132.58,0,0,0-25.73-50.67A90.29,90.29,0,0,1,209.57,90ZM218,128a89.7,89.7,0,0,1-3.83,26H171.81a155.43,155.43,0,0,0,0-52h42.36A89.7,89.7,0,0,1,218,128Zm-90,87.83a110,110,0,0,1-15.19-19.45A124.24,124.24,0,0,1,99.35,166h57.3a124.24,124.24,0,0,1-13.46,30.38A110,110,0,0,1,128,215.83ZM96.45,154a139.18,139.18,0,0,1,0-52h63.1a139.18,139.18,0,0,1,0,52ZM38,128a89.7,89.7,0,0,1,3.83-26H84.19a155.43,155.43,0,0,0,0,52H41.83A89.7,89.7,0,0,1,38,128Zm90-87.83a110,110,0,0,1,15.19,19.45A124.24,124.24,0,0,1,156.65,90H99.35a124.24,124.24,0,0,1,13.46-30.38A110,110,0,0,1,128,40.17Zm-15.46-.84A132.58,132.58,0,0,0,86.81,90H46.43A90.29,90.29,0,0,1,112.54,39.33ZM46.43,166H86.81a132.58,132.58,0,0,0,25.73,50.67A90.29,90.29,0,0,1,46.43,166Zm97,50.67A132.58,132.58,0,0,0,169.19,166h40.38A90.29,90.29,0,0,1,143.46,216.67Z" }))
  ],
  [
    "regular",
    /* @__PURE__ */ a5.createElement(a5.Fragment, null, /* @__PURE__ */ a5.createElement("path", { d: "M128,24h0A104,104,0,1,0,232,128,104.12,104.12,0,0,0,128,24Zm88,104a87.61,87.61,0,0,1-3.33,24H174.16a157.44,157.44,0,0,0,0-48h38.51A87.61,87.61,0,0,1,216,128ZM102,168H154a115.11,115.11,0,0,1-26,45A115.27,115.27,0,0,1,102,168Zm-3.9-16a140.84,140.84,0,0,1,0-48h59.88a140.84,140.84,0,0,1,0,48ZM40,128a87.61,87.61,0,0,1,3.33-24H81.84a157.44,157.44,0,0,0,0,48H43.33A87.61,87.61,0,0,1,40,128ZM154,88H102a115.11,115.11,0,0,1,26-45A115.27,115.27,0,0,1,154,88Zm52.33,0H170.71a135.28,135.28,0,0,0-22.3-45.6A88.29,88.29,0,0,1,206.37,88ZM107.59,42.4A135.28,135.28,0,0,0,85.29,88H49.63A88.29,88.29,0,0,1,107.59,42.4ZM49.63,168H85.29a135.28,135.28,0,0,0,22.3,45.6A88.29,88.29,0,0,1,49.63,168Zm98.78,45.6a135.28,135.28,0,0,0,22.3-45.6h35.66A88.29,88.29,0,0,1,148.41,213.6Z" }))
  ],
  [
    "thin",
    /* @__PURE__ */ a5.createElement(a5.Fragment, null, /* @__PURE__ */ a5.createElement("path", { d: "M128,28h0A100,100,0,1,0,228,128,100.11,100.11,0,0,0,128,28Zm0,190.61c-6.33-6.09-23-24.41-31.27-54.61h62.54C151,194.2,134.33,212.52,128,218.61ZM94.82,156a140.42,140.42,0,0,1,0-56h66.36a140.42,140.42,0,0,1,0,56ZM128,37.39c6.33,6.09,23,24.41,31.27,54.61H96.73C105,61.8,121.67,43.48,128,37.39ZM169.41,100h46.23a92.09,92.09,0,0,1,0,56H169.41a152.65,152.65,0,0,0,0-56Zm43.25-8h-45a129.39,129.39,0,0,0-29.19-55.4A92.25,92.25,0,0,1,212.66,92ZM117.54,36.6A129.39,129.39,0,0,0,88.35,92h-45A92.25,92.25,0,0,1,117.54,36.6ZM40.36,100H86.59a152.65,152.65,0,0,0,0,56H40.36a92.09,92.09,0,0,1,0-56Zm3,64h45a129.39,129.39,0,0,0,29.19,55.4A92.25,92.25,0,0,1,43.34,164Zm95.12,55.4A129.39,129.39,0,0,0,167.65,164h45A92.25,92.25,0,0,1,138.46,219.4Z" }))
  ]
]);

// node_modules/.pnpm/@phosphor-icons+react@2.1.10_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/@phosphor-icons/react/dist/csr/Globe.es.js
var e9 = o6.forwardRef((r7, t2) => /* @__PURE__ */ o6.createElement(p, { ref: t2, ...r7, weights: e8 }));
e9.displayName = "GlobeIcon";

// node_modules/.pnpm/@phosphor-icons+react@2.1.10_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/@phosphor-icons/react/dist/csr/Hand.es.js
var o7 = __toESM(require_react(), 1);

// node_modules/.pnpm/@phosphor-icons+react@2.1.10_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/@phosphor-icons/react/dist/defs/Hand.es.js
var a6 = __toESM(require_react(), 1);
var e10 = /* @__PURE__ */ new Map([
  [
    "bold",
    /* @__PURE__ */ a6.createElement(a6.Fragment, null, /* @__PURE__ */ a6.createElement("path", { d: "M188,44a32,32,0,0,0-8,1V44a32,32,0,0,0-60.79-14A32,32,0,0,0,76,60v50.83a32,32,0,0,0-52,36.7C55.82,214.6,75.35,244,128,244a92.1,92.1,0,0,0,92-92V76A32,32,0,0,0,188,44Zm8,108a68.08,68.08,0,0,1-68,68c-35.83,0-49.71-14-82.48-83.14-.14-.29-.29-.58-.45-.86a8,8,0,0,1,13.85-8l.21.35,18.68,30A12,12,0,0,0,100,152V60a8,8,0,0,1,16,0v60a12,12,0,0,0,24,0V44a8,8,0,0,1,16,0v76a12,12,0,0,0,24,0V76a8,8,0,0,1,16,0Z" }))
  ],
  [
    "duotone",
    /* @__PURE__ */ a6.createElement(a6.Fragment, null, /* @__PURE__ */ a6.createElement(
      "path",
      {
        d: "M208,76v76a80,80,0,0,1-80,80c-44.18,0-60.75-21.28-93.32-90a20,20,0,0,1,34.64-20L88,152V60a20,20,0,0,1,40,0V44a20,20,0,0,1,40,0V76a20,20,0,0,1,40,0Z",
        opacity: "0.2"
      }
    ), /* @__PURE__ */ a6.createElement("path", { d: "M188,48a27.75,27.75,0,0,0-12,2.71V44a28,28,0,0,0-54.65-8.6A28,28,0,0,0,80,60v64l-3.82-6.13a28,28,0,0,0-48.6,27.82c16,33.77,28.93,57.72,43.72,72.69C86.24,233.54,103.2,240,128,240a88.1,88.1,0,0,0,88-88V76A28,28,0,0,0,188,48Zm12,104a72.08,72.08,0,0,1-72,72c-20.38,0-33.51-4.88-45.33-16.85C69.44,193.74,57.26,171,41.9,138.58a6.36,6.36,0,0,0-.3-.58,12,12,0,0,1,20.79-12,1.76,1.76,0,0,0,.14.23l18.67,30A8,8,0,0,0,96,152V60a12,12,0,0,1,24,0v60a8,8,0,0,0,16,0V44a12,12,0,0,1,24,0v76a8,8,0,0,0,16,0V76a12,12,0,0,1,24,0Z" }))
  ],
  [
    "fill",
    /* @__PURE__ */ a6.createElement(a6.Fragment, null, /* @__PURE__ */ a6.createElement("path", { d: "M216,64v90.93c0,46.2-36.85,84.55-83,85.06A83.71,83.71,0,0,1,72.6,215.4C50.79,192.33,26.15,136,26.15,136a16,16,0,0,1,6.53-22.23c7.66-4,17.1-.84,21.4,6.62l21,36.44a6.09,6.09,0,0,0,6,3.09l.12,0A8.19,8.19,0,0,0,88,151.74V48a16,16,0,0,1,16.77-16c8.61.4,15.23,7.82,15.23,16.43V112a8,8,0,0,0,8.53,8,8.17,8.17,0,0,0,7.47-8.25V32a16,16,0,0,1,16.77-16c8.61.4,15.23,7.82,15.23,16.43V120a8,8,0,0,0,8.53,8,8.17,8.17,0,0,0,7.47-8.25V64.45c0-8.61,6.62-16,15.23-16.43A16,16,0,0,1,216,64Z" }))
  ],
  [
    "light",
    /* @__PURE__ */ a6.createElement(a6.Fragment, null, /* @__PURE__ */ a6.createElement("path", { d: "M188,50a25.8,25.8,0,0,0-14,4.11V44a26,26,0,0,0-51.41-5.51A26,26,0,0,0,82,60v71l-7.53-12.1a26,26,0,0,0-45.11,25.87C60.76,211,78.51,238,128,238a86.1,86.1,0,0,0,86-86V76A26,26,0,0,0,188,50Zm14,102a74.09,74.09,0,0,1-74,74c-21,0-34.51-5.05-46.75-17.45C67.81,195,55.54,172,40.1,139.43l-.23-.43a14,14,0,0,1,24.25-14l.1.17,18.68,30A6,6,0,0,0,94,152V60a14,14,0,0,1,28,0v60a6,6,0,0,0,12,0V44a14,14,0,0,1,28,0v76a6,6,0,0,0,12,0V76a14,14,0,0,1,28,0Z" }))
  ],
  [
    "regular",
    /* @__PURE__ */ a6.createElement(a6.Fragment, null, /* @__PURE__ */ a6.createElement("path", { d: "M188,48a27.75,27.75,0,0,0-12,2.71V44a28,28,0,0,0-54.65-8.6A28,28,0,0,0,80,60v64l-3.82-6.13a28,28,0,0,0-48.6,27.82c16,33.77,28.93,57.72,43.72,72.69C86.24,233.54,103.2,240,128,240a88.1,88.1,0,0,0,88-88V76A28,28,0,0,0,188,48Zm12,104a72.08,72.08,0,0,1-72,72c-20.38,0-33.51-4.88-45.33-16.85C69.44,193.74,57.26,171,41.9,138.58a6.36,6.36,0,0,0-.3-.58,12,12,0,0,1,20.79-12,1.76,1.76,0,0,0,.14.23l18.67,30A8,8,0,0,0,96,152V60a12,12,0,0,1,24,0v60a8,8,0,0,0,16,0V44a12,12,0,0,1,24,0v76a8,8,0,0,0,16,0V76a12,12,0,0,1,24,0Z" }))
  ],
  [
    "thin",
    /* @__PURE__ */ a6.createElement(a6.Fragment, null, /* @__PURE__ */ a6.createElement("path", { d: "M188,52a23.9,23.9,0,0,0-16,6.13V44a24,24,0,0,0-47.93-1.8A24,24,0,0,0,84,60v78L72.75,119.94a24,24,0,0,0-41.62,23.92C64.44,214.12,82.17,236,128,236a84.09,84.09,0,0,0,84-84V76A24,24,0,0,0,188,52Zm16,100a76.09,76.09,0,0,1-76,76c-37.29,0-53.59-11.51-89.71-87.71l-.15-.29a16,16,0,0,1,27.71-16,.75.75,0,0,1,.07.12l18.68,30A4,4,0,0,0,92,152V60a16,16,0,0,1,32,0v60a4,4,0,0,0,8,0V44a16,16,0,0,1,32,0v76a4,4,0,0,0,8,0V76a16,16,0,0,1,32,0Z" }))
  ]
]);

// node_modules/.pnpm/@phosphor-icons+react@2.1.10_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/@phosphor-icons/react/dist/csr/Hand.es.js
var a7 = o7.forwardRef((e34, r7) => /* @__PURE__ */ o7.createElement(p, { ref: r7, ...e34, weights: e10 }));
a7.displayName = "HandIcon";

// node_modules/.pnpm/@phosphor-icons+react@2.1.10_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/@phosphor-icons/react/dist/csr/LockKey.es.js
var o8 = __toESM(require_react(), 1);

// node_modules/.pnpm/@phosphor-icons+react@2.1.10_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/@phosphor-icons/react/dist/defs/LockKey.es.js
var a8 = __toESM(require_react(), 1);
var e11 = /* @__PURE__ */ new Map([
  [
    "bold",
    /* @__PURE__ */ a8.createElement(a8.Fragment, null, /* @__PURE__ */ a8.createElement("path", { d: "M208,76H180V56A52,52,0,0,0,76,56V76H48A20,20,0,0,0,28,96V208a20,20,0,0,0,20,20H208a20,20,0,0,0,20-20V96A20,20,0,0,0,208,76ZM100,56a28,28,0,0,1,56,0V76H100ZM204,204H52V100H204Zm-76-92a32,32,0,0,0-12,61.66V180a12,12,0,0,0,24,0v-6.34A32,32,0,0,0,128,112Zm0,24a8,8,0,1,1-8,8A8,8,0,0,1,128,136Z" }))
  ],
  [
    "duotone",
    /* @__PURE__ */ a8.createElement(a8.Fragment, null, /* @__PURE__ */ a8.createElement(
      "path",
      {
        d: "M208,88H48a8,8,0,0,0-8,8V208a8,8,0,0,0,8,8H208a8,8,0,0,0,8-8V96A8,8,0,0,0,208,88Zm-80,72a20,20,0,1,1,20-20A20,20,0,0,1,128,160Z",
        opacity: "0.2"
      }
    ), /* @__PURE__ */ a8.createElement("path", { d: "M208,80H176V56a48,48,0,0,0-96,0V80H48A16,16,0,0,0,32,96V208a16,16,0,0,0,16,16H208a16,16,0,0,0,16-16V96A16,16,0,0,0,208,80ZM96,56a32,32,0,0,1,64,0V80H96ZM208,208H48V96H208V208Zm-80-96a28,28,0,0,0-8,54.83V184a8,8,0,0,0,16,0V166.83A28,28,0,0,0,128,112Zm0,40a12,12,0,1,1,12-12A12,12,0,0,1,128,152Z" }))
  ],
  [
    "fill",
    /* @__PURE__ */ a8.createElement(a8.Fragment, null, /* @__PURE__ */ a8.createElement("path", { d: "M208,80H176V56a48,48,0,0,0-96,0V80H48A16,16,0,0,0,32,96V208a16,16,0,0,0,16,16H208a16,16,0,0,0,16-16V96A16,16,0,0,0,208,80Zm-72,78.63V184a8,8,0,0,1-16,0V158.63a24,24,0,1,1,16,0ZM160,80H96V56a32,32,0,0,1,64,0Z" }))
  ],
  [
    "light",
    /* @__PURE__ */ a8.createElement(a8.Fragment, null, /* @__PURE__ */ a8.createElement("path", { d: "M208,82H174V56a46,46,0,0,0-92,0V82H48A14,14,0,0,0,34,96V208a14,14,0,0,0,14,14H208a14,14,0,0,0,14-14V96A14,14,0,0,0,208,82ZM94,56a34,34,0,0,1,68,0V82H94ZM210,208a2,2,0,0,1-2,2H48a2,2,0,0,1-2-2V96a2,2,0,0,1,2-2H208a2,2,0,0,1,2,2Zm-82-94a26,26,0,0,0-6,51.29V184a6,6,0,0,0,12,0V165.29A26,26,0,0,0,128,114Zm0,40a14,14,0,1,1,14-14A14,14,0,0,1,128,154Z" }))
  ],
  [
    "regular",
    /* @__PURE__ */ a8.createElement(a8.Fragment, null, /* @__PURE__ */ a8.createElement("path", { d: "M128,112a28,28,0,0,0-8,54.83V184a8,8,0,0,0,16,0V166.83A28,28,0,0,0,128,112Zm0,40a12,12,0,1,1,12-12A12,12,0,0,1,128,152Zm80-72H176V56a48,48,0,0,0-96,0V80H48A16,16,0,0,0,32,96V208a16,16,0,0,0,16,16H208a16,16,0,0,0,16-16V96A16,16,0,0,0,208,80ZM96,56a32,32,0,0,1,64,0V80H96ZM208,208H48V96H208V208Z" }))
  ],
  [
    "thin",
    /* @__PURE__ */ a8.createElement(a8.Fragment, null, /* @__PURE__ */ a8.createElement("path", { d: "M208,84H172V56a44,44,0,0,0-88,0V84H48A12,12,0,0,0,36,96V208a12,12,0,0,0,12,12H208a12,12,0,0,0,12-12V96A12,12,0,0,0,208,84ZM92,56a36,36,0,0,1,72,0V84H92ZM212,208a4,4,0,0,1-4,4H48a4,4,0,0,1-4-4V96a4,4,0,0,1,4-4H208a4,4,0,0,1,4,4Zm-84-92a24,24,0,0,0-4,47.66V184a4,4,0,0,0,8,0V163.66A24,24,0,0,0,128,116Zm0,40a16,16,0,1,1,16-16A16,16,0,0,1,128,156Z" }))
  ]
]);

// node_modules/.pnpm/@phosphor-icons+react@2.1.10_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/@phosphor-icons/react/dist/csr/LockKey.es.js
var e12 = o8.forwardRef((c3, r7) => /* @__PURE__ */ o8.createElement(p, { ref: r7, ...c3, weights: e11 }));
e12.displayName = "LockKeyIcon";

// node_modules/.pnpm/@phosphor-icons+react@2.1.10_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/@phosphor-icons/react/dist/csr/PaperPlaneTilt.es.js
var e14 = __toESM(require_react(), 1);

// node_modules/.pnpm/@phosphor-icons+react@2.1.10_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/@phosphor-icons/react/dist/defs/PaperPlaneTilt.es.js
var a9 = __toESM(require_react(), 1);
var e13 = /* @__PURE__ */ new Map([
  [
    "bold",
    /* @__PURE__ */ a9.createElement(a9.Fragment, null, /* @__PURE__ */ a9.createElement("path", { d: "M230.14,25.86a20,20,0,0,0-19.57-5.11l-.22.07L18.44,79a20,20,0,0,0-3.06,37.25L99,157l40.71,83.65a19.81,19.81,0,0,0,18,11.38c.57,0,1.15,0,1.73-.07A19.82,19.82,0,0,0,177,237.56L235.18,45.65a1.42,1.42,0,0,0,.07-.22A20,20,0,0,0,230.14,25.86ZM156.91,221.07l-34.37-70.64,46-45.95a12,12,0,0,0-17-17l-46,46L34.93,99.09,210,46Z" }))
  ],
  [
    "duotone",
    /* @__PURE__ */ a9.createElement(a9.Fragment, null, /* @__PURE__ */ a9.createElement(
      "path",
      {
        d: "M223.69,42.18l-58.22,192a8,8,0,0,1-14.92,1.25L108,148,20.58,105.45a8,8,0,0,1,1.25-14.92l192-58.22A8,8,0,0,1,223.69,42.18Z",
        opacity: "0.2"
      }
    ), /* @__PURE__ */ a9.createElement("path", { d: "M227.32,28.68a16,16,0,0,0-15.66-4.08l-.15,0L19.57,82.84a16,16,0,0,0-2.49,29.8L102,154l41.3,84.87A15.86,15.86,0,0,0,157.74,248q.69,0,1.38-.06a15.88,15.88,0,0,0,14-11.51l58.2-191.94c0-.05,0-.1,0-.15A16,16,0,0,0,227.32,28.68ZM157.83,231.85l-.05.14,0-.07-40.06-82.3,48-48a8,8,0,0,0-11.31-11.31l-48,48L24.08,98.25l-.07,0,.14,0L216,40Z" }))
  ],
  [
    "fill",
    /* @__PURE__ */ a9.createElement(a9.Fragment, null, /* @__PURE__ */ a9.createElement("path", { d: "M231.4,44.34s0,.1,0,.15l-58.2,191.94a15.88,15.88,0,0,1-14,11.51q-.69.06-1.38.06a15.86,15.86,0,0,1-14.42-9.15L107,164.15a4,4,0,0,1,.77-4.58l57.92-57.92a8,8,0,0,0-11.31-11.31L96.43,148.26a4,4,0,0,1-4.58.77L17.08,112.64a16,16,0,0,1,2.49-29.8l191.94-58.2.15,0A16,16,0,0,1,231.4,44.34Z" }))
  ],
  [
    "light",
    /* @__PURE__ */ a9.createElement(a9.Fragment, null, /* @__PURE__ */ a9.createElement("path", { d: "M225.88,30.12a13.83,13.83,0,0,0-13.7-3.58l-.11,0L20.14,84.77A14,14,0,0,0,18,110.85l85.56,41.64L145.12,238a13.87,13.87,0,0,0,12.61,8c.4,0,.81,0,1.21-.05a13.9,13.9,0,0,0,12.29-10.09l58.2-191.93,0-.11A13.83,13.83,0,0,0,225.88,30.12Zm-8,10.4L159.73,232.43l0,.11a2,2,0,0,1-3.76.26l-40.68-83.58,49-49a6,6,0,1,0-8.49-8.49l-49,49L23.15,100a2,2,0,0,1,.31-3.74l.11,0L215.48,38.08a1.94,1.94,0,0,1,1.92.52A2,2,0,0,1,217.92,40.52Z" }))
  ],
  [
    "regular",
    /* @__PURE__ */ a9.createElement(a9.Fragment, null, /* @__PURE__ */ a9.createElement("path", { d: "M227.32,28.68a16,16,0,0,0-15.66-4.08l-.15,0L19.57,82.84a16,16,0,0,0-2.49,29.8L102,154l41.3,84.87A15.86,15.86,0,0,0,157.74,248q.69,0,1.38-.06a15.88,15.88,0,0,0,14-11.51l58.2-191.94c0-.05,0-.1,0-.15A16,16,0,0,0,227.32,28.68ZM157.83,231.85l-.05.14,0-.07-40.06-82.3,48-48a8,8,0,0,0-11.31-11.31l-48,48L24.08,98.25l-.07,0,.14,0L216,40Z" }))
  ],
  [
    "thin",
    /* @__PURE__ */ a9.createElement(a9.Fragment, null, /* @__PURE__ */ a9.createElement("path", { d: "M224.47,31.52a11.87,11.87,0,0,0-11.82-3L20.74,86.67a12,12,0,0,0-1.91,22.38L105,151l41.92,86.15A11.88,11.88,0,0,0,157.74,244c.34,0,.69,0,1,0a11.89,11.89,0,0,0,10.52-8.63l58.21-192,0-.08A11.85,11.85,0,0,0,224.47,31.52Zm-4.62,9.54-58.23,192a4,4,0,0,1-7.48.59l-41.3-84.86,50-50a4,4,0,1,0-5.66-5.66l-50,50-84.9-41.31a3.88,3.88,0,0,1-2.27-4,3.93,3.93,0,0,1,3-3.54L214.9,36.16A3.93,3.93,0,0,1,216,36a4,4,0,0,1,2.79,1.19A3.93,3.93,0,0,1,219.85,41.06Z" }))
  ]
]);

// node_modules/.pnpm/@phosphor-icons+react@2.1.10_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/@phosphor-icons/react/dist/csr/PaperPlaneTilt.es.js
var a10 = e14.forwardRef((o20, r7) => /* @__PURE__ */ e14.createElement(p, { ref: r7, ...o20, weights: e13 }));
a10.displayName = "PaperPlaneTiltIcon";

// node_modules/.pnpm/@phosphor-icons+react@2.1.10_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/@phosphor-icons/react/dist/csr/Prohibit.es.js
var o9 = __toESM(require_react(), 1);

// node_modules/.pnpm/@phosphor-icons+react@2.1.10_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/@phosphor-icons/react/dist/defs/Prohibit.es.js
var e15 = __toESM(require_react(), 1);
var t = /* @__PURE__ */ new Map([
  [
    "bold",
    /* @__PURE__ */ e15.createElement(e15.Fragment, null, /* @__PURE__ */ e15.createElement("path", { d: "M128,20A108,108,0,1,0,236,128,108.12,108.12,0,0,0,128,20Zm84,108a83.6,83.6,0,0,1-16.75,50.28L77.72,60.75A84,84,0,0,1,212,128ZM44,128A83.6,83.6,0,0,1,60.75,77.72L178.28,195.25A84,84,0,0,1,44,128Z" }))
  ],
  [
    "duotone",
    /* @__PURE__ */ e15.createElement(e15.Fragment, null, /* @__PURE__ */ e15.createElement("path", { d: "M224,128a96,96,0,1,1-96-96A96,96,0,0,1,224,128Z", opacity: "0.2" }), /* @__PURE__ */ e15.createElement("path", { d: "M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm88,104a87.56,87.56,0,0,1-20.41,56.28L71.72,60.4A88,88,0,0,1,216,128ZM40,128A87.56,87.56,0,0,1,60.41,71.72L184.28,195.6A88,88,0,0,1,40,128Z" }))
  ],
  [
    "fill",
    /* @__PURE__ */ e15.createElement(e15.Fragment, null, /* @__PURE__ */ e15.createElement("path", { d: "M200,128a71.69,71.69,0,0,1-15.78,44.91L83.09,71.78A71.95,71.95,0,0,1,200,128ZM56,128a71.95,71.95,0,0,0,116.91,56.22L71.78,83.09A71.69,71.69,0,0,0,56,128Zm180,0A108,108,0,1,1,128,20,108.12,108.12,0,0,1,236,128Zm-20,0a88,88,0,1,0-88,88A88.1,88.1,0,0,0,216,128Z" }))
  ],
  [
    "light",
    /* @__PURE__ */ e15.createElement(e15.Fragment, null, /* @__PURE__ */ e15.createElement("path", { d: "M128,26A102,102,0,1,0,230,128,102.12,102.12,0,0,0,128,26Zm90,102a89.6,89.6,0,0,1-22.29,59.22L68.78,60.29A89.95,89.95,0,0,1,218,128ZM38,128A89.6,89.6,0,0,1,60.29,68.78L187.22,195.71A89.95,89.95,0,0,1,38,128Z" }))
  ],
  [
    "regular",
    /* @__PURE__ */ e15.createElement(e15.Fragment, null, /* @__PURE__ */ e15.createElement("path", { d: "M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm88,104a87.56,87.56,0,0,1-20.41,56.28L71.72,60.4A88,88,0,0,1,216,128ZM40,128A87.56,87.56,0,0,1,60.41,71.72L184.28,195.6A88,88,0,0,1,40,128Z" }))
  ],
  [
    "thin",
    /* @__PURE__ */ e15.createElement(e15.Fragment, null, /* @__PURE__ */ e15.createElement("path", { d: "M128,28A100,100,0,1,0,228,128,100.11,100.11,0,0,0,128,28Zm92,100a91.67,91.67,0,0,1-24.21,62.13L65.87,60.21A92,92,0,0,1,220,128ZM36,128A91.67,91.67,0,0,1,60.21,65.87L190.13,195.79A92,92,0,0,1,36,128Z" }))
  ]
]);

// node_modules/.pnpm/@phosphor-icons+react@2.1.10_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/@phosphor-icons/react/dist/csr/Prohibit.es.js
var r3 = o9.forwardRef((t2, i3) => /* @__PURE__ */ o9.createElement(p, { ref: i3, ...t2, weights: t }));
r3.displayName = "ProhibitIcon";

// node_modules/.pnpm/@phosphor-icons+react@2.1.10_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/@phosphor-icons/react/dist/csr/SignIn.es.js
var o10 = __toESM(require_react(), 1);

// node_modules/.pnpm/@phosphor-icons+react@2.1.10_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/@phosphor-icons/react/dist/defs/SignIn.es.js
var a11 = __toESM(require_react(), 1);
var e16 = /* @__PURE__ */ new Map([
  [
    "bold",
    /* @__PURE__ */ a11.createElement(a11.Fragment, null, /* @__PURE__ */ a11.createElement("path", { d: "M144.49,136.49l-40,40a12,12,0,0,1-17-17L107,140H24a12,12,0,0,1,0-24h83L87.51,96.49a12,12,0,0,1,17-17l40,40A12,12,0,0,1,144.49,136.49ZM200,28H136a12,12,0,0,0,0,24h52V204H136a12,12,0,0,0,0,24h64a12,12,0,0,0,12-12V40A12,12,0,0,0,200,28Z" }))
  ],
  [
    "duotone",
    /* @__PURE__ */ a11.createElement(a11.Fragment, null, /* @__PURE__ */ a11.createElement(
      "path",
      {
        d: "M200,40V216H40a16,16,0,0,1-16-16V56A16,16,0,0,1,40,40Z",
        opacity: "0.2"
      }
    ), /* @__PURE__ */ a11.createElement("path", { d: "M141.66,133.66l-40,40a8,8,0,0,1-11.32-11.32L116.69,136H24a8,8,0,0,1,0-16h92.69L90.34,93.66a8,8,0,0,1,11.32-11.32l40,40A8,8,0,0,1,141.66,133.66ZM200,32H136a8,8,0,0,0,0,16h56V208H136a8,8,0,0,0,0,16h64a8,8,0,0,0,8-8V40A8,8,0,0,0,200,32Z" }))
  ],
  [
    "fill",
    /* @__PURE__ */ a11.createElement(a11.Fragment, null, /* @__PURE__ */ a11.createElement("path", { d: "M141.66,133.66l-40,40A8,8,0,0,1,88,168V136H24a8,8,0,0,1,0-16H88V88a8,8,0,0,1,13.66-5.66l40,40A8,8,0,0,1,141.66,133.66ZM200,32H136a8,8,0,0,0,0,16h56V208H136a8,8,0,0,0,0,16h64a8,8,0,0,0,8-8V40A8,8,0,0,0,200,32Z" }))
  ],
  [
    "light",
    /* @__PURE__ */ a11.createElement(a11.Fragment, null, /* @__PURE__ */ a11.createElement("path", { d: "M140.24,132.24l-40,40a6,6,0,0,1-8.48-8.48L121.51,134H24a6,6,0,0,1,0-12h97.51L91.76,92.24a6,6,0,0,1,8.48-8.48l40,40A6,6,0,0,1,140.24,132.24ZM200,34H136a6,6,0,0,0,0,12h58V210H136a6,6,0,0,0,0,12h64a6,6,0,0,0,6-6V40A6,6,0,0,0,200,34Z" }))
  ],
  [
    "regular",
    /* @__PURE__ */ a11.createElement(a11.Fragment, null, /* @__PURE__ */ a11.createElement("path", { d: "M141.66,133.66l-40,40a8,8,0,0,1-11.32-11.32L116.69,136H24a8,8,0,0,1,0-16h92.69L90.34,93.66a8,8,0,0,1,11.32-11.32l40,40A8,8,0,0,1,141.66,133.66ZM200,32H136a8,8,0,0,0,0,16h56V208H136a8,8,0,0,0,0,16h64a8,8,0,0,0,8-8V40A8,8,0,0,0,200,32Z" }))
  ],
  [
    "thin",
    /* @__PURE__ */ a11.createElement(a11.Fragment, null, /* @__PURE__ */ a11.createElement("path", { d: "M138.83,130.83l-40,40a4,4,0,0,1-5.66-5.66L126.34,132H24a4,4,0,0,1,0-8H126.34L93.17,90.83a4,4,0,0,1,5.66-5.66l40,40A4,4,0,0,1,138.83,130.83ZM200,36H136a4,4,0,0,0,0,8h60V212H136a4,4,0,0,0,0,8h64a4,4,0,0,0,4-4V40A4,4,0,0,0,200,36Z" }))
  ]
]);

// node_modules/.pnpm/@phosphor-icons+react@2.1.10_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/@phosphor-icons/react/dist/csr/SignIn.es.js
var n = o10.forwardRef((e34, r7) => /* @__PURE__ */ o10.createElement(p, { ref: r7, ...e34, weights: e16 }));
n.displayName = "SignInIcon";

// node_modules/.pnpm/@phosphor-icons+react@2.1.10_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/@phosphor-icons/react/dist/defs/ArrowElbowDownLeft.es.js
var e17 = __toESM(require_react(), 1);
var a12 = /* @__PURE__ */ new Map([
  [
    "bold",
    /* @__PURE__ */ e17.createElement(e17.Fragment, null, /* @__PURE__ */ e17.createElement("path", { d: "M204,32V176a12,12,0,0,1-12,12H77l27.52,27.51a12,12,0,0,1-17,17l-48-48a12,12,0,0,1,0-17l48-48a12,12,0,1,1,17,17L77,164H180V32a12,12,0,0,1,24,0Z" }))
  ],
  [
    "duotone",
    /* @__PURE__ */ e17.createElement(e17.Fragment, null, /* @__PURE__ */ e17.createElement("path", { d: "M96,128v96L48,176Z", opacity: "0.2" }), /* @__PURE__ */ e17.createElement("path", { d: "M192,24a8,8,0,0,0-8,8V168H104V128a8,8,0,0,0-13.66-5.66l-48,48a8,8,0,0,0,0,11.32l48,48A8,8,0,0,0,104,224V184h88a8,8,0,0,0,8-8V32A8,8,0,0,0,192,24ZM88,204.69,59.31,176,88,147.31Z" }))
  ],
  [
    "fill",
    /* @__PURE__ */ e17.createElement(e17.Fragment, null, /* @__PURE__ */ e17.createElement("path", { d: "M200,32V176a8,8,0,0,1-8,8H104v40a8,8,0,0,1-13.66,5.66l-48-48a8,8,0,0,1,0-11.32l48-48A8,8,0,0,1,104,128v40h80V32a8,8,0,0,1,16,0Z" }))
  ],
  [
    "light",
    /* @__PURE__ */ e17.createElement(e17.Fragment, null, /* @__PURE__ */ e17.createElement("path", { d: "M198,32V176a6,6,0,0,1-6,6H62.49l37.75,37.76a6,6,0,1,1-8.48,8.48l-48-48a6,6,0,0,1,0-8.48l48-48a6,6,0,1,1,8.48,8.48L62.49,170H186V32a6,6,0,0,1,12,0Z" }))
  ],
  [
    "regular",
    /* @__PURE__ */ e17.createElement(e17.Fragment, null, /* @__PURE__ */ e17.createElement("path", { d: "M200,32V176a8,8,0,0,1-8,8H67.31l34.35,34.34a8,8,0,0,1-11.32,11.32l-48-48a8,8,0,0,1,0-11.32l48-48a8,8,0,0,1,11.32,11.32L67.31,168H184V32a8,8,0,0,1,16,0Z" }))
  ],
  [
    "thin",
    /* @__PURE__ */ e17.createElement(e17.Fragment, null, /* @__PURE__ */ e17.createElement("path", { d: "M196,32V176a4,4,0,0,1-4,4H57.66l41.17,41.17a4,4,0,0,1-5.66,5.66l-48-48a4,4,0,0,1,0-5.66l48-48a4,4,0,1,1,5.66,5.66L57.66,172H188V32a4,4,0,0,1,8,0Z" }))
  ]
]);

// node_modules/.pnpm/@phosphor-icons+react@2.1.10_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/@phosphor-icons/react/dist/defs/ArrowSquareOut.es.js
var a13 = __toESM(require_react(), 1);
var e18 = /* @__PURE__ */ new Map([
  [
    "bold",
    /* @__PURE__ */ a13.createElement(a13.Fragment, null, /* @__PURE__ */ a13.createElement("path", { d: "M228,104a12,12,0,0,1-24,0V69l-59.51,59.51a12,12,0,0,1-17-17L187,52H152a12,12,0,0,1,0-24h64a12,12,0,0,1,12,12Zm-44,24a12,12,0,0,0-12,12v64H52V84h64a12,12,0,0,0,0-24H48A20,20,0,0,0,28,80V208a20,20,0,0,0,20,20H176a20,20,0,0,0,20-20V140A12,12,0,0,0,184,128Z" }))
  ],
  [
    "duotone",
    /* @__PURE__ */ a13.createElement(a13.Fragment, null, /* @__PURE__ */ a13.createElement(
      "path",
      {
        d: "M184,80V208a8,8,0,0,1-8,8H48a8,8,0,0,1-8-8V80a8,8,0,0,1,8-8H176A8,8,0,0,1,184,80Z",
        opacity: "0.2"
      }
    ), /* @__PURE__ */ a13.createElement("path", { d: "M224,104a8,8,0,0,1-16,0V59.32l-66.33,66.34a8,8,0,0,1-11.32-11.32L196.68,48H152a8,8,0,0,1,0-16h64a8,8,0,0,1,8,8Zm-40,24a8,8,0,0,0-8,8v72H48V80h72a8,8,0,0,0,0-16H48A16,16,0,0,0,32,80V208a16,16,0,0,0,16,16H176a16,16,0,0,0,16-16V136A8,8,0,0,0,184,128Z" }))
  ],
  [
    "fill",
    /* @__PURE__ */ a13.createElement(a13.Fragment, null, /* @__PURE__ */ a13.createElement("path", { d: "M192,136v72a16,16,0,0,1-16,16H48a16,16,0,0,1-16-16V80A16,16,0,0,1,48,64h72a8,8,0,0,1,0,16H48V208H176V136a8,8,0,0,1,16,0Zm32-96a8,8,0,0,0-8-8H152a8,8,0,0,0-5.66,13.66L172.69,72l-42.35,42.34a8,8,0,0,0,11.32,11.32L184,83.31l26.34,26.35A8,8,0,0,0,224,104Z" }))
  ],
  [
    "light",
    /* @__PURE__ */ a13.createElement(a13.Fragment, null, /* @__PURE__ */ a13.createElement("path", { d: "M222,104a6,6,0,0,1-12,0V54.49l-69.75,69.75a6,6,0,0,1-8.48-8.48L201.51,46H152a6,6,0,0,1,0-12h64a6,6,0,0,1,6,6Zm-38,26a6,6,0,0,0-6,6v72a2,2,0,0,1-2,2H48a2,2,0,0,1-2-2V80a2,2,0,0,1,2-2h72a6,6,0,0,0,0-12H48A14,14,0,0,0,34,80V208a14,14,0,0,0,14,14H176a14,14,0,0,0,14-14V136A6,6,0,0,0,184,130Z" }))
  ],
  [
    "regular",
    /* @__PURE__ */ a13.createElement(a13.Fragment, null, /* @__PURE__ */ a13.createElement("path", { d: "M224,104a8,8,0,0,1-16,0V59.32l-66.33,66.34a8,8,0,0,1-11.32-11.32L196.68,48H152a8,8,0,0,1,0-16h64a8,8,0,0,1,8,8Zm-40,24a8,8,0,0,0-8,8v72H48V80h72a8,8,0,0,0,0-16H48A16,16,0,0,0,32,80V208a16,16,0,0,0,16,16H176a16,16,0,0,0,16-16V136A8,8,0,0,0,184,128Z" }))
  ],
  [
    "thin",
    /* @__PURE__ */ a13.createElement(a13.Fragment, null, /* @__PURE__ */ a13.createElement("path", { d: "M220,104a4,4,0,0,1-8,0V49.66l-73.16,73.17a4,4,0,0,1-5.66-5.66L206.34,44H152a4,4,0,0,1,0-8h64a4,4,0,0,1,4,4Zm-36,28a4,4,0,0,0-4,4v72a4,4,0,0,1-4,4H48a4,4,0,0,1-4-4V80a4,4,0,0,1,4-4h72a4,4,0,0,0,0-8H48A12,12,0,0,0,36,80V208a12,12,0,0,0,12,12H176a12,12,0,0,0,12-12V136A4,4,0,0,0,184,132Z" }))
  ]
]);

// node_modules/.pnpm/@phosphor-icons+react@2.1.10_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/@phosphor-icons/react/dist/defs/Check.es.js
var e19 = __toESM(require_react(), 1);
var a14 = /* @__PURE__ */ new Map([
  [
    "bold",
    /* @__PURE__ */ e19.createElement(e19.Fragment, null, /* @__PURE__ */ e19.createElement("path", { d: "M232.49,80.49l-128,128a12,12,0,0,1-17,0l-56-56a12,12,0,1,1,17-17L96,183,215.51,63.51a12,12,0,0,1,17,17Z" }))
  ],
  [
    "duotone",
    /* @__PURE__ */ e19.createElement(e19.Fragment, null, /* @__PURE__ */ e19.createElement(
      "path",
      {
        d: "M232,56V200a16,16,0,0,1-16,16H40a16,16,0,0,1-16-16V56A16,16,0,0,1,40,40H216A16,16,0,0,1,232,56Z",
        opacity: "0.2"
      }
    ), /* @__PURE__ */ e19.createElement("path", { d: "M205.66,85.66l-96,96a8,8,0,0,1-11.32,0l-40-40a8,8,0,0,1,11.32-11.32L104,164.69l90.34-90.35a8,8,0,0,1,11.32,11.32Z" }))
  ],
  [
    "fill",
    /* @__PURE__ */ e19.createElement(e19.Fragment, null, /* @__PURE__ */ e19.createElement("path", { d: "M216,40H40A16,16,0,0,0,24,56V200a16,16,0,0,0,16,16H216a16,16,0,0,0,16-16V56A16,16,0,0,0,216,40ZM205.66,85.66l-96,96a8,8,0,0,1-11.32,0l-40-40a8,8,0,0,1,11.32-11.32L104,164.69l90.34-90.35a8,8,0,0,1,11.32,11.32Z" }))
  ],
  [
    "light",
    /* @__PURE__ */ e19.createElement(e19.Fragment, null, /* @__PURE__ */ e19.createElement("path", { d: "M228.24,76.24l-128,128a6,6,0,0,1-8.48,0l-56-56a6,6,0,0,1,8.48-8.48L96,191.51,219.76,67.76a6,6,0,0,1,8.48,8.48Z" }))
  ],
  [
    "regular",
    /* @__PURE__ */ e19.createElement(e19.Fragment, null, /* @__PURE__ */ e19.createElement("path", { d: "M229.66,77.66l-128,128a8,8,0,0,1-11.32,0l-56-56a8,8,0,0,1,11.32-11.32L96,188.69,218.34,66.34a8,8,0,0,1,11.32,11.32Z" }))
  ],
  [
    "thin",
    /* @__PURE__ */ e19.createElement(e19.Fragment, null, /* @__PURE__ */ e19.createElement("path", { d: "M226.83,74.83l-128,128a4,4,0,0,1-5.66,0l-56-56a4,4,0,0,1,5.66-5.66L96,194.34,221.17,69.17a4,4,0,1,1,5.66,5.66Z" }))
  ]
]);

// node_modules/.pnpm/@phosphor-icons+react@2.1.10_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/@phosphor-icons/react/dist/defs/Copy.es.js
var a15 = __toESM(require_react(), 1);
var e20 = /* @__PURE__ */ new Map([
  [
    "bold",
    /* @__PURE__ */ a15.createElement(a15.Fragment, null, /* @__PURE__ */ a15.createElement("path", { d: "M216,28H88A12,12,0,0,0,76,40V76H40A12,12,0,0,0,28,88V216a12,12,0,0,0,12,12H168a12,12,0,0,0,12-12V180h36a12,12,0,0,0,12-12V40A12,12,0,0,0,216,28ZM156,204H52V100H156Zm48-48H180V88a12,12,0,0,0-12-12H100V52H204Z" }))
  ],
  [
    "duotone",
    /* @__PURE__ */ a15.createElement(a15.Fragment, null, /* @__PURE__ */ a15.createElement("path", { d: "M216,40V168H168V88H88V40Z", opacity: "0.2" }), /* @__PURE__ */ a15.createElement("path", { d: "M216,32H88a8,8,0,0,0-8,8V80H40a8,8,0,0,0-8,8V216a8,8,0,0,0,8,8H168a8,8,0,0,0,8-8V176h40a8,8,0,0,0,8-8V40A8,8,0,0,0,216,32ZM160,208H48V96H160Zm48-48H176V88a8,8,0,0,0-8-8H96V48H208Z" }))
  ],
  [
    "fill",
    /* @__PURE__ */ a15.createElement(a15.Fragment, null, /* @__PURE__ */ a15.createElement("path", { d: "M216,32H88a8,8,0,0,0-8,8V80H40a8,8,0,0,0-8,8V216a8,8,0,0,0,8,8H168a8,8,0,0,0,8-8V176h40a8,8,0,0,0,8-8V40A8,8,0,0,0,216,32Zm-8,128H176V88a8,8,0,0,0-8-8H96V48H208Z" }))
  ],
  [
    "light",
    /* @__PURE__ */ a15.createElement(a15.Fragment, null, /* @__PURE__ */ a15.createElement("path", { d: "M216,34H88a6,6,0,0,0-6,6V82H40a6,6,0,0,0-6,6V216a6,6,0,0,0,6,6H168a6,6,0,0,0,6-6V174h42a6,6,0,0,0,6-6V40A6,6,0,0,0,216,34ZM162,210H46V94H162Zm48-48H174V88a6,6,0,0,0-6-6H94V46H210Z" }))
  ],
  [
    "regular",
    /* @__PURE__ */ a15.createElement(a15.Fragment, null, /* @__PURE__ */ a15.createElement("path", { d: "M216,32H88a8,8,0,0,0-8,8V80H40a8,8,0,0,0-8,8V216a8,8,0,0,0,8,8H168a8,8,0,0,0,8-8V176h40a8,8,0,0,0,8-8V40A8,8,0,0,0,216,32ZM160,208H48V96H160Zm48-48H176V88a8,8,0,0,0-8-8H96V48H208Z" }))
  ],
  [
    "thin",
    /* @__PURE__ */ a15.createElement(a15.Fragment, null, /* @__PURE__ */ a15.createElement("path", { d: "M216,36H88a4,4,0,0,0-4,4V84H40a4,4,0,0,0-4,4V216a4,4,0,0,0,4,4H168a4,4,0,0,0,4-4V172h44a4,4,0,0,0,4-4V40A4,4,0,0,0,216,36ZM164,212H44V92H164Zm48-48H172V88a4,4,0,0,0-4-4H92V44H212Z" }))
  ]
]);

// node_modules/.pnpm/@phosphor-icons+react@2.1.10_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/@phosphor-icons/react/dist/defs/Microphone.es.js
var a16 = __toESM(require_react(), 1);
var e21 = /* @__PURE__ */ new Map([
  [
    "bold",
    /* @__PURE__ */ a16.createElement(a16.Fragment, null, /* @__PURE__ */ a16.createElement("path", { d: "M128,180a52.06,52.06,0,0,0,52-52V64A52,52,0,0,0,76,64v64A52.06,52.06,0,0,0,128,180ZM100,64a28,28,0,0,1,56,0v64a28,28,0,0,1-56,0Zm40,155.22V240a12,12,0,0,1-24,0V219.22A92.14,92.14,0,0,1,36,128a12,12,0,0,1,24,0,68,68,0,0,0,136,0,12,12,0,0,1,24,0A92.14,92.14,0,0,1,140,219.22Z" }))
  ],
  [
    "duotone",
    /* @__PURE__ */ a16.createElement(a16.Fragment, null, /* @__PURE__ */ a16.createElement(
      "path",
      {
        d: "M168,64v64a40,40,0,0,1-40,40h0a40,40,0,0,1-40-40V64a40,40,0,0,1,40-40h0A40,40,0,0,1,168,64Z",
        opacity: "0.2"
      }
    ), /* @__PURE__ */ a16.createElement("path", { d: "M128,176a48.05,48.05,0,0,0,48-48V64a48,48,0,0,0-96,0v64A48.05,48.05,0,0,0,128,176ZM96,64a32,32,0,0,1,64,0v64a32,32,0,0,1-64,0Zm40,143.6V240a8,8,0,0,1-16,0V207.6A80.11,80.11,0,0,1,48,128a8,8,0,0,1,16,0,64,64,0,0,0,128,0,8,8,0,0,1,16,0A80.11,80.11,0,0,1,136,207.6Z" }))
  ],
  [
    "fill",
    /* @__PURE__ */ a16.createElement(a16.Fragment, null, /* @__PURE__ */ a16.createElement("path", { d: "M80,128V64a48,48,0,0,1,96,0v64a48,48,0,0,1-96,0Zm128,0a8,8,0,0,0-16,0,64,64,0,0,1-128,0,8,8,0,0,0-16,0,80.11,80.11,0,0,0,72,79.6V240a8,8,0,0,0,16,0V207.6A80.11,80.11,0,0,0,208,128Z" }))
  ],
  [
    "light",
    /* @__PURE__ */ a16.createElement(a16.Fragment, null, /* @__PURE__ */ a16.createElement("path", { d: "M128,174a46.06,46.06,0,0,0,46-46V64a46,46,0,0,0-92,0v64A46.06,46.06,0,0,0,128,174ZM94,64a34,34,0,0,1,68,0v64a34,34,0,0,1-68,0Zm40,141.75V240a6,6,0,0,1-12,0V205.75A78.09,78.09,0,0,1,50,128a6,6,0,0,1,12,0,66,66,0,0,0,132,0,6,6,0,0,1,12,0A78.09,78.09,0,0,1,134,205.75Z" }))
  ],
  [
    "regular",
    /* @__PURE__ */ a16.createElement(a16.Fragment, null, /* @__PURE__ */ a16.createElement("path", { d: "M128,176a48.05,48.05,0,0,0,48-48V64a48,48,0,0,0-96,0v64A48.05,48.05,0,0,0,128,176ZM96,64a32,32,0,0,1,64,0v64a32,32,0,0,1-64,0Zm40,143.6V240a8,8,0,0,1-16,0V207.6A80.11,80.11,0,0,1,48,128a8,8,0,0,1,16,0,64,64,0,0,0,128,0,8,8,0,0,1,16,0A80.11,80.11,0,0,1,136,207.6Z" }))
  ],
  [
    "thin",
    /* @__PURE__ */ a16.createElement(a16.Fragment, null, /* @__PURE__ */ a16.createElement("path", { d: "M128,172a44.05,44.05,0,0,0,44-44V64a44,44,0,0,0-88,0v64A44.05,44.05,0,0,0,128,172ZM92,64a36,36,0,0,1,72,0v64a36,36,0,0,1-72,0Zm40,139.89V240a4,4,0,0,1-8,0V203.89A76.09,76.09,0,0,1,52,128a4,4,0,0,1,8,0,68,68,0,0,0,136,0,4,4,0,0,1,8,0A76.09,76.09,0,0,1,132,203.89Z" }))
  ]
]);

// node_modules/.pnpm/@phosphor-icons+react@2.1.10_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/@phosphor-icons/react/dist/defs/MicrophoneSlash.es.js
var a17 = __toESM(require_react(), 1);
var e22 = /* @__PURE__ */ new Map([
  [
    "bold",
    /* @__PURE__ */ a17.createElement(a17.Fragment, null, /* @__PURE__ */ a17.createElement("path", { d: "M56.88,39.93A12,12,0,1,0,39.12,56.07L76,96.64V128a52,52,0,0,0,72.11,48l11.26,12.39A67.34,67.34,0,0,1,128,196a68.07,68.07,0,0,1-68-68,12,12,0,0,0-24,0,92.14,92.14,0,0,0,80,91.22V240a12,12,0,0,0,24,0V219.23a90.39,90.39,0,0,0,35.92-12.68l23.2,25.52a12,12,0,0,0,17.76-16.14ZM128,156a28,28,0,0,1-28-28v-5l29.9,32.89C129.27,156,128.64,156,128,156Zm63-2.42A67.63,67.63,0,0,0,196,128a12,12,0,0,1,24,0,91.48,91.48,0,0,1-6.74,34.61,12,12,0,0,1-22.23-9ZM85.7,33.75A52,52,0,0,1,180,64v56.54a12,12,0,0,1-24,0V64a28,28,0,0,0-50.79-16.28,12,12,0,0,1-19.51-14Z" }))
  ],
  [
    "duotone",
    /* @__PURE__ */ a17.createElement(a17.Fragment, null, /* @__PURE__ */ a17.createElement(
      "path",
      {
        d: "M168,64v64a40,40,0,0,1-40,40h0a40,40,0,0,1-40-40V64a40,40,0,0,1,40-40h0A40,40,0,0,1,168,64Z",
        opacity: "0.2"
      }
    ), /* @__PURE__ */ a17.createElement("path", { d: "M213.92,218.62l-160-176A8,8,0,0,0,42.08,53.38L80,95.09V128a48,48,0,0,0,69.11,43.12l11.1,12.2A63.41,63.41,0,0,1,128,192a64.07,64.07,0,0,1-64-64,8,8,0,0,0-16,0,80.11,80.11,0,0,0,72,79.6V240a8,8,0,0,0,16,0V207.59a78.83,78.83,0,0,0,35.16-12.22l30.92,34a8,8,0,1,0,11.84-10.76ZM128,160a32,32,0,0,1-32-32V112.69l41.66,45.82A32,32,0,0,1,128,160Zm57.52-3.91A63.32,63.32,0,0,0,192,128a8,8,0,0,1,16,0,79.16,79.16,0,0,1-8.11,35.12,8,8,0,0,1-7.19,4.49,7.88,7.88,0,0,1-3.51-.82A8,8,0,0,1,185.52,156.09ZM84,44.87A48,48,0,0,1,176,64v64a49.19,49.19,0,0,1-.26,5,8,8,0,0,1-8,7.17,8.13,8.13,0,0,1-.84,0,8,8,0,0,1-7.12-8.79c.11-1.1.17-2.24.17-3.36V64A32,32,0,0,0,98.64,51.25,8,8,0,1,1,84,44.87Z" }))
  ],
  [
    "fill",
    /* @__PURE__ */ a17.createElement(a17.Fragment, null, /* @__PURE__ */ a17.createElement("path", { d: "M213.38,229.92a8,8,0,0,1-11.3-.54l-30.92-34A78.83,78.83,0,0,1,136,207.59V240a8,8,0,0,1-16,0V207.6A80.11,80.11,0,0,1,48,128a8,8,0,0,1,16,0,64.07,64.07,0,0,0,64,64,63.41,63.41,0,0,0,32.21-8.68l-11.1-12.2A48,48,0,0,1,80,128V95.09L42.08,53.38A8,8,0,0,1,53.92,42.62l160,176A8,8,0,0,1,213.38,229.92Zm-24.19-63.13a7.88,7.88,0,0,0,3.51.82,8,8,0,0,0,7.19-4.49A79.16,79.16,0,0,0,208,128a8,8,0,0,0-16,0,63.32,63.32,0,0,1-6.48,28.09A8,8,0,0,0,189.19,166.79Zm-27.33-29.22A8,8,0,0,0,175.74,133a49.49,49.49,0,0,0,.26-5V64A48,48,0,0,0,84,44.87a8,8,0,0,0,1.41,8.57Z" }))
  ],
  [
    "light",
    /* @__PURE__ */ a17.createElement(a17.Fragment, null, /* @__PURE__ */ a17.createElement("path", { d: "M212.44,220,52.44,44A6,6,0,0,0,43.56,52L82,94.32V128a46,46,0,0,0,67.56,40.64l13.75,15.12A65.26,65.26,0,0,1,128,194a66.08,66.08,0,0,1-66-66,6,6,0,0,0-12,0,78.09,78.09,0,0,0,72,77.75V240a6,6,0,0,0,12,0V205.77a76.93,76.93,0,0,0,37.48-13L203.56,228a6,6,0,0,0,8.88-8.08ZM128,162a34,34,0,0,1-34-34V107.52l47.12,51.84A33.82,33.82,0,0,1,128,162Zm59.32-5A65.38,65.38,0,0,0,194,128a6,6,0,0,1,12,0,77.33,77.33,0,0,1-7.9,34.25A6,6,0,1,1,187.32,157ZM85.8,45.67A46,46,0,0,1,174,64v64a45.17,45.17,0,0,1-.25,4.81,6,6,0,0,1-6,5.38q-.31,0-.63,0a6,6,0,0,1-5.34-6.59A35.41,35.41,0,0,0,162,128V64A34,34,0,0,0,96.8,50.45a6,6,0,0,1-11-4.78Z" }))
  ],
  [
    "regular",
    /* @__PURE__ */ a17.createElement(a17.Fragment, null, /* @__PURE__ */ a17.createElement("path", { d: "M213.92,218.62l-160-176A8,8,0,0,0,42.08,53.38L80,95.09V128a48,48,0,0,0,69.11,43.12l11.1,12.2A63.41,63.41,0,0,1,128,192a64.07,64.07,0,0,1-64-64,8,8,0,0,0-16,0,80.11,80.11,0,0,0,72,79.6V240a8,8,0,0,0,16,0V207.59a78.83,78.83,0,0,0,35.16-12.22l30.92,34a8,8,0,1,0,11.84-10.76ZM128,160a32,32,0,0,1-32-32V112.69l41.66,45.82A32,32,0,0,1,128,160Zm57.52-3.91A63.32,63.32,0,0,0,192,128a8,8,0,0,1,16,0,79.16,79.16,0,0,1-8.11,35.12,8,8,0,0,1-7.19,4.49,7.88,7.88,0,0,1-3.51-.82A8,8,0,0,1,185.52,156.09ZM84,44.87A48,48,0,0,1,176,64v64a49.19,49.19,0,0,1-.26,5,8,8,0,0,1-8,7.17,8.13,8.13,0,0,1-.84,0,8,8,0,0,1-7.12-8.79c.11-1.1.17-2.24.17-3.36V64A32,32,0,0,0,98.64,51.25,8,8,0,1,1,84,44.87Z" }))
  ],
  [
    "thin",
    /* @__PURE__ */ a17.createElement(a17.Fragment, null, /* @__PURE__ */ a17.createElement("path", { d: "M211,221.31,51,45.31A4,4,0,0,0,45,50.69L84,93.55V128a44,44,0,0,0,66,38.12l16.38,18A67.21,67.21,0,0,1,128,196a68.07,68.07,0,0,1-68-68,4,4,0,0,0-8,0,76.09,76.09,0,0,0,72,75.89V240a4,4,0,0,0,8,0V203.89a75.1,75.1,0,0,0,39.79-13.77L205,226.69a4,4,0,1,0,5.92-5.38ZM128,164a36,36,0,0,1-36-36V102.35L144.43,160A35.83,35.83,0,0,1,128,164Zm61.12-6.15A67.44,67.44,0,0,0,196,128a4,4,0,0,1,8,0,75.28,75.28,0,0,1-7.7,33.37,4,4,0,0,1-7.18-3.52ZM87.63,46.46A44,44,0,0,1,172,64v64a44.2,44.2,0,0,1-.24,4.61,4,4,0,0,1-4,3.58l-.42,0a4,4,0,0,1-3.57-4.39A36.67,36.67,0,0,0,164,128V64A36,36,0,0,0,95,49.66a4,4,0,0,1-7.34-3.2Z" }))
  ]
]);

// node_modules/.pnpm/@phosphor-icons+react@2.1.10_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/@phosphor-icons/react/dist/defs/PhoneDisconnect.es.js
var a18 = __toESM(require_react(), 1);
var l2 = /* @__PURE__ */ new Map([
  [
    "bold",
    /* @__PURE__ */ a18.createElement(a18.Fragment, null, /* @__PURE__ */ a18.createElement("path", { d: "M234.39,87.29c-57.67-57.72-155.11-57.72-212.78,0-21.45,21.47-23.52,53.13-5,77a20,20,0,0,0,22.92,6.37L88.4,153.29l.45-.16A20,20,0,0,0,101,138.47l5.44-27.24a72.48,72.48,0,0,1,42.76-.09L155,138.62a20,20,0,0,0,12.14,14.49l.45.17,48.94,17.37a20,20,0,0,0,22.91-6.37C257.91,140.42,255.84,108.76,234.39,87.29Zm-12.23,59.9L178,131.5,172.24,104a20,20,0,0,0-13-14.8,96.49,96.49,0,0,0-62.94.14A20,20,0,0,0,83.4,104.24L78,131.53,33.84,147.19c-9.16-13.85-7.41-30.77,4.73-42.92C62.81,80,95.41,67.88,128,67.88S193.19,80,217.43,104.27C229.57,116.42,231.32,133.35,222.16,147.19ZM228,200a12,12,0,0,1-12,12H40a12,12,0,0,1,0-24H216A12,12,0,0,1,228,200Z" }))
  ],
  [
    "duotone",
    /* @__PURE__ */ a18.createElement(a18.Fragment, null, /* @__PURE__ */ a18.createElement(
      "path",
      {
        d: "M230,157a8,8,0,0,1-9.26,2.47L171.58,142a8,8,0,0,1-4.86-5.8l-6.21-29.74a7.94,7.94,0,0,0-5.14-5.9,84.39,84.39,0,0,0-55.1.13,7.93,7.93,0,0,0-5.12,6l-5.9,29.51A8,8,0,0,1,84.38,142L35.29,159.42A8,8,0,0,1,26,157c-14.6-18.83-13.26-43.83,4-61.12,53.11-53.11,142.77-53.11,195.88,0C243.23,113.12,244.57,138.12,230,157Z",
        opacity: "0.2"
      }
    ), /* @__PURE__ */ a18.createElement("path", { d: "M231.59,90.13h0C175.44,34,80.56,34,24.41,90.13c-20,20-21.92,49.49-4.69,71.71A16,16,0,0,0,32.35,168a15.8,15.8,0,0,0,5.75-1.08l49-17.37.29-.11a16,16,0,0,0,9.75-11.73l5.9-29.52a76.52,76.52,0,0,1,49.68-.11h0l6.21,29.75a16,16,0,0,0,9.72,11.59l.29.11,49,17.39a16,16,0,0,0,18.38-5.06C253.51,139.62,251.58,110.13,231.59,90.13ZM223.67,152l-.3-.12-48.82-17.33-6.21-29.74A16,16,0,0,0,158,93a92.56,92.56,0,0,0-60.34.13,16,16,0,0,0-10.32,12l-5.9,29.51L32.63,151.86c-.1,0-.17.13-.27.17-12.33-15.91-11-36.23,3.36-50.58,25-25,58.65-37.53,92.28-37.53s67.27,12.51,92.28,37.53C234.61,115.8,236,136.12,223.67,152Zm.32,48a8,8,0,0,1-8,8H40a8,8,0,0,1,0-16H216A8,8,0,0,1,224,200Z" }))
  ],
  [
    "fill",
    /* @__PURE__ */ a18.createElement(a18.Fragment, null, /* @__PURE__ */ a18.createElement("path", { d: "M236.28,161.84a16,16,0,0,1-18.38,5.06l-49-17.39-.29-.11a16,16,0,0,1-9.72-11.59l-6.21-29.75h0a76.52,76.52,0,0,0-49.68.11l-5.9,29.52a16,16,0,0,1-9.75,11.73l-.29.11-49,17.37A15.8,15.8,0,0,1,32.35,168a16,16,0,0,1-12.63-6.14c-17.23-22.22-15.3-51.71,4.69-71.71,56.15-56.17,151-56.17,207.18,0h0C251.58,110.13,253.51,139.62,236.28,161.84ZM216,192H40a8,8,0,0,0,0,16H216a8,8,0,0,0,0-16Z" }))
  ],
  [
    "light",
    /* @__PURE__ */ a18.createElement(a18.Fragment, null, /* @__PURE__ */ a18.createElement("path", { d: "M230.19,91.55h0c-55.39-55.4-149-55.4-204.38,0C6.56,110.82,4.7,139.22,21.29,160.61A14,14,0,0,0,37.39,165l49-17.38.22-.09a13.93,13.93,0,0,0,8.53-10.25l5.9-29.52a1.93,1.93,0,0,1,1.21-1.47,78.53,78.53,0,0,1,51.18-.11,1.93,1.93,0,0,1,1.22,1.45l6.21,29.75a14,14,0,0,0,8.5,10.14l.23.08,49,17.4a14,14,0,0,0,16.1-4.42C251.3,139.22,249.44,110.82,230.19,91.55Zm-5,61.71a2,2,0,0,1-2.29.58l-.22-.09-49-17.38A2,2,0,0,1,172.6,135l-6.22-29.74a14,14,0,0,0-9.06-10.35,90.53,90.53,0,0,0-59,.13,14,14,0,0,0-9,10.45L83.37,135a2,2,0,0,1-1.15,1.44L33.28,153.75l-.22.09a2,2,0,0,1-2.29-.58c-13-16.74-11.56-38.12,3.53-53.22,25.39-25.4,59.55-38.1,93.7-38.1s68.31,12.7,93.7,38.1C236.79,115.14,238.21,136.52,225.23,153.26ZM222,200a6,6,0,0,1-6,6H40a6,6,0,0,1,0-12H216A6,6,0,0,1,222,200Z" }))
  ],
  [
    "regular",
    /* @__PURE__ */ a18.createElement(a18.Fragment, null, /* @__PURE__ */ a18.createElement("path", { d: "M231.59,90.13h0C175.44,34,80.56,34,24.41,90.13c-20,20-21.92,49.49-4.69,71.71A16,16,0,0,0,32.35,168a15.8,15.8,0,0,0,5.75-1.08l49-17.37.29-.11a16,16,0,0,0,9.75-11.73l5.9-29.52a76.52,76.52,0,0,1,49.68-.11h0l6.21,29.75a16,16,0,0,0,9.72,11.59l.29.11,49,17.39a16,16,0,0,0,18.38-5.06C253.51,139.62,251.58,110.13,231.59,90.13ZM223.67,152l-.3-.12-48.82-17.33-6.21-29.74A16,16,0,0,0,158,93a92.56,92.56,0,0,0-60.34.13,16,16,0,0,0-10.32,12l-5.9,29.51L32.63,151.86c-.1,0-.17.13-.27.17-12.33-15.91-11-36.23,3.36-50.58,25-25,58.65-37.53,92.28-37.53s67.27,12.51,92.28,37.53C234.61,115.8,236,136.12,223.67,152Zm.32,48a8,8,0,0,1-8,8H40a8,8,0,0,1,0-16H216A8,8,0,0,1,224,200Z" }))
  ],
  [
    "thin",
    /* @__PURE__ */ a18.createElement(a18.Fragment, null, /* @__PURE__ */ a18.createElement("path", { d: "M228.79,93C174.15,38.34,81.85,38.34,27.21,93,8.69,111.5,6.9,138.81,22.85,159.39a12,12,0,0,0,13.83,3.77l49-17.39.15-.06a12,12,0,0,0,7.31-8.79l5.9-29.51a3.93,3.93,0,0,1,2.51-3,80.59,80.59,0,0,1,52.5-.12,3.94,3.94,0,0,1,2.52,2.94L162.81,137a12,12,0,0,0,7.29,8.69l.15.06,49.07,17.41a12,12,0,0,0,13.83-3.77C249.1,138.81,247.31,111.5,228.79,93Zm-2,61.51a4,4,0,0,1-4.61,1.21l-.15-.06L173,138.24a4,4,0,0,1-2.37-2.87l-6.21-29.75a12,12,0,0,0-7.75-8.87,88.63,88.63,0,0,0-57.74.14,12,12,0,0,0-7.72,9l-5.9,29.51A4,4,0,0,1,83,138.26l-49,17.38-.15.06a4,4,0,0,1-4.61-1.21c-13.42-17.3-11.9-40.26,3.69-55.85C58.65,72.85,93.33,60,128,60s69.35,12.89,95.13,38.68C238.71,114.23,240.24,137.19,226.82,154.49ZM220,200a4,4,0,0,1-4,4H40a4,4,0,0,1,0-8H216A4,4,0,0,1,220,200Z" }))
  ]
]);

// node_modules/.pnpm/@phosphor-icons+react@2.1.10_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/@phosphor-icons/react/dist/defs/Question.es.js
var e23 = __toESM(require_react(), 1);
var a19 = /* @__PURE__ */ new Map([
  [
    "bold",
    /* @__PURE__ */ e23.createElement(e23.Fragment, null, /* @__PURE__ */ e23.createElement("path", { d: "M144,180a16,16,0,1,1-16-16A16,16,0,0,1,144,180Zm92-52A108,108,0,1,1,128,20,108.12,108.12,0,0,1,236,128Zm-24,0a84,84,0,1,0-84,84A84.09,84.09,0,0,0,212,128ZM128,64c-24.26,0-44,17.94-44,40v4a12,12,0,0,0,24,0v-4c0-8.82,9-16,20-16s20,7.18,20,16-9,16-20,16a12,12,0,0,0-12,12v8a12,12,0,0,0,23.73,2.56C158.31,137.88,172,122.37,172,104,172,81.94,152.26,64,128,64Z" }))
  ],
  [
    "duotone",
    /* @__PURE__ */ e23.createElement(e23.Fragment, null, /* @__PURE__ */ e23.createElement("path", { d: "M224,128a96,96,0,1,1-96-96A96,96,0,0,1,224,128Z", opacity: "0.2" }), /* @__PURE__ */ e23.createElement("path", { d: "M140,180a12,12,0,1,1-12-12A12,12,0,0,1,140,180ZM128,72c-22.06,0-40,16.15-40,36v4a8,8,0,0,0,16,0v-4c0-11,10.77-20,24-20s24,9,24,20-10.77,20-24,20a8,8,0,0,0-8,8v8a8,8,0,0,0,16,0v-.72c18.24-3.35,32-17.9,32-35.28C168,88.15,150.06,72,128,72Zm104,56A104,104,0,1,1,128,24,104.11,104.11,0,0,1,232,128Zm-16,0a88,88,0,1,0-88,88A88.1,88.1,0,0,0,216,128Z" }))
  ],
  [
    "fill",
    /* @__PURE__ */ e23.createElement(e23.Fragment, null, /* @__PURE__ */ e23.createElement("path", { d: "M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,168a12,12,0,1,1,12-12A12,12,0,0,1,128,192Zm8-48.72V144a8,8,0,0,1-16,0v-8a8,8,0,0,1,8-8c13.23,0,24-9,24-20s-10.77-20-24-20-24,9-24,20v4a8,8,0,0,1-16,0v-4c0-19.85,17.94-36,40-36s40,16.15,40,36C168,125.38,154.24,139.93,136,143.28Z" }))
  ],
  [
    "light",
    /* @__PURE__ */ e23.createElement(e23.Fragment, null, /* @__PURE__ */ e23.createElement("path", { d: "M138,180a10,10,0,1,1-10-10A10,10,0,0,1,138,180ZM128,74c-21,0-38,15.25-38,34v4a6,6,0,0,0,12,0v-4c0-12.13,11.66-22,26-22s26,9.87,26,22-11.66,22-26,22a6,6,0,0,0-6,6v8a6,6,0,0,0,12,0v-2.42c18.11-2.58,32-16.66,32-33.58C166,89.25,149,74,128,74Zm102,54A102,102,0,1,1,128,26,102.12,102.12,0,0,1,230,128Zm-12,0a90,90,0,1,0-90,90A90.1,90.1,0,0,0,218,128Z" }))
  ],
  [
    "regular",
    /* @__PURE__ */ e23.createElement(e23.Fragment, null, /* @__PURE__ */ e23.createElement("path", { d: "M140,180a12,12,0,1,1-12-12A12,12,0,0,1,140,180ZM128,72c-22.06,0-40,16.15-40,36v4a8,8,0,0,0,16,0v-4c0-11,10.77-20,24-20s24,9,24,20-10.77,20-24,20a8,8,0,0,0-8,8v8a8,8,0,0,0,16,0v-.72c18.24-3.35,32-17.9,32-35.28C168,88.15,150.06,72,128,72Zm104,56A104,104,0,1,1,128,24,104.11,104.11,0,0,1,232,128Zm-16,0a88,88,0,1,0-88,88A88.1,88.1,0,0,0,216,128Z" }))
  ],
  [
    "thin",
    /* @__PURE__ */ e23.createElement(e23.Fragment, null, /* @__PURE__ */ e23.createElement("path", { d: "M136,180a8,8,0,1,1-8-8A8,8,0,0,1,136,180ZM128,76c-19.85,0-36,14.36-36,32v4a4,4,0,0,0,8,0v-4c0-13.23,12.56-24,28-24s28,10.77,28,24-12.56,24-28,24a4,4,0,0,0-4,4v8a4,4,0,0,0,8,0v-4.2c18-1.77,32-15.36,32-31.8C164,90.36,147.85,76,128,76Zm100,52A100,100,0,1,1,128,28,100.11,100.11,0,0,1,228,128Zm-8,0a92,92,0,1,0-92,92A92.1,92.1,0,0,0,220,128Z" }))
  ]
]);

// node_modules/.pnpm/@phosphor-icons+react@2.1.10_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/@phosphor-icons/react/dist/defs/WarningCircle.es.js
var e24 = __toESM(require_react(), 1);
var a20 = /* @__PURE__ */ new Map([
  [
    "bold",
    /* @__PURE__ */ e24.createElement(e24.Fragment, null, /* @__PURE__ */ e24.createElement("path", { d: "M128,20A108,108,0,1,0,236,128,108.12,108.12,0,0,0,128,20Zm0,192a84,84,0,1,1,84-84A84.09,84.09,0,0,1,128,212Zm-12-80V80a12,12,0,0,1,24,0v52a12,12,0,0,1-24,0Zm28,40a16,16,0,1,1-16-16A16,16,0,0,1,144,172Z" }))
  ],
  [
    "duotone",
    /* @__PURE__ */ e24.createElement(e24.Fragment, null, /* @__PURE__ */ e24.createElement("path", { d: "M224,128a96,96,0,1,1-96-96A96,96,0,0,1,224,128Z", opacity: "0.2" }), /* @__PURE__ */ e24.createElement("path", { d: "M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216Zm-8-80V80a8,8,0,0,1,16,0v56a8,8,0,0,1-16,0Zm20,36a12,12,0,1,1-12-12A12,12,0,0,1,140,172Z" }))
  ],
  [
    "fill",
    /* @__PURE__ */ e24.createElement(e24.Fragment, null, /* @__PURE__ */ e24.createElement("path", { d: "M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm-8,56a8,8,0,0,1,16,0v56a8,8,0,0,1-16,0Zm8,104a12,12,0,1,1,12-12A12,12,0,0,1,128,184Z" }))
  ],
  [
    "light",
    /* @__PURE__ */ e24.createElement(e24.Fragment, null, /* @__PURE__ */ e24.createElement("path", { d: "M128,26A102,102,0,1,0,230,128,102.12,102.12,0,0,0,128,26Zm0,192a90,90,0,1,1,90-90A90.1,90.1,0,0,1,128,218Zm-6-82V80a6,6,0,0,1,12,0v56a6,6,0,0,1-12,0Zm16,36a10,10,0,1,1-10-10A10,10,0,0,1,138,172Z" }))
  ],
  [
    "regular",
    /* @__PURE__ */ e24.createElement(e24.Fragment, null, /* @__PURE__ */ e24.createElement("path", { d: "M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216Zm-8-80V80a8,8,0,0,1,16,0v56a8,8,0,0,1-16,0Zm20,36a12,12,0,1,1-12-12A12,12,0,0,1,140,172Z" }))
  ],
  [
    "thin",
    /* @__PURE__ */ e24.createElement(e24.Fragment, null, /* @__PURE__ */ e24.createElement("path", { d: "M128,28A100,100,0,1,0,228,128,100.11,100.11,0,0,0,128,28Zm0,192a92,92,0,1,1,92-92A92.1,92.1,0,0,1,128,220Zm-4-84V80a4,4,0,0,1,8,0v56a4,4,0,0,1-8,0Zm12,36a8,8,0,1,1-8-8A8,8,0,0,1,136,172Z" }))
  ]
]);

// node_modules/.pnpm/@phosphor-icons+react@2.1.10_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/@phosphor-icons/react/dist/defs/X.es.js
var e25 = __toESM(require_react(), 1);
var a21 = /* @__PURE__ */ new Map([
  [
    "bold",
    /* @__PURE__ */ e25.createElement(e25.Fragment, null, /* @__PURE__ */ e25.createElement("path", { d: "M208.49,191.51a12,12,0,0,1-17,17L128,145,64.49,208.49a12,12,0,0,1-17-17L111,128,47.51,64.49a12,12,0,0,1,17-17L128,111l63.51-63.52a12,12,0,0,1,17,17L145,128Z" }))
  ],
  [
    "duotone",
    /* @__PURE__ */ e25.createElement(e25.Fragment, null, /* @__PURE__ */ e25.createElement(
      "path",
      {
        d: "M216,56V200a16,16,0,0,1-16,16H56a16,16,0,0,1-16-16V56A16,16,0,0,1,56,40H200A16,16,0,0,1,216,56Z",
        opacity: "0.2"
      }
    ), /* @__PURE__ */ e25.createElement("path", { d: "M205.66,194.34a8,8,0,0,1-11.32,11.32L128,139.31,61.66,205.66a8,8,0,0,1-11.32-11.32L116.69,128,50.34,61.66A8,8,0,0,1,61.66,50.34L128,116.69l66.34-66.35a8,8,0,0,1,11.32,11.32L139.31,128Z" }))
  ],
  [
    "fill",
    /* @__PURE__ */ e25.createElement(e25.Fragment, null, /* @__PURE__ */ e25.createElement("path", { d: "M208,32H48A16,16,0,0,0,32,48V208a16,16,0,0,0,16,16H208a16,16,0,0,0,16-16V48A16,16,0,0,0,208,32ZM181.66,170.34a8,8,0,0,1-11.32,11.32L128,139.31,85.66,181.66a8,8,0,0,1-11.32-11.32L116.69,128,74.34,85.66A8,8,0,0,1,85.66,74.34L128,116.69l42.34-42.35a8,8,0,0,1,11.32,11.32L139.31,128Z" }))
  ],
  [
    "light",
    /* @__PURE__ */ e25.createElement(e25.Fragment, null, /* @__PURE__ */ e25.createElement("path", { d: "M204.24,195.76a6,6,0,1,1-8.48,8.48L128,136.49,60.24,204.24a6,6,0,0,1-8.48-8.48L119.51,128,51.76,60.24a6,6,0,0,1,8.48-8.48L128,119.51l67.76-67.75a6,6,0,0,1,8.48,8.48L136.49,128Z" }))
  ],
  [
    "regular",
    /* @__PURE__ */ e25.createElement(e25.Fragment, null, /* @__PURE__ */ e25.createElement("path", { d: "M205.66,194.34a8,8,0,0,1-11.32,11.32L128,139.31,61.66,205.66a8,8,0,0,1-11.32-11.32L116.69,128,50.34,61.66A8,8,0,0,1,61.66,50.34L128,116.69l66.34-66.35a8,8,0,0,1,11.32,11.32L139.31,128Z" }))
  ],
  [
    "thin",
    /* @__PURE__ */ e25.createElement(e25.Fragment, null, /* @__PURE__ */ e25.createElement("path", { d: "M202.83,197.17a4,4,0,0,1-5.66,5.66L128,133.66,58.83,202.83a4,4,0,0,1-5.66-5.66L122.34,128,53.17,58.83a4,4,0,0,1,5.66-5.66L128,122.34l69.17-69.17a4,4,0,1,1,5.66,5.66L133.66,128Z" }))
  ]
]);

// node_modules/.pnpm/@phosphor-icons+react@2.1.10_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/@phosphor-icons/react/dist/csr/ArrowElbowDownLeft.es.js
var o11 = __toESM(require_react(), 1);
var r4 = o11.forwardRef((e34, t2) => /* @__PURE__ */ o11.createElement(p, { ref: t2, ...e34, weights: a12 }));
r4.displayName = "ArrowElbowDownLeftIcon";

// node_modules/.pnpm/@phosphor-icons+react@2.1.10_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/@phosphor-icons/react/dist/csr/ArrowSquareOut.es.js
var r5 = __toESM(require_react(), 1);
var o12 = r5.forwardRef((e34, t2) => /* @__PURE__ */ r5.createElement(p, { ref: t2, ...e34, weights: e18 }));
o12.displayName = "ArrowSquareOutIcon";

// node_modules/.pnpm/@phosphor-icons+react@2.1.10_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/@phosphor-icons/react/dist/csr/Check.es.js
var e26 = __toESM(require_react(), 1);
var o13 = e26.forwardRef((c3, r7) => /* @__PURE__ */ e26.createElement(p, { ref: r7, ...c3, weights: a14 }));
o13.displayName = "CheckIcon";

// node_modules/.pnpm/@phosphor-icons+react@2.1.10_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/@phosphor-icons/react/dist/csr/Copy.es.js
var o14 = __toESM(require_react(), 1);
var e27 = o14.forwardRef((r7, t2) => /* @__PURE__ */ o14.createElement(p, { ref: t2, ...r7, weights: e20 }));
e27.displayName = "CopyIcon";

// node_modules/.pnpm/@phosphor-icons+react@2.1.10_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/@phosphor-icons/react/dist/csr/Microphone.es.js
var o15 = __toESM(require_react(), 1);
var e28 = o15.forwardRef((r7, c3) => /* @__PURE__ */ o15.createElement(p, { ref: c3, ...r7, weights: e21 }));
e28.displayName = "MicrophoneIcon";

// node_modules/.pnpm/@phosphor-icons+react@2.1.10_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/@phosphor-icons/react/dist/csr/MicrophoneSlash.es.js
var o16 = __toESM(require_react(), 1);
var e29 = o16.forwardRef((r7, a22) => /* @__PURE__ */ o16.createElement(p, { ref: a22, ...r7, weights: e22 }));
e29.displayName = "MicrophoneSlashIcon";

// node_modules/.pnpm/@phosphor-icons+react@2.1.10_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/@phosphor-icons/react/dist/csr/PhoneDisconnect.es.js
var o17 = __toESM(require_react(), 1);
var e30 = o17.forwardRef((n9, c3) => /* @__PURE__ */ o17.createElement(p, { ref: c3, ...n9, weights: l2 }));
e30.displayName = "PhoneDisconnectIcon";

// node_modules/.pnpm/@phosphor-icons+react@2.1.10_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/@phosphor-icons/react/dist/csr/Question.es.js
var o18 = __toESM(require_react(), 1);
var e31 = o18.forwardRef((t2, r7) => /* @__PURE__ */ o18.createElement(p, { ref: r7, ...t2, weights: a19 }));
e31.displayName = "QuestionIcon";

// node_modules/.pnpm/@phosphor-icons+react@2.1.10_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/@phosphor-icons/react/dist/csr/WarningCircle.es.js
var r6 = __toESM(require_react(), 1);
var e32 = r6.forwardRef((o20, n9) => /* @__PURE__ */ r6.createElement(p, { ref: n9, ...o20, weights: a20 }));
e32.displayName = "WarningCircleIcon";

// node_modules/.pnpm/@phosphor-icons+react@2.1.10_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/@phosphor-icons/react/dist/csr/X.es.js
var o19 = __toESM(require_react(), 1);
var e33 = o19.forwardRef((r7, t2) => /* @__PURE__ */ o19.createElement(p, { ref: t2, ...r7, weights: a21 }));
e33.displayName = "XIcon";

// mockups/voice/before/source/dialog-focus.ts
var import_react2 = __toESM(require_react(), 1);
var FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "a[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])"
].join(",");
function useDialogFocus(dialogRef, onEscape) {
  const onEscapeRef = (0, import_react2.useRef)(onEscape);
  const returnFocusRef = (0, import_react2.useRef)(
    document.activeElement instanceof HTMLElement ? document.activeElement : null
  );
  (0, import_react2.useEffect)(() => {
    onEscapeRef.current = onEscape;
  }, [onEscape]);
  (0, import_react2.useEffect)(() => {
    const returnFocus = returnFocusRef.current;
    const dialog = dialogRef.current;
    const initialFocus = dialog?.querySelector("[data-modal-initial-focus]") ?? dialog?.querySelector("[role='tab'][aria-selected='true']") ?? dialog?.querySelector(FOCUSABLE_SELECTOR) ?? dialog;
    initialFocus?.focus();
    const onKey = (event) => {
      if (event.key === "Escape") {
        const handler = onEscapeRef.current;
        if (!handler) return;
        event.preventDefault();
        handler();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = Array.from(dialog.querySelectorAll(FOCUSABLE_SELECTOR)).filter(
        (element) => !element.hidden && element.getAttribute("aria-hidden") !== "true"
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      returnFocus?.focus();
    };
  }, [dialogRef]);
}

export {
  require_react_dom,
  r4 as r,
  o12 as o,
  r2,
  o3 as o2,
  o13 as o3,
  e5 as e,
  e27 as e2,
  o5 as o4,
  e9 as e3,
  a7 as a,
  e12 as e4,
  e28 as e5,
  e29 as e6,
  a10 as a2,
  e30 as e7,
  r3,
  e31 as e8,
  n,
  e32 as e9,
  e33 as e10,
  useDialogFocus
};
/*! Bundled license information:

react-dom/cjs/react-dom.development.js:
  (**
   * @license React
   * react-dom.development.js
   *
   * Copyright (c) Meta Platforms, Inc. and affiliates.
   *
   * This source code is licensed under the MIT license found in the
   * LICENSE file in the root directory of this source tree.
   *)
*/
