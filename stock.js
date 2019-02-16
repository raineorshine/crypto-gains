module.exports = (() => {

  const lots = []

  const next = cur => lots.find(lot => lot.cur === cur)
  const remove = lot => {
    const i = lots.indexOf(lot)
    lots.splice(i, 1)
  }

  const deposit = (amount, cur, cost, date) => {
    lots.push({ amount, cur, cost, date })
  }

  const withdraw = (amount, cur, date) => {
  }

  const trade = (sell, sellCur, buy, buyCur, date) => {
    let pending = sell
    const exchanges = []
    while (pending > 0) {
      const lot = next(sellCur)
      let lotDebit, cost
      if (!lot) throw new Error(`No available purchase for ${sell} ${sellCur} (${sell - pending} ${sellCur} found)`)

      // lot has a larger supply than is needed
      if (lot.amount > pending) {
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

      exchanges.push({
        buy: buy * (lotDebit / sell),
        buyCur,
        sell: lotDebit,
        sellCur,
        cost
      })
    }

    return exchanges
  }

  return { deposit, withdraw, trade }
})
