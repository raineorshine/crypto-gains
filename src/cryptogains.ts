import fs from 'fs/promises'
import memoize from 'nano-persistent-memoizer'
import fetch from 'node-fetch'
import CoinTrackingTrade from './@types/CoinTrackingTrade.js'
import Loan from './@types/Loan.js'
import Ticker from './@types/Ticker.js'
import Transaction from './@types/Transaction.js'
import log from './log.js'
import normalDate from './normalDate.js'
import Stock from './stock.js'
import airdropSymbols from './util/airdropSymbols.js'
import isUsdEquivalent from './util/isUsdEquivalent.js'

const secure = JSON.parse(await fs.readFile(new URL('../data/secure.json', import.meta.url), 'utf-8')) as {
  cryptoCompareApiKey: string
  icos: {
    Buy: string
    CurBuy: Ticker
    Sell: string
    CurSell: Ticker
    Date: string
  }[]
  fallbackPrice: { [key: string]: number }
}

const stock = Stock()

/** Group transactions by day. */
const groupByDay = (trades: CoinTrackingTrade[]) => {
  const txsByDay: { [key: string]: CoinTrackingTrade[] } = {}
  for (let i = 0; i < trades.length; i++) {
    const key = day(trades[i]['Trade Date'])
    if (!(key in txsByDay)) {
      txsByDay[key] = []
    }
    txsByDay[key].push(trades[i])
  }
  return txsByDay
}

/** Get the day of the normalized date string. */
const day = (date: string) => date.split(' ')[0]

// memoized price
const mPrice = memoize('price').async(async (key: string): Promise<number | string> => {
  const { from, to, time, exchange } = JSON.parse(key)

  if (from === to) return 1

  const url = `https://min-api.cryptocompare.com/data/pricehistorical?fsym=${from}&tsyms=${to}&ts=${
    new Date(time).getTime() / 1000
  }&e=${exchange}&api_key=${secure.cryptoCompareApiKey}&calculationType=MidHighLow&extraParams=cost-basis-filler`
  const response = await fetch(url)
  const data = (await response.json()) as any

  if (data[from]) {
    return data[from][to]
  } else if (data.Message.startsWith('There is no data for')) {
    throw new Error(`No price for ${from} on ${time}`)
  } else if (data.Response === 'Error') {
    throw new Error(data.Message)
  } else {
    throw new Error('Unknown Response', data)
  }
})

// calculate the price of a currency in a countercurrency
// stringify arguments into caching key for memoize
const price = async (
  from: string | number,
  to: string | number,
  time: string,
  options: { exchange?: string } = {},
): Promise<number> => +(await mPrice(JSON.stringify({ from, to, time, exchange: options.exchange || 'cccagg' })))

/** Returns true if the trade is selling crypto for USD. */
const isCryptoSale = (trade: CoinTrackingTrade) =>
  (trade.Type === 'Withdrawal' &&
    trade.Exchange === 'Coinbase' &&
    !trade.Fee &&
    trade.Sell !== null &&
    trade.Sell < 4) || // shift card (infer)
  (trade.Type === 'Trade' && trade.CurBuy === 'USD') ||
  (trade.Type === 'Spend' && trade.Exchange !== 'Ledger')

/** Returns true if the trade is buying crypto with USD or a stable coin. */
const isCryptoPurchase = (trade: CoinTrackingTrade) => trade.Type === 'Trade' && isUsdEquivalent(trade.CurSell)

/**
 * Group transactions into several broad categories.
 * Match same-day withdrawals and deposits.
 * Calculate custom cost basis.
 */
