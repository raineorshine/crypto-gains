import argv from './argv.js'

/** Logs info to the console. */
const log = (...args: unknown[]) => console.info(...args)

/** Logs a warning to the console. */
log.warn = (...args: unknown[]) => console.warn(...args)

/** Logs an error to the console. */
log.error = (...args: unknown[]) => console.error(...args)

/** Logs info to the console if argv.verbose is true. */
const verbose = (...args: unknown[]) => argv.verbose && console.info(...args)

/** Logs a warning to the console if argv.verbose is true. */
verbose.warn = (...args: unknown[]) => argv.verbose && console.warn(...args)

/** Logs an error to the console if argv.verbose is true. */
verbose.error = (...args: unknown[]) => argv.verbose && console.error(...args)

log.verbose = verbose

export default log
