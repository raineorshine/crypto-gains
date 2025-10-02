import chalk from 'chalk'
import fs from 'fs'
import json2csv from 'json2csv'
import mkdir from 'make-dir'
import Loan from './@types/Loan.js'
import Transaction from './@types/Transaction.js'
import TransactionWithGain from './@types/TransactionWithGain.js'
import argv from './argv.js'
import cryptogains from './cryptogains.js'
import loadTrades from './loadTrades.js'
import log from './log.js'

/** Convert trades array to CSV and restore header. */
const toCSV = (trades: unknown[], fields: { value: string; label: string }[]): string => {
  const csv = json2csv.parse(trades, { delimiter: ',', fields })
  const csvLines = csv.split('\n')
  return ([] as string[])
    .concat(
      csvLines[0].replace('CurBuy', 'Cur.').replace('CurSell', 'Cur.').replace('CurFee', 'Cur.'),
      csvLines.slice(1),
    )
    .join('\n')
}

/** Convert d-m-y date (e.g. 18.06.2016 15:14 0) to y-m-d. */
const normalDate = (d: string): string => `${d.slice(6, 10)}-${d.slice(3, 5)}-${d.slice(0, 2)} ${d.slice(11)}`

/** Return true if the sale date is over a year from the acquisision date. */
const isShortTerm = (sale: Transaction): boolean => {
  const buyTime = new Date(normalDate(sale.dateAcquired)).getTime()
  const saleTime = new Date(normalDate(sale.date)).getTime()
  return saleTime - buyTime < 3.154e10
}

const numberWithCommas = (n: number): string => n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')

const formatPrice = (n: number): string => {
  const priceString = '$' + numberWithCommas(Math.round(n * 100) / 100)
  return chalk[n > 0 ? 'green' : n < 0 ? 'red' : 'cyan'](priceString)
}

/** Add two numbers. */
const sum = (x: number, y: number): number => x + y

/****************************************************************
 * RUN
 *****************************************************************/

