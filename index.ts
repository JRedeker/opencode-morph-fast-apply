// opencode-morph-fast-apply — plugin ENTRY module.
//
// OpenCode 1.18.4+ invokes EVERY function-valued export of a plugin entry
// module as a plugin factory: its loader iterates Object.values(entryModule)
// and calls each export with the PluginInput. This module previously also
// exported helper functions (scrubSecrets, callMorphApply), which OpenCode
// then invoked as bogus factories — non-throwing here (they returned a string /
// result object), so it produced no load error, but it silently registered
// garbage "plugins" alongside the real one.
//
// Therefore the entry module exports EXACTLY ONE thing: default. All
// implementation and its named (test) exports live in impl.ts, pulled in as a
// normal transitive import — OpenCode only inspects the entry file's exports.
import MorphFastApply from "./impl.js";

export default MorphFastApply;