const cryptogains = async (
  txs: CoinTrackingTrade[],
  options: {
    accounting?: 'fifo' | 'lifo'
    likekind?: boolean
  } = {},
) => {
  const income: CoinTrackingTrade[] = []
  const rebates: CoinTrackingTrade[] = []
  const cryptoSales: CoinTrackingTrade[] = []
  const cryptoPurchases: CoinTrackingTrade[] = []
  const usdDeposits: CoinTrackingTrade[] = []
  const deposits: CoinTrackingTrade[] = []
  const withdrawals: CoinTrackingTrade[] = []
  const margin: CoinTrackingTrade[] = []
  const tradeTxs: CoinTrackingTrade[] = []
  const airdrops: CoinTrackingTrade[] = []

  /* List of sales (not including like-kind-exchanges)
  {
    buy             // total sell amount in USD (it is called "buy" because we are "buying" USD)
    buyCur          // Always USD
    cost            // USD value of crypto that is sold
    date            // date of the trade
    dateAcquired    // date the original asset was acquired
  }
  */
  const sales: Transaction[] = []
  const interest: Loan[] = [] // loan interest earned must be reported differently than sales
  const likeKindExchanges: Transaction[] = []
  const noMatchingWithdrawals: string[] = []
  const priceErrors: CoinTrackingTrade[] = []
  const zeroPrices: CoinTrackingTrade[] = []

  const txsByDay = groupByDay(txs)

  // pushes price errors to priceErrors instead of throwing
  const tryPrice = async (
    tx: CoinTrackingTrade,
    from: string | number | undefined,
    to: string | number | undefined,
    time: string,
    options?: Parameters<typeof price>[3],
  ): Promise<number | undefined> => {
    if (from == null) {
      log.error('Missing from price')
      priceErrors.push(tx)
      return undefined
    } else if (to == null) {
      log.error('Missing from price')
      priceErrors.push(tx)
      return undefined
    }

    let p
    try {
      // Poloniex market does not exist for some coin pairs
      p = await price(from, to, time, options)
    } catch (e: any) {
      log.error(`Error fetching price of ${from}.`, e.message)
      priceErrors.push(tx)
    }

    return p
  }

  // loop through each day
  for (let key in txsByDay) {
    const dayGroup = txsByDay[key]

    // loop through each of the day's transactions
    for (let i in dayGroup) {
      const tx = dayGroup[i]

      // convert ICO's to Trade
      // the matching withdrawal of CurSell can be ignored since it does no affect cost basis
      const ico = secure.icos.find(
        ico => tx.Buy !== null && +ico.Buy === +tx.Buy && ico.CurBuy === tx.CurBuy && ico.Date === tx['Trade Date'],
      )
      if (ico) {
        tx.Type = 'Trade'
        tx.Sell = +ico.Sell
        tx.CurSell = ico.CurSell
        tx.Comment = 'ICO'
      }

      // LENDING

      // must go before Trade
      if (/lending/i.test(tx['Trade Group'] ?? '')) {
        let p = tx.Price || (await tryPrice(tx, tx.CurBuy, 'USD', day(normalDate(tx['Trade Date']))))

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
        if (tx.CurBuy === 'BTS' && (p as any) > 10) {
          p = 0.2
        }

        // simulate USD Buy
        // use buy because a USD sale "buys" a certain amount of USD, so buy - cost is the profit
        interest.push({
          date: tx['Trade Date'],
          loanAmount: tx.Buy!,
          loanCurrency: tx.CurBuy!,
          interestEarnedUSD: tx.Buy! * p!,
        })
      }

      // MARGIN

      // must go before iscryptoSales
      // some Bitfinex margin trades are reported as Lost
      // similar to Trade processing, but does not update stock
      else if (/margin/i.test(tx['Trade Group'] ?? '') || tx.Type === 'Lost') {
        margin.push(tx)

        // handle '-' value
        const buy = isNaN(tx.Buy ? 0 : +tx.Buy!)
        const sell = isNaN(tx.Sell ? 0 : +tx.Sell!)

        let buyPrice, sellPrice

        try {
          buyPrice = buy ? tx.Price || (await price(tx.CurBuy!, 'USD', day(normalDate(tx['Trade Date'])))) : 0
          sellPrice = sell ? tx.Price || (await price(tx.CurSell!, 'USD', day(normalDate(tx['Trade Date'])))) : 0
        } catch (e: any) {
          log.error(`Error fetching price`, e.message)
          priceErrors.push(tx)
        }

        // simulate USD Buy
        // use buy because a USD sale "buys" a certain amount of USD, so buy - cost is the profit
        sales.push({
          buy: +sell * +sellPrice!,
          buyCur: 'USD',
          cost: +buy * +buyPrice!,
          // count as short-term gains
          date: tx['Trade Date'],
          dateAcquired: tx['Trade Date'],
        })
      }

      // SALE

      // USD buy = crypto sale
      // must go before Trade and Withdrawal
      else if (isCryptoSale(tx)) {
        cryptoSales.push(tx)

        // update cost basis
        // Trade to USD
        if (tx.Type === 'Trade') {
          sales.push(
            ...stock.trade({
              isLikekind: undefined,
              sell: +tx.Sell!,
              sellCur: tx.CurSell,
              buy: +tx.Buy!,
              buyCur: 'USD',
              date: tx['Trade Date'],
              price: undefined,
              type: options.accounting,
            }),
          )
        }
        // Shift: we have to calculate the historical USD sale value since Coinbase only provides the token price
        else {
          const p =
            tx.Price ||
            (await tryPrice(tx, tx.CurSell, 'USD', day(normalDate(tx['Trade Date'])), {
              exchange: tx.Exchange,
            })) ||
            0
          sales.push(
            ...stock.trade({
              isLikekind: undefined,
              sell: +tx.Sell!,
              sellCur: tx.CurSell,
              buy: tx.Sell! * +p!,
              buyCur: 'USD',
              date: tx['Trade Date'],
              price: undefined,
              type: options.accounting,
            }),
          )
        }
      }

      // PURCHASE

      // usd-to-crypto
      // must go before crypto-to-crypto trade
      else if (isCryptoPurchase(tx)) {
        cryptoPurchases.push(tx)
        stock.deposit(+tx.Buy!, tx.CurBuy!, +tx.Sell!, tx['Trade Date'])
      }

      // TRADE

      // crypto-to-crypto trade
      // include ICOs
      else if (tx.Type === 'Trade') {
        tradeTxs.push(tx)

        // fetch price of buy currency
        const p = tx.Price || (await tryPrice(tx, tx.CurBuy, 'USD', day(normalDate(tx['Trade Date']))))

        // A zero price could cause problems
        // Luckily it seems quite rare
        if (!p) {
          zeroPrices.push(tx)
        }

        // update cost basis
        const isLikekind = options.likekind && new Date(normalDate(tx['Trade Date'])).getFullYear() < 2018
        const trades = stock.trade({
          isLikekind,
          sell: +tx.Sell!,
          sellCur: tx.CurSell,
          buy: +tx.Buy!,
          buyCur: tx.CurBuy,
          date: tx['Trade Date'],
          price: p,
          type: options.accounting,
        })

        ;(isLikekind ? likeKindExchanges : sales).push(...(trades as any))
      }

      // INCOME
      // Fetch price to determine cost basis and deposit to stock.
      else if (tx.Type === 'Income') {
        income.push(tx)

        // update cost basis
        const p = tx.Price || (await tryPrice(tx, tx.CurBuy, 'USD', day(normalDate(tx['Trade Date'])))) || 0

        // A zero price could cause problems
        // Luckily it seems quite rare
        if (!p) {
          zeroPrices.push(tx)
        }

        stock.deposit(+tx.Buy!, tx.CurBuy!, tx.Buy! * p, tx['Trade Date'])
      }

      // REBATE
      // Fetch price to determine cost basis and deposit to stock.
      // Credit card rewards are not considered taxable income. We just need to record the cost basis for future sales.
      else if (tx.Type === 'Rebate') {
        rebates.push(tx)

        // update cost basis
        const p = tx.Price || (await tryPrice(tx, tx.CurBuy, 'USD', day(normalDate(tx['Trade Date'])))) || 0

        // A zero price could cause problems
        // Luckily it seems quite rare
        if (!p) {
          zeroPrices.push(tx)
        }

        stock.deposit(+tx.Buy!, tx.CurBuy!, tx.Buy! * p, tx['Trade Date'])
      }

      // DEPOSIT
      else if (tx.Type === 'Deposit') {
        // air drops have cost basis of 0
        if (tx.CurBuy && airdropSymbols.has(tx.CurBuy)) {
          airdrops.push(tx)
          stock.deposit(+tx.Buy!, tx.CurBuy, 0, tx['Trade Date'])
        }
        // SALT presale
        else if (tx.CurBuy === 'SALT' && tx['Trade Date'].includes('2017')) {
          deposits.push(tx)
          stock.deposit(+tx.Buy!, tx.CurBuy, tx.Buy! * 0.25, tx['Trade Date'])
        }
        // Forks have a cost basis of 0
        // e.g. BCH, ETC
        else if (
          (tx.CurBuy === 'BCH' && tx['Trade Date'].includes('2017')) ||
          (tx.CurBuy === 'ETC' && tx['Trade Date'].includes('2016'))
        ) {
          deposits.push(tx)
          stock.deposit(+tx.Buy!, tx.CurBuy, 0, tx['Trade Date'])
        }
        // Otherwise assume the deposit is an internal transfer.
        // No need to change the stock or cost basis.
        else {
          deposits.push(tx)
        }
      }

      // WITHDRAWAL
      else if (tx.Type === 'Withdrawal') {
        withdrawals.push(tx)
      }

      // SPEND
      else if (tx.Type === 'Spend') {
        withdrawals.push(tx)
        stock.withdraw(+tx.Sell!, tx.CurSell!, tx['Trade Date'], options.accounting)
      }

      // UNKNOWN
      else {
        throw new Error('I do not know how to handle this transaction: \n\n' + JSON.stringify(tx))
      }
    }
  }

  return {
    income,
    rebates,
    cryptoSales,
    cryptoPurchases,
    airdrops,
    usdDeposits,
    deposits,
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
  }
}

export default cryptogains
