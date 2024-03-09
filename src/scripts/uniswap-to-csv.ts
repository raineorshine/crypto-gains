import fs from 'fs/promises'
import json2csv from 'json2csv'
import yargs from 'yargs/yargs'
import Transaction from '../@types/Transaction.js'
import UniswapTrade from '../@types/UniswapTrade.js'

const argv = await yargs(process.argv.slice(2)).usage('Usage: $0 <uniswap.json>').demandCommand(1).argv
const filename = argv._[0] as string
const file = await fs.readFile(filename, 'utf-8')
const json = JSON.parse(file) as UniswapTrade[]

const transactions: Transaction[] = json.map(txRaw => ({
  date: txRaw.date,
  dateAcquired: txRaw.date,
  from: txRaw.from.currency.symbol,
  cost: +txRaw.from.amount,
  buy: +txRaw.to.amount,
  buyCur: txRaw.to.currency.symbol,
}))

const csv = json2csv.parse(transactions, {
  delimiter: ',',
  fields: [
    { value: 'date', label: 'Date Exchanged' },
    { value: 'dateAcquired', label: 'Date Purchased' },
    { value: 'sell', label: 'From Amount' },
    { value: 'sellCur', label: 'From Asset' },
    { value: 'buy', label: 'To Amount' },
    { value: 'buyCur', label: 'To Asset' },
    { value: 'cost', label: 'Cost Basis (USD)' },
    { value: 'deferredGains', label: 'Deferred Gains (USD)' },
  ],
})

console.info(csv)
