const fs = require('fs')
const csvtojson = require('csvtojson')
const json2csv = require('json2csv')
const got = require('got')
const secure = require('./secure.json')
const memoize = require('p-memoize')
const ProgressBar = require('progress')
const stock = require('./stock.js')()

const exchange = 'cccagg' // cryptocompare aggregrate
const sampleSize = Infinity

// replace duplicate Cur. with CurBuy, CurSell, CurFee
const fixHeader = input => {
  const lines = input.split('\n')
  return [].concat(
    lines[0]
      .replace('Cur.', 'CurBuy')
      .replace('Cur.', 'CurSell')
      .replace('Cur.', 'CurFee'),
    lines.slice(1)
  ).join('\n')
}

// convert trades array to CSV and restore header
const toCSV = (trades, fields=['Type','Buy','CurBuy','Sell','CurSell','Exchange','Trade Group',,,'Comment','Trade Date']) => {
  const csv = json2csv.parse(trades, { delimiter: ',', fields })
  const csvLines = csv.split('\n')
  return [].concat(
    csvLines[0]
      .replace('CurBuy', 'Cur.')
      .replace('CurSell', 'Cur.')
      .replace('CurFee', 'Cur.'),
    csvLines.slice(1)
  ).join('\n')
}

// group transactions by day
const groupByDay = trades => {
  const txsByDay = {}
  for (let i=0; i<trades.length; i++) {
    const key = day(trades[i]['Trade Date'])
    if (!(key in txsByDay)) {
      txsByDay[key] = []
    }
    txsByDay[key].push(trades[i])
  }
  return txsByDay
}

// get the day of the date
const day = date => date.split(' ')[0]

// convert to y-m-d
const normalDate = tx => {
  const d = tx['Trade Date']
  return `${d.slice(6, 10)}-${d.slice(3, 5)}-${d.slice(0, 2)} ${d.slice(11)}`
  // 18.06.2016 15:14 0
}

// get the opposite tx type: Deposit/Withdrawal
const otherType = tx => tx.Type === 'Deposit' ? 'Withdrawal' : 'Deposit'

// convert a string value to a number and set '-' to 0
const z = v => v === '-' ? 0 : +v

// checks if two txs are within a margin of error from each other
let n = 0
const closeEnough = (tx1, tx2) => {
  // const errorRange =
  //   tx1.CurBuy === 'BTC' ? 0.1
  //   tx1.CurBuy === 'ETH' ? 0.02
  //   : 0
  return Math.abs(z(tx1.Buy) - z(tx2.Sell)) <= 0.02 &&
         Math.abs(z(tx1.Sell) - z(tx2.Buy)) <= 0.02
}

// checks if a tx is too small to count based on a token-specific size
// const tooSmallToCount = tx => {
//   const tooSmallAmount =
//     tx.CurBuy === 'BTC' ? 0.0001 :
//     tx.CurBuy === 'ETH' ? 0.001 :
//     0.005
//   return z(tx.Buy) < tooSmallAmount &&
//          z(tx.Sell) < tooSmallAmount
// }

// checks if two transactions are a Deposit/Withdrawal match
const match = (tx1, tx2) =>
  tx1.Type === otherType(tx2.Type) &&
  tx1.CurBuy === tx2.CurSell &&
  tx1.CurSell === tx2.CurBuy &&
  closeEnough(tx1, tx2)

const price = memoize(async (from, to, time) => {
  const url = `https://min-api.cryptocompare.com/data/pricehistorical?fsym=${from}&tsyms=${to}&ts=${(new Date(time)).getTime()/1000}&e=${exchange}&api_key=${secure.cryptoCompareApiKey}&extraParams=cost-basis-filler`
  const data = JSON.parse((await got(url))
  .body)

  if (data[from]) {
    return data[from][to]
  }
  else if (data.Message.startsWith('There is no data for the symbol')) {
    throw new Error(`No price for ${from} on ${time}`)
  }
  else if (data.Response === 'Error') {
    throw new Error(data.Message)
  }
  else {
    throw new Error('Unknown Response', data)
  }
})

const isUsdBuy = trade =>
  (trade.Comment === 'Shift Card' || // shift card (explicit)
  (trade.Type === 'Withdrawal' && trade.Exchange === 'Coinbase' && !trade.Fee && trade.Sell < 4) || // shift card (infer)
  (trade.Type === 'Trade' && trade.CurBuy === 'USD')) && // USD Sale
  trade.CurSell !== 'USDT' // not tether

