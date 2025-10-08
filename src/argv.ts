import yargs from 'yargs'

const argv = await yargs(process.argv.slice(2))
  .usage('Usage: $0 <input> [options]')
  .demandCommand(1)
  .option('accounting', { default: 'fifo', describe: 'Accounting type: fifo/lifo.' })
  .option('trace', {
    describe: 'Print all transactions and rolling balances involving a specific token.',
    type: 'string',
  })
  .option('likekind', { default: true, describe: 'Allow like-kind exchange before 2018.' })
  .option('limit', { default: Infinity, describe: 'Limit number of transactions processed.' })
  .option('output', { describe: 'Output directory for results.' })
  .option('verbose', { describe: 'Show more errors and warnings.' }).argv

export default argv
