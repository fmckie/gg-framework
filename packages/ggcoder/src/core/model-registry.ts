// Moved to @kleio/core. This shim re-exports it so existing relative
// imports (`./model-registry.js`) and the `@kleio/coder/models` subpath
// export keep resolving unchanged.
export * from "@kleio/core/models";
