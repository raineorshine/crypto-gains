const fs = require('fs')
const yargs = require('yargs')
const csvtojson = require('csvtojson')
const json2csv = require('json2csv')
const got = require('got')
const secure = require('./secure.json')
const memoize = require('nano-persistent-memoizer')
const mkdir = require('make-dir')
const Stock = require('./stock.js')
const stock = Stock()

// replace duplicate Cur. with CurBuy, CurSell, CurFee
const fixHeader = input => {
  const lines = input.split('\n')
  return [].concat(
    lines[0]
      .replace('Cur.', 'CurBuy')
      .replace('Cur.', 'CurSell')
      .replace('Cur.', 'CurFee'),
    lines.slice(1)
  ).join('\n')
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

// group transactions by day
const groupByDay = trades => {
  const txsByDay = {}
  for (let i=0; i<trades.length; i++) {
    const key = day(trades[i]['Trade Date'])
    if (!(key in txsByDay)) {
      txsByDay[key] = []
    }
    txsByDay[key].push(trades[i])
  }
  return txsByDay
}

// get the day of the date
const day = date => date.split(' ')[0]

// convert d-m-y date (e.g. 18.06.2016 15:14 0) to y-m-d
const normalDate = d => `${d.slice(6, 10)}-${d.slice(3, 5)}-${d.slice(0, 2)} ${d.slice(11)}`

// get the opposite tx type: Deposit/Withdrawal
const otherType = tx => tx.Type === 'Deposit' ? 'Withdrawal' : 'Deposit'

// convert a string value to a number and set '-' to 0
const z = v => v === '-' ? 0 : +v

// add two numbers
const sum = (x,y) => x + y

// return true if the sale date is over a year from the acquisision date
const isShortTerm = sale =>
  (new Date(normalDate(sale.date)) - new Date(normalDate(sale.dateAcquired))) < 3.154e+10

// checks if two txs are within a margin of error from each other
const closeEnough = (tx1, tx2) => {
  const errorRange = tx1.CurBuy === 'BTC' ? 0.2 :
    tx1.CurBuy === 'ETH' ? 0.2 :
    0.5
  return Math.abs(z(tx1.Buy) - z(tx2.Sell)) < errorRange &&
         Math.abs(z(tx1.Sell) - z(tx2.Buy)) < errorRange
}

// checks if two transactions are a Deposit/Withdrawal match
const match = (tx1, tx2) =>
  tx1.Type === otherType(tx2.Type) &&
  tx1.CurBuy === tx2.CurSell &&
  tx1.CurSell === tx2.CurBuy &&
  closeEnough(tx1, tx2)

// memoized price
const mPrice = memoize('price').async(async key => {
  const { from, to, time, exchange } = JSON.parse(key)

  if (from === to) return 1

  const url = `https://min-api.cryptocompare.com/data/pricehistorical?fsym=${from}&tsyms=${to}&ts=${(new Date(time)).getTime()/1000}&e=${exchange}&api_key=${secure.cryptoCompareApiKey}&calculationType=MidHighLow&extraParams=cost-basis-filler`
  const data = JSON.parse((await got(url)).body)

  if (data[from]) {
    return data[from][to]
  }
  else if (data.Message.startsWith('There is no data for the symbol')) {
    throw new Error(`No price for ${from} on ${time}`)
  }
  else if (data.Response === 'Error') {
    throw new Error(data.Message)
  }
  else {
    throw new Error('Unknown Response', data)
  }
})

// calculate the price of a currency in a countercurrency
// stringify arguments into caching key for memoize
const price = async (from, to, time, exchange = argv.exchange) => argv.mockprice != null ? argv.mockprice : +(await mPrice(JSON.stringify({ from, to, time, exchange })))

const numberWithCommas = n => n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')

const formatPrice = n => '$' + numberWithCommas(Math.round(n * 100)/100)

const isCryptoToUsd = trade =>
  (trade.Type === 'Withdrawal' && trade.Exchange === 'Coinbase' && !trade.Fee && trade.Sell < 4) || // shift card (infer)
  (trade.Type === 'Trade' && trade.CurBuy === 'USD') ||
  trade.Type === 'Spend'

const isUsdToCrypto = trade =>
  trade.Type === 'Trade' && trade.CurSell === 'USD'

// find a withdrawal in the given list of transactions that matches the given deposit
const findMatchingWithdrawal = (deposit, txs) =>
  txs.find(tx => match(deposit, tx))


/****************************************************************
* CALCULATE
*****************************************************************/

// group transactions into several broad categories
// match same-day withdrawals and deposits
// calculate custom cost basis
const calculate = async txs => {

  const matched = []
  const unmatched = []
  const income = []
  const cryptoToUsd = []
  const usdToCrypto = []
  const usdDeposits = []
  const withdrawals = []
  const margin = []
  const tradeTxs = []
  const airdrops = []

  const sales = []
  const interest = [] // loan interest earned must be reported differently than sales
  const likeKindExchanges = []
  const noAvailablePurchases = []
  const noMatchingWithdrawals = []
  const priceErrors = []

  const txsByDay = groupByDay(txs)

  // loop through each day
  for (let key in txsByDay) {
    const group = txsByDay[key]

    // loop through each of the day's transactions
    for (let i in group) {
      const tx = group[i]

      // LENDING

      // must go before Trade
      if(/lending/i.test(tx['Trade Group'])) {

        let p
        try {
          // Poloniex market does not exist for some coin pairs
          p = await price(tx.CurBuy, 'USD', day(normalDate(tx['Trade Date'])))

          // Cryptocompare returns erroneous prices for BTS on some days. When a price that is out of range is detected, set it to 0.2 which is a reasonable estimate for that time.
          // e.g. https://min-api.cryptocompare.com/data/pricehistorical?fsym=BTS&tsyms=USD&ts=1495756800
          /*
          1495756800 208.98
          1495843200 173.07
          1495929600 255.73
          1496016000 252.73
          1496102400 275.6
          1496188800 267.5
          1496275200 303.7
          1496361600 343.6
          1496448000 367.5
          1496534400 321.38
          1496620800 329.67
          1496707200 360.55
          1496793600 214.17
          1496880000 235.96
          1496966400 343.52
          1497139200 489.26
          1497312000 546.67
          1497916800 371.61
          */
          if (tx.CurBuy === 'BTS' && p > 10) {
            p = 0.2
          }
        }
        catch(e) {
          console.error(`Error fetching price`, e.message)
          priceErrors.push(tx)
        }

        // simulate USD Buy
        // use buy because a USD sale "buys" a certain amount of USD, so buy - cost is the profit
        interest.push({
          date: tx['Trade Date'],
          loanAmount: tx.Buy,
          loanCurrency: tx.CurBuy,
          interestEarnedUSD: tx.Buy * p
        })
      }

      // MARGIN

      // must go before isCryptoToUsd
      // some Bitfinex margin trades are reported as Lost
      // similar to Trade processing, but does not update stock
      else if(/margin/i.test(tx['Trade Group']) || tx.Type === 'Lost') {
        margin.push(tx)

        // handle '-' value
        const buy = isNaN(tx.Buy ? 0 : +tx.Buy)
        const sell = isNaN(tx.Sell ? 0 : +tx.Sell)

        let buyPrice, sellPrice

        try {
          buyPrice = buy ? await price(tx.CurBuy, 'USD', day(normalDate(tx['Trade Date']))) : 0
          sellPrice = sell ? await price(tx.CurSell, 'USD', day(normalDate(tx['Trade Date']))) : 0
        }
        catch(e) {
          console.error(`Error fetching price`, e.message)
          priceErrors.push(tx)
        }

        // simulate USD Buy
        // use buy because a USD sale "buys" a certain amount of USD, so buy - cost is the profit
        sales.push({
          buy: sell * sellPrice,
          buyCur: 'USD',
          cost: buy * buyPrice,
          // count as short-term gains
          date: tx['Trade Date'],
          dateAcquired: tx['Trade Date']
        })
      }

      // SALE

      // USD buy = crypto sale
      // must go before Trade and Withdrawal
      else if(isCryptoToUsd(tx)) {
        cryptoToUsd.push(tx)

        // update cost basis
        try {
          // Trade to USD
          if (tx.Type === 'Trade') {
            sales.push(...stock.trade(+tx.Sell, tx.CurSell, +tx.Buy, 'USD', tx['Trade Date'], null, argv.accounting))
          }
          // Shift: we have to calculate the historical USD sale value since Coinbase only provides the token price
          else {
            let p = 0
            try {
              p = await price(tx.CurSell, 'USD', day(normalDate(tx['Trade Date'])), tx.Exchange)
            }
            catch(e) {
              console.error(`Error fetching price`, e.message)
              priceErrors.push(tx)
            }

            sales.push(...stock.trade(+tx.Sell, tx.CurSell, tx.Sell * p, 'USD', tx['Trade Date'], null, argv.accounting))
          }
        }
        catch (e) {
          if (e instanceof Stock.NoAvailablePurchaseError) {
            if (argv.verbose) {
              console.error('Error making trade', e.message)
            }
            noAvailablePurchases.push(e)
          }
          else {
            throw e
          }
        }
      }

      // PURCHASE

      // usd-to-crypto
      // must go before crypto-to-crypto trade
      else if(isUsdToCrypto(tx)) {
        usdToCrypto.push(tx)
        stock.deposit(+tx.Buy, tx.CurBuy, +tx.Sell, tx['Trade Date'])
      }

      // TRADE

      // crypto-to-crypto trade
      else if(tx.Type === 'Trade') {
        tradeTxs.push(tx)

        // update cost basis
        try {
          const before2018 = (new Date(normalDate(tx['Trade Date']))).getFullYear() < 2018
          const tradeExchanges = stock.trade(+tx.Sell, tx.CurSell, +tx.Buy, tx.CurBuy, tx['Trade Date'], before2018 ? null : await price(tx.CurBuy, 'USD', day(normalDate(tx['Trade Date']))), argv.accounting)
          ;(before2018 ? likeKindExchanges : sales)
            .push(...tradeExchanges)
        }
        catch (e) {
          if (e instanceof Stock.NoAvailablePurchaseError) {
            if (argv.verbose) {
              console.error('Error making trade:', e.message)
            }
            noAvailablePurchases.push(e)
          }
          else {
            throw e
          }
        }

      }

      // INCOME

      else if(tx.Type === 'Income') {
        income.push(tx)

        // update cost basis
        let p = 0
        try {
          p = await price(tx.CurBuy, 'USD', day(normalDate(tx['Trade Date'])))
        }
        catch(e) {
          console.error(`Error fetching price`, e.message)
          priceErrors.push(tx)
        }

        stock.deposit(+tx.Buy, tx.CurBuy, tx.Buy * p, tx['Trade Date'])
      }

     // DEPOSIT

     else if (tx.Type === 'Deposit') {

        // USD deposits have as-is cost basis
        if (tx.CurBuy === 'USD') {
          usdDeposits.push(tx)
          stock.deposit(+tx.Buy, 'USD', +tx.Buy, tx['Trade Date'])
        }
        // air drops have cost basis of 0
        else if (tx.CurBuy in secure.airdropSymbols) {
          airdrops.push(tx)
          stock.deposit(+tx.Buy, tx.CurBuy, 0, tx['Trade Date'])
        }
        // try to match the deposit to a same-day withdrawal
        else if (findMatchingWithdrawal(tx, group)) {
          matched.push(tx)
        }
        // SALT presale
        else if (tx.CurBuy === 'SALT' && tx['Trade Date'].includes('2017')) {
          matched.push(tx)
          stock.deposit(+tx.Buy, tx.CurBuy, tx.Buy * 0.25, tx['Trade Date'])
        }
        // BCH fork
        else if (tx.CurBuy === 'BCH' && tx['Trade Date'].includes('2017')) {
          matched.push(tx)
          stock.deposit(+tx.Buy, tx.CurBuy, 0, tx['Trade Date'])
        }
        // otherwise we have an unmatched transaction and need to fallback to the day-of price
        // and add it to the stock
        else {

          let p
          try {
            // per-day memoization
            p = await price(tx.CurBuy, 'USD', day(normalDate(tx['Trade Date'])))
          }
          catch (e) {
            priceErrors.push(e.message)
          }

          // do not report missing USDT purchases as warnings, since the cost basis is invariant
          if (tx.CurBuy === 'USDT') {
            matched.push(tx)
          }
          else {
            const message = `WARNING: No matching withdrawal for deposit of ${tx.Buy} ${tx.CurBuy} on ${tx['Trade Date']}. Using historical price.`
            if (argv.verbose) {
              console.log(message)
            }
            noMatchingWithdrawals.push(message)

            const newTx = Object.assign({}, tx, {
              Type: 'Income',
              Comment: 'Cost Basis',
              Price: p
            })

            unmatched.push(newTx)
          }

          stock.deposit(+tx.Buy, tx.CurBuy, tx.Buy * p, tx['Trade Date'])
        }

      }

      // WITHDRAWAL

      else if (tx.Type === 'Withdrawal') {
        withdrawals.push(tx)
      }

      // UNKNOWN

      else {
        throw new Error('I do not know how to handle this transaction: \n\n' + JSON.stringify(tx))
      }
    }
  }

  return { matched, unmatched, income, cryptoToUsd, usdToCrypto, airdrops, usdDeposits, withdrawals, tradeTxs, margin, sales, interest, likeKindExchanges, noAvailablePurchases, noMatchingWithdrawals, priceErrors }
}


/****************************************************************
* RUN
*****************************************************************/

const argv = yargs
  .usage('Usage: $0 <data.csv> [options]')
  .demandCommand(1)
  .option('accounting', { default: 'fifo', describe: 'Accounting type: fifo/lifo.' })
  .option('exchange', { default: 'cccagg', describe: 'Exchange for price lookups.' })
  .option('limit', { default: Infinity, describe: 'Limit number of transactions processed.' })
  .option('mockprice', { describe: 'Mock price in place of cryptocompare lookups.' })
  .option('output', { describe: 'Output directory for results.' })
  .option('verbose', { describe: 'Show more errors and warnings.' })
  .argv

const file = argv._[0]


;(async () => {

// import csv
const input = fixHeader(fs.readFileSync(file, 'utf-8'))
const txs = Array.prototype.slice.call(await csvtojson().fromString(input), 0, argv.limit) // convert to true array

const { matched, unmatched, income, cryptoToUsd, usdToCrypto, airdrops, usdDeposits, withdrawals, tradeTxs, margin, sales, interest, likeKindExchanges, noAvailablePurchases, noMatchingWithdrawals, priceErrors } = await calculate(txs)
const salesWithGain = sales.map(sale => Object.assign({}, sale, { gain: sale.buy - sale.cost }))

const total = withdrawals.length + matched.length + unmatched.length + cryptoToUsd.length + usdToCrypto.length + airdrops.length + usdDeposits.length + income.length + tradeTxs.length + margin.length + interest.length
console.log('')
console.log('Withdrawals:', withdrawals.length)
console.log('Matched Deposits:', matched.length)
console.log('Unmatched Deposits:', unmatched.length)
console.log('Crypto-to-USD:', cryptoToUsd.length)
console.log('USD-to-Crypto:', usdToCrypto.length)
console.log('USD Deposits:', usdDeposits.length)
console.log('Airdrops', airdrops.length)
console.log('Income:', income.length)
console.log('Trades:', tradeTxs.length)
console.log('Margin Trades:', margin.length)
console.log('Lending:', interest.length)
console.log(total === txs.length
  ? `TOTAL: ${total} ✓`
  : `✗ TOTAL: ${total}, TXS: ${txs.length}`
)
console.log('')

console.log('ERRORS')
console.log('No available purchase:', noAvailablePurchases.length)
console.log('No matching withdrawals:', noMatchingWithdrawals.length)
console.log('Price errors:', priceErrors.length)
console.log('')

const outputByYear = async (year, sales, interest, likeKindExchanges) => {

  const stSales = sales.filter(isShortTerm)
  const ltSales = sales.filter(sale => !isShortTerm(sale))

  const stSalesYear = stSales.filter(sale => sale.date.includes(year))
  const ltSalesYear = ltSales.filter(sale => sale.date.includes(year))
  const interestYear = interest.filter(tx => tx.date.includes(year))
  const likeKindExchangesYear = likeKindExchanges.filter(tx => tx.date.includes(year))

  // summary
  // cannot calculate unrealized gains from like-kind exchanges without fetching the price of tx.Buy and converting it to USD
  console.log(`${year} Like-Kind Exchanges (${likeKindExchangesYear.length})`)
  console.log(`${year} Short-Term Sales (${stSalesYear.length}):`, formatPrice(stSalesYear.map(sale => sale.gain).reduce(sum, 0)))
  console.log(`${year} Long-Term Sales (${ltSalesYear.length}):`, formatPrice(ltSalesYear.map(sale => sale.gain).reduce(sum, 0)))
  console.log(`${year} Interest (${interestYear.length}):`, formatPrice(interestYear.map(tx => tx.interestEarnedUSD).reduce(sum, 0)))
  console.log('')

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
        { value: 'cost', label: 'Cost Basis (USD)' }
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

outputByYear(2016, salesWithGain, interest, likeKindExchanges)
outputByYear(2017, salesWithGain, interest, likeKindExchanges)
outputByYear(2018, salesWithGain, interest, likeKindExchanges)

})()
