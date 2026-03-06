import fs from 'fs/promises'
import memoize from 'nano-persistent-memoizer'
import fetch from 'node-fetch'
import Loan from './@types/Loan.js'
import SecureData from './@types/SecureData.js'
import Ticker from './@types/Ticker.js'
import Trade from './@types/Trade.js'
import Transaction from './@types/Transaction.js'
import log from './log.js'
import Stock from './stock.js'
import airdropSymbols from './util/airdropSymbols.js'
import isUsdEquivalent from './util/isUsdEquivalent.js'
import stake from './util/stake.js'
import stakingSymbols from './util/stakingSymbols.js'
import unstake from './util/unstake.js'

const secure = JSON.parse(await fs.readFile(new URL('../data/secure.json', import.meta.url), 'utf-8')) as SecureData

const stock = Stock()

const SECOND = 1000
const MINUTE = SECOND * 60

/** Group transactions by day. */
const groupByDay = (trades: Trade[]) => {
  const txsByDay: { [key: string]: Trade[] } = {}
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
  /** Any date string that can be parsed by new Date(). */
  time: string,
  options: { exchange?: string } = {},
): Promise<number> => +(await mPrice(JSON.stringify({ from, to, time, exchange: options.exchange || 'cccagg' })))

/** Returns true if the trade is selling crypto for USD. */
const isCryptoSale = (trade: Trade) =>
  (trade.type === 'Withdrawal' &&
    trade.exchange === 'Coinbase' &&
    !trade.fee &&
    trade.sell !== null &&
    trade.sell < 4) || // shift card (infer)
  (trade.type === 'Trade' && trade.curBuy === 'USD') ||
  (trade.type === 'Spend' && trade.exchange !== 'Ledger')

/** Returns true if the trade is buying crypto with USD or a stable coin. */
const isCryptoPurchase = (trade: Trade) => trade.type === 'Trade' && isUsdEquivalent(trade.curSell)

/**
 * Group transactions into several broad categories.
 * Match same-day withdrawals and deposits.
 * Calculate custom cost basis.
 */
