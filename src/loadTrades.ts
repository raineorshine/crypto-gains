import { error } from 'console'
import csvtojson from 'csvtojson'
import fs from 'fs'
import path from 'path'
import CoinTrackingTrade from './@types/CoinTrackingTrade.js'
import GeminiTrade from './@types/GeminiTrade.js'
import KrakenTrade from './@types/KrakenTrade.js'
import Ticker from './@types/Ticker.js'
import UniswapTrade from './@types/UniswapTrade.js'
import nonNull from './nonNull.js'
import normalDate from './normalDate.js'

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
  'ETH Amount ETH',
  'Fee (ETH) ETH',
  'ETH Balance ETH',
  'GUSD Amount GUSD',
  'Fee (GUSD) GUSD',
  'GUSD Balance GUSD',
  'SOL Amount SOL',
  'Fee (SOL) SOL',
  'SOL Balance SOL',
  'MATIC Amount MATIC',
  'Fee (MATIC) MATIC',
  'MATIC Balance MATIC',
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

const pairMap = new Map<string, { from?: Ticker; to?: Ticker }>([
  ['BATUSD', { from: 'BAT', to: 'USD' } as const],
  ['AVAXUSD', { from: 'AVAX', to: 'USD' } as const],
  ['DAIUSD', { from: 'DAI', to: 'USD' } as const],
  ['EOSUSD', { from: 'EOS', to: 'USD' } as const],
  ['GNOUSD', { from: 'GNO', to: 'USD' } as const],
  ['GNOUSD', { from: 'GNO', to: 'USD' } as const],
  ['MATICUSD', { from: 'MATIC', to: 'USD' } as const],
  ['SOLUSD', { from: 'SOL', to: 'USD' } as const],
  ['UNIUSD', { from: 'UNI', to: 'USD' } as const],
  ['GUSD', {}],
  ['GUSDUSD', {}],
  ['USD', {}],
  ['USDCUSD', {}],
  ['USDTZUSD', {}],
  ['BTC', { from: 'BTC', to: 'USD' } as const],
  ['BTCUSD', { from: 'BTC', to: 'USD' } as const],
  ['XBTUSDC', { from: 'BTC', to: 'USD' } as const],
  ['ETH', { from: 'ETH', to: 'USD' } as const],
  ['ETHUSD', { from: 'ETH', to: 'USD' } as const],
  ['XETHZUSD', { from: 'ETH', to: 'USD' } as const],
  ['XXBTZUSD', { from: 'BTC', to: 'USD' } as const],
  ['XXLMZUSD', { from: 'XLM', to: 'USD' } as const],
])

/** Extracts the currency symbols from a Kraken trading pair. */
const pair = (p: string): { from?: Ticker; to?: Ticker } => {
  const array = pairMap.get(p)
  if (!array) {
    error(`Unrecognized trading pair: ${p}`)
  }
  return array!
}

/** Returns true if the given input path is a directory. */
const isDir = (inputPath: string): boolean => fs.lstatSync(inputPath).isDirectory()

/** Returns true if the file is one of the ignored file names. */
const ignoreTradeFile = (file: string): boolean => file === '.DS_Store'

// replace duplicate Cur. with CurBuy, CurSell, CurFee
const fixCointrackingHeader = (input: string): string => {
  const lines = input.split('\n')
  return ([] as string[])
    .concat(lines[0].replace('Cur.', 'CurBuy').replace('Cur.', 'CurSell').replace('Cur.', 'CurFee'), lines.slice(1))
    .join('\n')
}

/** Converts a trade in the Kraken schema to the Cointracking schema. */
const krakenTradeToCointracking = (trade: KrakenTrade): CoinTrackingTrade | null => {
  const { from, to } = pair(trade.pair)!
  // ignore USDC/GUSD -> USD trades
  if ((trade.type === 'buy' || trade.type === 'sell') && !from && !to) return null
  return {
    Type:
      trade.type === 'buy' || trade.type === 'sell'
        ? 'Trade'
        : (`${trade.type[0].toUpperCase()}${trade.type.slice(1).toLowerCase()}` as CoinTrackingTrade['Type']),
    Buy: trade.type === 'buy' || trade.type === 'deposit' ? +trade.cost / trade.price : +trade.cost,
    CurBuy: trade.type === 'buy' || trade.type === 'deposit' ? from : 'USD',
    Sell: trade.type === 'sell' ? +trade.cost / trade.price : +trade.cost,
    CurSell: trade.type === 'sell' ? from : 'USD',
    Exchange: 'Kraken',
    'Trade Date': trade.time,
    // Use Kraken-provided price
    // Not part of Cointracking data schema
    Price: +trade.price,
  }
}

