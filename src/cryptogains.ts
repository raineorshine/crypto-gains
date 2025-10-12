import fs from 'fs/promises'
import memoize from 'nano-persistent-memoizer'
import fetch from 'node-fetch'
import CoinTrackingTrade from './@types/CoinTrackingTrade.js'
import Loan from './@types/Loan.js'
import SecureData from './@types/SecureData.js'
import Ticker from './@types/Ticker.js'
import Trade from './@types/Trade.js'
import Transaction from './@types/Transaction.js'
import log from './log.js'
import Stock from './stock.js'
import airdropSymbols from './util/airdropSymbols.js'
import isUsdEquivalent from './util/isUsdEquivalent.js'
import stakingSymbols from './util/stakingSymbols.js'
import unstake from './util/unstake.js'

const secure = JSON.parse(await fs.readFile(new URL('../data/secure.json', import.meta.url), 'utf-8')) as SecureData

const stock = Stock()

const SECOND = 1000
const MINUTE = SECOND * 60

/** Group transactions by day. */
const groupByDay = (trades: CoinTrackingTrade[]) => {
  const txsByDay: { [key: string]: CoinTrackingTrade[] } = {}
  for (let i = 0; i < trades.length; i++) {
    const key = day(trades[i].date)
    if (!(key in txsByDay)) {
      txsByDay[key] = []
    }
    txsByDay[key].push(trades[i])
  }
  return txsByDay
}

/** Return a parsable date string representing thn given date at midnight, e.g. 2025-01-31. */
const day = (date: Date): string =>
  `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date
    .getDate()
    .toString()
    .padStart(2, '0')}`

