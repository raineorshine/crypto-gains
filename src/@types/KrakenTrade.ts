interface KrakenTrade {
  type: 'buy' | 'sell' | 'deposit' | 'withdrawal'
  buy: number
  cost: string
  curBuy: string
  sell: number
  curSell: string
  exchange: string
  time: string
  tradeDate: string
  pair: string
  price: number
}

export default KrakenTrade
