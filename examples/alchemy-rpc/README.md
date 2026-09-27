# Alchemy Node RPC demo

A standalone Node.js 22+ project using `dotenv` and Node's built-in `fetch` to
read Robinhood Chain Mainnet through Alchemy. It makes three read-only RPC calls.

## Run

From the Fletch repository root:

```sh
cd examples/alchemy-rpc
npm ci
cp .env.example .env
```

Please create/edit `.env` with your own key:

```dotenv
ALCHEMY_API_KEY=<my-key>
```

Replace the placeholder, then run:

```sh
npm start
```

The script reads `process.env.ALCHEMY_API_KEY` after loading `.env` from its own
directory. An already exported environment variable takes precedence. `.env` is
ignored by Git; `.env.example` contains only a placeholder. Requests have a
15-second timeout and failures exit with status 1 without printing the endpoint.

## Response

The script sends standard JSON-RPC 2.0 requests to
`https://robinhood-mainnet.g.alchemy.com/v2/<key>`. Each request contains a
`method`, `params`, and an `id` matched by the response. Successful responses have
`result`; RPC failures have `error`, sometimes even with HTTP 200.

| Method | Result | Demo output |
| --- | --- | --- |
| `eth_chainId` | Hexadecimal chain ID | `chainIdHex: "0x1237"`, `chainId: "4663"`; another chain causes an error |
| `eth_blockNumber` | Latest block height, hexadecimal | Used to request that exact block |
| `eth_getBlockByNumber` | Block data; `false` requests transaction hashes | Height, hash, UTC timestamp and the number of transactions in that block |

Numeric quantities arrive as hexadecimal strings. The demo converts heights with
`BigInt` and prints decimal strings to avoid JavaScript integer precision loss.
`transactionCount` is the count in the sampled block. The head block can change
in a reorganization; this example does not claim finality. Block values change on
every run, and RPC usage counts toward your Alchemy allowance.

References: [Alchemy chain ID](https://www.alchemy.com/docs/chains/robinhood-chain/robinhood-chain-api-endpoints/eth-chain-id),
[block number](https://www.alchemy.com/docs/chains/robinhood-chain/robinhood-chain-api-endpoints/eth-block-number),
[block lookup](https://www.alchemy.com/docs/chains/robinhood-chain/robinhood-chain-api-endpoints/eth-get-block-by-number).