;(async () => {
  const outputByYear = async (
    year: string,
    sales: TransactionWithGain[],
    interest: Loan[],
    likeKindExchanges: Transaction[],
  ) => {
    const stSales = sales.filter(isShortTerm)
    const ltSales = sales.filter(sale => !isShortTerm(sale))

    const stSalesYear = stSales.filter(sale => sale.date.includes(year))
    const ltSalesYear = ltSales.filter(sale => sale.date.includes(year))
    const interestYear = interest.filter(tx => tx.date.includes(year.toString()))
    const likeKindExchangesYear = likeKindExchanges.filter((tx: Transaction) => tx.date.includes(year))

    const hasTrades =
      stSalesYear.length > 0 || ltSalesYear.length > 0 || likeKindExchangesYear.length > 0 || interestYear.length > 0
    if (!hasTrades) return

    // summary
    // cannot calculate unrealized gains from like-kind exchanges without fetching the price of tx.Buy and converting it to USD
    if (likeKindExchangesYear.length > 0) {
      log(
        `${year} Like-Kind Exchange Deferred Gains (${likeKindExchangesYear.length})`,
        formatPrice(likeKindExchangesYear.map(sale => sale.deferredGains || 0).reduce(sum, 0)),
      )
    }
    log(
      `${year} Short-Term Gains (${stSalesYear.length}):`,
      formatPrice(stSalesYear.map(sale => sale.gain).reduce(sum, 0)),
    )
    log(
      `${year} Long-Term Gains (${ltSalesYear.length}):`,
      formatPrice(ltSalesYear.map(sale => sale.gain).reduce(sum, 0)),
    )
    if (interestYear.length > 0) {
      log(
        `${year} Interest (${interestYear.length}):`,
        formatPrice(interestYear.map(tx => tx.interestEarnedUSD).reduce(sum, 0)),
      )
    }
    log('')

    // output csv
    if (argv.output) {
      const dir = `${argv.output}/${year}/`
      await mkdir(dir)
      if (likeKindExchangesYear.length) {
        fs.writeFileSync(
          `${dir}like-kind-exchanges-${year}.csv`,
          toCSV(likeKindExchangesYear, [
            { value: 'date', label: 'Date Exchanged' },
            { value: 'dateAcquired', label: 'Date Purchased' },
            { value: 'sell', label: 'From Amount' },
            { value: 'sellCur', label: 'From Asset' },
            { value: 'buy', label: 'To Amount' },
            { value: 'buyCur', label: 'To Asset' },
            { value: 'cost', label: 'Cost Basis (USD)' },
            { value: 'deferredGains', label: 'Deferred Gains (USD)' },
          ]),
        )
      }
      if (stSalesYear.length) {
        fs.writeFileSync(
          `${dir}sales-short-term-${year}.csv`,
          toCSV(stSalesYear, [
            { value: 'date', label: 'Date Sold' },
            { value: 'dateAcquired', label: 'Date Acquired' },
            { value: 'sell', label: 'Sell' },
            { value: 'sellCur', label: 'Sell Currency' },
            { value: 'buy', label: 'Sell (USD)' },
            { value: 'cost', label: 'Cost Basis (USD)' },
            { value: 'gain', label: 'Gain (USD)' },
          ]),
        )
      }
      if (ltSalesYear.length) {
        fs.writeFileSync(
          `${dir}sales-long-term-${year}.csv`,
          toCSV(ltSalesYear, [
            { value: 'date', label: 'Date Sold' },
            { value: 'dateAcquired', label: 'Date Acquired' },
            { value: 'sell', label: 'Sell' },
            { value: 'sellCur', label: 'Sell Currency' },
            { value: 'buy', label: 'Sell (USD)' },
            { value: 'cost', label: 'Cost Basis (USD)' },
            { value: 'gain', label: 'Gain (USD)' },
          ]),
        )
      }
      if (interestYear.length) {
        fs.writeFileSync(
          `${dir}interest-${year}.csv`,
          toCSV(interestYear, [
            { value: 'date', label: 'Date' },
            { value: 'loanAmount', label: 'Loan Amount' },
            { value: 'loanCurrency', label: 'Loan Currency' },
            { value: 'interestEarnedUSD', label: 'Interest Earned (USD)' },
          ]),
        )
      }
    }
  }

  // load transactions from a csv or directory of csv files
  const txs = await loadTrades(argv._[0] as string, argv.limit)

  const {
    income,
    cryptoSales,
    cryptoPurchases,
    airdrops,
    usdDeposits,
    withdrawals,
    tradeTxs,
    margin,
    sales,
    interest,
    likeKindExchanges,
    noMatchingWithdrawals,
    priceErrors,
    zeroPrices,
    stock,
  } = await cryptogains(txs, {
    ...argv,
    // narrow option types that yargs types too generically
    accounting: argv.accounting as 'fifo' | 'lifo' | undefined,
  })

  // sale.buy is the USD acquired from the trade ("buy" USD)
  // sale.cost is the cost basis
  const salesWithGain: TransactionWithGain[] = sales.map(sale => ({ ...sale, gain: sale.buy - sale.cost }))

  const total =
    withdrawals.length +
    cryptoSales.length +
    cryptoPurchases.length +
    airdrops.length +
    usdDeposits.length +
    income.length +
    tradeTxs.length +
    margin.length +
    interest.length
  log('')
  log('Withdrawals:', withdrawals.length)
  log('Crypto sale:', cryptoSales.length)
  log('Crypto purchases:', cryptoPurchases.length)
  log('USD Deposits:', usdDeposits.length)
  log('Airdrops', airdrops.length)
  log('Income:', income.length)
  log('Trades:', tradeTxs.length)
  log('Margin Trades:', margin.length)
  log('Lending:', interest.length)
  log(total === txs.length ? `TOTAL: ${total} ✓` : `✗ TOTAL: ${total}, TXS: ${txs.length}`)
  log('')

  log('ERRORS')
  log('No matching withdrawals:', noMatchingWithdrawals.length)
  log('Price errors:', priceErrors.length)
  log('Zero prices:', zeroPrices.length)
  log('')

  log('STOCK (sample)')
  const sampleSymbols = new Set(['BTC', 'ETH', 'LTC', 'SOL', 'UNI', 'AVAX'])
  const stockMap = stock.all() as { [key: string]: number }
  const stockFiltered = Object.fromEntries(Object.entries(stockMap).filter(([cur, amount]) => sampleSymbols.has(cur)))
  log(stockFiltered)

  for (let y = 2016; y <= new Date().getFullYear(); y++) {
    outputByYear(y.toString(), salesWithGain, interest, likeKindExchanges)
  }
})()