// group transactions into several broad categories
// match same-day withdrawals and deposits
const groupTransactions = trades => {
  const matched = []
  const unmatched = []
  const usdBuys = []
  const withdrawals = []
  const margin = []
  const lending = []
  const unmatchedRequests = [] // thunks for prices

  const txsByDay = groupByDay(trades)

  // loop through each day
  for (let key in txsByDay) {
    const group = txsByDay[key]

    // loop through each transaction
    // label loop so that matching
    txLoop:
    for (let i in group) {
      const tx1 = group[i]

      if(/lending/i.test(tx1['Trade Group']) || /lending/i.test(tx1.Comment)) {
        lending.push(tx1)
      }
      else if(/margin/i.test(tx1['Trade Group']) || /margin/i.test(tx1.Comment)) {
        margin.push(tx1)
      }
      else if(isUsdBuy(tx1)) {
        usdBuys.push(tx1)
      }
      else if (tx1.Type === 'Withdrawal') {
        withdrawals.push(tx1)
      }
      else if (tx1.Type === 'Deposit') {

        // loop through each other transaction on the same day to find a matching withdrawal
        for (let i2 in group) {
          const tx2 = group[i2]
          // match negligible transactions
          if(match(tx1, tx2)) {
            matched.push(tx1)
            tx1.match = tx2
            continue txLoop // jump to next tx
          }
        }

        // otherwise we have an unmatched transaction
        delete tx1.field1

        const newTx = Object.assign({}, tx1, {
          Type: 'Income',
          Comment: 'Cost Basis',
          Group: ''
        })

        if (command === 'prices') {
          unmatchedRequests.push(async () => {
            let p, err
            try {
              // per-day memoization
              p = await price(tx1.CurBuy, 'USD', day(normalDate(tx1)))
            }
            catch (e) {
              err = e.message
            }

            return {
              tx: Object.assign({}, newTx, { Price: p }),
              error: err
            }
          })
        }
        // ignore txs beyond sampleSize
        else if (command !== 'sample' || unmatched.length < sampleSize) {
          unmatched.push(newTx)
        }
        else {
          throw new Error('I do not know how to handle this transaction: \n\n' + JSON.stringify(tx1))
        }
      }
    }
  }

  return { matched, unmatched, usdBuys, withdrawals, margin, lending, unmatchedRequests }
}


/****************************************************************
* RUN
*****************************************************************/

const file = process.argv[2]
const command = process.argv[3]

if (!file) {
  console.error('Invalid usage. \n\nUsage: \nnode index.js [command] [trades.csv]')
  process.exit(1)
}

// import csv

(async () => {

const input = fixHeader(fs.readFileSync(file, 'utf-8'))
const trades = Array.prototype.slice.call(await csvtojson().fromString(input)) // convert to true array

const { matched, unmatched, usdBuys, withdrawals, margin, lending, unmatchedRequests } = groupTransactions(trades)

/************************************************************************
 * SUMMARY
 ************************************************************************/
if (command === 'summary') {
  console.log('Transactions:', trades.length)
  console.log('Margin Trades:', margin.length)
  console.log('Lending:', lending.length)
  console.log('USD Buys:', usdBuys.length)
  console.log('Withdrawals:', withdrawals.length)
  console.log('Matched Deposits:', matched.length)
  console.log('Unmatched Deposits:', unmatched.length)
}

/************************************************************************
 * GAINS
 ************************************************************************/
else if (command === 'gains') {

  const usdGains = []
  const shift = []
  let usdSum = 0

  // input
  const file2 = process.argv[4]
  const subcommand = process.argv[5]

  if (!file2) {
    console.error('Please specify a trades file and a gains file')
    process.exit(1)
  }

  const input2 = fixHeader(fs.readFileSync(file2, 'utf-8'))
  const gains = Array.prototype.slice.call(await csvtojson().fromString(input2)) // indexed object; not a true array

  usdBuys.forEach(trade => {
    const tradeDay = day(trade['Trade Date'])

    if (trade.Comment === 'Shift Card') {
      shift.push(trade)
    }

    // Kraken Margin gains show up as trades for 0 USD
    if (trade.CurSell === 'USD' && (+trade.Buy === 0 || +trade.Sell === 0)) {
      usdGains.push({
        "Amount": +trade.Sell,
        "Currency": '-',
        "Date Acquired": trade['Trade Date'],
        "Date Sold": trade['Trade Date'],
        "Short/Long": 'Short',
        "Buy /Input at": 'Kraken',
        "Sell /Output at": 'Kraken',
        "Proceeds in USD": +trade.Buy,
        "Cost Basis in USD": 0,
        // positive Buy means we got USD for 0 (gain)
        // poitive Sell means we lost USD for 0 (loss)
        "Gain/Loss in USD": +trade.Buy || -trade.Sell,
        "Comment": 'Margin'
      })
      return
    }

    const gain = gains.find(gain =>
      day(gain['Date Sold']) === tradeDay &&
      gain.Currency === trade.CurSell &&
      +gain.Amount === +trade.Sell
    )

    if (gain) {
      usdGains.push(gain)
      usdSum += parseFloat(gain['Gain/Loss in USD'].replace(',', ''))
      // console.log("gain", gain)
    }
    else {
      console.warn(`Unmatched USD Trade of ${trade.Sell} ${trade.CurSell} for ${trade.Buy} ${trade.CurBuy} on ${tradeDay}. Trade Group: ${trade['Trade Group']}, Comment: ${trade.Comment}`)
    }
  })

  if (subcommand !== 'summary') {
    console.log(toCSV(usdGains, ["Amount","Currency","Date Acquired","Date Sold","Short/Long","Buy /Input at","Sell /Output at","Proceeds in USD","Cost Basis in USD","Gain/Loss in USD"]))
  }

  console.warn("trades", trades.length)
  console.warn("shift", shift.length)
  console.warn("gains", gains.length)
  console.warn("usdBuys", usdBuys.length)
  console.warn("usdGains", usdGains.length)
  console.warn("usdSum", Math.round(usdSum * 100) / 100)
}

//  prices
else if (command === 'prices') {

  const errors = []

  const numRequests = Math.min(unmatchedRequests.length, sampleSize)
  const bar = new ProgressBar(':current/:total :percent :etas (:token1 errors)', { total: numRequests })
  for (let i=0; i<numRequests; i++) {
    const result = await unmatchedRequests[i]()
    if (!result.error) {
      unmatched.push(result.tx)
    }
    else {
      errors.push(result.error)
    }
    bar.tick({ token1: errors.length })
  }

  if (errors.length > 0) {
    console.warn(errors.join('\n'))
  }

  // output
  console.log(toCSV(unmatched))
}

})()
