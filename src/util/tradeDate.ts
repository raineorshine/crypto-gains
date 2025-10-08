/** Convert any date string to CoinTrackingTrade date format of dd.mm.yyyy hh:mm. */
const tradeDate = (d: string) => {
  const date = new Date(d)
  const days = date.getDate().toString().padStart(2, '0')
  const month = (date.getMonth() + 1).toString().padStart(2, '0')
  const year = date.getFullYear()
  const hours = date.getHours().toString().padStart(2, '0')
  const minutes = date.getMinutes().toString().padStart(2, '0')

  return `${days}.${month}.${year} ${hours}:${minutes}`
}

export default tradeDate
