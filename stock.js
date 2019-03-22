const closeEnough = (a, b) => Math.abs(a - b) <= 0.02

const Stock = () => {

  const lots = []

  const balance = cur => lots.filter(lot => lot.cur === cur).reduce((prev, item) => prev + item.amount, 0)
  const next = cur => lots.find(lot => lot.cur === cur)
  const remove = lot => lots.splice(lots.indexOf(lot), 1)
  const deposit = (amount, cur, cost, date) => lots.push({ amount, cur, cost, date })

  // assume withdraw is not a sale; maintain cost basis
  // validates available purchases
  const withdraw = (amount, cur, date) => {
    let pending = amount
    let lotIndex = 0
    const exchangeLots = []

    // get all lots of the withdawal currency
    const curLots = lots.filter(lot => lot.cur === cur)

    while (pending > 0) {
      const lot = curLots[lotIndex++]
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

  const trade = (sell, sellCur, buy, buyCur, date) => {
    let pending = sell
    const exchanges = []
    while (pending > 0) {

      let lot, lotDebit, cost

      // do not track USD in stock since it is the basis
      if (sellCur === 'USD') {
          lotDebit = sell
          cost = sell
          pending = 0
      }
      // non-USD
      else {
        lot = next(sellCur)
        if (!lot) throw new NoAvailablePurchaseError(`trade: No available purchase for ${sell} ${sellCur} trade on ${date} (${sell - pending} ${sellCur} found)`)

        // lot has a larger supply than is needed
        if (lot.amount > pending || closeEnough(lot.amount, pending)) {
          lotDebit = pending
          cost = lot.cost * (pending / lot.amount)
          lot.amount -= pending
          lot.cost -= cost
          pending = 0
        }
        // lot is not big enough
        else {
          remove(lot)
          lotDebit = lot.amount
          cost = lot.cost
          pending -= lot.amount
        }
      }

      const buyNew = buy * (lotDebit / sell)

      lots.push({
        amount: buyNew,
        cur: buyCur,
        cost,
        date
      })

      exchanges.push({
        buy: buyNew,
        buyCur,
        sell: lotDebit,
        sellCur,
        cost,
        date,
        dateAcquired: lot ? lot.date : date
      })
    }

    return exchanges
  }

  return { balance, deposit, withdraw, trade }
}

function NoAvailablePurchaseError(msg) { this.message = msg }
NoAvailablePurchaseError.prototype = new Error()
Stock.NoAvailablePurchaseError = NoAvailablePurchaseError

module.exports = Stock