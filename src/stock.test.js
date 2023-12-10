const Stock = require('./stock.js')
const assert = require('assert')
const closeEnough = (a, b) => Math.abs(a - b) <= 0.02

describe('stock', () => {
  describe('deposit', () => {
    it('basic functionality', () => {
      const stock = Stock()
      const date = new Date()
      stock.deposit(1, 'BTC', 100, date)
      stock.deposit(2, 'BTC', 500, date)
    })

    it('balance', () => {
      const stock = Stock()
      const date = new Date()
      stock.deposit(1, 'BTC', 100, date)
      stock.deposit(2, 'BTC', 500, date)
      assert.equal(stock.balance('BTC'), 3)
    })
  })

  describe('trade', () => {
    it('return a single lot when the full trade is available at the same cost basis', () => {
      const stock = Stock()
      const date = new Date()
      stock.deposit(1, 'BTC', 4000, date)
      const trades = stock.trade({
        sell: 1,
        sellCur: 'BTC',
        buy: 10,
        buyCur: 'ETH',
        date,
        price: 400,
      })
      assert.deepEqual(trades, [
        {
          buy: 10,
          buyCur: 'ETH',
          sell: 1,
          sellCur: 'BTC',
          cost: 4000,
          deferredGains: 0,
          date,
          dateAcquired: date,
        },
      ])
      assert.equal(stock.balance('BTC'), 0)
      assert.equal(stock.balance('ETH'), 10)
    })

    it('support per-trade fifo/lifo', () => {
      const stock = Stock()
      const date = new Date()
      stock.deposit(1, 'BTC', 4000, date)
      stock.deposit(1, 'BTC', 5000, date)
      const trades = stock.trade({
        sell: 1,
        sellCur: 'BTC',
        buy: 10,
        buyCur: 'ETH',
        date,
        price: 500,
        type: 'lifo',
      })
      assert.deepEqual(trades, [
        {
          buy: 10,
          buyCur: 'ETH',
          sell: 1,
          sellCur: 'BTC',
          cost: 5000,
          deferredGains: 0,
          date,
          dateAcquired: date,
        },
      ])
      assert.equal(stock.balance('BTC'), 1)
      assert.equal(stock.balance('ETH'), 10)
    })

    it.skip('preserve dateAcquired in like-kind exchange', () => {
      const stock = Stock()
      const dateAcquired = new Date('2019')
      const now = new Date()
      stock.deposit(2, 'BTC', 8000, dateAcquired) // Deposit 2 BTC with cost basis $8,000
      const trades1 = stock.trade({
        sell: 1,
        sellCur: 'BTC',
        buy: 10,
        buyCur: 'ETH',
        date: now,
        price: 800,
        isLikekind: true,
      })
      assert.deepEqual(trades1, [
        {
          buy: 10,
          buyCur: 'ETH', // ETH takes on new, given cost basis
          sell: 1,
          sellCur: 'BTC',
          cost: 4000, // original cost basis
          deferredGains: 4000,
          date: now,
          dateAcquired,
        },
      ])
      assert.equal(stock.balance('BTC'), 1)
      assert.equal(stock.balance('ETH'), 10)

      const trades2 = stock.trade({
        sell: 10,
        sellCur: 'ETH',
        buy: 1,
        buyCur: 'BTC',
        date: now,
        price: 8000,
      })
      assert.deepEqual(trades2, [
        {
          buy: 1,
          buyCur: 'BTC',
          sell: 10,
          sellCur: 'ETH',
          cost: 4000,
          deferredGains: 0,
          date: now,
          dateAcquired, // original date
        },
      ])
      assert.equal(stock.balance('BTC'), 2)
      assert.equal(stock.balance('ETH'), 0)
    })

    it('set new cost basis (i.e. treat as taxable sale)', () => {
      const stock = Stock()
      const dateAcquired = new Date('2019')
      const now = new Date()
      stock.deposit(2, 'BTC', 8000, dateAcquired)

      // sell 1 BTC (half our supply) for 10 ETH @ $1000/ETH
      const trades1 = stock.trade({
        sell: 1,
        sellCur: 'BTC',
        buy: 10,
        buyCur: 'ETH',
        date: now,
        price: 1000,
      })

      assert.deepEqual(trades1, [
        {
          buy: 10,
          buyCur: 'ETH', // ETH takes on new, given cost basis
          sell: 1,
          sellCur: 'BTC',
          cost: 4000, // original cost basis of purchased BTC
          deferredGains: 0,
          date: now,
          dateAcquired,
        },
      ])
      assert.equal(stock.balance('BTC'), 1)
      assert.equal(stock.balance('ETH'), 10)

      // sell the 10 ETH for 1 BTC @ $8000 (less than what we bought it for)
      const trades2 = stock.trade({
        sell: 10,
        sellCur: 'ETH',
        buy: 1,
        buyCur: 'BTC',
        date: now,
        price: 8000,
      })
      assert.deepEqual(trades2, [
        {
          buy: 1,
          buyCur: 'BTC',
          sell: 10,
          sellCur: 'ETH',
          cost: 10000, // original cost basis of purchased ETH
          deferredGains: 0,
          date: now,
          dateAcquired: now, // new date
        },
      ])
      assert.equal(stock.balance('BTC'), 2)
      assert.equal(stock.balance('ETH'), 0)
    })

    it('calculate new cost basis proportionally to amount taken from lot', () => {
      const stock = Stock()
      const date = new Date()
      stock.deposit(1, 'BTC', 4000, date)
      const trades = stock.trade({
        sell: 0.5,
        sellCur: 'BTC',
        buy: 5,
        buyCur: 'ETH',
        date: date,
        price: 400,
      })
      assert.deepEqual(trades, [
        {
          buy: 5,
          buyCur: 'ETH',
          sell: 0.5,
          sellCur: 'BTC',
          cost: 2000,
          deferredGains: 0,
          date,
          dateAcquired: date,
        },
      ])
      assert.equal(stock.balance('BTC'), 0.5)
      assert.equal(stock.balance('ETH'), 5)
    })

    it.skip('default to fifo when there are multiple lots', () => {
      const stock = Stock()
      const date = new Date()
      stock.deposit(1, 'BTC', 3000, date)
      stock.deposit(1, 'BTC', 4000, date)
      const trades = stock.trade({
        sell: 1,
        sellCur: 'BTC',
        buy: 10,
        buyCur: 'ETH',
        date: date,
      })
      assert.deepEqual(trades, [
        {
          buy: 10,
          buyCur: 'ETH',
          sell: 1,
          sellCur: 'BTC',
          cost: 3000,
          deferredGains: 0,
          date,
          dateAcquired: date,
        },
      ])
      assert.equal(stock.balance('BTC'), 1)
      assert.equal(stock.balance('ETH'), 10)
    })

    it('return multiple lots when trading on multiple purchases', () => {
      const stock = Stock()
      const date = new Date()
      stock.deposit(10, 'BTC', 30000, date)
      stock.deposit(10, 'BTC', 40000, date)
      const trades = stock.trade({
        sell: 15,
        sellCur: 'BTC',
        buy: 150,
        buyCur: 'ETH',
        date: date,
        price: 4000,
      })
      assert.deepEqual(trades, [
        {
          buy: 100,
          buyCur: 'ETH',
          sell: 10,
          sellCur: 'BTC',
          cost: 30000,
          deferredGains: 0,
          date,
          dateAcquired: date,
        },
        {
          buy: 50,
          buyCur: 'ETH',
          sell: 5,
          sellCur: 'BTC',
          cost: 20000,
          deferredGains: 0,
          date,
          dateAcquired: date,
        },
      ])
      assert.equal(stock.balance('BTC'), 5)
      assert.equal(stock.balance('ETH'), 150)
    })

    it.skip('add new lot', () => {
      const stock = Stock()
      const date = new Date()
      stock.deposit(1, 'BTC', 4000, date)
      stock.trade({
        sell: 1,
        sellCur: 'BTC',
        buy: 10,
        buyCur: 'ETH',
        date: date,
      })
      assert.equal(stock.balance('BTC'), 0)
      assert.equal(stock.balance('ETH'), 10)
    })

    it('error if not enough purchases for trade', () => {
      const stock = Stock()
      const date = new Date()
      let error
      stock.deposit(10, 'BTC', 40000, date)
      const errorF = () =>
        stock.trade({
          sell: 11,
          sellCur: 'BTC',
          buy: 110,
          buyCur: 'ETH',
          date: date,
          price: 400,
        })
      assert.throws(errorF)
    })

    it('allow margin of error in supply', () => {
      const stock = Stock()
      const date = new Date()
      let error
      stock.deposit(10, 'BTC', 40000, date)
      stock.trade({
        sell: 10.01,
        sellCur: 'BTC',
        buy: 100,
        buyCur: 'ETH',
        date,
        price: 400,
      })
      assert(closeEnough(stock.balance('BTC'), 0))
      assert.equal(stock.balance('ETH'), 100)
    })
  })

  describe('withdraw', () => {
    it('basic functionality', () => {
      const stock = Stock()
      const date = new Date()
      stock.deposit(10, 'BTC', 40000, date)
      const withdrawals = stock.withdraw(1, 'BTC', date)
      assert.deepEqual(withdrawals, [
        {
          amount: 1,
          cur: 'BTC',
          cost: 4000,
          date,
        },
      ])
    })

    it('do not debit from stock', () => {
      const stock = Stock()
      const date = new Date()
      stock.deposit(10, 'BTC', 40000, date)
      const withdrawals = stock.withdraw(1, 'BTC', date)
      assert.deepEqual(withdrawals, [
        {
          amount: 1,
          cur: 'BTC',
          cost: 4000,
          date,
        },
      ])
      assert.equal(stock.balance('BTC'), 10)
    })

    it('error if not enough purchases for withdrawal', () => {
      const stock = Stock()
      const date = new Date()
      let error
      stock.deposit(10, 'BTC', 40000, date)
      const errorF = () => stock.withdraw(11, 'BTC', date)
      assert.throws(errorF)
    })

    it('work across multiple purchases', () => {
      const stock = Stock()
      const date = new Date()
      stock.deposit(10, 'BTC', 30000, date)
      stock.deposit(10, 'BTC', 40000, date)
      const withdrawals = stock.withdraw(15, 'BTC', date)
      assert.deepEqual(withdrawals, [
        {
          amount: 10,
          cur: 'BTC',
          cost: 30000,
          date,
        },
        {
          amount: 5,
          cur: 'BTC',
          cost: 20000,
          date,
        },
      ])
    })

    it('support per-trade fifo/lifo', () => {
      const stock = Stock()
      const date = new Date()
      stock.deposit(1, 'BTC', 4000, date)
      stock.deposit(1, 'BTC', 5000, date)
      const trades = stock.withdraw(1, 'BTC', date, 'lifo')
      assert.deepEqual(trades, [
        {
          amount: 1,
          cur: 'BTC',
          cost: 5000,
          date,
        },
      ])
    })

    it.skip('track deferred gains from multiple trades', () => {
      const stock = Stock()
      const dateAcquired = new Date('2019')
      const now = new Date()

      stock.deposit(1, 'BTC', 4000, dateAcquired)

      // perform a like-kind exchange of the 1 BTC for 10 ETH which is worth more now ($5000)
      const exchanges1 = stock.trade({
        sell: 1,
        sellCur: 'BTC',
        buy: 10,
        buyCur: 'ETH',
        date: now,
        price: 500,
        isLikekind: true,
      })

      assert.deepEqual(exchanges1, [
        {
          buy: 10,
          buyCur: 'ETH',
          sell: 1,
          sellCur: 'BTC',
          cost: 4000, // cost basis is NOT updated in a like-kind exchange
          deferredGains: 1000, // new cost basis (5000) - old cost basis (4000)
          date: now,
          dateAcquired,
        },
      ])
      assert.equal(stock.balance('BTC'), 0)
      assert.equal(stock.balance('ETH'), 10)
      assert.equal(stock.balance('LTC'), 0)

      // exchange all 10 ETH for 90 LTC which is worth more now ($9000)
      // deferred gains increase even more after another profitable exchange
      const exchanges2 = stock.trade({
        sell: 10,
        sellCur: 'ETH',
        buy: 90,
        buyCur: 'LTC',
        date: now,
        price: 100,
        isLikekind: true,
      })

      assert.deepEqual(exchanges2, [
        {
          buy: 90,
          buyCur: 'LTC',
          sell: 10,
          sellCur: 'ETH',
          cost: 4000, // cost basis is NOT updated in a like-kind exchange
          deferredGains: 5000, // new cost basis (9000) - old cost basis (4000)
          date: now,
          dateAcquired,
        },
      ])
      assert.equal(stock.balance('BTC'), 0)
      assert.equal(stock.balance('ETH'), 0)
      assert.equal(stock.balance('LTC'), 90)

      // exchange half the LTC (45) for 2 BTC @ $10000
      const exchanges3 = stock.trade({
        sell: 45,
        sellCur: 'LTC',
        buy: 2,
        buyCur: 'BTC',
        date: now,
        price: 10000,
        isLikekind: true,
      })

      assert.deepEqual(exchanges3, [
        {
          buy: 2,
          buyCur: 'BTC',
          sell: 45,
          sellCur: 'LTC',
          cost: 2000, // old cost basis but half as much since half the amount was sold
          deferredGains: 18000, // new cost basis (20000) - old cost basis ($2000)
          date: now,
          dateAcquired,
        },
      ])
      assert.equal(stock.balance('BTC'), 2)
      assert.equal(stock.balance('ETH'), 0)
      assert.equal(stock.balance('LTC'), 45)

      // BUG: somehow a lot of 0 is created
      // does not affect final counts, just creates empty exchange
      // deferred gains decrease

      // const exchanges4 = stock.trade({
      //   sell: 2,
      //   sellCur: 'BTC',
      //   buy: 10,
      //   buyCur: 'ETH',
      //   date: now,
      //   price: 8000,
      //   isLikekind: true
      // })

      // assert.deepEqual(exchanges4, [
      //   {
      //     buy: 10,
      //     buyCur: 'ETH',
      //     sell: 2,
      //     sellCur: 'BTC',
      //     cost: 4000,
      //     deferredGains: -2000,
      //     date: now,
      //     dateAcquired
      //   }
      // ])
      // assert.equal(stock.balance('BTC'), 2)
      // assert.equal(stock.balance('ETH'), 0)
      // assert.equal(stock.balance('LTC'), 0)
    })

    it.skip('track decreasing deferred gains from multiple trades', () => {
      const stock = Stock()
      const dateAcquired = new Date('2019')
      const now = new Date()

      stock.deposit(1, 'BTC', 4000, dateAcquired)

      // exchange the 1 BTC for 10 ETH at $500/ETH which is worth more ($5000)
      const exchanges = stock.trade({
        sell: 1,
        sellCur: 'BTC',
        buy: 10,
        buyCur: 'ETH',
        date: now,
        price: 500,
        isLikekind: true,
      })

      assert.deepEqual(exchanges, [
        {
          buy: 10,
          buyCur: 'ETH',
          sell: 1,
          sellCur: 'BTC',
          cost: 4000, // cost basis is NOT updated in a like-kind exchange
          deferredGains: 1000, // new cost basis (5000) - old cost basis (4000)
          date: now,
          dateAcquired,
        },
      ])
      assert.equal(stock.balance('BTC'), 0)
      assert.equal(stock.balance('ETH'), 10)
      assert.equal(stock.balance('LTC'), 0)

      // exchange all 10 ETH for 5 LTC at $500/LTC which is worth less ($2500)
      const trades2 = stock.trade({
        sell: 10,
        sellCur: 'ETH',
        buy: 5,
        buyCur: 'LTC',
        date: now,
        price: 500,
        isLikekind: true,
      })

      assert.deepEqual(trades2, [
        {
          buy: 5,
          buyCur: 'LTC',
          sell: 10,
          sellCur: 'ETH',
          cost: 4000, // cost basis is NOT updated in a like-kind exchange
          deferredGains: -1500, // new cost basis (2500) - old cost basis (4000)
          date: now,
          dateAcquired,
        },
      ])
      assert.equal(stock.balance('BTC'), 0)
      assert.equal(stock.balance('ETH'), 0)
      assert.equal(stock.balance('LTC'), 5)

      // exchange all 5 LTC for 2 BTC at $8000/BTC which is worth much more ($16000)
      const exchanges3 = stock.trade({
        sell: 5,
        sellCur: 'LTC',
        buy: 2,
        buyCur: 'BTC',
        date: now,
        price: 8000,
        isLikekind: true,
      })

      assert.deepEqual(exchanges3, [
        {
          buy: 2,
          buyCur: 'BTC',
          sell: 5,
          sellCur: 'LTC',
          cost: 4000, // cost basis is NOT updated in a like-kind exchange
          deferredGains: 12000, // new cost basis (16000) - old cost basis (4000)
          date: now,
          dateAcquired,
        },
      ])
      assert.equal(stock.balance('BTC'), 2)
      assert.equal(stock.balance('ETH'), 0)
      assert.equal(stock.balance('LTC'), 0)
    })
  })
})
