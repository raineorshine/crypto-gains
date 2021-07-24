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
      if (!lot) throw new NoAvailablePurchaseError(`withdraw: No available purchase for ${amount} ${cur} on ${date} (${amount - pending} ${cur} found)`)

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
        date: lot.date
      })
    }

    return exchangeLots
  }

  // newCostBasis is used to calculate the deferred gains
  // if isSale, new cost basis sets the cost basis of the new currency (i.e. treats it as a taxable sale)
  // otherwise the cost basis is preserved
  const trade = ({ sell, sellCur, buy, buyCur, date, newCostBasis, isSale, type }) => {
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

      // USD sale: do not track USD in stock since it is the basis
      if (sellCur === 'USD') {
          sellPartial = sell
          costPartial = sell
          pending = 0
      }
      // Non-USD sale: actual trade
      else {
        // get the next lot with the sell currency
        // it will be either completely partially consumed in the trade (mutation)
        lot = next(sellCur, type)
        if (!lot) throw new NoAvailablePurchaseError(`trade: No available purchase for ${sell} ${sellCur} trade on ${date} (${sell - pending} ${sellCur} found)`)

        // lot has a larger supply than is needed
        if (lot.amount > pending || closeEnough(lot.amount, pending)) {
          sellPartial = pending
          costPartial = lot.cost * (sellPartial / lot.amount) // proportional cost of the amount that is taken from the lot
          lot.amount -= pending   // debit sell amount from lot
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

      // proportional amount of the buy amount
      // if the lot is big enough to make the entire sale, then it equals the full buy amount
      //   i.e. if sellPartial === sell, then buyPartial === buy
      // otherwise, it only equals a portion of the full buy amount
      //   e.g. if we can only debit 50% of the sell amount, then we can only buy 50% of the buy amount
      const buyPartial = buy * (sellPartial / sell)

      // add a new lot of the purchased currency
      const lotNew = {
        amount: buyPartial,
        cur: buyCur,
        cost: isSale ? newCostBasis : costPartial, // give the new currency a new cost basis if provided
        deferredGains: (newCostBasis || costPartial) - costPartial,
        date: isSale || !lot ? date : lot.date
      }
      lots.push(lotNew)

      // record the trade
      const tradeNew = {
        buy: buyPartial,
        buyCur,
        sell: sellPartial,
        sellCur,
        cost: costPartial,
        deferredGains: (newCostBasis || costPartial) - costPartial - (lot.deferredGains || 0),
        date, // include this even though it is an argument in order to make concatenated trades easier
        dateAcquired: lot ? lot.date : date
      }
      trades.push(tradeNew)
    }

    return trades
  }

  return { balance, deposit, withdraw, trade }
}

function NoAvailablePurchaseError(msg) { this.message = msg }
NoAvailablePurchaseError.prototype = new Error()
Stock.NoAvailablePurchaseError = NoAvailablePurchaseError

module.exports = Stock
