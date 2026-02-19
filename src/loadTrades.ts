import csvtojson from 'csvtojson'
import fs from 'fs'
import path from 'path'
import CoinTrackingTrade from './@types/CoinTrackingTrade.js'
import GeminiTrade from './@types/GeminiTrade.js'
import KrakenTrade from './@types/KrakenTrade.js'
import LedgerTrade from './@types/LedgerTrade.js'
import Trade from './@types/Trade.js'
import TradingPair from './@types/TradingPair.js'
import UniswapTrade from './@types/UniswapTrade.js'
import error from './error.js'
import log from './log.js'
import nonNull from './nonNull.js'

const allowedCsvFormats = ['CoinTracking', 'Gemini', 'Kraken', 'Ledger Operation History']

// Corresponding type: CoinTrackingTrade
const cointrackingColumns: (keyof CoinTrackingTrade | 'Cur.')[] = [
  'Type',
  'Buy',
  'Cur.',
  'Sell',
  'Cur.',
  'Exchange',
  'Trade Group',
  'Comment',
  'Trade Date',
]

// Corresponding type: GeminiTrade
const geminiColumns: (keyof GeminiTrade)[] = [
  'Date',
  'Time (UTC)',
  'Type',
  'Symbol',
  'Specification',
  'Liquidity Indicator',
  'Trading Fee Rate (bps)',
  'USD Amount USD',
  'Fee (USD) USD',
  'USD Balance USD',
  'BTC Amount BTC',
  'Fee (BTC) BTC',
  'BTC Balance BTC',
  'Trade ID',
  'Order ID',
  'Order Date',
  'Order Time',
  'Client Order ID',
  'API Session',
  'Tx Hash',
  'Deposit Destination',
  'Deposit Tx Output',
  'Withdrawal Destination',
  'Withdrawal Tx Output',
]

// Corresponding type: KrakenTrade
const krakenColumns = [
  'txid',
  'ordertxid',
  'pair',
  'time',
  'type',
  'ordertype',
  'price',
  'cost',
  'fee',
  'vol',
  'margin',
  'misc',
  'ledgers',
]

// Corresponding type: LedgerTrade
const ledgerColumns = [
  'Operation Date',
  'Status',
  'Currency Ticker',
  'Operation Type',
  'Operation Amount',
  'Operation Fees',
  'Operation Hash',
  'Account Name',
  'Account xpub',
  'Countervalue Ticker',
  'Countervalue at Operation Date',
  'Countervalue at CSV Export',
]

/** Extracts the from/to pair of currencies from a given trading pair symbol. The 'from' value always represents the crypto token (regardless of Buy or Sell) while the 'to' value always represents the fiat token. That is, 'from' -> 'to' refers to the tickers if 'from' is sold in exchange for 'to'. */
const pairMap = new Map<string, TradingPair>([
  ['BATUSD', { from: 'BAT', to: 'USD' } as const],
  // Deposit/Withdraw AVAX (not really trading for USD)
  ['AVAX', { from: 'AVAX', to: 'USD' } as const],
  ['AVAXUSD', { from: 'AVAX', to: 'USD' } as const],
  ['AAVEUSD', { from: 'AAVE', to: 'USD' } as const],
  ['CRVUSD', { from: 'CRV', to: 'USD' } as const],
  ['DAIUSD', { from: 'DAI', to: 'USD' } as const],
  ['DOGEBTC', { from: 'DOGE', to: 'BTC' } as const],
  ['ETHBTC', { from: 'ETH', to: 'BTC' } as const],
  ['EOSUSD', { from: 'EOS', to: 'USD' } as const],
  // Deposit/Withdraw LTC (not really trading for USD)
  ['LTC', { from: 'LTC', to: 'USD' } as const],
  ['LTCBTC', { from: 'LTC', to: 'BTC' } as const],
  ['LTCUSD', { from: 'LTC', to: 'USD' } as const],
  ['GNOUSD', { from: 'GNO', to: 'USD' } as const],
  ['GNOUSD', { from: 'GNO', to: 'USD' } as const],
  ['MATICUSD', { from: 'MATIC', to: 'USD' } as const],
  ['OPUSD', { from: 'OP', to: 'USD' } as const],
  // Deposit/Withdraw SOL (not really trading for USD)
  ['SOL', { from: 'SOL', to: 'USD' } as const],
  ['SOLUSD', { from: 'SOL', to: 'USD' } as const],
  ['SOLBTC', { from: 'SOL', to: 'BTC' } as const],
  ['UNIUSD', { from: 'UNI', to: 'USD' } as const],
  ['GUSD', {}],
  ['GUSDUSD', {}],
  // Deposit/Withdraw UNI (not really trading for USD)
  ['UNI', { from: 'UNI', to: 'USD' } as const],
  ['USD', {}],
  ['USDC', {}],
  ['USDT', {}],
  ['USDCUSD', {}],
  ['USDTUSD', {}],
  ['USDTZUSD', {}],
  // BTC deposits only (type: 'Credit')
  ['BTC', { from: 'BTC', to: 'USD' } as const],
  ['BTCUSD', { from: 'BTC', to: 'USD' } as const],
  ['XBTUSDC', { from: 'BTC', to: 'USD' } as const],
  ['ETH', { from: 'ETH', to: 'USD' } as const],
  ['ETHUSD', { from: 'ETH', to: 'USD' } as const],
  ['XETHZUSD', { from: 'ETH', to: 'USD' } as const],
  ['XXBTZUSD', { from: 'BTC', to: 'USD' } as const],
  ['XXLMZUSD', { from: 'XLM', to: 'USD' } as const],
])

