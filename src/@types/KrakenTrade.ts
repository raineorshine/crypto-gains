interface KrakenTrade {
  type: 'buy' | 'sell' | 'deposit' | 'withdrawal'
  buy: number
  cost: string
  sell: number
  exchange: string
  // yyyy-mm-dd hh:mm:ss.msms
  time: string
  pair: string
  price: number
}

export default KrakenTrade
