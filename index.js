const fs = require('fs')
const csvtojson = require('csvtojson')
const json2csv = require('json2csv')
const got = require('got')
const secure = require('./secure.json')
const memoize = require('p-memoize')
const ProgressBar = require('progress')
const Stock = require('./stock.js')
const stock = Stock()

const exchange = 'cccagg' // cryptocompare aggregrate
const mockPrice = true

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

const price = mockPrice ? async () => 0 : memoize(async (from, to, time) => {
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
  const income = []
  const usdBuys = []
  const withdrawals = []
  const margin = []
  const lending = []
  const unmatchedRequests = [] // thunks for prices
  const tradeTxs = []
  const lost = []
  const spend = []

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
      else if(tx1.Type === 'Trade') {
        tradeTxs.push(tx1)
      }
      else if(tx1.Type === 'Income') {
        income.push(tx1)
      }
      else if (tx1.Type === 'Withdrawal') {
        withdrawals.push(tx1)
      }
      else if (tx1.Type === 'Lost') {
        lost.push(tx1)
      }
      else if (tx1.Type === 'Spend') {
        spend.push(tx1)
      }
      // try to match the deposit to a same-day withdrawal
      else if (tx1.Type === 'Deposit') {

        // loop through each other transaction on the same day to find a matching withdrawal
        for (let i2 in group) {
          const tx2 = group[i2]
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
        else if (command !== 'sample' || unmatched.length < sampleSize) {
        // ignore txs beyond sampleSize
          unmatched.push(newTx)
        }
      }
      else {
        throw new Error('I do not know how to handle this transaction: \n\n' + JSON.stringify(tx1))
      }
    }
  }

  return { matched, unmatched, income, usdBuys, withdrawals, tradeTxs, lost, spend, margin, lending, unmatchedRequests }
}


/****************************************************************
* RUN
*****************************************************************/

const file = process.argv[2]
const command = process.argv[3]
const sampleSize = process.argv[4] || Infinity

if (!file || !command) {
  console.error('Invalid usage. \n\nUsage: \nnode index.js [command] [transactions.csv]')
  process.exit(1)
}

// import csv

