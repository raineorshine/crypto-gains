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
  type: 'exchange' // eventually add other types
  /** USD value of fees. I suspect that this is not accurate when the trade takes place on a side chain. */
  fee_value?: string
}

export default UniswapTrade
