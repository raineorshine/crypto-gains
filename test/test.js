const Stock = require('../stock.js')
const assert = require('assert')

describe('stock', () => {

  it('it should allow deposits', () => {
    const stock = Stock()
    stock.deposit(1, 'BTC', 100, new Date())
    stock.deposit(2, 'BTC', 500, new Date())
    assert.equal(stock.balance('BTC'), 3)
  })

  it('trade should return a single lot when the full trade is available at the same cost basis', () => {
    const stock = Stock()
    stock.deposit(1, 'BTC', 4000, new Date())
    const exchanges = stock.trade(1, 'BTC', 10, 'ETH', new Date())
    assert.deepEqual(exchanges, [
      {
        buy: 10,
        buyCur: 'ETH',
        sell: 1,
        sellCur: 'BTC',
        cost: 4000,
        date: new Date(),
        dateAcquired: new Date()
      }
    ])
    assert.equal(stock.balance('BTC'), 0)
    assert.equal(stock.balance('ETH'), 10)
  })

  it('trade should calculate new cost basis proportionally to amount taken from lot', () => {
    const stock = Stock()
    stock.deposit(1, 'BTC', 4000, new Date())
    const exchanges = stock.trade(0.5, 'BTC', 5, 'ETH', new Date())
    assert.deepEqual(exchanges, [
      {
        buy: 5,
        buyCur: 'ETH',
        sell: 0.5,
        sellCur: 'BTC',
        cost: 2000,
        date: new Date(),
        dateAcquired: new Date()
      }
    ])
    assert.equal(stock.balance('BTC'), 0.5)
    assert.equal(stock.balance('ETH'), 5)
  })

  it('trade should return multiple lots taken FIFO when trading on multiple purchases', () => {
    const stock = Stock()
    stock.deposit(10, 'BTC', 30000, new Date())
    stock.deposit(10, 'BTC', 40000, new Date())
    const exchanges = stock.trade(15, 'BTC', 150, 'ETH', new Date())
    assert.deepEqual(exchanges, [
      {
        buy: 100,
        buyCur: 'ETH',
        sell: 10,
        sellCur: 'BTC',
        cost: 30000,
        date: new Date(),
        dateAcquired: new Date()
      },
      {
        buy: 50,
        buyCur: 'ETH',
        sell: 5,
        sellCur: 'BTC',
        cost: 20000,
        date: new Date(),
        dateAcquired: new Date()
      },
    ])
    assert.equal(stock.balance('BTC'), 5)
    assert.equal(stock.balance('ETH'), 150)
  })

  it('withdraw should work', () => {
    const stock = Stock()
    stock.deposit(10, 'BTC', 40000, new Date())
    const withdrawals = stock.withdraw(1, 'BTC', new Date())
    assert.deepEqual(withdrawals, [
      {
        amount: 1,
        cur: 'BTC',
        cost: 4000,
        date: new Date()
      }
    ])
    assert.equal(stock.balance('BTC'), 9)
  })

  it('withdraw should error if not enough purchases', () => {
    const stock = Stock()
    let error
    stock.deposit(10, 'BTC', 40000, new Date())
    const errorF = () => stock.withdraw(11, 'BTC', new Date())
    assert.throws(errorF)
  })

  it('withdraw should work across multiple purchases', () => {
    const stock = Stock()
    stock.deposit(10, 'BTC', 30000, new Date())
    stock.deposit(10, 'BTC', 40000, new Date())
    const withdrawals = stock.withdraw(15, 'BTC', new Date())
    assert.deepEqual(withdrawals, [
      {
        amount: 10,
        cur: 'BTC',
        cost: 30000,
        date: new Date()
      },
      {
        amount: 5,
        cur: 'BTC',
        cost: 20000,
        date: new Date()
      },
    ])
    assert.equal(stock.balance('BTC'), 5)
  })

  it('trade should add new lot', () => {
    const stock = Stock()
    stock.deposit(1, 'BTC', 4000, new Date())
    stock.trade(1, 'BTC', 10, 'ETH', new Date())
    stock.withdraw(10, 'ETH')
    assert.equal(stock.balance('BTC'), 0)
    assert.equal(stock.balance('ETH'), 0)
  })

})