/** Extracts the currency symbols from a trading pair. */
const pair = (p: string): TradingPair => {
  const symbols = pairMap.get(p)
  if (!symbols) {
    error(`Unrecognized trading pair: ${p}. Add to pairMap in src/loadTrades.ts.`)
  }
  return symbols!
}

/** Returns true if the given input path is a directory. */
const isDir = (inputPath: string): boolean => fs.lstatSync(inputPath).isDirectory()

/** Returns true if the file is one of the ignored file names. */
const ignoreTradeFile = (file: string): boolean => file === '.DS_Store'

/** Replace duplicate Cur. with CurBuy, CurSell, CurFee. */
const fixCointrackingHeader = (input: string): string => {
  const lines = input.split('\n')
  return ([] as string[])
    .concat(lines[0].replace('Cur.', 'CurBuy').replace('Cur.', 'CurSell').replace('Cur.', 'CurFee'), lines.slice(1))
    .join('\n')
}

const loadCoinTrackingTrade = (trade: CoinTrackingTrade): Trade | null => {
  const d = trade['Trade Date']
  const date = new Date(`${d.slice(6, 10)}-${d.slice(3, 5)}-${d.slice(0, 2)} ${d.slice(11)}`)
  return {
    type: trade.Type,
    buy: trade.Buy,
    comment: trade.Comment,
    curBuy: trade.CurBuy,
    curSell: trade.CurSell,
    exchange: trade.Exchange,
    fee: trade.Fee,
    price: trade.Price,
    sell: trade.Sell,
    tradeGroup: trade['Trade Group'],
    date,
  }
}

/** Converts a trade in the Kraken schema to the Cointracking schema. */
const loadKrakenTrade = (trade: KrakenTrade): Trade | null => {
  const { from, to } = pair(trade.pair)!
  // ignore USDC/GUSD -> USD trades
  if ((trade.type === 'buy' || trade.type === 'sell') && !from && !to) return null

  return {
    type:
      trade.type === 'buy' || trade.type === 'sell'
        ? 'Trade'
        : (`${trade.type[0].toUpperCase()}${trade.type.slice(1).toLowerCase()}` as Trade['type']),
    buy: trade.type === 'buy' || trade.type === 'deposit' ? +trade.cost / trade.price : +trade.cost,
    curBuy: trade.type === 'buy' || trade.type === 'deposit' ? from : 'USD',
    sell: trade.type === 'sell' ? +trade.cost / trade.price : +trade.cost,
    curSell: trade.type === 'sell' ? from : 'USD',
    exchange: 'Kraken',
    // Use Kraken-provided price
    // Not part of Cointracking data schema
    price: +trade.price,
    date: new Date(trade.time),
  }
}

