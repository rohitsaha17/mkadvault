// Empty CommonJS module used by next.config.ts's
// NormalModuleReplacementPlugin to neutralise pptxgenjs's
// `node:fs` / `node:https` / `node:http` imports on the client
// bundle. None of those modules are reachable from the code paths
// the browser actually executes — we just need a buildable stub.
module.exports = {};
