# MVP lifecycle run on stellar:testnet — the deploy script's defaults

This run is not against the deployment the record names. It is the one that
proves `contracts/script/deploy-testnet.sh` itself: a kernel deployed from
this tree with the script's own defaults (120 s window, 100 bps fee), taken
through the same path. The deployment the app and the demo run on is in
[stellar-mvp.md](./stellar-mvp.md), and its run is
[lifecycle-testnet.md](./lifecycle-testnet.md).

Run at 2026-09-20T01:36:59.249Z against https://soroban-testnet.stellar.org. One job, the MVP path:
create, price, fund, submit, the window, finalize, withdraw. The five settlement
paths, real USDC and the keeper are phase 2.

| | |
|---|---|
| Kernel | [CBSPPHW2P5NGITR7Z5NJIN6IB5VIOHOQDSVMWXT4LH6WZCHMHUA2KFJQ](https://stellar.expert/explorer/testnet/contract/CBSPPHW2P5NGITR7Z5NJIN6IB5VIOHOQDSVMWXT4LH6WZCHMHUA2KFJQ) |
| Payment token | XLM, `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` |
| Challenge window | 120 s |
| Platform fee | 100 bps |
| Job | 1 |
| Client | `GCIF3AENXBQ2RHFXKUFPTLVH52TC7ZCF3PRQDFLKYKINVTRRS33P6WQX` |
| Provider | `GDS6MP5KITLZESS7WN7J5KOLNPPURUN7JEY7XPEWCODXF6GB7P6ETPT4` |
| Budget | 10 XLM |
| Payout | 9.9 XLM |
| Fee kept | 0.1 XLM |

| Step | Transaction | Ledger | Fee charged |
|---|---|---|---|
| createJob (id 1) | [dc02461d…](https://stellar.expert/explorer/testnet/tx/dc02461d4471578b3480cff4af7b575f5cd68451f43b0b4a3696dcc3b2783688) | 4768896 | 0.0151648 XLM |
| setBudget | [c7041f02…](https://stellar.expert/explorer/testnet/tx/c7041f02e575c23b862f938b684808f243ba9803f0b5c02aa2801d5a2c43dfd3) | 4768897 | 0.0013901 XLM |
| fund | [5bff2599…](https://stellar.expert/explorer/testnet/tx/5bff2599fb64f7baaa8fcbc5fc6ecc2858e6a70b9d58292c59b0d06f3cbbb62b) | 4768898 | 0.0242772 XLM |
| submit | [dfb77540…](https://stellar.expert/explorer/testnet/tx/dfb77540e8f7b69cc60a3ec1ec6d9bced91902d357091261a13eac15d49b33c7) | 4768899 | 0.0022525 XLM |
| finalize (inside the window) | refused in simulation with WindowOpen; nothing was sent | | |
| finalize (permissionless) | [5506ee1e…](https://stellar.expert/explorer/testnet/tx/5506ee1ed418f61e11509560d6b4163520bfbdb4c810bffdc6976d45ad56aebb) | 4768925 | 0.0097659 XLM |
| withdraw (9.9 XLM) | [ffb77688…](https://stellar.expert/explorer/testnet/tx/ffb77688c1c1b2127247b168625a312a50d5b38d014af80f40279538527db8a8) | 4768926 | 0.0028536 XLM |

Resource and inclusion fees for the run: 0.0557041 XLM over 6 transactions.

The fee column is `feeCharged` from each transaction's own result, which is the
inclusion fee plus the resource fee with refunds applied: what the account actually
paid, not what was bid.
