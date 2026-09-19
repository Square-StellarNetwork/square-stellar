// Port (contracts/vendor/stellar-8004/PORTING.md): upstream also declares
// `consecutive`, `enumerable`, `royalties` and `votes`. The 8004 registries use
// none of them; `burnable` stays because `overrides.rs` implements
// `BurnableOverrides` for `Base` with its functions.
pub mod burnable;
