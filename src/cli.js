const csvtojson = require('csvtojson')
const fs = require('fs')
const json2csv = require('json2csv')
const mkdir = require('make-dir')
const path = require('path')
const yargs = require('yargs')
const Stock = require('./stock.js')
const cryptogains = require('./index.js')
const chalk = require('chalk')

/** Extracts the currency symbols from a Kraken trading pair. */
const pair = p => p === 'BATUSD' ? { from : 'BAT', to: 'USD' }
  : p === 'AVAXUSD' ? { from : 'AVAX', to: 'USD' }
  : p === 'DAIUSD' ? { from : 'DAI', to: 'USD' }
  : p === 'EOSUSD' ? { from : 'EOS', to: 'USD' }
  : p === 'GNOUSD' ? { from : 'GNO', to: 'USD' }
  : p === 'SOLUSD' ? { from : 'SOL', to: 'USD' }
  : p === 'UNIUSD' ? { from : 'UNI', to: 'USD' }
  : p === 'USDCUSD' ? {}
  : p === 'USDTZUSD' ? {}
  : p === 'XBTUSDC' ? { from : 'BTC', to: 'USD' }
  : p === 'XETHZUSD' ? { from: 'ETH', to: 'USD' }
  : p === 'XXBTZUSD' ? { from : 'BTC', to: 'USD' }
  : p === 'XXLMZUSD' ? { from : 'XLM', to: 'USD' }
  : error(`Unrecognized trading pair: ${p}`)

