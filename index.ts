// opencode-morph-fast-apply — plugin ENTRY module.
//
// The entry module exports EXACTLY ONE thing: default, a dual plugin object
// shaped `{ id, setup, server }`:
//
// - OpenCode V2 decodes the default export as a Promise plugin `{ id, setup }`
//   and runs `setup` (the extra `server` key is an ignored excess property).
// - OpenCode V1 (1.18.29+) reads the default export as a `{ server }` adapter
//   and calls `server(input)` for its hooks object. Older V1 loaders only
//   invoke function-valued exports, so the object export is skipped and the
//   plugin does not load there (documented in README).
//
// Each loader registers exactly one morph_edit. Never add function-valued
// NAMED exports to this entry module: OpenCode inspects only the entry file's
// exports, and function-valued exports get invoked as plugin factories by
// loaders that fall through to the legacy export scan. All implementation and
// named (test) exports live in impl.ts, pulled in as a normal transitive
// import.
import morphFastApplyPlugin from "./impl.js";

export default morphFastApplyPlugin;