/** Converts a trade in the Gemini schema to the Cointracking schema. */
const geminiTradeToCointracking = (trade: GeminiTrade): CoinTrackingTrade | null => {
  const { from, to } = pair(trade.Symbol)
  // ignore USDC/GUSD -> USD trades
  if (
    trade.Specification.includes('Gemini Credit Card Reward Payout') ||
    trade.Symbol === 'USD' ||
    ((trade.Type === 'Buy' || trade.Type === 'Sell') && !from && !to)
  )
    return null

  const costRaw = trade[`${to} Amount ${to}` as keyof GeminiTrade]

  if ((trade.Type === 'Buy' || trade.Type === 'Sell') && !costRaw) {
    error(`Missing ${to} cost`, trade)
  }

  const buyAmountRaw = trade[`${from} Amount ${from}` as keyof GeminiTrade]

  if ((trade.Type === 'Buy' || trade.Type === 'Sell') && !buyAmountRaw) {
    error(`Missing ${from} buyAmount`, trade)
  }

  const cost = parseFloat((costRaw || '0').replace(/[$(),]/g, ''))
  const buyAmount = parseFloat((buyAmountRaw || '0').replace(/[$(),]/g, ''))
  const price = cost / buyAmount
  const [year, month, day] = trade.Date.split('-')

  return {
    Type:
      trade.Type === 'Buy' || trade.Type === 'Sell'
        ? 'Trade'
        : trade.Type === 'Credit'
          ? 'Deposit'
          : trade.Type === 'Debit'
            ? 'Withdrawal'
            : trade.Type,
    Buy: trade.Type === 'Buy' || trade.Type === 'Credit' ? cost / price : cost,
    CurBuy: trade.Type === 'Buy' || trade.Type === 'Credit' ? from : 'USD',
    Sell: trade.Type === 'Sell' ? cost / price : cost,
    CurSell: trade.Type === 'Sell' ? from : 'USD',
    Exchange: 'Gemini',
    'Trade Date': `${day}.${month}.${year} ${trade['Time (UTC)']}`,
    Price: price,
  }
}

/** Converts a trade in the Uniswap schema to the Cointracking schema. */
const uniswapTradeToCointracking = (trade: UniswapTrade): CoinTrackingTrade | null => {
  if (trade.type !== 'exchange') {
    throw new Error('Unrecognized Uniswap trade type: ' + trade.type)
  }

  const buyAmount = parseFloat(trade.to.amount || '0')
  const sellAmount = parseFloat(trade.from.amount || '0')
  const date = new Date(trade.date)

  const days = date.getDate().toString().padStart(2, '0')
  const month = (date.getMonth() + 1).toString().padStart(2, '0')
  const year = date.getFullYear()
  const hours = date.getHours().toString().padStart(2, '0')
  const minutes = date.getMinutes().toString().padStart(2, '0')

  return {
    Type: 'Trade',
    Buy: buyAmount,
    CurBuy: trade.to.currency.symbol,
    Sell: sellAmount,
    CurSell: trade.from.currency.symbol,
    Exchange: 'Uniswap',
    'Trade Date': `${days}.${month}.${year} ${hours}:${minutes}`,
    Price: sellAmount / buyAmount,
  }
}

/** Loads a trade history file in one of the supported formats. */
const loadTradeHistoryFile = async (file: string | null): Promise<CoinTrackingTrade[]> => {
  if (!file) return []
  const text = fs.readFileSync(file, 'utf-8')
  const ext = path.extname(file).toLowerCase()

  // json
  // Uniswap is the only supported json format
  switch (ext) {
    case '.json': {
      const uniswapTrades = JSON.parse(text) as UniswapTrade[]
      const trades = uniswapTrades.map(uniswapTradeToCointracking).filter(nonNull)
      return trades
    }
    case '.csv':
      {
        const headerColumns = text
          .split('\n')[0]
          .split(',')
          .map(col => col.replace(/["\r]/g, ''))

        // CoinTracking
        if (cointrackingColumns.every(col => headerColumns.includes(col))) {
          return (await csvtojson().fromString(fixCointrackingHeader(text))) as CoinTrackingTrade[]
        }
        // Gemini
        else if (geminiColumns.every(col => headerColumns.includes(col))) {
          const geminiTrades = (await csvtojson().fromString(text)) as GeminiTrade[]
          return geminiTrades.map(geminiTradeToCointracking).filter(nonNull)
        }
        // Kraken
        else if (krakenColumns.every(col => headerColumns.includes(col))) {
          const krakenTrades = (await csvtojson().fromString(text)) as KrakenTrade[]
          return krakenTrades
            .map(row => {
              const trade = krakenTradeToCointracking(row)
              return [
                trade,
                // assume that funds are immediately withdrawn after a sale so that they are removed from the stock
                trade && row.type === 'sell'
                  ? ({
                      ...trade,
                      Type: 'Withdrawal' as const,
                      Buy: null,
                      BuyCur: null,
                    } as CoinTrackingTrade)
                  : null,
              ]
            })
            .flat()
            .filter(nonNull)
        }
      }
      break

    default:
      throw new Error('Unrecognized file type: ' + file)
  }

  return []
}

/** Loads all trades from a file or directory. */
const loadTrades = async (inputPath: string, limit?: number): Promise<CoinTrackingTrade[]> => {
  let inputPaths: string[] = []

  // dir
  if (isDir(inputPath)) {
    console.info('\nInput files:')
    inputPaths = await Promise.all(
      fs
        .readdirSync(inputPath)
        .sort()
        .map(file => {
          const fullPath = path.resolve(inputPath, file)
          if (isDir(fullPath) || ignoreTradeFile(file)) return null
          console.info(`  ${file}`)
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
  const tradesByFile = await Promise.all(inputPaths.map(loadTradeHistoryFile))
  const trades = tradesByFile.flat()

  // return trades sorted by date
  return trades
    .sort((a, b) => {
      const dateA = new Date(normalDate(a['Trade Date']))
      const dateB = new Date(normalDate(b['Trade Date']))
      return dateA === dateB ? 0 : dateA < dateB ? -1 : 1
    })
    .slice(0, limit)
}

export default loadTrades
