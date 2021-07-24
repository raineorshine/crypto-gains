const memoize = require('nano-persistent-memoizer')
const got = require('got')
const secure = require('../data/secure.json')
const Stock = require('./stock.js')

const stock = Stock()

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
const price = async (from, to, time, options) => options.mockprice != null ? options.mockprice : +(await mPrice(JSON.stringify({ from, to, time, exchange: options.exchange })))

const isCryptoToUsd = trade =>
  (trade.Type === 'Withdrawal' && trade.Exchange === 'Coinbase' && !trade.Fee && trade.Sell < 4) || // shift card (infer)
  (trade.Type === 'Trade' && trade.CurBuy === 'USD') ||
  trade.Type === 'Spend'

const isUsdToCrypto = trade =>
  trade.Type === 'Trade' && trade.CurSell === 'USD'

// find a withdrawal in the given list of transactions that matches the given deposit
const findMatchingWithdrawal = (deposit, txs) =>
  txs.find(tx => match(deposit, tx))

// convert airdropSymbols from array to object for O(1) lookup
const airdropIndex = secure.airdropSymbols.reduce((accum, cur) => ({
  ...accum,
  [cur.toLowerCase()]: 1
}), {})
const isAirdrop = symbol => symbol.toLowerCase() in airdropIndex

// group transactions into several broad categories
// match same-day withdrawals and deposits
// calculate custom cost basis
const cryptogains = async (txs, options = {}) => {

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

  // pushes price errors to priceErrors instead of throwing
  const tryPrice = async (tx, ...args) => {
    let p
    try {
      // Poloniex market does not exist for some coin pairs
      p = await price(...args)
    }
    catch(e) {
      console.error(`Error fetching price`, e.message)
      priceErrors.push(tx)
    }

    return p
  }


  // loop through each day
  for (let key in txsByDay) {
    const group = txsByDay[key]

    // loop through each of the day's transactions
    for (let i in group) {
      const tx = group[i]

      // convert ICO's to Trade
      // the matching withdrawal of CurSell can be ignored since it does no affect cost basis
      const ico = secure.icos.find(ico => +ico.Buy === +tx.Buy && ico.CurBuy === tx.CurBuy && ico.Date === tx['Trade Date'])
      if(ico) {
        tx.Type = 'Trade'
        tx.Sell = ico.Sell
        tx.CurSell = ico.CurSell
        tx.Comment = 'ICO'
      }

      // LENDING

      // must go before Trade
      if(/lending/i.test(tx['Trade Group'])) {

        let p = tx.Price || await tryPrice(tx, tx.CurBuy, 'USD', day(normalDate(tx['Trade Date'])), options)

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
          buyPrice = buy ? tx.Price || await price(tx.CurBuy, 'USD', day(normalDate(tx['Trade Date'])), options) : 0
          sellPrice = sell ? tx.Price || await price(tx.CurSell, 'USD', day(normalDate(tx['Trade Date'])), options) : 0
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
            sales.push(...stock.trade(+tx.Sell, tx.CurSell, +tx.Buy, 'USD', tx['Trade Date'], null, null, options.accounting))
          }
          // Shift: we have to calculate the historical USD sale value since Coinbase only provides the token price
          else {
            const p = tx.Price || await tryPrice(tx, tx.CurSell, 'USD', day(normalDate(tx['Trade Date'])), { ...options, exchange: tx.Exchange }) || 0
            sales.push(...stock.trade(+tx.Sell, tx.CurSell, tx.Sell * p, 'USD', tx['Trade Date'], null, null, options.accounting))
          }
        }
        catch (e) {
          if (e instanceof Stock.NoAvailablePurchaseError) {
            if (options.verbose) {
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
      // include ICOs
      else if(tx.Type === 'Trade') {
        tradeTxs.push(tx)

        // update cost basis
        const p = tx.Price || await tryPrice(tx, tx.CurBuy, 'USD', day(normalDate(tx['Trade Date'])), options)

        try {
          const before2018 = options.likekind && (new Date(normalDate(tx['Trade Date']))).getFullYear() < 2018
          const tradeExchanges = stock.trade(+tx.Sell, tx.CurSell, +tx.Buy, tx.CurBuy, tx['Trade Date'], p, !before2018, options.accounting)

          ;(before2018 ? likeKindExchanges : sales)
            .push(...tradeExchanges)
        }
        catch (e) {
          if (e instanceof Stock.NoAvailablePurchaseError) {
            if (options.verbose) {
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
        const p = tx.Price || await tryPrice(tx, tx.CurBuy, 'USD', day(normalDate(tx['Trade Date'])), options) || 0

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
        else if (isAirdrop(tx.CurBuy)) {
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
        // Forks: BCH, ETC
        else if (tx.CurBuy === 'BCH' && tx['Trade Date'].includes('2017') ||
          tx.CurBuy === 'ETC' && tx['Trade Date'].includes('2016')) {
          matched.push(tx)
          stock.deposit(+tx.Buy, tx.CurBuy, 0, tx['Trade Date'])
        }
        // otherwise we have an unmatched transaction and need to fallback to the day-of price
        // and add it to the stock
        else {

          const p = tx.Price || await tryPrice(tx, tx.CurBuy, 'USD', day(normalDate(tx['Trade Date'])), options)

          // do not report missing USDT purchases as warnings, since the cost basis is invariant
          if (tx.CurBuy === 'USDT') {
            matched.push(tx)
          }
          else {
            const message = `WARNING: No matching withdrawal for deposit of ${tx.Buy} ${tx.CurBuy} on ${tx['Trade Date']}. Using historical price.`
            if (options.verbose) {
              console.warn(message)
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

module.exports = cryptogains
