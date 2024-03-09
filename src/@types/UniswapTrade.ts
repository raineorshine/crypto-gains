interface UniswapTrade {
  date: string
  from: {
    amount: string
    currency: {
      symbol: string
    }
  }
  to: {
    amount: string
    currency: {
      symbol: string
    }
  }
  fee: {
    amount: string
    currency: {
      symbol: string
    }
  }
}

export default UniswapTrade