(async () => {

const input = fixHeader(fs.readFileSync(file, 'utf-8'))
const rawData = Array.prototype.slice.call(await csvtojson().fromString(input)) // convert to true array

const { matched, unmatched, income, usdBuys, lost, spend, withdrawals, tradeTxs, margin, lending, unmatchedRequests } = groupTransactions(rawData)


/************************************************************************
 * SUMMARY
 ************************************************************************/
if (command === 'summary') {
  console.log('Transactions:', rawData.length)
  console.log('Margin Trades:', margin.length)
  console.log('Lending:', lending.length)
  console.log('USD Buys:', usdBuys.length)
  console.log('Income:', income.length)
  console.log('Lost:', lost.length)
  console.log('Spend:', spend.length)
  console.log('Trades:', tradeTxs.length)
  console.log('Withdrawals:', withdrawals.length)
  console.log('Matched Deposits:', matched.length)
  console.log('Unmatched Deposits:', unmatched.length)
}


/************************************************************************
 * COST BASIS
 ************************************************************************/
else if (command === 'costbasis') {

  const n = Math.min(rawData.length, sampleSize)
  const errors = []
  let withdrawals = []
  let deposits = []
  let trades = []
  let sales = []
  let income = []
  let lost = []
  let spend = []

  for (let i=0; i<n; i++) {
    const tx = rawData[i]

    // ignore "Cost Basis" transactions which were added for the CoinTracking tax report
    // they are duplicates to unmatched deposits, which we can derive the cost basis of
    if (tx.Comment === 'Cost Basis') {
      continue
    }

    // if (tx.CurBuy) {
    //   console.log("balance", tx.CurBuy, stock.balance(tx.CurBuy))
    // }
    // if (tx.CurSell) {
    //   console.log("balance", tx.CurSell, stock.balance(tx.CurSell))
    // }
    // console.log("tx", tx)
    switch(tx.Type) {

      // ignore ALL withdrawals, as they do not affect cost basis calculations
      case 'Withdrawal':
        withdrawals.push(tx)
      //   // ignore USD withdrawals
      //   // ignore transactions processed via an out-of-order deposit
      //   if (tx.CurSell !== 'USD' && !tx.processed) {
      //     // store the cost basis (1 or more) of the withdrawal in the Withdrawal tx object so that the matching Deposit tx has access to the cost basis
      //     try {
      //       tx.processed = true
      //       tx.withdrawals = stock.withdraw(+tx.Sell, tx.CurSell, tx['Trade Date'])
      //     }
      //     catch (e) {
      //       if (e instanceof Stock.NoAvailablePurchaseError) {
      //         console.error('Error making withdrawal:', e.message)
      //         errors.push(e)
      //       }
      //       else {
      //         throw e
      //       }
      //     }
      //   }
      //   // TODO: process pending deposit
        break

      case 'Deposit':

        deposits.push(tx)

        // USD cost basis = buy amount
        if (tx.CurBuy === 'USD') {
          // stock.deposit(+tx.Buy, tx.CurBuy, +tx.Buy, tx['Trade Date'])
          // ignore USD deposits
        }
        // get the cost basis from matching deposits
        else if (tx.match) {

          // if we get a deposit before its matching withdrawal, go ahead and process the withdrawal now
          // if (!tx.match.processed) {
            // console.log("Processing out-of-order deposit with", tx.match)
            try {
              tx.match.processed = true
              tx.match.withdrawals = stock.withdraw(+tx.match.Sell, tx.match.CurSell, tx.match['Trade Date'])
            }
            catch (e) {
              if (e instanceof Stock.NoAvailablePurchaseError) {
                console.error(e.message)
                errors.push(e)
              }
              else {
                throw e
              }
            }
          // }

          if (tx.match.withdrawals) {
            tx.match.withdrawals.forEach(withdrawal => {
              stock.deposit(withdrawal.amount, withdrawal.cur, withdrawal.cost, withdrawal.date)
            })
          }
          else {
            console.error(`ERROR: Matching deposit of ${tx.Buy} ${tx.CurBuy} on ${tx['Trade Date']} with no withdrawals.`)
            errors.push(tx)
          }
        }
        else {
          console.warn(`WARNING: No matching withdrawal for deposit of ${tx.Buy} ${tx.CurBuy} on ${tx['Trade Date']}. Using historical price.`)
          let p = 0
          try {
            p = await price(tx.CurBuy, 'USD', day(normalDate(tx)))
          }
          catch(e) {
            console.error(`Error fetching price`)
            errors.push(tx)
          }
          stock.deposit(+tx.Buy, tx.CurBuy, tx.Buy * p, tx['Trade Date'])
          // errors.push('No matching withdrawal for deposit')
        }

        break

      case 'Trade':
        try {
          const tradeExchanges = stock.trade(+tx.Sell, tx.CurSell, +tx.Buy, tx.CurBuy, tx['Trade Date'])
          if (tx.CurBuy === 'USD') {
            sales = sales.concat(tradeExchanges)
          }
          else {
            trades = trades.concat(tradeExchanges)
          }
        }
        catch (e) {
          if (e instanceof Stock.NoAvailablePurchaseError) {
            console.error('Error making trade:', e.message)
            errors.push(e)
          }
          else {
            throw e
          }
        }
        break

      case 'Income':
        let p = 0
        try {
          p = await price(tx.CurBuy, 'USD', day(normalDate(tx)))
        }
        catch(e) {
            console.error(`Error fetching price`)
            errors.push(tx)
          }
        income = income.concat(stock.deposit(+tx.Buy, tx.CurBuy, tx.Buy * p, tx['Trade Date']))
        break

      case 'Lost':
        lost.push(tx)
        break

      case 'Spend':
        spend.push(tx)
        break

      default:
        throw new Error('Unknown transaction type: \n' + JSON.stringify(tx))
    }
  }

  console.log('withdrawals', withdrawals.length)
  console.log('deposits', deposits.length)
  console.log('trades', trades.length)
  console.log('sales', sales.length)
  console.log('income', income.length)
  console.log('lost', lost.length)
  console.log('spend:', spend.length)
  console.log('errors', errors.length)
}

//  prices
else if (command === 'prices') {

  const errors = []

  const numRequests = Math.min(unmatchedRequests.length, sampleSize)
  const bar = new ProgressBar(':current/:total :percent :etas (:token1 errors)', { total: numRequests })
  bar.render()
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
