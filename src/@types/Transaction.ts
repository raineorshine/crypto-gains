interface Transaction {
  buy?: number
  buyCur?: string
  cost: number
  date: string
  dateAcquired: string
  deferredGains?: number
  sell?: number
  sellCur?: string
}

export default Transaction
