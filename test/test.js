const Stock = require('../stock.js')
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
      const exchanges = stock.trade(1, 'BTC', 10, 'ETH', date)
      assert.deepEqual(exchanges, [
        {
          buy: 10,
          buyCur: 'ETH',
          sell: 1,
          sellCur: 'BTC',
          cost: 4000,
          date,
          dateAcquired: date
        }
      ])
      assert.equal(stock.balance('BTC'), 0)
      assert.equal(stock.balance('ETH'), 10)
    })

    it('support per-trade fifo/lifo', () => {
      const stock = Stock()
      const date = new Date()
      stock.deposit(1, 'BTC', 4000, date)
      stock.deposit(1, 'BTC', 5000, date)
      const exchanges = stock.trade(1, 'BTC', 10, 'ETH', date, null, 'lifo')
      assert.deepEqual(exchanges, [
        {
          buy: 10,
          buyCur: 'ETH',
          sell: 1,
          sellCur: 'BTC',
          cost: 5000,
          date,
          dateAcquired: date
        }
      ])
      assert.equal(stock.balance('BTC'), 1)
      assert.equal(stock.balance('ETH'), 10)
    })

    it('preserve dateAcquired', () => {
      const stock = Stock()
      const dateAcquired = new Date('2019')
      const now = new Date()
      stock.deposit(2, 'BTC', 8000, dateAcquired)
      const exchanges1 = stock.trade(1, 'BTC', 10, 'ETH', now)
      assert.deepEqual(exchanges1, [
        {
          buy: 10,
          buyCur: 'ETH', // ETH takes on new, given cost basis
          sell: 1,
          sellCur: 'BTC',
          cost: 4000, // original cost basis
          date: now,
          dateAcquired
        }
      ])
      assert.equal(stock.balance('BTC'), 1)
      assert.equal(stock.balance('ETH'), 10)

      const exchanges2 = stock.trade(10, 'ETH', 1, 'BTC', now)
      assert.deepEqual(exchanges2, [
        {
          buy: 1,
          buyCur: 'BTC',
          sell: 10,
          sellCur: 'ETH',
          cost: 4000,
          date: now,
          dateAcquired // original date
        }
      ])
      assert.equal(stock.balance('BTC'), 2)
      assert.equal(stock.balance('ETH'), 0)
    })

    it('option to set new cost basis (i.e. treat as taxable sale)', () => {
      const stock = Stock()
      const dateAcquired = new Date('2019')
      const now = new Date()
      stock.deposit(2, 'BTC', 8000, dateAcquired)
      const exchanges1 = stock.trade(1, 'BTC', 10, 'ETH', now, 5000) // update cost basis
      assert.deepEqual(exchanges1, [
        {
          buy: 10,
          buyCur: 'ETH', // ETH takes on new, given cost basis
          sell: 1,
          sellCur: 'BTC',
          cost: 4000, // original cost basis
          date: now,
          dateAcquired
        }
      ])
      assert.equal(stock.balance('BTC'), 1)
      assert.equal(stock.balance('ETH'), 10)

      const exchanges2 = stock.trade(10, 'ETH', 1, 'BTC', now)
      assert.deepEqual(exchanges2, [
        {
          buy: 1,
          buyCur: 'BTC',
          sell: 10,
          sellCur: 'ETH',
          cost: 5000,
          date: now,
          dateAcquired: now // new date
        }
      ])
      assert.equal(stock.balance('BTC'), 2)
      assert.equal(stock.balance('ETH'), 0)
    })

    it('calculate new cost basis proportionally to amount taken from lot', () => {
      const stock = Stock()
      const date = new Date()
      stock.deposit(1, 'BTC', 4000, date)
      const exchanges = stock.trade(0.5, 'BTC', 5, 'ETH', date)
      assert.deepEqual(exchanges, [
        {
          buy: 5,
          buyCur: 'ETH',
          sell: 0.5,
          sellCur: 'BTC',
          cost: 2000,
          date,
          dateAcquired: date
        }
      ])
      assert.equal(stock.balance('BTC'), 0.5)
      assert.equal(stock.balance('ETH'), 5)
    })

    it('default to fifo when there are multiple lots', () => {
      const stock = Stock()
      const date = new Date()
      stock.deposit(1, 'BTC', 3000, date)
      stock.deposit(1, 'BTC', 4000, date)
      const exchanges = stock.trade(1, 'BTC', 10, 'ETH', date)
      assert.deepEqual(exchanges, [
        {
          buy: 10,
          buyCur: 'ETH',
          sell: 1,
          sellCur: 'BTC',
          cost: 3000,
          date,
          dateAcquired: date
        }
      ])
      assert.equal(stock.balance('BTC'), 1)
      assert.equal(stock.balance('ETH'), 10)
    })

    it('return multiple lots when trading on multiple purchases', () => {
      const stock = Stock()
      const date = new Date()
      stock.deposit(10, 'BTC', 30000, date)
      stock.deposit(10, 'BTC', 40000, date)
      const exchanges = stock.trade(15, 'BTC', 150, 'ETH', date)
      assert.deepEqual(exchanges, [
        {
          buy: 100,
          buyCur: 'ETH',
          sell: 10,
          sellCur: 'BTC',
          cost: 30000,
          date,
          dateAcquired: date
        },
        {
          buy: 50,
          buyCur: 'ETH',
          sell: 5,
          sellCur: 'BTC',
          cost: 20000,
          date,
          dateAcquired: date
        },
      ])
      assert.equal(stock.balance('BTC'), 5)
      assert.equal(stock.balance('ETH'), 150)
    })

    it('add new lot', () => {
      const stock = Stock()
      const date = new Date()
      stock.deposit(1, 'BTC', 4000, date)
      stock.trade(1, 'BTC', 10, 'ETH', date)
      assert.equal(stock.balance('BTC'), 0)
      assert.equal(stock.balance('ETH'), 10)
    })

    it('error if not enough purchases for trade', () => {
      const stock = Stock()
      const date = new Date()
      let error
      stock.deposit(10, 'BTC', 40000, date)
      const errorF = () => stock.trade(11, 'BTC', 110, 'ETH', date)
      assert.throws(errorF)
    })

    it('allow margin of error in supply', () => {
      const stock = Stock()
      const date = new Date()
      let error
      stock.deposit(10, 'BTC', 40000, date)
      stock.trade(10.01, 'BTC', 100, 'ETH', date)
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
          date
        }
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
          date
        }
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
          date
        },
        {
          amount: 5,
          cur: 'BTC',
          cost: 20000,
          date
        },
      ])
    })

    it('support per-trade fifo/lifo', () => {
      const stock = Stock()
      const date = new Date()
      stock.deposit(1, 'BTC', 4000, date)
      stock.deposit(1, 'BTC', 5000, date)
      const exchanges = stock.withdraw(1, 'BTC', date, 'lifo')
      assert.deepEqual(exchanges, [
        {
          amount: 1,
          cur: 'BTC',
          cost: 5000,
          date
        }
      ])
    })

  })

})