/** Converts a trade in the Gemini schema to the Cointracking schema. */
const loadGeminiTrade = (trade: GeminiTrade): Trade | null => {
  // xlsx file comes with an empty totals row that should be ignored
  if (!trade.Date && !trade.Type && !trade.Specification) return null

  const { from, to } = pair(trade.Symbol)

  // ignore USDC/GUSD -> USD trades
  // ignore USDC Credit/Debit (i.e. Deposit/Widhtdrawal)
  if (
    trade.Symbol === 'USD' ||
    ((trade.Type === 'Buy' || trade.Type === 'Sell' || trade.Type === 'Debit' || trade.Type === 'Credit') &&
      !from &&
      !to)
  )
    return null

  // 'to' amount
  // If Sell, represents the amount of USD received
  // If Buy, represents the amount of USD spent
  const costRaw = trade[`${to} Amount ${to}` as keyof GeminiTrade]
  const cost = parseFloat((costRaw || '0').replace(/[$(),]/g, ''))

  if ((trade.Type === 'Buy' || trade.Type === 'Sell') && !costRaw) {
    error(`Missing ${to} cost`, trade)
  }

  // 'from' amount
  // If Sell, represents the amount of tokens sold
  // If Buy, represents the amount of tokens bought
  const buyAmountRaw = trade[`${from} Amount ${from}` as keyof GeminiTrade]
  const buyAmount = parseFloat((buyAmountRaw || '0').replace(/[$(),]/g, ''))

  if ((trade.Type === 'Buy' || trade.Type === 'Sell') && !buyAmountRaw) {
    error(`Missing ${from} buyAmount`, trade)
  }

  // price = [total] cost / [tokens] buyAmount
  // Except Debits (withdrawals) which are not trades and price can be set to 0
  const price = cost === 0 || (trade.Type === 'Debit' && buyAmount === 0) ? 0 : cost / buyAmount

  // price is required for Buy/Sell/Credit so that we calculate the correct cost basis
  if ((trade.Type === 'Buy' || trade.Type === 'Sell') && cost === 0 && buyAmount < 1) {
    if (buyAmount > 1) {
      error(
        `Sometimes Gemini can return a zero cost on a Buy/Sell. As long as it is miniscule, this trade can be safely ignored. However, this trade has a buyAmount of ${buyAmount}, so it should be investigated.`,
      )
    }
    return null
  }

  if ((trade.Type === 'Buy' || trade.Type === 'Sell') && isNaN(cost / price)) {
    error('loadGeminiTrade: NaN encountered: cost / price', { trade, from, to, cost, price, buyAmount })
  }

  return {
    type: trade.Specification.includes('Gemini Credit Card Reward Payout')
      ? 'Rebate'
      : trade.Type === 'Buy' || trade.Type === 'Sell'
        ? 'Trade'
        : trade.Type === 'Credit'
          ? 'Deposit'
          : trade.Type === 'Debit'
            ? 'Withdrawal'
            : trade.Type,
    buy: trade.Type === 'Credit' ? buyAmount : trade.Type === 'Buy' ? cost / price : cost,
    curBuy: trade.Type === 'Buy' || trade.Type === 'Credit' ? from : 'USD',
    sell: trade.Type === 'Sell' ? cost / price : cost,
    curSell: trade.Type === 'Sell' ? from : 'USD',
    exchange: 'Gemini',
    price: price,
    date: new Date(trade.Date),
  }
}

/** Converts a trade in the Uniswap schema to the Cointracking schema. */
const loadUniswapTrade = (trade: UniswapTrade): Trade | null => {
  if (trade.type !== 'exchange') {
    throw new Error('Unrecognized Uniswap trade type: ' + trade.type)
  }

  const buyAmount = parseFloat(trade.to.amount || '0')
  const sellAmount = parseFloat(trade.from.amount || '0')

  return {
    type: 'Trade',
    buy: buyAmount,
    curBuy: trade.to.currency.symbol,
    sell: sellAmount,
    curSell: trade.from.currency.symbol,
    exchange: 'Uniswap',
    price: sellAmount / buyAmount,
    date: new Date(trade.date),
  }
}

/** Converts a transaction from the Ledger Live operations history to the Cointracking schema. Records deposits and withdrawals. */
const loadLedgerTrade = (trade: LedgerTrade): Trade | null => {
  const isDeposit = trade['Operation Type'] === 'IN' || trade['Operation Type'] === 'UNDELEGATE'
  const isWithdrawal =
    trade['Operation Type'] === 'OUT' ||
    trade['Operation Type'] === 'WITHDRAW_UNBONDED' ||
    // treat DELEGATE as a withdrawal since the funds are locked up and cannot be sold
    // TODO: Calculate income from staking rewards
    trade['Operation Type'] === 'DELEGATE'

  return {
    type: isDeposit
      ? 'Deposit'
      : isWithdrawal
        ? 'Withdrawal'
        : trade['Operation Type'] === 'FEES'
          ? 'Spend'
          : error(`Unrecognized Ledger operation type: ${trade['Operation Type']}`),
    buy: isDeposit ? trade['Operation Amount'] : null,
    curBuy: isDeposit ? trade['Currency Ticker'] : undefined,
    sell: isWithdrawal ? +trade['Operation Amount'] : null,
    curSell: isWithdrawal ? trade['Currency Ticker'] : undefined,
    exchange: 'Ledger',
    fee: trade['Operation Type'] === 'FEES' ? trade['Operation Amount'].toString() : undefined,
    date: new Date(trade['Operation Date']),
  }
}

