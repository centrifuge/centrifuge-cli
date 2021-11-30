#!/usr/bin/env node

// import oclif from "@oclif/core";
// import handle from "@oclif/errors";

// oclif.run(void 0, import.meta.url)
//     .then(oclif.flush)
//     .catch(handle);
//import command from "@oclif/command";
import oclif from "@oclif/core"

oclif.command.run().then( import("@oclif/command/flush.js")).catch(import('@oclif/errors/handle.js'))

// require('@oclif/command').run()
//     .then(require('@oclif/command/flush'))
//     .catch(require('@oclif/errors/handle'))
