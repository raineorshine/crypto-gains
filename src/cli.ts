import chalk from 'chalk'
import fs from 'fs'
import json2csv from 'json2csv'
import mkdir from 'make-dir'
import Loan from './@types/Load.js'
import Transaction from './@types/Transaction.js'
import cryptogains from './index.js'
import loadTrades from './loadTrades.js'

const yargs = require('yargs')

// convert trades array to CSV and restore header
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

// convert d-m-y date (e.g. 18.06.2016 15:14 0) to y-m-d
const normalDate = (d: string): string => `${d.slice(6, 10)}-${d.slice(3, 5)}-${d.slice(0, 2)} ${d.slice(11)}`

// return true if the sale date is over a year from the acquisision date
const isShortTerm = (sale: Transaction): boolean =>
  new Date(normalDate(sale.date)).getTime() - new Date(normalDate(sale.dateAcquired)).getTime() < 3.154e10

const numberWithCommas = (n: number): string => n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')

const formatPrice = (n: number): string => {
  const priceString = '$' + numberWithCommas(Math.round(n * 100) / 100)
  return chalk[n > 0 ? 'green' : n < 0 ? 'red' : 'cyan'](priceString)
}

// add two numbers
const sum = (x: number, y: number): number => x + y

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
  .option('verbose', { describe: 'Show more errors and warnings.' }).argv

;(async () => {
  const outputByYear = async (
    year: string,
    sales: (Transaction & { gain: number })[],
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
      console.info(
        `${year} Like-Kind Exchange Deferred Gains (${likeKindExchangesYear.length})`,
        formatPrice(likeKindExchangesYear.map(sale => sale.deferredGains || 0).reduce(sum, 0)),
      )
    }
    console.info(
      `${year} Short-Term Gains (${stSalesYear.length}):`,
      formatPrice(stSalesYear.map(sale => sale.gain).reduce(sum, 0)),
    )
    console.info(
      `${year} Long-Term Gains (${ltSalesYear.length}):`,
      formatPrice(ltSalesYear.map(sale => sale.gain).reduce(sum, 0)),
    )
    if (interestYear.length > 0) {
      console.info(
        `${year} Interest (${interestYear.length}):`,
        formatPrice(interestYear.map(tx => tx.interestEarnedUSD).reduce(sum, 0)),
      )
    }
    console.info('')

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
  const txs = await loadTrades(argv._[0], argv.limit)

  const {
    matched,
    unmatched,
    income,
    cryptoToUsd,
    usdToCrypto,
    airdrops,
    usdDeposits,
    withdrawals,
    tradeTxs,
    margin,
    sales,
    interest,
    likeKindExchanges,
    noAvailablePurchases,
    noMatchingWithdrawals,
    priceErrors,
    zeroPrices,
  } = await cryptogains(txs, argv)

  // sale.buy is the USD acquired from the trade ("buy" USD)
  // sale.cost is the cost basis
  const salesWithGain = sales.map(sale => ({ ...sale, gain: sale.buy - sale.cost }))

  const total =
    withdrawals.length +
    matched.length +
    unmatched.length +
    cryptoToUsd.length +
    usdToCrypto.length +
    airdrops.length +
    usdDeposits.length +
    income.length +
    tradeTxs.length +
    margin.length +
    interest.length
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
  console.info(total === txs.length ? `TOTAL: ${total} ✓` : `✗ TOTAL: ${total}, TXS: ${txs.length}`)
  console.info('')

  console.info('ERRORS')
  console.info('No available purchase:', noAvailablePurchases.length)
  console.info('No matching withdrawals:', noMatchingWithdrawals.length)
  console.info('Price errors:', priceErrors.length)
  console.info('Zero prices:', zeroPrices.length)
  console.info('')

  for (let y = 2016; y <= new Date().getFullYear(); y++) {
    outputByYear(y.toString(), salesWithGain, interest, likeKindExchanges)
  }
})()