/** Fetches the price from the cryptocompare API using { from, to, time, exchange } embedded in the given key. Must take a single string argument as input to use as the memoizaton key. Persists the memoized value to a file in ./.nano-persisten-memoizer. */
const mPrice = memoize('price').async(async (key: string): Promise<number | string> => {
  // time: any date string that is parsable by new Date()
  const { from, to, time, exchange } = JSON.parse(key)

  if (from === to) return 1

  console.log(time)
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
  // any time string that is parsable by new Date()
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
    trace?: Ticker[]
  } = {},
) => {
  const income: CoinTrackingTrade[] = []
  const rebates: CoinTrackingTrade[] = []
  const cryptoSales: CoinTrackingTrade[] = []
  const cryptoPurchases: CoinTrackingTrade[] = []
  const deposits: CoinTrackingTrade[] = []
  const withdrawals: CoinTrackingTrade[] = []
  const margin: CoinTrackingTrade[] = []
  const tradeTxs: CoinTrackingTrade[] = []
  const airdrops: CoinTrackingTrade[] = []
  const staking: CoinTrackingTrade[] = []

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
  const priceErrors: CoinTrackingTrade[] = []
  const zeroPrices: CoinTrackingTrade[] = []
  const minBalance: CoinTrackingTrade[] = []

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

      /** The ticker that is currently traced in this transaction, regardless of whether it is a buy or sell. Otherwise returns null. */
      const traced = options.trace
        ? options.trace.includes(tx.CurBuy!)
          ? tx.CurBuy!
          : options.trace.includes(tx.CurSell!)
            ? tx.CurSell!
            : null
        : null

      // trace
      if (traced) {
        log(`\nTRACE ${traced}`, 'tx', JSON.stringify(tx))
      }

      // convert ICO's to Trade
      // the matching withdrawal of CurSell can be ignored since it does no affect cost basis
      const ico = secure.icos.find(
        ico =>
          tx.Buy !== null &&
          +ico.Buy === +tx.Buy &&
          ico.CurBuy === tx.CurBuy &&
          new Date(ico.Date).getTime() === tx.date.getTime(),
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
        let p = tx.Price || (await tryPrice(tx, tx.CurBuy, 'USD', day(tx.date)))

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
          date: tx.date,
          loanAmount: tx.Buy!,
          loanCurrency: tx.CurBuy!,
          interestEarnedUSD: tx.Buy! * p!,
        })

        // trace
        if (traced) {
          log(`TRACE ${traced} lending`, tx.Buy)
          log(`TRACE ${traced} balance`, stock.balance(traced!))
        }
      }

      // MARGIN TRADE

      // must go before isCryptoSale
      // some Bitfinex margin trades are reported as Lost
      // similar to Trade processing, but does not update stock
      else if (/margin/i.test(tx['Trade Group'] ?? '') || tx.Type === 'Lost') {
        margin.push(tx)

        // handle '-' value
        const buy = isNaN(tx.Buy ? 0 : +tx.Buy!)
        const sell = isNaN(tx.Sell ? 0 : +tx.Sell!)

        let buyPrice, sellPrice

        try {
          buyPrice = buy ? tx.Price || (await price(tx.CurBuy!, 'USD', day(tx.date))) : 0
          sellPrice = sell ? tx.Price || (await price(tx.CurSell!, 'USD', day(tx.date))) : 0
        } catch (e: any) {
          log.error(`Error fetching price`, e.message)
          priceErrors.push(tx)
        }

        // simulate USD Buy
        // use buy because a USD sale "buys" a certain amount of USD, so buy - cost is the profit
        const sale: Transaction = {
          buy: +sell * +sellPrice!,
          buyCur: 'USD',
          cost: +buy * +buyPrice!,
          // count as short-term gains
          date: tx.date,
          dateAcquired: tx.date,
        }
        sales.push(sale)

        // trace
        if (traced) {
          log(`TRACE ${traced} margin trade`, sale)
          log(`TRACE ${traced} balance`, stock.balance(traced!))
        }
      }

      // SALE

      // USD buy = crypto sale
      // must go before Trade and Withdrawal
      else if (isCryptoSale(tx)) {
        cryptoSales.push(tx)

        // update cost basis
        // Trade to USD
        if (tx.Type === 'Trade') {
          const trades = stock.trade({
            isLikekind: undefined,
            sell: +tx.Sell!,
            sellCur: tx.CurSell,
            buy: +tx.Buy!,
            buyCur: 'USD',
            date: tx.date,
            price: undefined,
            type: options.accounting,
          })
          sales.push(...trades)

          // trace
          if (traced) {
            log(`TRACE ${traced} sale`, trades)
            log(`TRACE ${traced} balance`, stock.balance(tx.CurSell!))
          }
        }
        // Shift: we have to calculate the historical USD sale value since Coinbase only provides the token price
        else {
          const p =
            tx.Price ||
            (await tryPrice(tx, tx.CurSell, 'USD', day(tx.date), {
              exchange: tx.Exchange,
            })) ||
            0
          const sale: Trade = {
            isLikekind: undefined,
            sell: +tx.Sell!,
            sellCur: tx.CurSell,
            buy: tx.Sell! * +p!,
            buyCur: 'USD',
            date: tx.date,
            price: undefined,
            type: options.accounting,
          }
          sales.push(...stock.trade(sale))

          // trace
          if (traced) {
            log(`TRACE ${traced} margin trade`, sale)
            log(`TRACE ${traced} balance`, stock.balance(traced!))
          }
        }
      }

      // PURCHASE

      // usd-to-crypto
      // must go before crypto-to-crypto trade
      else if (isCryptoPurchase(tx)) {
        cryptoPurchases.push(tx)
        stock.deposit(+tx.Buy!, tx.CurBuy!, +tx.Sell!, tx.date)

        // trace
        if (traced) {
          log(`TRACE ${traced} purchase`, tx.Buy)
          log(`TRACE ${traced} balance`, stock.balance(traced!))
        }
      }

      // TRADE

      // crypto-to-crypto trade
      // include ICOs
      else if (tx.Type === 'Trade') {
        tradeTxs.push(tx)

        // fetch price of buy currency
        const p = tx.Price || (await tryPrice(tx, tx.CurBuy, 'USD', day(tx.date)))

        // A zero price could cause problems
        // Luckily it seems quite rare
        if (!p) {
          zeroPrices.push(tx)
        }

        // update cost basis
        const isLikekind = options.likekind && tx.date.getFullYear() < 2018
        const trades = stock.trade({
          isLikekind,
          sell: +tx.Sell!,
          sellCur: tx.CurSell,
          buy: +tx.Buy!,
          buyCur: tx.CurBuy,
          date: tx.date,
          price: p,
          type: options.accounting,
        })

        ;(isLikekind ? likeKindExchanges : sales).push(...(trades as any))

        // trace
        if (traced) {
          log(`TRACE ${tx.CurSell} -> ${tx.CurBuy} trade`, trades)
          log(`TRACE ${traced} balance`, stock.balance(traced!))
        }
      }

      // INCOME
      // Fetch price to determine cost basis and deposit to stock.
      else if (tx.Type === 'Income') {
        income.push(tx)

        // update cost basis
        const p = tx.Price || (await tryPrice(tx, tx.CurBuy, 'USD', day(tx.date))) || 0

        // A zero price could cause problems
        // Luckily it seems quite rare
        if (!p) {
          zeroPrices.push(tx)
        }

        stock.deposit(+tx.Buy!, tx.CurBuy!, tx.Buy! * p, tx.date)
      }

      // REBATE
      // Fetch price to determine cost basis and deposit to stock.
      // Credit card rewards are not considered taxable income. We just need to record the cost basis for future sales.
      else if (tx.Type === 'Rebate') {
        rebates.push(tx)

        // update cost basis
        const p = tx.Price || (await tryPrice(tx, tx.CurBuy, 'USD', day(tx.date))) || 0

        // A zero price could cause problems
        // Luckily it seems quite rare
        if (!p) {
          zeroPrices.push(tx)
        }

        stock.deposit(+tx.Buy!, tx.CurBuy!, tx.Buy! * p, tx.date)

        // trace
        if (traced) {
          log(`TRACE ${traced} income`, tx.Buy)
          log(`TRACE ${traced} balance`, stock.balance(traced!))
        }
      }

      // DEPOSIT
      else if (tx.Type === 'Deposit') {
        // air drops have cost basis of 0
        if (tx.CurBuy && airdropSymbols.has(tx.CurBuy)) {
          airdrops.push(tx)
          stock.deposit(+tx.Buy!, tx.CurBuy, 0, tx.date)

          // trace
          if (traced) {
            log(`TRACE ${traced} airdrop`, tx.Buy)
            log(`TRACE ${traced} balance`, stock.balance(traced!))
          }
        }
        // SALT presale
        else if (tx.CurBuy === 'SALT' && tx.date.getFullYear() === 2017) {
          deposits.push(tx)
          stock.deposit(+tx.Buy!, tx.CurBuy, tx.Buy! * 0.25, tx.date)

          // trace
          if (traced) {
            log(`TRACE ${traced} presale`, tx.Buy)
            log(`TRACE ${traced} balance`, stock.balance(traced!))
          }
        }
        // Forks have a cost basis of 0
        // e.g. BCH, ETC
        else if (
          (tx.CurBuy === 'BCH' && tx.date.getFullYear() === 2017) ||
          (tx.CurBuy === 'ETC' && tx.date.getFullYear() === 2016)
        ) {
          deposits.push(tx)
          stock.deposit(+tx.Buy!, tx.CurBuy, 0, tx.date)

          // trace
          if (traced) {
            log(`TRACE ${traced} fork`, tx.Buy)
            log(`TRACE ${traced} balance`, stock.balance(traced!))
          }
        }
        // stake
        else if (tx.CurBuy && stakingSymbols.has(tx.CurBuy)) {
          staking.push(tx)

          const unstaked = unstake(tx.CurBuy)
          if (!unstaked) {
            throw new Error(`stakingPairs missing entry for ${tx.CurBuy}`)
          }

          // find matching withdrawal with exact same time
          let txMatching = dayGroup.find(
            otherTx =>
              otherTx.Type === 'Withdrawal' &&
              otherTx.CurSell === unstaked &&
              otherTx.date.getTime() === tx.date.getTime(),
          )

          // fallback to matching withdrawals within 5 minutes
          const txs = txMatching
            ? [txMatching]
            : dayGroup.filter(
                otherTx =>
                  otherTx.Type === 'Withdrawal' &&
                  otherTx.CurSell === unstaked &&
                  Math.abs(otherTx.date.getTime() - tx.date.getTime()) < 5 * MINUTE,
              )

          if (txs.length === 0) {
            const sameDayWithdrawals = dayGroup
              .filter(otherTx => otherTx.Type === 'Withdrawal')
              .map(otherTx => ({
                ...otherTx,
                timeSinceDeposit: Math.abs(otherTx.date.getTime() - tx.date.getTime()),
              }))
            if (+tx.CurBuy >= 0.0000001) {
              console.error(tx.date)
              console.error({ sameDayWithdrawals })
              throw new Error(
                `No matching withdrawal within ${5 * MINUTE} ms (5 min) for staked ${tx.Buy} ${tx.CurBuy!}`,
              )
            } else {
              log.error(
                `${tx.date}: No matching withdrawal for deposit of ${tx.Buy} ${tx.CurBuy}, but trade is too small to matter.`,
              )
            }
          } else if (txs.length > 1) {
            console.error(tx.date)
            console.error(
              txs.map(otherTx => ({
                ...otherTx,
                timeSinceDeposit: Math.abs(otherTx.date.getTime() - tx.date.getTime()),
              })),
            )
            throw new Error(
              `Too many matching withdrawals within ${5 * MINUTE} ms (5 min) for staked ${tx.Buy} ${tx.CurBuy!}`,
            )
          } else {
            txMatching = txs[0]

            // TODO: Cost Basis
            stock.deposit(+tx.Buy!, tx.CurBuy, 0, tx.date)
            stock.withdraw(+txMatching.Sell!, txMatching.CurSell, tx.date, options.accounting)
          }

          // trace
          if (traced) {
            log(`TRACE ${traced} stake`, tx.Buy)
            log(`TRACE ${traced} stake matching withdrawal`, txMatching)
            log(`TRACE ${traced} balance`, stock.balance(traced!))
          }
        }
        // Otherwise assume the deposit is an internal transfer.
        // No need to change the stock or cost basis.
        else {
          deposits.push(tx)

          // If the deposit amount is greater than the current balance, then we are missing the record of a trade.
          // TODO: How to differentiate an internal transfer from an initial deposit?
          // There should be no such thing as an initial deposit, because acquiring a token always begins with a trade.
          if (tx.CurBuy && tx.Buy && !isUsdEquivalent(tx.CurBuy)) {
            const balance = stock.balance(tx.CurBuy)
            const diff = +tx.Buy - balance
            if (diff > 0!) {
              minBalance.push(tx)
              const fallbackPrice = secure.fallbackPrice[tx.CurBuy.toUpperCase()] ?? 0

              log.error(
                `${tx.date}: Deposit of ${tx.Buy} ${tx.CurBuy} to ${tx.Exchange} exceeds current balance of ${balance} ${tx.CurBuy}.`,
              )
              log.error(
                `  Adding ${diff} ${tx.CurBuy} to stock with $${fallbackPrice} cost basis to ensure adequate balance of ${tx.Buy} ${tx.CurBuy}.`,
              )

              stock.deposit(diff, tx.CurBuy, fallbackPrice, tx.date)
            }
          }

          // trace
          if (traced) {
            log(`TRACE ${traced} deposit`, tx.Buy)
            log(`TRACE ${traced} balance`, stock.balance(traced!))
          }
        }
      }

      // WITHDRAWAL
      else if (tx.Type === 'Withdrawal') {
        withdrawals.push(tx)

        // trace
        if (traced) {
          log(`TRACE ${traced} withdrawal`, tx.Sell)
          log(`TRACE ${traced} balance`, stock.balance(traced!))
        }
      }

      // SPEND
      else if (tx.Type === 'Spend') {
        withdrawals.push(tx)
        stock.withdraw(+tx.Sell!, tx.CurSell!, tx.date, options.accounting)

        // trace
        if (traced) {
          log(`TRACE ${traced} spend`, tx.Sell)
          log(`TRACE ${traced} balance`, stock.balance(traced!))
        }
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
    staking,
    deposits,
    withdrawals,
    tradeTxs,
    margin,
    sales,
    interest,
    likeKindExchanges,
    priceErrors,
    zeroPrices,
    stock,
    minBalance,
  }
}

export default cryptogains