/** Loads a trade history file in one of the supported formats. */
const loadTradeHistoryFile = async (file: string | null): Promise<Trade[]> => {
  if (!file) return []
  const text = fs.readFileSync(file, 'utf-8')
  const filename = path.basename(file)
  const ext = path.extname(file).toLowerCase()

  switch (ext) {
    // UniSwap
    case '.json': {
      const uniswapTrades = JSON.parse(text) as UniswapTrade[]
      const trades = uniswapTrades.map(loadUniswapTrade).filter(nonNull)
      log.verbose(`  ${filename} [Uniswap]: ${trades.length} trades`)
      return trades
    }
    case '.xlsx':
      error(`\n.xlsx files are not supported. Convert to .csv and delete .xlsx before proceeding.`)
      break
    case '.csv':
      {
        const headerColumns = text
          .split('\n')[0]
          .split(',')
          .map(col => col.replace(/["\r]/g, ''))

        // CoinTracking
        if (cointrackingColumns.every(col => headerColumns.includes(col))) {
          const coinTrackingTrades = (await csvtojson().fromString(fixCointrackingHeader(text))) as CoinTrackingTrade[]
          const trades = coinTrackingTrades.map(loadCoinTrackingTrade).filter(nonNull)
          log.verbose(`  ${filename} [CoinTracking]: ${trades.length} trades`)
          return trades
        }
        // Gemini
        else if (geminiColumns.every(col => headerColumns.includes(col))) {
          const geminiTrades = (await csvtojson().fromString(text)) as GeminiTrade[]
          const trades = geminiTrades.map(loadGeminiTrade).filter(nonNull)
          log.verbose(`  ${filename} [Gemini]: ${trades.length} trades`)
          return trades
        }
        // Kraken
        else if (krakenColumns.every(col => headerColumns.includes(col))) {
          const krakenTrades = (await csvtojson().fromString(text)) as KrakenTrade[]
          const trades = krakenTrades
            .map(row => {
              const trade = loadKrakenTrade(row)
              return [
                trade,
                // assume that funds are immediately withdrawn after a sale so that they are removed from the stock
                trade && row.type === 'sell'
                  ? ({
                      ...trade,
                      type: 'Withdrawal' as const,
                      buy: null,
                      buyCur: null,
                    } as Trade)
                  : null,
              ]
            })
            .flat()
            .filter(nonNull)

          log.verbose(`  ${filename} [Kraken]: ${trades.length} trades`)
          return trades
        }
        // Ledger Operation History
        else if (ledgerColumns.every(col => headerColumns.includes(col))) {
          const ledgerTrades = (await csvtojson().fromString(text)) as LedgerTrade[]
          const trades = ledgerTrades.map(loadLedgerTrade).filter(nonNull)
          log.verbose(`  ${filename} [Ledger]: ${trades.length} trades`)
          return trades
        } else {
          const matchResults = allowedCsvFormats.map(format => {
            const columns =
              format === 'CoinTracking' ? cointrackingColumns : format === 'Gemini' ? geminiColumns : krakenColumns
            const extra = headerColumns.filter(col => !columns.includes(col))
            const matching = columns.filter(col => headerColumns.includes(col))
            const missing = columns.filter(col => !headerColumns.includes(col))
            return { extra, format, matching, missing, total: columns.length }
          })

          const closestMatch = matchResults.reduce((prev, curr) =>
            curr.matching.length > prev.matching.length ? curr : prev,
          )

          log.error(
            `Unrecognized format in CSV file: ${filename}. \nAllowed formats are: ${allowedCsvFormats.join(', ')}.\n`,
            {
              headerColumns,
            },
          )
          log.error(
            `\nClosest csv format match: ${closestMatch.format} (${closestMatch.matching.length}/${closestMatch.total})\n`,
          )
          log(`Matching columns: \n${'  ' + closestMatch.matching.join('\n  ')}\n`)
          log(`Missing columns: \n${'  ' + closestMatch.missing.join('\n  ')}\n`)
          log(`Extra columns: \n${'  ' + closestMatch.extra.join('\n  ')}\n`)

          process.exit(1)
        }
      }
      break
    default:
      error('Unrecognized file type: ' + file)
  }

  return []
}

/** Loads all trades from a file or directory. */
const loadTrades = async (inputPath: string, limit?: number): Promise<Trade[]> => {
  let inputPaths: string[] = []

  // dir
  if (isDir(inputPath)) {
    log('\nInput files:')
    inputPaths = await Promise.all(
      fs
        .readdirSync(inputPath)
        .sort()
        .map(file => {
          const fullPath = path.resolve(inputPath, file)
          if (isDir(fullPath) || ignoreTradeFile(file)) return null
          const ext = path.extname(file).toLowerCase()
          if (ext === '.xlsx') {
            error(`  ${file}`)
          } else {
            log(`  ${file}`)
          }
          return fullPath
        })
        .filter(nonNull),
    )
  }
  // file
  else {
    inputPaths = [inputPath]
  }

  // load trades from each file and flatten into a single list
  log.verbose('\nLoading trades...')
  const tradesByFile = await Promise.all(inputPaths.map(loadTradeHistoryFile))
  const trades = tradesByFile.flat()
  log.verbose('')

  // return trades sorted by date
  return trades.sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? -1 : 1)).slice(0, limit)
}

export default loadTrades
