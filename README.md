Historical prices provided by the [cryptocompare API](https://min-api.cryptocompare.com/documentation?key=Historical&cat=dataPriceHistorical).

## Usage

```sh
Usage: index.js <data.csv> [options]

Options:
  --accounting  Accounting type: fifo/lifo.                [lifo|fifo (default)]
  --exchange    Exchange for price lookups.                  [default: "cccagg"]
  --help        Show help                                              [boolean]
  --likekind    Allow like-kind exchange before 2018.            [default: true]
  --limit       Limit number of transactions processed.      [default: Infinity]
  --mockprice   Mock price in place of cryptocompare lookups.
  --output      Output directory for results.          [stdout if not specified]
  --verbose     Show more errors and warnings.
  --version     Show version number                                    [boolean]
```

## Installation

1. Clone the repo.
2. Rename sample-secure.json to secure.json and add valid API keys, icos (optional), and airdrop tokens to ignore (optional)
3. [sample-data.csv](https://github.com/raineorshine/cost-basis-filler/blob/master/sample-data.csv) is from [cointracking.info/trades](https://cointracking.info/trades.php). *must be sorted by trade date ascending*
