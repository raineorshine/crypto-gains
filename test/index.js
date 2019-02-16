const Stock = require('../stock.js')
const assert = require('assert')

describe('stock', () => {

  it('it should allow deposits', () => {
    const stock = Stock()
    stock.deposit(1, 'BTC', 100, new Date())
  })

  it('trade should return a single lot when the full trade is available at the same cost basis', () => {
    const stock = Stock()
    stock.deposit(1, 'BTC', 3500, new Date())
    const exchanges = stock.trade(1, 'BTC', 10, 'ETH', 3500, new Date())
    assert.deepEqual(exchanges, [
      {
        buyCur: 'ETH',
        sellCur: 'BTC',
        sellSize: 1,
        cost: 3500
      }
    ])
  })

  it('trade should calculate new cost basis proportionally to amount taken from lot', () => {
    const stock = Stock()
    stock.deposit(1, 'BTC', 4000, new Date())
    const exchanges = stock.trade(0.5, 'BTC', 5, 'ETH', new Date())
    assert.deepEqual(exchanges, [
      {
        buyCur: 'ETH',
        sellCur: 'BTC',
        sellSize: 0.5,
        cost: 2000
      }
    ])
  })

})