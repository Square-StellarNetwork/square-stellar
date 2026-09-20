# MVP lifecycle run on stellar:testnet

This file always holds the latest run and is rewritten every time the runner is used.
The dated record of this run is [lifecycle-testnet-2026-09-20.md](./lifecycle-testnet-2026-09-20.md),
which nothing overwrites, and that is the file a document quoting a figure should link.

Run at 2026-09-20T01:47:37.303Z against https://soroban-testnet.stellar.org. One job, the MVP path:
create, price, fund, submit, the window, finalize, withdraw. The five settlement
paths, real USDC and the keeper are phase 2.

| | |
|---|---|
| Kernel | [CATY3ZGNSS44HY4GAPBBAWQUW4E7YHNHG7GVFLUWPJPO22WP3O5YZVII](https://stellar.expert/explorer/testnet/contract/CATY3ZGNSS44HY4GAPBBAWQUW4E7YHNHG7GVFLUWPJPO22WP3O5YZVII) |
| Payment token | XLM, `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` |
| Challenge window | 30 s |
| Platform fee | 250 bps |
| Job | 4 |
| Client | `GC7XJHVK2KGZ52BKPXBKLSYZDRRFVKWKWYWFLU4TNRYBV3MAHGIXURTY` |
| Provider | `GB7WJYWXWYAZ7ZLVTNPUEVHE5PR3P3DD34RK6AL4RZS7KLTEADSO3THT` |
| Budget | 10 XLM |
| Payout | 9.75 XLM |
| Fee kept | 0.25 XLM |

| Step | Transaction | Ledger | Fee charged |
|---|---|---|---|
| createJob (id 4) | [64fd3f01…](https://stellar.expert/explorer/testnet/tx/64fd3f01312c243a66fb4a770f5229c028c17118cdba1b716cdbc65e4ae1f839) | 4769041 | 0.0174976 XLM |
| setBudget | [d7f72ec1…](https://stellar.expert/explorer/testnet/tx/d7f72ec1110c50a633f089cc942d41ce9281ce59ad438d4f844814d82e31768c) | 4769042 | 0.0013901 XLM |
| fund | [b8403246…](https://stellar.expert/explorer/testnet/tx/b840324615e3d6f4ef81146d12fcdc86fac5e555931fde799c25ab381d268828) | 4769043 | 0.0026418 XLM |
| submit | [d82a4c23…](https://stellar.expert/explorer/testnet/tx/d82a4c23d72b44eeae83ca18d5365624ab294f0423fe2072aeeeab9962bafc3c) | 4769044 | 0.0022553 XLM |
| finalize (inside the window) | refused in simulation with WindowOpen; nothing was sent | | |
| finalize (permissionless) | [f695bc25…](https://stellar.expert/explorer/testnet/tx/f695bc255b1540a2aaa4de6a35cd93e1b4ab90b587f3cf2aa4d802edef0b2b53) | 4769052 | 0.0062125 XLM |
| withdraw (9.75 XLM) | [2e6ed460…](https://stellar.expert/explorer/testnet/tx/2e6ed460a5555372099e950650d5d07ba8a638b13f9c85187707a24f60ee1d80) | 4769054 | 0.0028771 XLM |

Resource and inclusion fees for the run: 0.0328744 XLM over 6 transactions.

The fee column is `feeCharged` from each transaction's own result, which is the
inclusion fee plus the resource fee with refunds applied: what the account actually
paid, not what was bid.
