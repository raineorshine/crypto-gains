const Stock = require('../stock.js')
const assert = require('assert')

describe('stock', () => {

  it('it should allow deposits', () => {
    const stock = Stock()
    stock.deposit(1, 'BTC', 100, new Date())
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
        cost: 4000
      }
    ])
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
        cost: 2000
      }
    ])
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
        cost: 30000
      },
      {
        buy: 50,
        buyCur: 'ETH',
        sell: 5,
        sellCur: 'BTC',
        cost: 20000
      },
    ])
  })

})