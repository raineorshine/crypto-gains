import yargs from 'yargs'
import Ticker from './@types/Ticker.js'

const argv = await yargs(process.argv.slice(2))
  .usage('Usage: $0 <input> [options]')
  .demandCommand(1)
  .option('accounting', { default: 'fifo', describe: 'Accounting type: fifo/lifo.' })
  .option('trace', {
    describe: 'Log all transactions and rolling balances of token.',
  })
  .option('likekind', { default: true, describe: 'Allow like-kind exchange before 2018.' })
  .option('limit', { default: Infinity, describe: 'Limit number of transactions processed.' })
  .option('output', { describe: 'Output directory for results.' })
  .option('verbose', { describe: 'Show more errors and warnings.' }).argv

/** Parses the trace argument into an arrow of Tickers */
const parseTrace = (value: string | string[] | undefined): Ticker[] => {
  const tickers = typeof value === 'string' ? [value] : value
  const tickersUpperCase = (tickers ?? []).flatMap(s => s.split(',')).map(s => s.toUpperCase())
  return tickersUpperCase as Ticker[]
}

const argvParsed = {
  ...argv,
  trace: parseTrace(argv.trace as string | string[]),
}

export default argvParsed
