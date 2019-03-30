Historical prices provided by the [cryptocompare API](https://min-api.cryptocompare.com/documentation?key=Historical&cat=dataPriceHistorical).

## Usage

```sh
Usage: index.js <data.csv> [options]

Options:
  --help        Show help                                              [boolean]
  --version     Show version number                                    [boolean]
  --accounting  Accounting type: fifo/lifo.                    [default: "fifo"]
  --exchange    Exchange for price lookups.                  [default: "cccagg"]
  --limit       Limit number of transactions processed.      [default: Infinity]
  --mockprice   Mock price in place of cryptocompare lookups.
  --output      Output directory for results.
  --verbose     Show more errors and warnings.
```

## Installation

1. Clone the repo.
2. Rename sample-secure.json to secure.json and add valid API keys.
3. [sample-data.csv](https://github.com/raineorshine/cost-basis-filler/blob/master/sample-data.csv) is from [cointracking.info/trades](https://cointracking.info/trades.php).
