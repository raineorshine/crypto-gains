Historical prices provided by the [cryptocompare API](https://min-api.cryptocompare.com/documentation?key=Historical&cat=dataPriceHistorical).

## Usage

    $ node index.js data.csv

    $ node index.js data.csv summary

If a symbol cannot be found, errors will be shown and the price will be empty:

    402/402 100% 0.0s (2 errors)
    No price for BLOOBLOO on 2018-12-11
    No price for BLOGBING on 2018-12-13
    Type  Buy Cur.  Sell  Cur.Sell Exchange  Trade Group Comment Trade Date  Price
    "Income","1.00000000","BLOOBLOO","-","Coinssss","",,"11.12.2018 00:00"
    "Income","10.00000000",BLOGBING","-","Coinssss","",,"13.12.2018 00:00"
    "Income","0.63300000","BTC","-","Kraken","Krakenger","18.06.2016 15:14"  "753.77"

## Installation

1. Clone the repo.
2. Rename sample-secure.json to secure.json and add valid API keys.
3. [sample-data.csv](https://github.com/raineorshine/cost-basis-filler/blob/master/sample-data.csv) is from [cointracking.info/trades](https://cointracking.info/trades.php).
