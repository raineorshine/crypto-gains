const fs = require('fs')
const yargs = require('yargs')
const csvtojson = require('csvtojson')
const json2csv = require('json2csv')
const got = require('got')
const secure = require('./secure.json')
const memoize = require('nano-persistent-memoizer')
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
const toCSV = (trades, fields=['Type','Buy','CurBuy','Sell','CurSell','Exchange','Trade Group',,,'Comment','Trade Date']) => {
  const csv = json2csv.parse(trades, { delimiter: ',', fields })
  const csvLines = csv.split('\n')
  return [].concat(
    csvLines[0]
      .replace('CurBuy', 'Cur.')
      .replace('CurSell', 'Cur.')
      .replace('CurFee', 'Cur.'),
    csvLines.slice(1)
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

// checks if two txs are within a margin of error from each other
const closeEnough = (tx1, tx2) => {
  return Math.abs(z(tx1.Buy) - z(tx2.Sell)) <= 0.02 &&
         Math.abs(z(tx1.Sell) - z(tx2.Buy)) <= 0.02
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
  const url = `https://min-api.cryptocompare.com/data/pricehistorical?fsym=${from}&tsyms=${to}&ts=${(new Date(time)).getTime()/1000}&e=${exchange}&api_key=${secure.cryptoCompareApiKey}&extraParams=cost-basis-filler`
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

// USD buy = crypto sale
const isUsdBuy = trade =>
  (trade.Type === 'Withdrawal' && trade.Exchange === 'Coinbase' && !trade.Fee && trade.Sell < 4) || // shift card (infer)
  (trade.Type === 'Trade' && trade.CurBuy === 'USD') ||
  trade.Type === 'Spend'

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
  const usdBuys = []
  const usdDeposits = []
  const withdrawals = []
  const margin = []
  const lending = []
  const tradeTxs = []
  const lost = []
  const airdrops = []

  const sales = []
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

      // must go ahead of Trade
      if(/lending/i.test(tx['Trade Group']) || /lending/i.test(tx.Comment)) {
        lending.push(tx)
      }

      // MARGIN

      else if(/margin/i.test(tx['Trade Group']) || /margin/i.test(tx.Comment)) {
        margin.push(tx)
      }

      // SALE

      // USD buy = crypto sale
      // must go ahead of Trade and Withdrawal
      else if(isUsdBuy(tx)) {
        usdBuys.push(tx)

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
            console.error(e.message)
            noAvailablePurchases.push(e)
          }
          else {
            throw e
          }
        }
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
          stock.deposit(+tx.Buy, 'USD', tx.Buy, tx['Trade Date'])
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
        // otherwise we have an unmatched transaction and need to fallback to the day-of price
        // and add it to the stock
        else {
          const message = `WARNING: No matching withdrawal for deposit of ${tx.Buy} ${tx.CurBuy} on ${tx['Trade Date']}. Using historical price.`
          if (argv.verbose) {
            console.warn(message)
          }
          noMatchingWithdrawals.push(message)

          let p
          try {
            // per-day memoization
            p = await price(tx.CurBuy, 'USD', day(normalDate(tx['Trade Date'])))
          }
          catch (e) {
            priceErrors.push(e.message)
          }

          const newTx = Object.assign({}, tx, {
            Type: 'Income',
            Comment: 'Cost Basis',
            Price: p
          })

          unmatched.push(newTx)

          // cost basis based on day-of price
          stock.deposit(+tx.Buy, tx.CurBuy, tx.Buy * p, tx['Trade Date'])
        }

      }

      // OTHER

      else if (tx.Type === 'Withdrawal') {
        withdrawals.push(tx)
      }
      else if (tx.Type === 'Lost') {
        lost.push(tx)
        sales.push({
          buy: 0,
          buyCur: tx.CurSell,
          sell: 0,
          sellCur: tx.CurSell,
          cost: +tx.Sell,
          date: tx['Trade Date'],
          dateAcquired: tx['Trade Date']
        })
      }
      else {
        throw new Error('I do not know how to handle this transaction: \n\n' + JSON.stringify(tx))
      }
    }
  }

  return { matched, unmatched, income, usdBuys, airdrops, usdDeposits, withdrawals, tradeTxs, lost, margin, lending, sales, likeKindExchanges, noAvailablePurchases, noMatchingWithdrawals, priceErrors }
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
  .option('summary', { describe: 'Show a summary of results.' })
  .option('verbose', { describe: 'Show more errors and warnings.' })
  .argv

const file = argv._[0]


;(async () => {

// import csv
const input = fixHeader(fs.readFileSync(file, 'utf-8'))
const txs = Array.prototype.slice.call(await csvtojson().fromString(input), 0, argv.limit) // convert to true array

const { matched, unmatched, income, usdBuys, airdrops, usdDeposits, withdrawals, tradeTxs, lost, margin, lending, sales, likeKindExchanges, noAvailablePurchases, noMatchingWithdrawals, priceErrors } = await calculate(txs)

if (argv.summary) {

  const stSales = sales.filter(sale => (new Date(normalDate(sale.date)) - new Date(normalDate(sale.dateAcquired))) < 3.154e+10)
  const ltSales = sales.filter(sale => (new Date(normalDate(sale.date)) - new Date(normalDate(sale.dateAcquired))) >= 3.154e+10)

  const sum = withdrawals.length + matched.length + unmatched.length + usdBuys.length + airdrops.length + usdDeposits.length + income.length + tradeTxs.length + margin.length + lending.length + lost.length

  console.log('')
  console.log('Withdrawals:', withdrawals.length)
  console.log('Matched Deposits:', matched.length)
  console.log('Unmatched Deposits:', unmatched.length)
  console.log('USD Buys:', usdBuys.length)
  console.log('USD Deposits:', usdDeposits.length)
  console.log('Airdrops', airdrops.length)
  console.log('Income:', income.length)
  console.log('Trades:', tradeTxs.length)
  console.log('Margin Trades:', margin.length)
  console.log('Lending:', lending.length)
  console.log('Lost:', lost.length)
  console.log(sum === txs.length
    ? `TOTAL: ${sum} ✓`
    : `✗ TOTAL: ${sum}, TXS: ${txs.length}`
  )
  console.log('')

  console.log('ERRORS')
  console.log('No available purchase:', noAvailablePurchases.length)
  console.log('No matching withdrawals:', noMatchingWithdrawals.length)
  console.log('Price errors:', priceErrors.length)
  console.log('')

  console.log('Like-Kind Exchanges:', likeKindExchanges.length)
  console.log('Unrealized Gains from Like-Kind Exchanges:', formatPrice(likeKindExchanges.map(sale => sale.buy - sale.cost).reduce((x,y) => x+y)))
  console.log('Short-Term Sales', stSales.length)
  console.log('Long-Term Sales', ltSales.length)
  console.log('Total Gains from Short-Term Sales:', formatPrice(stSales.map(sale => sale.buy - sale.cost).reduce((x,y) => x+y, 0)))
  console.log('Total Gains from Long-Term Sales:', formatPrice(ltSales.map(sale => sale.buy - sale.cost).reduce((x,y) => x+y, 0)))
  console.log('')
}

})()
