// known currencies that have missing prices
const currenciesWithMissingPrices = {
  APPC: 1,
  SNT: 1,
}

const closeEnough = (a, b) => Math.abs(a - b) <= 0.02

const Stock = () => {
  const lots = []

  const balance = cur => lots.filter(lot => lot.cur === cur).reduce((prev, item) => prev + item.amount, 0)
  const next = (cur, type = 'fifo') => (type === 'fifo' ? lots : lots.slice().reverse()).find(lot => lot.cur === cur)
  const remove = lot => lots.splice(lots.indexOf(lot), 1)
  const deposit = (amount, cur, cost, date) => lots.push({ amount, cur, cost, date })

  // assume withdraw is not a sale; maintain cost basis
  // validates available purchases
  const withdraw = (amount, cur, date, type = 'fifo') => {
    let pending = amount
    const exchangeLots = []

    // get all lots of the withdawal currency
    const curLots = lots.filter(lot => lot.cur === cur)
    let i = type === 'fifo' ? 0 : curLots.length - 1

    while (pending > 0) {
      // must use index since lots are not removed with withdraw
      const lot = curLots[type === 'fifo' ? i++ : i--]
      if (!lot)
        throw new NoAvailablePurchaseError(
          `withdraw: No available purchase for ${amount} ${cur} on ${date} (${amount - pending} ${cur} found)`,
        )

      let lotDebit, cost

      // lot has a larger supply than is needed
      if (lot.amount > pending || closeEnough(lot.amount, pending)) {
        lotDebit = pending
        cost = lot.cost * (pending / lot.amount)
        pending = 0
      }
      // lot is close enough
      // lot is not big enough
      else {
        lotDebit = lot.amount
        cost = lot.cost
        pending -= lot.amount
      }

      exchangeLots.push({
        amount: lotDebit,
        cur,
        cost,
        date: lot.date,
      })
    }

    return exchangeLots
  }

  /** Perform a trade by debiting the sell asset and crediting the buy asset. Debits from multiple lots with different cost bases.
   *
   * @param price Updates the cost basis of the new lot. Gains are calculated from the original cost basis in the return value. If isLikekind, the cost basis is preserved.
   */
  const trade = ({ sell, sellCur, buy, buyCur, date, price, isLikekind, type }) => {
    type = type || 'fifo'
    let pending = sell
    const trades = []
    while (pending > 0) {
      // next lot with the sell currency
      let lot

      // amount of sell currency to debit from lot
      let sellPartial

      // cost in USD of the currency sold
      // i.e. proportional cost of the amount that is taken from the lot
      let costPartial

      // USD sale (i.e. crypto purchase): do not track USD in stock since it is the basis
      if (sellCur === 'USD') {
        sellPartial = sell
        costPartial = sell
        pending = 0
      }
      // Non-USD sale: actual trade
      else {
        // if a taxable sale (i.e. trading to USD), we can calculate the price directly from the trade
        if (buyCur === 'USD') {
          price = buy / sell
        }

        // get the next lot with the sell currency
        // it will be either completely partially consumed in the trade (mutation)
        lot = next(sellCur, type)
        if (!lot)
          throw new NoAvailablePurchaseError(
            `trade: No available purchase for ${sell} ${sellCur} trade on ${date} (${sell - pending} ${sellCur} found)`,
          )

        // lot has a larger supply than is needed
        if (lot.amount > pending || closeEnough(lot.amount, pending)) {
          sellPartial = pending
          costPartial = lot.cost * (sellPartial / lot.amount) // proportional cost of the amount that is taken from the lot
          lot.amount -= pending // debit sell amount from lot
          lot.cost -= costPartial // debit partial cost from lot
          pending = 0
        }
        // lot is not big enough, take what we can
        else {
          remove(lot)
          sellPartial = lot.amount
          costPartial = lot.cost
          pending -= lot.amount
        }
      }

      // if the price is missing, we're purchasing a non-zero amount, and it is not a currency that is known to have missing prices, then throw an error
      if (!price && buy && !currenciesWithMissingPrices[buyCur]) {
        console.error('args', { sell, sellCur, buy, buyCur, date, price, isLikekind, type })
        console.error('lot', lot)
        throw new Error('Missing Price')
      }

      // proportional amount of the buy amount
      // if the lot is big enough to make the entire sale, then it equals the full buy amount
      //   i.e. if sellPartial === sell, then buyPartial === buy
      // otherwise, it only equals a portion of the full buy amount
      //   e.g. if we can only debit 50% of the sell amount, then we can only buy 50% of the buy amount
      const buyPartial = buy * (sellPartial / sell)

      // set the cost basis of the new lot to the proportional cost at the new buy price
      const costPartialNew = buyPartial * price

      // add a new lot of the purchased currency
      const lotNew = {
        amount: buyPartial,
        cur: buyCur,
        // give the new lot the old cost basis if like-kind exchange
        cost: isLikekind ? costPartial : costPartialNew,
        // transfer the deferred gains from the old lot to the new lot
        // we don't need to add old lot's deferred gains since costPartial still represents the original cost basis of the like-kind exchange
        deferredGains: isLikekind ? costPartialNew - costPartial : 0,
        date: lot && isLikekind ? lot.date : date,
      }

      // do not store new lot for crypto sale to USD
      // it would get ignored anyway
      if (buyCur !== 'USD') {
        lots.push(lotNew)
      }

      // record the trade
      const tradeNew = {
        buy: buyPartial,
        buyCur,
        sell: sellPartial,
        sellCur,
        cost: costPartial,
        // subtract the deferred gains from the previous lot since it has already been recorded
        // thus a sum of deferred gains can be made without including any gains more than once
        deferredGains: lotNew.deferredGains - (lot?.deferredGains || 0),
        date, // include this even though it is an argument in order to make concatenated trades easier
        dateAcquired: lot ? lot.date : date,
      }
      trades.push(tradeNew)
    }

    return trades
  }

  return { balance, deposit, withdraw, trade }
}

function NoAvailablePurchaseError(msg) {
  this.message = msg
}
NoAvailablePurchaseError.prototype = new Error()
Stock.NoAvailablePurchaseError = NoAvailablePurchaseError

module.exports = Stock