/** Loads a trade history file in Cointracking or Kraken format. */
const loadTradeHistoryFile = async file => {
  const cointrackingColumns = ['Type','Buy','Cur.','Sell','Cur.','Exchange','Trade Group','Comment','Trade Date']
  const krakenColumns = ['txid','ordertxid','pair','time','type','ordertype','price','cost','fee','vol','margin','misc','ledgers']
  const text = fs.readFileSync(file, 'utf-8')
  const headerColumns = text.split('\n')[0].split(',').map(col => col.replace(/["\r]/g, ''))

  // CoinTracking
  if (cointrackingColumns.every(col => headerColumns.includes(col))) {
    return [...await csvtojson().fromString(fixCointrackingHeader(text))]
  }
  // Kraken
  else if (krakenColumns.every(col => headerColumns.includes(col))) {
    return [...await csvtojson().fromString(text)]
      // convert Kraken schema to Cointracking
      // add withdrawal
      .map(row => {
        const trade = krakenTradeToCointracking(row)
        return [
          trade,
          // assume that funds are immediately withdrawn after a sale so that they are removed from the stock
          trade && row.type === 'sell' ? {
            ...trade,
            Type: 'Withdrawal',
            Buy: null,
            BuyCur: null,
          } : null
        ]
      })
      .flat()
      .filter(x => x)
  }
  else {
    error('Unrecognized file header:', headerColumns)
  }
}

/** Loads all trades from a file or directory. */
const loadTrades = async inputPath => {
  if (isDir(inputPath)) {
    console.info('\nInput files (these MUST be in chronological order)')
    const tradeGroups = await Promise.all(fs.readdirSync(inputPath)
      .map(file => {
        const fullPath = path.resolve(inputPath, file)
        if (isDir(fullPath) || ignoreTradeFile(file)) return null
        console.info(`  ${file}`)
        return fullPath
      })
      .filter(x => x)
      .map(loadTradeHistoryFile)
    )
    return tradeGroups.flat().slice(0, argv.limit)
  }
  else {
    const txs = await loadTradeHistoryFile(inputPath)
    return txs.slice(0, argv.limit)
  }
}

/** Converts a trade in the Kraken schema to the Cointracking schema. */
const krakenTradeToCointracking = trade => {
  const { from, to } = pair(trade.pair)
  // ignore USDC -> USD trades
  if ((trade.type === 'buy' || trade.type === 'sell') && !from && !to) return null
  return {
    Type: trade.type === 'buy' || trade.type === 'sell' ? 'Trade'
      : `${trade.type[0].toUpperCase()}${trade.type.slice(1).toLowerCase()}`,
    Buy: trade.type === ' buy' || trade.type === 'deposit' ? +trade.cost / trade.price : +trade.cost,
    CurBuy: trade.type === 'buy' || trade.type === 'deposit' ? from : 'USD',
    Sell: trade.type === 'sell' ? +trade.cost / trade.price : +trade.cost,
    CurSell: trade.type === 'sell' ? from : 'USD',
    Exchange: 'Kraken',
    'Trade Date': trade.time,
    // Use Kraken-provided price
    // Not part of Cointracking data schema
    Price: +trade.price
  }
}

/** Returns true if the given input path is a directory. */
const isDir = inputPath => fs.lstatSync(inputPath).isDirectory()

/** Returns true if the file is one of the ignored file names. */
const ignoreTradeFile = file => file === '.DS_Store'

// replace duplicate Cur. with CurBuy, CurSell, CurFee
const fixCointrackingHeader = input => {
  const lines = input.split('\n')
  return [].concat(
    lines[0]
      .replace('Cur.', 'CurBuy')
      .replace('Cur.', 'CurSell')
      .replace('Cur.', 'CurFee'),
    lines.slice(1)
  ).join('\n')
}

/** Exits with an error code. */
const error = (...msg) => {
  console.error(...msg)
  process.exit(1)
}

// convert trades array to CSV and restore header
const toCSV = (trades, fields) => {
  const csv = json2csv.parse(trades, { delimiter: ',', fields })
  const csvLines = csv.split('\n')
  return [].concat(
    csvLines[0]
      .replace('CurBuy', 'Cur.')
      .replace('CurSell', 'Cur.')
      .replace('CurFee', 'Cur.')
    , csvLines.slice(1)
  ).join('\n')
}

// convert d-m-y date (e.g. 18.06.2016 15:14 0) to y-m-d
const normalDate = d => `${d.slice(6, 10)}-${d.slice(3, 5)}-${d.slice(0, 2)} ${d.slice(11)}`

// return true if the sale date is over a year from the acquisision date
const isShortTerm = sale =>
  (new Date(normalDate(sale.date)) - new Date(normalDate(sale.dateAcquired))) < 3.154e+10

const numberWithCommas = n => n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')

const formatPrice = n => {
  const priceString = '$' + numberWithCommas(Math.round(n * 100)/100)
  return chalk[n > 0 ? 'green' :
    n < 0 ? 'red' :
    'cyan'
    ](priceString)
}

// add two numbers
const sum = (x,y) => x + y

/****************************************************************
* RUN
*****************************************************************/

const argv = yargs
  .usage('Usage: $0 <file or directory> [options]')
  .demandCommand(1)
  .option('accounting', { default: 'fifo', describe: 'Accounting type: fifo/lifo.' })
  .option('exchange', { default: 'cccagg', describe: 'Exchange for price lookups.' })
  .option('likekind', { default: true, describe: 'Allow like-kind exchange before 2018.' })
  .option('limit', { default: Infinity, describe: 'Limit number of transactions processed.' })
  .option('mockprice', { describe: 'Mock price in place of cryptocompare lookups.' })
  .option('output', { describe: 'Output directory for results.' })
  .option('verbose', { describe: 'Show more errors and warnings.' })
  .argv

;(async () => {

const outputByYear = async (year, sales, interest, likeKindExchanges) => {

  const stSales = sales.filter(isShortTerm)
  const ltSales = sales.filter(sale => !isShortTerm(sale))

  const stSalesYear = stSales.filter(sale => sale.date.includes(year))
  const ltSalesYear = ltSales.filter(sale => sale.date.includes(year))
  const interestYear = interest.filter(tx => tx.date.includes(year))
  const likeKindExchangesYear = likeKindExchanges.filter(tx => tx.date.includes(year))

  const hasTrades = stSalesYear.length > 0 || ltSalesYear.length > 0 || likeKindExchangesYear.length > 0 || interestYear > 0
  if (!hasTrades) return

  // summary
  // cannot calculate unrealized gains from like-kind exchanges without fetching the price of tx.Buy and converting it to USD
  if (likeKindExchangesYear.length > 0) {
    console.info(`${year} Like-Kind Exchange Deferred Gains (${likeKindExchangesYear.length})`, formatPrice(likeKindExchangesYear.map(sale => sale.deferredGains).reduce(sum, 0)))
  }
  console.info(`${year} Short-Term Gains (${stSalesYear.length}):`, formatPrice(stSalesYear.map(sale => sale.gain).reduce(sum, 0)))
  console.info(`${year} Long-Term Gains (${ltSalesYear.length}):`, formatPrice(ltSalesYear.map(sale => sale.gain).reduce(sum, 0)))
  if (interestYear.length > 0) {
    console.info(`${year} Interest (${interestYear.length}):`, formatPrice(interestYear.map(tx => tx.interestEarnedUSD).reduce(sum, 0)))
  }
  console.info('')

  // output csv
  if (argv.output) {
    const dir = `${argv.output}/${year}/`
    await mkdir(dir)
    if (likeKindExchangesYear.length) {
      fs.writeFileSync(`${dir}like-kind-exchanges-${year}.csv`, toCSV(likeKindExchangesYear, [
        { value: 'date', label: 'Date Exchanged' },
        { value: 'dateAcquired', label: 'Date Purchased' },
        { value: 'sell', label: 'From Amount' },
        { value: 'sellCur', label: 'From Asset' },
        { value: 'buy', label: 'To Amount' },
        { value: 'buyCur', label: 'To Asset' },
        { value: 'cost', label: 'Cost Basis (USD)' },
        { value: 'deferredGains', label: 'Deferred Gains (USD)' }
      ]))
    }
    if (stSalesYear.length) {
      fs.writeFileSync(`${dir}sales-short-term-${year}.csv`, toCSV(stSalesYear, [
        { value: 'date', label: 'Date Sold' },
        { value: 'dateAcquired', label: 'Date Acquired' },
        { value: 'sell', label: 'Sell' },
        { value: 'sellCur', label: 'Sell Currency' },
        { value: 'buy', label: 'Sell (USD)' },
        { value: 'cost', label: 'Cost Basis (USD)' },
        { value: 'gain', label: 'Gain (USD)' }
      ]))
    }
    if (ltSalesYear.length) {
      fs.writeFileSync(`${dir}sales-long-term-${year}.csv`, toCSV(ltSalesYear, [
        { value: 'date', label: 'Date Sold' },
        { value: 'dateAcquired', label: 'Date Acquired' },
        { value: 'sell', label: 'Sell' },
        { value: 'sellCur', label: 'Sell Currency' },
        { value: 'buy', label: 'Sell (USD)' },
        { value: 'cost', label: 'Cost Basis (USD)' },
        { value: 'gain', label: 'Gain (USD)' }
      ]))
    }
    if (interestYear.length) {
      fs.writeFileSync(`${dir}interest-${year}.csv`, toCSV(interestYear, [
        { value: 'date', label: 'Date' },
        { value: 'loanAmount', label: 'Loan Amount' },
        { value: 'loanCurrency', label: 'Loan Currency' },
        { value: 'interestEarnedUSD', label: 'Interest Earned (USD)' }
      ]))
    }
  }
}

// load transactions from a csv or directory of csv files
const txs = await loadTrades(argv._[0])

const { matched, unmatched, income, cryptoToUsd, usdToCrypto, airdrops, usdDeposits, withdrawals, tradeTxs, margin, sales, interest, likeKindExchanges, noAvailablePurchases, noMatchingWithdrawals, priceErrors, zeroPrices } = await cryptogains(txs, argv)

// sale.buy is the USD acquired from the trade ("buy" USD)
// sale.cost is the cost basis
const salesWithGain = sales.map(sale => ({ ...sale, gain: sale.buy - sale.cost }))

const total = withdrawals.length + matched.length + unmatched.length + cryptoToUsd.length + usdToCrypto.length + airdrops.length + usdDeposits.length + income.length + tradeTxs.length + margin.length + interest.length
console.info('')
console.info('Withdrawals:', withdrawals.length)
console.info('Matched Deposits:', matched.length)
console.info('Unmatched Deposits:', unmatched.length)
console.info('Crypto-to-USD:', cryptoToUsd.length)
console.info('USD-to-Crypto:', usdToCrypto.length)
console.info('USD Deposits:', usdDeposits.length)
console.info('Airdrops', airdrops.length)
console.info('Income:', income.length)
console.info('Trades:', tradeTxs.length)
console.info('Margin Trades:', margin.length)
console.info('Lending:', interest.length)
console.info(total === txs.length
  ? `TOTAL: ${total} ✓`
  : `✗ TOTAL: ${total}, TXS: ${txs.length}`
)
console.info('')

console.info('ERRORS')
console.info('No available purchase:', noAvailablePurchases.length)
console.info('No matching withdrawals:', noMatchingWithdrawals.length)
console.info('Price errors:', priceErrors.length)
console.info('Zero prices:', zeroPrices.length)
console.info('')


for (y = 2016; y <= (new Date).getFullYear(); y++) {
  outputByYear(y, salesWithGain, interest, likeKindExchanges)
}

})()