const cryptogains = async (
  txs: Trade[],
  options: {
    accounting?: 'fifo' | 'lifo'
    likekind?: boolean
    trace?: Ticker[]
  } = {},
) => {
  const income: Trade[] = []
  const rebates: Trade[] = []
  const cryptoSales: Trade[] = []
  const cryptoPurchases: Trade[] = []
  const deposits: Trade[] = []
  const withdrawals: Trade[] = []
  const margin: Trade[] = []
  const tradeTxs: Trade[] = []
  const airdrops: Trade[] = []
  const staking: Trade[] = []

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
  const priceErrors: Trade[] = []
  const zeroPrices: Trade[] = []
  const minBalance: Trade[] = []

  const txsByDay = groupByDay(txs)

  // pushes price errors to priceErrors instead of throwing
  const tryPrice = async (
    tx: Trade,
    from: string | number | undefined,
    to: string | number | undefined,
    /** Any date string that can be parsed by new Date(). */
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
        ? options.trace.includes(tx.curBuy!)
          ? tx.curBuy!
          : options.trace.includes(tx.curSell!)
            ? tx.curSell!
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
          tx.buy !== null &&
          +ico.Buy === +tx.buy &&
          ico.CurBuy === tx.curBuy &&
          new Date(ico.Date).getTime() === tx.date.getTime(),
      )
      if (ico) {
        tx.type = 'Trade'
        tx.sell = +ico.Sell
        tx.curSell = ico.CurSell
        tx.comment = 'ICO'
      }

      // LENDING

      // must go before Trade
      if (/lending/i.test(tx.tradeGroup ?? '')) {
        let p = tx.price || (await tryPrice(tx, tx.curBuy, 'USD', day(tx.date)))

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
        if (tx.curBuy === 'BTS' && (p as any) > 10) {
          p = 0.2
        }

        // simulate USD Buy
        // use buy because a USD sale "buys" a certain amount of USD, so buy - cost is the profit
        interest.push({
          date: tx.date,
          loanAmount: tx.buy!,
          loanCurrency: tx.curBuy!,
          interestEarnedUSD: tx.buy! * p!,
        })

        // trace
        if (traced) {
          log(`TRACE ${traced} lending`, tx.buy)
          log(`TRACE ${traced} balance`, stock.balance(traced!))
        }
      }

      // MARGIN TRADE

      // must go before isCryptoSale
      // some Bitfinex margin trades are reported as Lost
      // similar to Trade processing, but does not update stock
      else if (/margin/i.test(tx.tradeGroup ?? '') || tx.type === 'Lost') {
        margin.push(tx)

        // handle '-' value
        const buy = isNaN(tx.buy ? 0 : +tx.buy!)
        const sell = isNaN(tx.sell ? 0 : +tx.sell!)

        let buyPrice, sellPrice

        try {
          buyPrice = buy ? tx.price || (await price(tx.curBuy!, 'USD', day(tx.date))) : 0
          sellPrice = sell ? tx.price || (await price(tx.curSell!, 'USD', day(tx.date))) : 0
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
        if (tx.type === 'Trade') {
          const trades = stock.trade({
            isLikekind: undefined,
            sell: +tx.sell!,
            sellCur: tx.curSell,
            buy: +tx.buy!,
            buyCur: 'USD',
            date: tx.date,
            price: undefined,
            type: options.accounting,
          })
          sales.push(...trades)

          // trace
          if (traced) {
            log(`TRACE ${traced} sale`, trades)
            log(`TRACE ${traced} balance`, stock.balance(tx.curSell!))
          }
        }
        // Shift: we have to calculate the historical USD sale value since Coinbase only provides the token price
        else {
          const p =
            tx.price ||
            (await tryPrice(tx, tx.curSell, 'USD', day(tx.date), {
              exchange: tx.exchange,
            })) ||
            0
          const sale = {
            isLikekind: undefined,
            sell: +tx.sell!,
            sellCur: tx.curSell,
            buy: tx.sell! * +p!,
            buyCur: 'USD' as const,
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
        stock.deposit(+tx.buy!, tx.curBuy!, +tx.sell!, tx.date)

        // trace
        if (traced) {
          log(`TRACE ${traced} purchase`, tx.buy)
          log(`TRACE ${traced} balance`, stock.balance(traced!))
        }
      }

      // TRADE

      // crypto-to-crypto trade
      // include ICOs
      else if (tx.type === 'Trade') {
        tradeTxs.push(tx)

        // fetch price of buy currency
        const p = tx.price || (await tryPrice(tx, tx.curBuy, 'USD', day(tx.date)))

        // A zero price could cause problems
        // Luckily it seems quite rare
        if (!p) {
          zeroPrices.push(tx)
        }

        // update cost basis
        const isLikekind = options.likekind && tx.date.getFullYear() < 2018
        const trades = stock.trade({
          isLikekind,
          sell: +tx.sell!,
          sellCur: tx.curSell,
          buy: +tx.buy!,
          buyCur: tx.curBuy,
          date: tx.date,
          price: p,
          type: options.accounting,
        })

        ;(isLikekind ? likeKindExchanges : sales).push(...(trades as any))

        // trace
        if (traced) {
          log(`TRACE ${tx.curSell} -> ${tx.curBuy} trade`, trades)
          log(`TRACE ${traced} balance`, stock.balance(traced!))
        }
      }

      // INCOME
      // Fetch price to determine cost basis and deposit to stock.
      else if (tx.type === 'Income') {
        income.push(tx)

        // update cost basis
        const p = tx.price || (await tryPrice(tx, tx.curBuy, 'USD', day(tx.date))) || 0

        // A zero price could cause problems
        // Luckily it seems quite rare
        if (!p) {
          zeroPrices.push(tx)
        }

        stock.deposit(+tx.buy!, tx.curBuy!, tx.buy! * p, tx.date)
      }

      // REBATE
      // Fetch price to determine cost basis and deposit to stock.
      // Credit card rewards are not considered taxable income. We just need to record the cost basis for future sales.
      else if (tx.type === 'Rebate') {
        rebates.push(tx)

        // update cost basis
        const p = tx.price || (await tryPrice(tx, tx.curBuy, 'USD', day(tx.date))) || 0

        // A zero price could cause problems
        // Luckily it seems quite rare
        if (!p) {
          zeroPrices.push(tx)
        }

        stock.deposit(+tx.buy!, tx.curBuy!, tx.buy! * p, tx.date)

        // trace
        if (traced) {
          log(`TRACE ${traced} income`, tx.buy)
          log(`TRACE ${traced} balance`, stock.balance(traced!))
        }
      }

      // DEPOSIT
      // Deposits are generally treated as internal transfers and are not recorded in the stock.
      // Special cases like AirDrops and presales do update the stock.
      // If the deposit exceeds the stock, then assume the cost basis was lost and add it to the stock with the fallback cost basis (see else condition)
      else if (tx.type === 'Deposit') {
        // air drops have cost basis of 0
        if (tx.curBuy && airdropSymbols.has(tx.curBuy)) {
          airdrops.push(tx)
          stock.deposit(+tx.buy!, tx.curBuy, 0, tx.date)

          // trace
          if (traced) {
            log(`TRACE ${traced} airdrop`, tx.buy)
            log(`TRACE ${traced} balance`, stock.balance(traced!))
          }
        }
        // SALT presale
        else if (tx.curBuy === 'SALT' && tx.date.getFullYear() === 2017) {
          deposits.push(tx)
          stock.deposit(+tx.buy!, tx.curBuy, tx.buy! * 0.25, tx.date)

          // trace
          if (traced) {
            log(`TRACE ${traced} presale`, tx.buy)
            log(`TRACE ${traced} balance`, stock.balance(traced!))
          }
        }
        // Forks have a cost basis of 0
        // e.g. BCH, ETC
        else if (
          (tx.curBuy === 'BCH' && tx.date.getFullYear() === 2017) ||
          (tx.curBuy === 'ETC' && tx.date.getFullYear() === 2016)
        ) {
          deposits.push(tx)
          stock.deposit(+tx.buy!, tx.curBuy, 0, tx.date)

          // trace
          if (traced) {
            log(`TRACE ${traced} fork`, tx.buy)
            log(`TRACE ${traced} balance`, stock.balance(traced!))
          }
        }
        // stake: e.g. ETH -> ETHx
        // A deposit of a staked token with a same-timestamp unstaked withdrawal is a taxable sale of the unstaked token.
        else if (tx.curBuy && stakingSymbols.has(tx.curBuy)) {
          staking.push(tx)

          const curUnstaked = unstake(tx.curBuy)
          if (!curUnstaked) {
            throw new Error(`stakingPairs missing entry for ${tx.curBuy}`)
          }

          // find matching withdrawal with exact same time
          const txWithdrawUnstaked = dayGroup.find(
            otherTx =>
              otherTx.type === 'Withdrawal' &&
              otherTx.curSell === curUnstaked &&
              otherTx.date.getTime() === tx.date.getTime(),
          )

          if (!txWithdrawUnstaked) {
            const sameDayWithdrawals = dayGroup
              .filter(otherTx => otherTx.type === 'Withdrawal')
              .map(otherTx => ({
                ...otherTx,
                timeSinceDeposit: Math.abs(otherTx.date.getTime() - tx.date.getTime()),
              }))
            if (+tx.curBuy >= 0.0000001) {
              console.error(tx.date)
              console.error({ sameDayWithdrawals })
              throw new Error(
                `No matching withdrawal within ${5 * MINUTE} ms (5 min) for staked ${tx.buy} ${tx.curBuy!}`,
              )
            } else {
              log.error(
                `${tx.date}: No matching withdrawal for deposit of ${tx.buy} ${tx.curBuy}, but trade is too small to matter.`,
              )
            }
          } else {
            // Staking is a taxable sale: debit the unstaked asset at its current price,
            // then credit the staked token with that same USD value as its cost basis.
            const p = (await tryPrice(tx, curUnstaked, 'USD', day(tx.date))) || 0

            // taxable amount in USD
            const buyUSD = +txWithdrawUnstaked.sell! * p

            // log as a taxable sale
            sales.push(
              ...stock.trade({
                sell: +txWithdrawUnstaked.sell!,
                sellCur: txWithdrawUnstaked.curSell,
                buy: buyUSD,
                buyCur: 'USD',
                date: tx.date,
                type: options.accounting,
              }),
            )

            // credit the staked token with the same USD cost basis
            stock.deposit(+tx.buy!, tx.curBuy!, buyUSD, tx.date)
          }

          // trace
          if (traced) {
            log(`TRACE ${traced} stake`, tx.buy)
            log(`TRACE ${traced} stake matching withdrawal`, txWithdrawUnstaked)
            log(`TRACE ${traced} balance`, stock.balance(traced!))
          }
        }
        // unstake: e.g. ETHx -> ETH
        // A deposit of an unstaked token with a same-timestamp staked withdrawal is a taxable sale of the staked token.
        else if (
          tx.curBuy &&
          stake(tx.curBuy)?.some(stakedCur =>
            dayGroup.some(
              otherTx =>
                otherTx.type === 'Withdrawal' &&
                otherTx.curSell === stakedCur &&
                otherTx.date.getTime() === tx.date.getTime(),
            ),
          )
        ) {
          staking.push(tx)

          const stakedVariants = stake(tx.curBuy)!
          const txWithdrawStaked = dayGroup.find(
            otherTx =>
              otherTx.type === 'Withdrawal' &&
              stakedVariants.includes(otherTx.curSell!) &&
              otherTx.date.getTime() === tx.date.getTime(),
          )!

          // Unstaking is a taxable sale: debit the staked asset at its current price,
          // then credit the unstaked token with that same USD value as its cost basis.
          const p = (await tryPrice(tx, txWithdrawStaked.curSell, 'USD', day(tx.date))) || 0

          // taxable amount in USD
          const buyUSD = +txWithdrawStaked.sell! * p

          // log as a taxable sale
          sales.push(
            ...stock.trade({
              sell: +txWithdrawStaked.sell!,
              sellCur: txWithdrawStaked.curSell,
              buy: buyUSD,
              buyCur: 'USD',
              date: tx.date,
              type: options.accounting,
            }),
          )

          // credit the unstaked token with the same USD cost basis
          stock.deposit(+tx.buy!, tx.curBuy!, buyUSD, tx.date)

          // trace
          if (traced) {
            log(`TRACE ${traced} unstake`, tx.buy)
            log(`TRACE ${traced} unstake matching withdrawal`, txWithdrawStaked)
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
          if (tx.curBuy && tx.buy && !isUsdEquivalent(tx.curBuy)) {
            const balance = stock.balance(tx.curBuy)
            const diff = +tx.buy - balance
            if (diff > 0!) {
              minBalance.push(tx)
              const fallbackPrice = secure.fallbackPrice[tx.curBuy.toUpperCase()] ?? 0

              log.error(
                `${tx.date}: Deposit of ${tx.buy} ${tx.curBuy} to ${tx.exchange} exceeds current balance of ${balance} ${tx.curBuy}.`,
              )
              log.error(
                `  Adding ${diff} ${tx.curBuy} to stock with $${fallbackPrice} cost basis to ensure adequate balance of ${tx.buy} ${tx.curBuy}.`,
              )

              stock.deposit(diff, tx.curBuy, fallbackPrice, tx.date)
            }
          }

          // trace
          if (traced) {
            log(`TRACE ${traced} deposit`, tx.buy)
            log(`TRACE ${traced} balance`, stock.balance(traced!))
          }
        }
      }

      // WITHDRAWAL
      // Withdrawals are treated as internal transfers and are not recorded in the stock.
      // TODO: Record staking withdrawals in the stock
      else if (tx.type === 'Withdrawal') {
        withdrawals.push(tx)

        // This WILL affect the gains
        // stock.withdraw(+tx.sell!, tx.curSell!, tx.date, options.accounting)

        // trace
        if (traced) {
          log(`TRACE ${traced} withdrawal`, tx.sell)
          log(`TRACE ${traced} balance`, stock.balance(traced!))
        }
      }

      // SPEND
      else if (tx.type === 'Spend') {
        withdrawals.push(tx)
        stock.withdraw(+tx.sell!, tx.curSell!, tx.date, options.accounting)

        // trace
        if (traced) {
          log(`TRACE ${traced} spend`, tx.sell)
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
